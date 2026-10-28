// #419: the Tobu Department Store brand directory (facts-only, OD-34) makes a brand search return the
// store's own card with the printed floor. Runs on the real bundle with the real search engine.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStationFiles, validateBundle, type StationBundle } from "@gteki/schema";
import { createSearchIndex } from "../../../packages/search/src/index.ts";

const read = (f: string): unknown => JSON.parse(fs.readFileSync(new URL(`../gteki/${f}`, import.meta.url), "utf8"));

const bundle: StationBundle = (() => {
  const parsed = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"), read("tenants.json"));
  if (!parsed.ok || !parsed.bundle) throw new Error("Ikebukuro bundle failed to parse");
  return parsed.bundle;
})();

describe("西武池袋本店 brand directory (OD-35)", () => {
  it("returns shop-ikb-seibu-honten's card with the printed floor for a Seibu-only brand", () => {
    expect(createSearchIndex(bundle).search("ACQUA DI PARMA")[0]).toMatchObject({
      poi: { id: "shop-ikb-seibu-honten", category: "shop" },
      tenant: { name: "ACQUA DI PARMA", floorLabel: "1F", category: "コスメ＆ビューティー" },
    });
  });
});

describe("Tobu Department Store brand directory (#419)", () => {
  it("returns shop-ikb-tobudept's card with the printed floor for a real brand", () => {
    expect(validateBundle(bundle).filter((issue) => issue.level === "error")).toEqual([]);
    const index = createSearchIndex(bundle);
    for (const brand of [
      { name: "浅草今半", floorLabel: "B2F", category: "食品" },
      { name: "紀伊國屋書店", floorLabel: "7F", category: "文具・書籍" },
      { name: "とらや", floorLabel: "B1F", category: "食品" },
    ]) {
      // A brand may also be in 西武池袋本店, so look for Tobu's card among the hits.
      expect(index.search(brand.name).find((hit) => hit.poi.id === "shop-ikb-tobudept")).toMatchObject({
        poi: { id: "shop-ikb-tobudept", category: "shop" },
        matched: brand.name,
        tenant: { name: brand.name, floorLabel: brand.floorLabel, category: brand.category },
      });
    }
  });
});
