// @vitest-environment jsdom
// Private build store flow (OD-35): a brand typed into the destination field finds its store, the store's result row
// carries the map-read door label, and selecting it gives a route that ends at one of the store's connectors, with the
// sheet labelling that door instead of the public "entrance not verified" wording. The private data is read at run time
// from GTEKI_PRIVATE_DIR only: nothing from it is written here, so CI and the public build skip this file.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseStationFiles, type Poi, type StationBundle, type Tenant } from "@gteki/schema";
import { createRouter, routeBetween, type RouteFailure, type RouteProfile, type RouteResult } from "@gteki/navigation";
import { createSearchIndex } from "@gteki/search";
import { pick, strings, type Lang } from "../i18n.ts";
import { isMapReadDoor } from "./merchantCard.ts";

vi.mock("../explorer/explorer.ts", () => ({ Explorer: class {} }));
vi.mock("../registry.ts", () => ({ listStations: vi.fn(), PRIVATE_BUILD: true, StationLoadError: class extends Error {} }));
import { App } from "./app.ts";

type Harness = {
  s: {
    lang: Lang; loaded: unknown; route: RouteResult | RouteFailure | null; origin: unknown;
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

const STATIONS = ["ikebukuro", "shinjuku"] as const;
const MIN_STORES = 15;
/**
 * Per station: map-read stores, and how many of them are searched by a brand from their own directory (the rest fall
 * back to the store name). Lowering either needs a reason in the PR: a lost directory must fail here, not pass by name.
 */
const MIN_BY_STATION: Record<(typeof STATIONS)[number], { stores: number; brandStores: number }> = {
  ikebukuro: { stores: 12, brandStores: 3 },
  shinjuku: { stores: 8, brandStores: 3 },
};
const PROFILE: RouteProfile = { fare: "ticketed", stepFree: false, hours: "warn_unknown" };

/**
 * Store ids whose check fails for real data reasons, not the harness: the id is written as its sha256 prefix, so no
 * private id reaches this file. Each entry needs a one-line reason beside it in the PR.
 */
const KNOWN_GAPS = new Set<string>([
  // (none yet)
]);
const gapKey = (storeId: string) => crypto.createHash("sha256").update(storeId).digest("hex").slice(0, 12);

/** The bundle the private build hands the explorer: the overlay's four contract files, tenants included. */
function bundleOf(dir: string): StationBundle {
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as unknown;
  const tenants = fs.existsSync(path.join(dir, "tenants.json")) ? read("tenants.json") : undefined;
  const parsed = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"), tenants, { privateTier: true });
  if (!parsed.ok || !parsed.bundle) throw new Error(parsed.issues.filter((i) => i.level === "error").map((i) => i.message).join("; "));
  return parsed.bundle;
}

/** A mounted app at the station, with `originId` already picked, the real search index and the private router. */
function app(bundle: StationBundle, originId: string) {
  const root = document.createElement("div");
  document.body.append(root);
  const a = new App(root) as unknown as Harness;
  a.s.lang = "ja";
  a.layout(); // Mounts the panel and binds the destination field's real input handler.
  const explorer = { connectorRoutePaths: () => new Map(), refitOverview: vi.fn(), clearRoute: vi.fn(), focusPoints: vi.fn(), showPois: vi.fn(), showRoute: vi.fn(), currentMode: "overview" };
  a.s.loaded = { bundle };
  a.s.search = createSearchIndex(bundle);
  a.s.router = createRouter(bundle, { allowUnverified: true });
  a.s.origin = { kind: "poi", poi: bundle.pois.find((p) => p.id === originId)! };
  a.stationReady = true;
  a.explorer = explorer;
  // Only the renders the pick would otherwise do are stubbed; search, the pick and the route card stay real.
  for (const name of ["renderIdentity", "renderCredit", "renderBanner", "renderSpawnChips", "renderProfile", "syncPanelMascot"] as const)
    vi.spyOn(a as unknown as Record<string, () => void>, name).mockImplementation(() => {});
  for (const name of ["releaseMascot", "mascotSay"] as const) vi.spyOn(a, name).mockImplementation(() => {});
  return { a, root };
}

/** The first ticket gate from which the router reaches the store, or null. */
function gateReaching(bundle: StationBundle, store: Poi): Poi | null {
  const router = createRouter(bundle, { allowUnverified: true });
  for (const gate of bundle.pois.filter((p) => p.category === "ticket_gate")) {
    const r = routeBetween(router, { kind: "poi", poi: gate }, store, PROFILE);
    if (r.ok) return gate;
  }
  return null;
}

/** Each store's brands from the directory (two at most), or its own Japanese name when it lists none. */
function queriesFor(bundle: StationBundle, store: Poi): { query: string; tenant: Tenant | null }[] {
  const brands = (bundle.tenants ?? []).filter((t) => t.poiId === store.id).slice(0, 2);
  if (brands.length === 0) return [{ query: pick(store.names, "ja"), tenant: null }];
  return brands.map((tenant) => ({ query: pick(tenant.names, "ja"), tenant }));
}

/**
 * One brand query end to end: type it, find the store's row, pick it, then check the route and the sheet.
 * Every check is a soft expectation named by the store id, so one store never hides another.
 */
function checkQuery(bundle: StationBundle, store: Poi, query: string, tenant: Tenant | null, origin: Poi, label: string): boolean {
  const t = strings("ja");
  const door = t.merchant.precision.door;
  const storeName = pick(store.names, "ja");
  const kind = tenant ? "brand" : "own name";
  let ok = true;
  const check = (cond: boolean, what: string) => {
    expect.soft(cond, `${label} (${kind}): ${what}`).toBe(true);
    if (!cond) ok = false;
    return cond;
  };
  const { a, root } = app(bundle, origin.id);
  if (!check(root.contains(a.ui.toInput), "mounted destination field")) return false;

  a.ui.toInput.value = query;
  a.ui.toInput.dispatchEvent(new Event("input"));
  const row = [...a.ui.toResults.querySelectorAll<HTMLElement>('[role="option"]')]
    .find((o) => o.querySelector(".result-name")?.textContent === storeName);
  if (!check(row !== undefined, "result list has a row for the store")) return false;
  if (!check(row!.textContent?.includes(door) === true, "row carries the door label")) return false;

  row!.click();
  if (!check(a.s.destination?.id === store.id, "picked destination is the store")) return false;
  if (tenant) check(a.s.destinationTenant?.id === tenant.id, "picked brand is the store's own listing");

  const route = a.s.route;
  if (!check(route?.ok === true, "route is ok")) return false;
  const last = route?.ok ? route.nodeIds[route.nodeIds.length - 1] : undefined;
  check(last !== undefined && store.connectorNodeIds.includes(last), "route ends at one of the store's connectors");

  const sheet = a.ui.sheet.textContent ?? "";
  check(a.ui.sheet.querySelector(".entrance-unverified")?.textContent === door, "sheet labels the map-read door");
  check(!sheet.includes(t.merchant.precision.search), "sheet has no shop-location-unconfirmed wording");
  check(!sheet.includes(t.shopSearchOnly), "sheet has no public not-verified wording");
  return ok;
}

describe.skipIf(!process.env.GTEKI_PRIVATE_DIR)("private build store flow (brand → store → map-read door)", () => {
  let tmp = "";
  const bundles = new Map<string, StationBundle>();

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-store-flow-"));
    fs.cpSync(path.join(process.env.GTEKI_PRIVATE_DIR!, "additions"), path.join(tmp, "additions"), { recursive: true });
    // A runtime path: the overlay builder lives outside this package's typecheck (as route-clip-audit.ts does).
    const overlayModule = pathToFileURL(path.resolve(import.meta.dirname, "../../../../tools/private-overlay/build-overlay.ts")).href;
    const { buildOverlay } = (await import(overlayModule)) as { buildOverlay: (o: { repoRoot: string; privateDir: string; stations?: string[] }) => string[] };
    const repoRoot = path.resolve(import.meta.dirname, "../../../..");
    for (const station of buildOverlay({ repoRoot, privateDir: tmp, stations: [...STATIONS] }))
      bundles.set(station, bundleOf(path.join(tmp, "overlay", station, "gteki")));
  });

  beforeEach(() => {
    // jsdom has no matchMedia; layout() reads the controls hint through it.
    vi.stubGlobal("matchMedia", () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });
  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  const storesOf = (bundle: StationBundle) => bundle.pois.filter((p) => p.category === "shop" && p.connectorNodeIds.length > 0 && isMapReadDoor(p));

  it("the private overlay has at least the expected number of map-read stores", () => {
    const total = STATIONS.reduce((n, id) => n + storesOf(bundles.get(id)!).length, 0);
    expect(total).toBeGreaterThanOrEqual(MIN_STORES);
  });

  for (const station of STATIONS) {
    it(`${station}: every map-read store is found by brand search, routed to its door and labelled`, () => {
      const bundle = bundles.get(station);
      expect(bundle, `${station} overlay built`).toBeDefined();
      let storesPassed = 0;
      let queriesPassed = 0;
      let queriesRun = 0;
      const stores = storesOf(bundle!);
      expect(stores.length, `${station}: map-read stores`).toBeGreaterThanOrEqual(MIN_BY_STATION[station].stores);
      const brandStores = stores.filter((store) => queriesFor(bundle!, store).some((q) => q.tenant !== null)).length;
      expect(brandStores, `${station}: stores searched by their own brands`).toBeGreaterThanOrEqual(MIN_BY_STATION[station].brandStores);
      let skipped = 0;
      for (const store of stores) {
        if (KNOWN_GAPS.has(gapKey(store.id))) { skipped++; continue; }
        const label = `store ${store.id}`;
        const origin = gateReaching(bundle!, store);
        expect.soft(origin !== null, `${label}: a ticket gate routes to the store`).toBe(true);
        if (!origin) continue;
        let storeOk = true;
        for (const { query, tenant } of queriesFor(bundle!, store)) {
          queriesRun++;
          let ok = false;
          try {
            ok = checkQuery(bundle!, store, query, tenant, origin, label);
          } catch (error) {
            expect.soft(error instanceof Error ? error.message : String(error), `${label}: flow threw`).toBe("no error");
          }
          if (ok) queriesPassed++;
          else storeOk = false;
        }
        if (storeOk) storesPassed++;
      }
      console.info(`${station}: ${storesPassed}/${stores.length - skipped} stores (${brandStores} by brand), ${queriesPassed}/${queriesRun} queries passed`);
      expect(storesPassed, `${station}: stores passing`).toBe(stores.length - skipped);
    });
  }
});
