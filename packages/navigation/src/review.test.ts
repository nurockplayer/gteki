import { describe, expect, it } from "vitest";
import { createRouter, describeRoute } from "./index.ts";
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
      edge("st", "a", "upper", { mode: "stairs", lengthM: null, geometry: [{ x: 10, y: 0, z: null }, { x: 10, y: 0, z: null }] }),
    ]);
    expect(createRouter(b).route("start", "upper", base).ok).toBe(false);
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
    expect(stairs[1]!.text).toMatch(/^Turn left, then take the stairs/);
    expect(describeRoute(b, ok(createRouter(b).route("start", "upper-2", base)), "ja").filter((i) => i.kind === "stairs")[1]!.text).toMatch(/^左へ曲がり、階段/);
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
    expect(texts).toEqual(["Start", "Go straight ~10 m", "Turn left, then moving walkway ~10 m", "Arrive at destination"]);
    const ja = describeRoute(b, ok(createRouter(b).route("start", "b2", base)), "ja").map((i) => i.text);
    expect(ja).toContain("左へ曲がり、動く歩道で約10m");
  });
});
