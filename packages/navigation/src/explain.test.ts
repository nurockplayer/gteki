import { describe, expect, it } from "vitest";
import type { Edge } from "@gteki/schema";
import { createRouter, explainNoPath, explainNoPathWith } from "./index.ts";
import type { NoPathCause, RouteProfile, Router } from "./index.ts";
import { createSyntheticBundle, syntheticEdge as edge } from "./fixtures.ts";

const base: RouteProfile = { fare: "ticketed", stepFree: false };

/** A router that counts `route()` calls. */
function counted(edges: Edge[]): { router: Router; calls: () => number } {
  const inner = createRouter(createSyntheticBundle(edges));
  let n = 0;
  const router: Router = { ...inner, route: (...args) => { n++; return inner.route(...args); } };
  return { router, calls: () => n };
}

/** Asserts the query really is a `no_path` under `profile`, then explains it; returns the cause and the extra calls. */
function explain(edges: Edge[], profile: RouteProfile): { cause: NoPathCause; extra: number } {
  const { router, calls } = counted(edges);
  expect(router.route("start", "goal", profile)).toMatchObject({ ok: false, reason: "no_path" });
  const before = calls();
  const cause = explainNoPath(router, "start", "goal", profile);
  return { cause, extra: calls() - before };
}

// A route that is flat, step-free, outside the gates, always open and evidenced: nothing restricts it.
const flat = (id: string, from: string, to: string, o: Partial<Edge> = {}) => edge(id, from, to, o);

describe("explainNoPath: single options", () => {
  it("step-free: the only link is a stair (known not step-free)", () => {
    const { cause, extra } = explain([edge("s1", "start", "a", { mode: "stairs" }), flat("s2", "a", "goal")], { ...base, stepFree: true });
    expect(cause).toEqual({ kind: "option", options: [{ option: "stepFree", evidence: "known" }] });
    expect(extra).toBe(1);
  });

  it("step-free: wheelchair access unevidenced is UNKNOWN, not known-inaccessible", () => {
    const unsurveyed = [flat("u1", "start", "a", { wheelchair: null, steps: null }), flat("u2", "a", "goal")];
    expect(explain(unsurveyed, { ...base, stepFree: true }).cause).toEqual({ kind: "option", options: [{ option: "stepFree", evidence: "unknown" }] });
    // Same when the access evidence itself is missing: every flag is UNKNOWN.
    const noEvidence = [flat("e1", "start", "a", { accessEvidence: null }), flat("e2", "a", "goal")];
    expect(explain(noEvidence, { ...base, stepFree: true }).cause).toEqual({ kind: "option", options: [{ option: "stepFree", evidence: "unknown" }] });
  });

  it("step-free: a flat passage recorded as not wheelchair-accessible is known, not unknown", () => {
    const { cause } = explain([flat("k1", "start", "goal", { wheelchair: false })], { ...base, stepFree: true });
    expect(cause).toEqual({ kind: "option", options: [{ option: "stepFree", evidence: "known" }] });
  });

  it("step-free: a route with both an unsurveyed passage and a stair is mixed", () => {
    const edges = [flat("m1", "start", "a", { wheelchair: null }), edge("m2", "a", "goal", { mode: "stairs" })];
    expect(explain(edges, { ...base, stepFree: true }).cause).toEqual({ kind: "option", options: [{ option: "stepFree", evidence: "mixed" }] });
  });

  it("outside gates: a known fare-gate crossing is known; an unknown crossing is unknown", () => {
    const gate = [flat("g1", "start", "goal", { paid: true, crossesFareBoundary: true })];
    expect(explain(gate, { ...base, fare: "unpaid_only" }).cause).toEqual({ kind: "option", options: [{ option: "unpaidOnly", evidence: "known" }] });
    const unsure = [flat("g2", "start", "goal", { paid: null, crossesFareBoundary: null })];
    expect(explain(unsure, { ...base, fare: "unpaid_only" }).cause).toEqual({ kind: "option", options: [{ option: "unpaidOnly", evidence: "unknown" }] });
  });

  it("verified hours only: the link has unknown hours", () => {
    const { cause, extra } = explain([flat("h1", "start", "goal", { hours: null })], { ...base, hours: "require_known" });
    expect(cause).toEqual({ kind: "option", options: [{ option: "strictHours", evidence: "unknown" }] });
    expect(extra).toBe(1);
  });

  it("avoided modes: the only link is an avoided escalator", () => {
    const { cause } = explain([edge("esc", "start", "goal", { mode: "escalator" })], { ...base, avoidModes: ["escalator"] });
    expect(cause).toEqual({ kind: "option", options: [{ option: "avoidModes", evidence: "known" }] });
  });
});

