import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { duplicateMaterialWarning, materialsFromGlb } from "./export-scene.ts";

// GLTFExporter uses FileReader for its binary result; Node supplies Blob but not FileReader.
Object.defineProperty(globalThis, "FileReader", {
  configurable: true,
  value: class {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob): void {
      void blob.arrayBuffer().then((result) => {
        this.result = result;
        this.onloadend?.();
      });
    }
  },
});

async function exportMaterials(names: string[]): Promise<ArrayBuffer> {
  const root = new THREE.Group();
  for (const name of names) {
    const material = new THREE.MeshStandardMaterial({ color: "#888888" });
    material.name = name;
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  }
  return await new GLTFExporter().parseAsync(root, { binary: true }) as ArrayBuffer;
}

describe("GLB material sidecar metadata", () => {
  it("preserves source names in glTF material order", async () => {
    const parsed = materialsFromGlb(await exportMaterials(["mat.floor", "mat.wall", "mat.floor"]));
    expect(parsed.materials).toEqual([
      { index: 0, name: "mat.floor" },
      { index: 1, name: "mat.wall" },
      { index: 2, name: "mat.floor" },
    ]);
    expect(parsed.duplicates).toEqual(["mat.floor"]);
    expect(duplicateMaterialWarning(parsed.duplicates)).toBe("duplicate GLB material names: mat.floor");
  });

  it("records absent names as null without a duplicate warning", async () => {
    const parsed = materialsFromGlb(await exportMaterials(["", "mat.floor"]));
    expect(parsed.materials).toEqual([
      { index: 0, name: null },
      { index: 1, name: "mat.floor" },
    ]);
    expect(parsed.duplicates).toEqual([]);
    expect(duplicateMaterialWarning(parsed.duplicates)).toBeNull();
  });
});
