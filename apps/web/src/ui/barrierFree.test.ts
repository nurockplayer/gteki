// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createRouter, routeBetween } from "@gteki/navigation";
import { parseStationFiles, type Poi, type StationBundle } from "@gteki/schema";
import { createSearchIndex } from "@gteki/search";
import ikbStation from "../../../../stations/ikebukuro/gteki/station.json" with { type: "json" };
import ikbGraph from "../../../../stations/ikebukuro/gteki/graph.json" with { type: "json" };
import ikbPois from "../../../../stations/ikebukuro/gteki/pois.json" with { type: "json" };
import sjkStation from "../../../../stations/shinjuku/gteki/station.json" with { type: "json" };
import sjkGraph from "../../../../stations/shinjuku/gteki/graph.json" with { type: "json" };
import sjkPois from "../../../../stations/shinjuku/gteki/pois.json" with { type: "json" };
import { barrierFreeResults, isAccessibleToilet } from "./barrierFree.ts";

vi.mock("../explorer/explorer.ts", () => ({ Explorer: class {} }));
vi.mock("../registry.ts", () => ({ listStations: vi.fn(), PRIVATE_BUILD: false, StationLoadError: class extends Error {} }));
import { App } from "./app.ts";

function bundleOf(station: unknown, graph: unknown, pois: unknown): StationBundle {
  const result = parseStationFiles(station, graph, pois);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.bundle;
}
const ikb = bundleOf(ikbStation, ikbGraph, ikbPois);
const sjk = bundleOf(sjkStation, sjkGraph, sjkPois);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("classifies only toilets whose names state accessibility", () => {
  const toilet = ikb.pois.find((p) => p.id === "toilet-ikb-metro-001")!;
  for (const text of ["車いす対応トイレ", "多機能トイレ", "多目的トイレ", "バリアフリートイレ", "Accessible toilet"])
    expect(isAccessibleToilet({ ...toilet, names: [{ lang: "ja", text }] })).toBe(true);
  expect(isAccessibleToilet({ ...toilet, names: [{ lang: "ja", text: "トイレ（男女共用）" }] })).toBe(false);
  expect(isAccessibleToilet({ ...toilet, category: "shop" })).toBe(false);
});

it("keeps real IKB search-only facilities, excludes plain toilets, and narrows by text", () => {
  const search = createSearchIndex(ikb);
  const origin = { kind: "poi", poi: ikb.pois.find((p) => p.id === "jr-central-gate-2")! } as const;
  const results = (query: string) => barrierFreeResults(ikb, search, createRouter(ikb), origin, query, "ja");
  expect(results("")).toHaveLength(20);
  expect(results("").every((h) => ["elevator", "escalator"].includes(h.poi.category) || isAccessibleToilet(h.poi))).toBe(true);
  expect(results("").every((h) => !h.routable && h.distanceM === null)).toBe(true);
  const toilets = results("トイレ");
  expect(toilets).toHaveLength(19);
  expect(toilets.every((h) => isAccessibleToilet(h.poi))).toBe(true);
  expect(toilets.find((h) => h.poi.id === "toilet-ikb-metro-001")?.poi.notes?.[0]?.text).toContain("中央通路東改札外広場");
});

it("orders real SJK lifts by distance from a gate or store, then keeps unlocated facilities last", () => {
  const router = createRouter(sjk);
  const search = createSearchIndex(sjk);
  for (const poi of [sjk.pois.find((p) => p.id === "poi:gate:1")!, sjk.pois.find((p) => p.category === "shop")!]) {
    const origin = { kind: "poi", poi } as const;
    const hits = barrierFreeResults(sjk, search, router, origin, "", "en");
    expect(hits).toHaveLength(9);
    if (!poi.displayPosition && !poi.connectorNodeIds.length) {
      expect(hits.every((h) => h.distanceM === null)).toBe(true);
      continue;
    }
    expect(hits.slice(0, 3).every((h) => h.routable && h.distanceM !== null)).toBe(true);
    expect(hits.slice(3).every((h) => !h.routable && h.distanceM === null)).toBe(true);
    const distances = hits.slice(0, 3).map((h) => h.distanceM!);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    for (const hit of hits.slice(0, 3)) {
      const route = routeBetween(router, origin, hit.poi, { fare: "ticketed", stepFree: true });
      if (route.ok) expect(hit).toMatchObject({ distanceKind: "route", distanceM: route.totalLengthM });
      else {
        const start = poi.displayPosition ?? sjk.nodes.find((n) => poi.connectorNodeIds.includes(n.id))!.position;
        expect(hit).toMatchObject({ distanceKind: "straight", distanceM: Math.hypot(hit.poi.displayPosition!.x - start.x, hit.poi.displayPosition!.y - start.y) });
      }
    }
  }
});

it("selects the new option, shows 20 real IKB rows with notes, and preserves the single-category filter", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const app = new App(document.createElement("div")) as unknown as {
    s: { lang: string; loaded: unknown; entry: unknown; search: unknown; router: unknown; origin: unknown; openNow: boolean };
    ui: { toResults: HTMLElement; toInput: HTMLInputElement; categoryFilter: HTMLSelectElement };
    layout(): void; renderCategoryFilter(bundle: StationBundle): void;
  };
  for (const name of ["releaseMascot", "mascotSay"])
    vi.spyOn(app as unknown as Record<string, () => void>, name).mockImplementation(() => {});
  app.s.lang = "ja";
  app.layout();
  app.s.loaded = { bundle: ikb };
  app.s.entry = { key: "ikebukuro" };
  app.s.search = createSearchIndex(ikb);
  app.s.router = createRouter(ikb);
  app.s.origin = { kind: "poi", poi: ikb.pois.find((p) => p.id === "jr-central-gate-2")! };
  app.s.openNow = true;
  app.renderCategoryFilter(ikb);
  app.ui.categoryFilter.value = "barrier_free";
  app.ui.categoryFilter.dispatchEvent(new Event("change"));
  expect(app.ui.toResults.querySelectorAll("button.result")).toHaveLength(20);
  expect(app.ui.toResults.textContent).toContain("距離不明");
  app.ui.toInput.value = "トイレ";
  app.ui.toInput.dispatchEvent(new Event("input"));
  expect(app.ui.toResults.querySelectorAll("button.result")).toHaveLength(19);
  expect(app.ui.toResults.querySelector('[data-poi="toilet-ikb-metro-001"]')?.textContent).toContain("中央通路東改札外広場");
  app.ui.categoryFilter.value = "toilet";
  app.ui.categoryFilter.dispatchEvent(new Event("change"));
  app.ui.toInput.dispatchEvent(new Event("input"));
  const ids = [...app.ui.toResults.querySelectorAll<HTMLElement>("button.result")].map((row) => row.dataset.poi);
  expect(ids.length).toBeGreaterThan(0);
  expect(ids.every((id) => ikb.pois.find((p: Poi) => p.id === id)?.category === "toilet")).toBe(true);
});
