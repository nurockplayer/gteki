import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { installBootFrameProbe, PROBE_SCRIPT, hooks, overlayGrid, settleFrames, shotPath, waitBootLift } from "../lib/gteki";

test.use({ trace: "off", video: "off", screenshot: "off" });

test("compact guide and arrival @phone", async ({ page }, info) => {
  test.setTimeout(720_000);
  await page.setViewportSize(info.project.name === "phone-chromium" ? { width: 390, height: 844 } : { width: 1280, height: 800 });
  await installBootFrameProbe(page);
  await page.addInitScript(PROBE_SCRIPT);
  await page.goto("/?next=1");
  await page.waitForFunction(() => (window as any).__gteki?.phase() === "ready", null, { timeout: 120_000 });
  await waitBootLift(page, info);
  await settleFrames(page, "cold open");
  await page.evaluate(() => (window as any).__gteki.holdFrames(true));
  try {
  await page.locator(".cold-open .primary").click({ timeout: 60_000 });
  await expect.poll(() => hooks.mode(page)).toBe("guide");
  const cdp = await page.context().newCDPSession(page);
  const capture = async (name: string) => {
    const png = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(shotPath(info, name), Buffer.from(png.data, "base64"));
  };
  const card = page.locator(".hud-instruction");
  const sample = async (name: string) => {
    await page.evaluate(() => (window as any).__gteki.goldenFrame());
    const overlay = await overlayGrid(page);
    console.log(`[walk-hud] ${info.project.name} ${name}: ${JSON.stringify(overlay)}`);
    expect(overlay.share, `${name}: ${JSON.stringify(overlay.top)}`).toBeLessThanOrEqual(info.project.name === "phone-chromium" ? .30 : .20);
    if (name === "first") expect(overlay.cat, `${name}: ${JSON.stringify(overlay.top)}`).toBe(true);
    await capture(`walk-hud-${name}.png`);
  };
  const controls = async () => {
    await expect(page.locator(".guide-more")).toBeVisible();
    await expect(page.locator(".guide-speed")).toBeHidden();
    await expect(page.locator(".rail-launch")).toBeHidden();
    await expect(page.locator(".minimap-notice")).toBeHidden();
  };
  await hooks.simulate(page, 1);
  await sample("first");
  await controls();
  await page.locator(".guide-more").click();
  await expect(page.locator(".guide-speed")).toBeVisible();
  await expect(page.getByRole("button", { name: "First person" })).toBeVisible();
  await page.locator(".guide-more").click();
  await expect(page.locator(".guide-speed")).toBeHidden();
  await expect(page.locator(".topbar .tagline")).toBeHidden();
  await expect(page.locator(".topbar .coverage")).toBeVisible();
  expect((await page.locator(".topbar").boundingBox())!.height).toBeLessThanOrEqual(28);
  const spans = await page.evaluate(() => (window as any).__gteki.quietHud().spans);
  expect(spans.length).toBeGreaterThan(0);
  await page.evaluate((s) => (window as any).__gteki.seekGuide(s), (spans[0].fromS + spans[0].toS) / 2);
  await hooks.simulate(page, 0.1);
  await expect(page.locator(".app.next")).toHaveClass(/\bescalator\b/);
  const rect = await card.boundingBox();
  expect(rect!.height).toBeLessThanOrEqual(28);
  if (info.project.name !== "phone-chromium") expect(rect!.width).toBeLessThanOrEqual(240);
  expect((await page.locator(".minimap-map").boundingBox())!.width).toBeLessThanOrEqual(80);
  await expect(page.locator(".poi-label:visible")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__gteki.quietHud().opacity)).toBe(0);
  await page.evaluate((s) => (window as any).__gteki.seekGuide(s), spans[0].toS + 0.01);
  await hooks.simulate(page, 0.1);
  await expect(page.locator(".app.next")).not.toHaveClass(/\bescalator\b/);
  await expect.poll(() => page.evaluate(() => (window as any).__gteki.quietHud().opacity)).toBe(0.45);
  let escalator = true;
  for (let i = 0; i < 100; i++) {
    const line = await page.locator(".guide-card-line").first().allTextContents();
    if (line.length && !await page.locator(".app").evaluate((el) => el.classList.contains("escalator"))) {
      expect(line[0]!.length).toBeLessThanOrEqual(36);
      expect(line[0]).not.toContain("…");
      expect(line[0]).not.toMatch(/GL[–-]B1 landing/);
    }
    expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true);
    const state = await page.evaluate(() => (window as any).__gteki.guideControls());
    if (state.arrived) break;
    if (!escalator && /escalator/i.test(await card.textContent() ?? "")) {
      escalator = true;
      await sample("escalator");
      await controls();
    }
    await page.keyboard.press("]");
    await hooks.simulate(page, 0.5);
  }
  expect(escalator).toBe(true);
  await sample("arrival");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Arrived ·");
  await expect(page.getByRole("button", { name: "Pause" })).toBeHidden();
  await expect(page.getByRole("button", { name: "End guide" })).toBeHidden();
  await expect(page.locator(".hud .mascot-bubble:visible")).toHaveCount(0);
  await expect(page.locator(".minimap")).toBeHidden();
  await expect(card).not.toContainText("Data for");
  await expect(card).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".toast")).not.toHaveClass(/\bshow\b/);
  await expect(page.getByRole("button", { name: "Search again" })).toBeHidden();
  await page.locator(".guide-more").click();
  await expect(page.getByRole("button", { name: "Search again" })).toBeVisible();
  await page.locator(".guide-more").click();
  await card.click();
  await expect(card).toContainText("Data for");
  await page.evaluate(() => (window as any).__gteki.goldenFrame());
  await capture("walk-hud-arrival-open.png");
  } finally {
    await page.evaluate(() => (window as any).__gteki.holdFrames(false));
  }
});
