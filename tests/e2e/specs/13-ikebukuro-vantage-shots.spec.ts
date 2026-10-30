import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { hooks, openStation, stationData } from "../lib/gteki.ts";

/**
 * Vantage-shot probe for Ikebukuro (#94 gates and rails, #181 street pavement plane): a fixed set of "vantage"
 * spots, four headings each, one full-viewport screenshot per view plus the draw calls and triangles of the frame
 * counted at the WebGL boundary (every pass, shadow and post included, as in spec 10). Measurement and evidence,
 * not a visual golden: nothing is compared against a baseline here. Run it once per candidate build (and per
 * tier) and compare the PNGs and the tables side by side.
 *
 * Frame time (#352, #324, #353). With GTEKI_VANTAGE_FRAMETIME_MS=<ms> set, each view also measures frame pacing
 * before its screenshot: requestAnimationFrame in the page for that long, recording the performance.now() gap
 * between consecutive frames (p50, p95, max and the frame count, in ms). No drag, key or pointer event is sent
 * during that window, and it runs after the draw-call sample so the two never share a frame loop's work.
 * Caveat: requestAnimationFrame is throttled when Brave's window is occluded, minimised or in a background tab (and
 * the OS can lower the display's refresh rate in low-power mode), so a run against a hidden window reports
 * inflated, unusable frame times. Keep the Brave window foreground and leave the pointer alone during a run: no
 * drag or hover moves the camera between the settle and the screenshot. Every report
 * records document.visibilityState and document.hasFocus() per view, and any view that is not visible is flagged
 * in the table and in a report-level warning, so a throttled run cannot be mistaken for a slow build.
 *
 * Not part of CI (e2e-smoke.yml names its specs) and skipped unless GTEKI_VANTAGE=1. Needs a real GPU: run it on
 * the dev Mac in Brave against a built candidate (`pnpm build` in apps/web first; the config serves it with
 * `vite preview`). Run from tests/e2e, one pass at a time:
 *
 *   GTEKI_VANTAGE=1 GTEKI_ROOT=<checkout> pnpm exec playwright test specs/13-ikebukuro-vantage-shots.spec.ts --project=desktop-chromium   # high tier
 *   GTEKI_VANTAGE=1 GTEKI_ROOT=<checkout> pnpm exec playwright test specs/13-ikebukuro-vantage-shots.spec.ts --project=phone-chromium     # low tier (Pixel 7, 412x915)
 *
 * Tier comes from the explorer (hooks.quality: coarse pointer or screen under 700 px => low), so the phone project
 * is the low run. Add GTEKI_VANTAGE_TIER=low (or high) to assert the tier the run landed on.
 *
 * Default spots (all verified against stations/ikebukuro/gteki/graph.json; override with GTEKI_VANTAGE_NODES):
 *   gate     g_jr_c1, g_jr_c2, g_jr_s                  the three JR ticket-gate nodes (representative gate arrays, #94)
 *   rail     c_g2, c_c    on the I1 route (JR Central Gate 2 -> Exit 35); 7.9 m and 11.1 m from the nearest mark in
 *            scene/access_fences.json (g_jr_c2 itself is 1.1 m, it is in the gate group)
 *            w_c, x4f     on the I2 route (West Exit B1 -> Exit 4 stair foot); 3.5 m and 4.5 m from the nearest mark
 *                         (sw_h, the next node, is 15.7 m; w_cj 6.6 m, a good swap if one of these is blocked)
 *            The distances are re-derived from access_fences.json and printed in the report ("fence m").
 *   exit     x10, x11, x15, x39, x42    the street-level end node of each exit's stair edge (#181 pavement plane check)
 *   control  x35                        the exit used by spec 10 and the I1 route; the known-good street view
 *   spawn    station.json spawnNodeIds (c_mid, c_e2, n_h, sp_e, w_c, sw_h)    the station's own default spawn nodes,
 *            read from stationData() so they follow the manifest. The frame-time runs (#352) start here.
 * A node id that is not in the graph is dropped and listed under "dropped" in the report; the run goes on.
 * GTEKI_VANTAGE_GROUPS=<group,...> keeps only spots in those groups (from the default list, or from
 * GTEKI_VANTAGE_NODES when that is set too); e.g. GTEKI_VANTAGE_GROUPS=spawn shoots just the six spawn views.
 *
 * Headings. Each spot is shot at four headings. Heading 0 is the bearing (0 = north, 90 = east, compass degrees in
 * station ENU) along the first `verified` edge at the node (else its first edge), read from the edge geometry
 * (the point about 2 m from the node); then +90, +180, +270. The walker spawns facing north (walkFrom resets yaw),
 * so the probe turns by dragging the canvas (yaw -= dx * 0.0042, as specs 04 and 10 steer) and tracks the yaw it
 * has sent; the camera's measured facing is recorded next to it as a cross-check (`facing`, flagged "(!)" when
 * more than 3 degrees (HEADING_TOL_DEG) off after up to three closed-loop corrections, and listed in a report warning).
 *
 * Per view: wait 2 animation frames after the turn plus GTEKI_VANTAGE_SETTLE_MS (default 600) for the follow
 * camera, count FRAMES rendered frames (default 5), sample frame intervals if GTEKI_VANTAGE_FRAMETIME_MS is set,
 * then take the screenshot. Draws and triangles in the table are the p50 over those frames; the max is next to it.
 * A street-level spot waits (up to 8 s) for sceneInfo().street.active and then 1.5 s for the context to finish
 * loading before the first heading.
 *
 * Output (per project, so desktop and phone runs never overwrite each other):
 *   <out>/<group>-<node>-h<bearing>.png    full viewport, CSS pixels x DPR
 *   <out>/vantage-<project>.md             header (label, renderer, tier, viewport, visibility), per-view table
 *                                          (draws, triangles and frame time), per-group max / p50 of draws and
 *                                          triangles, rows over the low-tier draw limit marked
 *   <out>/vantage-<project>.json           the same data, plus sceneInfo() per view, document.visibilityState and
 *                                          document.hasFocus() per view, and any renderer.info-style fields the
 *                                          build exposes on it (sceneInfo().renderer / .info / .render)
 *
 * Env: GTEKI_VANTAGE_NODES    comma list of graph node ids; an item may be `group:node` to pick the group
 *                             (otherwise the default group, else gate / exit by node kind and floor, else `node`);
 *                             an item may end with `>x/y` waypoints (station ENU metres) the walker walks to from the
 *                             node before the views (walkPath, 40 s cap); a walk that does not arrive is shot anyway
 *                             and listed in a report warning
 *      GTEKI_VANTAGE_HEADINGS comma list of degrees added to the edge bearing (default 0,90,180,270); prefix an item
 *                             with `@` for an absolute compass heading (`@45`)
 *      GTEKI_VANTAGE_OUT      output dir (default <GTEKI_ROOT>/.qa/<station>-vantage/<project>)
 *      GTEKI_VANTAGE_LABEL    free text recorded in the report, e.g. the candidate SHAs
 *      GTEKI_VANTAGE_FRAMES   frames counted per view (default 5)
 *      GTEKI_VANTAGE_SETTLE_MS extra settle after the turn (default 600)
 *      GTEKI_VANTAGE_LOW_DRAWS draw-call limit marked on the low tier (default 28)
 *      GTEKI_VANTAGE_TIER     assert the explorer tier ("low" or "high")
 *      GTEKI_VANTAGE_STATION  station id to open (default ikebukuro); pass GTEKI_VANTAGE_NODES with it
 *      GTEKI_VANTAGE_FRAMETIME_MS frame intervals sampled per view before its screenshot (default 0 = off)
 *      GTEKI_VANTAGE_GROUPS   comma list of groups to keep (gate, rail, exit, control, spawn)
 *
 * Runtime: about 19 spots x 4 headings = 76 views at roughly 2 to 3 s each, plus page load and the street-context
 * waits on the 6 street spots: expect 4 to 8 minutes per project on the dev Mac, plus GTEKI_VANTAGE_FRAMETIME_MS
 * per view when frame times are on.
 */
