import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSearchIndex } from "@gteki/search";
import type { Poi } from "@gteki/schema";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import approxPositions from "../sources/s03-approx-positions.json" with { type: "json" };

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
/** #411: search-only line POIs cite tokyo-s03-zip and nothing else. */
const S03_SOURCE = "tokyo-s03-zip";
const isS03 = (p: Poi) => p.evidence.sourceIds.includes(S03_SOURCE);
/** #214: facts-only merchant listings (shops). Search-only like S03, but with their own directory sources. */
const isShop = (p: Poi) => p.category === "shop";
/** #501: WP4 line POIs (Toei station exits, Metro M08 exits/lifts/escalators), facts-only and search-only. */
const WP4_SOURCES = new Set([
  "tokyometro-shinjuku-station-2026-10",
  "tokyometro-shinjuku-accessibility-2026-10",
  "tokyometro-shinjuku-yardmap-print-2026-10",
  "toei-shinjuku-station-2026-10",
  // Line-code and English line-name aliases on the Marunouchi POIs (M08 / Marunouchi Line).
  "tokyometro-shinjuku-station-en-2026-10",
]);
// Non-empty: `every` is true for an empty source list, which would class an unsourced POI as WP4 and skip the E27 checks.
const isWp4 = (p: Poi) => p.category !== "shop" && p.evidence.sourceIds.length > 0 && p.evidence.sourceIds.every((id) => WP4_SOURCES.has(id));
/** The E27 (Toei NWD / station map / GSI) POIs: everything the station itself evidences. */
const isE27 = (p: Poi) => !isS03(p) && !isShop(p) && !isWp4(p);
const exits = pois.filter((p) => p.category === "exit" && isE27(p));

