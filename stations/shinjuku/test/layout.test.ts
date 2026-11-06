import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { StationBundle } from "@gteki/schema";
import { buildLayout, pointInRings, soffitHeight, WalkWorld, type Plan, type Soffit } from "../scene/layout.ts";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildStation } from "../scene/build.ts";
import { withCanvasStub } from "./helpers/scene-digest.ts";

const { bundle } = loadShinjukuBundle();
const plan = planJson as unknown as Plan;

it("keeps B3 shot 28 shaft fascias clear of kept wall planes within 2 mm", () => {
  const layout = buildLayout(bundle, plan);
  const walls = layout.levels.flatMap(l => l.walls.filter(w => w.kind !== "trackside" && w.finish !== "fascia"));
  for (const fascia of layout.shaftFascias) {
    const panel = fascia.polygon!;
    for (const wall of walls) {
      const distance = (p: { x: number; y: number }) => Math.abs(-p.x * panel.axis.y + p.y * panel.axis.x - panel.offset);
      if (distance(wall.a) >= 0.002 || distance(wall.b) >= 0.002) continue;
      const project = (p: { x: number; y: number }) => p.x * panel.axis.x + p.y * panel.axis.y;
      const a = project(wall.a), b = project(wall.b);
      if (Math.abs(a - b) < 1e-6) continue;
      const p = wall.profile ?? { bottomA: wall.zMin, bottomB: wall.zMin, topA: wall.zMax, topB: wall.zMax };
      const snap = (v: number) => Math.round(v * 1e4) / 1e4;
      const cover = [new THREE.Vector2(snap(a), snap(p.bottomA)), new THREE.Vector2(snap(b), snap(p.bottomB)),
        new THREE.Vector2(snap(b), snap(p.topB)), new THREE.Vector2(snap(a), snap(p.topA))];
      if (Math.abs(snap(a) - snap(b)) < 1e-6) continue;
      const rings = panel.rings.map(r => r.slice(0, -1).map(p => new THREE.Vector2(p.x, p.y)));
      const vertices = rings.flat();
      const triangles = THREE.ShapeUtils.triangulateShape(rings[0]!, rings.slice(1));
      const cross = (a: THREE.Vector2, b: THREE.Vector2, p: THREE.Vector2) => (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
      const orientation = Math.sign(cover.reduce((sum, v, i) => sum + v.cross(cover[(i+1)%cover.length]!), 0));
      if (orientation === 0) continue;
      let area = 0;
      for (const triangle of triangles) {
        let clipped = triangle.map(i => vertices[i]!);
        for (let i = 0; i < cover.length && clipped.length; i++) {
          const a = cover[i]!, b = cover[(i+1)%cover.length]!, input = clipped;
          clipped = [];
          for (let j = 0; j < input.length; j++) {
            const p = input[j]!, q = input[(j+1)%input.length]!, dp = orientation * cross(a,b,p), dq = orientation * cross(a,b,q);
            if (dp >= 0) clipped.push(p);
            if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) clipped.push(p.clone().lerp(q, dp / (dp-dq)));
          }
        }
        area += Math.abs(clipped.reduce((sum, v, i) => sum + v.cross(clipped[(i+1)%clipped.length]!), 0)) / 2;
      }
      expect(area, `fascia ${fascia.floorId} wall ${wall.a.x},${wall.a.y}`).toBeLessThan(1e-8);
    }
  }
}, 120_000);

