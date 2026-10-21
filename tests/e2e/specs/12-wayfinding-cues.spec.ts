import { expect, test } from "@playwright/test";
import { chooseBySearch, hooks, openStation, save, shotPath, textIf, toasts } from "../lib/gteki.ts";
import { aheadWithin, cuesAlong, gaps, project, round, routeLine, stagnantRuns } from "../lib/cues.ts";

/**
 * Ikebukuro wayfinding cues along the long B1 passages, #108 (A4: repetitive passages). Acceptance, for the
 * guided legs `westb1-exit4` (187 m) and `jrc2-exit35`:
 *
 *   1. At least one distinct, reference-grounded cue (sign, junction, ...) within roughly every 30 m of the
 *      leg, and no two consecutive frames interchangeable.
 *   2. Facts only, 3. phone tier (`low`) holds, 4. a side-by-side review names each cue's source.
 *
 * Drives the same UI path as 03 (search fields, Start guide, HUD "fast" tier) and samples every ~2 s
 * (~3 s on phones): HUD instruction, avatar position, progress along the route and the cues ahead.
 *
 * Which cues exist is decided by the route geometry, not by the screen. The app exposes no hook for
 * on-screen signs (none in main, none in #126, which only adds `signage.json` entries), so cues come from
 * the files the scene builds from, read from GTEKI_ROOT: signs in `stations/ikebukuro/scene/signage.json`
 * (counted when within 8 m horizontally and 4 m vertically of the route; #126's `sign-rep-*` repeaters are
 * in that file only on a candidate that includes them), junctions (interior route nodes of graph degree >= 3)
 * and, recorded as a separate list, the "access unverified" fences. Facts-only (2) and the phone-tier
 * independence of cues (3) are not machine-checkable here; they stay with the side-by-side review (4).
 *
 * Hard (soft-expect) asserts: the route exists, the guide starts on the fast tier, several HUD instructions
 * appear, and the largest gap between consecutive sign/junction cues along the leg (start and end count as
 * boundaries) is <= 30 m. That gap is pure geometry, so it is asserted in flow-only CI runs too.
 *
 * Recorded only: every cue with its arc length, gaps incl. fences, the front-facing-only gap (a sign whose
 * `facing` points against the walking direction shows its front to the walker; double-sided signs are
 * readable both ways, so this is a stricter, advisory view), per-sample cue ids within 25 m ahead as a
 * rough proxy for what is on screen (no line of sight or frustum test), stagnant runs (identical HUD
 * instruction and cues ahead over more than 30 m of travel), and a few frames. A long identical
 * instruction ("Turn left, ~152 m") alone is expected; the runs flag stretches where nothing else changes.
 *
 * This spec does not replace the human side-by-side review the issue asks for.
 */

const FAST_MPS = 6.8;
const FLOW_ONLY = !!process.env.GTEKI_GUIDE_FLOW_ONLY;
const MAX_GAP_M = 30;
const AHEAD_M = 25;

const walks = [
  { from: ["中央2", /JR Central Gate 2/] as [string, RegExp], to: ["35", /^Exit 35$/] as [string, RegExp], label: "jrc2-exit35" },
  { from: ["West Exit", /^West Exit \(B1\)$/] as [string, RegExp], to: ["West Exit (South)", /^Exit 4$/] as [string, RegExp], label: "westb1-exit4" },
];

