/**
 * POI label visibility, kept free of three.js so it can be unit-tested.
 *
 * A label is "shown", "faded" (occluded by nearby scene geometry, or a selected label on another floor) or
 * "hidden" (an unselected label on another floor than the walker's, behind a sign, or occluded and far).
 * Occlusion is a raycast per label,
 * spread over frames by `OcclusionSweep` so phones pay only a few rays per frame, and none at rest.
 */

export type LabelState = "shown" | "faded" | "hidden";

/** A label whose floor is within this height (m) of the walker's feet is on the focus floor. */
export const FLOOR_BAND_M = 2.5;

/** `focusY` null (overview) puts every floor in focus. */
export function onFocusFloor(groundY: number, focusY: number | null): boolean {
  return focusY === null || Math.abs(groundY - focusY) <= FLOOR_BAND_M;
}

/** What stands between the camera and a label: nothing, scene geometry (walls, floors) or a sign. */
export type LabelOcclusion = "none" | "geometry" | "sign";

/** An unselected label occluded and farther than this (m) from the camera hides rather than fades: far faded labels only add clutter. */
export const OCCLUDED_FADE_MAX_M = 40;

/**
 * Origin and destination labels stay findable like the x-ray route: occlusion never fades or hides them,
 * and on another floor they fade instead of hiding. Any other label behind a sign hides (the sign already
 * carries wayfinding text, so a faded label on its face is clutter); one behind geometry fades while within
 * OCCLUDED_FADE_MAX_M of the camera and hides beyond it.
 */
export function labelState(l: { occluded: LabelOcclusion; distance: number; onFocusFloor: boolean; selected: boolean }): LabelState {
  if (l.selected) return l.onFocusFloor ? "shown" : "faded";
  if (!l.onFocusFloor) return "hidden";
  if (l.occluded === "none") return "shown";
  return l.occluded === "sign" || l.distance > OCCLUDED_FADE_MAX_M ? "hidden" : "faded";
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
