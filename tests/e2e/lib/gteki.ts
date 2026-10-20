import fs from "node:fs";
import path from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";

/** Station keys under test; both have independent acceptance records. */
export const STATIONS = ["ikebukuro", "shinjuku"] as const;
export type StationKey = (typeof STATIONS)[number];

export const ARTIFACTS = path.resolve(import.meta.dirname, "../artifacts");

export interface Vec3 { x: number; y: number; z: number }

/**
 * Injected before any page script: counts WebGL draw calls between animation frames and records
 * frame intervals, so performance numbers come from the real render loop rather than app hooks.
 */
export const PROBE_SCRIPT = `(() => {
  const st = { frames: [], draws: [], cur: 0, errors: [], gl: null };
  window.__qa = st;
  const wrap = (C) => {
    if (!C) return;
    for (const fn of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced", "drawRangeElements"]) {
      const orig = C.prototype[fn];
      if (!orig) continue;
      C.prototype[fn] = function (...a) { st.cur++; return orig.apply(this, a); };
    }
  };
  wrap(self.WebGL2RenderingContext);
  wrap(self.WebGLRenderingContext);
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = gc.call(this, type, ...rest);
    if (ctx && !st.gl && /webgl/.test(String(type))) {
      try {
        const ext = ctx.getExtension("WEBGL_debug_renderer_info");
        st.gl = { type, vendor: ext ? ctx.getParameter(ext.UNMASKED_VENDOR_WEBGL) : ctx.getParameter(ctx.VENDOR), renderer: ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER), maxTexture: ctx.getParameter(ctx.MAX_TEXTURE_SIZE) };
      } catch (e) { st.gl = { type, error: String(e) }; }
    }
    return ctx;
  };
  let last = performance.now();
  const loop = (t) => {
    st.frames.push(t - last); st.draws.push(st.cur); st.cur = 0; last = t;
    if (st.frames.length > 30000) { st.frames.splice(0, 15000); st.draws.splice(0, 15000); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // Every toast the user is shown, with time: transient feedback (arrival, scene fallback) is never missed.
  st.toasts = [];
  addEventListener("DOMContentLoaded", () => {
    let last = "";
    new MutationObserver(() => {
      const t = document.querySelector(".toast.show");
      const text = t ? (t.textContent || "").trim() : "";
      if (text && text !== last) st.toasts.push({ t: performance.now(), text });
      last = text;
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  });
  addEventListener("error", (e) => st.errors.push(String(e.message)));
  addEventListener("unhandledrejection", (e) => st.errors.push("unhandledrejection: " + String(e.reason)));
})();`;

export interface Diagnostics { console: string[]; pageErrors: string[]; failedRequests: string[] }

/** Collect console errors/warnings, uncaught errors and failed requests for the whole test. */
export function watch(page: Page): Diagnostics {
  const d: Diagnostics = { console: [], pageErrors: [], failedRequests: [] };
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") d.console.push(`[${m.type()}] ${m.text()}`); });
  page.on("pageerror", (e) => d.pageErrors.push(e.message));
  page.on("requestfailed", (r) => d.failedRequests.push(`${r.failure()?.errorText ?? "failed"} ${r.url()}`));
  page.on("response", (r) => { if (r.status() >= 400) d.failedRequests.push(`${r.status()} ${r.url()}`); });
  return d;
}

/** Open a station through the public URL and wait until its scene (or its L0 fallback) is ready. */
export async function openStation(page: Page, key: StationKey, query = ""): Promise<{ loadMs: number; phase: string }> {
  await page.addInitScript(PROBE_SCRIPT);
  const t0 = Date.now();
  await page.goto(`/?station=${key}&lang=en${query}`);
  await page.waitForFunction(() => typeof (window as any).__gteki?.phase === "function", null, { timeout: 30_000 });
  await page.waitForFunction(() => (window as any).__gteki.phase() === "ready", null, { timeout: 120_000 });
  const loadMs = Date.now() - t0;
  // Spawn chips render only once the station is ready; they are the user-visible readiness signal.
  await expect(page.locator(".chips .chip").first()).toBeAttached();
  return { loadMs, phase: await page.evaluate(() => (window as any).__gteki.phase()) };
}

/** Every toast text shown since page load (recorded by the probe's observer). */
export async function toasts(page: Page): Promise<string[]> {
  return page.evaluate(() => ((window as any).__qa?.toasts ?? []).map((x: { text: string }) => x.text));
}

/** Text of the first match, or null when absent (never waits for an element to appear). */
export async function textIf(page: Page, selector: string): Promise<string | null> {
  const l = page.locator(selector).first();
  return (await l.count()) ? l.textContent() : null;
}

