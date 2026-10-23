import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { hooks, openStation, stationData, type Vec3 } from "../lib/gteki.ts";

/**
 * Sign probe for Ikebukuro (#108, #180): screenshots of the five `sign-rep-sw_h__w_cj-N` repeater signs and the
 * six blue `sign-place-sw_h__w_cj-N` place boards on the sw_h to w_cj passage, both faces of each, plus a tight
 * crop of every sign face at native pixels (to judge text legibility at phone resolution without zooming the full
 * frame) and the size of every texture the page uploads (the sign atlas page in particular). Measurement and
 * evidence, not a visual golden.
 *
 * Not part of CI (e2e-smoke.yml names its specs) and skipped unless GTEKI_REPEATERS=1. Needs a real GPU: run
 * it on the dev Mac in Brave, one project per tier, each against a built candidate (`pnpm build` in apps/web
 * first; the config serves it with `vite preview`). Run from tests/e2e, one pass at a time:
 *
 *   GTEKI_REPEATERS=1 GTEKI_ROOT=<checkout> pnpm exec playwright test specs/11-ikebukuro-repeater-signs.spec.ts --project=desktop-chromium          # high, 1280x720
 *   GTEKI_REPEATERS=1 GTEKI_ROOT=<checkout> pnpm exec playwright test specs/11-ikebukuro-repeater-signs.spec.ts --project=phone-chromium            # low, Pixel 7 (412x915, DPR 2.625)
 *   GTEKI_REPEATERS=1 GTEKI_ROOT=<checkout> pnpm exec playwright test specs/11-ikebukuro-repeater-signs.spec.ts --project=phone-iphone15-chromium   # low, iPhone 15 size (393x852, DPR 3, touch) in Brave
 *
 * Add GTEKI_REPEATERS_TIER=low (or high) to assert the tier the run landed on. The iPhone pass is Brave
 * (Chromium) at iPhone 15 geometry, not Safari: the low tier caps the render pixel ratio at 1.5, so the canvas
 * renders at about 590x1278 and the DPR 3 screenshot upsamples it (the report records both). Outputs never
 * overwrite each other: desktop-chromium and phone-chromium keep `<tier>/` and `ikebukuro-repeaters-<tier>.*`;
 * any other project writes `<tier>-<project>/` and `ikebukuro-repeaters-<tier>-<project>.*`.
 *
 * Placement. The explorer exposes no "teleport to ENU" hook (`walkFrom(enu)` is not on window.__gteki and there
 * is no `?spawn=` param in apps/web; that param exists only in the stations/ikebukuro preview harness). So the
 * walker is spawned with walkFromNode at sw_h (front pass, walking north) or w_cj (back pass, walking south) and
 * driven along the verified edge `sw_h__w_cj` polyline with hooks.simulate (W, Shift when far) and mouse-drag
 * yaw, the way specs/04 steers. The polyline is not perfectly straight (it bends twice near its south end); each
 * stop is the point on the polyline 6 m (arc length) before the sign's own projection onto it, then the walker
 * is turned to look at the sign. Where the walker really ended up is recorded per shot. Signs are visited in
 * order along the passage (repeaters and place boards interleave about every 12 m).
 *
 * Faces. Signs face along `facing` (towards the viewer of the front face). Front is seen walking north from the
 * south (sw_h side), back is seen walking south from the north (w_cj side). A face the sign builder did not paint
 * (hooks.signFaces) is not shot. The place boards carry both faces.
 *
 * Crops and readability. For each shot the four corners of the sign face are projected through the explorer's
 * own camera (hooks.projectEnu; face width/height come from the sign builder via hooks.signFaces) and the page is
 * re-shot clipped to that box plus a margin, at the screenshot's native device pixels (`<name>.crop.png`). Per
 * face the report gives the on-screen face height in CSS px, device px and canvas render px, and the smallest
 * type as em / cap height derived from the layout in scene/signs.ts (the face canvas is 126 px high; the smallest
 * type is 0.2 of it on repeaters (the "Exit" caption) and 0.21 on place boards (English name, distance); cap
 * height is taken as 0.72 em, an approximation). It ends with a readability checklist, one line per face with
 * its crop, for the reviewer to mark.
 *
 * Texture probe. An init script hooks bindTexture/activeTexture and texStorage2D/texImage2D (level 0) and
 * records width x height per texture, then learns the upload source type from the following texSubImage2D /
 * texImage2D. The sign atlas pages are the only CanvasTextures of width 4096 (packAtlas in scene/signs.ts); the
 * 4k lightmap is square and arrives from a decoded WebP (HTMLImageElement / ImageBitmap), so atlas = width
 * 4096 AND source is a canvas, and the lightmap is told apart by source type, not by aspect. Every size is
 * reported regardless (`textures`), with the source type, so a misclassification is visible in the output.
 *
 * Env: GTEKI_REPEATERS_OUT (output dir, default <GTEKI_ROOT>/.qa/ikebukuro-repeaters),
 *      GTEKI_REPEATERS_IDS (comma list of sign ids on this edge, e.g. "sign-place-sw_h__w_cj-3,sign-rep-sw_h__w_cj-2";
 *        default: every `sign-rep-*` and `sign-place-*` on the edge),
 *      GTEKI_REPEATERS_SIGNS (legacy: comma list of 1..5 selecting repeaters only; ignored when IDS is set),
 *      GTEKI_REPEATERS_TIER (assert "low" or "high"),
 *      GTEKI_REPEATERS_BEFORE_M (stand-off in metres, default 6).
 */
