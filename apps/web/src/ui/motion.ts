/** The subset of MediaQueryList that watching needs. */
export interface MotionQuery {
  matches: boolean;
  addEventListener(type: "change", cb: (e: { matches: boolean }) => void): void;
  removeEventListener(type: "change", cb: (e: { matches: boolean }) => void): void;
}

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Call `onChange` now and whenever the user's reduced-motion preference changes; returns the unsubscribe. */
export function watchReducedMotion(
  onChange: (reduce: boolean) => void,
  mq: MotionQuery | null = typeof matchMedia === "function" ? matchMedia(REDUCED_MOTION_QUERY) : null,
): () => void {
  if (!mq) return () => {};
  const cb = (e: { matches: boolean }): void => onChange(e.matches);
  onChange(mq.matches);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
