// Golden search expectations for the Ikebukuro bundle, on the real bundle with the real search engine
// (the same createSearchIndex(parseStationFiles(...)) path the web app uses).
//
// Each row is a query a visitor might type and the POI ids that must lead the results.
//   top1: the single best hit must be this POI.
//   top : the first N hits (N = list length) must be exactly this set, in any order. Used where the
//         query is genuinely ambiguous (東口 names four places) so the engine's tie-break order is not pinned.
// Aliases are data (stations/ikebukuro/data/graph.src.json, copied to gteki/pois.json by the pipeline);
// a row failing here means an alias was lost or the engine's matching changed.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStationFiles, type StationBundle } from "@gteki/schema";
import { createSearchIndex } from "../../../packages/search/src/index.ts";

const read = (f: string): unknown => JSON.parse(fs.readFileSync(new URL(`../gteki/${f}`, import.meta.url), "utf8"));
function load(): StationBundle {
  const parsed = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"));
  if (!parsed.ok || !parsed.bundle) throw new Error("Ikebukuro bundle failed to parse");
  return parsed.bundle;
}

const bundle = load();
const index = createSearchIndex(bundle);
const ids = (query: string): string[] => index.search(query).map((hit) => hit.poi.id);

type Row = { q: string; top1: string } | { q: string; top: string[] };

const EAST = ["exit-22", "exit-37", "exit-38", "east-exit-b1"];
const WEST = ["exit-4", "exit-19", "west-exit-b1", "west-exit-south-b1"];
const METRO = ["metro-m-central-west-gate", "metro-m-central-gate", "metro-m-central-east-gate"];
const TOBU = ["tobu-central-gate-1", "tobu-central-gate-2"];
const JR = ["jr-central-gate-1", "jr-central-gate-2", "jr-south-gate"];

const GOLDEN: Record<string, Row[]> = {
  "numbered exits (ja / en / digits / full-width)": [
    { q: "35", top1: "exit-35" },
    { q: "35番", top1: "exit-35" },
    { q: "35番出口", top1: "exit-35" },
    { q: "出口35", top1: "exit-35" },
    { q: "Exit 35", top1: "exit-35" },
    { q: "３５", top1: "exit-35" },
    { q: "5", top1: "exit-5" },
    { q: "Exit 6a", top1: "exit-6a" },
  ],
  "numbered exits (romaji / zh-Hant)": [
    { q: "35 ban deguchi", top1: "exit-35" },
    { q: "22號出口", top1: "exit-22" },
  ],
  "east and west exit names": [
    { q: "東口", top: EAST },
    { q: "西口", top: WEST },
    { q: "西口（南）", top1: "exit-4" },
    { q: "East Exit (South)", top1: "exit-38" },
    { q: "east exit south", top1: "exit-38" },
    { q: "東口 地下", top1: "east-exit-b1" },
  ],
  "east and west exit names (romaji / kana)": [
    { q: "higashiguchi", top: EAST },
    { q: "higashi guchi", top: EAST },
    { q: "ひがしぐち", top: EAST },
    { q: "ヒガシグチ", top: EAST },
    { q: "nishiguchi", top: ["exit-4", "west-exit-b1", "exit-19"] },
  ],
  "JR gates": [
    { q: "JR", top: JR },
    { q: "中央2", top1: "jr-central-gate-2" },
    { q: "JR Central Gate 2", top1: "jr-central-gate-2" },
    { q: "chuo 2 kaisatsu", top1: "jr-central-gate-2" },
    { q: "chuo ni kaisatsu", top1: "jr-central-gate-2" },
    { q: "ちゅうおうにかいさつ", top1: "jr-central-gate-2" },
    { q: "chuo 1 kaisatsu", top1: "jr-central-gate-1" },
    { q: "minami kaisatsu", top1: "jr-south-gate" },
    { q: "JR 南剪票口", top1: "jr-south-gate" },
  ],
  "Tokyo Metro Marunouchi gates": [
    { q: "メトロ", top: METRO },
    { q: "東京メトロ", top: METRO },
    { q: "Tokyo Metro", top: METRO },
    { q: "M", top: METRO },
    { q: "丸ノ内", top: METRO },
    { q: "丸の内線", top: METRO },
    { q: "まるのうち", top: METRO },
    { q: "Marunouchi", top: METRO },
    { q: "丸之內線", top: METRO },
    { q: "西改札", top: ["metro-m-central-west-gate", "metro-y-south-west-gate"] },
    { q: "南通路西改札", top1: "metro-y-south-west-gate" },
    { q: "marunouchi-sen chuo-tsuro higashi kaisatsu", top1: "metro-m-central-east-gate" },
  ],
  "Tobu Tojo gates": [
    { q: "東武", top: TOBU },
    { q: "東上線", top: TOBU },
    { q: "Tobu Tojo", top: TOBU },
    { q: "とうぶとうじょうせん", top: TOBU },
    { q: "tobu chuo 1 kaisatsu", top1: "tobu-central-gate-1" },
    { q: "東武東上線 中央1號剪票口", top1: "tobu-central-gate-1" },
  ],
  "passages": [
    { q: "中央通路", top1: "central-passage" },
    { q: "chuo tsuro", top1: "central-passage" },
    { q: "北通道", top1: "north-passage" },
  ],
};

describe("Ikebukuro golden search", () => {
  for (const [group, rows] of Object.entries(GOLDEN)) {
    describe(group, () => {
      for (const row of rows) {
        if ("top1" in row) {
          it(`${JSON.stringify(row.q)} -> ${row.top1}`, () => {
            expect(ids(row.q)[0]).toBe(row.top1);
          });
        } else {
          it(`${JSON.stringify(row.q)} -> {${row.top.join(", ")}}`, () => {
            expect(new Set(ids(row.q).slice(0, row.top.length))).toEqual(new Set(row.top));
          });
        }
      }
    });
  }

  it("stays specific: 東口 never offers a west exit among its top hits, and 西口 never an east one", () => {
    for (const id of WEST) expect(ids("東口").slice(0, 4)).not.toContain(id);
    for (const id of EAST) expect(ids("西口").slice(0, 4)).not.toContain(id);
  });

  // The data has no Seibu gate (only the operator in station.json), so searching it must not invent one.
  // Same for department-store names: no source ties them to an exit here.
  describe("no false gate for names the data does not evidence", () => {
    for (const q of ["西武", "西武線", "Seibu", "Seibu Railway", "そごう", "PARCO", "パルコ", "山手線"]) {
      it(`${JSON.stringify(q)} returns no gate or exit`, () => {
        const hits = index.search(q).filter((hit) => hit.poi.category === "ticket_gate" || hit.poi.category === "exit");
        expect(hits).toEqual([]);
      });
    }

    it("no POI name or alias carries a Seibu / PARCO / department-store label", () => {
      const banned = /西武|seibu|parco|パルコ|そごう|百貨店|sogo/i;
      const offenders = bundle.pois.flatMap((poi) => [...poi.names, ...poi.aliases].filter(({ text }) => banned.test(text)).map(({ text }) => `${poi.id}: ${text}`));
      expect(offenders).toEqual([]);
    });
  });
});
