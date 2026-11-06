import { expect, test } from "@playwright/test";
import { hooks, openStation, shotPath } from "../lib/gteki.ts";

test("search panel folds while walking @phone", async ({ page }, info) => {
  const phone = info.project.name.startsWith("phone");
  const tier = phone ? "phone" : "desktop";
  await openStation(page, "ikebukuro");
  const panel = page.locator(".panel"), entry = page.locator(".panel-entry");
  await expect(panel).toBeVisible();
  expect(await hooks.walkFromNode(page, "x35")).toBe(true);
  if (!phone) await expect(panel).toBeVisible();
  await hooks.simulate(page, 0.2, ["KeyW"]);
  await expect(panel).toBeHidden();
  await expect(entry).toBeVisible();
  await expect(page.locator(".greybox-legend")).toBeVisible();
  const rects = await Promise.all([entry.boundingBox(), page.locator(".minimap").boundingBox(), page.locator(".topbar").boundingBox()]);
  console.log(`[panel-fold] ${new Date().toISOString()} ${tier} entry/minimap/topbar ${JSON.stringify(rects)}`);
  const [a, b, c] = rects;
  expect(a).not.toBeNull(); expect(b).not.toBeNull(); expect(c).not.toBeNull();
  const overlap = (x: NonNullable<typeof a>, y: NonNullable<typeof a>) => x.x < y.x + y.width && x.x + x.width > y.x && x.y < y.y + y.height && x.y + x.height > y.y;
  expect(overlap(a!, b!)).toBe(false); expect(overlap(a!, c!)).toBe(false);
  const legend = await page.locator(".greybox-legend").boundingBox();
  const hudButtons = await page.locator(".hud button:visible").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
  console.log(`[panel-fold] ${new Date().toISOString()} ${tier} legend/hudButtons ${JSON.stringify({ legend, hudButtons })}`);
  expect(legend).not.toBeNull();
  expect(hudButtons.length).toBeGreaterThan(0);
  for (const button of hudButtons) expect(overlap(legend!, button)).toBe(false);
  await page.screenshot({ path: shotPath(info, `${tier}-folded.png`) });
  if (phone) await entry.tap(); else await entry.click();
  await expect(panel).toBeVisible();
  await expect(panel.locator('.banner')).toContainText('From open data; desk-checked only, not verified on site');
  await page.screenshot({ path: shotPath(info, `${tier}-open.png`) });
  await page.locator('#gteki-to').blur();
  await hooks.simulate(page, 0.1, []);
  await hooks.simulate(page, 0.2, ["KeyW"]);
  await expect(panel).toBeHidden();
  if (!phone) {
    await page.keyboard.press('/');
    await expect(panel).toBeVisible();
    await expect(page.locator('#gteki-to')).toBeFocused();
  }
});