test.skip(!process.env.GTEKI_REPEATERS, "set GTEKI_REPEATERS=1 to run the Ikebukuro sign probe");
test.use({ trace: "off", video: "off", screenshot: "off" });

const EDGE = "sw_h__w_cj";
const FROM = "sw_h";
const TO = "w_cj";
const STANDOFF_M = Number(process.env.GTEKI_REPEATERS_BEFORE_M ?? 6);
const WANT_IDS = (process.env.GTEKI_REPEATERS_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const WANT_REPEATERS = process.env.GTEKI_REPEATERS_SIGNS?.split(",").map((s) => Number(s.trim())).filter((n) => n >= 1 && n <= 5);
/** Projects whose outputs keep the original tier-only names. */
const LEGACY_NAMES = new Set(["desktop-chromium", "phone-chromium"]);
/** Layout facts from scene/signs.ts: face canvas height (H 0.42 m x 300 px/m), smallest type as a fraction of it, cap height per em. */
const CANVAS_H_PX = 126;
/** Repeaters: the "Exit" caption, EXIT_EN_EM; place boards: English name and distance, SMALL_EM (scene/signage.test.ts pins both). */
const MIN_EM_FRAC = { repeat: 0.2, place: 0.21 } as const;
const CAP_PER_EM = 0.72;
const LOOK_RAD_PER_PX = 0.0042;
const WALK_MPS = 1.45;
const RUN_MPS = 3.4;

/** Records every texture's size and upload source type (see header). Runs before page scripts. */
const TEX_PROBE = `(() => {
  const st = { entries: [] };
  window.__tex = st;
  const ctx = new WeakMap();
  const owner = new WeakMap();
  const S = (gl) => { let s = ctx.get(gl); if (!s) { s = { unit: 0, bound: {} }; ctx.set(gl, s); } return s; };
  const src = (s) => (s == null ? null : typeof s === "number" ? "offset" : (s.constructor && s.constructor.name) || typeof s);
  const sdim = (s) => (s ? [s.naturalWidth || s.videoWidth || s.displayWidth || s.width || 0, s.naturalHeight || s.videoHeight || s.displayHeight || s.height || 0] : [0, 0]);
  const TARGET = (t) => (t === 3553 ? "2d" : t >= 34069 && t <= 34074 ? "cube" : t === 35866 ? "2d-array" : t === 32879 ? "3d" : "other");
  const spec = (gl, target, w, h, d, via, source, levels) => {
    const s = S(gl);
    const tex = s.bound[s.unit + ":" + (target >= 34069 && target <= 34074 ? 34067 : target)];
    if (!tex) return;
    let e = owner.get(tex);
    if (!e || e.width !== w || e.height !== h) {
      e = { index: st.entries.length, width: w, height: h, depth: d, target: TARGET(target), via, srcType: src(source), levels };
      st.entries.push(e);
      owner.set(tex, e);
    } else if (!e.srcType && source != null) e.srcType = src(source);
  };
  const sub = (gl, target, source) => {
    const s = S(gl);
    const tex = s.bound[s.unit + ":" + (target >= 34069 && target <= 34074 ? 34067 : target)];
    const e = tex && owner.get(tex);
    if (e && !e.srcType && source != null) e.srcType = src(source);
  };
  const wrap = (C) => {
    if (!C) return;
    const P = C.prototype;
    const over = (name, f) => { const o = P[name]; if (o) P[name] = function (...a) { try { f(this, ...a); } catch (e) {} return o.apply(this, a); }; };
    over("activeTexture", (gl, u) => { S(gl).unit = u - 33984; });
    over("bindTexture", (gl, t, tex) => { const s = S(gl); s.bound[s.unit + ":" + t] = tex; });
    over("texStorage2D", (gl, t, lv, f, w, h) => spec(gl, t, w, h, 1, "texStorage2D", null, lv));
    over("texStorage3D", (gl, t, lv, f, w, h, d) => spec(gl, t, w, h, d, "texStorage3D", null, lv));
    over("texImage2D", (gl, t, level, f, ...r) => {
      if (level !== 0) return;
      if (r.length <= 3) { const s = r[2]; const [w, h] = sdim(s); spec(gl, t, w, h, 1, "texImage2D", s, 1); }
      else spec(gl, t, r[0], r[1], 1, "texImage2D", r[5] === undefined ? null : r[5], 1);
    });
    over("compressedTexImage2D", (gl, t, level, f, w, h) => { if (level === 0) spec(gl, t, w, h, 1, "compressedTexImage2D", null, 1); });
    over("texSubImage2D", (gl, t, ...a) => sub(gl, t, a.length >= 8 ? a[7] : a[5]));
  };
  wrap(self.WebGL2RenderingContext);
  wrap(self.WebGLRenderingContext);
})();`;

interface TexEntry { index: number; width: number; height: number; depth: number; target: string; via: string; srcType: string | null; levels: number }
interface Pt { x: number; y: number }

// ---- geometry on the sw_h to w_cj polyline ---------------------------------------------------------

function polyline(): Pt[] {
  const { graph } = stationData("ikebukuro");
  const e = graph.edges.find((x) => x.id === EDGE);
  if (!e?.geometry) throw new Error(`edge ${EDGE} has no geometry`);
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const pts = e.geometry.map((g) => ({ x: g.x, y: g.y }));
  // Orient it from FROM to TO regardless of how the edge is stored.
  const a = nodes.get(FROM)!.position;
  const first = pts[0]!, last = pts[pts.length - 1]!;
  return Math.hypot(first.x - a.x, first.y - a.y) <= Math.hypot(last.x - a.x, last.y - a.y) ? pts : [...pts].reverse();
}

const seglen = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

function arcTable(poly: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1]! + seglen(poly[i - 1]!, poly[i]!));
  return cum;
}

