import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ARTIFACTS, hooks, openStation } from "../lib/gteki.ts";

/**
 * Vertical-transport before/after probe (Golden Slice, docs/visual/vertical-gap.md). Fixed spots at Shinjuku's
 * m1-m3 escalator bank (edges e1fa65, 2692fe, fd3365: both guided walks ride it) and the Exit 1 stair flights:
 * the walker spawns at a graph node, the follow camera is pinned with setCamera (yaw 0 = -Z, radians), and each spot
 * records a screenshot, draws and triangles per frame (p50 at the WebGL boundary, every pass included, as in spec 13)
 * and frame intervals. Then a play-view walk: down escalator e1fa65 (m1 head to m3 foot) and up 2692fe, with a
 * shot at each quarter and the avatar height recorded, so a walk/collision regression shows as a stuck or a height
 * jump. Evidence, not a golden: compare two runs (before/after) side by side.
 *
 * Not in CI; skipped unless GTEKI_VERTICAL=1. Needs a real GPU (run through `orb-test --heavy --host`), against a
 * built checkout (GTEKI_ROOT, `pnpm build` first). From tests/e2e:
 *   GTEKI_VERTICAL=1 GTEKI_ROOT=<checkout> GTEKI_VERTICAL_LABEL=before pnpm exec playwright test specs/21-vertical-shots.spec.ts --project=desktop-chromium --project=phone-chromium
 * Desktop runs at 1280x800 (high tier), phone at 390x844 (Pixel 7, low tier).
 * Output: <GTEKI_VERTICAL_OUT or artifacts/vertical>/<label>/<project>/<spot>.png and vertical.json.
 */
test.skip(!process.env.GTEKI_VERTICAL, "set GTEKI_VERTICAL=1 to run the vertical-transport probe");
test.use({ trace: "off", video: "off", screenshot: "off" });

const LABEL = process.env.GTEKI_VERTICAL_LABEL ?? "run";
const OUT = process.env.GTEKI_VERTICAL_OUT ?? path.join(ARTIFACTS, "vertical");
const SETTLE_MS = 1500;

// Nodes from stations/shinjuku/gteki/graph.json. Escalator e1fa65 runs from the m1 head (renderer -19.81,-7.8,-175.47)
// down to the m3 foot (-48.21,-23.74,-165.23); up the bank is yaw about -1.22.
const HEAD = "n:e4365ef27b14448eb770343c8a024f80";
const FOOT = "n:ea71c5f746934d0a934c43782d861da5";
// The bank's up escalator 2692fe: m3 foot (-47.62,-23.74,-163.74) to m1 head (-19.29,-7.8,-174.02).
const UP_FOOT = "n:5d2a3fac668d4a068a98e0b9e3aeaf5d";
const UP_HEAD = "n:57e00b46b8804e7f95bd92ba9a20fb7b";
const STAIR_FOOT = "n:04f621ba"; // prefix, resolved below: Exit 1 stair flight 03bd24, foot on m1
const spots = [
  { id: "bank-foot", node: FOOT, yaw: -0.75, pitch: 0.18, distance: 6 },
  { id: "bank-foot-close", node: FOOT, yaw: -1.22, pitch: 0.1, distance: 3 },
  { id: "bank-head", node: HEAD, yaw: 1.92 - 0.45, pitch: -0.3, distance: 5 },
  { id: "stair-foot", node: STAIR_FOOT, yaw: 0.35, pitch: 0.2, distance: 5 },
];

const GL_PROBE = `(() => {
  const st = { draws: [], tris: [], curD: 0, curT: 0 };
  window.__vt = st;
  const T = (m, n) => (m === 4 ? Math.floor(n / 3) : m === 5 || m === 6 ? Math.max(0, n - 2) : 0);
  const wrap = (C) => {
    if (!C) return;
    const w = (fn, f) => { const o = C.prototype[fn]; if (o) C.prototype[fn] = function (...a) { st.curD++; st.curT += f(...a); return o.apply(this, a); }; };
    w("drawElements", (m, c) => T(m, c)); w("drawArrays", (m, f, c) => T(m, c));
    w("drawElementsInstanced", (m, c, t, o, i) => T(m, c) * i); w("drawArraysInstanced", (m, f, c, i) => T(m, c) * i);
  };
  wrap(self.WebGL2RenderingContext); wrap(self.WebGLRenderingContext);
  const loop = () => { if (st.curD > 0) { st.draws.push(st.curD); st.tris.push(st.curT); } st.curD = 0; st.curT = 0; if (st.draws.length > 4000) { st.draws.splice(0, 2000); st.tris.splice(0, 2000); } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();`;

