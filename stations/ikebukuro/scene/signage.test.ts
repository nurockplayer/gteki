// Wayfinding cue coverage (#108): along the two guided legs there is a distinct, graph-grounded cue (a sign, a
// junction or a POI node) in every 30 m window, on the committed signage.json. Node only: no DOM, no GPU.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildSigns, EXIT_EN_EM, EXIT_JA_EM, FONT, LOW_TEXEL_SCALE, SMALL_EM, type SignSpec } from "./signs.ts";
import { parseStationFiles } from "@gteki/schema";
import { createRouter, routeBetween } from "../../../packages/navigation/src/index.ts";

const here = (p: string) => new URL(p, import.meta.url);
const json = (p: string) => JSON.parse(readFileSync(here(p), "utf8"));

type Edge = {
  id: string;
  from: string;
  to: string;
  direction: "both" | "forward";
  lengthM: number;
  verification: string;
  geometry: { x: number; y: number; z: number }[];
};
type Poi = { id: string; category: string; connectorNodeIds: string[] };
type Sign = SignSpec & { basis?: string[]; atNode: string };

const graph = json("../gteki/graph.json") as { nodes: { id: string; kind: string }[]; edges: Edge[] };
const pois = json("../gteki/pois.json").pois as Poi[];
const signs = json("./signage.json").signs as Sign[];

for (const script of ["test_sign_sightlines.py", "test_fitting_exclusion.py"]) it(`checks ${script} against station geometry (#308)`, () => {
  // The outer vitest command owns gteki-local-test.lock. The stdlib Python child
  // runs serially here; it reads the shipped GLB, not the gitignored ENU extract.
  const result = spawnSync("python3", ["-I", fileURLToPath(here(`../pipeline/${script}`))], { encoding: "utf8" });
  expect(result.signal, result.stderr).toBeNull();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stderr).not.toContain("expected failure");
}, 30_000);
// The two guided legs, routed live with the shared router (the same POI pairs as Lane F's I1 and I2 goldens), so a
// graph rebuild never leaves this test reading a stale e2e golden. Steps keep the golden's ">edge" / "<edge" form.
const bundle = (() => {
  const parsed = parseStationFiles(json("../gteki/station.json"), json("../gteki/graph.json"), json("../gteki/pois.json"));
  if (!parsed.ok || !parsed.bundle) throw new Error("Ikebukuro bundle failed to parse");
  return parsed.bundle;
})();
const router = createRouter(bundle);
function guided(from: string, to: string) {
  const poi = (id: string) => bundle.pois.find((p) => p.id === id)!;
  const r = routeBetween(router, { kind: "poi", poi: poi(from) }, poi(to), { fare: "ticketed", stepFree: false });
  if (!r.ok) throw new Error(`${from} -> ${to}: ${r.reason}`);
  return { from, to, result: { ok: true, steps: r.steps.map((s) => `${s.reversed ? "<" : ">"}${s.edgeId}`) } };
}
const edges = new Map(graph.edges.map((e) => [e.id, e]));
const REPEAT_EDGE = "sw_h__w_cj";

/** The two guided legs of #108: Lane F golden routes West Exit B1 -> Exit 4 and JR Central Gate 2 -> Exit 35. */
const LEGS = {
  "westb1-exit4": guided("west-exit-b1", "exit-4"),
  "jrc2-exit35": guided("jr-central-gate-2", "exit-35"),
};

type Pt = { x: number; y: number; cum: number };
function leg(steps: string[]) {
  const pts: Pt[] = [];
  const nodes: { cum: number; id: string }[] = [];
  let cum = 0;
  const edgeSpan: Record<string, [number, number]> = {};
  let endNode = "";
  for (const s of steps) {
    const rev = s[0] === "<";
    const e = edges.get(s.slice(1))!;
    const g = rev ? [...e.geometry].reverse() : e.geometry;
    nodes.push({ cum, id: rev ? e.to : e.from });
    const start = cum;
    g.forEach((p, i) => {
      if (pts.length && i === 0) return;
      if (pts.length) cum += Math.hypot(p.x - pts.at(-1)!.x, p.y - pts.at(-1)!.y);
      pts.push({ x: p.x, y: p.y, cum });
    });
    edgeSpan[e.id] = [start, cum];
    endNode = rev ? e.from : e.to;
  }
  nodes.push({ cum, id: endNode });
  return { pts, nodes, length: cum, edgeSpan };
}

