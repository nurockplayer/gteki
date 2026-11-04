import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { createRouter, routePolyline } from "@gteki/navigation";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";
import { routeGroundCounts, sceneMeshNear, sceneMeshProbe } from "./routeGroundQa.ts";

it("does not count a nearby floor as a vertical connector", () => {
  const bundle = createSyntheticBundle([syntheticEdge("stairs", "start", "a", { mode: "stairs" })]);
  const a = bundle.nodes.find((n) => n.id === "start")!, b = bundle.nodes.find((n) => n.id === "a")!;
  const root = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(20, 0.2, 20));
  floor.position.set((a.position.x + b.position.x) / 2, 0, -(a.position.y + b.position.y) / 2);
  root.add(floor);
  const steps = [{ edgeId: "stairs", mode: "stairs", fromNodeId: "start", toNodeId: "a", reversed: false, lengthM: 10, fromFloorId: a.floorId, toFloorId: b.floorId }] as Parameters<typeof routeGroundCounts>[2];
  const count = () => routeGroundCounts([], () => 0, steps, bundle, (p, r) => sceneMeshNear([root], p, r)).verticalWithoutConnector;
  expect(count()).toBe(1);
  const connector = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  connector.position.copy(floor.position);
  connector.userData = { greybox: true, connector: true };
  root.add(connector);
  expect(count()).toBe(0);
  connector.userData = {};
  connector.name = "escalator-steps:synthetic";
  expect(count()).toBe(0);
  connector.name = "";
  connector.userData.gteki_role = "stairs";
  expect(count()).toBe(0);
});

it("does not count a nearby greybox connector belonging to a different edge", () => {
  const bundle = createSyntheticBundle([syntheticEdge("stairs", "start", "a", { mode: "stairs" })]);
  const connector = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  connector.position.set(5, 0, 0);
  connector.userData = { greybox: true, connector: true, edgeId: "other" };
  const steps = [{ edgeId: "stairs", mode: "stairs", fromNodeId: "start", toNodeId: "a", reversed: false, lengthM: 10, fromFloorId: "concourse", toFloorId: "concourse" }] as Parameters<typeof routeGroundCounts>[2];
  const count = () => routeGroundCounts([], () => 0, steps, bundle, (p, r, id) => sceneMeshNear([connector], p, r, id)).verticalWithoutConnector;
  expect(count()).toBe(1);
  connector.userData.edgeId = "stairs";
  expect(count()).toBe(0);
  connector.userData = { gteki_role: "stairs" };
  expect(count()).toBe(0);
});

it("checks the edge of the nearby triangles inside a shared connector mesh", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 1, 10, 0, 0, 10, 1, 0, 10, 0, 1], 3));
  const mesh = new THREE.Mesh(geometry);
  mesh.userData = { greybox: true, connector: true, edgeId: ["first", "second"], edgeRanges: [{ start: 0, end: 3, edgeId: "first" }, { start: 3, end: 6, edgeId: "second" }] };
  const point = new THREE.Vector3(0, 0.2, 0.2);
  expect(sceneMeshNear([mesh], point, 1, "first")).toBe(true);
  expect(sceneMeshNear([mesh], point, 1, "second")).toBe(false);
});

it("exempts elevator ride interiors while checking both landings and the connector", () => {
  const bundle = createSyntheticBundle([syntheticEdge("lift", "a", "upper", { mode: "elevator" })]);
  for (const reversed of [false, true]) {
    const route = createRouter(bundle).route(reversed ? "upper" : "a", reversed ? "a" : "upper");
    if (!route.ok) throw new Error(route.reason);
    const points = routePolyline(bundle, route);
    const floor = (p: THREE.Vector3) => p.y === 0 || p.y === 4 ? p.y : null;
    expect(routeGroundCounts(points, floor, route.steps, bundle, () => false)).toEqual({ samples: 2, noFloor: 0, verticalWithoutConnector: 1 });
    expect(routeGroundCounts(points, () => null, route.steps, bundle, () => true)).toEqual({ samples: 2, noFloor: 2, verticalWithoutConnector: 0 });
    for (const mode of ["stairs", "escalator"] as const) {
      expect(routeGroundCounts(points, floor, route.steps.map(step => ({ ...step, mode })), bundle, () => true)).toMatchObject({ samples: 9, noFloor: 7 });
    }
  }
});

