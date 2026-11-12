import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { PROBE_SCRIPT, hooks, overlayGrid, settleFrames, shotPath } from "../lib/gteki";

test.use({ trace: "off", video: "off", screenshot: "off" });

test("compact guide and arrival @phone", async ({ page }, info) => {
  test.setTimeout(720_000);
  await page.setViewportSize(info.project.name === "phone-chromium" ? { width: 390, height: 844 } : { width: 1280, height: 800 });
  await page.addInitScript(PROBE_SCRIPT);
  await page.goto("/?next=1");
  await page.waitForFunction(() => (window as any).__gteki?.phase() === "ready", null, { timeout: 120_000 });
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
    expect(overlay.cat, `${name}: ${JSON.stringify(overlay.top)}`).toBe(true);
    await capture(`walk-hud-${name}.png`);
  };
  const controls = async () => {
    await expect(page.locator(".hud button:visible:not(.hud-instruction)")).toHaveCount(3);
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
  let escalator = false;
  for (let i = 0; i < 100; i++) {
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
  await expect(card).toContainText("Arrived");
  await expect(card).not.toContainText("Data for");
  await expect(card).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".toast")).not.toHaveClass(/\bshow\b/);
  await expect(page.getByRole("button", { name: "Reverse route" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search again" })).toBeVisible();
  await card.click();
  await expect(card).toContainText("Data for");
  await page.evaluate(() => (window as any).__gteki.goldenFrame());
  await capture("walk-hud-arrival-open.png");
  } finally {
    await page.evaluate(() => (window as any).__gteki.holdFrames(false));
  }
});
