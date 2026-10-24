/**
 * Turns kit placements into as few draws as the materials allow: one merged mesh per (level, material, retained textures).
 *
 * - Only visual nodes are used. `COL_*`, `*-colonly`, `SOCKET_*` and `LIGHTHINT_*` never reach the scene:
 *   kit pieces are visual-only here, and collision stays the station's own merged wall collider.
 * - Materials are keyed by `extras.gteki_name`, falling back to the material name, so AO-baked clones
 *   (`<material>~<asset_id>`) still batch together. Per-asset AO maps cannot survive that merge, so they are
 *   dropped from the shared material (the station has GTAO on high).
 * - Every batched material is a clone owned (tracked) by the station, together with the textures it keeps
 *   (ctx.loadGlb returns a fresh, uncached GLTF per call). Slots that match a tint rule (`line_accent`) are tinted to the line colour on that clone.
 * - A mesh with an array of materials is split by its geometry groups, one slice per material. A multi-material
 *   mesh without groups draws nothing in three.js and is treated as not drawn.
 * - `drawn` lists only complete placements: if any batch fails to merge, all geometry belonging to its
 *   placements is removed from every batch before drawing. Only complete placements may hide a placeholder.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TINT_BASE_COMPENSATION, type TintSlot } from "./config.ts";
import { compact } from "./ledger.ts";
import { materialKey } from "./place.ts";
import type { KitAssetProvider, KitManifest, KitPlacement } from "./types.ts";

export interface BatchResult {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  tinted: string[];
  triangles: number;
  geometryBytes: number;
  /** Placements the provider could not instantiate. */
  missing: string[];
  /** Placements with drawable triangles and no failed batches. */
  drawn: Set<KitPlacement>;
}

const NON_VISUAL = /^(COL_|SOCKET_|LIGHTHINT_)|-colonly$/;

/** The contract name of a node: `extras.gteki_name` when a bundle importer renamed it, else its name. */
export const contractName = (o: THREE.Object3D): string => (typeof o.userData?.gteki_name === "string" ? (o.userData.gteki_name as string) : o.name);

/**
 * A copy with only position, normal and uv, as plain Float32 attributes: meshopt-compressed kit bundles may
 * quantise (normalised Int16), and merging or transforming those in place would clip or refuse to merge.
 */
function plainGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv"] as const) {
    const a = src.getAttribute(name);
    if (!a) continue;
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (src.index) out.setIndex(Array.from(src.index.array));
  return out;
}

