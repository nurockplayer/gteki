import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createSyntheticBundle, syntheticEdge } from "../../navigation/src/fixtures.ts";
import { auditPolyline, violations, type SceneProbe } from "./route-clip-audit.ts";
import { drapeEdges } from "./drape-edges.ts";

function probe(gap: boolean, z = 0): SceneProbe {
  const floor = new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, 10), new THREE.MeshBasicMaterial());
  floor.position.y = z - 0.1;
  const wall = (center: number, length: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, length), new THREE.MeshBasicMaterial());
    mesh.position.set(0, z + 1.5, center); mesh.updateMatrixWorld(true); return mesh;
  };
  floor.updateMatrixWorld(true);
  return { ground: [floor], collider: gap ? [wall(-3, 4), wall(2.5, 5)] : [wall(0, 10)], walls: [] };
}
function bundle() {
  const b = createSyntheticBundle([syntheticEdge("edge", "start", "goal")]);
  b.nodes.find(n => n.id === "start")!.position = { x: -2, y: 0, z: null };
  b.nodes.find(n => n.id === "goal")!.position = { x: 2, y: 0, z: null };
  return b;
}
describe("scene floor draping", () => {
  it("routes through a wall gap and audits clean", () => {
    const scene = probe(true), result = drapeEdges(scene, bundle(), new Set(["edge"]));
    expect(result.unresolved).toEqual([]);
    const points = result.geometry.get("edge")!;
    expect(points.length).toBeGreaterThan(2);
    expect(violations(auditPolyline(scene, points.map(p => ({ ...p, zKnown: false, stepIndex: 0, floorId: "concourse" }))))).toBe(0);
  });
  it("reports a wall without a gap", () => {
    const result = drapeEdges(probe(false), bundle(), new Set(["edge"]));
    expect(result.geometry.size).toBe(0);
    expect(result.unresolved).toEqual([{ edgeId: "edge", reason: "no lattice path" }]);
  });
  it("snaps nodes to a floor above the render height", () => {
    const result = drapeEdges(probe(true, 1), bundle(), new Set(["edge"]));
    expect(result.nodes.get("start")).toBeCloseTo(1);
  });
});
