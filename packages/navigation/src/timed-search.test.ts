import { describe, expect, it } from "vitest";
import { parseStationFiles } from "@gteki/schema";
import type { Edge, StationBundle, Weekday } from "@gteki/schema";
import { createRouter } from "./index.ts";
import type { RouteProfile, RouteResult } from "./index.ts";
import { createRouterForTest } from "./router.ts";
import { createSyntheticBundle, syntheticEdge as edge } from "./fixtures.ts";
import shinjukuManifest from "../../../stations/shinjuku/gteki/station.json" with { type: "json" };
import shinjukuGraph from "../../../stations/shinjuku/gteki/graph.json" with { type: "json" };
import shinjukuPois from "../../../stations/shinjuku/gteki/pois.json" with { type: "json" };
import ikebukuroManifest from "../../../stations/ikebukuro/gteki/station.json" with { type: "json" };
import ikebukuroGraph from "../../../stations/ikebukuro/gteki/graph.json" with { type: "json" };
import ikebukuroPois from "../../../stations/ikebukuro/gteki/pois.json" with { type: "json" };

/**
 * The clock-dependent search: the 366-day horizon is UNKNOWN (never no_path), and lower-bound pruning solves
 * graphs whose Pareto sets used to exhaust the work budget while returning exactly what the unpruned search does.
 */
const base: RouteProfile = { fare: "ticketed", stepFree: false };
const MON_0: RouteProfile = { ...base, at: { weekday: "mon", minutes: 0 } };
const EVIDENCE = { sourceIds: ["fixture-access"], method: "synthetic-fixture", checkedDate: "2026-10-20" };
const win = (open: string, close: string, days?: Weekday[]): NonNullable<Edge["hours"]> =>
  ({ kind: "window", open, close, ...(days ? { days } : {}), evidence: EVIDENCE });
const unprunedOf = (b: StationBundle) => createRouterForTest(b, { unpruned: true });

function ok(r: ReturnType<ReturnType<typeof createRouter>["route"]>): RouteResult {
  if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
  return r;
}

