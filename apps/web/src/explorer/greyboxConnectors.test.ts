import { describe, expect, it } from "vitest";
import type { Edge, StationBundle } from "@gteki/schema";
import { skippedConnectorPath, unmodelledVerticalEdges } from "./greyboxConnectors.ts";
import { cumulativeLengths, resolveWalls, samplePolyline } from "./walker.ts";

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

});

import * as THREE from "three";
import { buildConnectors, buildEscalator, buildStairs, withinGreyboxBudget } from "./greyboxConnectors.ts";
import { buildConnectors as buildLegacyConnectors } from "./greyboxConnectorsLegacy.ts";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";

it("leaves elevator edges to the follow-up, including scene gaps", () => {
  const station = { ...bundle, edges: [{ ...bundle.edges[0]!, mode: "elevator", attributes: { sceneGap: true } }] } as StationBundle;
  const result = buildConnectors(station, () => true, { hasFloor: () => false, nearMesh: () => false }, "high");
  expect(result.root.children).toHaveLength(0);
  expect(result.walkable).toHaveLength(0);
  expect(result.colliders).toHaveLength(0);
});

describe("connector geometry", () => {
  const a = new THREE.Vector3(0, 0, 0), b = new THREE.Vector3(5.2, 3, 0);
  it("emits stairs and escalator parts", () => {
    const edge = bundle.edges[0]!;
    const stairs = buildStairs(a, b, 1.5, "high");
    expect(stairs.some((p) => p.material === "riser")).toBe(true);
    expect(stairs.some((p) => p.role === "walkable")).toBe(true);
    const escalator = buildEscalator(a, b, "high");
    expect(escalator.some((p) => p.material === "glass")).toBe(true);
    expect(escalator.some((p) => p.role === "collider")).toBe(true);

  });
  it("batches generated geometry and tags its meshes", () => {
    const result = buildConnectors(bundle, () => true, { hasFloor: () => false, nearMesh: () => false }, "low");
    expect(result.stats.connectors.stairs).toBe(1);
    expect(result.root.children.length).toBeLessThanOrEqual(3);
    result.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) expect(o.userData).toMatchObject({ greybox: true, connector: true, approximate: true }); });
  });
});


it("adds rendered and walkable endpoint pads only where floors are missing", () => {
  for (const mode of ["stairs", "escalator"] as const) {
    const station = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 5, y: 0, z: 3 } }], edges: [{ ...bundle.edges[0]!, mode, attributes: { sceneGap: true } }] } as StationBundle;
    const build = (missing: boolean) => buildConnectors(station, () => true, { hasFloor: (p) => !missing || p.z !== 3, nearMesh: () => false }, "high");
    const result = build(true), noPad = build(false);
    const x = 5.75;
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 3.2, 0), new THREE.Vector3(0, -1, 0), 0, 0.4);
    const ground = ray.intersectObjects(result.walkable, false);
    expect(ground[0]?.point.y).toBeCloseTo(3);
    expect(ray.intersectObjects(result.root.children, false).some((hit) => Math.abs(hit.point.y - 3) < 1e-5)).toBe(true);
    expect(ray.intersectObjects(noPad.walkable, false)).toHaveLength(0);
  }
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
    expect(steps).toHaveLength(2); // flat landings; flight tops follow the incline
    expect(high.every((v) => v.userData?.fit === "exact")).toBe(true);
    const indicators = high.filter((p) => ["lampOk", "lampNo"].includes(p.material) && Math.abs(extent(p, 2) - 0.16) < 1e-5);
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
    expect(Math.max(...p.filter((v) => v.material === "riser").at(-1)!.position.filter((_, i) => i % 3 === 1))).toBeCloseTo(3.6);
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
    const inFirst = x >= -1.501 && x <= 4.751 && Math.abs(z) <= 0.751;
    const inSecond = Math.abs(x - 4) <= 0.751 && z <= 0.751 && z >= -5.501;
    expect(inFirst || inSecond).toBe(true);
    if (x < 3 && y > 0) first = true;
    if (z < -1 && y > 2) second = true;
  }
  expect(first && second).toBe(true);
});

it("keeps the L-shaped stair path clear and guards the two outside landing edges", () => {
  for (const direction of [-1, 1]) {
    const station = createSyntheticBundle([syntheticEdge("bent", "start", "upper", { mode: "stairs", attributes: { sceneGap: true }, geometry: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 2 }, { x: 4, y: direction * 4, z: 4 }] })]);
    station.nodes.find((n) => n.id === "upper")!.position = { x: 4, y: direction * 4, z: 4 };
    const result = buildConnectors(station, () => true, { hasFloor: () => true, nearMesh: () => false }, "high");
    const path = result.pathByEdge.get("bent")!, cumulative = cumulativeLengths(path), total = cumulative.at(-1)!;
    for (let s = 0; s <= total; s += 0.05) {
      const p = samplePolyline(path, cumulative, s), resolved = resolveWalls(p.x, p.z, 0.3, p.y, 1.7, result.wallSegments);
      expect(Math.hypot(resolved.x - p.x, resolved.z - p.z), `direction=${direction}, s=${s}`).toBeLessThanOrEqual(0.05);
    }
    const outer = result.wallSegments.filter((w) => Math.abs(w.yMin - 1.88) < 1e-6 && Math.abs(w.yMax - 2.96) < 1e-6);
    expect(outer.some((w) => Math.abs(w.ax - 4.78) < 1e-6 && Math.abs(w.bx - 4.78) < 1e-6)).toBe(true);
    expect(outer.some((w) => Math.abs(w.az - direction * 0.78) < 1e-6 && Math.abs(w.bz - direction * 0.78) < 1e-6)).toBe(true);
    for (const w of outer) {
      const x = (w.ax + w.bx) / 2, z = (w.az + w.bz) / 2;
      const resolved = resolveWalls(x, z, 0.3, 2, 1.7, [w]);
      expect(Math.hypot(resolved.x - x, resolved.z - z)).toBeGreaterThan(0.29);
      const normal = new THREE.Vector3(-(w.bz - w.az), 0, w.bx - w.ax).normalize();
      const ray = new THREE.Raycaster(new THREE.Vector3(x, 2.4, z).addScaledVector(normal, 0.1), normal.negate(), 0, 0.2);
      expect(ray.intersectObjects(result.colliders).length).toBeGreaterThan(0);
    }
  }
});

