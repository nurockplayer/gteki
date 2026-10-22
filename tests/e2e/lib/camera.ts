import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { Vec3, Waypoint } from "./gteki.ts";

/**
 * Follow-camera measurement helpers (#49 follow-camera half, #70 crowding, #94/#136 lens).
 *
 * Nothing here needs a new app hook. From `window.__gteki` it uses `sceneInfo().camera` (renderer frame,
 * rounded to 0.1 m) and `avatar()` (station ENU, feet). The lens (vertical FOV, aspect), the exact camera
 * position and the avatar's on-screen height come from LENS_PROBE: an init script that wraps
 * WebGL `getUniformLocation`/`uniformMatrix4fv` and keeps the perspective `projectionMatrix` and
 * `viewMatrix` the renderer actually uploaded. So the FOV is what was rendered, not what a constant says.
 */

// ---- Candidate constants, read from source ------------------------------------------------------

export interface FollowConstants {
  source: string;
  minDistance: number;
  defaultDistance: number;
  shoulder: number;
  clearance: number;
  lowestBoom: number;
  /** WALKER_BODY: head height and body top above the avatar's feet. */
  eyeM: number;
  bodyTopM: number;
  /** Declared vertical FOVs (degrees) from the source, for comparison with the measured one. null: not declared. */
  declaredFov: { follow: number | null; firstPerson: number | null; overview: number | null; settleS: number | null; source: string };
}

// origin/main values when this was written (apps/web/src/explorer/followCamera.ts, packages/scene-api).
const FALLBACK: FollowConstants = {
  source: "fallback (origin/main constants; GTEKI_ROOT source not readable)",
  minDistance: 0.55, defaultDistance: 3.4, shoulder: 0.42, clearance: 0.3, lowestBoom: -0.1, eyeM: 1.62, bodyTopM: 1.7,
  declaredFov: { follow: null, firstPerson: null, overview: null, settleS: null, source: "none" },
};

export function followConstants(): FollowConstants {
  const root = process.env.GTEKI_ROOT;
  if (!root) return FALLBACK;
  try {
    const follow = fs.readFileSync(path.join(root, "apps/web/src/explorer/followCamera.ts"), "utf8");
    const scene = fs.readFileSync(path.join(root, "packages/scene-api/src/index.ts"), "utf8");
    const num = (src: string, key: string): number | null => {
      const m = new RegExp(`\\b${key}:\\s*(-?[0-9.]+)`).exec(src);
      return m ? Number(m[1]) : null;
    };
    const block = /export const FOLLOW = \{([\s\S]*?)\} as const/.exec(follow)?.[1] ?? "";
    const body = /WALKER_BODY = \{([^}]*)\}/.exec(scene)?.[1] ?? "";
    const fovBlock = /export const FOV = \{([\s\S]*?)\} as const/.exec(follow)?.[1];
    const declaredFov = fovBlock
      ? { follow: num(fovBlock, "follow"), firstPerson: num(fovBlock, "firstPerson"), overview: num(fovBlock, "overview"), settleS: num(fovBlock, "settle"), source: "followCamera.ts FOV" }
      : (() => {
          // Before #136 the lens is the PerspectiveCamera constructor literal in explorer.ts, shared by every mode.
          const lit = /new THREE\.PerspectiveCamera\(\s*([0-9.]+)/.exec(fs.readFileSync(path.join(root, "apps/web/src/explorer/explorer.ts"), "utf8"))?.[1];
          const v = lit ? Number(lit) : null;
          return { follow: v, firstPerson: v, overview: v, settleS: null, source: "explorer.ts PerspectiveCamera literal (no FOV table)" };
        })();
    const c = {
      minDistance: num(block, "minDistance"), defaultDistance: num(block, "defaultDistance"), shoulder: num(block, "shoulder"),
      clearance: num(block, "clearance"), lowestBoom: num(block, "lowestBoom"), eyeM: num(body, "eyeM"), bodyTopM: num(body, "bodyTopM"),
    };
    if (Object.values(c).some((v) => v === null)) return { ...FALLBACK, source: "fallback (a constant was not found in the GTEKI_ROOT source)" };
    return { source: "GTEKI_ROOT apps/web/src/explorer/followCamera.ts FOLLOW + packages/scene-api WALKER_BODY", ...(c as Omit<FollowConstants, "source" | "declaredFov">), declaredFov };
  } catch {
    return FALLBACK;
  }
}