/** Nearest point on the polyline: lateral distance, position along it (m), unit walking direction there. */
function project(pts: Pt[], x: number, y: number) {
  let best = { d: Infinity, c: 0, dir: [1, 0] as [number, number] };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
    const d = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
    if (d < best.d) {
      const l = Math.sqrt(l2);
      best = { d, c: a.cum + t * l, dir: [dx / l, dy / l] };
    }
  }
  return best;
}

const LATERAL_M = 12; // a sign this close to the path can be read
const FACING_MIN = 0.5; // |facing . walking| : face-on enough to read, either face
const WINDOW_M = 30;
const LOOKAHEAD_M = 12; // a sign this far beyond the window is already readable from inside it

/** Anchors (m along the leg) of signs readable from the leg. */
function signAnchors(l: ReturnType<typeof leg>, set: Sign[]) {
  const out: { c: number; id: string }[] = [];
  for (const s of set) {
    const p = project(l.pts, s.position.x, s.position.y);
    if (p.d > LATERAL_M) continue;
    if (Math.abs(p.dir[0] * s.facing.x + p.dir[1] * s.facing.y) < FACING_MIN) continue;
    out.push({ c: p.c, id: s.id });
  }
  return out.sort((a, b) => a.c - b.c);
}

/** Windows (start m) of the leg with no cue: a sign anchored in it or readable just ahead, or a node on the route. */
function emptyWindows(l: ReturnType<typeof leg>, set: Sign[]) {
  const sign = signAnchors(l, set).map((a) => a.c);
  const node = l.nodes.map((n) => n.cum);
  const empty: number[] = [];
  for (let w = 0; w < l.length; w += WINDOW_M) {
    const end = Math.min(w + WINDOW_M, l.length);
    const has = sign.some((c) => c >= w && c <= end + LOOKAHEAD_M) || node.some((c) => c >= w && c <= end);
    if (!has) empty.push(w);
  }
  return empty;
}

/** Largest gap between consecutive readable sign anchors in [lo, hi]; lo and hi themselves count as anchors. */
function maxGap(anchors: number[], lo: number, hi: number) {
  const a = [lo, ...anchors.filter((c) => c > lo && c < hi), hi];
  return Math.max(...a.slice(1).map((c, i) => c - a[i]!));
}

describe("ikebukuro wayfinding cues along the guided legs (#108)", () => {
  const legs = Object.fromEntries(Object.entries(LEGS).map(([k, g]) => [k, leg(g.result.steps)]));

  it("routes the same legs as Lane F's I1/I2 goldens", () => {
    expect(LEGS["westb1-exit4"]).toMatchObject({ from: "west-exit-b1", to: "exit-4" });
    expect(LEGS["jrc2-exit35"]).toMatchObject({ from: "jr-central-gate-2", to: "exit-35" });
    expect(legs["westb1-exit4"]!.length).toBeCloseTo(186.8, 0);
    expect(legs["westb1-exit4"]!.edgeSpan[REPEAT_EDGE]).toBeDefined();
  });

  for (const name of Object.keys(LEGS)) {
    it(`${name}: every ${WINDOW_M} m window has a cue`, () => {
      expect(emptyWindows(legs[name]!, signs)).toEqual([]);
    });

    it(`${name}: readable signs are at most ${WINDOW_M} m apart`, () => {
      const l = legs[name]!;
      const anchors = signAnchors(l, signs).map((a) => a.c);
      expect(maxGap(anchors, 0, l.length)).toBeLessThanOrEqual(WINDOW_M);
    });
  }

  it("the long West passage (sw_h__w_cj) has a readable sign at most 24 m apart along its whole length", () => {
    const l = legs["westb1-exit4"]!;
    const [lo, hi] = l.edgeSpan[REPEAT_EDGE]!;
    const anchors = signAnchors(l, signs).map((a) => a.c);
    expect(maxGap(anchors, lo, hi)).toBeLessThanOrEqual(24);
    expect(signs.filter((s) => s.kind === "repeat" && s.id.startsWith(`sign-rep-${REPEAT_EDGE}-`)).length).toBeGreaterThanOrEqual(4);
  });

  it("negative control: without the repeaters the West leg has empty windows and a long gap (the JR leg is unaffected)", () => {
    const base = signs.filter((s) => s.kind !== "repeat" && s.kind !== "place");
    const west = legs["westb1-exit4"]!;
    expect(emptyWindows(west, base).length).toBeGreaterThan(0);
    const [lo, hi] = west.edgeSpan[REPEAT_EDGE]!;
    expect(maxGap(signAnchors(west, base).map((a) => a.c), lo, hi)).toBeGreaterThan(30);
    expect(emptyWindows(legs["jrc2-exit35"]!, base)).toEqual([]);
  });

  it("repeaters: double-sided, capped, and sit on a verified edge between its end signs", () => {
    const rep = signs.filter((s) => s.kind === "repeat");
    expect(rep.length).toBeGreaterThan(0);
    for (const s of rep) {
      const m = /^sign-rep-(.+)-(\d+)$/.exec(s.id)!;
      const e = edges.get(m[1]!)!;
      expect(e.verification).toBe("verified");
      expect(e.lengthM).toBeGreaterThanOrEqual(100);
      expect(s.atNode).toBe(e.from);
      expect(s.exits.length).toBeLessThanOrEqual(3);
      expect(s.gates.length).toBeLessThanOrEqual(1);
      expect(s.back).toHaveLength(1);
      expect(s.back![0]!.arrow).toBe("up");
      expect(s.basis).toContain(`graph:${e.id}`);
      expect(s.basis!.some((b) => b.startsWith("fact:"))).toBe(true);
    }
    // ids are unique across the file
    expect(new Set(signs.map((s) => s.id)).size).toBe(signs.length);
  });
});

