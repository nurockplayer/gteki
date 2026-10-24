import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { Explorer } from "./explorer.ts";

function qaStand(mode = "walk") {
  const virtualKeys = new Set<string>();
  const state = Object.assign(Object.create(Explorer.prototype), {
    mode,
    pos: new THREE.Vector3(),
    camera: new THREE.PerspectiveCamera(),
    input: {
      enabled: true,
      virtualKeys,
      consumeLook: () => ({ dx: 0, dy: 0, zoom: 0 }),
      move: () => ({ x: 0, y: virtualKeys.has("KeyW") ? 1 : 0, run: virtualKeys.has("ShiftLeft") }),
    },
    yaw: 0,
    walls: [] as { ax: number; az: number; bx: number; bz: number; yMin: number; yMax: number }[],
    timer: { getElapsed: () => 0 },
    blockedByColliders: () => null,
    groundAt: () => 0,
    step(dt: number) {
      (Explorer.prototype as unknown as { stepWalk(this: typeof state, dt: number): void }).stepWalk.call(state, dt);
    },
    render: vi.fn(),
    blockerTargets: new Set<THREE.Object3D>(),
    signMeshes: new Set<THREE.Object3D>(),
    qaSignBounds: new THREE.Box3(),
    qaSignExpanded: new THREE.Box3(),
  });
  return state as typeof state & Explorer;
}

const qa = (state: ReturnType<typeof qaStand>) => state as unknown as Explorer;

function box(name: string, size: number[], at: number[]): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]));
  mesh.name = name;
  mesh.position.set(at[0]!, at[1]!, at[2]!);
  mesh.updateMatrixWorld(true);
  return mesh;
}

describe("Explorer QA hooks", () => {
  it("walks a three-point renderer-space path through ordinary walk movement", () => {
    const state = qaStand();
    const sampled: number[] = [];
    const result = qa(state).walkPath([{ x: 0, z: -1 }, { x: 1, z: -1 }, { x: 1, z: -2 }], {
      onStep: (i) => sampled.push(i),
    });
    expect(result).toMatchObject({ done: true, stuck: false, timedOut: false });
    expect(result.steps).toBeGreaterThan(0);
    expect(Math.hypot(state.pos.x - 1, state.pos.z + 2)).toBeLessThanOrEqual(0.35);
    expect(sampled).toHaveLength(result.steps);
    expect([...state.input.virtualKeys]).toEqual([]);
    expect(state.render).toHaveBeenCalledTimes(1);
  });

  it("reports stuck when a wall blocks the path", () => {
    const state = qaStand();
    state.walls.push({ ax: -10, az: -0.5, bx: 10, bz: -0.5, yMin: 0, yMax: 3 });
    const result = qa(state).walkPath([{ x: 0, z: -3 }], { maxSeconds: 2 });
    expect(result).toMatchObject({ done: false, stuck: true, timedOut: false });
    expect(result.steps).toBeLessThanOrEqual(120);
    expect(state.pos.z).toBeGreaterThan(-1);
    expect([...state.input.virtualKeys]).toEqual([]);
  });

  it("does not report done for a point 3 m above a walker that cannot climb", () => {
    const state = qaStand();
    const result = qa(state).walkPath([{ x: 0, z: -1, y: 3 }], { maxSeconds: 3 });
    expect(result.done).toBe(false);
    expect(result.stuck || result.timedOut).toBe(true);
  });

  it("counts a point with y when the feet are within 0.6 m vertically", () => {
    const state = qaStand();
    const result = qa(state).walkPath([{ x: 0, z: 0, y: 0.5 }]);
    expect(result).toMatchObject({ done: true, steps: 0 });
  });

  it("does not call a slow walker making waypoint progress stuck", () => {
    const state = qaStand();
    const points = Array.from({ length: 11 }, (_, i) => ({ x: 0, z: -0.3 * (i + 1) }));
    const result = qa(state).walkPath(points, { maxSeconds: 30 });
    expect(result).toMatchObject({ done: true, stuck: false, timedOut: false });
  });

  it("reports timedOut, not stuck, when maxSeconds runs out while still moving", () => {
    const state = qaStand();
    const result = qa(state).walkPath([{ x: 0, z: -10 }], { maxSeconds: 0.5 });
    expect(result).toMatchObject({ done: false, stuck: false, timedOut: true });
    expect(result.steps).toBe(30);
    expect(state.pos.z).toBeLessThan(-0.1);
  });

  it("returns done at once with maxSeconds 0 when already at the last point", () => {
    const state = qaStand();
    expect(qa(state).walkPath([{ x: 0, z: 0 }], { maxSeconds: 0 })).toEqual({ done: true, stuck: false, timedOut: false, steps: 0 });
  });

  it("does not move outside walk mode", () => {
    const state = qaStand("guide");
    expect(qa(state).walkPath([{ x: 0, z: -1 }])).toEqual({ done: false, stuck: false, timedOut: false, steps: 0 });
    expect(state.pos.toArray()).toEqual([0, 0, 0]);
    expect(state.render).not.toHaveBeenCalled();
  });

  it("measures nearby camera blockers and sign boxes, using the lowest bottom gap", () => {
    const state = qaStand();
    state.camera.position.set(0, 2, 0);
    const sign = box("overhead sign", [1, 1, 1], [0, 3.5, 0]);
    state.signMeshes.add(sign);
    expect(qa(state).signClearance()).toEqual({ nearest: { name: "overhead sign", gapM: 1 }, inside: false, count: 1 });

    const containing = box("camera box", [2, 2, 2], [0, 2, 0]);
    state.blockerTargets.add(containing);
    const result = qa(state).signClearance();
    expect(result.inside).toBe(true);
    expect(result.nearest).toEqual({ name: "camera box", gapM: -1 });
    expect(result.count).toBe(2);

    const distant = box("far sign", [1, 1, 1], [20, 3, 0]);
    state.signMeshes.add(distant);
    expect(qa(state).signClearance(6).count).toBe(2);

    const low = box("floor-standing sign", [1, 1, 1], [1, 0.5, 0]);
    state.signMeshes.add(low);
    expect(qa(state).signClearance(6).count).toBe(2);
  });

  it("counts a sign whose top is 0.2 m below the camera and ignores one 0.5 m below", () => {
    const state = qaStand();
    state.camera.position.set(0, 2, 0);
    state.signMeshes.add(box("hanging", [1, 1, 1], [3, 1.3, 0]));
    state.signMeshes.add(box("low", [1, 1, 1], [-3, 1, 0]));
    expect(qa(state).signClearance()).toMatchObject({ count: 1, nearest: { name: "hanging" } });
  });

  it("reports inside when the camera is within the near-plane margin outside a box face", () => {
    const state = qaStand();
    state.camera.position.set(1.1, 0, 0);
    state.signMeshes.add(box("panel", [2, 2, 2], [0, 0, 0]));
    expect(qa(state).signClearance()).toMatchObject({ inside: true, count: 1 });
  });
});
