import { describe, expect, it } from "vitest";
import type { Asset, Source } from "@gteki/schema";
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
