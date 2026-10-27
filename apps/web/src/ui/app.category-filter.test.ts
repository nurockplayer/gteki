// #213: a query with no match in the filtered category says how many the other categories have, and that row
// drops the filter and shows them. On the Shinjuku files as the web build ships them.
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { parseStationFiles, type StationBundle } from "@gteki/schema";
import { createSearchIndex } from "@gteki/search";
import sjkStation from "../../../../stations/shinjuku/gteki/station.json" with { type: "json" };
import sjkGraph from "../../../../stations/shinjuku/gteki/graph.json" with { type: "json" };
import sjkPois from "../../../../stations/shinjuku/gteki/pois.json" with { type: "json" };

vi.mock("../explorer/explorer.ts", () => ({ Explorer: class {} }));
vi.mock("../registry.ts", () => ({ listStations: vi.fn(), PRIVATE_BUILD: false, StationLoadError: class extends Error {} }));
import { App } from "./app.ts";

type Harness = {
  s: { lang: "ja"; loaded: unknown; search?: unknown; filter: string | null; entry: unknown };
  ui: { toInput: HTMLInputElement; toResults: HTMLElement; categoryFilter: HTMLSelectElement };
  layout: () => void;
  mascotSay: () => void;
};

function bundle(): StationBundle {
  const parsed = parseStationFiles(sjkStation, sjkGraph, sjkPois);
  if (!parsed.ok || !parsed.bundle) throw new Error("shinjuku bundle");
  return parsed.bundle;
}

function type(a: Harness, q: string) {
  a.ui.toInput.value = q;
  a.ui.toInput.dispatchEvent(new Event("input"));
  return [...a.ui.toResults.querySelectorAll<HTMLElement>('[role="option"]')];
}

describe("category filter with no hits in its category", () => {
  // jsdom has no matchMedia; layout() reads the controls hint through it.
  vi.stubGlobal("matchMedia", () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {} }));
  const b = bundle();
  const root = document.createElement("div");
  document.body.append(root);
  const a = new App(root) as unknown as Harness;
  a.s.lang = "ja";
  a.layout();
  a.s.loaded = { bundle: b };
  a.s.search = createSearchIndex(b);
  a.s.entry = { key: "shinjuku" };
  vi.spyOn(a, "mascotSay").mockImplementation(() => {});

  it("offers the other categories' hits and drops the filter on pick", () => {
    const unfiltered = type(a, "トイレ").length;
    expect(unfiltered, "トイレ matches toilets").toBeGreaterThan(0);
    a.s.filter = "shop";
    const options = type(a, "トイレ");
    expect(options).toHaveLength(1);
    expect(options[0]!.textContent).toBe(`他の種類に ${unfiltered === 8 ? "8+" : unfiltered} 件：すべての種類で探す`);
    expect(a.ui.toResults.querySelector(".result.empty")?.textContent).toBe("該当なし");
    options[0]!.click();
    expect(a.s.filter).toBeNull();
    expect(a.ui.categoryFilter.value).toBe("");
    expect(a.ui.toResults.querySelectorAll('[role="option"]')).toHaveLength(unfiltered);
  });

  it("keeps the plain empty row when no category matches", () => {
    a.s.filter = "shop";
    const options = type(a, "zzzzqqq");
    expect(options).toHaveLength(1);
    expect(options[0]!.getAttribute("aria-disabled")).toBe("true");
    expect(options[0]!.textContent).toBe("該当なし");
  });
});
