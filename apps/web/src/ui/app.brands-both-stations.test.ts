// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseStationFiles, type StationBundle } from "@gteki/schema";
import { createSearchIndex } from "@gteki/search";
import { createRouter } from "@gteki/navigation";
import type { LoadedStation, StationEntry } from "../registry.ts";
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
    lang: Lang; entries: StationEntry[]; entry: StationEntry; loaded: LoadedStation;
    search: ReturnType<typeof createSearchIndex>; router: ReturnType<typeof createRouter>;
    filter: "shop" | "toilet" | null; destination: { id: string } | null; destinationTenant: { id: string } | null;
  };
  ui: { fromInput: HTMLInputElement; fromResults: HTMLElement; toInput: HTMLInputElement; toResults: HTMLElement };
  combo: { to: { count: number } };
  stationReady: boolean;
  layout(): void;
  openStation(entry: StationEntry, fromId: null, toId: string): Promise<void>;
  explorer: unknown;
};

function bundleOf(manifest: unknown, graph: unknown, pois: unknown, tenants: unknown): StationBundle {
  const parsed = parseStationFiles(manifest, graph, pois, tenants);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.bundle;
}
const bundles = {
  ikebukuro: bundleOf(ikbStation, ikbGraph, ikbPois, ikbTenants),
  shinjuku: bundleOf(sjkStation, sjkGraph, sjkPois, sjkTenants),
};
const brands = ["ユニクロ", "スターバックス", "アンタイトル"];
function mounted(key: keyof typeof bundles) {
  const entries: StationEntry[] = Object.entries(bundles).map(([key, bundle]) => ({
    key, label: key === "ikebukuro" ? "池袋" : "新宿", synthetic: false,
    loadDirectory: vi.fn(async () => bundle),
    load: vi.fn(async () => ({ key, bundle, scene: null, sceneImportError: null, issues: [], assetUrls: new Map() })),
  }));
  const root = document.createElement("div");
  document.body.append(root);
  const a = new App(root) as unknown as Harness;
  a.s.lang = "ja";
  a.s.entries = entries;
  a.s.entry = entries.find((entry) => entry.key === key)!;
  a.layout();
  a.s.loaded = { key, bundle: bundles[key], scene: null, sceneImportError: null, issues: [], assetUrls: new Map() };
  a.s.search = createSearchIndex(bundles[key]);
  a.s.router = createRouter(bundles[key]);
  a.stationReady = true;
  a.explorer = {
    getPose: () => ({ mode: "overview" }), cancelPendingLoad: vi.fn(), loadStation: vi.fn(async () => true),
    connectorRoutePaths: () => new Map(), refitOverview: vi.fn(), clearRoute: vi.fn(), showPois: vi.fn(), currentMode: "overview",
  };
  for (const name of ["renderIdentity", "renderCredit", "renderBanner", "renderSpawnChips", "renderProfile", "syncPanelMascot", "releaseMascot", "mascotSay"])
    vi.spyOn(a as unknown as Record<string, () => void>, name).mockImplementation(() => {});
  return { a, entries };
}
function type(input: HTMLInputElement, query: string) {
  input.value = query;
  input.dispatchEvent(new Event("input"));
}
const options = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>('[role="option"]')];

