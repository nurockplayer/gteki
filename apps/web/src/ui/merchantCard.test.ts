// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Poi, Source } from "@gteki/schema";
import { strings } from "../i18n.ts";
import { merchantCardEl, merchantCardModel, merchantPrecision } from "./merchantCard.ts";

const source: Source = {
  id: "toei-shinjuku-stores-2026-10",
  title: "都営新宿駅 駅構内のお店",
  publisher: "東京都交通局",
  url: "https://www.kotsu.metro.tokyo.jp/other/kanren/stores/shinjuku.html",
  license: null,
  rights: "REUSABLE_WITH_CONDITIONS",
  usage: "facts-only",
  attribution: "東京都交通局「駅構内のお店」",
  modified: false,
  retrievedAt: "2026-10-24",
  datasetDate: "2026-10",
  validUntil: null,
} as Source;

const shop = (over: Partial<Poi> = {}): Poi => ({
  id: "shop-sjk-toei-001",
  category: "shop",
  names: [{ lang: "ja", text: "カレーショップC＆C" }],
  aliases: [],
  floorId: null,
  displayPosition: null,
  connectorNodeIds: [],
  paid: null,
  evidence: { sourceIds: [source.id], method: "facts-only directory listing (OD-34), UNVERIFIED, AREA_ONLY", checkedDate: "2026-10-24" },
  notes: [{ lang: "ja", text: "都営 新宿駅 B1階改札外コンコース。位置・入口は未確認（検索のみ。案内ルートなし）。" }],
  ...over,
});

describe("merchant precision (#213)", () => {
  it("reads the precision the listing's own evidence states", () => {
    expect(merchantPrecision(shop())).toBe("area");
    expect(merchantPrecision(shop({ evidence: { sourceIds: [source.id], method: "facts-only directory listing (#26), UNVERIFIED, SEARCH_ONLY", checkedDate: "2026-10-24" } }))).toBe("search");
    // A routable display position is a verified point, unless the evidence is SEARCH_ONLY (see below).
    expect(merchantPrecision(shop({ displayPosition: { x: 0, y: 0, z: null }, connectorNodeIds: ["node-1"] }))).toBe("point");
    expect(merchantPrecision(shop({ evidence: { sourceIds: [source.id], method: "test", checkedDate: "2026-10-24" } }))).toBeNull();
  });

  it("does not call a routable shop's position verified when its evidence is search-only", () => {
    const poi = shop({
      displayPosition: { x: 0, y: 0, z: null },
      connectorNodeIds: ["node-1"],
      evidence: { sourceIds: [source.id], method: "facts-only directory listing (#26), UNVERIFIED, SEARCH_ONLY", checkedDate: "2026-10-24" },
    });
    expect(merchantPrecision(poi)).toBe("search");
  });

  it("never calls a search-only shop's display position verified without a connector", () => {
    const poi = shop({
      displayPosition: { x: 0, y: 0, z: null },
      evidence: { sourceIds: [source.id], method: "facts-only directory listing (#26), UNVERIFIED, SEARCH_ONLY", checkedDate: "2026-10-24" },
    });
    const card = merchantCardEl(merchantCardModel(poi, [source], "en", null), strings("en"));
    expect(card.textContent).not.toContain(strings("en").merchant.precision.point);
    expect(card.textContent).toContain(strings("en").merchant.precision.search);
  });
});

describe("merchant card model (#213)", () => {
  it("carries the name, category, source, checked date and precision, and never a route", () => {
    const model = merchantCardModel(shop(), [source], "ja", null);
    expect(model).toMatchObject({
      id: "shop-sjk-toei-001", name: "カレーショップC＆C", category: "shop", floor: null,
      precision: "area", checkedDate: "2026-10-24", routable: false,
    });
    expect(model.source).toEqual({ title: source.title, url: source.url });
    expect(model.note).toContain("位置・入口は未確認");
  });

  it("says a source is missing rather than inventing one, and takes routability from the connector only", () => {
    const model = merchantCardModel(shop({ evidence: { sourceIds: ["not-in-the-bundle"], method: "test", checkedDate: "2026-10-24" } }), [source], "en", null);
    expect(model.source).toBeNull();
    expect(merchantCardEl(model, strings("en")).textContent).toContain("No source recorded");
    expect(merchantCardModel(shop({ connectorNodeIds: ["node-1"] }), [source], "en", null).routable).toBe(true);
  });

  it("renders the source as a safe external link and offers no direction control", () => {
    const card = merchantCardEl(merchantCardModel(shop(), [source], "en", "B1"), strings("en"));
    expect(card.querySelector("h2")?.textContent).toBe("カレーショップC＆C");
    expect(card.querySelector(".merchant-meta")?.textContent).toBe("Shop · B1 · Approximate area only");
    const link = card.querySelector("a.merchant-source-link");
    expect(link?.getAttribute("href")).toBe(source.url);
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(card.textContent).toContain("Last checked: 2026-10-24");
    expect(card.textContent).toContain(strings("en").shopSearchOnly);
    // No button at all: the guide control lives on the route card, which a shop without a connector never reaches.
    expect(card.querySelector("button")).toBeNull();
  });

  it("does not claim a location problem for a routable shop, and shows the source title when it has no URL", () => {
    const routable = merchantCardEl(merchantCardModel(shop({ connectorNodeIds: ["node-1"] }), [source], "ja", null), strings("ja"));
    expect(routable.textContent).not.toContain(strings("ja").shopSearchOnly);
    const noUrl = merchantCardEl(merchantCardModel(shop(), [{ ...source, url: "" }], "ja", null), strings("ja"));
    expect(noUrl.querySelector("a")).toBeNull();
    expect(noUrl.textContent).toContain(source.title);
  });
});
