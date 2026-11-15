/** Bake the verified, pitched layout/protection snapshot: pnpm --filter ./stations/shinjuku bake:layout [--check]. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { buildLayout, type Plan } from "../scene/layout.ts";
import { protectFareAndAccess } from "../scene/fare-fence.ts";
import { contentKey } from "../scene/content-key.ts";
import { encodeLayoutSnapshot } from "../scene/layout-codec.ts";
import { layoutInputKey, type LayoutBake } from "../scene/layout-bake.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const LAYOUT_BAKED_PATH = join(here, "../data/layout-baked.bin");
const keyPath = join(here, "../data/layout-bake-key.json");
const sources = ["layout.ts", "stable-hypot.ts", "fare-fence.ts", "content-key.ts", "layout-codec.ts", "layout-bake.ts"];
export function layoutSourceKey(): string {
  const files = sources.map((f) => [f, readFileSync(join(here, "../scene", f), "utf8")]);
  // Runtime derivation dependencies outside the station, including their re-export wiring.
  for (const f of ["navigation/src/present.ts", "navigation/src/index.ts", "scene-api/src/liftShaft.ts", "scene-api/src/index.ts"])
    files.push([f, readFileSync(join(here, "../../../packages", f), "utf8")]);
  const clipping = JSON.parse(readFileSync(join(here, "../node_modules/polygon-clipping/package.json"), "utf8")).version;
  return contentKey("layout-sources-v1", files, clipping);
}
export function layoutBakedText(): string {
  const { bundle } = loadShinjukuBundle();
  const plan = JSON.parse(readFileSync(join(here, "../data/plan.json"), "utf8")) as Plan;
  const layout = buildLayout(bundle, plan, { pitchedCeilings: true });
  const protection = protectFareAndAccess(layout, plan, bundle);
  return JSON.stringify({ inputKey: layoutInputKey(bundle, plan), sourceKey: layoutSourceKey(), verified: true,
    snapshot: encodeLayoutSnapshot({ layout, protection }) } satisfies LayoutBake) + "\n";
}
export function bakeLayoutFile(check = false) {
  const payload = gzipSync(layoutBakedText(), { level: 9 });
  const keyText = JSON.stringify({ sourceKey: layoutSourceKey() }) + "\n";
  if (check) {
    if (!readFileSync(LAYOUT_BAKED_PATH).equals(payload) || readFileSync(keyPath, "utf8") !== keyText)
      throw new Error("layout bake is stale; run bake:layout");
  } else {
    writeFileSync(LAYOUT_BAKED_PATH, payload);
    writeFileSync(keyPath, keyText);
  }
  console.log(`${check ? "Checked" : "Wrote"} layout-baked.bin, ${payload.byteLength} gzip bytes`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) bakeLayoutFile(process.argv.includes("--check"));
