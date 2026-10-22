import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { chooseBySearch, hooks, imageStats, openStation, routeWaypoints, save, shotPath, stationData, textIf, toasts, STATIONS, type StationKey } from "../lib/gteki.ts";
import {
  analyseFovEase, candidateIdentity, drainCameraSamples, followConstants, LENS_PROBE, longestRunMs, startCameraSampler, startFovRecorder, stopCameraSampler, stopFovRecorder,
  summarise, toSample, CROWDED_M, type CameraSample, type FovEase,
} from "../lib/camera.ts";

/**
 * Follow-camera acceptance (#49 follow-camera half, #70, and the #94 / #136 lens trial). Two kinds of test:
 *
 *  1. `follow camera <walk>`: a real-UI guided walk (same flow as 03: search fields, Start guide, fast tier)
 *     over routes with hanging signs, stairs, escalators and tight corridors, sampled every GTEKI_CAM_SAMPLE_MS
 *     (default 500 ms) from inside the page. Per sample: camera and avatar position, camera-to-head distance,
 *     whether the camera sits at the minimum-distance clamp, vertical/horizontal FOV, aspect, the avatar's
 *     height share of the viewport and the route step mode. Screenshots are taken every 3rd loop and whenever
 *     a metric crosses a threshold, for near-black statistics; only flagged and every 6th are written to disk.
 *  2. `lens ease`: the FOV at about every animation frame around Start guide, First person on/off, End guide
 *     and Overview, to check the lens eases rather than jumps.
 *
 * Acceptance (soft, from #49 and #70):
 *   - worst near-black frame per route <= 0.10 (screenshot sample, same statistic as 03: luminance <= 12);
 *   - the camera is not held at the minimum-distance clamp for more than about 1 s continuously (the fraction
 *     of samples at the clamp is recorded);
 *   - frames with camera-to-head distance < 1.0 m are "crowded": recorded and listed as an annotation, never
 *     a failure (#70 is open).
 * Hooks used: `sceneInfo().camera`, `avatar()`, `mode()`, `route()`, `instructions()`, `guideControls()`.
 * Not exposed (recorded null, hook request for Lane C): whether a camera-only blocker is over the camera, the
 * follow state (clamped / boom elevation) and the lens (FOV/aspect). The lens and exact camera position are
 * measured from the WebGL matrices the renderer uploads (LENS_PROBE in lib/camera.ts), which needs no hook.
 */

/** The HUD's "fast" guide tier (m/s), `GUIDE_TIERS` in apps/web/src/explorer/guidePace.ts. */
const FAST_MPS = 6.8;
/** Flow-only mode of CI's smoke job: no arrival, no screenshots. */
const FLOW_ONLY = !!process.env.GTEKI_GUIDE_FLOW_ONLY;
const SAMPLE_MS = Math.max(250, Number(process.env.GTEKI_CAM_SAMPLE_MS ?? 500));
const NEAR_BLACK_MAX = 0.1;
/** "About 1 s" at the clamp, with a little room for sampling jitter. */
const CLAMP_RUN_MAX_MS = 1250;
/** Largest FOV change between two consecutive frames that still counts as an ease (deg). */
const FOV_JUMP_MAX_DEG = Number(process.env.GTEKI_FOV_JUMP_DEG ?? 5);
/** Tolerance when comparing the measured FOV with the source's declared value (deg). */
const FOV_TOL_DEG = 0.5;
const MAX_SAVED_FRAMES = 12;

test.use({ trace: "off" });

const walks: Record<StationKey, { from: [string, RegExp]; to: [string, RegExp]; label: string; why: string }[]> = {
  ikebukuro: [
    { from: ["中央2", /JR Central Gate 2/], to: ["35", /^Exit 35$/], label: "jrc2-exit35", why: "Exit 35 stair" },
    { from: ["West Exit", /^West Exit \(B1\)$/], to: ["West Exit (South)", /^Exit 4$/], label: "westb1-exit4", why: "tight B1 corridor" },
  ],
  shinjuku: [
    { from: ["north side", /street level, north side/], to: ["platform", /Oedo Line platform/], label: "exit1-platform", why: "escalators under hanging signs" },
    { from: ["platform", /Oedo Line platform/], to: ["northwest", /street level, northwest side/], label: "platform-exit2", why: "C3 stair: exit:2 street stair (#70)" },
  ],
};

async function viewInfo(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector("canvas.gteki-canvas");
    return { viewport: { w: innerWidth, h: innerHeight }, dpr: devicePixelRatio, canvas: c ? { w: c.clientWidth, h: c.clientHeight } : null };
  });
}

async function startWalkUi(page: Page, key: StationKey, w: { from: [string, RegExp]; to: [string, RegExp] }) {
  await chooseBySearch(page, "from", w.from[0], w.from[1]);
  await chooseBySearch(page, "to", w.to[0], w.to[1]);
  const route = await hooks.route(page);
  expect(route?.ok, "route exists").toBe(true);
  return route;
}

