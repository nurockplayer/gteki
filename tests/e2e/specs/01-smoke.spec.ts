import { expect, test } from "@playwright/test";
import { hooks, imageStats, textIf, toasts, labelUiOverlaps, openStation, save, shotPath, STATIONS, watch } from "../lib/gteki.ts";

/** Opening each station from a plain browser URL: no install, real scene, honest banners, no errors. */
for (const key of STATIONS) {
  test(`${key}: opens, renders its scene and states its limits @phone`, async ({ page }, testInfo) => {
    const diag = watch(page);
    const { loadMs, phase } = await openStation(page, key);
    expect(phase).toBe("ready");

    const info = await hooks.sceneInfo(page);
    // A station scene, not the L0 fallback: real geometry, walkable surfaces and colliders.
    expect.soft(info.world.length, "world bounding box").toBe(6);
    expect.soft(info.walkable, "walkable meshes").toBeGreaterThan(0);
    const fallback = await textIf(page, ".toast.show");

    // Honest framing: real-candidate banner with freshness and "no indoor positioning".
    const banner = (await page.locator(".banner").textContent()) ?? "";
    expect.soft(banner).toMatch(/positioning/i);

    // Station selector lists both stations.
    const options = await page.locator(".station-select option").allTextContents();
    expect.soft(options.join("|")).toMatch(/Ikebukuro/);
    expect.soft(options.join("|")).toMatch(/Shinjuku/);

    await page.waitForTimeout(1500);
    const png = await page.screenshot({ path: shotPath(testInfo, `${key}-01-overview.png`) });
    const stats = await imageStats(page, png);
    const overlaps = await labelUiOverlaps(page);

    // Coverage dialog must list gaps and sources.
    await page.locator(".top-actions button").first().click();
    const dialog = page.locator("dialog.coverage");
    await expect(dialog).toBeVisible();
    const coverageText = (await dialog.textContent()) ?? "";
    await page.screenshot({ path: shotPath(testInfo, `${key}-02-coverage.png`) });
    await dialog.locator("button.close").click();

    // The L0 fallback also has a bounding box and walkable ribbons; its toast is the reliable signal.
    const shown = await toasts(page);
    expect.soft(shown.filter((t) => /L0|network view|経路網表示/.test(t)), "station scene fell back to the L0 network view").toEqual([]);
    expect.soft(diag.console.filter((c) => /scene/i.test(c)), "scene warnings on the console").toEqual([]);
    save(testInfo, `${key}-smoke.json`, { toasts: shown, loadMs, phase, info, fallback, banner, stats, overlaps, quality: await hooks.quality(page), coverageChars: coverageText.length, diag });

    expect.soft(coverageText.length, "coverage dialog content").toBeGreaterThan(200);
    expect.soft(diag.pageErrors, "uncaught page errors").toEqual([]);
    expect.soft(diag.failedRequests, "failed requests").toEqual([]);
    // Labels may overlap UI boxes, but must never paint above controls (they would steal taps/clicks).
    expect.soft(overlaps.uiOverlaps.filter((o) => o.labelOnTop), "POI labels painted over UI controls").toEqual([]);
  });
}

test("station switching drops the previous station's state", async ({ page }) => {
  await openStation(page, "ikebukuro", "&from=jr-central-gate-2&to=exit-35");
  expect((await hooks.route(page))?.ok).toBe(true);
  await page.locator(".station-select").selectOption("shinjuku");
  await page.waitForFunction(() => (window as any).__gteki.phase() === "ready" && (window as any).__gteki.route() === null);
  await expect(page.locator("#gteki-from")).toHaveValue("");
  await expect(page.locator("#gteki-to")).toHaveValue("");
  expect(page.url()).toContain("station=shinjuku");
  // Rapid back-and-forth must settle on the last selection.
  await page.locator(".station-select").selectOption("ikebukuro");
  await page.locator(".station-select").selectOption("shinjuku");
  await page.waitForFunction(() => (window as any).__gteki.phase() === "ready", null, { timeout: 120_000 });
  await page.waitForTimeout(1000);
  await expect(page.locator(".station-select")).toHaveValue("shinjuku");
  expect(await hooks.setOrigin(page, "poi:exit:1")).toBe(true);
  expect(await hooks.setOrigin(page, "jr-central-gate-2")).toBe(false);
});
