// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseStationFiles, type StationBundle } from "@gteki/schema";
import { createSearchIndex } from "@gteki/search";
import ikbStation from "../../../../stations/ikebukuro/gteki/station.json" with { type: "json" };
import ikbGraph from "../../../../stations/ikebukuro/gteki/graph.json" with { type: "json" };
import ikbPois from "../../../../stations/ikebukuro/gteki/pois.json" with { type: "json" };
import ikbTenants from "../../../../stations/ikebukuro/gteki/tenants.json" with { type: "json" };
import sjkStation from "../../../../stations/shinjuku/gteki/station.json" with { type: "json" };
import sjkGraph from "../../../../stations/shinjuku/gteki/graph.json" with { type: "json" };
import sjkPois from "../../../../stations/shinjuku/gteki/pois.json" with { type: "json" };
import sjkTenants from "../../../../stations/shinjuku/gteki/tenants.json" with { type: "json" };

vi.mock("../explorer/explorer.ts", () => ({ Explorer: class {} }));
vi.mock("../registry.ts", () => ({ listStations: vi.fn(), PRIVATE_BUILD: false, StationLoadError: class extends Error {} }));
import { openNow } from "../openNow.ts";
import { App } from "./app.ts";

type Harness = {
  s: { lang: "ja" | "en"; loaded: unknown; entry: { key: string }; search: unknown; openNow: boolean; filter: string | null };
  ui: {
    toInput: HTMLInputElement; fromInput: HTMLInputElement; toResults: HTMLElement; fromResults: HTMLElement;
    openNowFilter: HTMLInputElement;
  };
  layout: () => void;
  layoutText: () => void;
};
function bundleOf(station: unknown, graph: unknown, pois: unknown, tenants: unknown): StationBundle {
  const result = parseStationFiles(station, graph, pois, tenants);
  if (!result.ok || !result.bundle) throw new Error(JSON.stringify(result.issues));
  return result.bundle;
}
function mount(bundle: StationBundle, key: string) {
  const root = document.createElement("div");
  document.body.append(root);
  const a = new App(root) as unknown as Harness;
  a.s.lang = "ja";
  a.layout();
  a.s.loaded = { bundle };
  a.s.entry = { key };
  a.s.search = createSearchIndex(bundle);
  for (const name of ["releaseMascot", "mascotSay"])
    vi.spyOn(a as unknown as Record<string, () => void>, name).mockImplementation(() => {});
  const search = (query: string, which: "to" | "from" = "to") => {
    const input = which === "to" ? a.ui.toInput : a.ui.fromInput;
    input.value = query;
    input.dispatchEvent(new Event("input"));
    return [...(which === "to" ? a.ui.toResults : a.ui.fromResults).querySelectorAll<HTMLElement>("button.result")];
  };
  const toggle = (checked: boolean) => {
    a.ui.openNowFilter.checked = checked;
    a.ui.openNowFilter.dispatchEvent(new Event("change"));
  };
  return { a, root, search, toggle };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();
});

