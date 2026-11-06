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

/** Per-clip stride speeds baked into the cat GLB's `extras.gteki_cat.calib`, in m/s. */
export interface CatCalibration { walk: number; trot: number; run: number }

export interface GlbAvatarOptions {
  quality: "low" | "high";
  loader?: AvatarGlbLoader;
  /** Bind-pose height in metres; the human protagonist's 1.70 is the default. */
  heightM?: number;
  /** Four-legged protagonist: gait clip policy and floor-hugging draw order (see `catClips`). */
  cat?: boolean;
}

export async function loadGlbAvatar(url: string, opts: GlbAvatarOptions): Promise<AvatarRig> {
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
    // Scale bind-pose height to the requested size and centre X/Z with the feet at Y=0. Keep animated nodes intact.
    const normalized = new THREE.Group();
    const scale = (opts.heightM ?? 1.7) / height;
    normalized.scale.setScalar(scale);
    normalized.position.set(-(bounds.min.x + bounds.max.x) * 0.5 * scale, -bounds.min.y * scale, -(bounds.min.z + bounds.max.z) * 0.5 * scale);
    normalized.add(gltf.scene);
    root.add(normalized);
    gltf.scene.traverse((object) => {
      if (!isDrawable(object)) return;
      object.castShadow = true;
      // The cat walks the station floor under the always-on-top route band (renderOrder 21):
      // draw it later so that band never covers it.
      if (opts.cat) object.renderOrder = 30;
      if (object instanceof THREE.SkinnedMesh) object.frustumCulled = false;
      const clone = (source: THREE.Material): THREE.Material => {
        let material = clones.get(source);
        if (!material) {
          material = source.userData.gteki_toon ? toonClone(source) : source.clone();
          if (opts.cat) {
            material.transparent = true;
            material.depthWrite = true;
          }
          clones.set(source, material);
          materials.add(material);
          ditherFade(material, fade);
        }
        return material;
      };
      object.material = Array.isArray(object.material) ? object.material.map(clone) : clone(object.material);
    });
    mixer = new THREE.AnimationMixer(gltf.scene);
    let hold: "sit" | null = null;
    const animate = opts.cat
      ? catClips(mixer, gltf.animations, catCalibration(gltf.scene), () => hold)
      : clipCrossfade(mixer, gltf.animations);
    return {
      root,
      update(dt, speedMps) {
        if (disposed) return;
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        animate(speedMps, step);
        mixer!.update(step);
      },
      setHold(pose) { hold = pose; },
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

/** The cat GLB carries its stride speeds in `extras.gteki_cat.calib` on a node. */
function catCalibration(scene: THREE.Object3D): CatCalibration | undefined {
  let calib: CatCalibration | undefined;
  scene.traverse((object) => {
    const value = (object.userData as { gteki_cat?: { calib?: CatCalibration } }).gteki_cat?.calib;
    if (!calib && value && (["walk", "trot", "run"] as const).every((key) => Number.isFinite(value[key]))) calib = value;
  });
  return calib;
}

/**
 * Cat gait policy (#854): below 0.05 m/s the cat idles and sits after 4 s, then walk below 0.7,
 * trot below 1.9, run above. Each locomotion clip plays at `speed / calib` so the paws stay planted.
 */
export function catClips(
  mixer: THREE.AnimationMixer,
  clips: THREE.AnimationClip[],
  calib: CatCalibration | undefined,
  hold: () => "sit" | null = () => null,
): (speed: number, dt: number) => void {
  const action = (name: string): THREE.AnimationAction | undefined => {
    const clip = clips.find((candidate) => candidate.name.toLowerCase() === name);
    return clip ? mixer.clipAction(clip) : undefined;
  };
  const idle = action("idle"), sit = action("sit"), walk = action("walk"), trot = action("trot"), run = action("run");
  let active = idle ?? sit ?? walk ?? trot ?? run;
  active?.play();
  let restSeconds = 0;
  return (speed, dt) => {
    let next: THREE.AnimationAction | undefined;
    if (hold() === "sit") {
      next = sit ?? idle;
    } else if (!(speed > 0.05)) {
      restSeconds += Number.isFinite(dt) ? Math.max(0, dt) : 0;
      next = restSeconds >= 4 ? sit ?? idle : idle;
    } else {
      restSeconds = 0;
      next = speed < 0.7 ? walk ?? trot ?? run ?? idle
        : speed < 1.9 ? trot ?? walk ?? run ?? idle
        : run ?? trot ?? walk ?? idle;
    }
    next ??= active;
    if (!next) return;
    if (next !== active) {
      next.reset().play();
      active?.crossFadeTo(next, 0.2, false);
      active = next;
    }
    if (!active) return;
    const gait = next === walk ? "walk" : next === trot ? "trot" : next === run ? "run" : undefined;
    const stride = gait && calib ? calib[gait] : 0;
    active.timeScale = stride && Number.isFinite(stride) && stride > 0 ? speed / stride : 1;
  };
}

/** Temporary X1 policy: named clips only, no phase/stride correction or terrain logic. */
function clipCrossfade(mixer: THREE.AnimationMixer, clips: THREE.AnimationClip[]): (speed: number, dt: number) => void {
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
