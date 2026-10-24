import { describe, expect, it } from "vitest";
import type { PolylinePoint, RouteStep } from "@gteki/navigation";
import type { Poi } from "@gteki/schema";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";
import type { ExplorerPose } from "../explorer/explorer.ts";
import { advanceRouteSeg, arrowRotationDeg, currentFloorId, floorPois, floorWalkGraph, nextFloorChange, rimBearing, routeOnFloor, toMinimap } from "./minimapGeometry.ts";

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

const point = (x: number, y: number, floorId: string, stepIndex: number): PolylinePoint =>
  ({ x, y, z: floorId === "upper" ? 4 : 0, zKnown: true, stepIndex, floorId });

const step = (fromFloorId: string, toFloorId: string, mode: RouteStep["mode"] = "walk"): RouteStep =>
  ({ edgeId: `${fromFloorId}-${toFloorId}-${mode}`, fromNodeId: "from", toNodeId: "to", reversed: false, mode, lengthM: 10, fromFloorId, toFloorId });

/** B1F → 1F → B1F → 1F: leaves the concourse twice and re-enters once. */
const B1F = "concourse", F1 = "upper";
const zigzag: PolylinePoint[] = [
  point(0, 0, B1F, -1),
  point(10, 0, B1F, 0),
  point(10, 0, F1, 1),
  point(10, 10, F1, 2),
  point(10, 10, B1F, 3),
  point(20, 10, B1F, 4),
  point(20, 10, F1, 5),
];
const zigzagSteps: RouteStep[] = [
  step(B1F, B1F),
  step(B1F, F1, "stairs"),
  step(F1, F1),
  step(F1, B1F, "stairs"),
  step(B1F, B1F),
  step(B1F, F1, "escalator"),
];

