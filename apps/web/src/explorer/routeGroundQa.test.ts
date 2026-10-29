import { expect, it } from "vitest";
import * as THREE from "three";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";
import { routeGroundCounts, sceneMeshNear } from "./routeGroundQa.ts";

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

it("reports missing vertical connector and unsupported interior on an elevator edge", () => {
  const bundle = createSyntheticBundle([syntheticEdge("lift", "a", "upper", { mode: "elevator" })]);
  const steps = [{ edgeId: "lift", mode: "elevator", fromNodeId: "a", toNodeId: "upper", reversed: false, lengthM: 4, fromFloorId: "concourse", toFloorId: "upper" }] as Parameters<typeof routeGroundCounts>[2];
  const points = [{ x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 4 }];
  expect(routeGroundCounts(points, (p) => p.y === 0 || p.y === 4 ? p.y : null, steps, bundle, () => false)).toMatchObject({ samples: 9, noFloor: 7, verticalWithoutConnector: 1 });
});
