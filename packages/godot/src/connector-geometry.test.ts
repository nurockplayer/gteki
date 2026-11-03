import fs from "node:fs";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { expect, it } from "vitest";
import { parseStationFiles } from "@gteki/schema";
import { loadScene } from "./route-clip-audit.ts";
import { makeGreybox } from "./navmesh-greybox.ts";

// Recorded on e35daf9fb9c7b7a445972ed17a698505bd43bf64 before the allocation/probe optimization.
const expected: Record<string, string> = {
  ikebukuro: "446cec8af83769c744902d512e1803a8463ee5d89411b93aeed31687d4d6b02d",
  shinjuku: "3bcf631bf29ad26240939d20a277af99d2b286f0cfae6c5c2d90def9deedfe3c",
};

// Public station geometry, through the same live cut and connector builder as the navmesh gate.
for (const station of ["ikebukuro", "shinjuku"]) {
  it(`${station}: preserves connector meshes and walls`, async () => {
    const read = (name: string) => JSON.parse(fs.readFileSync(`stations/${station}/gteki/${name}.json`, "utf8"));
    const parsed = parseStationFiles(read("station"), read("graph"), read("pois"), read("tenants"));
    if (!parsed.ok) throw new Error("Invalid public station bundle");
    const scene = await loadScene(station, parsed.bundle, "low");
    const live = makeGreybox(parsed.bundle, scene, false);
    const connectors = live.connectors;
    const hash = createHash("sha256");
    for (const root of [connectors.root, ...connectors.walkable, ...connectors.colliders]) root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const name of Object.keys(mesh.geometry.attributes).sort()) {
        const attribute = mesh.geometry.getAttribute(name);
        hash.update(name);
        hash.update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
      }
      hash.update(JSON.stringify({ index: mesh.geometry.index && Array.from(mesh.geometry.index.array), groups: mesh.geometry.groups, data: mesh.userData }));
    });
    hash.update(JSON.stringify({ walls: connectors.wallSegments, paths: [...connectors.pathByEdge], stats: connectors.stats, skipped: connectors.skippedEdgeIds }));
    const digest = hash.digest("hex");
    console.log("[connector-geometry]", station, digest);
    expect(digest).toBe(expected[station]);
    live.stairwellCut.dispose();
    scene.dispose();
  }, 120_000);
}
