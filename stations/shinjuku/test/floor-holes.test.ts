import { describe, expect, it } from "vitest";
import polygonClipping from "polygon-clipping";
import { buildLayout, roomFloorFill, type Plan, type Run, type SlabPoly } from "../scene/layout.ts";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };

// #221: a floor outline carries rooms (restricted, office, toilet) as inner rings. Those rooms are not
// walkable slabs, so the hole read as a black void. Every hole left in a level's floor must now be
// covered by walkable ground, the render-only room floor, or a stair/escalator opening.
type Poly = [number, number][][];
const { bundle } = loadShinjukuBundle();
const plan = planJson as unknown as Plan;
const layout = buildLayout(bundle, plan);
const fill = roomFloorFill(layout, plan);

const toPoly = (s: SlabPoly): Poly => s.rings.map((r) => r.map((p) => [p.x, p.y] as [number, number]));
const area = (mp: Poly[]): number =>
  mp.reduce(
    (total, poly) =>
      total +
      poly.reduce((a, ring, i) => {
        let s = 0;
        for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) s += (ring[j]![0] - ring[k]![0]) * (ring[j]![1] + ring[k]![1]);
        return a + (i ? -1 : 1) * Math.abs(s) / 2;
      }, 0),
    0,
  );
// Stair/escalator openings: the run footprint, widened by 0.3 m for the cut's ends and edges.
const runFootprint = (r: Run): Poly => {
  const d = { x: r.b.x - r.a.x, y: r.b.y - r.a.y };
  const L = Math.hypot(d.x, d.y) || 1;
  const n = { x: (-d.y / L) * (r.width / 2 + 0.3), y: (d.x / L) * (r.width / 2 + 0.3) };
  return [[[r.a.x + n.x, r.a.y + n.y], [r.b.x + n.x, r.b.y + n.y], [r.b.x - n.x, r.b.y - n.y], [r.a.x - n.x, r.a.y - n.y], [r.a.x + n.x, r.a.y + n.y]]];
};

describe("E27 floor holes (#221)", () => {
  it("leaves no floor void outside a stair or escalator opening", () => {
    expect(fill.length).toBeGreaterThan(0);
    const runPolys = layout.runs.map(runFootprint) as any[];
    const runs = polygonClipping.union(runPolys[0] ?? [], ...runPolys.slice(1)) as unknown as Poly[];
    const bad: string[] = [];
    for (const lv of layout.levels) {
      const cover = [...lv.slabs, ...layout.pads, ...layout.linkStrips.filter((s) => s.z < -0.5), ...layout.streetPads, ...fill].filter((s) => Math.abs(s.z - lv.z) < 0.01).map(toPoly);
      for (const slab of lv.slabs) {
        for (let i = 1; i < slab.rings.length; i++) {
          const hole: Poly = [slab.rings[i]!.map((p) => [p.x, p.y] as [number, number])];
          const uncovered = cover.length ? polygonClipping.difference(hole as any, ...(cover as any)) : hole;
          if (!uncovered.length) continue;
          const void_ = polygonClipping.difference(uncovered as any, ...(runs as any)) as unknown as Poly[];
          const a = area(void_);
          if (a > 0.05) bad.push(`${lv.label} ${slab.spaceId} hole#${i} ${a.toFixed(2)} m2`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
