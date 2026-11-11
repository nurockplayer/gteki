import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__gteki?.phase() === "ready", null, { timeout: 120_000, polling: 250 });
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
  await ready(page, "/?open=world");
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
  expect(new URL(page.url()).searchParams.has("from")).toBe(false);
  expect(new URL(page.url()).searchParams.has("to")).toBe(false);
  const overlay = await page.evaluate(() => {
    let covered = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) {
      if (!document.elementFromPoint((x + .5) * innerWidth / 24, (y + .5) * innerHeight / 16)?.matches("canvas.gteki-canvas")) covered++;
    }
    const g = (window as any).__gteki;
    const point = g.projectEnu([g.avatar()])[0];
    return { share: covered / 384, cat: document.elementFromPoint(point.x, point.y)?.matches("canvas.gteki-canvas") };
  });
  expect(overlay.share).toBeLessThanOrEqual(info.project.name === "phone-chromium" ? .30 : .20);
  expect(overlay.cat).toBe(true);
  await page.locator(".cold-open .primary").click();
  await expect.poll(() => page.evaluate(() => (window as any).__gteki.mode())).toBe("guide");
  await expect.poll(() => page.evaluate(() => (window as any).__gteki.audio().state)).toBe("running");
  await expect(page.locator(".cold-open")).toBeHidden();
});

test("search opens the destination field @phone", async ({ page }) => {
  await ready(page, "/?open=world");
  await page.locator(".cold-open-search").click();
  await expect(page.locator(".panel")).toBeVisible();
  await expect(page.locator("#gteki-to")).toBeFocused();
  await expect(page.locator(".cold-open")).toBeHidden();
  expect(await page.evaluate(() => (window as any).__gteki.mode())).toBe("walk");
});

test("other stations, deep links and default retain their state @phone", async ({ page }) => {
  for (const url of ["/?open=world&station=ikebukuro", "/?station=ikebukuro", "/"]) {
    await ready(page, url);
    expect(await page.evaluate(() => (window as any).__gteki.mode())).toBe("overview");
    await expect(page.locator(".panel")).toBeVisible();
    await expect(page.locator(".cold-open")).toBeHidden();
  }
  for (const flag of ["&open=world", ""]) {
    await ready(page, `/?station=shinjuku&from=poi:gate:1&to=poi:platform:oedo${flag}`);
    expect(await page.evaluate(() => (window as any).__gteki.route()?.ok)).toBe(true);
    expect(await page.evaluate(() => (window as any).__gteki.mode())).toBe("overview");
    await expect(page.locator(".cold-open")).toBeHidden();
  }
});
