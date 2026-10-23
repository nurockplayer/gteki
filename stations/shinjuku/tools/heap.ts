/**
 * JS heap composition after a forced GC, from a Chrome heap snapshot (self sizes by node type /
 * constructor; minified names in production builds). For finding what the station keeps alive.
 *
 *   pnpm --filter @gteki/station-shinjuku heap "http://localhost:5275/?q=high&crowd=24"
 *   pnpm --filter @gteki/station-shinjuku heap "http://localhost:5291/?station=shinjuku"
 */
import { chromium } from "playwright-core";
import { browserTarget } from "./browser.ts";
const url = process.argv[2] ?? "http://localhost:5275/?q=high&crowd=24";
const browser = await chromium.launch({ ...browserTarget(), headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url);
await page.waitForFunction(() => (window as any).__gteki?.timings?.().timeToInteractiveMs != null || ((window as any).__gteki?.sceneInfo?.().walkable ?? 0) > 0, null, { timeout: 120000 });
await page.waitForTimeout(2000);
const cdp = await page.context().newCDPSession(page);
await cdp.send("HeapProfiler.collectGarbage");
let chunks: string[] = [];
cdp.on("HeapProfiler.addHeapSnapshotChunk", (e: any) => chunks.push(e.chunk));
await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
const snap = JSON.parse(chunks.join(""));
const m = snap.snapshot.meta, F = m.node_fields.length, nf = m.node_fields;
const ti = nf.indexOf("type"), ni = nf.indexOf("name"), si = nf.indexOf("self_size");
const types = m.node_types[0];
const agg = new Map<string, [number, number]>();
let total = 0;
for (let i = 0; i < snap.nodes.length; i += F) {
  const t = types[snap.nodes[i + ti]], name = snap.strings[snap.nodes[i + ni]], sz = snap.nodes[i + si];
  total += sz;
  const key = t === "object" || t === "native" ? `${t}:${name}` : t;
  const a = agg.get(key) ?? [0, 0]; a[0] += sz; a[1]++; agg.set(key, a);
}
console.log("total MB", (total / 1e6).toFixed(1));
for (const [k, [s, c]] of [...agg].sort((a, b) => b[1][0] - a[1][0]).slice(0, 25)) console.log((s / 1e6).toFixed(2).padStart(7), String(c).padStart(8), k.slice(0, 90));
await browser.close();
