import { describe, expect, it } from "vitest";
import { validateBundle } from "@gteki/schema";
import type { Edge, EdgeMode, StationBundle } from "@gteki/schema";
import { createRouter, DEFAULT_PROFILE } from "./index.ts";
import type { RouteProfile, RouteResult, Router } from "./index.ts";
import { createSyntheticBundle, syntheticEdge as edge, syntheticEvidence } from "./fixtures.ts";

const unpaid: RouteProfile = { fare: "unpaid_only", stepFree: false };
const stepFree: RouteProfile = { fare: "ticketed", stepFree: true };

function checked(bundle: StationBundle): StationBundle {
  expect(validateBundle(bundle).filter((issue) => issue.level === "error")).toEqual([]);
  return bundle;
}

function routerFor(edges?: Edge[]): Router {
  return createRouter(checked(createSyntheticBundle(edges)));
}

function success(result: ReturnType<Router["route"]>): RouteResult {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result;
}

function noPath(router: Router, from = "start", to: string | string[] = "goal", profile?: RouteProfile): void {
  expect(router.route(from, to, profile)).toMatchObject({ ok: false, reason: "no_path" });
}

describe("synthetic fixtures", () => {
  it("validates fresh fixtures and explicitly labels every edge synthetic", () => {
    const first = checked(createSyntheticBundle());
    const second = checked(createSyntheticBundle());
    expect(first.station.synthetic).toBe(true);
    expect(first.edges.every((e) => e.verification === "synthetic")).toBe(true);
    first.edges[0]!.closed = true;
    expect(second.edges[0]!.closed).toBe(false);
  });
});

