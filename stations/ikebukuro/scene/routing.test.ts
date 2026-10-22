// G2 evidence: the @gteki/navigation core routing matrix, run on the committed Ikebukuro bundle
// (gteki/station.json + graph.json + pois.json, parsed with parseStationFiles like the web app does).
//
// Already covered elsewhere, not repeated: packages/navigation router/present/review/truth tests on synthetic
// bundles; timed-search.test.ts "station-scale timed queries" (pruned vs unpruned search on this bundle with
// seeded random windows); Lane F goldens I1-I7 / IN1-IN5 (browser). This file adds what those do not: the
// matrix's rows asserted on the real Ikebukuro data.
//
// Mutations (closed link, one-way) are applied to a freshly parsed COPY of the bundle, so they show how the router
// treats the real graph under a changed fact; they are not claims about the real station.
//
// Not applicable to Ikebukuro, so no case here (premise asserted in "matrix rows that do not apply"):
//  - fare-paid boundary: all 63 edges are paid=false / crossesFareBoundary=false (fare-paid concourses are not modelled);
//  - cross-operator: every floor belongs to the single operator "public".
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStationFiles, type Edge, type StationBundle } from "@gteki/schema";
import { createRouter, describeRoute, routeBetween } from "../../../packages/navigation/src/index.ts";

const read = (f: string): unknown => JSON.parse(fs.readFileSync(new URL(`../gteki/${f}`, import.meta.url), "utf8"));
/** A fresh parse each call, so a test may mutate its bundle freely. */
function load(): StationBundle {
  const parsed = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"));
  if (!parsed.ok || !parsed.bundle) throw new Error("Ikebukuro bundle failed to parse");
  return parsed.bundle;
}
const TICKETED = { fare: "ticketed", stepFree: false } as const;
const edgeOf = (b: StationBundle, id: string): Edge => b.edges.find((e) => e.id === id)!;

// I1 in Lane F's goldens: JR Central Gate 2 -> Exit 35.
const FROM = "g_jr_c2";
const TO = "x35";
const I1_NODES = ["g_jr_c2", "c_g2", "c_c", "c_e1", "c_n", "c_e2", "e_27j", "e_hall", "e_low", "x35"];

describe("shortest path", () => {
  const bundle = load();
  const router = createRouter(bundle);

  it("JR Central Gate 2 -> Exit 35 is the golden route: 9 edges, 198.6 m, one floor change, two stair edges", () => {
    const r = router.route(FROM, TO, TICKETED);
    if (!r.ok) throw new Error(r.message);
    expect(r.nodeIds).toEqual(I1_NODES);
    expect(r.totalLengthM).toBeCloseTo(198.6, 6);
    expect(r.floorChanges).toBe(1);
    expect(r.steps.map((s) => s.mode)).toEqual(["walk", "walk", "walk", "walk", "walk", "walk", "walk", "stairs", "stairs"]);
    expect(r.synthetic).toBe(false);
  });

  it("is cheapest: for every pair of routable endpoints the route costs what an independent Dijkstra says (stairs 1.6 x length)", () => {
    const cost = (e: Edge) => e.lengthM! * (e.mode === "stairs" ? 1.6 : 1);
    const adj = new Map<string, { to: string; edge: Edge }[]>();
    for (const e of bundle.edges) {
      expect(e.lengthM, e.id).not.toBeNull();
      expect(e.direction, e.id).toBe("both"); // undirected here; one-way is exercised on a copy below
      for (const [a, b] of [[e.from, e.to], [e.to, e.from]] as const) (adj.get(a) ?? adj.set(a, []).get(a)!).push({ to: b, edge: e });
    }
    const dijkstra = (src: string) => {
      const dist = new Map<string, number>([[src, 0]]);
      const todo = new Set(adj.keys());
      while (todo.size) {
        let u: string | undefined;
        for (const n of todo) if (dist.has(n) && (u === undefined || dist.get(n)! < dist.get(u)!)) u = n;
        if (u === undefined) break;
        todo.delete(u);
        for (const { to, edge } of adj.get(u)!) {
          const d = dist.get(u)! + cost(edge);
          if (d < (dist.get(to) ?? Infinity)) dist.set(to, d);
        }
      }
      return dist;
    };
    const ends = [...new Set(bundle.pois.flatMap((p) => p.connectorNodeIds))];
    expect(ends.length).toBeGreaterThan(30);
    const pathCost = (ids: string[]) => ids.slice(1).reduce((sum, id, i) => {
      const e = bundle.edges.find((x) => (x.from === ids[i] && x.to === id) || (x.to === ids[i] && x.from === id))!;
      return sum + cost(e);
    }, 0);
    let pairs = 0;
    for (const a of ends) {
      const dist = dijkstra(a);
      for (const b of ends) {
        if (a === b) continue;
        const r = router.route(a, b, TICKETED);
        if (!r.ok) throw new Error(`${a} -> ${b}: ${r.reason}`);
        expect(pathCost(r.nodeIds), `${a} -> ${b}`).toBeCloseTo(dist.get(b)!, 6);
        expect(r.nodeIds[0]).toBe(a);
        expect(r.nodeIds.at(-1)).toBe(b);
        pairs++;
      }
    }
    expect(pairs).toBeGreaterThan(900);
  });

  it("a route is symmetric on an undirected graph: the reverse trip uses the same nodes backwards", () => {
    const fwd = router.route(FROM, TO, TICKETED);
    const back = router.route(TO, FROM, TICKETED);
    if (!fwd.ok || !back.ok) throw new Error("expected both routes");
    expect(back.nodeIds).toEqual([...fwd.nodeIds].reverse());
    expect(back.totalLengthM).toBeCloseTo(fwd.totalLengthM, 6);
  });
});

