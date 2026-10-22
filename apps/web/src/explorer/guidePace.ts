import type { Instruction, PolylinePoint, RouteStep } from "@gteki/navigation";
import type { EdgeMode } from "@gteki/schema";
import { instructionPoints } from "@gteki/navigation";

/** Guide speed tiers the HUD cycles through (m/s): walking pace, the avatar's run, and a fast-forward for long routes. */
export const GUIDE_TIERS = [
  { id: "walk", mps: 1.6 },
  { id: "run", mps: 3.4 },
  { id: "fast", mps: 6.8 },
] as const;

export type GuideTierId = (typeof GUIDE_TIERS)[number]["id"];

export const DEFAULT_GUIDE_TIER: GuideTierId = "run";

/** Every instruction but a wait stays on screen at least this long, so its text is readable at any tier. */
export const MIN_INSTRUCTION_S = 1.8;

/** The guide never crawls: a span's cap is floored here so a tiny instruction span cannot stall progress. */
export const MIN_GUIDE_MPS = 0.2;

/** On the fast tier connector speeds are time-lapsed by this factor (dwell caps are not). */
export const FAST_CONNECTOR_SCALE = 2;

/** Believable top speeds (m/s along the path) on connectors; other modes are uncapped. */
export const CONNECTOR_MPS: Partial<Record<EdgeMode, number>> = { stairs: 0.9, escalator: 0.75, elevator: 1.5, gate: 1.6 };

/** A stretch [fromS, toS) of the polyline where the guide may not go faster than `maxMps`; `scales` caps stretch on the fast tier. */
export interface PaceSpan {
  fromS: number;
  toS: number;
  maxMps: number;
  scales: boolean;
}

export function isGuideTier(value: unknown): value is GuideTierId {
  return GUIDE_TIERS.some((t) => t.id === value);
}

export function nextGuideTier(id: GuideTierId): GuideTierId {
  const i = GUIDE_TIERS.findIndex((t) => t.id === id);
  return GUIDE_TIERS[(i + 1) % GUIDE_TIERS.length]!.id;
}

export function guideTierSpeed(id: GuideTierId): number {
  return GUIDE_TIERS.find((t) => t.id === id)!.mps;
}

function cumulativeS(polyline: readonly PolylinePoint[]): number[] {
  const cum = [0];
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1]!;
    const b = polyline[i]!;
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  return cum;
}

/** Length (m) of the polyline: the distance the guide covers end to end. */
export function polylineLengthM(polyline: readonly PolylinePoint[]): number {
  return cumulativeS(polyline).at(-1) ?? 0;
}

/** Connector caps per polyline segment (by the step it belongs to) and a dwell cap per non-wait instruction. */
export function guidePaceSpans(polyline: readonly PolylinePoint[], steps: readonly Pick<RouteStep, "mode">[], instructions: readonly Instruction[]): PaceSpan[] {
  const cum = cumulativeS(polyline);
  const spans: PaceSpan[] = [];
  for (let i = 1; i < polyline.length; i++) {
    const cap = CONNECTOR_MPS[steps[polyline[i]!.stepIndex]?.mode as EdgeMode];
    if (cap !== undefined && cum[i]! > cum[i - 1]!) spans.push({ fromS: cum[i - 1]!, toS: cum[i]!, maxMps: cap, scales: true });
  }
  for (const ins of instructions) {
    if (ins.kind === "wait") continue;
    const pts = instructionPoints(polyline, ins);
    if (pts.length < 2) continue;
    const fromS = cum[polyline.indexOf(pts[0]!)]!;
    const toS = cum[polyline.indexOf(pts[pts.length - 1]!)]!;
    if (toS > fromS) spans.push({ fromS, toS, maxMps: (toS - fromS) / MIN_INSTRUCTION_S, scales: false });
  }
  return spans;
}

/** The guide's speed (m/s) at distance `s`: the tier's, capped by every span containing `s`, never below MIN_GUIDE_MPS. */
export function guideSpeedAt(s: number, tier: GuideTierId, spans: readonly PaceSpan[]): number {
  let mps = guideTierSpeed(tier);
  for (const sp of spans) {
    if (s < sp.fromS || s >= sp.toS) continue;
    mps = Math.min(mps, sp.scales && tier === "fast" ? sp.maxMps * FAST_CONNECTOR_SCALE : sp.maxMps);
  }
  return Math.max(MIN_GUIDE_MPS, mps);
}

/**
 * Distance (m) the guide covers in `dt` seconds from `s`, integrating the speed piecewise so a frame that crosses a
 * span edge uses each side's own speed (a short instruction's dwell cap is never skipped by a big step).
 */
export function pacedDistance(s: number, dt: number, tier: GuideTierId, spans: readonly PaceSpan[]): number {
  let at = s;
  let remaining = dt;
  for (let i = 0; i < 64 && remaining > 0; i++) {
    const v = guideSpeedAt(at, tier, spans);
    let edge = Infinity;
    for (const sp of spans) {
      if (sp.fromS > at && sp.fromS < edge) edge = sp.fromS;
      if (sp.toS > at && sp.toS < edge) edge = sp.toS;
    }
    if (v * remaining <= edge - at) return at + v * remaining - s;
    remaining -= (edge - at) / v;
    at = edge;
  }
  return at + guideSpeedAt(at, tier, spans) * Math.max(0, remaining) - s;
}

/**
 * Seconds the guide takes to cover `totalM` at `tier` (stops at waits excluded). Speed is constant between span edges,
 * so this sums each stretch at the speed pacedDistance would use there: the two agree exactly.
 */
export function pacedDuration(totalM: number, tier: GuideTierId, spans: readonly PaceSpan[]): number {
  const edges = new Set<number>([0, totalM]);
  for (const sp of spans) for (const e of [sp.fromS, sp.toS]) if (e > 0 && e < totalM) edges.add(e);
  const at = [...edges].sort((a, b) => a - b);
  let seconds = 0;
  for (let i = 1; i < at.length; i++) seconds += (at[i]! - at[i - 1]!) / guideSpeedAt(at[i - 1]!, tier, spans);
  return seconds;
}

/** The pace (m/s) the guide averages over the route at `tier`: length over paced duration; the tier's speed for an empty route. */
export function effectivePace(totalM: number, tier: GuideTierId, spans: readonly PaceSpan[]): number {
  return totalM > 0 ? totalM / pacedDuration(totalM, tier, spans) : guideTierSpeed(tier);
}

/** What the HUD shows for the tier: the route's effective pace and the tier's top speed, one decimal each; `approx` unless they round alike (open corridor). */
export function paceReadout(totalM: number, tier: GuideTierId, spans: readonly PaceSpan[]): { pace: string; top: string; approx: boolean } {
  const pace = effectivePace(totalM, tier, spans).toFixed(1);
  const top = guideTierSpeed(tier).toFixed(1);
  return { pace, top, approx: pace !== top };
}
