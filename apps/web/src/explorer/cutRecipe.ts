/**
 * Baked stairwell cut (#650). A recipe records, per mesh the triangle stage reaches, which output triangles the live
 * cut made: a copy of source triangle i, or a piece of it with the piece's corners as barycentric (u, v) pairs.
 * Replay rebuilds the same geometry without any clipping. Pure data and arithmetic: no Three.js scene is needed.
 */

/** Bump whenever the cut logic changes: a recipe baked by another version is stale. */
export const RECIPE_VERSION = 3;
const MAGIC = "GTSR";
const FORMAT = 1;

/** Thrown during replay when the live scene no longer matches the recipe. The caller falls back to the live cut. */
export class StaleRecipe extends Error {
  constructor(message: string) { super(message); this.name = "StaleRecipe"; }
}

/** One mesh that the triangle stage reached, in traversal order. */
export interface MeshRecord {
  /** Position vertex count, and FNV-1a of the position and index arrays. */
  count: number;
  hash: number;
  /** FNV-1a of the mesh's world matrix. */
  matrix: number;
  /** Whether the live cut found a triangle to cut (false: nothing else is recorded). */
  hasCut: boolean;
  /** Output triangles per source group, in group order. */
  groups: number[];
  /** Per output triangle: source vertex index * 2, plus 1 for a piece. */
  codes: number[];
  /** Per piece output triangle: (u, v) of each of its 3 corners in the source triangle, 6 floats. */
  weights: number[];
  /** Per removed polygon: region index, mean height, maximum height. */
  events: number[];
}

/** A decoded recipe, checked against the live wells by the caller. */
export interface CutRecipe {
  version: number;
  tier: "high" | "low";
  wellsSha256: string;
  keyCount: number;
  meshKeysHash: number;
  meshes: MeshRecord[];
}

/** What a cut run does with a recipe: `keys` names the regions events refer to; replay or record is chosen by the field. */
export interface RecipeHooks {
  keys: readonly object[];
  record?: MeshRecord[];
  replay?: readonly MeshRecord[];
}

/** FNV-1a 32-bit over bytes, continuing from `seed`. */
export function fnv1a(bytes: Uint8Array, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193);
  return h >>> 0;
}

/** The bytes behind a typed array (its own view, not the whole buffer). */
export function bytesOf(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/** Canonical JSON: object keys sorted at every level, so equal values serialize identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k];
      return sorted;
    }
    return v;
  });
}

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** SHA-256 hex of a UTF-8 string, synchronous (the explorer checks recipes inside a synchronous cut). */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bits = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes); padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(padded.length - 4, bits >>> 0);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    const sum = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i]! + sum[i]!) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, "0")).join("");
}

/** Serialize a recipe: "GTSR", u32 format, u32 JSON length, JSON header, then per mesh u32 codes, f32 weights, f64 events. */
export function encodeRecipe(recipe: CutRecipe): Uint8Array {
  const header = {
    version: recipe.version, tier: recipe.tier, wellsSha256: recipe.wellsSha256, keyCount: recipe.keyCount, meshKeysHash: recipe.meshKeysHash,
    meshes: recipe.meshes.map((m) => ({ count: m.count, hash: m.hash, matrix: m.matrix, hasCut: m.hasCut, groups: m.groups, codes: m.codes.length, weights: m.weights.length, events: m.events.length })),
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const body = recipe.meshes.reduce((n, m) => n + m.codes.length * 4 + m.weights.length * 4 + m.events.length * 8, 0);
  const out = new Uint8Array(12 + json.length + body);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(MAGIC), 0);
  view.setUint32(4, FORMAT, true); view.setUint32(8, json.length, true);
  out.set(json, 12);
  let off = 12 + json.length;
  for (const m of recipe.meshes) {
    for (const c of m.codes) { view.setUint32(off, c, true); off += 4; }
    for (const x of m.weights) { view.setFloat32(off, x, true); off += 4; }
    for (const x of m.events) { view.setFloat64(off, x, true); off += 8; }
  }
  return out;
}

/** Parse a recipe file. Throws on a malformed file; a version or tier mismatch is for the caller to judge. */
export function decodeRecipe(bytes: ArrayBuffer | Uint8Array): CutRecipe {
  const buf = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
  const view = new DataView(buf);
  if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== MAGIC) throw new Error("stairwell recipe: bad magic");
  if (view.getUint32(4, true) !== FORMAT) throw new Error("stairwell recipe: unknown format");
  const jsonLength = view.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jsonLength))) as {
    version: number; tier: "high" | "low"; wellsSha256: string; keyCount: number; meshKeysHash: number;
    meshes: { count: number; hash: number; matrix: number; hasCut: boolean; groups: number[]; codes: number; weights: number; events: number }[];
  };
  let off = 12 + jsonLength;
  const meshes: MeshRecord[] = header.meshes.map((m) => {
    const codes: number[] = [], weights: number[] = [], events: number[] = [];
    for (let k = 0; k < m.codes; k++) { codes.push(view.getUint32(off, true)); off += 4; }
    for (let k = 0; k < m.weights; k++) { weights.push(view.getFloat32(off, true)); off += 4; }
    for (let k = 0; k < m.events; k++) { events.push(view.getFloat64(off, true)); off += 8; }
    return { count: m.count, hash: m.hash, matrix: m.matrix, hasCut: m.hasCut, groups: m.groups, codes, weights, events };
  });
  if (off !== buf.byteLength) throw new Error("stairwell recipe: length does not match its header");
  return { version: header.version, tier: header.tier, wellsSha256: header.wellsSha256, keyCount: header.keyCount, meshKeysHash: header.meshKeysHash, meshes };
}
