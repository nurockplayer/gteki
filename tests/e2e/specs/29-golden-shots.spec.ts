import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { ARTIFACTS, hooks, imageStats, openStation, type StationKey } from "../lib/gteki.ts";
import { evaluateCheck, flatRatio, type Metric } from "../lib/golden.ts";

test.use({ trace: "off", video: "off", screenshot: "off" });

type Camera = { id: string; station: StationKey; kind: string; node?: string; headingDeg?: number; expect: string; thresholds?: Partial<Record<Metric, number>>; known?: Partial<Record<Metric, string>> };
const config = JSON.parse(fs.readFileSync(new URL("../golden-cameras.json", import.meta.url), "utf8")) as {
  thresholds: Record<"voidRatio" | "flatRatio" | "nearBlack", number>;
  cameras: Camera[];
};

async function screenshotFlatRatio(page: Page, png: Buffer): Promise<number> {
  const rgba = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d")!; ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let binary = "";
    for (let i = 0; i < data.length; i += 32768) binary += String.fromCharCode(...data.subarray(i, i + 32768));
    return btoa(binary);
  }, png.toString("base64"));
  return flatRatio(Buffer.from(rgba, "base64"));
}

test("golden cameras: void, coverage and flat frames", async ({ page: initialPage, context }, testInfo) => {
  test.setTimeout(700_000);
  let page = initialPage;
  const filter = process.env.GTEKI_GOLDEN_STATION;
  if (filter && !["ikebukuro", "shinjuku"].includes(filter)) throw new Error(`Unknown golden station: ${filter}`);
  const out = path.join(ARTIFACTS, "golden", testInfo.project.name);
  fs.mkdirSync(out, { recursive: true });
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.env.GTEKI_ROOT, encoding: "utf8" }).trim();
  const rows: object[] = [], failures: string[] = [];
  let station: StationKey | undefined, tier = "", renderer: unknown = null;
  for (const camera of config.cameras.filter(c => !filter || c.station === filter)) {
    const started = Date.now();
    const phases = { place: 0, turn: 0, settle: 0, screenshot: 0, probe: 0 };
    let phaseStart = started;
    try {
      if (page.isClosed()) { page = await context.newPage(); station = undefined; }
      if (station !== camera.station) {
        await openStation(page, camera.station); station = camera.station;
        tier = await hooks.quality(page);
        renderer = await page.evaluate(() => (window as any).__qa?.gl ?? null);
      }
      phaseStart = Date.now();
      if (camera.kind === "node") {
        const result = await page.evaluate(({ node, headingDeg }) => (window as any).__gteki.setView({ node, headingDeg }), { node: camera.node!, headingDeg: camera.headingDeg! }) as { placed: boolean; placeMs: number; turnMs: number };
        phases.place = result.placeMs;
        phases.turn = result.turnMs;
        if (!result.placed) throw new Error(`setView ${camera.node} failed: node or walkable ground unavailable`);
      } else {
        if (await hooks.mode(page) !== "overview") {
          await page.locator(".hud").getByRole("button", { name: "Overview", exact: true }).click();
        }
        phases.place = Date.now() - phaseStart;
      }
      phaseStart = Date.now();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      phases.settle = Date.now() - phaseStart;
      phaseStart = Date.now();
      const png = await page.screenshot({ path: path.join(out, `${camera.id}.png`), timeout: 60_000 });
      phases.screenshot = Date.now() - phaseStart;
      phaseStart = Date.now();
      const probe = await page.evaluate((overview) => (window as any).__gteki.goldenProbe(overview), camera.kind === "overview") as { voidRatio: number; stationShare: number | null; renderMs: number[] };
      console.log(`[golden] ${camera.id}: probe render+read ms=${probe.renderMs.map(ms => ms.toFixed(1)).join(",")}`);
      phases.probe = Date.now() - phaseStart;
      const metrics = { voidRatio: probe.voidRatio, stationShare: probe.stationShare, flatRatio: await screenshotFlatRatio(page, png), nearBlack: (await imageStats(page, png)).nearBlack };
      const thresholds = camera.kind === "overview" ? camera.thresholds! : config.thresholds;
      const checks = (Object.entries(thresholds) as [Metric, number][]).map(([metric, threshold]) => evaluateCheck(metric, metrics[metric]!, threshold, camera.known));
      for (const c of checks) if (c.status === "fail") failures.push(`${camera.id}: ${c.metric}=${c.value} threshold=${c.threshold}`);
      rows.push({ ...camera, metrics, checks, status: checks.some(c => c.status === "fail") ? "fail" : checks.some(c => c.status === "known") ? "known" : "pass" });
    } catch (error) {
      failures.push(`${camera.id}: ${String(error)}`); rows.push({ ...camera, status: "fail", error: String(error) });
      console.error(`[golden] ${camera.id}: ${String(error)}`);
    }
    fs.writeFileSync(path.join(out, "golden.json"), JSON.stringify({ sha, project: testInfo.project.name, tier, renderer, cameras: rows }, null, 2));
    console.log(`[golden] ${camera.id}: total=${((Date.now() - started) / 1000).toFixed(1)}s ${Object.entries(phases).map(([name, ms]) => `${name}=${(ms / 1000).toFixed(2)}s`).join(" ")}`);
  }
  expect(failures, failures.join("\n")).toEqual([]);
});
