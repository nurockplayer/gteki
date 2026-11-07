import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createCatAvatar } from "./catAvatar.ts";

type CatFixture = ReturnType<typeof catFixture>;

/** Minimal stand-in for cat.glb: one skinned box plus the five named gait clips and the calib extras. */
function catFixture() {
  const scene = new THREE.Group();
  const height = 2;
  const geometry = new THREE.BoxGeometry(0.6, height, 0.4).translate(0.3, height / 2, -0.2);
  const count = geometry.getAttribute("position").count;
  const indices = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  const material = new THREE.MeshStandardMaterial();
  const mesh = new THREE.SkinnedMesh(geometry, material);
  const hips = new THREE.Bone();
  hips.name = "hips";
  const spine = new THREE.Bone();
  spine.name = "spine";
  spine.position.y = height / 2;
  hips.add(spine);
  mesh.add(hips);
  mesh.bind(new THREE.Skeleton([hips, spine]));
  scene.add(mesh);
  const pose = (name: string, value: number) => new THREE.AnimationClip(name, 1, [
    new THREE.NumberKeyframeTrack("spine.rotation[z]", [0, 1], [value, value]),
  ]);
  const animations = [pose("idle", 0.1), pose("sit", 0.5), pose("walk", 0.2), pose("trot", 0.3), pose("run", 0.4)];
  spine.userData.gteki_cat = { calib: { walk: 0.40625, trot: 1, run: 2.285714285714286 } };
  return { scene, animations, spine, geometry, material };
}

function immediate(asset: CatFixture) {
  return { loadAsync: async () => ({ scene: asset.scene, animations: asset.animations }) };
}

function deferred() {
  let resolve!: (asset: { scene: THREE.Group; animations: THREE.AnimationClip[] }) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((res, rej) => { resolve = res; reject = rej; });
  return { loader: { loadAsync: () => promise }, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createCatAvatar", () => {
  it("updates before the GLB arrives without throwing", async () => {
    const pending = deferred();
    const avatar = createCatAvatar(THREE, { loader: pending.loader });
    expect(avatar.object.children).toHaveLength(0);
    expect(() => avatar.update(0.1, 1)).not.toThrow();
    const asset = catFixture();
    pending.resolve(asset);
    await flush();
  });

  it("scales the loaded cat to 0.345 m with the feet at y 0 and centred X/Z", async () => {
    const asset = catFixture();
    const avatar = createCatAvatar(THREE, { loader: immediate(asset) });
    await flush();
    const bounds = new THREE.Box3().setFromObject(avatar.object);
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(0.345, 5);
    expect(bounds.min.y).toBeCloseTo(0, 5);
    const centre = bounds.getCenter(new THREE.Vector3());
    expect(centre.x).toBeCloseTo(0, 5);
    expect(centre.z).toBeCloseTo(0, 5);
    avatar.dispose();
  });

  it("follows the gait thresholds and the 4 s sit timer", async () => {
    const asset = catFixture();
    const avatar = createCatAvatar(THREE, { loader: immediate(asset) });
    await flush();
    const pose = () => asset.spine.rotation.z;
    avatar.update(0.4, 0.02);
    expect(pose()).toBeCloseTo(0.1); // idle
    avatar.update(0.4, 0.5);
    expect(pose()).toBeCloseTo(0.2); // walk
    avatar.update(0.4, 1.2);
    expect(pose()).toBeCloseTo(0.3); // trot
    avatar.update(0.4, 2.5);
    expect(pose()).toBeCloseTo(0.4); // run
    for (let step = 0; step < 10; step++) avatar.update(0.5, 0);
    expect(pose()).toBeCloseTo(0.5); // idle long enough to sit
    avatar.update(0.5, 0.5);
    expect(pose()).toBeCloseTo(0.2); // moving again leaves sit
    avatar.dispose();
  });

  it("adds the human on load failure and keeps updating", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const avatar = createCatAvatar(THREE, { loader: { loadAsync: async () => { throw new Error("404"); } } });
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(avatar.object.children[0]?.name).toBe("CommuterAvatar");
    expect(() => avatar.update(0.1, 1)).not.toThrow();
    avatar.dispose();
  });

  it("calls onFallback once on load failure, not on a good load, not after dispose", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onFallback = vi.fn();
    const failed = createCatAvatar(THREE, { loader: { loadAsync: async () => { throw new Error("404"); } }, onFallback });
    await flush();
    expect(onFallback).toHaveBeenCalledTimes(1);
    failed.dispose();

    const ok = createCatAvatar(THREE, { loader: immediate(catFixture()), onFallback });
    await flush();
    ok.dispose();
    expect(onFallback).toHaveBeenCalledTimes(1);

    const pending = deferred();
    const disposed = createCatAvatar(THREE, { loader: pending.loader, onFallback });
    disposed.dispose();
    pending.reject(new Error("404"));
    await flush();
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("disposes the asset instead of attaching it when dispose runs before the load resolves", async () => {
    const pending = deferred();
    const asset = catFixture();
    const geometryDispose = vi.spyOn(asset.geometry, "dispose");
    const materialDispose = vi.spyOn(asset.material, "dispose");
    const avatar = createCatAvatar(THREE, { loader: pending.loader });
    avatar.dispose();
    pending.resolve(asset);
    await flush();
    expect(avatar.object.children).toHaveLength(0);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });
});
