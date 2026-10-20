import { describe, expect, it } from "vitest";
import { createRouter, type RouteResult } from "@gteki/navigation";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { buildLayout, WalkWorld, type Layout, type Plan, type WallSeg } from "../scene/layout.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { Player, sweepCamera, type CameraSurface } from "../app/src/player.ts";
import { floorLabel, narrate, routeMapFrame, nearbyExits, summarizeRoute } from "../app/src/narrate.ts";

const ring = (lo: number, hi: number) => [{ x: lo, y: lo }, { x: hi, y: lo }, { x: hi, y: hi }, { x: lo, y: hi }];
function worldWith(walls: WallSeg[] = []) {
  const layout: Layout = { levels: [], runs: [], tactile: [], gates: [], pads: [], streetPads: [], linkStrips: [], runWalls: [], nodeZ: new Map(), bounds: { min: { x: -10, y: -10 }, max: { x: 10, y: 10 } } };
  const world = new WalkWorld(layout);
  world.addWalls(walls);
  world.addSlab({ spaceId: "test", rings: [ring(-10, 10)], z: 0, fare: null, category: "test" });
  return world;
}
const wall = (a: { x: number; y: number }, b: { x: number; y: number }, zMin = 0, zMax = 3): WallSeg => ({ a, b, zMin, zMax, side: 1, kind: "wall" });

describe("camera volume sweep", () => {
  const anchor = { x: 0, y: 0, z: 1.5 };
  it("keeps the full boom in an open corridor", () => {
    const desired = { x: 0, y: -4, z: 2 };
    expect(sweepCamera(anchor, desired, worldWith(), [])).toEqual(desired);
  });
  it("stops before a thin wall including the near-plane margin", () => {
    const world = worldWith([wall({ x: -5, y: -2 }, { x: 5, y: -2 })]);
    const p = sweepCamera(anchor, { x: 0, y: -4, z: 2 }, world, []);
    expect(p.y).toBeGreaterThanOrEqual(-1.76);
    expect(p.y).toBeLessThan(-1.5);
  });
  it("does not force a minimum camera distance through a nearby wall", () => {
    const world = worldWith([wall({ x: -5, y: -0.3 }, { x: 5, y: -0.3 })]);
    const p = sweepCamera(anchor, { x: 0, y: -4, z: 1.5 }, world, []);
    expect(p.y).toBeGreaterThan(-0.07);
  });
  it("checks actual boom height at a stair head, not the pivot height", () => {
    const world = worldWith([wall({ x: -5, y: -2 }, { x: 5, y: -2 }, 1.8, 2.3)]);
    const p = sweepCamera({ x: 0, y: 0, z: 1 }, { x: 0, y: -4, z: 3 }, world, []);
    expect(p.y).toBeGreaterThan(-1.8);
  });
  it("catches a railing below the center ray", () => {
    const world = worldWith([wall({ x: -5, y: -2 }, { x: 5, y: -2 }, 0, 1.1)]);
    const p = sweepCamera({ x: 0, y: 0, z: 1.25 }, { x: 0, y: -4, z: 1.25 }, world, []);
    expect(p.y).toBeGreaterThan(-2);
  });
  it("catches walls parallel to the boom in a narrow corridor", () => {
    const world = worldWith([wall({ x: 0, y: -5 }, { x: 0, y: 5 })]);
    const p = sweepCamera({ x: 0.5, y: 0, z: 1.5 }, { x: 0.1, y: -3, z: 1.5 }, world, []);
    expect(p.x).toBeGreaterThanOrEqual(0.24);
  });
  it("does not collide with a railing on another floor", () => {
    const world = worldWith([wall({ x: -5, y: -2 }, { x: 5, y: -2 }, -4, -2.9)]);
    const desired = { x: 0, y: -4, z: 1.5 };
    expect(sweepCamera(anchor, desired, world, [])).toEqual(desired);
  });
  it.each(["ceiling", "floor"])("stops before a cut %s polygon", () => {
    const surfaces: CameraSurface[] = [{ z: 2, rings: [ring(-10, 10)] }];
    const p = sweepCamera({ x: 0, y: 0, z: 1 }, { x: 0, y: -2, z: 3 }, worldWith(), surfaces);
    expect(p.z).toBeLessThanOrEqual(1.76);
  });
  it("allows the boom through the actual stairwell opening", () => {
    const surfaces: CameraSurface[] = [{ z: 2, rings: [ring(-10, 10), ring(-1, 1)] }];
    const desired = { x: 0, y: 0, z: 3 };
    expect(sweepCamera({ x: 0, y: 0, z: 1 }, desired, worldWith(), surfaces)).toEqual(desired);
  });
  it("re-checks the smoothed path when it cuts across a corner", () => {
    const world = worldWith([wall({ x: 1, y: 0.5 }, { x: 1, y: 5 })]);
    const p = sweepCamera(anchor, { x: 3, y: 3, z: 1.5 }, world, []);
    expect(p.x).toBeLessThan(1);
  });
  it("supports first-person / zero-length booms without NaN", () => {
    expect(sweepCamera(anchor, anchor, worldWith(), [])).toEqual(anchor);
  });
});