describe("route on one floor", () => {
  it("splits into separate runs when the route leaves and re-enters the floor", () => {
    expect(routeOnFloor(zigzag, B1F, zigzagSteps)).toEqual([
      [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      [{ x: 10, y: 10 }, { x: 20, y: 10 }],
    ]);
    expect(routeOnFloor(zigzag, F1, zigzagSteps)).toEqual([[{ x: 10, y: 0 }, { x: 10, y: 10 }]]);
    expect(routeOnFloor(zigzag, "missing", zigzagSteps)).toEqual([]);
  });
  it("never draws a level change or a single point as a run", () => {
    expect(routeOnFloor([point(0, 0, B1F, -1), point(0, 0, F1, 0)], B1F, [step(B1F, F1)])).toEqual([]);
    // A lone on-floor point between two off-floor points has no pair to draw.
    const isolated = [point(0, 0, F1, 0), point(5, 0, B1F, 1), point(6, 0, F1, 2)];
    expect(routeOnFloor(isolated, B1F, [step(F1, B1F)])).toEqual([]);
    expect(routeOnFloor([], B1F, [])).toEqual([]);
  });
  it("does not flatten a cross-floor stair's drawn vertices into the floor line", () => {
    const points = [
      point(0, 0, B1F, -1),
      point(10, 0, B1F, 0),
      point(11, 2, B1F, 1), // stair interior, tagged with the floor it leaves
      point(12, 4, F1, 1),
    ];
    const steps = [step(B1F, B1F), step(B1F, F1, "stairs")];
    expect(routeOnFloor(points, B1F, steps)).toEqual([[{ x: 0, y: 0 }, { x: 10, y: 0 }]]);
    expect(routeOnFloor(points, F1, steps)).toEqual([]);
    // Losing the step evidence drops the segment instead of assuming it stays on the floor.
    expect(routeOnFloor(points, B1F, [])).toEqual([]);
  });
  it("drops a segment whose ending point has no step at all, rather than assuming a same-floor walk", () => {
    const points = [point(0, 0, B1F, -1), point(10, 0, B1F, 2)];
    // The second point claims step 2, but only steps 0 and 1 were supplied.
    expect(routeOnFloor(points, B1F, [step(B1F, B1F), step(B1F, B1F)])).toEqual([]);
  });
});

describe("next floor change", () => {
  it("picks the first step leaving the current floor and its start point on this floor", () => {
    expect(nextFloorChange(zigzag, zigzagSteps, B1F, 0)).toEqual({ x: 10, y: 0, mode: "stairs", toFloorId: F1 });
    expect(nextFloorChange(zigzag, zigzagSteps, F1, 0)).toEqual({ x: 10, y: 10, mode: "stairs", toFloorId: B1F });
  });
  it("ignores same-floor stairs, escalators and gates", () => {
    const points = [point(0, 0, B1F, -1), point(10, 0, B1F, 0), point(20, 0, B1F, 1), point(20, 0, F1, 2)];
    const steps = [step(B1F, B1F, "stairs"), step(B1F, B1F, "escalator"), step(B1F, F1, "elevator")];
    expect(nextFloorChange(points, steps, B1F, 0)).toEqual({ x: 20, y: 0, mode: "elevator", toFloorId: F1 });
  });
  it("uses the route's start point when the very first step leaves the floor", () => {
    const points = [point(3, 4, B1F, -1), point(3, 4, F1, 0)];
    expect(nextFloorChange(points, [step(B1F, F1, "ramp")], B1F, 0)).toEqual({ x: 3, y: 4, mode: "ramp", toFloorId: F1 });
  });
  it("returns null when the route never leaves the floor", () => {
    expect(nextFloorChange(zigzag, [step(B1F, B1F)], B1F, 0)).toBeNull();
    expect(nextFloorChange(zigzag, zigzagSteps, "missing", 0)).toBeNull();
    expect(nextFloorChange([], [], B1F, 0)).toBeNull();
  });
  it("does not point back at a connector already walked past on a revisited floor", () => {
    // Back on B1F at segment 4, the next change is the later one at (20, 10).
    expect(nextFloorChange(zigzag, zigzagSteps, B1F, 4)).toEqual({ x: 20, y: 10, mode: "escalator", toFloorId: F1 });
    expect(nextFloorChange(zigzag, zigzagSteps, B1F, 6)).toBeNull();
  });
  it("keeps the current cross-floor step selected until the floor actually changes", () => {
    // Segments 0 and 1 are on the floor before the stairs step; segment 2 has crossed it.
    expect(nextFloorChange(zigzag, zigzagSteps, B1F, 0)?.toFloorId).toBe(F1);
    expect(nextFloorChange(zigzag, zigzagSteps, B1F, 1)?.toFloorId).toBe(F1);
    // Past it, the hint moves on to the later escalator rather than disappearing.
    expect(nextFloorChange(zigzag, zigzagSteps, B1F, 2)?.mode).toBe("escalator");
  });
});

describe("segment route progress", () => {
  /** B1F out → up to 1F → back down over the same coordinates → on to the escalator. */
  const loop: PolylinePoint[] = [
    point(0, 0, B1F, -1),
    point(10, 0, B1F, 0),
    point(10, 0, F1, 1),
    point(10, 10, F1, 2),
    point(10, 10, B1F, 3),
    point(10, 0, B1F, 4), // the return leg passes over (10, 0) again
    point(20, 0, B1F, 5),
    point(20, 0, F1, 6),
  ];
  const loopSteps: RouteStep[] = [
    step(B1F, B1F), step(B1F, F1, "stairs"), step(F1, F1),
    step(F1, B1F, "stairs"), step(B1F, B1F), step(B1F, B1F), step(B1F, F1, "escalator"),
  ];
  const progress = (floorId: string, east: number, north: number, seg: number, floorChanged = false) =>
    advanceRouteSeg(loop, loopSteps, floorId, east, north, seg, floorChanged);

  it("stays forward over a revisited coordinate and keeps the hint on the right connector", () => {
    // Outbound on B1F: segment 0 stays selected, so the first stairs remain the hint.
    expect(progress(B1F, 0, 0, 0)).toBe(0);
    expect(progress(B1F, 10, 0, 0)).toBe(0);
    expect(nextFloorChange(loop, loopSteps, B1F, 0)).toEqual({ x: 10, y: 0, mode: "stairs", toFloorId: F1 });
    // Only the floor change may cross the stairs step.
    expect(progress(F1, 10, 0, 0, true)).toBe(2);
    expect(progress(F1, 10, 10, 2)).toBe(2);
    expect(nextFloorChange(loop, loopSteps, F1, 2)?.toFloorId).toBe(B1F);
    // Back on B1F, progress jumps past the down-stairs to the return leg.
    expect(progress(B1F, 10, 10, 2, true)).toBe(4);
    // The same coordinates as the outbound leg keep the later segment: no first-stairs hint again.
    expect(progress(B1F, 10, 0, 4)).toBe(4);
    expect(nextFloorChange(loop, loopSteps, B1F, 4)).toEqual({ x: 20, y: 0, mode: "escalator", toFloorId: F1 });
    expect(progress(B1F, 20, 0, 4)).toBe(5);
    expect(nextFloorChange(loop, loopSteps, B1F, 5)?.mode).toBe("escalator");
  });

  it("does not fall back to an earlier vertex when a long segment passes 1.4 m from it", () => {
    const longLeg = [
      point(0, 0, B1F, -1),
      point(100, 0, B1F, 0),
      point(100, 50, B1F, 1),
      point(0, 1.4, B1F, 2),
      point(0, 10, B1F, 3),
    ];
    const longSteps = [step(B1F, B1F), step(B1F, B1F), step(B1F, B1F), step(B1F, B1F)];
    const segAt = (east: number, north: number, seg: number) => advanceRouteSeg(longLeg, longSteps, B1F, east, north, seg, false);
    // The return leg passes 1.4 m from the start vertex; the covered segment itself is the match.
    expect(segAt(0, 1.4, 2)).toBe(2);
    expect(segAt(0, 0, 2)).toBe(2);
    expect(segAt(50, 0, 0)).toBe(0);
  });

  it("holds progress while more than 3 m off the route and resumes when back on it", () => {
    const straight = [point(0, 0, B1F, -1), point(100, 0, B1F, 0), point(100, 100, B1F, 1)];
    const straightSteps = [step(B1F, B1F), step(B1F, B1F)];
    const segAt = (east: number, north: number, seg: number) => advanceRouteSeg(straight, straightSteps, B1F, east, north, seg, false);
    expect(segAt(50, 10, 0)).toBe(0);
    expect(segAt(50, 0, 0)).toBe(0);
    expect(segAt(100, 50, 0)).toBe(1);
    expect(segAt(90, 10, 1)).toBe(1);
  });

  it("does not move onto a floor the route never reaches, and survives an empty route", () => {
    expect(advanceRouteSeg(loop, loopSteps, "attic", 10, 0, 0, true)).toBe(0);
    expect(advanceRouteSeg([], [], B1F, 0, 0, 4, true)).toBe(0);
  });
});

describe("rim bearing", () => {
  const radius = 93;
  it("measures screen bearings with 0 up and clockwise", () => {
    expect(rimBearing({ x: 0, y: -50 }, radius).angleDeg).toBeCloseTo(0);
    expect(rimBearing({ x: 50, y: -50 }, radius).angleDeg).toBeCloseTo(45);
    expect(rimBearing({ x: 50, y: 0 }, radius).angleDeg).toBeCloseTo(90);
    expect(rimBearing({ x: 0, y: 50 }, radius).angleDeg).toBeCloseTo(180);
    expect(rimBearing({ x: -50, y: 0 }, radius).angleDeg).toBeCloseTo(270);
  });
  it("keeps a margin inside the rim and reports outside points", () => {
    expect(rimBearing({ x: 0, y: -50 }, radius).inside).toBe(true);
    expect(rimBearing({ x: 0, y: -(radius - 8) }, radius).inside).toBe(true);
    expect(rimBearing({ x: 0, y: -(radius - 7) }, radius).inside).toBe(false);
    expect(rimBearing({ x: 100, y: 0 }, radius).inside).toBe(false);
    expect(rimBearing({ x: 0, y: 0 }, radius)).toEqual({ inside: true, angleDeg: 0 });
  });
});

describe("floor POIs by evidence", () => {
  const poi = (over: Partial<Poi>): Poi => ({ ...createSyntheticBundle().pois[0]!, ...over });
  it("keeps only POIs with a position, the current floor and a verified connector", () => {
    const bundle = createSyntheticBundle();
    bundle.pois = [
      poi({ id: "ok", floorId: "concourse", displayPosition: { x: 1, y: 2, z: 0 }, connectorNodeIds: ["a"] }),
      poi({ id: "search-only", floorId: "concourse", displayPosition: { x: 1, y: 2, z: 0 }, connectorNodeIds: [] }),
      poi({ id: "no-position", floorId: "concourse", displayPosition: null, connectorNodeIds: ["a"] }),
      poi({ id: "other-floor", floorId: "upper", displayPosition: { x: 10, y: 0, z: 4 }, connectorNodeIds: ["upper"] }),
      poi({ id: "null-floor", floorId: null, displayPosition: { x: 1, y: 2, z: 0 }, connectorNodeIds: ["a"] }),
    ];
    expect(floorPois(bundle, "concourse").map((p) => p.id)).toEqual(["ok"]);
    expect(floorPois(bundle, "upper").map((p) => p.id)).toEqual(["other-floor"]);
    expect(floorPois(bundle, "missing")).toEqual([]);
  });
  it("applies the rule to the synthetic fixture's own POIs", () => {
    expect(floorPois(createSyntheticBundle(), "concourse").map((p) => p.id)).toEqual(["toilet", "exit-a1"]);
    // The shop has a position but no connector: search-only, so it never gets a dot.
    expect(floorPois(createSyntheticBundle(), "upper")).toEqual([]);
  });
});
