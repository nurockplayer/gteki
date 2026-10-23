// Core search regression on a real station (#106): the expected-results tables of
// docs/stations/shinjuku/search-expected.md, run against the real `createSearchIndex` over the Shinjuku (E27) bundle
// as the explorer loads it (the station's gteki/ contract files through parseStationFiles). It lives in apps/web
// because the web app is the layer that already depends on stations; packages/search stays station-free. A ranking
// change in packages/search that breaks a row of the doc fails here; the doc, not this file, is the source of a row.
import { describe, expect, it } from "vitest";
import { parseStationFiles } from "@gteki/schema";
import { createSearchIndex } from "@gteki/search";
import manifest from "../../../stations/shinjuku/gteki/station.json" with { type: "json" };
import graph from "../../../stations/shinjuku/gteki/graph.json" with { type: "json" };
import pois from "../../../stations/shinjuku/gteki/pois.json" with { type: "json" };

const parsed = parseStationFiles(manifest, graph, pois);
if (!parsed.ok) throw new Error(`Shinjuku station files failed validation: ${parsed.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`);
const index = createSearchIndex(parsed.bundle);
const hits = (q: string) => index.search(q, { limit: 20 });
/** A name or alias match, not ranker fuzz: the doc counts only hits with score >= 30. */
const STRONG = 30;
const strong = (q: string) => hits(q).filter((h) => h.score >= STRONG);
const ids = (list: { poi: { id: string } }[]) => list.map((h) => h.poi.id).sort();

const P = "poi:platform:oedo";
const exit = (...n: number[]) => n.map((k) => `poi:exit:${k}`);
const ALL_EXITS = exit(1, 2, 3, 4, 5, 6);

/**
 * One row per query of the doc. `top`: a single id is the first hit; a list is the set of strong hits (the doc's
 * "all six exits", "exits 1-4", ...). `score`: the score the doc states for the first hit (or for every hit of a set).
 * `among`: the id is one of the strong hits (the doc says another POI also matches). `order`: strong hits in this
 * order, tiers given as sets.
 */
type Case =
  | { q: string; top: string | string[]; score?: number; note?: string }
  | { q: string; among: string; note?: string }
  | { q: string; order: { ids: string[]; score?: number }[]; note?: string };

const CASES: Case[] = [
  // Station-name anchor
  ...["新宿", "新宿駅", "しんじゅく", "シンジュク", "Shinjuku", "shinjuku station", "shinjuku eki", "E27", "e27",
    "大江戸線", "都営大江戸線", "Oedo", "oedo line", "Toei Oedo Line", "新宿站", "大江戶線", "都營大江戶線", "ホーム", "月台"]
    .map((q): Case => ({ q, top: P })),
  // Exits
  ...["出口", "でぐち", "deguchi", "exit"].map((q): Case => ({ q, top: ALL_EXITS, score: 105, note: "generic aliases on every exit" })),
  { q: "出口 地上", top: exit(1, 2, 3, 4), score: 85, note: "prefix of the ja name" },
  { q: "street level", top: exit(1, 2, 3, 4) },
  { q: "出口 地下1階", top: exit(5, 6) },
  { q: "exit B1", top: exit(5, 6) },
  { q: "屋根あり", top: "poi:exit:1" },
  { q: "roofed", top: "poi:exit:1" },
  { q: "階段", top: exit(1, 4, 5) },
  { q: "stairs", order: [{ ids: exit(5), score: 75 }, { ids: exit(1, 4), score: 65 }], note: "suffix, then the other stairs exits" },
  ...["escalator", "エスカレーター", "手扶梯"].map((q): Case => ({ q, top: "poi:exit:4" })),
  { q: "exit street level south elevator", top: "poi:exit:3", score: 105 },
  { q: "出口 地面 北側", top: "poi:exit:1" },
  { q: "出口 地面 西北側", top: "poi:exit:2" },
  { q: "でぐち ちじょう きたがわ", top: "poi:exit:1" },
  { q: "deguchi kita-gawa", among: "poi:exit:1", note: "exit 5 also matches: it is also on the north side" },
  { q: "northwest", order: [{ ids: ["poi:exit:2", "poi:gate:1"], score: 65 }] },
  // Facilities
  ...["トイレ", "廁所", "toilet"].map((q): Case => ({ q, top: ["poi:toilet:1", "poi:toilet:2", "poi:toilet:3"] })),
  ...["電梯", "elevator", "エレベーター"].map((q): Case => ({
    q, order: [{ ids: ["poi:elevator:1", "poi:elevator:2", "poi:elevator:3"] }, { ids: ["poi:exit:3"] }], note: "exit 3's name says elevator",
  })),
  ...["改札", "剪票口", "gate"].map((q): Case => ({ q, top: ["poi:gate:1", "poi:gate:2", "poi:gate:3"] })),
];

/** Negative cases: no hit with score >= 30 (other operators, other stations, exit numbers, 屋根なし). */
const NO_STRONG_HIT = ["JR", "JR新宿", "山手線", "Yamanote", "中央線", "京王", "京王線", "小田急", "小田急線", "丸ノ内線",
  "東京メトロ", "Tokyo Metro", "都営新宿線", "西口", "南口", "東口", "新宿西口", "E01", "屋根なし", "3番出口", "Exit 3", "A1出口"];
/** The doc's stronger rule for these: no hit at all, not even fuzz. */
const NO_HIT = ["JR", "山手線", "Yamanote"];

describe("core search on the real Shinjuku POIs (docs/stations/shinjuku/search-expected.md)", () => {
  it("loads the bundle the explorer loads, without validation errors", () => {
    expect(parsed.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(parsed.bundle.pois.some((p) => p.id === P)).toBe(true);
  });

  it.each(CASES.map((c) => [c.q, c] as const))("%s", (_q, c) => {
    const s = strong(c.q);
    if ("top" in c) {
      if (typeof c.top === "string") {
        expect(hits(c.q)[0]?.poi.id).toBe(c.top);
        if (c.score !== undefined) expect(hits(c.q)[0]?.score).toBe(c.score);
      } else {
        expect(ids(s)).toEqual([...c.top].sort());
        if (c.score !== undefined) expect(s.map((h) => h.score)).toEqual(c.top.map(() => c.score));
      }
    } else if ("among" in c) {
      expect(s.map((h) => h.poi.id)).toContain(c.among);
    } else {
      let at = 0;
      for (const tier of c.order) {
        const part = s.slice(at, at + tier.ids.length);
        expect(ids(part)).toEqual([...tier.ids].sort());
        if (tier.score !== undefined) expect(part.map((h) => h.score)).toEqual(tier.ids.map(() => tier.score));
        at += tier.ids.length;
      }
    }
  });

  it("the reverse word order 地下1階 出口 returns nothing", () => {
    expect(hits("地下1階 出口")).toEqual([]);
  });

  it.each(NO_STRONG_HIT)("%s returns no strong hit", (q) => {
    expect(strong(q)).toEqual([]);
  });

  it.each(NO_HIT)("%s returns no hit at all", (q) => {
    expect(hits(q)).toEqual([]);
  });
});
