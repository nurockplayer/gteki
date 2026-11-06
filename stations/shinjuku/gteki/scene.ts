/**
 * @gteki/scene-api hook for the shared explorer (apps/web). Reuses the Shinjuku lane's
 * renderer-neutral layout + Three.js builder; geometry is a visual/physical approximation and
 * never adds routes (the explorer routes only on graph.json).
 */
import { WALKER_BODY, buildWallProps, wallPropDrawRanges, type AcousticZone, type BuildScene, type NavmeshPaths, type SpawnPoint, type StationScene, type WallSegment } from "@gteki/scene-api";
import type * as THREE from "three";
import { cacheBvh, raycastObject } from "../../../apps/web/src/explorer/meshBvh.ts";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { OEDO_MAGENTA, STREET_UNDERSIDE, buildStation, slabGeometry, soffitGeometry, type BuiltStation } from "../scene/build.ts";
import { kitSwapRequested, prepareKitSwap, type KitSwap } from "../scene/kit/index.ts";
import { currentTimeBand } from "../../ikebukuro/scene/time-band.ts";
import { railingWalls, type Plan } from "../scene/layout.ts";
import { surfaceEntrances, surfaceRoofs, withSurfaceMemo } from "../scene/surface-layout.ts";
import { clearLayoutCache } from "../scene/build-cache.ts";
import plan from "../data/plan.json" with { type: "json" };
import { loadShopKit, type LoadedShopKit, type Opening, type Shop } from "../../ikebukuro/scene/kit_shops.ts";
import type { KitManifest } from "../../ikebukuro/scene/kit.ts";
import { createTrainSound } from "./train-sound.ts";
import { crowdEdges } from "./explorer-crowd.ts";
import { buildCrowd } from "../../ikebukuro/scene/crowd.ts";
import { createAmbience } from "../../ikebukuro/scene/ambience.ts";
import { createZoneAcoustics, ZONE_ACOUSTICS } from "../../ikebukuro/scene/zone-acoustics.ts";
import { createStationSound, type V3 } from "../../ikebukuro/scene/station-sound.ts";
import shopKitManifest from "../scene/shop_kit.json" with { type: "json" };
import shopBays from "../scene/shop_bays.json" with { type: "json" };
import shopPlacements from "../scene/shop_placements.json" with { type: "json" };
import wallPropPlacements from "../scene/wall-props.ts";

/** Supplement the existing attributed cap only for a camera looking above
 * the walker. The default follow boom and every horizontal walking ray retain
 * the legacy query. Actual roof meshes supply footprints and post-cut heights;
 * no copied fascia buffer or extra stairwell-cut target is introduced.
 * Kept outside assembleScene so its closure cannot retain the build layout. */
function addOverheadRoofQueries(T: typeof THREE, cap: THREE.Mesh, root: THREE.Object3D) {
  Object.defineProperty(cap.userData, "gtekiOverheadRaycast", { value: (ray: THREE.Raycaster, hits: THREE.Intersection[]) => {
    if (ray.ray.origin.y > STREET_UNDERSIDE + 0.0001) return;
    root.traverseVisible((o) => {
      const roof = o as THREE.Mesh;
      if (!roof.isMesh || Array.isArray(roof.material) || !roof.material.visible || roof.material.name !== "mat.ceiling") return;
      cacheBvh(roof.geometry);
      const added: THREE.Intersection[] = [];
      if (roof instanceof T.InstancedMesh && roof.userData.tightCulling) {
        const count = roof.count;
        try {
          // Camera queries need every roof instance, even when rendering culled the batch.
          roof.count = roof.instanceMatrix.count;
          raycastObject(roof, ray, added);
        } finally {
          roof.count = count;
        }
      } else {
        raycastObject(roof, ray, added);
      }
      for (const hit of added) {
        if (!hit.face || hit.point.y > STREET_UNDERSIDE + 0.0001) continue;
        const normal = hit.face.normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(roof.matrixWorld));
        if (Math.abs(normal.y) < 0.000001) continue; // vertical fascias are not roofs
        normal.applyNormalMatrix(new T.Matrix3().getNormalMatrix(cap.matrixWorld).invert());
        hit.face = { ...hit.face, normal };
        hit.object = cap;
        hits.push(hit);
      }
    });
  } });
}

