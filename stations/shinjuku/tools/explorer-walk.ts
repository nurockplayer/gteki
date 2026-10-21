/**
 * Guided-walk sampler for Shinjuku in the SHARED explorer (apps/web), the view Lane F accepts on.
 *
 *   pnpm --filter @gteki/station-shinjuku explorer-walk [--url http://localhost:5290] [--out .qa/explorer-walk]
 *     [--route poi:exit:1,poi:platform:oedo] [--every 3] [--w 1280 --h 720] [--exits]
 *
 * For each route it starts guidance and advances the explorer's own fixed-step simulation, sampling
 * every `--every` seconds of station time: a JPEG of the frame, the near-black ("void") fraction read
 * back from the WebGL canvas in the same task as the render, camera height vs avatar height, and mode.
 * Writes <out>/<route>/NNN.jpg, <out>/report.json and a contact sheet per route (needs ffmpeg).
 * Every sample also records the explorer's street backdrop (sky opacity, pavement shown), read from the
 * three.js scene through the __THREE_DEVTOOLS__ observe hook. `--exits` adds, per exit, the frame at its
 * street-level stair top and the first frame one tread (0.15 m) below it, guiding down from the exit.
 */
import { chromium } from "playwright-core";
import { browserTarget } from "./browser.ts";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadShinjukuBundle } from "../data/bundle.ts";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const url = arg("url", "http://localhost:5290")!;
const out = resolve(arg("out", join(here, "../../../.qa/explorer-walk"))!);
const every = Number(arg("every", "3"));
const w = Number(arg("w", "1280")), h = Number(arg("h", "720"));
const exits = process.argv.includes("--exits");
const routes = (arg("route") ? [arg("route")!] : ["poi:exit:1,poi:platform:oedo", "poi:platform:oedo,poi:exit:2", "poi:platform:oedo,poi:exit:1"]).map((r) => r.split(","));

const browser = await chromium.launch({ ...browserTarget(), headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  const hook = new EventTarget(), scenes: unknown[] = [];
  hook.addEventListener("observe", (e) => { const o = (e as CustomEvent).detail; if (o?.isScene) scenes.push(o); });
  Object.assign(window, { __THREE_DEVTOOLS__: hook, __scenes: scenes });
});
await page.goto(`${url}/?station=shinjuku`);
await page.waitForFunction(() => !!(window as any).__gteki?.sceneInfo, null, { timeout: 60_000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  /** Street backdrop as drawn: sky opacity (0 when hidden) and whether the pavement plane shows. */
  (window as any).__street = () => {
    for (const sc of (window as any).__scenes) {
      const grp = sc.getObjectByName("street-backdrop");
      if (!grp) continue;
      const sky = grp.children.find((c: any) => c.material?.uniforms?.uOpacity);
      return { sky: grp.visible ? Math.round(sky.material.uniforms.uOpacity.value * 1000) / 1000 : 0, pavement: grp.visible && !!grp.getObjectByName("street-backdrop-ground")?.visible };
    }
    return null;
  };
});

type Street = { sky: number; pavement: boolean } | null;
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
  const samples: { t: number; void: number; camY: number; avatarZ: number; mode: string; street: Street }[] = [];
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
      return { void: dark / (px.length / 4), camY: info.camera[1], avatarZ: a.z, ax: a.x, ay: a.y, mode: g.mode() as string, street: (window as any).__street() };
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
  const daylight = samples.filter((s) => (s.street?.sky ?? 0) > 0).length;
  console.log(name, "samples", samples.length, "worstVoid", worst, "samples >0.15 void", over, "samples with daylight", daylight);
  report.push({ from, to, samples, worstVoid: worst, samplesOver15: over, samplesWithDaylight: daylight });
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-pattern_type", "glob", "-i", join(dir, "*.jpg"), "-vf", "scale=480:-1,tile=6x8", "-frames:v", "1", join(out, `${name}.sheet.jpg`)]);
  } catch {
    /* contact sheet is optional */
  }
}
const exitTops: unknown[] = [];
if (exits) {
  const dir = join(out, "exit-tops");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const ids = loadShinjukuBundle().bundle.pois.filter((p) => p.id.startsWith("poi:exit:")).map((p) => ({ id: p.id, node: p.connectorNodeIds[0]! }));
  const frame = (dt: number) => page.evaluate((dt) => {
    const g = (window as any).__gteki, a = g.simulate(dt);
    return { z: Math.round(a.z * 100) / 100, street: (window as any).__street() as Street };
  }, dt);
  const shot = (id: string, tag: string) => page.screenshot({ path: join(dir, `${id.replace(/\W+/g, "-")}-${tag}.jpg`), type: "jpeg", quality: 80 });
  for (const { id, node } of ids) {
    // Standing still on the exit's own node (free walk) long enough for the backdrop blend to settle.
    if (!(await page.evaluate((n: string) => (window as any).__gteki.walkFromNode(n), node))) { exitTops.push({ id, error: "walkFromNode failed" }); continue; }
    const top = await frame(3);
    await shot(id, "top");
    // Then guide down from the exit and stop on the first frame one tread (0.15 m) below where it starts.
    const started = await page.evaluate(async (id: string) => {
      const g = (window as any).__gteki;
      g.setOrigin(id); g.setDestination("poi:platform:oedo");
      await new Promise((r) => setTimeout(r, 400));
      g.startGuide();
      return g.mode() === "guide";
    }, id);
    if (!started) { exitTops.push({ id, top, error: "no guide" }); continue; }
    const start = await frame(0.05);
    let below = start, t = 0;
    while (below.z > start.z - 0.15 && t < 30) { below = await frame(0.1); t += 0.1; }
    await shot(id, "below");
    console.log(id, "top", top, "below", below, `after ${t.toFixed(1)} s`);
    exitTops.push({ id, top, below, secondsToBelow: Math.round(t * 10) / 10 });
  }
}
await browser.close();
writeFileSync(join(out, "report.json"), JSON.stringify({ url, every, w, h, errors, routes: report, exitTops }, null, 2));
if (errors.length) console.log("page errors", errors);
