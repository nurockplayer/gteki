/**
 * Start-up cost of Shinjuku in production builds (headless Chrome on this machine, not a phone).
 *
 *   pnpm --filter @gteki/station-shinjuku build && pnpm --filter @gteki/web build
 *   (serve: vite preview --port 5275 for the lane, --port 5291 for apps/web)
 *   pnpm --filter @gteki/station-shinjuku perf [--lane http://localhost:5275] [--explorer http://localhost:5291] [--runs 3]
 *
 * Lane app: navigation → first station frame / interactive from `__gteki.timings()`, plus JS heap.
 * Shared explorer: navigation → Shinjuku scene ready (walkable proxies present), then three warm
 * `openStation("shinjuku")` reloads; JS heap after a forced GC. Medians over fresh pages.
 */
import { chromium, type Page } from "playwright-core";

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const lane = arg("lane", "http://localhost:5275")!;
const explorer = arg("explorer", "http://localhost:5291")!;
const runs = Number(arg("runs", "3"));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-precise-memory-info", "--js-flags=--expose-gc"] });
const heapMB = (page: Page) => page.evaluate(() => { (globalThis as { gc?: () => void }).gc?.(); return Math.round(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1e5) / 10; });

const laneRuns: { firstFrame: number; interactive: number; heap: number; phases: Record<string, number> }[] = [];
for (let i = 0; i < runs; i++) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${lane}/?q=high&crowd=24`);
  await page.waitForFunction(() => (window as any).__gteki?.timings?.().timeToInteractiveMs != null, null, { timeout: 120_000 });
  const t = await page.evaluate(() => (window as any).__gteki.timings());
  await page.waitForTimeout(1000);
  laneRuns.push({ firstFrame: Math.round(t.timeToFirstFrameMs), interactive: Math.round(t.timeToInteractiveMs), heap: await heapMB(page), phases: Object.fromEntries(t.measures.filter((m: { name: string }) => !m.name.includes("time-to")).map((m: { name: string; durationMs: number }) => [m.name.replace("gteki:", ""), Math.round(m.durationMs)])) });
  await page.close();
}

const exRuns: { ready: number; reopen: number; heap: number }[] = [];
for (let i = 0; i < runs; i++) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const t0 = Date.now();
  await page.goto(`${explorer}/?station=shinjuku`);
  await page.waitForFunction(() => ((window as any).__gteki?.sceneInfo?.().walkable ?? 0) > 0, null, { timeout: 120_000, polling: 50 });
  const ready = Date.now() - t0;
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
  exRuns.push({ ready, reopen: Math.round(reopen), heap: await heapMB(page) });
  await page.close();
}
await browser.close();

const out = {
  lane: { url: lane, runs: laneRuns, median: { firstFrameMs: median(laneRuns.map((r) => r.firstFrame)), interactiveMs: median(laneRuns.map((r) => r.interactive)), heapMB: median(laneRuns.map((r) => r.heap)) } },
  explorer: { url: explorer, runs: exRuns, median: { readyMs: median(exRuns.map((r) => r.ready)), reopenMs: median(exRuns.map((r) => r.reopen)), heapMB: median(exRuns.map((r) => r.heap)) } },
};
console.log(JSON.stringify(out, null, 2));