async function selectFastTier(page: Page): Promise<string> {
  const speed = page.locator(".hud button.guide-speed");
  for (let n = 0; n < 3 && (await hooks.guideControls(page)).tier !== "fast"; n++) await speed.click();
  const tier = (await hooks.guideControls(page)).tier;
  expect(tier, "guide speed tier").toBe("fast");
  // The button shows this route's effective pace (#92), at most the fast tier's top speed (as in 03).
  await expect(speed).toContainText(/fast|早送り/i);
  const pace = Number((await speed.textContent())?.match(/(\d+(?:\.\d+)?)\s*m\/s/)?.[1]);
  expect(pace, "effective guide pace (m/s)").toBeGreaterThan(0);
  expect(pace, "effective guide pace (m/s)").toBeLessThanOrEqual(FAST_MPS);
  return tier;
}

for (const key of STATIONS) {
  for (const w of walks[key]) {
    test(`${key}: follow camera ${w.label} (${w.why}) @phone`, async ({ page }, testInfo) => {
      test.setTimeout(480_000);
      const isPhone = testInfo.project.name.startsWith("phone");
      const k = followConstants();
      const candidate = candidateIdentity();
      await page.addInitScript(LENS_PROBE);
      await openStation(page, key);
      const route = await startWalkUi(page, key, w);
      await page.locator(".sheet .card.route button.primary").click();
      await expect.poll(() => hooks.mode(page)).toBe("guide");
      const guideTier = await selectFastTier(page);
      const wps = routeWaypoints(key, route.steps);

      await startCameraSampler(page, SAMPLE_MS, k.bodyTopM);
      const samples: CameraSample[] = [];
      let t0: number | null = null;
      const drain = async () => {
        const raw = await drainCameraSamples(page);
        t0 ??= raw[0]?.t ?? null;
        const fresh: CameraSample[] = [];
        for (const r of raw) {
          const s = t0 === null ? null : toSample(r, t0, k, wps);
          if (s) fresh.push(s);
        }
        samples.push(...fresh);
        return fresh;
      };

      const frames: Record<string, unknown>[] = [];
      const savedFrames: string[] = [];
      let worst: { nearBlack: number; loop: number; file: string | null } | null = null;
      const seen = new Set<string>();
      const wall0 = Date.now();
      let arrived = false;
      const finalLine = (await hooks.instructions(page)).at(-1) ?? "";
      const isArrival = (t: string) => /arriv|到着/i.test(t) || (finalLine !== "" && t === finalLine);
      const budgetMs = Math.max(90_000, route.totalLengthM * 1000 + 30_000);
      let loop = 0;
      let still = 0;
      let last = "";
      while (Date.now() - wall0 < budgetMs) {
        await page.waitForTimeout(isPhone ? 1500 : 1000);
        const fresh = await drain();
        const latest = fresh.at(-1) ?? samples.at(-1);
        const instruction = await textIf(page, ".hud-instruction");
        if (instruction) seen.add(instruction);

        // Screenshot only on a threshold crossing, plus every 3rd loop (cheap enough on a GPU; SwiftShader is flow-only).
        const reasons: string[] = [];
        if (fresh.some((s) => s.crowded)) reasons.push(`crowded<${CROWDED_M}m`);
        if (fresh.some((s) => s.belowClamp)) reasons.push("below-clamp");
        else if (fresh.some((s) => s.atClamp)) reasons.push("at-clamp");
        if (fresh.some((s) => s.avatarInFrame === false)) reasons.push("avatar-out-of-frame");
        const periodic = loop % 3 === 0;
        let stats: Awaited<ReturnType<typeof imageStats>> | null = null;
        let file: string | null = null;
        if (!FLOW_ONLY && (reasons.length || periodic)) {
          const png = await page.screenshot();
          stats = await imageStats(page, png);
          if (stats.nearBlack > NEAR_BLACK_MAX) reasons.push(`near-black ${stats.nearBlack.toFixed(3)}`);
          if ((reasons.length || loop % 6 === 0) && savedFrames.length < MAX_SAVED_FRAMES) {
            file = shotPath(testInfo, `${key}-camera-${w.label}-${String(loop).padStart(3, "0")}.png`);
            fs.writeFileSync(file, png);
            savedFrames.push(file);
          }
          if (!worst || stats.nearBlack > worst.nearBlack) worst = { nearBlack: stats.nearBlack, loop, file };
        }
        const avatar = await hooks.avatar(page);
        frames.push({
          loop, wallMs: Date.now() - wall0, sampleT: latest?.t ?? null, instruction, avatar, stepMode: latest?.stepMode ?? null,
          headDistance: latest?.headDistance ?? null, atClamp: latest?.atClamp ?? null, crowded: latest?.crowded ?? null,
          fovV: latest?.fovV ?? null, avatarHeightShare: latest?.avatarHeightShare ?? null, stats, reasons, file,
        });
        loop++;
        if ((await toasts(page)).some(isArrival)) arrived = true;
        const pos = JSON.stringify(avatar, (_k, v) => (typeof v === "number" ? Math.round(v * 10) / 10 : v));
        still = pos === last ? still + 1 : 0;
        last = pos;
        if (arrived || still >= 2 || (await hooks.mode(page)) !== "guide") break;
        if (FLOW_ONLY && seen.size >= 2) break;
      }
      await drain();
      await stopCameraSampler(page);
      const end = await hooks.avatar(page);
      await page.waitForTimeout(1000);
      if ((await toasts(page)).some(isArrival)) arrived = true;
      const nodes = new Map(stationData(key).graph.nodes.map((n) => [n.id, n]));
      const goal = nodes.get(route.nodeIds.at(-1))!.position;
      const distToGoal = Math.hypot(end.x - goal.x, end.y - goal.y);

      const summary = summarise(samples, SAMPLE_MS);
      const guideSamples = samples.filter((s) => s.mode === "guide");
      const crowdedSamples = guideSamples.filter((s) => s.crowded).map((s) => ({ t: s.t, headDistance: s.headDistance, stepMode: s.stepMode, avatar: s.avatar }));
      const clampRun = longestRunMs(guideSamples, (s) => s.atClamp, SAMPLE_MS);
      const nearBlackFrames = frames.filter((f) => f.stats && (f.stats as { nearBlack: number }).nearBlack > NEAR_BLACK_MAX).length;
      save(testInfo, `${key}-camera-${w.label}.json`, {
        candidate, station: key, walk: w.label, why: w.why, project: testInfo.project.name, view: await viewInfo(page),
        constants: k, thresholds: { crowdedM: CROWDED_M, nearBlackMax: NEAR_BLACK_MAX, clampRunMaxMs: CLAMP_RUN_MAX_MS, sampleMs: SAMPLE_MS },
        hooks: {
          used: ["sceneInfo().camera", "avatar()", "mode()", "route()", "instructions()", "guideControls()"],
          measuredWithoutHook: ["vertical FOV, aspect, exact camera position, avatar height share (projectionMatrix/viewMatrix uploads, LENS_PROBE)"],
          missing: ["overhead camera-only blocker present (always null)", "follow state: clamped / boom elevation / wanted distance", "yaw/pitch (pivot distance is estimated from head distance)", "a lightweight cameraInfo() (sceneInfo() re-measures two bounding boxes per call)"],
        },
        route: { lengthM: route.totalLengthM, floorChanges: route.floorChanges, stepModes: [...new Set(wps.map((p) => p.mode))] },
        guideTier, arrived, distToGoal, elapsedMs: Date.now() - wall0, instructionsSeenInHud: [...seen],
        result: {
          worstNearBlack: worst, nearBlackFramesOver: nearBlackFrames, screenshots: frames.filter((f) => f.stats).length,
          longestAtClampRunMs: clampRun.ms, fractionAtClamp: summary.guideOnly.fractionAtClamp, fractionBelowClamp: summary.guideOnly.fractionBelowClamp,
          minHeadDistance: summary.guideOnly.headDistance.min, crowdedSamples: crowdedSamples.length, fractionCrowded: summary.guideOnly.fractionCrowded,
          fovVMedian: summary.lens.fovVMedian, fovHMedian: summary.lens.fovHMedian, avatarHeightShareMedian: summary.guideOnly.avatarHeightShare.median,
        },
        summary, crowdedSamples, flaggedFrames: frames.filter((f) => (f.reasons as string[]).length), savedFrames, frames, samples,
      });
      console.log(`[follow-camera] ${key}/${w.label} ${testInfo.project.name} @${candidate.sha?.slice(0, 7) ?? "?"}: ${guideSamples.length} samples, min head dist ${summary.guideOnly.headDistance.min} m, at-clamp ${summary.guideOnly.fractionAtClamp}, crowded ${crowdedSamples.length}, worst near-black ${worst?.nearBlack?.toFixed(3) ?? "n/a"}, FOV ${summary.lens.fovVMedian}`);
      if (crowdedSamples.length) testInfo.annotations.push({ type: "crowded", description: `${crowdedSamples.length} samples with camera-to-head < ${CROWDED_M} m (#70, recorded only); min ${summary.guideOnly.headDistance.min} m` });

      expect.soft(seen.size, "HUD showed several instructions").toBeGreaterThan(1);
      if (FLOW_ONLY) return;
      expect.soft(guideSamples.length, "camera samples taken during the guide").toBeGreaterThan(10);
      expect.soft(summary.lens.samplesWithoutLens, "samples without a measured lens").toBeLessThanOrEqual(Math.ceil(samples.length * 0.1));
      expect.soft(worst?.nearBlack ?? 0, `worst near-black frame (${worst ? `loop ${worst.loop}` : "no screenshots"}, #49 target)`).toBeLessThanOrEqual(NEAR_BLACK_MAX);
      expect.soft(clampRun.ms, `camera held at the ${k.minDistance} m clamp continuously (ms, from t=${clampRun.startT})`).toBeLessThanOrEqual(CLAMP_RUN_MAX_MS);
      expect.soft(distToGoal, "guide ended at the destination (the whole route was sampled)").toBeLessThan(2);
      expect.soft(arrived, "arrival feedback (toast) shown to the user").toBe(true);
    });
  }

  test(`${key}: lens ease on mode changes (first person, end guide, overview) @phone`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const k = followConstants();
    const candidate = candidateIdentity();
    await page.addInitScript(LENS_PROBE);
    await openStation(page, key);
    const w = walks[key][0]!;
    await startWalkUi(page, key, w);
    const hud = (name: RegExp) => page.locator(".hud button").filter({ hasText: name }).first();

    const events: (FovEase & { expectedFov: number | null; kind: "ease" | "snap-by-design" })[] = [];
    const declared = k.declaredFov;
    const run = async (event: string, act: () => Promise<void>, expectedFov: number | null, kind: "ease" | "snap-by-design" = "ease", settleMs = 900) => {
      await startFovRecorder(page);
      await page.waitForTimeout(200);
      await act();
      await page.waitForTimeout(settleMs);
      const rec = await stopFovRecorder(page);
      events.push({ ...analyseFovEase(event, rec), expectedFov, kind });
    };

    // Start guide: overview 60 -> follow.
    await run("start-guide (overview to follow)", async () => {
      await page.locator(".sheet .card.route button.primary").click();
      await expect.poll(() => hooks.mode(page)).toBe("guide");
    }, declared.follow, "ease", 1500);
    await selectFastTier(page);
    await page.waitForTimeout(1500);
    await run("first-person on (guide)", () => hud(/^First person$/).click(), declared.firstPerson);
    await page.waitForTimeout(1000);
    await run("first-person off (guide)", () => hud(/^First person$/).click(), declared.follow);
    await page.waitForTimeout(1000);
    await run("end-guide (guide to walk)", async () => { await hud(/^End guide$/).click(); await expect.poll(() => hooks.mode(page)).toBe("walk"); }, declared.follow);
    await page.waitForTimeout(800);
    await run("first-person on (walk)", () => hud(/^First person$/).click(), declared.firstPerson);
    await page.waitForTimeout(800);
    await run("first-person off (walk)", () => hud(/^First person$/).click(), declared.follow);
    await page.waitForTimeout(800);
    // #136 snaps to the overview lens on purpose ("entering overview snaps to 60"): recorded as a jump, not asserted smooth.
    await run("overview (walk to overview)", async () => { await hud(/^Overview$/).click(); await expect.poll(() => hooks.mode(page)).toBe("overview"); }, declared.overview, "snap-by-design");

    save(testInfo, `${key}-camera-fov-ease.json`, {
      candidate, station: key, project: testInfo.project.name, view: await viewInfo(page), constants: k,
      thresholds: { fovJumpMaxDeg: FOV_JUMP_MAX_DEG, fovToleranceDeg: FOV_TOL_DEG },
      note: "FOV is the perspective projectionMatrix the renderer uploaded (LENS_PROBE), sampled on every animation frame; t = 0 is the click. 'snap-by-design' events are recorded, not asserted smooth.",
      events: events.map((e) => ({ ...e, curve: e.curve })),
    });
    for (const e of events) console.log(`[lens-ease] ${key} ${testInfo.project.name} @${candidate.sha?.slice(0, 7) ?? "?"} ${e.event}: ${e.startFov} -> ${e.endFov} deg, max step ${e.maxStepDeg}, settle ${e.settleMs} ms`);

    expect.soft(events.every((e) => e.startFov !== null && e.endFov !== null), "the lens was measured around every event (a perspective matrix was seen)").toBe(true);
    for (const e of events) {
      if (e.startFov === null || e.endFov === null) continue;
      if (e.kind === "ease") expect.soft(e.maxStepDeg ?? 0, `${e.event}: largest single-frame FOV change (deg)`).toBeLessThanOrEqual(FOV_JUMP_MAX_DEG);
      if (e.expectedFov !== null) expect.soft(Math.abs(e.endFov - e.expectedFov), `${e.event}: final FOV ${e.endFov} vs declared ${e.expectedFov}`).toBeLessThanOrEqual(FOV_TOL_DEG);
    }
  });
}
