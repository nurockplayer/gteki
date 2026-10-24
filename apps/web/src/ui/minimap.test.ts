// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PolylinePoint, RouteStep } from "@gteki/navigation";
import type { Poi, StationBundle } from "@gteki/schema";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";
import type { ExplorerPose } from "../explorer/explorer.ts";
import { Minimap } from "./minimap.ts";

/** A synthetic destination: the fixture's restroom is on the concourse at (10, 0) with a connector. */
const poi = (over: Partial<Poi> = {}): Poi => ({ ...createSyntheticBundle().pois[0]!, ...over });

const point = (x: number, y: number, floorId: string, stepIndex: number): PolylinePoint =>
  ({ x, y, z: floorId === "upper" ? 4 : 0, zKnown: true, stepIndex, floorId });
const step = (fromFloorId: string, toFloorId: string, mode: RouteStep["mode"] = "walk"): RouteStep =>
  ({ edgeId: `${fromFloorId}-${toFloorId}`, fromNodeId: "from", toNodeId: "to", reversed: false, mode, lengthM: 10, fromFloorId, toFloorId });

/** Concourse → 1F: a walk to the stairs, then the stairs. */
const upRoute: PolylinePoint[] = [
  point(0, 0, "concourse", -1),
  point(10, 0, "concourse", 0),
  point(10, 0, "upper", 1),
  point(10, 4, "upper", 2),
];
const upSteps: RouteStep[] = [step("concourse", "concourse"), step("concourse", "upper", "stairs"), step("upper", "upper")];

/** Concourse → 1F → back down over the same coordinates → on to the escalator. */
const loopPoints: PolylinePoint[] = [
  point(0, 0, "concourse", -1), point(10, 0, "concourse", 0),
  point(10, 0, "upper", 1), point(10, 10, "upper", 2),
  point(10, 10, "concourse", 3), point(20, 10, "concourse", 4),
  point(20, 10, "upper", 5),
];
const loopSteps: RouteStep[] = [
  step("concourse", "concourse"), step("concourse", "upper", "stairs"), step("upper", "upper"),
  step("upper", "concourse", "stairs"), step("concourse", "concourse"), step("concourse", "upper", "escalator"),
];

