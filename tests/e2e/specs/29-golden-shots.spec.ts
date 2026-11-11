import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { ARTIFACTS, hooks, imageStats, openStation, type StationKey } from "../lib/gteki.ts";
import { evaluateCheck, flatRatio, type Metric } from "../lib/golden.ts";

test.use({ trace: "off", video: "off", screenshot: "off" });

type Feature = { name: string; match: { namePrefix?: string; contains?: string; role?: string; withinM?: number }; minPixels: number };
type Camera = { features?: Feature[]; id: string; station: StationKey; kind: string; knownIssue?: number; node?: string; headingDeg?: number; expect: string; thresholds?: Partial<Record<Metric, number>>; known?: Partial<Record<Metric, string>> };
const config = JSON.parse(fs.readFileSync(new URL("../golden-cameras.json", import.meta.url), "utf8")) as {
  thresholds: Record<"voidRatio" | "flatRatio" | "nearBlack", number>;
  cameras: Camera[];
};

async function screenshotFlatRatio(page: Page, png: Buffer): Promise<{ value: number; ms: number }> {
  const decoded = await page.evaluate(async (b64) => {
    const started = performance.now();
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d")!; ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let binary = "";
    for (let i = 0; i < data.length; i += 32768) binary += String.fromCharCode(...data.subarray(i, i + 32768));
    return { rgba: btoa(binary), ms: performance.now() - started };
  }, png.toString("base64"));
  return { value: flatRatio(Buffer.from(decoded.rgba, "base64")), ms: decoded.ms };
}

