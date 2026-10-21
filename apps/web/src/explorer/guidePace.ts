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

/** Connector caps per polyline segment (by the step it belongs to) and a dwell cap per non-wait instruction. */
export function guidePaceSpans(polyline: readonly PolylinePoint[], steps: readonly Pick<RouteStep, "mode">[], instructions: readonly Instruction[]): PaceSpan[] {
  const cum = [0];
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1]!;
    const b = polyline[i]!;
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
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
