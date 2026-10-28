import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeJa } from "../../search/src/index.ts";
import { createSyntheticBundle } from "../../navigation/src/fixtures.ts";
import { buildSearchExport } from "./export-search.ts";
import { loadBundle } from "./load-bundle.ts";
import { runSearch } from "./search-query.ts";
import goldens from "./search-goldens.json" with { type: "json" };

const exportScript = fileURLToPath(new URL("./export-search.ts", import.meta.url));
const queryScript = fileURLToPath(new URL("./search-query.ts", import.meta.url));
const stationDir = (id: string) => fileURLToPath(new URL(`../../../stations/${id}`, import.meta.url));
const STATIONS = ["ikebukuro", "shinjuku"] as const;

describe("search normalisation goldens (for the Godot port)", () => {
  it.each(goldens.normalize.map((g) => [g.input, g.normalized] as const))("normalizeJa(%j) === %j", (input, normalized) => {
    expect(normalizeJa(input)).toBe(normalized);
  });

  it("covers the folds Godot must reproduce", () => {
    const byInput = new Map(goldens.normalize.map((g) => [g.input, g.normalized]));
    expect(byInput.get("Ｅｘｉｔ　３５")).toBe("exit35"); // NFKC full-width + case fold + space removal
    expect(byInput.get("ﾃﾞｸﾞﾁ")).toBe("でぐち"); // half-width katakana + dakuten compose, then katakana -> hiragana
    expect(byInput.get("コーヒー")).toBe("こひ"); // long-vowel mark dropped
    expect(byInput.get("中央通路（西）")).toBe("中央通路西"); // punctuation dropped
  });
});

describe.each(STATIONS)("%s search export", (id) => {
  it("is a non-empty index whose entries all exist in the bundle and never overstate status", async () => {
    const bundle = await loadBundle(stationDir(id));
    const out = buildSearchExport(bundle);
    expect(out.contract).toBe("gteki.search/0.1");
    expect(out.stationId).toBe(id);
    expect(out.entries.length).toBeGreaterThan(0);
    expect(out.entries).toHaveLength(bundle.pois.length);

    const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
    const pois = new Map(bundle.pois.map((p) => [p.id, p]));
    const floorIds = new Set(bundle.floors.map((f) => f.id));
    expect(new Set(out.entries.map((e) => e.poiId)).size).toBe(out.entries.length);
    for (const e of out.entries) {
      const poi = pois.get(e.poiId)!;
      expect(poi, e.poiId).toBeDefined();
      expect(e.nodeIds).toEqual(poi.connectorNodeIds);
      for (const nodeId of e.nodeIds) expect(nodes.has(nodeId), `${e.poiId} -> ${nodeId}`).toBe(true);
      // routable means "the data lists a connector node": never inferred, never true for a search-only POI.
      expect(e.routable, e.poiId).toBe(poi.connectorNodeIds.length > 0);
      // unknown stays unknown
      expect(e.paid, e.poiId).toBe(poi.paid);
      if (e.floorId !== null) expect(floorIds.has(e.floorId), e.poiId).toBe(true);
      // No verification claim of any kind is exported; evidence is passed through as the data states it.
      expect(Object.keys(e).filter((k) => /verif|confirm|trusted/i.test(k)), e.poiId).toEqual([]);
      expect(e.evidence).toMatchObject({ method: poi.evidence.method, checkedDate: poi.evidence.checkedDate });
      expect(e.keys.length, e.poiId).toBeGreaterThan(0);
      for (const key of e.keys) expect(key.norm, `${e.poiId} ${key.text}`).toBe(normalizeJa(key.text));
      // a height is "known" only when the data has one
      if (e.position?.source === "connector_node") {
        expect(e.position.zKnown, e.poiId).toBe(nodes.get(e.position.nodeId!)!.position.z !== null);
        expect(e.position.nodeId).toBe(e.nodeIds.find((n) => nodes.has(n)));
      }
      if (e.position?.source === "display_position") expect(e.position.zKnown, e.poiId).toBe(poi.displayPosition!.z !== null);
      if (!e.routable && !poi.displayPosition) expect(e.position, e.poiId).toBeNull();
    }
    expect(out.entries.some((e) => e.names.ja !== null)).toBe(true);
    expect(out.entries.some((e) => e.names.en !== null)).toBe(true);
  });

  it("matches the queries recorded from the TS search index", async () => {
    const bundle = await loadBundle(stationDir(id));
    const cases = goldens.queries[id];
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const result = runSearch(bundle, c.query, 3);
      expect(result.normalized, c.query).toBe(c.normalized);
      expect(result.hits.map((h) => ({ poiId: h.poiId, score: h.score })), c.query).toEqual(c.top);
    }
  });
});

