/**
 * POI label visibility, kept free of three.js so it can be unit-tested.
 *
 * A label is "shown", "faded" (occluded by scene geometry, or a selected label on another floor) or
 * "hidden" (an unselected label on another floor than the walker's). Occlusion is a raycast per label,
 * spread over frames by `OcclusionSweep` so phones pay only a few rays per frame, and none at rest.
 */

export type LabelState = "shown" | "faded" | "hidden";

/** A label whose floor is within this height (m) of the walker's feet is on the focus floor. */
export const FLOOR_BAND_M = 2.5;

/** `focusY` null (overview) puts every floor in focus. */
export function onFocusFloor(groundY: number, focusY: number | null): boolean {
  return focusY === null || Math.abs(groundY - focusY) <= FLOOR_BAND_M;
}

/**
 * Origin and destination labels stay findable like the x-ray route: occlusion never fades them, and on
 * another floor they fade instead of hiding.
 */
export function labelState(l: { occluded: boolean; onFocusFloor: boolean; selected: boolean }): LabelState {
  if (l.selected) return l.onFocusFloor ? "shown" : "faded";
  if (!l.onFocusFloor) return "hidden";
  return l.occluded ? "faded" : "shown";
}

/**
 * Round-robin occlusion checks: the caller takes labels one at a time within its per-frame budget, and
 * only until every label was checked once since the view last changed (`invalidate`).
 */
export class OcclusionSweep {
  private cursor = 0;
  private remaining = 0;

  invalidate(count: number): void {
    this.remaining = count;
  }

  get pending(): boolean {
    return this.remaining > 0;
  }

  /** Index of the next label to check, of `count` labels. Call only while `pending`. */
  take(count: number): number {
    const i = this.cursor % count;
    this.cursor = i + 1;
    this.remaining--;
    return i;
  }
}
