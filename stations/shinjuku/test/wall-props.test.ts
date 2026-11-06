// Decorative Shinjuku wall props (#858 item 12) stand flush to a built wall and are at most
// WALKER_BODY.radiusM deep, so the wall alone (no prop collider) keeps the walker's centre out of them.
// This checks both halves against buildLayout's walls.
import { WALKER_BODY } from "@gteki/scene-api";
import { describe, expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildLayout, type Plan, type WallSeg, type XY } from "../scene/layout.ts";
import wallProps from "../scene/wall-props.ts";

const { bundle } = loadShinjukuBundle();
const layout = buildLayout(bundle, planJson as unknown as Plan);
const walls: WallSeg[] = [...layout.levels.flatMap((level) => level.walls), ...layout.runWalls];

function pointSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

describe("Shinjuku wall props (#858 item 12)", () => {
  it("are no deeper than the walker's radius", () => {
    for (const prop of wallProps) expect(prop.d, prop.id).toBeLessThanOrEqual(WALKER_BODY.radiusM);
  });

  it("stand within 0.05 m of a wall across their full width, and its band covers the walker's body", () => {
    const missing: string[] = [];
    for (const prop of wallProps) {
      const [wx, wy] = prop.wall, [nx, ny] = prop.n, tx = -ny, ty = nx;
      const floor = prop.z;
      for (let i = 0; i <= 10; i++) {
        const along = -prop.w / 2 + (prop.w * i) / 10;
        const point = { x: wx + tx * along - nx * 0.02, y: wy + ty * along - ny * 0.02 };
        const wall = walls.find((w) => pointSegment(point, w.a, w.b) <= 0.05
          && w.zMin <= floor + WALKER_BODY.bodyBottomM && w.zMax >= floor + WALKER_BODY.bodyTopM);
        if (!wall) missing.push(`${prop.id} at ${along.toFixed(2)} m along its width`);
      }
    }
    expect(missing).toEqual([]);
  });
});
