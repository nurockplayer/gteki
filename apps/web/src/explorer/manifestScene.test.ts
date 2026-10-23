import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it, vi } from "vitest";
import type { Asset } from "@gteki/schema";
import { manifestScene } from "./manifestScene.ts";

const asset = (uri: string): Asset => ({ id: uri, uri, format: "glb", floorIds: [], role: "visual", sourceIds: [] });

function glb(name: string) {
  const geometry = new THREE.BoxGeometry();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const scene = new THREE.Group();
  scene.add(Object.assign(new THREE.Mesh(geometry, material), { name }));
  return {
    gltf: { scene } as unknown as GLTF,
    disposed: { geometry: vi.spyOn(geometry, "dispose"), material: vi.spyOn(material, "dispose"), texture: vi.spyOn(texture, "dispose") },
  };
}

const translated = (x: number): NonNullable<Asset["transform"]> => new THREE.Matrix4().makeTranslation(x, 0, 0).toArray() as NonNullable<Asset["transform"]>;

describe("manifestScene", () => {
  it("loads each URI once, places independent clones, shares resources, and classifies each placement", async () => {
    const a = glb("floor");
    a.gltf.scene.position.x = 1;
    const floor = a.gltf.scene.children[0] as THREE.Mesh;
    floor.userData.gteki_role = "floor";
    const wall = new THREE.Mesh(floor.geometry, floor.material);
    wall.name = "wall";
    wall.userData.gteki_role = "wall";
    a.gltf.scene.add(wall);
    const b = glb("other");
    const loadGlb = vi.fn(async (uri: string) => uri === "a.glb" ? a.gltf : b.gltf);
    const scene = await manifestScene([
      { ...asset("a.glb"), transform: translated(2), role: "collision" },
      { ...asset("a.glb"), transform: translated(7), role: "visual" },
      { ...asset("b.glb"), transform: translated(11) },
    ], { loadGlb, quality: "high" });

    expect(loadGlb).toHaveBeenCalledTimes(2);
    expect(loadGlb).toHaveBeenNthCalledWith(1, "a.glb");
    expect(loadGlb).toHaveBeenNthCalledWith(2, "b.glb");
    expect(scene.root.children).toHaveLength(3);
    expect(scene.root.children[0]).toBe(a.gltf.scene);
    expect(scene.root.children.map((child) => child.position.x)).toEqual([3, 8, 11]);
    const firstCopy = scene.root.children[0]!;
    const secondCopy = scene.root.children[1]!;
    const firstMesh = firstCopy.children[0] as THREE.Mesh;
    const secondMesh = secondCopy.children[0] as THREE.Mesh;
    expect(secondMesh).not.toBe(firstMesh);
    expect(secondMesh.geometry).toBe(firstMesh.geometry);
    expect(secondMesh.material).toBe(firstMesh.material);
    expect(firstMesh.visible).toBe(false);
    expect(secondMesh.visible).toBe(true);
    expect(scene.walkable).toHaveLength(2);
    expect(scene.colliders).toHaveLength(2); // each placement's wall
    expect(scene.walkable).toContain(firstCopy.children[0]);
    expect(scene.walkable).toContain(secondCopy.children[0]);
    expect(scene.colliders).toContain(firstCopy.children[1]);
    expect(scene.colliders).toContain(secondCopy.children[1]);
    scene.dispose();
    expect(a.disposed.geometry).toHaveBeenCalledTimes(1);
    expect(a.disposed.material).toHaveBeenCalledTimes(1);
    expect(a.disposed.texture).toHaveBeenCalledTimes(1);
  });

  it("clones skinned meshes with independent bones while sharing geometry and materials", async () => {
    const source = glb("skin");
    const mesh = source.gltf.scene.children[0] as THREE.Mesh;
    const skin = new THREE.SkinnedMesh(mesh.geometry, mesh.material);
    const bone = new THREE.Bone();
    skin.add(bone);
    skin.bind(new THREE.Skeleton([bone]));
    source.gltf.scene.remove(mesh);
    source.gltf.scene.add(skin);

    const scene = await manifestScene([asset("skin.glb"), asset("skin.glb")], { loadGlb: async () => source.gltf, quality: "high" });
    const copy = scene.root.children[1]!.children[0] as THREE.SkinnedMesh;
    expect(copy.skeleton).not.toBe(skin.skeleton);
    expect(copy.skeleton.bones[0]).toBe(copy.children[0]);
    expect(copy.skeleton.bones[0]).not.toBe(bone);
    expect(copy.geometry).toBe(skin.geometry);
    expect(copy.material).toBe(skin.material);
    scene.dispose();
  });

  it("loads a URI again for a separate station scene", async () => {
    const loadGlb = vi.fn(async () => glb("floor").gltf);
    const first = await manifestScene([asset("a.glb")], { loadGlb, quality: "high" });
    const second = await manifestScene([asset("a.glb")], { loadGlb, quality: "high" });
    expect(loadGlb).toHaveBeenCalledTimes(2);
    first.dispose();
    second.dispose();
  });

  it("disposes the assets already loaded when a later GLB fails", async () => {
    const first = glb("floor");
    const loadGlb = vi.fn(async (uri: string) => {
      if (uri === "assets/a.glb") return first.gltf;
      throw new Error(`cannot load ${uri}`);
    });
    await expect(manifestScene([asset("assets/a.glb"), asset("assets/a.glb"), asset("assets/b.glb")], { loadGlb, quality: "high" })).rejects.toThrow("cannot load assets/b.glb");
    expect(loadGlb).toHaveBeenCalledTimes(2);
    expect(first.disposed.geometry).toHaveBeenCalledTimes(1);
    expect(first.disposed.material).toHaveBeenCalledTimes(1);
    expect(first.disposed.texture).toHaveBeenCalledTimes(1);
  });

  it("keeps everything alive on success until the scene's own dispose", async () => {
    const a = glb("floor");
    const b = glb("wall");
    const loads = [a.gltf, b.gltf];
    const scene = await manifestScene([asset("assets/a.glb"), asset("assets/b.glb")], { loadGlb: async () => loads.shift()!, quality: "high" });
    expect(scene.walkable).toHaveLength(1);
    expect(scene.colliders).toHaveLength(1);
    expect(a.disposed.geometry).not.toHaveBeenCalled();
    scene.dispose();
    expect(a.disposed.geometry).toHaveBeenCalled();
    expect(b.disposed.texture).toHaveBeenCalled();
  });

  it("loads uriMobile on the low tier only, and uri when there is no variant", async () => {
    const withMobile: Asset = { ...asset("assets/kit.glb"), uriMobile: "assets/kit.mobile.glb" };
    const plain = asset("assets/plain.glb");
    for (const [quality, expected] of [["low", ["assets/kit.mobile.glb", "assets/plain.glb"]], ["high", ["assets/kit.glb", "assets/plain.glb"]]] as const) {
      const loadGlb = vi.fn(async (_uri: string) => glb("floor").gltf);
      await manifestScene([withMobile, plain], { loadGlb, quality });
      expect(loadGlb.mock.calls.map((c) => c[0])).toEqual(expected);
    }
  });

  it("falls back to uri when the mobile variant fails, and says so", async () => {
    const withMobile: Asset = { ...asset("assets/kit.glb"), uriMobile: "assets/kit.mobile.glb" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loadGlb = vi.fn(async (uri: string) => { if (uri.includes("mobile")) throw new Error("404"); return glb("floor").gltf; });
    const scene = await manifestScene([withMobile], { loadGlb, quality: "low" });
    expect(loadGlb.mock.calls.map((c) => c[0])).toEqual(["assets/kit.mobile.glb", "assets/kit.glb"]);
    expect(scene.root.children[0]!.userData.gtekiAsset).toEqual({ id: withMobile.id, variant: "full", uri: "assets/kit.glb", mobileFailed: true });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("loads a repeated mobile variant once on the low tier and tags each placement with its own id", async () => {
    const loadGlb = vi.fn(async (_uri: string) => glb("floor").gltf);
    const kit = (id: string): Asset => ({ ...asset("assets/kit.glb"), id, uriMobile: "assets/kit.mobile.glb" });
    const scene = await manifestScene([kit("a"), kit("b")], { loadGlb, quality: "low" });
    expect(loadGlb.mock.calls.map(([uri]) => uri)).toEqual(["assets/kit.mobile.glb"]);
    expect(scene.root.children.map((c) => c.userData.gtekiAsset)).toEqual([
      { id: "a", variant: "mobile", uri: "assets/kit.mobile.glb" },
      { id: "b", variant: "mobile", uri: "assets/kit.mobile.glb" },
    ]);
    scene.dispose();
  });

  it("tags each asset root with the variant it loaded, for sceneInfo().assets", async () => {
    const withMobile: Asset = { ...asset("assets/kit.glb"), uriMobile: "assets/kit.mobile.glb" };
    for (const [quality, variant, uri] of [["low", "mobile", "assets/kit.mobile.glb"], ["high", "full", "assets/kit.glb"]] as const) {
      const scene = await manifestScene([withMobile], { loadGlb: async () => glb("floor").gltf, quality });
      expect(scene.root.children[0]!.userData.gtekiAsset).toEqual({ id: withMobile.id, variant, uri });
    }
  });
});
