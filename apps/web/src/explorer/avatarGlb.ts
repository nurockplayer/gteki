/** #339 X1: optional rigged GLB avatar; X2 replaces the isolated clip-name crossfade below. */
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { AvatarRig } from "./avatar.ts";
import { ditherFade, sanitizeAvatarFade } from "./avatarDither.ts";

type AvatarAsset = Pick<GLTF, "scene" | "animations"> & Partial<Pick<GLTF, "scenes">>;
/** Like GLTFLoader, an injected loader transfers ownership of the asset's resources to the rig. */
export interface AvatarGlbLoader { loadAsync(url: string): Promise<AvatarAsset> }

export async function loadGlbAvatar(url: string, opts: { quality: "low" | "high"; loader?: AvatarGlbLoader }): Promise<AvatarRig> {
  // Both quality tiers use the supplied URL for now; Lane E supplies the tiered assets later.
  const loader = opts.loader ?? new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  const root = new THREE.Group();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  const clones = new Map<THREE.Material, THREE.Material>();
  const fade = { value: 1 };
  let mixer: THREE.AnimationMixer | undefined;
  let disposed = false;

  // Include unused glTF scenes too. Original materials remain unpatched, but are owned by this load.
  for (const scene of new Set([gltf.scene, ...(gltf.scenes ?? [])])) scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
  });

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    mixer?.stopAllAction();
    mixer?.uncacheRoot(gltf.scene);
    // Bone textures can be allocated lazily by the renderer, after load. Deduplicate them with all maps.
    for (const skeleton of skeletons) {
      if (skeleton.boneTexture) textures.add(skeleton.boneTexture);
      skeleton.boneTexture = null;
    }
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  };

  try {
    let skinned = false;
    gltf.scene.traverse((object) => { if (object instanceof THREE.SkinnedMesh) skinned = true; });
    if (!skinned) throw new Error("Avatar GLB requires a SkinnedMesh");
    gltf.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(gltf.scene);
    const height = bounds.max.y - bounds.min.y;
    if (bounds.isEmpty() || ![...bounds.min, ...bounds.max, height].every(Number.isFinite) || height <= 0) {
      throw new Error("Avatar GLB has invalid bounds");
    }
    // Contract: Y up, faces -Z (unlike the station kit's +Z); no axis rotation is applied.
    // Scale bind-pose height to 1.70 metres and centre X/Z with the feet at Y=0. Keep animated nodes intact.
    const normalized = new THREE.Group();
    const scale = 1.7 / height;
    normalized.scale.setScalar(scale);
    normalized.position.set(-(bounds.min.x + bounds.max.x) * 0.5 * scale, -bounds.min.y * scale, -(bounds.min.z + bounds.max.z) * 0.5 * scale);
    normalized.add(gltf.scene);
    root.add(normalized);
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      if (object instanceof THREE.SkinnedMesh) object.frustumCulled = false;
      const clone = (source: THREE.Material): THREE.Material => {
        let material = clones.get(source);
        if (!material) {
          material = source.clone();
          clones.set(source, material);
          materials.add(material);
          ditherFade(material, fade);
        }
        return material;
      };
      object.material = Array.isArray(object.material) ? object.material.map(clone) : clone(object.material);
    });
    mixer = new THREE.AnimationMixer(gltf.scene);
    const animate = clipCrossfade(mixer, gltf.animations);
    return {
      root,
      update(dt, speedMps) { if (!disposed) { animate(speedMps); mixer!.update(Number.isFinite(dt) ? Math.max(0, dt) : 0); } },
      setFade(opacity) { fade.value = sanitizeAvatarFade(opacity); },
      setEnvMap(env, intensity = 0.6) {
        for (const material of clones.values()) {
          if ("envMap" in material) {
            const lit = material as THREE.MeshStandardMaterial;
            if (lit.envMap !== env) { lit.envMap = env; lit.needsUpdate = true; }
            lit.envMapIntensity = intensity;
          }
        }
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

/** Temporary X1 policy: named clips only, no phase/stride correction or terrain logic. */
function clipCrossfade(mixer: THREE.AnimationMixer, clips: THREE.AnimationClip[]): (speed: number) => void {
  const action = (name: string): THREE.AnimationAction | undefined => {
    const clip = clips.find((clip) => clip.name.toLowerCase() === name);
    return clip ? mixer.clipAction(clip) : undefined;
  };
  const idle = action("idle"), walk = action("walk"), run = action("run");
  let active = idle ?? walk ?? run;
  active?.play();
  return (speed) => {
    const next = speed > 2.4 ? run ?? walk ?? idle : speed > 0.1 ? walk ?? idle ?? run : idle ?? walk ?? run;
    if (!next || next === active) return;
    next.reset().play();
    active?.crossFadeTo(next, 0.2, false);
    active = next;
  };
}
