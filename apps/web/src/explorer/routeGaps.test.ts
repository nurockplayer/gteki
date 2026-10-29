import { describe, expect, it } from "vitest";
import { unmodelledRuns } from "./routeGaps.ts";

// Floor everywhere except x in (10, 20).
const floorOutsideGap = (p: { x: number }) => p.x <= 10 || p.x >= 20;

describe("unmodelled route runs", () => {
  it("returns nothing when every sample has a floor", () => {
    expect(unmodelledRuns([{ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }], () => true)).toEqual([]);
  });

  it("covers the gap and joins the floored samples on both sides", () => {
    const runs = unmodelledRuns([{ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 2 }], floorOutsideGap);
    expect(runs).toHaveLength(1);
    expect(runs[0]![0]!.x).toBe(10);
    expect(runs[0]!.at(-1)!.x).toBe(20);
  });

  it("ignores a seam where one sample misses the floor", () => {
    expect(unmodelledRuns([{ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }], (p) => p.x <= 10 || p.x >= 11)).toEqual([]);
  });

  it("probes only the ends of a vertical piece", () => {
    const lift = [{ x: 5, y: 0, z: 0 }, { x: 5, y: 0, z: 8 }];
    expect(unmodelledRuns(lift, (p) => p.z === 0 || p.z === 8)).toEqual([]);
  });

  it("treats a sceneGap edge as unmodelled even over a floor, joining the floored ends", () => {
    const runs = unmodelledRuns([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 20, y: 0, z: 0, sceneGap: true }, { x: 30, y: 0, z: 0 }], () => true);
    expect(runs).toHaveLength(1);
    expect(runs[0]![0]!.x).toBe(10);
    // The band ends one sample past the edge's end node.
    expect(runs[0]!.at(-1)!.x).toBe(20.5);
  });

  it("keeps a densely sampled sceneGap edge whole, and a short one too", () => {
    const dense = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, ...Array.from({ length: 20 }, (_, i) => ({ x: 10 + (i + 1) * 0.4, y: 0, z: 0, sceneGap: true })), { x: 20, y: 0, z: 0 }];
    const runs = unmodelledRuns(dense, () => true);
    expect(runs).toHaveLength(1);
    expect(runs[0]![0]!.x).toBe(10);
    expect(runs[0]!.at(-1)!.x).toBeCloseTo(18.5, 5);
    expect(unmodelledRuns([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10.8, y: 0, z: 0, sceneGap: true }, { x: 20, y: 0, z: 0 }], () => true)).toHaveLength(1);
    // A single segment of half a metre or less.
    expect(unmodelledRuns([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10.4, y: 0, z: 0, sceneGap: true }, { x: 20, y: 0, z: 0 }], () => true)).toHaveLength(1);
  });

  it("runs to the route's end when the destination has no floor", () => {
    const runs = unmodelledRuns([{ x: 0, y: 0, z: 0 }, { x: 15, y: 0, z: 0 }], floorOutsideGap);
    expect(runs[0]!.at(-1)!.x).toBe(15);
  });
});
