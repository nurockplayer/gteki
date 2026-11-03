import { describe, expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { liftClearances } from "../scene/fare-fence.ts";
import { pointInRing, type XY } from "../scene/layout.ts";
import generated from "../scene/fare-restricted.generated.json" with { type: "json" };

/**
 * #645 step 2c (#648): a fare or access fence, return or join that overlaps a lift door's clearance is cut there, so every
 * lift door stays open.
 */
describe("restricted fences and lift clearances", () => {
  const lifts = liftClearances(loadShinjukuBundle().bundle);
  const fences = (generated as unknown as { fences: { a: XY; b: XY; zMin: number }[] }).fences;
  // Shrink each ring 5 cm toward its centre: fare and access boundaries are sampled every 8 cm, so a cut lands within 4 cm
  // of the clear space's edge.
  const inset = (ring: XY[]) => {
    const c = ring.reduce((s, p) => ({ x: s.x + p.x / ring.length, y: s.y + p.y / ring.length }), { x: 0, y: 0 });
    return ring.map((p) => { const d = Math.hypot(p.x - c.x, p.y - c.y) || 1; return { x: p.x + (c.x - p.x) / d * 0.05, y: p.y + (c.y - p.y) / d * 0.05 }; });
  };
  const onBoundary = (p: XY, ring: XY[]) => ring.some((a, i) => {
    const b = ring[(i + 1) % ring.length]!, dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)) < 0.05;
  });

  it("finds lift stops in Shinjuku", () => expect(lifts.length).toBeGreaterThan(0));

  it("leaves no fence inside any lift door's clearance", () => {
    for (const lift of lifts) for (const ring of lift.rings.map(inset)) for (const f of fences) {
      if (Math.abs(f.zMin + 0.05 - lift.z) >= 0.5) continue;
      for (let k = 0; k <= 20; k++) {
        const p = { x: f.a.x + (f.b.x - f.a.x) * k / 20, y: f.a.y + (f.b.y - f.a.y) * k / 20 };
        expect(pointInRing(p, ring), `fence (${f.a.x.toFixed(2)},${f.a.y.toFixed(2)})-(${f.b.x.toFixed(2)},${f.b.y.toFixed(2)}) at z ${lift.z}`).toBe(false);
      }
    }
  }, 30_000);

  it("cuts a fence where it meets a lift door's clearance, not only avoids it", () => {
    const cut = fences.some((f) => lifts.some((lift) => Math.abs(f.zMin + 0.05 - lift.z) < 0.5 && lift.rings.some((ring) => onBoundary(f.a, ring) || onBoundary(f.b, ring))));
    expect(cut).toBe(true);
  });
});
