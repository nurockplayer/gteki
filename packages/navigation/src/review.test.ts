import { describe, expect, it } from "vitest";
import { isOpenAt } from "@gteki/schema";
import { createRouter, describeRoute, instructionPoints, routePolyline } from "./index.ts";
import type { RouteProfile, RouteResult } from "./index.ts";
import { createSyntheticBundle, syntheticEdge as edge } from "./fixtures.ts";

/** Regressions from the independent read-only review of the shared core. */
const base: RouteProfile = { fare: "ticketed", stepFree: false };

function ok(r: ReturnType<ReturnType<typeof createRouter>["route"]>): RouteResult {
  if (!r.ok) throw new Error(r.message);
  return r;
}

describe("symbolic polyline heights never affect routing", () => {
  it("measures symbolic polylines in plan, so a display-only z cannot change the chosen route", () => {
    const mk = (z: number) => createSyntheticBundle([
      edge("direct", "start", "goal", { lengthM: null, geometryZ: "symbolic", geometry: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z }, { x: 20, y: 0, z: 0 }] }),
      edge("d1", "start", "b", { lengthM: 15 }),
      edge("d2", "b", "goal", { lengthM: 15 }),
    ]);
    for (const z of [0, 100]) {
      const r = ok(createRouter(mk(z)).route("start", "goal", base));
      expect(r.steps.map((s) => s.edgeId)).toEqual(["direct"]);
      expect(r.totalLengthM).toBeCloseTo(20);
    }
  });
});

describe("fare boundary stays tri-state", () => {
  it("reports an UNKNOWN crossing instead of false", () => {
    const r = ok(createRouter(createSyntheticBundle([edge("x", "start", "goal", { paid: false, crossesFareBoundary: null })])).route("start", "goal", base));
    expect(r.crossesFareBoundary).toBeNull();
    expect(r.unknowns).toContainEqual({ kind: "fare_boundary", edgeIds: ["x"] });
  });

  it("a known crossing wins over unknown ones", () => {
    const r = ok(createRouter(createSyntheticBundle([
      edge("u", "start", "a", { crossesFareBoundary: null }),
      edge("g", "a", "goal", { mode: "gate", crossesFareBoundary: true, paid: null }),
    ])).route("start", "goal", base));
    expect(r.crossesFareBoundary).toBe(true);
  });
});

describe("freshness with undated sources", () => {
  it("keeps freshness UNKNOWN when any dependency is undated, unless dated evidence already proves staleness", () => {
    const b = createSyntheticBundle();
    b.sources.find((s) => s.id === "fixture-access")!.datasetDate = "2026-09-17";
    const fresh = ok(createRouter(b).route("start", "goal", { ...base, today: "2026-10-20" }));
    expect(fresh.undatedSourceIds).toEqual(["fixture-geometry"]);
    expect(fresh.stale).toBeNull();
    b.sources.find((s) => s.id === "fixture-access")!.datasetDate = "2019-01-01";
    expect(ok(createRouter(b).route("start", "goal", { ...base, today: "2026-10-20" })).stale).toBe(true);
  });
});

describe("vertical instructions never invent direction", () => {
  it("does not merge a known 'up' segment with a direction-unknown one", () => {
    const b = createSyntheticBundle([
      edge("s-a", "start", "a"),
      edge("st1", "a", "upper", { mode: "stairs" }),
      edge("st2", "upper", "other", { mode: "stairs" }),
    ]);
    b.nodes.find((n) => n.id === "other")!.position.z = null;
    b.floors.find((f) => f.id === "other-concourse")!.elevationM = null;
    const ins = describeRoute(b, ok(createRouter(b).route("start", "other", base)), "en").filter((i) => i.kind === "stairs");
    expect(ins.map((i) => i.vertical)).toEqual(["up", null]);
    expect(ins[1]!.text).not.toMatch(/\bup\b|\bdown\b/);
  });
});

describe("vertical instructions on one floor", () => {
  it("names no destination floor when the stair chain starts and ends on the same floor", () => {
    const b = createSyntheticBundle([edge("s-a", "start", "a"), edge("st", "a", "b", { mode: "stairs" })]);
    b.nodes.find((n) => n.id === "b")!.position = { x: 20, y: 0, z: -2 }; // straight on: no turn to name
    const r = ok(createRouter(b).route("start", "b", base));
    expect(describeRoute(b, r, "en").find((i) => i.kind === "stairs")!.text).toBe("Take the stairs down");
    expect(describeRoute(b, r, "ja").find((i) => i.kind === "stairs")!.text).toBe("階段で下へ");
  });
});

describe("second review round", () => {
  it("never measures a sloped edge with symbolic heights and no stated length as 0 m", () => {
    const b = createSyntheticBundle([
      edge("s-a", "start", "a"),
      edge("st", "a", "upper", { mode: "stairs", lengthM: null, geometryZ: "symbolic", geometry: [{ x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 4 }] }),
    ]);
    const r = createRouter(b).route("start", "upper", base);
    expect(r.ok).toBe(false);
    b.edges[1]!.lengthM = 6;
    expect(ok(createRouter(b).route("start", "upper", base)).totalLengthM).toBeCloseTo(16);
  });

  it("counts hours evidence as a freshness dependency", () => {
    const b = createSyntheticBundle([edge("x", "start", "goal", { hours: { kind: "window", open: "05:00", close: "24:00", evidence: { sourceIds: ["hours-src"], method: "source-attribute:hours", checkedDate: "2026-10-20" } } })]);
    for (const s of b.sources) s.datasetDate = "2026-09-17";
    b.sources.push({ ...b.sources[0]!, id: "hours-src", datasetDate: null });
    const r = ok(createRouter(b).route("start", "goal", { ...base, today: "2026-10-20" }));
    expect(r.undatedSourceIds).toEqual(["hours-src"]);
    expect(r.stale).toBeNull();
  });
});

describe("third review round", () => {
  it("refuses a sloped edge whose stated-length fallback geometry has unknown heights (never 0 m)", () => {
    const b = createSyntheticBundle([
      edge("s-a", "start", "a"),
      edge("st", "a", "upper", { mode: "stairs", lengthM: null, geometry: [{ x: 10, y: 0, z: null }, { x: 12, y: 0, z: null }, { x: 10, y: 0, z: null }] }),
    ]);
    // An interior height is unknown: the climb along the flight can't be measured.
    expect(createRouter(b).route("start", "upper", base).ok).toBe(false);
    // Endpoints take their nodes' known heights (as drawn), so a straight flight is measured node to node.
    b.edges[1]!.geometry = [{ x: 10, y: 0, z: null }, { x: 10, y: 0, z: null }];
    expect(ok(createRouter(b).route("start", "upper", base)).steps[1]!.lengthM).toBeCloseTo(4);
    // Endpoints on their nodes (a at x=10 z=0, upper at x=10 z=4): a 3-4-5 flight, then 3 m back along the landing.
    b.edges[1]!.geometry = [{ x: 10, y: 0, z: 0 }, { x: 13, y: 0, z: 4 }, { x: 10, y: 0, z: 4 }];
    expect(ok(createRouter(b).route("start", "upper", base)).steps[1]!.lengthM).toBeCloseTo(8);
  });

  it("counts a lift ride as time, not walking length", () => {
    const b = createSyntheticBundle([
      edge("s-a", "start", "a"),
      edge("lift", "a", "upper", { mode: "elevator", lengthM: null, geometry: [{ x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 4 }] }),
    ]);
    const r = ok(createRouter(b).route("start", "upper", base));
    expect(r.steps[1]!.lengthM).toBe(0);
    expect(r.estimatedSeconds).toBeGreaterThanOrEqual(45);
  });
});

