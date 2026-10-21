import { expect, test, type Page } from "@playwright/test";
import { hooks, openStation, routeWaypoints, save, shotPath, stationData, STATIONS, type StationKey, type Vec3 } from "../lib/gteki.ts";

/**
 * POI label fade probe. Every POI label is a CSS2D element `.gteki-labels > .poi-label`; the explorer
 * adds class `occluded` when it fades a label because geometry blocks its line of sight. A label must
 * fade only when *drawn* geometry is in its sight line, never because of an invisible camera-only
 * blocker (e.g. a hidden ceiling cap). The page exposes no scene, so this spec cannot judge that: it
 * produces evidence for a human.
 *
 * At about 8 poses along each walking route it takes
 *   a) the live frame as the user sees it,
 *   b) the same frame with the labels hidden (so the geometry alone is visible),
 *   c) b) annotated with one box per visible label at its rect: red = faded by occlusion,
 *      amber = a selected route endpoint faded because it is on another floor (labelState() never
 *      occlusion-fades selected labels, but both states share the `occluded` class), green = shown,
 *      with a cross at the anchor. CSS2DRenderer anchors each label at its object's `center` (0.5, 0.5)
 *      with an inline transform, so the anchor is the centre of the rect.
 * A human reads c) against b): a red label whose anchor has no drawn wall/ceiling/column between it
 * and the camera in b) is the defect. Amber labels are not occlusion evidence. Nothing here asserts
 * the fade judgement itself.
 *
 * Poses re-use the walking conventions of 04/08: walkFromNode() resets yaw to 0, one mouse-look drag
 * (yaw -= dx·0.0042) faces the next waypoint, forward in station ENU is (−sin yaw, cos yaw).
 */
const LOOK_RAD_PER_PX = 0.0042;
const POSES_PER_ROUTE = 8;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// A failed or long run's trace would snapshot every drag; the PNG triples and JSON carry the evidence.
test.use({ trace: "off" });

const routes: Record<StationKey, { label: string; from: string; to: string }[]> = {
  shinjuku: [
    { label: "exit1-oedo", from: "poi:exit:1", to: "poi:platform:oedo" },
    { label: "oedo-exit2", from: "poi:platform:oedo", to: "poi:exit:2" },
  ],
  ikebukuro: [
    { label: "jrc2-exit35", from: "jr-central-gate-2", to: "exit-35" },
  ],
};

interface LabelRect { text: string; x: number; y: number; w: number; h: number; occluded: boolean; selected: boolean; opacity: number; anchor: { x: number; y: number } }

/** Faded because geometry blocks it, as opposed to a selected endpoint faded for being off-floor. */
const occlusionFaded = (l: LabelRect) => l.occluded && !l.selected;
const floorFaded = (l: LabelRect) => l.occluded && l.selected;

async function canvasPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const c = document.querySelector("canvas.gteki-canvas")!.getBoundingClientRect();
    for (const [fx, fy] of [[0.5, 0.45], [0.7, 0.35], [0.3, 0.35], [0.6, 0.6], [0.85, 0.5]]) {
      const x = c.left + c.width * fx!, y = c.top + c.height * fy!;
      const el = document.elementFromPoint(x, y);
      if (el?.classList.contains("gteki-canvas") || el?.classList.contains("gteki-labels")) return { x, y };
    }
    return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
  });
}

async function turn(page: Page, at: { x: number; y: number }, dx: number): Promise<number> {
  let sent = 0;
  while (Math.abs(dx - sent) >= 1) {
    const chunk = Math.max(-500, Math.min(500, Math.round(dx - sent)));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + chunk, at.y, { steps: 2 });
    await page.mouse.up();
    sent += chunk;
  }
  return sent;
}

/** Every label with a laid-out box that intersects the viewport. */
async function visibleLabels(page: Page): Promise<LabelRect[]> {
  return page.evaluate(() => {
    const out: LabelRect[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(".gteki-labels > .poi-label")) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0) continue;
      if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue;
      out.push({
        text: (el.textContent ?? "").trim(),
        x: r.left, y: r.top, w: r.width, h: r.height,
        occluded: el.classList.contains("occluded"),
        selected: el.classList.contains("selected"),
        opacity: Number(getComputedStyle(el).opacity),
        anchor: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      });
    }
    return out;
  });
}

