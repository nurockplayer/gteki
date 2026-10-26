// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Poi } from "@gteki/schema";
import { createSearchIndex } from "@gteki/search";
import { createSyntheticBundle } from "../../../../packages/navigation/src/fixtures.ts";
import { strings, type Lang } from "../i18n.ts";

vi.mock("../explorer/explorer.ts", () => ({ Explorer: class {} }));
vi.mock("../registry.ts", () => ({ listStations: vi.fn(), PRIVATE_BUILD: false, StationLoadError: class extends Error {} }));
import { App } from "./app.ts";

type Harness = {
  s: { lang: Lang; loaded: unknown; route: unknown; noPath: null; origin: unknown; destination: Poi | null; search?: unknown };
  ui: { sheet: HTMLElement; fromNote: HTMLElement; toNote: HTMLElement; fromInput: HTMLInputElement; toInput: HTMLInputElement; fromResults: HTMLElement; toResults: HTMLElement };
  stationReady: boolean;
  renderEndpointNote: (box: HTMLElement, poi: Poi | null) => void;
  renderResults: (which: "from" | "to") => void;
  renderSheet: () => void;
  releaseMascot: () => void;
  mascotSay: () => void;
  openStation: (e: { key: string; label: string; synthetic: boolean; load: () => Promise<never> }) => Promise<void>;
  explorer: unknown;
  field: (which: "from" | "to", input: HTMLInputElement, results: HTMLElement, note: HTMLElement) => HTMLElement;
};

const NOTE_JA = "2020年3月時点の名称。現在の状況は不明";
const NOTE_EN = "Name as of March 2020; current status unknown";
function poi(id: string, routable: boolean, notes = [{ lang: "ja", text: NOTE_JA }, { lang: "en", text: NOTE_EN }]): Poi {
  return {
    id, category: "ticket_gate", names: [{ lang: "ja", text: "京王新線口（出口専用）" }], aliases: [], floorId: null,
    displayPosition: null, connectorNodeIds: routable ? ["a"] : [], paid: null,
    evidence: { sourceIds: [], method: "test", checkedDate: "2026-10-24" }, notes,
  } as Poi;
}
function app(lang: Lang = "ja") {
  const root = document.createElement("div"); document.body.append(root);
  const a = new App(root) as unknown as Harness;
  a.s.lang = lang;
  a.s.loaded = { bundle: createSyntheticBundle([]) };
  // renderSheet refits an automatic overview after the sheet opens or closes (#385); the real App always has one.
  a.explorer = { refitOverview: vi.fn() } as unknown;
  for (const name of ["releaseMascot", "mascotSay"] as const) vi.spyOn(a, name).mockImplementation(() => {});
  return a;
}
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe("search-only POI notes outside a route", () => {
  it("shows a picked search-only endpoint's note under its field, in the UI language, and hides it otherwise", () => {
    const a = app("en");
    a.renderEndpointNote(a.ui.toNote, poi("p1", false));
    expect(a.ui.toNote.hidden).toBe(false);
    expect(a.ui.toNote.textContent).toBe(NOTE_EN);
    a.renderEndpointNote(a.ui.toNote, poi("p2", false, [{ lang: "ja", text: NOTE_JA }]));
    expect(a.ui.toNote.textContent).toBe(NOTE_JA);
    a.renderEndpointNote(a.ui.toNote, poi("p3", true));
    expect(a.ui.toNote.hidden).toBe(true);
    a.renderEndpointNote(a.ui.toNote, null);
    expect(a.ui.toNote.hidden).toBe(true);
    expect(a.ui.toNote.textContent).toBe("");
  });

  it("describes each field with its note element", () => {
    const a = app();
    for (const which of ["from", "to"] as const) {
      const input = which === "from" ? a.ui.fromInput : a.ui.toInput;
      const note = which === "from" ? a.ui.fromNote : a.ui.toNote;
      const row = a.field(which, input, which === "from" ? a.ui.fromResults : a.ui.toResults, note);
      expect(row.contains(note)).toBe(true);
      expect(note.hidden).toBe(true);
      expect(note.id).toBe(`gteki-${which}-note`);
      expect(input.getAttribute("aria-describedby")).toBe(note.id);
    }
  });

  it.each([
    ["unknown_goal", "destination"],
    ["unknown_start", "origin"],
  ] as const)("adds the %s endpoint's note to the failed route card", (reason, side) => {
    const a = app();
    const p = poi("p1", false);
    if (side === "destination") a.s.destination = p; else a.s.origin = { kind: "poi", poi: p };
    a.s.route = { ok: false, reason, message: "" };
    a.renderSheet();
    const card = a.ui.sheet.querySelector(".no-route");
    expect(card?.textContent).toContain(NOTE_JA);
  });

  it("clears a previous station's endpoint notes as soon as another station starts loading, even if it fails", async () => {
    const a = app();
    a.explorer = { currentMode: "overview", sceneError: null, cancelPendingLoad: vi.fn(), loadStation: vi.fn(async () => true) };
    for (const name of ["renderCredit", "renderSpawnChips", "renderHud", "updateUrl"] as const)
      vi.spyOn(a as unknown as Record<string, () => void>, name).mockImplementation(() => {});
    a.renderEndpointNote(a.ui.fromNote, poi("p1", false));
    a.renderEndpointNote(a.ui.toNote, poi("p2", false));
    const opening = a.openStation({ key: "next", label: "next", synthetic: true, load: () => Promise.reject(new Error("missing station")) });
    expect(a.ui.fromNote.hidden).toBe(true);
    expect(a.ui.toNote.hidden).toBe(true);
    await opening;
    expect(a.ui.toNote.textContent).toBe("");
  });

  it("adds no note for other failures", () => {
    const a = app();
    a.s.destination = poi("p1", false);
    a.s.route = { ok: false, reason: "no_path", message: "" };
    a.renderSheet();
    expect(a.ui.sheet.textContent).not.toContain(NOTE_JA);
  });
});

