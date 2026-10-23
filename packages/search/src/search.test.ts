import { describe, expect, it } from "vitest";
import { validateBundle } from "@gteki/schema";
import type { Poi, StationBundle } from "@gteki/schema";
import { createSyntheticBundle, syntheticEvidence } from "../../navigation/src/fixtures.ts";
import { createSearchIndex, normalizeJa } from "./index.ts";

function indexFor(bundle = createSyntheticBundle()) {
  expect(validateBundle(bundle).filter((issue) => issue.level === "error")).toEqual([]);
  return createSearchIndex(bundle);
}

function poi(id: string, name: string, overrides: Partial<Poi> = {}): Poi {
  return {
    id, category: "other", names: [{ lang: "en", text: name }], aliases: [],
    floorId: "concourse", displayPosition: null, connectorNodeIds: [], paid: null,
    evidence: syntheticEvidence(), ...overrides,
  };
}

function bundleWith(pois: Poi[]): StationBundle {
  const bundle = createSyntheticBundle();
  bundle.pois = pois;
  return bundle;
}

describe("normalizeJa", () => {
  it.each([
    ["トイレ", "といれ"], ["ﾄｲﾚ", "といれ"], ["Ａ１", "a1"],
    ["ＥＸＩＴ　１２", "exit12"], [" ヴァ・ヴィ・ヴェ・ヴォ ", "ゔぁゔぃゔぇゔぉ"],
    ["（Ａ－１）・出口〜~！", "a1出口"], ["コイン・ロッカー", "こいんろっか"],
    ["【西口】「出口」『１』［Ａ］｛Ｂ｝", "西口出口1ab"],
    ["<Ａ１>〈西口〉《出口》", "a1西口出口"],
    ["a-b‐c‑d–e—f−g", "abcdefg"], ["exit, A1: 'West'. / 北口？", "exita1west北口"],
    ["a\t b\n c", "abc"], ["東京２ＦABC", "東京2fabc"],
  ])("normalizes %j to %j", (input, output) => {
    expect(normalizeJa(input)).toBe(output);
    expect(normalizeJa(output)).toBe(output);
  });
});