describe("turn narration robustness (Ikebukuro lane observations)", () => {
  it("measures headings over ~5 m, so a short snapping hook does not turn a right turn into 'Turn back'", () => {
    // Walk east 20 m to node a, but the polyline ends in a 1.5 m hook pointing west; then go south.
    const b = createSyntheticBundle([
      edge("in", "start", "a", { lengthM: null, geometry: [{ x: 0, y: 0, z: 0 }, { x: 11.5, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }] }),
      edge("out", "a", "b", { lengthM: null, geometry: [{ x: 10, y: 0, z: 0 }, { x: 10, y: -10, z: 0 }] }),
    ]);
    b.nodes.find((n) => n.id === "b")!.position = { x: 10, y: -10, z: 0 };
    const kinds = describeRoute(b, ok(createRouter(b).route("start", "b", base)), "en").map((i) => i.kind);
    expect(kinds).toContain("turn_right");
    expect(kinds).not.toContain("u_turn");
  });

  it("does not merge two flights across a real turn and names the turn", () => {
    // Flight 1 heads east (a → upper); flight 2 turns left (north) to upper-2' on the same floor.
    const b = createSyntheticBundle([
      edge("s-a", "start", "a"),
      edge("f1", "a", "upper", { mode: "stairs" }),
      edge("f2", "upper", "upper-2", { mode: "stairs", lengthM: null, geometry: [{ x: 10, y: 0, z: 4 }, { x: 10, y: 8, z: 4 }] }),
    ]);
    b.nodes.find((n) => n.id === "a")!.position = { x: 0, y: 0, z: 0 };
    b.nodes.find((n) => n.id === "upper-2")!.position = { x: 10, y: 8, z: 4 };
    b.edges[0] = edge("s-a", "start", "a", { lengthM: 1, geometry: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }] });
    b.nodes.find((n) => n.id === "start")!.position = { x: -1, y: 0, z: 0 };
    const stairs = describeRoute(b, ok(createRouter(b).route("start", "upper-2", base)), "en").filter((i) => i.kind === "stairs");
    expect(stairs).toHaveLength(2);
    // The second flight follows straight on from the first: a continuation, with its turn still named.
    expect(stairs[1]!.text).toBe("Turn left, then continue on the stairs");
    expect(describeRoute(b, ok(createRouter(b).route("start", "upper-2", base)), "ja").filter((i) => i.kind === "stairs")[1]!.text).toBe("左へ曲がり、引き続き階段を進む");
  });
});

describe("fourth review round", () => {
  it("interpolates the 5 m heading chord, so a long sparse segment cannot invent a turn", () => {
    const mk = (incoming: { x: number; y: number; z: number }[]) => {
      const b = createSyntheticBundle([
        edge("in", "start", "a", { lengthM: null, geometry: incoming }),
        edge("st", "a", "goal", { mode: "stairs", lengthM: null, geometry: [{ x: 4, y: 0, z: 0 }, { x: 14, y: 0, z: -2 }] }),
      ]);
      b.nodes.find((n) => n.id === "start")!.position = { x: 0, y: -100, z: 0 };
      b.nodes.find((n) => n.id === "a")!.position = { x: 4, y: 0, z: 0 };
      b.nodes.find((n) => n.id === "goal")!.position = { x: 14, y: 0, z: -2 };
      return describeRoute(b, ok(createRouter(b).route("start", "goal", base)), "en").map((i) => i.text);
    };
    const sparse = mk([{ x: 0, y: -100, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }]);
    const dense = mk([{ x: 0, y: -100, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }]);
    expect(sparse).toEqual(dense);
    expect(sparse.join(" / ")).not.toMatch(/Turn right, then/);
  });
});

describe("multi-origin routing (PR #15 Codex review)", () => {
  it("ranks alternate starts by the router's cost, not walking length", () => {
    const router = createRouter(createSyntheticBundle([
      edge("stair", "start", "goal", { mode: "stairs", lengthM: 6 }),
      edge("walk", "b", "goal", { lengthM: 8 }),
    ]));
    const r = ok(router.route(["start", "b"], "goal", base));
    expect(r.nodeIds).toEqual(["b", "goal"]);
    expect(r.steps.map((s) => s.edgeId)).toEqual(["walk"]);
  });

  it("keeps 'already at the destination' when one start is a goal and another has a path", () => {
    const router = createRouter(createSyntheticBundle([edge("walk", "start", "goal", { lengthM: 8 })]));
    expect(router.route(["start", "goal"], "goal", base)).toMatchObject({ ok: false, reason: "start_equals_goal" });
    expect(router.route(["goal", "start"], "goal", base)).toMatchObject({ ok: false, reason: "start_equals_goal" });
  });

  it("ignores unknown starts and fails only when none is known", () => {
    const router = createRouter(createSyntheticBundle());
    expect(ok(router.route(["missing", "start"], "goal", base)).nodeIds[0]).toBe("start");
    expect(router.route(["missing", "gone"], "goal", base)).toMatchObject({ ok: false, reason: "unknown_start" });
    expect(router.route([], "goal", base)).toMatchObject({ ok: false, reason: "unknown_start" });
  });

  it("matches the single-start result when given one start", () => {
    const router = createRouter(createSyntheticBundle());
    expect(router.route(["start"], "goal", base)).toEqual(router.route("start", "goal", base));
  });
});

describe("hours evidence in provenance (PR #15 Codex review)", () => {
  it("counts the hours evidence checkedDate in evidenceCheckedDate", () => {
    const hoursEvidence = { sourceIds: ["fixture-access"], method: "source-attribute:hours", checkedDate: "2030-01-01" };
    const r = ok(createRouter(createSyntheticBundle([edge("x", "start", "goal", { hours: { kind: "always", evidence: hoursEvidence } })])).route("start", "goal", base));
    expect(r.evidenceCheckedDate).toBe("2030-01-01");
    expect(r.sourceIds).toContain("fixture-access");
  });
});

describe("fifth GitHub review round (PR #15)", () => {
  it("names the turn when leaving stairs into a corridor", () => {
    const b = createSyntheticBundle([
      edge("s-a", "start", "a"),
      edge("st", "a", "upper", { mode: "stairs", lengthM: null, geometry: [{ x: 10, y: 0, z: 0 }, { x: 13, y: 0, z: 2 }, { x: 16, y: 0, z: 4 }, { x: 10, y: 0, z: 4 }] }),
      edge("u-u2", "upper", "upper-2", { geometry: [{ x: 10, y: 0, z: 4 }, { x: 10, y: -10, z: 4 }, { x: 20, y: 0, z: 4 }] }),
    ]);
    // The flight climbs east and its landing walks back west; the corridor then leaves heading south: a left turn.
    const route = ok(createRouter(b).route("start", "upper-2", base));
    const kinds = describeRoute(b, route, "en").map((i) => i.kind);
    expect(kinds).toContain("stairs");
    expect(kinds[kinds.indexOf("stairs") + 1]).toBe("turn_left");
  });

  it("measures polylines from their nodes, as drawn, even when endpoints are displaced", () => {
    const b = createSyntheticBundle([edge("p", "start", "goal", { lengthM: null, geometry: [{ x: 100, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }] })]);
    const r = ok(createRouter(b).route("start", "goal", base));
    expect(r.totalLengthM).toBeCloseTo(20);
  });
});

