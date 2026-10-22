/**
 * @gteki/scene-api hook for the shared explorer (apps/web). Reuses the Shinjuku lane's
 * renderer-neutral layout + Three.js builder; geometry is a visual/physical approximation and
 * never adds routes (the explorer routes only on graph.json).
 */
import { WALKER_BODY, type BuildScene, type SceneContext, type SpawnPoint, type StationScene, type WallSegment } from "@gteki/scene-api";
import type * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildStation, slabGeometry, soffitGeometry } from "../scene/build.ts";
import { railingWalls, type Plan } from "../scene/layout.ts";
import { surfaceEntrances, surfaceRoofs } from "../scene/surface-layout.ts";
import { contextGlbFor, contextVariant, prepareContext } from "../scene/context.ts";
import plan from "../data/plan.json" with { type: "json" };

/**
 * The PLATEAU street-context GLB for this quality (low on low, high on high), or null: station.json does not
 * declare it, the explorer does not bundle it, or it fails to load or is not what tools/gis writes. Any null
 * leaves the procedural LOD1 street untouched. Loaded before the build so no LOD1 geometry is made to be thrown away.
 */
async function loadStreetContext(ctx: SceneContext): Promise<THREE.Object3D | null> {
  const uri = contextGlbFor(ctx);
  if (!uri) return null;
  try {
    const loaded = await ctx.loadGlb(uri);
    if (prepareContext(loaded.scene, contextVariant(uri))) return loaded.scene;
    console.warn(`[gteki] shinjuku street context ${uri} is not the visual-only ctx_bldg_* file context-omit.json was written for; using the procedural street`);
    loaded.scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  } catch (err) {
    console.warn(`[gteki] shinjuku street context ${uri} failed to load; using the procedural street`, err);
  }
  return null;
}

