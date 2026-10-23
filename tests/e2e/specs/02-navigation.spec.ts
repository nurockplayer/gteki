import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { chooseBySearch, hooks, textIf, openStation, save, shotPath, stationData, STATIONS, type StationKey } from "../lib/gteki.ts";

interface Scenario { id: string; from: string; to: string; expect: "ok" | "fail" | "record"; profile?: Record<string, boolean>; walk?: boolean; note: string }
const scenarios = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../fixtures/scenarios.json"), "utf8")) as Record<StationKey, Scenario[]>;

const RESET = { stepFree: false, unpaidOnly: false, strictHours: false };

/**
 * Navigation regression through the real explorer (same router, same UI state the user sees).
 * Goldens pin each route's shape; a change must be reviewed, not silently accepted.
 */
for (const key of STATIONS) {
  test.describe(`${key} navigation`, () => {
    test(`${key}: scenario goldens and fail-closed cases`, async ({ page }, testInfo) => {
      await openStation(page, key);
      const { graph } = stationData(key);
      const edges = new Map(graph.edges.map((e) => [e.id, e]));
      const summaries: Record<string, unknown> = {};
      for (const s of scenarios[key]) {
        await hooks.setProfile(page, { ...RESET, ...s.profile });
        expect(await hooks.setOrigin(page, s.from), `${s.id} origin ${s.from}`).toBe(true);
        expect(await hooks.setDestination(page, s.to), `${s.id} destination ${s.to}`).toBe(true);
        const r = await hooks.route(page);
        const instructions = await hooks.instructions(page);
        const usedModes = r?.ok ? [...new Set((r.steps as { edgeId: string }[]).map((st) => edges.get(st.edgeId)?.mode ?? "?"))] : [];
        const summary = r?.ok
          ? {
              ok: true, lengthM: Math.round(r.totalLengthM * 10) / 10, seconds: Math.round(r.estimatedSeconds), floorChanges: r.floorChanges,
              crossesFareBoundary: r.crossesFareBoundary, synthetic: r.synthetic, unknowns: r.unknowns.map((u: { kind: string; edgeIds: string[] }) => `${u.kind}×${u.edgeIds.length}`),
              stale: r.stale, sources: r.sourceIds.length, nodes: r.nodeIds.length, modes: usedModes, instructions,
              // Exact route shape: ordered edges with traversal direction.
              steps: (r.steps as { edgeId: string; reversed: boolean }[]).map((st) => `${st.reversed ? "<" : ">"}${st.edgeId}`),
            }
          : { ok: false, reason: r?.reason ?? null, uiCard: await textIf(page, ".sheet .card") };
        summaries[s.id] = { ...s, result: summary };

        if (s.expect === "ok") expect.soft(r?.ok, `${s.id} should route: ${s.note}`).toBe(true);
        if (s.expect === "fail") expect.soft(r?.ok, `${s.id} must fail closed: ${s.note}`).toBe(false);
        if (r?.ok) {
          expect.soft(r.synthetic, `${s.id} real station route marked synthetic`).toBe(false);
          expect.soft(r.sourceIds.length, `${s.id} route without sources`).toBeGreaterThan(0);
          // Step-free routes may never use stairs or escalators.
          if (s.profile?.stepFree) expect.soft(usedModes.filter((m) => /stair|escalator/.test(m)), `${s.id} step-free used`).toEqual([]);
          // Outside-gates routes may never cross the fare line.
          if (s.profile?.unpaidOnly) expect.soft(r.crossesFareBoundary, `${s.id} unpaid-only crossed fare`).not.toBe(true);
          // Unknown facts must be visible on the route card.
          if (r.unknowns.length) await expect.soft(page.locator(".sheet .badge.unknown").first()).toBeVisible();
        } else if (r) {
          await expect.soft(page.locator(".sheet .card.no-route"), `${s.id} refusal shown to user`).toBeVisible();
        }
      }
      save(testInfo, `${key}-navigation.json`, summaries);
      // The golden is byte-for-byte an input of stations/ikebukuro/pipeline/build_kit_catalog.py (its sha256 is in
      // kit_catalog.json), so it keeps the same shape as main, `stale` included.
      expect(JSON.stringify(summaries, null, 2)).toMatchSnapshot(`${key}-routes.json`);
    });

    test(`${key}: deep link restores the same route after reload`, async ({ page }) => {
      const s = scenarios[key][0]!;
      await openStation(page, key, `&from=${encodeURIComponent(s.from)}&to=${encodeURIComponent(s.to)}`);
      const a = await hooks.route(page);
      await page.reload();
      await page.waitForFunction(() => (window as any).__gteki?.phase?.() === "ready", null, { timeout: 120_000 });
      const b = await hooks.route(page);
      expect(a?.ok).toBe(true);
      expect(b?.nodeIds).toEqual(a?.nodeIds);
    });
  });
}

/** One route per station picked purely through the visible search UI, as a user would. */
const uiPicks: Record<StationKey, { from: [string, RegExp]; to: [string, RegExp]; alias: [string, RegExp] }> = {
  ikebukuro: { from: ["中央2", /JR Central Gate 2/], to: ["35", /^Exit 35$/], alias: ["東口", /East Exit/] },
  shinjuku: { from: ["exit", /street level, north side/], to: ["大江戸", /Oedo Line platform/], alias: ["トイレ", /Toilet/] },
};

for (const key of STATIONS) {
  test(`${key}: search UI → route card → instruction preview @phone`, async ({ page }, testInfo) => {
    await openStation(page, key);
    const p = uiPicks[key];
    // Alias / Japanese query finds something on this station.
    await page.locator("#gteki-to").click();
    await page.locator("#gteki-to").pressSequentially(p.alias[0], { delay: 40 });
    await expect(page.locator(".field-to .results .result-name", { hasText: p.alias[1] }).first()).toBeVisible();
    await page.keyboard.press("Escape");

    await chooseBySearch(page, "from", p.from[0], p.from[1]);
    await chooseBySearch(page, "to", p.to[0], p.to[1]);
    const card = page.locator(".sheet .card.route");
    await expect(card).toBeVisible();
    await expect(card.locator(".route-head")).toContainText(/min/);
    await expect(card.locator(".instructions li").first()).toBeVisible();
    // Freshness is a calendar verdict (sources older than the core's staleAfterDays, 730 by default), so a
    // stale route must say so on the card; Ikebukuro's 2022 guide is past it.
    const stale = (await hooks.route(page))?.stale;
    const staleBadge = await card.locator(".badge.warn", { hasText: /Possibly outdated|情報が古い可能性/ }).isVisible();
    save(testInfo, `${key}-route-card.json`, { stale: stale ?? null, staleBadge });
    expect.soft(typeof stale, "route() reports a freshness verdict").toBe("boolean");
    if (stale === true) expect.soft(staleBadge, "stale route says so on the card").toBe(true);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: shotPath(testInfo, `${key}-03-route-card.png`) });
    // Clicking an instruction frames that segment in the overview.
    const items = card.locator(".instructions li");
    const n = await items.count();
    if (n > 2) {
      await items.nth(Math.floor(n / 2)).click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: shotPath(testInfo, `${key}-04-instruction-preview.png`) });
    }
    // Provenance is one click away.
    await card.locator("details.provenance summary").click();
    await expect(card.locator("details.provenance li").first()).toBeVisible();
    save(testInfo, `${key}-search-ui.json`, { instructions: await hooks.instructions(page), url: page.url() });
  });
}