interface PlanFacility { id: string; category: string; x: number; y: number }
const plan = planJson as unknown as { levels: { label: string; ordinal: number; floorId: string; facilities: PlanFacility[]; spaces: { category: string; rings: Pt[][] }[] }[] };
const facilities = plan.levels.flatMap((lv) => lv.facilities.map((f) => ({ ...f, level: lv.label, ordinal: lv.ordinal })));
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("POI names", () => {
  it("passes the shared contract validator with no errors", () => {
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("gives every E27 POI a ja and en name, unique per language, and every S03 or shop POI one ja name", () => {
    // #411: S03 search-only POIs carry a ja name only (copied as printed; no English is invented).
    // #214: merchant listings are printed names too; they carry no invented English either.
    const e27 = pois.filter(isE27);
    for (const p of pois.filter(isShop)) expect(text(p, "ja"), p.id).toBeTruthy();
    for (const lang of ["ja", "en"]) {
      const names = e27.map((p) => text(p, lang));
      expect(names.every(Boolean), lang).toBe(true);
      expect(new Set(names).size, lang).toBe(names.length);
    }
    const s03Ja = pois.filter(isS03).map((p) => text(p, "ja"));
    expect(s03Ja.every(Boolean)).toBe(true);
    // the source lists two gates under one name (S03 has two entities with this name); kept as printed.
    // Asserted by id: S03 names stay out of Apache-2.0 files.
    const s03 = pois.filter(isS03);
    expect(s03.filter((p, i) => s03Ja.indexOf(s03Ja[i]) !== s03Ja.lastIndexOf(s03Ja[i])).map((p) => p.id)).toEqual(["poi:keio-gate:1", "poi:keio-gate:2"]);
    for (const lang of ["ja", "en", "zh-Hant"]) {
      const names = e27.map((p) => text(p, lang)).filter(Boolean);
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

  it("builds every exit name from descriptors recomputed here from coordinates, plan.json and the graph", () => {
    // Nothing is read back out of the names: level, compass, adjacent space and roof come from the
    // POI position, the node centroid, plan.json spaces and the E27 link roof attribute.
    for (const p of exits) {
      const d = describeExit(p);
      const wordsJa = d.spaces.map((c) => SPACE_BY_CATEGORY[c]!.ja).join("と");
      const wordsEn = d.spaces.map((c) => SPACE_BY_CATEGORY[c]!.en).join(" and ");
      const ja = [d.street ? "地上" : "地下1階", `${COMPASS_BY_EN[d.compass]!.ja}側`, ...(wordsJa ? [`${wordsJa}に隣接`] : []), ...(d.roof ? [d.roof === "roofed" ? "屋根あり" : "屋根なし"] : [])].join("・");
      const en = [d.street ? "street level" : "underground level B1", `${d.compass} side`, ...(wordsEn ? [`next to ${wordsEn}`] : []), ...(d.roof ? [d.roof === "roofed" ? "roofed" : "no roof"] : [])].join(", ");
      expect(text(p, "ja"), p.id).toBe(`出口（${ja}）`);
      expect(text(p, "en"), p.id).toBe(`Exit (${en})`);
      if (!d.street) expect(d.roof, p.id).toBeNull();
      expect(p.evidence.method, p.id).toContain("E27 屋根の有無");
    }
    // The descriptors tell all six exits apart.
    expect(new Set(exits.map((p) => JSON.stringify(describeExit(p)))).size).toBe(exits.length);
  });

  it("says roofed / no roof only when every nearby E27 link agrees and none is 不明 (99)", () => {
    const byId = Object.fromEntries(exits.map((p) => [p.id, describeExit(p)]));
    // exit 4: its 3 m approach link is roof=1 (なし) but the stair link 0.8 m away and the escalator link 1.1 m away are roof=2 (あり)
    expect(byId["poi:exit:4"]!.roofCodes).toEqual([1, 2]);
    expect(byId["poi:exit:4"]!.roof).toBeNull();
    expect(text(exits.find((p) => p.id === "poi:exit:4")!, "ja")).not.toMatch(/屋根/);
    expect(byId["poi:exit:2"]!.roof).toBeNull(); // open approach link at 1.4 m, roofed links at 1.0 m and 1.3 m
    expect(byId["poi:exit:1"]!.roof).toBe("roofed");
    for (const d of Object.values(byId)) if (d.street && d.roof) expect(d.roofCodes).toHaveLength(1);
    for (const d of Object.values(byId)) if (d.roofCodes.includes(99)) expect(d.roof).toBeNull();
  });
});

const ROOF_RADIUS_M = 1.5, ADJACENT_RADIUS_M = 0.5;
const SPACE_BY_CATEGORY: Record<string, { ja: string; en: string }> = {
  B021: { ja: "階段", en: "stairs" }, B022: { ja: "エレベーター", en: "elevator" }, B023: { ja: "エスカレーター", en: "escalator" }, B029: { ja: "通路/コンコース", en: "walkway/concourse" },
};
const SECTORS = [["north", "北"], ["northeast", "北東"], ["east", "東"], ["southeast", "南東"], ["south", "南"], ["southwest", "南西"], ["west", "西"], ["northwest", "北西"]] as const;
const COMPASS_BY_EN = Object.fromEntries(SECTORS.map(([en, ja]) => [en, { ja }])) as Record<string, { ja: string }>;
type Pt = { x: number; y: number };
const segDist = (p: Pt, a: Pt, b: Pt) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
};
const ringDist = (p: Pt, ring: Pt[]) => Math.min(...ring.slice(0, -1).map((a, i) => segDist(p, a, ring[i + 1]!)));
const inRing = (p: Pt, ring: Pt[]) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
const centroid = {
  x: bundle.nodes.reduce((s, n) => s + n.position.x, 0) / bundle.nodes.length,
  y: bundle.nodes.reduce((s, n) => s + n.position.y, 0) / bundle.nodes.length,
};
/** Everything an exit name may say, recomputed independently of the importer. */
function describeExit(p: Poi) {
  const pos = p.displayPosition!;
  const ordinal = floors.get(p.floorId!)!.ordinal!;
  const street = ordinal >= 0;
  // compass: bearing of the POI from the node centroid, 8 sectors clockwise from north
  const bearing = (Math.atan2(pos.x - centroid.x, pos.y - centroid.y) * 180) / Math.PI;
  const compass = SECTORS[Math.round(((bearing + 360) % 360) / 45) % 8]![0];
  // adjacent space: plan.json spaces of the exit's map level that contain or touch the point
  const level = plan.levels.find((l) => l.label === (street ? "1" : "B1"))!;
  const adj = level.spaces.filter((sp) => sp.category in SPACE_BY_CATEGORY && (inRing(pos, sp.rings[0]!) || sp.rings.some((r) => ringDist(pos, r) <= ADJACENT_RADIUS_M)));
  const spaces = Object.keys(SPACE_BY_CATEGORY).filter((c) => adj.some((sp) => sp.category === c));
  // roof: every graph link within ROOF_RADIUS_M of the point, plus links inside a cited stairs / lift / escalator space
  const equivalent = street ? [1, 0] : [ordinal];
  const codes = new Set<number>();
  for (const e of bundle.edges) {
    const from = nodes.get(e.from)!, to = nodes.get(e.to)!;
    const line: Pt[] = (e.geometry ?? [from.position, to.position]).map((g) => ({ x: g.x, y: g.y }));
    let hit = line.slice(0, -1).some((a, i) => segDist(pos, a, line[i + 1]!) <= ROOF_RADIUS_M);
    if (!hit && [from, to].some((n) => equivalent.includes(floors.get(n.floorId)!.ordinal!))) {
      const f = (line.length - 1) * 0.5;
      const a = line[Math.floor(f)]!, b = line[Math.ceil(f)]!;
      const mid = { x: a.x + (b.x - a.x) * (f - Math.floor(f)), y: a.y + (b.y - a.y) * (f - Math.floor(f)) };
      hit = adj.some((sp) => ["B021", "B022", "B023"].includes(sp.category) && inRing(mid, sp.rings[0]!));
    }
    if (hit) codes.add(e.attributes!.roof as number);
  }
  const roofCodes = street ? [...codes].sort((a, b) => a - b) : [];
  const roof = roofCodes.length === 1 && roofCodes[0] === 2 ? "roofed" : roofCodes.length === 1 && roofCodes[0] === 1 ? "open" : null;
  return { street, compass, spaces, roofCodes, roof };
}

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
      if (p.id === "poi:tokyometro-gate:1" || p.id === "poi:tokyometro-gate:2") {
        add("en:M08", "printed station number on the Tokyo Metro English Shinjuku page");
        add("en:Marunouchi Line", "printed English line name on the Tokyo Metro English Shinjuku page");
      }
      if (p.category === "exit" && isE27(p)) {
        // Distinguishing aliases are rebuilt from the independently recomputed descriptors (not from the name).
        const d = describeExit(p);
        const lw = WORDS[d.street ? "地上" : "地下1階"]!;
        const rest = [...d.spaces.map((c) => WORDS[SPACE_BY_CATEGORY[c]!.ja]!), ...(d.roof ? [WORDS[d.roof === "roofed" ? "屋根あり" : "屋根なし"]!] : [])];
        const c = COMPASS[SECTORS.find(([en]) => en === d.compass)![1]]!;
        add("ja-Hrkt:" + tokens(["でぐち", lw.kana, `${c.kana}がわ`, ...rest.map((w) => w.kana)].join(" ")), "readings of the recomputed descriptors");
        add("ja-Latn:" + tokens(["deguchi", `${c.romaji}-gawa`, ...rest.map((w) => w.romaji), lw.romaji].join(" ")), "romaji of the recomputed descriptors");
        add("en:" + tokens(["exit", lw.en, c.en, ...rest.map((w) => w.en)].join(" ")), "English of the recomputed descriptors");
        add("zh-Hant:" + tokens(["出口", lw.zh, `${c.zh}側`, ...rest.map((w) => w.zh)].join(" ")), "zh-Hant of the recomputed descriptors");
      }
      const norm = (k: string) => {
        const i = k.indexOf(":");
        const lang = k.slice(0, i), t = k.slice(i + 1);
        // composite aliases are compared as unordered word sets; single words compare as written
        return p.category === "exit" && t.includes(" ") ? `${lang}:${tokens(t)}` : k;
      };
      const allowedNorm = new Map([...allowed].map(([k, v]) => [norm(k), v]));
      // #214: a shop's only aliases are kana readings its directory prints (checked in the shop block below).
      for (const a of p.aliases) {
        if (isShop(p)) expect(a.lang, `${p.id} alias ${a.text}`).toBe("ja-Hrkt");
        else if (isWp4(p)) {
          // #501: a Metro exit's alias is the printed code of a 番出口 name (A6 of A6番出口); the Marunouchi POIs
          // also carry the printed M08 and "Marunouchi Line". The exact set is asserted in the WP4 block below.
          expect(["ja", "en"], `${p.id} alias ${a.lang}`).toContain(a.lang);
        } else expect(allowedNorm.has(norm(`${a.lang}:${a.text}`)), `${p.id} alias ${a.lang}:${a.text}`).toBe(true);
      }
    }
  });

  it("lets nobody read a JR or other-operator claim out of a name or alias", () => {
    const other = /JR|ＪＲ|山手|京王|小田急|メトロ|丸ノ内|丸ノ内線|新宿線|中央線|Yamanote|Keio|Odakyu|Metro|Marunouchi|西口|南口|東口|Nishiguchi/i;
    // S03 search-only POIs (#411) and merchant listings (#214) carry other operators' printed names by design;
    // both are checked for having no route in their own blocks.
    for (const p of pois.filter(isE27)) for (const t of [...p.names, ...p.aliases]) expect(t.text, `${p.id} ${t.lang}`).not.toMatch(other);
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
  it("keeps to the five E27 categories Shinjuku has a source anchor for (no kiosks, benches or vending)", () => {
    // #214 adds shops, but only as facts-only listings from the merchant directories (their own block below).
    expect([...new Set(pois.filter(isE27).map((p) => p.category))].sort()).toEqual(["elevator", "exit", "platform", "ticket_gate", "toilet"]);
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
      expect(notes, p.id).toMatch(/not the door/);
      expect(notes, p.id).not.toMatch(/F\d{3}/);
      expect(p.evidence!.method, p.id).toContain(`GSI ${pts.find((f) => near(f, p.displayPosition!) < 0.02)!.category}`);
    }
  });

  it("cross-checks every lift POI against the GSI lift points (F012) and reports any mismatch", () => {
    const pts = facilities.filter((f) => f.category === "F012");
    const lifts = byCategory("elevator").filter(isE27);
    // every GSI lift point lies within 4 m of one E27 lift POI, and no E27 lift POI lacks one
    for (const f of pts) expect(lifts.some((p) => near(f, p.displayPosition!) <= 4), `F012 ${f.level} ${f.x},${f.y}`).toBe(true);
    const mismatched: string[] = [];
    for (const p of lifts) {
      const own = pts.filter((f) => near(f, p.displayPosition!) <= 4);
      expect(own.length, p.id).toBeGreaterThan(0);
      const e27 = new Set([...new Set(p.connectorNodeIds.map((id) => floors.get(nodes.get(id)!.floorId)!.ordinal!))].map((o) => (o === 0 ? 1 : o)));
      const gsi = new Set(own.map((f) => f.ordinal));
      const agree = [...e27].every((o) => gsi.has(o)) && [...gsi].every((o) => e27.has(o));
      const jaNote = p.notes!.find((n) => n.lang === "ja")!.text;
      const enNote = p.notes!.find((n) => n.lang === "en")!.text;
      expect(/確認できません|停止がありません/.test(jaNote), `${p.id} ja`).toBe(!agree);
      expect(/not confirmed by the station map|has no stop there/.test(enNote), `${p.id} en`).toBe(!agree);
      expect(p.evidence!.method, p.id).toContain("F012");
      if (!agree) mismatched.push(p.id);
    }
    // Known result at import time: the B1–B3 lift has no F012 point on B3.
    expect(mismatched).toEqual(["poi:elevator:2"]);
    expect(byCategory("elevator").find((p) => p.id === "poi:elevator:2")!.notes!.find((n) => n.lang === "ja")!.text).toContain("B3の停止は構内地図で確認できません");
    expect(byCategory("elevator").find((p) => p.id === "poi:elevator:2")!.notes!.find((n) => n.lang === "en")!.text).toContain("the B3 stop is not confirmed by the station map");
  });

  it("names ticket gates per E27 gate cluster and counts every F106 point once, for its nearest cluster", () => {
    const pts = facilities.filter((f) => f.category === "F106");
    const gates = byCategory("ticket_gate").filter((p) => !isS03(p));
    expect(gates.length).toBeGreaterThan(0);
    expect(gates.length).toBeLessThanOrEqual(pts.length);
    const counts = gates.map((g) => {
      const level = floors.get(g.floorId!)!.ordinal!;
      const sameLevel = gates.filter((o) => floors.get(o.floorId!)!.ordinal === level);
      const n = pts.filter((f) => f.ordinal === level && sameLevel.reduce((best, o) => (near(f, o.displayPosition!) < near(f, best.displayPosition!) ? o : best)) === g).length;
      const suffix = `F106 points nearest this cluster on this level: ${n}`;
      expect(g.evidence!.method.endsWith(suffix), `${g.id} evidence should end with "${suffix}"`).toBe(true);
      return n;
    });
    expect(counts.reduce((a, b) => a + b, 0)).toBe(pts.length); // no overlap, none lost
    expect(counts).toEqual([1, 4, 1]);
  });

  it("keeps internal facility codes and cross-check jargon out of user-visible notes", () => {
    for (const p of pois) {
      for (const n of p.notes ?? []) {
        expect(n.text, `${p.id} ${n.lang}`).not.toMatch(/\b[FB]\d{3}\b/);
        expect(n.text, `${p.id} ${n.lang}`).not.toContain("GSI");
        expect(n.text, `${p.id} ${n.lang}`).not.toContain("E27 gate link");
        expect(n.text, `${p.id} ${n.lang}`).not.toContain("NWD");
      }
    }
  });

  it("matches the old POI count plus only source-backed additions", () => {
    const OLD_COUNT = 16; // pois.json at fe8d3b6: 6 exits, 3 gates, 1 platform, 3 lifts, 3 toilets
    // #106 adds no POI: station-name hits ride on the Oedo platform, and the GSI toilet / lift / gate
    // points were already modelled (and are now cross-checked). A new entry must be listed here with its source.
    const ADDED: { id: string; source: string }[] = [];
    // #411: 45 search-only line POIs from tokyo-s03-zip, appended after every E27 POI (see the S03 block below).
    const S03_COUNT = 45;
    // #214: 6 Toei/Tokyo Metro + 576 LUMINE/NEWoMan listings + the Odakyu department store, plus the 7 store
    // POIs for the printed buildings (LUMINE 1/2, LUMINE EST, NEWoMan, 新宿マルイ 本館/アネックス/メン).
    const SHOP_COUNT = 590;
    // #501: 9 Toei station exits + 28 Metro M08 exits + 4 lifts + 2 escalators (see the WP4 block); the 2 M08 gates are held.
    const WP4_COUNT = 43;
    expect(pois.length).toBe(OLD_COUNT + ADDED.length + S03_COUNT + SHOP_COUNT + WP4_COUNT);
    const e27Pois = pois.filter(isE27);
    expect(e27Pois.length).toBe(OLD_COUNT + ADDED.length);
    const bySource = { exit: 6, ticket_gate: 3, platform: 1, elevator: 3, toilet: 3 } as const;
    for (const [c, n] of Object.entries(bySource)) expect(e27Pois.filter((p) => p.category === c).length, c).toBe(n);
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
    ["屋根あり", ["poi:exit:1"]], ["roofed", ["poi:exit:1"]], 
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

  it.each(["JR新宿", "東京メトロ", "Tokyo Metro", "都営新宿線", "E01", "Yamanote", "3番出口", "Exit 3", "屋根なし"])(
    "%s returns no Shinjuku POI claim",
    (query) => {
      expect(strong(query)).toEqual([]);
    },
  );

  // #411: other operators' names resolve only to the search-only S03 POIs, since #214 the facts-only merchant
  // listings (e.g. 小田急百貨店, or a shop whose printed name names an exit) and, since #501, the WP4 line
  // POIs (Toei station exits, Metro M08 exits/lifts/escalators). None has a route.
  it.each(["JR", "山手線", "中央線", "京王", "京王線", "小田急", "小田急線", "丸ノ内線", "西口", "南口", "東口", "新宿西口", "A1出口"])(
    "%s returns only search-only S03, shop or WP4 line POIs (no route)",
    (query) => {
      const hits = strong(query);
      expect(hits.length).toBeGreaterThan(0);
      for (const h of hits) {
        expect(isS03(h.poi) || isShop(h.poi) || isWp4(h.poi), h.poi.id).toBe(true);
        expect(h.poi.connectorNodeIds, h.poi.id).toEqual([]);
      }
    },
  );

  it("returns nothing at all (not even fuzz) for Yamanote, 都営新宿線 and E01", () => {
    for (const q of ["Yamanote", "都営新宿線", "E01"]) expect(index.search(q, { limit: 10 })).toEqual([]);
  });
});

describe("S03 search-only line POIs (#411)", () => {
  const s03Pois = pois.filter(isS03);
  const index = createSearchIndex(bundle);
  const srcEntry = bundle.sources.find((s) => s.id === S03_SOURCE);

  it("has 45 S03 POIs, after every E27 POI and before the #214 shops", () => {
    expect(s03Pois.length).toBe(45);
    const lastE27 = Math.max(...pois.flatMap((p, i) => (isE27(p) ? [i] : [])));
    const firstS03 = Math.min(...pois.flatMap((p, i) => (isS03(p) ? [i] : [])));
    const lastS03 = Math.max(...pois.flatMap((p, i) => (isS03(p) ? [i] : [])));
    const firstShop = Math.min(...pois.flatMap((p, i) => (isShop(p) ? [i] : [])));
    expect(firstS03).toBeGreaterThan(lastE27);
    expect(firstShop).toBeGreaterThan(lastS03);
  });

  it("gives each S03 POI no floor, position, connector or paid value", () => {
    for (const p of s03Pois) {
      expect(p.floorId, p.id).toBeNull();
      expect(p.displayPosition, p.id).toBeNull();
      expect(p.paid, p.id).toBeNull();
      expect(p.connectorNodeIds, p.id).toEqual([]);
    }
  });

  it("cites tokyo-s03-zip, plus the printed line page on the two Marunouchi gates", () => {
    for (const p of s03Pois) {
      const lineAlias = p.id === "poi:tokyometro-gate:1" || p.id === "poi:tokyometro-gate:2";
      expect(p.evidence.sourceIds, p.id).toEqual(lineAlias ? [S03_SOURCE, "tokyometro-shinjuku-station-en-2026-10"] : [S03_SOURCE]);
    }
  });

  it("carries the March 2020 ja and en notes", () => {
    for (const p of s03Pois) {
      const ja = p.notes?.find((n) => n.lang === "ja")?.text ?? "";
      const en = p.notes?.find((n) => n.lang === "en")?.text ?? "";
      expect(ja, `${p.id} ja`).toContain("2020年3月時点");
      expect(en, `${p.id} en`).toContain("As of March 2020");
    }
  });

  it("has no aliases, except the printed line code and English line name on the two Marunouchi gates", () => {
    for (const p of s03Pois) {
      const metro = p.id === "poi:tokyometro-gate:1" || p.id === "poi:tokyometro-gate:2";
      expect(p.aliases, p.id).toEqual(
        metro ? [{ lang: "en", text: "M08" }, { lang: "en", text: "Marunouchi Line" }] : [],
      );
    }
  });

  it("registers tokyo-s03-zip as a modified source with the exact attribution", () => {
    expect(srcEntry).toBeDefined();
    expect(srcEntry!.modified).toBe(true);
    expect(srcEntry!.attribution).toBe("出典：東京都都市整備局「新宿駅周辺の施設情報等」");
    // CC BY 4.0, not facts-only: the app would otherwise say the source has no licence.
    expect(srcEntry!.usage).not.toBe("facts-only");
    expect(srcEntry!.license).toEqual({
      name: [
        { lang: "ja", text: "CC BY 4.0（データセット単位の表示）" },
        { lang: "en", text: "CC BY 4.0 (stated at dataset level)" },
      ],
      url: "https://creativecommons.org/licenses/by/4.0/",
    });
  });

  it("keeps the S03 credit out of plan.json, which S03 does not feed", () => {
    expect((planJson as unknown as { attribution: string[] }).attribution).not.toContain("出典：東京都都市整備局「新宿駅周辺の施設情報等」");
  });

  it("uses no poi:toei ids", () => {
    for (const p of s03Pois) expect(p.id.startsWith("poi:toei"), p.id).toBe(false);
  });

  it("keeps a routable POI as the top hit for 新宿 and Shinjuku", () => {
    for (const q of ["新宿", "Shinjuku"]) {
      const top = index.search(q, { limit: 10 })[0];
      expect(top, q).toBeDefined();
      expect(top!.poi.connectorNodeIds.length, `${q} → ${top!.poi.id}`).toBeGreaterThan(0);
    }
  });

  it("finds an S03 gate by its own name (read from pois.json, not written here)", () => {
    const name = text(pois.find((p) => p.id === "poi:jreast-gate:7")!, "ja")!;
    expect(index.search(name, { limit: 10 }).map((h) => h.poi.id)).toContain("poi:jreast-gate:7");
  });

  it("S03 approximate points (#463)", () => {
    // The ids come from the derived input, never from literals: this file is Apache-2.0 and the points are
    // S03-derived (NOTICE 4.7). Search display only: no connector, no displayPosition, no floor, no routing.
    const approxPois = pois.filter((p) => p.approximatePosition !== undefined);
    expect(approxPois.length).toBe(25);
    expect(approxPois.filter((p) => p.category === "ticket_gate").length).toBe(22);
    expect(approxPois.filter((p) => p.category === "transfer").length).toBe(3);
    const derivedIds = approxPositions.positions.map((r) => r.poiId);
    expect(approxPois.map((p) => p.id).sort()).toEqual([...derivedIds].sort());
    for (const p of approxPois) {
      expect(isS03(p), p.id).toBe(true);
      expect(["ticket_gate", "transfer"], p.id).toContain(p.category);
      expect(p.connectorNodeIds, p.id).toEqual([]);
      expect(p.displayPosition, p.id).toBeNull();
      expect(p.floorId, p.id).toBeNull();
      const a = p.approximatePosition!;
      expect(a.navigationUse, p.id).toBe("NOT_FOR_ROUTING");
      expect(a.floor, p.id).toBe("UNVERIFIED");
      expect(a.uncertaintyM, p.id).toBeGreaterThanOrEqual(5);
      expect(Number.isFinite(a.east) && Number.isFinite(a.north), p.id).toBe(true);
    }
  });

  it("leaves the unpointed Keio gate and every platform name-only (#463)", () => {
    const keio = pois.find((p) => p.id === "poi:keio-gate:1");
    expect(keio, "poi:keio-gate:1 is in the bundle").toBeDefined();
    expect(keio!.approximatePosition).toBeUndefined();
    for (const p of pois.filter((x) => x.category === "platform")) expect(p.approximatePosition, p.id).toBeUndefined();
  });

  it("never gives an E27 POI a point, and keeps the points out of the graph (#463)", () => {
    for (const p of pois.filter((x) => !isS03(x))) expect(p.approximatePosition, p.id).toBeUndefined();
    const graphText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "gteki/graph.json"), "utf8");
    for (const p of pois.filter((x) => x.approximatePosition !== undefined)) expect(graphText.includes(p.id), `${p.id} appears in graph.json`).toBe(false);
  });
});

