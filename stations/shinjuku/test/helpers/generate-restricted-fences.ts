/** pnpm exec tsx stations/shinjuku/test/helpers/generate-restricted-fences.ts */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadShinjukuBundle } from "../../data/bundle.ts";
import planJson from "../../data/plan.json" with { type: "json" };
import { buildLayout, type Plan } from "../../scene/layout.ts";
import { protectFareAndAccess } from "../../scene/fare-fence.ts";
const { bundle } = loadShinjukuBundle(), plan = planJson as Plan;
protectFareAndAccess(buildLayout(bundle, plan), plan, bundle, { recomputeRestricted: true,
  onRestricted: data => writeFileSync(fileURLToPath(new URL("../../scene/fare-restricted.generated.json", import.meta.url)), JSON.stringify(data) + "\n") });