describe("ikebukuro repeater content comes from the verified graph (#108)", () => {
  const poiById = new Map(pois.map((p) => [p.id, p]));
  // Shortest walking distance from each node over verified edges, honouring one-way edges.
  const adj = new Map<string, { to: string; len: number }[]>();
  const link = (a: string, b: string, len: number) => adj.set(a, [...(adj.get(a) ?? []), { to: b, len }]);
  for (const e of graph.edges) {
    if (e.verification !== "verified") continue;
    link(e.from, e.to, e.lengthM);
    if (e.direction === "both") link(e.to, e.from, e.lengthM);
  }
  function dijkstra(src: string) {
    const dist = new Map([[src, 0]]);
    const todo = new Set([src]);
    while (todo.size) {
      const u = [...todo].reduce((a, b) => (dist.get(a)! <= dist.get(b)! ? a : b));
      todo.delete(u);
      for (const { to, len } of adj.get(u) ?? []) {
        const nd = dist.get(u)! + len;
        if (nd < (dist.get(to) ?? Infinity)) {
          dist.set(to, nd);
          todo.add(to);
        }
      }
    }
    return dist;
  }
  const toPoi = (dist: Map<string, number>, id: string) =>
    Math.min(...poiById.get(id)!.connectorNodeIds.map((c) => dist.get(c) ?? Infinity));

  it("every exit and gate on every sign is a POI with a connector node", () => {
    for (const s of signs) {
      const items = [...s.exits, ...s.gates, ...(s.back ?? []).flatMap((b) => [...b.exits, ...b.gates])];
      for (const it of items) {
        const p = poiById.get(it.id);
        expect(p, `${s.id}: ${it.id}`).toBeDefined();
        expect(p!.connectorNodeIds.length, `${s.id}: ${it.id}`).toBeGreaterThan(0);
        expect(p!.category).toMatch(/^(exit|ticket_gate)$/);
      }
    }
  });

  it("each distanceM equals the graph distance less the sign's position, within 5 m", () => {
    const rep = signs.filter((s) => s.kind === "repeat");
    expect(rep.length).toBeGreaterThan(0);
    for (const s of rep) {
      const e = edges.get(/^sign-rep-(.+)-\d+$/.exec(s.id)![1]!)!;
      // Position along the edge in graph metres (the polyline is a hair shorter than lengthM).
      let acc = 0;
      const poly: Pt[] = e.geometry.map((p, i) => {
        if (i) acc += Math.hypot(p.x - e.geometry[i - 1]!.x, p.y - e.geometry[i - 1]!.y);
        return { x: p.x, y: p.y, cum: acc };
      });
      const along = (project(poly, s.position.x, s.position.y).c / acc) * e.lengthM;
      const fromD = dijkstra(e.from), toD = dijkstra(e.to);
      const check = (list: { id: string; distanceM?: number }[], d: Map<string, number>, at: number) => {
        for (const it of list) {
          expect(it.distanceM, `${s.id}: ${it.id}`).toBeDefined();
          expect(Math.abs(it.distanceM! - (toPoi(d, it.id) - at)), `${s.id}: ${it.id}`).toBeLessThanOrEqual(5);
          expect(it.distanceM! % 5).toBe(0);
        }
      };
      check([...s.exits, ...s.gates], fromD, along);
      check([...s.back![0]!.exits, ...s.back![0]!.gates], toD, e.lengthM - along);
      // basis names the edge and every POI shown
      const shown = [...s.exits, ...s.gates, ...s.back![0]!.exits, ...s.back![0]!.gates].map((i) => `poi:${i.id}`);
      for (const b of shown) expect(s.basis).toContain(b);
    }
  });

  it("the walker's own cue is right: Exit 4 counts down along the West leg to the stair foot", () => {
    const l = leg(LEGS["westb1-exit4"].result.steps);
    const total = l.length;
    const counts = signs
      .filter((s) => s.kind === "repeat")
      .map((s) => ({ c: project(l.pts, s.position.x, s.position.y).c, d: s.back![0]!.exits.find((x) => x.id === "exit-4")?.distanceM }))
      .sort((a, b) => a.c - b.c);
    expect(counts.length).toBeGreaterThan(0);
    for (const x of counts) {
      expect(x.d).toBeDefined();
      expect(Math.abs(x.d! - (total - x.c))).toBeLessThanOrEqual(8); // leg length to the stair foot, within rounding and path offset
    }
    for (let i = 1; i < counts.length; i++) expect(counts[i]!.d!).toBeLessThan(counts[i - 1]!.d!);
  });
});