describe("WP4 line POIs (#501)", () => {
  const wp4 = pois.filter(isWp4);
  const index = createSearchIndex(bundle);
  const TOEI_SOURCE = "toei-shinjuku-station-2026-10";
  const isToei = (p: Poi) => p.evidence.sourceIds.includes(TOEI_SOURCE);

  it("imports the 43 rows the gap table lists: 9 Toei exits, 28 Metro exits, 4 lifts, 2 escalators", () => {
    expect(wp4.length).toBe(43);
    const toei = wp4.filter(isToei);
    expect(toei.length).toBe(9);
    for (const p of toei) expect(p.category, p.id).toBe("exit");
    const metro = wp4.filter((p) => !isToei(p));
    expect(metro.filter((p) => p.category === "exit").length).toBe(28);
    expect(metro.filter((p) => p.category === "elevator").length).toBe(4);
    expect(metro.filter((p) => p.category === "escalator").length).toBe(2);
  });

  it("holds the two WP4 Metro gates for the WP10 field check, and keeps the S03 pair", () => {
    expect(pois.some((p) => p.id === "poi:tokyometro-gate:3" || p.id === "poi:tokyometro-gate:4")).toBe(false);
    expect(pois.some((p) => p.id === "poi:tokyometro-gate:1" && isS03(p))).toBe(true);
    expect(pois.some((p) => p.id === "poi:tokyometro-gate:2" && isS03(p))).toBe(true);
  });

  it("gives each WP4 POI no floor, position, connector, paid value or approximate point", () => {
    for (const p of wp4) {
      expect(p.floorId, p.id).toBeNull();
      expect(p.displayPosition, p.id).toBeNull();
      expect(p.connectorNodeIds, p.id).toEqual([]);
      expect(p.paid, p.id).toBeNull();
      expect(p.approximatePosition, p.id).toBeUndefined();
    }
  });

  it("keeps the printed ja name, the printed exit code, the printed line code and name, and the unverified note", () => {
    for (const p of wp4) {
      expect(p.names.length, p.id).toBe(1);
      expect(p.names[0]!.lang, p.id).toBe("ja");
      // #501 review: an exit keeps only the lettered code its printed name starts with (A6 of A6番出口, A1 of
      // A1出口); the bare Toei 1–8 aliases were dropped because a lone number matches the whole station (#506),
      // and no lift or escalator has an alias. A Marunouchi POI also carries the printed M08 and
      // "Marunouchi Line"; the Toei exits carry no line and so no line alias. Asserted as an exact set, so an
      // empty alias cannot pass.
      const printed = p.names[0]!.text;
      const code = p.category === "exit" ? /^(.*?)番?出?口$/.exec(printed)?.[1] : undefined;
      const metro = p.evidence.sourceIds.includes("tokyometro-shinjuku-station-en-2026-10");
      expect(p.aliases.map((a) => a.text), p.id).toEqual([
        ...(code && /[a-z]/i.test(code) ? [code] : []),
        ...(metro ? ["M08", "Marunouchi Line"] : []),
      ]);
      const ja = p.notes?.find((n) => n.lang === "ja")?.text ?? "";
      const en = p.notes?.find((n) => n.lang === "en")?.text ?? "";
      expect(ja, `${p.id} ja`).toContain("位置・入口は未確認");
      expect(en, `${p.id} en`).toContain("Location and entrance not verified");
    }
  });

  it("keeps Toei exits 1 and 2 printed as closed, with no route", () => {
    for (const id of ["poi:toei-exit:1", "poi:toei-exit:2"]) {
      const p = pois.find((x) => x.id === id)!;
      expect(p, id).toBeDefined();
      expect(p.notes!.find((n) => n.lang === "ja")!.text, id).toMatch(/閉鎖中/);
      expect(p.notes!.find((n) => n.lang === "en")!.text, id).toContain("closed");
      expect(p.connectorNodeIds, id).toEqual([]);
    }
  });

  it("registers the five WP4 sources as facts-only with their clearance decision", () => {
    for (const id of WP4_SOURCES) {
      const src = bundle.sources.find((s) => s.id === id);
      expect(src, id).toBeDefined();
      expect(src!.usage, id).toBe("facts-only");
      expect(src!.decision, id).toBeDefined();
      expect(src!.retrievedAt, id).toBeTruthy();
    }
  });

  it("finds a WP4 exit by its own printed name (read from pois.json, not written here)", () => {
    const exit = wp4.find((p) => p.category === "exit" && p.names[0]!.text.length >= 4)!;
    expect(index.search(exit.names[0]!.text, { limit: 10 }).map((h) => h.poi.id)).toContain(exit.id);
  });

  it("keeps a routable POI as the top hit for 出口 and Exit", () => {
    for (const q of ["出口", "Exit"]) expect(index.search(q, { limit: 10 })[0]!.poi.connectorNodeIds.length, q).toBeGreaterThan(0);
  });
});

