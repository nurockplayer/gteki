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
  });
  return state as typeof state & Explorer;
}

const qa = (state: ReturnType<typeof qaStand>) => state as unknown as Explorer;

describe("Explorer QA hooks", () => {
  it("walks a three-point renderer-space path through ordinary walk movement", () => {
    const state = qaStand();
    const sampled: number[] = [];
    const result = qa(state).walkPath([{ x: 0, z: -1 }, { x: 1, z: -1 }, { x: 1, z: -2 }], {
      onStep: (i) => sampled.push(i),
    });
    expect(result).toMatchObject({ done: true, stuck: false });
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
    expect(result).toMatchObject({ done: false, stuck: true });
    expect(result.steps).toBeLessThanOrEqual(121);
    expect(state.pos.z).toBeGreaterThan(-1);
    expect([...state.input.virtualKeys]).toEqual([]);
  });

  it("does not move outside walk mode", () => {
    const state = qaStand("guide");
    expect(qa(state).walkPath([{ x: 0, z: -1 }])).toEqual({ done: false, stuck: false, steps: 0 });
    expect(state.pos.toArray()).toEqual([0, 0, 0]);
    expect(state.render).not.toHaveBeenCalled();
  });

  it("measures nearby camera blockers and sign boxes, using the lowest bottom gap", () => {
    const state = qaStand();
    state.camera.position.set(0, 2, 0);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    sign.name = "overhead sign";
    sign.position.y = 3.5;
    sign.updateMatrixWorld(true);
    state.signMeshes.add(sign);
    expect(qa(state).signClearance()).toEqual({ nearest: { name: "overhead sign", gapM: 1 }, inside: false, count: 1 });

    const containing = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    containing.name = "camera box";
    containing.position.y = 2;
    containing.updateMatrixWorld(true);
    state.blockerTargets.add(containing);
    const result = qa(state).signClearance();
    expect(result.inside).toBe(true);
    expect(result.nearest).toEqual({ name: "camera box", gapM: -1 });
    expect(result.count).toBe(2);

    const distant = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    distant.name = "far sign";
    distant.position.set(20, 3, 0);
    distant.updateMatrixWorld(true);
    state.signMeshes.add(distant);
    expect(qa(state).signClearance(6).count).toBe(2);

    const low = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    low.name = "floor-standing sign";
    low.position.set(1, 0.5, 0);
    low.updateMatrixWorld(true);
    state.signMeshes.add(low);
    expect(qa(state).signClearance(6).count).toBe(2);
  });
});
