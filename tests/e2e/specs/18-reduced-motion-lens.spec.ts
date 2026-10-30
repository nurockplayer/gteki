import { expect, test, type Page } from "@playwright/test";
import { chooseBySearch, hooks, openStation, save, type StationKey } from "../lib/gteki.ts";
import { followConstants, LENS_PROBE, startFovRecorder, stopFovRecorder } from "../lib/camera.ts";
test.use({ trace: "off" });

/**
 * The follow lens under `prefers-reduced-motion: reduce` (#136): it must change in one frame, never ease. A whole
 * guided walk at the fast tier is recorded (the rendered projection's vertical FOV at every animation frame, via
 * LENS_PROBE), with First person on/off and Overview toggled at the end. Every recorded FOV must sit on one of the
 * declared lenses (follow, first person, overview; ±0.1°); any other value is an intermediate frame of an ease.
 * Routes: Shinjuku platform-exit2 crosses stairs (slope lens), Ikebukuro jrc2-exit35 starts from Overview at a
 * different floor height (the teleport reset in 8ec5794) and squeezes the boom in the corridor.
 */
const routes: Record<StationKey, { from: [string, RegExp]; to: [string, RegExp]; label: string }> = {
  ikebukuro: { from: ["中央2", /JR 中央2改札/], to: ["35", /^35番出口$/], label: "jrc2-exit35" },
  shinjuku: { from: ["platform", /Oedo Line platform/], to: ["northwest", /street level, northwest side/], label: "platform-exit2" },
};

async function selectFastTier(page: Page) {
  const speed = page.locator(".hud button.guide-speed");
  for (let n = 0; n < 3 && (await hooks.guideControls(page)).tier !== "fast"; n++) await speed.click();
}

for (const key of ["ikebukuro", "shinjuku"] as StationKey[]) {
  test(`${key}: lens snaps under reduced motion (no intermediate FOV) @phone`, async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const k = followConstants().declaredFov;
    test.skip(k.follow === null, "candidate declares no follow FOV");
    const lenses = [...new Set([k.follow, k.firstPerson, k.overview].filter((v): v is number => v !== null))];
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(LENS_PROBE);
    await openStation(page, key);
    const r = routes[key];
    await chooseBySearch(page, "from", r.from[0], r.from[1]);
    await chooseBySearch(page, "to", r.to[0], r.to[1]);
    const reduced = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
    expect(reduced, "reduced motion is emulated").toBe(true);
    const hud = (name: RegExp) => page.locator(".hud button").filter({ hasText: name }).first();

    await startFovRecorder(page);
    // The app's own lens, sampled every 0.5 s next to the per-frame projection.
    const sceneFov: { t: number; fov: number | null; mode: string | null }[] = [];
    const t0 = Date.now();
    const sample = async () => sceneFov.push(await page.evaluate(() => ({ fov: (window as any).__gteki?.sceneInfo?.()?.fov ?? null, mode: (window as any).__gteki?.mode?.() ?? null })).then((s) => ({ t: Date.now() - t0, ...s })));
    await page.locator(".sheet .card.route button.primary").click();
    await expect.poll(() => hooks.mode(page)).toBe("guide");
    await selectFastTier(page);
    while (Date.now() - t0 < 200_000 && (await hooks.mode(page)) === "guide") { await sample(); await page.waitForTimeout(500); }
    for (const act of [() => hud(/^First person$/).click(), () => hud(/^First person$/).click(), () => hud(/^Overview$/).click()]) {
      await act().catch(() => {});
      await page.waitForTimeout(800);
      await sample();
    }
    const rec = await stopFovRecorder(page);

    const fovs = rec.frames.map((f) => f.fovV).filter((v): v is number => v !== null);
    const onLens = (v: number) => lenses.some((l) => Math.abs(v - l) <= 0.1);
    const off = rec.frames.filter((f) => f.fovV !== null && !onLens(f.fovV));
    let changes = 0;
    for (let i = 1; i < fovs.length; i++) if (Math.abs(fovs[i]! - fovs[i - 1]!) > 0.1) changes++;
    const sceneOff = sceneFov.filter((s) => s.fov !== null && !onLens(s.fov));
    const summary = {
      project: testInfo.project.name, route: r.label, lenses, frames: rec.frames.length, framesWithFov: fovs.length,
      lensChanges: changes, offLensFrames: off.length, offLensSample: off.slice(0, 20),
      distinctFov: [...new Set(fovs.map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b).slice(0, 40),
      sceneFov: { samples: sceneFov.length, offLens: sceneOff.slice(0, 20) },
    };
    save(testInfo, `reduced-lens-${key}.json`, summary);
    expect(fovs.length, "projection frames recorded").toBeGreaterThan(100);
    expect.soft(changes, "at least one lens change happened (else the run proves nothing)").toBeGreaterThan(0);
    expect.soft(off.length, `rendered frames off the declared lenses ${lenses.join("/")} (intermediate ease frames)`).toBe(0);
    expect.soft(sceneOff.length, "sceneInfo().fov samples off the declared lenses").toBe(0);
  });
}