describe("line-code and English line-name aliases (M08 / Marunouchi Line)", () => {
  const index = createSearchIndex(bundle);
  const ALIAS_SOURCE = "tokyometro-shinjuku-station-en-2026-10";
  const metro = pois.filter((p) => p.evidence.sourceIds.includes(ALIAS_SOURCE));

  it("puts M08 and Marunouchi Line on the 36 Marunouchi POIs only", () => {
    expect(metro.length).toBe(36);
    expect(metro.filter((p) => p.id.startsWith("poi:tokyometro-exit:")).length).toBe(28);
    expect(metro.filter((p) => p.category === "ticket_gate").length).toBe(2);
    expect(metro.filter((p) => p.category === "elevator").length).toBe(4);
    expect(metro.filter((p) => p.category === "escalator").length).toBe(2);
    for (const p of metro) {
      expect(p.aliases, p.id).toContainEqual({ lang: "en", text: "M08" });
      expect(p.aliases, p.id).toContainEqual({ lang: "en", text: "Marunouchi Line" });
    }
    for (const p of pois) {
      if (metro.includes(p)) continue;
      expect(p.aliases.some((a) => a.text === "M08" || a.text === "Marunouchi Line"), p.id).toBe(false);
    }
  });

  it("finds every Marunouchi POI by M08, m08 and Marunouchi Line", () => {
    for (const q of ["M08", "m08", "Marunouchi Line"]) {
      const ids = index.search(q, { limit: 100 }).map((h) => h.poi.id);
      for (const p of metro) expect(ids, `${q} -> ${p.id}`).toContain(p.id);
    }
  });

  it("gives the Toei exits, JR, Keio and Odakyu no line code or English line name", () => {
    for (const id of ["poi:toei-exit:a1", "poi:toei-exit:1", "poi:jreast-gate:1", "poi:jreast-platform:14", "poi:keio-gate:1", "poi:odakyu-gate:1", "poi:odakyu-platform:2"]) {
      const p = pois.find((x) => x.id === id)!;
      expect(p.aliases.some((a) => a.lang === "en"), id).toBe(false);
    }
  });
});

