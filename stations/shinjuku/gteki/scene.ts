/**
 * @gteki/scene-api hook for the shared explorer (apps/web). Reuses the Shinjuku lane's
 * renderer-neutral layout + Three.js builder; geometry is a visual/physical approximation and
 * never adds routes (the explorer routes only on graph.json).
 */
import { WALKER_BODY, type BuildScene, type SpawnPoint, type StationScene, type WallSegment } from "@gteki/scene-api";
import type * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildStation, slabGeometry, soffitGeometry } from "../scene/build.ts";
import { railingWalls, type Plan } from "../scene/layout.ts";
import plan from "../data/plan.json" with { type: "json" };

export const buildScene: BuildScene = (ctx) => {
  const T = ctx.THREE;
  const built = buildStation(ctx.bundle, plan as unknown as Plan, { quality: ctx.quality });
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
  // Camera-only blockers (proposed additive scene-api field `cameraBlockers`): the same caps, already cut
  // wherever a stairwell or shaft passes, so the camera can follow down a stairwell. Until the explorer
  // reads that field the caps also stay in `colliders`, which the follow camera already raycasts.
  const cameraBlockers: THREE.Mesh[] = [];
  const underground = new Set(layout.levels.filter((lv) => lv.z < -0.5).map((lv) => lv.floorId));
  const caps = [
    ...layout.levels.filter((lv) => underground.has(lv.floorId)).flatMap((lv) => lv.ceilings.map((s) => slabGeometry(s.rings, s.z, 1, true))),
    ...layout.soffits.filter((s) => underground.has(s.floorId)).map(soffitGeometry),
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
  const nodes = new Map(ctx.bundle.nodes.map((n) => [n.id, n]));
  const spawnPoints: SpawnPoint[] = (ctx.bundle.spawnNodeIds ?? []).flatMap((id) => {
    const n = nodes.get(id);
    if (!n) return [];
    const poi = ctx.bundle.pois.find((p) => p.connectorNodeIds.includes(id));
    const label = poi?.names.find((x) => x.lang === "ja")?.text;
    return [{ x: n.position.x, y: n.position.y, z: layout.nodeZ.get(id) ?? n.renderZ ?? 0, headingDeg: 0, nodeId: id, ...(label ? { label } : {}) }];
  });

  // Typed as an intersection so this compiles both before and after scene-api gains `cameraBlockers`.
  const scene: StationScene & { cameraBlockers?: THREE.Object3D[] } = {
    root: built.root,
    walkable,
    colliders,
    cameraBlockers,
    walls,
    spawnPoints,
    environment: { background: 0x0d0e10, exposure: 0.92 },
    update: (dt, t) => built.update(dt, t),
    dispose() {
      built.dispose();
      for (const m of [...walkable, ...colliders]) m.geometry.dispose();
      proxyMat.dispose();
    },
  };
  return scene;
};