/** Arc length of the polyline point nearest p. */
function project(poly: Pt[], cum: number[], p: Pt): { s: number; off: number } {
  let best = { s: 0, off: Infinity };
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!, b = poly[i]!;
    const L = seglen(a, b);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (L * L)));
    const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const off = Math.hypot(p.x - q.x, p.y - q.y);
    if (off < best.off) best = { s: cum[i - 1]! + t * L, off };
  }
  return best;
}

function pointAt(poly: Pt[], cum: number[], s: number): Pt {
  const c = Math.max(0, Math.min(cum[cum.length - 1]!, s));
  for (let i = 1; i < poly.length; i++) {
    if (c <= cum[i]!) {
      const t = (c - cum[i - 1]!) / (cum[i]! - cum[i - 1]!);
      return { x: poly[i - 1]!.x + (poly[i]!.x - poly[i - 1]!.x) * t, y: poly[i - 1]!.y + (poly[i]!.y - poly[i - 1]!.y) * t };
    }
  }
  return poly[poly.length - 1]!;
}

/** Waypoints from arc `from` to arc `to`: interior polyline vertices in travel order, then the target point. */
function waypoints(poly: Pt[], cum: number[], from: number, to: number): Pt[] {
  const out: Pt[] = [];
  if (to >= from) { for (let i = 0; i < poly.length; i++) if (cum[i]! > from + 0.5 && cum[i]! < to - 0.5) out.push(poly[i]!); }
  else { for (let i = poly.length - 1; i >= 0; i--) if (cum[i]! < from - 0.5 && cum[i]! > to + 0.5) out.push(poly[i]!); }
  out.push(pointAt(poly, cum, to));
  return out;
}

// ---- steering (mirrors specs/04: yaw -= dx * 0.0042, forward in ENU = (-sin yaw, cos yaw)) ------------

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

interface Walker { pos: Vec3; yaw: number; at: Pt }

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

async function aim(page: Page, w: Walker, target: Pt): Promise<void> {
  const desired = Math.atan2(-(target.x - w.pos.x), target.y - w.pos.y);
  const dx = Math.round(-wrap(desired - w.yaw) / LOOK_RAD_PER_PX);
  if (Math.abs(dx) >= 2) w.yaw = wrap(w.yaw - (await drag(page, w.at, dx)) * LOOK_RAD_PER_PX);
}