test.skip(!process.env.GTEKI_VANTAGE, "set GTEKI_VANTAGE=1 to run the Ikebukuro vantage-shot probe");
test.use({ trace: "off", video: "off", screenshot: "off" });

/** The listed groups; `spawn` is appended from station.json's spawnNodeIds once the station data is read. */
const DEFAULT_NODES = [
  "gate:g_jr_c1", "gate:g_jr_c2", "gate:g_jr_s",
  "rail:c_g2", "rail:c_c", "rail:w_c", "rail:x4f",
  "exit:x10", "exit:x11", "exit:x15", "exit:x39", "exit:x42",
  "control:x35",
];
const DEFAULT_HEADINGS = ["0", "90", "180", "270"];
const FRAMES = Number(process.env.GTEKI_VANTAGE_FRAMES ?? 5);
const SETTLE_MS = Number(process.env.GTEKI_VANTAGE_SETTLE_MS ?? 600);
/** Facing error (degrees) the closed-loop turn aims under; a view still further off is flagged in the report. */
const HEADING_TOL_DEG = 3;
const LOW_DRAW_LIMIT = Number(process.env.GTEKI_VANTAGE_LOW_DRAWS ?? 28);
const FRAMETIME_MS = Number(process.env.GTEKI_VANTAGE_FRAMETIME_MS ?? 0);
const GROUPS = (process.env.GTEKI_VANTAGE_GROUPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const LOOK_RAD_PER_PX = 0.0042;
/** Station to shoot (default ikebukuro); the default spots below are Ikebukuro nodes, so name nodes for another. */
const STATION = process.env.GTEKI_VANTAGE_STATION ?? "ikebukuro";

/** Counts draw calls and triangles per rendered frame at the WebGL boundary (independent of lib PROBE_SCRIPT; as in spec 10). */
const TRI_PROBE = `(() => {
  const st = { draws: [], tris: [], zero: 0, curD: 0, curT: 0 };
  window.__van = st;
  const T = (mode, n) => (mode === 4 ? Math.floor(n / 3) : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0);
  const wrap = (C) => {
    if (!C) return;
    const w = (fn, f) => { const o = C.prototype[fn]; if (o) C.prototype[fn] = function (...a) { st.curD++; st.curT += f(...a); return o.apply(this, a); }; };
    w("drawElements", (m, c) => T(m, c));
    w("drawArrays", (m, f, c) => T(m, c));
    w("drawElementsInstanced", (m, c, t, o, i) => T(m, c) * i);
    w("drawArraysInstanced", (m, f, c, i) => T(m, c) * i);
    w("drawRangeElements", (m, s, e, c) => T(m, c));
  };
  wrap(self.WebGL2RenderingContext);
  wrap(self.WebGLRenderingContext);
  const loop = () => {
    if (st.curD > 0) { st.draws.push(st.curD); st.tris.push(st.curT); } else st.zero++;
    st.curD = 0; st.curT = 0;
    if (st.draws.length > 6000) { st.draws.splice(0, 3000); st.tris.splice(0, 3000); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();`;

interface Pt { x: number; y: number }

const round = (n: number, d = 1): number => Math.round(n * 10 ** d) / 10 ** d;
const wrapRad = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const pct = (a: number[], p: number): number | null => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
};
const pad3 = (n: number): string => String(n).padStart(3, "0");