describe("public brand search across stations", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it.each(["ikebukuro", "shinjuku"] as const)("%s lists its own stores first for three shared brands", async (key) => {
    const { a, entries } = mounted(key);
    const other = entries.find((entry) => entry.key !== key)!;
    type(a.ui.toInput, brands[0]!);
    expect(a.ui.toResults.querySelector('[data-station]')).toBeNull();
    a.ui.toInput.focus();
    await vi.waitFor(() => expect(a.ui.toResults.querySelector('[data-station]')).not.toBeNull());
    for (const brand of brands) {
      type(a.ui.toInput, brand);
      const own = createSearchIndex(bundles[key]).search(brand, { limit: 8, lang: "ja" });
      const foreign = createSearchIndex(bundles[other.key as keyof typeof bundles]).search(brand, { limit: 9999, lang: "ja" })
        .filter((hit) => hit.tenant).slice(0, 3);
      expect(own.length).toBeGreaterThan(0);
      expect(foreign.length).toBeGreaterThan(0);
      const rows = options(a.ui.toResults);
      expect(rows.slice(0, own.length).every((row) => !row.dataset.station)).toBe(true);
      const others = rows.slice(own.length);
      expect(others.length).toBeLessThanOrEqual(3);
      expect(others.map((row) => row.dataset.station)).toEqual(foreign.map(() => other.key));
      const header = a.ui.toResults.querySelector('.result-group')!;
      expect(header.textContent).toBe(`${other.label}にもあります`);
      expect(header.getAttribute("role")).toBe("presentation");
      expect(rows[own.length - 1]!.nextElementSibling).toBe(header);
      expect(header.nextElementSibling).toBe(others[0]);
      foreign.forEach((hit, i) => {
        expect(others[i]!.querySelector(".result-name")?.textContent).toBe(hit.poi.names.find((n) => n.lang === "ja")?.text);
        expect(others[i]!.querySelector(".result-meta")?.textContent).toContain(hit.tenant!.floorLabel);
        expect(others[i]!.querySelector(".result-meta")?.textContent).toContain(hit.tenant!.name);
        const tenant = bundles[other.key as keyof typeof bundles].tenants!.find((tenant) => tenant.id === hit.tenant!.id)!;
        expect(others[i]!.querySelector(".result-asof")?.textContent).toBe(`店舗情報（${tenant.evidence.checkedDate} 時点・未確認）`);
      });
      expect(a.combo.to.count).toBe(rows.length);
      rows.forEach((row, i) => expect(row.id).toBe(`gteki-to-listbox-opt-${i}`));
      a.ui.toInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
      expect(a.ui.toInput.getAttribute("aria-activedescendant")).toBe(rows.at(-1)!.id);
      type(a.ui.fromInput, brand);
      expect(a.ui.fromResults.querySelector('[data-station], .result-group')).toBeNull();
    }
    a.ui.toInput.blur();
    a.ui.toInput.focus();
    expect(other.loadDirectory).toHaveBeenCalledTimes(1);
    expect(other.load).not.toHaveBeenCalled();
    a.s.filter = "toilet";
    type(a.ui.toInput, brands[0]!);
    expect(a.ui.toResults.querySelector('[data-station]')).toBeNull();
    a.s.filter = null;
    a.s.lang = "en";
    type(a.ui.toInput, brands[0]!);
    expect(a.ui.toResults.querySelector('.result-group')?.textContent).toBe(`Also at ${other.label}`);
  });

  it("keeps the second local keyboard choice when a matching directory arrives", async () => {
    const { a, entries } = mounted("ikebukuro");
    let resolve!: (bundle: StationBundle) => void;
    const pending = new Promise<StationBundle>((done) => { resolve = done; });
    vi.spyOn(entries[1]!, "loadDirectory").mockReturnValue(pending);
    a.ui.toInput.focus();
    type(a.ui.toInput, "スターバックス");
    const local = createSearchIndex(bundles.ikebukuro).search("スターバックス", { limit: 8, lang: "ja" });
    expect(local.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < 2; i++) a.ui.toInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(a.ui.toInput.getAttribute("aria-activedescendant")).toBe(options(a.ui.toResults)[1]!.id);
    resolve(bundles.shinjuku);
    await vi.waitFor(() => expect(a.ui.toResults.querySelector('[data-station="shinjuku"]')).not.toBeNull());
    expect(a.ui.toInput.getAttribute("aria-activedescendant")).toBe(options(a.ui.toResults)[1]!.id);
    a.ui.toInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(a.s.destination?.id).toBe(local[1]!.poi.id);
    expect(a.s.entry.key).toBe("ikebukuro");
  });

  it.each(["", "トイレ"])("does not rebuild for query '%s' when a directory adds no brand rows", async (query) => {
    const { a, entries } = mounted("ikebukuro");
    let resolve!: (bundle: StationBundle) => void;
    const pending = new Promise<StationBundle>((done) => { resolve = done; });
    vi.spyOn(entries[1]!, "loadDirectory").mockReturnValue(pending);
    a.s.filter = "toilet";
    a.ui.toInput.focus();
    type(a.ui.toInput, query);
    const first = options(a.ui.toResults)[0]!;
    expect(first).toBeDefined();
    a.ui.toInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    const active = a.ui.toInput.getAttribute("aria-activedescendant");
    resolve(bundles.shinjuku);
    await pending;
    expect(options(a.ui.toResults)[0]).toBe(first);
    expect(a.ui.toInput.getAttribute("aria-activedescendant")).toBe(active);
    expect(a.ui.toResults.querySelector('[data-station]')).toBeNull();
  });

  it("names the other station in each foreign option's accessible label", async () => {
    const { a, entries } = mounted("ikebukuro");
    const other = entries.find((entry) => entry.key === "shinjuku")!;
    a.ui.toInput.focus();
    type(a.ui.toInput, "ユニクロ");
    await vi.waitFor(() => expect(a.ui.toResults.querySelector('[data-station="shinjuku"]')).not.toBeNull());
    for (const row of a.ui.toResults.querySelectorAll('[data-station="shinjuku"]'))
      expect(row.getAttribute("aria-label")).toContain(`${other.label}にもあります`);
  });

  it("selecting a Shinjuku store opens it as the destination and keeps the brand", async () => {
    const { a, entries } = mounted("ikebukuro");
    a.ui.toInput.focus();
    type(a.ui.toInput, "アンタイトル");
    await vi.waitFor(() => expect(a.ui.toResults.querySelector('[data-station="shinjuku"]')).not.toBeNull());
    const hit = createSearchIndex(bundles.shinjuku).search("アンタイトル", { limit: 9999, lang: "ja" }).find((hit) => hit.tenant)!;
    const open = vi.spyOn(a, "openStation");
    a.ui.toInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    // Click the first other-station row through the mounted result handler.
    a.ui.toResults.querySelector<HTMLElement>('[data-station="shinjuku"]')!.click();
    await vi.waitFor(() => expect(a.s.destinationTenant?.id).toBe(hit.tenant!.id));
    expect(open).toHaveBeenCalledWith(entries[1], null, hit.poi.id);
    expect(a.s.entry.key).toBe("shinjuku");
    expect(a.s.destination?.id).toBe(hit.poi.id);
    expect(a.ui.toInput.value).toContain("アンタイトル");
  });

  it("silently skips a failed directory and synthetic entries without retrying", async () => {
    const { a, entries } = mounted("ikebukuro");
    const load = vi.spyOn(entries[1]!, "loadDirectory").mockRejectedValue(new Error("unreadable"));
    const synthetic = { ...entries[1]!, key: "demo", synthetic: true, loadDirectory: vi.fn() };
    entries.push(synthetic);
    a.ui.toInput.focus();
    type(a.ui.toInput, brands[0]!);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    a.ui.toInput.blur();
    a.ui.toInput.focus();
    expect(a.ui.toResults.querySelector('[data-station]')).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    expect(synthetic.loadDirectory).not.toHaveBeenCalled();
  });
});