describe("station POI search", () => {
  it("matches katakana, hiragana and half-width kana identically", () => {
    const index = indexFor();
    for (const query of ["トイレ", "といれ", "ﾄｲﾚ"]) {
      expect(index.search(query)[0]).toMatchObject({ poi: { id: "toilet" }, score: 105, routable: true });
    }
    expect(index.search("といれ")[0]!.matched).toBe("トイレ");
  });

  it("matches full-width latin/digits and romaji aliases", () => {
    const index = indexFor();
    expect(index.search("a1")[0]).toMatchObject({ poi: { id: "exit-a1" }, score: 105, matched: "A1" });
    expect(index.search("Ａ１")).toEqual(index.search("a1"));
    expect(index.search("TOIRE")[0]).toMatchObject({ poi: { id: "toilet" }, score: 105, matched: "toire" });
  });

  it("indexes every localized name and alias without guessing readings", () => {
    const index = indexFor();
    expect(index.search("restroom")[0]).toMatchObject({ poi: { id: "toilet" }, score: 105, matched: "Restroom" });
    expect(index.search("車站商店")[0]).toMatchObject({ poi: { id: "shop" }, score: 100, matched: "車站商店" });
    expect(index.search("ekishoten")).toEqual([]);
  });

  it("ranks exact, prefix, substring, then fuzzy matches", () => {
    const index = indexFor(bundleWith([
      poi("substring", "North West Gate"), poi("fuzzy", "Wonderful Entrance Sign Terminal"),
      poi("prefix", "West Gate"), poi("exact", "West"),
    ]));
    const hits = index.search("west");
    expect(hits.map((hit) => hit.poi.id)).toEqual(["exact", "prefix", "substring", "fuzzy"]);
    expect(hits.slice(0, 3).map((hit) => hit.score)).toEqual([100, 80, 60]);
    expect(hits[3]!.score).toBeGreaterThan(0);
    expect(hits[3]!.score).toBeLessThanOrEqual(40);
  });

  it("uses the best matching alias, returning only one hit per POI", () => {
    const index = indexFor(bundleWith([poi("gate", "North Gate", {
      aliases: [{ lang: "en", text: "Gate" }, { lang: "en", text: "Gate entry" }],
    })]));
    expect(index.search("gate")).toMatchObject([{ poi: { id: "gate" }, score: 100, matched: "Gate" }]);
  });

  it("penalises subsequence gaps and rejects reversed character order", () => {
    const index = indexFor(bundleWith([poi("wide", "a---xxx---b---xxx---c---d"), poi("tight", "axbcd"), poi("wrong", "dcba")]));
    const hits = index.search("abcd");
    expect(hits.map((hit) => hit.poi.id)).toEqual(["tight", "wide"]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    expect(hits[0]!.score).toBeLessThanOrEqual(40);
  });

  it("finds a tight later subsequence rather than penalising an early loose match", () => {
    const index = indexFor(bundleWith([poi("later", "a very long path axbcd"), poi("only", "axxbcd")]));
    expect(index.search("abcd").map((hit) => hit.poi.id)).toEqual(["later", "only"]);
  });

  it("matches multi-word latin tokens in a different order", () => {
    const index = indexFor(bundleWith([
      poi("tokens", "Exit West"), poi("prefix", "West Exit"), poi("missing-token", "West service desk"),
    ]));
    const hits = index.search("ＷＥＳＴ　ＥＸＩＴ");
    expect(hits.map((hit) => hit.poi.id)).toEqual(["prefix", "tokens"]);
    expect(hits.map((hit) => hit.score)).toEqual([100, 40]);
  });

  it("boosts routable POIs and flags search-only POIs", () => {
    const index = indexFor(bundleWith([
      poi("unroutable", "Shop"), poi("routable", "Shop", { connectorNodeIds: ["a"] }),
    ]));
    expect(index.search("shop")).toMatchObject([
      { poi: { id: "routable" }, score: 105, routable: true },
      { poi: { id: "unroutable" }, score: 100, routable: false },
    ]);
    expect(indexFor().search("shop")[0]!.routable).toBe(false);
  });

  it("filters categories and floors together, excluding unknown floors", () => {
    const index = indexFor(bundleWith([
      poi("lower-shop", "Shop", { category: "shop" }),
      poi("upper-shop", "Shop", { category: "shop", floorId: "upper" }),
      poi("unknown-shop", "Shop", { category: "shop", floorId: null }),
      poi("service", "Shop service", { category: "service" }),
    ]));
    expect(index.search("shop", { categories: ["shop"] }).map((hit) => hit.poi.id)).toEqual(["lower-shop", "unknown-shop", "upper-shop"]);
    expect(index.search("shop", { floorIds: ["upper"] }).map((hit) => hit.poi.id)).toEqual(["upper-shop"]);
    expect(index.search("shop", { categories: ["shop"], floorIds: ["concourse"] }).map((hit) => hit.poi.id)).toEqual(["lower-shop"]);
    expect(index.search("shop", { categories: [] })).toEqual([]);
    expect(index.search("shop", { floorIds: [] })).toEqual([]);
  });

  it.each(["", "  ", "\n\t　", "・ー〜~（）--"])("returns no results for an empty normalized query: %j", (query) => {
    expect(indexFor().search(query)).toEqual([]);
  });

  it("applies the default limit and requested limits after ranking", () => {
    const index = indexFor(bundleWith(Array.from({ length: 12 }, (_, i) => poi(`shop-${String(i).padStart(2, "0")}`, "Shop"))));
    expect(index.search("shop")).toHaveLength(10);
    expect(index.search("shop", { limit: 2 }).map((hit) => hit.poi.id)).toEqual(["shop-00", "shop-01"]);
    expect(index.search("shop", { limit: 20 })).toHaveLength(12);
    expect(index.search("shop", { limit: 0 })).toEqual([]);
  });

  it("sorts ties by id regardless of bundle order", () => {
    const pois = [
      poi("z", "Alpha", { aliases: [{ lang: "en", text: "Gate" }] }),
      poi("a", "Beta", { aliases: [{ lang: "en", text: "Gate" }] }),
      poi("b", "Alpha", { aliases: [{ lang: "en", text: "Gate" }] }),
    ];
    const expected = indexFor(bundleWith(pois)).search("gate");
    expect(expected.map((hit) => hit.poi.id)).toEqual(["a", "b", "z"]);
    expect(indexFor(bundleWith([...pois].reverse())).search("gate")).toEqual(expected);
  });

  it("breaks score ties by match quality: starts with the query, then the shorter matched name", () => {
    // Same score, ids sort the other way round: the shorter matched name wins.
    const sub = indexFor(bundleWith([
      poi("a-long", "B1 Central East Gate Underground"), poi("b-short", "B1 East Gate Hall"), poi("c-lead", "East Gate Plaza Annex"),
      poi("d-shorter", "1 East Gate Hall"),
    ]));
    expect(sub.search("east gate").map((hit) => [hit.poi.id, hit.score])).toEqual([
      ["c-lead", 80], ["d-shorter", 60], ["b-short", 60], ["a-long", 60],
    ]);
    const prefix = indexFor(bundleWith([poi("a-long", "East Gate Plaza Annex"), poi("b-short", "East Gate Hall")]));
    expect(prefix.search("east gate").map((hit) => hit.poi.id)).toEqual(["b-short", "a-long"]);
    // 東口: exact, then starts-with, then the shorter of the names that merely contain it.
    const ja = indexFor(bundleWith([
      poi("a", "地下東口コンコース"), poi("b", "東口"), poi("c", "B1東口（地下）"), poi("d", "東口広場"),
    ]));
    expect(ja.search("東口").map((hit) => hit.poi.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("picks each POI's best matching text on equal score, so name/alias order does not change ranking", () => {
    const name = { lang: "en", text: "East Gate Plaza Annex" };
    const alias = { lang: "en", text: "East Gate Hall" };
    const lobby = poi("b", "East Gate Lobby");
    const order = (a: Poi) => indexFor(bundleWith([a, lobby])).search("east gate").map((hit) => [hit.poi.id, hit.score, hit.matched]);
    const expected = [["a", 80, "East Gate Hall"], ["b", 80, "East Gate Lobby"]];
    expect(order(poi("a", "East Gate Plaza Annex", { aliases: [alias] }))).toEqual(expected);
    expect(order(poi("a", "East Gate Hall", { aliases: [name] }))).toEqual(expected);
    expect(order(poi("a", "x", { names: [{ lang: "en", text: name.text }, { lang: "en", text: alias.text }] }))).toEqual(expected);
  });
});

describe("short-query fuzz floor", () => {
  it("does not match short queries as a loose subsequence", () => {
    const index = indexFor(bundleWith([
      poi("noise", "丸之内線 中央通道東剪票口"), poi("tobu", "Tobu Tojo Line Central Gate"), poi("east", "東口"), poi("jr", "JR East Gate"),
    ]));
    expect(index.search("東口").map((hit) => hit.poi.id)).toEqual(["east"]);
    expect(index.search("JR").map((hit) => hit.poi.id)).toEqual(["jr"]);
    expect(index.search("exi")).toEqual([]);
  });

  it("still finds substring, prefix and suffix matches of short queries", () => {
    const index = indexFor(bundleWith([poi("a", "B1 東口（地下）"), poi("b", "新東口"), poi("c", "East JR Gate")]));
    expect(index.search("東口").map((hit) => hit.poi.id)).toEqual(["b", "a"]);
    expect(index.search("jr")[0]).toMatchObject({ poi: { id: "c" }, score: 60 });
  });

  it("keeps subsequence fuzz from four characters", () => {
    expect(indexFor(bundleWith([poi("f", "ab-c-d")])).search("abcd")).toMatchObject([{ poi: { id: "f" } }]);
  });
});

describe("exit numbers", () => {
  const exits = () => indexFor(bundleWith([
    poi("e2", "2番出口"), poi("e22", "22番出口"), poi("e3", "出口（地下1階・南側・通路/コンコースに隣接）"),
    poi("line", "1号線 ホーム"), poi("platform", "1番線 ホーム"),
  ]));

  it.each(["22号出口", "22號出口", "22番出口", "２２号出口", "22号"])("folds 号 / 號 / 番 and full-width digits: %s", (query) => {
    expect(exits().search(query).map((hit) => hit.poi.id)).toEqual(["e22"]);
  });

  it("folds the index side too", () => {
    const index = indexFor(bundleWith([poi("g", "22号出口"), poi("h", "35號出口")]));
    expect(index.search("22番出口")).toMatchObject([{ poi: { id: "g" }, score: 100 }]);
    expect(index.search("35番出口").map((hit) => hit.poi.id)).toEqual(["h"]);
  });

  it("matches the digits as a whole number and ignores descriptive exit names", () => {
    const index = exits();
    expect(index.search("2番出口").map((hit) => hit.poi.id)).toEqual(["e2"]);
    expect(index.search("2号出口").map((hit) => hit.poi.id)).toEqual(["e2"]);
    expect(index.search("3番出口")).toEqual([]);
    expect(index.search("2番")).toMatchObject([{ poi: { id: "e2" } }]);
  });

  it("does not turn line or car numbers into exit numbers", () => {
    expect(normalizeJa("1号線")).toBe("1号線");
    const index = exits();
    expect(index.search("1号線").map((hit) => hit.poi.id)).toEqual(["line"]);
    expect(index.search("1番線").map((hit) => hit.poi.id)).toEqual(["platform"]);
  });
});

describe("station-name prefix", () => {
  function station(pois: Poi[]) {
    const bundle = bundleWith(pois);
    bundle.station.names = [
      { lang: "ja", text: "池袋駅" }, { lang: "ja-Latn", text: "Ikebukuro" }, { lang: "en", text: "Ikebukuro Station (Test Line)" },
    ];
    return indexFor(bundle);
  }
  const pois = () => [
    poi("east", "東口", { aliases: [{ lang: "en", text: "East Exit" }] }), poi("west", "西口", { aliases: [{ lang: "en", text: "West Exit" }] }),
    poi("platform", "池袋駅ホーム", { aliases: [{ lang: "en", text: "Ikebukuro Station platform" }] }),
  ];

  it("also searches the remainder after the station's own name", () => {
    const index = station(pois());
    expect(index.search("池袋東口")[0]).toMatchObject({ poi: { id: "east" }, score: 98 });
    expect(index.search("池袋駅東口")[0]!.poi.id).toBe("east");
    expect(index.search("ikebukuro east exit")[0]).toMatchObject({ poi: { id: "east" }, matched: "East Exit" });
    expect(index.search("Ikebukuro Station West Exit")[0]!.poi.id).toBe("west");
    expect(index.search("ikebukuro east exit").map((hit) => hit.poi.id)).not.toContain("west");
  });

  it("leaves a query that is only the station name as it was", () => {
    const index = station(pois());
    for (const query of ["池袋", "池袋駅", "ikebukuro", "ikebukuro station"]) {
      expect(index.search(query)[0]!.poi.id).toBe("platform");
      expect(index.search(query).map((hit) => hit.poi.id)).not.toContain("east");
    }
  });

  it("ranks a literal match above a stripped one", () => {
    const index = station([...pois(), poi("literal", "池袋東口")]);
    expect(index.search("池袋東口").map((hit) => hit.poi.id).slice(0, 2)).toEqual(["literal", "east"]);
  });
});

describe("script-run matching", () => {
  it("matches parts across word order and script changes", async () => {
    const { scriptRuns } = await import("./search.ts");
    expect(scriptRuns(normalizeJa("でぐち35"))).toEqual(["でぐち", "35"]);
    const bundle = createSyntheticBundle();
    bundle.pois[1]!.aliases.push({ lang: "ja-Hrkt", text: "35ばんでぐち" });
    const hits = createSearchIndex(bundle).search("でぐち35");
    expect(hits[0]?.poi.id).toBe("exit-a1");
    expect(hits[0]?.matched).toBe("35ばんでぐち");
  });
});

describe("head-final ranking", () => {
  it("ranks a suffix (head noun) match above an infix match", () => {
    const bundle = createSyntheticBundle();
    bundle.pois[0]!.names = [{ lang: "ja", text: "トイレ（改札外）" }];
    bundle.pois[1]!.names = [{ lang: "ja", text: "中央改札" }];
    expect(createSearchIndex(bundle).search("改札").map((h) => h.poi.id).slice(0, 2)).toEqual(["exit-a1", "toilet"]);
  });
});