const { bundle } = loadShinjukuBundle();
const layout = buildLayout(bundle, planJson as unknown as Plan);
const router = createRouter(bundle);
const platform = bundle.pois.find((p) => p.id === "poi:platform:oedo")!;
const exit = bundle.pois.find((p) => p.category === "exit")!;
const result = router.route(platform.connectorNodeIds, exit.connectorNodeIds, { fare: "ticketed", stepFree: false, today: "2026-10-21" });
if (!result.ok) throw new Error(result.message);
const route: RouteResult = result;

describe("route overview and narration", () => {
  it("presents router distance/time/floor changes without inventing measurements", () => {
    const s = summarizeRoute(bundle, route);
    expect(s.distanceM).toBe(Math.round(route.totalLengthM));
    expect(s.minutes * 60).toBeGreaterThanOrEqual(route.estimatedSeconds);
    expect(s.floorChanges).toBe(route.floorChanges);
    expect(s.floorLabels[0]).toBe("B6");
    expect(route.unknowns.map((u) => u.kind)).toContain("hours");
  });
  it.each([true, false, null])("keeps three-valued fare state (%s)", (crossesFareBoundary) => {
    const text = summarizeRoute(bundle, { ...route, crossesFareBoundary }).fare.en;
    expect(text).toBe(crossesFareBoundary === true ? "Crosses ticket gates · ticket / IC required" : crossesFareBoundary === false ? "No fare boundary crossing" : "Fare boundary unverified");
  });
  it("provides source-floor labels for floor-transition toasts", () => {
    const moves = narrate(bundle, route).filter((m) => m.toFloorLabel);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => !!m.fromFloorLabel)).toBe(true);
    expect(narrate(bundle, route).at(-1)?.kind).toBe("arrive");
  });
  it("does not invent up/down direction on same-floor symbolic stairs", () => {
    const step = route.steps.find((s) => s.mode === "stairs")!;
    const maneuvers = narrate(bundle, { ...route, steps: [{ ...step, toFloorId: step.fromFloorId }] });
    expect(maneuvers[0]!.ja).toContain("階段を進む");
    expect(maneuvers[0]!.up).toBeUndefined();
  });
  it("fits every route point inside the overview padding", () => {
    const points = route.nodeIds.map((id) => bundle.nodes.find((n) => n.id === id)!.position);
    const frame = routeMapFrame(points, 440)!;
    for (const p of points) {
      expect(Math.abs(p.x - frame.x) * frame.scale).toBeLessThanOrEqual(176.001);
      expect(Math.abs(p.y - frame.y) * frame.scale).toBeLessThanOrEqual(176.001);
    }
    expect(routeMapFrame([], 440)).toBeNull();
    expect(Number.isFinite(routeMapFrame([{ x: 1, y: 2 }], 440)!.scale)).toBe(true);
  });
  it("does not call vertically overlapping exits nearby on the platform", () => {
    expect(nearbyExits(bundle, router, platform.connectorNodeIds[0]!, { fare: "ticketed", stepFree: false })).toEqual([]);
    expect(nearbyExits(bundle, router, "unknown node", { fare: "ticketed", stepFree: false })).toEqual([]);
  });
  it("lists only same-floor exits reachable through the selected fare profile", () => {
    let count = 0;
    for (const p of bundle.pois) for (const node of p.connectorNodeIds) {
      const found = nearbyExits(bundle, router, node, { fare: "unpaid_only", stepFree: false });
      count += found.length;
      expect(found.length).toBeLessThanOrEqual(2);
      for (const exit of found) {
        const r = router.route(node, exit.poi.connectorNodeIds, { fare: "unpaid_only", stepFree: false });
        expect(exit.poi.paid).toBe(false);
        expect(exit.poi.connectorNodeIds).not.toContain(node);
        expect(r.ok).toBe(true);
        if (r.ok) { expect(r.floorChanges).toBe(0); expect(exit.distanceM).toBe(Math.round(r.totalLengthM)); expect(r.totalLengthM).toBeLessThanOrEqual(80); }
      }
    }
    expect(count).toBeGreaterThan(0);
  });
  it("labels unknown floors honestly", () => expect(floorLabel(undefined).short).toBe("?"));
});

