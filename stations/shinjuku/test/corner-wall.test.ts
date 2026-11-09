import { expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildLayout, type Plan } from "../scene/layout.ts";

it("keeps the B3 wall at the shaft corner", () => {
  const { bundle } = loadShinjukuBundle();
  const level = buildLayout(bundle, planJson as unknown as Plan).levels.find((lv) => lv.label === "B3")!;
  const midpoint = { x: -54.6015, y: 154.2518 };
  expect(level.walls.some((w) => {
    const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
    const t = Math.max(0, Math.min(1, ((midpoint.x - w.a.x) * dx + (midpoint.y - w.a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(midpoint.x - w.a.x - t * dx, midpoint.y - w.a.y - t * dy) < 0.02 &&
      w.zMin <= level.z + 1 && w.zMax >= level.z + 1;
  })).toBe(true);
});
