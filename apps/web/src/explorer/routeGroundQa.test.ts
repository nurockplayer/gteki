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
