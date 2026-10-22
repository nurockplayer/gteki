import { describe, expect, it } from "vitest";
import type { Edge, Poi, StationBundle } from "@gteki/schema";
import { createRouter, explainNoPath, explainNoPathBetween, explainNoPathWith, routeBetween } from "./index.ts";
import type { NoPathCause, RouteProfile, Router } from "./index.ts";
import { createSyntheticBundle, syntheticEdge as edge } from "./fixtures.ts";

const base: RouteProfile = { fare: "ticketed", stepFree: false };

/** A router that counts `route()` calls. */
function counted(edges: Edge[]): { router: Router; bundle: StationBundle; calls: () => number } {
  const bundle = createSyntheticBundle(edges);
  const inner = createRouter(bundle);
  let n = 0;
  const router: Router = { ...inner, route: (...args) => { n++; return inner.route(...args); } };
  return { router, bundle, calls: () => n };
}

/** Asserts the query really is a `no_path` under `profile`, then explains it; returns the cause and the extra calls. */
function explain(edges: Edge[], profile: RouteProfile): { cause: NoPathCause; extra: number } {
  const { router, bundle, calls } = counted(edges);
  expect(router.route("start", "goal", profile)).toMatchObject({ ok: false, reason: "no_path" });
  const before = calls();
  const cause = explainNoPath(router, bundle, "start", "goal", profile);
  return { cause, extra: calls() - before };
}

const flat = (id: string, from: string, to: string, o: Partial<Edge> = {}) => edge(id, from, to, o);
const opt = (option: string, evidence: string | null, complete = true) => ({ option, evidence, complete });

