import { expect, test, type Page } from "@playwright/test";
import { hooks, openStation, save, shotPath } from "../lib/gteki.ts";

/**
 * Minimal reproductions of defects Lane F reported, kept as regression tests. Each starts from a
 * graph node and uses the explorer's own walk step with fixed keys (yaw 0 = facing north, D = east),
 * so a failure here does not depend on the free-walk autopilot.
 */

/** Face east (yaw −π/2) with a real drag: yaw −= dx·0.0042. */
async function faceEast(page: Page) {
  const c = await page.locator("canvas.gteki-canvas").boundingBox();
  const x = c!.x + c!.width * 0.3, y = c!.y + c!.height * 0.55;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + Math.round(Math.PI / 2 / 0.0042), y, { steps: 4 });
  await page.mouse.up();
}

test("ikebukuro: Exit 18 U-stair (edge w_n__x18) is walkable both ways", async ({ page }, testInfo) => {
  await openStation(page, "ikebukuro", "&from=jr-south-gate&to=exit-18");
  // Up: from the West Exit hall junction w_n toward the stair foot at (−99.5, 152.5).
  expect(await hooks.walkFromNode(page, "w_n")).toBe(true);
  await hooks.simulate(page, 1.0, ["KeyW"]);
  let p = await hooks.avatar(page);
  for (let i = 0; i < 20; i++) p = await hooks.simulate(page, 0.5, ["KeyD"]);
  await faceEast(page);
  await hooks.simulate(page, 0.6, []);
  await page.screenshot({ path: shotPath(testInfo, "repro-ikebukuro-exit18-blocked-3p.png") });
  await page.locator(".hud button", { hasText: /First person/ }).click();
  await hooks.simulate(page, 0.2, []);
  await page.screenshot({ path: shotPath(testInfo, "repro-ikebukuro-exit18-blocked-1p.png") });
  await page.locator(".hud button", { hasText: /First person/ }).click();
  // Down: from the street node x18 back toward B1.
  expect(await hooks.walkFromNode(page, "x18")).toBe(true);
  const top = await hooks.avatar(page);
  let down = top;
  for (let i = 0; i < 16; i++) down = await hooks.simulate(page, 0.5, ["KeyS"]);
  save(testInfo, "repro-ikebukuro-exit18.json", { upStoppedAt: p, downFrom: top, downStoppedAt: down });
  expect.soft(p.x, "walker reaches the stair foot (x ≥ −99.6) from B1").toBeGreaterThan(-99.6);
  expect.soft(top.z - down.z, "walker descends the stair from street level by more than 3 m").toBeGreaterThan(3);
});
