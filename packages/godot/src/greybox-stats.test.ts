import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createSyntheticBundle, syntheticEdge } from "../../navigation/src/fixtures.ts";
import type { StationScene } from "@gteki/scene-api";
import { greyboxStats } from "./greybox-stats.ts";

describe("headless greybox statistics", () => {
  it("uses scene floors and colliders for both explorer tiers", () => {
    const bundle = createSyntheticBundle([syntheticEdge("hall", "start", "a")]);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 6), new THREE.MeshBasicMaterial());
    floor.position.y = -0.1;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3, 6), new THREE.MeshBasicMaterial());
    wall.position.set(2.1, 1.5, 0);
    const root = new THREE.Group().add(floor, wall);
    const scene: StationScene = { root, walkable: [floor], colliders: [wall], walls: [{ a: { x: 2.05, y: -3 }, b: { x: 2.05, y: 3 }, zMin: 0, zMax: 3 }], dispose() {} };
    for (const tier of ["high", "low"] as const) {
      const stats = greyboxStats(bundle, scene, tier);
      expect(stats.runs).toBe(1);
      expect(stats.portals).toBe(1);
      expect(stats.lengthM).toBeGreaterThan(7);
      expect(stats.meshes).toBeGreaterThan(0);
      expect(stats.triangles).toBeGreaterThan(0);
      expect(stats.buildMs).toBeGreaterThanOrEqual(0);
      expect(stats.overBudget).toBeNull();
    }
  });
});