describe("headings across short connectors (PR #15 re-review)", () => {
  const withNodes = (edges: Parameters<typeof createSyntheticBundle>[0], extra: { id: string; x: number; y: number }[]) => {
    const b = createSyntheticBundle(edges);
    const template = b.nodes.find((n) => n.id === "start")!;
    for (const n of extra) b.nodes.push({ ...template, id: n.id, position: { x: n.x, y: n.y, z: 0 } });
    return b;
  };
  const kinds = (b: ReturnType<typeof createSyntheticBundle>, to: string) => describeRoute(b, ok(createRouter(b).route("start", to, base)), "en").map((i) => i.kind);

  it("a zero-length gate does not hide the turn after it", () => {
    const b = withNodes([
      edge("s-a", "start", "a"),
      edge("g", "a", "a2", { mode: "gate" }),
      edge("a2-n", "a2", "north"),
    ], [{ id: "a2", x: 10, y: 0 }, { id: "north", x: 10, y: 10 }]);
    expect(kinds(b, "north")).toEqual(["start", "walk", "gate", "turn_left", "arrive"]);
  });

  it("a few centimetres of gate offset never invents a turn", () => {
    const b = withNodes([
      edge("s-a", "start", "a"),
      edge("g", "a", "a2", { mode: "gate" }),
      edge("a2-e", "a2", "east"),
    ], [{ id: "a2", x: 10, y: 0.05 }, { id: "east", x: 20, y: 0.05 }]);
    expect(kinds(b, "east")).toEqual(["start", "walk", "gate", "walk", "arrive"]);
  });

  it("never looks through a lift ride to claim a turn", () => {
    const b = withNodes([
      edge("s-a", "start", "a"),
      edge("lift", "a", "upper", { mode: "elevator", lengthM: null, geometry: [{ x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 4 }] }),
      edge("u-n", "upper", "upper-n"),
    ], []);
    const un = b.nodes.find((n) => n.id === "upper")!;
    b.nodes.push({ ...un, id: "upper-n", position: { x: 10, y: 10, z: 4 } });
    const k = kinds(b, "upper-n");
    expect(k[k.indexOf("elevator") + 1]).toBe("walk");
  });
});

describe("staleness with year/month source dates (PR #15 re-review)", () => {
  const staleWith = (dates: (string | null)[], today: string, staleAfterDays?: number) => {
    const b = createSyntheticBundle();
    b.sources.forEach((s, i) => { s.datasetDate = dates[i] ?? null; });
    return ok(createRouter(b).route("start", "goal", { ...base, today, ...(staleAfterDays === undefined ? {} : { staleAfterDays }) })).stale;
  };

  it("keeps a year-only date UNKNOWN when the year straddles the cutoff", () => {
    expect(staleWith(["2024", "2024"], "2026-01-02")).toBeNull();
    expect(staleWith(["2023", "2024"], "2026-01-02")).toBe(true);
    expect(staleWith(["2025", "2025"], "2026-01-02")).toBe(false);
  });

  it("treats a month-only date as that whole month", () => {
    expect(staleWith(["2024-01", "2024-01"], "2026-01-15")).toBeNull();
    expect(staleWith(["2023-12", "2026-01-01"], "2026-01-15")).toBe(true);
    expect(staleWith(["2024-02", "2026-01-01"], "2026-01-15")).toBe(false);
  });
});

describe("short connectors name a turn exactly once (PR #15 re-review 2)", () => {
  const withNodes = (edges: Parameters<typeof createSyntheticBundle>[0], extra: { id: string; x: number; y: number; z?: number; floorId?: string }[]) => {
    const b = createSyntheticBundle(edges);
    const template = b.nodes.find((n) => n.id === "start")!;
    for (const n of extra) b.nodes.push({ ...template, id: n.id, floorId: n.floorId ?? template.floorId, position: { x: n.x, y: n.y, z: n.z ?? 0 } });
    return b;
  };
  const texts = (b: ReturnType<typeof createSyntheticBundle>, from: string, to: string) =>
    describeRoute(b, ok(createRouter(b).route(from, to, base)), "en").map((i) => i.text);
  const turns = (t: string[]) => t.filter((s) => /Turn (left|right)/.test(s)).length;

  it("a zero-length gate carries no turn of its own; the turn is named once after it, in both directions", () => {
    const b = withNodes([edge("s-a", "start", "a"), edge("g", "a", "a2", { mode: "gate" }), edge("a2-n", "a2", "north")],
      [{ id: "a2", x: 10, y: 0 }, { id: "north", x: 10, y: 10 }]);
    const fwd = texts(b, "start", "north");
    expect(fwd).toEqual(["Start", "Go straight ~10 m", "Pass the ticket gate", "Turn left, ~10 m", "Arrive at destination"]);
    expect(turns(texts(b, "north", "start"))).toBe(1);
  });

  it("two short steps in a row still give one turn", () => {
    const b = withNodes([edge("s-a", "start", "a"), edge("t1", "a", "a2"), edge("t2", "a2", "a3"), edge("a3-n", "a3", "north")],
      [{ id: "a2", x: 10.3, y: 0 }, { id: "a3", x: 10.3, y: 0.3 }, { id: "north", x: 10.3, y: 10 }]);
    expect(turns(texts(b, "start", "north"))).toBe(1);
  });

  it("a lift offset by centimetres claims no turn into or out of it", () => {
    const b = withNodes([
      edge("s-a", "start", "a"),
      edge("lift", "a", "up1", { mode: "elevator", lengthM: null, geometry: [{ x: 10, y: 0, z: 0 }, { x: 10, y: 0.05, z: 4 }] }),
      edge("u-e", "up1", "up-e"),
    ], [{ id: "up1", x: 10, y: 0.05, z: 4, floorId: "upper" }, { id: "up-e", x: 20, y: 0.05, z: 4, floorId: "upper" }]);
    expect(turns(texts(b, "start", "up-e"))).toBe(0);
  });
});

describe("staleness needs one real `today` (PR #15 re-review 2)", () => {
  const staleOn = (today: string) => {
    const b = createSyntheticBundle();
    for (const s of b.sources) s.datasetDate = "2024-01-02";
    return ok(createRouter(b).route("start", "goal", { ...base, today })).stale;
  };
  it("returns UNKNOWN for a partial or impossible today", () => {
    for (const today of ["2026", "2026-01", "2026-13-01", "2026-00-01", "2026-02-30", "soon"]) expect(staleOn(today), today).toBeNull();
    expect(staleOn("2026-01-01")).toBe(false);
    expect(staleOn("2026-01-03")).toBe(true);
  });
});

describe("provenance completeness (PR #15 Codex review 6)", () => {
  it("a source past its validUntil makes the route stale and is named", () => {
    const b = createSyntheticBundle();
    for (const s of b.sources) s.datasetDate = "2026-09-01";
    const fresh = ok(createRouter(b).route("start", "goal", { ...base, today: "2026-10-20" }));
    expect(fresh.stale).toBe(false);
    b.sources.find((s) => s.id === "fixture-access")!.validUntil = "2026-10-01";
    const expired = ok(createRouter(b).route("start", "goal", { ...base, today: "2026-10-20" }));
    expect(expired.stale).toBe(true);
    expect(expired.expiredSourceIds).toEqual(["fixture-access"]);
    b.sources.find((s) => s.id === "fixture-access")!.validUntil = "2026-10";
    expect(ok(createRouter(b).route("start", "goal", { ...base, today: "2026-10-20" })).stale).toBeNull();
    // Valid through today itself is still valid; a month-only validUntil covers its first day.
    b.sources.find((s) => s.id === "fixture-access")!.validUntil = "2026-10-20";
    expect(ok(createRouter(b).route("start", "goal", { ...base, today: "2026-10-20" })).stale).toBe(false);
    b.sources.find((s) => s.id === "fixture-access")!.validUntil = "2026-10";
    expect(ok(createRouter(b).route("start", "goal", { ...base, today: "2026-10-01" })).stale).toBe(false);
    b.sources.find((s) => s.id === "fixture-access")!.validUntil = "2027-03-12";
    expect(ok(createRouter(b).route("start", "goal", { ...base, today: "2026-10-20" })).stale).toBe(false);
  });

  it("traversed nodes' sources are route dependencies", () => {
    const b = createSyntheticBundle();
    b.sources.push({ ...b.sources[0]!, id: "node-survey", datasetDate: "2015-01-01" });
    b.nodes.find((n) => n.id === "start")!.sourceRefs = [{ sourceId: "node-survey", featureId: "n1" }];
    for (const s of b.sources) if (s.id !== "node-survey") s.datasetDate = "2026-09-01";
    const r = ok(createRouter(b).route("start", "goal", { ...base, today: "2026-10-20" }));
    expect(r.sourceIds).toContain("node-survey");
    expect(r.stale).toBe(true);
  });
});

