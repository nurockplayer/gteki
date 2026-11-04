import { expect, test, type Page } from "@playwright/test";
import { hooks, openStation, save } from "../lib/gteki.ts";

test.use({ trace: "off", video: "off", screenshot: "off" });

async function measure(page: Page) {
  return page.evaluate(() => {
    const map = document.querySelector<HTMLElement>(".minimap")!;
    const circle = document.querySelector(".minimap-map")!.getBoundingClientRect();
    const box = map.getBoundingClientRect();
    const overlap = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden")
      .reduce((sum, el) => {
        const r = el.getBoundingClientRect();
        return sum + Math.max(0, Math.min(box.right, r.right) - Math.max(box.left, r.left))
          * Math.max(0, Math.min(box.bottom, r.bottom) - Math.max(box.top, r.top));
      }, 0);
    const frames: number[] = (window as any).__qa.frames.slice(-60);
    return {
      width: circle.width, height: circle.height, right: box.right, bottom: box.bottom,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      label: map.querySelector(".minimap-label")!.textContent,
      routeLabel: map.querySelector(".minimap-route-label")!.textContent,
      routeLines: map.querySelectorAll(".minimap-route-line").length,
      dots: map.querySelectorAll(".minimap-poi").length,
      overlaps: Object.fromEntries([".panel", ".hint", ".hud-row", ".hud-instruction", ".credit-line", ".joystick.active", ".mascot-figure", ".mascot-bubble"]
        .map((selector) => [selector, overlap(selector)])),
      canvasCount: document.querySelectorAll("canvas").length,
      minimapCanvasCount: map.querySelectorAll("canvas").length,
      quality: (window as any).__gteki.quality(),
      fps: 1000 / (frames.reduce((a, b) => a + b, 0) / frames.length),
      renderer: (window as any).__qa.gl?.renderer,
    };
  });
}

test("minimap station switch, orientation, zoom and HUD geometry @phone", async ({ page }, info) => {
  const phone = info.project.name.startsWith("phone");
  await page.setViewportSize(phone ? { width: 375, height: 812 } : { width: 1440, height: 900 });
  const rows: unknown[] = [];
  const check = async (state: string) => {
    await expect(page.locator(".minimap")).toBeVisible();
    const m = await measure(page);
    rows.push({ state, ...m });
    save(info, "minimap-audit.json", { rows });
    expect.soft(m.width).toBeGreaterThanOrEqual(phone ? 120 : 180);
    expect.soft(m.width).toBeLessThanOrEqual(phone ? 140 : 200);
    expect.soft(m.width).toBeCloseTo(m.height, 1);
    expect.soft(m.right).toBeLessThanOrEqual(m.viewportWidth);
    expect.soft(m.bottom).toBeLessThanOrEqual(m.viewportHeight);
    for (const [name, area] of Object.entries(m.overlaps)) expect.soft(area, `${state}: ${name} overlap px²`).toBe(0);
    expect(m.minimapCanvasCount).toBe(0);
    if (phone) expect(m.quality).toBe("low");
  };
  await openStation(page, "ikebukuro");
  await hooks.walkFromNode(page, "g_jr_c2");
  await check("ikebukuro-walk");
  await expect(page.locator(".minimap-label")).toContainText("ikebukuro");
  await expect(page.locator(".minimap-label strong")).toHaveText("B1 passages");
  await expect(page.locator(".minimap-orientation")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".minimap .minimap-arrow")).toHaveAttribute("transform", /rotate\(0\)/);
  if (phone) {
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 70, y: 650 }] });
    await expect(page.locator(".joystick.active")).toBeVisible();
    await check("ikebukuro-joystick");
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
  }
  await hooks.setOrigin(page, "jr-central-gate-2");
  await hooks.setDestination(page, "exit-35");
  const route = await hooks.route(page);
  expect(route.ok).toBe(true);
  await page.locator(".minimap-zoom-in").click();
  await page.locator(".minimap-orientation").click();
  expect(await hooks.route(page)).toEqual(route);
  await expect(page.locator(".minimap-zoom span")).toHaveText("2×");
  await page.evaluate(() => (window as any).__gteki.startGuide());
  await check("ikebukuro-guide");
  await page.reload();
  await page.waitForFunction(() => (window as any).__gteki?.phase() === "ready", null, { polling: 250 });
  await hooks.walkFromNode(page, "g_jr_c2");
  await expect(page.locator(".minimap-orientation")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".minimap .minimap-graph")).toHaveAttribute("transform", /rotate\(0\)/);
  await page.locator(".station-select").selectOption("shinjuku");
  await page.waitForFunction(() => (window as any).__gteki.phase() === "ready", null, { polling: 250 });
  await hooks.walkFromNode(page, "n:a06f3d191885497bac197b666c4daef9");
  await check("shinjuku-walk-after-switch");
  await expect(page.locator(".minimap-label")).toContainText("shinjuku");
  await expect(page.locator(".minimap-label strong")).toHaveText("Street");
  await expect(page.locator(".minimap-route-line")).toHaveCount(0);
  expect(await hooks.route(page)).toBeNull();
  await hooks.setOrigin(page, "poi:exit:1");
  await hooks.setDestination(page, "poi:platform:oedo");
  const crossFloorRoute = await hooks.route(page);
  expect(crossFloorRoute.ok).toBe(true);
  await page.evaluate(() => (window as any).__gteki.startGuide());
  await check("shinjuku-cross-floor-guide");
  await expect(page.locator(".minimap-route-label")).toContainText("Destination floor: B6");
  await hooks.walkFromNode(page, crossFloorRoute.steps.at(-1).toNodeId);
  await expect(page.locator(".minimap-label strong")).toHaveText("B6");
  await check("shinjuku-destination-floor-spawn");
  save(info, "minimap-audit.json", { rows });
  console.log(JSON.stringify({ project: info.project.name, rows }));
});
