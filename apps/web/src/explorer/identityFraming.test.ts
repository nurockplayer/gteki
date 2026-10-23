import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FOLLOW, followPose } from "./followCamera.ts";
import { identityFraming, LOOK_PITCH, type FramingBoard } from "./identityFraming.ts";

const head = new THREE.Vector3(0, 1.62, 0);
const board = (x: number, y: number, z: number): FramingBoard => {
  const centre = new THREE.Vector3(x, y, z);
  return { centre, front: head.clone().sub(centre).normalize(), blocked: false };
};

describe("identityFraming", () => {
  it.each([board(0, 3, -9), board(-7, 4, -8), board(0, 8, -8), board(2, 3, 9), board(0, 7, -10)])("frames a front-readable board at $centre for both aspect ratios", (b) => {
    for (const aspect of [16 / 9, 9 / 19.5]) {
      const before = b.centre.clone();
      const look = identityFraming(head, 0, -0.12, [b], aspect, 50);
      expect(look).not.toBeNull();
      expect(look!.pitch).toBeGreaterThanOrEqual(LOOK_PITCH.min);
      expect(look!.pitch).toBeLessThanOrEqual(LOOK_PITCH.max);
      // The same placement meets both viewports, including the actual shoulder/boom/target drop.
      for (const viewAspect of [16 / 9, 9 / 19.5]) {
        const camera = new THREE.PerspectiveCamera(50, viewAspect, 0.05, 100);
        const pose = followPose(head, look!.yaw, look!.pitch);
        camera.position.copy(pose.pivot).addScaledVector(pose.back, FOLLOW.defaultDistance);
        camera.lookAt(pose.target);
        camera.updateMatrixWorld(true);
        const p = b.centre.clone().project(camera);
        expect((p.x + 1) / 2).toBeGreaterThanOrEqual(0.2);
        expect((p.x + 1) / 2).toBeLessThanOrEqual(0.8);
        expect((1 - p.y) / 2).toBeGreaterThanOrEqual(0.15);
        expect((1 - p.y) / 2).toBeLessThanOrEqual(0.7);
      }
      expect(b.centre).toEqual(before);
    }
  });

  it.each(["back", "edge", "range", "blocked"])("rejects %s boards", (kind) => {
    const b = board(0, 3, -9);
    if (kind === "back") b.front.negate();
    if (kind === "edge") b.front.set(1, 0, 0);
    if (kind === "range") b.centre.z = -31;
    if (kind === "blocked") b.blocked = true;
    expect(identityFraming(head, 0, 0, [b], 16 / 9, 50)).toBeNull();
  });

  it("skips a board behind a guide's route and chooses an eligible board ahead", () => {
    const behind = board(0, 3, 8), ahead = board(-4, 3, -12);
    expect(identityFraming(head, 0, 0, [behind], 1, 50, 0)).toBeNull();
    const result = identityFraming(head, 0, 0, [behind, ahead], 1, 50, 0);
    expect(result).not.toBeNull();
    expect(Math.abs(result!.yaw)).toBeLessThan(Math.PI / 2);
  });

  it("returns null without boards or when pitch limits cannot frame a name", () => {
    expect(identityFraming(head, 0, 0, [], 1, 50)).toBeNull();
    expect(identityFraming(head, 0, 0, [board(0, 29, -0.1)], 1, 50)).toBeNull();
  });
});
