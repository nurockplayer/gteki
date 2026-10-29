import { describe, expect, it } from "vitest";
import type { StationBundle } from "@gteki/schema";
import { unmodelledVerticalEdges } from "./greyboxConnectors.ts";
import { resolveWalls } from "./walker.ts";

const bundle = {
  floors: [{ id: "low", renderElevationM: 0 }, { id: "high", renderElevationM: 3 }],
  nodes: [
    { id: "a", floorId: "low", position: { x: 0, y: 0, z: 0 } },
    { id: "b", floorId: "high", position: { x: 4, y: 0, z: 3 } },
  ],
  edges: [{ id: "e", from: "a", to: "b", mode: "stairs" }],
} as unknown as StationBundle;

describe("vertical connector scope", () => {
  it("excludes modelled and non-traversable edges, and detects a single missing sample", () => {
    expect(unmodelledVerticalEdges(bundle, () => true, () => true, () => true)).toEqual([]);
    expect(unmodelledVerticalEdges(bundle, () => false, () => false, () => false)).toEqual([]);
    expect(unmodelledVerticalEdges(bundle, () => true, (p) => p.x !== 2, () => true)).toEqual(bundle.edges);
    expect(unmodelledVerticalEdges(bundle, () => true, () => true, () => false)).toEqual(bundle.edges);
  });
  it("probes only landings and excludes an existing scene elevator", () => {
    const lift = { ...bundle, edges: [{ ...bundle.edges[0]!, mode: "elevator" }] } as StationBundle;
    const floors = (p: { z: number }) => p.z === 0 || p.z === 3;
    expect(unmodelledVerticalEdges(lift, () => true, floors, () => false, () => true)).toEqual([]);
    expect(unmodelledVerticalEdges(lift, () => true, floors, () => false, () => false)).toEqual(lift.edges);
    expect(unmodelledVerticalEdges(lift, () => true, (p) => p.z === 0, () => true, () => true)).toEqual(lift.edges);
  });
});

import * as THREE from "three";
import { buildConnectors, buildElevator, buildEscalator, buildStairs, withinGreyboxBudget } from "./greyboxConnectors.ts";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";

describe("connector geometry", () => {
  const a = new THREE.Vector3(0, 0, 0), b = new THREE.Vector3(5.2, 3, 0);
  it("emits stairs, escalator and movable elevator car parts", () => {
    const edge = bundle.edges[0]!;
    const stairs = buildStairs(a, b, 1.5, "high");
    expect(stairs.some((p) => p.material === "riser")).toBe(true);
    expect(stairs.some((p) => p.role === "walkable")).toBe(true);
    const escalator = buildEscalator(a, b, "high");
    expect(escalator.some((p) => p.material === "glass")).toBe(true);
    expect(escalator.some((p) => p.role === "collider")).toBe(true);
    const elevator = buildElevator(a, b, new THREE.Vector3(-1, 0, 0), "high");
    expect(elevator.some((p) => p.role === "car" && p.material === "tread")).toBe(true);
    expect(elevator.some((p) => p.role === "collider")).toBe(true);
  });
  it("batches generated geometry and tags its meshes", () => {
    const result = buildConnectors(bundle, () => true, { hasFloor: () => false, nearMesh: () => false }, "low");
    expect(result.stats.connectors.stairs).toBe(1);
    expect(result.root.children.length).toBeLessThanOrEqual(3);
    result.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) expect(o.userData).toMatchObject({ greybox: true, connector: true, approximate: true }); });
  });
});