/** Draw the annotation overlay (fixed, viewport coordinates, same as the rects). */
async function drawOverlay(page: Page, labels: LabelRect[], caption: string) {
  await page.evaluate(({ labels, caption }) => {
    document.getElementById("qa-label-overlay")?.remove();
    const root = document.createElement("div");
    root.id = "qa-label-overlay";
    root.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;font:11px/1.2 system-ui,sans-serif";
    const add = (css: string, text = "") => {
      const d = document.createElement("div");
      d.style.cssText = `position:absolute;box-sizing:border-box;${css}`;
      if (text) d.textContent = text;
      root.appendChild(d);
      return d;
    };
    for (const l of labels) {
      const kind = !l.occluded ? "shown" : l.selected ? "floor" : "faded";
      const col = { shown: "#0a9a3a", floor: "#d98a00", faded: "#e0102a" }[kind];
      const bg = { shown: "rgba(10,154,58,0.18)", floor: "rgba(217,138,0,0.18)", faded: "rgba(224,16,42,0.18)" }[kind];
      add(`left:${l.x}px;top:${l.y}px;width:${l.w}px;height:${l.h}px;border:2px solid ${col};background:${bg}`);
      add(`left:${l.x}px;top:${Math.max(0, l.y - 14)}px;max-width:240px;white-space:nowrap;overflow:hidden;padding:0 3px;color:#fff;background:${col}`, `${{ shown: "", floor: "OFF-FLOOR ", faded: "FADED " }[kind]}${l.text}`);
      // Anchor cross: the CSS2D anchor, the centre of the rect.
      add(`left:${l.anchor.x - 8}px;top:${l.anchor.y - 1}px;width:16px;height:2px;background:${col}`);
      add(`left:${l.anchor.x - 1}px;top:${l.anchor.y - 8}px;width:2px;height:16px;background:${col}`);
    }
    add("left:6px;bottom:6px;padding:2px 6px;color:#fff;background:rgba(0,0,0,0.75)", `${caption} | red = faded (occluded), amber = selected endpoint off-floor, green = shown, + = anchor`);
    document.body.appendChild(root);
  }, { labels, caption });
}

/** Indices of `n` items picked evenly, always including the first. */
function evenIndices(n: number, want: number): number[] {
  if (n <= want) return Array.from({ length: n }, (_, i) => i);
  return [...new Set(Array.from({ length: want }, (_, k) => Math.round((k * (n - 1)) / (want - 1))))];
}

