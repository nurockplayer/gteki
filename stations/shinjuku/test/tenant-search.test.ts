import { describe, expect, it } from "vitest";
import { createSearchIndex } from "@gteki/search";
import { loadShinjukuBundle } from "../data/bundle.ts";

/**
 * #419: the Odakyu Department Store brand directory ships as gteki/tenants.json. Searching a brand
 * returns the store's own card with the floor label the store prints; there is no per-brand POI.
 */
const { bundle, issues } = loadShinjukuBundle();
const search = createSearchIndex(bundle).search;

describe("Odakyu Department Store brand search (#419)", () => {
  it("loads the brand directory with no validation errors", () => {
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(bundle.tenants).toHaveLength(269);
    expect(new Set(bundle.tenants!.map((t) => t.poiId))).toEqual(new Set(["shop-sjk-odakyudept"]));
  });

  it.each([
    ["赤坂柿山", "地下１階"],
    ["アナ スイ", "１階"],
    ["アクセーヌ", "地下１階"],
  ])("returns the store card with the printed floor for %s", (brand, floor) => {
    const hits = search(brand);
    expect(hits[0]).toMatchObject({
      poi: { id: "shop-sjk-odakyudept" },
      matched: brand,
      tenant: { name: brand, floorLabel: floor },
    });
  });
});
