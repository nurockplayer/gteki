import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Explorer } from "./explorer.ts";

describe("Explorer layer QA hook", () => {
  it("counts indexed, non-indexed and instanced meshes sharing a mipmapped texture, and toggles every exact match", () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.name = "ikebukuro_kit_shops";
    const nested = new THREE.Group();
    nested.name = group.name;
    const other = new THREE.Group();
    other.name = `${group.name}_other`;
    const texture = new THREE.Texture({ width: 64, height: 64 });
    const material = new THREE.MeshStandardMaterial({ map: texture, roughnessMap: texture });
    const indexed = new THREE.PlaneGeometry(); // two triangles
    const nonIndexed = indexed.toNonIndexed();
    group.add(new THREE.Mesh(indexed, material), nested);
    nested.add(new THREE.Mesh(nonIndexed, [material, material]), new THREE.InstancedMesh(indexed, material, 3));
    other.add(new THREE.Mesh(indexed, material));
    scene.add(group, other);
    const explorer = Object.assign(Object.create(Explorer.prototype), { scene }) as Explorer;
    const counts = { found: 2, visible: true, meshes: 3, triangles: 10, textures: 1, textureBytesEst: 64 * 64 * 4 * 4 / 3 };

    expect(explorer.layer(group.name)).toEqual(counts);
    expect(explorer.layer(group.name, false)).toEqual({ ...counts, visible: false });
    expect(group.visible).toBe(false);
    expect(nested.visible).toBe(false);
    expect(other.visible).toBe(true);
    expect(nested.children.every((child) => child.visible)).toBe(true);
    expect(explorer.layer(group.name)).toEqual({ ...counts, visible: false });
    expect(explorer.layer(group.name, true)).toEqual(counts);
    expect(group.visible && nested.visible).toBe(true);
    expect(explorer.layer("unknown", false)).toEqual({ found: 0, visible: false, meshes: 0, triangles: 0, textures: 0, textureBytesEst: 0 });

    texture.generateMipmaps = false;
    expect(explorer.layer(group.name).textureBytesEst).toBe(64 * 64 * 4);
    indexed.dispose(); nonIndexed.dispose(); material.dispose(); texture.dispose();
  });
});
