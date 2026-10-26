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
    { q: "西改札", top: ["metro-m-central-west-gate", "metro-y-south-west-gate", "metro-f-west-west-gate"] }, // + Fukutoshin West Passage West Gate (#414)
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
  "search-only shops": [
    { q: "Patio de METRO", top1: "shop-ikb-mr-002" },
    { q: "パティオ", top1: "shop-ikb-mr-002" },
    { q: "マツモトキヨシ", top: ["shop-ikb-mr-004", "shop-ikb-echika-1108"] }, // two branches: ISP 南館 and Echika (#407)
    { q: "カフェカルディーノ", top1: "shop-ikb-isp-000066" },
    { q: "青山フラワーマーケット", top1: "shop-ikb-hope-001" },
    { q: "リンツ ショコラ ブティック", top1: "shop-ikb-echika-1104" },
  ],
  "search-only line POIs (#414, #420)": [
    { q: "C1番出口", top1: "exit-c1" },
    { q: "副都心線 西通路東改札", top1: "metro-f-west-east-gate" },
    { q: "西武池袋線 1F改札口", top1: "seibu-1f-gate" },
    { q: "北改札", top: ["jr-north-gate", "tobu-north-gate"] }, // printed for both JR and Tobu on the ward guide
    { q: "JR 北改札", top1: "jr-north-gate" },
    { q: "東武東上線 北改札", top1: "tobu-north-gate" },
    { q: "地下改札", top1: "seibu-b1f-gate" },
  ],
  "merchant batch 4 (#432)": [
    { q: "東武百貨店", top1: "shop-ikb-tobudept" },
    { q: "HARBS", top1: "shop-ikb-lumine-000539" },
    { q: "JO MALONE LONDON", top1: "shop-ikb-lumine-000527" },
    { q: "Timberland", top1: "shop-ikb-esola-1147" },
    { q: "ミラ オーウェン", top1: "shop-ikb-lumine-000463" }, // printed kana alias of Mila Owen
  ],
  "merchant batch 5 (#443)": [
    { q: "トモニー 池袋駅１階改札内店", top1: "shop-ikb-seibu-000597" },
    { q: "宝くじ 1F", top1: "shop-ikb-seibu-000901" },
    { q: "マネケン", top1: "shop-ikb-seibu-000516" }, // exact name unique among all Ikebukuro POI names and aliases
  ],
  "facilities batch 1 (#431)": [
    { q: "車いす対応トイレ（改札外）", top1: "toilet-ikb-metro-001" },
    { q: "車いす対応トイレ（改札内）", top: ["toilet-ikb-metro-002", "toilet-ikb-metro-003"] }, // printed twice: Yurakucho and Fukutoshin
    { q: "コインロッカー", top1: "locker-ikb-metro-001" },
    { q: "ATM・三井住友銀行", top1: "atm-ikb-metro-008" },
  ],
  "facilities batches 2-3 (#453, #455)": [
    { q: "インフォメーション", top1: "service-ikb-lumine-001" }, // LUMINE B1; exact name unique among all Ikebukuro POI names and aliases
    // No Tōbu facility name is unique (12 バリアフリートイレ, 5 コインロッカー（有料）, ...), so the two printed ベビー休憩室 are asserted as a set.
    { q: "ベビー休憩室", top: ["service-ikb-tobudept-007", "service-ikb-tobudept-008"] },
    { q: "お忘れ物取扱所", top1: "service-ikb-seibu-003" }, // #455, Seibu lost-property office; exact name unique among all Ikebukuro POI names and aliases
  ],
  "line and store POIs (#501)": [
    { q: "西武池袋線 3番ホーム", top1: "seibu-platform-3" },
    { q: "Seibu Ikebukuro Line Platform 7", top1: "seibu-platform-7" },
    { q: "ルミネ池袋", top1: "shop-ikb-lumine" },
    { q: "エソラ池袋", top1: "shop-ikb-esola" },
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

  // Department-store names: no source ties them to an exit here, so searching them must not invent a gate.
  // Seibu names come from the Seibu Railway station page, recorded twice as distinct reads of that one page:
  // seibu-ikebukuro-station-2026-10 (#414, OD-25) and seibu-ikebukuro-norikae-2026-10 (#452, the platform
  // legend); only POIs sourced from it may carry 西武 / Seibu labels, and the Seibu queries may reach only those POIs.
  // 百貨店 only on the Tobu Department Store POI, which cites the store's own page (OD-34); Sogo & Seibu stays excluded.
  // パルコ only on the PARCO POI, which cites the JCSC facility record (S13, facts-only); PARCO's own site is corroboration only.
  // 西武池袋本店 only on the Seibu Ikebukuro store POI, which cites the JCSC 2026 opening-SC list (facts-only).
  const SEIBU_SOURCES = ["seibu-ikebukuro-station-2026-10", "seibu-ikebukuro-norikae-2026-10"];
  const fromSeibu = (poi: StationBundle["pois"][number]): boolean =>
    poi.evidence.sourceIds.some((id) => SEIBU_SOURCES.includes(id));
  const TOBU_DEPT_SOURCE = "tobu-dept-ikebukuro-2026-10";
  const TOBU_DEPT_POI = "shop-ikb-tobudept";
  const PARCO_SOURCE = "jcsc-ikebukuro-parco-facility-2021-10";
  const PARCO_POI = "shop-ikb-parco";
  const SEIBU_STORE_SOURCE = "jcsc-ikebukuro-links-open-sc";
  const SEIBU_STORE_POI = "shop-ikb-seibu-honten";
  const isSeibuStore = (poi: StationBundle["pois"][number]): boolean =>
    poi.id === SEIBU_STORE_POI && poi.evidence.sourceIds.includes(SEIBU_STORE_SOURCE);
  describe("no false gate for names the data does not evidence", () => {
    for (const q of ["そごう", "PARCO", "パルコ", "山手線"]) {
      it(`${JSON.stringify(q)} returns no gate or exit`, () => {
        const hits = index.search(q).filter((hit) => hit.poi.category === "ticket_gate" || hit.poi.category === "exit");
        expect(hits).toEqual([]);
      });
    }

    it("the Seibu queries reach only POIs sourced from the Seibu Railway station page or the JCSC Seibu store listing", () => {
      for (const q of ["西武", "西武線", "Seibu", "Seibu Railway"]) {
        const hits = index.search(q);
        for (const hit of hits) expect(fromSeibu(hit.poi) || isSeibuStore(hit.poi), `${q} -> ${hit.poi.id}`).toBe(true);
      }
    });

    it("carries PARCO labels only on the JCSC-sourced PARCO POI, Sogo labels nowhere, 百貨店 only on the Tobu Department Store POI, and Seibu labels only on Seibu-sourced POIs or the JCSC-sourced Seibu store POI", () => {
      const parco = /parco|パルコ/i;
      const sogo = /そごう|sogo/i;
      const departmentStore = /百貨店/;
      const seibu = /西武|seibu/i;
      const offenders = bundle.pois.flatMap((poi) =>
        [...poi.names, ...poi.aliases]
          .filter(
            ({ text }) =>
              sogo.test(text) ||
              (parco.test(text) && !(poi.id === PARCO_POI && poi.evidence.sourceIds.includes(PARCO_SOURCE))) ||
              (departmentStore.test(text) && !(poi.id === TOBU_DEPT_POI && poi.evidence.sourceIds.includes(TOBU_DEPT_SOURCE))) ||
              (seibu.test(text) && !fromSeibu(poi) && !isSeibuStore(poi)),
          )
          .map(({ text }) => `${poi.id}: ${text}`),
      );
      expect(offenders).toEqual([]);
    });
  });
});
