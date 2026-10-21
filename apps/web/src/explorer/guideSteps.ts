import type { Instruction, PolylinePoint } from "@gteki/navigation";
import { instructionPoints } from "@gteki/navigation";
import { cumulativeLengths } from "./walker.ts";

/** Previous restarts the current instruction when the guide is further into it than this (seconds of guide time) ... */
export const RESTART_AFTER_S = 2;
/** ... or than this (metres along the path); otherwise it goes to the previous instruction (the media-player convention). */
export const RESTART_AFTER_M = 3;

/**
 * Distance along the polyline (m, the same measure as the guide's `s`) at which each instruction starts, in
 * instruction order and never decreasing. Start is 0 and arrive is the route's end; a wait starts where
 * guideStops stops for it; any other instruction starts at the first point instructionPoints gives it.
 */
export function instructionStartsM(polyline: readonly PolylinePoint[], instructions: readonly Instruction[]): number[] {
  const cum = cumulativeLengths(polyline);
  const total = cum[cum.length - 1] ?? 0;
  let prev = 0;
  return instructions.map((ins) => {
    let s = prev;
    if (ins.kind === "start") s = 0;
    else if (ins.kind === "arrive") s = total;
    else {
      const first = instructionPoints(polyline, ins)[0];
      const k = first ? polyline.indexOf(first) : -1;
      if (k >= 0) s = cum[k]!;
    }
    prev = Math.max(prev, s);
    return prev;
  });
}

/** The instruction a guide at `s` is in: the last one that has started (ties go to the later one). */
export function instructionIndexAt(s: number, starts: readonly number[]): number {
  let at = 0;
  for (let i = 0; i < starts.length; i++) if (starts[i]! <= s + 1e-9) at = i;
  return at;
}

export interface GuideJump {
  /** The instruction the guide lands in. */
  index: number;
  /** The distance (m) it lands at: that instruction's start. */
  s: number;
}

/**
 * Where Previous (`dir` -1) or Next (+1) sends the guide. `active` is the instruction it is in (default: from
 * `currentM`) and `elapsedS` how long the guide has played in it; `first` is the guide's first instruction (the
 * "Start" line is skipped, so it is 1 then).
 *
 * - Next: the start of the next instruction; null on the last one (arrival), where the control is disabled.
 * - Previous: the start of the current instruction when the guide is more than RESTART_AFTER_S or RESTART_AFTER_M
 *   into it, else the previous instruction's start; on the first instruction it restarts it.
 */
export function jumpTarget(
  currentM: number,
  starts: readonly number[],
  dir: 1 | -1,
  elapsedS: number,
  active: number = instructionIndexAt(currentM, starts),
  first = 0,
): GuideJump | null {
  const last = starts.length - 1;
  if (last < 0) return null;
  const at = Math.min(Math.max(active, first), last);
  if (dir === 1) return at >= last ? null : { index: at + 1, s: starts[at + 1]! };
  const intoM = currentM - starts[at]!;
  const restart = elapsedS > RESTART_AFTER_S || intoM > RESTART_AFTER_M || at <= first;
  const index = restart ? at : at - 1;
  return { index, s: starts[index]! };
}

/**
 * Which of the guide's wait stops (numbered in instruction order, `waits[i]` = the wait instruction of stop i) still
 * lie ahead after landing in instruction `index`: stops of waits before it are consumed, the rest apply (again).
 * Returns the first stop number that applies; the guide keeps every stop with that number or higher.
 */
export function firstStopFor(waits: readonly number[], index: number): number {
  return waits.filter((w) => w < index).length;
}

/** What a key press does to the guide. */
export type GuideKeyAction = "prev" | "next";

export interface GuideKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}

/**
 * `[` / PageUp = previous, `]` / PageDown = next. Ignores key repeat (a held key must not skip a whole route),
 * modified chords (browser shortcuts) and IME composition. Callers handle "in a text field" and "guide mode".
 */
export function guideKeyAction(e: GuideKeyEvent): GuideKeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing) return null;
  if (e.key === "[" || e.key === "PageUp") return "prev";
  if (e.key === "]" || e.key === "PageDown") return "next";
  return null;
}
