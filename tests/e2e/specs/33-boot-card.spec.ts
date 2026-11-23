import fs from "node:fs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { installBootFrameProbe, shotPath, waitBootLift } from "../lib/gteki";

async function lifted(page: Page, info: TestInfo) {
  await page.waitForFunction(() => (window as any).__gteki?.phase() === "ready", null, { timeout: 120_000, polling: 50 });
  await waitBootLift(page, info);
  await expect(page.locator(".cold-open")).toBeVisible();
}

// Each case takes 2.2–4.1 min under CI software rendering, past the 240 s default (#1401).
test.describe.configure({ timeout: 420_000 });

for (const url of ["/", "/?next=1"])
test(`${url}: loading card blocks early taps and lifts to the route @phone`, async ({ page }, info) => {
  await installBootFrameProbe(page);
  await page.goto(url);
  expect(await page.locator("html").getAttribute("data-cold-open")).toBe("1");
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
  if (info.project.name.startsWith("phone")) {
    for (const phone of [{ width: 412, height: 839 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(phone);
      const track = await page.locator("#cold-open-poster .boot-track").boundingBox();
      expect(track).not.toBeNull();
      const catTop = 455 / 839 * phone.height;
      expect(catTop - (track!.y + track!.height), `${phone.width}×${phone.height} poster bar gap`).toBeGreaterThanOrEqual(8);
    }
    await page.setViewportSize(viewport);
  }
  await expect(page.locator(".boot-title")).not.toBeEmpty();
  const progress = Number(await page.locator('[role="progressbar"]').getAttribute("aria-valuenow"));
  expect(progress).toBeGreaterThan(0);
  expect(progress).toBeLessThan(100);
  await expect(page.locator(".cold-open")).toBeHidden();
  await expect(page.locator(".panel")).toBeHidden();
  await page.screenshot({ path: shotPath(info, "boot-1s.png") });
  const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest(".boot-card"), point)).toBe(true);
  await page.mouse.click(point.x, point.y);
  release();
  await lifted(page, info);
  const state = await page.evaluate(() => {
    const g = (window as any).__gteki;
    return { mode: g.mode(), route: g.route(), endpoints: g.routeEndpoints(), flag: localStorage.getItem("gteki.firstRunDone") };
  });
  expect(state.mode).toBe("walk");
  expect(state.route.ok).toBe(true);
  expect(state.endpoints).toMatchObject({ from: "poi:exit:1", to: "poi:platform:oedo" });
  expect(state.flag).toBeNull();
  await page.evaluate(() => (window as any).__gteki.holdFrames(true));
  try {
    await page.evaluate(() => (window as any).__gteki.goldenFrame());
    const cdp = await page.context().newCDPSession(page);
    const png = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(shotPath(info, "boot-lifted.png"), Buffer.from(png.data, "base64"));
    // Drain the captured frame before input, and keep continuous SwiftShader work paused
    // until the click has reached the guide (run 44945389493).
    await page.evaluate(() => (window as any).__gteki.scanProbe().explorer.renderer.getContext().finish());
    await page.locator(".cold-open .primary").click();
    await expect.poll(() => page.evaluate(() => (window as any).__gteki.mode())).toBe("guide");
  } finally {
    await page.evaluate(() => (window as any).__gteki.holdFrames(false));
  }
});
