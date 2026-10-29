import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { objectSource } from "./navmesh-source.ts";
import { navmeshBundle } from "./navmesh-input.ts";
import { loadScene } from "./route-clip-audit.ts";

describe("public station collider attribution", () => {
  for (const station of ["ikebukuro", "shinjuku"]) it(station, async () => {
    const { bundle } = await navmeshBundle(station);
    const scene = await loadScene(station, bundle);
    try {
      for (const object of [...(scene.colliders ?? []), ...(scene.cameraBlockers ?? [])]) {
        expect(object.userData.gteki_source, object.name).toBeTruthy();
        expect(object.userData.gteki_role, object.name).toBeTruthy();
      }
      for (const wall of scene.walls ?? []) { expect(wall.source).toBeTruthy(); expect(wall.role).toBeTruthy(); }
    } finally { scene.dispose(); }
  }, 120_000);
});

it("prefers an explicit source over name and legacy role heuristics", () => {
  const parent = new THREE.Group(); parent.userData.gteki_source = "fence";
  const mesh = new THREE.Mesh(); mesh.name = "plateau"; mesh.userData.greybox = true; parent.add(mesh);
  expect(objectSource(mesh)).toBe("fence");
  mesh.userData.gteki_source = "procedural";
  expect(objectSource(mesh)).toBe("procedural");
});