describe("moving walkway entry turns (PR #15 Codex review 7)", () => {
  it("names the turn onto a moving walkway", () => {
    const b = createSyntheticBundle([edge("s-a", "start", "a"), edge("mw", "a", "b2", { mode: "moving_walkway" })]);
    const template = b.nodes.find((n) => n.id === "a")!;
    b.nodes.push({ ...template, id: "b2", position: { x: 10, y: 20, z: 0 } });
    const texts = describeRoute(b, ok(createRouter(b).route("start", "b2", base)), "en").map((i) => i.text);
    expect(texts).toEqual(["Start", "Go straight ~10 m", "Turn left, then take the moving walkway ~10 m", "Arrive at destination"]);
    const ja = describeRoute(b, ok(createRouter(b).route("start", "b2", base)), "ja").map((i) => i.text);
    expect(ja).toContain("左へ曲がり、動く歩道で約10m");
  });
});

describe("elevators and endpoint evidence (PR #15 Codex review 8)", () => {
  it("never derives a heading from a lift's plan displacement", () => {
    const b = createSyntheticBundle([
      edge("s-a", "start", "a"),
      edge("lift", "a", "up1", { mode: "elevator", lengthM: null, geometry: [{ x: 10, y: 0, z: 0 }, { x: 10, y: 3, z: 4 }] }),
      edge("u-e", "up1", "up-e"),
    ]);
    const up = b.nodes.find((n) => n.id === "upper")!;
    b.nodes.push({ ...up, id: "up1", position: { x: 10, y: 3, z: 4 } }, { ...up, id: "up-e", position: { x: 20, y: 3, z: 4 } });
    const texts = describeRoute(b, ok(createRouter(b).route("start", "up-e", base)), "en").map((i) => i.text);
    expect(texts.filter((t) => /Turn (left|right|back)/.test(t))).toEqual([]);
  });

  it("endpoint POI evidence joins sources, freshness and the checked date", () => {
    const b = createSyntheticBundle();
    for (const s of b.sources) s.datasetDate = "2026-09-01";
    b.sources.push({ ...b.sources[0]!, id: "poi-survey", datasetDate: "2016-01-01" });
    const poiEvidence = { sourceIds: ["poi-survey"], method: "field-survey", checkedDate: "2030-01-01" };
    const plain = ok(createRouter(b).route("start", "goal", { ...base, today: "2026-10-20" }));
    expect(plain.stale).toBe(false);
    const withPoi = ok(createRouter(b).route("start", "goal", { ...base, today: "2026-10-20" }, [poiEvidence]));
    expect(withPoi.sourceIds).toContain("poi-survey");
    expect(withPoi.stale).toBe(true);
    expect(withPoi.evidenceCheckedDate).toBe("2030-01-01");
  });
});

describe("access facts need access evidence", () => {
  it("treats paid/fare/wheelchair/steps flags as UNKNOWN on an edge without accessEvidence", () => {
    const bundle = createSyntheticBundle([edge("claimed", "start", "goal", { verification: "synthetic", accessEvidence: null })]);
    const router = createRouter(bundle);
    // The flags claim step-free and unpaid, but nothing evidences them.
    expect(router.route("start", "goal", { ...base, stepFree: true })).toMatchObject({ ok: false, reason: "no_path" });
    expect(router.route("start", "goal", { ...base, fare: "unpaid_only" })).toMatchObject({ ok: false, reason: "no_path" });
    const r = ok(router.route("start", "goal", base));
    expect(r.unknowns.map((u) => u.kind)).toEqual(expect.arrayContaining(["paid", "fare_boundary", "wheelchair", "steps", "access_evidence"]));
    expect(r.crossesFareBoundary).toBeNull();
    // With evidence the same flags are honoured.
    const evidenced = createRouter(createSyntheticBundle([edge("claimed", "start", "goal", { verification: "synthetic" })]));
    expect(evidenced.route("start", "goal", { ...base, stepFree: true, fare: "unpaid_only" }).ok).toBe(true);
  });
});

describe("vertical narration from floor heights", () => {
  it("never says up/down from an unevidenced floor elevation", () => {
    const mk = (elevationSource: "source-derived" | "unknown") => {
      const b = createSyntheticBundle([edge("s-a", "start", "a"), edge("up", "a", "upper", { mode: "stairs", lengthM: 6 })]);
      for (const n of b.nodes) n.position.z = null;
      for (const f of b.floors) { f.elevationSource = elevationSource; f.ordinal = null; }
      return describeRoute(b, ok(createRouter(b).route("start", "upper", base)), "en").find((i) => i.kind === "stairs")!;
    };
    expect(mk("source-derived").vertical).toBe("up");
    expect(mk("unknown").vertical).toBeNull();
  });
});

describe("endpoint heights, floor provenance and coverage status", () => {
  it("measures endpoint heights as drawn: a node of unknown height adds no climb", () => {
    const b = createSyntheticBundle([edge("ramp", "start", "goal", { mode: "walk", lengthM: null, geometry: [{ x: 0, y: 0, z: 3 }, { x: 20, y: 0, z: 0 }] })]);
    b.nodes.find((n) => n.id === "start")!.position.z = null;
    // The polyline claims a 3 m drop at the start, but the drawn path starts at the node's display height.
    expect(ok(createRouter(b).route("start", "goal", base)).totalLengthM).toBeCloseTo(20);
  });

  it("counts the traversed floors' sources in provenance and freshness", () => {
    const b = createSyntheticBundle([edge("s-a", "start", "a"), edge("up", "a", "upper", { mode: "ramp", lengthM: 6 })]);
    b.sources.push({ ...b.sources[0]!, id: "floor-labels", datasetDate: "2010-01-01" });
    b.floors.find((f) => f.id === "upper")!.sourceLabels = [{ operatorId: "operator-a", label: "1F", sourceId: "floor-labels" }];
    const r = ok(createRouter(b).route("start", "upper", { ...base, today: "2026-10-21" }));
    expect(r.sourceIds).toContain("floor-labels");
    expect(r.stale).toBe(true);
  });
});

describe("step-free never uses stairs or escalators", () => {
  it("excludes them even when (contradictory) access flags claim wheelchair access", () => {
    for (const mode of ["stairs", "escalator"] as const) {
      const b = createSyntheticBundle([edge("x", "start", "a"), edge("v", "a", "upper", { mode, lengthM: 6, wheelchair: true, steps: false })]);
      const router = createRouter(b);
      expect(router.route("start", "upper", base).ok).toBe(true);
      expect(router.route("start", "upper", { ...base, stepFree: true })).toMatchObject({ ok: false, reason: "no_path" });
    }
  });
});