it("filters the real public stores and their brands at noon and 21:00 JST, retaining unknown hours", () => {
  const ikb = bundleOf(ikbStation, ikbGraph, ikbPois, ikbTenants);
  const sjk = bundleOf(sjkStation, sjkGraph, sjkPois, sjkTenants);
  for (const [bundle, key, id, query] of [
    [ikb, "ikebukuro", "shop-ikb-seibu-honten", "西武池袋本店"],
    [sjk, "shinjuku", "shop-sjk-takashimaya", "高島屋タイムズスクエア"],
  ] as const) {
    const { a, root, search, toggle } = mount(bundle, key);
    expect(a.s.openNow).toBe(false);
    expect(root.querySelector(".filter-row label")?.textContent).toBe("営業中のみ");
    const tenant = bundle.tenants!.find((t) => t.poiId === id)!;
    expect(tenant).toBeDefined();
    for (const time of ["12:00", "21:00"]) {
      vi.setSystemTime(new Date(`2026-11-04T${time}:00+09:00`));
      toggle(false);
      const baseline = search(query).map((row) => row.textContent);
      expect(baseline.some((text) => text?.includes(query))).toBe(true);
      toggle(true);
      for (const which of ["from", "to"] as const) {
        const rows = search(query, which);
        const row = rows.find((r) => r.querySelector(".result-name")?.textContent === query);
        if (time === "12:00") expect(row?.querySelector(".result-meta")?.textContent).toContain("営業中");
        else expect(row).toBeUndefined();
      }
      const brands = search(tenant.names[0]!.text);
      const brandRow = brands.find((row) => row.querySelector(".result-name")?.textContent === query);
      if (time === "12:00") expect(brandRow?.querySelector(".result-meta")?.textContent).toContain("営業中");
      else expect(brandRow).toBeUndefined();
      if (key === "ikebukuro") {
        const tobu = search("東武百貨店").find((r) => r.textContent?.includes("東武百貨店"));
        expect(tobu?.querySelector(".result-meta")?.textContent).toContain("営業時間不明");
      }
      toggle(false);
      expect(a.ui.toResults.children.length).toBe(0);
      expect(a.ui.fromResults.children.length).toBe(0);
      expect(search(query).map((row) => row.textContent)).toEqual(baseline);
    }
    vi.setSystemTime(new Date("2026-11-04T12:00:00+09:00"));
    toggle(true);
    a.s.filter = "shop";
    const suggestions = search("");
    expect(suggestions.length).toBeLessThanOrEqual(8);
    const tags = suggestions.map((row) => row.querySelector(".result-meta")!.textContent!);
    if (key === "ikebukuro") {
      expect(suggestions.map((row) => row.querySelector(".result-name")?.textContent))
        .toEqual(["西武池袋本店", "ルミネ池袋", "池袋ショッピングパーク"]);
      expect(tags[0]).toContain("営業中");
      expect(tags.slice(1).every((tag) => tag.includes("営業時間不明"))).toBe(true);
      vi.setSystemTime(new Date("2026-11-04T21:00:00+09:00"));
      expect(search("").map((row) => row.querySelector(".result-name")?.textContent))
        .toEqual(["ルミネ池袋", "池袋ショッピングパーク"]);
    } else expect(suggestions).toHaveLength(0); // Public SJK shops have no verified connectors for suggestions.
    a.s.filter = "ticket_gate";
    toggle(false);
    const gates = search("改札").map((row) => row.textContent);
    expect(gates.length).toBeGreaterThan(0);
    toggle(true);
    expect(search("改札").map((row) => row.textContent)).toEqual(gates);
    a.s.lang = "en";
    a.layoutText();
    expect(root.querySelector(".filter-row label")?.textContent).toBe("Open now");
  }
});

it("ranks every candidate before dropping closed shops, and the other-category count drops them too (#724 review)", () => {
  const sjk = bundleOf(sjkStation, sjkGraph, sjkPois, sjkTenants);
  const { a, search, toggle } = mount(sjk, "shinjuku");
  vi.setSystemTime(new Date("2026-11-04T21:30:00+09:00"));
  const now = new Date();
  a.s.filter = "shop";
  toggle(true);
  // Every shop the full ranking says is not closed is a candidate; the list shows the first 8 of them.
  const all = createSearchIndex(sjk).search("a", { limit: sjk.pois.length, lang: "ja", categories: ["shop"] })
    .filter((h) => openNow(h.poi.hours, now) !== "closed");
  const shown = search("a").map((row) => row.querySelector(".result-name")?.textContent);
  expect(shown.length).toBe(Math.min(8, all.length));
  expect(shown.filter((name) => !name?.length)).toHaveLength(0);
  // A closed store found only in the shop category leaves no "other categories" offer that counts it.
  const ikb = bundleOf(ikbStation, ikbGraph, ikbPois, ikbTenants);
  const second = mount(ikb, "ikebukuro");
  vi.setSystemTime(new Date("2026-11-04T21:00:00+09:00"));
  second.a.s.filter = "shop";
  second.toggle(true);
  expect(second.search("西武池袋本店").length).toBe(0);
  const offer = second.a.ui.toResults.querySelector(".other-categories")?.textContent ?? "";
  const expected = createSearchIndex(ikb).search("西武池袋本店", { limit: ikb.pois.length, lang: "ja" })
    .filter((h) => h.poi.category !== "shop" || openNow(h.poi.hours, new Date()) !== "closed").slice(0, 8).length;
  if (expected === 0) expect(offer).toBe("");
  else expect(offer).toContain(expected === 8 ? "8+" : String(expected));
});
