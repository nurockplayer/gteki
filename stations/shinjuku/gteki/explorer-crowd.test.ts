// Shinjuku's explorer commuters (#938): the real graph adapted for Ikebukuro's instanced buildCrowd.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { GraphFile } from "@gteki/schema";
import { buildCrowd } from "../../ikebukuro/scene/crowd.ts";
import graph from "./graph.json";
import { crowdEdges } from "./explorer-crowd.ts";

const graphFile = graph as GraphFile;
const nodeById = new Map(graphFile.nodes.map((n) => [n.id, n]));
/** The adapter's node height, as the scene passes it: the node's own z, else its display height. */
const nodeZ = (id: string) => {
  const n = nodeById.get(id);
  return n ? n.position.z ?? n.renderZ ?? 0 : 0;
};
const { edges, lanes } = crowdEdges(graphFile, nodeZ);

describe("shinjuku explorer crowd edges", () => {
  it("keeps only verified, open walk/stairs/ramp/gate edges between present nodes", () => {
    const kept = new Set(edges.map((e) => e.id));
    const wanted = graphFile.edges.filter((e) =>
      (e.mode === "walk" || e.mode === "stairs" || e.mode === "ramp" || e.mode === "gate")
      && e.verification === "verified" && !e.closed
      && nodeById.has(e.from) && nodeById.has(e.to));
    expect(edges.map((e) => e.id).sort()).toEqual(wanted.map((e) => e.id).sort());
    // Escalators and lifts are walked in both directions by buildCrowd: never kept.
    const vertical = graphFile.edges.filter((e) => e.mode === "escalator" || e.mode === "elevator");
    expect(vertical.length).toBeGreaterThan(0);
    for (const e of vertical) expect(kept.has(e.id)).toBe(false);
  });

  it("gives every kept point a finite height from its node and every edge a lane", () => {
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(e.geometry.length).toBeGreaterThanOrEqual(2);
      for (const p of e.geometry) expect(Number.isFinite(p.z)).toBe(true);
      expect(e.geometry[0]!.z).toBe(nodeZ(e.from));
      expect(e.geometry[e.geometry.length - 1]!.z).toBe(nodeZ(e.to));
      expect(lanes[e.id]).toBeDefined();
      expect(lanes[e.id]!.stepM).toBe(1000);
      const w = e.mode === "stairs" ? 0.45 : 0.8;
      expect(lanes[e.id]!.left).toEqual([w]);
      expect(lanes[e.id]!.right).toEqual([w]);
    }
    expect(Object.keys(lanes).sort()).toEqual(edges.map((e) => e.id).sort());
  });
});

describe("shinjuku explorer crowd", () => {
  const toRenderer = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

  it.each([56, 150])("keeps %i commuters finite, moving and in constant draws over 2,000 frames", (count) => {
    const crowd = buildCrowd(THREE, edges, toRenderer, count, new THREE.Texture(), lanes);
    try {
      const meshes = crowd.group.children as THREE.InstancedMesh[];
      const people = meshes.find((m) => m.name === "crowd_torso" || m.name === "crowd_low")!;
      expect(people.count).toBe(count);
      // Low tier (56) packs every person into one InstancedMesh; the brief's budget is two draws.
      if (count === 56) expect(meshes.length).toBeLessThanOrEqual(2);

      const m = new THREE.Matrix4();
      const lastX = new Float64Array(count), lastZ = new Float64Array(count);
      const seen = new Uint8Array(count);
      let firstRead = true;
      const readPeople = () => {
        for (let i = 0; i < count; i++) {
          people.getMatrixAt(i, m);
          const x = m.elements[12]!, z = m.elements[14]!;
          if (!firstRead && !seen[i] && (x - lastX[i]!) ** 2 + (z - lastZ[i]!) ** 2 > 1e-8) seen[i] = 1;
          lastX[i] = x;
          lastZ[i] = z;
        }
        firstRead = false;
      };
      readPeople(); // buildCrowd already applied frame 0
      let finite = true;
      for (let frame = 0; frame < 2000 && finite; frame++) {
        crowd.update(1 / 60, frame / 60);
        for (const mesh of meshes) {
          const a = mesh.instanceMatrix.array;
          for (let k = 0; k < a.length; k++) if (!Number.isFinite(a[k]!)) { finite = false; break; }
          if (!finite) break;
        }
        readPeople();
      }
      expect(finite).toBe(true);
      let moved = 0;
      for (let i = 0; i < count; i++) moved += seen[i]!;
      expect(moved).toBeGreaterThanOrEqual(Math.ceil(count * 0.9));
    } finally {
      crowd.dispose();
    }
  }, 60_000);
});
