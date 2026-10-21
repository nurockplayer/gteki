import { describe, expect, it } from "vitest";
import { avatarMotion } from "./avatarMotion.ts";

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
});