describe("the clock horizon is UNKNOWN, not no_path (#25)", () => {
  /** `passages` successive 50 s passages (60 m), each open only Monday 00:00-00:01: one per week. */
  function weekly(passages: number, last = "goal") {
    const node = createSyntheticBundle([]).nodes.find((x) => x.id === "a")!;
    const b = createSyntheticBundle([]);
    const id = (i: number) => (i === 0 ? "start" : i === passages ? last : `w${i}`);
    for (let i = 1; i < passages; i++) b.nodes.push({ ...node, id: `w${i}` });
    for (let i = 0; i < passages; i++) b.edges.push(edge(`p${i}`, id(i), id(i + 1), { direction: "forward", lengthM: 60, hours: win("00:00", "00:01", ["mon"]) }));
    return b;
  }

  it("reports a route that finishes after the horizon as search_limit naming it", () => {
    // 54 passages: the last is entered 53 weeks (371 days) in, past the 366-day horizon.
    for (const router of [createRouter(weekly(54)), unprunedOf(weekly(54))]) {
      const r = router.route("start", "goal", MON_0);
      expect(r).toMatchObject({ ok: false, reason: "search_limit" });
      expect(r.ok ? "" : r.message).toMatch(/366-day clock horizon/);
    }
  });

  it("still finds the route that fits the horizon", () => {
    // 53 passages: the last is entered 52 weeks (364 days) in.
    const r = ok(createRouter(weekly(53)).route("start", "goal", MON_0));
    expect(r.steps).toHaveLength(53);
    expect(r.steps.at(-1)!.waitUntil).toEqual({ weekday: "mon", minutes: 0, dayOffset: 364 });
  });

  it("keeps no_path when the search proves there is none", () => {
    // Nothing connects the weekly chain to the goal.
    const b = weekly(54, "w-end");
    expect(createRouter(b).route("start", "goal", MON_0)).toMatchObject({ ok: false, reason: "no_path" });
    // Every way on is closed: a window with no open day ends the search at once.
    const never = createSyntheticBundle([edge("gate", "start", "goal", { mode: "gate", lengthM: 0, hours: win("05:00", "06:00", []) })]);
    expect(createRouter(never).route("start", "goal", MON_0)).toMatchObject({ ok: false, reason: "no_path" });
    // A mode the profile avoids is no way on either.
    const stairsOnly = createSyntheticBundle([edge("up", "start", "a", { mode: "stairs", lengthM: 10 }), edge("g", "a", "goal", { hours: win("05:00", "06:00") })]);
    expect(createRouter(stairsOnly).route("start", "goal", { ...MON_0, avoidModes: ["stairs"] })).toMatchObject({ ok: false, reason: "no_path" });
  });

  it("does not call a dead-end branch past the horizon UNKNOWN", () => {
    // The only way to the goal never opens; the 54-week chain beside it leads nowhere, so dropping it proves nothing.
    const b = weekly(54, "dead-end");
    b.nodes.push({ ...b.nodes.find((n) => n.id === "a")!, id: "dead-end" });
    b.edges.push(edge("to-a", "start", "a", { lengthM: 5 }), edge("closed-gate", "a", "goal", { mode: "gate", lengthM: 0, hours: win("05:00", "06:00", []) }));
    expect(createRouter(b).route("start", "goal", MON_0)).toMatchObject({ ok: false, reason: "no_path" });
  });

  it("does not return a route dearer than anything dropped at the horizon", () => {
    // A 300-day walk (≈31 M cost) beside the 54-week chain (≈24 M, but it ends past the horizon): the chain may be
    // cheaper, so the walk is not known to be the best route.
    const b = weekly(54);
    b.edges.push(edge("long-walk", "start", "goal", { lengthM: 1.2 * 300 * 86_400, hours: win("00:00", "24:00") }));
    for (const router of [createRouter(b), unprunedOf(b)]) {
      const r = router.route("start", "goal", MON_0);
      expect(r).toMatchObject({ ok: false, reason: "search_limit" });
      expect(r.ok ? "" : r.message).toMatch(/horizon/);
    }
    // Without the chain, the walk is simply the route.
    const only = createSyntheticBundle([edge("long-walk", "start", "goal", { lengthM: 1.2 * 300 * 86_400, hours: win("00:00", "24:00") })]);
    expect(createRouter(only).route("start", "goal", MON_0)).toMatchObject({ ok: true });
  });
});

/**
 * `rungs` successive escalator-or-walk alternatives from "start" (an escalator of `a` m, or a 1.4× longer and
 * faster walk: cheaper and slower vs dearer and quicker, so no combination dominates another), then `gate`
 * to "goal". `a` is spread over 10-18 m, so every subset of walks sums to its own arrival time and cost.
 */
function ladder(rungs: number, gate: NonNullable<Edge["hours"]> = win("00:00", "24:00"), tailM = 0): { bundle: StationBundle; cheapest: string[] } {
  const b = createSyntheticBundle([]);
  const node = b.nodes.find((x) => x.id === "a")!;
  const at = (i: number) => (i === 0 ? "start" : `d${i}`);
  for (let i = 1; i <= rungs; i++) b.nodes.push({ ...node, id: `d${i}` });
  for (let i = 0; i < rungs; i++) {
    const escalator = 10 + 8 * ((i * 0.6180339887) % 1);
    b.edges.push(
      edge(`esc-${i}`, at(i), at(i + 1), { mode: "escalator", direction: "forward", lengthM: escalator }),
      edge(`walk-${i}`, at(i), at(i + 1), { direction: "forward", lengthM: 1.4 * escalator }),
    );
  }
  b.edges.push(edge("gate", at(rungs), "goal", { mode: "gate", lengthM: tailM, hours: gate }));
  return { bundle: b, cheapest: [...Array.from({ length: rungs }, (_, i) => `esc-${i}`), "gate"] };
}

