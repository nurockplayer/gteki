import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { PolylinePoint } from "@gteki/navigation";
import { auditPolyline, sceneProbe, violations } from "./route-clip-audit.ts";

// Renderer frame: y up, ENU (x, y, z) → (x, z, -y). A 20 m floor at z 0 and a wall across x = 5.
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 20).translate(5, 1.5, 0), new THREE.MeshBasicMaterial());
const root = new THREE.Group().add(floor, wall);
root.updateMatrixWorld(true);
const probe = sceneProbe({ root, walkable: [floor], colliders: [wall] } as never);
const line = (...pts: [number, number, number][]): PolylinePoint[] =>
  pts.map(([x, y, z], i) => ({ x, y, z, zKnown: true, stepIndex: i - 1, floorId: "f" }));

describe("route clip audit", () => {
  it("passes a route on the floor that stays on one side of the wall", () => {
    expect(violations(auditPolyline(probe, line([-8, 0, 0.1], [4, 0, 0.1])))).toBe(0);
  });
  it("counts samples above the floor tolerance", () => {
    const a = auditPolyline(probe, line([-8, 0, 1], [-2, 0, 1]));
    expect(a.offFloor).toBe(a.samples);
    expect(a.maxAbsDzM).toBeCloseTo(1);
  });
  it("counts a wall crossing and samples with no floor below", () => {
    expect(auditPolyline(probe, line([0.2, 0, 0], [8.2, 0, 0])).wallHits).toBe(1);
    expect(auditPolyline(probe, line([30, 0, 0], [31, 0, 0])).noFloor).toBe(3);
  });
});
