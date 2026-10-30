import { expect, test } from "@playwright/test";
import { hooks, imageStats, textIf, toasts, labelUiOverlaps, openStation, save, shotPath, STATIONS, watch } from "../lib/gteki.ts";

/** CI's e2e-smoke sets this (.github/workflows/e2e-smoke.yml): under SwiftShader the spec checks flow only and skips screenshots that time out (#76, #118). */
const FLOW_ONLY = !!process.env.GTEKI_GUIDE_FLOW_ONLY;
/**
 * Load budget (ms) for the stairwell cut, greybox and connectors steps together, measured under CI SwiftShader (#650).
 * May only be lowered; never raise it to make a run pass.
 */
const LOAD_BUDGET_MS = 1500;

/** Opening each station from a plain browser URL: no install, real scene, honest banners, no errors. */
for (const key of STATIONS) {
  test(`${key}: opens, renders its scene and states its limits @phone`, async ({ page }, testInfo) => {
    const diag = watch(page);
    const { loadMs, phase } = await openStation(page, key);
    expect(phase).toBe("ready");

    const info = await hooks.sceneInfo(page);
    // Load-time breakdown in the CI log, so every PR shows where opening a station spends its time (#650).
    const steps = (info as { loadTimings?: Record<string, number> }).loadTimings ?? {};
    const measures = await page.evaluate(() => performance.getEntriesByType("measure").filter((m) => m.name.startsWith("sjk:")).map((m) => [m.name, Math.round(m.duration)]));
    console.log(`[load-timings] ${key} ${JSON.stringify({ loadMs, steps, measures })}`);
    for (const step of ["scene", "greybox", "stairwellCut", "connectors", "rayTrees", "total"]) expect.soft(Number.isFinite(steps[step]) && steps[step]! >= 0, `load timing ${step}`).toBe(true);
    expect.soft(steps.total ?? 0, "load timing total").toBeGreaterThan(0);
    // Ratchet: the stairwell cut, greybox and connectors together stay under the budget (#650).
    const cutAndShell = (steps.stairwellCut ?? NaN) + (steps.greybox ?? NaN) + (steps.connectors ?? NaN);
    expect(cutAndShell, `${key}: stairwellCut + greybox + connectors (ms), budget ${LOAD_BUDGET_MS}`).toBeLessThanOrEqual(LOAD_BUDGET_MS);
    // Shinjuku's baked stairwell recipe (#650) replays; a stale one would fall back to live. Ikebukuro stays live.
    expect(info.greybox?.stairwells?.recipe, `${key}: stairwell cut recipe`).toBe(key === "shinjuku" ? "replayed" : "live");
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
    const png = FLOW_ONLY ? null : await page.screenshot({ path: shotPath(testInfo, `${key}-01-overview.png`) });
    const stats = png ? await imageStats(page, png) : null;
    const overlaps = await labelUiOverlaps(page);

    // Coverage dialog must list gaps and sources.
    // By label: the top bar also holds the rail-ride button (#240), hidden at most stations and placed first.
    await page.locator(".top-actions button").filter({ hasText: /^(Coverage|カバー範囲)$/ }).click();
    const dialog = page.locator("dialog.coverage");
    await expect(dialog).toBeVisible();
    const coverageText = (await dialog.textContent()) ?? "";
    if (!FLOW_ONLY) await page.screenshot({ path: shotPath(testInfo, `${key}-02-coverage.png`) });
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
  // CPU profile of the switch (#647): self time by function and the garbage collector's share, logged below.
  const heapBeforeMB = await page.evaluate(() => Math.round(((performance as any).memory?.usedJSHeapSize ?? 0) / 1e6));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 1000 }); await cdp.send("Profiler.start");
  await page.locator(".station-select").selectOption("shinjuku");
  // Where the switch spends its time (#647): logged pass or fail, so a timeout shows which step ran long.
  const switchState = () => page.evaluate(() => {
    const g = (window as any).__gteki;
    const heapMB = Math.round(((performance as any).memory?.usedJSHeapSize ?? 0) / 1e6);
    const measures = performance.getEntriesByType("measure").filter((m) => m.name.startsWith("sjk:")).map((m) => [m.name, Math.round(m.startTime), Math.round(m.duration)]);
    return { phase: g.phase(), routeNull: g.route() === null, heapMB, opens: g.openTimings?.(), steps: g.sceneInfo?.()?.loadTimings, measures };
  });
  try {
    await page.waitForFunction(() => (window as any).__gteki.phase() === "ready" && (window as any).__gteki.route() === null);
  } finally {
    console.log(`[switch-timings] ${JSON.stringify({ heapBeforeMB, ...(await switchState()) })}`);
    const { profile } = await cdp.send("Profiler.stop") as { profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[]; samples: number[]; timeDeltas: number[] } };
    const frames = new Map(profile.nodes.map((n) => [n.id, n.callFrame]));
    const self = new Map<string, number>();
    profile.samples.forEach((id, i) => {
      const f = frames.get(id)!, file = f.url.split("/").pop()?.split("?")[0] ?? "";
      const key = `${f.functionName || "(anonymous)"} ${file}:${f.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
    });
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, ms]) => [k, Math.round(ms)]);
    console.log(`[switch-profile] ${JSON.stringify({ totalMs: Math.round(total), gcMs: Math.round(self.get("(garbage collector) :0") ?? 0), top })}`);
    await cdp.detach();
  }
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
