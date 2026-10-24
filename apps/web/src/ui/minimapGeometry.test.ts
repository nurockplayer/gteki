import { describe, expect, it } from "vitest";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";
import type { ExplorerPose } from "../explorer/explorer.ts";
import { arrowRotationDeg, currentFloorId, floorWalkGraph, toMinimap } from "./minimapGeometry.ts";

const pose: ExplorerPose = { east: 10, north: 20, up: 0, headingDeg: 0, mode: "walk" };

describe("minimap orientation and player translation", () => {
  const turns = [
    { heading: 0, north: [0, -20], east: [20, 0] },
    { heading: 90, north: [-20, 0], east: [0, -20] },
    { heading: 180, north: [0, 20], east: [-20, 0] },
    { heading: 270, north: [20, 0], east: [0, 20] },
  ];
  for (const turn of turns) {
    it(`rotates around the body at ${turn.heading} degrees`, () => {
      const p = { ...pose, headingDeg: turn.heading };
      const north = toMinimap(10, 30, p, "player-up", .5);
      const east = toMinimap(20, 20, p, "player-up", .5);
      expect(north.x).toBeCloseTo(turn.north[0]!);
      expect(north.y).toBeCloseTo(turn.north[1]!);
      expect(east.x).toBeCloseTo(turn.east[0]!);
      expect(east.y).toBeCloseTo(turn.east[1]!);
      expect(arrowRotationDeg(p, "player-up")).toBe(0);
    });
    it(`keeps north fixed while the arrow faces ${turn.heading} degrees`, () => {
      const p = { ...pose, headingDeg: turn.heading };
      expect(toMinimap(10, 30, p, "north-up", .5)).toEqual({ x: 0, y: -20 });
      const east = toMinimap(20, 20, p, "north-up", .5);
      expect(east.x).toBe(20);
      expect(east.y).toBeCloseTo(0);
      expect(arrowRotationDeg(p, "north-up")).toBe(turn.heading);
    });
  }
  it("follows the player without changing scale in both modes", () => {
    for (const orientation of ["north-up", "player-up"] as const) {
      const a = toMinimap(15, 28, pose, orientation, .5);
      expect(toMinimap(115, -22, { ...pose, east: 110, north: -30 }, orientation, .5)).toEqual(a);
      const centre = toMinimap(pose.east, pose.north, pose, orientation, .5);
      expect(centre.x).toBeCloseTo(0);
      expect(centre.y).toBeCloseTo(0);
    }
  });
});

describe("current floor", () => {
  it("selects B1F versus 1F by display height and nearest 3D node, not floor order", () => {
    const bundle = createSyntheticBundle([]);
    bundle.floors = bundle.floors.slice(0, 2);
    bundle.floors[0]!.renderElevationM = -4;
    bundle.nodes = bundle.nodes.filter((n) => ["start", "a", "upper"].includes(n.id));
    for (const n of bundle.nodes) n.position.z = null;
    expect(currentFloorId(bundle, -4, 0, 0)).toBe("concourse");
    expect(currentFloorId(bundle, 4, 10, 0)).toBe("upper");
    expect(currentFloorId(bundle, 0, 0, 0)).toBeNull();
    bundle.nodes[0]!.position.z = 3;
    // Within the same vertical band, horizontal proximity matters too.
    expect(currentFloorId(bundle, 4, 0, 0)).toBe("concourse");
    expect(currentFloorId(bundle, 4, 10, 0)).toBe("upper");
  });
  it("uses node renderZ before floor elevation, includes the 2.5m boundary, and handles no nodes", () => {
    const bundle = createSyntheticBundle([]);
    bundle.nodes = [bundle.nodes[0]!];
    bundle.nodes[0]!.position.z = null;
    bundle.nodes[0]!.renderZ = -8;
    expect(currentFloorId(bundle, -5.5, 0, 0)).toBe("concourse");
    expect(currentFloorId(bundle, -5.49, 0, 0)).toBeNull();
    bundle.nodes = [];
    expect(currentFloorId(bundle, -8, 0, 0)).toBeNull();
  });
});

describe("current-floor schematic walk graph", () => {
  it("uses supplied polylines or straight endpoints, retaining mode and excluding elevators and cross-floor edges", () => {
    const bundle = createSyntheticBundle([
      syntheticEdge("straight", "start", "a"),
      syntheticEdge("bent", "a", "goal", { mode: "stairs", geometry: [{ x: 10, y: 0, z: null }, { x: 15, y: 3, z: null }, { x: 20, y: 0, z: null }] }),
      syntheticEdge("gate", "start", "b", { mode: "gate" }),
      syntheticEdge("lift", "start", "a", { mode: "elevator" }),
      syntheticEdge("up", "a", "upper", { mode: "stairs" }),
      syntheticEdge("other", "goal", "other"),
      syntheticEdge("missing", "start", "absent"),
      syntheticEdge("upper", "upper", "upper-2", { mode: "escalator" }),
    ]);
    expect(floorWalkGraph(bundle, "concourse")).toEqual([
      { mode: "walk", points: [{ east: 0, north: 0 }, { east: 10, north: 0 }] },
      { mode: "stairs", points: [{ east: 10, north: 0 }, { east: 15, north: 3 }, { east: 20, north: 0 }] },
      { mode: "gate", points: [{ east: 0, north: 0 }, { east: 0, north: 10 }] },
    ]);
    expect(floorWalkGraph(bundle, "upper").map((s) => s.mode)).toEqual(["escalator"]);
    expect(floorWalkGraph(bundle, "unknown")).toEqual([]);
  });
  it("normalises degenerate polylines to the node endpoints and pins offset ends to the nodes", () => {
    const bundle = createSyntheticBundle([
      syntheticEdge("empty", "start", "a", { geometry: [] }),
      syntheticEdge("single", "start", "b", { geometry: [{ x: 42, y: 42, z: null }] }),
      syntheticEdge("offset", "a", "goal", { geometry: [{ x: 11, y: 1, z: null }, { x: 15, y: 3, z: null }, { x: 19, y: 1, z: null }] }),
    ]);
    expect(floorWalkGraph(bundle, "concourse").map((s) => s.points)).toEqual([
      [{ east: 0, north: 0 }, { east: 10, north: 0 }],
      [{ east: 0, north: 0 }, { east: 0, north: 10 }],
      [{ east: 10, north: 0 }, { east: 15, north: 3 }, { east: 20, north: 0 }],
    ]);
  });
});
