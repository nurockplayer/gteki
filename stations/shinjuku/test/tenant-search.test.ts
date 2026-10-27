import { describe, expect, it } from "vitest";
import { createSearchIndex } from "@gteki/search";
import { loadShinjukuBundle } from "../data/bundle.ts";

/**
 * #419: the Odakyu Department Store and 新宿マルイ brand directories ship as gteki/tenants.json.
 * Searching a brand returns its store's own card with the floor label the store prints; there is no
 * per-brand POI.
 */
const { bundle, issues } = loadShinjukuBundle();
const search = createSearchIndex(bundle).search;

describe("Department store brand search (#419)", () => {
  it("loads the brand directories with no validation errors", () => {
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(bundle.tenants).toHaveLength(509);
    expect(new Set(bundle.tenants!.map((t) => t.poiId))).toEqual(
      new Set([
        "shop-sjk-odakyudept",
        "shop-sjk-marui-honkan",
        "shop-sjk-marui-annex",
        "shop-sjk-marui-men",
        "shop-sjk-isetan-honkan",
        "shop-sjk-isetan-mens",
      ]),
    );
  });

  it.each([
    ["赤坂柿山", "地下１階"],
    ["アナ スイ", "１階"],
    ["アクセーヌ", "地下１階"],
  ])("returns the Odakyu card with the printed floor for %s", (brand, floor) => {
    const hits = search(brand);
    expect(hits[0]).toMatchObject({
      poi: { id: "shop-sjk-odakyudept" },
      matched: brand,
      tenant: { name: brand, floorLabel: floor },
    });
  });

  it.each([
    ["新宿三丁目ロフト", "shop-sjk-marui-honkan", "3F"],
    ["駿河屋", "shop-sjk-marui-annex", "5F"],
    ["RENNEN by HALB", "shop-sjk-marui-men", "3F"],
  ])("returns the right Marui building for %s", (brand, poiId, floor) => {
    const hits = search(brand);
    expect(hits[0]).toMatchObject({
      poi: { id: poiId },
      matched: brand,
      tenant: { name: brand, floorLabel: floor },
    });
  });

  it("returns the 伊勢丹 メンズ館 card with the printed floor for a 売場 section", () => {
    const section = "レザーグッズ / ベルト / 帽子・傘";
    expect(search(section)[0]).toMatchObject({
      poi: { id: "shop-sjk-isetan-mens" },
      matched: section,
      tenant: { name: section, floorLabel: "1F" },
    });
  });
});