it("marks a bent escalator approximate once per edge", () => {
  const station = createSyntheticBundle([syntheticEdge("bent", "start", "upper", { mode: "escalator", attributes: { sceneGap: true }, geometry: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 2 }, { x: 4, y: 4, z: 4 }] })]);
  station.nodes.find((n) => n.id === "upper")!.position = { x: 4, y: 4, z: 4 };
  const result = buildConnectors(station, () => true, { hasFloor: () => false, nearMesh: () => false }, "high");
  expect(result.stats.approximateFits).toBe(1);
});


it("renders the comb and flight at the walkable incline height in both tiers", () => {
  const station = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 5.2, y: 0, z: 1.5 } }], edges: [{ ...bundle.edges[0]!, mode: "escalator", attributes: { sceneGap: true } }] } as StationBundle;
  for (const tier of ["high", "low"] as const) {
    const result = buildConnectors(station, () => true, { hasFloor: () => true, nearMesh: () => false }, tier);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    for (let x = 0.01; x < 5.2; x += 0.1) {
      ray.ray.origin.set(x, 2.05, 0);
      const physical = ray.intersectObjects(result.walkable)[0], visible = ray.intersectObjects(result.root.children)[0];
      expect(physical).toBeDefined(); expect(visible).toBeDefined();
      expect(Math.abs(visible!.point.y - physical!.point.y)).toBeLessThan(0.02);
    }
    const lights = result.root.children.find((o) => Array.isArray((o as THREE.Mesh).material)) as THREE.Mesh;
    const materials = lights.material as THREE.MeshStandardMaterial[];
    expect(materials[1]!.emissive.getHexString()).toBe("00ff00"); expect(materials[2]!.emissive.getHexString()).toBe("ff0000");
    expect(new Set(lights.geometry.groups.map((g) => g.materialIndex))).toEqual(new Set([0, 1, 2]));
  }
});

it("routes over inserted stair landings in both directions on the walkable surface", async () => {
  const { createRouter, routePolyline } = await import("@gteki/navigation");
  const { cumulativeLengths, samplePolyline } = await import("./walker.ts");
  const station = createSyntheticBundle([syntheticEdge("flight", "start", "upper", { mode: "stairs", attributes: { sceneGap: true } })]);
  station.nodes.find((n) => n.id === "upper")!.position = { x: 7.2, y: 0, z: 3.6 };
  const result = buildConnectors(station, () => true, { hasFloor: () => true, nearMesh: () => false }, "high");
  const paths = new Map([...result.pathByEdge].map(([id, path]) => [id, path.map((p) => ({ x: p.x, y: -p.z, z: p.y }))]));
  for (const [from, to] of [["start", "upper"], ["upper", "start"]]) {
    const route = createRouter(station).route(from!, to!); expect(route.ok).toBe(true); if (!route.ok) throw new Error("missing route");
    const polyline = routePolyline(station, route, paths), points = polyline.map((p) => new THREE.Vector3(p.x, p.z, -p.y));
    const cumulative = cumulativeLengths(points), total = cumulative.at(-1)!;
    expect(points[0]!.distanceTo(new THREE.Vector3(from === "start" ? 0 : 7.2, from === "start" ? 0 : 3.6, 0))).toBeLessThan(0.05);
    expect(points.at(-1)!.distanceTo(new THREE.Vector3(to === "start" ? 0 : 7.2, to === "start" ? 0 : 3.6, 0))).toBeLessThan(0.05);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    for (let s = 0; s <= total; s += 0.25) {
      const p = samplePolyline(points, cumulative, s); ray.ray.origin.set(p.x, p.y + 0.04, p.z);
      const hit = ray.intersectObjects(result.walkable)[0]; expect(hit, `s=${s} p=${JSON.stringify(p)}`).toBeDefined();
      expect(Math.abs(hit!.point.y - p.y)).toBeLessThan(0.05);
    }
  }
});

it("builds a steep stair in place and skips edges without a usable run", () => {
  for (const mode of ["stairs", "escalator"] as const) {
    const station = createSyntheticBundle([syntheticEdge("vertical", "start", "upper", { mode, attributes: { sceneGap: true } })]);
    const upper = station.nodes.find((n) => n.id === "upper")!;
    upper.position = { x: 1, y: 0, z: 4 };
    const result = buildConnectors(station, () => true, { hasFloor: () => true, nearMesh: () => false }, "high");
    expect(result.stats.approximateFits).toBe(1); expect(result.stats.connectorsSkipped).toBe(0);
    const path = result.pathByEdge.get("vertical")!;
    expect(path.every((p) => Math.abs(p.z) < 1e-6 && p.x >= -1e-6 && p.x <= 1 + 1e-6)).toBe(true);
    expect(path.at(-1)!.x).toBeCloseTo(1); expect(path.at(-1)!.y).toBeCloseTo(4);
    if (mode === "stairs") {
      const parts = buildStairs(new THREE.Vector3(), new THREE.Vector3(1, 4, 0), 1.5, "high");
      for (const riser of parts.filter((p) => p.material === "riser")) {
        const ys = riser.position.filter((_, i) => i % 3 === 1);
        expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(0.3);
      }
    }
    upper.position = { x: 0.2, y: 0, z: 4 };
    const skipped = buildConnectors(station, () => true, { hasFloor: () => true, nearMesh: () => false }, "high");
    expect(skipped.stats.connectorsSkipped).toBe(1); expect(skipped.pathByEdge.has("vertical")).toBe(false);
    expect(skipped.root.children).toHaveLength(0); expect(skipped.walkable).toHaveLength(0);
  }
});