describe("explainNoPath: single options and their evidence", () => {
  it("step-free: the only link is a stair (known not step-free)", () => {
    const { cause, extra } = explain([edge("s1", "start", "a", { mode: "stairs" }), flat("s2", "a", "goal")], { ...base, stepFree: true });
    expect(cause).toEqual({ kind: "option", options: [opt("stepFree", "known")] });
    expect(extra).toBe(1);
  });

  it("step-free: wheelchair access unevidenced is UNKNOWN, not known-inaccessible", () => {
    const unsurveyed = [flat("u1", "start", "a", { wheelchair: null, steps: null }), flat("u2", "a", "goal")];
    expect(explain(unsurveyed, { ...base, stepFree: true }).cause).toEqual({ kind: "option", options: [opt("stepFree", "unknown")] });
    // Same when the access evidence itself is missing: every flag is UNKNOWN.
    const noEvidence = [flat("e1", "start", "a", { accessEvidence: null }), flat("e2", "a", "goal")];
    expect(explain(noEvidence, { ...base, stepFree: true }).cause).toEqual({ kind: "option", options: [opt("stepFree", "unknown")] });
  });

  it("step-free: a flat passage recorded as not wheelchair-accessible is known, not unknown", () => {
    expect(explain([flat("k1", "start", "goal", { wheelchair: false })], { ...base, stepFree: true }).cause).toEqual({ kind: "option", options: [opt("stepFree", "known")] });
  });

  it("step-free: an unsurveyed passage plus a stair, both refusing, is mixed", () => {
    const edges = [flat("m1", "start", "a", { wheelchair: null }), edge("m2", "a", "goal", { mode: "stairs" })];
    expect(explain(edges, { ...base, stepFree: true }).cause).toEqual({ kind: "option", options: [opt("stepFree", "mixed")] });
  });

  it("evidence comes from the refusing edges only: an unknown fact on an edge step-free accepts is ignored", () => {
    // `steps` is UNKNOWN on the second edge, but step-free only refuses it for steps === true / wheelchair !== true.
    const edges = [edge("r1", "start", "a", { mode: "stairs" }), flat("r2", "a", "goal", { steps: null })];
    expect(explain(edges, { ...base, stepFree: true }).cause).toEqual({ kind: "option", options: [opt("stepFree", "known")] });
    // A stair whose access flags are unknown is still a known refusal (the mode is known).
    const stair = [edge("r3", "start", "goal", { mode: "stairs", wheelchair: null, steps: null })];
    expect(explain(stair, { ...base, stepFree: true }).cause).toEqual({ kind: "option", options: [opt("stepFree", "known")] });
  });

  it("evidence ignores unknowns that belong to another option (unknown hours on a step-free refusal)", () => {
    const edges = [flat("o1", "start", "a", { hours: null, mode: "stairs" }), flat("o2", "a", "goal")];
    expect(explain(edges, { ...base, stepFree: true }).cause).toEqual({ kind: "option", options: [opt("stepFree", "known")] });
  });

  it("outside gates: a known fare-gate crossing is known; an unknown crossing is unknown", () => {
    const gate = [flat("g1", "start", "goal", { paid: true, crossesFareBoundary: true })];
    expect(explain(gate, { ...base, fare: "unpaid_only" }).cause).toEqual({ kind: "option", options: [opt("unpaidOnly", "known")] });
    const unsure = [flat("g2", "start", "goal", { paid: null, crossesFareBoundary: null })];
    expect(explain(unsure, { ...base, fare: "unpaid_only" }).cause).toEqual({ kind: "option", options: [opt("unpaidOnly", "unknown")] });
  });

  it("verified hours only: the link has unknown hours", () => {
    const { cause, extra } = explain([flat("h1", "start", "goal", { hours: null })], { ...base, hours: "require_known" });
    expect(cause).toEqual({ kind: "option", options: [opt("strictHours", "unknown")] });
    expect(extra).toBe(1);
  });

  it("avoided modes: the only link is an avoided escalator", () => {
    const { cause } = explain([edge("esc", "start", "goal", { mode: "escalator" })], { ...base, avoidModes: ["escalator"] });
    expect(cause).toEqual({ kind: "option", options: [opt("avoidModes", "known")] });
  });

  it("an edge the explainer cannot look up makes the attribution incomplete and says nothing about the facts", () => {
    const { router, bundle } = counted([edge("s", "start", "goal", { mode: "stairs" })]);
    const cause = explainNoPathWith((p) => router.route("start", "goal", p), { ...base, stepFree: true }, { router, bundle: { edges: [] } });
    expect(cause).toEqual({ kind: "option", options: [opt("stepFree", null, false)] });
  });

  it("attribution ignores waits: an edge reached after waiting for its window still counts as refused by the option only", () => {
    const window = { kind: "window" as const, open: "05:00", close: "23:00", evidence: { sourceIds: ["fixture-access"], method: "synthetic-fixture", checkedDate: "2026-10-20" } };
    const edges = [flat("w1", "start", "a", { hours: window }), edge("w2", "a", "goal", { mode: "stairs" })];
    const profile: RouteProfile = { ...base, stepFree: true, at: { weekday: "mon", minutes: 60 } };
    expect(explain(edges, profile).cause).toEqual({ kind: "option", options: [opt("stepFree", "known")] });
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
    expect(cause).toEqual({ kind: "option", options: [opt("stepFree", "known"), opt("strictHours", "unknown")] });
    expect(extra).toBe(2); // no all-relaxed retry once a single option works
  });

  it("only enabled options are considered (outside-gates off is not a suspect)", () => {
    const { cause } = explain(twoRoutes, { ...base, stepFree: true, hours: "require_known", fare: "ticketed" });
    expect((cause as { options: { option: string }[] }).options.map((o) => o.option)).toEqual(["stepFree", "strictHours"]);
  });

  it("a combination: relaxing either option alone is not enough, both together is", () => {
    const edges = [edge("c1", "start", "a", { mode: "stairs" }), flat("c2", "a", "goal", { hours: null })];
    const { cause, extra } = explain(edges, { ...base, stepFree: true, hours: "require_known" });
    expect(cause).toEqual({ kind: "combination", options: ["stepFree", "strictHours"] });
    expect(extra).toBe(3); // 2 singles + all relaxed = enabled + 1
  });

  it("none: the points are not connected even with everything relaxed", () => {
    const { cause, extra } = explain([flat("only", "start", "a")], { ...base, stepFree: true, fare: "unpaid_only", hours: "require_known" });
    expect(cause).toEqual({ kind: "none", relaxed: ["stepFree", "unpaidOnly", "strictHours"] });
    expect(extra).toBe(4); // 3 singles + all relaxed
  });

  it("none with one option enabled costs a single retry (all-relaxed is that same query)", () => {
    const { cause, extra } = explain([flat("only", "start", "a")], { ...base, stepFree: true });
    expect(cause).toEqual({ kind: "none", relaxed: ["stepFree"] });
    expect(extra).toBe(1);
  });

  it("a closed edge stays closed, and closures and the departure time are not options", () => {
    expect(explain([flat("closed", "start", "goal", { closed: true })], { ...base, stepFree: true }).cause).toEqual({ kind: "none", relaxed: ["stepFree"] });
    const { router, bundle } = counted([flat("x", "start", "goal")]);
    const seen: RouteProfile[] = [];
    explainNoPathWith((p) => { seen.push(p); return router.route("start", "a", p); }, { ...base, stepFree: true, at: { weekday: "mon", minutes: 60 }, today: "2026-10-22", extraClosedEdgeIds: ["x"] }, { router, bundle });
    expect(seen[0]).toEqual({ ...base, stepFree: false, at: { weekday: "mon", minutes: 60 }, today: "2026-10-22", extraClosedEdgeIds: ["x"] });
  });
});