/** Drag the canvas by dx pixels in chunks that stay inside the (phone-width) canvas. Returns the dx sent. */
async function drag(page: Page, at: Pt, dx: number): Promise<number> {
  const box = (await page.locator("canvas.gteki-canvas").boundingBox())!;
  const maxChunk = Math.max(20, Math.floor(box.width * 0.3));
  let sent = 0;
  while (Math.abs(dx - sent) >= 1) {
    const chunk = Math.max(-maxChunk, Math.min(maxChunk, Math.round(dx - sent)));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + chunk, at.y, { steps: 3 });
    await page.mouse.up();
    sent += chunk;
  }
  return sent;
}

/** Where the camera looks, compass degrees (0 = north, 90 = east): avatar minus camera, renderer frame (x, up, -north). */
async function facingOf(page: Page): Promise<number> {
  const cam = (await hooks.sceneInfo(page)).camera as number[];
  const av = await hooks.avatar(page);
  return Math.round(((Math.atan2(av.x - cam[0]!, -(-av.y - cam[2]!)) * 180) / Math.PI + 360) % 360);
}

/** A point on the canvas that is not covered by UI, to start drags from. */
async function canvasPoint(page: Page): Promise<Pt> {
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

/** Distance (m) from p to the nearest segment {a, b} of a list. */
function nearestSegment(p: Pt, segs: { a: number[]; b: number[] }[]): number | null {
  let best = Infinity;
  for (const s of segs) {
    const [ax, ay] = s.a as [number, number], [bx, by] = s.b as [number, number];
    const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * vx + (p.y - ay) * vy) / len2));
    best = Math.min(best, Math.hypot(p.x - ax - t * vx, p.y - ay - t * vy));
  }
  return Number.isFinite(best) ? best : null;
}

