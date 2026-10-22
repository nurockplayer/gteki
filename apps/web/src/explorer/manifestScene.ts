import * as THREE from "three";
import type { Asset } from "@gteki/schema";
import type { SceneContext, StationScene } from "@gteki/scene-api";
import { sceneFromGlbRoles } from "@gteki/scene-api";

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
  try {
    for (const asset of assets) {
      const gltf = await ctx.loadGlb(ctx.quality === "low" && asset.uriMobile ? asset.uriMobile : asset.uri);
      // Attach first, so a failure below still disposes this asset with the others.
      root.add(gltf.scene);
      if (asset.transform) gltf.scene.applyMatrix4(new THREE.Matrix4().fromArray(asset.transform));
      const roles = sceneFromGlbRoles(gltf.scene, { assetRole: asset.role });
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

/** Release geometries, materials and their textures owned by a loaded subtree. */
export function disposeObject(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const m = mesh.material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) materials.add(mat);
  });
  for (const mat of materials) {
    for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value);
    mat.dispose();
  }
  for (const t of textures) t.dispose();
}