describe("no path / refusals", () => {
  const bundle = load();
  const router = createRouter(bundle);

  it("unknown ids and start == goal fail with their own reasons", () => {
    expect(router.route("nope", TO, TICKETED)).toMatchObject({ ok: false, reason: "unknown_start" });
    expect(router.route(FROM, "nope", TICKETED)).toMatchObject({ ok: false, reason: "unknown_goal" });
    expect(router.route(FROM, FROM, TICKETED)).toMatchObject({ ok: false, reason: "start_equals_goal" });
  });

  it("a search-only POI (no verified connector) refuses to route rather than guessing an entrance", () => {
    const searchOnly = bundle.pois.filter((p) => p.connectorNodeIds.length === 0);
    expect(searchOnly.length).toBe(21); // 6 gates (incl. Yurakucho South Passage West Gate) and 15 exit numbers, per the gap list
    const exit35 = bundle.pois.find((p) => p.id === "exit-35")!;
    const gate = bundle.pois.find((p) => p.id === "jr-central-gate-2")!;
    const tobu = bundle.pois.find((p) => p.id === "tobu-central-gate-2")!;
    expect(routeBetween(router, { kind: "poi", poi: gate }, tobu, TICKETED)).toMatchObject({ ok: false, reason: "unknown_goal" });
    expect(routeBetween(router, { kind: "poi", poi: tobu }, exit35, TICKETED)).toMatchObject({ ok: false, reason: "unknown_start" });
    expect(routeBetween(router, { kind: "poi", poi: gate }, exit35, TICKETED)).toMatchObject({ ok: true });
  });

  it("Yurakucho South Passage West Gate is searchable but has no edge, so it refuses to route to Exit 4", () => {
    const gate = bundle.pois.find((p) => p.id === "metro-y-south-west-gate")!;
    const exit4 = bundle.pois.find((p) => p.id === "exit-4")!;
    expect(gate.names.some((n) => n.text === "有楽町線 南通路西改札")).toBe(true);
    expect(gate.connectorNodeIds).toEqual([]);
    expect(routeBetween(router, { kind: "poi", poi: gate }, exit4, TICKETED)).toMatchObject({ ok: false, reason: "unknown_start" });
    expect(routeBetween(router, { kind: "poi", poi: exit4 }, gate, TICKETED)).toMatchObject({ ok: false, reason: "unknown_goal" });
  });

  it("an unreachable goal is no_path, not search_limit (the only way to Exit 35's stair foot is cut)", () => {
    const b = load();
    edgeOf(b, "e_low__x35").closed = true;
    expect(createRouter(b).route(FROM, TO, TICKETED)).toMatchObject({ ok: false, reason: "no_path" });
  });
});

describe("one-way (wrong-way) edges", () => {
  it("Ikebukuro publishes no one-way edges, so wrong-way cannot arise from the real data", () => {
    expect(load().edges.filter((e) => e.direction !== "both")).toEqual([]);
  });

  it("on a copy where Exit 35's last stair is made one-way, the forward trip works and the reverse refuses", () => {
    const b = load();
    const last = edgeOf(b, "e_low__x35");
    expect([last.from, last.to]).toEqual(["e_low", "x35"]);
    last.direction = "forward";
    const router = createRouter(b);
    expect(router.route(FROM, TO, TICKETED)).toMatchObject({ ok: true });
    expect(router.route(TO, FROM, TICKETED)).toMatchObject({ ok: false, reason: "no_path" });
    // the stair's own traversal direction is never reported as reversed on the forward trip
    const fwd = router.route("e_low", TO, TICKETED);
    if (!fwd.ok) throw new Error(fwd.message);
    expect(fwd.steps.map((s) => s.reversed)).toEqual([false]);
  });
});

