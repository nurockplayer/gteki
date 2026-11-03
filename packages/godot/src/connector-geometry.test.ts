import fs from "node:fs";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { expect, it, vi } from "vitest";
import { parseStationFiles } from "@gteki/schema";
import { loadScene } from "./route-clip-audit.ts";
import { makeGreybox } from "./navmesh-greybox.ts";
import * as connectorModule from "../../../apps/web/src/explorer/greyboxConnectors.ts";
import { buildConnectors as referenceBuild } from "./fixtures/connector-reference.ts";

function connectorHash(connectors: ReturnType<typeof referenceBuild>): string {
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
  return hash.digest("hex");
}

// Public station geometry, through the same live cut and connector builder as the navmesh gate.
for (const station of ["ikebukuro", "shinjuku"]) {
  it(`${station}: preserves connector meshes and walls`, async () => {
    const read = (name: string) => JSON.parse(fs.readFileSync(`stations/${station}/gteki/${name}.json`, "utf8"));
    const parsed = parseStationFiles(read("station"), read("graph"), read("pois"), read("tenants"));
    if (!parsed.ok) throw new Error("Invalid public station bundle");
    const scene = await loadScene(station, parsed.bundle, "low");
    const optimizedBuild = connectorModule.buildConnectors;
    let referenceHash: string | undefined;
    const build = vi.spyOn(connectorModule, "buildConnectors").mockImplementation((...args) => {
      referenceHash = connectorHash(referenceBuild(...args));
      return optimizedBuild(...args);
    });
    let live: ReturnType<typeof makeGreybox>;
    try { live = makeGreybox(parsed.bundle, scene, false); }
    finally { build.mockRestore(); }
    const connectors = live.connectors;
    const digest = connectorHash(connectors);
    console.log("[connector-geometry]", station, { reference: referenceHash, optimized: digest });
    expect(referenceHash).toBeDefined();
    expect(digest).toBe(referenceHash);
    live.stairwellCut.dispose();
    scene.dispose();
  }, 120_000);
}
