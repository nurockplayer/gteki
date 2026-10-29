import { describe, expect, it } from "vitest";
import type { StationBundle } from "@gteki/schema";
import { unmodelledRunsByEdge } from "./greybox.ts";

const bundle = {
  floors: [{ id: "f", renderElevationM: 0 }],
  nodes: [{ id: "a", floorId: "f", position: { x: 0, y: 0, z: 0 } }, { id: "b", floorId: "f", position: { x: 10, y: 0, z: 0 } }],
  edges: [{ id: "e", from: "a", to: "b", mode: "walk" }],
} as unknown as StationBundle;

describe("unmodelledRunsByEdge", () => {
  it("detects a floorless run and extends it into the adjacent samples", () => {
    const runs = unmodelledRunsByEdge(bundle, () => true, (p) => p.x <= 2 || p.x >= 6);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.points[0]!.x).toBe(2);
    expect(runs[0]!.points.at(-1)!.x).toBe(6);
    expect(unmodelledRunsByEdge(bundle, () => false, () => false)).toEqual([]);
  });

  it("forces a sceneGap edge to be unmodelled", () => {
    const forced = { ...bundle, edges: [{ ...bundle.edges[0]!, attributes: { sceneGap: true } }] };
    expect(unmodelledRunsByEdge(forced, () => true, () => true)[0]!.points.at(-1)!.x).toBe(10);
  });

  it("keeps a short forced edge and extends by arc length across short segments", () => {
    const short = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 0.4, y: 0, z: 0 } }], edges: [{ ...bundle.edges[0]!, attributes: { sceneGap: true } }] };
    expect(unmodelledRunsByEdge(short, () => true, () => true)).toHaveLength(1);
    const bent = { ...bundle, edges: [{ ...bundle.edges[0]!, geometry: Array.from({ length: 51 }, (_, i) => ({ x: i * 0.2, y: 0, z: 0 })) }] };
    const run = unmodelledRunsByEdge(bent, () => true, (p) => p.x < 2 || p.x > 4)[0]!;
    expect(run.points[0]!.x).toBeCloseTo(1.5);
    expect(run.points.at(-1)!.x).toBeCloseTo(4.5);
  });

  it("extends half a metre along a slope", () => {
    const slope = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 10, y: 0, z: 10 } }] };
    const bare: { x: number; y: number; z: number }[] = [];
    const runs = unmodelledRunsByEdge(slope, () => true, (p) => {
      const missing = p.x >= 2 && p.x <= 4;
      if (missing) bare.push(p);
      return !missing;
    });
    const first = runs[0]!.points[0]!;
    expect(Math.hypot(first.x - bare[0]!.x, first.y - bare[0]!.y, first.z - bare[0]!.z)).toBeCloseTo(0.5);
  });
});