/** The candidate under test, so two runs (main vs a PR) can be told apart in their JSON. */
export function candidateIdentity(): { sha: string | null; branch: string | null; source: string } {
  const root = process.env.GTEKI_ROOT;
  const git = (...args: string[]) => {
    try { return execFileSync("git", ["-C", root!, ...args], { encoding: "utf8", timeout: 5000 }).trim() || null; } catch { return null; }
  };
  if (root) {
    const sha = git("rev-parse", "HEAD");
    if (sha) return { sha, branch: git("rev-parse", "--abbrev-ref", "HEAD"), source: "git -C GTEKI_ROOT" };
  }
  const env = process.env.GTEKI_CANDIDATE_SHA ?? null;
  return { sha: env, branch: null, source: env ? "env GTEKI_CANDIDATE_SHA" : "unknown (GTEKI_ROOT is not a git checkout and GTEKI_CANDIDATE_SHA is unset)" };
}

// ---- In-page lens probe ---------------------------------------------------------------------------

/**
 * Init script (page.addInitScript before the page loads). Keeps, per aspect ratio, the latest perspective
 * projectionMatrix and the latest viewMatrix uploaded after it; `window.__qaLensRead()` returns the ones whose
 * aspect matches the explorer canvas. m[5] = 1/tan(fov/2), m[0] = m[5]/aspect, m[11] = -1, m[15] = 0
 * identify a perspective matrix (orthographic post passes and UI quads are ignored). A shadow-casting
 * perspective camera at another aspect would be skipped; one at the canvas aspect would be ambiguous, so
 * `candidates` lists every distinct FOV seen at that aspect in the last second.
 */
export const LENS_PROBE = `(() => {
  // three skips uniform uploads whose value is unchanged per program, so the main camera's projection is uploaded
  // only when it changes or a program is first used. Keep the latest perspective projection per aspect on every
  // upload (orthographic post-pass quads are ignored, never reset it), and the latest viewMatrix next to the
  // perspective aspect last uploaded. The lens comes from the projection alone; position and avatar share need a
  // view, which only programs using viewMatrix upload (envMap, shadows, custom shaders), so they can be null.
  const L = { names: new WeakMap(), projs: new Map(), views: new Map(), lastKey: null };
  window.__qaLens = L;
  const persp = (v) => v && v.length === 16 && Math.abs(v[11] + 1) < 1e-6 && Math.abs(v[15]) < 1e-6;
  const wrap = (C) => {
    if (!C) return;
    const gl = C.prototype.getUniformLocation;
    C.prototype.getUniformLocation = function (p, n) {
      const l = gl.call(this, p, n);
      if (l && (n === "projectionMatrix" || n === "viewMatrix")) L.names.set(l, n);
      return l;
    };
    const um = C.prototype.uniformMatrix4fv;
    C.prototype.uniformMatrix4fv = function (loc, tr, v, ...rest) {
      const n = loc && L.names.get(loc);
      const now = performance.now();
      if (n === "projectionMatrix" && persp(v)) {
        const aspect = v[5] / v[0], key = Math.round(aspect * 1000);
        const prev = L.projs.get(key);
        const fovs = prev ? prev.fovs.filter((f) => now - f.t < 1000) : [];
        const fov = 2 * Math.atan(1 / v[5]) * 180 / Math.PI;
        const same = fovs.find((f) => Math.abs(f.fov - fov) < 0.01);
        if (same) same.t = now; else fovs.push({ fov, t: now });
        L.projs.set(key, { proj: Float32Array.from(v), aspect, t: now, fovs });
        L.lastKey = key;
      } else if (n === "viewMatrix" && L.lastKey !== null && v && v.length === 16) {
        L.views.set(L.lastKey, { view: Float32Array.from(v), t: now });
      }
      return um.call(this, loc, tr, v, ...rest);
    };
  };
  wrap(self.WebGL2RenderingContext);
  wrap(self.WebGLRenderingContext);
  /** Latest main-camera lens, camera position (renderer frame) and, with an avatar, its screen height share. */
  window.__qaLensRead = (avatar, bodyTopM) => {
    const c = document.querySelector("canvas.gteki-canvas");
    if (!c || !c.clientHeight) return null;
    const ca = c.clientWidth / c.clientHeight;
    let best = null, bestKey = null;
    for (const [k, p] of L.projs) if (Math.abs(p.aspect / ca - 1) < 0.03 && (!best || p.t > best.t)) { best = p; bestKey = k; }
    if (!best) return null;
    const P = best.proj, vw = L.views.get(bestKey) ?? null, V = vw ? vw.view : null;
    const cam = V ? [0, 1, 2].map((j) => -(V[j * 4] * V[12] + V[j * 4 + 1] * V[13] + V[j * 4 + 2] * V[14])) : null;
    let share = null, inFrame = null, cx = null;
    if (avatar && V) {
      const proj = (x, y, z) => {
        const v = [0, 1, 2].map((i) => V[i] * x + V[4 + i] * y + V[8 + i] * z + V[12 + i]);
        const cl = [0, 1, 2, 3].map((i) => P[i] * v[0] + P[4 + i] * v[1] + P[8 + i] * v[2] + P[12 + i]);
        return cl[3] > 0 ? [cl[0] / cl[3], cl[1] / cl[3]] : null;
      };
      // station ENU (x, y, z up) -> renderer (x, z, -y)
      const f = proj(avatar.x, avatar.z, -avatar.y), h = proj(avatar.x, avatar.z + bodyTopM, -avatar.y);
      if (f && h) {
        share = Math.round(((h[1] - f[1]) / 2) * 1000) / 1000;
        inFrame = Math.abs(f[0]) <= 1 && Math.abs(h[0]) <= 1 && Math.abs(f[1]) <= 1 && Math.abs(h[1]) <= 1;
        cx = Math.round(((f[0] + h[0]) / 2) * 1000) / 1000;
      }
    }
    const now = performance.now();
    return {
      fovV: Math.round(2 * Math.atan(1 / P[5]) * 180 / Math.PI * 1000) / 1000, aspect: Math.round(ca * 1000) / 1000,
      cam: cam ? cam.map((v) => Math.round(v * 1000) / 1000) : null, ageMs: Math.round(now - best.t), viewAgeMs: vw ? Math.round(now - vw.t) : null, share, inFrame, cx,
      candidates: best.fovs.map((f) => Math.round(f.fov * 100) / 100),
    };
  };
})();`;

