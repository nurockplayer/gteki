import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Asset, Coverage, Edge, Node, Poi, Source } from "@gteki/schema";
import { composeCreditLine, creditEntries, creditLineFor, drawnSources, entryRightsLabels, groupByAttribution, groupLicenses } from "./creditLine.ts";
import { strings } from "./i18n.ts";

const PLATEAU = "出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成";
const src = (id: string, attribution: string, extra: Partial<Source> = {}): Source => ({
  id, title: `title ${id}`, publisher: "MLIT", url: "https://example.org/", license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  rights: "REUSABLE_WITH_CONDITIONS", attribution, modified: true, retrievedAt: null, datasetDate: null, ...extra,
} as Source);
const asset = (id: string, role: Asset["role"], sourceIds: string[]): Asset => ({ id, uri: `${id}.glb`, format: "glb", floorIds: ["f"], role, sourceIds });

describe("drawnSources", () => {
  const sources = [src("a", PLATEAU), src("b", PLATEAU), src("c", "other"), src("f", "facts", { usage: "facts-only" })];

  it("keeps only the sources cited by visual assets", () => {
    const assets = [asset("v", "visual", ["a"]), asset("vc", "visual+collision", ["b"]), asset("col", "collision", ["c"])];
    expect(drawnSources({ sources, assets }).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("never counts facts-only sources, even when an asset cites them", () => {
    expect(drawnSources({ sources, assets: [asset("v", "visual", ["a", "f"])] }).map((s) => s.id)).toEqual(["a"]);
  });

  it("falls back to every non-facts-only source for a graph-only station", () => {
    expect(drawnSources({ sources }).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(drawnSources({ sources, assets: [asset("col", "collision", ["c"])] }).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});

describe("drawnSources with a drawn graph", () => {
  const sources = [src("a", PLATEAU), src("g", "graph source"), src("e", "evidence only"), src("f", "facts", { usage: "facts-only" })];
  const visual = [asset("v", "visual", ["a"])];
  const node = (sourceId: string): Node => ({ id: "n", floorId: "f", position: { x: 0, y: 0, z: 0 }, kind: "junction", inOut: null, sourceRefs: [{ sourceId, featureId: "1" }] });
  const edge = (geometry: boolean, ids: string[]): Edge => ({
    id: "e", from: "n", to: "m", direction: "both", mode: "walk", lengthM: 1, ...(geometry ? { geometry: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] } : {}),
    paid: null, crossesFareBoundary: null, wheelchair: null, steps: null, hours: null, closed: false, verification: "geometry_only",
    geometryEvidence: { sourceIds: ids, method: "m", checkedDate: "2026-01-01" }, accessEvidence: null,
  } as Edge);
  const ids = (b: Parameters<typeof drawnSources>[0]) => drawnSources(b).map((s) => s.id);

  it("credits both the asset's and the drawn graph's sources", () => {
    expect(ids({ sources, assets: visual, nodes: [node("g")] })).toEqual(["a", "g"]);
    expect(ids({ sources, assets: visual, edges: [edge(true, ["g"])] })).toEqual(["a", "g"]);
    const area = { id: "c", floorId: null, status: "routable", label: [], polygon: [{ x: 0, y: 0 }], sourceIds: ["g"] } as Coverage["areas"][number];
    expect(ids({ sources, assets: visual, coverage: { areas: [area] } })).toEqual(["a", "g"]);
    const poi = { id: "p", displayPosition: { x: 0, y: 0, z: 0 }, evidence: { sourceIds: ["g"], method: "m", checkedDate: "2026-01-01" } } as Poi;
    expect(ids({ sources, assets: visual, pois: [poi] })).toEqual(["a", "g"]);
  });

  it("does not count evidence-only references", () => {
    const area = { id: "c", floorId: null, status: "routable", label: [], sourceIds: ["e"] } as Coverage["areas"][number];
    const poi = { id: "p", displayPosition: null, evidence: { sourceIds: ["e"], method: "m", checkedDate: "2026-01-01" } } as Poi;
    expect(ids({ sources, assets: visual, edges: [edge(false, ["e"])], coverage: { areas: [area] }, pois: [poi] })).toEqual(["a"]);
  });

  it("still excludes facts-only sources and keeps bundle order", () => {
    expect(ids({ sources, assets: visual, nodes: [node("f"), node("g")] })).toEqual(["a", "g"]);
    expect(ids({ sources: [sources[1]!, sources[0]!], assets: visual, nodes: [node("g")] })).toEqual(["g", "a"]);
  });

  it("leaves a graph-only station unchanged", () => {
    expect(ids({ sources, nodes: [node("g")] })).toEqual(["a", "g", "e"]);
  });
});

describe("credit line", () => {
  it("shows an attribution shared by several sources once", () => {
    const five = ["1", "2", "3", "4", "5"].map((i) => src(`p${i}`, PLATEAU));
    expect(composeCreditLine(five)).toBe(PLATEAU);
  });

  it("joins distinct attributions in order and ignores whitespace differences and blanks", () => {
    const line = composeCreditLine([src("a", "A"), src("b", " B  x "), src("c", "A"), src("d", "B x"), src("e", "  ")]);
    expect(line).toBe("A / B x");
  });

  it("is empty when nothing is drawn", () => {
    expect(composeCreditLine([])).toBe("");
    expect(creditLineFor({ sources: [src("f", "facts", { usage: "facts-only" })] })).toBe("");
  });

  it("composes from a bundle's drawn sources", () => {
    expect(creditLineFor({ sources: [src("a", PLATEAU), src("b", "unused")], assets: [asset("v", "visual", ["a"])] })).toBe(PLATEAU);
  });
});

describe("groupByAttribution", () => {
  it("groups identical attribution text and keeps ids in order", () => {
    const groups = groupByAttribution([src("a", PLATEAU), src("x", "X"), src("b", PLATEAU), src("c", PLATEAU)]);
    expect(groups.map((g) => [g.attribution, g.sources.map((s) => s.id)])).toEqual([[PLATEAU, ["a", "b", "c"]], ["X", ["x"]]]);
  });

  it("lists a group's licences once", () => {
    const g = groupByAttribution([src("a", PLATEAU), src("b", PLATEAU), src("c", PLATEAU, { license: { name: "PDL 1.0", url: "" } })])[0]!;
    expect(groupLicenses(g.sources)).toEqual([
      { name: "CC BY 4.0", href: "https://creativecommons.org/licenses/by/4.0/" },
      { name: "PDL 1.0", href: null },
    ]);
  });

  it("dedupes legacy and localized names by safe URL and rights in both languages", () => {
    const legacy = src("legacy", PLATEAU, { license: { name: "Legacy licence", url: "https://example.org/licence" } });
    const localized = src("localized", PLATEAU, {
      license: {
        name: [{ lang: "ja", text: "日本語ライセンス" }, { lang: "en", text: "Localized licence" }],
        url: "https://example.org/licence",
      },
    });

    expect(groupLicenses([legacy, localized], "ja")).toEqual([{ name: "Legacy licence", href: "https://example.org/licence" }]);
    expect(groupLicenses([legacy, localized], "en")).toEqual([{ name: "Legacy licence", href: "https://example.org/licence" }]);
  });

  it("keeps the same URL separate when sources have different rights", () => {
    const reusable = src("reusable", PLATEAU);
    const reference = src("reference", PLATEAU, { rights: "REFERENCE_ONLY" });

    expect(groupLicenses([reusable, reference])).toEqual([
      { name: "CC BY 4.0", href: "https://creativecommons.org/licenses/by/4.0/" },
      { name: "CC BY 4.0", href: "https://creativecommons.org/licenses/by/4.0/" },
    ]);
  });

  it("keeps genuinely different licences in first appearance order", () => {
    const first = src("first", PLATEAU, { license: { name: "First", url: "https://example.org/first" } });
    const second = src("second", PLATEAU, { license: { name: "Second", url: "https://example.org/second" } });

    expect(groupLicenses([first, second])).toEqual([
      { name: "First", href: "https://example.org/first" },
      { name: "Second", href: "https://example.org/second" },
    ]);
  });

  it("dedupes unlinked licences by resolved name and rights", () => {
    const sameName = src("same", PLATEAU, { license: { name: "Unlinked licence", url: "" } });
    const sameNameAgain = src("same-again", PLATEAU, { license: { name: "Unlinked licence", url: "javascript:alert(1)" } });

    expect(groupLicenses([sameName, sameNameAgain])).toEqual([{ name: "Unlinked licence", href: null }]);
  });
});

describe("creditEntries (the credits dialog)", () => {
  const facts = (id: string, attribution: string) => src(id, attribution, { usage: "facts-only", rights: "REFERENCE_ONLY", license: null });

  it("never merges a facts-only source, even when it shares an attribution with a data source", () => {
    const sources = [src("a", PLATEAU), facts("f", PLATEAU), src("b", PLATEAU)];
    expect(groupByAttribution(sources).map((g) => g.sources.map((s) => s.id))).toEqual([["a", "b"]]);
    expect(creditEntries(sources).map((g) => g.sources.map((s) => s.id))).toEqual([["a", "b"], ["f"]]);
  });

  it("keeps a source with a blank attribution as its own entry instead of dropping it", () => {
    const sources = [src("a", "A"), src("blank", "  "), src("empty", ""), src("b", "A")];
    expect(creditEntries(sources).map((g) => g.sources.map((s) => s.id))).toEqual([["a", "b"], ["blank"], ["empty"]]);
    // The persistent line still skips them: there is no text to show.
    expect(composeCreditLine(sources)).toBe("A");
  });

  it("lists every source exactly once, in bundle order", () => {
    const sources = [src("a", "A"), facts("f", "F"), src("blank", ""), src("b", "A"), src("c", "C")];
    const ids = creditEntries(sources).flatMap((g) => g.sources.map((s) => s.id));
    expect(ids.sort()).toEqual(["a", "b", "blank", "c", "f"]);
    expect(creditEntries(sources).map((g) => g.sources[0]!.id)).toEqual(["a", "f", "blank", "c"]);
  });
});

describe("entryRightsLabels", () => {
  it("words rights in plain language, once each, and leaves facts-only to its own line", () => {
    const t = strings("en");
    const a = src("a", "A");
    const o = src("o", "A", { rights: "PUBLISHED_UNDER_OWNER_OVERRIDE" });
    const f = src("f", "A", { rights: "REFERENCE_ONLY", usage: "facts-only" });
    expect(entryRightsLabels([a, src("a2", "A"), o], t)).toEqual([t.rightsReusable, t.rightsOwnerOverride]);
    expect(entryRightsLabels([f], t)).toEqual([]);
    for (const label of entryRightsLabels([a, o, f], t)) expect(label).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
  });
});

// The real Ikebukuro manifest must credit the context even though it supplies no graph geometry.
describe("Ikebukuro N02 context credit", () => {
  it("appears in the persistent bottom strip and the Credits/coverage source list", () => {
    const station = JSON.parse(readFileSync(new URL("../../../stations/ikebukuro/gteki/station.json", import.meta.url), "utf8"));
    const attribution = "出典：国土交通省国土数値情報ダウンロードサイト（https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html）を加工して作成";
    expect(drawnSources(station).map((s) => s.id)).toContain("ksj-n02-2025");
    expect(creditLineFor(station)).toContain(attribution);
    const entry = creditEntries(station.sources).find((g) => g.sources.some((s) => s.id === "ksj-n02-2025"))!;
    expect(entry.attribution).toBe(attribution);
    expect(groupLicenses(entry.sources)).toEqual([{ name: "CC BY 4.0", href: "https://creativecommons.org/licenses/by/4.0/" }]);
  });
});