it("finishes grouped flights on their own planes with flat landings and shoulders", () => {
  const coordinates = [{ x: 0, y: 0, z: -12 }, { x: 4, y: 0, z: -10 }, { x: 5, y: 0, z: -10 }, { x: 9, y: 0, z: -7.96 }];
  const nodes = coordinates.map((p, i) => ({ ...bundle.nodes[0]!, id: `flight-${i}`, floorId: "test", position: { ...p, z: null }, renderZ: p.z }));
  const stairs = bundle.edges.find((e) => e.mode === "stairs")!, walk = bundle.edges.find((e) => e.mode === "walk")!;
  const edges = [stairs, walk, stairs].map((e, i) => ({ ...e, id: `flight-edge-${i}`, from: nodes[i]!.id, to: nodes[i + 1]!.id, geometry: undefined, attributes: { ...e.attributes, width: 3 } }));
  const ring = [{ x: -4, y: -5 }, { x: 13, y: -5 }, { x: 13, y: 5 }, { x: -4, y: 5 }];
  const fixture: Plan = { levels: [{ label: "B3", ordinal: -3, floorId: "test", renderElevationM: -12, outline: [[ring]],
    spaces: [{ id: "hall", category: "B001", restricted: false, toll: null, rings: [ring] }], facilities: [] }],
    nodeRenderZ: Object.fromEntries(nodes.map((n) => [n.id, n.renderZ])), attribution: [] };
  const fixtureBundle: StationBundle = { ...bundle, nodes, edges, pois: [], floors: [{ ...bundle.floors[0]!, id: "test", ordinal: -3, renderElevationM: -12 }] };
  const built = buildLayout(fixtureBundle, fixture);
  const sheets = (built as typeof built & { shaftFinishes?: Soffit[] }).shaftFinishes;
  const finishes = sheets ? [...built.soffits.filter((s) => !/^shaft-(roof|invert|collar):/.test(s.spaceId)), ...sheets] : built.soffits;
  const at = (kind: string, x: number, y: number) => finishes.filter((s) =>
    (s.spaceId.startsWith(`shaft-${kind}:`) || kind === "roof" && s.spaceId.startsWith("shaft-collar:")) && pointInRings({ x, y }, s.rings));
  for (const kind of ["roof", "invert"]) {
    const offset = kind === "roof" ? 4.5 : -0.3;
    for (const x of [4.2, 4.8]) {
      const landing = at(kind, x, 0);
      expect(landing.length).toBeGreaterThan(0);
      expect(landing.every((s) => !s.slope && Math.abs(s.z - (kind === "roof" ? -6.8 : -10.18)) < 0.001)).toBe(true);
    }
    for (const [x, floor, slope] of [[2, -11, 0.5], [7, -8.98, 0.51]]) {
      const flight = at(kind, x!, 0);
      expect(flight.length).toBeGreaterThan(0);
      expect(flight.every((s) => Math.abs((s.slope?.x ?? 0) - slope!) < 1e-6 && Math.abs(soffitHeight(s, { x: x!, y: 0 }) - (floor! + offset)) < 0.001)).toBe(true);
    }
    for (const x of [-0.1, 1.5, 3, 9.1]) {
      const shoulder = at(kind, x, 2);
      expect(shoulder.length).toBeGreaterThan(0);
      expect(shoulder.every((s) => !s.slope)).toBe(true);
    }
  }
  for (const height of [-12.1, -11, -10.2, -8.8, -7.8, -6.9]) {
    expect(built.shaftFascias.some(({ wall, polygon }) => {
      const dx = wall.b.x - wall.a.x, dy = wall.b.y - wall.a.y, l2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((2 - wall.a.x) * dx + (2 - wall.a.y) * dy) / l2));
      if (polygon) return Math.hypot(2 - wall.a.x - dx * t, 2 - wall.a.y - dy * t) < 0.002
        && pointInRings({ x: 2 * polygon.axis.x + 2 * polygon.axis.y, y: height }, polygon.rings);
      const profile = wall.profile!;
      return Math.hypot(2 - wall.a.x - dx * t, 2 - wall.a.y - dy * t) < 0.002
        && height >= profile.bottomA + (profile.bottomB - profile.bottomA) * t
        && height <= profile.topA + (profile.topB - profile.topA) * t;
    }), `closed shoulder step at ${height}`).toBe(true);
  }
  expect(at("roof", -0.1, 2).every((s) => !s.slope && Math.abs(s.z + 8.9) < 0.001)).toBe(true);
  // Physical collars stay, but no raised collar sheet may survive in the actual draw.
  expect(built.soffits.some((s) => s.spaceId.startsWith("shaft-collar:") && pointInRings({ x: -0.1, y: 2 }, s.rings))).toBe(true);
  const rendered = withCanvasStub(() => buildStation(fixtureBundle, fixture, { quality: "low" }));
  try {
    rendered.root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(-0.1, -8.8, -2), new THREE.Vector3(0, 1, 0), 0, 3);
    expect(ray.intersectObject(rendered.root, true).filter((hit) => {
      const mesh = hit.object as THREE.Mesh;
      const material = Array.isArray(mesh.material) ? mesh.material[hit.face!.materialIndex] : mesh.material;
      return material?.name === "mat.ceiling";
    })).toEqual([]);
  } finally { rendered.dispose(); }
});