describe("directed Dijkstra routing", () => {
  it("finds the shortest valid path and reports its physical distance", () => {
    const route = success(routerFor().route("start", "goal"));
    expect(route.nodeIds).toEqual(["start", "a", "goal"]);
    expect(route.steps.map((step) => step.edgeId)).toEqual(["start-a", "a-goal"]);
    expect(route.totalLengthM).toBe(20);
    expect(route.estimatedSeconds).toBeCloseTo(20 / 1.2);
    expect(route.floorChanges).toBe(0);
    expect(route.crossesFareBoundary).toBe(false);
    expect(route.unknowns).toEqual([]);
  });

  it("updates queued distances when a cheaper path reaches an already queued node", () => {
    const router = routerFor([
      edge("start-a", "start", "a", { lengthM: 9 }),
      edge("start-b", "start", "b", { lengthM: 1 }),
      edge("b-a", "b", "a", { lengthM: 1 }),
      edge("a-goal", "a", "goal", { lengthM: 1 }),
      edge("b-goal", "b", "goal", { lengthM: 10 }),
    ]);
    expect(success(router.route("start", "goal")).nodeIds).toEqual(["start", "b", "a", "goal"]);
  });

  it("fails when there is no connected path", () => {
    noPath(routerFor(), "start", "isolated");
    noPath(routerFor([]));
  });

  it("returns unknown_start before evaluating goals", () => {
    expect(routerFor().route("missing", "also-missing")).toMatchObject({ ok: false, reason: "unknown_start" });
  });

  it.each(["missing", ["missing", "also-missing"], []])("rejects an entirely unknown goal set: %j", (goals) => {
    expect(routerFor().route("start", goals)).toMatchObject({ ok: false, reason: "unknown_goal" });
  });

  it.each(["start", ["missing", "start", "goal"]])("reports start_equals_goal: %j", (goals) => {
    expect(routerFor().route("start", goals)).toMatchObject({ ok: false, reason: "start_equals_goal" });
  });

  it("uses a bidirectional edge in reverse and reports traversal endpoints", () => {
    const route = success(routerFor([edge("link", "start", "goal")]).route("goal", "start"));
    expect(route.nodeIds).toEqual(["goal", "start"]);
    expect(route.steps[0]).toMatchObject({ edgeId: "link", fromNodeId: "goal", toNodeId: "start", reversed: true });
  });

  it.each<EdgeMode>(["walk", "escalator"])("blocks wrong-way traversal of a forward %s edge", (mode) => {
    const router = routerFor([edge("one-way", "start", "goal", { direction: "forward", mode })]);
    expect(success(router.route("start", "goal")).steps[0]!.reversed).toBe(false);
    noPath(router, "goal", "start");
  });

  it("chooses the nearest reachable known goal regardless of request order", () => {
    const router = routerFor();
    expect(success(router.route("start", ["missing", "goal", "a"])).nodeIds).toEqual(["start", "a"]);
    noPath(router, "start", ["missing", "isolated"]);
  });

  it("breaks equal-cost goal ties by node id", () => {
    const router = routerFor([edge("to-b", "start", "b"), edge("to-a", "start", "a")]);
    expect(success(router.route("start", ["b", "a"])).nodeIds).toEqual(["start", "a"]);
  });

  it("handles zero-length cycles without changing predecessors into loops", () => {
    const router = routerFor([
      edge("start-b", "start", "b", { lengthM: 0 }),
      edge("b-a", "b", "a", { lengthM: 0 }),
      edge("a-start", "a", "start", { lengthM: 0 }),
      edge("a-goal", "a", "goal", { lengthM: 1 }),
    ]);
    const route = success(router.route("start", "goal"));
    expect(route.totalLengthM).toBe(1);
    expect(new Set(route.nodeIds).size).toBe(route.nodeIds.length);
  });

  it("produces identical results across queries and input order, including parallel edges", () => {
    const edges = [
      edge("z-start-a", "start", "a"), edge("a-start-a", "start", "a"),
      edge("a-goal", "a", "goal"), edge("start-b", "start", "b"), edge("b-goal", "b", "goal"),
    ];
    const expected = success(routerFor(edges).route("start", "goal"));
    expect(expected.steps.map((step) => step.edgeId)).toEqual(["a-start-a", "a-goal"]);
    for (let i = 0; i < edges.length; i++) {
      const bundle = createSyntheticBundle([...edges.slice(i), ...edges.slice(0, i)].reverse());
      bundle.nodes.reverse();
      const router = createRouter(checked(bundle));
      expect(router.route("start", "goal")).toEqual(expected);
      expect(router.route("start", "goal")).toEqual(expected);
    }
  });
});