/** Walk (run when far) through the waypoints; throws if the walker cannot make progress. */
async function walk(page: Page, w: Walker, wps: Pt[]): Promise<void> {
  for (let k = 0; k < wps.length; k++) {
    const wp = wps[k]!;
    const last = k === wps.length - 1;
    const reach = last ? 0.3 : 0.5;
    let stuck = 0;
    for (let guard = 0; guard < 600; guard++) {
      const d = dist(w.pos, wp);
      if (d < reach) break;
      await aim(page, w, wp);
      const run = d > 8;
      const secs = Math.max(0.05, Math.min(1.0, (d - reach * 0.5) / (run ? RUN_MPS : WALK_MPS)));
      w.pos = await hooks.simulate(page, secs, run ? ["KeyW", "ShiftLeft"] : ["KeyW"]);
      if (d - dist(w.pos, wp) < 0.02) {
        // Pressed against something: sidestep a little, as a player would, then re-aim.
        if (++stuck > 8) throw new Error(`walker stuck ${d.toFixed(2)} m from (${wp.x.toFixed(1)}, ${wp.y.toFixed(1)}) at (${w.pos.x.toFixed(1)}, ${w.pos.y.toFixed(1)})`);
        w.pos = await hooks.simulate(page, 0.35, [stuck % 2 ? "KeyA" : "KeyD"]);
      } else stuck = 0;
    }
  }
}

async function spawn(page: Page, node: string): Promise<Walker> {
  expect(await hooks.walkFromNode(page, node), `walkFromNode ${node}`).toBe(true);
  await expect.poll(() => hooks.mode(page)).toBe("walk");
  // walkFrom resets yaw to 0 (north).
  return { pos: await hooks.avatar(page), yaw: 0, at: await canvasPoint(page) };
}

// ---- the test ------------------------------------------------------------------------------------

type Kind = "repeat" | "place";
interface SignRec { id: string; kind: Kind; n: number; position: { x: number; y: number; z: number }; facing: { x: number; y: number }; along: number }
interface FaceRec { id: string; side: "front" | "back"; scale: number; widthM: number; heightM: number; canvasPx: { w: number; h: number } }
/** What the lead needs to judge legibility of one face; null where the face could not be measured. */
interface Readability {
  cropFile: string | null; inFrame: boolean; faceMeters: { w: number; h: number } | null;
  faceHeightCssPx: number | null; faceHeightDevicePx: number | null; faceHeightRenderPx: number | null; faceWidthCssPx: number | null;
  minEmCssPx: number | null; minEmDevicePx: number | null; minCapHeightDevicePx: number | null; minEmTexels: number | null;
  cameraDistM: number | null; dpr: number; renderScale: number; texelScale: number | null;
}
interface Shot {
  sign: string; kind: Kind; n: number; face: "front" | "back"; file: string; walkingToward: string;
  target: Pt; walker: Vec3; distToSignM: number; sideOk: boolean; offAxisDeg: number; offCorridorM: number;
  viewportShot: { width: number; height: number } | null; readability: Readability;
}

