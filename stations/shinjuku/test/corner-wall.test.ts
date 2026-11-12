import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildLayout, type Plan } from "../scene/layout.ts";

it("keeps the B3 wall at the shaft corner", () => {
  const { bundle } = loadShinjukuBundle();
  const layout = buildLayout(bundle, planJson as unknown as Plan);
  const level = layout.levels.find((lv) => lv.label === "B3")!;
  const midpoint = { x: -54.6015, y: 154.2518 };
  const atCorner = (w: typeof level.walls[number]) => {
    const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
    const t = Math.max(0, Math.min(1, ((midpoint.x - w.a.x) * dx + (midpoint.y - w.a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(midpoint.x - w.a.x - t * dx, midpoint.y - w.a.y - t * dy) < 0.02 &&
      w.zMin <= level.z + 1 && w.zMax >= level.z + 1;
  };
  expect(layout.cornerFills.some((w) => w.level === "B3" && atCorner(w))).toBe(true);
  expect(level.walls.some(atCorner)).toBe(false);
  expect(createHash("sha256").update(JSON.stringify(layout.levels.map((lv) => lv.walls))).digest("hex")).toBe("8a14eef41029388912390d01fba99aeefff60386d88f573906e3cc32d88d0b83");
}, 30_000);
