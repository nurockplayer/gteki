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
    const index = indexFor(bundleWith([poi("wide", "a---xxx---b---xxx---c"), poi("tight", "axbc"), poi("wrong", "cba")]));
    const hits = index.search("abc");
    expect(hits.map((hit) => hit.poi.id)).toEqual(["tight", "wide"]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    expect(hits[0]!.score).toBeLessThanOrEqual(40);
  });

  it("finds a tight later subsequence rather than penalising an early loose match", () => {
    const index = indexFor(bundleWith([poi("later", "a very long path axbc"), poi("only", "axxbc")]));
    expect(index.search("abc").map((hit) => hit.poi.id)).toEqual(["later", "only"]);
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

  it("sorts ties by display name then id regardless of bundle order", () => {
    const pois = [
      poi("z", "Alpha", { aliases: [{ lang: "en", text: "Gate" }] }),
      poi("a", "Alpha", { aliases: [{ lang: "en", text: "Gate" }] }),
      poi("b", "Beta", { aliases: [{ lang: "en", text: "Gate" }] }),
    ];
    const expected = indexFor(bundleWith(pois)).search("gate");
    expect(expected.map((hit) => hit.poi.id)).toEqual(["a", "z", "b"]);
    expect(indexFor(bundleWith([...pois].reverse())).search("gate")).toEqual(expected);
  });
});
