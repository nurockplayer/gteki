// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";
import type { ExplorerPose } from "../explorer/explorer.ts";
import { Minimap } from "./minimap.ts";

describe("Minimap HUD", () => {
  let pose: ExplorerPose | null;
  const maps: Minimap[] = [];
  function create() {
    const map = new Minimap(() => pose);
    maps.push(map);
    document.body.append(map.el);
    map.setStation(createSyntheticBundle(), "en");
    return map;
  }
  const tick = () => vi.advanceTimersByTime(90);

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    pose = { east: 0, north: 0, up: 0, headingDeg: 90, mode: "walk" };
  });
  afterEach(() => {
    for (const map of maps.splice(0)) map.dispose();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("defaults to player-up and persists the north-up toggle across instances without changing pose", () => {
    const map = create();
    const toggle = map.el.querySelector<HTMLButtonElement>(".minimap-orientation")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(map.el.querySelector(".minimap-arrow")?.getAttribute("transform")).toContain("rotate(0)");
    expect(map.el.querySelector(".minimap-graph")?.getAttribute("transform")).toContain("rotate(-90)");
    const before = { ...pose };
    toggle.click();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("gteki.minimap.orientation")).toBe("north-up");
    expect(pose).toEqual(before);
    expect(map.el.querySelector(".minimap-arrow")?.getAttribute("transform")).toContain("rotate(90)");
    expect(create().el.querySelector(".minimap-orientation")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("clears the old graph and player on station unload/switch and does not retain paths from another floor", () => {
    const map = create();
    expect(map.el.querySelectorAll("polyline")).toHaveLength(3);
    map.setStation(null, "en");
    expect(map.el.hidden).toBe(true);
    expect(map.el.querySelectorAll("polyline")).toHaveLength(0);
    expect(map.el.querySelector<SVGElement>(".minimap-arrow")!.style.display).toBe("none");
    const bundle = createSyntheticBundle([syntheticEdge("new", "start", "b")]);
    bundle.station.id = "new-station";
    map.setStation(bundle, "en");
    expect(map.el.querySelectorAll("polyline")).toHaveLength(1);
    expect(map.el.querySelector("polyline")?.getAttribute("points")).toBe("0,0 0,-20");
    expect(map.el.textContent).toContain("new-station");
    pose = { ...pose!, east: 10, up: 4 };
    tick();
    expect(map.el.querySelectorAll("polyline")).toHaveLength(0);
    expect(map.el.querySelector(".minimap-label")?.textContent).toContain("1F");
  });

  it("shows an unknown-floor notice with no graph or player marker", () => {
    const map = create();
    pose = { ...pose!, up: 100 };
    tick();
    expect(map.el.textContent).toContain("Floor unknown");
    expect(map.el.textContent).toContain("Schematic walk graph (not a floor plan)");
    expect(map.el.querySelectorAll("polyline")).toHaveLength(0);
    expect(map.el.querySelector<SVGElement>(".minimap-arrow")!.style.display).toBe("none");
    map.setLang("ja");
    expect(map.el.textContent).toContain("階不明");
    expect(map.el.textContent).toContain("概略歩行経路（実際の構内図ではありません）");
  });

  it("makes no DOM writes for an unchanged pose and preserves paths during movement and orientation changes", () => {
    const map = create();
    const graph = map.el.querySelector(".minimap-graph")!;
    const path = graph.firstChild;
    const observer = new MutationObserver(() => {});
    observer.observe(map.el, { subtree: true, attributes: true, childList: true, characterData: true });
    tick();
    expect(observer.takeRecords()).toHaveLength(0);
    pose = { ...pose!, east: 2, north: 3 };
    tick();
    expect(graph.firstChild).toBe(path);
    expect(graph.getAttribute("transform")).toContain("translate(-4 6)");
    map.el.querySelector<HTMLButtonElement>(".minimap-orientation")!.click();
    expect(graph.firstChild).toBe(path);
    observer.disconnect();
  });

  it("hides null/overview poses and returns for walking or guided mode", () => {
    const map = create();
    pose = null; tick(); expect(map.el.hidden).toBe(true);
    pose = { east: 0, north: 0, up: 0, headingDeg: 0, mode: "overview" };
    tick(); expect(map.el.hidden).toBe(true);
    pose.mode = "guide";
    tick(); expect(map.el.hidden).toBe(false);
  });

  it("brings a collapsed map back on a mode change without relying on its stopped timer (#220)", () => {
    // The repro: collapse, reload (overview), then enter walk mode. The timer is gone, so only the mode
    // change can re-show the section that holds the reopen button.
    pose = { east: 0, north: 0, up: 0, headingDeg: 0, mode: "overview" };
    const map = create();
    map.collapse();
    expect(vi.getTimerCount()).toBe(0);
    expect(map.el.hidden).toBe(true);
    pose = { ...pose!, mode: "walk" };
    map.syncVisibility();
    expect(map.el.hidden).toBe(false);
    expect(map.el.querySelector<HTMLElement>(".minimap-body")!.hidden).toBe(true);
    expect(map.el.querySelector<HTMLElement>(".minimap-reopen")!.hidden).toBe(false);
  });

  it("stops its interval while collapsed or hidden, restarts on reopen/visible, and disposes it", () => {
    const map = create();
    expect(vi.getTimerCount()).toBe(1);
    map.el.querySelector<HTMLButtonElement>(".minimap-collapse")!.click();
    expect(vi.getTimerCount()).toBe(0);
    expect(map.el.querySelector<HTMLElement>(".minimap-body")!.hidden).toBe(true);
    expect(map.el.querySelector<HTMLElement>(".minimap-reopen")!.hidden).toBe(false);
    expect(localStorage.getItem("gteki.minimap.collapsed")).toBe("true");
    const next = create();
    expect(next.el.dataset.collapsed).toBe("true");
    expect(vi.getTimerCount()).toBe(0);
    map.el.querySelector<HTMLButtonElement>(".minimap-reopen")!.click();
    expect(vi.getTimerCount()).toBe(1);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(1);
    map.dispose();
    expect(vi.getTimerCount()).toBe(0);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("continues when localStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const map = create();
    map.el.querySelector<HTMLButtonElement>(".minimap-orientation")!.click();
    expect(map.el.querySelector(".minimap-orientation")?.getAttribute("aria-pressed")).toBe("true");
    map.collapse();
    expect(map.el.dataset.collapsed).toBe("true");
  });
});