for (const key of STATIONS) {
  test(`${key}: POI label fade probe (evidence for human review) @phone`, async ({ page }, testInfo) => {
    test.setTimeout(420_000);
    await openStation(page, key);
    await hooks.setProfile(page, { stepFree: false, unpaidOnly: false, strictHours: false });

    // Resolve every route first, then walk: setOrigin/setDestination must not interleave with poses.
    const resolved: { label: string; steps: { edgeId: string; fromNodeId: string; toNodeId: string; reversed: boolean; mode: string }[] }[] = [];
    for (const r of routes[key]) {
      await hooks.setOrigin(page, r.from);
      await hooks.setDestination(page, r.to);
      const route = await hooks.route(page);
      expect(route?.ok, `${r.label}: route exists`).toBe(true);
      resolved.push({ label: r.label, steps: route.steps });
    }

    const nodes = new Map(stationData(key).graph.nodes.map((n) => [n.id, n]));
    const poses: Record<string, unknown>[] = [];
    let posesWithLabels = 0;
    let totalShown = 0;
    let totalFaded = 0;
    let totalOffFloor = 0;
    let at: { x: number; y: number } | null = null;

    for (const r of resolved) {
      const wps = routeWaypoints(key, r.steps);
      const picks = evenIndices(r.steps.length, POSES_PER_ROUTE);
      for (let n = 0; n < picks.length; n++) {
        const j = picks[n]!;
        const step = r.steps[j]!;
        const base = `${key}-labelfade-${r.label}-${n}`;

        // 1. Stand on the node; yaw is 0 afterwards.
        expect(await hooks.walkFromNode(page, step.fromNodeId), `${r.label}#${n}: ground at ${step.fromNodeId}`).toBe(true);
        await expect.poll(() => hooks.mode(page)).toBe("walk");
        at ??= await canvasPoint(page);
        const pos = await hooks.avatar(page);

        // 2. Face the first waypoint of this step that is not underfoot (else the step's end node).
        const toNode = nodes.get(step.toNodeId)!.position;
        const target: { x: number; y: number } =
          wps.filter((w) => w.stepIndex === j).map((w) => w.p).find((p) => Math.hypot(p.x - pos.x, p.y - pos.y) > 0.3) ?? { x: toNode.x, y: toNode.y };
        const want = Math.atan2(-(target.x - pos.x), target.y - pos.y);
        const dx = Math.round(-wrap(want) / LOOK_RAD_PER_PX);
        let yaw = 0;
        if (Math.abs(dx) >= 2) yaw = wrap(-(await turn(page, at, dx)) * LOOK_RAD_PER_PX);

        // 3. Let the follow camera settle; 4. let the label sweep run in real time.
        const settled: Vec3 = await hooks.simulate(page, 0.5, []);
        await page.waitForTimeout(1200);

        // 5. Collect the visible labels.
        const labels = await visibleLabels(page);

        // 6. Screenshot A, as the user sees it.
        const a = shotPath(testInfo, `${base}-a.png`);
        await page.screenshot({ path: a });

        // 7. Screenshot B with the labels hidden, 7b. then C with the annotation overlay on top of B.
        const style = await page.addStyleTag({ content: ".gteki-labels, .gteki-labels * { visibility: hidden !important; }" });
        const b = shotPath(testInfo, `${base}-b.png`);
        const c = shotPath(testInfo, `${base}-c.png`);
        try {
          await page.screenshot({ path: b });
          await drawOverlay(page, labels, `${base} (${labels.filter(occlusionFaded).length} faded / ${labels.filter(floorFaded).length} off-floor / ${labels.filter((l) => !l.occluded).length} shown)`);
          await page.screenshot({ path: c });
        } finally {
          // 8. Restore labels and remove the overlay.
          await page.evaluate(() => document.getElementById("qa-label-overlay")?.remove());
          await style.evaluate((e) => e.remove());
        }

        // 9. Counts, avatar and camera as the app reports them.
        const counts = await page.evaluate(() => (window as any).__gteki.labels?.() ?? null);
        const avatar = await hooks.avatar(page);
        const camera = await hooks.sceneInfo(page).then((s) => s?.camera ?? null, () => null);

        const faded = labels.filter(occlusionFaded).length;
        const offFloor = labels.filter(floorFaded).length;
        const shown = labels.length - faded - offFloor;
        if (labels.length > 0) posesWithLabels++;
        totalFaded += faded;
        totalOffFloor += offFloor;
        totalShown += shown;
        poses.push({
          route: r.label, n, stepIndex: j, edgeId: step.edgeId, mode: step.mode, fromNodeId: step.fromNodeId,
          start: pos, aimAt: target, dragPx: dx, yawRad: yaw, settled, avatar, camera, counts,
          visible: { total: labels.length, faded, offFloor, shown },
          labels: labels.map((l) => ({ text: l.text, rect: { x: l.x, y: l.y, w: l.w, h: l.h }, anchor: l.anchor, occluded: l.occluded, selected: l.selected, opacity: l.opacity })),
          screenshots: { a, b, c },
        });
      }
    }

    save(testInfo, `${key}-label-fade.json`, { station: key, project: testInfo.project.name, routes: resolved.map((r) => r.label), totalPoses: poses.length, posesWithVisibleLabels: posesWithLabels, totalShown, totalFaded, totalOffFloor, poses });
    console.log(`[label-fade] ${key} ${testInfo.project.name}: ${poses.length} poses, ${posesWithLabels} with visible labels, visible labels shown=${totalShown} faded=${totalFaded} off-floor=${totalOffFloor}`);
    // Only a blank page is flagged; whether any fade is justified is a human call on the C frames.
    expect.soft(poses.length, "poses captured").toBeGreaterThan(0);
    expect.soft(posesWithLabels, `poses with at least one visible label (of ${poses.length})`).toBeGreaterThanOrEqual(Math.ceil(poses.length / 2));
  });
}