describe("access and verification rules", () => {
  it("refuses a paid gate for unpaid_only and permits it for a ticketed traveller", () => {
    const gate = edge("gate", "start", "goal", { mode: "gate", paid: true, crossesFareBoundary: true });
    const router = routerFor([gate]);
    noPath(router, "start", "goal", unpaid);
    expect(router.isTraversable(gate, unpaid)).toBe(false);
    expect(success(router.route("start", "goal")).crossesFareBoundary).toBe(true);
    expect(router.isTraversable(gate, DEFAULT_PROFILE)).toBe(true);
  });

  it.each([
    { paid: null, crossesFareBoundary: false },
    { paid: false, crossesFareBoundary: null },
    { paid: true, crossesFareBoundary: false },
  ])("unpaid_only excludes paid/unknown fare facts: %j", (facts) => {
    const router = routerFor([edge("link", "start", "goal", facts)]);
    noPath(router, "start", "goal", unpaid);
    expect(success(router.route("start", "goal")).ok).toBe(true);
  });

  it("blocks an explicitly closed edge", () => {
    const closed = edge("closed", "start", "goal", { closed: true });
    const router = routerFor([closed]);
    expect(router.isTraversable(closed, DEFAULT_PROFILE)).toBe(false);
    noPath(router);
  });

  it("applies extra closures only to the current query", () => {
    const link = edge("link", "start", "goal");
    const router = routerFor([link]);
    const profile = { ...DEFAULT_PROFILE, extraClosedEdgeIds: ["link"] };
    noPath(router, "start", "goal", profile);
    expect(router.isTraversable(link, profile)).toBe(false);
    expect(success(router.route("start", "goal")).ok).toBe(true);
    expect(link.closed).toBe(false);
  });

  it.each<EdgeMode>(["walk", "gate", "ramp", "moving_walkway", "stairs", "escalator", "elevator"])("avoids the %s mode", (mode) => {
    const link = edge("link", "start", "goal", { mode });
    const router = routerFor([link]);
    const profile = { ...DEFAULT_PROFILE, avoidModes: [mode] };
    expect(router.isTraversable(link, profile)).toBe(false);
    noPath(router, "start", "goal", profile);
    expect(success(router.route("start", "goal")).ok).toBe(true);
  });

  it("chooses a step-free detour over stairs and unknown-wheelchair shortcuts", () => {
    const router = routerFor([
      edge("stairs", "start", "upper", { mode: "stairs", lengthM: 5, wheelchair: false, steps: true }),
      edge("unknown-wheelchair", "start", "upper", { mode: "ramp", lengthM: 1, wheelchair: null }),
      edge("walk-to-ramp", "start", "b"),
      edge("ramp", "b", "upper", { mode: "ramp" }),
    ]);
    expect(success(router.route("start", "upper", stepFree)).steps.map((step) => step.edgeId)).toEqual(["walk-to-ramp", "ramp"]);
  });

  it("fails step-free routing when stairs are the only connection", () => {
    const router = routerFor([edge("stairs", "start", "upper", { mode: "stairs", wheelchair: false, steps: true })]);
    noPath(router, "start", "upper", stepFree);
    expect(success(router.route("start", "upper")).ok).toBe(true);
  });

  it.each([{ wheelchair: null }, { wheelchair: false }, { steps: true }])("fails closed on step-free constraints: %j", (facts) => {
    const link = edge("link", "start", "goal", facts);
    const router = routerFor([link]);
    expect(router.isTraversable(link, stepFree)).toBe(false);
    noPath(router, "start", "goal", stepFree);
  });

  it("allows and reports unknown steps when wheelchair access is explicitly true", () => {
    const route = success(routerFor([edge("link", "start", "goal", { steps: null })]).route("start", "goal", stepFree));
    expect(route.unknowns).toEqual([{ kind: "steps", edgeIds: ["link"] }]);
  });

  it.each<Edge["verification"]>(["unverified", "geometry_only"])("never uses %s edges, even in synthetic bundles", (verification) => {
    const shortcut = edge("shortcut", "start", "goal", { verification, lengthM: 1 });
    const router = routerFor([shortcut, edge("detour-1", "start", "a"), edge("detour-2", "a", "goal")]);
    expect(router.isTraversable(shortcut, DEFAULT_PROFILE)).toBe(false);
    expect(success(router.route("start", "goal")).totalLengthM).toBe(20);
    noPath(routerFor([shortcut]));
  });

  it("rejects synthetic edges when the station is not synthetic", () => {
    const bundle = checked(createSyntheticBundle([edge("link", "start", "goal")]));
    bundle.station.synthetic = false; // Deliberately invalid input exercises the runtime safety boundary.
    expect(validateBundle(bundle).filter((issue) => issue.level === "error").map((issue) => issue.code)).toEqual(["edge.synthetic"]);
    const router = createRouter(bundle);
    expect(router.isTraversable(bundle.edges[0]!, DEFAULT_PROFILE)).toBe(false);
    noPath(router);
  });

  it("accepts verified edges in a non-synthetic bundle", () => {
    const bundle = createSyntheticBundle([edge("link", "start", "goal", { verification: "verified" })]);
    bundle.station.synthetic = false;
    expect(success(createRouter(checked(bundle)).route("start", "goal")).ok).toBe(true);
  });
});