describe("ikebukuro place boards between the repeaters (#108)", () => {
  const poiById = new Map(pois.map((p) => [p.id, p]));
  const boards = signs.filter((s) => s.kind === "place");
  const west = leg(LEGS["westb1-exit4"].result.steps);
  const [lo, hi] = west.edgeSpan[REPEAT_EDGE]!;
  const edge = edges.get(REPEAT_EDGE)!;
  /** Positions along the leg of the readable signs of one kind inside the long passage. */
  const inPassage = (kind: "repeat" | "place" | "end") =>
    signAnchors(west, signs.filter((s) => (kind === "end" ? !s.kind : s.kind === kind)))
      .filter((a) => a.c >= lo - 0.01 && a.c <= hi + 0.01)
      .map((a) => a.c);

  it("every board names a B1 hall that is a POI with a connector node, on both faces, with a source", () => {
    expect(boards.length).toBeGreaterThanOrEqual(4);
    for (const b of boards) {
      expect(b.exits).toEqual([]);
      expect(b.gates).toEqual([]);
      expect(b.back).toHaveLength(1);
      for (const face of [b.places!, b.back![0]!.places!]) {
        expect(face.length, b.id).toBeGreaterThan(0);
        expect(face.length, b.id).toBeLessThanOrEqual(2);
        for (const it of face) {
          const p = poiById.get(it.id)!;
          expect(p, `${b.id}: ${it.id}`).toBeDefined();
          expect(p.category).toBe("other");
          expect(p.connectorNodeIds.length).toBeGreaterThan(0);
          expect(it.ja, it.id).toBeTruthy();
          expect(it.en, it.id).toBeTruthy();
          expect(b.basis).toContain(`poi:${it.id}`);
        }
      }
      expect(b.basis).toContain(`graph:${REPEAT_EDGE}`);
      expect(b.basis!.some((x) => x.startsWith("fact:"))).toBe(true);
    }
  });

  it("names only halls, not passages (a passage's connector is an arbitrary junction inside it)", () => {
    const named = new Set(boards.flatMap((b) => [...b.places!, ...b.back![0]!.places!].map((x) => x.id)));
    expect([...named].sort()).toEqual(["west-exit-b1", "west-exit-south-b1"]);
  });

  it("each distance is the graph walk to the hall's connector less the sign's position, within 5 m", () => {
    // Verified edges except the passage itself (a hall is reached from its end nodes, not through the signed edge).
    const adj = new Map<string, { to: string; len: number }[]>();
    const link = (a: string, b: string, len: number) => adj.set(a, [...(adj.get(a) ?? []), { to: b, len }]);
    for (const e of graph.edges) {
      if (e.verification !== "verified" || e.id === edge.id) continue;
      link(e.from, e.to, e.lengthM);
      if (e.direction === "both") link(e.to, e.from, e.lengthM);
    }
    const dijkstra = (src: string) => {
      const dist = new Map([[src, 0]]);
      const todo = new Set([src]);
      while (todo.size) {
        const u = [...todo].reduce((a, b) => (dist.get(a)! <= dist.get(b)! ? a : b));
        todo.delete(u);
        for (const { to, len } of adj.get(u) ?? []) {
          if (dist.get(u)! + len < (dist.get(to) ?? Infinity)) {
            dist.set(to, dist.get(u)! + len);
            todo.add(to);
          }
        }
      }
      return dist;
    };
    const fromEnd = dijkstra(edge.from), toEnd = dijkstra(edge.to);
    let acc = 0;
    const poly: Pt[] = edge.geometry.map((p, i) => {
      if (i) acc += Math.hypot(p.x - edge.geometry[i - 1]!.x, p.y - edge.geometry[i - 1]!.y);
      return { x: p.x, y: p.y, cum: acc };
    });
    const hall = (id: string, d: Map<string, number>) => Math.min(...poiById.get(id)!.connectorNodeIds.map((c) => d.get(c) ?? Infinity));
    for (const b of boards) {
      const along = (project(poly, b.position.x, b.position.y).c / acc) * edge.lengthM;
      for (const it of b.places!) {
        expect(Math.abs(it.distanceM! - (hall(it.id, toEnd) + edge.lengthM - along)), `${b.id}: ${it.id}`).toBeLessThanOrEqual(5);
        expect(it.distanceM! % 5).toBe(0);
      }
      for (const it of b.back![0]!.places!) {
        expect(Math.abs(it.distanceM! - (hall(it.id, fromEnd) + along)), `${b.id}: ${it.id}`).toBeLessThanOrEqual(5);
        expect(it.distanceM! % 5).toBe(0);
      }
    }
  });

  it("the long passage alternates direction signs and place boards: neither kind twice in a row", () => {
    const rep = inPassage("repeat");
    const place = inPassage("place");
    expect(place.length).toBe(boards.length);
    const all = [...rep.map((c) => ({ c, k: "direction" })), ...place.map((c) => ({ c, k: "place" }))].sort((a, b) => a.c - b.c);
    // from the first repeater to the last board; the end signs sit in the junction zones
    for (let i = 1; i < all.length; i++) expect(all[i]!.k, `at ${all[i]!.c.toFixed(1)} m`).not.toBe(all[i - 1]!.k);
  });

  it("a readable sign every 14 m or less along the long passage, and every 30 m window holds both kinds", () => {
    const anchors = signAnchors(west, signs).map((a) => a.c);
    expect(maxGap(anchors, lo, hi)).toBeLessThanOrEqual(14);
    const rep = inPassage("repeat"), place = inPassage("place");
    for (let w = lo; w + WINDOW_M <= hi; w += 10) {
      expect(rep.some((c) => c >= w && c <= w + WINDOW_M), `direction sign in ${w.toFixed(0)}-${(w + WINDOW_M).toFixed(0)} m`).toBe(true);
      expect(place.some((c) => c >= w && c <= w + WINDOW_M), `place board in ${w.toFixed(0)}-${(w + WINDOW_M).toFixed(0)} m`).toBe(true);
    }
  });

  it("boards keep clear of the repeaters (at least 5.5 m along the passage)", () => {
    const rep = inPassage("repeat");
    for (const c of inPassage("place")) for (const r of rep) expect(Math.abs(c - r)).toBeGreaterThanOrEqual(5.5);
  });

  it("negative control: without the boards the passage has no second kind of sign", () => {
    expect(new Set(boards.map((b) => b.kind))).toEqual(new Set(["place"]));
    const without = signs.filter((s) => s.kind !== "place");
    expect(without.some((s) => (s.places ?? []).length > 0)).toBe(false);
    expect(maxGap(signAnchors(west, without).map((a) => a.c), lo, hi)).toBeGreaterThan(14);
  });
});