describe("explainNoPath: several options", () => {
  // Two disjoint routes: one stair (blocks step-free only), one with unknown hours (blocks strict hours only).
  const twoRoutes = [
    edge("stairs-1", "start", "a", { mode: "stairs" }), flat("stairs-2", "a", "goal"),
    flat("night-1", "start", "b", { hours: null }), flat("night-2", "b", "goal"),
  ];

  it("lists every option that is sufficient on its own", () => {
    const { cause, extra } = explain(twoRoutes, { ...base, stepFree: true, hours: "require_known" });
    expect(cause).toEqual({ kind: "option", options: [{ option: "stepFree", evidence: "known" }, { option: "strictHours", evidence: "unknown" }] });
    expect(extra).toBe(2); // no all-relaxed retry once a single option works
  });

  it("only enabled options are considered (outside-gates off is not a suspect)", () => {
    const { cause } = explain(twoRoutes, { ...base, stepFree: true, hours: "require_known", fare: "ticketed" });
    expect((cause as { options: { option: string }[] }).options.map((o) => o.option)).toEqual(["stepFree", "strictHours"]);
  });

  it("a combination: relaxing either option alone is not enough, both together is", () => {
    // One link blocks step-free, the next blocks strict hours: there is only one way through.
    const edges = [edge("c1", "start", "a", { mode: "stairs" }), flat("c2", "a", "goal", { hours: null })];
    const { cause, extra } = explain(edges, { ...base, stepFree: true, hours: "require_known" });
    expect(cause).toEqual({ kind: "combination", options: ["stepFree", "strictHours"] });
    expect(extra).toBe(3); // 2 singles + all relaxed = enabled + 1
  });

  it("none: the points are not connected even with everything relaxed", () => {
    const { cause, extra } = explain([flat("only", "start", "a")], { ...base, stepFree: true, fare: "unpaid_only", hours: "require_known" });
    expect(cause).toEqual({ kind: "none" });
    expect(extra).toBe(4); // 3 singles + all relaxed
  });

  it("none with one option enabled costs a single retry (all-relaxed is that same query)", () => {
    const { cause, extra } = explain([flat("only", "start", "a")], { ...base, stepFree: true });
    expect(cause).toEqual({ kind: "none" });
    expect(extra).toBe(1);
  });

  it("a closed edge stays closed: closures and the departure time are not options", () => {
    const edges = [flat("closed", "start", "goal", { closed: true })];
    expect(explain(edges, { ...base, stepFree: true }).cause).toEqual({ kind: "none" });
    const { router } = counted([flat("x", "start", "goal")]);
    const seen: RouteProfile[] = [];
    explainNoPathWith((p) => { seen.push(p); return router.route("start", "a", p); }, { ...base, stepFree: true, at: { weekday: "mon", minutes: 60 }, today: "2026-10-22", extraClosedEdgeIds: ["x"] });
    expect(seen[0]).toEqual({ ...base, stepFree: false, at: { weekday: "mon", minutes: 60 }, today: "2026-10-22", extraClosedEdgeIds: ["x"] });
  });
});

describe("explainNoPath: no restrictive option, search_limit, purity", () => {
  it("an untouched profile is none immediately, with no router call", () => {
    const { router, calls } = counted([flat("only", "start", "a")]);
    expect(explainNoPath(router, "start", "goal", base)).toEqual({ kind: "none" });
    expect(explainNoPath(router, "start", "goal", { ...base, hours: "warn_unknown", avoidModes: [] })).toEqual({ kind: "none" });
    expect(calls()).toBe(0);
  });

  it("a retry that hits search_limit makes the cause unknown, never a guess", () => {
    const limit = { ok: false as const, reason: "search_limit" as const, message: "limit" };
    const found = explain([edge("s", "start", "goal", { mode: "stairs" })], { ...base, stepFree: true }).cause;
    expect(found.kind).toBe("option"); // control: the same shape resolves when the router answers
    expect(explainNoPathWith(() => limit, { ...base, stepFree: true })).toEqual({ kind: "unknown" });
    // A later search_limit overrides an earlier success: the option list would be incomplete.
    const { router } = counted([edge("s", "start", "goal", { mode: "stairs" })]);
    let n = 0;
    expect(explainNoPathWith((p) => (++n === 1 ? router.route("start", "goal", p) : limit), { ...base, stepFree: true, hours: "require_known" })).toEqual({ kind: "unknown" });
    // And on the all-relaxed retry.
    n = 0;
    const none = { ok: false as const, reason: "no_path" as const, message: "none" };
    expect(explainNoPathWith(() => (++n <= 2 ? none : limit), { ...base, stepFree: true, hours: "require_known" })).toEqual({ kind: "unknown" });
  });

  it("does not change the router's own answer or the caller's profile", () => {
    const edges = [edge("s", "start", "goal", { mode: "stairs" })];
    const { router } = counted(edges);
    const profile: RouteProfile = Object.freeze({ ...base, stepFree: true, avoidModes: Object.freeze(["escalator"]) as never });
    const before = router.route("start", "goal", profile);
    explainNoPath(router, "start", "goal", profile);
    expect(router.route("start", "goal", profile)).toEqual(before);
    expect(profile.stepFree).toBe(true);
  });
});