test("ikebukuro signs: screenshots, crops and atlas-size probe @phone", async ({ page }, testInfo) => {
  test.setTimeout(900_000);
  const root = process.env.GTEKI_ROOT;
  if (!root) throw new Error("GTEKI_ROOT must point at the candidate checkout");

  const poly = polyline();
  const cum = arcTable(poly);
  const total = cum[cum.length - 1]!;

  const signage = JSON.parse(fs.readFileSync(path.join(root, "stations", "ikebukuro", "scene", "signage.json"), "utf8")) as { signs: { id: string; position: { x: number; y: number; z: number }; facing: { x: number; y: number } }[] };
  const signs: SignRec[] = signage.signs
    .filter((s) => /^sign-(rep|place)-sw_h__w_cj-\d+$/.test(s.id))
    .map((s) => ({ id: s.id, kind: (s.id.startsWith("sign-place-") ? "place" : "repeat") as Kind, n: Number(s.id.split("-").pop()), position: s.position, facing: s.facing, along: project(poly, cum, s.position).s }))
    .sort((a, b) => a.along - b.along);
  const repeaters = signs.filter((s) => s.kind === "repeat").map((s) => s.n).sort((a, b) => a - b);
  expect(repeaters, "repeaters 1..5 in signage.json").toEqual([1, 2, 3, 4, 5]);
  let chosen: SignRec[];
  if (WANT_IDS.length) {
    const unknown = WANT_IDS.filter((id) => !signs.some((s) => s.id === id));
    if (unknown.length) throw new Error(`GTEKI_REPEATERS_IDS: no such sign on ${EDGE}: ${unknown.join(", ")}`);
    chosen = signs.filter((s) => WANT_IDS.includes(s.id));
  } else if (WANT_REPEATERS) chosen = signs.filter((s) => s.kind === "repeat" && WANT_REPEATERS.includes(s.n));
  else chosen = signs;
  if (!WANT_IDS.length && !WANT_REPEATERS) expect.soft(signs.filter((s) => s.kind === "place").length, "place boards (#180) in signage.json").toBe(6);

  const isPhone = testInfo.project.name.startsWith("phone");
  // Desktop evidence is 1280x720 (set before load so the explorer sizes its canvas and picks its tier from it);
  // the phone projects keep their device size.
  if (!isPhone) await page.setViewportSize({ width: 1280, height: 720 });

  await page.addInitScript(TEX_PROBE);
  const { loadMs } = await openStation(page, "ikebukuro");
  const tier = await hooks.quality(page);
  if (process.env.GTEKI_REPEATERS_TIER) expect(tier, "explorer quality tier").toBe(process.env.GTEKI_REPEATERS_TIER);
  const gl = await page.evaluate(() => (window as any).__qa?.gl ?? null);
  const gpuValid = Boolean(gl?.renderer) && !/SwiftShader|llvmpipe|Software/i.test(String(gl?.renderer));
  const viewport = page.viewportSize();

  const outDir = process.env.GTEKI_REPEATERS_OUT ?? path.join(root, ".qa", "ikebukuro-repeaters");
  const tag = LEGACY_NAMES.has(testInfo.project.name) ? tier : `${tier}-${testInfo.project.name}`;
  const shotDir = path.join(outDir, tag);
  fs.mkdirSync(shotDir, { recursive: true });
  const base = path.join(outDir, `ikebukuro-repeaters-${tag}`);

  // Face sizes from the sign builder, and the texel scale the candidate uses on the low tier (read from source).
  const faces = (await hooks.signFaces(page)) as FaceRec[];
  const hasFace = (id: string, side: "front" | "back") => faces.length === 0 || faces.some((f) => f.id === id && f.side === side);
  const lowScale = Number(/LOW_TEXEL_SCALE\s*=\s*([0-9.]+)/.exec(fs.readFileSync(path.join(root, "stations", "ikebukuro", "scene", "signs.ts"), "utf8"))?.[1]);
  const texelScale = tier === "high" ? 1 : Number.isFinite(lowScale) ? lowScale : null;

  /** Project the sign face's corners, clip a native-pixel crop around them, and derive the on-screen sizes. */
  const measureFace = async (s: SignRec, face: "front" | "back", stem: string): Promise<Readability> => {
    const e = await page.evaluate(() => {
      const c = document.querySelector("canvas.gteki-canvas") as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      return { left: r.left, top: r.top, cssW: c.clientWidth, pxW: c.width, dpr: window.devicePixelRatio, vw: window.innerWidth, vh: window.innerHeight };
    });
    const renderScale = e.pxW / Math.max(1, e.cssW);
    const out: Readability = {
      cropFile: null, inFrame: false, faceMeters: null, faceHeightCssPx: null, faceHeightDevicePx: null, faceHeightRenderPx: null, faceWidthCssPx: null,
      minEmCssPx: null, minEmDevicePx: null, minCapHeightDevicePx: null, minEmTexels: null, cameraDistM: null, dpr: e.dpr, renderScale: round(renderScale), texelScale,
    };
    const cam = ((await hooks.sceneInfo(page)) as { camera: number[] }).camera; // renderer frame (x, y up, z): ENU is (x, -z, y)
    out.cameraDistM = round(Math.hypot(cam[0]! - s.position.x, -cam[2]! - s.position.y, cam[1]! - s.position.z));
    const fc = faces.find((f) => f.id === s.id && f.side === face);
    if (!fc) return out;
    const wM = fc.widthM * fc.scale, hM = fc.heightM * fc.scale;
    out.faceMeters = { w: round(wM), h: round(hM) };
    const len = Math.hypot(s.facing.x, s.facing.y) || 1;
    const nx = s.facing.x / len, ny = s.facing.y / len; // towards the viewer of the front face
    const sgn = face === "front" ? 1 : -1;
    const cx = s.position.x + nx * 0.041 * fc.scale * sgn, cy = s.position.y + ny * 0.041 * fc.scale * sgn;
    const tx = -ny, ty = nx;
    const corner = (u: number, v: number): Vec3 => ({ x: cx + tx * u * (wM / 2), y: cy + ty * u * (wM / 2), z: s.position.z + v * (hM / 2) });
    const pr = await hooks.projectEnu(page, [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)]);
    const q = pr.map((p) => ({ x: p.x + e.left, y: p.y + e.top }));
    const behind = pr.some((p) => p.behind);
    out.inFrame = !behind && q.every((p) => p.x >= 0 && p.x <= e.vw && p.y >= 0 && p.y <= e.vh);
    if (behind) return out;
    const hCss = (dist(q[0]!, q[3]!) + dist(q[1]!, q[2]!)) / 2;
    const wCss = (dist(q[0]!, q[1]!) + dist(q[3]!, q[2]!)) / 2;
    const emCanvas = Math.round(CANVAS_H_PX * MIN_EM_FRAC[s.kind]);
    const emCss = hCss * (emCanvas / CANVAS_H_PX);
    out.faceHeightCssPx = round(hCss);
    out.faceHeightDevicePx = round(hCss * e.dpr);
    out.faceHeightRenderPx = round(hCss * renderScale);
    out.faceWidthCssPx = round(wCss);
    out.minEmCssPx = round(emCss);
    out.minEmDevicePx = round(emCss * e.dpr);
    out.minCapHeightDevicePx = round(emCss * e.dpr * CAP_PER_EM);
    out.minEmTexels = texelScale == null ? null : round(emCanvas * texelScale);
    // Crop: bounding box of the projected corners plus a margin, clamped to the viewport, native device pixels.
    const x0 = Math.min(...q.map((p) => p.x)), x1 = Math.max(...q.map((p) => p.x));
    const y0 = Math.min(...q.map((p) => p.y)), y1 = Math.max(...q.map((p) => p.y));
    const m = Math.max(8, 0.1 * Math.max(x1 - x0, y1 - y0));
    const cl = { x: Math.max(0, Math.floor(x0 - m)), y: Math.max(0, Math.floor(y0 - m)) };
    const clip = { x: cl.x, y: cl.y, width: Math.min(e.vw, Math.ceil(x1 + m)) - cl.x, height: Math.min(e.vh, Math.ceil(y1 + m)) - cl.y };
    if (clip.width >= 4 && clip.height >= 4) {
      const file = path.join(shotDir, `${stem}.crop.png`);
      await page.screenshot({ path: file, clip });
      out.cropFile = path.relative(outDir, file);
    }
    return out;
  };

  const shots: Shot[] = [];
  const shoot = async (w: Walker, s: SignRec, face: "front" | "back", target: Pt) => {
    // Look at the sign, then let the follow camera settle (simulate steps the camera at 60 Hz).
    await aim(page, w, s.position);
    w.pos = await hooks.simulate(page, 1.2, []);
    await page.waitForTimeout(600);
    const stem = `${s.kind === "place" ? "place" : "rep"}-${s.n}-${face}`;
    const file = path.join(shotDir, `${stem}.png`);
    await page.screenshot({ path: file });
    const readability = await measureFace(s, face, stem);
    const toSign = { x: s.position.x - w.pos.x, y: s.position.y - w.pos.y };
    const d = Math.hypot(toSign.x, toSign.y);
    // Front is seen from the side `facing` points to; back from the opposite side.
    const side = -(toSign.x * s.facing.x + toSign.y * s.facing.y);
    // Angle between the viewer's line of sight and the sign's normal (0 = dead on).
    const cos = Math.abs(side) / d;
    const proj = project(poly, cum, w.pos);
    shots.push({
      sign: s.id, kind: s.kind, n: s.n, face, file: path.relative(outDir, file), walkingToward: face === "front" ? TO : FROM,
      target, walker: { x: round(w.pos.x), y: round(w.pos.y), z: round(w.pos.z) }, distToSignM: round(d),
      sideOk: face === "front" ? side > 0 : side < 0, offAxisDeg: Math.round((Math.acos(Math.min(1, cos)) * 180) / Math.PI),
      offCorridorM: round(proj.off), viewportShot: viewport, readability,
    });
  };

  // Front faces: from sw_h walking north (towards w_cj), signs in order along the passage, one continuous walk.
  {
    const w = await spawn(page, FROM);
    let s = 0;
    for (const sign of chosen) {
      if (!hasFace(sign.id, "front")) continue;
      const stop = Math.max(0, sign.along - STANDOFF_M);
      const wps = waypoints(poly, cum, s, stop);
      await walk(page, w, wps);
      s = stop;
      await shoot(w, sign, "front", wps[wps.length - 1]!);
    }
  }
  // Back faces: from w_cj walking south (towards sw_h), signs in reverse order.
  {
    const w = await spawn(page, TO);
    let s = total;
    for (const sign of [...chosen].reverse()) {
      if (!hasFace(sign.id, "back")) continue;
      const stop = Math.min(total, sign.along + STANDOFF_M);
      const wps = waypoints(poly, cum, s, stop);
      await walk(page, w, wps);
      s = stop;
      await shoot(w, sign, "back", wps[wps.length - 1]!);
    }
  }

  // Texture sizes, after every sign has been in view (the atlas uploads on its first draw).
  const entries = await page.evaluate(() => ((window as any).__tex?.entries ?? []) as TexEntry[]);
  const isCanvas = (t: string | null) => !!t && /Canvas/i.test(t);
  const w4096 = entries.filter((e) => e.width === 4096);
  // Atlas pages: width 4096 and drawn from a canvas. The lightmap (square, from a decoded image) is excluded
  // by source type. Textures whose source was never seen (null: storage-only, render targets) are listed apart.
  const atlasPages = w4096.filter((e) => isCanvas(e.srcType));
  const unseen4096 = w4096.filter((e) => e.srcType === null);
  const lightmaps = entries.filter((e) => e.width === e.height && e.width >= 2048 && e.srcType !== null && !isCanvas(e.srcType));
  const atlasMaxHeight = atlasPages.length ? Math.max(...atlasPages.map((e) => e.height)) : null;
  const max4096Height = w4096.length ? Math.max(...w4096.map((e) => e.height)) : null;
  const square4096Atlas = atlasPages.filter((e) => e.width === 4096 && e.height === 4096);

  const result = {
    probe: "ikebukuro-repeater-signs", tier, project: testInfo.project.name, viewport, loadMs, gl, gpuValid,
    textureSizes: {
      atlasClassifiedBy: "width 4096 and upload source is a canvas; lightmap = square >= 2048 with a non-canvas (decoded image) source",
      atlasPages: atlasPages.map((e) => `${e.width}x${e.height}`),
      atlasMaxHeight, max4096WideHeightAnySource: max4096Height,
      lightmaps: lightmaps.map((e) => `${e.width}x${e.height} (${e.srcType})`),
      square4096AtlasPages: square4096Atlas.length,
      unseenSource4096: unseen4096.map((e) => `${e.width}x${e.height}`),
      textures: entries.map((e) => ({ ...e, size: `${e.width}x${e.height}` })),
    },
    corridor: { edge: EDGE, lengthM: round(total), standoffM: STANDOFF_M, polyline: poly },
    texelScale, lowTexelScaleInSource: Number.isFinite(lowScale) ? lowScale : null,
    shots,
  };
  fs.writeFileSync(`${base}.json`, JSON.stringify(result, null, 2));

  const yn = (b: unknown) => (b ? "yes" : "no");
  const md = [
    `# Ikebukuro repeater signs and place boards: ${tier} tier (${testInfo.project.name})`,
    "",
    `Renderer: ${gl?.renderer ?? "unknown"} (gpuValid=${gpuValid}); viewport ${JSON.stringify(viewport)}; page load ${loadMs} ms.`,
    "",
    `Sign atlas pages (4096 wide, canvas-sourced): ${atlasPages.map((e) => `${e.width}x${e.height}`).join(", ") || "none seen"}; max atlas height ${atlasMaxHeight ?? "n/a"}; ` +
      `max height among all 4096-wide textures ${max4096Height ?? "n/a"}. Lightmap(s): ${lightmaps.map((e) => `${e.width}x${e.height}`).join(", ") || "none identified"}.` +
      (tier === "low" ? ` Low tier must not upload a 4096x4096 sign page: ${square4096Atlas.length === 0 ? "ok" : "VIOLATED"}.` : ""),
    "",
    "All uploaded textures (level 0):",
    "",
    "| # | size | target | via | source |",
    "|---|---|---|---|---|",
    ...entries.map((e) => `| ${e.index} | ${e.width}x${e.height}${e.depth > 1 ? `x${e.depth}` : ""} | ${e.target} | ${e.via} | ${e.srcType ?? "unseen"} |`),
    "",
    "## Screenshots",
    "",
    "| sign | face | walking toward | walker ENU (x, y, z) | dist to sign (m) | off-axis | side ok | off corridor (m) | file |",
    "|---|---|---|---|---|---|---|---|---|",
    ...shots.map((s) => `| ${s.sign} | ${s.face} | ${s.walkingToward} | ${s.walker.x}, ${s.walker.y}, ${s.walker.z} | ${s.distToSignM} | ${s.offAxisDeg} deg | ${yn(s.sideOk)} | ${s.offCorridorM} | [${s.file}](${s.file}) |`),
    "",
    ...shots.map((s) => `![${s.sign} ${s.face}](${s.file})`),
    "",
    "## Readability checklist",
    "",
    `Setting: ${tier} tier, project ${testInfo.project.name}, viewport ${viewport ? `${viewport.width}x${viewport.height}` : "?"} CSS px, DPR ${shots[0]?.readability.dpr ?? "?"}, ` +
      `canvas render scale ${shots[0]?.readability.renderScale ?? "?"}x, sign texel scale ${texelScale ?? "?"} (LOW_TEXEL_SCALE in source: ${Number.isFinite(lowScale) ? lowScale : "not found"}).`,
    "",
    "Open each crop at 100%: it is the page at native device pixels, so what you see is what the screen shows. " +
      "Mark one box per face. Face height = on-screen height of the whole sign face; min cap = approximate cap height of its smallest type " +
      "(0.2 of face height on repeaters, 0.21 on place boards, times 0.72). Heights are device px unless stated; `render` is the canvas backing resolution (the low tier renders at <= 1.5x and the screenshot upsamples it).",
    "",
    ...(["place", "repeat"] as const).flatMap((kind) => {
      const rows = shots.filter((s) => s.kind === kind);
      if (!rows.length) return [];
      return [
        `### ${kind === "place" ? "Place boards (blue)" : "Repeater signs (charcoal)"}`,
        "",
        ...rows
          .sort((a, b) => a.n - b.n || a.face.localeCompare(b.face))
          .flatMap((s) => {
            const r = s.readability;
            const nums = r.faceHeightDevicePx == null
              ? "not measurable (face behind the camera or no face record)"
              : `face ${r.faceHeightDevicePx} px high (render ${r.faceHeightRenderPx}), ${r.faceWidthCssPx} CSS px wide; min em ${r.minEmDevicePx} px, min cap ~${r.minCapHeightDevicePx} px; ` +
                `min em ${r.minEmTexels ?? "?"} texels in the atlas; walker ${s.distToSignM} m / camera ${r.cameraDistM} m from the sign; ${r.inFrame ? "fully in frame" : "NOT fully in frame"}`;
            return [
              `- [ ] readable  [ ] not readable: \`${s.sign}\` ${s.face}, ${nums}. ${r.cropFile ? `Crop: [${r.cropFile}](${r.cropFile})` : "No crop."}`,
              ...(r.cropFile ? ["", `  ![${s.sign} ${s.face} crop](${r.cropFile})`, ""] : []),
            ];
          }),
        "",
      ];
    }),
  ].join("\n");
  fs.writeFileSync(`${base}.md`, md);
  testInfo.annotations.push({ type: "output", description: `${base}.json` });
  console.log(`repeater signs (${tier}) written to ${base}.json / .md`);

  expect(gpuValid, `renderer ${gl?.renderer}: software rendering invalidates the visuals and texture sizes`).toBe(true);
  const expectedShots = chosen.reduce((n, s) => n + (hasFace(s.id, "front") ? 1 : 0) + (hasFace(s.id, "back") ? 1 : 0), 0);
  expect(shots.length, "screenshots taken").toBe(expectedShots);
  for (const s of shots) {
    expect.soft(s.sideOk, `${s.sign} ${s.face}: walker is on the ${s.face} side of the sign`).toBe(true);
    expect.soft(Math.abs(s.distToSignM - STANDOFF_M), `${s.sign} ${s.face}: stand-off ${s.distToSignM} m`).toBeLessThan(2.5);
  }
  expect.soft(atlasPages.length, "a canvas-sourced 4096-wide sign atlas page was uploaded (else the probe proved nothing)").toBeGreaterThan(0);
  if (tier === "low") {
    expect(square4096Atlas.map((e) => `${e.width}x${e.height}`), "low tier uploads no 4096x4096 sign atlas page").toEqual([]);
    expect.soft(unseen4096.filter((e) => e.height === 4096).length, "no 4096x4096 texture of unseen source (not the lightmap: that has an image source)").toBe(0);
  }
});

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
