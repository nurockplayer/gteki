import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { hooks, openStation } from "../lib/gteki.ts";

/**
 * #221 player-view re-check: the 16 first-person views (5 Shinjuku stair-end nodes, the 13 headings the
 * 2026-11-03 report called broken plus 3 controls) shot in the real app, first person, standing at eye height
 * on the walkable mesh. Measurement and evidence only: nothing is compared against a baseline and no product
 * geometry is touched. Skipped unless GTEKI_221_PLAYER_VIEW=1; needs a real GPU (run under `orb-test --heavy
 * --host` on the dev Mac, against a built checkout, one pass at a time).
 *
 *   GTEKI_221_PLAYER_VIEW=1 GTEKI_ROOT=<checkout> GTEKI_PORT=5771 \
 *   GTEKI_221_OUT=<dir> pnpm exec playwright test specs/22-221-player-view.spec.ts --project=desktop-chromium
 *
 * Output: <out>/<nn>-<floor>-<node8>-h<heading>.png per view (full viewport, downscaled after the run) and
 * <out>/views.json with the requested heading, the camera's measured heading, the standing position and the
 * scene's street state, so a view that missed its heading cannot pass as evidence.
 */
test.skip(!process.env.GTEKI_221_PLAYER_VIEW, "set GTEKI_221_PLAYER_VIEW=1 to run the #221 player-view probe");
test.use({ trace: "off", video: "off", screenshot: "off" });

/** The 13 headings the 2026-11-03 first-person report called broken, plus the 3 controls of the same grids. */
const VIEWS = [
  { floor: "m6", node: "n:34dc769bdb5b49d083a211ff541f435d", heading: 353, reported: true },
  { floor: "m6", node: "n:34dc769bdb5b49d083a211ff541f435d", heading: 83, reported: false },
  { floor: "m6", node: "n:34dc769bdb5b49d083a211ff541f435d", heading: 173, reported: false },
  { floor: "m6", node: "n:34dc769bdb5b49d083a211ff541f435d", heading: 263, reported: false },
  { floor: "m1", node: "n:399c24bf916c45f197e22e812433aed9", heading: 150, reported: true },
  { floor: "m1", node: "n:399c24bf916c45f197e22e812433aed9", heading: 240, reported: true },
  { floor: "m1", node: "n:399c24bf916c45f197e22e812433aed9", heading: 330, reported: true },
  { floor: "m2_5", node: "n:3d154fc290ac43c992ec8de105c82997", heading: 71, reported: true },
  { floor: "m2_5", node: "n:3d154fc290ac43c992ec8de105c82997", heading: 341, reported: true },
  { floor: "m3", node: "n:e26f39c2df0f4f3b82b9163d2230d4c8", heading: 83, reported: true },
  { floor: "m3", node: "n:e26f39c2df0f4f3b82b9163d2230d4c8", heading: 263, reported: true },
  { floor: "m3", node: "n:e26f39c2df0f4f3b82b9163d2230d4c8", heading: 353, reported: true },
  { floor: "m1", node: "n:fb5671d1edba4c91ad50438c830827a9", heading: 68, reported: true },
  { floor: "m1", node: "n:fb5671d1edba4c91ad50438c830827a9", heading: 158, reported: true },
  { floor: "m1", node: "n:fb5671d1edba4c91ad50438c830827a9", heading: 248, reported: true },
  { floor: "m1", node: "n:fb5671d1edba4c91ad50438c830827a9", heading: 338, reported: true },
];
const SETTLE_MS = Number(process.env.GTEKI_221_SETTLE_MS ?? 700);
const HEADING_TOL_DEG = 3;
const LOOK_RAD_PER_PX = 0.0042;

const pad3 = (n: number): string => String(n).padStart(3, "0");
const wrapRad = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Camera heading, compass degrees (0 = north, 90 = east). First person: view dir = (-sin yaw, sin pitch, -cos yaw). */
async function cameraOf(page: Page): Promise<{ yaw: number; pitch: number }> {
  return page.evaluate(() => {
    const c = (window as any).__gteki.camera();
    return { yaw: c.yaw as number, pitch: c.pitch as number };
  });
}

async function headingOf(page: Page): Promise<number> {
  return Math.round(((-(await cameraOf(page)).yaw * 180) / Math.PI + 360) % 360);
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

test("shinjuku #221 player views: eye-height first person at the 5 stair ends @desktop", async ({ page }, testInfo) => {
  test.setTimeout(900_000);
  const root = process.env.GTEKI_ROOT;
  if (!root) throw new Error("GTEKI_ROOT must point at the candidate checkout");
  const outDir = process.env.GTEKI_221_OUT ?? path.join(root, ".qa", "221", "player-view", "shots");
  fs.mkdirSync(outDir, { recursive: true });

  await openStation(page, "shinjuku");
  await expect.poll(() => hooks.quality(page)).toBe("high");
  // The station opens in overview; the first walk to a node is what enters walk mode.
  expect(await hooks.walkFromNode(page, VIEWS[0]!.node), "walkFromNode(first view)").toBe(true);
  await expect.poll(() => hooks.mode(page)).toBe("walk");
  // First person: the camera sits at the walker's eye point (explorer.placeCamera), the avatar is hidden.
  await page.getByRole("button", { name: /^(First person|一人称)$/ }).click();
  await page.waitForTimeout(SETTLE_MS);

  const rows: Record<string, unknown>[] = [];
  for (const [i, view] of VIEWS.entries()) {
    const ok = await hooks.walkFromNode(page, view.node);
    expect(ok, `walkFromNode(${view.node})`).toBe(true);
    await expect.poll(() => hooks.mode(page)).toBe("walk");
    await page.waitForTimeout(SETTLE_MS);
    const at = await canvasPoint(page);
    let facing = await headingOf(page);
    for (let k = 0; k < 4; k++) {
      const err = ((view.heading - facing + 540) % 360) - 180;
      if (Math.abs(err) < HEADING_TOL_DEG) break;
      await drag(page, at, Math.round((err * Math.PI) / 180 / LOOK_RAD_PER_PX));
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      await page.waitForTimeout(SETTLE_MS);
      facing = await headingOf(page);
    }
    const diff = Math.abs(((facing - view.heading + 540) % 360) - 180);
    if (diff > HEADING_TOL_DEG) console.warn(`player-view: ${view.floor} ${view.heading} ends facing ${facing}`);
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const info = await hooks.sceneInfo(page);
    const cam = await cameraOf(page);
    const file = `${String(i).padStart(2, "0")}-${view.floor}-${view.node.slice(2, 10)}-h${pad3(view.heading)}.png`;
    await page.screenshot({ path: path.join(outDir, file) });
    rows.push({
      index: i, floor: view.floor, node: view.node, reported: view.reported, heading: view.heading, facing,
      headingOk: diff <= HEADING_TOL_DEG, pitchDeg: Math.round((cam.pitch * 180) / Math.PI * 10) / 10,
      camera: (info as unknown as { camera: number[] }).camera, street: (info as unknown as { street: unknown }).street, file,
      project: testInfo.project.name,
    });
  }
  fs.writeFileSync(path.join(outDir, "views.json"), JSON.stringify({ views: rows }, null, 2) + "\n");
  expect(rows.filter((r) => r.headingOk === false).length, "views that missed their heading").toBe(0);
});