export const hooks = {
  route: (page: Page) => page.evaluate(() => (window as any).__gteki.route()),
  instructions: (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__gteki.instructions()),
  mode: (page: Page): Promise<string> => page.evaluate(() => (window as any).__gteki.mode()),
  avatar: (page: Page): Promise<Vec3> => page.evaluate(() => (window as any).__gteki.avatar()),
  sceneInfo: (page: Page) => page.evaluate(() => (window as any).__gteki.sceneInfo()),
  simulate: (page: Page, seconds: number, keys: string[] = []): Promise<Vec3> =>
    page.evaluate(([s, k]) => (window as any).__gteki.simulate(s, k), [seconds, keys] as const),
  setOrigin: (page: Page, id: string) => page.evaluate((x) => (window as any).__gteki.setOrigin(x), id),
  setDestination: (page: Page, id: string) => page.evaluate((x) => (window as any).__gteki.setDestination(x), id),
  setProfile: (page: Page, p: Record<string, boolean>) => page.evaluate((x) => (window as any).__gteki.setProfile(x), p),
  walkFromNode: (page: Page, id: string): Promise<boolean> => page.evaluate((x) => (window as any).__gteki.walkFromNode(x), id),
  quality: (page: Page): Promise<string> => page.evaluate(() => (window as any).__gteki.quality()),
};

/** Pick an endpoint the way a user does: type into the field and click a search result by its visible name. */
export async function chooseBySearch(page: Page, which: "from" | "to", query: string, resultName: string | RegExp): Promise<void> {
  const input = page.locator(`#gteki-${which}`);
  await input.click();
  await input.fill("");
  await input.pressSequentially(query, { delay: 40 });
  const result = page.locator(`.field-${which} .results button.result`).filter({ has: page.locator(".result-name", { hasText: resultName }) }).first();
  await expect(result).toBeVisible();
  await result.click();
}

/** Mean/stdev luminance of a screenshot, decoded in the page (no image dependencies in Node). */
export async function imageStats(page: Page, png: Buffer): Promise<{ mean: number; std: number; clippedWhite: number; nearBlack: number }> {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    const w = (c.width = Math.min(img.width, 480));
    const h = (c.height = Math.round((img.height * w) / img.width));
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let s = 0, s2 = 0, white = 0, black = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
      s += l; s2 += l * l;
      if (l >= 250) white++;
      if (l <= 12) black++;
    }
    const mean = s / n;
    return { mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), clippedWhite: white / n, nearBlack: black / n };
  }, png.toString("base64"));
}

/** Frame-time and draw-call summary from the injected probe over the last `seconds`. */
export async function perfWindow(page: Page, seconds: number) {
  await page.evaluate(() => { const q = (window as any).__qa; q.frames.length = 0; q.draws.length = 0; });
  await page.waitForTimeout(seconds * 1000);
  return page.evaluate(() => {
    const q = (window as any).__qa;
    const f = [...q.frames].filter((x: number) => x > 0).sort((a: number, b: number) => a - b);
    const zeroDrawFrames = q.draws.filter((x: number) => x === 0).length;
    const d = [...q.draws].filter((x: number) => x > 0).sort((a: number, b: number) => a - b);
    const pct = (a: number[], p: number) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null;
    const total = f.reduce((s: number, x: number) => s + x, 0);
    const mem = (performance as any).memory;
    return {
      frames: f.length,
      fps: total ? Math.round((f.length / total) * 1000 * 10) / 10 : null,
      frameMsP50: pct(f, 0.5), frameMsP95: pct(f, 0.95), frameMsMax: f.at(-1) ?? null,
      longFrames50ms: f.filter((x: number) => x > 50).length,
      drawCallsP50: pct(d, 0.5), drawCallsMax: d.at(-1) ?? null,
      jsHeapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
      zeroDrawFrames,
      // Software rasterisers make every number above meaningless for device performance.
      gpuValid: Boolean(q.gl?.renderer) && !/SwiftShader|llvmpipe|Software/i.test(String(q.gl?.renderer)),
      gl: q.gl,
    };
  });
}

/** Overlap of floating POI labels with the app's own UI (labels must never cover controls). */
export async function labelUiOverlaps(page: Page) {
  return page.evaluate(() => {
    const ui = [".topbar", ".panel", ".sheet.open", ".hud"].flatMap((sel) => [...document.querySelectorAll<HTMLElement>(sel)]).filter((e) => e.offsetParent !== null);
    const labels = [...document.querySelectorAll<HTMLElement>(".gteki-labels > *")].filter((e) => e.style.display !== "none" && e.getBoundingClientRect().width > 0);
    const hits: { label: string; over: string; labelOnTop: boolean }[] = [];
    for (const l of labels) {
      const r = l.getBoundingClientRect();
      if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
      for (const u of ui) {
        const q = u.getBoundingClientRect();
        const ix = Math.min(r.right, q.right) - Math.max(r.left, q.left);
        const iy = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
        if (ix > 2 && iy > 2) {
          const cx = Math.max(r.left, q.left) + ix / 2, cy = Math.max(r.top, q.top) + iy / 2;
          const top = document.elementFromPoint(cx, cy);
          hits.push({ label: l.textContent?.trim() ?? "", over: u.className, labelOnTop: Boolean(top && l.contains(top)) });
        }
      }
    }
    let pairs = 0;
    const rects = labels.map((l) => l.getBoundingClientRect()).filter((r) => r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!, b = rects[j]!;
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 4 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 4) pairs++;
    }
    return { visibleLabels: rects.length, labelLabelOverlaps: pairs, uiOverlaps: hits };
  });
}

