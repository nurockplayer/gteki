// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Poi } from "@gteki/schema";
import { createSyntheticBundle } from "../../../../packages/navigation/src/fixtures.ts";
import type { Lang } from "../i18n.ts";

vi.mock("../explorer/explorer.ts", () => ({ Explorer: class {} }));
vi.mock("../registry.ts", () => ({ listStations: vi.fn(), StationLoadError: class extends Error {} }));
import { App } from "./app.ts";

type Harness = {
  s: { lang: Lang; loaded: unknown; route: unknown; noPath: null; origin: unknown; destination: Poi | null };
  ui: { sheet: HTMLElement; fromNote: HTMLElement; toNote: HTMLElement; fromInput: HTMLInputElement; toInput: HTMLInputElement; fromResults: HTMLElement; toResults: HTMLElement };
  renderEndpointNote: (box: HTMLElement, poi: Poi | null) => void;
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
