/**
 * #854: the cat's non-verbal meow. The timing curves are pure so the rig only has to apply them
 * over its clips; the sound itself belongs to the station audio work (see Explorer.setCatMeowSound).
 */
export const MEOW_SECONDS = 1.1;

export interface MeowPose {
  /** Head lift, radians; positive lifts the nose. */
  head: number;
  /** Ear rotation, radians; positive tips them backward. */
  ears: number;
  /** Tail lift, 0..1 weight. */
  tailLift: number;
  /** Tail sway, radians about the rig's up axis, weighted by the lift. */
  tailSway: number;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Smooth 0..1 ramp between two times; reversed edges ramp down. */
function ramp(t: number, from: number, to: number): number {
  const x = clamp01((t - from) / (to - from));
  return x * x * (3 - 2 * x);
}

/** The overlay at `t` seconds after the meow starts: zero before and after, smooth in between. */
export function meowPose(t: number): MeowPose {
  if (!(t > 0) || t >= MEOW_SECONDS) return { head: 0, ears: 0, tailLift: 0, tailSway: 0 };
  const tailLift = Math.min(ramp(t, 0, 0.2), 1 - ramp(t, 0.2, MEOW_SECONDS));
  return {
    head: 0.22 * Math.min(ramp(t, 0, 0.25), 1 - ramp(t, 0.7, MEOW_SECONDS)),
    ears: 0.45 * Math.min(ramp(t, 0, 0.15), 1 - ramp(t, 0.15, 0.5)),
    tailLift,
    tailSway: 0.18 * Math.sin((2 * Math.PI * t) / 0.55) * tailLift,
  };
}

/** Whether a tap in CSS pixels lands on the cat's projected centre (never when it is behind the camera). */
export function catTapHit(tap: { x: number; y: number }, cat: { x: number; y: number; behind: boolean }, radiusPx = 72): boolean {
  if (cat.behind) return false;
  const dx = tap.x - cat.x;
  const dy = tap.y - cat.y;
  return dx * dx + dy * dy <= radiusPx * radiusPx;
}
