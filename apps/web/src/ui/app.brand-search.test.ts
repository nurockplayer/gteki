// #419: a brand typed into the destination field finds its department store through the store's own tenant
// directory, the store's result card shows the printed floor, and — because neither store POI has a verified
// entrance yet — selecting it gives the honest search-only/no-route card, never a drawn route. One case per
// station, on the station files as the web build ships them (tenants.json through parseStationFiles).
// @vitest-environment jsdom
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseStationFiles, type StationBundle } from "@gteki/schema";
import { createSearchIndex } from "@gteki/search";
import { createRouter } from "@gteki/navigation";
import { discoverStations } from "../../stations-plugin.ts";
import type { Lang } from "../i18n.ts";
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
  s: {
    lang: Lang; loaded: unknown; route: { ok: boolean; reason?: string } | null; origin: unknown;
    destination: { id: string } | null; destinationTenant: { id: string } | null;
    search?: unknown; router?: unknown; polyline?: unknown[];
  };
  ui: { sheet: HTMLElement; toInput: HTMLInputElement; toResults: HTMLElement };
  stationReady: boolean;
  layout: () => void;
  releaseMascot: () => void;
  mascotSay: () => void;
  explorer: unknown;
};

/** The bundle the web build hands the explorer: the four contract files, tenants included. */
function bundleOf(manifest: unknown, graph: unknown, pois: unknown, tenants: unknown): StationBundle {
  const parsed = parseStationFiles(manifest, graph, pois, tenants);
  if (!parsed.ok || !parsed.bundle) throw new Error(parsed.issues.filter((i) => i.level === "error").map((i) => i.message).join("; "));
  return parsed.bundle;
}

/** A mounted app at the station, with `originId` already picked (a routable POI), the real search index and router. */
function app(bundle: StationBundle, originId: string) {
  const root = document.createElement("div");
  document.body.append(root);
  const a = new App(root) as unknown as Harness;
  a.s.lang = "ja";
  a.layout(); // Mounts the panel and binds the destination field's real input handler.
  const explorer = { connectorRoutePaths: () => new Map(), refitOverview: vi.fn(), clearRoute: vi.fn(), showPois: vi.fn(), showRoute: vi.fn(), currentMode: "overview" };
  a.s.loaded = { bundle };
  a.s.search = createSearchIndex(bundle);
  a.s.router = createRouter(bundle);
  a.s.origin = { kind: "poi", poi: bundle.pois.find((p) => p.id === originId)! };
  a.stationReady = true;
  a.explorer = explorer;
  // Only the renders the pick would otherwise do are stubbed; search, the pick and the route card stay real.
  for (const name of ["renderIdentity", "renderCredit", "renderBanner", "renderSpawnChips", "renderProfile", "syncPanelMascot"] as const)
    vi.spyOn(a as unknown as Record<string, () => void>, name).mockImplementation(() => {});
  for (const name of ["releaseMascot", "mascotSay"] as const) vi.spyOn(a, name).mockImplementation(() => {});
  return { a, explorer, root };
}

type Flow = {
  stationDir: string;
  query: string;
  brand: string;
  storeId: string;
  storeName: string;
  floor: string;
  tenantId: string;
  checkedDate: string;
  /** The result row's meta line, written out rather than rebuilt from the UI's own strings. */
  resultMeta: string;
  /** The store's own printed wording that the no-route card repeats. */
  sourceNote: string;
  originId: string;
};

const SHOP_NO_ROUTE = "この店舗への道案内はまだありません（位置未確認）";
const TENANT_AS_OF = (date: string) => `店舗情報（${date} 時点・未確認）`;

