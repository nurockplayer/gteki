import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { hooks, openStation } from "../lib/gteki.ts";

/**
 * #221 reshoot: the 3 views the 2026-11-05 player-view pass left UNCERTAIN, re-taken from 2 m further back
 * so a wall at <1 m no longer fills the frame, at native viewport size (no downscale). Measurement only.
 * Skipped unless GTEKI_221_RESHOOT=1; needs a real GPU (orb-test --heavy --host).
 *
 *   GTEKI_221_RESHOOT=1 GTEKI_ROOT=<checkout> GTEKI_PORT=5772 GTEKI_221_RESHOOT_OUT=<dir> \
 *   pnpm exec playwright test specs/22-221-player-reshoot.spec.ts --project=desktop-chromium
 */
test.skip(!process.env.GTEKI_221_RESHOOT, "set GTEKI_221_RESHOOT=1 to run the #221 reshoot");
test.use({ trace: "off", video: "off", screenshot: "off" });

const VIEWS = [
  { floor: "m6", node: "n:34dc769bdb5b49d083a211ff541f435d", heading: 263 },
  { floor: "m1", node: "n:399c24bf916c45f197e22e812433aed9", heading: 330 },
  { floor: "m3", node: "n:e26f39c2df0f4f3b82b9163d2230d4c8", heading: 263 },
];
const BACK_M = 2;
const SETTLE_MS = 700;
const HEADING_TOL_DEG = 3;
const LOOK_RAD_PER_PX = 0.0042;

const pad3 = (n: number): string => String(n).padStart(3, "0");

async function cameraOf(page: Page): Promise<{ yaw: number; pitch: number }> {
  return page.evaluate(() => {
    const c = (window as any).__gteki.camera();
    return { yaw: c.yaw as number, pitch: c.pitch as number };
  });
}

async function headingOf(page: Page): Promise<number> {
  return Math.round(((-(await cameraOf(page)).yaw * 180) / Math.PI + 360) % 360);
}

async function eyeOf(page: Page): Promise<number[]> {
  const info = await hooks.sceneInfo(page);
  return (info as unknown as { camera: number[] }).camera;
}

async function drag(page: Page, at: { x: number; y: number }, dx: number): Promise<void> {
  const box = (await page.locator("canvas.gteki-canvas").boundingBox())!;
  const maxChunk = Math.max(20, Math.floor(box.width * 0.3));
  let sent = 0;
  while (Math.abs(dx - sent) >= 1) {
    const chunk = Math.max(-maxChunk, Math.min(maxChunk, Math.round(dx - sent)));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + chunk, at.y, { steps: 3 });
    await page.mouse.up();
    sent += chunk;
  }
}

async function canvasPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const c = document.querySelector("canvas.gteki-canvas")!.getBoundingClientRect();
    for (const [fx, fy] of [[0.5, 0.45], [0.7, 0.35], [0.3, 0.35], [0.6, 0.6]]) {
      const x = c.left + c.width * fx!, y = c.top + c.height * fy!;
      const el = document.elementFromPoint(x, y);
      if (el?.classList.contains("gteki-canvas") || el?.classList.contains("gteki-labels")) return { x, y };
    }
    return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
  });
}

/**
 * Hold S (walk backward) until the eye is BACK_M away horizontally, at most 4 s. One continuous hold: the
 * walker accelerates while the key is down, so 180 ms taps move only ~0.1 m each (measured 2026-11-05).
 */
async function stepBack(page: Page, start: number[]): Promise<number> {
  // Real key events do not reach the walker here: the last clicked HUD button keeps focus and the input guard
  // ignores walk keys aimed at it (2026-11-05: 6 runs, three of them with a canvas focus, all moved 0.5 m).
  // `simulate` drives the same step loop through the QA virtual keys, so the walk physics are unchanged.
  for (let i = 0; i < 16; i++) {
    const eye = await eyeOf(page);
    if (Math.hypot(eye[0]! - start[0]!, eye[2]! - start[2]!) >= BACK_M) break;
    await hooks.simulate(page, 0.25, ["KeyS"]);
  }
  await page.waitForTimeout(200);
  const eye = await eyeOf(page);
  return Math.round(Math.hypot(eye[0]! - start[0]!, eye[2]! - start[2]!) * 100) / 100;
}

test("shinjuku #221 reshoot: the 3 UNCERTAIN views from 2 m back @desktop", async ({ page }) => {
  test.setTimeout(900_000);
  const root = process.env.GTEKI_ROOT;
  if (!root) throw new Error("GTEKI_ROOT must point at the candidate checkout");
  const outDir = process.env.GTEKI_221_RESHOOT_OUT ?? path.join(root, ".qa", "221", "player-view", "shots-reshoot");
  fs.mkdirSync(outDir, { recursive: true });

  await openStation(page, "shinjuku");
  await expect.poll(() => hooks.quality(page)).toBe("high");
  expect(await hooks.walkFromNode(page, VIEWS[0]!.node), "walkFromNode(first view)").toBe(true);
  await expect.poll(() => hooks.mode(page)).toBe("walk");
  await page.getByRole("button", { name: /^(First person|一人称)$/ }).click();
  await page.waitForTimeout(SETTLE_MS);

  const rows: Record<string, unknown>[] = [];
  for (const [i, view] of VIEWS.entries()) {
    expect(await hooks.walkFromNode(page, view.node), `walkFromNode(${view.node})`).toBe(true);
    await expect.poll(() => hooks.mode(page)).toBe("walk");
    await page.waitForTimeout(SETTLE_MS);
    const at = await canvasPoint(page);
    let facing = await headingOf(page);
    for (let k = 0; k < 4; k++) {
      const err = ((view.heading - facing + 540) % 360) - 180;
      if (Math.abs(err) < HEADING_TOL_DEG) break;
      await drag(page, at, Math.round((err * Math.PI) / 180 / LOOK_RAD_PER_PX));
      await page.waitForTimeout(SETTLE_MS);
      facing = await headingOf(page);
    }
    const start = await eyeOf(page);
    const backM = await stepBack(page, start);
    await page.waitForTimeout(SETTLE_MS);
    const after = await headingOf(page);
    const diff = Math.abs(((after - view.heading + 540) % 360) - 180);
    const cam = await cameraOf(page);
    const eye = await eyeOf(page);
    const file = `${String(i).padStart(2, "0")}-${view.floor}-${view.node.slice(2, 10)}-h${pad3(view.heading)}-back${Math.round(backM)}.png`;
    await page.screenshot({ path: path.join(outDir, file) });
    rows.push({
      index: i, floor: view.floor, node: view.node, heading: view.heading, facing: after,
      headingOk: diff <= HEADING_TOL_DEG, backM, pitchDeg: Math.round((cam.pitch * 180) / Math.PI * 10) / 10,
      eyeBefore: start, eyeAfter: eye, file,
    });
  }
  fs.writeFileSync(path.join(outDir, "reshoot.json"), JSON.stringify({ views: rows }, null, 2) + "\n");
  expect(rows.filter((r) => r.headingOk === false).length, "views that lost their heading").toBe(0);
});
