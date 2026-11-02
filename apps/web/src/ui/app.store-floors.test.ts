// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseStationFiles, type Poi, type StationBundle } from "@gteki/schema";
import { createSearchIndex } from "@gteki/search";
import { createRouter } from "@gteki/navigation";
import { pick } from "../i18n.ts";
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
import { App } from "./app.ts";

type Harness = {
  s: { lang: "ja"; loaded: unknown; search: unknown; router: unknown; origin: unknown; destination: Poi | null };
  ui: { sheet: HTMLElement; toInput: HTMLInputElement; toResults: HTMLElement };
  stationReady: boolean;
  layout: () => void;
  explorer: unknown;
};

function bundleOf(manifest: unknown, graph: unknown, pois: unknown, tenants: unknown): StationBundle {
  const parsed = parseStationFiles(manifest, graph, pois, tenants);
  if (!parsed.ok || !parsed.bundle) throw new Error(JSON.stringify(parsed.issues));
  return parsed.bundle;
}

function app(bundle: StationBundle, originId: string) {
  const root = document.createElement("div");
  document.body.append(root);
  const a = new App(root) as unknown as Harness;
  a.s.lang = "ja";
  a.layout();
  a.s.loaded = { bundle };
  a.s.search = createSearchIndex(bundle);
  a.s.router = createRouter(bundle);
  a.s.origin = { kind: "poi", poi: bundle.pois.find((p) => p.id === originId)! };
  a.stationReady = true;
  a.explorer = { connectorRoutePaths: () => new Map(), refitOverview: vi.fn(), clearRoute: vi.fn(), showPois: vi.fn(), showRoute: vi.fn(), currentMode: "overview" };
  for (const name of ["renderIdentity", "renderCredit", "renderBanner", "renderSpawnChips", "renderProfile", "syncPanelMascot", "releaseMascot", "mascotSay"])
    vi.spyOn(a as unknown as Record<string, () => void>, name).mockImplementation(() => {});
  return a;
}

describe("public store cards list their printed brand floors", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {} }));
    localStorage.clear();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });

  it.each([
    { storeId: "shop-ikb-tobudept", originId: "exit-22", files: [ikbStation, ikbGraph, ikbPois, ikbTenants] },
    { storeId: "shop-sjk-takashimaya", originId: "poi:exit:1", files: [sjkStation, sjkGraph, sjkPois, sjkTenants] },
    { storeId: "shop-sjk-keio", originId: "poi:exit:1", files: [sjkStation, sjkGraph, sjkPois, sjkTenants] },
  ])("$storeId: pick, open a floor, then filter a real brand", ({ storeId, originId, files }) => {
    const bundle = bundleOf(files[0], files[1], files[2], files[3]);
    const tenants = bundle.tenants!.filter((tenant) => tenant.poiId === storeId);
    const labels = [...new Set(tenants.map((tenant) => pick(tenant.floorLabel, "ja")))];
    expect(tenants.length).toBeGreaterThan(0);
    const a = app(bundle, originId);
    const store = bundle.pois.find((poi) => poi.id === storeId)!;
    a.ui.toInput.value = pick(store.names, "ja");
    a.ui.toInput.dispatchEvent(new Event("input"));
    const option = [...a.ui.toResults.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((row) => row.querySelector(".result-name")?.textContent === pick(store.names, "ja"))!;
    expect(option).toBeDefined();
    option.click();
    expect(a.s.destination?.id).toBe(storeId);
    const directory = a.ui.sheet.querySelector<HTMLDetailsElement>(".merchant-floors")!;
    expect(directory.open).toBe(false);
    expect(directory.querySelector("summary")?.textContent).toBe(`フロア別ブランド（${tenants.length}）`);
    const floors = [...directory.querySelectorAll<HTMLDetailsElement>(".merchant-floor")];
    expect(floors).toHaveLength(labels.length);
    expect(floors.map((floor) => floor.dataset.floor)).toEqual(labels);
    expect(directory.querySelectorAll("ul")).toHaveLength(0);
    directory.open = true;
    floors[0]!.open = true;
    floors[0]!.dispatchEvent(new Event("toggle"));
    expect([...floors[0]!.querySelectorAll("li")].map((li) => li.firstChild?.textContent)).toEqual(
      tenants.filter((tenant) => pick(tenant.floorLabel, "ja") === labels[0]).map((tenant) => pick(tenant.names, "ja")),
    );
    const brand = pick(tenants.at(-1)!.names, "ja");
    const filter = directory.querySelector<HTMLInputElement>(".merchant-floors-filter")!;
    filter.value = brand;
    filter.dispatchEvent(new Event("input"));
    const matching = tenants.filter((tenant) => pick(tenant.names, "ja").normalize("NFKC").toLowerCase().includes(brand.normalize("NFKC").toLowerCase()));
    expect(floors.filter((floor) => !floor.hidden).map((floor) => floor.dataset.floor)).toEqual(
      labels.filter((label) => matching.some((tenant) => pick(tenant.floorLabel, "ja") === label)),
    );
    for (const floor of floors.filter((floor) => !floor.hidden)) {
      expect(floor.open).toBe(true);
      expect([...floor.querySelectorAll("li")].map((li) => li.firstChild?.textContent)).toEqual(
        matching.filter((tenant) => pick(tenant.floorLabel, "ja") === floor.dataset.floor).map((tenant) => pick(tenant.names, "ja")),
      );
    }
  });
});
