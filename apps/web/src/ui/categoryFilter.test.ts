// The category filter of the search fields (#213): the choices offered per station, and the filter the
// search index already supports (`SearchOptions.categories`). Real bundles, no fixtures.
import { describe, expect, it } from "vitest";
import { parseStationFiles } from "@gteki/schema";
import { createSearchIndex } from "@gteki/search";
import { categoriesIn, CATEGORY_ORDER } from "./categoryFilter.ts";
import shinjukuManifest from "../../../../stations/shinjuku/gteki/station.json" with { type: "json" };
import shinjukuGraph from "../../../../stations/shinjuku/gteki/graph.json" with { type: "json" };
import shinjukuPois from "../../../../stations/shinjuku/gteki/pois.json" with { type: "json" };
import ikebukuroManifest from "../../../../stations/ikebukuro/gteki/station.json" with { type: "json" };
import ikebukuroGraph from "../../../../stations/ikebukuro/gteki/graph.json" with { type: "json" };
import ikebukuroPois from "../../../../stations/ikebukuro/gteki/pois.json" with { type: "json" };

const bundleOf = (manifest: unknown, graph: unknown, pois: unknown) => {
  const parsed = parseStationFiles(manifest, graph, pois);
  if (!parsed.ok) throw new Error(parsed.issues.filter((i) => i.level === "error").map((i) => i.message).join("; "));
  return parsed.bundle;
};

const shinjuku = bundleOf(shinjukuManifest, shinjukuGraph, shinjukuPois);
const ikebukuro = bundleOf(ikebukuroManifest, ikebukuroGraph, ikebukuroPois);

describe("search category filter (#213)", () => {
  it("offers only the categories a station has, in the fixed order with shops first", () => {
    const shinjukuCategories = categoriesIn(shinjuku.pois);
    expect(shinjukuCategories[0]).toBe("shop");
    expect(shinjukuCategories).toEqual([...CATEGORY_ORDER].filter((c) => shinjuku.pois.some((p) => p.category === c)));
    // Neither station has a category it never uses.
    expect(categoriesIn(ikebukuro.pois)).toContain("shop");
    expect(categoriesIn([])).toEqual([]);
  });

  it("narrows a shop search to the category and drops other categories", () => {
    for (const [bundle, query] of [[shinjuku, "カレー"], [ikebukuro, "マツモトキヨシ"]] as const) {
      const index = createSearchIndex(bundle);
      const all = index.search(query, { limit: 20 });
      const shops = index.search(query, { limit: 20, categories: ["shop"] });
      expect(all.length, query).toBeGreaterThan(0);
      expect(shops.length, query).toBeGreaterThan(0);
      expect(shops.every((h) => h.poi.category === "shop"), query).toBe(true);
      // Every shop hit the unfiltered search made is still there: the filter only removes other categories.
      expect(shops.map((h) => h.poi.id), query).toEqual(all.filter((h) => h.poi.category === "shop").map((h) => h.poi.id));
    }
  });

  it("returns nothing, not a different place, when the category has no match", () => {
    // No shop in either station is named after an exit: a category filter never falls back to other POIs.
    for (const bundle of [shinjuku, ikebukuro]) {
      const index = createSearchIndex(bundle);
      expect(index.search("出口", { limit: 20, categories: ["shop"] }).filter((h) => h.score >= 30)).toEqual([]);
    }
  });

  it("keeps a shop hit search-only under the filter, as without it", () => {
    const hits = createSearchIndex(shinjuku).search("カレー", { categories: ["shop"] });
    for (const h of hits) expect(h.poi.connectorNodeIds, h.poi.id).toEqual([]);
  });
});
