import { describe, expect, it } from "vitest";
import { validateBundle } from "@gteki/schema";
import type { StationBundle, Tenant } from "@gteki/schema";
import { createSyntheticBundle, createTenantFixtureBundle, syntheticStorePoi } from "../../navigation/src/fixtures.ts";
import { createSearchIndex } from "./index.ts";

function indexFor(bundle: StationBundle) {
  expect(validateBundle(bundle).filter((issue) => issue.level === "error")).toEqual([]);
  return createSearchIndex(bundle);
}

function tenantIn(bundle: StationBundle, id: string): Tenant {
  return bundle.tenants!.find((t) => t.id === id)!;
}

describe("tenant search (#419)", () => {
  it("returns the store card with the brand and its printed floor label", () => {
    const hits = indexFor(createTenantFixtureBundle()).search("サンプル薬局");
    expect(hits[0]).toMatchObject({
      poi: { id: "store", category: "shop" },
      routable: true,
      matched: "サンプル薬局",
      tenant: { id: "tenant-store-1", name: "サンプル薬局", floorLabel: "8F", category: "薬局" },
    });
    expect(hits[0]!.moreTenants).toBeUndefined();
  });

  it("matches a tenant alias but keeps the brand name as printed", () => {
    expect(indexFor(createTenantFixtureBundle()).search("さんぷるやっきょく")[0]).toMatchObject({
      poi: { id: "store" },
      matched: "さんぷるやっきょく",
      tenant: { id: "tenant-store-1", name: "サンプル薬局" },
    });
  });

  it("picks tenant strings in the requested language, then ja, then the first", () => {
    const index = indexFor(createTenantFixtureBundle());
    expect(index.search("Sample Pharmacy", { lang: "en" })[0]!.tenant).toMatchObject({ name: "Sample Pharmacy" });
    // The fixture prints the floor only in ja, so an English reader still sees the printed label.
    expect(index.search("Sample Pharmacy", { lang: "en" })[0]!.tenant).toMatchObject({ floorLabel: "8F" });
    expect(index.search("Sample Pharmacy", { lang: "zh-Hant" })[0]!.tenant).toMatchObject({ name: "サンプル薬局" });
  });

  it("ranks a store's own name above a store that only lists the brand", () => {
    const bundle = createTenantFixtureBundle();
    bundle.pois.push(syntheticStorePoi("other-store", "別館ストア"));
    bundle.tenants!.push({ ...tenantIn(bundle, "tenant-store-1"), id: "tenant-other-1", poiId: "other-store" });
    const hits = indexFor(bundle).search("サンプル");
    expect(hits.map((h) => h.poi.id).slice(0, 2)).toEqual(["store", "other-store"]);
    // サンプル百貨店 matched directly; it is not reported as a tenant hit.
    expect(hits[0]!.tenant).toBeUndefined();
    expect(hits[0]!.matched).toBe("サンプル百貨店");
    expect(hits[1]!.tenant).toMatchObject({ id: "tenant-other-1" });
  });

  it("still finds a store through a mistyped brand, below a mistyped direct match", () => {
    const bundle = createTenantFixtureBundle();
    expect(indexFor(bundle).search("Sample Pharmcy")[0]).toMatchObject({ poi: { id: "store" }, tenant: { id: "tenant-store-1" } });
    bundle.pois.push(syntheticStorePoi("pharmacy", "Sample Pharmacy"));
    const hits = indexFor(bundle).search("Sample Pharmcy");
    expect(hits.map((h) => h.poi.id).slice(0, 2)).toEqual(["pharmacy", "store"]);
  });

  it("keeps one hit per store and counts the other brands that matched", () => {
    const bundle = createTenantFixtureBundle();
    bundle.tenants![1]!.names = [{ lang: "ja", text: "デモカフェ" }];
    bundle.tenants![2]!.names = [{ lang: "ja", text: "デモ書店" }];
    const hits = indexFor(bundle).search("デモ");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ poi: { id: "store" }, moreTenants: 1, tenant: { name: "デモ書店" } });
  });

  it("never floods the list with a store's 881 brands", () => {
    const bundle = createTenantFixtureBundle();
    bundle.tenants = Array.from({ length: 881 }, (_, i) => ({
      ...tenantIn(bundle, "tenant-store-1"),
      id: `tenant-store-${i + 1}`,
      names: [{ lang: "ja", text: `共通ブランド${i + 1}` }],
      aliases: [],
    }));
    // Same name on every brand: every tenant matches exactly, yet the store appears once.
    bundle.tenants = bundle.tenants.map((t) => ({ ...t, names: [{ lang: "ja", text: "共通ブランド" }] }));
    const hits = indexFor(bundle).search("共通ブランド");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ poi: { id: "store" }, moreTenants: 880, tenant: { name: "共通ブランド" } });
  });

  it("leaves bundles without tenants byte-identical", () => {
    const plain = createSyntheticBundle();
    const emptyDirectory = { ...createSyntheticBundle(), tenants: [] as Tenant[] };
    const a = createSearchIndex(plain);
    const b = createSearchIndex(emptyDirectory);
    for (const query of ["トイレ", "a1", "shop", "station", "west", "車站商店", "xxxx"]) {
      expect(b.search(query)).toEqual(a.search(query));
    }
    expect(a.search("トイレ")[0]).not.toHaveProperty("tenant");
  });

  it("still finds a store's own name as a direct hit when it also lists tenants", () => {
    const hits = indexFor(createTenantFixtureBundle()).search("さんぷるひゃっかてん");
    expect(hits[0]).toMatchObject({ poi: { id: "store" }, routable: true, matched: "さんぷるひゃっかてん" });
    expect(hits[0]).not.toHaveProperty("tenant");
  });
});
