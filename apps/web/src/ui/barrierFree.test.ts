// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createRouter, DEFAULT_PROFILE, routeBetween, type RouteFailure, type RouteProfile, type RouteResult } from "@gteki/navigation";
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

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("classifies only toilets whose names state accessibility", () => {
  const toilet = ikb.pois.find((p) => p.id === "toilet-ikb-metro-001")!;
  for (const text of ["車いす対応トイレ", "車椅子対応トイレ", "多機能トイレ", "多目的トイレ", "バリアフリートイレ",
    "Accessible toilet", "multipurpose toilet", "multi-purpose toilet", "wheelchair toilet"])
    expect(isAccessibleToilet({ ...toilet, names: [{ lang: "ja", text }] })).toBe(true);
  for (const text of ["not accessible toilet", "inaccessible toilet", "non-accessible toilet", "in-accessible toilet"])
    expect(isAccessibleToilet({ ...toilet, names: [{ lang: "en", text }] })).toBe(false);
  expect(isAccessibleToilet({ ...toilet, names: [{ lang: "ja", text: "トイレ（男女共用）" }] })).toBe(false);
  expect(isAccessibleToilet({ ...toilet, category: "shop" })).toBe(false);
});

it.each([["IKB", ikb, 2, 4, 19], ["SJK", sjk, 0, 0, 0]] as const)(
  "keeps toilet designations separate in real %s names and generic queries complete",
  (_station, bundle, multipurposeCount, wheelchairCount, accessibleCount) => {
    const search = createSearchIndex(bundle);
    const results = (query: string) => barrierFreeResults(bundle, search, null, null, query, "ja", DEFAULT_PROFILE);
    for (const [queries, designation, count] of [
      [["多機能", "多機", "多目的", "multipurpose", "multi-purpose", "multi"], /多機能|多目的|multi-?purpose/i, multipurposeCount],
      [["車いす", "車椅子", "wheelchair", "wheel"], /車いす|車椅子|wheelchair/i, wheelchairCount],
    ] as const) {
      const expected = bundle.pois.filter((poi) => poi.category === "toilet" &&
        poi.names.some(({ text }) => designation.test(text)));
      expect(expected).toHaveLength(count);
      for (const query of queries) {
        const toilets = results(query).filter(({ poi }) => poi.category === "toilet");
        expect(toilets.map(({ poi }) => poi.id).sort()).toEqual(expected.map((poi) => poi.id).sort());
        if (count > 0) expect(toilets.length).toBeGreaterThan(0);
        for (const { poi } of toilets)
          expect(poi.names.some(({ text }) => designation.test(text))).toBe(true);
      }
    }
    const accessible = bundle.pois.filter(isAccessibleToilet);
    expect(accessible).toHaveLength(accessibleCount);
    for (const query of ["トイレ", "toilet", "restroom", "accessible toilet", "バリアフリー"])
      expect(results(query).map(({ poi }) => poi.id).sort()).toEqual(accessible.map((poi) => poi.id).sort());
  },
);