it("keeps rendered stair treads at or below the walkable incline", () => {
  const station = createSyntheticBundle([syntheticEdge("stairs", "start", "upper", { mode: "stairs", attributes: { sceneGap: true } })]);
  station.nodes.find((n) => n.id === "upper")!.position = { x: 7.2, y: 0, z: 3.6 };
  for (const tier of ["high", "low"] as const) {
    const result = buildConnectors(station, () => true, { hasFloor: () => true, nearMesh: () => false }, tier);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    const shell = result.root.children.find((o) => { const material = (o as THREE.Mesh).material as THREE.MeshStandardMaterial; return !Array.isArray(material) && material.vertexColors && !material.transparent; })!;
    let checked = 0;
    for (let x = 0.013; x < 7.2; x += 0.01) {
      ray.ray.origin.set(x, 10, 0); const physical = ray.intersectObjects(result.walkable)[0];
      const visible = ray.intersectObject(shell)[0];
      expect(physical).toBeDefined();
      if (!visible) continue; // Float32 tread boundaries can fall between adjacent faces.
      checked++; expect(visible.point.y - physical!.point.y).toBeLessThanOrEqual(0.010001);
    }
    expect(checked).toBeGreaterThan(700);
  }
});

/** Renderer waypoints [x, height, z] of a stair with one turn of `degrees` toward `direction` (-1 or 1); legs are 4 m long in plan. */
function stackedWaypoints(degrees: number, direction: number): [number, number, number][] {
  const angle = degrees * Math.PI / 180;
  return [[0, 0, 0], [4, 2, 0], [4 + 4 * Math.cos(angle), 4, -direction * 4 * Math.sin(angle)]];
}

/**
 * Switchbacks of 135 degrees and more: two turns with a 1.7 m flat step (flight width + 0.2 m) between them,
 * so the return flight sits beside the first one instead of stacked on it. Below 135 degrees the single turn is kept.
 */
function switchbackWaypoints(degrees: number, direction: number): [number, number, number][] {
  if (degrees < 135) return stackedWaypoints(degrees, direction);
  const angle = degrees * Math.PI / 180;
  return [[0, 0, 0], [4, 2, 0], [4, 3, 1.7 * direction], [4 + 4 * Math.cos(angle), 5, direction * (1.7 + 4 * Math.sin(angle))]];
}

/** Synthetic stair through renderer waypoints; the station frame is (x, -z, height). */
function stairThrough(waypoints: [number, number, number][]) {
  const geometry = waypoints.map(([x, h, z]) => ({ x, y: -z, z: h }));
  const station = createSyntheticBundle([syntheticEdge("turn", "start", "upper", { mode: "stairs", attributes: { sceneGap: true }, geometry })]);
  station.nodes.find((n) => n.id === "upper")!.position = { ...geometry.at(-1)! };
  return station;
}

/** Each turning landing (plan bend of 20 degrees or more): centre (x, z), height, and the plan unit directions of its two flights, pointing away from the centre. */
function landingsOf(waypoints: [number, number, number][]) {
  return waypoints.slice(1, -1).map(([x, h, z], index) => {
    const centre = new THREE.Vector2(x, z);
    const before = new THREE.Vector2(waypoints[index]![0], waypoints[index]![2]).sub(centre).normalize();
    const after = new THREE.Vector2(waypoints[index + 2]![0], waypoints[index + 2]![2]).sub(centre).normalize();
    return { centre, height: h, flights: [before, after], bend: Math.PI - before.angleTo(after) };
  }).filter((landing) => landing.bend >= 20 * Math.PI / 180 - 1e-9);
}

/** Two 90 degree turns 0.5 m apart: an S-shaped stair whose two landing squares overlap. */
function closeS(direction: number): [number, number, number][] {
  const base: [number, number, number][] = [[0, 0, 0], [4, 2, 0], [4, 2.5, -0.5], [8, 4.5, -0.5]];
  return base.map(([x, h, z]): [number, number, number] => [x, h, direction * z]);
}
/**
 * A 0.78 m flat step, then a rise away from the landing: the two landing squares are equal, sit level and overlap by half, with
 * flush outer edges on x = 4.78 (the step runs toward -z). The second flight leaves the x = 4.78 edge over z in [-1.54, -0.02].
 */