export function batchKitPlacements(args: {
  placed: readonly KitPlacement[];
  manifest: KitManifest;
  provider: KitAssetProvider;
  tint: readonly TintSlot[];
  track: <T extends { dispose(): void }>(x: T) => T;
}): BatchResult {
  const { placed, manifest, provider, tint, track } = args;
  const batches = new Map<string, { floorId: string; key: string; material: THREE.Material; parts: { geo: THREE.BufferGeometry; placement: KitPlacement }[] }>();
  const sharedMaterials = new Map<THREE.Material, THREE.Material>();
  const tinted = new Set<string>();
  const missing: string[] = [];

  const resolveMaterial = (m: THREE.Material, key: string): THREE.Material => {
    let out = sharedMaterials.get(m);
    if (!out) {
      const slot = tint.find((t) => t.match.test(key));
      out = m.clone();
      out.name = key;
      // Clone copies userData: a GLB role must never reach the station's merged materials (kit pieces are visual-only).
      delete out.userData.gteki_role;
      const s = out as THREE.MeshStandardMaterial;
      if (s.aoMap) { s.aoMap = null; s.aoMapIntensity = 1; }
      if (slot && s.color) {
        s.color.set(slot.colour);
        if (s.map) for (const c of ["r", "g", "b"] as const) s.color[c] = Math.min(1, s.color[c] * TINT_BASE_COMPENSATION);
        tinted.add(key);
      }
      track(out);
      // Material.clone() shares the GLB's textures. The explorer's ctx.loadGlb parses a fresh GLTF on every
      // call (no cache), so this station build is their only user: release the retained ones with it. The
      // discarded aoMap is never drawn, so it never reaches the GPU. If a GLB cache is ever added, ownership
      // must move to that cache instead.
      for (const v of Object.values(out)) if (v && (v as THREE.Texture).isTexture) track(v as THREE.Texture);
      sharedMaterials.set(m, out);
    }
    return out;
  };

  for (const p of placed) {
    const asset = manifest.byId.get(p.assetId);
    const obj = asset ? provider.instantiate(asset) : null;
    if (!asset || !obj) { missing.push(p.assetId); continue; }
    obj.position.set(...p.position);
    obj.rotation.set(0, p.yaw, 0);
    obj.updateMatrixWorld(true);
    const add = (src: THREE.Mesh, geo: THREE.BufferGeometry, material: THREE.Material) => {
      const key = materialKey(typeof material.userData?.gteki_name === "string" ? (material.userData.gteki_name as string) : material.name);
      geo.applyMatrix4(src.matrixWorld);
      if (!geo.index) geo.setIndex([...Array(geo.attributes.position!.count).keys()]);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      if (!geo.attributes.uv) geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position!.count * 2), 2));
      if (geo.index!.count < 3) { geo.dispose(); return; }
      // AO is discarded; every retained texture slot must reference the same texture to share a draw.
      const textures = Object.entries(material)
        .filter(([slot, value]) => slot !== "aoMap" && (value as THREE.Texture | null)?.isTexture)
        .map(([slot, value]) => [slot, (value as THREE.Texture).uuid])
        .sort(([a], [b]) => a!.localeCompare(b!));
      const id = JSON.stringify([p.floorId, key, textures]);
      const batch = batches.get(id) ?? { floorId: p.floorId, key, material: resolveMaterial(material, key), parts: [] };
      batch.parts.push({ geo, placement: p });
      batches.set(id, batch);
    };
    const visit = (o: THREE.Object3D) => {
      if (!o.visible || NON_VISUAL.test(contractName(o))) return;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry && mesh.material) {
        const plain = plainGeometry(mesh.geometry);
        if (!Array.isArray(mesh.material)) {
          add(mesh, plain, mesh.material);
        } else {
          const all = plain.index ? Array.from(plain.index.array) : [...Array(plain.attributes.position!.count).keys()];
          for (const g of mesh.geometry.groups) {
            const material = mesh.material[g.materialIndex ?? 0];
            if (!material) continue;
            const slice = all.slice(g.start, Math.min(all.length, g.start + g.count));
            if (slice.length >= 3) add(mesh, compact(plain, slice), material);
          }
          plain.dispose();
        }
      }
      for (const c of o.children) visit(c);
    };
    visit(obj);
  }

  const group = new THREE.Group();
  group.name = "kit-swap";
  const meshes: THREE.Mesh[] = [];
  const drawn = new Set<KitPlacement>();
  let triangles = 0;
  let geometryBytes = 0;
  const ordered = [...batches].sort(([x], [y]) => x.localeCompare(y)).map(([, b]) => b);
  const failed = new Set<KitPlacement>();
  let merged: { batch: (typeof ordered)[number]; geo: THREE.BufferGeometry }[];
  // A failed piece may also contribute to a successful shared batch. Rebuild without it so no partial
  // piece survives beside its placeholder. Each retry removes placements, so this loop is bounded.
  for (;;) {
    merged = [];
    const before = failed.size;
    for (const batch of ordered) {
      const parts = batch.parts.filter((part) => !failed.has(part.placement));
      if (!parts.length) continue;
      const geo = mergeGeometries(parts.map((part) => part.geo), false);
      if (geo) merged.push({ batch, geo });
      else for (const part of parts) failed.add(part.placement);
    }
    if (failed.size === before) break;
    for (const { geo } of merged) geo.dispose();
  }
  for (const batch of ordered) for (const part of batch.parts) part.geo.dispose();
  for (const { batch: b, geo } of merged) {
    for (const part of b.parts) if (!failed.has(part.placement)) drawn.add(part.placement);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    track(geo);
    const mesh = new THREE.Mesh(geo, b.material);
    mesh.name = `kit:${b.floorId}:${b.key}`;
    mesh.userData.gteki_kit = true;
    meshes.push(mesh);
    group.add(mesh);
    triangles += (geo.index?.count ?? 0) / 3;
    geometryBytes += Object.values(geo.attributes).reduce((s, a) => s + (a as THREE.BufferAttribute).array.byteLength, 0) + (geo.index?.array.byteLength ?? 0);
  }
  return { group, meshes, tinted: [...tinted].sort(), triangles, geometryBytes, missing, drawn };
}
