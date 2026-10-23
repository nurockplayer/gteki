/**
 * Writes (or checks) stations/shinjuku/kit/catalog.json, the station catalog Lane E builds kit pieces from
 * (Issue #94). Derived from the scene layout, so rerun it whenever the importers change the graph or plan:
 *
 *   pnpm --filter @gteki/station-shinjuku kit:catalog            # regenerate kit/catalog.json
 *   pnpm --filter @gteki/station-shinjuku kit:catalog -- --check # exit 1 if the committed file is stale
 *
 * Never hand-edit the JSON. See docs/stations/shinjuku/kit-swap.md, "Regenerating the catalog".
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadShinjukuBundle } from "../data/bundle.ts";
import plan from "../data/plan.json" with { type: "json" };
import { protectFareAndAccess } from "../scene/fare-fence.ts";
import { buildLayout, type Plan } from "../scene/layout.ts";
import { buildStationCatalog, validateStationCatalog } from "../scene/kit/catalog.ts";

export const CATALOG_PATH = fileURLToPath(new URL("../kit/catalog.json", import.meta.url));

export function renderCatalog(): { text: string; unfitted: ReturnType<typeof buildStationCatalog>["unfitted"]; entries: number } {
  const { bundle } = loadShinjukuBundle();
  const layout = buildLayout(bundle, plan as unknown as Plan);
  const protection = protectFareAndAccess(layout, plan as unknown as Plan, bundle);
  const { catalog, unfitted } = buildStationCatalog(layout, protection);
  const problems = validateStationCatalog(catalog);
  if (problems.length) throw new Error(`generated catalog is invalid:\n${problems.join("\n")}`);
  return { text: `${JSON.stringify(catalog, null, 2)}\n`, unfitted, entries: catalog.assets.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { text, unfitted, entries } = renderCatalog();
  for (const u of unfitted) console.log(`unfitted ${u.role} ${u.edgeId}: ${u.reason}`);
  if (process.argv.includes("--check")) {
    const current = readFileSync(CATALOG_PATH, "utf8");
    if (current !== text) {
      console.error("kit/catalog.json is stale: run pnpm --filter @gteki/station-shinjuku kit:catalog");
      process.exit(1);
    }
    console.log(`kit/catalog.json is up to date (${entries} entries, ${unfitted.length} unfitted runs)`);
  } else {
    writeFileSync(CATALOG_PATH, text);
    console.log(`wrote ${CATALOG_PATH} (${entries} entries, ${unfitted.length} unfitted runs)`);
  }
}
