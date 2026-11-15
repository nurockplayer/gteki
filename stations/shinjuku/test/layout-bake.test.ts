import { deepStrictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import source from "../data/layout-bake-key.json" with { type: "json" };
import { clearLayoutCache, prepareLayout } from "../scene/build-cache.ts";
import { layoutInputKey, fetchLayoutBake, type LayoutBake } from "../scene/layout-bake.ts";
import type { Plan } from "../scene/layout.ts";
import { encodeLayoutSnapshot } from "../scene/layout-codec.ts";
import { LAYOUT_BAKED_PATH, layoutBakedText, layoutSourceKey } from "../tools/bake-layout.ts";

const { bundle } = loadShinjukuBundle();
const plan = planJson as unknown as Plan;
const compressed = readFileSync(LAYOUT_BAKED_PATH);
const text = gunzipSync(compressed).toString("utf8");
afterEach(() => { clearLayoutCache(); vi.unstubAllGlobals(); });

describe("prepared layout bake (#1317, J2)", () => {
  it("cold-hits exactly the fresh snapshot, including property order, aliases, -0, undefined and the Map", () => {
    const fresh = prepareLayout(bundle, plan);
    const hit = prepareLayout(bundle, plan, { reuse: true, layoutBakeText: text });
    expect(hit.cached).toBe(true);
    deepStrictEqual(hit.layout, fresh.layout);
    deepStrictEqual(hit.protection, fresh.protection);
    // Canonical graph encoding also compares every shared-reference pair and property position,
    // which ordinary deep equality alone does not prove.
    const encoded = encodeLayoutSnapshot({ layout: hit.layout, protection: hit.protection });
    expect(encoded).toBe(encodeLayoutSnapshot({ layout: fresh.layout, protection: fresh.protection }));
    const tables = JSON.parse(encoded);
    expect(tables.references).toHaveLength(3231);
    expect(tables.negativeZeros).toHaveLength(5);
    expect(tables.undefineds).toHaveLength(447);
    expect(tables.maps).toHaveLength(1);
    expect([...hit.layout.nodeZ]).toEqual([...fresh.layout.nodeZ]);
    expect(hit.layout.nodeZ.size).toBe(233);
  }, 60_000);

  it("seeds reuse with a pristine snapshot and gives every build its own copy", () => {
    const first = prepareLayout(bundle, plan, { reuse: true, layoutBakeText: text });
    expect(first.cached).toBe(true);
    const before = encodeLayoutSnapshot(first.layout);
    first.layout.levels[0]!.walls.length = 0;
    first.layout.nodeZ.clear();
    const next = prepareLayout(bundle, plan, { reuse: true });
    expect(next.cached).toBe(true);
    expect(next.layout).not.toBe(first.layout);
    expect(encodeLayoutSnapshot(next.layout)).toBe(before);
  });

  it("rejects stale input/source keys and unverified bakes, deriving and caching fresh instead", () => {
    const fresh = prepareLayout(bundle, plan);
    const saved = JSON.parse(text) as LayoutBake;
    for (const changed of [{ ...saved, inputKey: "stale" }, { ...saved, sourceKey: "stale" }, { ...saved, verified: false }]) {
      clearLayoutCache();
      const result = prepareLayout(bundle, plan, { reuse: true, layoutBakeText: JSON.stringify(changed) });
      expect(result.cached).toBe(false);
      deepStrictEqual(result.layout, fresh.layout);
      expect(prepareLayout(bundle, plan, { reuse: true }).cached).toBe(true);
    }
    expect(layoutInputKey(bundle, plan, false)).not.toBe(saved.inputKey);
    expect(layoutInputKey({ ...bundle, nodes: bundle.nodes.slice(1) }, plan)).not.toBe(saved.inputKey);
    expect(layoutInputKey(bundle, { ...plan, nodeRenderZ: {} })).not.toBe(saved.inputKey);
    clearLayoutCache();
    expect(prepareLayout(bundle, plan, { reuse: true, verifyGeneratedInput: false,
      layoutBakeText: JSON.stringify({ ...saved, verified: false }) }).cached).toBe(true);
    expect(prepareLayout(bundle, plan, { reuse: true }).cached).toBe(false);
  }, 60_000);

  it("commits exactly the current verified bake and source key within the transfer budget", () => {
    expect(source.sourceKey).toBe(layoutSourceKey());
    expect(compressed.equals(gzipSync(layoutBakedText(), { level: 9 }))).toBe(true);
    expect(compressed.byteLength).toBeLessThanOrEqual(2_100_000);
    expect(3_571_974 + compressed.byteLength).toBeLessThanOrEqual(6_000_000);
  }, 60_000);

  it("fetches precompressed bytes as text, drops failures to derivation, and handles HTTP gzip decoding", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(compressed));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchLayoutBake()).toBe(text);
    fetch.mockResolvedValueOnce(new Response(text, { headers: { "Content-Encoding": "gzip" } }));
    expect(await fetchLayoutBake()).toBe(text);
    fetch.mockRejectedValueOnce(new Error("offline"));
    const failed = await fetchLayoutBake();
    expect(failed).toBeNull();
    expect(prepareLayout(bundle, plan, { reuse: true, layoutBakeText: failed }).cached).toBe(false);
  }, 60_000);
});