// Every added sign cites a source id: the graph edge, the POIs it names and a documented access fact.
describe("ikebukuro sign provenance (#108)", () => {
  const edgeIds = new Set(graph.edges.map((e) => `graph:${e.id}`));
  const poiIds = new Set(pois.map((p) => p.id));
  const src = json("../data/graph.src.json") as { accessFacts: { id: string }[] };
  const facts = new Set(src.accessFacts.map((f) => f.id));

  it("every repeater and place board cites a verified graph edge, the POIs it names and an access fact", () => {
    const added = signs.filter((s) => s.kind);
    expect(added.length).toBeGreaterThanOrEqual(10);
    for (const s of added) {
      expect(s.basis, s.id).toBeDefined();
      for (const b of s.basis!) {
        const kind = b.slice(0, b.indexOf(":"));
        const id = b.slice(b.indexOf(":") + 1);
        if (kind === "graph") expect(edgeIds.has(b), `${s.id}: ${b}`).toBe(true);
        else if (kind === "poi") expect(poiIds.has(id), `${s.id}: ${b}`).toBe(true);
        else if (kind === "fact") expect(facts.has(id), `${s.id}: ${b}`).toBe(true);
        else throw new Error(`${s.id}: unknown basis ${b}`);
      }
      const shown = [
        ...s.exits, ...s.gates, ...(s.places ?? []),
        ...(s.back ?? []).flatMap((x) => [...x.exits, ...x.gates, ...(x.places ?? [])]),
      ].map((i) => `poi:${i.id}`);
      for (const b of shown) expect(s.basis, s.id).toContain(b);
      expect(s.basis!.some((b) => b.startsWith("fact:")), s.id).toBe(true);
    }
  });
});