// ---- Station data on disk (the candidate under test) ---------------------------------

export interface GraphNode { id: string; floorId: string; position: { x: number; y: number; z: number | null }; renderZ?: number }
export interface GraphEdge { id: string; from: string; to: string; direction: string; mode: string; lengthM?: number; geometry?: { x: number; y: number; z: number | null }[] }

export function stationData(key: StationKey) {
  const root = process.env.GTEKI_ROOT;
  if (!root) throw new Error("GTEKI_ROOT must point at the candidate checkout");
  const dir = path.join(root, "stations", key, "gteki");
  const graph = JSON.parse(fs.readFileSync(path.join(dir, "graph.json"), "utf8")) as { nodes: GraphNode[]; edges: GraphEdge[] };
  const pois = JSON.parse(fs.readFileSync(path.join(dir, "pois.json"), "utf8"));
  const station = JSON.parse(fs.readFileSync(path.join(dir, "station.json"), "utf8"));
  return { graph, pois: (Array.isArray(pois) ? pois : pois.pois) as { id: string; connectorNodeIds: string[]; category: string; paid: boolean | null; names: { lang: string; text: string }[] }[], station };
}

export interface Waypoint { p: Vec3; zKnown: boolean; mode: string; edgeId: string; stepIndex: number }

interface RouteStepLike { edgeId: string; fromNodeId: string; toNodeId: string; reversed: boolean; mode: string }

/**
 * Waypoints (station ENU) for the exact routed steps, mirroring @gteki/navigation routePolyline:
 * edge geometry reversed when traversed backwards, display heights (surveyed z, else renderZ, else
 * the floor's render elevation) and interior heights interpolated where z is unknown.
 */
export function routeWaypoints(key: StationKey, steps: RouteStepLike[]): Waypoint[] {
  const { graph, station } = stationData(key);
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const edges = new Map(graph.edges.map((e) => [e.id, e]));
  const floors = new Map((station.floors as { id: string; renderElevationM?: number }[]).map((f) => [f.id, f]));
  const dz = (n: GraphNode) => n.position.z !== null ? { z: n.position.z, known: true } : n.renderZ !== undefined ? { z: n.renderZ, known: false } : { z: floors.get(n.floorId)?.renderElevationM ?? 0, known: false };
  const first = nodes.get(steps[0]!.fromNodeId)!;
  const s0 = dz(first);
  const out: Waypoint[] = [{ p: { x: first.position.x, y: first.position.y, z: s0.z }, zKnown: s0.known, mode: steps[0]!.mode, edgeId: steps[0]!.edgeId, stepIndex: 0 }];
  steps.forEach((step, stepIndex) => {
    const from = nodes.get(step.fromNodeId)!, to = nodes.get(step.toNodeId)!;
    const a = dz(from), b = dz(to);
    const edge = edges.get(step.edgeId) as (GraphEdge & { geometryZ?: string }) | undefined;
    const drawn = edge?.geometry && edge.geometry.length >= 2 ? edge.geometry : null;
    const raw = drawn ? [...drawn] : [from.position, to.position];
    if (step.reversed && drawn) raw.reverse();
    const lengths = [0];
    for (let i = 1; i < raw.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(raw[i]!.x - raw[i - 1]!.x, raw[i]!.y - raw[i - 1]!.y));
    const total = lengths.at(-1)! || 1;
    for (let i = 1; i < raw.length; i++) {
      const p = raw[i]!, last = i === raw.length - 1, t = lengths[i]! / total;
      const known = p.z !== null && edge?.geometryZ !== "symbolic" && (last ? b.known : true);
      const z = last ? b.z : p.z !== null ? p.z : a.z + (b.z - a.z) * t;
      out.push({ p: { x: last ? to.position.x : p.x, y: last ? to.position.y : p.y, z }, zKnown: known, mode: step.mode, edgeId: step.edgeId, stepIndex });
    }
  });
  return out;
}

export function save(testInfo: TestInfo, name: string, data: unknown): string {
  const dir = path.join(ARTIFACTS, "evidence", testInfo.project.name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data, null, 2));
  return file;
}

export function shotPath(testInfo: TestInfo, name: string): string {
  const dir = path.join(ARTIFACTS, "evidence", testInfo.project.name);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}
