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

describe("manifestScene", () => {
  it("disposes the assets already loaded when a later GLB fails", async () => {
    const first = glb("floor");
    const loadGlb = vi.fn(async (uri: string) => {
      if (uri === "assets/a.glb") return first.gltf;
      throw new Error(`cannot load ${uri}`);
    });
    await expect(manifestScene([asset("assets/a.glb"), asset("assets/b.glb")], { loadGlb })).rejects.toThrow("cannot load assets/b.glb");
    expect(first.disposed.geometry).toHaveBeenCalled();
    expect(first.disposed.material).toHaveBeenCalled();
    expect(first.disposed.texture).toHaveBeenCalled();
  });

  it("keeps everything alive on success until the scene's own dispose", async () => {
    const a = glb("floor");
    const b = glb("wall");
    const loads = [a.gltf, b.gltf];
    const scene = await manifestScene([asset("assets/a.glb"), asset("assets/b.glb")], { loadGlb: async () => loads.shift()! });
    expect(scene.walkable).toHaveLength(1);
    expect(scene.colliders).toHaveLength(1);
    expect(a.disposed.geometry).not.toHaveBeenCalled();
    scene.dispose();
    expect(a.disposed.geometry).toHaveBeenCalled();
    expect(b.disposed.texture).toHaveBeenCalled();
  });
});