it("keeps a rendered shaft ceiling over the shipped stair's former collar patch", () => {
  const station = withCanvasStub(() => buildStation(bundle, plan, { quality: "high" }));
  try {
    station.root.updateMatrixWorld(true);
    const ceilings: THREE.Mesh[] = [];
    station.root.traverseVisible((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && [mesh.material].flat().some((m) => m.visible && m.name === "mat.ceiling")) ceilings.push(mesh);
    });
    // e:c690df6cad7b48bba7b3b30fee65eda2, 0.161 m in plan from its lower endpoint.
    const eye = new THREE.Vector3(-4.751, -7.605 + 1.62, 16.279);
    const hit = new THREE.Raycaster(eye, new THREE.Vector3(0, 1, 0), 0, 20).intersectObjects(ceilings, false)[0];
    expect(hit).toBeDefined();
    expect(hit!.point.y).toBeLessThan(0);
  } finally { station.dispose(); }
}, 60_000);

it("closes shipped escalator and shaft shoulder sightlines with rendered surfaces", () => {
  const station = withCanvasStub(() => buildStation(bundle, plan, { quality: "high" }));
  try {
    station.root.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    station.root.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    // e:d573063b997e42f3b146ffeec98aed38 at 5%, then the outer shoulder
    // of stair e:c690df6cad7b48bba7b3b30fee65eda2 at 3 m, -0.6 half-width.
    for (const [eye, direction] of [
      [new THREE.Vector3(18.3415, -14.16, -5.2725), new THREE.Vector3(0.4238, 3, 1.4389)],
      [new THREE.Vector3(-2.8477459353, -5.4859025133 + 1.62, 16.0726828284),
        new THREE.Vector3(-0.3299046246, 0.7578125, 0.5629237546)],
      // e:85f51acf3bfe4da797fbdf82497ce706, 0 m, lateral -0.6.
      [new THREE.Vector3(9.195240064658455, -11.96 + 1.62, -5.46691563878745),
        new THREE.Vector3(-0.3621114756780077, 0.8828125, 0.29919453375027694)],
      // e:88ef3d09d7b240b18754ee19bbeae3e1, 3.5 m, lateral 0.6.
      [new THREE.Vector3(-83.61250390249477, -14.78680661097159 + 1.62, -170.8367727006367),
        new THREE.Vector3(0.6267458007743936, 0.6171875, -0.4756777176360212)],
      // e:cc8b27a958dd4cbb83d68f3791db6111, 1 m, lateral 0.6.
      [new THREE.Vector3(-91.52869312410283, -18.438204298786 + 1.62, -166.75528757378888),
        new THREE.Vector3(-0.3030417828247059, 0.4453125, -0.8425333555451521)],
      // e:1cc1c57ea635401cac4ac6bf895feece, 0.000 m, lateral 0.
      [new THREE.Vector3(-55.14, -7.8 + 1.62, -142.5),
        new THREE.Vector3(0.547129872820503, -0.17364817766693033, -0.8188377205896016)],
      // e:2692fe08625f4a3f92d69a1380a58ccd, 32.500 m, lateral -0.6.
      [new THREE.Vector3(-20.486021234199537, -8.544917935482566 + 1.62, -173.187079040088),
        new THREE.Vector3(-0.6963642403200189, -0.17364817766693033, 0.696364240320019)],
      // e:41b6ebb3ce0846719aa1c9985f9cd4d1, 5.471 m, lateral 0.
      [new THREE.Vector3(-15.72, -16.2 + 1.62, -117.52),
        new THREE.Vector3(0.2837846601360632, 0.9453125, -0.1607810437060573)],
      // e:03bd24ff9bc0412b92016f57625f0ba5, 1.000 m, lateral 0.6.
      [new THREE.Vector3(-59.06354349973163, -7.330693182213129 + 1.62, -195.52152587908938),
        new THREE.Vector3(0.38268343236509, 0, -0.9238795325112866)],
      // e:03bd24ff9bc0412b92016f57625f0ba5, 2.500 m, lateral -0.6.
      [new THREE.Vector3(-57.64225482568801, -6.626732955532824 + 1.62, -196.99393156513096),
        new THREE.Vector3(0.1950903220161283, 0, -0.9807852804032304)],
    ]) {
      const hit = new THREE.Raycaster(eye!, direction!.normalize(), 0.001, 25).intersectObjects(meshes, false).find((h) => {
        const mesh = h.object as THREE.Mesh;
        const material = Array.isArray(mesh.material) ? mesh.material[h.face!.materialIndex] : mesh.material;
        return material?.visible && !material.transparent && material.opacity > 0;
      });
      expect(hit).toBeDefined();
      expect(hit!.point.y).toBeLessThan(0);
    }
  } finally { station.dispose(); }
}, 60_000);

