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

async function turn(page: Page, heading: number) {
  const point = await page.evaluate(() => {
    const c = document.querySelector("canvas.gteki-canvas")!.getBoundingClientRect();
    for (const [fx, fy] of [[0.5, 0.45], [0.7, 0.35], [0.3, 0.35], [0.6, 0.6], [0.85, 0.5]]) {
      const x = c.left + c.width * fx!, y = c.top + c.height * fy!;
      const el = document.elementFromPoint(x, y);
      if (el?.classList.contains("gteki-canvas") || el?.classList.contains("gteki-labels")) return { x, y, width: c.width };
    }
    return { x: c.left + c.width / 2, y: c.top + c.height / 2, width: c.width };
  });
  async function drag(dx: number) {
    const chunkMax = Math.max(20, Math.floor(point.width * 0.3));
    let sent = 0;
    while (Math.abs(dx - sent) >= 1) {
      const chunk = Math.max(-chunkMax, Math.min(chunkMax, Math.round(dx - sent)));
      await page.mouse.move(point.x, point.y); await page.mouse.down();
      await page.mouse.move(point.x + chunk, point.y, { steps: 3 }); await page.mouse.up();
      sent += chunk;
    }
  }
  const delta = Math.atan2(Math.sin(heading * Math.PI / 180), Math.cos(heading * Math.PI / 180));
  await drag(Math.round(delta / 0.0042));
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    await page.waitForTimeout(600);
    const dir = (await hooks.sceneInfo(page)).cameraDirection as number[];
    const facing = (Math.atan2(dir[0]!, -dir[2]!) * 180 / Math.PI + 360) % 360;
    const error = ((heading - facing + 540) % 360) - 180;
    if (Math.abs(error) < 3) return;
    if (i < 3) await drag(Math.round(error * Math.PI / 180 / 0.0042));
    else throw new Error(`heading ${heading} ended at ${facing.toFixed(1)}`);
  }
}

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

test("golden cameras: void, coverage and flat frames", async ({ page }, testInfo) => {
  test.setTimeout(840_000);
  const out = path.join(ARTIFACTS, "golden", testInfo.project.name);
  fs.mkdirSync(out, { recursive: true });
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.env.GTEKI_ROOT, encoding: "utf8" }).trim();
  const rows: object[] = [], failures: string[] = [];
  let station: StationKey | undefined, tier = "", renderer: unknown = null;
  for (const camera of config.cameras) {
    const started = Date.now();
    try {
      if (station !== camera.station) {
        await openStation(page, camera.station); station = camera.station;
        tier = await hooks.quality(page);
        renderer = await page.evaluate(() => (window as any).__qa?.gl ?? null);
      }
      if (camera.kind === "node") {
        if (!await hooks.walkFromNode(page, camera.node!)) throw new Error(`walkFromNode ${camera.node} failed`);
        await turn(page, camera.headingDeg!);
      } else {
        if (await hooks.mode(page) !== "overview") {
          await page.locator(".hud").getByRole("button", { name: "Overview", exact: true }).click();
        }
        await page.waitForTimeout(1500);
      }
      const png = await page.screenshot({ path: path.join(out, `${camera.id}.png`), timeout: 60_000 });
      const probe = await page.evaluate(() => (window as any).__gteki.goldenProbe()) as { voidRatio: number; stationShare: number };
      const metrics = { ...probe, flatRatio: await screenshotFlatRatio(page, png), nearBlack: (await imageStats(page, png)).nearBlack };
      const thresholds = camera.kind === "overview" ? camera.thresholds! : config.thresholds;
      const checks = (Object.entries(thresholds) as [Metric, number][]).map(([metric, threshold]) => evaluateCheck(metric, metrics[metric], threshold, camera.known));
      for (const c of checks) if (c.status === "fail") failures.push(`${camera.id}: ${c.metric}=${c.value} threshold=${c.threshold}`);
      rows.push({ ...camera, metrics, checks, status: checks.some(c => c.status === "fail") ? "fail" : checks.some(c => c.status === "known") ? "known" : "pass" });
    } catch (error) {
      failures.push(`${camera.id}: ${String(error)}`); rows.push({ ...camera, status: "fail", error: String(error) });
      console.error(`[golden] ${camera.id}: ${String(error)}`);
    }
    fs.writeFileSync(path.join(out, "golden.json"), JSON.stringify({ sha, project: testInfo.project.name, tier, renderer, cameras: rows }, null, 2));
    console.log(`[golden] ${camera.id}: ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  expect(failures, failures.join("\n")).toEqual([]);
});
