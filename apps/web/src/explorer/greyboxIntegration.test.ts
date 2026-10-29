import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createRouter } from "@gteki/navigation";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";
import { Explorer } from "./explorer.ts";
import { greyboxSceneProbes, insideGreyboxOpening, nearGreybox, routeUsesGreybox } from "./greyboxScene.ts";
import { strings } from "../i18n.ts";
import { darkSampleDistances } from "./routeGroundQa.ts";

const bundle = () => createSyntheticBundle([syntheticEdge("hall", "start", "a")]);

function fixture() {
  const floor = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 6), new THREE.MeshBasicMaterial());
  floor.position.set(0, -0.1, 0);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3, 6), new THREE.MeshBasicMaterial());
  wall.position.set(2.1, 1.5, 0);
  const root = new THREE.Group(); root.add(floor, wall); root.updateMatrixWorld(true);
  const scene = { root, walkable: [floor], colliders: [wall], walls: [{ a: { x: 2.05, y: -3 }, b: { x: 2.05, y: 3 }, zMin: 0, zMax: 3 }], dispose: vi.fn() };
  const keys = new Set<string>();
  const state = Object.assign(Object.create(Explorer.prototype), {
    loadGeneration: 0, disposed: false, mode: "walk", quality: "high", stationCaches: { remember: vi.fn() },
    releaseStationCaches: vi.fn(), clearStation: vi.fn(), ensureAudio: () => false,
    buildStationScene: async () => scene, overviewLook: { set: vi.fn() }, street: { restore: vi.fn(), attach: vi.fn() },
    scene: new THREE.Scene(), world: new THREE.Group(), overlays: new THREE.Group(), routeGroup: new THREE.Group(),
    applyLighting: vi.fn(), cameraCut: { apply: () => [] }, attachShadows: vi.fn(), buildOccluders: vi.fn(),
    setupComposer: vi.fn(), frameAll: vi.fn(), events: {}, ray: new THREE.Raycaster(),
    pos: new THREE.Vector3(1, 0, 0), yaw: -Math.PI / 2, pitch: 0, camDistance: 3,
    input: { enabled: true, virtualKeys: keys, consumeLook: () => ({ dx: 0, dy: 0, zoom: 0 }), move: () => ({ x: 0, y: keys.has("KeyW") ? 1 : 0, run: false }) },
    timer: { getElapsed: () => 0 }, render: vi.fn(),
    step(dt: number) { (Explorer.prototype as unknown as { stepWalk(this: unknown, dt: number): void }).stepWalk.call(state, dt); },
  });
  const loaded = { key: "synthetic", bundle: bundle(), assetUrls: new Map(), scene: undefined };
  return { state, scene, loaded };
}

