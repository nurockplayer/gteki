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
      for (const object of scene.colliders ?? []) {
        expect(object.userData.gteki_source, object.name).toBeTruthy();
        expect(object.userData.gteki_role, object.name).toBeTruthy();
      }
      for (const object of scene.cameraBlockers ?? []) expect(object.userData.gteki_source, object.name).toBeTruthy();
      for (const wall of scene.walls ?? []) { expect(wall.source).toBeTruthy(); expect(wall.role).toBeTruthy(); }
      if (station === "shinjuku") {
        const gate = (scene.walls ?? []).find(w => "gtekiGate" in w && w.gtekiGate === true);
        expect(gate?.role).toBe("gate");
        expect(JSON.stringify(gate)).not.toMatch(/gtekiGate|source|role/);
        for (const object of scene.colliders ?? []) expect(Object.keys(object.userData)).not.toContain("gteki_source");
        const collider = (scene.colliders ?? []).find(object => object.name === "wall collider (invisible)");
        const activeGates = (scene.walls ?? []).filter(w => "gtekiGate" in w && w.gtekiGate === true && w.zMax > w.zMin);
        expect(collider?.userData.gtekiGateTriangles.length).toBe(activeGates.length * 2);
        expect(Object.keys(collider!.userData)).not.toContain("gtekiGateTriangles");
      }
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
