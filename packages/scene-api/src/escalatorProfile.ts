// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors

/** Two 0.40 m step depths at each comb, followed by the kit's 0.80 m eased transition. */
export const ESCALATOR_FLAT_M = 0.8;
const TRANSITION_M = 0.8;

/** Height above the lower landing at horizontal distance `along` from its comb. */
export function escalatorHeight(along: number, length: number, rise: number): number {
  const run = length - 2 * ESCALATOR_FLAT_M;
  const transition = Math.min(TRANSITION_M, run / 2);
  const x = Math.max(0, Math.min(run, along - ESCALATOR_FLAT_M));
  const slope = rise / (run - transition);
  if (x < transition) return slope * x * x / (2 * transition);
  if (x > run - transition) return rise - slope * (run - x) ** 2 / (2 * transition);
  return slope * (x - transition / 2);
}

/** The kit samples each eased transition in eight pieces; procedural finishes use the same breaks. */
export function escalatorBreaks(length: number): number[] {
  const transition = Math.min(TRANSITION_M, (length - 2 * ESCALATOR_FLAT_M) / 2);
  return [0, ...Array.from({ length: 9 }, (_, i) => ESCALATOR_FLAT_M + transition * i / 8),
    ...Array.from({ length: 9 }, (_, i) => length - ESCALATOR_FLAT_M - transition + transition * i / 8), length];
}
