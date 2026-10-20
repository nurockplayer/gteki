/**
 * Guided-walk sampler for Shinjuku in the SHARED explorer (apps/web), the view Lane F accepts on.
 *
 *   pnpm --filter @gteki/station-shinjuku explorer-walk [--url http://localhost:5290] [--out .qa/explorer-walk]
 *     [--route poi:exit:1,poi:platform:oedo] [--every 3] [--w 1280 --h 720]
 *
 * For each route it starts guidance and advances the explorer's own fixed-step simulation, sampling
 * every `--every` seconds of station time: a JPEG of the frame, the near-black ("void") fraction read
 * back from the WebGL canvas in the same task as the render, camera height vs avatar height, and mode.
 * Writes <out>/<route>/NNN.jpg, <out>/report.json and a contact sheet per route (needs ffmpeg).
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
const url = arg("url", "http://localhost:5290")!;
const out = resolve(arg("out", join(here, "../../../.qa/explorer-walk"))!);
const every = Number(arg("every", "3"));
const w = Number(arg("w", "1280")), h = Number(arg("h", "720"));
const routes = (arg("route") ? [arg("route")!] : ["poi:exit:1,poi:platform:oedo", "poi:platform:oedo,poi:exit:2", "poi:platform:oedo,poi:exit:1"]).map((r) => r.split(","));

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${url}/?station=shinjuku`);
await page.waitForFunction(() => !!(window as any).__gteki?.sceneInfo, null, { timeout: 60_000 });
await page.waitForTimeout(1500);

const report: unknown[] = [];
for (const [from, to] of routes) {
  const name = `${from}__${to}`.replace(/[^a-z0-9_]+/gi, "-");
  const dir = join(out, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const ok = await page.evaluate(async ({ from, to }) => {
    const g = (window as any).__gteki;
    const a = g.setOrigin(from), b = g.setDestination(to);
    await new Promise((r) => setTimeout(r, 400));
    g.startGuide();
    return a && b && g.mode() === "guide";
  }, { from, to });
  if (!ok) throw new Error(`could not start guide ${from} → ${to}`);
  const samples: { t: number; void: number; camY: number; avatarZ: number; mode: string }[] = [];
  let still = 0, last = "";
  for (let i = 0; i < 400; i++) {
    const s = await page.evaluate((dt) => {
      const g = (window as any).__gteki;
      const a = g.simulate(dt);
      // Read back in the same task as the render (no preserveDrawingBuffer needed).
      const src = document.querySelector("canvas") as HTMLCanvasElement;
      const c = document.createElement("canvas");
      c.width = 320; c.height = Math.round((320 * src.height) / src.width);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(src, 0, 0, c.width, c.height);
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      for (let k = 0; k < px.length; k += 4) if (px[k]! < 24 && px[k + 1]! < 24 && px[k + 2]! < 28) dark++;
      const info = g.sceneInfo();
      return { void: dark / (px.length / 4), camY: info.camera[1], avatarZ: a.z, ax: a.x, ay: a.y, mode: g.mode() as string };
    }, i === 0 ? 0.5 : every);
    const t = i === 0 ? 0 : 0.5 + (i - 1) * every;
    const { ax, ay, ...rest } = s;
    samples.push({ t, ...rest, void: Math.round(s.void * 1000) / 1000, avatarZ: Math.round(s.avatarZ * 100) / 100 });
    const here = `${ax.toFixed(2)},${ay.toFixed(2)},${s.avatarZ.toFixed(2)}`;
    still = here === last ? still + 1 : 0;
    last = here;
    await page.screenshot({ path: join(dir, `${String(i).padStart(3, "0")}.jpg`), type: "jpeg", quality: 80 });
    if (s.mode !== "guide" || still >= 2) break; // guidance ended or the walker has arrived and stopped
  }
  const worst = samples.reduce((m, s) => Math.max(m, s.void), 0);
  const over = samples.filter((s) => s.void > 0.15).length;
  console.log(name, "samples", samples.length, "worstVoid", worst, "samples >0.15 void", over);
  report.push({ from, to, samples, worstVoid: worst, samplesOver15: over });
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-pattern_type", "glob", "-i", join(dir, "*.jpg"), "-vf", "scale=480:-1,tile=6x8", "-frames:v", "1", join(out, `${name}.sheet.jpg`)]);
  } catch {
    /* contact sheet is optional */
  }
}
await browser.close();
writeFileSync(join(out, "report.json"), JSON.stringify({ url, every, w, h, errors, routes: report }, null, 2));
if (errors.length) console.log("page errors", errors);
