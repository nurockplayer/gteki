// Tone-map pre-compensation for UI overlays on the high tier (presentation only, pure: no GL).
//
// Overlays set `toneMapped: false`, which the low tier honours (exact authored sRGB). The high tier renders into a
// HalfFloat target and OutputPass tone-maps the whole frame, so overlays would be AgX-desaturated anyway. This module
// ports three r186's GLSL AgXToneMapping (+ OutputPass's sRGB OETF) to JS and inverts it numerically: given the
// display colour an overlay should show, it returns the linear colour to write into the material so the pipeline
// lands on it. Reachable gamut is limited (AgX output is clamped to Rec.709), so a residual is reported.
//
// The post grade (saturation/contrast/lift, after OutputPass) is modelled when `grade` is passed; its vignette and
// dither are ignored (view-dependent / ±1 LSB). Alpha blending happens before tone mapping, so a translucent
// overlay over a bright backdrop still drifts: this compensates the overlay's own colour only.

export type Vec3 = [number, number, number];

/** The grade slice that is a pure per-pixel colour map (see postfx.ts GradeShader). */
export interface GradeParams { contrast: number; saturation: number; lift: number }

/** Upper linear-input clamp of the solve: HDR emitters stay finite. */
const IN_MAX = 64;
/** Default lower clamp: physical colours only. */
const IN_MIN = 1e-6;

// three's GLSL mat3s are column-major: each triple below is one column.
const SRGB_TO_REC2020: readonly Vec3[] = [[0.6274, 0.0691, 0.0164], [0.3293, 0.9195, 0.088], [0.0433, 0.0113, 0.8956]];
const REC2020_TO_SRGB: readonly Vec3[] = [[1.6605, -0.1246, -0.0182], [-0.5876, 1.1329, -0.1006], [-0.0728, -0.0083, 1.1187]];
const AGX_INSET: readonly Vec3[] = [[0.856627153315983, 0.137318972929847, 0.11189821299995], [0.0951212405381588, 0.761241990602591, 0.0767994186031903], [0.0482516061458583, 0.101439036467562, 0.811302368396859]];
const AGX_OUTSET: readonly Vec3[] = [[1.1271005818144368, -0.1413297634984383, -0.14132976349843826], [-0.11060664309660323, 1.157823702216272, -0.11060664309660294], [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405]];
const AGX_MIN_EV = -12.47393;
const AGX_MAX_EV = 4.026069;

function mul(m: readonly Vec3[], v: Vec3): Vec3 {
  return [0, 1, 2].map((i) => m[0]![i]! * v[0] + m[1]![i]! * v[1] + m[2]![i]! * v[2]) as Vec3;
}

/** three's agxDefaultContrastApprox (iolite polynomial). */
function contrastApprox(x: number): number {
  const x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Hex (0xRRGGBB) to sRGB-encoded 0..1. */
export function hexToSrgb(hex: number): Vec3 {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** three r186 AgXToneMapping: linear-sRGB in (before exposure) to linear-sRGB out in 0..1. */
export function agxToneMap(rgb: Vec3, exposure: number): Vec3 {
  let c = mul(SRGB_TO_REC2020, [rgb[0] * exposure, rgb[1] * exposure, rgb[2] * exposure]);
  c = mul(AGX_INSET, c);
  c = c.map((v) => contrastApprox(clamp01((Math.log2(Math.max(v, 1e-10)) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV)))) as Vec3;
  c = mul(AGX_OUTSET, c);
  c = c.map((v) => Math.pow(Math.max(0, v), 2.2)) as Vec3;
  return mul(REC2020_TO_SRGB, c).map(clamp01) as Vec3;
}

/** Linear scene colour to display sRGB 0..1: exposure, AgX, sRGB OETF (OutputPass), then the grade if given. */
export function forwardDisplay(linear: Vec3, exposure: number, grade?: GradeParams): Vec3 {
  let c = agxToneMap(linear, exposure).map(linearToSrgb) as Vec3;
  if (grade) {
    const luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    c = c.map((v) => {
      const s = luma + (v - luma) * grade.saturation;
      const k = clamp01((s - 0.5) * grade.contrast + 0.5);
      return k + grade.lift * (1 - k);
    }) as Vec3;
  }
  return c;
}

export interface ToneCompensation {
  /** Linear colour to author into the material. */
  linear: Vec3;
  /** Max per-channel |displayed - target| in 0..255 display units. */
  residual: number;
}

/** Max per-channel error between two display colours, in 0..255 units. */
export function displayError(a: Vec3, b: Vec3): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) * 255;
}

