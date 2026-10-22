import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Lit-bake provenance pin (Lane F audit #12, item 6).
 *
 * `ikebukuro_b1_lit.meta.json` records the sha256 of the generic GLB the lightmap was baked from. The shipped
 * `ikebukuro_b1.glb` has a different hash because commit 93023f3 ("portal closures are fully transparent in the
 * generic GLB") rebuilt it. That commit changed the `mat_portals` material only (BLEND alpha 0.5 -> MASK alpha 0);
 * the glTF JSON apart from `materials`, and the BIN buffer, are byte-identical. The bake replaces every material
 * and only reads portal geometry (for daylight faces), so the lightmap is not stale.
 *
 * This test pins that known pair. If it fails, the b1 GLB or the lit meta changed: decide whether to re-bake
 * (`pnpm bake:lighting`) or to re-document the new pair here and in the README, then update the constants below.
 */
const KNOWN_PAIR = {
  bakedFrom: "e0188c5009365d075b1f3828ab12cdc77a900c16de21b8cea271979a1d5b33bd",
  current: "aef077a6928855a98c4ae2e26be2856f79716e1e016503fe3413b14331cdfba8",
  diff: "mat_portals material only (93023f3); bake replaces materials",
} as const;

const DECISION =
  "The generic b1 GLB or the lit meta changed since the documented pair " +
  `{ bakedFrom: ${KNOWN_PAIR.bakedFrom.slice(0, 8)}, current: ${KNOWN_PAIR.current.slice(0, 8)}, diff: "${KNOWN_PAIR.diff}" }. ` +
  "Decide: re-bake the lightmap (pnpm bake:lighting) or re-document the new hash pair here and in stations/ikebukuro/README.md.";

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

  it("lit meta still records the documented bake-source hash", () => {
    expect(litMeta.source_glb_sha256, DECISION).toBe(KNOWN_PAIR.bakedFrom);
  });

  it("the shipped generic GLB is still the documented current hash", () => {
    expect(sha256(b1), DECISION).toBe(KNOWN_PAIR.current);
  });

  it("the documented pair differs, on purpose", () => {
    expect(KNOWN_PAIR.bakedFrom).not.toBe(KNOWN_PAIR.current);
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
