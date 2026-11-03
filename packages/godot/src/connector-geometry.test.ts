import fs from "node:fs";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { expect, it } from "vitest";
import { parseStationFiles } from "@gteki/schema";
import { loadScene } from "./route-clip-audit.ts";
import { makeGreybox } from "./navmesh-greybox.ts";

// Recorded on 556e6fab446df0c4a77a5fb202c4a9be7be70f8c before the allocation/probe optimization.
const expected: Record<string, string> = {
  ikebukuro: "9eabaf17d435174722a870092335e8735d3b04c40206ea81fffd88e5b8ef3f13",
  shinjuku: "906a30dde6ed34a5bebc41e21ecc6755c7ad8722db954a9d6b2e6fdb6427d9e8",
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