describe("explainNoPath: no restrictive option, search_limit, purity", () => {
  it("an untouched profile is none immediately, with no router call", () => {
    const { router, bundle, calls } = counted([flat("only", "start", "a")]);
    expect(explainNoPath(router, bundle, "start", "goal", base)).toEqual({ kind: "none", relaxed: [] });
    expect(explainNoPath(router, bundle, "start", "goal", { ...base, hours: "warn_unknown", avoidModes: [] })).toEqual({ kind: "none", relaxed: [] });
    expect(calls()).toBe(0);
  });

  const limit = { ok: false as const, reason: "search_limit" as const, message: "limit" };
  const none = { ok: false as const, reason: "no_path" as const, message: "none" };

  it("a search_limit retry is skipped over: another option that succeeds is still reported", () => {
    const { router, bundle } = counted([edge("s", "start", "goal", { mode: "stairs" })]);
    let n = 0;
    // Option 1 (stepFree) hits the limit, option 2 (strictHours) finds the route.
    const cause = explainNoPathWith((p) => (++n === 1 ? limit : router.route("start", "goal", { ...p, stepFree: false })), { ...base, stepFree: true, hours: "require_known" }, { router, bundle });
    expect(cause.kind).toBe("option");
    expect((cause as { options: { option: string }[] }).options.map((o) => o.option)).toEqual(["strictHours"]);
  });

  it("is unknown only when nothing succeeded and some retry hit search_limit, never a guess", () => {
    const { router, bundle } = counted([flat("only", "start", "a")]);
    const profile = { ...base, stepFree: true, hours: "require_known" as const };
    expect(explainNoPathWith(() => limit, { ...base, stepFree: true }, { router, bundle })).toEqual({ kind: "unknown" });
    expect(explainNoPathWith(() => limit, profile, { router, bundle })).toEqual({ kind: "unknown" });
    let n = 0;
    expect(explainNoPathWith(() => (++n === 1 ? limit : none), profile, { router, bundle })).toEqual({ kind: "unknown" });
    // And on the all-relaxed retry.
    n = 0;
    expect(explainNoPathWith(() => (++n <= 2 ? none : limit), profile, { router, bundle })).toEqual({ kind: "unknown" });
  });

  it("does not change the router's own answer or the caller's profile", () => {
    const { router, bundle } = counted([edge("s", "start", "goal", { mode: "stairs" })]);
    const profile: RouteProfile = Object.freeze({ ...base, stepFree: true, avoidModes: Object.freeze(["escalator"]) as never });
    const before = router.route("start", "goal", profile);
    explainNoPath(router, bundle, "start", "goal", profile);
    expect(router.route("start", "goal", profile)).toEqual(before);
    expect(profile.stepFree).toBe(true);
  });
});

