/**
 * @gteki/scene-api hook for the shared explorer (apps/web). Reuses the Shinjuku lane's
 * renderer-neutral layout + Three.js builder; geometry is a visual/physical approximation and
 * never adds routes (the explorer routes only on graph.json).
 */
import type { BuildScene, SpawnPoint, StationScene, WallSegment } from "@gteki/scene-api";
import type * as THREE from "three";
import { buildStation, slabGeometry } from "../scene/build.ts";
import type { Plan } from "../scene/layout.ts";
import plan from "../data/plan.json" with { type: "json" };

export const buildScene: BuildScene = (ctx) => {
  const T = ctx.THREE;
  const built = buildStation(ctx.bundle, plan as unknown as Plan, { quality: ctx.quality });
  const { layout } = built;

  // Invisible walk proxies: the explorer raycasts these from above (non-recursive), so each is a Mesh.
  const proxyMat = new T.MeshBasicMaterial({ visible: false });
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
  const walls: WallSegment[] = [...layout.levels.flatMap((lv) => lv.walls), ...layout.runWalls, ...built.propWalls].map((w) => ({ a: w.a, b: w.b, zMin: w.zMin, zMax: w.bodyMax !== undefined ? Math.min(w.zMax, w.bodyMax + 0.3) : w.zMax }));
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
    walls,
    spawnPoints,
    environment: { background: 0x0d0e10, exposure: 0.92 },
    update: (dt, t) => built.update(dt, t),
    dispose() {
      built.dispose();
      for (const m of walkable) m.geometry.dispose();
      proxyMat.dispose();
    },
  };
  return scene;
};
