import * as THREE from "three";
import { expect, it } from "vitest";
import { SceneQuery } from "./sceneQuery.ts";

it("picks the mesh and its source data id at a viewport point", () => {
  const scene = new THREE.Scene();
  const floor = new THREE.Group();
  floor.userData.dataId = "fixture-floor-B1";
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  mesh.name = "west passage slab";
  floor.position.x = 1.5;
  floor.add(mesh);
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 50);
  camera.position.z = 3;
  const query = new SceneQuery(scene, camera, new THREE.Group(), () => ({
    left: 20, top: 40, width: 200, height: 200,
  }));

  expect(query.pick({ x: 180, y: 140 })).toMatchObject({
    name: "west passage slab",
    dataId: "fixture-floor-B1",
  });

  mesh.userData.sourceAt = (point: THREE.Vector3) => point.x > 0
    ? { dataId: "fixture-east-link", floorId: "fixture-floor-B1" }
    : { dataId: "fixture-west-link", floorId: "fixture-floor-B1" };
  const east = { name: "west passage slab", dataId: "fixture-east-link", floorId: "fixture-floor-B1" };
  expect(query.pick({ origin: [1.75, 0, 3], direction: [0, 0, -1] })).toMatchObject(east);
  camera.position.x = 2.25;
  expect(query.near(2.6)).toMatchObject([east]);
});
