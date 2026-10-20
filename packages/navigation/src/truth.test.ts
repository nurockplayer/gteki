import { describe, expect, it } from "vitest";
import type { EvidenceRef } from "@gteki/schema";
import { createRouter } from "./index.ts";
import type { RouteProfile, RouteResult } from "./index.ts";
import { createSyntheticBundle, syntheticEdge as edge } from "./fixtures.ts";

const ev: EvidenceRef = { sourceIds: ["fixture-access"], method: "synthetic-fixture", checkedDate: "2026-10-20" };
const base: RouteProfile = { fare: "ticketed", stepFree: false };

function ok(r: ReturnType<ReturnType<typeof createRouter>["route"]>): RouteResult {
  if (!r.ok) throw new Error(r.message);
  return r;
}

describe("opening hours", () => {
  const night = edge("night-gate", "start", "goal", { lengthM: 1, hours: { kind: "window", open: "05:00", close: "24:30", evidence: ev } });
  const unknown = edge("unknown-hours", "start", "goal", { lengthM: 2, hours: null });
  const detour = [edge("d1", "start", "a"), edge("d2", "a", "goal")];

  it("routes unknown hours by default but reports them for the 'hours unverified' badge", () => {
    const r = ok(createRouter(createSyntheticBundle([unknown, ...detour])).route("start", "goal", base));
    expect(r.steps.map((s) => s.edgeId)).toEqual(["unknown-hours"]);
    expect(r.unknowns).toContainEqual({ kind: "hours", edgeIds: ["unknown-hours"] });
  });

  it("excludes unknown hours under the strict profile", () => {
    const r = ok(createRouter(createSyntheticBundle([unknown, ...detour])).route("start", "goal", { ...base, hours: "require_known" }));
    expect(r.steps.map((s) => s.edgeId)).toEqual(["d1", "d2"]);
    expect(r.unknowns).toEqual([]);
  });

  it("excludes an edge closed at the departure time and uses it when open", () => {
    const router = createRouter(createSyntheticBundle([night, ...detour]));
    expect(ok(router.route("start", "goal", { ...base, at: { weekday: "wed", minutes: 120 } })).steps.map((s) => s.edgeId)).toEqual(["d1", "d2"]);
    expect(ok(router.route("start", "goal", { ...base, at: { weekday: "wed", minutes: 15 } })).steps.map((s) => s.edgeId)).toEqual(["night-gate"]);
    expect(ok(router.route("start", "goal", { ...base, at: { weekday: "wed", minutes: 600 } })).timeRestricted).toEqual([]);
  });

  it("without a departure time, uses windowed edges but lists their windows", () => {
    const r = ok(createRouter(createSyntheticBundle([night, ...detour])).route("start", "goal", base));
    expect(r.timeRestricted).toEqual([{ edgeId: "night-gate", open: "05:00", close: "24:30" }]);
  });

  it("waits for the only link to open instead of using it while closed", () => {
    const r = ok(createRouter(createSyntheticBundle([night])).route("start", "goal", { ...base, at: { weekday: "sun", minutes: 200 } }));
    expect(r.steps[0]).toMatchObject({ edgeId: "night-gate", waitSeconds: 100 * 60, waitUntil: { weekday: "sun", minutes: 300, dayOffset: 0 } });
    expect(r.waitSeconds).toBe(100 * 60);
  });

  it("fails safely when the only link is never open long enough to cross", () => {
    // A 600 m passage (500 s) whose daily window lasts one minute.
    const brief = edge("brief", "start", "goal", { lengthM: 600, hours: { kind: "window", open: "05:00", close: "05:01", evidence: ev } });
    const router = createRouter(createSyntheticBundle([brief]));
    expect(router.route("start", "goal", { ...base, at: { weekday: "sun", minutes: 200 } })).toMatchObject({ ok: false, reason: "no_path" });
    // Without a departure time the window is only listed.
    expect(ok(router.route("start", "goal", base)).timeRestricted).toEqual([{ edgeId: "brief", open: "05:00", close: "05:01" }]);
  });
});

describe("freshness and labelling", () => {
  it("reports the oldest source date and a stale verdict relative to today", () => {
    const b = createSyntheticBundle();
    b.sources.find((s) => s.id === "fixture-geometry")!.datasetDate = "2019-01-28";
    b.sources.find((s) => s.id === "fixture-access")!.datasetDate = "2026-09-17";
    const router = createRouter(b);
    const r = ok(router.route("start", "goal", { ...base, today: "2026-10-20" }));
    expect(r.oldestSourceDate).toBe("2019-01-28");
    expect(r.stale).toBe(true);
    expect(ok(router.route("start", "goal", { ...base, today: "2026-10-20", staleAfterDays: 5000 })).stale).toBe(false);
    expect(ok(router.route("start", "goal", base)).stale).toBeNull();
  });

  it("returns stale = null for undated sources instead of implying freshness", () => {
    const r = ok(createRouter(createSyntheticBundle()).route("start", "goal", { ...base, today: "2026-10-20" }));
    expect(r.oldestSourceDate).toBeNull();
    expect(r.stale).toBeNull();
  });

  it("labels synthetic routes and real verified routes distinctly", () => {
    expect(ok(createRouter(createSyntheticBundle()).route("start", "goal")).synthetic).toBe(true);
    const real = createSyntheticBundle([edge("v", "start", "goal", { verification: "verified" })]);
    real.station.synthetic = false;
    expect(ok(createRouter(real).route("start", "goal")).synthetic).toBe(false);
  });

  it("lists operators in traversal order for cross-operator transfers", () => {
    const r = ok(createRouter(createSyntheticBundle([edge("t", "start", "other")])).route("start", "other"));
    expect(r.operatorIds).toEqual(["operator-a", "operator-b"]);
  });
});

describe("wrong way and direction", () => {
  it("never travels a one-way edge backwards", () => {
    const router = createRouter(createSyntheticBundle([edge("esc", "start", "upper", { mode: "escalator", direction: "forward" })]));
    expect(ok(router.route("start", "upper")).steps).toHaveLength(1);
    expect(router.route("upper", "start")).toMatchObject({ ok: false, reason: "no_path" });
  });
});
