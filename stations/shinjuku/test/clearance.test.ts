import { expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildLayout, cutStairwells, pointInRings, runWidth, WalkWorld, type Plan, type SlabPoly } from "../scene/layout.ts";

const { bundle } = loadShinjukuBundle();
const layout = buildLayout(bundle, planJson as unknown as Plan);
const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));

it("keeps every walk surface outside the 0.3–2.3 m overhead band along every graph edge", () => {
  const surfaces = [...layout.pads, ...layout.linkStrips, ...layout.streetPads, ...layout.levels.flatMap((lv) => lv.slabs)];
  const cells = new Map<string, typeof surfaces>();
  for (const s of surfaces) {
    const points = s.rings[0]!;
    for (let x = Math.floor(Math.min(...points.map((p) => p.x)) / 4); x <= Math.floor(Math.max(...points.map((p) => p.x)) / 4); x++)
      for (let y = Math.floor(Math.min(...points.map((p) => p.y)) / 4); y <= Math.floor(Math.max(...points.map((p) => p.y)) / 4); y++) {
        const key = `${x},${y}`;
        const list = cells.get(key) ?? []; list.push(s); cells.set(key, list);
      }
  }
  const hits = new Set<string>();
  for (const edge of bundle.edges) {
    const za = layout.nodeZ.get(edge.from)!, zb = layout.nodeZ.get(edge.to)!;
    const points = edge.geometry?.length ? edge.geometry : [nodes.get(edge.from)!.position, nodes.get(edge.to)!.position];
    const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
    const total = lengths.reduce((a, b) => a + b, 0);
    let acc = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!, length = lengths[i - 1]!;
      const z0 = za + (zb - za) * (total ? acc / total : 0), z1 = za + (zb - za) * (total ? (acc + length) / total : 1);
      const count = Math.max(1, Math.ceil(Math.hypot(length, z1 - z0) / 0.25));
      for (let j = 0; j <= count; j++) {
        const t = j / count, along = acc + length * t;
        // Only the edge's own 0.6 m endpoint zones may contain abutting proxy lips.
        // For a purely vertical lift use distance along its vertical travel instead.
        const fullLength = Math.hypot(total, zb - za), travelled = total ? along / total * fullLength : t * fullLength;
        if (travelled < 0.6 || fullLength - travelled < 0.6) continue;
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, z = z0 + (z1 - z0) * t;
        const overhead: [string, number][] = [];
        for (const run of layout.runs) {
          if (run.edgeId === edge.id) continue;
          const dx = run.b.x - run.a.x, dy = run.b.y - run.a.y, l2 = dx * dx + dy * dy;
          const u = ((p.x - run.a.x) * dx + (p.y - run.a.y) * dy) / l2;
          if (u < 0 || u > 1 || Math.abs((p.x - run.a.x) * dy - (p.y - run.a.y) * dx) / Math.sqrt(l2) > run.width / 2) continue;
          overhead.push([run.edgeId, run.a.z + (run.b.z - run.a.z) * u]);
        }
        for (const s of cells.get(`${Math.floor(p.x / 4)},${Math.floor(p.y / 4)}`) ?? []) {
          if (s.z - z > 0.3 && s.z - z < 2.3 && pointInRings(p, s.rings)) overhead.push([s.spaceId, s.z]);
        }
        for (const [id, height] of overhead) if (height - z > 0.3 && height - z < 2.3) hits.add(`${edge.id} below ${id}: ${(height - z).toFixed(3)} m`);
      }
      acc += length;
    }
  }
  expect([...hits]).toEqual([]); // No source-ID exceptions.
});

it("opens a street slab above a run whose ends are both below that slab", () => {
  const slab: SlabPoly = { spaceId: "street", z: 0, fare: null, category: "street", rings: [[{x:-4,y:-4},{x:4,y:-4},{x:4,y:4},{x:-4,y:4}]] };
  const result = cutStairwells([slab], [{ edgeId: "run", mode: "stairs", a: {x:-3,y:0,z:-3}, b: {x:3,y:0,z:-1}, width: 2, travel: 0 }]);
  expect(result.some((s) => pointInRings({x:1,y:0}, s.rings))).toBe(false);
  expect(result.some((s) => pointInRings({x:-3,y:0}, s.rings))).toBe(true);
});

it("uses the source class lower bound only for a parallel walkway beside a class-4 stair foot", () => {
  const a = {x:0,y:0,z:-8}, b = {x:8,y:0,z:-6};
  const walk = {a:{x:-2,y:1.6,z:-8},b:{x:6,y:1.6,z:-8}};
  expect(runWidth(4, "stairs", a, b, [walk])).toBe(3);
  expect(runWidth(4, "stairs", a, b, [])).toBe(3.4);
  expect(runWidth(4, "stairs", a, b, [{a:{...walk.a,z:-12},b:{...walk.b,z:-12}}])).toBe(3.4);
  expect(runWidth(4, "escalator", a, b, [walk])).toBe(1.25);
});

it("keeps the B1 switchback underpass walker on B1 instead of climbing a flight proxy", () => {
  const world = new WalkWorld(layout);
  for (const prefix of ["e:c536dec7", "e:203cbf0c"]) {
    const edge = bundle.edges.find((e) => e.id.startsWith(prefix))!;
    const a = nodes.get(edge.from)!.position, b = nodes.get(edge.to)!.position;
    const z = layout.nodeZ.get(edge.from)!;
    let feet = z;
    for (let i = 0; i <= 100; i++) {
      const p = {x:a.x+(b.x-a.x)*i/100,y:a.y+(b.y-a.y)*i/100};
      const ground = world.groundAt(p, feet);
      expect(ground).not.toBeNull();
      expect(ground).toBeCloseTo(z, 2);
      feet = ground!;
    }
  }
});
