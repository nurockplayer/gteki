/**
 * Digests of a built station tree. `geometryDigest` hashes exactly what test/helpers/retained-geometry.ts
 * hashes (name, transform, visibility, every attribute/index byte, instance matrices and counts, in
 * traversal order), so its value for a flag-off build is comparable with that helper's committed hash.
 * `appearanceDigest` adds what a viewer sees that geometry bytes do not carry: material kind, colours,
 * textures present, blending flags and render order.
 */
import { createHash } from "node:crypto";
import * as THREE from "three";

export interface StationDigest {
  geometryDigest: string;
  appearanceDigest: string;
  meshes: number;
  bytes: number;
}

/** `skip` prunes whole subtrees (the scene hook's walk proxies and probe, the kit group). Traversal order is `Object3D.traverse`'s. */
export function digestStation(root: THREE.Object3D, skip: (o: THREE.Object3D) => boolean = () => false): StationDigest {
  const geometry = createHash("sha256");
  const appearance = createHash("sha256");
  let meshes = 0;
  let bytes = 0;
  const visit = (o: THREE.Object3D) => {
    if (skip(o)) return;
    if (o instanceof THREE.Mesh) one(o);
    for (const c of o.children) visit(c);
  };
  const one = (o: THREE.Mesh) => {
    meshes++;
    geometry.update(JSON.stringify([o.name, o.position, o.quaternion, o.scale, o.visible]));
    for (const [name, a] of [["index", o.geometry.index], ...Object.entries(o.geometry.attributes)] as const) {
      if (!a) continue;
      geometry.update(JSON.stringify([name, a.itemSize, a.normalized]));
      geometry.update(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength));
      bytes += a.array.byteLength;
    }
    if (o instanceof THREE.InstancedMesh) {
      geometry.update(JSON.stringify(o.count));
      geometry.update(Buffer.from(o.instanceMatrix.array.buffer));
    }
    for (const m of [o.material].flat() as THREE.Material[]) {
      const s = m as THREE.MeshStandardMaterial;
      appearance.update(JSON.stringify([
        o.name, m.type, m.visible, m.transparent, m.opacity, m.side, m.depthWrite,
        s.color?.getHexString?.() ?? null, s.emissive?.getHexString?.() ?? null, s.emissiveIntensity ?? null,
        s.roughness ?? null, s.metalness ?? null, !!s.map, !!s.aoMap, !!s.bumpMap, !!s.emissiveMap, o.renderOrder,
      ]));
    }
  };
  visit(root);
  return { geometryDigest: geometry.digest("hex"), appearanceDigest: appearance.digest("hex"), meshes, bytes };
}