export interface LensRead { fovV: number; aspect: number; cam: number[] | null; ageMs: number; viewAgeMs: number | null; share: number | null; inFrame: boolean | null; cx: number | null; candidates: number[] }

// ---- Samplers -------------------------------------------------------------------------------------

/** Raw in-page sample: renderer-frame camera position, ENU avatar position, explorer mode, lens. */
export interface RawCameraSample { t: number; camera: number[] | null; avatar: Vec3 | null; mode: string | null; lens: LensRead | null }

/**
 * Start a sampler inside the page (setInterval; one `sceneInfo()` + `avatar()` + lens read per tick),
 * independent of the Playwright round trip, so it keeps a steady cadence while screenshots are taken.
 * `sceneInfo()` re-measures two bounding boxes per call (a lighter hook is on the request list), so keep
 * the interval at >= 250 ms.
 */
export async function startCameraSampler(page: Page, intervalMs: number, bodyTopM: number): Promise<void> {
  await page.evaluate(([ms, top]) => {
    const w = window as any;
    if (w.__qaCam?.timer) clearInterval(w.__qaCam.timer);
    const st = { samples: [] as unknown[], timer: 0 as any, errors: 0 };
    w.__qaCam = st;
    st.timer = setInterval(() => {
      try {
        const g = w.__gteki;
        const avatar = g.avatar() ?? null;
        st.samples.push({ t: performance.now(), camera: g.sceneInfo()?.camera ?? null, avatar, mode: g.mode() ?? null, lens: w.__qaLensRead?.(avatar, top) ?? null });
      } catch { st.errors++; }
    }, ms);
  }, [intervalMs, bodyTopM] as const);
}

/** Samples recorded since the previous call. */
export async function drainCameraSamples(page: Page): Promise<RawCameraSample[]> {
  return page.evaluate(() => {
    const st = (window as any).__qaCam;
    return st ? st.samples.splice(0, st.samples.length) : [];
  });
}

