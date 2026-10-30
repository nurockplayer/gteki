import { describe, expect, it } from "vitest";
import type { StationBundle } from "@gteki/schema";
import { unmodelledVerticalEdges } from "./greyboxConnectors.ts";
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
 * Turns from 135 degrees up return past the first flight, so their flights would stack in plan with about 1 m of headroom.
 * Those layouts step 1.7 m (flight width + 0.2 m) sideways at a short second leg before the final leg, so the flights sit side by side.
 */
function turningWaypoints(degrees: number, direction: number): [number, number, number][] {
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

const zigzag: [number, number, number][] = [[0, 0, 0], [4, 2, 0], [4, 4, -4], [8, 6, -4]];
const turnCases = [
  ...[15, 45, 90, 135, 165, 180].flatMap((degrees) => [-1, 1].map((direction) => ({ name: `${degrees} degrees, direction=${direction}`, waypoints: turningWaypoints(degrees, direction) }))),
  ...[-1, 1].map((direction) => ({ name: `two consecutive 90 degree turns, direction=${direction}`, waypoints: zigzag.map(([x, h, z]): [number, number, number] => [x, h, direction * z]) })),
];

describe("turning landing guards", () => {
  const flat = { hasFloor: () => true, nearMesh: () => false };
  const half = 1.5 / 2 + 0.03;

  it("stops a walker leaving any turning landing except through a flight opening", () => {
    for (const { name, waypoints } of turnCases) {
      const result = buildConnectors(stairThrough(waypoints), () => true, flat, "high");
      for (const { centre, height, flights } of landingsOf(waypoints)) {
        const axis = flights[0]!.clone().negate(), normal = new THREE.Vector2(-axis.y, axis.x);
        for (let k = 0; k < 36; k++) {
          const heading = k * Math.PI / 18, dir = new THREE.Vector2(Math.cos(heading), Math.sin(heading));
          // The ray leaves the square at `r`; it passes an opening when that exit lies inside a flight's footprint.
          const r = half / Math.max(Math.abs(dir.dot(axis)), Math.abs(dir.dot(normal)));
          const exit = dir.clone().multiplyScalar(r);
          if (flights.some((u) => exit.dot(u) > 1e-6 && Math.abs(exit.x * u.y - exit.y * u.x) < half - 1e-6)) continue;
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
    for (const { name, waypoints } of turnCases) {
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
    for (const { name, waypoints } of turnCases) {
      const result = buildConnectors(stairThrough(waypoints), () => true, flat, "high");
      const heights = landingsOf(waypoints).map((landing) => landing.height);
      if (heights.length === 0) continue; // only shallow bends: no landing guard to check
      const guards = result.wallSegments.filter((w) => heights.some((h) => Math.abs(w.yMin - (h - 0.12)) < 1e-6 && Math.abs(w.yMax - (h + 0.96)) < 1e-6));
      expect(guards.length, name).toBeGreaterThan(0);
      for (const w of guards) expect(Math.hypot(w.bx - w.ax, w.bz - w.az), name).toBeLessThanOrEqual(diagonal + 1e-6);
    }
  });

  it("builds every turn, including 180 degree switchbacks and consecutive turns, without skipping", () => {
    for (const { name, waypoints } of turnCases) {
      const result = buildConnectors(stairThrough(waypoints), () => true, flat, "high");
      expect(result.stats.connectorsSkipped, name).toBe(0);
      expect(result.stats.connectors.stairs, name).toBe(1);
      expect(result.pathByEdge.has("turn"), name).toBe(true);
    }
  });

  // Unwalkable stacked layout: the 135 degree return passes over the first flight with under 2.1 m of headroom,
  // so a 1.7 m body cannot walk under it. Whatever the construction does there must not leave an open gap.
  it("guards or skips a stacked return where two flights overlap in plan with under 2.1 m of headroom", () => {
    for (const direction of [-1, 1]) {
      const result = buildConnectors(stairThrough(stackedWaypoints(135, direction)), () => true, flat, "high");
      if (result.stats.connectorsSkipped === 1) {
        expect(result.root.children).toHaveLength(0);
        expect(result.wallSegments).toHaveLength(0);
        continue;
      }
      const path = result.pathByEdge.get("turn")!, cumulative = cumulativeLengths(path), total = cumulative.at(-1)!;
      let blocked = false;
      for (let s = 0; s <= total && !blocked; s += 0.05) {
        const p = samplePolyline(path, cumulative, s);
        const resolved = resolveWalls(p.x, p.z, 0.3, p.y, 1.7, result.wallSegments);
        if (Math.hypot(resolved.x - p.x, resolved.z - p.z) > 0.05) blocked = true;
      }
      expect(blocked, `direction=${direction}`).toBe(true);
    }
  });

  it("builds two landings that overlap in plan when they are 3 m apart vertically", () => {
    for (const direction of [-1, 1]) {
      const tall: [number, number, number][] = [[0, 0, 0], [4, 2, 0], [4, 5, -0.5], [8, 7, -0.5]];
      const waypoints = tall.map(([x, h, z]): [number, number, number] => [x, h, direction * z]);
      const result = buildConnectors(stairThrough(waypoints), () => true, flat, "high");
      expect(result.stats.connectorsSkipped, `direction=${direction}`).toBe(0);
      expect(result.pathByEdge.has("turn")).toBe(true);
    }
  });

  // Shallow bends are walked as one continuous flight: no landing square or guard, so the flights' mitred walls keep the passage clear.
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

  // Two turning landings whose squares overlap would let one guard cut the other's flight, so the stair gets no connector.
  it("skips a stair whose two turning landings are 0.5 m apart, with no walls, and still builds the distant zigzag", () => {
    const close: [number, number, number][] = [[0, 0, 0], [4, 2, 0], [4, 2.5, -0.5], [8, 4.5, -0.5]];
    for (const direction of [-1, 1]) {
      const mirrored = close.map(([x, h, z]): [number, number, number] => [x, h, direction * z]);
      const result = buildConnectors(stairThrough(mirrored), () => true, flat, "high");
      expect(result.stats.connectorsSkipped, `direction=${direction}`).toBe(1);
      expect(result.root.children).toHaveLength(0);
      expect(result.walkable).toHaveLength(0);
      expect(result.colliders).toHaveLength(0);
      expect(result.wallSegments).toHaveLength(0);
      expect(result.pathByEdge.has("turn")).toBe(false);
      const far = buildConnectors(stairThrough(zigzag.map(([x, h, z]): [number, number, number] => [x, h, direction * z])), () => true, flat, "high");
      expect(far.stats.connectorsSkipped, `zigzag direction=${direction}`).toBe(0);
      expect(far.pathByEdge.has("turn")).toBe(true);
    }
  });
});