describe("greybox station integration", () => {
  it("builds floor and targets and walks through a portal in the original collider", async () => {
    const { state, loaded } = fixture();
    expect(await state.loadStation(loaded, createRouter(loaded.bundle))).toBe(true);
    expect(state.greybox.stats.runs).toBe(1);
    expect(state.greyboxOpenings).toHaveLength(1);
    expect(state.world.children).toContain(state.greybox.root);
    expect(state.groundTargets).toContain(state.greybox.walkable[0]);
    expect(state.colliderTargets).toContain(state.greybox.colliders[0]);
    expect(state.groundAt(4, 0.4, 0, 1)).toBeCloseTo(0);
    const point = (x: number, y: number) => ({ x, y, z: 0, zKnown: true, stepIndex: 0, floorId: "concourse" });
    const vertical = [{ mode: "stairs", fromNodeId: "isolated", toNodeId: "upper" }];
    expect(state.routeGroundCheck([point(0, 0), point(10, 0)], vertical)).toMatchObject({ samples: 21, noFloor: 0, verticalWithoutConnector: 1 });
    expect(state.routeGroundCheck([point(0, 8), point(10, 8)], [])).toMatchObject({ samples: 21, noFloor: 21, verticalWithoutConnector: 0 });
    const result = state.walkPath([{ x: 5, z: 0 }], { maxSeconds: 10 });
    expect(result).toMatchObject({ done: true, stuck: false });
    expect(state.pos.x).toBeGreaterThan(4.5);
    expect(state.pos.y).toBeCloseTo(0);
    expect(state.blockedByColliders(new THREE.Vector3(1.5, 0, 2.3), new THREE.Vector3(2.2, 0, 2.3))).not.toBeNull();
    state.mode = "guide";
    state.guideIdentityHoldS = 0;
    state.guide = { pts: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)], cum: [0, 10], steps: [-1, 0], s: 2.05, paused: true, stops: [], holding: false, spans: [] };
    state.stepGuide(0.016);
    expect(state.pos.x).toBeCloseTo(2.05);
  });

  it("detects scene wall intersections and bounds openings in the passage frame", () => {
    const scene = greyboxSceneProbes([], [{ ax: 2, az: -3, bx: 2, bz: 3, yMin: 0, yMax: 3 }]);
    expect(scene.wallHit({ x: 1, y: 0, z: 0 }, { x: 3, y: 0, z: 0 })).toEqual({ x: 2, y: 0, z: 0 });
    const box = { center: new THREE.Vector3(2, 0, 0), along: new THREE.Vector3(1, 0, 0), across: new THREE.Vector3(0, 0, 1), width: 2, depth: 0.6, height: 2.3 };
    expect(insideGreyboxOpening(new THREE.Vector3(2, 1, 0), box)).toBe(true);
    expect(insideGreyboxOpening(new THREE.Vector3(2, 1, 2), box)).toBe(false);
  });

  it("samples dark share with a test renderer and restores the camera", async () => {
    const { state, loaded } = fixture();
    await state.loadStation(loaded, createRouter(loaded.bundle));
    const readPixels = vi.fn((_x, _y, _w, _h, _format, _type, pixels: Uint8Array) => pixels.fill(255));
    state.renderer = { getContext: () => ({ drawingBufferWidth: 10, drawingBufferHeight: 10, RGBA: 6408, UNSIGNED_BYTE: 5121, readPixels }), render: vi.fn() };
    state.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    state.camera.position.set(20, 10, 5);
    state.avatar = new THREE.Group(); state.avatar.position.set(1, 0, 0);
    state.composer = null;
    state.guideAllStops = [];
    const route = [{ x: 0, y: 0, z: 0, zKnown: true, stepIndex: -1, floorId: "concourse" }, { x: 10, y: 0, z: 0, zKnown: true, stepIndex: 0, floorId: "concourse" }];
    const share = await state.routeGroundCheck(route, []).darkShare();
    expect(share).toBeGreaterThanOrEqual(0);
    expect(share).toBeLessThanOrEqual(1);
    expect(readPixels).toHaveBeenCalledTimes(2);
    expect(state.camera.position.toArray()).toEqual([20, 10, 5]);
    expect(state.avatar.position.toArray()).toEqual([1, 0, 0]);
  });

  it("retains late guide stops within the 40-frame cap", () => {
    const samples = darkSampleDistances(500, [5, 495, 500]);
    expect(samples).toHaveLength(40);
    expect(samples).toEqual(expect.arrayContaining([5, 495, 500]));
    expect(samples).toContain(0);
    expect(() => darkSampleDistances(500, Array.from({ length: 41 }, (_, i) => i))).toThrow(RangeError);
  });

  it("detects a route crossing and walk proximity in 3D", () => {
    const runs = [{ line: new THREE.Line3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)), halfWidth: 1 }];
    expect(routeUsesGreybox([{ x: 5, y: -2, z: 0 }, { x: 5, y: 2, z: 0 }], runs)).toBe(true);
    expect(nearGreybox(new THREE.Vector3(5, 0, 15.9), runs, 15)).toBe(true);
    expect(nearGreybox(new THREE.Vector3(5, 0, 16.1), runs, 15)).toBe(false);
    expect(nearGreybox(new THREE.Vector3(5, 20, 0), runs, 15)).toBe(false);
  });

  it("updates the localized legend when a route or nearby walk needs it", () => {
    const notify = vi.fn();
    const state = Object.assign(Object.create(Explorer.prototype), {
      routeGroup: new THREE.Group(), mode: "overview", pos: new THREE.Vector3(5, 0, 0),
      greyboxSegments: [{ line: new THREE.Line3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)), halfWidth: 1 }],
      greyboxLegendVisible: false, events: { onGreyboxLegend: notify },
    });
    state.routeGroup.userData.greybox = true;
    state.updateGreyboxLegend();
    expect(notify).toHaveBeenLastCalledWith(true);
    state.routeGroup.userData.greybox = false;
    state.mode = "walk";
    state.updateGreyboxLegend();
    expect(notify).toHaveBeenCalledTimes(1);
    state.pos.set(5, 0, 17);
    state.updateGreyboxLegend();
    expect(notify).toHaveBeenLastCalledWith(false);
    state.mode = "overview";
    state.updateGreyboxLegend();
    expect(notify).toHaveBeenLastCalledWith(true);
    expect(strings("ja").greyboxLegend).toBe("示意，非實測");
    expect(strings("en").greyboxLegend).toBe("Approximate, not surveyed");
  });
});