const p50 = (a: number[]): number | null => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : null);

/** Draws/triangles p50 over 20 frames, then frame intervals over 2 s (p50/p95 ms). */
async function measure(page: Page) {
  await page.evaluate(() => { const s = (window as any).__vt; s.draws.length = 0; s.tris.length = 0; });
  await page.waitForFunction(() => (window as any).__vt.draws.length >= 20, null, { timeout: 30_000 });
  const gl = await page.evaluate(() => { const s = (window as any).__vt; return { draws: s.draws.slice(0, 20), tris: s.tris.slice(0, 20) }; });
  const gaps: number[] = await page.evaluate(() => new Promise<number[]>((done) => {
    const out: number[] = []; let last = performance.now(); const end = last + 2000;
    const f = (t: number) => { out.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else done(out.slice(1)); };
    requestAnimationFrame(f);
  }));
  const sorted = [...gaps].sort((a, b) => a - b);
  return { draws: p50(gl.draws), tris: p50(gl.tris), frameMsP50: p50(gaps), frameMsP95: sorted[Math.floor(sorted.length * 0.95)] ?? null, visible: await page.evaluate(() => document.visibilityState) };
}

test("shinjuku vertical transport: fixed spots and escalator walk @phone", async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const phone = testInfo.project.name.startsWith("phone");
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1280, height: 800 });
  await page.addInitScript(GL_PROBE);
  const { loadMs } = await openStation(page, "shinjuku");
  const dir = path.join(OUT, LABEL, testInfo.project.name);
  fs.mkdirSync(dir, { recursive: true });
  const nodes: string[] = JSON.parse(fs.readFileSync(path.join(process.env.GTEKI_ROOT ?? "../..", "stations/shinjuku/gteki/graph.json"), "utf8")).nodes.map((n: { id: string }) => n.id);
  const resolve = (id: string) => nodes.find((n) => n === id || n.startsWith(id)) ?? id;
  const report: Record<string, unknown> = { label: LABEL, project: testInfo.project.name, loadMs, quality: await hooks.quality(page), sceneInfo: await hooks.sceneInfo(page), spots: [], walk: [] };

  const shoot = async (name: string) => {
    await page.waitForTimeout(SETTLE_MS);
    const m = await measure(page);
    await page.screenshot({ path: path.join(dir, `${name}.png`) });
    return { name, ...m, avatar: await hooks.avatar(page) };
  };

  for (const s of spots) {
    const ok = await hooks.walkFromNode(page, resolve(s.node));
    await page.evaluate((c) => (window as any).__gteki.setCamera(c), { yaw: s.yaw, pitch: s.pitch, distance: s.distance });
    (report.spots as unknown[]).push({ ...s, spawned: ok, ...(await shoot(s.id)) });
  }

  // Play view: the follow camera trails the walker down e1fa65 and up 2692fe (camera released, as a player sees it).
  await page.evaluate(() => (window as any).__gteki.setCamera(null));
  const at = async (node: string) => { await hooks.walkFromNode(page, node); return hooks.avatar(page); };
  const legs = [["down", HEAD, FOOT], ["up", UP_FOOT, UP_HEAD]] as const;
  for (const [leg, from, to] of legs) {
    const b = await at(to);
    const a = await at(from);
    for (const q of [0.25, 0.5, 0.75, 1]) {
      // Avatar ENU (x east, y north, z up) -> renderer (x, z = -north); walkPath takes renderer x/z.
      const target = { x: a.x + (b.x - a.x) * q, z: -(a.y + (b.y - a.y) * q) };
      const r = await page.evaluate((p) => (window as any).__gteki.walkPath([p], { maxSeconds: 30 }), target);
      (report.walk as unknown[]).push({ leg, q, result: r, ...(await shoot(`walk-${leg}-${q * 100}`)) });
      expect.soft(r.done && !r.stuck, `${leg} walk reaches ${q * 100}% without getting stuck`).toBe(true);
    }
  }
  fs.writeFileSync(path.join(dir, "vertical.json"), JSON.stringify(report, null, 2));
});
