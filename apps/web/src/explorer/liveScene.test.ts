import * as THREE from "three";
import { expect, it, vi } from "vitest";
import { buildLiveScene } from "./liveScene.ts";

const clock = vi.hoisted(() => ({ now: 0 }));
vi.mock("./stairwellCut.ts", () => ({
  stairwellWells: () => [],
  cutStairwells: () => {
    clock.now += 11;
    return { resources: { instances: [] }, colliders: [], walls: [] };
  },
}));
vi.mock("./greyboxConnectors.ts", () => ({
  buildConnectors: () => {
    clock.now += 31;
    return { walkable: [], colliders: [], wallSegments: [] };
  },
}));
vi.mock("./greybox.ts", () => ({ splitWallsAtOpenings: () => { clock.now += 7; return []; } }));

it("attributes connector construction to connectors, separately from the cut and wall split", () => {
  // An earlier recipe wait must not enter any synchronous build interval.
  clock.now = 10_000;
  const now = vi.spyOn(performance, "now").mockImplementation(() => clock.now);
  try {
    const root = new THREE.Group();
    const options = {
      root, bundle: {}, traversable: () => true, hasFloor: () => false,
      greybox: { root: new THREE.Group(), walkable: [], colliders: [], wallSegments: [] }, openings: [],
      originalTargets: { ground: [], collider: [], blockers: new Set(), camera: [], sky: [] },
      walkable: [], colliders: [], cameraBlockers: [], walls: [], tier: "low", recipe: null, portalInstances: [],
    } as unknown as Parameters<typeof buildLiveScene>[0];
    expect(buildLiveScene(options).timings).toEqual({ stairwellCut: 11, cutTargets: 0, connectors: 31, connectorWalls: 7 });
  } finally { now.mockRestore(); }
});
