/** #339 X1: optional rigged GLB avatar; X2 replaces the isolated clip-name crossfade below. */
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { AvatarRig } from "./avatar.ts";
import { ditherFade, sanitizeAvatarFade } from "./avatarDither.ts";

type AvatarAsset = Pick<GLTF, "scene" | "animations"> & Partial<Pick<GLTF, "scenes">>;
/** Like GLTFLoader, an injected loader transfers ownership of the asset's resources to the rig. */
export interface AvatarGlbLoader { loadAsync(url: string): Promise<AvatarAsset> }

/** Every primitive that carries geometry and materials: meshes plus the Line/Points a GLB may also contain. */
type Drawable = THREE.Mesh | THREE.Line | THREE.Points;

function isDrawable(object: THREE.Object3D): object is Drawable {
  return object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points;
}

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
    if (!isDrawable(object)) return;
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
    // GLTFLoader decodes images through ImageBitmapLoader, and Texture.dispose() does not close the decoded
    // bitmap. One image can back several textures, so close each owned bitmap once, by identity.
    const bitmaps = new Set<ImageBitmap>();
    for (const texture of textures) {
      for (const image of Array.isArray(texture.image) ? texture.image : [texture.image]) {
        if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) bitmaps.add(image);
      }
      texture.dispose();
    }
    for (const bitmap of bitmaps) bitmap.close();
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
      if (!isDrawable(object)) return;
      object.castShadow = true;
      if (object instanceof THREE.SkinnedMesh) object.frustumCulled = false;
      const clone = (source: THREE.Material): THREE.Material => {
        let material = clones.get(source);
        if (!material) {
          material = source.userData.gteki_toon ? toonClone(source) : source.clone();
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
          // `"envMap" in material` also matches unlit materials (MeshBasicMaterial, KHR_materials_unlit):
          // only the PBR classes may take the station's probe. MeshPhysicalMaterial extends MeshStandardMaterial.
          if (material instanceof THREE.MeshStandardMaterial) {
            if (material.envMap !== env) { material.envMap = env; material.needsUpdate = true; }
            material.envMapIntensity = intensity;
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

const TOON_FILL = 0.55;

/** One shared 3-tone ramp for toon-flagged avatar materials: nearest-sampled, no mipmaps. */
let toonRamp: THREE.DataTexture | undefined;
function toonGradient(): THREE.DataTexture {
  if (!toonRamp) {
    toonRamp = new THREE.DataTexture(new Uint8Array([150, 205, 255]), 3, 1, THREE.RedFormat, THREE.UnsignedByteType);
    toonRamp.minFilter = THREE.NearestFilter;
    toonRamp.magFilter = THREE.NearestFilter;
    toonRamp.generateMipmaps = false;
    toonRamp.needsUpdate = true;
  }
  return toonRamp;
}

/** Matte toon clone of a glTF material flagged `gteki_toon` (base colour texture only, no specular). */
function toonClone(source: THREE.Material): THREE.MeshToonMaterial {
  const standard = source as THREE.MeshStandardMaterial;
  const material = new THREE.MeshToonMaterial({
    map: standard.map ?? null,
    color: standard.color ? standard.color.clone() : new THREE.Color(0xffffff),
    gradientMap: toonGradient(),
    // Scene-lit stations switch the core lights off and light PBR by IBL alone, which toon shading ignores:
    // the base colour doubles as a fill so the avatar never goes black; any real light adds the 3-tone ramp.
    emissive: new THREE.Color().setScalar(TOON_FILL),
    emissiveMap: standard.map ?? null,
    side: source.side,
  });
  material.name = source.name;
  return material;
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
