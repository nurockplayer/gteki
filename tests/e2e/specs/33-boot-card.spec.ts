import { expect, test, type Page } from "@playwright/test";
import { shotPath } from "../lib/gteki";

async function lifted(page: Page, project: string) {
  await page.waitForFunction(() => (window as any).__gteki?.phase() === "ready", null, { timeout: 120_000, polling: 50 });
  const readyAt = Date.now();
  await expect(page.locator(".boot-card")).toBeHidden({ timeout: 6_000 });
  console.log(`[boot-lift] ${project}: ${Date.now() - readyAt} ms from observed ready`);
  await expect(page.locator(".cold-open")).toBeVisible();
}

test("loading card blocks early taps and lifts to the route", async ({ page }, info) => {
  await page.goto("/?next=1");
  await lifted(page, info.project.name);
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
  await lifted(page, info.project.name);
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