describe("lower-bound pruning solves graphs that used to exhaust the work budget (#24)", () => {
  const at = { ...base, at: { weekday: "mon" as const, minutes: 8 * 60 } };

  it("routes the 16-node, 29-edge ladder (14 rungs) at the minimum cost", () => {
    const { bundle, cheapest } = ladder(14, undefined, 100);
    expect(bundle.edges).toHaveLength(29);
    const r = ok(createRouter(bundle).route("start", "goal", at));
    expect(r.steps.map((s) => s.edgeId)).toEqual(cheapest);
    expect(r.waitSeconds).toBe(0);
    // ... which the unpruned search could not decide.
    expect(unprunedOf(bundle).route("start", "goal", at)).toMatchObject({ ok: false, reason: "search_limit" });
    // Without `at`, plain Dijkstra picks the same route.
    expect(ok(createRouter(bundle).route("start", "goal", base)).steps.map((s) => s.edgeId)).toEqual(cheapest);
  }, 30_000);

  it("routes the 23-node variant (21 rungs)", () => {
    const { bundle, cheapest } = ladder(21, undefined, 100);
    expect(ok(createRouter(bundle).route("start", "goal", at)).steps.map((s) => s.edgeId)).toEqual(cheapest);
  }, 30_000);

  it("still waits for a window the bound ignores, and agrees with the unpruned search while it can", () => {
    for (const rungs of [2, 5, 8]) {
      // Open only 10:00-10:02 on Tuesday: every route waits, whichever rungs it takes.
      const { bundle } = ladder(rungs, win("10:00", "10:02", ["tue"]));
      const r = ok(createRouter(bundle).route("start", "goal", at));
      expect(r.steps.at(-1)!.waitUntil).toMatchObject({ weekday: "tue", minutes: 600 });
      expect(JSON.stringify(r)).toBe(JSON.stringify(ok(unprunedOf(bundle).route("start", "goal", at))));
    }
  }, 30_000);

  it("keeps search_limit when a cheap path stays uncertain until late", () => {
    // The gate is open only 00:00-00:06 on the departure morning and the all-escalator route is too slow for it, so
    // which of the 2^24 cost/time trade-offs makes it is decided only at the gate: the lower bound (hours ignored)
    // is no help, and a day's wait (≈65 k cost) never beats a combination that makes it.
    const { bundle } = ladder(24, win("00:00", "00:06", ["mon"]));
    for (const router of [createRouter(bundle), unprunedOf(bundle)]) {
      const r = router.route("start", "goal", MON_0);
      expect(r).toMatchObject({ ok: false, reason: "search_limit" });
      expect(r.ok ? "" : r.message).toMatch(/work limit/);
    }
    // A shorter ladder of the same shape is solved, the same either way.
    const small = ladder(7, win("00:00", "00:02", ["mon"])).bundle;
    const pruned = ok(createRouter(small).route("start", "goal", MON_0));
    expect(JSON.stringify(pruned)).toBe(JSON.stringify(ok(unprunedOf(small).route("start", "goal", MON_0))));
  }, 60_000);

  it("solves the 2^18 escalator/walk diamond chain that used to be search_limit", () => {
    // review.test.ts's former exhaustion fixture: 18 diamonds scaled by powers of two, an escalator or a 1.4× walk.
    const n = 18;
    const b = createSyntheticBundle([]);
    const node = b.nodes.find((x) => x.id === "a")!;
    for (let i = 0; i <= n; i++) b.nodes.push({ ...node, id: `d${i}` });
    for (let i = 0; i < n; i++) {
      b.nodes.push({ ...node, id: `m${i}` });
      b.edges.push(
        edge(`esc-${i}`, `d${i}`, `d${i + 1}`, { mode: "escalator", direction: "forward", lengthM: 10 * 2 ** i }),
        edge(`walk-${i}-1`, `d${i}`, `m${i}`, { lengthM: 7 * 2 ** i }),
        edge(`walk-${i}-2`, `m${i}`, `d${i + 1}`, { lengthM: 7 * 2 ** i }),
      );
    }
    b.edges.push(edge("start-d0", "start", "d0", { lengthM: 1 }), edge("gate", `d${n}`, "goal", { mode: "gate", lengthM: 0, hours: win("00:00", "24:00") }));
    expect(unprunedOf(b).route("start", "goal", MON_0)).toMatchObject({ ok: false, reason: "search_limit" });
    expect(ok(createRouter(b).route("start", "goal", MON_0)).steps.map((s) => s.edgeId)).toEqual(["start-d0", ...Array.from({ length: n }, (_, i) => `esc-${i}`), "gate"]);
  }, 30_000);

  it("keeps the work budget per edge tried at one very wide node", () => {
    // 2,000 parallel week-long passages, each cheaper than the last, so no edge is ever ruled out by cost: trying
    // them all would sample 20 million minutes.
    const b = createSyntheticBundle(Array.from({ length: 2000 }, (_, i) =>
      edge(`p${String(i).padStart(4, "0")}`, "start", "goal", { lengthM: 725_760 + 2000 - i, hours: win("00:00", "24:00") })));
    expect(createRouter(b).route("start", "goal", MON_0)).toMatchObject({ ok: false, reason: "search_limit" });
    // Dearer ones are skipped on their cost alone, before any hours are sampled.
    const dearer = createSyntheticBundle(Array.from({ length: 2000 }, (_, i) =>
      edge(`p${String(i).padStart(4, "0")}`, "start", "goal", { lengthM: 725_760 + i, hours: win("00:00", "24:00") })));
    expect(ok(createRouter(dearer).route("start", "goal", MON_0)).steps[0]!.edgeId).toBe("p0000");
  }, 30_000);
});

