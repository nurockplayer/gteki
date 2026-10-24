import { describe, expect, it } from "vitest";
import type { Poi } from "@gteki/schema";
import type { RouteFailure } from "@gteki/navigation";
import { strings } from "../i18n.ts";
import { isUnlocatedShop, noRouteText, poiNoteText } from "./noRouteText.ts";

const poi = (category: Poi["category"]): Poi => ({
  id: "shop-test",
  category,
  names: [],
  aliases: [],
  floorId: null,
  displayPosition: null,
  connectorNodeIds: [],
  paid: null,
  evidence: { sourceIds: [], method: "test", checkedDate: "2026-10-24" },
  notes: [],
});

const failure = (reason: RouteFailure["reason"]): RouteFailure => ({ ok: false, reason, message: "fallback" });

describe("noRouteText", () => {
  it("uses the shop wording for unknown_goal in both languages", () => {
    expect(noRouteText(strings("ja"), failure("unknown_goal"), poi("shop"))).toBe("この店舗への道案内はまだありません（位置未確認）");
    expect(noRouteText(strings("en"), failure("unknown_goal"), poi("shop"))).toBe("No directions to this shop yet (location not verified).");
  });

  it("keeps the existing unknown_goal wording for non-shop POIs", () => {
    expect(noRouteText(strings("en"), failure("unknown_goal"), poi("exit"))).toBe(strings("en").noRouteWhy.unknown_goal);
  });

  it("does not use shop wording for another failure reason", () => {
    expect(noRouteText(strings("en"), failure("unknown_start"), poi("shop"))).toBe(strings("en").noRouteWhy.unknown_start);
  });

  it("does not say the location is unverified for a shop that has a position but no verified entrance", () => {
    const placed = { ...poi("shop"), displayPosition: { x: 0, y: 0, z: null } } as Poi;
    expect(isUnlocatedShop(placed)).toBe(false);
    expect(noRouteText(strings("en"), failure("unknown_goal"), placed)).toBe(strings("en").noRouteWhy.unknown_goal);
    expect(isUnlocatedShop(poi("shop"))).toBe(true);
  });
});

describe("poiNoteText", () => {
  const withNotes = (notes: Poi["notes"]): Poi => ({ ...poi("exit"), notes });

  it("returns the note in the requested language when there is one", () => {
    const p = withNotes([
      { lang: "ja", text: "2020年3月時点の情報です" },
      { lang: "en", text: "As of March 2020" },
    ]);
    expect(poiNoteText(p, "en")).toBe("As of March 2020");
    expect(poiNoteText(p, "ja")).toBe("2020年3月時点の情報です");
  });

  it("falls back to the ja note when the requested language has none", () => {
    expect(poiNoteText(withNotes([{ lang: "ja", text: "  現在の状況は不明  " }]), "en")).toBe("現在の状況は不明");
  });

  it("treats a blank note as no note", () => {
    expect(poiNoteText(withNotes([{ lang: "ja", text: "   " }]), "ja")).toBeNull();
    expect(poiNoteText(withNotes([{ lang: "en", text: "" }, { lang: "ja", text: " " }]), "en")).toBeNull();
  });

  it("returns null when the POI has no notes", () => {
    expect(poiNoteText(withNotes([]), "ja")).toBeNull();
    expect(poiNoteText({ ...poi("exit"), notes: undefined } as Poi, "en")).toBeNull();
  });

  it("returns null for an undefined, null or missing POI", () => {
    expect(poiNoteText(undefined, "ja")).toBeNull();
    expect(poiNoteText(null, "en")).toBeNull();
  });
});