describe("measured connector dimensions", () => {
  const extent = (p: { position: number[] }, axis: number) => {
    const values = p.position.filter((_, i) => i % 3 === axis);
    return Math.max(...values) - Math.min(...values);
  };
  it("builds 0.18 m risers, 0.30 m treads and a 1.2 m landing before 3 m", () => {
    const p = buildStairs(new THREE.Vector3(), new THREE.Vector3(7.2, 3.6, 0), 1.5, "high");
    const risers = p.filter((v) => v.material === "riser"), treads = p.filter((v) => v.material === "tread");
    expect(risers).toHaveLength(20);
    expect(p.every((v) => v.userData?.fit === "exact")).toBe(true);
    for (const riser of risers) expect(extent(riser, 1)).toBeCloseTo(0.18);
    expect(treads.filter((v) => Math.abs(extent(v, 0) - 0.30) < 1e-5)).toHaveLength(20);
    const landing = treads.find((v) => Math.abs(extent(v, 0) - 1.2) < 1e-5)!;
    expect(landing).toBeDefined();
    expect(Math.max(...landing.position.filter((_, i) => i % 3 === 1))).toBeCloseTo(2.88);
  });
  it("hides end steps, colours the approach indicators and reduces low tier triangles", () => {
    const from = new THREE.Vector3(), to = new THREE.Vector3(5.064101615, 2, 0);
    const high = buildEscalator(from, to, "high"), low = buildEscalator(from, to, "low");
    const steps = high.filter((p) => p.material === "escStep" && p.role !== "walkable" && p.position.length === 108 && extent(p, 1) < 0.081);
    expect(steps).toHaveLength(10); // two landings and eight interior steps
    expect(high.every((v) => v.userData?.fit === "exact")).toBe(true);
    const indicators = high.filter((p) => p.material === "light" && Math.abs(extent(p, 2) - 0.16) < 1e-5);
    expect(indicators).toHaveLength(2);
    expect(indicators[0]!.colour.slice(0, 3)).toEqual([0, 1, 0]);
    expect(indicators[1]!.colour.slice(0, 3)).toEqual([1, 0, 0]);
    expect(low.reduce((n, p) => n + p.position.length, 0)).toBeLessThan(high.reduce((n, p) => n + p.position.length, 0));
  });
});