/** mulberry32: a small seeded PRNG, so every failure names a reproducible seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    chance: (p: number) => next() < p,
  };
}
type Rng = ReturnType<typeof rng>;
const WEEK: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const hm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

function randomHours(r: Rng): Edge["hours"] {
  const roll = r.next();
  if (roll < 0.12) return null;
  if (roll < 0.3) return { kind: "always", evidence: EVIDENCE };
  const open = r.int(0, 287) * 5;
  const length = r.chance(0.45) ? r.int(1, 30) : r.int(30, 1000);
  const days = r.chance(0.5) ? undefined : WEEK.filter(() => r.chance(0.4));
  return win(hm(open), hm(open + length), days);
}

function randomGraph(r: Rng): { bundle: StationBundle; ids: string[] } {
  const bundle = createSyntheticBundle([]);
  const node = bundle.nodes.find((x) => x.id === "a")!;
  const n = r.int(5, 14);
  const ids = Array.from({ length: n }, (_, i) => `v${i}`);
  for (const id of ids) bundle.nodes.push({ ...node, id });
  const modes = ["walk", "walk", "walk", "stairs", "escalator", "escalator", "elevator", "ramp", "moving_walkway", "gate"] as const;
  const m = r.int(n, 3 * n);
  for (let i = 0; i < m; i++) {
    const mode = r.pick(modes);
    bundle.edges.push(edge(`e${i}`, r.pick(ids), r.pick(ids), {
      mode, direction: r.chance(0.65) ? "both" : "forward", lengthM: mode === "gate" ? r.pick([0, 0, 3]) : r.int(1, 40),
      hours: randomHours(r), closed: r.chance(0.04),
    }));
  }
  return { bundle, ids };
}

function randomProfile(r: Rng): RouteProfile {
  return {
    fare: "ticketed", stepFree: r.chance(0.15),
    ...(r.chance(0.15) ? { avoidModes: [r.pick(["stairs", "escalator", "walk"] as const)] } : {}),
    ...(r.chance(0.2) ? { hours: "require_known" as const } : {}),
    at: { weekday: r.pick(WEEK), minutes: r.int(0, 1439) + r.pick([0, 0, 0.25, 0.5]) },
  };
}

describe("pruned and unpruned searches agree (differential)", () => {
  it("returns the identical result on seeded random graphs whenever the unpruned search finishes", () => {
    const stats = { compared: 0, ok: 0, waits: 0, noPath: 0, unprunedLimit: 0, prunedLimit: 0 };
    const mismatches: string[] = [];
    for (let seed = 1; seed <= Number(process.env.GTEKI_DIFF_SEEDS ?? 400); seed++) {
      const r = rng(seed);
      const { bundle, ids } = randomGraph(r);
      const pruned = createRouter(bundle);
      const reference = unprunedOf(bundle);
      for (let q = 0; q < 3; q++) {
        const from = r.chance(0.3) ? [r.pick(ids), r.pick(ids)] : r.pick(ids);
        const to = r.chance(0.3) ? [r.pick(ids), r.pick(ids)] : r.pick(ids);
        const profile = randomProfile(r);
        const expected = reference.route(from, to, profile);
        const actual = pruned.route(from, to, profile);
        stats.compared++;
        if (!expected.ok && expected.reason === "search_limit") {
          stats.unprunedLimit++;
          continue;
        }
        if (!actual.ok && actual.reason === "search_limit") stats.prunedLimit++;
        if (JSON.stringify(actual) !== JSON.stringify(expected)) mismatches.push(`seed ${seed} query ${q}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
        if (expected.ok) {
          stats.ok++;
          if (expected.waitSeconds > 0) stats.waits++;
        } else if (expected.reason === "no_path") stats.noPath++;
      }
    }
    expect(mismatches).toEqual([]);
    expect(stats.prunedLimit).toBe(0);
    // The sample is not vacuous: routes, waits and failures are all there.
    expect(stats.ok).toBeGreaterThan(200);
    expect(stats.waits).toBeGreaterThan(40);
    expect(stats.noPath).toBeGreaterThan(100);
    console.info("timed-search differential:", JSON.stringify(stats));
  }, 120_000);

  it("agrees on ladders of random size, window and departure", () => {
    const mismatches: string[] = [];
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(1000 + seed);
      const open = r.int(0, 24) * 60;
      const { bundle } = ladder(r.int(1, 9), win(hm(open), hm(open + r.int(1, 90)), r.chance(0.5) ? undefined : [r.pick(WEEK)]));
      const profile = randomProfile(r);
      const expected = unprunedOf(bundle).route("start", "goal", profile);
      if (!expected.ok && expected.reason === "search_limit") continue;
      if (JSON.stringify(createRouter(bundle).route("start", "goal", profile)) !== JSON.stringify(expected)) mismatches.push(`seed ${seed}`);
    }
    expect(mismatches).toEqual([]);
  }, 120_000);
});

describe("station-scale timed queries", () => {
  const stations = [
    ["shinjuku", shinjukuManifest, shinjukuGraph, shinjukuPois],
    ["ikebukuro", ikebukuroManifest, ikebukuroGraph, ikebukuroPois],
  ] as const;

  it.each(stations)("%s: pruning changes nothing the unpruned search could decide", (name, manifest, graph, pois) => {
    const parsed = parseStationFiles(manifest, graph, pois);
    if (!parsed.ok) throw new Error(`${name} failed to parse`);
    const bundle = parsed.bundle;
    // The published bundles carry no opening windows yet: give a seeded share of the edges daily ones.
    const r = rng(name.length * 7919);
    for (const e of bundle.edges) if (r.chance(0.3)) e.hours = randomHours(r);
    if (!bundle.edges.some((e) => e.hours?.kind === "window")) throw new Error("expected some windows");
    const pruned = createRouter(bundle);
    const reference = unprunedOf(bundle);
    const endpoints = bundle.pois.map((p) => p.connectorNodeIds).filter((ids) => ids.length > 0);
    let compared = 0;
    let routed = 0;
    for (let q = 0; q < 8; q++) {
      const from = r.pick(endpoints);
      const to = r.pick(endpoints);
      const profile = randomProfile(r);
      const expected = reference.route(from, to, profile);
      const actual = pruned.route(from, to, profile);
      compared++;
      if (!expected.ok && expected.reason === "search_limit") continue;
      expect(actual.ok ? "ok" : actual.reason, `${name} query ${q}`).toBe(expected.ok ? "ok" : expected.reason);
      expect(JSON.stringify(actual), `${name} query ${q}`).toBe(JSON.stringify(expected));
      if (expected.ok) routed++;
    }
    expect(compared).toBe(8);
    expect(routed).toBeGreaterThan(0);
    console.info(`station-scale ${name}:`, JSON.stringify({ compared, routed, edges: bundle.edges.length, windows: bundle.edges.filter((e) => e.hours?.kind === "window").length }));
  }, 60_000);
});
