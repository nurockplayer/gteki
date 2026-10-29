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
    const outer = [{ x: 4.78, z: 0 }, { x: 4, z: direction * 0.78 }];
    for (const point of outer) {
      const resolved = resolveWalls(point.x, point.z, 0.3, 2, 1.7, result.wallSegments);
      expect(Math.hypot(resolved.x - point.x, resolved.z - point.z)).toBeGreaterThan(0.29);
      const toward = new THREE.Vector3(point.x - 4, 0, point.z).normalize();
      const ray = new THREE.Raycaster(new THREE.Vector3(4, 2.4, 0), toward, 0, 0.9);
      expect(ray.intersectObjects(result.colliders).length).toBeGreaterThan(0);
    }
  }
});

it("keeps diagonal turning landings clear while preserving outer guards", () => {
  for (const degrees of [45, 135]) for (const direction of [-1, 1]) {
    const angle = degrees * Math.PI / 180, endX = 4 + 4 * Math.cos(angle), endY = direction * 4 * Math.sin(angle);
    const station = createSyntheticBundle([syntheticEdge("bent", "start", "upper", { mode: "stairs", attributes: { sceneGap: true }, geometry: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 2 }, { x: endX, y: endY, z: 4 }] })]);
    station.nodes.find((n) => n.id === "upper")!.position = { x: endX, y: endY, z: 4 };
    const result = buildConnectors(station, () => true, { hasFloor: () => true, nearMesh: () => false }, "high");
    const path = result.pathByEdge.get("bent")!, cumulative = cumulativeLengths(path), total = cumulative.at(-1)!;
    for (let s = 0; s <= total; s += 0.05) {
      const p = samplePolyline(path, cumulative, s), resolved = resolveWalls(p.x, p.z, 0.3, p.y, 1.7, result.wallSegments);
      expect(Math.hypot(resolved.x - p.x, resolved.z - p.z), `${degrees}° direction=${direction} s=${s}`).toBeLessThanOrEqual(0.05);
    }
    const guards = result.wallSegments.filter((w) => Math.abs(w.yMin - 1.88) < 1e-6 && Math.abs(w.yMax - 2.96) < 1e-6 && Math.hypot(w.bx - w.ax, w.bz - w.az) > 0.05);
    expect(guards.length, `${degrees}° direction=${direction}`).toBeGreaterThan(0);
    for (const w of guards) {
      const x = (w.ax + w.bx) / 2, z = (w.az + w.bz) / 2, resolved = resolveWalls(x, z, 0.3, 2, 1.7, [w]);
      expect(Math.hypot(resolved.x - x, resolved.z - z)).toBeGreaterThan(0.29);
      const dx = w.bx - w.ax, dz = w.bz - w.az, normal = new THREE.Vector3(-dz, 0, dx).normalize();
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
