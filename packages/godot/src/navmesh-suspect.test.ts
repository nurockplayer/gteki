import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { StationBundle } from "@gteki/schema";
import { makeFloorHeightNear, suspectVerticalEdges } from "./navmesh-suspect.ts";
import { countedTotals } from "./navmesh-audit.ts";

const floor = { id: "f0", renderElevationM: 0 };
const node = (id: string, x: number, y: number, z: number | null) => ({ id, floorId: "f0", position: { x, y, z }, kind: "junction", inOut: "inside", sourceRefs: [] });
const edge = (id: string, mode: string, from: string, to: string, geometry?: { x: number; y: number; z: number }[]) => ({ id, from, to, mode, direction: "both", lengthM: null, geometry, paid: null, crossesFareBoundary: null, wheelchair: null, steps: null, hours: null, closed: false });
function bundle(nodes: ReturnType<typeof node>[], edges: ReturnType<typeof edge>[]): StationBundle {
  return { floors: [floor], nodes, edges, pois: [] } as unknown as StationBundle;
}
const noFloor = () => null;
const any = () => true;

describe("suspect vertical edges", () => {
  it("flags a stair rising 3.9 m over 3.2 m of plan as slope", () => {
    const b = bundle([node("a", 0, 0, 0), node("b", 3.2, 0, 3.9)], [edge("e1", "stairs", "a", "b")]);
    const found = suspectVerticalEdges(b, noFloor, any);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ edgeId: "e1", mode: "stairs", reason: "slope" });
  });

  it("uses the edge geometry for plan length when present", () => {
    // Nodes stand 3.9 m apart vertically; the drawn polyline runs 6.4 m of plan, so the stair is not steep.
    const geometry = [{ x: 0, y: 0, z: 0 }, { x: 3.2, y: 0, z: 0 }, { x: 0, y: 0, z: 3.9 }];
    const b = bundle([node("a", 0, 0, 0), node("b", 0, 0, 3.9)], [edge("e1", "stairs", "a", "b", geometry)]);
    expect(suspectVerticalEdges(b, noFloor, any)).toEqual([]);
  });

  it("does not flag a stair rising 3 m over 6 m", () => {
    const b = bundle([node("a", 0, 0, 0), node("b", 6, 0, 3)], [edge("e1", "stairs", "a", "b")]);
    expect(suspectVerticalEdges(b, noFloor, any)).toEqual([]);
  });

  it("flags an elevator whose upper end sits 0.8 m above the floor", () => {
    const b = bundle([node("a", 0, 0, 0), node("b", 0, 0, 3)], [edge("e1", "elevator", "a", "b")]);
    const floorAt = (_x: number, _y: number, z: number) => (z > 2 ? 2.2 : z);
    const found = suspectVerticalEdges(b, floorAt, any);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ edgeId: "e1", mode: "elevator", reason: "end_height" });
  });

  it("does not flag an end without a floor (null)", () => {
    const b = bundle([node("a", 0, 0, 0), node("b", 3, 0, 0.5)], [edge("e1", "stairs", "a", "b")]);
    expect(suspectVerticalEdges(b, noFloor, any)).toEqual([]);
  });

  it("ignores edges the traversable filter refuses", () => {
    const b = bundle([node("a", 0, 0, 0), node("b", 3.2, 0, 3.9)], [edge("e1", "stairs", "a", "b")]);
    expect(suspectVerticalEdges(b, noFloor, () => false)).toEqual([]);
  });

  it("finds the walkable surface nearest z within 1.5 m", () => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2).translate(0, 5, 0));
    const floorHeightNear = makeFloorHeightNear({ ground: [plane] });
    expect(floorHeightNear(0, 0, 4.8)).toBeCloseTo(5, 6);
    expect(floorHeightNear(0, 0, 2)).toBeNull();
  });
});

describe("suspect sample filter", () => {
  it("counts no samples of a suspect step", () => {
    const details = [
      { floor: "off" as const, wallBefore: false },
      { floor: "none" as const, wallBefore: true },
      { floor: "ok" as const, wallBefore: false },
    ];
    expect(countedTotals(details, [{ suspect: true }, { suspect: true }, { suspect: false }])).toEqual({ samples: 1, offFloor: 0, noFloor: 0, wallHits: 0 });
    expect(countedTotals(details, [{}, {}, {}])).toEqual({ samples: 3, offFloor: 1, noFloor: 1, wallHits: 1 });
  });
});