export async function stopCameraSampler(page: Page): Promise<void> {
  await page.evaluate(() => { const st = (window as any).__qaCam; if (st?.timer) clearInterval(st.timer); }).catch(() => {});
}

// ---- Per-sample metrics ---------------------------------------------------------------------------

export interface CameraSample {
  /** ms since the sampler started. */
  t: number;
  mode: string | null;
  /** Camera position in station ENU (the renderer frame is x, up, -north). */
  camera: Vec3;
  /** "viewMatrix": exact, from the uploaded view matrix. "sceneInfo": rounded to 0.1 m (matrix missing or disagreeing by > 0.3 m). */
  cameraSource: "viewMatrix" | "sceneInfo";
  avatar: Vec3;
  /** Camera to the avatar's head (feet + eyeM): the metric #85 and #86 report. */
  headDistance: number;
  /** Camera height above the head (m); falls when the boom slides under an overhead blocker. */
  cameraAboveHead: number;
  /**
   * Camera to the orbit pivot, estimated as sqrt(headDistance^2 - shoulder^2) (the pivot sits `shoulder`
   * to the right of the head, perpendicular to the boom). A lower bound: a wall beside the walker shrinks
   * the shoulder, which makes the true pivot distance larger.
   */
  pivotDistanceEst: number;
  /** pivotDistanceEst <= minDistance + tolerance. */
  atClamp: boolean;
  /** pivotDistanceEst < minDistance - tolerance: only a camera-only blocker may pull the camera past the minimum. */
  belowClamp: boolean;
  /** headDistance < CROWDED_M (#70). */
  crowded: boolean;
  /** Whether a camera-only blocker is over the camera: not exposed by the hooks on main, always null. */
  overheadBlocker: boolean | null;
  /** Vertical FOV (deg) of the rendered main camera, aspect (canvas w/h) and the derived horizontal FOV. null: no perspective matrix seen. */
  fovV: number | null;
  aspect: number | null;
  fovH: number | null;
  /** Avatar feet-to-top height as a share of the viewport height (exact projection); null when not projectable. */
  avatarHeightShare: number | null;
  /** Avatar feet and top both inside the viewport. */
  avatarInFrame: boolean | null;
  /** Edge mode of the route step the avatar is on (nearest route segment), when a route was given. */
  stepMode: string | null;
}

export const CROWDED_M = 1.0;
/** sceneInfo().camera is rounded to 0.05 m per axis; the pivot estimate adds to that. */
export const CLAMP_TOLERANCE_M = 0.15;
const DEG = 180 / Math.PI;

export function toSample(raw: RawCameraSample, t0: number, k: FollowConstants, wps?: Waypoint[]): CameraSample | null {
  if (!raw.camera || raw.camera.length < 3 || !raw.avatar) return null;
  const rounded = raw.camera as [number, number, number];
  const exact = raw.lens?.cam as [number, number, number] | undefined;
  const useMatrix = !!exact && Math.hypot(exact[0] - rounded[0], exact[1] - rounded[1], exact[2] - rounded[2]) <= 0.3;
  const [cx, cy, cz] = useMatrix ? exact! : rounded;
  const camera: Vec3 = { x: cx, y: -cz, z: cy };
  const head = { x: raw.avatar.x, y: raw.avatar.y, z: raw.avatar.z + k.eyeM };
  const headDistance = Math.hypot(camera.x - head.x, camera.y - head.y, camera.z - head.z);
  const pivotDistanceEst = Math.sqrt(Math.max(0, headDistance * headDistance - k.shoulder * k.shoulder));
  const r = (v: number, d = 1000) => Math.round(v * d) / d;
  const fovV = raw.lens?.fovV ?? null;
  const aspect = raw.lens?.aspect ?? null;
  return {
    t: Math.round(raw.t - t0), mode: raw.mode, camera, cameraSource: useMatrix ? "viewMatrix" : "sceneInfo", avatar: raw.avatar,
    headDistance: r(headDistance), cameraAboveHead: r(camera.z - head.z), pivotDistanceEst: r(pivotDistanceEst),
    atClamp: pivotDistanceEst <= k.minDistance + CLAMP_TOLERANCE_M,
    belowClamp: pivotDistanceEst < k.minDistance - CLAMP_TOLERANCE_M,
    crowded: headDistance < CROWDED_M,
    overheadBlocker: null,
    fovV, aspect,
    fovH: fovV !== null && aspect !== null ? r(2 * Math.atan(Math.tan((fovV / 2) / DEG) * aspect) * DEG, 100) : null,
    avatarHeightShare: raw.lens?.share ?? null, avatarInFrame: raw.lens?.inFrame ?? null,
    stepMode: wps && wps.length > 1 ? stepModeAt(wps, raw.avatar) : null,
  };
}

