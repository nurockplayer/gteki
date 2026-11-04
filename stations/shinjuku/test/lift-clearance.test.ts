import { describe, expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { liftClearances } from "../scene/fare-fence.ts";
import { buildLayout, pointInRing, type Plan, type XY } from "../scene/layout.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { openStation } from "./fence-slide-probe.ts";
import generated from "../scene/fare-restricted.generated.json" with { type: "json" };

/**
 * #645 step 2c (#648): a fare or access fence, return or join that overlaps a lift door's clearance is cut there, so every
 * lift door stays open.
 */
describe("restricted fences and lift clearances", () => {
  const { bundle } = loadShinjukuBundle(), plan = planJson as Plan;
  const lifts = liftClearances(bundle, plan, buildLayout(bundle, plan));
  const fences = (generated as unknown as { fences: { a: XY; b: XY; zMin: number }[] }).fences;
  // The base-fence sampler rounds cuts to the nearest 4 cm; inspect the interior beyond that fringe.
  const inset = (ring: XY[]) => {
    const c = ring.reduce((s, p) => ({ x: s.x + p.x / ring.length, y: s.y + p.y / ring.length }), { x: 0, y: 0 });
    return ring.map(p => { const d = Math.hypot(p.x - c.x, p.y - c.y); return { x: p.x + (c.x - p.x) / d * .05, y: p.y + (c.y - p.y) / d * .05 }; });
  };
  const onBoundary = (p: XY, ring: XY[]) => ring.some((a, i) => {
    const b = ring[(i + 1) % ring.length]!, dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)) < 0.05;
  });

  it("finds lift stops in Shinjuku", () => expect(lifts.length).toBeGreaterThan(0));

  it("clears same-space car and door openings while retaining differently labelled boundaries", () => {
    for (const lift of lifts) for (const f of fences) {
      if (Math.abs(f.zMin + 0.05 - lift.z) >= 0.5) continue;
      const dx = f.b.x - f.a.x, dy = f.b.y - f.a.y, length = Math.hypot(dx, dy);
      const normal = { x: -dy / length * .04, y: dx / length * .04 };
      for (let k = 1; k < 20; k++) {
        const p = { x: f.a.x + (f.b.x - f.a.x) * k / 20, y: f.a.y + (f.b.y - f.a.y) * k / 20 };
        if (!lift.rings.some(r => pointInRing(p, inset(r)))) continue;
        expect(lift.clear(p, normal), `fence (${f.a.x.toFixed(2)},${f.a.y.toFixed(2)})-(${f.b.x.toFixed(2)},${f.b.y.toFixed(2)}) at z ${lift.z}`).toBe(false);
      }
    }
  }, 30_000);

  it("cuts a fence where it meets a lift door's clearance, not only avoids it", () => {
    const cut = fences.some((f) => lifts.some((lift) => Math.abs(f.zMin + 0.05 - lift.z) < 0.5 && lift.rings.some((ring) => onBoundary(f.a, ring) || onBoundary(f.b, ring))));
    expect(cut).toBe(true);
  });

  it("blocks walking west from the B2 lift into source-restricted space", async () => {
    const station = await openStation();
    try {
      const start = { x: -4.04, y: 4.12, z: -16.2 };
      expect(station.env.labels(start).mapped).toBe(true);
      expect(station.env.labels({ ...start, x: -4.44 }).mapped).toBe(false);
      let p = start;
      for (let i = 0; i < 60; i++) {
        p = station.env.explorer.step(p, { x: -1, y: 0 }, 1.45, 1 / 60);
        expect(station.env.labels(p).mapped).toBe(true);
      }
      expect(p.x).toBeGreaterThan(-4.44);
    } finally { station.close(); }
  }, 120_000);

});
