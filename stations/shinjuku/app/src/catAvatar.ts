/** #854: optional rigged GLB cat for the standalone app, ported from the explorer's `avatarGlb.ts`. */
import type * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { createAvatar, type Avatar } from "./avatar.ts";

/** The GLB parts this avatar owns; a full GLTF from GLTFLoader satisfies it. */
type CatAsset = Pick<GLTF, "scene" | "animations"> & Partial<Pick<GLTF, "scenes">>;
/** Like GLTFLoader, an injected loader transfers ownership of the asset's resources to the avatar. */
export interface CatAvatarLoader { loadAsync(url: string): Promise<CatAsset> }

/** Bind-pose height in metres, the same as the explorer's cat (apps/web `CAT_AVATAR_HEIGHT_M`). */
const CAT_HEIGHT_M = 0.345;
/** Shared with apps/web; Vite resolves it and the shinjuku `fs.allow` already reaches it. */
const CAT_URL = new URL("../../../../apps/web/public/avatars/cat.glb", import.meta.url).href;

/** Per-clip stride speeds baked into the cat GLB's `extras.gteki_cat.calib`, in m/s. */
interface CatCalibration { walk: number; trot: number; run: number }

/** Every primitive that carries geometry and materials: meshes plus the Line/Points a GLB may also contain. */
type Drawable = THREE.Mesh | THREE.Line | THREE.Points;

export interface CatAvatarOptions {
  loader?: CatAvatarLoader;
  url?: string;
  /** Called once after the human is shown in place of a failed cat load. */
  onFallback?: () => void;
}

/** One rigged cat from a GLB: an empty group at once, filled in when the asset arrives. */
export function createCatAvatar(T: typeof THREE, opts: CatAvatarOptions = {}): Avatar {
  const object = new T.Group();
  object.name = "CatAvatar";
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  let loadedScene: THREE.Object3D | undefined;
  let mixer: THREE.AnimationMixer | undefined;
  let animate: ((speed: number, dt: number) => void) | undefined;
  let human: Avatar | undefined;
  let disposed = false;

  const isDrawable = (child: THREE.Object3D): child is Drawable =>
    child instanceof T.Mesh || child instanceof T.Line || child instanceof T.Points;

  const collect = (loaded: CatAsset): void => {
    for (const scene of new Set([loaded.scene, ...(loaded.scenes ?? [])])) scene.traverse((child) => {
      if (!isDrawable(child)) return;
      geometries.add(child.geometry);
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
    });
  };
  const release = (): void => {
    if (mixer && loadedScene) {
      mixer.stopAllAction();
      mixer.uncacheRoot(loadedScene);
    }
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    geometries.clear();
    materials.clear();
  };
  const fallBack = (error: unknown): void => {
    if (disposed) return;
    console.warn("Cat avatar failed to load; showing the human instead.", error);
    human = createAvatar(T, 0);
    object.add(human.object);
    opts.onFallback?.();
  };
  const setup = (loaded: CatAsset): void => {
    let skinned = false;
    loaded.scene.traverse((child) => { if (child instanceof T.SkinnedMesh) skinned = true; });
    if (!skinned) throw new Error("Cat GLB requires a SkinnedMesh");
    loaded.scene.updateMatrixWorld(true);
    const bounds = new T.Box3().setFromObject(loaded.scene);
    const height = bounds.max.y - bounds.min.y;
    if (bounds.isEmpty() || ![...bounds.min, ...bounds.max, height].every(Number.isFinite) || height <= 0) {
      throw new Error("Cat GLB has invalid bounds");
    }
    // Contract: Y up, faces -Z; no axis rotation. Scale the bind pose to the cat's height,
    // centre X/Z and put the feet at Y=0, keeping the animated nodes intact.
    const normalized = new T.Group();
    const scale = CAT_HEIGHT_M / height;
    normalized.scale.setScalar(scale);
    normalized.position.set(-(bounds.min.x + bounds.max.x) * 0.5 * scale, -bounds.min.y * scale, -(bounds.min.z + bounds.max.z) * 0.5 * scale);
    normalized.add(loaded.scene);
    loaded.scene.traverse((child) => {
      if (child instanceof T.SkinnedMesh) child.frustumCulled = false;
    });
    object.add(normalized);
    loadedScene = loaded.scene;
    mixer = new T.AnimationMixer(loaded.scene);
    animate = catClips(mixer, loaded.animations, catCalibration(loaded.scene));
  };

  const loader = opts.loader ?? new GLTFLoader();
  void loader.loadAsync(opts.url ?? CAT_URL).then(
    (loaded) => {
      collect(loaded);
      if (disposed) { release(); return; }
      try {
        setup(loaded);
      } catch (error) {
        release();
        fallBack(error);
      }
    },
    (error: unknown) => { fallBack(error); },
  );

  function update(dt: number, speedMps: number, updateOpts?: { onStairs?: boolean; climbing?: number }): void {
    if (disposed) return;
    if (human) { human.update(dt, speedMps, updateOpts); return; }
    if (!animate || !mixer) return;
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const speed = Number.isFinite(speedMps) ? Math.max(0, speedMps) : 0;
    animate(speed, step);
    mixer.update(step);
  }
  function setColorway(): void {}
  function setDistance(): void {}
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    human?.dispose();
    if (geometries.size || materials.size) release();
    object.clear();
  }
  return { object, update, setColorway, setDistance, dispose };
}

/** The cat GLB carries its stride speeds in `extras.gteki_cat.calib` on a node. */
function catCalibration(scene: THREE.Object3D): CatCalibration | undefined {
  let calib: CatCalibration | undefined;
  scene.traverse((child) => {
    const value = (child.userData as { gteki_cat?: { calib?: CatCalibration } }).gteki_cat?.calib;
    if (!calib && value && (["walk", "trot", "run"] as const).every((key) => Number.isFinite(value[key]))) calib = value;
  });
  return calib;
}

/**
 * Cat gait policy (#854): below 0.05 m/s the cat idles and sits after 4 s, then walk below 0.7,
 * trot below 1.9, run above. Each locomotion clip plays at `speed / calib` so the paws stay planted.
 */
function catClips(
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