function expectBrandFlow(bundle: StationBundle, want: Flow) {
  expect(bundle.tenants?.length, "tenants.json reaches the bundle").toBeGreaterThan(0);
  // The web build's discovery finds the same directory from stations/ (stations-plugin.ts:71-72), and the
  // virtual module then emits its tenants loader (plugin.test.ts); without that the bundle would lose its
  // brand directory in production even though this bundle parses.
  const stationsDir = path.resolve(import.meta.dirname, "../../../..", "stations");
  const discovered = discoverStations([stationsDir]).find((s) => s.dir === want.stationDir);
  expect(discovered?.tenants, "the plugin finds the station's tenants.json").toBe(path.join(stationsDir, want.stationDir, "gteki/tenants.json"));
  const store = bundle.pois.find((p) => p.id === want.storeId);
  expect(store, "the store POI").toMatchObject({ category: "shop", displayPosition: null, connectorNodeIds: [] });
  expect(bundle.pois.find((p) => p.id === want.originId)?.connectorNodeIds.length, "a routable start").toBeGreaterThan(0);

  const { a, explorer, root } = app(bundle, want.originId);
  expect(root.contains(a.ui.toInput), "the mounted destination field").toBe(true);

  // Typing a brand runs the real input handler, which searches the station bundle.
  a.ui.toInput.value = want.query;
  a.ui.toInput.dispatchEvent(new Event("input"));

  // The brand's directory entry is a fact about the store's card, never a place of its own.
  const options = [...a.ui.toResults.querySelectorAll<HTMLElement>('[role="option"]')];
  expect(options.length).toBeGreaterThan(0);
  for (const o of options) expect(o.querySelector(".result-name")?.textContent, "standalone brand place").not.toBe(want.brand);
  const option = options[0]!;
  expect(option.querySelector(".result-name")?.textContent).toBe(want.storeName);
  expect(option.querySelector(".result-meta")?.textContent).toBe(want.resultMeta);
  expect(option.querySelector(".result-asof")?.textContent).toBe(TENANT_AS_OF(want.checkedDate));

  option.click();

  // The brand is a fact about the store, not a destination of its own.
  expect(a.s.destination?.id).toBe(want.storeId);
  expect(a.s.destinationTenant?.id).toBe(want.tenantId);
  expect(a.ui.toInput.value).toBe(`${want.storeName} — ${want.brand}（${want.floor}）`);

  // No verified entrance: the honest no-route card, with the directory date and the store's own wording.
  expect(a.s.route).toMatchObject({ ok: false, reason: "unknown_goal" });
  expect(explorer.clearRoute).toHaveBeenCalled();
  expect(explorer.showRoute, "never a fake route").not.toHaveBeenCalled();
  expect(a.s.polyline).toEqual([]);
  expect(a.ui.sheet.classList.contains("open")).toBe(true);
  expect(root.contains(a.ui.sheet), "the mounted route sheet").toBe(true);
  const card = a.ui.sheet.querySelector(".no-route");
  expect(card?.textContent).toContain(SHOP_NO_ROUTE);
  expect(card?.textContent).toContain(TENANT_AS_OF(want.checkedDate));
  expect(card?.textContent).toContain(want.sourceNote);
}

describe("#419 department-store brand search end to end", () => {
  beforeEach(() => {
    // jsdom has no matchMedia; layout() reads the controls hint through it.
    vi.stubGlobal("matchMedia", () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("Ikebukuro: 紀伊國屋書店 → 東武百貨店 card with 7F → no route", () => {
    expectBrandFlow(bundleOf(ikbStation, ikbGraph, ikbPois, ikbTenants), {
      stationDir: "ikebukuro", query: "紀伊國屋書店", brand: "紀伊國屋書店", storeId: "shop-ikb-tobudept", storeName: "東武百貨店　池袋店",
      floor: "7F", tenantId: "tenant-ikb-tobudept-109225501", checkedDate: "2026-10-24",
      resultMeta: "7F · “紀伊國屋書店” · 位置未確認・道案内なし",
      sourceNote: "池袋駅西口 直結", originId: "exit-22",
    });
  });

  it("Shinjuku: アナ スイ → 小田急百貨店 card with １階 → no route", () => {
    expectBrandFlow(bundleOf(sjkStation, sjkGraph, sjkPois, sjkTenants), {
      stationDir: "shinjuku", query: "アナ スイ", brand: "アナ スイ", storeId: "shop-sjk-odakyudept", storeName: "小田急百貨店 新宿店",
      floor: "１階", tenantId: "tenant-sjk-odakyudept-013", checkedDate: "2026-10-24",
      resultMeta: "１階 · “アナ スイ” · 位置未確認・道案内なし",
      sourceNote: "新宿西口ハルクで営業", originId: "poi:exit:1",
    });
  });
});
