import { takesWalkKey, type ClosestLike } from "../explorer/inputGuard.ts";
import type { GuideKeyAction } from "../explorer/guideSteps.ts";

/** The slice of a KeyboardEvent this guard needs (fakes are fine in tests). */
export interface WalkKeyEventLike {
  readonly code: string;
  readonly target: unknown;
  stopImmediatePropagation(): void;
  stopPropagation(): void;
}

/** Whether a guide shortcut can run without typing into a field or crossing an open dialog. */
export function shouldHandleGuideKey(
  action: GuideKeyAction | null,
  target: ClosestLike | null,
  coverageDialogOpen: boolean,
  rideDialogOpen: boolean,
): boolean {
  return Boolean(action) && !coverageDialogOpen && !rideDialogOpen &&
    !target?.closest?.("input, textarea, select, [contenteditable]");
}

/**
 * While the ride modal is open the app behind it is `inert`, but the explorer's walk input
 * listens on `window` (explorer/input.ts), and `inert` does not stop window listeners. The modal
 * listens in the capture phase, so swallowing here keeps WASD/arrows (and Escape, which is always
 * a walk key) from walking the avatar under the dialog. The predicate is the explorer's own, so
 * keys a focused control owns are left alone.
 */
export function swallowBackgroundWalkKey(e: WalkKeyEventLike): boolean {
  if (!takesWalkKey(e.target as ClosestLike | null, e.code)) return false;
  e.stopImmediatePropagation();
  e.stopPropagation();
  return true;
}