describe("E27 scene layout", () => {
  const layout = buildLayout(bundle, plan);
  const world = new WalkWorld(layout);

  it("emits no zero-length or degenerate shaft fascia", () => {
    expect(layout.shaftFascias.every(({ wall: w }) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) > 1e-6
      && (!w.profile || Math.max(w.profile.topA - w.profile.bottomA, w.profile.topB - w.profile.bottomB) > 1e-6))).toBe(true);
  });

  it("builds every level with floor slabs and walls", () => {
    expect(layout.levels.length).toBe(6);
    for (const lv of layout.levels) {
      expect(lv.slabs.length).toBeGreaterThan(0);
      expect(lv.walls.length).toBeGreaterThan(0);
      expect(lv.ceilingZ).toBeGreaterThan(lv.z + 2.2);
    }
  });

  it("puts walkable ground under every non-elevator graph node at its render height", () => {
    const misses: string[] = [];
    for (const n of bundle.nodes) {
      if (n.kind === "elevator") continue;
      const z = layout.nodeZ.get(n.id)!;
      if (world.groundAt(n.position, z, 0.3, 0.3) === null) misses.push(`${n.id} ${n.floorId} ${n.kind}`);
    }
    // report, then require near-total coverage
    if (misses.length) console.warn("nodes without ground:", misses.length, misses.slice(0, 12));
    expect(misses).toEqual([]);
  });

  it("lets a walker follow every walk/stairs/escalator/gate edge without leaving the ground", () => {
    const nodeById = new Map(bundle.nodes.map((n) => [n.id, n]));
    const bad: string[] = [];
    for (const e of bundle.edges) {
      if (e.mode === "elevator") continue;
      const A = nodeById.get(e.from)!;
      const B = nodeById.get(e.to)!;
      let z = layout.nodeZ.get(e.from)!;
      const steps = Math.max(2, Math.ceil((e.lengthM ?? 1) / 0.25));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const p = { x: A.position.x + (B.position.x - A.position.x) * t, y: A.position.y + (B.position.y - A.position.y) * t };
        const g = world.groundAt(p, z);
        if (g === null) {
          bad.push(`${e.id} ${e.mode} at t=${t.toFixed(2)}`);
          break;
        }
        z = g;
      }
      // must also end at the destination's height (no staying on an overlapping surface)
      if (!bad.at(-1)?.startsWith(e.id) && Math.abs(z - layout.nodeZ.get(e.to)!) > 0.35) bad.push(`${e.id} ${e.mode} ends at ${z.toFixed(2)} ≠ ${layout.nodeZ.get(e.to)!.toFixed(2)}`);
    }
    if (bad.length) console.warn("edges not walkable:", bad.length, bad.slice(0, 15));
    expect(bad).toEqual([]);
  });
});
