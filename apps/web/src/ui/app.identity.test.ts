// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSyntheticBundle } from "../../../../packages/navigation/src/fixtures.ts";
import type { LoadedStation, StationEntry } from "../registry.ts";
import { LiveRegion } from "./live.ts";
import { StationIdentityView } from "./identityCard.ts";

vi.mock("../explorer/explorer.ts", () => ({ Explorer: class {} }));
vi.mock("../registry.ts", () => ({ listStations: vi.fn(), PRIVATE_BUILD: false, StationLoadError: class extends Error {} }));
import { App } from "./app.ts";

type Harness = {
  explorer: { currentMode: string; sceneError: null; cancelPendingLoad: () => void; loadStation: (s: LoadedStation) => Promise<boolean>; getPose: () => null };
  identityView: StationIdentityView;
  ui: { sheet: HTMLElement };
  openStation: (e: StationEntry) => Promise<void>;
  onMode: (mode: "overview" | "walk" | "guide") => void;
  renderIdentity: (mode?: string) => void;
  renderCredit: () => void;
  renderSpawnChips: () => void;
  renderHud: () => void;
  refreshAll: () => void;
  updateUrl: () => void;
};
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function loaded(key: string): LoadedStation {
  const bundle = createSyntheticBundle([]);
  bundle.station.identity = { names: [{ lang: "ja", text: key }, { lang: "en", text: `${key}-en` }] };
  return { key, bundle, issues: [], scene: null, sceneImportError: null, assetUrls: new Map() };
}
function entry(key: string, promise: Promise<LoadedStation>): StationEntry {
  return { key, label: key, synthetic: true, identity: loaded(key).bundle.station.identity, load: () => promise };
}
function app() {
  const root = document.createElement("div"); document.body.append(root);
  const a = new App(root) as unknown as Harness;
  a.explorer = { currentMode: "overview", sceneError: null, cancelPendingLoad: vi.fn(), loadStation: vi.fn(async () => true), getPose: () => null };
  for (const name of ["renderCredit", "renderSpawnChips", "renderHud", "updateUrl"] as const) vi.spyOn(a, name).mockImplementation(() => {});
  vi.spyOn(a, "refreshAll").mockImplementation(() => a.renderIdentity());
  root.append(a.identityView.card, a.identityView.overview, a.ui.sheet);
  return { a, root };
}
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe("App station identity lifecycle", () => {
  it("holds the card through scene readiness and announces loading once", async () => {
    const { a } = app(); const scene = deferred<boolean>(); const data = deferred<LoadedStation>();
    a.explorer.loadStation = vi.fn(() => scene.promise);
    const announce = vi.spyOn(LiveRegion.prototype, "announce");
    const opening = a.openStation(entry("池袋", data.promise));
    expect(a.identityView.info().card).toMatchObject({ visible: true, ja: "池袋" });
    data.resolve(loaded("池袋")); await Promise.resolve();
    expect(a.identityView.info().card?.visible).toBe(true);
    expect(announce.mock.calls.filter(([s]) => s.includes("Loading") || s.includes("読み込み中")).length).toBe(1);
    scene.resolve(true); await opening;
    expect(a.identityView.info().card?.visible).toBe(false);
    expect(a.identityView.info().overview?.visible).toBe(true);
    a.onMode("walk"); expect(a.identityView.overview.hidden).toBe(true);
    a.onMode("guide"); expect(a.identityView.overview.hidden).toBe(true);
    a.onMode("overview"); expect(a.identityView.overview.hidden).toBe(false);
  });
  it("ignores superseded data success and failure without hiding the current card", async () => {
    for (const failure of [false, true]) {
      const { a } = app(); const old = deferred<LoadedStation>(); const next = deferred<LoadedStation>();
      const first = a.openStation(entry("old", old.promise));
      const second = a.openStation(entry("next", next.promise));
      if (failure) old.reject(new Error("old failure")); else old.resolve(loaded("old"));
      await first;
      expect(a.identityView.info().card).toMatchObject({ visible: true, ja: "next" });
      next.resolve(loaded("next")); await second;
      expect(a.identityView.info().card).toMatchObject({ visible: false, ja: "next" });
      expect(a.identityView.overview.textContent).toContain("next-en");
    }
  });
  it("ignores a superseded scene completion", async () => {
    const { a } = app(); const oldScene = deferred<boolean>(); const nextScene = deferred<boolean>();
    a.explorer.loadStation = vi.fn((s) => s.key === "old" ? oldScene.promise : nextScene.promise);
    const first = a.openStation(entry("old", Promise.resolve(loaded("old")))); await Promise.resolve();
    const second = a.openStation(entry("next", Promise.resolve(loaded("next")))); await Promise.resolve();
    oldScene.resolve(true); await first;
    expect(a.identityView.info().card).toMatchObject({ visible: true, ja: "next" });
    nextScene.resolve(true); await second;
    expect(a.identityView.info().card?.visible).toBe(false);
  });
  it("replaces the current failed load with the existing error UI", async () => {
    const { a } = app();
    await a.openStation(entry("broken", Promise.reject(new Error("missing station"))));
    expect(a.identityView.info().card?.visible).toBe(false);
    expect(a.identityView.overview.hidden).toBe(true);
    expect(a.ui.sheet.querySelector(".error")?.textContent).toContain("missing station");
  });
});
