import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { WALKER_BODY, WALKER_SPEED } from "@gteki/scene-api";
import { Explorer } from "./explorer.ts";
import { FOLLOW, NO_SLOPE, SLOPE, descentAimDrop, followPose, type CameraHold } from "./followCamera.ts";
import { guidePaceSpans, type PaceSpan } from "./guidePace.ts";

/** Exercise the real camera wiring with CPU raycasts; no renderer or browser is constructed. */
function cameraStand() {
  const pos = new THREE.Vector3();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 2000);
  const pose = followPose(new THREE.Vector3(0, 1.62, 0), 0, -0.12);
  camera.position.copy(pose.pivot).addScaledVector(pose.back, FOLLOW.defaultDistance);
  const state = {
    pos, camera, slope: { ...NO_SLOPE }, slopeY: 0, firstPerson: false, mode: "walk",
    yaw: 0, pitch: -0.12, camDistance: FOLLOW.defaultDistance as number, boomRaise: 0,
    cameraTargets: [] as THREE.Object3D[], cameraSides: new Set<THREE.Object3D>(), blockerTargets: new Set<THREE.Object3D>(),
    ray: new THREE.Raycaster(), reducedMotion: false, squeezed: false,
    setFov: vi.fn(), avatarRig: { root: new THREE.Group(), setFade: vi.fn() },
    composer: { settings: { reflections: true }, setAvatarFade: vi.fn() },
    qaCamera: {} as CameraHold, qaCameraSnap: false, qaAvatarFade: null as number | null,
    boomActual: 0, cameraFade: 1, descentDrop: 0, fadeStale: false,
    guide: null as { s: number; spans: readonly PaceSpan[] } | null,
  };
  return Object.assign(Object.create(Explorer.prototype) as typeof state, state);
}

const place = (state: ReturnType<typeof cameraStand>, snap = false) => {
  (Explorer.prototype as unknown as { placeCamera(this: typeof state, dt: number, snap: boolean): void })
    .placeCamera.call(state, 1 / 60, snap);
};

const setTargets = (state: ReturnType<typeof cameraStand>, targets: THREE.Object3D[]) => {
  state.cameraTargets = targets;
  state.cameraSides = new Set(targets);
};

const pocket = () => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.05, 32, 24), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.position.copy(followPose(new THREE.Vector3(0, 1.62, 0), 0, -0.12).pivot);
  mesh.updateMatrixWorld(true);
  return mesh;
};

