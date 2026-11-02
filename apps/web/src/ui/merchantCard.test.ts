// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Poi, Source, Tenant } from "@gteki/schema";
import { strings } from "../i18n.ts";
import { arrivalPrecision, isMapReadDoor, isStationTie, merchantCardEl, merchantCardModel, merchantPrecision } from "./merchantCard.ts";

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

const tenant = (name: string, floor: string, sourceIds = [source.id]): Tenant => ({
  id: name, poiId: shop().id, names: [{ lang: "ja", text: name }], aliases: [],
  floorLabel: [{ lang: "ja", text: floor }],
  category: name === "ＡＢＣ" ? [{ lang: "ja", text: "雑貨" }] : undefined,
  evidence: { sourceIds, checkedDate: "2026-10-24", method: "printed directory" },
});

describe("merchant brands by printed floor", () => {
  const tenants = [tenant("ＡＢＣ", "本館 3F"), tenant("Other", "地下１階"), tenant("abc café", "本館 3F", ["second", source.id])];
  const model = () => merchantCardModel(shop(), [source], "ja", null, tenants);

  it("keeps first-appearance floor order and data brand order, combining source ids", () => {
    expect(model().floors).toEqual([
      { label: "本館 3F", brands: [{ name: "ＡＢＣ", category: "雑貨" }, { name: "abc café", category: null }], sourceIds: [source.id, "second"], checkedDate: "2026-10-24" },
      { label: "地下１階", brands: [{ name: "Other", category: null }], sourceIds: [source.id], checkedDate: "2026-10-24" },
    ]);
  });

  it("omits the directory without tenants and builds lists only when a floor first opens", () => {
    const empty = merchantCardEl(merchantCardModel(shop(), [source], "ja", null, []), strings("ja"), [source], "ja");
    expect(empty.querySelector(".merchant-floors")).toBeNull();
    for (const lang of ["ja", "en"] as const) {
      const card = merchantCardEl(model(), strings(lang), [source, { ...source, id: "second", title: "Second directory" }], lang);
      const directory = card.querySelector<HTMLDetailsElement>(".merchant-floors")!;
      expect(directory.open).toBe(false);
      expect(directory.querySelector("summary")?.textContent).toBe(lang === "ja" ? "フロア別ブランド（3）" : "Brands by floor (3)");
      expect(directory.querySelector("ul")).toBeNull();
      const floor = directory.querySelector<HTMLDetailsElement>(".merchant-floor")!;
      floor.open = true;
      floor.dispatchEvent(new Event("toggle"));
      expect(floor.querySelectorAll("li")).toHaveLength(2);
      expect(floor.querySelector("li")?.textContent).toBe("ＡＢＣ · 雑貨");
      expect(floor.querySelector("summary")?.textContent).toBe(lang === "ja" ? "本館 3F（2）" : "本館 3F (as printed) (2)");
      expect(floor.querySelector(".merchant-floor-source")?.textContent).toContain(`${source.title} · Second directory`);
      expect(floor.textContent).toContain(strings(lang).tenantAsOf("2026-10-24"));
      expect(directory.querySelectorAll("ul")).toHaveLength(1);
      expect(directory.querySelector("a, button")).toBeNull();
    }
  });

  it("normalizes name searches, opens only matching floors and restores every floor on clearing", () => {
    const card = merchantCardEl(model(), strings("ja"), [source], "ja");
    const floors = [...card.querySelectorAll<HTMLDetailsElement>(".merchant-floor")];
    const filter = card.querySelector<HTMLInputElement>(".merchant-floors-filter")!;
    filter.value = "ＡbＣ";
    filter.dispatchEvent(new Event("input"));
    expect(floors.map((f) => [f.hidden, f.open])).toEqual([[false, true], [true, false]]);
    expect([...card.querySelectorAll("li")].map((li) => li.firstChild?.textContent)).toEqual(["ＡＢＣ", "abc café"]);
    filter.value = "other";
    filter.dispatchEvent(new Event("input"));
    expect(floors.map((f) => [f.hidden, f.open])).toEqual([[true, false], [false, true]]);
    expect([...card.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Other"]);
    filter.value = "no match";
    filter.dispatchEvent(new Event("input"));
    expect(floors.every((f) => f.hidden && !f.open)).toBe(true);
    filter.value = "";
    filter.dispatchEvent(new Event("input"));
    expect(floors.every((f) => !f.hidden && !f.open)).toBe(true);
    expect(floors.map((f) => f.querySelectorAll("li").length)).toEqual([2, 1]);
  });
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

  it("reads a printed station-level tie as its own precision, checked before the point (#213)", () => {
    const tie = shop({
      displayPosition: { x: 0, y: 0, z: null },
      connectorNodeIds: ["node-1"],
      evidence: {
        sourceIds: [source.id],
        method: "printed store-entrance tie: the page prints 「南改札口から徒歩すぐ」 (facts only). STATION_TIE: the store's own entrance is not verified (field item V1). UNVERIFIED",
        checkedDate: "2026-10-28",
      },
    });
    expect(isStationTie(tie)).toBe(true);
    expect(merchantPrecision(tie)).toBe("tie");
    const card = merchantCardEl(merchantCardModel(tie, [source], "en", null, []), strings("en"), [source], "en");
    expect(card.querySelector(".merchant-meta")?.textContent).toContain(strings("en").merchant.precision.tie);
  });

  it("labels a private map-read door (P_MAP_DOOR) ahead of a station tie, and only when it routes (OD-35)", () => {
    const method = "facts-only directory listing (OD-34), UNVERIFIED, SEARCH_ONLY; STATION_TIE; P_MAP_DOOR: map-read entrance, unverified";
    const door = shop({ connectorNodeIds: ["p:entrance"], evidence: { sourceIds: [source.id], method, checkedDate: "2026-10-27" } });
    expect(isMapReadDoor(door)).toBe(true);
    expect(arrivalPrecision(door)).toBe("door");
    expect(merchantPrecision(door)).toBe("door");
    const card = merchantCardEl(merchantCardModel(door, [source], "ja", null, []), strings("ja"), [source], "ja");
    expect(card.querySelector(".merchant-meta")?.textContent).toContain(strings("ja").merchant.precision.door);
    expect(card.querySelector(".merchant-no-route")).toBeNull();
    // Without a connector the token labels nothing: the listing falls back to its own wording.
    expect(merchantPrecision(shop({ evidence: { sourceIds: [source.id], method, checkedDate: "2026-10-27" } }))).toBe("tie");
  });

  it("leaves a shop without the token on the existing precisions", () => {
    expect(isStationTie(shop())).toBe(false);
    expect(merchantPrecision(shop({ displayPosition: { x: 0, y: 0, z: null }, connectorNodeIds: ["node-1"] }))).toBe("point");
  });

  it("never calls a search-only shop's display position verified without a connector", () => {
    const poi = shop({
      displayPosition: { x: 0, y: 0, z: null },
      evidence: { sourceIds: [source.id], method: "facts-only directory listing (#26), UNVERIFIED, SEARCH_ONLY", checkedDate: "2026-10-24" },
    });
    const card = merchantCardEl(merchantCardModel(poi, [source], "en", null, []), strings("en"), [source], "en");
    expect(card.textContent).not.toContain(strings("en").merchant.precision.point);
    expect(card.textContent).toContain(strings("en").merchant.precision.search);
  });
});

describe("merchant card model (#213)", () => {
  it("carries the name, category, source, checked date and precision, and never a route", () => {
    const model = merchantCardModel(shop(), [source], "ja", null, []);
    expect(model).toMatchObject({
      id: "shop-sjk-toei-001", name: "カレーショップC＆C", category: "shop", floor: null,
      precision: "area", checkedDate: "2026-10-24", routable: false,
    });
    expect(model.source).toEqual({ title: source.title, url: source.url });
    expect(model.note).toContain("位置・入口は未確認");
  });

  it("says a source is missing rather than inventing one, and takes routability from the connector only", () => {
    const model = merchantCardModel(shop({ evidence: { sourceIds: ["not-in-the-bundle"], method: "test", checkedDate: "2026-10-24" } }), [source], "en", null, []);
    expect(model.source).toBeNull();
    expect(merchantCardEl(model, strings("en"), [source], "en").textContent).toContain("No source recorded");
    expect(merchantCardModel(shop({ connectorNodeIds: ["node-1"] }), [source], "en", null, []).routable).toBe(true);
  });

  it("renders the source as a safe external link and offers no direction control", () => {
    const card = merchantCardEl(merchantCardModel(shop(), [source], "en", "B1", []), strings("en"), [source], "en");
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
    const routable = merchantCardEl(merchantCardModel(shop({ connectorNodeIds: ["node-1"] }), [source], "ja", null, []), strings("ja"), [source], "ja");
    expect(routable.textContent).not.toContain(strings("ja").shopSearchOnly);
    const noUrl = merchantCardEl(merchantCardModel(shop(), [{ ...source, url: "" }], "ja", null, []), strings("ja"), [source], "ja");
    expect(noUrl.querySelector("a")).toBeNull();
    expect(noUrl.textContent).toContain(source.title);
  });
});
