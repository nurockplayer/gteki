import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { Explorer } from "./explorer.ts";
import { FOLLOW, NO_SLOPE, followPose, type CameraHold } from "./followCamera.ts";

/** Exercise the real camera wiring with CPU raycasts; no renderer or browser is constructed. */
function cameraStand() {
  const pos = new THREE.Vector3();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 2000);
  const pose = followPose(new THREE.Vector3(0, 1.62, 0), 0, -0.12);
  camera.position.copy(pose.pivot).addScaledVector(pose.back, FOLLOW.defaultDistance);
  const state = {
    pos, camera, slope: { ...NO_SLOPE }, slopeY: 0, firstPerson: false, mode: "walk",
    yaw: 0, pitch: -0.12, camDistance: FOLLOW.defaultDistance as number, boomRaise: 0,
    cameraTargets: [] as THREE.Object3D[], blockerTargets: new Set<THREE.Object3D>(),
    ray: new THREE.Raycaster(), reducedMotion: false, squeezed: false,
    setFov: vi.fn(), avatarRig: { root: new THREE.Group(), setFade: vi.fn() },
    composer: { setAvatarFade: vi.fn() },
    qaCamera: {} as CameraHold, qaCameraSnap: false, qaAvatarFade: null as number | null,
    boomActual: 0, cameraFade: 1,
  };
  return Object.assign(Object.create(Explorer.prototype) as typeof state, state);
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

const qa = (state: ReturnType<typeof cameraStand>) => state as unknown as Explorer;
const wall = (z: number, side: THREE.Side = THREE.DoubleSide) => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ side }));
  mesh.position.z = z;
  mesh.updateMatrixWorld(true);
  return mesh;
};

describe("Explorer wall fallback and QA controls", () => {
  it.each([THREE.FrontSide, THREE.BackSide, THREE.DoubleSide])("stays on the avatar side of a wall below the minimum, with material side %s", (side) => {
    const state = cameraStand();
    state.cameraTargets = [wall(0.2, side)];
    place(state, true);
    expect(state.camera.position.z).toBeLessThanOrEqual(0.2 - state.camera.near - FOLLOW.nearEpsilon);
    expect(state.boomActual).toBeLessThan(FOLLOW.minDistance);
    expect(state.cameraFade).toBe(FOLLOW.fadeMin);
    expect(state.camera.position.toArray().every(Number.isFinite)).toBe(true);
    expect((state.cameraTargets[0] as THREE.Mesh).material).toHaveProperty("side", side);
  });

  it("checks the interpolated camera direction when yaw sweeps across a wall", () => {
    const state = cameraStand();
    state.cameraTargets = [wall(0.8)];
    state.yaw = Math.PI / 2; // Solved boom is parallel to the wall; interpolated old position crosses it.
    place(state);
    expect(state.camera.position.z).toBeLessThan(0.8 - state.camera.near);
  });

  it("moves to the solved raise immediately while walking past a slab lip", () => {
    const state = cameraStand();
    const lip = new THREE.Mesh(new THREE.BoxGeometry(10, 1.97, 0.2), new THREE.MeshBasicMaterial());
    lip.position.set(0, 1.97 / 2, 0.6);
    lip.updateMatrixWorld(true);
    state.cameraTargets = [lip];
    place(state);
    expect(state.boomRaise).toBeGreaterThan(0);
    expect(state.camera.position.y).toBeGreaterThan(1.97);
    expect(state.boomActual).toBeGreaterThanOrEqual(FOLLOW.comfortDistance);
  });

  it("leaves ordinary controls alone until called, holds the requested pose, then releases it", () => {
    const state = cameraStand();
    state.yaw = 0.4;
    place(state, true);
    expect(state.yaw).toBe(0.4);
    qa(state).setCamera({ yaw: 1, pitch: -0.5, distance: 2 });
    place(state);
    const held = state.camera.position.clone();
    state.yaw = -1; // Guide steering or pointer input between frames.
    state.pitch = 0.2;
    state.camDistance = 5;
    place(state);
    expect(state.camera.position.distanceTo(held)).toBeLessThan(1e-9);
    expect(qa(state).cameraInfo()).toEqual({
      fov: 50, far: 2000, slopeOn: false, boomWanted: 2, boomActual: 2,
      raise: 0, pitch: -0.5, yaw: 1, avatarFade: 1, mode: "walk",
    });
    qa(state).setCamera(null);
    state.yaw = 0.6;
    place(state);
    expect(state.yaw).toBe(0.6);
  });

  it("holds the same fade in the body and postprocessing and releases immediately", () => {
    const state = cameraStand();
    place(state, true);
    qa(state).holdAvatarFade(0.5);
    place(state);
    expect(qa(state).cameraInfo().avatarFade).toBe(0.5);
    expect(state.avatarRig.setFade.mock.lastCall).toEqual([0.5]);
    expect(state.composer.setAvatarFade.mock.lastCall).toEqual([state.avatarRig.root, 0.5]);
    qa(state).holdAvatarFade(null);
    expect(qa(state).cameraInfo().avatarFade).toBe(1);
    expect(state.avatarRig.setFade.mock.lastCall).toEqual([1]);
  });
});

describe("Explorer placement snapping", () => {
  it("marks guide starts, seeks and restarts for the same solved camera snap", () => {
    const state = Object.assign(cameraStand(), { mode: "guide", lastAvatarPos: new THREE.Vector3(), teleported: false, bodyYaw: 0 });
    const route = [0, 2].map((x, i) => ({ x, y: 0, z: 0, zKnown: true, stepIndex: i, floorId: "b1" }));
    qa(state).startGuide(route);
    expect(state.teleported).toBe(true);
    state.teleported = false;
    qa(state).seekGuide(1);
    expect(state.teleported).toBe(true);
    expect(state.pos.x).toBe(1);
    state.camera.position.set(50, 50, 50);
    place(state, state.teleported);
    expect(state.boomActual).toBeCloseTo(FOLLOW.defaultDistance);
    state.teleported = false;
    qa(state).startGuide(route);
    expect(state.teleported).toBe(true);
    expect(state.pos.x).toBe(0);
    place(state, state.teleported);
    expect(state.boomActual).toBeCloseTo(FOLLOW.defaultDistance);
  });
});