describe("opening hours are checked when the route reaches each edge", () => {
  const hours = (open: string, close: string, days?: ("mon" | "wed" | "sun")[]) =>
    ({ kind: "window" as const, open, close, ...(days ? { days } : {}), evidence: { sourceIds: ["fixture-access"], method: "synthetic-fixture", checkedDate: "2026-10-20" } });
  // 720 m at walking pace (600 s = 10 min), then a gate with known hours.
  const mk = (gate: ReturnType<typeof hours>) => createRouter(createSyntheticBundle([
    edge("long", "start", "a", { lengthM: 720 }),
    edge("gate", "a", "goal", { mode: "gate", lengthM: 0, hours: gate }),
  ]));

  // The route waits at the edge's start until it opens, never crossing it while closed.
  const waitsFor = (r: ReturnType<ReturnType<typeof createRouter>["route"]>, edgeId: string, until: { weekday: string; minutes: number; dayOffset: number }) => {
    const route = ok(r);
    const step = route.steps.find((st) => st.edgeId === edgeId)!;
    expect(step.waitUntil).toEqual(until);
    expect(step.waitSeconds).toBeGreaterThan(0);
    expect(route.waitSeconds).toBe(route.steps.reduce((sum, st) => sum + (st.waitSeconds ?? 0), 0));
  };
  const noWait = (r: ReturnType<ReturnType<typeof createRouter>["route"]>) => expect(ok(r).waitSeconds).toBe(0);

  it("waits for a gate that closes before the walker gets there, under both hours policies", () => {
    const router = mk(hours("05:00", "23:00"));
    for (const policy of ["warn_unknown", "require_known"] as const) {
      const late = router.route("start", "goal", { ...base, hours: policy, at: { weekday: "mon", minutes: 22 * 60 + 55 } });
      waitsFor(late, "gate", { weekday: "tue", minutes: 5 * 60, dayOffset: 1 });
      // Arrives 23:05, waits until 05:00: 5 h 55 min of waiting on top of the 10 min walk.
      expect(ok(late).waitSeconds).toBeCloseTo(355 * 60, 6);
      expect(ok(late).estimatedSeconds).toBeCloseTo(600 + 355 * 60, 6);
      noWait(router.route("start", "goal", { ...base, hours: policy, at: { weekday: "mon", minutes: 22 * 60 + 40 } }));
    }
  });

  it("rolls the arrival time over midnight into the next weekday", () => {
    // Open only on Monday 00:00–01:00: leaving Sunday 23:55 arrives Monday 00:05.
    const router = mk(hours("00:00", "01:00", ["mon"]));
    noWait(router.route("start", "goal", { ...base, at: { weekday: "sun", minutes: 23 * 60 + 55 } }));
    waitsFor(router.route("start", "goal", { ...base, at: { weekday: "sun", minutes: 23 * 60 } }), "gate", { weekday: "mon", minutes: 0, dayOffset: 1 });
  });

  it("catches a closure that falls strictly between entering and leaving an edge", () => {
    // 1,080 m = 15 min from 04:50: daily 05:00–04:55 is open at both ends but closed 04:55–05:00.
    const router = createRouter(createSyntheticBundle([edge("passage", "start", "goal", { lengthM: 1080, hours: hours("05:00", "04:55") })]));
    for (const policy of ["warn_unknown", "require_known"] as const)
      waitsFor(router.route("start", "goal", { ...base, hours: policy, at: { weekday: "mon", minutes: 4 * 60 + 50 } }), "passage", { weekday: "mon", minutes: 5 * 60, dayOffset: 0 });
    noWait(router.route("start", "goal", { ...base, at: { weekday: "mon", minutes: 5 * 60 } }));
    // A departure between whole minutes still samples on clock minutes.
    waitsFor(router.route("start", "goal", { ...base, at: { weekday: "mon", minutes: 4 * 60 + 45.5 } }), "passage", { weekday: "mon", minutes: 5 * 60, dayOffset: 0 });
  });

  it("keeps an invalid departure time UNKNOWN instead of rolling it into a known one", () => {
    const router = mk(hours("00:00", "01:00", ["sun"]));
    // minutes 1440 is not a valid time: strict hours fail closed, the default only warns.
    const at = { weekday: "sat" as const, minutes: 1440 };
    expect(router.route("start", "goal", { ...base, hours: "require_known", at }).ok).toBe(false);
  });

  it("checks every minute of a traversal longer than a day", () => {
    // 207,360 m at walking speed takes 48 h; Monday and Wednesday windows of 00:00–47:59 leave
    // Tuesday 23:59–Wednesday 00:00 closed, beyond the first day of samples.
    const b = createSyntheticBundle([edge("passage", "start", "goal", { lengthM: 207_360, hours: hours("00:00", "47:59", ["mon", "wed"]) })]);
    const router = createRouter(b);
    const at = { weekday: "mon" as const, minutes: 0 };
    for (const policy of ["warn_unknown", "require_known"] as const) {
      expect(router.route("start", "goal", { ...base, hours: policy, at }).ok).toBe(false);
      expect(router.isTraversable(b.edges[0]!, { ...base, hours: policy, at })).toBe(false);
    }
  });

  it("samples whole clock minutes exactly after a long elapsed time", () => {
    // From Mon 00:00.17, 147,371.76 m of open walk reaches Tue 10:07; the gate (open daily 10:09–10:08,
    // closed 10:08–10:09) takes 3 minutes more. Floating-point drift must not skip the 10:08 sample.
    const b = createSyntheticBundle([
      edge("passage", "start", "a", { lengthM: 147_371.76 }),
      edge("passage", "a", "goal", { lengthM: 216, hours: hours("10:09", "10:08") }),
    ]);
    for (const policy of ["warn_unknown", "require_known"] as const) {
      const r = ok(createRouter(b).route("start", "goal", { ...base, hours: policy, at: { weekday: "mon", minutes: 0.17 } }));
      expect(r.steps[1]!.waitUntil).toEqual({ weekday: "tue", minutes: 10 * 60 + 9, dayOffset: 1 });
    }
  });

  it("keeps boundary minutes that floating-point arithmetic rounds just below", () => {
    // 56.16 m from 00:00.22 ends exactly at 00:01, when the 00:00–00:01 window has closed.
    const short = createSyntheticBundle([edge("passage", "start", "goal", { lengthM: 56.16, hours: hours("00:00", "00:01") })]);
    // 103,675.68 m from Mon 00:00.06 ends exactly at Tue 00:00, after Monday's 00:00–24:00 window.
    const midnight = createSyntheticBundle([edge("passage", "start", "goal", { lengthM: 103_675.68, hours: hours("00:00", "24:00", ["mon"]) })]);
    for (const [b, minutes] of [[short, 0.22], [midnight, 0.06]] as const)
      for (const policy of ["warn_unknown", "require_known"] as const) {
        const profile = { ...base, hours: policy, at: { weekday: "mon" as const, minutes } };
        // The next opening that fits the whole walk: Tuesday 00:00, or next Monday 00:00.
        waitsFor(createRouter(b).route("start", "goal", profile), "passage", b === short ? { weekday: "tue", minutes: 0, dayOffset: 1 } : { weekday: "mon", minutes: 0, dayOffset: 7 });
        expect(createRouter(b).isTraversable(b.edges[0]!, profile)).toBe(false);
      }
  });

  it("bounds the rounding accumulated over many edges", () => {
    // 37,324,800 m + 60,000 × 1.08 m from Mon 00:00 reach the gate exactly at Thu 15:00 (360 days 15 h),
    // when its daily 00:00–15:00 window has closed; the float sum lands just short of 15:00.
    const always = { kind: "always" as const, evidence: { sourceIds: ["fixture-access"], method: "synthetic-fixture", checkedDate: "2026-10-20" } };
    const b = createSyntheticBundle([edge("passage", "start", "a", { lengthM: 37_324_800, hours: always })]);
    const n = 60_000;
    for (let i = 0; i < n; i++) {
      b.nodes.push({ ...b.nodes.find((x) => x.id === "a")!, id: `chain-${i}` });
      b.edges.push({ ...b.edges[0]!, id: `chain-edge-${i}`, from: i === 0 ? "a" : `chain-${i - 1}`, to: `chain-${i}`, lengthM: 1.08 });
    }
    b.edges.push({ ...b.edges[0]!, id: "gate", mode: "gate", from: `chain-${n - 1}`, to: "goal", lengthM: 0, hours: hours("00:00", "15:00") });
    for (const policy of ["warn_unknown", "require_known"] as const)
      waitsFor(createRouter(b).route("start", "goal", { ...base, hours: policy, at: { weekday: "mon", minutes: 0 } }), "gate", { weekday: "fri", minutes: 0, dayOffset: 361 });
    b.edges.at(-1)!.hours = hours("00:00", "15:02");
    noWait(createRouter(b).route("start", "goal", { ...base, at: { weekday: "mon", minutes: 0 } }));
  });

  it("bounds the rounding accumulated inside one long polyline", () => {
    // One polyline of 37,324,800 m then 60,000 alternating 1.08 m segments reaches the gate exactly at
    // Thu 15:00, after its daily 00:00–15:00 window; the float length lands just short.
    const always = { kind: "always" as const, evidence: { sourceIds: ["fixture-access"], method: "synthetic-fixture", checkedDate: "2026-10-20" } };
    const points = [{ x: 0, y: 0, z: 0 }, { x: 37_324_800, y: 0, z: 0 }];
    for (let i = 1; i <= 60_000; i++) points.push({ x: 37_324_800, y: i % 2 ? 1.08 : 0, z: 0 });
    const b = createSyntheticBundle([edge("passage", "start", "a", { lengthM: null, hours: always, geometry: points })]);
    b.nodes.find((n) => n.id === "a")!.position = { ...points.at(-1)! };
    b.edges.push({ ...b.edges[0]!, id: "gate", mode: "gate", from: "a", to: "goal", lengthM: 0, geometry: undefined, hours: hours("00:00", "15:00") });
    b.nodes.find((n) => n.id === "goal")!.position = { ...points.at(-1)! };
    for (const policy of ["warn_unknown", "require_known"] as const)
      waitsFor(createRouter(b).route("start", "goal", { ...base, hours: policy, at: { weekday: "mon", minutes: 0 } }), "gate", { weekday: "fri", minutes: 0, dayOffset: 361 });
    b.edges.at(-1)!.hours = hours("00:00", "15:02");
    noWait(createRouter(b).route("start", "goal", { ...base, at: { weekday: "mon", minutes: 0 } }));
  });

  it("wraps samples before the departure day and covers a full week after a near-instant entry", () => {
    // A 1e-12 m step (so the widened entry samples the minute before departure), then 725,760 m (7 days)
    // open 00:00–47:59 Monday–Saturday: Sunday 23:59 is closed.
    const always = { kind: "always" as const, evidence: { sourceIds: ["fixture-access"], method: "synthetic-fixture", checkedDate: "2026-10-20" } };
    const week = { ...hours("00:00", "47:59"), days: ["mon", "tue", "wed", "thu", "fri", "sat"] as const };
    const b = createSyntheticBundle([
      edge("passage", "start", "a", { lengthM: 1e-12, hours: always }),
      edge("passage", "a", "goal", { lengthM: 725_760, hours: { ...week, days: [...week.days] } }),
    ]);
    for (const policy of ["warn_unknown", "require_known"] as const)
      expect(createRouter(b).route("start", "goal", { ...base, hours: policy, at: { weekday: "mon", minutes: 0 } }).ok).toBe(false);
  });

  it("fails closed when the arrival time is more than a year out", () => {
    const always = { kind: "always" as const, evidence: { sourceIds: ["fixture-access"], method: "synthetic-fixture", checkedDate: "2026-10-20" } };
    // 2**53 minutes, where clock minutes no longer step; and ~2**35, where a 1e-6 epsilon vanishes
    // (that walk would end exactly at a 10:08 close).
    for (const [lengthM, minutes, gate] of [[72 * 2 ** 53, 0, always], [2_473_901_162_424, 0.01, hours("00:00", "10:08")]] as const) {
      const b = createSyntheticBundle([
        edge("passage", "start", "a", { lengthM, hours: always }),
        edge("passage", "a", "goal", { lengthM: 71.28, hours: gate }),
      ]);
      for (const policy of ["warn_unknown", "require_known"] as const)
        expect(createRouter(b).route("start", "goal", { ...base, hours: policy, at: { weekday: "mon", minutes } }).ok).toBe(false);
    }
    // Without a departure time nothing is clock-checked.
    const b = createSyntheticBundle([edge("passage", "start", "goal", { lengthM: 72 * 2 ** 53, hours: always })]);
    expect(createRouter(b).route("start", "goal", base).ok).toBe(true);
  });

  it("keeps a faster, dearer path when the cheaper one arrives too late for a later edge", () => {
    // Stairs: 30 m at 0.5 m/s = 60 s (cheaper); walk: 50 m at 1.2 m/s ≈ 42 s. The gate shuts at 23:00.
    const b = createSyntheticBundle([
      edge("stairs-way", "start", "a", { mode: "stairs", lengthM: 30 }),
      edge("walk-way", "start", "a", { lengthM: 50 }),
      edge("gate", "a", "goal", { mode: "gate", lengthM: 0, hours: hours("05:00", "23:00") }),
    ]);
    const router = createRouter(b);
    expect(ok(router.route("start", "goal", base)).steps[0]!.edgeId).toBe("stairs-way");
    for (const policy of ["warn_unknown", "require_known"] as const) {
      const r = ok(router.route("start", "goal", { ...base, hours: policy, at: { weekday: "mon", minutes: 22 * 60 + 59 } }));
      expect(r.steps.map((st) => st.edgeId)).toEqual(["walk-way", "gate"]);
    }
  });

  it("finds the one in-time path behind many cheaper late ones (Shinjuku gate A)", () => {
    // 16 parallel stairs (30–31.5 m, 60–63 s, cheaper) all reach the gate at or after its 23:00 close;
    // only the 51 m walk (42.5 s) is in time. No label cap may drop it.
    const b = createSyntheticBundle([
      ...Array.from({ length: 16 }, (_, i) => edge(`stairs-${i}`, "start", "a", { mode: "stairs", lengthM: 30 + i * 0.1 })),
      edge("walk-way", "start", "a", { lengthM: 51 }),
      edge("gate", "a", "goal", { mode: "gate", lengthM: 0, hours: hours("05:00", "23:00") }),
    ]);
    for (const policy of ["warn_unknown", "require_known"] as const) {
      const r = ok(createRouter(b).route("start", "goal", { ...base, hours: policy, at: { weekday: "mon", minutes: 22 * 60 + 59 } }));
      expect(r.steps.map((st) => st.edgeId)).toEqual(["walk-way", "gate"]);
      expect(r.waitSeconds).toBe(0);
    }
  });

  it("waits for an opening instead of crossing an edge before it opens (Shinjuku gate B)", () => {
    // From 12:00 the stairs reach a at 12:00:20, the walk round via b at 12:01:10; a→goal opens at 12:01.
    const b = createSyntheticBundle([
      edge("stairs", "start", "a", { mode: "stairs", lengthM: 10 }),
      edge("a-b", "a", "b", { lengthM: 48 }),
      edge("start-b", "start", "b", { lengthM: 72 }),
      edge("b-a", "b", "a", { lengthM: 12 }),
      edge("gate", "a", "goal", { mode: "gate", lengthM: 0, hours: hours("12:01", "23:00") }),
    ]);
    for (const policy of ["warn_unknown", "require_known"] as const) {
      const r = ok(createRouter(b).route("start", "goal", { ...base, hours: policy, at: { weekday: "mon", minutes: 12 * 60 } }));
      // Waiting 40 s at a (cost 30) beats the 82 m walk round (cost 84) and is said as a wait, never invented.
      expect(r.steps.map((st) => st.edgeId)).toEqual(["stairs", "gate"]);
      expect(r.steps[1]!.waitUntil).toEqual({ weekday: "mon", minutes: 12 * 60 + 1, dayOffset: 0 });
      expect(r.steps[1]!.waitSeconds).toBeCloseTo(40, 6);
      expect(r.waitSeconds).toBeCloseTo(40, 6);
      expect(r.estimatedSeconds).toBeCloseTo(60, 6);
      expect(describeRoute(b, r, "ja").map((i) => [i.kind, i.text])).toContainEqual(["wait", "12:01まで待つ"]);
      expect(describeRoute(b, r, "en").map((i) => [i.kind, i.text])).toContainEqual(["wait", "Wait until 12:01"]);
      // The wait is anchored where the waited-for step starts, so the guide can stop there.
      const wait = describeRoute(b, r, "en").find((i) => i.kind === "wait")!;
      expect(wait.beforeStepIndex).toBe(1);
      expect(instructionPoints(routePolyline(b, r), wait).map((p) => [p.x, p.y])).toEqual([[10, 0]]);
    }
  });

  it("says which day a wait ends on", () => {
    const at = (weekday: "mon" | "sun", minutes: number) => ({ ...base, at: { weekday, minutes } });
    const say = (router: ReturnType<typeof createRouter>, b: ReturnType<typeof createSyntheticBundle>, profile: RouteProfile) => {
      const r = ok(router.route("start", "goal", profile));
      return (["ja", "en"] as const).map((lang) => describeRoute(b, r, lang).find((i) => i.kind === "wait")?.text);
    };
    const daily = createSyntheticBundle([edge("gate", "start", "goal", { mode: "gate", lengthM: 0, hours: hours("05:00", "23:00") })]);
    expect(say(createRouter(daily), daily, at("mon", 23 * 60 + 30))).toEqual(["翌日05:00まで待つ", "Wait until 05:00 tomorrow"]);
    const weekly = createSyntheticBundle([edge("gate", "start", "goal", { mode: "gate", lengthM: 0, hours: hours("05:00", "23:00", ["wed"]) })]);
    expect(say(createRouter(weekly), weekly, at("mon", 23 * 60 + 30))).toEqual(["水曜日05:00まで待つ", "Wait until 05:00 on Wednesday"]);
    // A week out, the same weekday name alone would read as today.
    const monday = createSyntheticBundle([edge("gate", "start", "goal", { mode: "gate", lengthM: 0, hours: hours("05:00", "23:00", ["mon"]) })]);
    expect(say(createRouter(monday), monday, at("mon", 23 * 60 + 30))).toEqual(["7日後の月曜日05:00まで待つ", "Wait until 05:00 on Monday, 7 days later"]);
  });

  it("waits exactly until the first minute a brute-force scan finds the edge open throughout", () => {
    // Random windows (overnight, over 24 h, some weekdays, empty spans) against an independent minute scan.
    let seed = 11;
    const rnd = (n: number) => (seed = (seed * 16807) % 2147483647) % n;
    const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const week = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
    for (let i = 0; i < 300; i++) {
      const open = rnd(48 * 60), close = rnd(48 * 60);
      const days = rnd(3) === 0 ? undefined : week.filter(() => rnd(2) === 0);
      if (days?.length === 0) continue;
      const gate = { ...hours(hm(open), hm(close)), ...(days ? { days: [...days] } : {}) } as ReturnType<typeof hours>;
      const minutesLong = rnd(4) === 0 ? 0 : 1 + rnd(90);
      const b = createSyntheticBundle([edge("passage", "start", "goal", { lengthM: minutesLong * 72, hours: gate })]);
      const at = { weekday: week[rnd(7)]!, minutes: rnd(1440) };
      // Brute force: the first whole minute from departure at which every minute of the walk is open.
      const openAt = (m: number) => isOpenAt(gate, { weekday: week[(week.indexOf(at.weekday) + Math.floor(m / 1440)) % 7]!, minutes: m % 1440 }) === true;
      let expected: number | null = null;
      for (let m = at.minutes; m <= at.minutes + 7 * 1440 && expected === null; m++) {
        let all = true;
        for (let c = m; c <= m + minutesLong && all; c++) all = openAt(c);
        if (all) expected = m;
      }
      const r = createRouter(b).route("start", "goal", { ...base, at });
      if (expected === null) expect(r, JSON.stringify({ gate, at, minutesLong })).toMatchObject({ ok: false, reason: "no_path" });
      else {
        const step = ok(r).steps[0]!;
        const start = step.waitUntil ? step.waitUntil.dayOffset * 1440 + step.waitUntil.minutes : at.minutes;
        expect(start, JSON.stringify({ gate, at, minutesLong })).toBe(expected);
      }
    }
  });

  it("enters a window at an arrival computed as exactly its opening minute", () => {
    // 72 m at 1.2 m/s from 04:59 reaches the gate at 05:00 exactly; it must not wait a day for the next 05:00,
    // and a parallel 72.01 m path must not lose to that wrongly delayed one.
    for (const parallel of [false, true]) {
      const b = createSyntheticBundle([
        edge("walk", "start", "a", { lengthM: 72 }),
        ...(parallel ? [edge("walk-2", "start", "a", { lengthM: 72.01 })] : []),
        edge("gate", "a", "goal", { mode: "gate", lengthM: 0, hours: hours("05:00", "23:00") }),
      ]);
      const r = ok(createRouter(b).route("start", "goal", { ...base, at: { weekday: "mon", minutes: 4 * 60 + 59 } }));
      expect(r.waitSeconds).toBeLessThan(1);
      expect(r.steps.at(-1)!.waitUntil?.dayOffset ?? 0).toBe(0);
    }
  });

  it("does not let escalator loops, which cost exactly what waiting does, exhaust the search", () => {
    const b = createSyntheticBundle([
      edge("up", "start", "a", { mode: "escalator", direction: "forward", lengthM: 9 }),
      edge("down", "a", "start", { mode: "escalator", direction: "forward", lengthM: 9 }),
      edge("gate", "a", "goal", { mode: "gate", lengthM: 0, hours: hours("12:00", "13:00", ["mon"]) }),
    ]);
    const r = ok(createRouter(b).route("start", "goal", { ...base, at: { weekday: "tue", minutes: 10 * 60 } }));
    expect(r.steps.map((st) => st.edgeId)).toEqual(["up", "gate"]);
    expect(r.steps[1]!.waitUntil).toEqual({ weekday: "mon", minutes: 12 * 60, dayOffset: 6 });
  });

  it("checks the work budget while expanding one very wide node", () => {
    // 2,000 parallel week-long passages: trying them all would sample 20 million minutes.
    const always = { ...hours("00:00", "24:00") };
    const b = createSyntheticBundle(Array.from({ length: 2000 }, (_, i) => edge(`p${i}`, "start", "goal", { lengthM: 725_760 + i, hours: always })));
    const t0 = performance.now();
    expect(createRouter(b).route("start", "goal", { ...base, at: { weekday: "mon", minutes: 0 } })).toMatchObject({ ok: false, reason: "search_limit" });
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  it("reports an exhausted search as UNKNOWN, never as no path", () => {
    // 18 diamonds, each a short escalator (slower, cheaper) or a 1.4× longer walk (faster, dearer), scaled
    // by powers of two: 2^18 arrival/cost trade-offs, none dominating another.
    const n = 18;
    const b = createSyntheticBundle([]);
    const node = b.nodes.find((x) => x.id === "a")!;
    for (let i = 0; i <= n; i++) b.nodes.push({ ...node, id: `d${i}` });
    for (let i = 0; i < n; i++) {
      const scale = 2 ** i;
      b.nodes.push({ ...node, id: `m${i}` });
      b.edges.push(
        edge(`esc-${i}`, `d${i}`, `d${i + 1}`, { mode: "escalator", direction: "forward", lengthM: 10 * scale }),
        edge(`walk-${i}-1`, `d${i}`, `m${i}`, { lengthM: 7 * scale }),
        edge(`walk-${i}-2`, `m${i}`, `d${i + 1}`, { lengthM: 7 * scale }),
      );
    }
    b.edges.push(edge("start-d0", "start", "d0", { lengthM: 1 }), edge("gate", `d${n}`, "goal", { mode: "gate", lengthM: 0, hours: hours("00:00", "24:00") }));
    const router = createRouter(b);
    const t0 = performance.now();
    expect(router.route("start", "goal", { ...base, at: { weekday: "mon", minutes: 0 } })).toMatchObject({ ok: false, reason: "search_limit" });
    // The budget bounds the time spent, not just the labels kept.
    expect(performance.now() - t0).toBeLessThan(5000);
    // Without clock-dependent hours the same graph is plain Dijkstra.
    expect(ok(router.route("start", "goal", base)).steps.at(-1)!.edgeId).toBe("gate");
  });

  it("gives isTraversable the edge's own duration", () => {
    const b = createSyntheticBundle([edge("passage", "start", "goal", { lengthM: 144, hours: hours("05:00", "23:00") })]);
    const router = createRouter(b);
    expect(router.isTraversable(b.edges[0]!, { ...base, at: { weekday: "mon", minutes: 22 * 60 + 59 } })).toBe(false);
    expect(router.isTraversable(b.edges[0]!, { ...base, at: { weekday: "mon", minutes: 22 * 60 + 57 } })).toBe(true);
  });

  it("requires a window to stay open while the edge is being traversed", () => {
    // A 120 s passage that closes 1 minute after the walker enters it.
    const router = createRouter(createSyntheticBundle([edge("passage", "start", "goal", { lengthM: 144, hours: hours("05:00", "23:00") })]));
    waitsFor(router.route("start", "goal", { ...base, at: { weekday: "mon", minutes: 22 * 60 + 59 } }), "passage", { weekday: "tue", minutes: 5 * 60, dayOffset: 1 });
    noWait(router.route("start", "goal", { ...base, at: { weekday: "mon", minutes: 22 * 60 + 57 } }));
  });
});

describe("continued flights never invent or flip a direction (Shinjuku E27 narration)", () => {
  /** Flight 1 heads east from a; flight 2 turns left (north) at its foot. All on one floor: senses come from z alone. */
  function twoFlights(z1: number, z2: number | null) {
    const b = createSyntheticBundle([
      edge("s-a", "start", "a"),
      edge("f1", "a", "upper", { mode: "stairs" }),
      edge("f2", "upper", "upper-2", { mode: "stairs" }),
    ]);
    b.nodes.find((n) => n.id === "upper")!.position = { x: 20, y: 0, z: z1 };
    b.nodes.find((n) => n.id === "upper-2")!.position = { x: 20, y: 10, z: z2 };
    for (const id of ["upper", "upper-2"]) b.nodes.find((n) => n.id === id)!.floorId = "concourse";
    const r = ok(createRouter(b).route("start", "upper-2", base));
    return { en: describeRoute(b, r, "en").filter((i) => i.kind === "stairs"), ja: describeRoute(b, r, "ja").filter((i) => i.kind === "stairs") };
  }

  it("continues a flight in the same evidenced sense", () => {
    const { en, ja } = twoFlights(2, 4);
    expect(en.map((i) => i.text)).toEqual(["Take the stairs up", "Turn left, then continue up the stairs"]);
    expect(ja[1]!.text).toBe("左へ曲がり、引き続き階段で上へ");
  });

  it("does not call a flight that reverses the last one a continuation", () => {
    // Down to a passage under the line, then up the other side.
    const { en, ja } = twoFlights(-3, 0);
    expect(en.map((i) => i.text)).toEqual(["Take the stairs down", "Turn left, then take the stairs up"]);
    expect(ja[1]!.text).toBe("左へ曲がり、階段で上へ");
  });

  it("continues on the stairs without a direction when the next flight's is unknown", () => {
    const { en, ja } = twoFlights(-3, null);
    expect(en[1]).toMatchObject({ vertical: null, text: "Turn left, then continue on the stairs" });
    expect(ja[1]!.text).toBe("左へ曲がり、引き続き階段を進む");
  });
});

describe("short legs never fold into or across a wait (rebased onto waits for opening windows)", () => {
  it("ends the walk before the wait and starts afresh after it", () => {
    const window = { kind: "window" as const, open: "12:01", close: "23:00", evidence: { sourceIds: ["fixture-access"], method: "synthetic-fixture", checkedDate: "2026-10-20" } };
    const b = createSyntheticBundle([
      edge("e1", "start", "a", { lengthM: 20 }),
      edge("e2", "a", "b", { lengthM: 3 }),
      edge("e3", "b", "c", { lengthM: 2, hours: window }),
      edge("e4", "c", "d", { lengthM: 20 }),
    ]);
    const node = (id: string, x: number, y: number) => ({ id, floorId: "concourse", position: { x, y, z: 0 }, kind: "junction" as const, inOut: null, sourceRefs: [] });
    // East 20 m, a 3 m step north (left), then — once e3 opens — 2 m on north and 20 m east (right).
    b.nodes = b.nodes.filter((n) => n.id !== "a" && n.id !== "b");
    b.nodes.push(node("a", 20, 0), node("b", 20, 3), node("c", 20, 5), node("d", 40, 5));
    const r = ok(createRouter(b).route("start", "d", { ...base, at: { weekday: "mon", minutes: 12 * 60 } }));
    expect(r.steps[2]!.waitUntil).toEqual({ weekday: "mon", minutes: 12 * 60 + 1, dayOffset: 0 });
    const en = describeRoute(b, r, "en");
    expect(en.map((i) => i.text)).toEqual(["Start", "Go straight ~20 m, then turn left", "Wait until 12:01", "Go straight ~2 m", "Turn right, ~20 m", "Arrive at destination"]);
    expect(en.map((i) => i.stepIndexes)).toEqual([[], [0, 1], [], [2], [3], []]);
    expect(en[2]).toMatchObject({ kind: "wait", beforeStepIndex: 2 });
    expect(describeRoute(b, r, "ja").map((i) => i.text)).toEqual(["出発", "約20m 直進、その先で左へ", "12:01まで待つ", "約2m 直進", "右へ曲がり約20m", "目的地に到着"]);
  });

  it("names a turn on the first leg after a wait, folded into the next line at the wait point", () => {
    const window = { kind: "window" as const, open: "12:01", close: "23:00", evidence: { sourceIds: ["fixture-access"], method: "synthetic-fixture", checkedDate: "2026-10-20" } };
    const b = createSyntheticBundle([
      edge("e1", "start", "a", { lengthM: 20 }),
      edge("e2", "a", "b", { lengthM: 3, hours: window }),
      edge("e3", "b", "c", { lengthM: 20 }),
    ]);
    const node = (id: string, x: number, y: number) => ({ id, floorId: "concourse", position: { x, y, z: 0 }, kind: "junction" as const, inOut: null, sourceRefs: [] });
    // East 20 m, wait at a until e2 opens, then 3 m north (left, measured from the heading waited in) and 20 m east.
    b.nodes = b.nodes.filter((n) => n.id !== "a" && n.id !== "b");
    b.nodes.push(node("a", 20, 0), node("b", 20, 3), node("c", 40, 3));
    const r = ok(createRouter(b).route("start", "c", { ...base, at: { weekday: "mon", minutes: 12 * 60 } }));
    expect(r.steps[1]!.waitUntil).toEqual({ weekday: "mon", minutes: 12 * 60 + 1, dayOffset: 0 });
    const en = describeRoute(b, r, "en");
    expect(en.map((i) => i.text)).toEqual(["Start", "Go straight ~20 m", "Wait until 12:01", "Turn left, then right, ~20 m", "Arrive at destination"]);
    expect(en[3]).toMatchObject({ stepIndexes: [1, 2], leadTurns: ["left"] });
    expect(en[2]).toMatchObject({ kind: "wait", stepIndexes: [], beforeStepIndex: 1 });
    expect(describeRoute(b, r, "ja")[3]!.text).toBe("左へ曲がり、すぐ右へ曲がり約20m");
  });

  it("does not ride one lift across a wait", () => {
    const window = { kind: "window" as const, open: "12:01", close: "23:00", evidence: { sourceIds: ["fixture-access"], method: "synthetic-fixture", checkedDate: "2026-10-20" } };
    const b = createSyntheticBundle([
      edge("s-a", "start", "a"),
      edge("lift-1", "a", "upper", { mode: "elevator", lengthM: 1 }),
      edge("lift-2", "upper", "upper-2", { mode: "elevator", lengthM: 1, hours: window }),
    ]);
    const r = ok(createRouter(b).route("start", "upper-2", { ...base, at: { weekday: "mon", minutes: 12 * 60 } }));
    const en = describeRoute(b, r, "en");
    expect(en.map((i) => i.kind)).toEqual(["start", "walk", "elevator", "wait", "elevator", "arrive"]);
    expect(en.map((i) => i.stepIndexes)).toEqual([[], [0], [1], [], [2], []]);
  });
});
