import { describe, expect, it } from "vitest";
import { parseStationFiles, type Poi, type PoiCategory } from "@gteki/schema";
import { emptySuggestions, exampleQueries, pushRecent, readRecent, writeRecent } from "./emptySuggestions.ts";
import ikebukuroStation from "../../../../stations/ikebukuro/gteki/station.json" with { type: "json" };
import ikebukuroGraph from "../../../../stations/ikebukuro/gteki/graph.json" with { type: "json" };
import ikebukuroPois from "../../../../stations/ikebukuro/gteki/pois.json" with { type: "json" };

function poi(id: string, category: PoiCategory, routable = true, ja = id, en = id): Poi {
  return {
    id, category, names: [{ lang: "ja", text: ja }, { lang: "en", text: en }], aliases: [], floorId: null,
    displayPosition: null, connectorNodeIds: routable ? ["node:" + id] : [], paid: null,
    evidence: { sourceIds: [], method: "synthetic-fixture", checkedDate: "2026-10-27" },
  } as Poi;
}

const fixture: Poi[] = [
  ...Array.from({ length: 8 }, (_, i) => poi("search-exit-" + i, "exit", false)),
  poi("shop", "shop"), poi("gate", "ticket_gate"), poi("platform", "platform"), poi("transfer", "transfer"),
  poi("toilet", "toilet"), poi("other", "other"), poi("exit", "exit"),
];

describe("empty suggestions", () => {
  it("prioritizes start and destination categories, excludes search-only POIs, and caps the total", () => {
    const from = emptySuggestions(fixture, "from", { filter: null, recentIds: [] });
    const to = emptySuggestions(fixture, "to", { filter: null, recentIds: [] });
    expect(from[0]?.pois[0]?.category).toBe("ticket_gate");
    expect(to[0]?.pois[0]?.category).toBe("shop");
    for (const groups of [from, to]) {
      const all = groups.flatMap((group) => group.pois);
      expect(all.length).toBeLessThanOrEqual(12);
      expect(all.some((item) => !item.connectorNodeIds.length)).toBe(false);
    }
  });

  it("applies the category filter to recent and popular groups", () => {
    const groups = emptySuggestions(fixture, "to", { filter: "ticket_gate", recentIds: ["shop", "gate"] });
    expect(groups.flatMap((group) => group.pois).map((item) => item.id)).toEqual(["gate"]);
    expect(groups.map((group) => group.key)).toEqual(["recent"]);
  });

  it("puts valid recents first, deduplicates them from popular results, and skips unknown ids", () => {
    const groups = emptySuggestions(fixture, "to", { filter: null, recentIds: ["missing", "gate", "gate", "search-exit-0"] });
    expect(groups[0]).toMatchObject({ key: "recent", pois: [{ id: "gate" }] });
    expect(groups[1]?.key).toBe("popular");
    expect(groups.flatMap((group) => group.pois).filter((item) => item.id === "gate")).toHaveLength(1);
  });

  it("pushes a recent id to the front with deduplication and a cap", () => {
    expect(pushRecent(["a", "b", "a", "c", "d"], "b")).toEqual(["b", "a", "c", "d"]);
    expect(pushRecent(["a", "b"], "c", 2)).toEqual(["c", "a"]);
  });

  it("reads and writes safely when storage throws or JSON is invalid", () => {
    expect(readRecent({ getItem: () => "not json" }, "ikebukuro")).toEqual([]);
    expect(readRecent({ getItem: () => { throw new Error("blocked"); } }, "ikebukuro")).toEqual([]);
    expect(readRecent(null, "ikebukuro")).toEqual([]);
    expect(() => writeRecent({ setItem: () => { throw new Error("blocked"); } }, "ikebukuro", ["x"])).not.toThrow();
    expect(() => writeRecent(null, "ikebukuro", ["x"])).not.toThrow();
  });

  it("suggests names found in the real Ikebukuro bundle", () => {
    const parsed = parseStationFiles(ikebukuroStation, ikebukuroGraph, ikebukuroPois);
    if (!parsed.ok) throw new Error("Ikebukuro station files failed validation");
    expect(exampleQueries(parsed.bundle.pois, "ja", "トイレ")).toContain("ルミネ池袋");
  });
});
