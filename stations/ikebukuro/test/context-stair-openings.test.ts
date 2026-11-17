import fs from "node:fs";
import { expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { glbPrimitivePlugin } from "@gteki/scene-api";
import type { StationBundle } from "@gteki/schema";
import { stairwellWells } from "../../../apps/web/src/explorer/stairwellCut.ts";
import { CONTEXT_GLB, cutContextStairOpenings } from "../scene/context.ts";

it("leaves zero context triangles in every street-exit stair opening in both shipped tiers", async () => {
  const base = new URL("../gteki/", import.meta.url);
  const read = (name: string) => JSON.parse(fs.readFileSync(new URL(name, base), "utf8"));
  const bundle = { ...read("station.json"), ...read("graph.json") } as StationBundle;
  const streets = new Set(bundle.floors.filter(f => f.ordinal === 0 && !f.intermediate).map(f => f.id));
  const exits = bundle.nodes.filter(n => n.kind === "exit" && streets.has(n.floorId));
  const ids = new Set(exits.map(n => n.id));
  const wells = stairwellWells(bundle, e => !e.closed && (ids.has(e.from) || ids.has(e.to)));
  expect(exits).toHaveLength(20);
  expect(wells).toHaveLength(20);
  for (const uri of Object.values(CONTEXT_GLB)) {
    const bytes = fs.readFileSync(new URL(uri, base));
    const gltf = await new GLTFLoader().register(glbPrimitivePlugin).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
    const originals = new Map<THREE.Mesh, THREE.BufferGeometry>();
    gltf.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) originals.set(o as THREE.Mesh, (o as THREE.Mesh).geometry); });
    expect(cutContextStairOpenings(THREE, gltf.scene, bundle)).toBeGreaterThan(0);
    const triangle = new THREE.Triangle(), local = new THREE.Triangle();
    for (const well of wells) {
      let intrusions = 0;
      for (const [mesh] of originals) {
        const positions = mesh.geometry.getAttribute("position"), index = mesh.geometry.index;
        for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
          [triangle.a, triangle.b, triangle.c].forEach((v, k) => v.fromBufferAttribute(positions, index ? index.getX(i + k) : i + k).applyMatrix4(mesh.matrixWorld));
          if (well.rects.some(rect => {
            [local.a, local.b, local.c].forEach((v, k) => {
              const point = [triangle.a, triangle.b, triangle.c][k]!, delta = point.clone().sub(rect.center);
              v.set(delta.dot(rect.along), point.y, delta.dot(rect.across));
            });
            return new THREE.Box3(new THREE.Vector3(-rect.halfLength, well.lowerY, -rect.halfWidth), new THREE.Vector3(rect.halfLength, well.upperY, rect.halfWidth)).intersectsTriangle(local);
          })) intrusions++;
        }
      }
      expect(intrusions, `${uri}: ${well.edgeId}`).toBe(0);
      console.log(`${uri}: ${well.edgeId}: 0 context triangles`);
    }
    for (const [mesh, original] of originals) {
      if (mesh.geometry === original) continue;
      // Retained vertices and all their attributes stay byte-identical; only triangle indices change.
      for (const name of Object.keys(original.attributes)) expect(mesh.geometry.getAttribute(name).array).toEqual(original.getAttribute(name).array);
      mesh.geometry.dispose();
    }
    for (const geometry of originals.values()) geometry.dispose();
  }
}, 60_000);