/** Camera that renders the station, reported to the street layer (see the probe in buildScene). */
function viewerTracker(setViewer: ((pos: { x: number; y: number; z: number }) => void) | undefined) {
  let camera: THREE.Camera | null = null;
  const report = (cam: THREE.Camera) => setViewer?.({ x: cam.position.x, y: -cam.position.z, z: cam.position.y });
  return {
    onBeforeRender: (_r: unknown, _s: unknown, cam: THREE.Camera) => { camera = cam; report(cam); },
    refresh: () => { if (camera) report(camera); },
  };
}

/** The shared crowd builder's handle (Ikebukuro's instanced commuters). */
type Crowd = ReturnType<typeof buildCrowd>;

/** update/dispose of the returned scene. They live out here, not inside buildScene, on purpose: a closure
 * keeps its entire defining scope alive, and buildScene's scope holds the layout, the built station and
 * every intermediate array (#72: ~9 MB retained for the life of the scene). Pass only what they use. */
function sceneLifecycle(stepBuilt: (dt: number, t: number) => void, disposeBuilt: () => void, refreshViewer: () => void, crowd: Crowd | null, meshes: THREE.Object3D[], owned: { dispose(): void }[], envTarget: THREE.WebGLRenderTarget | null, stepAudio: ((dt: number, camera?: THREE.Camera) => void) | null, disposeAudio: (() => void) | null) {
  return {
    update: (dt: number, t: number, camera?: THREE.Camera) => {
      refreshViewer();
      stepBuilt(dt, t);
      crowd?.update(dt, t);
      stepAudio?.(dt, camera);
    },
    dispose() {
      disposeBuilt();
      crowd?.dispose();
      disposeAudio?.();
      for (const m of meshes) (m as THREE.Mesh).geometry.dispose();
      for (const o of owned) o.dispose();
      envTarget?.dispose(); // render target owns the texture plus its framebuffer/depth
    },
  };
}

/** Wall props' own draw step (#946): the reaction range is drawn only while an interaction marker is visible. */
function wallPropStepper(markers: THREE.Object3D[], mesh: THREE.Mesh, draws: { idle: number; full: number }) {
  let full = false;
  return () => {
    const next = markers.some((o) => o.visible);
    if (next === full) return;
    full = next;
    mesh.geometry.setDrawRange(0, next ? draws.full : draws.idle);
  };
}

/** Runs the built station's step, then the wall prop step. Module level so neither can retain buildScene (#968). */
function sequence(stepBuilt: (dt: number, t: number) => void, stepProps: () => void) {
  return (dt: number, t: number) => { stepBuilt(dt, t); stepProps(); };
}

/** The crowd's converter. Every closure in buildCrowd shares the context holding it, so it must not close over buildScene (#968). */
function crowdVector(T: typeof THREE, enuToRenderer: (point: { x: number; y: number; z: number }) => [number, number, number]) {
  return (x: number, y: number, z: number) => new T.Vector3(...enuToRenderer({ x, y, z }));
}

/**
 * Explorer ambience and station sound (#859/#863/#926), with the acoustic zone setter. Lives out here for the
 * same reason as sceneLifecycle: the closures keep only the audio nodes and the train-audio sampler, never the
 * build layout or the built station (#968). Conditions and order are unchanged.
 */
function stationAudio({ ambience, stationSound, trainSound, acoustics, crowd, trainAudio }: {
  ambience: ReturnType<typeof createAmbience> | null;
  stationSound: ReturnType<typeof createStationSound> | null;
  trainSound: ReturnType<typeof createTrainSound> | null;
  acoustics: ReturnType<typeof createZoneAcoustics> | null;
  crowd: Crowd | null;
  trainAudio: BuiltStation["trainAudio"];
}) {
  let zone: AcousticZone = "passage";
  let trainAudioElapsed = 0.25;
  const on = ambience !== null || stationSound !== null;
  return {
    stepAudio: on ? (dt: number, camera?: THREE.Camera) => {
      ambience?.update({ nearby: crowd?.nearby() ?? 6, openness: ZONE_ACOUSTICS[zone].openness });
      stationSound?.update(dt, camera);
      trainAudioElapsed += dt;
      if (trainSound && camera && trainAudioElapsed >= 0.25) {
        trainAudioElapsed = 0;
        trainSound.update(trainAudio(), camera.position);
      }
    } : null,
    disposeAudio: on ? () => {
      trainSound?.dispose();
      stationSound?.dispose();
      ambience?.dispose();
      acoustics?.dispose();
    } : null,
    setAcousticZone: acoustics ? (next: AcousticZone) => { zone = next; acoustics.setZone(next); } : null,
  };
}

