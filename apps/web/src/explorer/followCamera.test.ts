import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FOLLOW, clampDistance, followPose, viewDirection } from "./followCamera.ts";

describe("follow camera", () => {
  it("stays under a 2.6 m ceiling at the default pitch and distance", () => {
    const head = new THREE.Vector3(0, 1.62, 0);
    const { pivot, back } = followPose(head, 0, -0.12);
    const cam = pivot.clone().addScaledVector(back, FOLLOW.defaultDistance);
    expect(cam.y).toBeLessThan(2.5);
    expect(cam.z).toBeGreaterThan(2.5); // behind a walker facing -Z
  });

  it("puts the pivot over the right shoulder for any yaw", () => {
    for (const yaw of [0, 1, -2.4]) {
      const head = new THREE.Vector3(3, 1.62, -4);
      const { pivot } = followPose(head, yaw, 0);
      const d = viewDirection(yaw, 0);
      // right = forward × up
      const right = d.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
      expect(pivot.clone().sub(head).dot(right)).toBeCloseTo(FOLLOW.shoulder, 5);
    }
  });

  it("keeps clearance before an obstruction but never collapses below the minimum", () => {
    expect(clampDistance(3, null)).toBe(3);
    expect(clampDistance(3, 2)).toBeCloseTo(2 - FOLLOW.clearance);
    expect(clampDistance(3, 0.1)).toBe(FOLLOW.minDistance);
  });
});