/** Edge mode of the route segment nearest (3D) to p. A segment ending at waypoint k belongs to waypoint k's step. */
export function stepModeAt(wps: Waypoint[], p: Vec3): string {
  let best = Infinity, mode = wps[0]!.mode;
  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1]!.p, b = wps[i]!.p;
    const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z, len2 = vx * vx + vy * vy + vz * vz || 1;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy + (p.z - a.z) * vz) / len2));
    const d = Math.hypot(p.x - (a.x + u * vx), p.y - (a.y + u * vy), p.z - (a.z + u * vz));
    if (d < best) { best = d; mode = wps[i]!.mode; }
  }
  return mode;
}

/** Longest stretch (ms) of consecutive samples for which `flag` holds; each sample stands for one interval. */
export function longestRunMs(samples: CameraSample[], flag: (s: CameraSample) => boolean, intervalMs: number): { ms: number; startT: number | null } {
  let best = { ms: 0, startT: null as number | null };
  let start: CameraSample | null = null;
  let prev: CameraSample | null = null;
  const close = () => {
    if (start && prev) {
      const ms = prev.t - start.t + intervalMs;
      if (ms > best.ms) best = { ms, startT: start.t };
    }
    start = null;
  };
  for (const s of samples) {
    if (flag(s)) { if (!start) start = s; prev = s; } else close();
  }
  close();
  return best;
}

const quantile = (sorted: number[], q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]! : null);
const rnd = (v: number | null, d = 1000) => (v === null ? null : Math.round(v * d) / d);

function stats(samples: CameraSample[], intervalMs: number) {
  const n = samples.length;
  const frac = (f: (s: CameraSample) => boolean) => (n ? Math.round((samples.filter(f).length / n) * 1000) / 1000 : null);
  const d = samples.map((s) => s.headDistance).sort((a, b) => a - b);
  const share = samples.map((s) => s.avatarHeightShare).filter((v): v is number => v !== null).sort((a, b) => a - b);
  return {
    samples: n,
    headDistance: { min: d[0] ?? null, p5: quantile(d, 0.05), median: quantile(d, 0.5), max: d.at(-1) ?? null },
    fractionAtClamp: frac((s) => s.atClamp),
    fractionBelowClamp: frac((s) => s.belowClamp),
    fractionCrowded: frac((s) => s.crowded),
    longestAtClampRun: longestRunMs(samples, (s) => s.atClamp, intervalMs),
    longestBelowClampRun: longestRunMs(samples, (s) => s.belowClamp, intervalMs),
    longestCrowdedRun: longestRunMs(samples, (s) => s.crowded, intervalMs),
    minCameraAboveHead: n ? Math.min(...samples.map((s) => s.cameraAboveHead)) : null,
    avatarHeightShare: { min: share[0] ?? null, median: quantile(share, 0.5), max: share.at(-1) ?? null, n: share.length },
    fractionAvatarOutOfFrame: n ? Math.round((samples.filter((s) => s.avatarInFrame === false).length / n) * 1000) / 1000 : null,
  };
}

