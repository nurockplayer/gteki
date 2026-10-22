import * as THREE from "three";
import type { Asset } from "@gteki/schema";
import type { SceneContext, StationScene } from "@gteki/scene-api";
import { sceneFromGlbRoles } from "@gteki/scene-api";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

/**
 * A station without a scene module: load its manifest GLBs and classify meshes by gteki_role.
 * If any asset fails, the ones already loaded are disposed before the error propagates (no
 * StationScene, and so no disposer, reaches the caller).
 */
export async function manifestScene(assets: readonly Asset[], ctx: Pick<SceneContext, "loadGlb">): Promise<StationScene> {
  const root = new THREE.Group();
  const walkable: THREE.Object3D[] = [];
  const colliders: THREE.Object3D[] = [];
  const cameraBlockers: THREE.Object3D[] = [];
  const loaded = new Map<string, Promise<{ gltf: Awaited<ReturnType<typeof ctx.loadGlb>>; template: THREE.Object3D }>>();
  try {
    for (const asset of assets) {
      let pending = loaded.get(asset.uri);
      const firstPlacement = !pending;
      if (!pending) {
        pending = ctx.loadGlb(asset.uri).then((gltf) => ({
          gltf,
          // Preserve the source before placement transforms or role classification mutate it.
          template: cloneScene(gltf.scene),
        }));
        loaded.set(asset.uri, pending);
      }
      const source = await pending;
      const scene = firstPlacement ? source.gltf.scene : cloneScene(source.template);
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