describe("endpoint fitting", () => {
  it("flags a short stair run, omits landings and reaches both endpoints", () => {
    const p = buildStairs(new THREE.Vector3(), new THREE.Vector3(3, 3.6, 0), 1.5, "high");
    expect(p.every((v) => v.userData?.fit === "approximate" && v.userData.omittedLandings === 1)).toBe(true);
    const treads = p.filter((v) => v.material === "tread");
    expect(Math.min(...treads[0]!.position.filter((_, i) => i % 3 === 0))).toBeCloseTo(0);
    expect(Math.max(...treads.at(-1)!.position.filter((_, i) => i % 3 === 0))).toBeCloseTo(3);
    expect(Math.max(...treads.at(-1)!.position.filter((_, i) => i % 3 === 1))).toBeCloseTo(3.6);
  });
  it("joins both comb plates to the visible flight in both tiers", () => {
    for (const tier of ["high", "low"] as const) {
      const parts = buildEscalator(new THREE.Vector3(), new THREE.Vector3(5.064101615, 2, 0), tier);
      const surfaces = parts.filter((p) => p.material === "escStep" && p.role !== "walkable" && (p.position.length === 108 || p.position.length === 18));
      const intervals = surfaces.map((p) => {
        const xs = p.position.filter((_, i) => i % 3 === 0);
        return [Math.min(...xs), Math.max(...xs)] as const;
      }).sort((a, b) => a[0] - b[0]);
      expect(intervals[0]![0]).toBeCloseTo(0);
      expect(intervals.at(-1)![1]).toBeCloseTo(5.064101615);
      for (let i = 1; i < intervals.length; i++) expect(intervals[i]![0] - intervals[i - 1]![1]).toBeLessThanOrEqual(0.05);
    }
  });
  it("samples a continuous walkable incline in both tiers", () => {
    const station = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 5.2, y: 0, z: 1.5 } }], edges: [{ ...bundle.edges[0]!, mode: "escalator" }] } as StationBundle;
    for (const tier of ["high", "low"] as const) {
      const result = buildConnectors(station, () => true, { hasFloor: () => false, nearMesh: () => false }, tier);
      const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
      let previous: number | undefined;
      for (let i = 0; i <= 52; i++) {
        ray.ray.origin.set(Math.min(5.199, i * 0.1 + 0.001), 10, 0);
        const hit = ray.intersectObjects(result.walkable, false)[0];
        expect(hit).toBeDefined();
        if (previous !== undefined) expect(Math.abs(hit!.point.y - previous)).toBeLessThanOrEqual(0.050001);
        previous = hit!.point.y;
      }
      const parts = buildEscalator(new THREE.Vector3(), new THREE.Vector3(5.2, 1.5, 0), tier);
      expect(parts.filter((p) => p.role === "walkable")).toHaveLength(3);
      expect(parts.filter((p) => p.role === "walkable").every((p) => p.walkableOnly)).toBe(true);
    }
  });
  it("samples a 30-degree flight at 0.1 m intervals along its surface", () => {
    const run = 2 * Math.sqrt(3), length = run + 1.6;
    const station = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: length, y: 0, z: 2 } }], edges: [{ ...bundle.edges[0]!, mode: "escalator" }] } as StationBundle;
    for (const tier of ["high", "low"] as const) {
      const result = buildConnectors(station, () => true, { hasFloor: () => false, nearMesh: () => false }, tier);
      const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
      let previous: number | undefined;
      for (let distance = 0.001; distance < 5.6; distance += 0.1) {
        const x = distance <= 0.8 ? distance : distance < 4.8 ? 0.8 + (distance - 0.8) * Math.sqrt(3) / 2 : 0.8 + run + distance - 4.8;
        ray.ray.origin.set(x, 10, 0);
        const hit = ray.intersectObjects(result.walkable, false)[0];
        expect(hit).toBeDefined();
        if (previous !== undefined) expect(Math.abs(hit!.point.y - previous)).toBeLessThanOrEqual(0.050001);
        previous = hit!.point.y;
      }
    }
  });
  it("flags escalator pitch outside the range and ends at the node", () => {
    const p = buildEscalator(new THREE.Vector3(), new THREE.Vector3(4, 3.6, 0), "high");
    expect(p.every((v) => v.userData?.fit === "approximate")).toBe(true);
    const landing = p.filter((v) => v.material === "escStep" && v.role === "walkable").slice(0, 2);
    expect(Math.min(...landing[0]!.position.filter((_, i) => i % 3 === 0))).toBeCloseTo(0);
    expect(Math.max(...landing[1]!.position.filter((_, i) => i % 3 === 0))).toBeCloseTo(4);
    expect(Math.max(...landing[1]!.position.filter((_, i) => i % 3 === 1))).toBeCloseTo(3.6);
  });
});

describe("elevator geometry", () => {
  it("spans the floors, places two doors and lamps, and parks the car", () => {
    const lower = new THREE.Vector3(0, 2, 0), upper = new THREE.Vector3(0, 6, 0);
    const parts = buildElevator(lower, upper, new THREE.Vector3(-1, 0, 0), "high");
    const shaft = parts.filter((p) => p.role === "collider");
    const ys = shaft.flatMap((p) => p.position.filter((_, i) => i % 3 === 1));
    expect(Math.min(...ys)).toBeCloseTo(2);
    expect(Math.max(...ys)).toBeCloseTo(8.6);
    const doors = parts.filter((p) => p.material === "steel" && p.role !== "car" && Math.abs(Math.max(...p.position.filter((_, i) => i % 3 === 1)) - Math.min(...p.position.filter((_, i) => i % 3 === 1)) - 2.1) < 1e-5);
    expect(doors).toHaveLength(4);
    expect(parts.filter((p) => p.material === "light" && p.role !== "car")).toHaveLength(2);
    const station = { ...bundle, nodes: [{ ...bundle.nodes[0]!, position: { x: 0, y: 0, z: 2 } }, { ...bundle.nodes[1]!, position: { x: 0, y: 0, z: 6 } }], edges: [{ ...bundle.edges[0]!, mode: "elevator" }] } as StationBundle;
    const result = buildConnectors(station, () => true, { hasFloor: () => false, nearMesh: () => false }, "high");
    expect(result.cars).toHaveLength(1);
    expect(result.cars[0]!.mesh.position.y).toBeCloseTo(2);
    expect(result.cars[0]!.zLow).toBe(2);
    expect(result.cars[0]!.zHigh).toBe(6);
    expect(result.walkable.some((o) => o.parent === result.cars[0]!.mesh)).toBe(true);
    expect(result.root.children.length).toBeLessThanOrEqual(6);
    expect(result.cars[0]!.doors).toHaveLength(2);
    expect(result.stats.triangles).toBe(result.root.children.reduce((sum, child) => sum + ((child as THREE.Mesh).geometry?.getAttribute("position").count ?? 0) / 3, 0));
    const ray = new THREE.Raycaster(new THREE.Vector3(-2, 2.8, 0), new THREE.Vector3(1, 0, 0), 0, 1.3);
    expect(ray.intersectObjects(result.colliders, false)).toHaveLength(0);
    ray.ray.origin.z = 0.8;
    expect(ray.intersectObjects(result.colliders, false).length).toBeGreaterThan(0);
  });
});

