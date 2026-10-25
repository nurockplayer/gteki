import { describe, expect, it } from "vitest";
import type { Poi } from "@gteki/schema";
import { loadShinjukuBundle } from "../../data/bundle.ts";
import { searchOnlyText, searchRowSub } from "./search-card.ts";

const { bundle } = loadShinjukuBundle();
const byId = (id: string) => bundle.pois.find((p) => p.id === id)!;
/** Search-only POIs: the S03 line names (#411) and the merchant listings (#214). */
const searchOnly = bundle.pois.filter((p) => p.connectorNodeIds.length === 0);
const s03 = searchOnly.filter((p) => p.evidence.sourceIds.includes("tokyo-s03-zip"));
const shops = searchOnly.filter((p) => p.category === "shop");
const en = (p: Poi) => p.names.find((n) => n.lang === "en")?.text ?? "";
const jaNote = (p: Poi) => p.notes?.find((n) => n.lang === "ja")?.text.trim() ?? "";

describe("search row line (station app)", () => {
  it("keeps the English name and floor for a POI that prints both", () => {
    const exit = byId("poi:exit:1");
    expect(searchRowSub(exit, "地上1F")).toBe(`${en(exit)} · 地上1F`);
    expect(searchRowSub(exit, "")).toBe(en(exit));
  });

  it("shows the source's own note for every search-only POI, so no row is left blank", () => {
    for (const p of searchOnly) {
      expect(searchRowSub(p, ""), p.id).toBe(jaNote(p));
      expect(searchRowSub(p, ""), p.id).not.toBe("");
    }
    // The caveat the data carries is what the traveller now reads.
    for (const p of s03) expect(searchRowSub(p, ""), p.id).toContain("2020年3月");
    for (const p of shops) expect(searchRowSub(p, ""), p.id).toContain("未確認");
  });
});

describe("search-only route error (station app)", () => {
  it("does not claim a position for the name-only POIs and names the role", () => {
    const nameOnly = searchOnly.filter((p) => p.approximatePosition === undefined);
    expect(nameOnly.length).toBeGreaterThan(0);
    for (const p of nameOnly) {
      for (const role of ["origin", "destination"] as const) {
        const text = searchOnlyText(p, role);
        expect(text, `${p.id} ${role}`).not.toContain("位置情報のみ");
        expect(text, `${p.id} ${role}`).not.toContain("おおよその位置");
        expect(text, `${p.id} ${role}`).toContain("名前だけ");
      }
    }
    expect(searchOnlyText(nameOnly[0]!, "origin")).toContain("出発地");
    expect(searchOnlyText(nameOnly[0]!, "destination")).toContain("目的地");
  });

  it("says an approximate position is search display only, with its radius, where one exists", () => {
    const pointed = searchOnly.filter((p) => p.approximatePosition !== undefined);
    expect(pointed.length).toBeGreaterThan(0);
    for (const p of pointed) {
      const text = searchOnlyText(p, "destination");
      expect(text, p.id).toContain(`±${Math.ceil(p.approximatePosition!.uncertaintyM)} m`);
      expect(text, p.id).toContain("検索表示のみ");
      expect(text, p.id).not.toContain("位置情報のみ");
    }
  });

  it("always says there is no verified entrance, in both languages", () => {
    for (const p of searchOnly) {
      const text = searchOnlyText(p, "destination");
      expect(text, p.id).toMatch(/検証済みの入口(が|も)ありません/);
      expect(text, p.id).toContain("no verified entrance");
    }
  });
});