describe("route facts and provenance", () => {
  it("counts each floor-changing step, including reversed traversal", () => {
    const router = routerFor([
      edge("walk", "start", "a"), edge("up", "a", "upper", { mode: "ramp" }),
      edge("upstairs-walk", "upper", "upper-2"), edge("down", "upper-2", "goal", { mode: "ramp" }),
    ]);
    expect(success(router.route("start", "goal")).floorChanges).toBe(2);
    const reverse = success(router.route("upper-2", "start"));
    expect(reverse.floorChanges).toBe(1);
    expect(reverse.steps[1]).toMatchObject({ fromFloorId: "upper", toFloorId: "concourse", reversed: true });
  });

  it("requires explicit cross-operator links despite matching floor labels and elevations", () => {
    noPath(routerFor(), "start", "other");
    const router = routerFor([edge("transfer", "start", "other")]);
    expect(success(router.route("start", "other")).floorChanges).toBe(1);
  });

  it("groups unknown facts by kind using only edges on the chosen route", () => {
    const router = routerFor([
      edge("unknown-1", "start", "a", { hours: null, paid: null, wheelchair: null, steps: null, accessEvidence: null }),
      edge("unknown-2", "a", "goal", { hours: null, paid: null }),
      edge("off-route", "start", "isolated", { hours: null, paid: null, wheelchair: null, steps: null, accessEvidence: null }),
    ]);
    expect(success(router.route("start", "goal")).unknowns).toEqual([
      { kind: "hours", edgeIds: ["unknown-1", "unknown-2"] },
      { kind: "paid", edgeIds: ["unknown-1", "unknown-2"] },
      { kind: "wheelchair", edgeIds: ["unknown-1"] },
      { kind: "steps", edgeIds: ["unknown-1"] },
      { kind: "access_evidence", edgeIds: ["unknown-1"] },
    ]);
  });

  it("sorts and deduplicates route evidence sources and returns the latest checked date", () => {
    const router = routerFor([
      edge("first", "start", "a", {
        geometryEvidence: { ...syntheticEvidence(), sourceIds: ["fixture-geometry", "fixture-access"], checkedDate: "2020-01-01" },
        accessEvidence: syntheticEvidence("fixture-access", "2024-03-02"),
      }),
      edge("second", "a", "goal", {
        geometryEvidence: syntheticEvidence("fixture-geometry", "2026-01-01"),
        accessEvidence: null,
        hours: { kind: "always", evidence: syntheticEvidence("fixture-access", "2026-10-20") },
      }),
    ]);
    const route = success(router.route("start", "goal"));
    expect(route.sourceIds).toEqual(["fixture-access", "fixture-geometry"]);
    expect(route.evidenceCheckedDate).toBe("2026-01-01");
  });

  it("preserves old evidence dates rather than presenting them as current", () => {
    const route = success(routerFor([edge("old", "start", "goal", {
      geometryEvidence: syntheticEvidence("fixture-geometry", "2010-01-01"), accessEvidence: null,
    })]).route("start", "goal"));
    expect(route.evidenceCheckedDate).toBe("2010-01-01");
  });
});