describe("search export description labels", () => {
  it("uses descriptions before generic aliases when no localized name exists", async () => {
    const bundle = await loadBundle(stationDir("shinjuku"));
    const exits = buildSearchExport(bundle).entries.filter((e) => /^poi:exit:[1-4]$/.test(e.poiId));
    expect(exits).toHaveLength(4);
    for (const entry of exits) {
      const poi = bundle.pois.find((p) => p.id === entry.poiId)!;
      expect(entry.names.en).toBe(poi.descriptions!.find((d) => d.lang === "en")!.text);
    }
    expect(new Set(exits.map((e) => e.names.en)).size).toBe(4);
  });
});

describe("approximate positions in the search export (#463)", () => {
  it("exports the ± radius and markers, never a position", () => {
    const b = createSyntheticBundle();
    const poi = b.pois.find((p) => p.id === "shop")!;
    Object.assign(poi, {
      connectorNodeIds: [], displayPosition: null,
      approximatePosition: { east: 10, north: -5, uncertaintyM: 25, method: "area_weighted_centroid", navigationUse: "NOT_FOR_ROUTING", floor: "UNVERIFIED" },
    });
    const out = buildSearchExport(b);
    const entry = out.entries.find((e) => e.poiId === "shop")!;
    // The approximate point never becomes a renderer position: no coordinates leave the schema.
    expect(entry.position).toBeNull();
    expect(entry.routable).toBe(false);
    expect(entry.approximate).toEqual({ uncertaintyM: 25, navigationUse: "NOT_FOR_ROUTING", floor: "UNVERIFIED" });
    expect(Object.keys(entry.approximate!)).toEqual(["uncertaintyM", "navigationUse", "floor"]);
    // Every other POI states the absence explicitly.
    expect(out.entries.filter((e) => e.poiId !== "shop").every((e) => e.approximate === null)).toBe(true);
  });
});

describe("data-bridge CLIs", { timeout: 30_000 }, () => {
  const invoke = (script: string, args: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", script, ...args], { encoding: "utf8" });

  it("export-search.ts writes the same JSON the library builds", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "gteki-search-"));
    try {
      const file = resolve(root, "search.json");
      const run = invoke(exportScript, [stationDir("shinjuku"), file]);
      expect(run.status, run.stderr).toBe(0);
      const written = JSON.parse(await readFile(file, "utf8")) as unknown;
      expect(written).toEqual(JSON.parse(JSON.stringify(buildSearchExport(await loadBundle(stationDir("shinjuku"))))));
      expect(invoke(exportScript, [stationDir("shinjuku")]).status).not.toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("search-query.ts answers like the index and returns no hits (exit 0) for nonsense", () => {
    const hit = invoke(queryScript, [stationDir("ikebukuro"), "35番出口", "--limit", "1"]);
    expect(hit.status, hit.stderr).toBe(0);
    expect(JSON.parse(hit.stdout)).toMatchObject({ contract: "gteki.search.result/0.1", normalized: "35番出口", hits: [{ poiId: "exit-35", nodeIds: ["x35"] }] });
    const none = invoke(queryScript, [stationDir("ikebukuro"), "zzzzqx"]);
    expect(none.status).toBe(0);
    expect(JSON.parse(none.stdout).hits).toEqual([]);
    expect(invoke(queryScript, [stationDir("ikebukuro")]).status).toBe(2);
  });
});