it("keeps real IKB search-only facilities, excludes plain toilets, and narrows by text", () => {
  const search = createSearchIndex(ikb);
  const origin = { kind: "poi", poi: ikb.pois.find((p) => p.id === "jr-central-gate-2")! } as const;
  const results = (query: string) => barrierFreeResults(ikb, search, createRouter(ikb), origin, query, "ja", DEFAULT_PROFILE);
  expect(results("")).toHaveLength(42);
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
    const hits = barrierFreeResults(sjk, search, router, origin, "", "en", { fare: "ticketed", stepFree: true });
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

it("matches English facility kinds on the real IKB Japanese-only POIs", () => {
  const search = createSearchIndex(ikb);
  const origin = { kind: "poi", poi: ikb.pois.find((p) => p.id === "metro-m-central-west-gate")! } as const;
  const results = (query: string) => barrierFreeResults(ikb, search, createRouter(ikb), origin, query, "en", DEFAULT_PROFILE);
  const elevators = results("elevator");
  expect(elevators).toHaveLength(8);
  expect(elevators.every((hit) => hit.poi.category === "elevator")).toBe(true);
  const toilets = results("toilet");
  expect(toilets).toHaveLength(19);
  expect(toilets.every((hit) => isAccessibleToilet(hit.poi))).toBe(true);
});

it("shows the distance computeRoute produces for the selected SJK lift with step-free off and on", () => {
  vi.useFakeTimers({ now: new Date("2026-11-03T12:00:00+09:00") });
  const router = createRouter(sjk);
  const search = createSearchIndex(sjk);
  const origin = { kind: "poi", poi: sjk.pois.find((p) => p.id === "poi:gate:1")! } as const;
  const destination = sjk.pois.find((p) => p.id === "poi:elevator:3")!;
  const app = new App(document.createElement("div")) as unknown as {
    s: { lang: string; loaded: unknown; entry: unknown; router: unknown; search: unknown; origin: unknown;
      destination: Poi; filter: string; profile: { stepFree: boolean }; route: RouteResult | RouteFailure | null };
    ui: { toResults: HTMLElement; minimap: { setRoute: () => void } };
    explorer: unknown;
    profile(): RouteProfile; computeRoute(): void; renderResults(which: "to"): void;
  };
  for (const name of ["renderSheet", "releaseMascot", "mascotSay"])
    vi.spyOn(app as unknown as Record<string, () => void>, name).mockImplementation(() => {});
  vi.spyOn(app.ui.minimap, "setRoute").mockImplementation(() => {});
  app.explorer = { clearRoute: vi.fn(), connectorRoutePaths: () => new Map(), navmeshRoutePaths: () => new Map(),
    showRoute: vi.fn(), currentMode: "walk" };
  Object.assign(app.s, { lang: "en", loaded: { bundle: sjk }, entry: { key: "shinjuku" }, router, search,
    origin, destination, filter: "barrier_free" });
  for (const stepFree of [false, true]) {
    app.s.profile.stepFree = stepFree;
    app.computeRoute();
    const route = app.s.route;
    expect(route?.ok).toBe(true);
    if (!route?.ok) throw new Error("Expected the real SJK lift route");
    const hit = barrierFreeResults(sjk, search, router, origin, "", "en", app.profile()).find((h) => h.poi.id === destination.id)!;
    expect(hit).toMatchObject({ distanceKind: "route", distanceM: route.totalLengthM });
    app.renderResults("to");
    expect(app.ui.toResults.querySelector(`[data-poi="${destination.id}"] .result-meta`)?.textContent)
      .toContain(`Route ${Math.round(route.totalLengthM)} m`);
  }
});

it("ranks the real IKB lift serving the origin gate first without inventing a distance", () => {
  const origin = { kind: "poi", poi: ikb.pois.find((p) => p.id === "metro-m-central-west-gate")! } as const;
  // Reverse the real POIs so the lift must move from the end rather than pass by data order.
  const bundle = { ...ikb, pois: [...ikb.pois].reverse() };
  const hits = barrierFreeResults(bundle, createSearchIndex(bundle), createRouter(bundle), origin, "", "en", DEFAULT_PROFILE);
  expect(hits).toHaveLength(42);
  expect(new Set(hits.map((hit) => hit.poi.category))).toEqual(new Set(["elevator", "escalator", "toilet"]));
  expect(hits[0]).toMatchObject({ poi: { id: "metro-m-lift-1" }, connectsToGate: true, distanceM: null });
  expect(hits.slice(1).every((hit) => !hit.connectsToGate)).toBe(true);
});

it("selects the new option, shows all 42 real IKB rows with notes, and preserves the single-category filter", () => {
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
  app.s.origin = { kind: "poi", poi: ikb.pois.find((p) => p.id === "metro-m-central-west-gate")! };
  app.s.openNow = true;
  app.renderCategoryFilter(ikb);
  app.ui.categoryFilter.value = "barrier_free";
  app.ui.categoryFilter.dispatchEvent(new Event("change"));
  expect(app.ui.toResults.querySelectorAll("button.result")).toHaveLength(42);
  expect(app.ui.toResults.querySelector("button.result")?.textContent).toContain("起点の改札に接続");
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
