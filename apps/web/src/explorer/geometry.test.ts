import { expect, it } from "vitest";
import * as THREE from "three";
import { ROUTE_RIBBON_WIDTH_OVERVIEW, ROUTE_RIBBON_WIDTH_WALK, clipFlatGeometry, ribbonGeometry, steppedProfile } from "./geometry.ts";

it("steps the ribbon over stair treads and leaves flat input unchanged", () => {
  const samples = Array.from({ length: 19 }, (_, i) => new THREE.Vector3(i * 0.05, Math.min(2, Math.floor((i * 0.05 + 1e-6) / 0.3)) * 0.18, 0));
  const profile = steppedProfile(samples);
  for (const p of profile) expect(Math.abs(p.y / 0.18 - Math.round(p.y / 0.18)) * 0.18).toBeLessThan(0.001);
  const positions = ribbonGeometry(profile, 0.4, 0.07).getAttribute("position");
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), tread = Math.min(2, Math.floor((x + 1e-6) / 0.3)) * 0.18;
    expect(positions.getY(i)).toBeGreaterThanOrEqual(tread - 0.001);
  }
  const flat = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)];
  expect(steppedProfile(flat)).toEqual(flat);
});

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
