/** Bake the street-layer derivations into data/surface-baked.json (#72).
 *
 *   pnpm --filter ./stations/shinjuku bake:surface            # write
 *   pnpm --filter ./stations/shinjuku bake:surface -- --check # fail if the file would change
 *
 * Reads only committed files (surface.json, the station bundle, plan.json), so it needs no raw data and can run
 * in CI. Run it after import:e27 or import:surface, or after changing scene/surface-*.ts or scene/layout.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { buildLayout, type Plan } from "../scene/layout.ts";
import { protectFareAndAccess } from "../scene/fare-fence.ts";
import { contentKey } from "../scene/content-key.ts";
import { bakeSurface, bakedFileText } from "../scene/surface-bake.ts";
import type { SurfaceData } from "../scene/surface-data.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const BAKED_PATH = join(here, "../data/surface-baked.json");

/** Hash of everything the baked values are computed by: the derivation sources (including the layout and the
 * fare/access pad trim the layout passes through) and the polygon-clipping version. Not checkable at load, so
 * the test and `--check` compare it with the one stored in the baked file. */
export const DERIVATION_SOURCES = ["layout.ts", "fare-fence.ts", "surface-layout.ts", "surface-street.ts", "surface-bake.ts", "content-key.ts"];
export function derivationSourceKey(): string {
  const sources = DERIVATION_SOURCES.map((f) => [f, readFileSync(join(here, "../scene", f), "utf8")]);
  const clipping = JSON.parse(readFileSync(join(here, "../node_modules/polygon-clipping/package.json"), "utf8")).version;
  return contentKey("surface-sources", sources, clipping);
}

/** The exact text the file must contain. */
export function bakedText(): string {
  const { bundle } = loadShinjukuBundle();
  const plan = JSON.parse(readFileSync(join(here, "../data/plan.json"), "utf8")) as Plan;
  const surface = JSON.parse(readFileSync(join(here, "../data/surface.json"), "utf8")) as SurfaceData;
  // buildStation derives the street layer from the layout after the fare/access trim of its pads.
  const layout = buildLayout(bundle, plan);
  protectFareAndAccess(layout, plan, bundle);
  return bakedFileText(bakeSurface(surface, layout, bundle, plan), derivationSourceKey());
}

export function bakeSurfaceFile(check = false) {
  const text = bakedText();
  if (check) {
    if (readFileSync(BAKED_PATH, "utf8") !== text) throw new Error("surface-baked.json is stale; run bake:surface");
  } else writeFileSync(BAKED_PATH, text);
  console.log(`${check ? "Checked" : "Wrote"} surface-baked.json, ${Buffer.byteLength(text)} bytes`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) bakeSurfaceFile(process.argv.includes("--check"));
