import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { hooks, openStation, save, shotPath, watch } from "../lib/gteki.ts";
test.use({ trace: "off" });

/**
 * #240's JR Saikyo ride demo: Ikebukuro → Shinjuku → back, from the "Ride train" button, as a user plays it.
 * Per leg: the overlay opens on "boarding" with its not-surveyed note, the ride runs (screenshots along it and a
 * frame-rate sample), the destination station loads behind it, "arrived" offers Exit, and Exit drops the player
 * back into the explorer of the other station. Run once with normal motion and once with reduced motion.
 * After each exit, W then A are held for 1.2 s each and the avatar must move. Records timings and stages; judging the cabin's look is left to the frames.
 */

const ride = (page: Page) => page.locator(".rail-ride");
const action = (page: Page) => page.locator(".rail-ride-sheet > button");

async function fps(page: Page, ms = 2000): Promise<number> {
  return page.evaluate((ms) => new Promise<number>((done) => {
    let n = 0; const t0 = performance.now();
    const step = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(step); else done((n * 1000) / (performance.now() - t0)); };
    requestAnimationFrame(step);
  }), ms);
}

async function leg(page: Page, testInfo: TestInfo, tag: string, from: string, to: string) {
  await page.locator(".rail-launch").click();
  await expect(ride(page)).toBeVisible();
  await expect(ride(page)).toHaveAttribute("data-stage", "boarding");
  const note = (await page.locator(".rail-ride-demo-note").textContent()) ?? "";
  await page.screenshot({ path: shotPath(testInfo, `${tag}-1-boarding.png`) });
  const t0 = Date.now();
  await action(page).click();
  await expect(ride(page)).toHaveAttribute("data-stage", "moving");
  const rideFps = await fps(page);
  await page.screenshot({ path: shotPath(testInfo, `${tag}-2-moving.png`) });
  const stages: { stage: string; ms: number }[] = [];
  let last = "moving";
  while (Date.now() - t0 < 90_000) {
    const s = (await ride(page).getAttribute("data-stage")) ?? "?";
    if (s !== last) { stages.push({ stage: s, ms: Date.now() - t0 }); last = s; }
    if (s === "arrived" || s === "error") break;
    if (Date.now() - t0 > 4000 && Date.now() - t0 < 4600) await page.screenshot({ path: shotPath(testInfo, `${tag}-3-mid.png`) });
    await page.waitForTimeout(100);
  }
  await page.screenshot({ path: shotPath(testInfo, `${tag}-4-${last}.png`) });
  const arrivedUrl = page.url();
  if (last === "arrived") await action(page).click();
  await expect(ride(page)).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(1500);
  const after = { url: page.url(), phase: await page.evaluate(() => (window as any).__gteki.phase()), mode: await hooks.mode(page) };
  await page.screenshot({ path: shotPath(testInfo, `${tag}-5-after-exit.png`) });
  // The player can walk on after the ride: real key presses (W, then A), as on a keyboard, from the spawn point.
  const p0 = await hooks.avatar(page);
  await page.locator("canvas").first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  for (const key of ["w", "a"]) { await page.keyboard.down(key); await page.waitForTimeout(1200); await page.keyboard.up(key); }
  await page.waitForTimeout(300);
  const p1 = await hooks.avatar(page);
  const walkedM = p0 && p1 ? Math.round(Math.hypot(p1.x - p0.x, p1.y - p0.y) * 100) / 100 : null;
  await page.screenshot({ path: shotPath(testInfo, `${tag}-6-after-walk.png`) });
  const r = { from, to, note, rideFps: Math.round(rideFps * 10) / 10, stages, final: last, arrivedUrl, after, walk: { p0, p1, walkedM } };
  expect.soft(walkedM ?? 0, `${tag}: WASD moves the avatar after the ride (m)`).toBeGreaterThan(0.5);
  expect.soft(last, `${tag}: ride reaches arrival`).toBe("arrived");
  expect.soft(note, `${tag}: says the platform is not surveyed`).toMatch(/unsurveyed|未測量|not surveyed|仮/i);
  expect.soft(after.url, `${tag}: lands in ${to}`).toContain(`station=${to}`);
  expect.soft(after.phase, `${tag}: explorer ready after exit`).toBe("ready");
  return r;
}

for (const reduced of [false, true]) {
  test(`rail ride demo ikebukuro ⇄ shinjuku${reduced ? " (reduced motion)" : ""} @phone`, async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
    const diag = watch(page);
    await openStation(page, "ikebukuro");
    const rm = reduced ? "rm" : "mo";
    const out = await leg(page, testInfo, `${rm}-a-ikb-sjk`, "ikebukuro", "shinjuku");
    const back = await leg(page, testInfo, `${rm}-b-sjk-ikb`, "shinjuku", "ikebukuro");
    save(testInfo, `rail-ride-${rm}.json`, { project: testInfo.project.name, reduced, viewport: page.viewportSize(), legs: [out, back], diag });
    expect.soft(diag.pageErrors, "uncaught page errors").toEqual([]);
  });
}
