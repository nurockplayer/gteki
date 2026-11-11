import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { hooks, openStation } from "../lib/gteki.ts";

test.use({ trace: "off", video: "off", screenshot: "off" });
const settle = async (page: Page) => { await page.waitForTimeout(700); };
const heading = async (page: Page) => page.evaluate(() => ((-(window as any).__gteki.camera().yaw * 180 / Math.PI) % 360 + 360) % 360);

async function turn(page: Page, target: number) {
  const started = Date.now();
  let iterations = 0, drags = 0;
  for (let i = 0; i < 4; i++) {
    const error = ((target - await heading(page) + 540) % 360) - 180;
    if (Math.abs(error) <= 3) break;
    iterations++;
    const box = (await page.locator("canvas.gteki-canvas").boundingBox())!;
    const at = await page.evaluate(() => {
      const c = document.querySelector("canvas.gteki-canvas")!.getBoundingClientRect();
      for (const [x, y] of [[0.5, 0.45], [0.7, 0.35], [0.3, 0.35], [0.6, 0.6]]) {
        const px = c.left + c.width * x!, py = c.top + c.height * y!;
        const el = document.elementFromPoint(px, py);
        if (el?.classList.contains("gteki-canvas") || el?.classList.contains("gteki-labels")) return { x: px, y: py };
      }
      return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
    });
    const dx = Math.round(error * Math.PI / 180 / 0.0042), chunkMax = Math.max(20, Math.floor(box.width * 0.3));
    let sent = 0;
    while (Math.abs(dx - sent) >= 1) {
      drags++;
      const chunk = Math.max(-chunkMax, Math.min(chunkMax, dx - sent));
      await page.mouse.move(at.x, at.y); await page.mouse.down();
      await page.mouse.move(at.x + chunk, at.y, { steps: 3 }); await page.mouse.up(); sent += chunk;
    }
    await settle(page);
  }
  return { measured: await heading(page), iterations, drags, ms: Date.now() - started };
}

const root = process.env.GTEKI_ROOT!;
const capture = JSON.parse(fs.readFileSync(path.join(root, ".qa/221/route-recheck/flights.json"), "utf8")) as {
  sha: string; routes: unknown[]; flights: { edgeId: string; routes: string[]; ends: { end: string; nodeId: string; floor: string; headings: { into: number; reverse: number } }[] }[];
};

for (const [flightIndex, flight] of capture.flights.entries()) {
  for (const [endIndex, end] of flight.ends.entries()) {
    test(`#221 flight ${flightIndex} ${end.end} @phone`, async ({ page }, info) => {
      test.setTimeout(240_000);
      const project = info.project.name === "desktop-chromium" ? "desktop" : info.project.name === "phone-chromium" ? "phone" : info.project.name;
      const resume = process.env.GTEKI_CAPTURE_RESUME === "1";
      const out = path.join(root, ".qa/221/route-recheck", capture.sha.slice(0, 7), project);
      fs.mkdirSync(out, { recursive: true });
      const manifestPath = path.join(out, "views.json");
      const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { sha: capture.sha, project: info.project.name, routes: capture.routes, flights: capture.flights, views: [] };
      const shots = (["into", "reverse"] as const).map((direction, i) => ({ direction, target: end.headings[direction], index: flightIndex * 4 + endIndex * 2 + i }));
      if (resume && shots.every(shot => fs.existsSync(path.join(out, `${String(shot.index).padStart(3, "0")}.jpg`)))) return;
      await openStation(page, "shinjuku");
      const quality = await hooks.quality(page);
      let started = Date.now();
      expect(await hooks.walkFromNode(page, end.nodeId), `walkFromNode(${end.nodeId})`).toBe(true);
      await expect.poll(() => hooks.mode(page)).toBe("walk");
      const walkFromNode = Date.now() - started;
      await page.getByRole("button", { name: /^(First person|一人称)$/ }).click();
      started = Date.now(); await settle(page); const settleMs = Date.now() - started;
      for (const shot of shots) {
        const file = `${String(shot.index).padStart(3, "0")}.jpg`;
        if (resume && fs.existsSync(path.join(out, file))) continue;
        const turnResult = await turn(page, shot.target);
        const missed = Math.abs(((turnResult.measured - shot.target + 540) % 360) - 180) > 5;
        started = Date.now();
        await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 85, scale: "css" });
        const screenshot = Date.now() - started;
        if (project === "desktop") execFileSync("sips", ["--resampleWidth", "1024", "-s", "formatOptions", "85", path.join(out, file)], { stdio: "ignore" });
        const row = { index: shot.index, project: info.project.name, quality, sha: capture.sha, edgeId: flight.edgeId, routes: flight.routes, end: end.end, nodeId: end.nodeId, floor: end.floor, direction: shot.direction, requestedHeading: shot.target, measuredHeading: turnResult.measured, missed, position: await hooks.avatar(page), file, timings: { walkFromNode, settle: settleMs, turn: { iterations: turnResult.iterations, drags: turnResult.drags, ms: turnResult.ms }, screenshot } };
        manifest.views = manifest.views.filter((view: { index: number }) => view.index !== shot.index);
        manifest.views.push(row);
        manifest.views.sort((a: { index: number }, b: { index: number }) => a.index - b.index);
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      }
    });
  }
}
