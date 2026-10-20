/**
 * QA screenshot harness for the E27 lane app.
 *
 *   pnpm --filter @gteki/station-shinjuku shoot [--url http://localhost:5274] [--out dir] [--only id,id] [--w 1280 --h 720] [--q high|low] [--crowd N]
 *
 * Needs a running dev server (`pnpm --filter @gteki/station-shinjuku dev`) and Google Chrome.
 * Writes <out>/<vantage>.png plus <out>/report.json (fps is not meaningful headless; calls/tris/void are).
 */
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Vantage { id: string; node?: string; heading?: number; eye?: XYZ; look?: XYZ; t?: number }
interface XYZ { x: number; y: number; z: number }

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const url = arg("url", "http://localhost:5274")!;
const out = resolve(arg("out", join(here, "../../../.qa/shots"))!);
const only = arg("only")?.split(",");
const w = Number(arg("w", "1280")), h = Number(arg("h", "720"));
const q = arg("q", "high")!;
const crowd = arg("crowd", "24")!;
const hud = arg("hud", "1")!;
const { vantages } = JSON.parse(readFileSync(join(here, "vantages.json"), "utf8")) as { vantages: Vantage[] };

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(`${url}/?q=${q}&crowd=${crowd}${hud === "0" ? "&hud=0" : ""}`);
await page.waitForFunction(() => !!(window as unknown as { __gteki?: unknown }).__gteki, null, { timeout: 60_000 });
const report: Record<string, unknown>[] = [];
for (const v of vantages) {
  if (only && !only.includes(v.id)) continue;
  const r = await page.evaluate((v) => {
    const g = (window as any).__gteki;
    if (v.eye && v.look) g.view({ eye: v.eye, look: v.look });
    else {
      g.view(null);
      if (!g.teleportNode(v.node, v.heading)) return { error: `no node ${v.node}` };
    }
    g.advance(v.t ?? 1.5, 45);
    const voidFraction = g.voidFraction();
    return { ...g.state(), voidFraction };
  }, v);
  await page.screenshot({ path: join(out, `${v.id}.png`) });
  report.push({ id: v.id, ...r });
  console.log(v.id, JSON.stringify(r));
}
writeFileSync(join(out, "report.json"), JSON.stringify({ url, w, h, q, crowd, errors, shots: report }, null, 2));
if (errors.length) console.error("page errors:", errors);
await browser.close();