describe("closed link", () => {
  const baseline = (() => {
    const r = createRouter(load()).route(FROM, TO, TICKETED);
    if (!r.ok) throw new Error(r.message);
    return r;
  })();

  it("a closed edge on a loop is rerouted around, at a longer length, and is never entered", () => {
    const b = load();
    edgeOf(b, "c_c__c_e1").closed = true; // on the central passage; the station's one big loop gives a way round
    const r = createRouter(b).route(FROM, TO, TICKETED);
    if (!r.ok) throw new Error(r.message);
    expect(r.steps.map((s) => s.edgeId)).not.toContain("c_c__c_e1");
    expect(r.nodeIds[0]).toBe(FROM);
    expect(r.nodeIds.at(-1)).toBe(TO);
    expect(r.totalLengthM).toBeGreaterThan(baseline.totalLengthM * 2);
  });

  it("closing it for the query (profile.extraClosedEdgeIds) gives the identical route as closing it in the data", () => {
    const b = load();
    edgeOf(b, "c_c__c_e1").closed = true;
    const inData = createRouter(b).route(FROM, TO, TICKETED);
    const perQuery = createRouter(load()).route(FROM, TO, { ...TICKETED, extraClosedEdgeIds: ["c_c__c_e1"] });
    if (!inData.ok || !perQuery.ok) throw new Error("expected reroutes");
    expect(perQuery.nodeIds).toEqual(inData.nodeIds);
    expect(perQuery.totalLengthM).toBe(inData.totalLengthM);
  });

  it("a closed edge with no way round (a spur) is no_path", () => {
    const b = load();
    edgeOf(b, "e_27j__e_hall").closed = true;
    expect(createRouter(b).route(FROM, TO, TICKETED)).toMatchObject({ ok: false, reason: "no_path" });
    expect(createRouter(load()).route(FROM, TO, { ...TICKETED, extraClosedEdgeIds: ["e_27j__e_hall"] })).toMatchObject({ ok: false, reason: "no_path" });
  });
});

describe("level transition", () => {
  const bundle = load();
  const route = (() => {
    const r = createRouter(bundle).route(FROM, TO, TICKETED);
    if (!r.ok) throw new Error(r.message);
    return r;
  })();

  it("the route climbs by stairs from B1 to street level: step floors change on the last edge, floorChanges counts it", () => {
    const stairs = route.steps.filter((s) => s.mode === "stairs");
    expect(stairs.map((s) => s.edgeId)).toEqual(["e_hall__e_low", "e_low__x35"]);
    const last = route.steps.at(-1)!;
    expect([last.fromFloorId, last.toFloorId]).toEqual(["b1", "street"]);
    expect(route.floorChanges).toBe(1);
    // stairs are costed and timed as stairs: 0.5 m/s on the stairs, 1.2 m/s walking
    const walkM = route.steps.filter((s) => s.mode === "walk").reduce((m, s) => m + s.lengthM, 0);
    const stairM = stairs.reduce((m, s) => m + s.lengthM, 0);
    expect(route.estimatedSeconds).toBeCloseTo(walkM / 1.2 + stairM / 0.5, 0);
  });

  it("the narration names the stairs in both languages, down-then-up (the dip is real) and ends at street level", () => {
    const ja = describeRoute(bundle, route, "ja");
    const en = describeRoute(bundle, route, "en");
    const stairsJa = ja.filter((i) => i.kind === "stairs");
    expect(stairsJa.map((i) => i.vertical)).toEqual(["down", "up"]);
    expect(stairsJa.at(-1)!.toFloorId).toBe("street");
    expect(stairsJa.at(-1)!.text).toContain("地上");
    const stairsEn = en.filter((i) => i.kind === "stairs");
    expect(stairsEn).toHaveLength(2);
    expect(stairsEn.map((i) => i.text.toLowerCase()).join(" ")).toMatch(/stairs/);
    expect(en[0]!.kind).toBe("start");
    expect(en.at(-1)!.kind).toBe("arrive");
    // every route step is narrated exactly once
    const covered = en.flatMap((i) => i.stepIndexes).sort((a, b) => a - b);
    expect(covered).toEqual(route.steps.map((_, i) => i));
  });
});

