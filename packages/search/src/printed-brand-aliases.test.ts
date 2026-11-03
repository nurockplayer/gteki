import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStationFiles } from "@gteki/schema";
import { createSearchIndex } from "./index.ts";

function load(station: string) {
  const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../stations/${station}/gteki/${name}.json`, import.meta.url), "utf8"));
  const parsed = parseStationFiles(read("station"), read("graph"), read("pois"), read("tenants"));
  if (!parsed.ok) throw new Error(`${station}: ${JSON.stringify(parsed.issues)}`);
  return { bundle: parsed.bundle, search: createSearchIndex(parsed.bundle).search };
}

const ikebukuro = load("ikebukuro");
const shinjuku = load("shinjuku");

describe("printed brand aliases on the real public bundles", () => {
  it.each([
    ["ikebukuro", "アールエフワン", "shop-ikb-tobudept", "tenant-ikb-tobudept-101119301", "RF1", "B2F"],
    ["ikebukuro", "ASAKUSA IMAHAN", "shop-ikb-tobudept", "tenant-ikb-tobudept-101113101", "浅草今半", "B2F"],
    ["shinjuku", "ANNA SUI", "shop-sjk-odakyudept", "tenant-sjk-odakyudept-013", "アナ スイ", "１階"],
    ["shinjuku", "アップル", "shop-sjk-marui-honkan", "tenant-sjk-marui-003-5876", "Apple", "1F"],
  ])("%s: %s finds the tenant with its printed name and floor", (station, query, poiId, id, name, floorLabel) => {
    const { search } = station === "ikebukuro" ? ikebukuro : shinjuku;
    expect(search(query).find((hit) => hit.poi.id === poiId)).toMatchObject({
      matched: query,
      tenant: { id, name, floorLabel },
    });
  });

  it("does not invent an RF1 reading for Odakyu by copying Tobu's printed reading", () => {
    const tenant = shinjuku.bundle.tenants!.find((row) => row.id === "tenant-sjk-odakyudept-020")!;
    expect(tenant.names).toEqual([{ lang: "ja", text: "RF1" }]);
    expect(tenant.aliases).toEqual([]);
    expect(shinjuku.search("アールエフワン").some((hit) => hit.tenant?.id === tenant.id)).toBe(false);
  });
});