describe("explainNoPathBetween: endpoint refusals", () => {
  const unpaid: RouteProfile = { ...base, fare: "unpaid_only" };
  const world = () => {
    const c = counted([flat("start-goal", "start", "goal")]);
    const [toilet, exit] = [c.bundle.pois.find((p) => p.id === "toilet")!, c.bundle.pois.find((p) => p.id === "exit-a1")!];
    return { ...c, toilet, exit };
  };
  const withPaid = (poi: Poi, paid: boolean | null): Poi => ({ ...poi, paid });

  it("a destination inside the gates is an endpoint cause, found without any router call", () => {
    const { router, bundle, calls, toilet, exit } = world();
    const inside = withPaid(toilet, true);
    expect(routeBetween(router, { kind: "poi", poi: exit }, inside, unpaid)).toMatchObject({ ok: false, reason: "no_path" });
    const before = calls();
    expect(explainNoPathBetween(router, bundle, { kind: "poi", poi: exit }, inside, unpaid)).toEqual({ kind: "endpoint", ends: [{ end: "destination", paid: true }] });
    expect(calls() - before).toBe(0);
  });

  it("a destination not known to be outside is told apart from one known to be inside", () => {
    const { router, bundle, toilet, exit } = world();
    expect(explainNoPathBetween(router, bundle, { kind: "poi", poi: exit }, withPaid(toilet, null), unpaid)).toEqual({ kind: "endpoint", ends: [{ end: "destination", paid: null }] });
  });

  it("names both ends when both are refused; a bare node origin is never refused", () => {
    const { router, bundle, toilet, exit } = world();
    expect(explainNoPathBetween(router, bundle, { kind: "poi", poi: withPaid(exit, true) }, withPaid(toilet, null), unpaid))
      .toEqual({ kind: "endpoint", ends: [{ end: "origin", paid: true }, { end: "destination", paid: null }] });
    expect(explainNoPathBetween(router, bundle, { kind: "node", nodeId: "start" }, withPaid(toilet, true), unpaid))
      .toEqual({ kind: "endpoint", ends: [{ end: "destination", paid: true }] });
  });

  it("endpoints are only checked under unpaid_only; known-outside endpoints fall through to the passages", () => {
    const { router, bundle, toilet, exit } = world();
    // Ticketed: a paid destination is no refusal (and the route exists), so nothing endpoint-shaped is reported.
    expect(explainNoPathBetween(router, bundle, { kind: "poi", poi: exit }, withPaid(toilet, true), base)).toEqual({ kind: "none", relaxed: [] });
    // Unpaid, both endpoints known outside: the passages decide (here the only link is a gate).
    const gated = counted([flat("gate", "start", "a", { paid: true, crossesFareBoundary: true }), flat("a-goal", "a", "goal")]);
    const [t, e] = [gated.bundle.pois.find((p) => p.id === "toilet")!, gated.bundle.pois.find((p) => p.id === "exit-a1")!];
    expect(routeBetween(gated.router, { kind: "poi", poi: e }, { ...t, connectorNodeIds: ["goal"] }, unpaid)).toMatchObject({ ok: false, reason: "no_path" });
    expect(explainNoPathBetween(gated.router, gated.bundle, { kind: "poi", poi: e }, { ...t, connectorNodeIds: ["goal"] }, unpaid))
      .toEqual({ kind: "option", options: [opt("unpaidOnly", "known")] });
  });
});
