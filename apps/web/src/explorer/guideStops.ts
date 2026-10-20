import type { Instruction, PolylinePoint } from "@gteki/navigation";
import { instructionPoints } from "@gteki/navigation";

/** Where the guide must stop for each wait instruction: its index and the polyline point it happens at. */
export function guideStops(polyline: readonly PolylinePoint[], instructions: readonly Instruction[]): { instruction: number; point: number }[] {
  return instructions.flatMap((ins, instruction) => {
    const point = ins.kind === "wait" ? polyline.indexOf(instructionPoints(polyline, ins)[0]!) : -1;
    return point >= 0 ? [{ instruction, point }] : [];
  });
}

/**
 * Move the guide `distance` along a path of length `total`, but never past the next stop (sorted by `s`):
 * reaching one consumes it and returns its index, so stops at one spot are each reached in turn.
 */
export function advanceGuide(g: { s: number; stops: { s: number; index: number }[] }, distance: number, total: number): number | null {
  const next = Math.min(total, g.s + distance);
  const stop = g.stops[0];
  if (stop && stop.s <= next) {
    g.stops.shift();
    g.s = stop.s;
    return stop.index;
  }
  g.s = next;
  return null;
}
