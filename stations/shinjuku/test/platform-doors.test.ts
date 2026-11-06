import { expect, it } from "vitest";
import * as THREE from "three";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildStation, carDoorCenters, psdOpeningCenters, PLATFORM_DOOR_WIDTH, TRAIN_CARS } from "../scene/build.ts";
import { withCanvasStub } from "./helpers/scene-digest.ts";
import { pointInRings, type Plan } from "../scene/layout.ts";

it("puts every platform door opening on a car door, keeping only openings wholly on the platform", () => {
  const stopS = 80, platA = 2, platB = 158;
  const openings = psdOpeningCenters(stopS, platA, platB);
  const doors = carDoorCenters(stopS, TRAIN_CARS);
  expect(openings.length).toBeGreaterThan(10);
  const offsets = openings.map((c) => Math.min(...doors.map((d) => Math.abs(d - c))));
  expect(Math.max(...offsets)).toBe(0);
  for (const c of openings) {
    expect(c - PLATFORM_DOOR_WIDTH / 2).toBeGreaterThanOrEqual(platA);
    expect(c + PLATFORM_DOOR_WIDTH / 2).toBeLessThanOrEqual(platB);
  }
  // No opening fits wholly within this short platform.
  expect(psdOpeningCenters(0, -3, 3)).toEqual([]);
});

it("keeps the platform door collision modules identical to origin/main", () => {
  const { bundle } = loadShinjukuBundle();
  const built = withCanvasStub(() => buildStation(bundle, planJson as unknown as Plan, { quality: "low", reuseLayout: true, verifyRestrictedInput: true }));
  const round = (p: { x: number; y: number }) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000];
  const walls = built.propWalls;
  // Snapshot from origin/main (same values: the collision loop is untouched).
  expect(walls.length).toBe(4704);
  expect(round(walls[0]!.a)).toEqual([-2.87, 74.736]);
  expect(round(walls[0]!.b)).toEqual([-4.104, 80.197]);
  expect(round(walls.at(-1)!.a)).toEqual([-252.6, -68.9]);
  expect(round(walls.at(-1)!.b)).toEqual([-257.7, -84.2]);
  expect(walls[0]!.zMin).toBe(-42.97);
  expect(walls[0]!.zMax).toBe(-41.519999999999996);
  built.dispose();
}, 120_000);


it("keeps platform markings in the existing tactile mesh on the platform floor", () => {
  const { bundle } = loadShinjukuBundle();
  const built = withCanvasStub(() => buildStation(bundle, planJson as unknown as Plan, { quality: "low", reuseLayout: true, verifyRestrictedInput: true }));
  const tactile: THREE.Mesh[] = [];
  let leaves = 0;
  built.root.traverse(o => {
    if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return;
    if (o.material.name === "mat.tactile") tactile.push(o);
    if (o.material.name === "mat.psdLeaf" && o instanceof THREE.InstancedMesh) leaves += o.count;
  });
  expect(tactile).toHaveLength(1); // origin/main has one tactile mesh
  const geometry = tactile[0]!.geometry;
  const positions = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
  // Existing tactile has 214 triangles (107 quads); new quads precede it in the merge.
  const newVertices = positions.count - 107 * 4;
  expect(newVertices).toBeGreaterThan(0);
  const level = built.layout.levels.find(l => l.walls.some(w => w.kind === "trackside"))!;
  let doorQuads = 0;
  const outside: { x: number; y: number; quad: number; door: boolean }[] = [];
  for (let i = 0; i < newVertices; i += 4) {
    if (Math.abs(uv.getY(i) - 0.03) < 1e-5) doorQuads++;
    for (let j = 0; j < 4; j++) {
      const k = i + j;
      expect(positions.getY(k)).toBeCloseTo(level.z + 0.006, 4);
      const p = { x: positions.getX(k), y: -positions.getZ(k) };
      if (!level.slabs.some(s => pointInRings(p, s.rings))) outside.push({ ...p, quad: i / 4, door: Math.abs(uv.getY(i) - 0.03) < 1e-5 });
    }
  }
  expect(outside).toEqual([]);
  expect(doorQuads).toBe(leaves / 2);
  built.dispose();
}, 120_000);