for (const w of walks) {
  test(`ikebukuro: wayfinding cues along ${w.label} (guided, sampled) @phone`, async ({ page }, testInfo) => {
    test.setTimeout(420_000);
    const key = "ikebukuro";
    await openStation(page, key);
    const isPhone = testInfo.project.name.startsWith("phone");
    await chooseBySearch(page, "from", w.from[0], w.from[1]);
    await chooseBySearch(page, "to", w.to[0], w.to[1]);
    const route = await hooks.route(page);
    expect(route?.ok, "route exists").toBe(true);

    // Cue geometry first: it depends only on the route and the station files.
    const steps = route.steps as { edgeId: string; fromNodeId: string; toNodeId: string; reversed: boolean; mode: string }[];
    const line = routeLine(key, steps);
    const cues = cuesAlong(key, line, route.nodeIds as string[]);
    const primary = cues.filter((c) => c.type !== "fence");
    const g = gaps(primary, line.lengthM);
    const gWithFences = gaps(cues, line.lengthM);
    const gFront = gaps(primary.filter((c) => c.type === "junction" || (c.facingDot ?? 0) < 0), line.lengthM);

    await page.locator(".sheet .card.route button.primary").click();
    await expect.poll(() => hooks.mode(page)).toBe("guide");
    const speed = page.locator(".hud button.guide-speed");
    for (let n = 0; n < 3 && (await hooks.guideControls(page)).tier !== "fast"; n++) await speed.click();
    const guideTier = (await hooks.guideControls(page)).tier;
    expect(guideTier, "guide speed tier").toBe("fast");
    await expect(speed).toContainText(`${FAST_MPS} m/s`);

    const samples: { i: number; tMs: number; instruction: string | null; avatar: { x: number; y: number; z: number }; sM: number; lateralM: number; ahead: string[]; nextCue: { id: string; type: string; aheadM: number } | null; key: string; frame: string | null }[] = [];
    const seen = new Set<string>();
    const t0 = Date.now();
    let arrived = false, still = 0, lastPos = "", sPrev = 0, frames = 0;
    const finalLine = (await hooks.instructions(page)).at(-1) ?? "";
    const isArrival = (t: string) => /arriv|到着/i.test(t) || (finalLine !== "" && t === finalLine);
    const budgetMs = Math.max(90_000, route.totalLengthM * 1000 + 30_000);
    for (let i = 0; Date.now() - t0 < budgetMs; i++) {
      await page.waitForTimeout(isPhone ? 3000 : 2000);
      const instruction = await textIf(page, ".hud-instruction");
      if (instruction) seen.add(instruction);
      const avatar = await hooks.avatar(page);
      const pr = project(line, avatar, Math.max(0, sPrev - 3));
      sPrev = Math.max(sPrev, pr.s);
      const ahead = aheadWithin(cues, pr.s, AHEAD_M);
      const next = cues.find((c) => c.s > pr.s + 0.5) ?? null;
      // A few frames only (every 4th sample, at most 8): software rasterisers time out on screenshots (#76), so never in flow-only runs.
      let frame: string | null = null;
      if (!FLOW_ONLY && i % 4 === 0 && frames < 8) {
        try { const p = shotPath(testInfo, `ikebukuro-cues-${w.label}-${String(i).padStart(2, "0")}.png`); await page.screenshot({ path: p, timeout: 10_000 }); frame = p; frames++; } catch { frame = null; }
      }
      samples.push({
        i, tMs: Date.now() - t0, instruction, avatar, sM: round(pr.s), lateralM: round(pr.lateralM),
        ahead: ahead.map((c) => c.id), nextCue: next ? { id: next.id, type: next.type, aheadM: round(next.s - pr.s) } : null,
        key: `${instruction ?? ""}|${ahead.filter((c) => c.type !== "fence").map((c) => c.id).join(",")}`, frame,
      });
      if ((await toasts(page)).some(isArrival)) arrived = true;
      const pos = JSON.stringify(avatar, (_k, v) => (typeof v === "number" ? Math.round(v * 10) / 10 : v));
      still = pos === lastPos ? still + 1 : 0;
      lastPos = pos;
      if (arrived || still >= 2 || (await hooks.mode(page)) !== "guide") break;
      if (FLOW_ONLY && seen.size >= 2) break;
    }
    const runs = stagnantRuns(samples, 30);
    const consecutiveIdentical = samples.slice(1).filter((s, k) => s.key === samples[k]!.key).length;

    save(testInfo, `ikebukuro-cues-${w.label}.json`, {
      project: testInfo.project.name, quality: await hooks.quality(page), guideTier, flowOnly: FLOW_ONLY, arrived,
      route: { lengthM: route.totalLengthM, horizontalLengthM: round(line.lengthM), nodeIds: route.nodeIds, instructions: await hooks.instructions(page) },
      sources: { signage: "stations/ikebukuro/scene/signage.json", repeaterSigns: cues.filter((c) => c.repeater).length, signsOnRoute: cues.filter((c) => c.type === "sign").length, junctionsOnRoute: cues.filter((c) => c.type === "junction").length, fencesOnRoute: cues.filter((c) => c.type === "fence").length },
      thresholds: { maxGapM: MAX_GAP_M, aheadM: AHEAD_M },
      gaps: { signsAndJunctions: g, withFences: { maxGapM: gWithFences.maxGapM, from: gWithFences.from, to: gWithFences.to }, frontFacingOnly: { maxGapM: gFront.maxGapM, from: gFront.from, to: gFront.to } },
      cues: cues.map((c) => ({ ...c, s: round(c.s), lateralM: round(c.lateralM), facingDot: c.facingDot === undefined ? undefined : round(c.facingDot, 2) })),
      note: "Cue spacing is decided by the route geometry; `ahead` per sample is the cues within 25 m ahead along the route, a rough proxy for what is on screen (no line of sight or frustum test).",
      progress: { reachedM: round(sPrev), samples: samples.length },
      stagnantRuns: runs, consecutiveSamplesWithIdenticalKey: consecutiveIdentical,
      instructionsSeenInHud: [...seen], toasts: await toasts(page), elapsedMs: Date.now() - t0,
      samples,
    });

    expect.soft(seen.size, "HUD showed several instructions").toBeGreaterThan(1);
    // The route geometry decides cue spacing; this holds whether or not the walk completed on this machine.
    expect.soft(g.maxGapM, `largest gap (m) between cues (${g.from} -> ${g.to}) on ${w.label}; the route geometry, not the screen, decides this`).toBeLessThanOrEqual(MAX_GAP_M);
    if (!FLOW_ONLY) expect.soft(sPrev, "the sampled walk covered the leg (m)").toBeGreaterThanOrEqual(line.lengthM * 0.9);
  });
}
