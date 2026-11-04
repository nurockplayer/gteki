import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as THREE from "three";
import { createSyntheticBundle, syntheticEdge } from "../../navigation/src/fixtures.ts";
import { auditPolyline, violations, type SceneProbe } from "./route-clip-audit.ts";
import { applyDrapeGeometry, drapeEdges, drapePaths, drapeSceneProbe } from "./drape-edges.ts";

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
  it.each(["scene", "polygon"])("snaps to %s floors without using a graph-generated ribbon as height evidence", async (source) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drape-source-height-"));
    try {
      const b = bundle(), original = source === "scene" ? probe(true, 1.5) : { ground: [], collider: [] };
      const origin = source === "scene" ? 20 : -5, size = source === "scene" ? 4 : 10;
      fs.writeFileSync(path.join(dir, "private_regions.json"), JSON.stringify([
        { kind: "polygon", level: "concourse", y: 1.5, rings: [[
          { x: origin, z: origin }, { x: origin + size, z: origin }, { x: origin + size, z: origin + size }, { x: origin, z: origin + size },
        ]] },
      ]));
      const root = new THREE.Group().add(...original.ground, ...original.collider);
      root.updateMatrixWorld(true);
      const p = await drapeSceneProbe({ root, walkable: original.ground, colliders: original.collider, walls: [] } as never, b, dir);
      const result = drapeEdges(p, b, new Set(["edge"]));
      expect(result.nodes.get("start")).toBeCloseTo(1.5);
      expect(result.nodes.get("goal")).toBeCloseTo(1.5);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it("loads polygon floors for the drape and audit while retaining explicit holes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drape-regions-"));
    try {
      const b = bundle();
      b.edges[0]!.attributes = { sceneGap: true, sceneGapReason: "drape-unresolved" };
      const ring = (x: number, z: number, size: number) => [
        { x, z }, { x: x + size, z }, { x: x + size, z: z + size }, { x, z: z + size },
      ];
      fs.writeFileSync(path.join(dir, "private_regions.json"), JSON.stringify([
        { kind: "polygon", level: "concourse", y: 0, rings: [ring(-5, -5, 10), ring(-1, 2, 2)], exclusions: [[ring(-1, 2, 2)]] },
      ]));
      const root = new THREE.Group();
      const p = await drapeSceneProbe({ root, walkable: [], colliders: [], walls: [] } as never, b, dir);
      const result = drapeEdges(p, b, new Set(["edge"]));
      expect(result.nodes.get("start")).toBeCloseTo(0);
      expect(result.nodes.get("goal")).toBeCloseTo(0);
      expect(result.sceneGaps.get("edge")).toBe(false);
      const point = (x: number, y: number) => ({ x, y, z: 0, zKnown: false, stepIndex: 0, floorId: "concourse" });
      // Away from the graph ribbon, only the selected polygon can support this point.
      expect(violations(auditPolyline(p, [point(3, 3)]))).toBe(0);
      expect(auditPolyline(p, [point(0, -3)]).noFloor).toBe(1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it("does not clear an automatic gap using the wall opening that its flag creates", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drape-flag-opening-"));
    try {
      const b = bundle(), original = probe(false);
      b.edges[0]!.attributes = { sceneGap: true, sceneGapReason: "drape-unresolved" };
      fs.writeFileSync(path.join(dir, "private_regions.json"), JSON.stringify([
        { kind: "polygon", level: "concourse", y: 0, rings: [[
          { x: 20, z: 20 }, { x: 24, z: 20 }, { x: 24, z: 24 }, { x: 20, z: 24 },
        ]] },
      ]));
      const root = new THREE.Group().add(...original.ground, ...original.collider);
      root.updateMatrixWorld(true);
      const p = await drapeSceneProbe({ root, walkable: original.ground, colliders: original.collider, walls: [] } as never, b, dir);
      const result = drapeEdges(p, b, new Set(["edge"]));
      expect(result.geometry.has("edge")).toBe(false);
      expect(result.sceneGaps.get("edge")).toBe(true);
      expect(b.edges[0]!.attributes).toEqual({ sceneGap: true, sceneGapReason: "drape-unresolved" });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
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
    edge.attributes = { sceneGap: false };
    expect(drapeEdges(probe(false), b, new Set(["edge"])).sceneGaps.has("edge")).toBe(false);
  });
  it("does not flag unmodelled floor alone", () => {
    expect(drapeEdges({ ground: [], collider: [], walls: [] }, bundle(), new Set(["edge"])).sceneGaps.has("edge")).toBe(false);
  });
  it("clears an automatic flag when only unmodelled floor remains", () => {
    const b = bundle();
    b.edges[0]!.attributes = { ...b.edges[0]!.attributes, sceneGap: true, sceneGapReason: "drape-unresolved" };
    expect(drapeEdges({ ground: [], collider: [], walls: [] }, b, new Set(["edge"])).sceneGaps.get("edge")).toBe(false);
  });
  it.each([[0, true], [2.9, false]])("distinguishes a wall at x=%s from the model boundary", (wallX, flagged) => {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 10), new THREE.MeshBasicMaterial());
    floor.position.y = -0.1; floor.updateMatrixWorld(true);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3, 10), new THREE.MeshBasicMaterial());
    wall.position.set(wallX, 1.5, 0); wall.updateMatrixWorld(true);
    const b = bundle(); b.edges[0]!.mode = "escalator";
    b.nodes.find(n => n.id === "goal")!.position.x = 6;
    const scene = { ground: [floor], collider: [wall], walls: [] };
    const result = drapeEdges(scene, b, new Set(["edge"]));
    expect(result.sceneGaps.get("edge") === true).toBe(flagged);
  });
  it("snaps nodes to a floor above the render height", () => {
    const result = drapeEdges(probe(true, 1), bundle(), new Set(["edge"]));
    expect(result.nodes.get("start")).toBeCloseTo(1);
  });
});
