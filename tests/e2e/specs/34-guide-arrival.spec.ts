import { expect, test } from "@playwright/test";

test.use({ trace: "off", video: "off", screenshot: "off", userAgent: undefined });

test("natural guided arrival stays at the platform @phone", async ({ page }, info) => {
  test.setTimeout(1_800_000);
  await page.goto(process.env.JOURNEY_MODE === "next" ? "/?next=1" : "/");
  await page.waitForFunction(() => (window as any).__gteki?.phase() === "ready" && (window as any).__gteki.route()?.ok, null, { timeout: 120_000 });
  const button = page.locator(".cold-open .primary");
  await button.waitFor({ state: "visible", timeout: 120_000 });
  await page.evaluate(() => {
    const w = window as any;
    const start = performance.now();
    let arrival: { at: number; position: { x: number; y: number; z: number }; distanceM: number; shot: boolean } | null = null;
    let frames = 0;
    const frame = () => {
      const g = w.__gteki, controls = g.guideControls(), position = g.avatar();
      if (!arrival && controls.arrived) arrival = { at: performance.now(), position, distanceM: controls.distanceM, shot: g.arrivalFrame().shot };
      if (arrival) {
        frames++;
        const elapsedMs = performance.now() - arrival.at;
        const changed = g.mode() !== "guide" || !controls.arrived || Math.abs(controls.distanceM - arrival.distanceM) > 0.01 ||
          Math.hypot(position.x - arrival.position.x, position.y - arrival.position.y, position.z - arrival.position.z) > 0.01 ||
          !document.querySelector(".app.arrival .arrival-controls .guide-more") || g.arrivalFrame().shot !== arrival.shot;
        if (changed || elapsedMs >= 90_000) {
          w.__arrivalObservation = { changed: changed ? { elapsedMs, position, controls, mode: g.mode(), arrival } : null, elapsedMs, frames, walkMs: arrival.at - start };
          return;
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await button.click();
  await page.waitForFunction(() => (window as any).__arrivalObservation !== undefined, null, { timeout: 1_700_000, polling: 1000 });
  const result = await page.evaluate(() => (window as any).__arrivalObservation);
  console.log(`[arrival] ${info.project.name} ${process.env.JOURNEY_MODE ?? "default"}: ${JSON.stringify(result)}`);
  expect(result.changed).toBeNull();
});
