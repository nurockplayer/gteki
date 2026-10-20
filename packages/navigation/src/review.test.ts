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
    b.nodes.find((n) => n.id === "b")!.position.z = -2;
    const r = ok(createRouter(b).route("start", "b", base));
    expect(describeRoute(b, r, "en").find((i) => i.kind === "stairs")!.text).toBe("Take the stairs down");
    expect(describeRoute(b, r, "ja").find((i) => i.kind === "stairs")!.text).toBe("階段で下へ");
  });
});
