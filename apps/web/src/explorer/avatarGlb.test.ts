import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { loadGlbAvatar } from "./avatarGlb.ts";
import { fadeUniform, skinnedAvatarFixture } from "./avatarGlb.fixture.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("loadGlbAvatar", () => {
  it("loads a generated skin, normalizes its feet/height, and advances idle/walk/run with one mixer", async () => {
    const asset = skinnedAvatarFixture();
    const update = vi.spyOn(THREE.AnimationMixer.prototype, "update");
    const loader = { loadAsync: vi.fn().mockResolvedValue(asset) };
    const rig = await loadGlbAvatar("/avatar.glb", { quality: "low", loader });
    expect(loader.loadAsync).toHaveBeenCalledWith("/avatar.glb");
    const bounds = new THREE.Box3().setFromObject(rig.root);
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.max.y).toBeCloseTo(1.7);
    expect(bounds.getCenter(new THREE.Vector3()).x).toBeCloseTo(0);
    expect(bounds.getCenter(new THREE.Vector3()).z).toBeCloseTo(0);
    expect(asset.scene.rotation.y).toBe(0); // authored -Z, no implicit +Z axis fix
    expect(asset.mesh.castShadow).toBe(true);
    expect(asset.accessory.castShadow).toBe(true);
    expect(asset.mesh.frustumCulled).toBe(false);
    rig.update(0.25, 0);
    expect(asset.spine.rotation.z).toBeCloseTo(0.05);
    rig.update(0.25, 1.4);
    expect(asset.spine.rotation.z).toBeCloseTo(0.3);
    rig.update(0.25, 3.4);
    expect(asset.spine.rotation.z).toBeCloseTo(0.5);
    expect(new Set(update.mock.contexts).size).toBe(1);
    rig.dispose();
  });

  it("requires a skin and releases rejected asset resources", async () => {
    const scene = new THREE.Group();
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
    scene.add(new THREE.Mesh(geometry, material));
    const disposals = [geometry, material, material.map!].map((resource) => vi.spyOn(resource, "dispose"));
    await expect(loadGlbAvatar("/bad.glb", { quality: "high", loader: { loadAsync: async () => ({ scene, animations: [] }) } })).rejects.toThrow("SkinnedMesh");
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid bounds and propagates loader failures", async () => {
    const asset = skinnedAvatarFixture();
    asset.geometry.scale(1, 0, 1);
    await expect(loadGlbAvatar("/flat.glb", { quality: "high", loader: { loadAsync: async () => asset } })).rejects.toThrow("bounds");
    await expect(loadGlbAvatar("/missing.glb", { quality: "high", loader: { loadAsync: async () => { throw new Error("404"); } } })).rejects.toThrow("404");
  });

  it("shares one sanitized fade uniform across cloned material arrays and rigid accessories", async () => {
    const asset = skinnedAvatarFixture();
    const sourceHooks = asset.materials.map((material) => material.onBeforeCompile);
    const rig = await loadGlbAvatar("/avatar.glb", { quality: "high", loader: { loadAsync: async () => asset } });
    const materials = asset.mesh.material as THREE.Material[];
    expect(materials[0]).not.toBe(asset.materials[0]);
    expect(materials[1]).not.toBe(asset.materials[1]);
    expect(materials[2]).toBe(materials[0]);
    expect(asset.accessory.material).toBe(materials[0]);
    const uniforms = materials.map(fadeUniform);
    expect(new Set(uniforms).size).toBe(1);
    const versions = materials.map((material) => material.version);
    for (const [input, expected] of [[0.35, 0.35], [-1, 0], [2, 1], [NaN, 1]]) {
      rig.setFade(input!);
      for (const uniform of uniforms) expect(uniform.value).toBe(expected);
    }
    expect(materials.map((material) => material.version)).toEqual(versions);
    expect(asset.materials.map((material) => material.onBeforeCompile)).toEqual(sourceHooks);
    for (const source of asset.materials) expect(fadeUniform(source)).toBeUndefined();
    rig.dispose();
  });

  it("sets the environment on every clone without adopting the borrowed environment texture", async () => {
    const asset = skinnedAvatarFixture();
    const rig = await loadGlbAvatar("/avatar.glb", { quality: "high", loader: { loadAsync: async () => asset } });
    const env = new THREE.Texture();
    const disposeEnv = vi.spyOn(env, "dispose");
    const materials = asset.mesh.material as THREE.MeshStandardMaterial[];
    rig.setEnvMap(env);
    for (const material of materials) {
      expect(material.envMap).toBe(env);
      expect(material.envMapIntensity).toBe(0.6);
    }
    rig.setEnvMap(env, 0.4);
    for (const material of materials) expect(material.envMapIntensity).toBe(0.4);
    for (const material of asset.materials) expect(material.envMap).toBeNull();
    rig.setEnvMap(null);
    for (const material of materials) expect(material.envMap).toBeNull();
    rig.dispose();
    expect(disposeEnv).not.toHaveBeenCalled();
  });

  it("disposes each unique geometry/material/texture once, including unused scenes and a late bone texture", async () => {
    const asset = skinnedAvatarFixture();
    const unused = new THREE.Group();
    const unusedMaterial = new THREE.MeshBasicMaterial({ map: asset.textures[0]! });
    unused.add(new THREE.Mesh(asset.geometry, unusedMaterial));
    const rig = await loadGlbAvatar("/avatar.glb", { quality: "high", loader: { loadAsync: async () => ({ ...asset, scenes: [asset.scene, unused] }) } });
    asset.skeleton.computeBoneTexture(); // renderer's lazy allocation, simulated without WebGL
    const resources = new Set([asset.geometry, ...asset.materials, unusedMaterial, ...asset.mesh.material as THREE.Material[], ...asset.textures, asset.skeleton.boneTexture!]);
    const counts = new Map([...resources].map((resource) => {
      const count = { value: 0 };
      resource.addEventListener("dispose", () => count.value++);
      return [resource, count] as const;
    }));
    const stop = vi.spyOn(THREE.AnimationMixer.prototype, "stopAllAction");
    const uncache = vi.spyOn(THREE.AnimationMixer.prototype, "uncacheRoot");
    rig.dispose();
    rig.dispose();
    rig.update(0.1, 1);
    for (const count of counts.values()) expect(count.value).toBe(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(uncache).toHaveBeenCalledExactlyOnceWith(asset.scene);
    expect(asset.skeleton.boneTexture).toBeNull();
  });

  it("closes each owned ImageBitmap once, because Texture.dispose() does not", async () => {
    class MockImageBitmap {
      closed = 0;
      close(): void { this.closed++; }
    }
    vi.stubGlobal("ImageBitmap", MockImageBitmap);
    const asset = skinnedAvatarFixture();
    const bitmap = new MockImageBitmap();
    // Two textures decoded from one image: the bitmap is owned once.
    asset.textures[0]!.image = bitmap as unknown as HTMLImageElement;
    asset.textures[1]!.image = bitmap as unknown as HTMLImageElement;
    const rig = await loadGlbAvatar("/avatar.glb", { quality: "high", loader: { loadAsync: async () => asset } });
    rig.dispose();
    expect(bitmap.closed).toBe(1);
  });

  it("disposes and fades Line and Points primitives, not only meshes", async () => {
    const asset = skinnedAvatarFixture();
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(20, 0, 5), new THREE.Vector3(20, 170, 5)]);
    const lineMaterial = new THREE.LineBasicMaterial();
    const line = new THREE.Line(lineGeometry, lineMaterial);
    const pointsGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(20, 85, 5)]);
    const pointsMaterial = new THREE.PointsMaterial();
    const points = new THREE.Points(pointsGeometry, pointsMaterial);
    asset.scene.add(line, points);
    const rig = await loadGlbAvatar("/avatar.glb", { quality: "high", loader: { loadAsync: async () => asset } });
    // Faded like the mesh: the clones share its uniform, and the source materials stay unpatched.
    expect(line.material).not.toBe(lineMaterial);
    expect(points.material).not.toBe(pointsMaterial);
    const uniform = fadeUniform(line.material as THREE.Material);
    expect(fadeUniform(points.material as THREE.Material)).toBe(uniform);
    expect(fadeUniform(lineMaterial)).toBeUndefined();
    const disposals = [lineGeometry, lineMaterial, pointsGeometry, pointsMaterial, line.material as THREE.Material, points.material as THREE.Material]
      .map((resource) => vi.spyOn(resource, "dispose"));
    rig.dispose();
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("keeps unlit materials unlit when the station probe is set", async () => {
    const asset = skinnedAvatarFixture();
    const unlit = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    unlit.position.set(20, 85, 5);
    asset.scene.add(unlit);
    const rig = await loadGlbAvatar("/avatar.glb", { quality: "high", loader: { loadAsync: async () => asset } });
    const env = new THREE.Texture();
    rig.setEnvMap(env);
    expect((unlit.material as THREE.MeshBasicMaterial).envMap).toBeNull();
    expect((asset.mesh.material as THREE.MeshStandardMaterial[])[0]!.envMap).toBe(env);
    rig.dispose();
  });

  it("clones gteki_toon materials as MeshToonMaterial with the shared ramp and keeps the fade; others stay standard", async () => {
    const asset = skinnedAvatarFixture();
    asset.materials[1]!.userData = { gteki_toon: 1 };
    const rig = await loadGlbAvatar("/avatar.glb", { quality: "high", loader: { loadAsync: async () => asset } });
    const materials = asset.mesh.material as THREE.Material[];
    expect(materials[1]).toBeInstanceOf(THREE.MeshToonMaterial);
    const toon = materials[1] as THREE.MeshToonMaterial;
    expect(toon.gradientMap).toBeInstanceOf(THREE.DataTexture);
    expect(toon.gradientMap!.minFilter).toBe(THREE.NearestFilter);
    expect(toon.gradientMap!.generateMipmaps).toBe(false);
    expect(materials[0]).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(materials[0]).not.toBeInstanceOf(THREE.MeshToonMaterial);
    const uniform = fadeUniform(toon);
    rig.setFade(0.35);
    expect(uniform.value).toBe(0.35);
    rig.dispose();
  });

  it("accepts a rig with no clips", async () => {
    const asset = skinnedAvatarFixture();
    asset.animations = [];
    const rig = await loadGlbAvatar("/avatar.glb", { quality: "low", loader: { loadAsync: async () => asset } });
    expect(() => rig.update(0.1, 3)).not.toThrow();
    rig.dispose();
  });
});
