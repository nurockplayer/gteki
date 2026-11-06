import { expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildStation, carDoorCenters, psdOpeningCenters, PLATFORM_DOOR_WIDTH, TRAIN_CARS } from "../scene/build.ts";
import { withCanvasStub } from "./helpers/scene-digest.ts";
import type { Plan } from "../scene/layout.ts";

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
  // A short platform keeps only the openings that fit wholly on it.
  expect(psdOpeningCenters(0, -3, 3)).toEqual([0]);
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
});