describe("movement feel", () => {
  it("accelerates, decelerates and advances the step phase only on movement", () => {
    const p = new Player(worldWith(), { x: 0, y: 0, z: 0 });
    p.update(1 / 30, { forward: 1, strafe: 0, run: false }, 0);
    expect(p.speed).toBeGreaterThan(0);
    expect(p.speed).toBeLessThan(1.45);
    for (let i = 0; i < 50; i++) p.update(1 / 30, { forward: 1, strafe: 0, run: false }, 0);
    const phase = p.stridePhase;
    expect(p.speed).toBeCloseTo(1.45, 2);
    p.update(1 / 30, { forward: 0, strafe: 0, run: false }, 0);
    expect(p.speed).toBeLessThan(1.45);
    expect(p.stridePhase).not.toBe(phase);
    for (let i = 0; i < 100; i++) p.update(1 / 30, { forward: 0, strafe: 0, run: false }, 0);
    expect(p.speed).toBeLessThan(0.001);
    expect(p.stridePhase).toBe(0);
    const stopped = p.stridePhase;
    p.update(1 / 30, { forward: 0, strafe: 0, run: false }, 0);
    expect(p.stridePhase - stopped).toBeLessThan(0.001);
  });
  it("resets motion after an elevator teleport and retains manual guide cancellation", () => {
    const p = new Player(worldWith(), { x: 0, y: 0, z: 0 });
    p.startGuide([{ x: 0, y: 0, z: 0, nodeId: "a" }, { x: 0, y: 5, z: 0, nodeId: "b" }]);
    p.update(1 / 30, { forward: 1, strafe: 0, run: false }, 0);
    expect(p.guide).toBeNull();
    p.teleport({ x: 0, y: 0, z: 0 });
    expect(p.speed).toBe(0);
    expect(p.climbing).toBe(0);
  });
  it("the B3 follow boom no longer crosses analytic walls after smoothing", () => {
    const n = bundle.nodes.find((n) => n.id === "n:b159c0f74b1843c4bca94432e5fb5e86")!;
    const z = layout.nodeZ.get(n.id)!;
    const world = new WalkWorld(layout);
    const anchor = { ...n.position, z: z + 1.45 };
    const p = sweepCamera(anchor, { x: anchor.x, y: anchor.y - 3.6, z: anchor.z + 0.65 }, world, layout.levels.flatMap((l) => [...l.slabs, ...l.ceilings]));
    // Regression is bounded to analytic station collision; a browser capture is still required.
    expect(world.firstWallHit(anchor, p, p.z)).toBe(1);
    expect(Number.isFinite(p.z)).toBe(true);
  });
});
