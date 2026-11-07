import { expect, it } from "vitest";
import * as THREE from "three";
import { ROUTE_RIBBON_WIDTH_OVERVIEW, ROUTE_RIBBON_WIDTH_WALK, clipFlatGeometry, ribbonGeometry } from "./geometry.ts";

it("clips the flat segment of a cross-level ribbon and keeps the rise", () => {
  const points = [new THREE.Vector3(1, 0, 5), new THREE.Vector3(9, 0, 5), new THREE.Vector3(9, 4, 6)];
  const ring = [{ x: 3, z: 3 }, { x: 7, z: 3 }, { x: 7, z: 7 }, { x: 3, z: 7 }];
  const geometry = clipFlatGeometry(ribbonGeometry(points, 0.5), [{ level: "concourse", y: 0, triangles: [ring] }], ["concourse", "upper"], [0, 4]);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const hits = (x: number, z: number) => new THREE.Raycaster(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh).length;
  expect(hits(5, 5)).toBe(0);
  expect(hits(2, 5)).toBeGreaterThan(0);
  expect(hits(9, 5.7)).toBeGreaterThan(0);
});

it("draws the walking ribbon 0.40 m wide and the overview ribbon 1.1 m wide", () => {
  const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)];
  const width = (w: number) => {
    const g = ribbonGeometry(points, w);
    g.computeBoundingBox();
    return g.boundingBox!.max.z - g.boundingBox!.min.z;
  };
  expect(width(ROUTE_RIBBON_WIDTH_WALK)).toBeCloseTo(0.4, 6);
  expect(width(ROUTE_RIBBON_WIDTH_OVERVIEW)).toBeCloseTo(1.1, 6);
});
