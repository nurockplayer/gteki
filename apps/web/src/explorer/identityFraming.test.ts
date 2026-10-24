import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FOLLOW, followPose } from "./followCamera.ts";
import { identityFraming, LOOK_PITCH, MAX_NAME_HEIGHT_NDC, type FramingBoard } from "./identityFraming.ts";

const head = new THREE.Vector3(0, 1.62, 0);
const board = (x: number, y: number, z: number): FramingBoard => {
  const centre = new THREE.Vector3(x, y, z);
  return { centre, front: head.clone().sub(centre).normalize(), blocked: false, nameCorners: [centre.clone().add(new THREE.Vector3(-2, -0.5, 0)), centre.clone().add(new THREE.Vector3(2, 0.5, 0))] };
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
        for (const corner of b.nameCorners) {
          const projected = corner.clone().project(camera);
          expect(projected.x).toBeGreaterThanOrEqual(-1);
          expect(projected.x).toBeLessThanOrEqual(1);
          expect(projected.y).toBeGreaterThanOrEqual(-1);
          expect(projected.y).toBeLessThanOrEqual(1);
        }
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

function cameraAt(look: { yaw: number; pitch: number }, aspect: number) {
  const camera = new THREE.PerspectiveCamera(50, aspect, 0.05, 100);
  const pose = followPose(head, look.yaw, look.pitch);
  camera.position.copy(pose.pivot).addScaledVector(pose.back, FOLLOW.defaultDistance);
  camera.lookAt(pose.target); camera.updateMatrixWorld(true);
  return camera;
}

describe("identity framing safeguards", () => {
  it.each([
    { x0: -1, y0: -1, x1: 1, y1: 1 },
    { x0: -2, y0: -2, x1: 2, y1: 2 },
  ])("skips a horizontally oversized name on a portrait phone with free area %j", (free) => {
    const aspect = 9 / 19.5;
    const wide = board(0, 3, -10), far = board(0, 3, -18);
    const look = identityFraming(head, 0, 0, [wide], aspect, 50, undefined, free)!;
    expect(look).not.toBeNull();
    wide.nameCorners = [-4, 4].flatMap((x) => [-0.2, 0.2].map((y) => wide.centre.clone().add(new THREE.Vector3(x, y, 0))));
    const camera = cameraAt(look, aspect);
    const xs = wide.nameCorners.map((p) => p.clone().project(camera).x);
    expect(Math.min(...xs)).toBeLessThan(-1);
    expect(Math.max(...xs)).toBeGreaterThan(1);
    expect(identityFraming(head, 0, 0, [wide], aspect, 50, undefined, free)).toBeNull();
    const fallback = identityFraming(head, 0, 0, [far], aspect, 50, undefined, free);
    expect(fallback).not.toBeNull();
    expect(identityFraming(head, 0, 0, [wide, far], aspect, 50, undefined, free)).toEqual(fallback);
  });

  it("rejects a name crossing the top UI even when its centre and height qualify", () => {
    const b = board(0, 3, -10);
    const free = { x0: -1, y0: -1, x1: 1, y1: 0.3 };
    const look = identityFraming(head, 0, 0, [b], 16 / 9, 50, undefined, free)!;
    expect(look).not.toBeNull();
    b.nameCorners = [-1, 1].flatMap((x) => [-2, 2].map((y) => b.centre.clone().add(new THREE.Vector3(x, y, 0))));
    const camera = cameraAt(look, 16 / 9);
    const centre = b.centre.clone().project(camera);
    const ys = b.nameCorners.map((p) => p.clone().project(camera).y);
    expect(centre.y).toBeGreaterThanOrEqual(-0.4);
    expect(centre.y).toBeLessThan(free.y1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(MAX_NAME_HEIGHT_NDC);
    expect(Math.max(...ys)).toBeGreaterThan(free.y1);
    expect(identityFraming(head, 0, 0, [b], 16 / 9, 50, undefined, free)).toBeNull();
  });

  it("skips an oversized close name and chooses the next farther board", () => {
    const near = board(0, 3, -1), far = board(0, 3, -12);
    const smallLook = identityFraming(head, 0, 0, [near], 16 / 9, 50)!;
    expect(smallLook).not.toBeNull();
    for (const b of [near, far]) b.nameCorners = [b.centre.clone().add(new THREE.Vector3(-2, -2, 0)), b.centre.clone().add(new THREE.Vector3(2, 2, 0))];
    const camera = cameraAt(smallLook, 16 / 9);
    const ys = near.nameCorners.map((p) => p.clone().project(camera).y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(MAX_NAME_HEIGHT_NDC);
    expect(identityFraming(head, 0, 0, [near], 16 / 9, 50)).toBeNull();
    expect(identityFraming(head, 0, 0, [near, far], 16 / 9, 50)).toEqual(identityFraming(head, 0, 0, [far], 16 / 9, 50));
    expect(identityFraming(head, 0, 0, [far], 16 / 9, 50)).not.toBeNull();
  });

  it("tests sight from the modelled camera and skips a blocked candidate", () => {
    const near = board(-2, 3, -8), far = board(4, 3, -12);
    const nearLook = identityFraming(head, 0, 0, [near], 16 / 9, 50)!;
    let checked = false;
    near.visible = (from, centre) => {
      checked = true;
      expect(from.distanceTo(cameraAt(nearLook, 16 / 9).position)).toBeLessThan(1e-8);
      expect(from.distanceTo(head)).toBeGreaterThan(3);
      expect(centre).toEqual(near.centre);
      return false;
    };
    const result = identityFraming(head, 0, 0, [near, far], 16 / 9, 50);
    expect(checked).toBe(true);
    expect(result).toEqual(identityFraming(head, 0, 0, [far], 16 / 9, 50));
    expect(result).not.toBeNull();
  });

  it.each([16 / 9, 9 / 19.5])("frames inside the central 60 percent of a free area at aspect %s", (aspect) => {
    const b = board(-3, 3, -10);
    // A compact name fits wholly below the top strip at both aspect ratios.
    b.nameCorners = b.nameCorners.map((p) => b.centre.clone().lerp(p, 0.5));
    // Exclude the left third and a top strip, as with desktop search and phone HUD.
    const free = { x0: -1 / 3, x1: 1, y0: -0.9, y1: 0.1 };
    const look = identityFraming(head, 0, 0, [b], aspect, 50, undefined, free);
    expect(look).not.toBeNull();
    const p = b.centre.clone().project(cameraAt(look!, aspect));
    expect(p.x).toBeGreaterThanOrEqual(free.x0 + (free.x1 - free.x0) * 0.2);
    expect(p.x).toBeLessThanOrEqual(free.x1 - (free.x1 - free.x0) * 0.2);
    expect(p.y).toBeGreaterThanOrEqual(-0.4);
    expect(p.y).toBeLessThanOrEqual(free.y1);
    for (const corner of b.nameCorners) {
      const projected = corner.clone().project(cameraAt(look!, aspect));
      expect(projected.x).toBeGreaterThanOrEqual(free.x0);
      expect(projected.x).toBeLessThanOrEqual(free.x1);
      expect(projected.y).toBeGreaterThanOrEqual(free.y0);
      expect(projected.y).toBeLessThanOrEqual(free.y1);
    }
  });

  it("returns null when the free area misses the vertical band", () => {
    expect(identityFraming(head, 0, 0, [board(0, 3, -10)], 1, 50, undefined, { x0: -1, x1: 1, y0: 0.8, y1: 1 })).toBeNull();
  });
});