describe("approximate positions are search display only (#463)", () => {
  const approximate = { east: 12, north: -4, uncertaintyM: 24.2, method: "area_weighted_centroid", navigationUse: "NOT_FOR_ROUTING", floor: "UNVERIFIED" } as const;

  it("shows the ± radius rounded up, in the UI language, under a picked endpoint", () => {
    const a = app("en");
    a.renderEndpointNote(a.ui.toNote, { ...poi("p1", false, []), approximatePosition: approximate });
    expect(a.ui.toNote.hidden).toBe(false);
    expect(a.ui.toNote.textContent).toBe("Approximate position (±25 m) · not used for directions");

    const ja = app("ja");
    ja.renderEndpointNote(ja.ui.fromNote, { ...poi("p2", false, []), approximatePosition: approximate });
    expect(ja.ui.fromNote.textContent).toBe("おおよその位置（±25 m）・経路案内には使いません");
  });

  it("keeps the station note and the approximate line together", () => {
    const a = app();
    a.renderEndpointNote(a.ui.fromNote, { ...poi("p3", false), approximatePosition: approximate });
    expect(a.ui.fromNote.textContent).toBe(`${NOTE_JA} · おおよその位置（±25 m）・経路案内には使いません`);
  });

  it("names the approximate radius the same way in both languages", () => {
    expect(strings("ja").approximatePosition(25)).toBe("おおよその位置（±25 m）・経路案内には使いません");
    expect(strings("en").approximatePosition(25)).toBe("Approximate position (±25 m) · not used for directions");
  });
});

