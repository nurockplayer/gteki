/**
 * Start-up cost of Shinjuku in production builds (headless Brave on this machine, not a phone).
 *
 *   pnpm --filter @gteki/station-shinjuku build && pnpm --filter @gteki/web build
 *   (serve: vite preview --port 5275 for the lane, --port 5291 for apps/web)
 *   pnpm --filter @gteki/station-shinjuku perf [--lane http://localhost:5275] [--explorer http://localhost:5291] [--runs 5] [--out perf.json]
 *
 * buildLayout: the renderer-neutral layout solve in Node (median of --runs, after one warm-up).
 * Lane app: navigation → first station frame / interactive / per-phase times from `__gteki.timings()`.
 * Shared explorer: navigation → Shinjuku scene ready (walkable proxies present), then three warm
 * `openStation("shinjuku")` reloads. Both: JS heap after a forced GC and WebGL draw calls per frame
 * (every draw* call counted over 60 animation frames of the idle spawn view). Medians over fresh pages;
 * the machine's load average and free memory are recorded alongside, since this is not a quiet bench.
 */
import { chromium, type Page } from "playwright-core";
import { browserTarget } from "./browser.ts";
import { writeFileSync } from "node:fs";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { buildLayout, type Plan } from "../scene/layout.ts";
import plan from "../data/plan.json" with { type: "json" };

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const lane = arg("lane", "http://localhost:5275")!;
const explorer = arg("explorer", "http://localhost:5291")!;
const runs = Number(arg("runs", "5"));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const machine = () => ({ loadavg1m: +loadavg()[0]!.toFixed(2), cpus: cpus().length, freeMemGB: +(freemem() / 2 ** 30).toFixed(1), totalMemGB: +(totalmem() / 2 ** 30).toFixed(1) });
const machineBefore = machine();

const { bundle } = loadShinjukuBundle();
buildLayout(bundle, plan as unknown as Plan);
const layoutMs: number[] = [];
for (let i = 0; i < runs; i++) {
  const t = performance.now();
  buildLayout(bundle, plan as unknown as Plan);
  layoutMs.push(Math.round(performance.now() - t));
}

const browser = await chromium.launch({ ...browserTarget(), headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-precise-memory-info", "--js-flags=--expose-gc"] });
const heapMB = (page: Page) => page.evaluate(() => { (globalThis as { gc?: () => void }).gc?.(); return Math.round(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1e5) / 10; });
const newPage = async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // Count WebGL draws for both apps the same way (renderer.info resets per render pass).
  await page.addInitScript(() => {
    const w = window as unknown as { __draws: number };
    w.__draws = 0;
    for (const C of [WebGL2RenderingContext, WebGLRenderingContext])
      for (const k of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced", "drawRangeElements"] as const) {
        const p = C.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
        const f = p[k];
        if (f) p[k] = function (this: unknown, ...a: unknown[]) { w.__draws++; return f.apply(this, a); };
      }
  });
  return page;
};
const drawsPerFrame = (page: Page) => page.evaluate(async () => {
  const w = window as unknown as { __draws: number };
  // No named closures in here: tsx's keepNames would wrap them in a `__name` the page doesn't have.
  await new Promise((r) => requestAnimationFrame(r));
  w.__draws = 0;
  for (let i = 0; i < 60; i++) await new Promise((r) => requestAnimationFrame(r));
  return Math.round(w.__draws / 60);
});

const laneRuns: { firstFrame: number; interactive: number; heap: number; draws: number; phases: Record<string, number> }[] = [];
for (let i = 0; i < runs; i++) {
  const page = await newPage();
  await page.goto(`${lane}/?q=high&crowd=24`);
  await page.waitForFunction(() => (window as any).__gteki?.timings?.().timeToInteractiveMs != null, null, { timeout: 120_000 });
  const t = await page.evaluate(() => (window as any).__gteki.timings());
  await page.waitForTimeout(1000);
  laneRuns.push({ firstFrame: Math.round(t.timeToFirstFrameMs), interactive: Math.round(t.timeToInteractiveMs), heap: await heapMB(page), draws: await drawsPerFrame(page), phases: Object.fromEntries(t.measures.filter((m: { name: string }) => !m.name.includes("time-to")).map((m: { name: string; durationMs: number }) => [m.name.replace("gteki:", ""), Math.round(m.durationMs)])) });
  await page.close();
}

const exRuns: { ready: number; reopen: number; heap: number; draws: number }[] = [];
for (let i = 0; i < runs; i++) {
  const page = await newPage();
  const t0 = Date.now();
  await page.goto(`${explorer}/?station=shinjuku`);
  await page.waitForFunction(() => ((window as any).__gteki?.sceneInfo?.().walkable ?? 0) > 0, null, { timeout: 120_000, polling: 50 });
  const ready = Date.now() - t0;
  await page.waitForTimeout(1000);
  const draws = await drawsPerFrame(page);
  const reopen = await page.evaluate(async () => {
    const g = (window as any).__gteki;
    const ms: number[] = [];
    for (let k = 0; k < 3; k++) {
      await g.openStation("_synthetic-demo");
      const s = performance.now();
      await g.openStation("shinjuku");
      ms.push(performance.now() - s);
    }
    return ms.sort((a, b) => a - b)[1]!;
  });
  await page.waitForTimeout(1000);
  exRuns.push({ ready, reopen: Math.round(reopen), heap: await heapMB(page), draws });
  await page.close();
}
await browser.close();

const phaseMedian = (key: string) => median(laneRuns.map((r) => r.phases[key] ?? NaN));
const out = {
  machine: { before: machineBefore, after: machine() },
  runs,
  buildLayoutMs: { runs: layoutMs, median: median(layoutMs) },
  lane: { url: lane, runs: laneRuns, median: { firstFrameMs: median(laneRuns.map((r) => r.firstFrame)), interactiveMs: median(laneRuns.map((r) => r.interactive)), stationMs: phaseMedian("station"), crowdMs: phaseMedian("crowd"), heapMB: median(laneRuns.map((r) => r.heap)), drawsPerFrame: median(laneRuns.map((r) => r.draws)) } },
  explorer: { url: explorer, runs: exRuns, median: { readyMs: median(exRuns.map((r) => r.ready)), reopenMs: median(exRuns.map((r) => r.reopen)), heapMB: median(exRuns.map((r) => r.heap)), drawsPerFrame: median(exRuns.map((r) => r.draws)) } },
};
const json = JSON.stringify(out, null, 2);
if (arg("out")) writeFileSync(arg("out")!, json + "\n");
console.log(json);
