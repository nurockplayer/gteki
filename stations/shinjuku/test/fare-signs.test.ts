import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildLayout, pointInRings, type Plan } from "../scene/layout.ts";
import { accessSigns, protectFareAndAccess, containsPolygons } from "../scene/fare-fence.ts";

const { bundle } = loadShinjukuBundle(), plan = planJson as Plan;
describe("access barrier sign truth", () => {
  const layout = buildLayout(bundle, plan);
  const protection = protectFareAndAccess(layout, plan, bundle);
  const signs = accessSigns(protection, plan);
  if (process.env.FARE_SIGN_REPORT) writeFileSync(process.env.FARE_SIGN_REPORT, JSON.stringify(signs, null, 2));
  it("classifies the removed side of every sign independently against source restrictions", () => {
    expect(signs.length).toBeGreaterThan(0);
    for (const sign of signs) {
      const level = plan.levels.find(l => Math.abs(l.renderElevationM - sign.z) < .02)!;
      const restricted = level.spaces.find(s => s.restricted && pointInRings(sign.removedSide, s.rings));
      expect(sign.classification, sign.fence.id).toBe(restricted ? "restricted" : "closed");
      expect(sign.sourceSpaceId, sign.fence.id).toBe(restricted?.id ?? null);
      expect([sign.ja, sign.en], sign.fence.id).toEqual(restricted
        ? ["立入制限区域", "Restricted area"] : ["立入不可", "No entry"]);
      expect(protection.removedAccess.some(a => a.level === sign.fence.level && pointInRings(sign.removedSide, a.rings))).toBe(true);
    }
  });
  it("indexed polygon membership preserves source edges, holes and boundary decisions", () => {
    for (const level of plan.levels) {
      const shapes = level.spaces.map(s => s.rings), indexed = containsPolygons(shapes);
      for (const vertex of shapes.flat(2)) for (const offset of [0, -.00001, .00001]) {
        const p = { x: vertex.x + offset, y: vertex.y - offset };
        expect(indexed(p)).toBe(shapes.some(rings => pointInRings(p, rings)));
      }
    }
  });
  it("labels the reviewer's B1 source-restricted space as restricted", () => {
    const sign = signs.find(s => Math.hypot((s.fence.a.x + s.fence.b.x) / 2 + 44.48,
      (s.fence.a.y + s.fence.b.y) / 2 - 169.395) < .02)!;
    expect(sign).toBeDefined();
    expect(sign.sourceSpaceId).toBe("aabd65fc5e8c4d1cabafa98e06faaf39");
    expect(sign.en).toBe("Restricted area");
  });
});
