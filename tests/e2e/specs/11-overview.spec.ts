import { expect, test } from "@playwright/test";
import { chooseBySearch, hooks, imageStats, labelUiOverlaps, openStation, save, shotPath, stationData, STATIONS } from "../lib/gteki.ts";
import { anchorSpread, labelBoxes, overlapPairs, settleLabels } from "../lib/overview.ts";
// Long guided walks: a retained trace would fill the disk (see protocol.md, host limits).
test.use({ trace: "off" });

/**
 * Explorer overview acceptance, #109 (C5: the opening view doesn't orient). The overview is the first
 * thing a user sees; this spec opens each station, waits as 01 does, screenshots the overview and
 * measures it against the numbers in #109's "Acceptance" section:
 *
 *   1. Framing: the routable slice fills roughly 50-80 % of the viewport's shorter side (desktop 1440x900,
 *      phones 393x659 and 412x839).
 *   2. Readable image: near-black <= 30 %, mean luminance about 40-200/255.
 *   3. No overlapping labels: visible POI labels don't overlap, while start/destination and exits stay reachable.
 *   4. No regression: C1 (no label painted over UI; the 09 label fade is its own spec).
 *
 * Hard (soft-expect) asserts: near-black, mean luminance, zero overlaps among visible non-faded labels,
 * C1, overview mode on open, an exit label on screen, and the framing proxy below (50-80 %).
 *
 * Recorded only: the full label list with rects, faded-label overlaps, label counts per category,
 * `__gteki.labels()`, camera position, the screenshot's stats, and (when the app offers them) a direct
 * measure of the routable slice's projected extent.
 *   - Framing: #114 (fc4e5c6) adds `__gteki.overviewFrame()` → `{ extentShare, viewportShare, fitShare, bbox }`
 *     (null outside overview): `viewportShare` (since #109 part b: the larger projected side over the
 *     viewport's shorter side) is asserted in the band when the hook exists; `extentShare` is the same over
 *     the free area, which exceeds 1 on an occluded phone and is recorded only. Both are measured on the
 *     network's actual edge points. Without it (main
 *     before #114) framing falls back to a proxy from label anchors: `labelSpread` from `labelUiOverlaps`
 *     (all visible labels) and the spread of the *routable* labels (those not marked `search-only`, i.e.
 *     anchored on a graph node). Anchors lie inside the slice, so the spread is a lower bound of its extent:
 *     > 80 % is a clear miss, < 50 % may be a miss or labels hidden at the edge. Both are always recorded.
 *   - "Reachable": #114 hides the lower-priority label of two colliding labels (display: none) until the user
 *     zooms in, but keeps start/destination always and exits ahead of everything but those. So reachable
 *     means (a) at least one exit label is on screen, and (b) an exit whose label is hidden can still be
 *     chosen through the search UI and then shows as a selected label. (b) runs last, only when such a
 *     label exists, and is a soft assert; it never runs on a build without the declutter.
 *
 * This spec does not replace human review of the frames: it cannot judge whether the view orients a person.
 */

const FRAMING = { min: 0.5, max: 0.8 }; // share of the shorter viewport side (#109 acceptance 1)
const NEAR_BLACK_MAX = 0.3; // #109 acceptance 2
const MEAN_LUMA = { min: 40, max: 200 }; // of 255

