import { describe, expect, it } from "vitest";
import { catTapHit, MEOW_SECONDS, meowPose } from "./catMeow.ts";

const ZERO = { head: 0, ears: 0, tailLift: 0, tailSway: 0 };

describe("meowPose", () => {
  it("is zero at both ends", () => {
    expect(meowPose(-0.5)).toEqual(ZERO);
    expect(meowPose(0)).toEqual(ZERO);
    expect(meowPose(MEOW_SECONDS)).toEqual(ZERO);
    expect(meowPose(MEOW_SECONDS + 1)).toEqual(ZERO);
  });

  it("reaches the head, ear and tail-lift peaks", () => {
    expect(meowPose(0.25).head).toBeCloseTo(0.22);
    expect(meowPose(0.5).head).toBeCloseTo(0.22);
    expect(meowPose(0.15).ears).toBeCloseTo(0.45);
    expect(meowPose(0.2).tailLift).toBeCloseTo(1);
    expect(meowPose(0.6).tailLift).toBeGreaterThan(0);
    expect(meowPose(0.6).tailLift).toBeLessThan(1);
  });

  it("sways the tail within the lift weight", () => {
    for (const t of [0.05, 0.3, 0.75, 1.05]) {
      const pose = meowPose(t);
      expect(pose.tailSway).toBeCloseTo(0.18 * Math.sin((2 * Math.PI * t) / 0.55) * pose.tailLift);
    }
  });
});

describe("catTapHit", () => {
  it("hits inside the radius and misses outside", () => {
    expect(catTapHit({ x: 10, y: 10 }, { x: 40, y: 40, behind: false })).toBe(true);
    expect(catTapHit({ x: 0, y: 0 }, { x: 72, y: 0, behind: false })).toBe(true);
    expect(catTapHit({ x: 0, y: 0 }, { x: 73, y: 0, behind: false })).toBe(false);
    expect(catTapHit({ x: 0, y: 0 }, { x: 100, y: 0, behind: false })).toBe(false);
  });

  it("never hits when the cat is behind the camera", () => {
    expect(catTapHit({ x: 0, y: 0 }, { x: 0, y: 0, behind: true })).toBe(false);
  });
});
