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
    b.edges[1]!.geometry = [{ x: 10, y: 0, z: 0 }, { x: 13, y: 0, z: 4 }];
    expect(ok(createRouter(b).route("start", "upper", base)).steps[1]!.lengthM).toBeCloseTo(5);
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