/** Compass bearing (0 = north, 90 = east) from `from` to `to` in station ENU. */
const bearing = (from: Pt, to: Pt): number => ((Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI + 360) % 360;

async function measure(page: Page, frames: number) {
  await page.evaluate(() => { const b = (window as any).__van; b.draws.length = 0; b.tris.length = 0; b.zero = 0; });
  await page.waitForFunction((n) => (window as any).__van.draws.length >= n, frames, { timeout: 60_000 });
  return page.evaluate((n) => {
    const b = (window as any).__van;
    return { draws: (b.draws as number[]).slice(0, n), tris: (b.tris as number[]).slice(0, n), zeroFrames: b.zero as number };
  }, frames);
}

/** document.visibilityState and document.hasFocus(): a hidden or occluded window throttles rAF and inflates frame times. */
const visibilityOf = (page: Page) =>
  page.evaluate(() => ({ visibility: document.visibilityState as string, focused: document.hasFocus() }));

/**
 * Frame pacing inside the page: the performance.now() gap between consecutive requestAnimationFrame callbacks over
 * `ms`. No drag, key or pointer event is sent during the window, so the renderer is doing nothing but drawing.
 * Runs after the draw-call sample, so the two loops never compete for the same frames.
 */
async function frameTime(page: Page, ms: number) {
  const t = await page.evaluate(
    (dur) =>
      new Promise<number[]>((resolve) => {
        // rAF's own frame timestamps (no main-thread jitter); a hidden page gets no rAF at all, so a timer
        // resolves with whatever was collected instead of hanging the run.
        const ts: number[] = [];
        let t0: number | null = null;
        const tick = (now: number) => {
          ts.push(now);
          t0 ??= now;
          if (now - t0 < dur) requestAnimationFrame(tick);
          else resolve(ts);
        };
        setTimeout(() => resolve(ts), dur + 2000);
        requestAnimationFrame(tick);
      }),
    ms,
  );
  const intervals = t.slice(1).map((v, i) => v - t[i]!);
  if (!intervals.length) return { ftP50: null, ftP95: null, ftMax: null, ftFrames: 0 };
  return {
    ftP50: round(pct(intervals, 0.5)!, 1),
    ftP95: round(pct(intervals, 0.95)!, 1),
    ftMax: round(Math.max(...intervals), 1),
    ftFrames: intervals.length,
  };
}

interface Row {
  group: string; node: string; nodeKind: string | null; floor: string | null; fenceM: number | null;
  offsetDeg: number | null; absolute: boolean; heading: number; facing: number | null; headingOk: boolean | null;
  draws: number | null; drawsMax: number | null; tris: number | null; trisMax: number | null; frames: number; zeroFrames: number;
  /** Frame intervals over GTEKI_VANTAGE_FRAMETIME_MS (ms); null when the measurement is off or the view failed. */
  ftP50: number | null; ftP95: number | null; ftMax: number | null; ftFrames: number | null;
  /** The document state when the view was measured: a view that is not "visible" was throttled. */
  visibility: string | null; focused: boolean | null;
  overLowLimit: boolean; streetActive: boolean | null; streetOpacity: number | null;
  walker: { x: number; y: number; z: number } | null; file: string | null; error?: string;
  /** The off-graph waypoints walked from the node (">x/y" text, null when none) and the walkPath result. */
  walkTo: string | null; walk: { done: boolean; stuck: boolean; timedOut: boolean } | null;
  renderInfo: unknown; sceneInfo: unknown;
}

test("ikebukuro vantage shots: gates, rails and street exits @phone", async ({ page }, testInfo) => {
  test.setTimeout(900_000);
  const root = process.env.GTEKI_ROOT;
  if (!root) throw new Error("GTEKI_ROOT must point at the candidate checkout");

  const { graph, station } = stationData(STATION);
  const byId = new Map(graph.nodes.map((n) => [n.id, n as typeof n & { kind?: string }]));

  // ---- spot list ------------------------------------------------------------------------------------
  // The spawn group comes from the manifest (station.json spawnNodeIds), so it follows the station's own spawns.
  const spawnNodes: string[] = Array.isArray((station as { spawnNodeIds?: string[] }).spawnNodeIds) ? (station as { spawnNodeIds: string[] }).spawnNodeIds : [];
  const allDefaults = [...DEFAULT_NODES, ...spawnNodes.map((n) => `spawn:${n}`)];
  const requested = (process.env.GTEKI_VANTAGE_NODES ? process.env.GTEKI_VANTAGE_NODES.split(",") : allDefaults).map((s) => s.trim()).filter(Boolean);
  // first wins: a bare id keeps its original group (w_c stays rail) even though it is also a spawn
  const defaultGroup = new Map<string, string>();
  for (const [g, n] of allDefaults.map((s) => [s.slice(0, s.indexOf(":")), s.slice(s.indexOf(":") + 1)])) if (!defaultGroup.has(n)) defaultGroup.set(n, g);
  const spots: { group: string; node: string; walkTo: { x: number; y: number }[] }[] = [];
  const dropped: string[] = [];
  const notInGroups: string[] = [];
  for (const item of requested) {
    // `>x/y` suffixes are off-graph waypoints the walker walks to from the node (station ENU metres, x east, y north)
    const [head = "", ...legs] = item.split(">");
    const walkTo = legs.map((s) => s.split("/").map(Number)).map(([x, y]) => ({ x: x!, y: y! }));
    expect(walkTo.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), `waypoints in ${item}`).toBe(true);
    // Shinjuku ids carry an "n:" prefix, so a whole item that is a node id wins; otherwise split at the first colon
    const cut = byId.has(head) ? -1 : head.indexOf(":");
    const [g, n] = cut < 0 ? [undefined, head] : [head.slice(0, cut), head.slice(cut + 1)];
    const node = byId.get(n!);
    if (!node) { dropped.push(n!); continue; }
    const group = g ?? defaultGroup.get(n!) ?? (node.kind === "ticket_gate" ? "gate" : node.kind === "exit" ? "exit" : "node");
    if (GROUPS.length && !GROUPS.includes(group)) { notInGroups.push(item); continue; }
    spots.push({ group, node: n!, walkTo });
  }
  if (dropped.length) console.warn(`vantage: dropped nodes not in the graph: ${dropped.join(", ")}`);
  if (notInGroups.length) console.warn(`vantage: skipped by GTEKI_VANTAGE_GROUPS=${GROUPS.join(",")}: ${notInGroups.join(", ")}`);
  expect(spots.length, "at least one valid node").toBeGreaterThan(0);
  expect(Number.isFinite(FRAMETIME_MS) && FRAMETIME_MS >= 0, "GTEKI_VANTAGE_FRAMETIME_MS is a number of ms >= 0").toBe(true);

  const headings = (process.env.GTEKI_VANTAGE_HEADINGS ? process.env.GTEKI_VANTAGE_HEADINGS.split(",") : DEFAULT_HEADINGS)
    .map((s) => s.trim()).filter(Boolean)
    .map((s) => (s.startsWith("@") ? { deg: Number(s.slice(1)), absolute: true } : { deg: Number(s), absolute: false }));
  for (const h of headings) expect(Number.isFinite(h.deg), "numeric heading").toBe(true);

  /** Bearing along the first verified edge at a node (else its first edge), from the edge geometry about 2 m out. */
  const edgeBearing = (id: string): { deg: number; edge: string | null } => {
    const node = byId.get(id)!;
    const here = { x: node.position.x, y: node.position.y };
    const edges = graph.edges.filter((e) => e.from === id || e.to === id) as (typeof graph.edges[number] & { verification?: string })[];
    const e = edges.find((x) => x.verification === "verified") ?? edges[0];
    if (!e) return { deg: 0, edge: null };
    const other = byId.get(e.from === id ? e.to : e.from)!;
    let pts: Pt[] = e.geometry && e.geometry.length >= 2 ? e.geometry.map((g) => ({ x: g.x, y: g.y })) : [here, { x: other.position.x, y: other.position.y }];
    // Orient the polyline so it starts at this node.
    const d0 = Math.hypot(pts[0]!.x - here.x, pts[0]!.y - here.y), d1 = Math.hypot(pts.at(-1)!.x - here.x, pts.at(-1)!.y - here.y);
    if (d1 < d0) pts = [...pts].reverse();
    let target = pts.at(-1)!;
    for (const p of pts.slice(1)) { if (Math.hypot(p.x - here.x, p.y - here.y) >= 2) { target = p; break; } }
    return { deg: Math.round(bearing(here, target)), edge: e.id };
  };

  const accessFile = path.join(root, "stations", STATION, "scene", "access_fences.json");
  const fences: { a: number[]; b: number[] }[] = fs.existsSync(accessFile) ? (JSON.parse(fs.readFileSync(accessFile, "utf8")).fences ?? []) : [];

  // ---- page ------------------------------------------------------------------------------------------
  await page.addInitScript(TRI_PROBE);
  const { loadMs } = await openStation(page, STATION);
  const tier = await hooks.quality(page);
  if (process.env.GTEKI_VANTAGE_TIER) expect(tier, "explorer quality tier").toBe(process.env.GTEKI_VANTAGE_TIER);
  const gl = await page.evaluate(() => (window as any).__qa?.gl ?? null);
  const gpuValid = Boolean(gl?.renderer) && !/SwiftShader|llvmpipe|Software/i.test(String(gl?.renderer));
  const viewport = page.viewportSize();
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const project = testInfo.project.name;
  const label = process.env.GTEKI_VANTAGE_LABEL ?? "";

  const outDir = process.env.GTEKI_VANTAGE_OUT ?? path.join(root, ".qa", `${STATION}-vantage`, project);
  fs.mkdirSync(outDir, { recursive: true });

  const rows: Row[] = [];
  for (const spot of spots) {
    const node = byId.get(spot.node)!;
    const eb = edgeBearing(spot.node);
    const fenceM = nearestSegment({ x: node.position.x, y: node.position.y }, fences);
    const ok = await hooks.walkFromNode(page, spot.node);
    const base = {
      group: spot.group, node: spot.node, nodeKind: node.kind ?? null, floor: node.floorId, fenceM: fenceM === null ? null : round(fenceM),
      walkTo: spot.walkTo.length ? spot.walkTo.map((p) => `${p.x}/${p.y}`).join(">") : null,
    };
    if (!ok) {
      for (const h of headings) {
        rows.push({
          ...base, offsetDeg: h.deg, absolute: h.absolute, heading: Math.round((h.absolute ? h.deg : eb.deg + h.deg) % 360), facing: null, headingOk: null,
          draws: null, drawsMax: null, tris: null, trisMax: null, frames: 0, zeroFrames: 0, ftP50: null, ftP95: null, ftMax: null, ftFrames: null,
          visibility: null, focused: null, overLowLimit: false, streetActive: null, streetOpacity: null,
          walker: null, walk: null, file: null, error: "walkFromNode returned false (no walkable ground at the node)", renderInfo: null, sceneInfo: null,
        });
      }
      continue;
    }
    await expect.poll(() => hooks.mode(page)).toBe("walk");
    // Shop vantage points off the graph: walk there through normal walk input (renderer frame: x east, z = -north).
    let walk: Row["walk"] = null;
    if (spot.walkTo.length) {
      const r = await page.evaluate((p) => (window as any).__gteki.walkPath(p, { maxSeconds: 40 }), spot.walkTo.map((p) => ({ x: p.x, z: -p.y })));
      walk = { done: r.done, stuck: r.stuck, timedOut: r.timedOut };
    }
    if (node.floorId === "street") {
      // The street gate lags the camera by a frame and the backdrop fades in: wait for it, never fail on it.
      await page.waitForFunction(() => (window as any).__gteki.sceneInfo().street.active, null, { timeout: 8_000 }).catch(() => undefined);
      await page.waitForTimeout(1_500);
    } else {
      await page.waitForTimeout(500);
    }
    const at = await canvasPoint(page);
    let yaw = 0; // walkFrom resets yaw to 0 (north); yaw = -heading in radians

    for (const h of headings) {
      const heading = ((Math.round(h.absolute ? h.deg : eb.deg + h.deg) % 360) + 360) % 360;
      const delta = wrapRad((-heading * Math.PI) / 180 - yaw);
      const dx = Math.round(-delta / LOOK_RAD_PER_PX);
      if (Math.abs(dx) >= 1) yaw = wrapRad(yaw - (await drag(page, at, dx)) * LOOK_RAD_PER_PX);
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      await page.waitForTimeout(SETTLE_MS);
      // Close the loop on the measured facing: the open-loop drag landed 50-77 degrees off on every view of the
      // 2026-10-29 shop hero run (#209). Up to three corrections, then carry the real yaw to the next heading.
      for (let i = 0; i < 3; i++) {
        const err = ((heading - (await facingOf(page)) + 540) % 360) - 180;
        if (Math.abs(err) < HEADING_TOL_DEG) break;
        await drag(page, at, Math.round((err * Math.PI) / 180 / LOOK_RAD_PER_PX));
        await page.waitForTimeout(SETTLE_MS);
      }
      yaw = wrapRad((-(await facingOf(page)) * Math.PI) / 180);

      const m = await measure(page, FRAMES);
      // Frame pacing after the draw sample, before the screenshot: nothing touches the page during the window.
      const ft = FRAMETIME_MS > 0 ? await frameTime(page, FRAMETIME_MS) : { ftP50: null, ftP95: null, ftMax: null, ftFrames: null };
      const vis = await visibilityOf(page);
      const info = await hooks.sceneInfo(page);
      const av = await hooks.avatar(page);
      const facing = await facingOf(page);
      const diff = Math.abs(((facing - heading + 540) % 360) - 180);

      const file = `${spot.group}-${spot.node}-h${pad3(heading)}.png`;
      await page.screenshot({ path: path.join(outDir, file) });

      const drawsP50 = pct(m.draws, 0.5), drawsMax = Math.max(...m.draws);
      // renderer.info-style numbers, if the build exposes them on sceneInfo() (this branch does not).
      const any = info as Record<string, unknown>;
      const renderInfo = any.renderer ?? any.info ?? any.render ?? null;
      rows.push({
        ...base, offsetDeg: h.deg, absolute: h.absolute, heading, facing, headingOk: diff <= HEADING_TOL_DEG,
        draws: drawsP50, drawsMax, tris: pct(m.tris, 0.5), trisMax: Math.max(...m.tris), frames: m.draws.length, zeroFrames: m.zeroFrames,
        ...ft, visibility: vis.visibility, focused: vis.focused,
        overLowLimit: tier === "low" && drawsMax > LOW_DRAW_LIMIT,
        streetActive: info.street.active, streetOpacity: info.street.opacity,
        walker: { x: round(av.x), y: round(av.y), z: round(av.z) }, walk, file, renderInfo, sceneInfo: info,
      });
    }
  }

  // ---- report ----------------------------------------------------------------------------------------
  const measured = rows.filter((r) => r.draws !== null);
  const groups = [...new Set(rows.map((r) => r.group))].map((g) => {
    const rs = measured.filter((r) => r.group === g);
    const nums = (k: "draws" | "drawsMax" | "tris" | "trisMax") => rs.map((r) => r[k] as number);
    const ft = (k: "ftP50" | "ftP95") => rs.map((r) => r[k]).filter((v): v is number => v !== null);
    return {
      group: g, views: rs.length, nodes: [...new Set(rs.map((r) => r.node))],
      drawsMax: rs.length ? Math.max(...nums("drawsMax")) : null, drawsP50: pct(nums("draws"), 0.5),
      trisMax: rs.length ? Math.max(...nums("trisMax")) : null, trisP50: pct(nums("tris"), 0.5),
      // median of the views' p50 frame intervals; the worst view's p95
      ftP50: pct(ft("ftP50"), 0.5), ftP95: ft("ftP95").length ? Math.max(...ft("ftP95")) : null,
      overLowLimit: rs.filter((r) => r.overLowLimit).length,
    };
  });
  const failed = rows.filter((r) => r.error);
  // A view measured in a hidden or occluded window has throttled rAF; its frame time is not the build's.
  const hiddenViews = rows.filter((r) => (r.visibility !== null && r.visibility !== "visible") || r.focused === false);
  const warnings = hiddenViews.length
    ? [`${hiddenViews.length} of ${measured.length} measured views were hidden or unfocused (${[...new Set(hiddenViews.map((r) => `${r.node} h${r.heading}: ${r.visibility}${r.focused === false ? ", unfocused" : ""}`))].join(", ")}): requestAnimationFrame may have been throttled, so their frame times are not comparable to a foreground run.`]
    : [];
  for (const w of warnings) console.warn(`vantage: ${w}`);
  // Views the closed-loop turn left more than HEADING_TOL_DEG off: the shot may miss what the heading aimed at.
  const offHeading = rows.filter((r) => r.headingOk === false);
  const headingWarnings = offHeading.length
    ? [`${offHeading.length} view(s) ended more than ${HEADING_TOL_DEG} degrees off the requested heading after the turn corrections: ${offHeading.map((r) => `${r.node} h${r.heading} -> facing ${r.facing}`).join(", ")}.`]
    : [];
  for (const w of headingWarnings) console.warn(`vantage: ${w}`);
  // Spots whose off-graph walk did not arrive: still shot, but the shot may be from somewhere else.
  const missedWalks = [...new Map(rows.filter((r) => r.walk && !r.walk.done).map((r) => [`${r.group} ${r.node}`, r])).values()];
  const walkWarnings = missedWalks.length
    ? [`${missedWalks.length} spot(s) did not reach their walk target: ${missedWalks.map((r) => `${r.group} ${r.node} >${r.walkTo}: ${r.walk!.stuck ? "stuck" : r.walk!.timedOut ? "timed out" : "not reached"} at walker ${r.walker?.x}/${r.walker?.y}`).join(", ")}.`]
    : [];
  for (const w of walkWarnings) console.warn(`vantage: ${w}`);
  const result = {
    probe: "ikebukuro-vantage-shots", station: STATION, label, tier, project, viewport, dpr, loadMs, gl, gpuValid,
    frames: FRAMES, settleMs: SETTLE_MS, lowDrawLimit: LOW_DRAW_LIMIT, headings: headings.map((h) => (h.absolute ? `@${h.deg}` : String(h.deg))),
    frametimeMs: FRAMETIME_MS, groupsRequested: GROUPS, visibilityWarnings: warnings, headingTolDeg: HEADING_TOL_DEG, headingWarnings, walkWarnings,
    requested, dropped, notInGroups, groups, rows,
  };
  const base = path.join(outDir, `vantage-${project}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(result, null, 2));

  const cell = (v: unknown) => (v === null || v === undefined ? "n/a" : String(v));
  const md = [
    `# ${STATION[0]!.toUpperCase()}${STATION.slice(1)} vantage shots: ${tier} tier (${project})`,
    "",
    `- Label: ${label || "(none)"}`,
    `- Renderer: ${gl?.renderer ?? "unknown"} (vendor ${gl?.vendor ?? "unknown"}, gpuValid=${gpuValid})`,
    `- Tier: ${tier}; viewport ${viewport ? `${viewport.width}x${viewport.height}` : "?"} CSS px, DPR ${dpr}; page load ${loadMs} ms`,
    `- ${FRAMES} frames per view (p50 shown, max beside it); draws and triangles counted at the WebGL boundary, all passes. Settle ${SETTLE_MS} ms after each turn.`,
    FRAMETIME_MS > 0
      ? `- Frame time: rAF intervals over ${FRAMETIME_MS} ms per view, sampled after the draw count and before the screenshot, with no input during the window. ms per frame; lower is better. A foreground window is required for these numbers to mean anything.`
      : "- Frame time: off (GTEKI_VANTAGE_FRAMETIME_MS=0). Draw counts are unaffected by window visibility; frame time is not.",
    ...warnings.map((w) => `- **WARNING**: ${w}`),
    ...headingWarnings.map((w) => `- **WARNING**: ${w}`),
    ...walkWarnings.map((w) => `- **WARNING**: ${w}`),
    `- Window state: every view records document.visibilityState and document.hasFocus(); a view that was not \`visible\` is flagged \`HIDDEN\` in the table.`,
    `- Headings: edge bearing (first verified edge at the node) ${result.headings.map((h) => (h.startsWith("@") ? `${h.slice(1)} (absolute)` : `+${h}`)).join(", ")}.`,
    tier === "low" ? `- Rows with draws max over ${LOW_DRAW_LIMIT} on the low tier are marked OVER.` : `- Not the low tier: no row is marked against the ${LOW_DRAW_LIMIT}-draw low-tier limit (run phone-chromium for that).`,
    dropped.length ? `- Dropped (not in the graph): ${dropped.join(", ")}` : "- Dropped nodes: none",
    failed.length ? `- Could not place: ${[...new Set(failed.map((r) => r.node))].join(", ")}` : "- Could not place: none",
    "",
    "## Per group",
    "",
    "| group | nodes | views | draws max | draws p50 | tris max | tris p50 | ft p50 ms (median view) | ft p95 ms (worst view) | rows over limit |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...groups.map((g) => `| ${g.group} | ${g.nodes.join(", ")} | ${g.views} | ${cell(g.drawsMax)} | ${cell(g.drawsP50)} | ${cell(g.trisMax)} | ${cell(g.trisP50)} | ${cell(g.ftP50)} | ${cell(g.ftP95)} | ${g.overLowLimit} |`),
    "",
    "## Views",
    "",
    "| group | node | fence m | heading | facing | walk | draws p50 | draws max | tris p50 | tris max | ft p50 ms | ft p95 ms | ft max ms | ft frames | vis | street.active | file |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r) =>
      `| ${r.group} | ${r.node} | ${cell(r.fenceM)} | ${r.heading} | ${cell(r.facing)}${r.headingOk === false ? " (!)" : ""} | ${r.walk === null ? "" : r.walk.done ? "ok" : r.walk.stuck ? "STUCK" : r.walk.timedOut ? "TIMEOUT" : "MISS"} | ${cell(r.draws)} | ${cell(r.drawsMax)}${r.overLowLimit ? " OVER" : ""} | ${cell(r.tris)} | ${cell(r.trisMax)} | ${cell(r.ftP50)} | ${cell(r.ftP95)} | ${cell(r.ftMax)} | ${cell(r.ftFrames)} | ${cell(r.visibility)}${r.visibility !== null && r.visibility !== "visible" ? " HIDDEN" : ""}${r.focused === false ? " (unfocused)" : ""} | ${cell(r.streetActive)} | ${r.file ? `[${r.file}](${r.file})` : `ERROR: ${r.error}`} |`),
    "",
    "`fence m` is the distance from the node to the nearest fence segment in scene/access_fences.json (blank when the file is absent).",
    "",
    ...rows.filter((r) => r.file).map((r) => `![${r.group} ${r.node} h${r.heading}](${r.file})`),
    "",
  ].join("\n");
  fs.writeFileSync(`${base}.md`, md);
  testInfo.annotations.push({ type: "output", description: `${base}.json` });
  console.log(`vantage shots (${tier}, ${project}) written to ${base}.json / .md (${measured.length} views)`);

  expect(gpuValid, `renderer ${gl?.renderer}: software rendering invalidates the visuals and the counts`).toBe(true);
  expect.soft(failed.map((r) => r.node), "nodes the walker could not be placed on").toEqual([]);
  expect.soft(measured.length, "views captured").toBe(spots.length * headings.length - failed.length);
});
