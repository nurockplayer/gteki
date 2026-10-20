/**
 * QA screenshot harness for the E27 lane app.
 *
 *   pnpm --filter @gteki/station-shinjuku shoot [--url http://localhost:5274] [--out dir] [--only id,id] [--w 1280 --h 720] [--q high|low] [--crowd N] [--route fromPoiId,toPoiId] [--ride-distance 4] [--check-ui 1] [--vantages file.json] [--timings 1] [--virtual-clock 1]
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
const rideDistance = Number(arg("ride-distance", "0"));
const virtualClock = arg("virtual-clock", "0") === "1";
const collectTimings = arg("timings", "0") === "1";
const checkUI = arg("check-ui", "0") === "1";
const uiChecks: string[] = [];
const routePair = arg("route")?.split(",");
if (routePair && (routePair.length !== 2 || routePair.some((id) => !id))) throw new Error("--route requires fromPoiId,toPoiId");
const { vantages } = JSON.parse(readFileSync(resolve(arg("vantages", join(here, "vantages.json"))!), "utf8")) as { vantages: Vantage[] };

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const errors: string[] = [];
const benignErrors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  // A missing browser favicon is cosmetic; retain it in the report without failing QA.
  // Other resource failures and all JS exceptions remain fatal.
  const favicon404 = /\/favicon\.ico(?:\?|$)/.test(m.location().url) && /404/.test(m.text());
  (favicon404 ? benignErrors : errors).push(m.text());
});
const report: Record<string, unknown>[] = [];
let startupTimings: Record<string, unknown> | undefined;
try {
  if (virtualClock) await page.addInitScript(() => {
    let time = 0, id = 0;
    let queue: FrameRequestCallback[] = [];
    performance.now = () => time;
    window.requestAnimationFrame = (callback) => (queue.push(callback), ++id);
    window.cancelAnimationFrame = () => {};
    (window as any).__tick = (ms: number) => {
      time += ms;
      const pending = queue; queue = [];
      for (const callback of pending) callback(time);
    };
  });
  await page.goto(`${url}/?q=${q}&crowd=${crowd}${hud === "0" ? "&hud=0" : ""}`, { waitUntil: virtualClock ? "commit" : "load" });
  if (virtualClock) {
    await page.waitForFunction(() => typeof (window as any).__tick === "function", null, { polling: 50, timeout: 60_000 });
    const deadline = Date.now() + 60_000;
    while (true) {
      const ready = await page.evaluate(() => { (window as any).__tick(1000 / 30); return !!(window as any).__gteki; });
      if (ready) break;
      if (Date.now() > deadline) throw new Error("Virtual-clock startup did not finish");
      await page.waitForTimeout(10);
    }
  }
  await page.waitForFunction(() => !!(window as unknown as { __gteki?: unknown }).__gteki, null, { timeout: 60_000 });
  if (collectTimings) await page.waitForFunction(() => (window as any).__gteki.timings?.().timeToInteractiveMs != null, null, { timeout: 60_000 });
  startupTimings = collectTimings ? await page.evaluate(() => ({
    ...(window as any).__gteki.timings(),
    heapUsedMB: (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1048576 * 10) / 10 : null,
  })) : undefined;
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
  if (routePair) {
    const [from, to] = routePair;
    const result = await page.evaluate(({ from, to }) => {
      const g = (window as any).__gteki;
      g.view(null);
      return g.routeTo(to, from);
    }, { from, to });
    if (typeof result === "string") throw new Error(`Route failed: ${result}`);
    const stages = rideDistance > 0 ? ["preview", "stairs", "stairs-mid", "arrival"] as const : ["preview", "stairs", "arrival"] as const;
    for (const stage of stages) {
      const r = await page.evaluate(({ stage, rideDistance }) => {
        const g = (window as any).__gteki;
        let capture: unknown = { ok: true };
        if (stage === "stairs") { g.guide(); capture = g.walkUntil("stairs"); }
        if (stage === "stairs-mid") capture = g.walkUntil("stairs", 600, rideDistance);
        if (stage === "arrival") capture = g.walkUntil("arrival");
        g.advance(0, 1);
        const ids = ["next", "panel", "stick", "btn-run", "journey-evidence", "evidence-detail", "floor-toast", "minimap", "hud-top", "foot", "destination-label", "maneuver-anchor"];
        const boxes = ids.flatMap((id) => {
          const el = document.getElementById(id)!;
          const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
          return style.display === "none" || style.visibility === "hidden" || !rect.width || !rect.height ? [] : [{ id, x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom }];
        });
        const overlaps = boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => (a.id.endsWith("label") || b.id.endsWith("label") || a.id === "maneuver-anchor" || b.id === "maneuver-anchor" || [a.id, b.id].every((id) => ["next", "panel", "stick", "btn-run"].includes(id))) && a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y).map((b) => `${a.id}/${b.id}`));
        return { ...g.state(), capture, overlaps, projectedLabels: boxes.filter((box) => box.id === "destination-label" || box.id === "maneuver-anchor"), voidFraction: g.voidFraction() };
      }, { stage, rideDistance });
      await page.screenshot({ path: join(out, `route-${stage}.png`) });
      report.push({ id: `route-${stage}`, ...r });
      if (!r.capture?.ok) errors.push(`route-${stage}: ${JSON.stringify(r.capture)}`);
      if ((stage === "stairs" || stage === "stairs-mid") && (!r.avatarVisible || r.cameraDistance < 1.6)) errors.push(`route-${stage}: rider/camera framing failed`);
      if (r.overlaps.length) errors.push(`route-${stage} overlapping controls: ${r.overlaps.join(", ")}`);
      console.log(`route-${stage}`, JSON.stringify(r));
      if (checkUI && stage === "stairs") {
        for (const speed of [2, 4, 1]) {
          await page.locator("#guide-speed").click();
          const actual = await page.evaluate(() => (window as any).__gteki.state().guideSpeed);
          if (actual !== speed) throw new Error(`Guide speed expected ${speed}, got ${actual}`);
        }
        await page.locator("#evidence-toggle").focus();
        await page.keyboard.press("Enter");
        if (await page.locator("#evidence-disclosure").getAttribute("open") === null) throw new Error("Evidence disclosure did not open with Enter");
        const detail = await page.locator("#evidence-detail").textContent();
        if (!detail?.includes("Hours unverified") || !detail.includes("Heights estimated")) throw new Error("Evidence detail lost unknowns");
        const labelsClear = await page.evaluate(() => {
          (window as any).__gteki.advance(0, 1);
          const obstacles = ["next", "journey-evidence", "evidence-detail", "minimap"].map((id) => document.getElementById(id)!.getBoundingClientRect());
          return ["destination-label", "maneuver-anchor"].every((id) => {
            const el = document.getElementById(id)!, rect = el.getBoundingClientRect();
            return getComputedStyle(el).display === "none" || !obstacles.some((r) => rect.x < r.right && rect.right > r.x && rect.y < r.bottom && rect.bottom > r.y);
          });
        });
        if (!labelsClear) throw new Error("Expanded evidence overlaps projected guidance");
        await page.keyboard.press("Enter");
        uiChecks.push("expanded evidence avoids projected labels");
        uiChecks.push("guide speed cycles 1/2/4; keyboard evidence disclosure retains hours and heights");
      }
    }
  }
  if (checkUI) {
    await page.evaluate(() => {
      const g = (window as any).__gteki;
      g.routeTo("poi:exit:1", "poi:platform:oedo");
      g.panel(true, true);
    });
    await page.locator("#stepfree").check();
    const refusal = await page.locator("#route-error").textContent();
    if (!refusal?.includes("uses stairs")) throw new Error(`Missing step-free reason: ${refusal}`);
    await page.screenshot({ path: join(out, "stepfree-refusal.png") });
    await page.locator("#route-error .alternative").click();
    const alternative = await page.evaluate(() => (window as any).__gteki.state());
    if (!alternative.stepFree || alternative.destination !== "poi:exit:3" || alternative.journey !== "preview") throw new Error(`Step-free alternative failed: ${JSON.stringify(alternative)}`);
    await page.screenshot({ path: join(out, "stepfree-alternative.png") });
    uiChecks.push("step-free refusal explains stairs; one-tap exit 3 retains step-free profile");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => (window as any).__gteki.state().reducedMotion, null, { polling: 50 });
    if (await page.locator("#btn-bob").getAttribute("aria-pressed") !== "false") throw new Error("Reduced motion did not disable bob");
    await page.locator("#view").focus();
    await page.keyboard.press("v");
    const firstPerson = await page.evaluate(() => { const g = (window as any).__gteki; g.advance(0, 1); return g.state(); });
    if (firstPerson.avatarVisible) throw new Error("V did not hide the first-person avatar");
    await page.keyboard.press("v");
    uiChecks.push("reduced motion disables bob; V toggles first person");
  }
} catch (error) {
  errors.push(String(error));
  throw error;
} finally {
  writeFileSync(join(out, "report.json"), JSON.stringify({ url, w, h, q, crowd, errors, benignErrors, uiChecks, virtualClock, ...(collectTimings ? { timings: startupTimings ?? null } : {}), shots: report }, null, 2));
  if (errors.length) console.error("page errors:", errors);
  await browser.close();
}
if (errors.length) process.exitCode = 1;
