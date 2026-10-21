import { describe, expect, it } from "vitest";
import { createSearchIndex } from "@gteki/search";
import type { Poi } from "@gteki/schema";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };

/**
 * Search truth for the Shinjuku (E27) POIs (issue #106): names are distinct, nothing in a name or
 * alias is invented, facilities trace to the GSI facility points, and the expected-results table
 * (docs/stations/shinjuku/search-expected.md) holds against the real search index.
 */
const { bundle, issues } = loadShinjukuBundle();
const pois = bundle.pois;
const floors = new Map(bundle.floors.map((f) => [f.id, f]));
const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
const text = (p: Poi, lang: string) => p.names.find((n) => n.lang === lang)?.text;
const byCategory = (c: string) => pois.filter((p) => p.category === c);
const exits = byCategory("exit");

interface PlanFacility { id: string; category: string; x: number; y: number }
const plan = planJson as unknown as { levels: { label: string; ordinal: number; floorId: string; facilities: PlanFacility[] }[] };
const facilities = plan.levels.flatMap((lv) => lv.facilities.map((f) => ({ ...f, level: lv.label, ordinal: lv.ordinal })));
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("POI names", () => {
  it("passes the shared contract validator with no errors", () => {
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("gives every POI a ja and en name, unique per language", () => {
    for (const lang of ["ja", "en"]) {
      const names = pois.map((p) => text(p, lang));
      expect(names.every(Boolean), lang).toBe(true);
      expect(new Set(names).size, lang).toBe(names.length);
    }
    for (const lang of ["ja", "en", "zh-Hant"]) {
      const names = pois.map((p) => text(p, lang)).filter(Boolean);
      expect(new Set(names).size, lang).toBe(names.length);
    }
  });

  it("keeps the level in every exit name (a B1 exit never says street level)", () => {
    for (const p of exits) {
      const ordinal = floors.get(p.floorId!)!.ordinal!;
      const ja = text(p, "ja")!, en = text(p, "en")!;
      if (ordinal >= 0) {
        expect(ja, p.id).toMatch(/地上/);
        expect(en, p.id).toMatch(/street level/);
      } else {
        expect(ja, p.id).toContain(`地下${-ordinal}階`);
        expect(en, p.id).toContain(`B${-ordinal}`);
        expect(`${ja} ${en}`, p.id).not.toMatch(/地上|street/i);
      }
    }
  });

  it("never shows a number that could be read as an official exit number", () => {
    // Official exit numbers are a coverage gap (gap:exit-numbers); the only digit allowed is the level itself.
    expect(bundle.coverage.gaps.some((g) => g.id === "gap:exit-numbers")).toBe(true);
    for (const p of exits) {
      const ja = text(p, "ja")!.replace("地下1階", ""), en = text(p, "en")!.replace("B1", "");
      expect(ja, p.id).not.toMatch(/[0-9０-９]|番|第|No\./);
      expect(en, p.id).not.toMatch(/[0-9]|#|\bno\.|\bnumber\b/i);
      for (const a of p.aliases) {
        const t = a.text.replace(/地下1階|地下1樓|ちかいっかい|chika ikkai|underground level B1/gi, "");
        expect(t, `${p.id} ${a.text}`).not.toMatch(/[0-9０-９]|番|第|#|\bno\./i);
      }
      expect(p.evidence.note, p.id).toContain("not official exit numbers");
    }
  });

  it("tells every exit apart by source-backed descriptors only", () => {
    const parse = (p: Poi) => {
      const ja = text(p, "ja")!;
      return {
        level: /地上/.test(ja) ? "street" : "B1",
        compass: /(北東|北西|南東|南西|北|東|南|西)側/.exec(ja)![1]!,
        spaces: ["階段", "エレベーター", "エスカレーター", "通路/コンコース"].filter((w) => ja.includes(w)),
        roof: /屋根あり/.test(ja) ? "roofed" : /屋根なし/.test(ja) ? "open" : null,
      };
    };
    const keys = exits.map((p) => JSON.stringify(parse(p)));
    expect(new Set(keys).size).toBe(exits.length);

    // Roof words only where E27 屋根の有無 gives one known code across the exit's links, and never below street.
    const links = bundle.edges;
    const rawRoof = (p: Poi) => new Set(links.filter((e) => p.connectorNodeIds.includes(e.from) || p.connectorNodeIds.includes(e.to)).map((e) => e.attributes?.roof));
    for (const p of exits) {
      const d = parse(p);
      if (d.level === "B1") expect(d.roof, p.id).toBeNull();
      expect(p.evidence.method, p.id).toContain("E27 屋根の有無");
      const codes = rawRoof(p);
      expect(codes.has(99), p.id).toBe(false); // 99 = 不明: never claimed
      // 1 = なし (open), 2 = あり (roofed): said only when every link at the exit agrees
      if (d.roof === "roofed") expect([...codes], p.id).toEqual([2]);
      else if (d.roof === "open") expect([...codes], p.id).toEqual([1]);
      else if (d.level === "street") expect(codes.size, p.id).toBeGreaterThan(1);
    }
  });
});

/** Source behind a hand-written alias; the allow-list is deliberately small and cited. */
const STATION_RECORD = "station.json: station.names (新宿駅（都営大江戸線） / Shinjuku Station (Toei Oedo Line) / 新宿站（都營大江戶線）) and codes E27";
const PLATFORM_ALIASES: Record<string, string> = {
  "ja-Hrkt:おおえどせん ほーむ": "reading of 大江戸線 ホーム (the platform's previous display name)",
  "ja-Latn:oedo sen platform": "romaji of 大江戸線 ホーム (previous display name)",
  "en:E27": "station.json codes[toei] = E27",
  "zh-Hant:大江戶線 月台": "zh-Hant of the previous display name; line name as in station.json zh-Hant",
  "ja:都庁前・光が丘方面": "pre-existing alias (fe8d3b6): Toei Oedo Line direction names, public timetable fact; no track or side assignment is claimed (evidence note)",
  "ja:六本木・両国方面": "Toei Oedo Line direction, cited public fact (as above)",
  "ja:新宿": STATION_RECORD,
  "ja:新宿駅": STATION_RECORD,
  "ja:都営大江戸線": STATION_RECORD + " (operator + line)",
  "ja:大江戸線": STATION_RECORD + " (line name inside the station name)",
  "ja:大江戸線 ホーム": "previous display name of the platform POI (pre-#106 pois.json)",
  "ja-Hrkt:しんじゅく": "reading of 新宿 (station name in " + STATION_RECORD + ")",
  "ja-Hrkt:しんじゅくえき": "reading of 新宿駅",
  "ja-Hrkt:とえいおおえどせん": "reading of 都営大江戸線",
  "ja-Hrkt:おおえどせん": "reading of 大江戸線",
  "ja-Latn:shinjuku": "romaji of 新宿 (en station name: Shinjuku Station)",
  "ja-Latn:shinjuku eki": "romaji of 新宿駅",
  "ja-Latn:toei oedo sen": "romaji of 都営大江戸線",
  "ja-Latn:oedo sen": "romaji of 大江戸線",
  "en:Shinjuku": "station.json en name: Shinjuku Station (Toei Oedo Line)",
  "en:Shinjuku Station": "station.json en name",
  "en:Toei Oedo Line": "station.json en name (operator + line)",
  "en:Oedo Line": "station.json en name (line)",
  "en:Oedo": "station.json en name (line)",
  "en:Oedo Line platform": "previous display name of the platform POI (pre-#106 pois.json)",
  "zh-Hant:新宿": "station.json zh-Hant name 新宿站（都營大江戶線）",
  "zh-Hant:新宿站": "station.json zh-Hant name",
  "zh-Hant:都營大江戶線": "station.json zh-Hant name (operator + line)",
  "zh-Hant:大江戶線": "station.json zh-Hant name (line)",
};
/** Category-wide generic words: the plain word for the thing, in each script (no claim about the place). */
const GENERIC_ALIASES: Record<string, Record<string, string>> = {
  exit: { "ja-Hrkt:でぐち": "reading of 出口", "ja-Latn:deguchi": "romaji of 出口", "en:exit": "English for 出口", "zh-Hant:出口": "zh-Hant for 出口" },
  ticket_gate: { "ja-Hrkt:かいさつ": "reading of 改札", "ja-Latn:kaisatsu": "romaji of 改札", "en:gate": "English for 改札", "zh-Hant:剪票口": "zh-Hant for 改札" },
  toilet: { "ja-Hrkt:といれ": "reading of トイレ", "ja:お手洗い": "synonym of トイレ", "ja-Latn:toire": "romaji of トイレ", "en:restroom": "English for トイレ", "en:wc": "English for トイレ", "zh-Hant:廁所": "zh-Hant for トイレ" },
  elevator: { "ja-Hrkt:えれべーたー": "reading of エレベーター", "ja-Latn:erebeta": "romaji of エレベーター", "en:lift": "English for エレベーター", "zh-Hant:電梯": "zh-Hant for エレベーター" },
};
/** Descriptor words → (reading, romaji, en, zh-Hant). Each key is a word that must appear in the exit's ja name. */
const WORDS: Record<string, { kana: string; romaji: string; en: string; zh: string; field: string }> = {
  地上: { kana: "ちじょう", romaji: "chijo", en: "street level", zh: "地面", field: "GSI map level 1 of the F108 point" },
  地下1階: { kana: "ちかいっかい", romaji: "chika ikkai", en: "underground level B1", zh: "地下1樓", field: "GSI map level B1 of the F108 point" },
  階段: { kana: "かいだん", romaji: "kaidan", en: "stairs", zh: "樓梯", field: "GSI space B021 (階段の範囲) at the F108 point" },
  エレベーター: { kana: "えれべーたー", romaji: "erebeta", en: "elevator", zh: "電梯", field: "GSI space B022 (エレベーターの範囲) at the F108 point" },
  エスカレーター: { kana: "えすかれーたー", romaji: "esukareta", en: "escalator", zh: "手扶梯", field: "GSI space B023 (エスカレーターの範囲) at the F108 point" },
  "通路/コンコース": { kana: "つうろ こんこーす", romaji: "tsuro konkosu", en: "walkway/concourse", zh: "通道", field: "GSI space B029 (通路/コンコース) at the F108 point" },
  屋根あり: { kana: "やねあり", romaji: "yane ari", en: "roofed", zh: "有屋頂", field: "E27 link attribute roof = 2 (あり)" },
  屋根なし: { kana: "やねなし", romaji: "yane nashi", en: "no roof", zh: "無屋頂", field: "E27 link attribute roof = 1 (なし)" },
};
const COMPASS: Record<string, { kana: string; romaji: string; en: string; zh: string }> = {
  北: { kana: "きた", romaji: "kita", en: "north", zh: "北" },
  北東: { kana: "ほくとう", romaji: "hokuto", en: "northeast", zh: "東北" },
  東: { kana: "ひがし", romaji: "higashi", en: "east", zh: "東" },
  南東: { kana: "なんとう", romaji: "nanto", en: "southeast", zh: "東南" },
  南: { kana: "みなみ", romaji: "minami", en: "south", zh: "南" },
  南西: { kana: "なんせい", romaji: "nansei", en: "southwest", zh: "西南" },
  西: { kana: "にし", romaji: "nishi", en: "west", zh: "西" },
  北西: { kana: "ほくせい", romaji: "hokusei", en: "northwest", zh: "西北" },
};
const tokens = (s: string) => s.split(" ").sort().join(" ");

describe("POI aliases", () => {
  it("traces every alias to a source field or a cited fact", () => {
    for (const p of pois) {
      const allowed = new Map<string, string>();
      const add = (k: string, why: string) => allowed.set(k, why);
      if (p.category === "platform") for (const [k, why] of Object.entries(PLATFORM_ALIASES)) add(k, why);
      for (const [k, why] of Object.entries(GENERIC_ALIASES[p.category] ?? {})) add(k, why);
      if (p.category === "exit") {
        // Distinguishing aliases are rebuilt from the descriptor words found in the ja name.
        const ja = text(p, "ja")!;
        const compass = /(北東|北西|南東|南西|北|東|南|西)側/.exec(ja)![1]!;
        const found = Object.keys(WORDS).filter((w) => ja.includes(w));
        const level: string[] = found.filter((w) => w === "地上" || w === "地下1階");
        const rest = found.filter((w) => !level.includes(w));
        expect(level.length, p.id).toBe(1);
        const c = COMPASS[compass]!;
        add("ja-Hrkt:" + tokens(["でぐち", WORDS[level[0]!]!.kana, `${c.kana}がわ`, ...rest.map((w) => WORDS[w]!.kana)].join(" ")), "readings of the name's descriptors");
        add("ja-Latn:" + tokens(["deguchi", `${c.romaji}-gawa`, ...rest.map((w) => WORDS[w]!.romaji), WORDS[level[0]!]!.romaji].join(" ")), "romaji of the name's descriptors");
        add("en:" + tokens(["exit", WORDS[level[0]!]!.en, c.en, ...rest.map((w) => WORDS[w]!.en)].join(" ")), "English of the name's descriptors");
        add("zh-Hant:" + tokens(["出口", WORDS[level[0]!]!.zh, `${c.zh}側`, ...rest.map((w) => WORDS[w]!.zh)].join(" ")), "zh-Hant of the name's descriptors");
      }
      const norm = (k: string) => {
        const i = k.indexOf(":");
        const lang = k.slice(0, i), t = k.slice(i + 1);
        // composite aliases are compared as unordered word sets; single words compare as written
        return p.category === "exit" && t.includes(" ") ? `${lang}:${tokens(t)}` : k;
      };
      const allowedNorm = new Map([...allowed].map(([k, v]) => [norm(k), v]));
      for (const a of p.aliases) expect(allowedNorm.has(norm(`${a.lang}:${a.text}`)), `${p.id} alias ${a.lang}:${a.text}`).toBe(true);
    }
  });

  it("lets nobody read a JR or other-operator claim out of a name or alias", () => {
    const other = /JR|ＪＲ|山手|京王|小田急|メトロ|丸ノ内|丸ノ内線|新宿線|中央線|Yamanote|Keio|Odakyu|Metro|Marunouchi|西口|南口|東口|Nishiguchi/i;
    for (const p of pois) for (const t of [...p.names, ...p.aliases]) expect(t.text, `${p.id} ${t.lang}`).not.toMatch(other);
  });

  it("makes the station-name anchor say it is the Toei Oedo Line station, and says what is not modelled", () => {
    const platform = pois.find((p) => p.id === "poi:platform:oedo")!;
    expect(text(platform, "ja")).toContain("都営大江戸線");
    expect(text(platform, "ja")).toContain("新宿");
    expect(text(platform, "en")).toContain("Toei Oedo Line");
    expect(text(platform, "en")).toContain("Shinjuku");
    expect(platform.notes!.map((n) => n.text).join(" ")).toMatch(/JR/);
    // the names reuse the station record's own wording
    const stationJa = bundle.station.names.find((n) => n.lang === "ja")!.text;
    expect(stationJa).toContain("都営大江戸線");
    expect(bundle.station.codes!.map((c) => c.code)).toContain("E27");
    expect(text(platform, "en")).toContain("E27");
  });

  it("never says PDL covers E27", () => {
    expect(JSON.stringify(pois)).not.toMatch(/PDL/i);
  });
});

describe("facility POIs trace to the GSI facility points", () => {
  it("keeps to the five categories Shinjuku has a source anchor for (no shops, kiosks, benches or vending)", () => {
    expect([...new Set(pois.map((p) => p.category))].sort()).toEqual(["elevator", "exit", "platform", "ticket_gate", "toilet"]);
  });

  it("has one exit POI per GSI exit point (F108)", () => {
    const pts = facilities.filter((f) => f.category === "F108");
    expect(pts.length).toBe(exits.length);
    for (const p of exits) expect(pts.some((f) => near(f, p.displayPosition!) < 0.02), p.id).toBe(true);
  });

  it("has one toilet POI per GSI toilet point (F001–F003), and says it is a space point, not a door", () => {
    const pts = facilities.filter((f) => ["F001", "F002", "F003"].includes(f.category));
    const toilets = byCategory("toilet");
    expect(toilets.length).toBe(pts.length);
    for (const p of toilets) {
      expect(pts.some((f) => near(f, p.displayPosition!) < 0.02), p.id).toBe(true);
      const notes = p.notes!.map((n) => n.text).join(" ");
      expect(notes, p.id).toMatch(/代表点/);
      expect(notes, p.id).toMatch(/not a door position/);
    }
  });

  it("cross-checks every lift POI against the GSI lift points (F012) and reports any mismatch", () => {
    const pts = facilities.filter((f) => f.category === "F012");
    const lifts = byCategory("elevator");
    // every GSI lift point lies within 4 m of one E27 lift POI, and no E27 lift POI lacks one
    for (const f of pts) expect(lifts.some((p) => near(f, p.displayPosition!) <= 4), `F012 ${f.level} ${f.x},${f.y}`).toBe(true);
    const mismatched: string[] = [];
    for (const p of lifts) {
      const own = pts.filter((f) => near(f, p.displayPosition!) <= 4);
      expect(own.length, p.id).toBeGreaterThan(0);
      const e27 = new Set([...new Set(p.connectorNodeIds.map((id) => floors.get(nodes.get(id)!.floorId)!.ordinal!))].map((o) => (o === 0 ? 1 : o)));
      const gsi = new Set(own.map((f) => f.ordinal));
      const agree = [...e27].every((o) => gsi.has(o)) && [...gsi].every((o) => e27.has(o));
      const note = p.notes!.map((n) => n.text).join(" ");
      expect(note.includes("不一致"), p.id).toBe(!agree);
      expect(note, p.id).toContain("F012");
      if (!agree) mismatched.push(p.id);
    }
    // Known result at import time: the B1–B3 lift has no F012 point on B3 (reported in the notes and the import report).
    expect(mismatched).toEqual(["poi:elevator:2"]);
  });

  it("names ticket gates per E27 gate cluster, with their F106 points counted in the note", () => {
    const pts = facilities.filter((f) => f.category === "F106");
    const gates = byCategory("ticket_gate");
    expect(gates.length).toBeGreaterThan(0);
    expect(gates.length).toBeLessThanOrEqual(pts.length);
    for (const g of gates) {
      const level = floors.get(g.floorId!)!.ordinal!;
      const onLevel = pts.filter((f) => f.ordinal === level && near(f, g.displayPosition!) <= 30);
      expect(onLevel.length, g.id).toBeGreaterThan(0);
      expect(g.notes!.map((n) => n.text).join(" "), g.id).toContain(`${onLevel.length}`);
    }
  });

  it("matches the old POI count plus only source-backed additions", () => {
    const OLD_COUNT = 16; // pois.json at fe8d3b6: 6 exits, 3 gates, 1 platform, 3 lifts, 3 toilets
    // #106 adds no POI: station-name hits ride on the Oedo platform, and the GSI toilet / lift / gate
    // points were already modelled (and are now cross-checked). A new entry must be listed here with its source.
    const ADDED: { id: string; source: string }[] = [];
    expect(pois.length).toBe(OLD_COUNT + ADDED.length);
    const bySource = { exit: 6, ticket_gate: 3, platform: 1, elevator: 3, toilet: 3 } as const;
    for (const [c, n] of Object.entries(bySource)) expect(byCategory(c).length, c).toBe(n);
  });
});

describe("expected search results (docs/stations/shinjuku/search-expected.md)", () => {
  const index = createSearchIndex(bundle);
  /** Hits that are a name or alias match, not ranker fuzz (the ranker gives subsequence noise < 30). */
  const strong = (q: string) => index.search(q, { limit: 10 }).filter((h) => h.score >= 30);
  const top = (q: string) => {
    const hits = strong(q);
    const best = hits[0]?.score;
    return hits.filter((h) => h.score === best).map((h) => h.poi.id).sort();
  };
  const P = "poi:platform:oedo";

  it.each([
    // station-name hits (the Toei Oedo Line station, anchored on the platform POI)
    ["新宿", [P]], ["しんじゅく", [P]], ["シンジュク", [P]], ["Shinjuku", [P]], ["shinjuku station", [P]], ["shinjuku eki", [P]],
    ["新宿駅", [P]], ["E27", [P]], ["e27", [P]], ["大江戸線", [P]], ["都営大江戸線", [P]], ["Oedo", [P]], ["oedo line", [P]], ["Toei Oedo Line", [P]],
    ["新宿站", [P]], ["大江戶線", [P]], ["都營大江戶線", [P]],
    // exits told apart by descriptor
    ["屋根あり", ["poi:exit:1"]], ["roofed", ["poi:exit:1"]], ["屋根なし", ["poi:exit:2", "poi:exit:4"]], ["no roof", ["poi:exit:2", "poi:exit:4"]],
    ["escalator", ["poi:exit:4"]], ["エスカレーター", ["poi:exit:4"]], ["手扶梯", ["poi:exit:4"]],
    ["stairs", ["poi:exit:5"]], ["階段", ["poi:exit:1", "poi:exit:4", "poi:exit:5"]],
    ["street level", ["poi:exit:1", "poi:exit:2", "poi:exit:3", "poi:exit:4"]],
    ["出口 地上", ["poi:exit:1", "poi:exit:2", "poi:exit:3", "poi:exit:4"]],
    ["出口 地下1階", ["poi:exit:5", "poi:exit:6"]],
    ["exit B1", ["poi:exit:5", "poi:exit:6"]],
    ["northwest", ["poi:exit:2", "poi:gate:1"]],
    ["出口 地面 北側", ["poi:exit:1"]],
    ["exit street level south elevator", ["poi:exit:3"]],
    // generic words still list the whole category
    ["出口", ["poi:exit:1", "poi:exit:2", "poi:exit:3", "poi:exit:4", "poi:exit:5", "poi:exit:6"]],
    ["でぐち", ["poi:exit:1", "poi:exit:2", "poi:exit:3", "poi:exit:4", "poi:exit:5", "poi:exit:6"]],
    ["exit", ["poi:exit:1", "poi:exit:2", "poi:exit:3", "poi:exit:4", "poi:exit:5", "poi:exit:6"]],
    ["トイレ", ["poi:toilet:1", "poi:toilet:2", "poi:toilet:3"]], ["廁所", ["poi:toilet:1", "poi:toilet:2", "poi:toilet:3"]],
    ["電梯", ["poi:elevator:1", "poi:elevator:2", "poi:elevator:3"]],
    ["改札", ["poi:gate:1", "poi:gate:2", "poi:gate:3"]], ["剪票口", ["poi:gate:1", "poi:gate:2", "poi:gate:3"]],
    ["ホーム", [P]], ["月台", [P]],
  ] as [string, string[]][])("%s → top hit(s) %j", (query, expected) => {
    expect(top(query)).toEqual([...expected].sort());
  });

  it.each([
    ["でぐち ちじょう きたがわ", "poi:exit:1"], ["deguchi kita-gawa", "poi:exit:1"], ["出口 地面 西北側", "poi:exit:2"],
  ] as [string, string][])("reading query %s finds %s among the strong hits", (query, id) => {
    expect(strong(query).map((h) => h.poi.id)).toContain(id);
  });

  it.each(["JR", "JR新宿", "山手線", "Yamanote", "中央線", "京王", "京王線", "小田急", "小田急線", "丸ノ内線", "東京メトロ", "Tokyo Metro", "都営新宿線", "西口", "南口", "東口", "新宿西口", "E01", "3番出口", "Exit 3", "A1出口"])(
    "%s returns no Shinjuku POI claim",
    (query) => {
      expect(strong(query)).toEqual([]);
    },
  );

  it("returns nothing at all (not even fuzz) for JR and 山手線", () => {
    for (const q of ["JR", "山手線", "Yamanote"]) expect(index.search(q, { limit: 10 })).toEqual([]);
  });
});