describe("Explorer follow camera wiring", () => {
  it.each([false, true].flatMap((floor) => [
    { motion: "walk", speed: 1.4, turn: 0, floor },
    { motion: "run", speed: WALKER_SPEED.runMps, turn: 0, floor },
    { motion: "walk with steady yaw", speed: 1.4, turn: 0.3, floor },
  ]))("keeps the boom steady for 10 seconds of $motion with floor=$floor", ({ speed, turn, floor, motion }) => {
    const state = cameraStand();
    if (floor) {
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
      ground.position.y = -0.01;
      ground.updateMatrixWorld(true);
      setTargets(state, [ground]);
    }
    place(state, true);
    const steady: number[] = [];
    for (let frame = 1; frame <= 600; frame++) {
      state.yaw += turn / 60;
      state.pos.x -= Math.sin(state.yaw) * speed / 60;
      state.pos.z -= Math.cos(state.yaw) * speed / 60;
      place(state);
      // Check every frame, including startup: locomotion must never accumulate boom length.
      expect(state.boomActual).toBeLessThanOrEqual(FOLLOW.defaultDistance + 1e-9);
      expect(Math.abs(state.boomActual - FOLLOW.defaultDistance)).toBeLessThan(0.05);
      if (frame >= 120) steady.push(state.boomActual);
    }
    expect(Math.max(...steady) - Math.min(...steady)).toBeLessThan(0.001);
    console.info(`${motion}, floor=${floor}: steady boom ${Math.min(...steady).toFixed(6)}..${Math.max(...steady).toFixed(6)} m; at 10 s ${state.boomActual.toFixed(6)} m`);
  });

  it("ramps the rendered avatar fade after an occluder appears and remains on its near side", () => {
    const state = cameraStand();
    place(state, true);
    setTargets(state, [pocket()]);
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
    expect(distance).toBeLessThanOrEqual(1.05 - FOLLOW.clearance + 1e-9);
  });

  it.each(["placement", "reduced motion"])("snaps the boom for %s", (reason) => {
    const state = cameraStand();
    setTargets(state, [pocket()]);
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
    setTargets(state, [wall(0.2, side)]);
    place(state, true);
    expect(state.camera.position.z).toBeLessThanOrEqual(0.2 - state.camera.near - FOLLOW.nearEpsilon);
    expect(state.boomActual).toBeLessThan(FOLLOW.minDistance);
    expect(state.cameraFade).toBe(FOLLOW.fadeMin);
    expect(state.camera.position.toArray().every(Number.isFinite)).toBe(true);
    expect((state.cameraTargets[0] as THREE.Mesh).material).toHaveProperty("side", side);
  });

  it("checks the interpolated camera direction when yaw sweeps across a wall", () => {
    const state = cameraStand();
    setTargets(state, [wall(0.8)]);
    state.yaw = Math.PI / 2; // Solved boom is parallel to the wall; interpolated old position crosses it.
    place(state);
    expect(state.camera.position.z).toBeLessThan(0.8 - state.camera.near);
  });

  it("moves to the solved raise immediately while walking past a slab lip", () => {
    const state = cameraStand();
    const lip = new THREE.Mesh(new THREE.BoxGeometry(10, 1.97, 0.2), new THREE.MeshBasicMaterial());
    lip.position.set(0, 1.97 / 2, 0.6);
    lip.updateMatrixWorld(true);
    setTargets(state, [lip]);
    place(state);
    expect(state.boomRaise).toBeGreaterThan(0);
    expect(state.camera.position.y).toBeGreaterThan(1.97);
    expect(state.boomActual).toBeGreaterThanOrEqual(FOLLOW.comfortDistance);
  });

  it("limits fade recovery when a raised boom clears a squeeze in one frame", () => {
    const state = cameraStand();
    setTargets(state, [pocket()]);
    place(state, true);
    const fade = state.cameraFade;
    expect(fade).toBeLessThan(1);
    expect(state.boomActual).toBeLessThan(FOLLOW.fadeStart);

    const lip = new THREE.Mesh(new THREE.BoxGeometry(10, 1.97, 0.2), new THREE.MeshBasicMaterial());
    lip.position.set(0, 1.97 / 2, 0.6);
    lip.updateMatrixWorld(true);
    setTargets(state, [lip]);
    place(state);
    expect(state.boomRaise).toBeGreaterThan(0);
    expect(state.boomActual).toBeGreaterThanOrEqual(FOLLOW.comfortDistance);
    expect(state.cameraFade).toBeGreaterThan(fade);
    expect(state.cameraFade - fade).toBeLessThanOrEqual(FOLLOW.fadeRecoverPerS / 60 + 1e-12);
    expect(state.avatarRig.setFade.mock.lastCall).toEqual([state.cameraFade]);
    expect(state.composer.setAvatarFade.mock.lastCall).toEqual([state.avatarRig.root, state.cameraFade]);
  });

  it.each(["placement", "reduced motion", "QA camera cut", "resuming after the overview"])("snaps fade recovery for %s", (reason) => {
    const state = cameraStand();
    setTargets(state, [pocket()]);
    place(state, true);
    expect(state.cameraFade).toBeLessThan(1);
    setTargets(state, []);
    state.reducedMotion = reason === "reduced motion";
    if (reason === "QA camera cut") qa(state).setCamera({ distance: FOLLOW.defaultDistance });
    state.fadeStale = reason === "resuming after the overview";
    place(state, reason === "placement");
    expect(state.cameraFade).toBe(1);
    expect(state.avatarRig.setFade.mock.lastCall).toEqual([1]);
    expect(state.composer.setAvatarFade.mock.lastCall).toEqual([state.avatarRig.root, 1]);
    expect(state.fadeStale).toBe(false);
  });

  it("fades immediately on entry to first person", () => {
    const state = cameraStand();
    place(state, true);
    state.firstPerson = true;
    place(state);
    expect(state.cameraFade).toBe(FOLLOW.fadeMin);
    expect(state.avatarRig.setFade.mock.lastCall).toEqual([FOLLOW.fadeMin]);
    expect(state.composer.setAvatarFade.mock.lastCall).toEqual([state.avatarRig.root, FOLLOW.fadeMin]);
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
      raise: 0, pitch: -0.5, yaw: 1, avatarFade: 1, reflections: true, mode: "walk",
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

  it("reports reflections only when the postprocessing pass is active", () => {
    const state = cameraStand();
    expect(qa(state).cameraInfo().reflections).toBe(true);
    state.composer.settings.reflections = false;
    expect(qa(state).cameraInfo().reflections).toBe(false);
    Object.assign(state, { composer: null }); // Low quality has no composer.
    expect(qa(state).cameraInfo().reflections).toBe(false);
  });
});

describe("Explorer placement snapping", () => {
  it.each([0, 9])("replaces stale boom length %s on placement and keeps it on the next frame", (stale) => {
    const state = cameraStand();
    state.boomActual = stale;
    state.pos.set(100, 5, -100);
    state.camera.position.set(-50, 20, 50);
    place(state, true);
    expect(state.boomActual).toBeCloseTo(FOLLOW.defaultDistance, 9);
    place(state);
    expect(state.boomActual).toBeCloseTo(FOLLOW.defaultDistance, 9);
  });

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

describe("Explorer descending framing", () => {
  it.each([0.5, Math.tan(Math.PI / 6)].flatMap((grade) => [-0.12, 0.2].map((pitch) => ({ grade, pitch }))))("keeps feet above the bottom eight percent at 60 degrees, descending at grade=$grade, pitch=$pitch", ({ grade, pitch }) => {
    const state = cameraStand();
    state.pitch = pitch;
    // Run the real FOV transition as well as the camera placement, without a renderer.
    state.setFov.mockImplementation((...args: unknown[]) => {
      (Explorer.prototype as unknown as { setFov(target: number, snap: boolean, dt: number): void })
        .setFov.apply(state, args as [number, boolean, number]);
    });
    place(state, true);
    const runMps = 0.9 / Math.hypot(1, grade);
    for (let frame = 0; frame < 120; frame++) {
      state.pos.z -= runMps / 60;
      state.pos.y -= runMps * grade / 60;
      place(state);
    }
    expect(state.camera.fov).toBe(60);
    state.camera.updateMatrixWorld(true);
    const footY = state.pos.clone().project(state.camera).y;
    // Negative control: the unchanged boom with the original pure aim target. At an upward-looking
    // pitch it reproduces the reported crop; the default pitch already clears -0.84 before the fix.
    const original = state.camera.clone();
    original.lookAt(followPose(state.pos.clone().add(new THREE.Vector3(0, WALKER_BODY.eyeM, 0)), state.yaw, pitch).target);
    original.updateMatrixWorld(true);
    const beforeY = state.pos.clone().project(original).y;
    process.stdout.write(`descending grade=${grade.toFixed(6)}, pitch=${pitch}: foot NDC ${beforeY.toFixed(6)} -> ${footY.toFixed(6)}\n`);
    if (pitch > 0) expect(beforeY).toBeLessThan(-0.84);
    expect(footY).toBeGreaterThan(-0.84);
    expect(footY).toBeGreaterThan(beforeY);
  });

  it.each([0, 0.5])("preserves the pure pose on level/up-stairs at grade=%s", (grade) => {
    const state = cameraStand();
    state.reducedMotion = true; // Compare the solved pose directly, without positional damping.
    for (let frame = 0; frame < 120; frame++) {
      state.pos.z -= 0.9 / 60;
      state.pos.y += grade * 0.9 / 60;
      place(state);
      const pose = followPose(state.pos.clone().add(new THREE.Vector3(0, WALKER_BODY.eyeM, 0)), state.yaw, state.pitch);
      const expected = new THREE.PerspectiveCamera();
      expected.position.copy(pose.pivot).addScaledVector(pose.back, FOLLOW.defaultDistance);
      expected.lookAt(pose.target);
      expect(state.descentDrop).toBe(0);
      expect(state.camera.position.distanceTo(expected.position)).toBeLessThan(1e-12);
      expect(state.camera.quaternion.angleTo(expected.quaternion)).toBeLessThan(1e-7);
    }
  });

  it("eases descending aim in and out, and snaps for reduced motion and placements", () => {
    const state = cameraStand();
    place(state, true);
    for (let frame = 0; frame < 30; frame++) {
      state.pos.y -= 0.4 / 60;
      place(state);
    }
    expect(state.descentDrop).toBeGreaterThan(0);
    expect(state.descentDrop).toBeLessThan(descentAimDrop(state.slope));
    state.reducedMotion = true;
    state.pos.y -= 0.4 / 60;
    place(state);
    expect(state.descentDrop).toBe(descentAimDrop(state.slope));
    state.reducedMotion = false;
    const descending = state.descentDrop;
    for (let frame = 0; frame < 30; frame++) place(state);
    expect(state.descentDrop).toBeGreaterThan(0);
    expect(state.descentDrop).toBeLessThan(descending);
    for (let frame = 0; frame < 90; frame++) place(state);
    expect(state.descentDrop).toBe(0);
    state.descentDrop = descending;
    place(state, true);
    expect(state.descentDrop).toBe(0);
    expect(state.slope).toEqual(NO_SLOPE);
  });
});

describe("Explorer guide stair lens", () => {
  it.each(["stairs", "escalator"] as const)("widens on shallow %s and holds across a short landing", (mode) => {
    const state = Object.assign(cameraStand(), { mode: "guide", lastAvatarPos: new THREE.Vector3(), teleported: false, bodyYaw: 0 });
    const route = [
      { x: 0, y: 0, z: 0, zKnown: true, stepIndex: -1, floorId: "b1" },
      { x: 0, y: 0.5, z: -10, zKnown: true, stepIndex: 0, floorId: "b1" },
      { x: 0, y: 0.5, z: -20, zKnown: true, stepIndex: 1, floorId: "b1" },
    ];
    const spans = guidePaceSpans(route, [{ mode }, { mode: "walk" }], []);
    qa(state).startGuide(route, 0, [], spans);
    place(state, true);
    expect(state.setFov.mock.lastCall?.[0]).toBe(60);
    for (let i = 0; i < 60; i++) {
      state.guide!.s += 0.9 / 60;
      state.pos.y += 0.045 / 60; // Far below SLOPE.enter.
      place(state);
    }
    expect(state.slope.speed).toBeLessThan(SLOPE.enter);
    expect(state.setFov.mock.lastCall?.[0]).toBe(60);
    state.guide!.s = spans[0]!.toS;
    for (let i = 0; i < SLOPE.hold * 60 - 1; i++) place(state);
    expect(state.setFov.mock.lastCall?.[0]).toBe(60);
    // Another stair flight before hold expires resets the landing timer.
    state.guide!.s = 1;
    place(state);
    state.guide!.s = spans[0]!.toS;
    for (let i = 0; i < SLOPE.hold * 60 + 1; i++) place(state);
    expect(state.setFov.mock.lastCall?.[0]).toBe(50);
  });

  it("keeps level walking at 50 even if an old guide has a stairs span", () => {
    const state = cameraStand();
    state.guide = { s: 1, spans: [{ fromS: 0, toS: 10, maxMps: 0.9, scales: true, mode: "stairs" }] };
    for (let i = 0; i < 120; i++) place(state);
    expect(state.slope.on).toBe(false);
    expect(state.setFov.mock.lastCall?.[0]).toBe(50);
  });
});
