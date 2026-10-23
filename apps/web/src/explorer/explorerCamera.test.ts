import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { Explorer } from "./explorer.ts";
import { FOLLOW, NO_SLOPE, followPose } from "./followCamera.ts";

/** Exercise the real camera wiring with CPU raycasts; no renderer or browser is constructed. */
function cameraStand() {
  const pos = new THREE.Vector3();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 2000);
  const pose = followPose(new THREE.Vector3(0, 1.62, 0), 0, -0.12);
  camera.position.copy(pose.pivot).addScaledVector(pose.back, FOLLOW.defaultDistance);
  return {
    pos, camera, slope: { ...NO_SLOPE }, slopeY: 0, firstPerson: false, mode: "walk",
    yaw: 0, pitch: -0.12, camDistance: FOLLOW.defaultDistance as number, boomRaise: 0,
    cameraTargets: [] as THREE.Object3D[], blockerTargets: new Set<THREE.Object3D>(),
    ray: new THREE.Raycaster(), reducedMotion: false, squeezed: false,
    setFov: vi.fn(), avatarRig: { root: new THREE.Group(), setFade: vi.fn() },
    composer: { setAvatarFade: vi.fn() },
  };
}

const place = (state: ReturnType<typeof cameraStand>, snap = false) => {
  (Explorer.prototype as unknown as { placeCamera(this: typeof state, dt: number, snap: boolean): void })
    .placeCamera.call(state, 1 / 60, snap);
};

const pocket = () => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.05, 32, 24), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.position.copy(followPose(new THREE.Vector3(0, 1.62, 0), 0, -0.12).pivot);
  mesh.updateMatrixWorld(true);
  return mesh;
};

describe("Explorer follow camera wiring", () => {
  it("ramps the rendered avatar fade after an occluder appears and remains on its near side", () => {
    const state = cameraStand();
    place(state, true);
    state.cameraTargets = [pocket()];
    const pivot = followPose(new THREE.Vector3(0, 1.62, 0), 0, -0.12).pivot;
    let distance = state.camera.position.distanceTo(pivot);
    let fade = 1;
    let rampFrames = 0;
    for (let i = 0; i < 60; i++) {
      place(state);
      const next = state.camera.position.distanceTo(pivot);
      const nextFade = state.avatarRig.setFade.mock.lastCall![0] as number;
      expect(next).toBeLessThanOrEqual(distance + 1e-9);
      expect(next).toBeLessThan(1.05 - state.camera.near);
      expect(nextFade).toBeLessThanOrEqual(fade + 1e-9);
      if (nextFade < fade - 1e-9) rampFrames++;
      expect(state.composer.setAvatarFade.mock.lastCall![1]).toBe(nextFade);
      distance = next;
      fade = nextFade;
    }
    expect(rampFrames).toBeGreaterThanOrEqual(3);
    expect(fade).toBeLessThan(1);
  });

  it.each(["placement", "reduced motion"])("snaps the boom for %s", (reason) => {
    const state = cameraStand();
    state.cameraTargets = [pocket()];
    state.reducedMotion = reason === "reduced motion";
    place(state, reason === "placement");
    const first = state.camera.position.clone();
    place(state);
    expect(state.camera.position.distanceTo(first)).toBeLessThan(1e-9);
  });
});