/** Solves the 3x3 system A x = b by Cramer's rule; null when singular. */
function solve3(a: number[][], b: Vec3): Vec3 | null {
  const det = (m: number[][]) => m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) - m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) + m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
  const d = det(a);
  if (Math.abs(d) < 1e-18) return null;
  return [0, 1, 2].map((col) => det(a.map((row, i) => row.map((v, j) => (j === col ? b[i]! : v)))) / d) as Vec3;
}

/** One Levenberg-Marquardt run from `x0`; returns the best input seen and its squared error (0..1 display units). */
function lm(target: Vec3, exposure: number, grade: GradeParams | undefined, min: number, x0: Vec3): { x: Vec3; err: number } {
  const f = (x: Vec3) => forwardDisplay(x, exposure, grade);
  const sq = (y: Vec3) => (y[0] - target[0]) ** 2 + (y[1] - target[1]) ** 2 + (y[2] - target[2]) ** 2;
  const clampIn = (x: Vec3) => x.map((v) => Math.min(IN_MAX, Math.max(min, v))) as Vec3;
  let x = clampIn(x0);
  let y = f(x);
  let err = sq(y);
  let lambda = 1e-3;
  for (let it = 0; it < 40 && err > 1e-10; it++) {
    // Finite-difference Jacobian J[i][j] = dy_i / dx_j (relative step: the response is roughly logarithmic).
    const jac = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let j = 0; j < 3; j++) {
      const h = Math.max(1e-5, Math.abs(x[j]!) * 1e-3);
      const xp = [...x] as Vec3;
      xp[j] = x[j]! + h;
      const yp = f(xp);
      for (let i = 0; i < 3; i++) jac[i]![j] = (yp[i]! - y[i]!) / h;
    }
    const g: Vec3 = [0, 0, 0]; // J^T (target - y)
    const jtj = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) g[j] = g[j]! + jac[i]![j]! * (target[i]! - y[i]!);
      for (let k = 0; k < 3; k++) for (let i = 0; i < 3; i++) jtj[j]![k] = jtj[j]![k]! + jac[i]![j]! * jac[i]![k]!;
    }
    let improved = false;
    for (let tries = 0; tries < 8 && !improved; tries++) {
      const a = jtj.map((row, r) => row.map((v, c) => (r === c ? v + lambda * (v + 1e-6) : v)));
      const dx = solve3(a, g);
      if (dx) {
        const xn = clampIn([x[0] + dx[0], x[1] + dx[1], x[2] + dx[2]]);
        const yn = f(xn);
        const en = sq(yn);
        if (en < err) { x = xn; y = yn; err = en; lambda = Math.max(1e-7, lambda * 0.3); improved = true; continue; }
      }
      lambda *= 10;
    }
    if (!improved) break;
  }
  return { x, err };
}

/** Lower linear clamp the explorer's overlays use: enough negative headroom to reach AgX's saturated corners. */
export const OVERLAY_INPUT_MIN = -3;

export interface CompensateOptions {
  grade?: GradeParams;
  /**
   * Lowest linear channel value the solve may use (default ~0). AgX's inset matrix mixes channels, so saturated
   * display colours are only reachable with slightly negative linear channels (a float target and blend keep them).
   */
  min?: number;
}

/**
 * The linear input whose forward output is closest to `target` (display sRGB 0..1) at `exposure`.
 * Levenberg-Marquardt in 3D from the naive start (inverse sRGB / exposure) plus a few brighter restarts, since
 * AgX's clamps leave flat spots; well under 1 ms per colour.
 */
export function compensate(target: Vec3, exposure: number, opts: CompensateOptions = {}): ToneCompensation {
  const { grade, min = IN_MIN } = opts;
  const naive = target.map((v) => srgbToLinear(v) / exposure) as Vec3;
  let best = lm(target, exposure, grade, min, naive);
  for (const k of [2, 6, 20]) {
    if (best.err < 1e-6) break;
    const r = lm(target, exposure, grade, min, naive.map((v) => v * k) as Vec3);
    if (r.err < best.err) best = r;
  }
  return { linear: best.x, residual: displayError(forwardDisplay(best.x, exposure, grade), target) };
}

/** Display error when an overlay is NOT compensated: authored linear colour straight through the pipeline. */
export function uncompensatedError(target: Vec3, exposure: number, grade?: GradeParams): number {
  return displayError(forwardDisplay(target.map(srgbToLinear) as Vec3, exposure, grade), target);
}