it("drops only connector soffits before reporting a combined over-budget result", () => {
  const station = { ...bundle, edges: [{ ...bundle.edges[0]!, mode: "escalator" }] } as StationBundle;
  const result = buildConnectors(station, () => true, { hasFloor: () => false, nearMesh: () => false }, "high");
  const before = result.stats.triangles;
  expect(withinGreyboxBudget({ triangles: 150000 }, result.stats, "high")).toBe(false);
  expect(result.stats.triangles).toBeLessThan(before);
  expect(result.stats.overBudget).toMatch(/exceeds 150000/);
  expect(result.walkable.length).toBeGreaterThan(0);
});

it("builds a bent stair edge along both legs with a flat turning landing", () => {
  const station = createSyntheticBundle([syntheticEdge("bent", "start", "upper", { mode: "stairs", attributes: { sceneGap: true }, geometry: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 2 }, { x: 4, y: 4, z: 4 }] })]);
  const upper = station.nodes.find((n) => n.id === "upper")!;
  upper.position = { x: 4, y: 4, z: 4 };
  const result = buildConnectors(station, () => true, { hasFloor: () => false, nearMesh: () => false }, "high");
  const support = result.walkable[0] as THREE.Mesh;
  const rail = result.wallSegments.find((w) => Math.abs(w.az) > 0.7 && w.ax < 2 && w.bx > 1)!;
  const x = (rail.ax + rail.bx) / 2;
  expect(Math.abs(resolveWalls(x, rail.az + 0.05, 0.3, 0.7, 1.8, [rail]).z - rail.az)).toBeGreaterThanOrEqual(0.299);
  support.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(4, 2.1, 0), new THREE.Vector3(0, -1, 0), 0, 0.2);
  expect(ray.intersectObject(support).some((hit) => Math.abs(hit.point.y - 2) < 0.001)).toBe(true);
  const pos = support.geometry.getAttribute("position");
  let first = false, second = false;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
    const inFirst = x >= -0.751 && x <= 4.751 && Math.abs(z) <= 0.751;
    const inSecond = Math.abs(x - 4) <= 0.751 && z <= 0.751 && z >= -4.751;
    expect(inFirst || inSecond).toBe(true);
    if (x < 3 && y > 0) first = true;
    if (z < -1 && y > 2) second = true;
  }
  expect(first && second).toBe(true);
});

it("marks a bent escalator approximate once per edge", () => {
  const station = createSyntheticBundle([syntheticEdge("bent", "start", "upper", { mode: "escalator", attributes: { sceneGap: true }, geometry: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 2 }, { x: 4, y: 4, z: 4 }] })]);
  station.nodes.find((n) => n.id === "upper")!.position = { x: 4, y: 4, z: 4 };
  const result = buildConnectors(station, () => true, { hasFloor: () => false, nearMesh: () => false }, "high");
  expect(result.stats.approximateFits).toBe(1);
});