describe("approximate positions in search results (#463)", () => {
  const approximate = { east: 12, north: -4, uncertaintyM: 24.2, method: "area_weighted_centroid", navigationUse: "NOT_FOR_ROUTING", floor: "UNVERIFIED" } as const;
  const LINE = "おおよその位置（±25 m）・経路案内には使いません";

  /** The synthetic bundle plus one searchable POI that has only an approximate, search-display point. */
  function searchable() {
    const bundle = createSyntheticBundle();
    bundle.pois.push({
      id: "approx-shop", category: "shop",
      names: [{ lang: "ja", text: "おおよそ商店" }, { lang: "en", text: "Approximate Shop" }],
      aliases: [], floorId: "concourse", displayPosition: null, approximatePosition: approximate,
      connectorNodeIds: [], paid: null,
      evidence: { sourceIds: ["fixture-geometry"], method: "synthetic-fixture", checkedDate: "2026-10-20" },
    });
    return bundle;
  }

  it("shows the approximate line and the unverified floor in the row and its accessible name", () => {
    const a = app();
    const bundle = searchable();
    a.s.loaded = { bundle };
    a.s.search = createSearchIndex(bundle);
    a.ui.toInput.value = "おおよそ";
    a.renderResults("to");
    const option = a.ui.toResults.querySelector('[role="option"]')!;
    expect(option.querySelector(".result-approx")?.textContent).toBe(LINE);
    expect(option.querySelector(".result-meta")?.textContent).toContain("B1（階は未確認）");
    const label = option.getAttribute("aria-label") ?? "";
    expect(label).toContain(LINE);
    expect(label).toContain("B1（階は未確認）");
  });

  it("keeps the warning under the picked endpoint's field", () => {
    const a = app();
    const bundle = searchable();
    a.s.loaded = { bundle };
    a.s.search = createSearchIndex(bundle);
    a.stationReady = true;
    a.explorer = { showPois: vi.fn() };
    // Only the parts the pick triggers after the field note are stubbed; renderEndpointNote runs for real.
    for (const name of ["updatePanelCollapse", "renderIdentity", "renderCredit", "renderBanner", "renderSpawnChips", "renderProfile", "computeRoute", "syncPanelMascot"] as const)
      vi.spyOn(a as unknown as Record<string, () => void>, name).mockImplementation(() => {});
    a.ui.toInput.value = "おおよそ";
    a.renderResults("to");
    (a.ui.toResults.querySelector('[role="option"]') as HTMLElement).click();
    expect(a.s.destination?.id).toBe("approx-shop");
    expect(a.ui.toNote.hidden).toBe(false);
    expect(a.ui.toNote.textContent).toContain("B1（階は未確認）");
    expect(a.ui.toNote.textContent).toContain(LINE);
  });
});

describe("printed shop hours on the destination card (OD-32)", () => {
  const HOURS = {
    text: "月～土 10:00～21:00\n日・祝 10:00～19:30", sourceUrl: "https://example.org/shop",
    retrievedAt: "2026-10-24", basis: "undated-official", status: "OK",
  } as const;

  /** A search-only shop (no verified entrance) whose page printed hours: the case OD-32 imports. */
  function shop(over: Partial<Poi> = {}): Poi {
    return { ...poi("p1", false), hours: HOURS, ...over };
  }

  function cardAt(a: Harness, when: string): HTMLElement {
    vi.setSystemTime(new Date(`${when}T00:00:00Z`));
    a.s.destination = shop();
    a.s.route = { ok: false, reason: "unknown_goal", message: "" };
    a.renderSheet();
    return a.ui.sheet;
  }

  it("shows the page's wording and the date it was read, then hides it once the reading is over 180 days old", () => {
    vi.useFakeTimers();
    try {
      const fresh = cardAt(app("ja"), "2026-10-24");
      expect(fresh.querySelector(".poi-hours")?.textContent).toContain(HOURS.text);
      expect(fresh.querySelector(".hours-asof")?.textContent).toBe("GT-Eki 確認日 2026-10-24 時点の公式表記");
      // 180 days later it is still shown; 181 days later it is not.
      expect(cardAt(app("ja"), "2027-04-22").querySelector(".poi-hours")).not.toBeNull();
      expect(cardAt(app("ja"), "2027-04-23").querySelector(".poi-hours")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides hours the page never printed", () => {
    const a = app();
    a.s.destination = shop({ hours: { ...HOURS, status: "UNKNOWN" } });
    a.s.route = { ok: false, reason: "unknown_goal", message: "" };
    a.renderSheet();
    expect(a.ui.sheet.querySelector(".poi-hours")).toBeNull();
  });
});