describe("Minimap HUD", () => {
  let pose: ExplorerPose | null;
  const maps: Minimap[] = [];
  function create(bundle: StationBundle = createSyntheticBundle()) {
    const map = new Minimap(() => pose);
    maps.push(map);
    document.body.append(map.el);
    map.setStation(bundle, "en");
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

describe("Minimap route overlay (#220 PR2)", () => {
  let pose: ExplorerPose | null;
  const maps: Minimap[] = [];
  function create(bundle: StationBundle = createSyntheticBundle()) {
    const map = new Minimap(() => pose);
    maps.push(map);
    document.body.append(map.el);
    map.setStation(bundle, "en");
    return map;
  }
  const tick = () => vi.advanceTimersByTime(90);
  const display = (map: Minimap, selector: string) => map.el.querySelector<SVGElement>(selector)!.style.display;
  const routeLines = (map: Minimap) => map.el.querySelectorAll(".minimap-route-line");

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    pose = { east: 0, north: 0, up: 0, headingDeg: 0, mode: "walk" };
  });
  afterEach(() => {
    for (const map of maps.splice(0)) map.dispose();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("draws only the current floor's run of the route and names the next floor change", () => {
    const map = create();
    map.setRoute({ points: upRoute, steps: upSteps }, poi());
    expect(routeLines(map)).toHaveLength(1);
    expect(map.el.querySelector(".minimap-route-line")!.getAttribute("points")).toBe("0,0 20,0");
    expect(map.el.querySelector(".minimap-route-label")!.textContent).toContain("To 1F by stairs");
    // The stairs marker sits at the start of the stairs step, on the current floor.
    expect(display(map, ".minimap-connector-marker")).toBe("");
    expect(display(map, ".minimap-connector-rim")).toBe("none");
    expect(map.el.querySelector(".minimap-connector-marker")!.getAttribute("transform")).toBe("translate(115 95)");
    expect(map.el.querySelector(".minimap-connector-glyph")!.getAttribute("d")).toContain("M -5,5");

    pose = { ...pose!, east: 10, north: 2, up: 4 };
    tick();
    expect(routeLines(map)).toHaveLength(1);
    // Run geometry is in station coordinates; the group transform is what follows the player.
    expect(map.el.querySelector(".minimap-route-line")!.getAttribute("points")).toBe("20,0 20,-8");
    // From 1F the recorded destination (the concourse restroom) is on another floor: no POI dot.
    expect(map.el.querySelector(".minimap-route-label")!.textContent).toContain("Destination floor: B1");
    expect(map.el.querySelector(".minimap-poi.is-destination")).toBeNull();
    // The route's own end is drawn, but only as a neutral endpoint.
    expect(display(map, ".minimap-route-end")).toBe("");
    expect(map.el.querySelector(".minimap-route-end")!.getAttribute("transform")).toBe("translate(95 91)");
    expect(display(map, ".minimap-destination-rim")).toBe("none");
  });

  it("clears the overlay when the route is cleared, but keeps evidenced POI dots", () => {
    const map = create();
    map.setRoute({ points: upRoute, steps: upSteps }, poi());
    expect(routeLines(map)).toHaveLength(1);
    map.setRoute(null, null);
    expect(routeLines(map)).toHaveLength(0);
    expect(map.el.querySelector<HTMLElement>(".minimap-route-label")!.hidden).toBe(true);
    expect(display(map, ".minimap-route-end")).toBe("none");
    expect(display(map, ".minimap-destination-rim")).toBe("none");
    expect(display(map, ".minimap-connector-marker")).toBe("none");
    expect(map.el.querySelectorAll(".minimap-poi")).toHaveLength(2);
  });

  it("highlights an evidenced on-floor destination's POI dot, not the route end", () => {
    const map = create();
    const route = [point(0, 0, "concourse", -1), point(10, 0, "concourse", 0)];
    map.setRoute({ points: route, steps: [step("concourse", "concourse")] }, poi());
    expect(display(map, ".minimap-destination-rim")).toBe("none");
    const dot = map.el.querySelector(".minimap-poi.is-destination");
    expect(dot).not.toBeNull();
    expect(dot!.getAttribute("cx")).toBe("20");
    expect(dot!.getAttribute("cy")).toBe("0");
    expect(dot!.querySelector("title")!.textContent).toBe("Restroom");
    // At the same place, the neutral route end yields to the destination dot.
    expect(display(map, ".minimap-route-end")).toBe("none");
  });

  it("points the rim chevron at the evidenced POI position, else at the route end", () => {
    const farPoi = poi({ id: "far", displayPosition: { x: 200, y: 0, z: 0 } });
    const farBundle = createSyntheticBundle();
    farBundle.pois = [farPoi];
    const nearRoute = [point(0, 0, "concourse", -1), point(10, 0, "concourse", 0)];
    const withPoi = create(farBundle);
    withPoi.setRoute({ points: nearRoute, steps: [step("concourse", "concourse")] }, farPoi);
    expect(display(withPoi, ".minimap-destination-rim")).toBe("");
    expect(withPoi.el.querySelector(".minimap-destination-rim")!.getAttribute("transform")).toBe("translate(179 95) rotate(90)");
    // The route end is still shown neutrally, inside the circle.
    expect(display(withPoi, ".minimap-route-end")).toBe("");

    // No evidence for the POI: the chevron follows the route's own end instead.
    const unevidenced = poi({ id: "unevidenced", connectorNodeIds: [] });
    const farRoute = [point(0, 0, "concourse", -1), point(200, 0, "concourse", 0)];
    const unlocatedBundle = createSyntheticBundle();
    unlocatedBundle.pois = [unevidenced];
    const withoutPoi = create(unlocatedBundle);
    withoutPoi.setRoute({ points: farRoute, steps: [step("concourse", "concourse")] }, unevidenced);
    expect(withoutPoi.el.querySelector(".minimap-poi.is-destination")).toBeNull();
    expect(display(withoutPoi, ".minimap-destination-rim")).toBe("");
    expect(withoutPoi.el.querySelector(".minimap-destination-rim")!.getAttribute("transform")).toBe("translate(179 95) rotate(90)");
    expect(display(withoutPoi, ".minimap-route-end")).toBe("none");
  });

  it("shows no destination POI dot for another floor, only the label line", () => {
    const map = create();
    const upperDestination = poi({ id: "upstairs", floorId: "upper" });
    const route = [point(0, 0, "concourse", -1), point(10, 0, "concourse", 0)];
    map.setRoute({ points: route, steps: [step("concourse", "concourse")] }, upperDestination);
    expect(map.el.querySelector(".minimap-route-label")!.textContent).toContain("Destination floor: 1F");
    expect(map.el.querySelector(".minimap-poi.is-destination")).toBeNull();
    expect(display(map, ".minimap-destination-rim")).toBe("none");
  });

  it("draws no destination POI dot unless the POI itself has position, connector and floor evidence", () => {
    const variants: Array<{ label: string; over: Partial<Poi> }> = [
      { label: "null position", over: { displayPosition: null } },
      { label: "no connector", over: { connectorNodeIds: [] } },
      { label: "null floor", over: { floorId: null } },
    ];
    for (const variant of variants) {
      const target = poi({ id: "target", ...variant.over });
      const bundle = createSyntheticBundle();
      bundle.pois = [target];
      const map = create(bundle);
      map.setRoute({ points: [point(0, 0, "concourse", -1), point(10, 0, "concourse", 0)], steps: [step("concourse", "concourse")] }, target);
      expect(map.el.querySelectorAll(".minimap-poi"), variant.label).toHaveLength(0);
      // The route's own end is still drawn, but as a neutral endpoint with no POI meaning.
      expect(display(map, ".minimap-route-end"), variant.label).toBe("");
      expect(display(map, ".minimap-destination-rim"), variant.label).toBe("none");
    }

    // With evidence, the dot sits at the POI's displayPosition — never at the route end (20, 0).
    const target = poi({ id: "target", displayPosition: { x: 50, y: 50, z: 0 } });
    const bundle = createSyntheticBundle();
    bundle.pois = [target];
    const map = create(bundle);
    map.setRoute({ points: [point(0, 0, "concourse", -1), point(10, 0, "concourse", 0)], steps: [step("concourse", "concourse")] }, target);
    const dots = map.el.querySelectorAll(".minimap-poi");
    expect(dots).toHaveLength(1);
    expect(dots[0]!.getAttribute("cx")).toBe("100");
    expect(dots[0]!.getAttribute("cy")).toBe("-100");
    expect(dots[0]!.classList.contains("is-destination")).toBe(true);
    expect(map.el.querySelector(".minimap-route-end")!.getAttribute("transform")).toBe("translate(115 95)");
  });

  it("points at the later connector after the route comes back to the floor", () => {
    const bundle = createSyntheticBundle();
    // The "other" node sits exactly on (20, 10) but belongs to another operator's floor.
    bundle.nodes = bundle.nodes.filter((node) => node.id !== "other");
    const map = create(bundle);
    map.setRoute({ points: loopPoints, steps: loopSteps }, null);
    expect(map.el.querySelector(".minimap-connector-marker")!.getAttribute("transform")).toBe("translate(115 95)");
    expect(map.el.querySelector(".minimap-route-label")!.textContent).toContain("To 1F by stairs");

    // Walk the route: up the stairs, across 1F, down again, then along the concourse.
    pose = { ...pose!, east: 10, north: 0 };
    tick();
    expect(map.el.querySelector(".minimap-route-label")!.textContent).toContain("To 1F by stairs");
    pose = { ...pose!, up: 4 };
    tick();
    pose = { ...pose!, east: 10, north: 10 };
    tick();
    pose = { ...pose!, up: 0 };
    tick();
    pose = { ...pose!, east: 20, north: 10 };
    tick();
    // Back on B1F after the detour, the already-walked stairs are no longer the hint.
    expect(map.el.querySelector(".minimap-connector-marker")!.getAttribute("transform")).toBe("translate(95 95)");
    expect(map.el.querySelector(".minimap-route-label")!.textContent).toContain("To 1F by escalator");
  });

  it("restarts progress at the first segment when the route is recomputed", () => {
    const bundle = createSyntheticBundle();
    bundle.nodes = bundle.nodes.filter((node) => node.id !== "other");
    const map = create(bundle);
    map.setRoute({ points: loopPoints, steps: loopSteps }, null);
    for (const next of [
      { east: 10, north: 0, up: 0 }, { east: 10, north: 0, up: 4 },
      { east: 10, north: 10, up: 4 }, { east: 10, north: 10, up: 0 },
      { east: 20, north: 10, up: 0 },
    ]) {
      pose = { ...pose!, ...next };
      tick();
    }
    expect(map.el.querySelector(".minimap-route-label")!.textContent).toContain("To 1F by escalator");
    // A recomputed route is new evidence: progress starts over at its first segment.
    map.setRoute({ points: loopPoints, steps: loopSteps }, null);
    expect(map.el.querySelector(".minimap-route-label")!.textContent).toContain("To 1F by stairs");
  });

  it("does not jump when the first floor reading arrives after the route is set", () => {
    pose = null;
    const map = create();
    map.setRoute({ points: loopPoints, steps: loopSteps }, null);
    expect(display(map, ".minimap-connector-marker")).toBe("none");
    // The first known floor is not a floor change: progress starts at the route's first segment.
    pose = { east: 0, north: 0, up: 0, headingDeg: 0, mode: "walk" };
    tick();
    expect(map.el.querySelector(".minimap-connector-marker")!.getAttribute("transform")).toBe("translate(115 95)");
    expect(map.el.querySelector(".minimap-route-label")!.textContent).toContain("To 1F by stairs");
    pose = { ...pose, east: 10 };
    tick();
    expect(map.el.querySelector(".minimap-route-label")!.textContent).toContain("To 1F by stairs");
  });

  it("keeps progress and the hint while the floor reading drops out and returns", () => {
    const map = create();
    map.setRoute({ points: loopPoints, steps: loopSteps }, null);
    expect(map.el.querySelector(".minimap-route-label")!.textContent).toContain("To 1F by stairs");
    // Mid-stairs the floor is unknown: nothing moves, and the stairs hint stays.
    pose = { ...pose!, up: 100 };
    tick();
    expect(display(map, ".minimap-connector-marker")).toBe("");
    expect(map.el.querySelector(".minimap-route-label")!.textContent).toContain("To 1F by stairs");
    // Back on the same floor, the earlier stairs are still the hint, not the later escalator.
    pose = { ...pose!, up: 0 };
    tick();
    expect(map.el.querySelector(".minimap-connector-marker")!.getAttribute("transform")).toBe("translate(115 95)");
    expect(map.el.querySelector(".minimap-route-label")!.textContent).toContain("To 1F by stairs");
  });

  it("still crosses floors when the reading returns on a different floor", () => {
    const map = create();
    map.setRoute({ points: loopPoints, steps: loopSteps }, null);
    pose = { ...pose!, up: 100 };
    tick();
    pose = { ...pose!, up: 4 };
    tick();
    expect(map.el.querySelector(".minimap-route-label")!.textContent).toContain("To B1 by stairs");
  });

  it("drops a route segment whose step data is missing rather than drawing it flat", () => {
    const map = create();
    // The second point claims step 2; only step 0 was supplied, so the pair is unproven.
    map.setRoute({ points: [point(0, 0, "concourse", -1), point(10, 0, "concourse", 2)], steps: [step("concourse", "concourse")] }, null);
    expect(routeLines(map)).toHaveLength(0);
    // The same points with their own step draw normally.
    map.setRoute({ points: [point(0, 0, "concourse", -1), point(10, 0, "concourse", 0)], steps: [step("concourse", "concourse")] }, null);
    expect(routeLines(map)).toHaveLength(1);
  });

  it("keeps the current stairs hint through the whole cross-floor step, then drops it on the new floor", () => {
    const map = create();
    const points = [
      point(0, 0, "concourse", -1),
      point(10, 0, "concourse", 0),
      point(10, 1, "concourse", 1), // mid-stair vertex, tagged with the floor it leaves
      point(10, 0, "upper", 1),
      point(20, 0, "upper", 2),
    ];
    const steps = [step("concourse", "concourse"), step("concourse", "upper", "stairs"), step("upper", "upper")];
    map.setRoute({ points, steps }, null);
    // Entry: at the foot of the stairs. The stair interior is never flattened into the floor line.
    expect(map.el.querySelector(".minimap-route-line")!.getAttribute("points")).toBe("0,0 20,0");
    expect(map.el.querySelector(".minimap-connector-marker")!.getAttribute("transform")).toBe("translate(115 95)");
    expect(map.el.querySelector(".minimap-route-label")!.textContent).toContain("To 1F by stairs");

    // A turn alone changes nothing about progress: the same stairs hint stays.
    pose = { ...pose!, headingDeg: 90 };
    tick();
    expect(display(map, ".minimap-connector-marker")).toBe("");
    expect(map.el.querySelector(".minimap-connector-marker")!.getAttribute("transform")).toBe("translate(95 75)");
    expect(map.el.querySelector(".minimap-route-label")!.textContent).toContain("To 1F by stairs");

    // Middle: standing on the stairs, the step is still the one being walked.
    pose = { ...pose!, east: 10, north: 1, headingDeg: 0 };
    tick();
    expect(map.el.querySelector(".minimap-connector-marker")!.getAttribute("transform")).toBe("translate(95 97)");
    expect(map.el.querySelector(".minimap-route-label")!.textContent).toContain("To 1F by stairs");

    // Complete: the floor changed, so the stair hint no longer applies.
    pose = { ...pose!, east: 10, north: 0, up: 4 };
    tick();
    expect(display(map, ".minimap-connector-marker")).toBe("none");
    expect(display(map, ".minimap-connector-rim")).toBe("none");
    expect(map.el.querySelector<HTMLElement>(".minimap-route-label")!.hidden).toBe(true);
  });

  it("never draws a search-only POI and drops dots when the floor changes", () => {
    const bundle = createSyntheticBundle();
    bundle.pois.push({
      ...poi({ id: "search-only" }),
      names: [{ lang: "en", text: "Unlocated Shop" }],
      displayPosition: { x: 5, y: 5, z: 0 },
      connectorNodeIds: [],
    });
    const map = create(bundle);
    const titles = [...map.el.querySelectorAll(".minimap-poi title")].map((t) => t.textContent);
    expect(titles).toEqual(["Restroom", "Exit A1"]);
    pose = { ...pose!, east: 10, north: 0, up: 4 };
    tick();
    // The fixture's upper-floor shop has no connector, so this floor has no evidenced POI.
    expect(map.el.querySelectorAll(".minimap-poi")).toHaveLength(0);
  });

  it("clears the route and its POIs when the station changes", () => {
    const map = create();
    map.setRoute({ points: upRoute, steps: upSteps }, poi());
    map.setStation(null, "en");
    expect(routeLines(map)).toHaveLength(0);
    expect(map.el.querySelectorAll(".minimap-poi")).toHaveLength(0);
    expect(map.el.querySelector<HTMLElement>(".minimap-route-label")!.hidden).toBe(true);
    expect(display(map, ".minimap-route-end")).toBe("none");
    expect(display(map, ".minimap-destination-rim")).toBe("none");
    map.setStation(createSyntheticBundle(), "en");
    expect(routeLines(map)).toHaveLength(0);
    expect(map.el.querySelector(".minimap-route-label")!.textContent).toBe("");
  });

  it("makes no DOM writes for an unchanged pose with a route set", () => {
    const map = create();
    map.setRoute({ points: upRoute, steps: upSteps }, poi());
    const observer = new MutationObserver(() => {});
    observer.observe(map.el, { subtree: true, attributes: true, childList: true, characterData: true });
    tick();
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
  });
});
