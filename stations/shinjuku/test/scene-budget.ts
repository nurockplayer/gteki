/** Draw, triangle and geometry-memory counts of an object subtree, for the street-context budget report. */
import type * as THREE from "three";

export interface Budget { draws: number; triangles: number; geometryBytes: number; meshes: number }

export function measure(root: THREE.Object3D, include: (o: THREE.Object3D) => boolean = () => true): Budget {
  const geometries = new Set<THREE.BufferGeometry>();
  let draws = 0, triangles = 0, meshes = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !include(o)) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.every((x) => x.visible === false)) return; // invisible proxies are never drawn
    const g = m.geometry;
    if (!g.attributes.position) return; // the viewer probe draws nothing
    const count = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
    const perDraw = (g.index ? g.index.count : g.attributes.position!.count) / 3;
    meshes++;
    draws += g.groups.length > 1 ? g.groups.length : 1;
    triangles += perDraw * count;
    geometries.add(g);
  });
  // Each underlying array once: an interleaved attribute's position and normal share one buffer.
  const arrays = new Set<ArrayBufferView>();
  for (const g of geometries) {
    for (const a of Object.values(g.attributes)) arrays.add((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as THREE.InterleavedBufferAttribute).data.array : (a as THREE.BufferAttribute).array);
    if (g.index) arrays.add(g.index.array);
  }
  let geometryBytes = 0;
  for (const a of arrays) geometryBytes += a.byteLength;
  return { draws, triangles: Math.round(triangles), geometryBytes, meshes };
}
