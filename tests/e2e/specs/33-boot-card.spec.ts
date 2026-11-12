import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { installBootFrameProbe, shotPath, waitBootLift } from "../lib/gteki";

async function lifted(page: Page, info: TestInfo) {
  await page.waitForFunction(() => (window as any).__gteki?.phase() === "ready", null, { timeout: 120_000, polling: 50 });
  await waitBootLift(page, info);
  await expect(page.locator(".cold-open")).toBeVisible();
}

test("loading card blocks early taps and lifts to the route", async ({ page }, info) => {
  await installBootFrameProbe(page);
  await page.goto("/?next=1");
  await lifted(page, info);
  const box = await page.locator(".cold-open .primary").boundingBox();
  expect(box).not.toBeNull();

  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let requested!: () => void;
  const requestSeen = new Promise<void>((resolve) => { requested = resolve; });
  await page.route(/\/graph-[^/]+\.js(?:\?.*)?$/, async (route) => {
    requested();
    await held;
    await route.continue();
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await requestSeen;
  await page.waitForTimeout(1000);
  const boot = page.locator(".boot-card");
  await expect(boot).toBeVisible();
  const bounds = await boot.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds).toMatchObject({ x: 0, y: 0, width: viewport.width, height: viewport.height });
  await expect(page.locator(".boot-title")).not.toBeEmpty();
  const progress = Number(await page.locator('[role="progressbar"]').getAttribute("aria-valuenow"));
  expect(progress).toBeGreaterThan(0);
  expect(progress).toBeLessThan(100);
  await expect(page.locator(".cold-open")).toBeHidden();
  await expect(page.locator(".panel")).toBeHidden();
  await page.screenshot({ path: shotPath(info, "boot-1s.png") });
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  release();
  await lifted(page, info);
  await page.screenshot({ path: shotPath(info, "boot-lifted.png") });
  const state = await page.evaluate(() => {
    const g = (window as any).__gteki;
    return { mode: g.mode(), route: g.route(), endpoints: g.routeEndpoints(), flag: localStorage.getItem("gteki.firstRunDone") };
  });
  expect(state.mode).toBe("walk");
  expect(state.route.ok).toBe(true);
  expect(state.endpoints).toMatchObject({ from: "poi:exit:1", to: "poi:platform:oedo" });
  expect(state.flag).toBeNull();
  await page.locator(".cold-open .primary").click();
  await expect.poll(() => page.evaluate(() => (window as any).__gteki.mode())).toBe("guide");
});