describe("freshness (stale data)", () => {
  const router = createRouter(load());
  const at = (today?: string, staleAfterDays?: number) => {
    const r = router.route(FROM, TO, { ...TICKETED, ...(today ? { today } : {}), ...(staleAfterDays ? { staleAfterDays } : {}) });
    if (!r.ok) throw new Error(r.message);
    return r;
  };

  it("reports its evidence dates: oldest source 2022-01 (Toshima guide), checked 2026-10-22, no undated or expired source", () => {
    const r = at("2026-10-22");
    expect(r.oldestSourceDate).toBe("2022-01");
    expect(r.evidenceCheckedDate).toBe("2026-10-22");
    expect(r.undatedSourceIds).toEqual([]);
    expect(r.expiredSourceIds).toEqual([]);
  });

  it("is stale on 2026-10-22 under the default 730 days (a 2022 guide), fresh when the guide is recent, and not evaluable with no date", () => {
    expect(at("2026-10-22").stale).toBe(true);
    expect(at("2023-06-01").stale).toBe(false);
    expect(at(undefined).stale).toBeNull();
    expect(at("2026-10-22", 3650).stale).toBe(false);
  });
});

describe("strict hours and step-free", () => {
  const bundle = load();
  const router = createRouter(bundle);

  it("opening hours are unknown on every edge: the default warns (hours unknown), strict require_known fails closed", () => {
    expect(bundle.edges.every((e) => e.hours === null)).toBe(true);
    const warn = router.route(FROM, TO, TICKETED);
    if (!warn.ok) throw new Error(warn.message);
    expect(warn.unknowns.find((u) => u.kind === "hours")!.edgeIds).toHaveLength(warn.steps.length);
    expect(warn.timeRestricted).toEqual([]);
    expect(router.route(FROM, TO, { ...TICKETED, hours: "require_known" })).toMatchObject({ ok: false, reason: "no_path" });
  });

  it("a departure time cannot open unknown hours: with `at` and the default it still routes with hours unknown, never as open", () => {
    const r = router.route(FROM, TO, { ...TICKETED, at: { weekday: "mon", minutes: 600 } });
    if (!r.ok) throw new Error(r.message);
    expect(r.unknowns.some((u) => u.kind === "hours")).toBe(true);
    expect(r.waitSeconds).toBe(0);
  });

  it("step-free fails closed: wheelchair access is unknown (null) on every edge, so even the flat walk to the gate stair foot has none", () => {
    expect(bundle.edges.every((e) => e.wheelchair === null)).toBe(true);
    expect(router.route(FROM, TO, { ...TICKETED, stepFree: true })).toMatchObject({ ok: false, reason: "no_path" });
    expect(router.route(FROM, "c_e2", { ...TICKETED, stepFree: true })).toMatchObject({ ok: false, reason: "no_path" });
  });

  it("avoiding stairs removes every exit stair: Exit 35 is unreachable, the flat passage still routes", () => {
    expect(router.route(FROM, TO, { ...TICKETED, avoidModes: ["stairs"] })).toMatchObject({ ok: false, reason: "no_path" });
    expect(router.route(FROM, "c_e2", { ...TICKETED, avoidModes: ["stairs"] })).toMatchObject({ ok: true });
  });
});

describe("matrix rows that do not apply to Ikebukuro (premise asserted, no routing case)", () => {
  const bundle = load();
  it("fare-paid boundary: no edge is paid or crosses a fare boundary, so unpaid_only changes nothing", () => {
    expect(bundle.edges.filter((e) => e.paid !== false || e.crossesFareBoundary !== false)).toEqual([]);
    const router = createRouter(bundle);
    const a = router.route(FROM, TO, TICKETED);
    const b = router.route(FROM, TO, { fare: "unpaid_only", stepFree: false });
    expect(JSON.stringify({ ...b, profile: null })).toBe(JSON.stringify({ ...a, profile: null }));
  });

  it("cross-operator: every floor belongs to the one operator 'public'", () => {
    expect(new Set(bundle.floors.map((f) => f.operatorId))).toEqual(new Set(["public"]));
    const r = createRouter(bundle).route(FROM, TO, TICKETED);
    if (!r.ok) throw new Error(r.message);
    expect(r.operatorIds).toEqual(["public"]);
  });
});

// #161: the in-app PLATEAU credit is the Owner's Q10 Option A string (Ikebukuro keeps real TP heights, so no
// base-adjustment parenthetical), and the unverified "CC BY 4.0" label is never shown.
describe("PLATEAU source credit (#161)", () => {
  const source = load().sources.find((s) => s.id === "plateau-ubld-13116")!;

  it("uses the Option A string, with no CC BY label and no Shinjuku base-adjustment parenthetical", () => {
    expect(source.attribution).toBe("出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成");
    expect(source.attribution).not.toMatch(/CC[ -]?BY/i);
    expect(source.attribution).not.toContain("建物の基部");
    expect(source.license?.name ?? "").not.toMatch(/CC[ -]?BY/i);
    expect(source.license?.url).toBe("https://www.mlit.go.jp/plateau/site-policy/");
  });
});