describe("merchant shops (#214)", () => {
  const shops = pois.filter(isShop);
  const index = createSearchIndex(bundle);

  it("imports the 583 directory listings and the 7 store POIs as search-only shops", () => {
    expect(shops.length).toBe(590);
    for (const p of shops) {
      expect(p.evidence.sourceIds.length, p.id).toBe(1);
      expect(bundle.sources.some((s) => s.id === p.evidence.sourceIds[0]), p.id).toBe(true);
      // No position, floor, fare-gate value or connector: a directory listing is not route evidence.
      expect(p.floorId, p.id).toBeNull();
      expect(p.displayPosition, p.id).toBeNull();
      expect(p.connectorNodeIds, p.id).toEqual([]);
      expect(p.paid, p.id).toBeNull();
      expect(p.approximatePosition, p.id).toBeUndefined();
    }
  });

  it("keeps one store POI per printed building, with its operator and floor range in the notes", () => {
    const store: [string, string, string][] = [
      ["shop-sjk-lumine1", "ルミネ新宿 ルミネ1", "B2F〜8F"],
      ["shop-sjk-lumine2", "ルミネ新宿 ルミネ2", "1F〜7F"],
      ["shop-sjk-lumineest", "ルミネエスト新宿", "B2F〜8F"],
      ["shop-sjk-newoman", "ニュウマン新宿", "1F〜7F"],
      ["shop-sjk-marui-honkan", "新宿マルイ 本館", "B1F〜8F"],
      ["shop-sjk-marui-annex", "新宿マルイ アネックス", "B1F〜8F"],
      ["shop-sjk-marui-men", "新宿マルイ メン", "1F〜8F"],
    ];
    expect(store.filter(([id]) => shops.some((p) => p.id === id)).length).toBe(store.length);
    for (const [id, name, floors] of store) {
      const p = pois.find((x) => x.id === id)!;
      expect(p.names[0]!.text, id).toBe(name);
      expect(p.aliases, id).toEqual([]);
      const ja = p.notes!.find((n) => n.lang === "ja")!.text;
      expect(ja, id).toContain("運営:");
      expect(ja, id).toContain(floors);
    }
  });

  it("keeps the printed name and says the location is unverified", () => {
    for (const p of shops) {
      expect(p.names.length, p.id).toBe(1);
      expect(p.names[0]!.lang, p.id).toBe("ja");
      expect(p.names[0]!.text.trim(), p.id).not.toBe("");
      const ja = p.notes?.find((n) => n.lang === "ja")?.text ?? "";
      const en = p.notes?.find((n) => n.lang === "en")?.text ?? "";
      expect(ja, `${p.id} ja`).toContain("未確認");
      expect(en, `${p.id} en`).toContain("not verified");
    }
  });

  it("keeps the S03 and merchant credit out of plan.json, which neither feeds", () => {
    const attribution = (planJson as unknown as { attribution: string[] }).attribution;
    for (const s of bundle.sources.filter((s) => isShopSource(s.id))) expect(attribution, s.id).not.toContain(s.attribution);
  });

  it("finds a shop by its own printed name (read from pois.json, not written here)", () => {
    const shop = shops.find((p) => p.names[0]!.text.length >= 4)!;
    expect(index.search(shop.names[0]!.text, { limit: 10 }).map((h) => h.poi.id)).toContain(shop.id);
  });
});

/** The merchant sources (#214): the shops' own directory sources, whatever the batch. */
function isShopSource(id: string): boolean {
  return pois.some((p) => isShop(p) && p.evidence.sourceIds.includes(id));
}
