import { expect, test } from "@playwright/test";
import { chooseBySearch, hooks, textIf, toasts, imageStats, labelUiOverlaps, openStation, perfWindow, save, shotPath, stationData, STATIONS, type StationKey } from "../lib/gteki.ts";

/** The HUD's "fast" guide tier (m/s), `GUIDE_TIERS` in apps/web/src/explorer/guidePace.ts. */
const FAST_MPS = 6.8;

/**
 * CI's e2e-smoke sets this: under SwiftShader the explorer runs at ~7 fps and caps each frame at 0.05 s,
 * so a guide advances ~0.35 s per real second and no walk can arrive within the job's budget. Flow-only
 * runs check the UI path (guide starts, fast tier selected, HUD instructions advance) and stop there,
 * without screenshots; arrival, distance and frames stay with GPU runs.
 */
const FLOW_ONLY = !!process.env.GTEKI_GUIDE_FLOW_ONLY;

/**
 * Recorded guided walkthrough driven only through visible UI (search fields, route card buttons,
 * HUD speed control), in real time. The video is the primary L2 evidence; frames are sampled
 * for review and for objective image statistics (exposure, blank frames, label clutter).
 */
const walks: Record<StationKey, { from: [string, RegExp]; to: [string, RegExp]; label: string; gpuOnly?: string }[]> = {
  ikebukuro: [
    { from: ["中央2", /JR Central Gate 2/], to: ["35", /^Exit 35$/], label: "jrc2-exit35" },
    { from: ["West Exit", /^West Exit \(B1\)$/], to: ["West Exit (South)", /^Exit 4$/], label: "westb1-exit4" },
  ],
  shinjuku: [
    { from: ["north side", /street level, north side/], to: ["platform", /Oedo Line platform/], label: "exit1-platform" },
    // Its first instruction is the long escalator up from the platform: under SwiftShader the second one
    // took 96–282 s and sometimes never came within the walk budget, pushing the smoke step to its 10 min
    // cap (#76). exit1-platform already checks the same Shinjuku guide flow in CI.
    { from: ["platform", /Oedo Line platform/], to: ["northwest", /street level, northwest side/], label: "platform-exit2", gpuOnly: "first instruction is a long escalator ride; too slow under SwiftShader (#76)" },
  ],
};