test("golden cameras: void, coverage and flat frames", async ({ page: initialPage, context }, testInfo) => {
  test.setTimeout(700_000);
  let page = initialPage;
  const filter = process.env.GTEKI_GOLDEN_STATION;
  if (filter && !["ikebukuro", "shinjuku"].includes(filter)) throw new Error(`Unknown golden station: ${filter}`);
  const out = path.join(ARTIFACTS, "golden", testInfo.project.name);
  fs.mkdirSync(out, { recursive: true });
  let sha: string;
  try {
    sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.env.GTEKI_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    sha = process.env.GITHUB_SHA || process.env.GTEKI_SHA || "unknown";
  }
  const rows: object[] = [], failures: string[] = [];
  let station: StationKey | undefined, tier = "", renderer: unknown = null;
  for (const camera of config.cameras.filter(c => !filter || c.station === filter)) {
    const started = Date.now();
    const phases = { setup: 0, hold: 0, place: 0, frame: 0, screenshotBefore: 0, screenshot: 0, screenshotAfter: 0, probe: 0, flat: 0, image: 0, release: 0 };
    const diagnostics: Record<string, unknown> = {};
    let held = false;
    let phaseStart = started;
    try {
      if (page.isClosed()) { page = await context.newPage(); station = undefined; }
      if (station !== camera.station) {
        await openStation(page, camera.station); station = camera.station;
        tier = await hooks.quality(page);
        renderer = await page.evaluate(() => (window as any).__qa?.gl ?? null);
      }
      phases.setup = Date.now() - phaseStart;
      phaseStart = Date.now();
      await page.evaluate(() => (window as any).__gteki.holdFrames(true));
      held = true;
      phases.hold = Date.now() - phaseStart;
      phaseStart = Date.now();
      if (camera.kind === "node") {
        const result = await page.evaluate(({ node, headingDeg }) => (window as any).__gteki.setView({ node, headingDeg }), { node: camera.node!, headingDeg: camera.headingDeg! }) as { placed: boolean; placeMs: number; turnMs: number };
        diagnostics.placement = result;
        if (!result.placed) throw new Error(`setView ${camera.node} failed: node or walkable ground unavailable`);
      } else {
        if (await hooks.mode(page) !== "overview") {
          await page.locator(".hud").getByRole("button", { name: "Overview", exact: true }).click();
        }
      }
      phases.place = Date.now() - phaseStart;
      phaseStart = Date.now();
      diagnostics.frame = await page.evaluate(() => (window as any).__gteki.goldenFrame());
      phases.frame = Date.now() - phaseStart;
      phaseStart = Date.now();
      diagnostics.screenshotBefore = await page.evaluate(() => (window as any).__gteki.goldenRenderState());
      phases.screenshotBefore = Date.now() - phaseStart;
      phaseStart = Date.now();
      const png = await page.screenshot({ path: path.join(out, `${camera.id}.png`), timeout: 60_000 });
      phases.screenshot = Date.now() - phaseStart;
      phaseStart = Date.now();
      diagnostics.screenshotAfter = await page.evaluate(() => (window as any).__gteki.goldenRenderState());
      phases.screenshotAfter = Date.now() - phaseStart;
      phaseStart = Date.now();
      const probe = await page.evaluate(({ overview, features }) => (window as any).__gteki.goldenProbe(overview, features), { overview: camera.kind === "overview", features: camera.features }) as { voidRatio: number; stationShare: number | null; features: { name: string; pixels: number; meshes: number }[]; renders: unknown[] };
      diagnostics.probe = probe.renders;
      phases.probe = Date.now() - phaseStart;
      phaseStart = Date.now();
      const flat = await screenshotFlatRatio(page, png);
      phases.flat = Date.now() - phaseStart;
      diagnostics.flatInPageMs = flat.ms;
      phaseStart = Date.now();
      const image = await imageStats(page, png);
      phases.image = Date.now() - phaseStart;
      diagnostics.imageInPageMs = image.ms;
      const metrics: Record<string, number | null> = { voidRatio: probe.voidRatio, stationShare: probe.stationShare, flatRatio: flat.value, nearBlack: image.nearBlack };
      const thresholds = camera.kind === "overview" ? camera.thresholds! : config.thresholds;
      const checks = (Object.entries(thresholds) as [Metric, number][]).map(([metric, threshold]) => evaluateCheck(metric, metrics[metric]!, threshold, camera.known));
      for (const feature of camera.features ?? []) {
        const result = probe.features.find(f => f.name === feature.name)!;
        const check = evaluateCheck(`feature:${feature.name}`, result.pixels, feature.minPixels, camera.known);
        if (!result.meshes) { check.status = "fail"; if (!camera.knownIssue) failures.push(`${camera.id}: feature not found: ${feature.name}`); }
        checks.push(check);
      }
      diagnostics.features = probe.features;
      const failedChecks = checks.filter(c => c.status === "fail");
      if (camera.knownIssue) {
        console.log(`[golden] ${camera.id}: KNOWN #${camera.knownIssue}${failedChecks.length ? "" : " now passes, remove the entry"}`);
      } else {
        for (const c of failedChecks) failures.push(`${camera.id}: ${c.metric}=${c.value} threshold=${c.threshold}`);
      }
      rows.push({ ...camera, phases, diagnostics, metrics, checks, status: camera.knownIssue ? "known" : failedChecks.length ? "fail" : checks.some(c => c.status === "known") ? "known" : "pass" });
    } catch (error) {
      failures.push(`${camera.id}: ${String(error)}`); rows.push({ ...camera, phases, diagnostics, status: "fail", error: String(error) });
      console.error(`[golden] ${camera.id}: ${String(error)}`);
    } finally {
      if (held && !page.isClosed()) {
        phaseStart = Date.now();
        await page.evaluate(() => (window as any).__gteki.holdFrames(false));
        phases.release = Date.now() - phaseStart;
      }
    }
    fs.writeFileSync(path.join(out, "golden.json"), JSON.stringify({ sha, project: testInfo.project.name, tier, renderer, cameras: rows }, null, 2));
    console.log(`[golden] ${camera.id}: diagnostics=${JSON.stringify(diagnostics)}`);
    console.log(`[golden] ${camera.id}: total=${((Date.now() - started) / 1000).toFixed(1)}s ${Object.entries(phases).map(([name, ms]) => `${name}=${(ms / 1000).toFixed(2)}s`).join(" ")}`);
  }
  expect(failures, failures.join("\n")).toEqual([]);
});

 test("hidden sign fails its feature check", async ({ page }) => {
  test.skip(process.env.GTEKI_GOLDEN_STATION === "ikebukuro", "Shinjuku fault test");
  const camera = config.cameras.find(c => c.id === "sj-sign-1ecbdf77")!;
  await openStation(page, "shinjuku");
  await page.evaluate(() => (window as any).__gteki.holdFrames(true));
  try {
    await page.evaluate(({ node, headingDeg }) => (window as any).__gteki.setView({ node, headingDeg }), camera);
    await page.evaluate(() => (window as any).__gteki.goldenFrame());
    const result = await page.evaluate((features) => (window as any).__gteki.goldenProbe(false, features, { hideBeforeShown: ["sign 1ecbdf77"] }), camera.features) as { features: { pixels: number; meshes: number }[] };
    expect(result.features[0]!.meshes).toBeGreaterThan(0);
    expect(evaluateCheck("feature:sign 1ecbdf77", result.features[0]!.pixels, camera.features![0]!.minPixels).status).toBe("fail");
  } finally { await page.evaluate(() => (window as any).__gteki.holdFrames(false)); }
});
