import * as THREE from "three";
import type { Asset } from "@gteki/schema";
import type { SceneContext, StationScene } from "@gteki/scene-api";
import { sceneFromGlbRoles } from "@gteki/scene-api";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

/** Which manifest variant an asset's root came from (`userData.gtekiAsset`), for `sceneInfo().assets`. */
export interface LoadedAsset { id: string; variant: "full" | "mobile"; uri: string; mobileFailed?: true }

/**
 * A station without a scene module: load its manifest GLBs and classify meshes by gteki_role.
 * If any asset fails, the ones already loaded are disposed before the error propagates (no
 * StationScene, and so no disposer, reaches the caller). An asset with a `uriMobile` loads that lighter variant
 * on the low quality tier, `uri` otherwise.
 */
export async function manifestScene(assets: readonly Asset[], ctx: Pick<SceneContext, "loadGlb" | "quality">): Promise<StationScene> {
  const root = new THREE.Group();
  const walkable: THREE.Object3D[] = [];
  const colliders: THREE.Object3D[] = [];
  const cameraBlockers: THREE.Object3D[] = [];
  const loaded = new Map<string, Promise<{ gltf: Awaited<ReturnType<typeof ctx.loadGlb>>; from: LoadedAsset; template: THREE.Object3D }>>();
  try {
    for (const asset of assets) {
      // One load per URI and tier variant; later placements clone the pristine template.
      const key = `${asset.uri}\0${ctx.quality === "low" ? asset.uriMobile ?? "" : ""}`;
      let pending = loaded.get(key);
      const firstPlacement = !pending;
      if (!pending) {
        pending = loadTier(asset, ctx).then(({ gltf, loaded: from }) => ({
          gltf,
          from,
          // Preserve the source before placement transforms or role classification mutate it.
          template: cloneScene(gltf.scene),
        }));
        loaded.set(key, pending);
      }
      const source = await pending;
      const scene = firstPlacement ? source.gltf.scene : cloneScene(source.template);
      scene.userData.gtekiAsset = { ...source.from, id: asset.id };
      // Attach first, so a failure below still disposes this asset with the others.
      root.add(scene);
      if (asset.transform) scene.applyMatrix4(new THREE.Matrix4().fromArray(asset.transform));
      const roles = sceneFromGlbRoles(scene, { assetRole: asset.role });
      walkable.push(...roles.walkable);
      colliders.push(...roles.colliders);
      cameraBlockers.push(...roles.cameraBlockers);
    }
  } catch (error) {
    disposeObject(root);
    throw error;
  }
  return { root, walkable, colliders, cameraBlockers, dispose: () => disposeObject(root) };
}

function cloneScene(scene: THREE.Object3D): THREE.Object3D {
  let hasSkinnedMesh = false;
  scene.traverse((object) => { if ((object as THREE.SkinnedMesh).isSkinnedMesh) hasSkinnedMesh = true; });
  return hasSkinnedMesh ? cloneSkeleton(scene) : scene.clone(true);
}

/**
 * The low tier loads `uriMobile` when set. If that fails it falls back to `uri` (reported as `variant: "full"` with
 * `mobileFailed`), so one missing phone file costs bandwidth instead of dropping the station to the L0 graph view.
 */
async function loadTier(asset: Asset, ctx: Pick<SceneContext, "loadGlb" | "quality">) {
  if (ctx.quality === "low" && asset.uriMobile) {
    try {
      return { gltf: await ctx.loadGlb(asset.uriMobile), loaded: { id: asset.id, variant: "mobile", uri: asset.uriMobile } as LoadedAsset };
    } catch (error) {
      console.warn(`[gteki] ${asset.id}: uriMobile failed, loading uri instead`, error);
      return { gltf: await ctx.loadGlb(asset.uri), loaded: { id: asset.id, variant: "full", uri: asset.uri, mobileFailed: true } as LoadedAsset };
    }
  }
  return { gltf: await ctx.loadGlb(asset.uri), loaded: { id: asset.id, variant: "full", uri: asset.uri } as LoadedAsset };
}

/** Release geometries, materials and their textures owned by a loaded subtree. */
export function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const m = mesh.material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) materials.add(mat);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const mat of materials) {
    for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value);
    mat.dispose();
  }
  for (const t of textures) t.dispose();
}