for (const key of STATIONS) {
  for (const w of walks[key]) {
    test(`${key}: guided walk ${w.label} (real UI, recorded) @phone`, async ({ page }, testInfo) => {
      test.skip(FLOW_ONLY && !!w.gpuOnly, w.gpuOnly);
      test.setTimeout(420_000);
      await openStation(page, key);
      const isPhone = testInfo.project.name.startsWith("phone");
      await chooseBySearch(page, "from", w.from[0], w.from[1]);
      await chooseBySearch(page, "to", w.to[0], w.to[1]);
      const route = await hooks.route(page);
      expect(route?.ok, "route exists").toBe(true);
      await page.locator(".sheet .card.route button.primary").click();
      await expect.poll(() => hooks.mode(page)).toBe("guide");

      // The fast tier (top speed FAST_MPS, close to the old ×4 at 1.6 m/s) keeps recordings reviewable; other tiers narrate the same instructions.
      // The tier persists across sessions, so read it and click (cycle order run, fast, walk) until it is "fast".
      const speed = page.locator(".hud button.guide-speed");
      for (let n = 0; n < 3 && (await hooks.guideControls(page)).tier !== "fast"; n++) await speed.click();
      const guideTier = (await hooks.guideControls(page)).tier;
      expect(guideTier, "guide speed tier").toBe("fast");
      // The button shows this route's effective pace (#92): connectors keep believable speeds, so it is at most the top speed.
      await expect(speed).toContainText(/fast|早送り/i);
      const pace = Number((await speed.textContent())?.match(/(\d+(?:\.\d+)?)\s*m\/s/)?.[1]);
      expect(pace, "effective guide pace (m/s)").toBeGreaterThan(0);
      expect(pace, "effective guide pace (m/s)").toBeLessThanOrEqual(FAST_MPS);

      const frames: { t: number; instruction: string | null; avatar: unknown; stats: unknown; overlaps: unknown }[] = [];
      const seen = new Set<string>();
      const t0 = Date.now();
      let arrived = false;
      // A route that ends at an unmodelled connector (e.g. a stair foot below a street exit) says so in
      // its last instruction, and the app toasts that line instead of "arrived" (#21).
      const finalLine = (await hooks.instructions(page)).at(-1) ?? "";
      const isArrival = (t: string) => /arriv|到着/i.test(t) || (finalLine !== "" && t === finalLine);
      // A ceiling against a hung guide, not a pace check: the loop ends as soon as the avatar arrives or
      // parks. Since #64 connectors keep believable speeds (escalators ~1.5 m/s even on fast) and every
      // instruction stays up ≥ 1.8 s, so long Shinjuku descents average far below FAST_MPS; budget 1 m/s.
      const budgetMs = Math.max(90_000, route.totalLengthM * 1000 + 30_000);
      let i = 0;
      let still = 0;
      let stillSince = Date.now();
      let steppedOn = false;
      let last = "";
      const perf = await perfWindow(page, 2);
      while (Date.now() - t0 < budgetMs) {
        await page.waitForTimeout(isPhone ? 4000 : 3000);
        const instruction = await textIf(page, ".hud-instruction");
        if (instruction) seen.add(instruction);
        // Flow-only (CI) takes no frames: under SwiftShader a screenshot can wait past its 15 s timeout for a
        // frame, which made the smoke job flaky (#76); the video and frame stats come from GPU runs.
        const png = FLOW_ONLY ? null : await page.screenshot({ path: shotPath(testInfo, `${key}-walk-${w.label}-${String(i++).padStart(2, "0")}.png`) });
        const avatar = await hooks.avatar(page);
        frames.push({ t: Date.now() - t0, instruction, avatar, stats: png ? await imageStats(page, png) : null, overlaps: png ? await labelUiOverlaps(page) : null });
        // The arrival toast lasts 2.5 s; the probe's observer records it even between samples.
        if ((await toasts(page)).some(isArrival)) arrived = true;
        // Flow-only (CI, SwiftShader) runs the Shinjuku scene at 2–3 fps, so the avatar can move under 0.1 m between
        // samples: compare at 1 cm there, and call it parked only after 20 s without movement (#261). GPU runs keep 0.1 m / 2 samples.
        const q = FLOW_ONLY ? 100 : 10;
        const pos = JSON.stringify(avatar, (_k, v) => (typeof v === "number" ? Math.round(v * q) / q : v));
        if (pos === last) still++;
        else { still = 0; stillSince = Date.now(); }
        last = pos;
        const parked = still >= 2 && (!FLOW_ONLY || Date.now() - stillSince >= 20_000);
        // Playback ended (avatar parked at the end) or the user-visible mode changed.
        if (arrived || parked || (await hooks.mode(page)) !== "guide") break;
        if (FLOW_ONLY && seen.size >= 2) break;
        // Flow-only: the explorer clamps each frame to 50 ms of sim time, so at SwiftShader's 2–3 fps playback runs at
        // ~0.13× and a long first leg (Shinjuku's GL–B1 stair) can outlast the budget on one instruction (#261). After
        // 15 s on the same line, step on with the HUD's own "Next instruction" button, as a user would.
        if (FLOW_ONLY && Date.now() - t0 >= 15_000 && !steppedOn) {
          await page.locator(".guide-next").click();
          steppedOn = true;
        }
      }
      const end = await hooks.avatar(page);
      await page.waitForTimeout(1000);
      if ((await toasts(page)).some(isArrival)) arrived = true;
      const nodes = new Map(stationData(key).graph.nodes.map((n) => [n.id, n]));
      const goal = nodes.get(route.nodeIds.at(-1))!.position;
      const distToGoal = Math.hypot(end.x - goal.x, end.y - goal.y);
      save(testInfo, `${key}-walk-${w.label}.json`, { route: { lengthM: route.totalLengthM, floorChanges: route.floorChanges, instructions: await hooks.instructions(page) }, instructionsSeenInHud: [...seen], steppedOn, toasts: await toasts(page), arrived, guideTier, distToGoal, elapsedMs: Date.now() - t0, end, perf, frames });
      expect.soft(seen.size, "HUD showed several instructions").toBeGreaterThan(1);
      if (FLOW_ONLY) return;
      expect.soft(distToGoal, "guide ended at the destination").toBeLessThan(2);
      expect.soft(arrived, "arrival feedback (toast) shown to the user").toBe(true);
    });
  }
}