function equalSquaresWaypoints(direction: number): [number, number, number][] {
  const base: [number, number, number][] = [[0, 0, 0], [4, 2, 0], [4, 2, -0.78], [8, 4, -0.78]];
  return base.map(([x, h, z]): [number, number, number] => [x, h, direction * z]);
}
/** Mirror renderer waypoints [x, height, z] across the plan's x axis when `direction` is -1. */
function mirror(waypoints: [number, number, number][], direction: number): [number, number, number][] {
  return waypoints.map(([x, h, z]): [number, number, number] => [x, h, direction * z]);
}
/** A 90 degree turn after three 10 degree bends 0.6 m apart, all turning the same way. */
function shallowThenTurn(direction: number): [number, number, number][] {
  const deg = (d: number) => (d * Math.PI) / 180;
  const headings = [0, 10, 20, 30, 120], lengths = [0.6, 0.6, 0.6, 0.6, 4], heights = [0, 0.2, 0.4, 0.6, 0.8, 2.8];
  const pts: [number, number, number][] = [[0, 0, 0]];
  let x = 0, z = 0;
  headings.forEach((heading, i) => { x += lengths[i]! * Math.cos(deg(heading)); z += lengths[i]! * Math.sin(deg(heading)); pts.push([x, heights[i + 1]!, z]); });
  return mirror(pts, direction);
}
/** #640 r17: shallow bends before a 90 degree landing; the landing opening would follow only the last bent segment. */
function bentLegThenTurn(direction: number): [number, number, number][] {
  const deg = (d: number) => (d * Math.PI) / 180;
  const headings = [0, 19, 38, -52], lengths = [4, 0.35, 0.35, 4], heights = [0, 2, 2.15, 2.3, 4.3];
  const pts: [number, number, number][] = [[0, 0, 0]];
  let x = 0, z = 0;
  headings.forEach((heading, i) => { x += lengths[i]! * Math.cos(deg(heading)); z += lengths[i]! * Math.sin(deg(heading)); pts.push([x, heights[i + 1]!, z]); });
  return mirror(pts, direction);
}
/** One turning landing of a supported shape, mirrored for each direction. */
const singleTurnCases = [15, 45, 90].flatMap((degrees) => [-1, 1].map((direction) => ({ name: `single ${degrees} degree turn, direction=${direction}`, waypoints: stackedWaypoints(degrees, direction) })));
/** #673 r1: four 90 degree turns; the last flight crosses the first landing's square in plan, about 4.3 m above it. */
function overFirstLanding(direction: number): [number, number, number][] {
  return mirror([[0, 0, 0], [4, 1, 0], [4, 2, 4], [-4, 3, 4], [-4, 4, 0], [8, 6, 0]], direction);
}
/** #673 r3: one revolution of 15 degree bends on a 2 m radius rising 4.8 m, then a turning landing into a 4 m leg. */
function spiral(direction: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let deg = 0; deg <= 360; deg += 15) { const t = (deg * Math.PI) / 180; pts.push([2 * Math.sin(t), (4.8 * deg) / 360, 2 * (1 - Math.cos(t))]); }
  pts.push([pts.at(-1)![0], 5.5, pts.at(-1)![2] - 4]);
  return mirror(pts, direction);
}
/** A single 45 degree turn whose outgoing leg is only 1.05 m long (#668 r19). */
function shortOutgoingLeg(direction: number): [number, number, number][] {
  const run = 1.05, angle = Math.PI / 4;
  return mirror([[0, 0, 0], [4, 2, 0], [4 + run * Math.cos(angle), 2.5, -run * Math.sin(angle)]], direction);
}
/** Shapes with several turning landings or shallow bends, which the general landing guard builds (#668). */
const multiTurnCases = ([
  { name: "U-turn", waypoints: (d: number) => mirror([[0, 0, 0], [4, 1, 0], [4, 2, -2], [0, 3, -2]], d) },
  { name: "switchback 180 degrees", waypoints: (d: number) => switchbackWaypoints(180, d) },
  { name: "switchback 135 degrees (a 45 degree landing)", waypoints: (d: number) => switchbackWaypoints(135, d) },
  { name: "19 degree bends on the leg into a 90 degree landing (safe path, #640 r17)", waypoints: (d: number) => bentLegThenTurn(d) },
] as const).flatMap((shape) => [-1, 1].map((direction) => ({ name: `${shape.name}, direction=${direction}`, waypoints: shape.waypoints(direction) })));
/** Every stair with a turning landing whose guard the property tests check. */
const guardedCases = [...singleTurnCases, ...multiTurnCases];
/** Shapes outside the supported set (overlapping landings, sharp returns, flights crossing or walls cutting). */
const unsupportedShapes: { name: string; waypoints: (direction: number) => [number, number, number][] }[] = [
  { name: "two 90 degree turns 0.5 m apart", waypoints: (d) => closeS(d) },
  { name: "two equal overlapping landing squares", waypoints: (d) => equalSquaresWaypoints(d) },
  { name: "landings 3 m apart vertically", waypoints: (d) => mirror([[0, 0, 0], [4, 2, 0], [4, 5, -0.5], [8, 7, -0.5]], d) },
  { name: "flight crossing a non-adjacent landing at 1 m", waypoints: (d) => mirror([[0, 0, 0], [4, 1, 0], [4, 1.2, 4], [2, 1.5, 0], [2, 2, -4]], d) },
  { name: "stacked non-adjacent flights", waypoints: (d) => mirror([[0, 0, 0], [4, 2, 0], [4, 2.2, 1.0], [0, 2.6, 1.0]], d) },
  { name: "three 10 degree bends 0.6 m apart and a 90 degree turn", waypoints: (d) => shallowThenTurn(d) },
  { name: "four 90 degree turns, the last flight passing 4.3 m over the first landing (#673 r1)", waypoints: (d) => overFirstLanding(d) },
  { name: "a spiral of 15 degree bends whose lower turns pass under its top landing (#673 r3)", waypoints: (d) => spiral(d) },
  { name: "two 90 degree landings 1.2 m apart whose squares overlap (#673 r1)", waypoints: (d) => mirror([[0, 0, 0], [4, 2, 0], [4, 2.5, -1.2], [8, 4.5, -1.2]], d) },
  { name: "single-vertex 135 degree sharp return", waypoints: (d) => stackedWaypoints(135, d) },
  { name: "single-vertex 165 degree sharp return", waypoints: (d) => stackedWaypoints(165, d) },
  { name: "single 100 degree turn whose inner wall crosses the next flight", waypoints: (d) => stackedWaypoints(100, d) },
];
const unsupportedCases = unsupportedShapes.flatMap((shape) => [-1, 1].map((direction) => ({ name: `${shape.name}, direction=${direction}`, waypoints: shape.waypoints(direction) })));

