import { expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildLayout, pointInRings, soffitHeight, WalkWorld, type Plan, type XY } from "../scene/layout.ts";

const { bundle } = loadShinjukuBundle();
const plan = planJson as unknown as Plan;
const layout = buildLayout(bundle, plan);
const b3 = layout.levels.find((lv) => lv.label === "B3")!;
const source = plan.levels.find((lv) => lv.label === "B3")!;
// GSI B3 contains this unrestricted B021 stair-space corner beyond the B3 network.
// Preserve its source floor polygon; this is not a new route or an asserted connection.
const mappedNonNetwork = new Map([
  ["efd7ca9d14564404887ebe2ef96a01f3", "GSI B3 B021 far corner, ~15.5 m from the nearest B3 network edge"],
]);
const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
const segments = bundle.edges.filter((e) => Math.abs(layout.nodeZ.get(e.from)! - b3.z) < 0.1 && Math.abs(layout.nodeZ.get(e.to)! - b3.z) < 0.1)
  .flatMap((e) => { const pts = e.geometry?.length ? e.geometry : [nodes.get(e.from)!.position, nodes.get(e.to)!.position]; return pts.slice(1).map((b, i) => ({ a: pts[i]!, b })); });
function networkDistance(p: XY) {
  return Math.min(...segments.map(({a, b}) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
  }));
}

it("keeps every B3 slab region within 15 m of its network or explicitly mapped non-network space", () => {
  const bad: string[] = [];
  const seen = new Set<string>();
  const roofs = [...b3.ceilings, ...layout.soffits];
  const slabs = [...b3.slabs, ...layout.pads, ...layout.linkStrips].filter((s) => Math.abs(s.z - b3.z) < 0.05);
  for (const slab of slabs) {
    const pts = slab.rings[0]!;
    for (let x = Math.min(...pts.map((p) => p.x)); x <= Math.max(...pts.map((p) => p.x)); x += 0.25)
      for (let y = Math.min(...pts.map((p) => p.y)); y <= Math.max(...pts.map((p) => p.y)); y += 0.25) {
        const p = {x, y};
        if (!pointInRings(p, slab.rings) || networkDistance(p) <= 15) continue;
        const mapped = source.spaces.find((s) => mappedNonNetwork.has(s.id) && !s.restricted && pointInRings(p, s.rings));
        if (!mapped) bad.push(`${slab.spaceId} at ${x.toFixed(2)},${y.toFixed(2)}`);
        else {
          seen.add(mapped.id);
          expect(roofs.some((s) => soffitHeight(s, p) >= b3.z + 2.1 && pointInRings(p, s.rings))).toBe(true);
        }
      }
  }
  expect(bad).toEqual([]);
  expect([...seen].sort()).toEqual([...mappedNonNetwork.keys()].sort());
});

it("retains the QA northbound B3 path inside source polygons and closes its far boundary", () => {
  const path = [{x:-30.2,y:152.7},{x:-30.2,y:166.3},{x:-30.2,y:176.5},{x:-29.9,y:179.2},{x:-21.4,y:182.3}];
  const world = new WalkWorld(layout);
  for (const p of path) {
    expect(source.spaces.some((s) => !s.restricted && pointInRings(p, s.rings))).toBe(true);
    expect(world.groundAt(p, b3.z, 0.1, 0.1)).toBeCloseTo(b3.z);
    expect([...b3.ceilings, ...layout.soffits].some((s) => soffitHeight(s, p) >= b3.z + 2.1 && pointInRings(p, s.rings))).toBe(true);
  }
  expect(world.firstWallHit(path.at(-1)!, {x:-21.4,y:186}, b3.z + 1)).toBeLessThan(1);
});