export const buildScene: BuildScene = async (ctx) => {
  const T = ctx.THREE;
  const streetContext = await loadStreetContext(ctx);
  const built = buildStation(ctx.bundle, plan as unknown as Plan, { quality: ctx.quality, streetContext });
  const { layout } = built;

  // Invisible walk proxies: the explorer raycasts these from above (non-recursive), so each is a Mesh.
  // DoubleSide: the explorer's third-person camera also raycasts these, and from below it must hit
  // the slab's underside (FrontSide back faces are invisible to rays, so the camera passed through).
  const proxyMat = new T.MeshBasicMaterial({ visible: false, side: T.DoubleSide });
  const walkable: THREE.Mesh[] = [];
  const proxies = new T.Group();
  proxies.name = "walk proxies (invisible)";
  const addProxy = (geo: THREE.BufferGeometry) => {
    const m = new T.Mesh(geo, proxyMat);
    m.userData.gteki_role = "walkable";
    proxies.add(m);
    walkable.push(m);
  };
  for (const lv of layout.levels) for (const s of lv.slabs) addProxy(slabGeometry(s.rings, s.z, 1));
  for (const p of layout.pads) addProxy(slabGeometry(p.rings, p.z, 1));
  for (const p of layout.linkStrips) addProxy(slabGeometry(p.rings, p.z, 1));
  for (const p of layout.streetPads) addProxy(slabGeometry(p.rings, p.z, 1));
  for (const r of layout.runs) {
    // Ramp quad along the stair/escalator run (renderer frame: x, z, -y).
    const dx = r.b.x - r.a.x;
    const dy = r.b.y - r.a.y;
    const L = Math.hypot(dx, dy) || 1;
    const nx = (-dy / L) * (r.width / 2);
    const ny = (dx / L) * (r.width / 2);
    const g = new T.BufferGeometry();
    const v = [
      [r.a.x + nx, r.a.z, -(r.a.y + ny)],
      [r.a.x - nx, r.a.z, -(r.a.y - ny)],
      [r.b.x - nx, r.b.z, -(r.b.y - ny)],
      [r.b.x + nx, r.b.z, -(r.b.y + ny)],
    ].flat();
    g.setAttribute("position", new T.Float32BufferAttribute(v, 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    addProxy(g);
  }
  built.root.add(proxies);

  // The street context (PLATEAU surface) is shown only when the viewer is where it can be seen; the lane
  // app reports its camera via setViewer, but scene-api's update() carries no camera. A draw-nothing probe
  // (empty geometry, never culled) reports whichever camera renders the station, every render.
  const probeMat = new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
  const probe = new T.Mesh(new T.BufferGeometry(), probeMat);
  probe.name = "viewer probe (draws nothing)";
  probe.frustumCulled = false;
  // update() runs before each render, so it re-reports the last seen camera's *current* position; the
  // probe alone would lag a frame (the render list is already built when onBeforeRender fires).
  let viewCamera: THREE.Camera | null = null;
  const reportViewer = (cam: THREE.Camera) => built.setViewer?.({ x: cam.position.x, y: -cam.position.z, z: cam.position.y });
  probe.onBeforeRender = (_r, _s, cam) => {
    viewCamera = cam;
    reportViewer(cam);
  };
  built.root.add(probe);

  // Level walls only block bodies near their own level (bodyMax); approximate that for the
  // explorer's height-band walker by capping the wall band at bodyMax + 1.7 m body height.
  const walls: WallSegment[] = [...layout.levels.flatMap((lv) => lv.walls), ...layout.runWalls, ...railingWalls(layout), ...built.propWalls].map((w) => ({
    a: w.a,
    b: w.b,
    // The shared walker blocks feet f when zMin ≤ f + bodyTopM and zMax ≥ f + bodyBottomM (WALKER_BODY),
    // so WalkWorld's body limits fold into the band: bodyMin → raise zMin, bodyMax → lower zMax.
    zMin: w.bodyMin !== undefined ? Math.max(w.zMin, w.bodyMin + WALKER_BODY.bodyTopM) : w.zMin,
    zMax: w.bodyMax !== undefined ? Math.min(w.zMax, w.bodyMax + WALKER_BODY.bodyBottomM) : w.zMax,
  }));
  // The explorer's follow camera only raycasts colliders + walkable, so without colliders it swung
  // through walls. One invisible DoubleSide mesh of the same wall bands gives it something to hit.
  // It cannot block more than `walls` already does: a collider ray at feet + h (0.2 ≤ h ≤ 1.7) only
  // hits a quad whose band contains that height, which the walls' band test blocks anyway.
  const colliders: THREE.Mesh[] = [];
  if (walls.length) {
    const pos: number[] = [];
    const idx: number[] = [];
    for (const w of walls) {
      if (w.zMax <= w.zMin) continue;
      const i = pos.length / 3;
      pos.push(w.a.x, w.zMin, -w.a.y, w.b.x, w.zMin, -w.b.y, w.b.x, w.zMax, -w.b.y, w.a.x, w.zMax, -w.a.y);
      idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new T.Mesh(g, proxyMat);
    m.name = "wall collider (invisible)";
    m.userData.gteki_role = "collider";
    proxies.add(m);
    colliders.push(m);
  }
  // Underground ceilings and shaft soffits: the explorer's follow camera rays rise behind the head and
  // otherwise left through the ceiling (only street pads are walkable above B1), viewing the station from
  // above its own roof. Horizontal walk rays never hit these horizontal/inclined caps along an edge: the
  // enclosure test keeps every edge ≥ 2.1 m below them, above the 1.2 m ray.
  // Camera blockers (scene-api `cameraBlockers`): the same caps, already cut wherever a stairwell or
  // shaft passes, so the camera can follow down a stairwell. The caps also stay in `colliders`: the
  // explorer's street probe tests only walls and floors for open sky, and a roof must count there too.
  const cameraBlockers: THREE.Mesh[] = [];
  const underground = new Set(layout.levels.filter((lv) => lv.z < -0.5).map((lv) => lv.floorId));
  const caps = [
    ...layout.levels.filter((lv) => underground.has(lv.floorId)).flatMap((lv) => lv.ceilings.map((s) => slabGeometry(s.rings, s.z, 1, true))),
    // Above-ground source spaces are drawn with ceilings too: the 1F entrance structures over exit stairs
    // and landings, whose E27 links are roofed (roof = 2). Capping them keeps the camera and the street
    // probe under the roof that is drawn, instead of reading the landing under it as open sky.
    ...layout.levels.filter((lv) => !underground.has(lv.floorId)).flatMap((lv) => lv.ceilings.map((s) => slabGeometry(s.rings, s.z, 1, true))),
    ...layout.soffits.filter((s) => underground.has(s.floorId)).map(soffitGeometry),
    // Street entrance canopies: the glass roof sits at 3.08 m; cap just below it so the follow camera
    // stays under the canopy instead of looking down onto the bright glazing.
    ...surfaceEntrances(layout, ctx.bundle).map((e) => {
      const n = { x: -e.u.y, y: e.u.x };
      const corner = (sl: number, sw: number) => [e.center.x + e.u.x * e.halfLength * sl + n.x * e.halfWidth * sw, 3.0, -(e.center.y + e.u.y * e.halfLength * sl + n.y * e.halfWidth * sw)];
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)].flat(), 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      return g;
    }),
    // Glazing over roofed (E27 roof = 2) runs open beyond the canopies, at 3.05 m: cap just below it.
    ...surfaceRoofs(layout, ctx.bundle).map((r) => {
      const n = { x: -r.u.y, y: r.u.x };
      const corner = (sl: number, sw: number) => [r.center.x + r.u.x * r.halfLength * sl + n.x * r.halfWidth * sw, 2.95, -(r.center.y + r.u.y * r.halfLength * sl + n.y * r.halfWidth * sw)];
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)].flat(), 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      return g;
    }),
  ];
  if (caps.length) {
    // Position-only, non-indexed copies so every cap merges into one raycast mesh.
    const flat = caps.map((c) => {
      const f = c.index ? c.toNonIndexed() : c.clone();
      for (const k of Object.keys(f.attributes)) if (k !== "position") f.deleteAttribute(k);
      return f;
    });
    const g = mergeGeometries(flat, false);
    for (const c of [...caps, ...flat]) c.dispose();
    if (g) {
      g.computeBoundingSphere();
      const m = new T.Mesh(g, proxyMat);
      m.name = "ceiling collider (invisible)";
      m.userData.gteki_role = "collider";
      proxies.add(m);
      colliders.push(m);
      cameraBlockers.push(m);
    }
  }
  // Hanging wayfinding boxes and fence sign panels are signage (role "sign"): the explorer dithers them
  // where they come between the camera and the walker instead of stopping the camera in front of a dark
  // board (A/B/C explorer walk: blockers framed 0.16–0.25 near-black close-ups). The drawn street paving
  // and kerbs are camera-only blockers: nothing may look through the pavement from below.
  built.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.name.startsWith("sign-faces:") || m.name === "sign-cases" || m.name === "Restricted area" || m.name === "No entry") m.userData.gteki_role = "sign";
    else if (m.name === "surface-ground" || m.name === "surface-stone") cameraBlockers.push(m);
  });
  // Underground station: it owns its lighting, as in the lane app. The explorer's default sun cast hard
  // pillar shadows across B1 floors through no opening at all. Same hemisphere and image-based light as
  // the lane app (app/src/main.ts), applied to the station's own materials only.
  const hemi = new T.HemisphereLight("#fff6ea", "#4a4642", 0.85);
  hemi.name = "station hemisphere";
  built.root.add(hemi);
  let envTarget: THREE.WebGLRenderTarget | null = null;
  if (ctx.renderer) {
    const pmrem = new T.PMREMGenerator(ctx.renderer);
    const room = new RoomEnvironment();
    envTarget = pmrem.fromScene(room, 0.04);
    pmrem.dispose();
    room.dispose(); // the capture scene's geometry/materials are throwaway
    const tex = envTarget.texture;
    built.root.traverse((o) => {
      for (const m of [(o as THREE.Mesh).material].flat()) {
        if (m instanceof T.MeshStandardMaterial && !m.envMap) {
          m.envMap = tex;
          m.envMapIntensity = 0.55;
          m.needsUpdate = true;
        }
      }
    });
  }

  const nodes = new Map(ctx.bundle.nodes.map((n) => [n.id, n]));
  const spawnPoints: SpawnPoint[] = (ctx.bundle.spawnNodeIds ?? []).flatMap((id) => {
    const n = nodes.get(id);
    if (!n) return [];
    const poi = ctx.bundle.pois.find((p) => p.connectorNodeIds.includes(id));
    const label = poi?.names.find((x) => x.lang === "ja")?.text;
    return [{ x: n.position.x, y: n.position.y, z: layout.nodeZ.get(id) ?? n.renderZ ?? 0, headingDeg: 0, nodeId: id, ...(label ? { label } : {}) }];
  });

  const scene: StationScene = {
    root: built.root,
    walkable,
    colliders,
    cameraBlockers,
    walls,
    spawnPoints,
    environment: { background: 0x0d0e10, exposure: 0.92, lighting: "scene" },
    update: (dt, t) => {
      if (viewCamera) reportViewer(viewCamera);
      built.update(dt, t);
    },
    dispose() {
      built.dispose();
      for (const m of [...walkable, ...colliders, probe]) m.geometry.dispose();
      proxyMat.dispose();
      probeMat.dispose();
      envTarget?.dispose(); // render target owns the texture plus its framebuffer/depth
    },
  };
  return scene;
};
