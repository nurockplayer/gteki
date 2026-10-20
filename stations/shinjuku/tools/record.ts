/**
 * Walkthrough recorder for the E27 lane app: guide-walks a real route and encodes an MP4.
 *
 *   pnpm --filter @gteki/station-shinjuku record --from poi:platform:oedo --to poi:exit:1 \
 *     [--url http://localhost:5274] [--out .qa/video] [--w 1280 --h 720] [--fps 30] [--q high] [--crowd 24] [--tail 3]
 *
 * The page runs on a virtual clock: `performance.now` and `requestAnimationFrame` are replaced before
 * the app loads, and each video frame advances exactly 1/fps of station time. The video therefore
 * shows the walk at true speed regardless of how fast headless Chrome renders. It needs a running dev
 * server, Google Chrome and Homebrew ffmpeg. Writes <out>/<from>__<to>.mp4 and a JSON sidecar.
 */
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const url = arg("url", "http://localhost:5274")!;
const from = arg("from", "poi:platform:oedo")!;
const to = arg("to", "poi:exit:1")!;
const out = resolve(arg("out", join(here, "../../../.qa/video"))!);
const w = Number(arg("w", "1280")), h = Number(arg("h", "720"));
const fps = Number(arg("fps", "30"));
const q = arg("q", "high")!;
const crowd = arg("crowd", "24")!;
const tail = Number(arg("tail", "3"));
const maxSeconds = Number(arg("max", "420"));
const name = `${from}__${to}`.replace(/[^a-z0-9_]+/gi, "-");
const frames = join(out, `${name}.frames`);
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  // Virtual clock: the recorder owns time. THREE.Clock and the app read performance.now().
  let vt = 0;
  let queue: FrameRequestCallback[] = [];
  let id = 0;
  performance.now = () => vt;
  window.requestAnimationFrame = (cb) => (queue.push(cb), ++id);
  window.cancelAnimationFrame = () => {};
  (window as unknown as { __tick: (ms: number) => void }).__tick = (ms: number) => {
    vt += ms;
    const run = queue;
    queue = [];
    for (const cb of run) cb(vt);
  };
});
await page.goto(`${url}/?q=${q}&crowd=${crowd}`);
await page.waitForFunction(() => !!(window as any).__gteki, null, { timeout: 60_000 });
const dtMs = 1000 / fps;
const tick = () => page.evaluate((ms) => (window as any).__tick(ms), dtMs);
for (let i = 0; i < 10; i++) await tick(); // load, first frames, loading veil
const plan = await page.evaluate(({ from, to }) => {
  const g = (window as any).__gteki;
  const fromPoi = g.bundle.pois.find((p: any) => p.id === from);
  if (!fromPoi) return { error: `no poi ${from}` };
  g.teleportNode(fromPoi.connectorNodeIds[0]);
  const r = g.routeTo(to, from);
  if (typeof r !== "object" || r === null) return { error: `no route: ${r}` };
  g.guide();
  return r;
}, { from, to });
if ("error" in plan) throw new Error(String(plan.error));
console.log("route", plan);

let n = 0;
let arrivedAt: number | null = null;
const states: unknown[] = [];
for (; n < maxSeconds * fps; n++) {
  await tick();
  await page.screenshot({ path: join(frames, `${String(n).padStart(5, "0")}.jpg`), type: "jpeg", quality: 92 });
  if (n % fps === 0) {
    const s = await page.evaluate(() => (window as any).__gteki.state());
    states.push({ t: n / fps, ...s });
    if (!s.guiding && arrivedAt === null && n > fps) arrivedAt = n;
    if (n % (fps * 10) === 0) console.log(`t=${n / fps}s`, JSON.stringify(s));
  }
  if (arrivedAt !== null && n - arrivedAt > tail * fps) break;
}
await browser.close();

const mp4 = join(out, `${name}.mp4`);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", join(frames, "%05d.jpg"), "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
writeFileSync(join(out, `${name}.json`), JSON.stringify({ url, from, to, w, h, fps, q, crowd, route: plan, frames: n, seconds: n / fps, arrived: arrivedAt !== null, arrivedAtS: arrivedAt === null ? null : arrivedAt / fps, errors, states }, null, 2));
rmSync(frames, { recursive: true, force: true });
console.log(arrivedAt !== null ? `arrived at ${arrivedAt / fps}s` : "DID NOT ARRIVE", "→", mp4);
if (arrivedAt === null) process.exitCode = 1;
