import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { releaseSceneTextures } from "./releaseTextures.ts";

const geo = () => new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
/** A plain object standing in for a canvas in the node test environment. */
const canvas = () => ({ width: 4, height: 4, getContext: () => null });

function sceneWith(textures: { map: THREE.Texture; normalMap: THREE.Texture }) {
  const root = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const material = new THREE.MeshStandardMaterial({ map: textures.map, normalMap: textures.normalMap });
    root.add(new THREE.Mesh(geo(), material));
  }
  return root;
}

describe("releaseSceneTextures", () => {
  it("disposes each shared texture once and frees the canvas backing store when asked", () => {
    const image = canvas();
    const map = new THREE.CanvasTexture(image as unknown as HTMLCanvasElement);
    const normalMap = new THREE.Texture();
    const mapDispose = vi.fn(), normalDispose = vi.fn();
    map.addEventListener("dispose", mapDispose);
    normalMap.addEventListener("dispose", normalDispose);

    const counts = releaseSceneTextures(sceneWith({ map, normalMap }), { freeCanvases: true });

    expect(counts).toEqual({ textures: 2, canvases: 1 });
    expect(image.width).toBe(0);
    expect(image.height).toBe(0);
    expect(mapDispose).toHaveBeenCalledTimes(1);
    expect(normalDispose).toHaveBeenCalledTimes(1);
  });

  it("keeps the canvas size when freeCanvases is false", () => {
    const image = canvas();
    const map = new THREE.CanvasTexture(image as unknown as HTMLCanvasElement);
    const counts = releaseSceneTextures(sceneWith({ map, normalMap: new THREE.Texture() }), { freeCanvases: false });

    expect(counts).toEqual({ textures: 2, canvases: 0 });
    expect(image.width).toBe(4);
    expect(image.height).toBe(4);
  });
});
