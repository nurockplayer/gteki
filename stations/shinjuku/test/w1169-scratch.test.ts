import { it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { planBundle } from "../gteki/scene.ts";
import { prepareLayout } from "../scene/build-cache.ts";
import type { Plan } from "../scene/layout.ts";
import plan from "../data/plan.json" with { type: "json" };

it("lists nearby walls", () => {
  const layout = prepareLayout(planBundle(loadShinjukuBundle().bundle), plan as unknown as Plan, { reuse: true }).layout;
  for (const lv of layout.levels) for (const w of [...lv.walls, ...layout.cornerFills.filter(w => w.level === lv.label)]) {
    if (w.kind === "trackside" || w.finish === "fascia") continue;
    if (Math.min(Math.hypot(w.a.x + 47.6, w.a.y - 165.5), Math.hypot(w.b.x + 47.6, w.b.y - 165.5)) > 6) continue;
    console.log(JSON.stringify({level:lv.label,a:w.a,b:w.b,profile:w.profile,base:w.surfaceBase, zMin:w.zMin,finish:w.finish}));
  }
}, 120_000);