/**
 * Drops what Shinjuku keeps between opens: the layout/fence snapshot that makes a reopen fast (~7.5 MB of JS
 * heap). Exported as the optional scene-api hook `releaseCaches`, which the explorer calls when it leaves Shinjuku
 * for another station or is disposed, never on a reopen of Shinjuku. The next open then rebuilds the layout once. The baked street table
 * (a 0.4 MB module-level string) cannot be released: it is a static ESM import.
 */
export function releaseShinjukuCaches() {
  clearLayoutCache();
}
export const releaseCaches = releaseShinjukuCaches;

/** Baked stairwell cut recipe for a tier (#650), as a data URL. Dynamic imports keep the bundled recipe text out of headless loads and load one tier only. */
export const stairwellRecipeUrl = async (tier: "high" | "low"): Promise<string | null> =>
  (tier === "high" ? await import("../scene/stairwell-recipe-high.ts") : await import("../scene/stairwell-recipe-low.ts")).default;

/**
 * The explorer hook. The Lane E kit swap (Issue #94) is ON by default for the escalator role only: with no query
 * the scene loads the station's mobile kit bundle and dresses the escalators, and if that fails for any reason it
 * keeps every placeholder. `?kit=1` (or `kit=mobile|full`) opts every hooked role in for QA; `?kit=0` turns the
 * swap off entirely, which is still the same synchronous build as before the kit.
 */
export const buildScene: BuildScene = (ctx) => {
  const request = kitSwapRequested(typeof location === "undefined" ? undefined : location.search);
  const swap = request.enabled ? prepareKitSwap(ctx, { lineColour: OEDO_MAGENTA, ...(request.tier ? { tier: request.tier } : {}), ...(request.roles ? { roles: request.roles } : {}) }) : Promise.resolve(null);
  const shops = loadShopKit(ctx.THREE, ctx, shopKitManifest as KitManifest,
    [...shopPlacements.shops, ...(ctx.privateShops?.shops ?? [])] as Shop[],
    [...shopBays.openings, ...(ctx.privateShops?.openings ?? [])] as Opening[], ctx.quality === "low")
    .catch((error: unknown) => { console.warn("[shinjuku] shop kit failed", error); return null; });
  return Promise.all([swap, shops]).then(([kit, shopKit]) => assembleScene(ctx, kit ?? undefined, shopKit ?? undefined));
};

/**
 * The part of the bundle the plan was authored for. A private build (GTEKI_PRIVATE_OVERLAY) adds nodes and edges
 * the plan has no heights or walls for; built as geometry they would sit at z 0 or open walls in the station. The route
 * still draws them; the scene does not.
 */
export function planBundle(bundle: Parameters<BuildScene>[0]["bundle"]): Parameters<BuildScene>[0]["bundle"] {
  const known = new Set(Object.keys((plan as unknown as Plan).nodeRenderZ));
  // Overlay edges are namespaced `p:<station>:` (gteki-private additions/FORMAT.md), also between two plan nodes.
  const planEdge = (e: { id: string; from: string; to: string }) => !e.id.startsWith("p:") && known.has(e.from) && known.has(e.to);
  if (bundle.nodes.every((n) => known.has(n.id)) && bundle.edges.every(planEdge)) return bundle;
  return { ...bundle, nodes: bundle.nodes.filter((n) => known.has(n.id)), edges: bundle.edges.filter(planEdge),
    // A POI keeps the connectors the plan knows; one with none left is not part of this scene.
    pois: bundle.pois.map((p) => ({ ...p, connectorNodeIds: p.connectorNodeIds.filter((id) => known.has(id)) })).filter((p) => p.connectorNodeIds.length > 0) };
}