describe("length, cost and time", () => {
  it("penalises stairs for path selection without changing reported metres", () => {
    const stairs = edge("stairs", "start", "goal", { mode: "stairs", lengthM: 6, steps: true, wheelchair: false });
    const route = success(routerFor([stairs, edge("walk", "start", "goal", { lengthM: 8 })]).route("start", "goal"));
    expect(route.steps[0]!.edgeId).toBe("walk");
    const stairsOnly = success(routerFor([stairs]).route("start", "goal"));
    expect(stairsOnly.totalLengthM).toBe(6);
    expect(stairsOnly.estimatedSeconds).toBe(12);
  });

  it("uses unmultiplied escalator distance for cost rather than its slower time estimate", () => {
    const route = success(routerFor([
      edge("escalator", "start", "goal", { mode: "escalator", lengthM: 5 }),
      edge("walk", "start", "goal", { lengthM: 6 }),
    ]).route("start", "goal"));
    expect(route.steps[0]!.edgeId).toBe("escalator");
    expect(route.estimatedSeconds).toBeCloseTo(5 / 0.75);
  });

  it.each<[EdgeMode, number]>([
    ["walk", 10], ["gate", 10], ["ramp", 10], ["moving_walkway", 10],
    ["stairs", 24], ["escalator", 16], ["elevator", 45],
  ])("estimates %s traversal time", (mode, seconds) => {
    const route = success(routerFor([edge("link", "start", "goal", { mode, lengthM: 12 })]).route("start", "goal"));
    expect(route.totalLengthM).toBe(12);
    expect(route.estimatedSeconds).toBe(seconds);
  });

  it("handles null-length elevators using geometry for distance and fixed ride time", () => {
    const lift = edge("lift", "start", "upper", {
      mode: "elevator", lengthM: null, geometry: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 4 }],
    });
    const router = routerFor([lift]);
    expect(router.isTraversable(lift, stepFree)).toBe(true);
    const route = success(router.route("start", "upper", stepFree));
    expect(route.estimatedSeconds).toBe(45);
    expect(route.totalLengthM).toBeCloseTo(Math.hypot(10, 4));
    expect(route.unknowns).toEqual([]);
  });

  it.each<[number | null, number, string]>([
    [null, 53, "walk"], [null, 55, "lift"], [1000, 55, "lift"],
  ])("charges 54 equivalent metres per elevator ride (length %s, walk %s)", (lengthM, walkLength, winner) => {
    const route = success(routerFor([
      edge("lift", "start", "goal", {
        mode: "elevator", lengthM, geometry: [{ x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }],
      }),
      edge("walk", "start", "goal", { lengthM: walkLength }),
    ]).route("start", "goal"));
    expect(route.steps[0]!.edgeId).toBe(winner);
    expect(route.totalLengthM).toBe(winner === "walk" ? walkLength : lengthM ?? 20);
  });

  it("excludes a null-length elevator without geometry under the fail-closed rule", () => {
    const lift = edge("unmeasured-lift", "start", "upper", { mode: "elevator", lengthM: null });
    const router = routerFor([lift]);
    expect(router.isTraversable(lift, DEFAULT_PROFILE)).toBe(false);
    noPath(router, "start", "upper");
  });

  it.each([undefined, [], [{ x: 0, y: 0, z: 0 }]])("excludes null-length non-elevator edges without a usable polyline: %j", (geometry) => {
    const missing = edge("missing-length", "start", "goal", { lengthM: null, geometry });
    const router = routerFor([missing]);
    expect(router.isTraversable(missing, DEFAULT_PROFILE)).toBe(false);
    noPath(router);
  });

  it("uses all geometry segments and falls back to 2D where segment height is unknown", () => {
    const route = success(routerFor([edge("polyline", "start", "goal", {
      lengthM: null, geometry: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 10, z: null }, { x: 20, y: 0, z: 0 }],
    })]).route("start", "goal"));
    expect(route.totalLengthM).toBeCloseTo(10 + Math.hypot(20, 10));
    expect(route.unknowns).toEqual([]);
  });

  it("includes vertical distance when both segment endpoints have known heights", () => {
    const route = success(routerFor([edge("polyline", "start", "upper", {
      mode: "ramp", lengthM: null, geometry: [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 2 }, { x: 10, y: 0, z: 4 }],
    })]).route("start", "upper"));
    expect(route.totalLengthM).toBeCloseTo(Math.hypot(10, 4));
    expect(route.estimatedSeconds).toBeCloseTo(Math.hypot(10, 4) / 1.2);
  });

  it("prefers an explicit length over geometry", () => {
    const route = success(routerFor([edge("measured", "start", "goal", {
      lengthM: 25, geometry: [{ x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }],
    })]).route("start", "goal"));
    expect(route.totalLengthM).toBe(25);
  });
});
