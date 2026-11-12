import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { installBootFrameProbe, PROBE_SCRIPT, settleFrames, waitBootLift } from "../lib/gteki";

test.beforeEach(async ({ page }) => { await installBootFrameProbe(page); });

async function ready(page: Page, url: string, info: TestInfo) {
  await page.addInitScript(PROBE_SCRIPT);
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__gteki?.phase() === "ready", null, { timeout: 120_000, polling: 250 });
  await waitBootLift(page, info);
}

test("cold open starts a route and guide @phone", async ({ page }, info) => {
  await page.setViewportSize(info.project.name === "phone-chromium" ? { width: 390, height: 844 } : { width: 1280, height: 800 });
  await page.addInitScript(() => {
    (window as any).__panelSeen = false;
    new MutationObserver(() => {
      const panel = document.querySelector<HTMLElement>(".panel");
      if (panel && getComputedStyle(panel).display !== "none" && (window as any).__gteki?.phase() !== "ready") (window as any).__panelSeen = true;
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  await ready(page, "/?open=world", info);
  await settleFrames(page, "cold open");
  await expect(page.locator(".cold-open")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__panelSeen)).toBe(false);
  expect(await page.locator(".station-select").inputValue()).toBe("shinjuku");
  const state = await page.evaluate(() => {
    const g = (window as any).__gteki;
    return { mode: g.mode(), route: g.route(), endpoints: g.routeEndpoints(), avatar: g.avatar() };
  });
  expect(state.mode).toBe("walk");
  expect(state.route.ok).toBe(true);
  expect(state.endpoints).toMatchObject({ from: "poi:exit:1", to: "poi:platform:oedo" });
  expect(Math.hypot(state.avatar.x - state.endpoints.first.x, state.avatar.y - state.endpoints.first.y, state.avatar.z - state.endpoints.first.z)).toBeLessThan(3);
  await expect(page.locator(".panel")).toBeHidden();
  await expect(page.locator(".minimap")).toBeHidden();
  expect(new URL(page.url()).searchParams.has("from")).toBe(false);
  expect(new URL(page.url()).searchParams.has("to")).toBe(false);
  const overlay = await page.evaluate(() => {
    let covered = 0;
    const elements: Record<string, number> = {};
    for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) {
      const element = document.elementFromPoint((x + .5) * innerWidth / 24, (y + .5) * innerHeight / 16);
      if (!element?.matches("canvas.gteki-canvas")) {
        covered++;
        const name = element ? `${element.tagName.toLowerCase()}.${Array.from(element.classList).join(".")}` : "none";
        elements[name] = (elements[name] ?? 0) + 1;
      }
    }
    const g = (window as any).__gteki;
    const point = g.projectEnu([g.avatar()])[0];
    return { share: covered / 384, cat: document.elementFromPoint(point.x, point.y)?.matches("canvas.gteki-canvas"), top: Object.entries(elements).sort((a, b) => b[1] - a[1]).slice(0, 5) };
  });
  expect(overlay.share, `Top overlays: ${JSON.stringify(overlay.top)}`).toBeLessThanOrEqual(info.project.name === "phone-chromium" ? .30 : .20);
  expect(overlay.cat).toBe(true);
  await page.locator(".cold-open .primary").click({ timeout: 60_000 });
  await expect(page.locator(".minimap")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__gteki.mode())).toBe("guide");
  await expect.poll(() => page.evaluate(() => (window as any).__gteki.audio().state)).toBe("running");
  await expect(page.locator(".cold-open")).toBeHidden();
});

test("search opens the destination field @phone", async ({ page }, info) => {
  await ready(page, "/?next=1", info);
  await settleFrames(page, "cold open");
  await page.locator(".cold-open-search").click({ timeout: 60_000 });
  await expect(page.locator(".panel")).toBeVisible();
  await expect(page.locator("#gteki-to")).toBeFocused();
  await expect(page.locator(".cold-open")).toBeHidden();
  expect(await page.evaluate(() => (window as any).__gteki.mode())).toBe("walk");
});

test("other stations and deep links retain their state @phone", async ({ page }, info) => {
  for (const url of ["/?open=world&station=ikebukuro"]) {
    await ready(page, url, info);
    expect(await page.evaluate(() => (window as any).__gteki.mode())).toBe("overview");
    await expect(page.locator(".panel")).toBeVisible();
    await expect(page.locator(".cold-open")).toBeHidden();
  }
  for (const flag of ["&open=world"]) {
    await ready(page, `/?station=shinjuku&from=poi:gate:1&to=poi:platform:oedo${flag}`, info);
    expect(await page.evaluate(() => (window as any).__gteki.route()?.ok)).toBe(true);
    expect(await page.evaluate(() => (window as any).__gteki.mode())).toBe("overview");
    await expect(page.locator(".cold-open")).toBeHidden();
  }
});