/** The scene build itself, with an optional, already prepared kit swap. Exported for tests. */
export const assembleScene = (ctx: Parameters<BuildScene>[0], kit?: KitSwap, shopKit?: LoadedShopKit): StationScene => {
  const T = ctx.THREE;
  const low = ctx.quality === "low";
  const sceneBundle = planBundle(ctx.bundle);
  // Decorative train rhythm (#870): the QA param, else the Tokyo clock, read once per build. Headless
  // builds (no `location`) get build.ts's "midday" default, so their output stays deterministic.
  const timeBand = typeof location === "undefined" ? undefined : currentTimeBand(location.search, new Date());
  const built = buildStation(sceneBundle, plan as unknown as Plan, { quality: ctx.quality, reuseLayout: true, verifyRestrictedInput: true, ...(timeBand ? { timeBand } : {}), ...(kit ? { kit } : {}) });
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

  // Neutral decorative wall props (#858 item 12): one merged mesh, one draw. They are at most
  // WALKER_BODY.radiusM deep and flush to a layout wall, so no collider is added; the wall already
  // keeps the walker's centre out of them. The interactive machine's reaction shares the same draw.
  // The renderer frame is fixed by the scene contract (enuToRenderer = (x, z, -y)); headless tests build the
  // scene without a context mapping, so derive it here instead of reading ctx.
  const toRenderer = (x: number, y: number, z: number) => new T.Vector3(x, z, -y);
  const wallProps = buildWallProps(T, mergeGeometries, toRenderer, wallPropPlacements, "shinjuku");
  built.root.add(wallProps);
  const propMarkers = wallProps.children.filter((o) => typeof o.userData.gtekiInteractionId === "string");
  const stepWallProps = wallPropStepper(propMarkers, wallProps, wallPropDrawRanges(wallProps));

  // The street context (PLATEAU surface) is shown only when the viewer is where it can be seen; the lane
  // app reports its camera via setViewer, but scene-api's update() carries no camera. A draw-nothing probe
  // (empty geometry, never culled) reports whichever camera renders the station, every render.
  const probeMat = new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
  const probe = new T.Mesh(new T.BufferGeometry(), probeMat);
  probe.name = "viewer probe (draws nothing)";
  probe.frustumCulled = false;
  // update() runs before each render, so it re-reports the last seen camera's *current* position; the
  // probe alone would lag a frame (the render list is already built when onBeforeRender fires).
  const viewer = viewerTracker(built.setViewer);
  probe.onBeforeRender = viewer.onBeforeRender;
  built.root.add(probe);

  // Level walls only block bodies near their own level (bodyMax); approximate that for the
  // explorer's height-band walker by capping the wall band at bodyMax + 1.7 m body height.
  const walls: WallSegment[] = [...layout.levels.flatMap((lv) => lv.walls), ...layout.runWalls, ...railingWalls(layout), ...built.propWalls].map((w) => {
    const fence = "reason" in w && (w.reason === "fare" || w.reason === "access");
    const gate = "gtekiGate" in w && w.gtekiGate === true;
    const wall: WallSegment = {
      a: w.a, b: w.b,
      // Body limits fold into the walker height band.
      zMin: w.bodyMin !== undefined ? Math.max(w.zMin, w.bodyMin + WALKER_BODY.bodyTopM) : w.zMin,
      zMax: w.bodyMax !== undefined ? Math.min(w.zMax, w.bodyMax + WALKER_BODY.bodyBottomM) : w.zMax,
    };
    // Attribution is available to the audit without changing the serialized wall contract.
    Object.defineProperties(wall, {
      source: { value: fence ? "fence" : "procedural", writable: true, configurable: true },
      role: { value: fence ? "access_fence" : gate ? "gate" : "wall_segment", writable: true, configurable: true },
      ...(gate ? { gtekiGate: { value: true, writable: true, configurable: true } } : {}),
    });
    return wall;
  });
  // The explorer's follow camera only raycasts colliders + walkable, so without colliders it swung
  // through walls. One invisible DoubleSide mesh of the same wall bands gives it something to hit.
  // It cannot block more than `walls` already does: a collider ray at feet + h (0.2 ≤ h ≤ 1.7) only
  // hits a quad whose band contains that height, which the walls' band test blocks anyway.
  const colliders: THREE.Mesh[] = [];
  if (walls.length) {
    const pos: number[] = [];
    const idx: number[] = [], gateTriangles: number[] = [];
    for (const w of walls) {
      if (w.zMax <= w.zMin) continue;
      const i = pos.length / 3;
      if ("gtekiGate" in w && w.gtekiGate === true) gateTriangles.push(idx.length / 3, idx.length / 3 + 1);
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
    Object.defineProperty(m.userData, "gteki_source", { value: "procedural", writable: true, configurable: true });
    Object.defineProperty(m.userData, "gtekiGateTriangles", { value: gateTriangles, writable: true, configurable: true });
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
  const street = withSurfaceMemo(() => ({ entrances: surfaceEntrances(layout, sceneBundle), roofs: surfaceRoofs(layout, sceneBundle) }));
  const caps = [
    ...layout.levels.filter((lv) => underground.has(lv.floorId)).flatMap((lv) => lv.ceilings.map((s) => slabGeometry(s.rings, s.z, 1, true))),
    // Above-ground source spaces are drawn with ceilings too: the 1F entrance structures over exit stairs
    // and landings, whose E27 links are roofed (roof = 2). Capping them keeps the camera and the street
    // probe under the roof that is drawn, instead of reading the landing under it as open sky.
    ...layout.levels.filter((lv) => !underground.has(lv.floorId)).flatMap((lv) => lv.ceilings.map((s) => slabGeometry(s.rings, s.z, 1, true))),
    ...layout.soffits.filter((s) => underground.has(s.floorId)).map(soffitGeometry),
    // Street entrance canopies: the glass roof sits at 3.08 m; cap just below it so the follow camera
    // stays under the canopy instead of looking down onto the bright glazing.
    ...street.entrances.map((e) => {
      const n = { x: -e.u.y, y: e.u.x };
      const corner = (sl: number, sw: number) => [e.center.x + e.u.x * e.halfLength * sl + n.x * e.halfWidth * sw, 3.0, -(e.center.y + e.u.y * e.halfLength * sl + n.y * e.halfWidth * sw)];
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)].flat(), 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      return g;
    }),
    // Glazing over roofed (E27 roof = 2) runs open beyond the canopies, at 3.05 m: cap just below it.
    ...street.roofs.map((r) => {
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
      Object.defineProperty(m.userData, "gteki_source", { value: "procedural", writable: true, configurable: true });
      proxies.add(m);
      colliders.push(m);
      cameraBlockers.push(m);
      addOverheadRoofQueries(T, m, built.root);
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
    else if (m.name === "surface-ground" || m.name === "surface-stone") { Object.defineProperty(m.userData, "gteki_source", { value: "procedural", writable: true, configurable: true }); cameraBlockers.push(m); }
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
  // Commuters (#938): the shared instanced crowd over Shinjuku's verified walk ways. Not the standalone
  // createCrowd, which builds one object per agent. Its materials take the scene's environment map, so a
  // headless build (no renderer, no env map) gets none; nothing renders there anyway.
  const adapted = crowdEdges(sceneBundle, (id) => layout.nodeZ.get(id) ?? nodes.get(id)?.renderZ ?? 0);
  const crowd = envTarget
    ? buildCrowd(T, adapted.edges, crowdVector(T, ctx.enuToRenderer), low ? 56 : 150, envTarget.texture, adapted.lanes, timeBand)
    : null;
  if (crowd) built.root.add(crowd.group);
  if (shopKit && !shopKit.placements.length) {
    shopKit.dispose();
    shopKit = undefined;
  }
  if (shopKit) {
    try {
      const { group, stats } = shopKit.build(T, envTarget?.texture as THREE.Texture, (x, y, z) => new T.Vector3(...ctx.enuToRenderer({ x, y, z })));
      built.root.add(group);
      built.root.userData.shopKit = stats;
    } catch (error) {
      console.warn("[shinjuku] shop kit failed", error);
      shopKit.dispose();
      shopKit = undefined;
    }
  }

  // Explorer ambience and station sound (#859): an original bed plus gate taps, an original approach
  // chime and our own ja-JP announcements. Sites come from the bundle's graph nodes, converted to renderer space.
  const acoustics = ctx.audio ? createZoneAcoustics(ctx.audio.context, ctx.audio.destination) : null;
  const ambience = ctx.audio && acoustics ? createAmbience(ctx.audio.context, acoustics.input) : null;
  const graphNodes = ctx.bundle.nodes;
  const siteAt = (n: (typeof graphNodes)[number]): V3 => {
    const [x, y, z] = ctx.enuToRenderer({ x: n.position.x, y: n.position.y, z: n.position.z ?? n.renderZ ?? 0 });
    return { x, y, z };
  };
  const stationSound = ctx.audio && acoustics ? createStationSound({
    context: ctx.audio.context,
    destination: acoustics.input,
    isMuted: ctx.audio.isMuted,
    stationNameJa: "新宿",
    sites: {
      gates: graphNodes.filter((n) => n.kind === "ticket_gate").map(siteAt),
      announce: graphNodes.filter((n) => n.kind === "ticket_gate" || n.kind === "escalator_end").map(siteAt),
      chime: [],
    },
  }) : null;
  const trainSound = ctx.audio && acoustics && stationSound ? createTrainSound({ context: ctx.audio.context, destination: acoustics.input, isMuted: ctx.audio.isMuted, chimeAt: stationSound.chimeAt }) : null;
  const audio = stationAudio({ ambience, stationSound, trainSound, acoustics, crowd, trainAudio: built.trainAudio });

  const spawnPoints: SpawnPoint[] = (ctx.bundle.spawnNodeIds ?? []).flatMap((id) => {
    const n = nodes.get(id);
    if (!n) return [];
    const poi = ctx.bundle.pois.find((p) => p.connectorNodeIds.includes(id));
    const label = poi?.names.find((x) => x.lang === "ja")?.text;
    return [{ x: n.position.x, y: n.position.y, z: layout.nodeZ.get(id) ?? n.renderZ ?? 0, headingDeg: 0, nodeId: id, ...(label ? { label } : {}) }];
  });

  // The interactive wall prop (#858 item 12): decorative, never a POI.
  const vending = wallPropPlacements.find((p) => p.interaction)!;
  const anchor = toRenderer(vending.wall[0] + vending.n[0] * (vending.d + 0.6), vending.wall[1] + vending.n[1] * (vending.d + 0.6), vending.z);
  const interactables = [
    { id: vending.interaction!, kind: "vending", layer: "fictional" as const, simulated: true as const,
      anchor: { x: anchor.x, y: anchor.y, z: anchor.z }, radiusM: 0.9,
      steps: [{ id: "look", seconds: 1.2 }, { id: "sit", seconds: 1.5 }, { id: "react", seconds: 2.0 }], once: false },
  ];

  const scene: StationScene = {
    root: built.root,
    interactables,
    walkable,
    colliders,
    cameraBlockers,
    walls,
    spawnPoints,
    environment: { background: 0x0d0e10, exposure: 0.92, lighting: "scene" },
    ...(audio.setAcousticZone ? { setAcousticZone: audio.setAcousticZone } : {}),
    ...(built.beforeRender ? { beforeRender: built.beforeRender } : {}),
    ...(crowd ? { setCameraNearFade: crowd.setCameraNearFade.bind(crowd) } : {}),
    ...sceneLifecycle(sequence(built.update, stepWallProps), built.dispose, viewer.refresh, crowd, [...walkable, ...colliders, probe, wallProps], [proxyMat, probeMat, ...(shopKit ? [shopKit] : []), wallProps.material as THREE.Material], envTarget, audio.stepAudio, audio.disposeAudio),
  };
  return scene;
};

/** Baked navmesh walk paths for the guide (packages/godot/src/navmesh-fallback.ts --write-paths), loaded on demand. */
export const navmeshPaths = async (): Promise<NavmeshPaths | null> =>
  (await import("../navmesh-paths.json", { with: { type: "json" } })).default as unknown as NavmeshPaths;