export function summarise(samples: CameraSample[], intervalMs: number) {
  const guide = samples.filter((s) => s.mode === "guide");
  const fovs = guide.map((s) => s.fovV).filter((v): v is number => v !== null);
  const fovH = guide.map((s) => s.fovH).filter((v): v is number => v !== null);
  const byMode: Record<string, ReturnType<typeof stats>> = {};
  for (const m of new Set(guide.map((s) => s.stepMode ?? "unknown"))) byMode[m] = stats(guide.filter((s) => (s.stepMode ?? "unknown") === m), intervalMs);
  return {
    intervalMs,
    all: stats(samples, intervalMs),
    guideOnly: stats(guide, intervalMs),
    byStepMode: byMode,
    lens: {
      fovVDistinct: [...new Set(fovs.map((f) => Math.round(f * 10) / 10))].sort((a, b) => a - b),
      fovVMedian: rnd(quantile([...fovs].sort((a, b) => a - b), 0.5), 100),
      fovHMedian: rnd(quantile([...fovH].sort((a, b) => a - b), 0.5), 100),
      aspect: guide.find((s) => s.aspect !== null)?.aspect ?? null,
      samplesWithoutLens: samples.filter((s) => s.fovV === null).length,
    },
  };
}

// ---- Per-frame FOV recorder for the ease checks ------------------------------------------------------

export interface FovFrame { t: number; fovV: number | null; mode: string | null }

/** Record the rendered vertical FOV on every animation frame, plus the time of any click (capture phase). */
export async function startFovRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    w.__qaFovStop?.();
    const st = { frames: [] as unknown[], marks: [] as number[], stop: false };
    const onClick = () => st.marks.push(performance.now());
    document.addEventListener("click", onClick, true);
    const loop = () => {
      if (st.stop) return;
      const l = w.__qaLensRead?.(null, 0);
      st.frames.push({ t: performance.now(), fovV: l ? l.fovV : null, mode: w.__gteki?.mode?.() ?? null });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    w.__qaFov = st;
    w.__qaFovStop = () => { st.stop = true; document.removeEventListener("click", onClick, true); };
  });
}

/** Stop recording; frames are relative to the first click mark (t = 0), or to the recorder start without one. */
export async function stopFovRecorder(page: Page): Promise<{ frames: FovFrame[]; markedAtMs: number | null }> {
  const out = await page.evaluate(() => {
    const w = window as any;
    const st = w.__qaFov;
    w.__qaFovStop?.();
    return st ? { frames: st.frames as { t: number; fovV: number | null; mode: string | null }[], mark: (st.marks[0] ?? null) as number | null } : { frames: [], mark: null };
  });
  const base = out.mark ?? out.frames[0]?.t ?? 0;
  return { frames: out.frames.map((f) => ({ t: Math.round(f.t - base), fovV: f.fovV, mode: f.mode })), markedAtMs: out.mark };
}

export interface FovEase {
  event: string;
  frames: number;
  startFov: number | null;
  endFov: number | null;
  /** Largest FOV change between two consecutive recorded frames (deg), measured from the click on. */
  maxStepDeg: number | null;
  /** Time from the click until the FOV is within 0.05 deg of its final value; null when it never moved. */
  settleMs: number | null;
  /** Total change in FOV after the click (deg). */
  changeDeg: number | null;
  curve: { t: number; fovV: number | null; mode: string | null }[];
}

export function analyseFovEase(event: string, rec: { frames: FovFrame[] }): FovEase {
  const post = rec.frames.filter((f) => f.t >= -50 && f.fovV !== null) as { t: number; fovV: number; mode: string | null }[];
  const before = post.filter((f) => f.t < 0).at(-1) ?? post[0];
  const after = post.filter((f) => f.t >= 0);
  const start = before?.fovV ?? null;
  const end = after.at(-1)?.fovV ?? null;
  let maxStep = 0;
  let prev = before;
  for (const f of after) {
    if (prev) maxStep = Math.max(maxStep, Math.abs(f.fovV - prev.fovV));
    prev = f;
  }
  const moved = start !== null && end !== null && Math.abs(end - start) > 0.05;
  const settle = moved ? (after.find((f) => Math.abs(f.fovV - end!) <= 0.05)?.t ?? null) : null;
  return {
    event, frames: rec.frames.length, startFov: rnd(start, 100), endFov: rnd(end, 100), maxStepDeg: post.length > 1 ? rnd(maxStep, 100) : null, settleMs: settle,
    changeDeg: start !== null && end !== null ? rnd(end - start, 100) : null,
    // Thin the curve (every other frame away from the click) so the JSON stays small and diffable.
    curve: post.filter((f, i) => i % 2 === 0 || Math.abs(f.t) < 80).map((f) => ({ t: f.t, fovV: rnd(f.fovV, 100), mode: f.mode })),
  };
}
