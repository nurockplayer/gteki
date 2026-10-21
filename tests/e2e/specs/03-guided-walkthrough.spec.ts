import { expect, test } from "@playwright/test";
import { chooseBySearch, hooks, textIf, toasts, imageStats, labelUiOverlaps, openStation, perfWindow, save, shotPath, stationData, STATIONS, type StationKey } from "../lib/gteki.ts";

/**
 * Recorded guided walkthrough driven only through visible UI (search fields, route card buttons,
 * HUD speed control), in real time. The video is the primary L2 evidence; frames are sampled
 * for review and for objective image statistics (exposure, blank frames, label clutter).
 */
const walks: Record<StationKey, { from: [string, RegExp]; to: [string, RegExp]; label: string }[]> = {
  ikebukuro: [
    { from: ["中央2", /JR Central Gate 2/], to: ["35", /^Exit 35$/], label: "jrc2-exit35" },
    { from: ["West Exit", /^West Exit \(B1\)$/], to: ["West Exit (South)", /^Exit 4$/], label: "westb1-exit4" },
  ],
  shinjuku: [
    { from: ["north side", /street level, north side/], to: ["platform", /Oedo Line platform/], label: "exit1-platform" },
    { from: ["platform", /Oedo Line platform/], to: ["northwest", /street level, northwest side/], label: "platform-exit2" },
  ],
};

for (const key of STATIONS) {
  for (const w of walks[key]) {
    test(`${key}: guided walk ${w.label} (real UI, recorded) @phone`, async ({ page }, testInfo) => {
      test.setTimeout(420_000);
      await openStation(page, key);
      const isPhone = testInfo.project.name.startsWith("phone");
      await chooseBySearch(page, "from", w.from[0], w.from[1]);
      await chooseBySearch(page, "to", w.to[0], w.to[1]);
      const route = await hooks.route(page);
      expect(route?.ok, "route exists").toBe(true);
      await page.locator(".sheet .card.route button.primary").click();
      await expect.poll(() => hooks.mode(page)).toBe("guide");

      // ×4 playback keeps recordings reviewable; at ×1 the HUD shows the same instructions.
      const speed = page.locator(".hud button", { hasText: /×/ });
      await speed.click();
      await speed.click();
      await expect(speed).toContainText("×4");

      const frames: { t: number; instruction: string | null; avatar: unknown; stats: unknown; overlaps: unknown }[] = [];
      const seen = new Set<string>();
      const t0 = Date.now();
      let arrived = false;
      const budgetMs = Math.max(60_000, (route.totalLengthM / (1.6 * 4)) * 1000 * 1.6 + 20_000);
      let i = 0;
      let still = 0;
      let last = "";
      const perf = await perfWindow(page, 2);
      while (Date.now() - t0 < budgetMs) {
        await page.waitForTimeout(isPhone ? 4000 : 3000);
        const instruction = await textIf(page, ".hud-instruction");
        if (instruction) seen.add(instruction);
        const png = await page.screenshot({ path: shotPath(testInfo, `${key}-walk-${w.label}-${String(i++).padStart(2, "0")}.png`) });
        const avatar = await hooks.avatar(page);
        frames.push({ t: Date.now() - t0, instruction, avatar, stats: await imageStats(page, png), overlaps: await labelUiOverlaps(page) });
        // The arrival toast lasts 2.5 s; the probe's observer records it even between samples.
        if ((await toasts(page)).some((t) => /arriv|到着/i.test(t))) arrived = true;
        const pos = JSON.stringify(avatar, (_k, v) => (typeof v === "number" ? Math.round(v * 10) / 10 : v));
        still = pos === last ? still + 1 : 0;
        last = pos;
        // Playback ended (avatar parked at the end) or the user-visible mode changed.
        if (arrived || still >= 2 || (await hooks.mode(page)) !== "guide") break;
      }
      const end = await hooks.avatar(page);
      await page.waitForTimeout(1000);
      if ((await toasts(page)).some((t) => /arriv|到着/i.test(t))) arrived = true;
      const nodes = new Map(stationData(key).graph.nodes.map((n) => [n.id, n]));
      const goal = nodes.get(route.nodeIds.at(-1))!.position;
      const distToGoal = Math.hypot(end.x - goal.x, end.y - goal.y);
      save(testInfo, `${key}-walk-${w.label}.json`, { route: { lengthM: route.totalLengthM, floorChanges: route.floorChanges, instructions: await hooks.instructions(page) }, instructionsSeenInHud: [...seen], arrived, distToGoal, elapsedMs: Date.now() - t0, end, perf, frames });
      expect.soft(distToGoal, "guide ended at the destination").toBeLessThan(2);
      expect.soft(arrived, "arrival feedback (toast) shown to the user").toBe(true);
      expect.soft(seen.size, "HUD showed several instructions").toBeGreaterThan(1);
    });
  }
}