for (const key of STATIONS) {
  test(`${key}: overview frames the slice, reads clearly and declutters labels @phone`, async ({ page }, testInfo) => {
    await openStation(page, key);
    // 01 waits 1.5 s after ready; the declutter (#114) runs 80 ms after the camera settles, so also wait for the label count to stop moving.
    await page.waitForTimeout(1500);
    const labelsSettled = await settleLabels(page);
    const mode = await hooks.mode(page);
    expect.soft(mode, "the opening view is the overview").toBe("overview");

    const png = await page.screenshot({ path: shotPath(testInfo, `${key}-11-overview.png`) });
    const stats = await imageStats(page, png);
    const smoke = await labelUiOverlaps(page);
    const { view, boxes } = await labelBoxes(page);

    // Overlaps among labels the user can read: painted, on screen, not faded.
    const visible = boxes.filter((b) => b.visible);
    const readable = visible.filter((b) => !b.faded);
    const overlapsReadable = overlapPairs(readable);
    const overlapsAll = overlapPairs(visible);

    // Framing proxy (see header).
    const spreadAll = anchorSpread(visible, view);
    const routable = visible.filter((b) => !b.searchOnly);
    const spreadRoutable = anchorSpread(routable, view);

    // The direct measure (#114's overviewFrame), or null on builds without it.
    const framingDirect = await page.evaluate(() => {
      const g = (window as any).__gteki;
      try {
        if (typeof g.overviewFrame === "function") return { source: "overviewFrame", value: g.overviewFrame() };
        const info = g.sceneInfo();
        if (info && info.overview !== undefined) return { source: "sceneInfo.overview", value: info.overview };
      } catch { /* a hook that throws is recorded as absent */ }
      return null;
    });

    // #114 (d940021+) frames into the area the panel leaves free and reports it as `visibleRect` (page CSS px).
    // Check that independently: the slice's projected bbox lies inside it, and the rect itself is clear of the panel.
    const placement = await page.evaluate((f) => {
      const v = f?.value?.visibleRect, b = f?.value?.bbox;
      if (!v || !b) return null;
      const inter = (a: { x0: number; y0: number; x1: number; y1: number }, c: { x0: number; y0: number; x1: number; y1: number }) =>
        Math.max(0, Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0)) * Math.max(0, Math.min(a.y1, c.y1) - Math.max(a.y0, c.y0));
      const vr = { x0: v.x, y0: v.y, x1: v.x + v.w, y1: v.y + v.h };
      const area = (r: { x0: number; y0: number; x1: number; y1: number }) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
      const panel = [...document.querySelectorAll<HTMLElement>(".panel")].find((e) => e.offsetParent !== null)?.getBoundingClientRect();
      const pr = panel ? { x0: panel.left, y0: panel.top, x1: panel.right, y1: panel.bottom } : null;
      return {
        visibleRect: v, bbox: b, panel: pr,
        bboxInsideShare: area(b) ? inter(b, vr) / area(b) : null,
        bboxUnderPanelShare: pr && area(b) ? inter(b, pr) / area(b) : null,
        visibleUnderPanelShare: pr && area(vr) ? inter(vr, pr) / area(vr) : null,
        centreOffset: { x: (b.x0 + b.x1) / 2 - (vr.x0 + vr.x1) / 2, y: (b.y0 + b.y1) / 2 - (vr.y0 + vr.y1) / 2 },
      };
    }, framingDirect);

    // Exits: present in the DOM, on screen, and which ones the declutter hid.
    const exits = boxes.filter((b) => b.category === "exit");
    const exitsVisible = exits.filter((b) => b.visible);
    const exitsHidden = exits.filter((b) => b.hiddenByStyle);
    const data = stationData(key);
    const exitPois = data.pois.filter((p) => p.category === "exit");
    const byCategory: Record<string, { dom: number; visible: number }> = {};
    for (const b of boxes) {
      const c = (byCategory[b.category ?? "?"] ??= { dom: 0, visible: 0 });
      c.dom++;
      if (b.visible) c.visible++;
    }

    // Reachability of a hidden exit through the UI (runs after every measurement above: it changes the selection).
    let reach: { label: string; shownAfterSelect: boolean | null; error?: string } | null = null;
    const target = exitsHidden.find((b) => b.text && !b.searchOnly) ?? null;
    if (target) {
      try {
        const esc = target.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        await chooseBySearch(page, "to", target.text, new RegExp(`^${esc}$`));
        await page.waitForTimeout(500);
        await settleLabels(page, 400, 4000);
        const after = (await labelBoxes(page)).boxes;
        reach = { label: target.text, shownAfterSelect: after.some((b) => b.text === target.text && b.selected && b.visible) };
      } catch (e) {
        reach = { label: target.text, shownAfterSelect: null, error: String(e).slice(0, 300) };
      }
    }

    save(testInfo, `${key}-overview.json`, {
      project: testInfo.project.name,
      quality: await hooks.quality(page),
      mode, view, labelsSettled,
      thresholds: { framing: FRAMING, nearBlackMax: NEAR_BLACK_MAX, meanLuma: MEAN_LUMA },
      stats,
      framing: { proxy: "label anchors; a lower bound of the slice extent", all: spreadAll, routable: spreadRoutable, labelSpreadFromSmoke: smoke.labelSpread, framingDirect, placement },
      labels: {
        domCount: boxes.length, visibleCount: visible.length, readableCount: readable.length,
        hooksLabels: await page.evaluate(() => (window as any).__gteki.labels()),
        byCategory,
        overlapsReadable, overlapsAllVisible: overlapsAll, labelLabelOverlapsFromSmoke: smoke.labelLabelOverlaps,
        uiOverlaps: smoke.uiOverlaps,
        boxes: boxes.map((b) => ({ ...b, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) })),
      },
      exits: { inData: exitPois.length, inDom: exits.length, visible: exitsVisible.map((b) => b.text), hiddenByStyle: exitsHidden.map((b) => b.text), reach },
    });

    // 2. Readable image.
    expect.soft(stats.nearBlack, "near-black share of the overview frame").toBeLessThanOrEqual(NEAR_BLACK_MAX);
    expect.soft(stats.mean, "mean luminance of the overview frame (/255)").toBeGreaterThanOrEqual(MEAN_LUMA.min);
    expect.soft(stats.mean, "mean luminance of the overview frame (/255)").toBeLessThanOrEqual(MEAN_LUMA.max);
    // 3. No overlapping labels among those the user can read.
    expect.soft(overlapsReadable, "visible, non-faded POI labels overlapping each other").toEqual([]);
    // 4. C1: labels never above the UI.
    expect.soft(smoke.uiOverlaps.filter((o) => o.labelOnTop), "POI labels painted over UI controls").toEqual([]);
    // 1. Framing: the direct measure when the app has it, else the label-anchor proxy.
    // `viewportShare` is #109's measure: the free-rect share can read over 1 when the map deliberately
    // reaches past a short phone band, so the band is checked against the viewport's shorter side.
    const viewportShare = framingDirect?.source === "overviewFrame" ? framingDirect.value?.viewportShare : undefined;
    if (typeof viewportShare === "number") {
      expect.soft(viewportShare, "routable network extent / shorter viewport side (overviewFrame)").toBeGreaterThanOrEqual(FRAMING.min);
      expect.soft(viewportShare, "routable network extent / shorter viewport side (overviewFrame)").toBeLessThanOrEqual(FRAMING.max);
    } else if (spreadRoutable.spread !== null) {
      expect.soft(spreadRoutable.spread, "spread of routable label anchors / shorter viewport side (proxy for the slice)").toBeGreaterThanOrEqual(FRAMING.min);
      expect.soft(spreadRoutable.spread, "spread of routable label anchors / shorter viewport side (proxy for the slice)").toBeLessThanOrEqual(FRAMING.max);
    } else {
      expect.soft(spreadRoutable.count, "at least two routable labels on screen to measure framing").toBeGreaterThanOrEqual(2);
    }
    // The slice sits in the area the UI leaves free (#114 P1: on phones it used to sit under the panel).
    if (placement) {
      expect.soft(placement.bboxInsideShare, "share of the slice bbox inside overviewFrame().visibleRect").toBeGreaterThanOrEqual(0.95);
      if (placement.bboxUnderPanelShare !== null) expect.soft(placement.bboxUnderPanelShare, "share of the slice bbox under the search panel").toBeLessThanOrEqual(0.05);
    }
    // Exits stay reachable.
    expect.soft(exits.length, "exit labels in the DOM").toBeGreaterThan(0);
    expect.soft(exitsVisible.length, "exit labels on screen in the overview").toBeGreaterThan(0);
    if (reach) {
      expect.soft(reach.error ?? null, "choosing a hidden exit through search").toBeNull();
      expect.soft(reach.shownAfterSelect, `hidden exit "${reach.label}" shows once chosen as destination`).toBe(true);
    }
  });
}
