import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as THREE from "three";
import { createSyntheticBundle, syntheticEdge } from "../../navigation/src/fixtures.ts";
import { auditPolyline, violations, type SceneProbe } from "./route-clip-audit.ts";
import { applyDrapeGeometry, drapeEdges, drapePaths } from "./drape-edges.ts";

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
  it("records the rounded plan length and previous length for a draped edge", () => {
    const edge = syntheticEdge("edge", "start", "goal", { lengthM: 4 });
    const geometry = [{ x: 0, y: 0, z: 1 }, { x: 3, y: 4, z: 2 }, { x: 4, y: 5, z: 3 }];
    applyDrapeGeometry(edge, geometry);
    expect(edge).toMatchObject({ lengthM: 6.4, geometry, attributes: { lengthMBeforeDrape: 4, lengthMethod: "drape-geometry", geometryMethod: "drape:scene-floor-lattice" }, geometryEvidence: { method: "synthetic-fixture+drape" } });
    expect(edge.geometryZ).toBeUndefined();
  });
  it("rejects paths the overlay does not load before reading input", () => {
    const script = "packages/godot/src/drape-edges.ts", root = "/tmp/synthetic-private";
    for (const [station, file, out] of [
      ["shinjuku", "additions/shinjuku/seam.json", `${root}/additions/shinjuku/graph.json`],
      ["other", "additions/other/graph.json", `${root}/additions/other/graph.json`],
    ]) {
      const result = spawnSync(process.execPath, ["--import", "tsx", script, "--station", station!, "--private", root, "--file", file!, "--out", out!], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/overlay file/);
    }
  });
  it("allows in-place and external output but refuses another file anywhere in additions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "drape-path-test-"));
    try {
      const privateDir = path.join(root, "private"), addDir = path.join(privateDir, "additions", "shinjuku");
      fs.mkdirSync(addDir, { recursive: true });
      const input = path.join(addDir, "graph.json"), file = "additions/shinjuku/graph.json";
      fs.writeFileSync(input, "{}");
      expect(drapePaths(privateDir, "shinjuku", file, input)).toEqual({ input, output: input });
      expect(drapePaths(privateDir, "shinjuku", file, path.join(root, "out.json")).output).toBe(path.join(root, "out.json"));
      expect(() => drapePaths(privateDir, "shinjuku", file, path.join(addDir, "graph.draped.json"))).toThrow(/outside the private additions/);
      expect(() => drapePaths(privateDir, "shinjuku", file, path.join(privateDir, "additions", "other", "out.json"))).toThrow(/outside the private additions/);
      const alias = path.join(root, "alias"); fs.symlinkSync(privateDir, alias);
      expect(drapePaths(alias, "shinjuku", file, path.join(alias, file))).toEqual({ input, output: input });
      expect(() => drapePaths(alias, "shinjuku", file, path.join(alias, "additions", "shinjuku", "graph.other.json"))).toThrow(/outside the private additions/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it("reports a wall without a gap", () => {
    const result = drapeEdges(probe(false), bundle(), new Set(["edge"]));
    expect(result.geometry.size).toBe(0);
    expect(result.unresolved).toEqual([{ edgeId: "edge", reason: "no lattice path" }]);
    expect(result.sceneGaps.get("edge")).toBe(true);
  });
  it("clears resolved automatic flags and preserves hand flags", () => {
    const b = bundle(), edge = b.edges[0]!;
    edge.attributes = { ...edge.attributes, sceneGap: true, sceneGapReason: "drape-unresolved" };
    expect(drapeEdges(probe(true), b, new Set(["edge"])).sceneGaps.get("edge")).toBe(false);
    edge.attributes = { ...edge.attributes, sceneGap: true, sceneGapReason: "hand" };
    expect(drapeEdges(probe(false), b, new Set(["edge"])).sceneGaps.has("edge")).toBe(false);
  });
  it("does not flag unmodelled floor alone", () => {
    expect(drapeEdges({ ground: [], collider: [], walls: [] }, bundle(), new Set(["edge"])).sceneGaps.has("edge")).toBe(false);
  });
  it("snaps nodes to a floor above the render height", () => {
    const result = drapeEdges(probe(true, 1), bundle(), new Set(["edge"]));
    expect(result.nodes.get("start")).toBeCloseTo(1);
  });
});