it("checks walking legs and off-grid elevator landings around a generated ride", () => {
  const bundle = createSyntheticBundle([
    syntheticEdge("approach", "start", "a"), syntheticEdge("lift", "a", "upper", { mode: "elevator" }), syntheticEdge("exit", "upper", "upper-2"),
  ]);
  bundle.nodes.find(n => n.id === "a")!.position = { x: 0.8, y: 0, z: 0 };
  bundle.nodes.find(n => n.id === "upper")!.position = { x: 0.8, y: 0, z: 4.2 };
  bundle.nodes.find(n => n.id === "upper-2")!.position = { x: 1.6, y: 0, z: 4.2 };
  const route = createRouter(bundle).route("start", "upper-2");
  if (!route.ok) throw new Error(route.reason);
  const paths = new Map([["lift", [{ x: 0.8, y: 0, z: 0 }, { x: 1.3, y: 0, z: 0 }, { x: 1.3, y: 0, z: 4.2 }, { x: 0.8, y: 0, z: 4.2 }]]]);
  const ground = vi.fn((p: THREE.Vector3) => Math.abs(p.x - 0.8) < 1e-6 ? p.y : null);
  expect(routeGroundCounts(routePolyline(bundle, route, paths), ground, route.steps, bundle, () => true)).toMatchObject({ samples: 6, noFloor: 4 });
  expect(ground.mock.calls.some(([p]) => p.distanceTo(new THREE.Vector3(0.8, 0, 0)) < 1e-6)).toBe(true);
  expect(ground.mock.calls.some(([p]) => p.distanceTo(new THREE.Vector3(0.8, 4.2, 0)) < 1e-6)).toBe(true);
});

it("keeps floor checks on a same-level elevator-labelled stub", () => {
  const bundle = createSyntheticBundle([syntheticEdge("stub", "start", "a", { mode: "elevator" })]);
  const route = createRouter(bundle).route("start", "a");
  if (!route.ok) throw new Error(route.reason);
  expect(routeGroundCounts(routePolyline(bundle, route), () => null, route.steps, bundle, () => true)).toMatchObject({ samples: 21, noFloor: 21 });
});


it("samples the actual bent vertical edge instead of its endpoint midpoint", () => {
  const bundle = createSyntheticBundle([syntheticEdge("stairs", "start", "a", { mode: "stairs", geometry: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }] })]);
  bundle.nodes.find((n) => n.id === "a")!.position = { x: 10, y: 10, z: 0 };
  const steps = [{ edgeId: "stairs", mode: "stairs", fromNodeId: "start", toNodeId: "a", reversed: false, lengthM: 20, fromFloorId: "concourse", toFloorId: "concourse" }] as Parameters<typeof routeGroundCounts>[2];
  const seen: THREE.Vector3[] = [];
  const result = routeGroundCounts([], () => 0, steps, bundle, (p) => { seen.push(p.clone()); return p.distanceTo(new THREE.Vector3(10, 0, 0)) < 0.01; });
  expect(result.verticalWithoutConnector).toBe(0); expect(seen[0]!.x).toBeCloseTo(10); expect(seen[0]!.z).toBeCloseTo(0);
});

it("prepares bounds on first visit and preserves proximity early exits", () => {
  const first = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  const later = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  first.userData.gteki_role = later.userData.gteki_role = "stairs";
  later.position.x = 10;
  const root = new THREE.Group(); root.add(first, later);
  const firstBounds = vi.spyOn(first.geometry, "computeBoundingSphere");
  const laterBounds = vi.spyOn(later.geometry, "computeBoundingSphere");
  const near = sceneMeshProbe([root]);
  expect(firstBounds).not.toHaveBeenCalled();
  expect(laterBounds).not.toHaveBeenCalled();
  expect(near(new THREE.Vector3(), 1)).toBe(true);
  expect(near(new THREE.Vector3(), 1)).toBe(true);
  expect(firstBounds).toHaveBeenCalledTimes(1);
  expect(laterBounds).not.toHaveBeenCalled();
  expect(near(new THREE.Vector3(10, 0, 0), 1)).toBe(true);
  expect(laterBounds).toHaveBeenCalledTimes(1);
  first.geometry.dispose(); later.geometry.dispose();
});
