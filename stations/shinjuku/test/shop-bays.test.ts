import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createSearchIndex } from "@gteki/search";
import { loadShopKit, type Opening, type Shop } from "../../ikebukuro/scene/kit_shops.ts";
import type { KitManifest } from "../../ikebukuro/scene/kit.ts";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { assembleScene } from "../gteki/scene.ts";
import { shopBays } from "../tools/shop-bays.ts";
import bays from "../scene/shop_bays.json" with { type: "json" };
import placements from "../scene/shop_placements.json" with { type: "json" };
import manifest from "../scene/shop_kit.json" with { type: "json" };
import { withCanvasStub } from "./helpers/scene-digest.ts";
import { digestSceneLists } from "./helpers/station-digest.ts";

describe("illustrative shopfronts", () => {
  it("regenerates the bay data", () => expect(shopBays()).toEqual(bays), 120_000);
  it("places placeholders only on bays and excludes them from POIs", () => {
    const ids = new Set(bays.openings.map((b) => b.polygon_ids[0]));
    const { bundle } = loadShinjukuBundle();
    const search = createSearchIndex(bundle);
    for (const shop of placements.shops) {
      expect(shop.kind).toBe("placeholder");
      expect(shop).not.toHaveProperty("poiId");
      expect(shop).not.toHaveProperty("sourceIds");
      expect(shop.openings.every((id) => ids.has(id))).toBe(true);
      expect(bundle.pois.flatMap((p) => p.names.map((n) => n.text))).not.toContain(shop.sign.ja);
      expect(bundle.pois.flatMap((p) => p.names.map((n) => n.text))).not.toContain(shop.sign.en);
      for (const name of [shop.sign.ja, shop.sign.en]) expect(search.search(name).some((hit) => hit.poi.id === shop.id)).toBe(false);
    }
  });
  it("adds only a visual group and leaves collision and graph unchanged", async () => {
    const { bundle } = loadShinjukuBundle(), graph = JSON.stringify([bundle.nodes, bundle.edges]);
    const ctx = { THREE, bundle, quality: "low", enuToRenderer: ({ x, y, z }: { x: number; y: number; z: number }) => [x, z, -y] } as never;
    const base = withCanvasStub(() => assembleScene(ctx));
    const scene = new THREE.Group(); scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    const kit = await loadShopKit(THREE, { assetUrl: () => "asset", loadGlb: async () => ({ scene }) as never }, manifest as KitManifest, placements.shops as Shop[], bays.openings as Opening[], true);
    expect(kit.placements.length).toBeGreaterThan(0);
    const canvas = new Proxy({}, { get: (_target, key) => key === "measureText" ? () => ({ width: 50 }) : key === "createLinearGradient" || key === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => undefined });
    vi.stubGlobal("document", { createElement: () => ({ width: 1, height: 1, getContext: () => canvas }) });
    const withShops = assembleScene(ctx, undefined, kit);
    expect(withShops.root.getObjectByName("ikebukuro_kit_shops")).toBeDefined();
    expect(digestSceneLists(withShops)).toEqual(digestSceneLists(base));
    expect(JSON.stringify([bundle.nodes, bundle.edges])).toBe(graph);
    withShops.dispose(); base.dispose();
    vi.unstubAllGlobals();
  }, 120_000);
});
