import { describe, expect, it } from "vitest";
import { avatarMotion, CAT_BODY_PITCH, CAT_TURN_RATE, stepCatBodyPitch } from "./avatarMotion.ts";

describe("avatar motion", () => {
  it("turns toward the direction of travel and reports ground speed", () => {
    // Moving +X: heading atan2(-1, 0) = -π/2.
    let yaw = 0;
    for (let i = 0; i < 60; i++) yaw = avatarMotion({ x: 0, z: 0 }, { x: 0.025, z: 0 }, 1 / 60, yaw, 0).yaw;
    expect(yaw).toBeCloseTo(-Math.PI / 2, 2);
    expect(avatarMotion({ x: 0, z: 0 }, { x: 0.025, z: 0 }, 1 / 60, 0, 0).speed).toBeCloseTo(1.5, 5);
  });

  it("keeps its heading when standing still", () => {
    expect(avatarMotion({ x: 1, z: 1 }, { x: 1, z: 1 }, 1 / 60, 0.7, 2)).toEqual({ yaw: 0.7, speed: 0 });
  });

  it("treats a long jump as a teleport: no speed, faces the camera", () => {
    expect(avatarMotion({ x: 0, z: 0 }, { x: 50, z: 0 }, 1 / 60, 0.3, 1.2)).toEqual({ yaw: 1.2, speed: 0 });
  });

  it("keeps the human's rate by default and turns the cat slower", () => {
    const prev = { x: 0, z: 0 }, cur = { x: 0.025, z: 0 };
    const once = (rate?: number) => avatarMotion(prev, cur, 1 / 60, 0, 0, rate).yaw;
    expect(once(10)).toBe(once());
    expect(Math.abs(once(CAT_TURN_RATE))).toBeLessThan(Math.abs(once()));
  });
});


describe("cat body pitch", () => {
  const run = (prev: number, vertical: number, horizontal: number) => {
    for (let i = 0; i < 600; i++) prev = stepCatBodyPitch(prev, vertical, horizontal, 1 / 60);
    return prev;
  };

  it("stays level on level ground", () => {
    expect(run(0, 0, 1)).toBe(0);
  });

  it("converges to the slope on climbs and descents", () => {
    expect(run(0, 0.5, 1)).toBeCloseTo(Math.atan2(0.5, 1));
    expect(run(0, -0.5, 1)).toBeCloseTo(-Math.atan2(0.5, 1));
  });

  it("clamps steep slopes", () => {
    expect(run(0, 10, 1)).toBeCloseTo(CAT_BODY_PITCH.max);
    expect(run(0, -10, 1)).toBeCloseTo(-CAT_BODY_PITCH.max);
  });

  it("eases back to level below minimum speed", () => {
    const next = stepCatBodyPitch(0.4, 1, CAT_BODY_PITCH.minSpeed / 2, 1 / 60);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(0.4);
    expect(run(0.4, 1, CAT_BODY_PITCH.minSpeed / 2)).toBeCloseTo(0);
  });

  it.each([0, -1])("holds the previous pitch when dt is %s", (dt) => {
    expect(stepCatBodyPitch(0.3, 1, 1, dt)).toBe(0.3);
  });
});
