import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { avatarGlbUrl, createAvatarRig, DEFAULT_AVATAR_GLB_URL } from "./avatarSelection.ts";
import { fadeUniform, skinnedAvatarFixture } from "./avatarGlb.fixture.ts";

afterEach(() => vi.restoreAllMocks());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("avatar selection", () => {
  it("keeps the procedural rig by default and never invokes the loader", async () => {
    const loader = { loadAsync: vi.fn() };
    const rig = createAvatarRig({ quality: "low", loader });
    const root = rig.root;
    await rig.loadGlb();
    expect(loader.loadAsync).not.toHaveBeenCalled();
    expect(rig.root).toBe(root);
    expect(root.getObjectByName("shoeL")).toBeDefined();
    rig.dispose();
  });

  it("shows procedural immediately, swaps only on success, and reapplies the latest fade and lighting", async () => {
    const asset = skinnedAvatarFixture();
    const load = deferred<typeof asset>();
    const loader = { loadAsync: vi.fn(() => load.promise) };
    const rig = createAvatarRig({ quality: "low", glbUrl: "/avatar.glb", loader });
    const previous = rig.root;
    const parent = new THREE.Group();
    const marker = new THREE.Object3D();
    parent.add(previous, marker);
    const previousGeometry = (previous.getObjectByName("shoeL") as THREE.Mesh).geometry;
    const disposedPrevious = vi.spyOn(previousGeometry, "dispose");
    rig.update(0.1, 0);
    rig.setFade(0.7);
    rig.setFade(0.2);
    const env = new THREE.Texture();
    rig.setEnvMap(env, 0.4);
    expect(rig.root).toBe(previous);
    expect(disposedPrevious).not.toHaveBeenCalled();
    load.resolve(asset);
    await rig.loadGlb();
    expect(loader.loadAsync).toHaveBeenCalledTimes(1);
    expect(rig.root).not.toBe(previous);
    expect(parent.children).toContain(rig.root);
    expect(parent.children).toContain(marker);
    expect(previous.parent).toBeNull();
    expect(disposedPrevious).toHaveBeenCalledTimes(1);
    for (const material of asset.mesh.material as THREE.MeshStandardMaterial[]) {
      expect(fadeUniform(material).value).toBe(0.2);
      expect(material.envMap).toBe(env);
      expect(material.envMapIntensity).toBe(0.4);
    }
    rig.update(0.25, 1.4);
    rig.setFade(0.5);
    expect(asset.spine.rotation.z).toBeCloseTo(0.3);
    for (const material of asset.mesh.material as THREE.Material[]) expect(fadeUniform(material).value).toBe(0.5);
    rig.cancelPendingLoad();
    await rig.loadGlb(); // switching stations retains a fully loaded rig
    expect(loader.loadAsync).toHaveBeenCalledTimes(1);
    rig.dispose();
    rig.dispose();
    expect(parent.children).toEqual([marker]);
    expect(disposedPrevious).toHaveBeenCalledTimes(1);
  });

  it("keeps the procedural rig on load failure and warns only once, including after a retry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loader = { loadAsync: vi.fn().mockRejectedValue(new Error("404")) };
    const rig = createAvatarRig({ quality: "low", glbUrl: "/missing.glb", loader });
    const previous = rig.root;
    await rig.loadGlb();
    expect(rig.root).toBe(previous);
    expect(warn).toHaveBeenCalledTimes(1);
    rig.cancelPendingLoad();
    await rig.loadGlb();
    expect(rig.root).toBe(previous);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(() => rig.update(0.1, 1.4)).not.toThrow();
    rig.dispose();
  });

  it("keeps procedural on GLB validation failure and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rig = createAvatarRig({ quality: "low", glbUrl: "/invalid.glb", loader: { loadAsync: async () => ({ scene: new THREE.Group(), animations: [] }) } });
    const previous = rig.root;
    await rig.loadGlb();
    expect(rig.root).toBe(previous);
    expect(warn).toHaveBeenCalledTimes(1);
    rig.dispose();
  });

  it("disposes a successful late load without attaching it after explorer disposal", async () => {
    const asset = skinnedAvatarFixture();
    const load = deferred<typeof asset>();
    const loader = { loadAsync: vi.fn(() => load.promise) };
    const rig = createAvatarRig({ quality: "low", glbUrl: "/avatar.glb", loader });
    const pending = rig.loadGlb();
    const parent = new THREE.Group();
    parent.add(rig.root);
    const dispose = vi.spyOn(asset.geometry, "dispose");
    rig.dispose();
    load.resolve(asset);
    await pending;
    expect(parent.children).toHaveLength(0);
    expect(dispose).toHaveBeenCalledTimes(1);
    await rig.loadGlb();
    expect(loader.loadAsync).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale station's swap and disposes it even when it resolves after the replacement", async () => {
    const oldAsset = skinnedAvatarFixture(), newAsset = skinnedAvatarFixture();
    const oldLoad = deferred<typeof oldAsset>(), newLoad = deferred<typeof newAsset>();
    const loader = { loadAsync: vi.fn().mockReturnValueOnce(oldLoad.promise).mockReturnValueOnce(newLoad.promise) };
    const rig = createAvatarRig({ quality: "low", glbUrl: "/avatar.glb", loader });
    const oldPending = rig.loadGlb();
    const parent = new THREE.Group(); parent.add(rig.root);
    rig.cancelPendingLoad(); // clearStation
    const newPending = rig.loadGlb(); // loadStation
    const oldDispose = vi.spyOn(oldAsset.geometry, "dispose");
    const newDispose = vi.spyOn(newAsset.geometry, "dispose");
    newLoad.resolve(newAsset);
    await newPending;
    const current = rig.root;
    oldLoad.resolve(oldAsset);
    await oldPending;
    expect(rig.root).toBe(current);
    expect(parent.children).toEqual([current]);
    expect(oldDispose).toHaveBeenCalledTimes(1);
    expect(newDispose).not.toHaveBeenCalled();
    rig.dispose();
    expect(newDispose).toHaveBeenCalledTimes(1);
  });

  it.each(["station change", "dispose"])("does not warn for load failures after %s", async (reason) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stale = deferred<ReturnType<typeof skinnedAvatarFixture>>();
    const rig = createAvatarRig({ quality: "low", glbUrl: "/avatar.glb", loader: { loadAsync: () => stale.promise } });
    const pending = rig.loadGlb();
    if (reason === "dispose") rig.dispose(); else rig.cancelPendingLoad();
    stale.reject(new Error("old station failed"));
    await pending;
    rig.dispose();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("avatar flag", () => {
  const page = "https://gteki.example/app/index.html";
  it.each(["", "avatar=procedural", "avatar=GLB", "avatarUrl=/avatar.glb"])("is off unless explicitly enabled: %s", (query) => {
    expect(avatarGlbUrl(new URLSearchParams(query), page)).toBeUndefined();
  });
  it("uses Lane E's future URL for ?avatar=glb", () => {
    expect(avatarGlbUrl(new URLSearchParams("avatar=glb"), page)).toBe(DEFAULT_AVATAR_GLB_URL);
  });
  it.each([
    ["ual", "/avatars/gteki-commuter-ual.glb"],
    ["kaykit", "/avatars/gteki-commuter-kaykit.glb"],
  ])("loads the %s ready-rigged CC0 candidate", (mode, expected) => {
    expect(avatarGlbUrl(new URLSearchParams(`avatar=${mode}`), page)).toBe(expected);
  });
  it.each([["/avatars/test.glb", "/avatars/test.glb"], ["./test.glb", "/app/test.glb"], ["../test.glb?tier=low", "/test.glb?tier=low"]])("accepts a same-origin relative path: %s", (input, expected) => {
    expect(avatarGlbUrl(new URLSearchParams({ avatar: "glb", avatarUrl: input! }), page)).toBe(expected);
  });
  it.each(["https://evil.example/avatar.glb", "https://gteki.example/avatar.glb", "//evil.example/a.glb", "/..//evil.example/a.glb", "/avatars/..//evil.example/a.glb", "/%2e%2e//evil.example/a.glb", "data:abc", "javascript:alert(1)", "file:///a.glb", "\\\\evil.example/a.glb", "/\\evil.example/a.glb", " /avatar.glb", "/ava\ntar.glb", "", "?url=evil", "#avatar"])("rejects a non-relative or malformed avatarUrl: %s", (input) => {
    expect(avatarGlbUrl(new URLSearchParams({ avatar: "glb", avatarUrl: input }), page)).toBeUndefined();
  });
});
