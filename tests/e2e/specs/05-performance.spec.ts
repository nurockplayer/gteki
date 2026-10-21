import { expect, test } from "@playwright/test";
import { hooks, openStation, perfWindow, save, STATIONS } from "../lib/gteki.ts";

/**
 * Observed performance on this host/browser, not a pass/fail budget (acceptance forbids
 * ungrounded FPS thresholds). Records the actual WebGL renderer so software rendering is
 * never mistaken for device performance.
 */
for (const key of STATIONS) {
  test(`${key}: load, overview, guide and walk frame times @phone`, async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const { loadMs } = await openStation(page, key);
    const nav = await page.evaluate(() => {
      const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      return { requests: res.length, transferKB: Math.round(res.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024), decodedKB: Math.round(res.reduce((s, r) => s + (r.decodedBodySize || 0), 0) / 1024), largest: res.sort((a, b) => b.decodedBodySize - a.decodedBodySize).slice(0, 5).map((r) => ({ url: r.name.split("/").pop(), kB: Math.round(r.decodedBodySize / 1024) })) };
    });
    const overview = await perfWindow(page, 6);

    const first = key === "ikebukuro" ? ["jr-central-gate-2", "exit-35"] : ["poi:exit:1", "poi:platform:oedo"];
    await hooks.setOrigin(page, first[0]!);
    await hooks.setDestination(page, first[1]!);
    await page.evaluate(() => (window as any).__gteki.startGuide());
    const guide = await perfWindow(page, 10);

    await page.evaluate(() => (window as any).__gteki.walkFromNode((window as any).__gteki.route().nodeIds[0]));
    await page.keyboard.down("KeyW");
    const walk = await perfWindow(page, 6);
    await page.keyboard.up("KeyW");

    const result = { project: testInfo.project.name, quality: await hooks.quality(page), viewport: page.viewportSize(), loadMs, nav, overview, guide, walk };
    save(testInfo, `${key}-perf.json`, result);
    expect(overview.frames).toBeGreaterThan(0);
    expect(overview.gpuValid, `renderer ${overview.gl?.renderer}: software rendering invalidates performance evidence`).toBe(true);
    expect(overview.zeroDrawFrames, "frames where the product drew nothing").toBeLessThan(overview.frames / 2);
  });
}
