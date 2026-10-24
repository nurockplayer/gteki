import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Lit-bake provenance pin (Lane F audit #12, item 6).
 *
 * `ikebukuro_b1_lit.meta.json` records the sha256 of the generic GLB the lightmap was baked from. Since the #308
 * rebake (PR #386) that is the shipped `ikebukuro_b1.glb` itself (the earlier pair e0188c50 / aef077a6 from the
 * material-only rebuild 93023f3 is gone). If this fails, the b1 GLB changed after the bake: re-bake
 * (`pnpm bake:lighting`), or document why the lightmap is still valid and pin the new pair here and in the README.
 */
const SHIPPED_B1 = "aef077a6928855a98c4ae2e26be2856f79716e1e016503fe3413b14331cdfba8";

const DECISION =
  `The generic b1 GLB or the lit meta changed since the bake from ${SHIPPED_B1.slice(0, 8)}. ` +
  "Decide: re-bake the lightmap (pnpm bake:lighting) or document the new hash pair here and in stations/ikebukuro/README.md.";

const assets = (name: string) => new URL(`../gteki/assets/${name}`, import.meta.url);
const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

interface Gltf {
  meshes: { name: string; primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  accessors: { count: number }[];
}

/** JSON chunk of a binary glTF (header 12 bytes, then chunk length + type + data). */
function gltfJson(buf: Buffer): Gltf {
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as Gltf;
}

/** Vertex and triangle counts per mesh name. */
function meshCounts(gltf: Gltf): Map<string, { vertices: number; triangles: number }> {
  const out = new Map<string, { vertices: number; triangles: number }>();
  for (const mesh of gltf.meshes) {
    let vertices = 0;
    let triangles = 0;
    for (const prim of mesh.primitives) {
      const position = prim.attributes.POSITION;
      if (position !== undefined) vertices += gltf.accessors[position]?.count ?? 0;
      if (prim.indices !== undefined) triangles += (gltf.accessors[prim.indices]?.count ?? 0) / 3;
    }
    out.set(mesh.name, { vertices, triangles });
  }
  return out;
}

describe("lit bake provenance", () => {
  const b1 = readFileSync(assets("ikebukuro_b1.glb"));
  const litMeta = JSON.parse(readFileSync(assets("ikebukuro_b1_lit.meta.json"), "utf8")) as {
    source_glb_sha256: string;
  };

  it("the lit meta records the shipped generic GLB as its bake source", () => {
    expect(sha256(b1), DECISION).toBe(SHIPPED_B1);
    expect(litMeta.source_glb_sha256, DECISION).toBe(SHIPPED_B1);
  });

  it("the generic GLB geometry matches what the lit GLB was baked from", () => {
    const src = meshCounts(gltfJson(b1));
    const lit = meshCounts(gltfJson(readFileSync(assets("ikebukuro_b1_lit.glb"))));
    expect(src.size).toBeGreaterThan(0);
    for (const [name, s] of src) {
      const l = lit.get(name);
      expect(l, `mesh "${name}" missing from the lit GLB. ${DECISION}`).toBeDefined();
      // Triangles are the invariant. The lit GLB may split a few vertices along UV1 seams, never merge them.
      expect(l?.triangles, `mesh "${name}" triangle count. ${DECISION}`).toBe(s.triangles);
      expect(l?.vertices ?? 0, `mesh "${name}" vertex count. ${DECISION}`).toBeGreaterThanOrEqual(s.vertices);
    }
  });
});