describe("turning landing guards", () => {
  const flat = { hasFloor: () => true, nearMesh: () => false };
  const half = 1.5 / 2 + 0.03;
  const insideLanding = (p: THREE.Vector2, landing: { centre: THREE.Vector2; flights: THREE.Vector2[] }) => {
    const axis = landing.flights[0]!.clone().negate(), across = new THREE.Vector2(-axis.y, axis.x), rel = p.clone().sub(landing.centre);
    return Math.abs(rel.dot(axis)) <= half + 1e-6 && Math.abs(rel.dot(across)) <= half + 1e-6;
  };

  it("stops a walker leaving any turning landing except through a flight opening", () => {
    for (const { name, waypoints } of guardedCases) {
      const result = buildConnectors(stairThrough(waypoints), () => true, flat, "high");
      const landings = landingsOf(waypoints);
      for (const landing of landings) {
        const { centre, height, flights } = landing;
        const axis = flights[0]!.clone().negate(), normal = new THREE.Vector2(-axis.y, axis.x);
        for (let k = 0; k < 36; k++) {
          const heading = k * Math.PI / 18, dir = new THREE.Vector2(Math.cos(heading), Math.sin(heading));
          // The ray leaves the square at `r`; it passes an opening when that exit lies inside a flight's footprint.
          const r = half / Math.max(Math.abs(dir.dot(axis)), Math.abs(dir.dot(normal)));
          const exit = dir.clone().multiplyScalar(r);
          if (flights.some((u) => exit.dot(u) > 1e-6 && Math.abs(exit.x * u.y - exit.y * u.x) < half - 1e-6)) continue;
          // Where two landings overlap, an exit inside the other square is open into it, not a gap.
          const absolute = centre.clone().add(exit);
          if (landings.some((other) => other !== landing && insideLanding(absolute, other))) continue;
          let stopped = false;
          for (let step = 1; step <= 50 && !stopped; step++) {
            const x = centre.x + dir.x * 0.03 * step, z = centre.y + dir.y * 0.03 * step;
            const resolved = resolveWalls(x, z, 0.3, height, 1.7, result.wallSegments);
            if (Math.hypot(resolved.x - x, resolved.z - z) > 0.05) stopped = true;
          }
          expect(stopped, `${name} landing=(${centre.x}, ${centre.y}) heading=${k * 10}`).toBe(true);
        }
      }
    }
  });

  it("lets a centreline walker and a walker 0.5 m off centre pass bottom to top", () => {
    for (const { name, waypoints } of guardedCases) {
      const result = buildConnectors(stairThrough(waypoints), () => true, flat, "high");
      const path = result.pathByEdge.get("turn")!, cumulative = cumulativeLengths(path), total = cumulative.at(-1)!;
      const bendS = waypoints.slice(1, -1).map(([x, h, z]) => cumulative[path.findIndex((p) => Math.hypot(p.x - x, p.y - h, p.z - z) < 1e-6)]!);
      for (const offset of [-0.5, 0, 0.5]) for (let s = 0; s <= total; s += 0.05) {
        const p = samplePolyline(path, cumulative, s);
        const leg = bendS.filter((b) => s > b).length;
        const [x0, , z0] = waypoints[leg]!, [x1, , z1] = waypoints[leg + 1]!;
        const length = Math.hypot(x1 - x0, z1 - z0);
        // Offsets fade to the centreline at each turn and grow again along the next flight.
        const amount = offset * Math.min(1, Math.min(...bendS.map((b) => Math.abs(s - b))) / 0.75);
        const x = p.x - (z1 - z0) / length * amount, z = p.z + (x1 - x0) / length * amount;
        const resolved = resolveWalls(x, z, 0.3, p.y, 1.7, result.wallSegments);
        expect(Math.hypot(resolved.x - x, resolved.z - z), `${name} offset=${offset} s=${s}`).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it("keeps every landing guard segment within the landing's diagonal", () => {
    const diagonal = 2 * half * Math.SQRT2;
    for (const { name, waypoints } of guardedCases) {
      const result = buildConnectors(stairThrough(waypoints), () => true, flat, "high");
      const heights = landingsOf(waypoints).map((landing) => landing.height);
      if (heights.length === 0) continue; // only shallow bends: no landing guard to check
      const guards = result.wallSegments.filter((w) => heights.some((h) => Math.abs(w.yMin - (h - 0.12)) < 1e-6 && Math.abs(w.yMax - (h + 0.96)) < 1e-6));
      expect(guards.length, name).toBeGreaterThan(0);
      for (const w of guards) expect(Math.hypot(w.bx - w.ax, w.bz - w.az), name).toBeLessThanOrEqual(diagonal + 1e-6);
    }
  });

  // #673 r2: a steep flight is still the landing's own flight, so its entrance stays open.
  it("leaves a steep flight's entrance to its landing open", () => {
    for (const direction of [-1, 1]) {
      const waypoints = mirror([[0, 0, 0], [4, 3.2, 0], [4, 4, 4]], direction);
      const result = buildConnectors(stairThrough(waypoints), () => true, flat, "high");
      expect(result.stats.legacyConnectors).toBe(0);
      // Walk the incoming flight's centreline up onto the landing: nothing may push the walker aside.
      for (let x = 2.5; x <= 4; x += 0.05) {
        const y = 3.2 * x / 4, resolved = resolveWalls(x, 0, 0.3, y, 1.7, result.wallSegments);
        expect(Math.hypot(resolved.x - x, resolved.z), `direction=${direction} x=${x.toFixed(2)}`).toBeLessThanOrEqual(0.05);
      }
    }
  });

  // #668 r19: the opening follows each flight's own leg length, not the landing square's extent, so the guard closes the
  // corner a 45 degree flight of 1.05 m never reaches.
  it("stops a walker at every landing exit past the end of a short outgoing flight", () => {
    const legLengths = [4, 1.05];
    for (const direction of [-1, 1]) {
      const waypoints = shortOutgoingLeg(direction);
      const result = buildConnectors(stairThrough(waypoints), () => true, flat, "high");
      expect(result.stats.connectorsSkippedByReason.unsupported_shape, `direction=${direction}`).toBe(0);
      const { centre, height, flights } = landingsOf(waypoints)[0]!;
      const axis = flights[0]!.clone().negate(), normal = new THREE.Vector2(-axis.y, axis.x);
      let outside = 0;
      for (let k = 0; k < 36; k++) {
        const heading = (k * Math.PI) / 18, dir = new THREE.Vector2(Math.cos(heading), Math.sin(heading));
        const r = half / Math.max(Math.abs(dir.dot(axis)), Math.abs(dir.dot(normal)));
        const exit = dir.clone().multiplyScalar(r);
        // An exit inside a flight's real footprint, no further than that flight's own leg reaches, is a walking opening.
        if (flights.some((u, i) => exit.dot(u) > 1e-6 && exit.dot(u) <= legLengths[i]! && Math.abs(exit.x * u.y - exit.y * u.x) < half - 1e-6)) continue;
        outside++;
        let stopped = false;
        for (let step = 1; step <= 50 && !stopped; step++) {
          const x = centre.x + dir.x * 0.03 * step, z = centre.y + dir.y * 0.03 * step;
          const resolved = resolveWalls(x, z, 0.3, height, 1.7, result.wallSegments);
          if (Math.hypot(resolved.x - x, resolved.z - z) > 0.05) stopped = true;
        }
        expect(stopped, `direction=${direction} heading=${k * 10}`).toBe(true);
      }
      expect(outside, `direction=${direction}`).toBeGreaterThan(0);
    }
  });

  it("guards the landing outline beyond the end of a short angled flight", () => {
    const legLengths = [4, 1.05];
    for (const direction of [-1, 1]) {
      const waypoints = shortOutgoingLeg(direction);
      const result = buildConnectors(stairThrough(waypoints), () => true, flat, "high");
      expect(result.stats.connectorsSkippedByReason.unsupported_shape, `direction=${direction}`).toBe(0);
      const { centre, flights } = landingsOf(waypoints)[0]!;
      const d = flights[0]!.clone().negate(), n = new THREE.Vector2(-d.y, d.x);
      const corner = (along: number, across: number) => centre.clone().addScaledVector(d, along * half).addScaledVector(n, across * half);
      const sides: [THREE.Vector2, THREE.Vector2][] = [
        [corner(-1, 1), corner(-1, -1)], [corner(1, -1), corner(1, 1)], [corner(-1, -1), corner(1, -1)], [corner(1, 1), corner(-1, 1)],
      ];
      for (const [a, b] of sides) {
        const run = b.clone().sub(a);
        // The parameter spans of this side that a wall lies on: every landing guard runs exactly along the outline.
        const guards = result.wallSegments.flatMap((w): [number, number][] => {
          const p = new THREE.Vector2(w.ax, w.az), q = new THREE.Vector2(w.bx, w.bz);
          const tp = p.clone().sub(a).dot(run) / run.lengthSq(), tq = q.clone().sub(a).dot(run) / run.lengthSq();
          const offP = p.clone().sub(a).addScaledVector(run, -tp).length(), offQ = q.clone().sub(a).addScaledVector(run, -tq).length();
          return offP < 1e-3 && offQ < 1e-3 ? [[Math.min(tp, tq), Math.max(tp, tq)]] : [];
        });
        for (let k = 0; k <= 200; k++) {
          const t = k / 200, p = a.clone().lerp(b, t).sub(centre);
          // A walker steps off the landing only where a flight's own leg reaches the outline; past the leg's end it is a drop.
          if (flights.some((u, i) => p.dot(u) > 1e-6 && p.dot(u) <= legLengths[i]! + 0.02 && Math.abs(p.x * u.y - p.y * u.x) < half + 1e-6)) continue;
          const guarded = guards.some(([lo, hi]) => t >= lo - 1e-6 && t <= hi + 1e-6);
          expect(guarded, `direction=${direction} unguarded outline point (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`).toBe(true);
        }
      }
    }
  });

  it("builds a stair with two 10 degree bends 0.5 m apart and lets both walkers pass", () => {
    const a = (10 * Math.PI) / 180, b = (20 * Math.PI) / 180;
    const p2: [number, number, number] = [4 + 0.5 * Math.cos(a), 2.5, 0.5 * Math.sin(a)];
    const shallow: [number, number, number][] = [[0, 0, 0], [4, 2, 0], p2, [p2[0] + 4 * Math.cos(b), 4.5, p2[2] + 4 * Math.sin(b)]];
    for (const direction of [-1, 1]) {
      const waypoints = shallow.map(([x, h, z]): [number, number, number] => [x, h, direction * z]);
      const result = buildConnectors(stairThrough(waypoints), () => true, flat, "high");
      expect(result.stats.connectorsSkipped, `direction=${direction}`).toBe(0);
      const path = result.pathByEdge.get("turn")!, cumulative = cumulativeLengths(path), total = cumulative.at(-1)!;
      const bendS = waypoints.slice(1, -1).map(([x, h, z]) => cumulative[path.findIndex((q) => Math.hypot(q.x - x, q.y - h, q.z - z) < 1e-6)]!);
      for (const offset of [-0.5, 0, 0.5]) for (let s = 0; s <= total; s += 0.05) {
        const q = samplePolyline(path, cumulative, s);
        const leg = bendS.filter((bs) => s > bs).length;
        const [x0, , z0] = waypoints[leg]!, [x1, , z1] = waypoints[leg + 1]!;
        const length = Math.hypot(x1 - x0, z1 - z0);
        const x = q.x - (z1 - z0) / length * offset, z = q.z + (x1 - x0) / length * offset;
        const resolved = resolveWalls(x, z, 0.3, q.y, 1.7, result.wallSegments);
        expect(Math.hypot(resolved.x - x, resolved.z - z), `direction=${direction} offset=${offset} s=${s}`).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it("keeps every landing guard off the flights, in every stair", () => {
    for (const { name, waypoints } of singleTurnCases) {
      const result = buildConnectors(stairThrough(waypoints), () => true, flat, "high");
      const heights = landingsOf(waypoints).map((landing) => landing.height);
      const legs = waypoints.slice(1).map((p, i) => {
        const a = waypoints[i]!, run = new THREE.Vector2(p[0] - a[0], p[2] - a[2]);
        return { origin: new THREE.Vector2(a[0], a[2]), dir: run.clone().normalize(), length: run.length() };
      }).filter((leg) => leg.length > 1e-6);
      const guards = result.wallSegments.filter((w) => heights.some((h) => Math.abs(w.yMin - (h - 0.12)) < 1e-6 && Math.abs(w.yMax - (h + 0.96)) < 1e-6));
      for (const w of guards) for (let t = 0; t <= 1; t += 0.01) {
        const p = new THREE.Vector2(w.ax + (w.bx - w.ax) * t, w.az + (w.bz - w.az) * t);
        for (const leg of legs) {
          const rel = p.clone().sub(leg.origin);
          const along = rel.dot(leg.dir), lateral = Math.abs(rel.x * leg.dir.y - rel.y * leg.dir.x);
          // The flight's own half width, 1 cm in: a guard piece starts exactly on that edge.
          const crosses = along > 0.05 && along < leg.length - 0.05 && lateral < half - 0.04;
          expect(crosses, `${name} guard (${w.ax}, ${w.az})-(${w.bx}, ${w.bz}) at (${p.x}, ${p.y})`).toBe(false);
        }
      }
    }
  });

  it("never builds two guard segments on the same stretch of a line", () => {
    for (const { name, waypoints } of singleTurnCases) {
      const result = buildConnectors(stairThrough(waypoints), () => true, flat, "high");
      const heights = landingsOf(waypoints).map((landing) => landing.height);
      const guards = result.wallSegments.filter((w) => heights.some((h) => Math.abs(w.yMin - (h - 0.12)) < 1e-6 && Math.abs(w.yMax - (h + 0.96)) < 1e-6));
      for (let i = 0; i < guards.length; i++) for (let j = i + 1; j < guards.length; j++) {
        const u = guards[i]!, v = guards[j]!;
        const du = new THREE.Vector2(u.bx - u.ax, u.bz - u.az), dv = new THREE.Vector2(v.bx - v.ax, v.bz - v.az);
        if (du.length() < 1e-9 || dv.length() < 1e-9) continue;
        const unit = du.clone().normalize();
        const parallel = Math.abs(unit.x * dv.clone().normalize().y - unit.y * dv.clone().normalize().x) < 1e-9;
        if (!parallel) continue;
        const offset = new THREE.Vector2(v.ax - u.ax, v.az - u.az);
        if (Math.abs(unit.x * offset.y - unit.y * offset.x) > 1e-6) continue;
        const t = (q: THREE.Vector2) => q.dot(unit);
        const overlap = Math.min(t(new THREE.Vector2(u.ax, u.az)), t(new THREE.Vector2(u.bx, u.bz))) >= 0 ? 0 : 0;
        const a0 = Math.min(t(new THREE.Vector2(u.ax, u.az)), t(new THREE.Vector2(u.bx, u.bz))), a1 = Math.max(t(new THREE.Vector2(u.ax, u.az)), t(new THREE.Vector2(u.bx, u.bz)));
        const b0 = Math.min(t(new THREE.Vector2(v.ax, v.az)), t(new THREE.Vector2(v.bx, v.bz))), b1 = Math.max(t(new THREE.Vector2(v.ax, v.az)), t(new THREE.Vector2(v.bx, v.bz)));
        expect(Math.min(a1, b1) - Math.max(a0, b0) - overlap <= 1e-6, `${name} duplicate guard (${u.ax}, ${u.az})-(${u.bx}, ${u.bz}) and (${v.ax}, ${v.az})-(${v.bx}, ${v.bz})`).toBe(true);
      }
    }
  });

  it("builds a normal 90 degree landing turn in both directions", () => {
    for (const direction of [-1, 1]) {
      const turn: [number, number, number][] = [[0, 0, 0], [4, 2, 0], [4, 4, 4]];
      const waypoints = turn.map(([x, h, z]): [number, number, number] => [x, h, direction * z]);
      const result = buildConnectors(stairThrough(waypoints), () => true, flat, "high");
      expect(result.stats.connectorsSkipped, `direction=${direction}`).toBe(0);
      expect(result.pathByEdge.has("turn")).toBe(true);
    }
  });

  // A 90 degree landing: the outline is open only where each flight enters, at that flight's width, and solid elsewhere.
  it("opens a 90 degree landing's outline only where each flight enters, and is solid elsewhere", () => {
    const result = buildConnectors(stairThrough([[0, 0, 0], [4, 2, 0], [4, 4, 4]]), () => true, flat, "high");
    const guards = result.wallSegments.filter((w) => Math.abs(w.yMin - 1.88) < 1e-6 && Math.abs(w.yMax - 2.96) < 1e-6);
    const covered = (x: number, z: number) => guards.some((w) => {
      const dx = w.bx - w.ax, dz = w.bz - w.az, length2 = dx * dx + dz * dz;
      const t = THREE.MathUtils.clamp(((x - w.ax) * dx + (z - w.az) * dz) / length2, 0, 1);
      return Math.hypot(x - (w.ax + dx * t), z - (w.az + dz * t)) < 0.01;
    });
    // The approach enters on x = 3.22 over z in (-0.75, 0.75); the departure leaves on z = 0.78 over x in (3.25, 4.75).
    const solid: [number, number][] = [[4.78, 0.5], [4.78, -0.5], [3.5, -0.78], [4.5, -0.78]], open: [number, number][] = [[3.22, 0], [3.22, -0.4], [3.5, 0.78], [4.5, 0.78]];
    for (const [x, z] of solid) expect(covered(x, z), `solid ${x},${z}`).toBe(true);
    for (const [x, z] of open) expect(covered(x, z), `open ${x},${z}`).toBe(false);
  });

  // The same 90 degree landing turned by 30 and 45 degrees: openings sit on each flight's centreline, solid elsewhere.
  it.each([0, 30, 45])("opens a 90 degree landing turned by %d degrees only where each flight enters", (degrees) => {
    const angle = (degrees * Math.PI) / 180, c = Math.cos(angle), sn = Math.sin(angle);
    const rotate = ([x, h, z]: [number, number, number]): [number, number, number] => [x * c - z * sn, h, x * sn + z * c];
    const waypoints = ([[0, 0, 0], [4, 2, 0], [4, 4, 4]] as [number, number, number][]).map(rotate);
    const result = buildConnectors(stairThrough(waypoints), () => true, flat, "high");
    expect(result.stats.connectorsSkipped).toBe(0);
    const guards = result.wallSegments.filter((w) => Math.abs(w.yMin - 1.88) < 1e-6 && Math.abs(w.yMax - 2.96) < 1e-6);
    const covered = (x: number, z: number) => guards.some((w) => {
      const dx = w.bx - w.ax, dz = w.bz - w.az, length2 = dx * dx + dz * dz;
      const t = THREE.MathUtils.clamp(((x - w.ax) * dx + (z - w.az) * dz) / length2, 0, 1);
      return Math.hypot(x - (w.ax + dx * t), z - (w.az + dz * t)) < 0.01;
    });
    // Square frame: centre C, axis u along leg 0, v across it. Leg 0 enters on -u, leg 1 leaves on +v (both at their centrelines).
    const C = new THREE.Vector2(waypoints[1]![0], waypoints[1]![2]);
    const u = new THREE.Vector2(c, sn), v = new THREE.Vector2(-sn, c);
    const point = (along: number, across: number) => C.clone().addScaledVector(u, along).addScaledVector(v, across);
    const h = 0.78;
    for (const [x, z] of [point(-h, 0), point(0, h)].map((p) => [p.x, p.y])) expect(covered(x!, z!), `open entry ${degrees}`).toBe(false);
    for (const offset of [-0.5, 0, 0.5]) {
      const solid = [point(h, offset), point(offset, -h)];
      for (const p of solid) expect(covered(p.x, p.y), `solid ${degrees} offset=${offset}`).toBe(true);
    }
  });

  // A repeated corner and a point on the straight line between its neighbours do not hide the turn.
  it("builds a 90 degree turn with a repeated corner and a collinear point, with its landing guard", () => {
    const result = buildConnectors(stairThrough([[0, 0, 0], [2, 1, 0], [4, 2, 0], [4, 2, 0], [4, 4, 4]]), () => true, flat, "high");
    expect(result.stats.connectorsSkipped).toBe(0);
    const guards = result.wallSegments.filter((w) => Math.abs(w.yMin - 1.88) < 1e-6 && Math.abs(w.yMax - 2.96) < 1e-6);
    expect(guards.length).toBeGreaterThan(0);
  });

  // A skipped stair's route path: end heights come from its floors (z null on the nodes), middle heights are interpolated.
  it("gives a skipped stair's route path its end heights from the floors and interpolates the middle", () => {
    const floorsBundle = {
      floors: [{ id: "lower", renderElevationM: 0 }, { id: "upper", renderElevationM: 4 }],
      nodes: [{ id: "a", floorId: "lower", position: { x: 0, y: 0, z: null } }, { id: "b", floorId: "upper", position: { x: 10, y: 0, z: null } }],
      edges: [{ id: "s", from: "a", to: "b", mode: "stairs", geometry: [{ x: 0, y: 0, z: null }, { x: 5, y: 0, z: null }, { x: 10, y: 0, z: null }] }],
    } as unknown as StationBundle;
    const path = skippedConnectorPath(floorsBundle, floorsBundle.edges[0] as unknown as Edge);
    expect(path.map((p) => p.z)).toEqual([0, 2, 4]);
    expect(path.map((p) => p.x)).toEqual([0, 5, 10]);
  });

  it("does not list an unsupported shape in skippedEdgeIds: main's builder builds it (#640 r18)", () => {
    const result = buildConnectors(stairThrough(closeS(1)), () => true, flat, "high");
    expect(result.skippedEdgeIds).toEqual([]);
    expect(result.stats.legacyConnectors).toBe(1);
  });

  // Every shape outside the supported set is built exactly as main builds it today (#640 r18 ruling; its clipping is #668).
  const positions = (objects: readonly THREE.Object3D[]) => objects.map((o) => Array.from(((o as THREE.Mesh).geometry.getAttribute("position").array as Float32Array)));
  it.each(unsupportedCases)("builds $name with main's legacy builder, unchanged", ({ waypoints }) => {
    for (const tier of ["high", "low"] as const) {
      const result = buildConnectors(stairThrough(waypoints), () => true, flat, tier);
      const legacy = buildLegacyConnectors(stairThrough(waypoints), () => true, flat, tier);
      expect(result.stats.connectorsSkippedByReason.unsupported_shape).toBe(1);
      expect(result.stats.legacyConnectors).toBe(1);
      expect(result.root.children.length).toBeGreaterThan(0);
      expect(positions(result.root.children)).toEqual(positions(legacy.root.children));
      expect(positions(result.walkable)).toEqual(positions(legacy.walkable));
      expect(positions(result.colliders)).toEqual(positions(legacy.colliders));
      expect(result.wallSegments).toEqual(legacy.wallSegments);
      expect([...result.pathByEdge]).toEqual([...legacy.pathByEdge]);
      expect(result.stats.triangles).toBe(legacy.stats.triangles);
    }
  });

  // A straight flight is built.
  it("builds a straight stair in both directions", () => {
    for (const direction of [-1, 1]) {
      const result = buildConnectors(stairThrough(mirror([[0, 0, 0], [4, 2, 0]], direction)), () => true, flat, "high");
      expect(result.stats.connectorsSkipped, `direction=${direction}`).toBe(0);
      expect(result.pathByEdge.has("turn")).toBe(true);
    }
  });

});