// The sign atlas on the phone tier ("low": texel scale LOW_TEXEL_SCALE, pages 4096 wide) is one 4096 x 2048 page plus,
// only when the faces do not fit it, one overflow page 4096 x (power of two <= 1024); never a 4096 x 4096 page.
// buildSigns runs for real on a stub canvas whose text measure is a flat estimate (CJK 1 em, Latin ~0.56 em),
// so face widths, trimming and shelf packing are the production code's; only glyph widths are approximate.
// At 0.5 the English line and the "~N m" distance did not read at mid range (Lane F), so the scale is 0.56 (read as well as 0.6 on the 2026-10-23 phone shoot) and the
// small lines are SMALL_EM of the face height (they were 0.15-0.16).
describe("ikebukuro sign atlas budget on the low tier", () => {
  function stubDocument() {
    const em = (font: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
    const ctx = (): CanvasRenderingContext2D => {
      const state: Record<string, unknown> = { font: "16px sans" };
      return new Proxy(state, {
        get(t, k: string) {
          if (k === "measureText") {
            return (text: string) => ({
              width: [...text].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e7f ? 1 : /\d/.test(ch) ? 0.6 : 0.56), 0) * em(String(t.font)),
            });
          }
          return k in t ? t[k] : () => undefined;
        },
        set(t, k: string, v) {
          if (k === "font") fonts.push(String(v));
          t[k] = v;
          return true;
        },
      }) as unknown as CanvasRenderingContext2D;
    };
    return {
      createElement: () => {
        const c = { width: 0, height: 0, getContext: () => (c as { _g?: CanvasRenderingContext2D })._g ?? ((c as { _g?: CanvasRenderingContext2D })._g = ctx()) };
        return c;
      },
    };
  }

  /** Font strings the faces were painted with (every assignment to a 2D context's font). */
  let fonts: string[] = [];

  function atlas(set: Sign[], texel = LOW_TEXEL_SCALE) {
    (globalThis as { document?: unknown }).document = stubDocument();
    fonts = [];
    try {
      const built = buildSigns(THREE, set, (x, y, z) => new THREE.Vector3(x, z, -y), 1, texel, 4096);
      const out = { pages: built.pages, rows: built.rows };
      built.dispose();
      return out;
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
  }

  /** Low-tier page limit: page 1 at most 4096 x 2048, an overflow page at most 4096 x 1024, nothing more. */
  function withinLimit(pages: { w: number; h: number }[]) {
    expect(pages.length).toBeLessThanOrEqual(2);
    expect(pages[0]!.w).toBeLessThanOrEqual(4096);
    expect(pages[0]!.h).toBeLessThanOrEqual(2048);
    if (pages[1]) {
      expect(pages[1].w).toBeLessThanOrEqual(4096);
      expect(pages[1].h).toBeLessThanOrEqual(1024);
      expect(Math.log2(pages[1].h) % 1).toBe(0);
    }
  }

  it("pins the phone scale and the small-line em", () => {
    expect(LOW_TEXEL_SCALE).toBe(0.56);
    expect(SMALL_EM).toBe(0.21);
    // The readability probe (e2e spec 11) reports the smallest type from these: keep it in step with the layout.
    const probe = readFileSync(here("../../../tests/e2e/specs/11-ikebukuro-repeater-signs.spec.ts"), "utf8");
    expect(probe).toContain(`const MIN_EM_FRAC = { repeat: ${Math.min(SMALL_EM, EXIT_EN_EM)}, place: ${SMALL_EM} } as const;`);
  });

  it("with the repeaters and place boards the low atlas is one 4096 x 2048 page and a 4096 x 512 overflow page", () => {
    const { pages } = atlas(signs);
    withinLimit(pages);
    expect(pages).toEqual([{ w: 4096, h: 2048 }, { w: 4096, h: 512 }]);
  });

  it("negative control: at this scale the faces do not fit one 2048 px page (why the overflow page exists)", () => {
    const { rows } = atlas(signs);
    const fits = Math.floor((2048 - rows.gutter) / rows.rowH);
    expect(rows.used.reduce((a, b) => a + b, 0)).toBeGreaterThan(fits);
  });

  it("the overflow page is made on demand: faces that fit page 1 give exactly one page", () => {
    const few = signs.slice(0, 20);
    const { pages, rows } = atlas(few);
    expect(pages).toHaveLength(1);
    expect(rows.used).toHaveLength(1);
    withinLimit(pages);
  });

  it("keeps slack for glyph-width error: three more repeaters (six faces) still fit the two low-tier pages", () => {
    const rep = signs.filter((s) => s.kind === "repeat");
    const extra = rep.slice(0, 3).map((s, i) => ({ ...s, id: `slack-${i}` }));
    withinLimit(atlas([...signs, ...extra]).pages);
  });

  it("paints the English line and the distance at SMALL_EM of the face height on boards and repeaters", () => {
    const h = Math.round(0.42 * 300);
    const small = `${Math.round(h * SMALL_EM)}px`;
    atlas(signs.filter((s) => s.kind === "place"));
    expect(fonts.filter((f) => f.startsWith("500 ") && f.includes(small)).length).toBeGreaterThan(0); // hall English
    expect(fonts.filter((f) => f.startsWith("600 ") && f.includes(small)).length).toBeGreaterThan(0); // hall distance
    atlas(signs.filter((s) => s.kind === "repeat"));
    expect(fonts.filter((f) => f.includes(small)).length).toBeGreaterThan(0); // exit distance, gate English and distance
    // The Japanese names stay larger: gates 0.24, halls 0.3 of the face height.
    expect(SMALL_EM).toBeLessThan(0.24);
    expect(SMALL_EM).toBeGreaterThanOrEqual(0.2);
    expect(SMALL_EM).toBeLessThanOrEqual(0.22);
  });

  it("the 出口 / Exit caption is 0.26 / 0.2 of the face height, 出口 larger, and the two lines do not overlap", () => {
    expect(EXIT_JA_EM).toBe(0.26);
    expect(EXIT_EN_EM).toBe(0.2);
    expect(EXIT_JA_EM).toBeGreaterThan(EXIT_EN_EM);
    const h = Math.round(0.42 * 300);
    // Centres as painted (0.36 h and 0.68 h, middle baseline): 出口's bottom stays above Exit's top, both on the face.
    expect(0.36 * h + (EXIT_JA_EM * h) / 2).toBeLessThan(0.68 * h - (EXIT_EN_EM * h) / 2);
    expect(0.36 * h - (EXIT_JA_EM * h) / 2).toBeGreaterThan(6); // below the top rule
    expect(0.68 * h + (EXIT_EN_EM * h) / 2).toBeLessThan(h);
    atlas(signs.filter((s) => s.kind === "repeat"));
    expect(fonts).toContain(`600 ${Math.round(h * EXIT_JA_EM)}px ${FONT}`);
    expect(fonts).toContain(`500 ${Math.round(h * EXIT_EN_EM)}px ${FONT}`);
  });
});
