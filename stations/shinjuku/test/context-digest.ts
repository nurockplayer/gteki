/**
 * Byte digest of everything in a built station scene that physically constrains the walker or the follow
 * camera: wall segments, spawn points, and the exact geometry of the walkable, collider and camera-blocker
 * meshes (names and roles included). The street context is visual only, so it must leave this unchanged.
 */
import { createHash } from "node:crypto";
import type * as THREE from "three";
import type { StationScene } from "@gteki/scene-api";

const hashBytes = (h: ReturnType<typeof createHash>, a: ArrayLike<number> & { buffer?: ArrayBufferLike; byteOffset?: number; byteLength?: number }) => {
  const arr = a as unknown as ArrayBufferView;
  h.update(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
};

function meshDigest(o: THREE.Object3D): string {
  const h = createHash("sha256");
  const m = o as THREE.Mesh;
  h.update(`${o.name}|${String(o.userData.gteki_role ?? "")}|${m.isMesh ? "mesh" : o.type}|`);
  if (m.isMesh) {
    const g = m.geometry;
    for (const key of Object.keys(g.attributes).sort()) {
      h.update(`${key}:`);
      hashBytes(h, g.attributes[key]!.array as Float32Array);
    }
    if (g.index) hashBytes(h, g.index.array as Uint32Array);
    h.update(JSON.stringify(g.groups));
  }
  h.update(JSON.stringify(o.matrixWorld.elements));
  return h.digest("hex");
}

export interface PhysicalDigest {
  walls: string;
  spawnPoints: string;
  walkable: string[];
  colliders: string[];
  cameraBlockers: string[];
  /** One hash over all of the above. */
  all: string;
}

export function physicalDigest(scene: StationScene): PhysicalDigest {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const walls = sha(JSON.stringify(scene.walls ?? []));
  const spawnPoints = sha(JSON.stringify(scene.spawnPoints ?? []));
  scene.root.updateMatrixWorld(true);
  const walkable = scene.walkable.map(meshDigest);
  const colliders = (scene.colliders ?? []).map(meshDigest);
  const cameraBlockers = (scene.cameraBlockers ?? []).map(meshDigest);
  return { walls, spawnPoints, walkable, colliders, cameraBlockers, all: sha([walls, spawnPoints, ...walkable, "|", ...colliders, "|", ...cameraBlockers].join("\n")) };
}
