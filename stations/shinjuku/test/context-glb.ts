/** Test helpers for the PLATEAU street-context GLBs: a minimal GLB reader, the per-building table, and a loadGlb for the scene hook. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { glbPrimitivePlugin } from "@gteki/scene-api";

export const GTEKI_DIR = join(dirname(fileURLToPath(import.meta.url)), "../gteki");
export const SOURCES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../sources");

export interface GlbMesh {
  name: string;
  /** glTF positions: x east, y up, z -north. */
  positions: Float32Array;
  indices: Uint32Array;
  extras: Record<string, unknown>;
}

export function readGlbBytes(uri: string): Buffer {
  return readFileSync(join(GTEKI_DIR, uri));
}

/** Meshes of a GLB (one primitive each, as tools/gis writes them), straight from the JSON and BIN chunks. */
export function parseGlb(bytes: Buffer): { json: { asset: { copyright?: string } }; meshes: GlbMesh[] } {
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
  const jsonLen = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString("utf8")) as {
    asset: { copyright?: string };
    accessors: { bufferView: number; byteOffset?: number; count: number; componentType: number }[];
    bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
    meshes: { name: string; extras?: Record<string, unknown>; primitives: { attributes: { POSITION: number }; indices: number }[] }[];
    nodes: { mesh?: number; name?: string }[];
  };
  const binStart = 20 + jsonLen + 8;
  const bin = bytes.subarray(binStart);
  const read = (acc: number) => {
    const a = json.accessors[acc]!, v = json.bufferViews[a.bufferView]!;
    return { a, v, base: (v.byteOffset ?? 0) + (a.byteOffset ?? 0) };
  };
  const meshes: GlbMesh[] = [];
  for (const node of json.nodes) {
    if (node.mesh === undefined) continue;
    const mesh = json.meshes[node.mesh]!;
    const prim = mesh.primitives[0]!;
    const p = read(prim.attributes.POSITION), stride = p.v.byteStride ?? 12;
    const positions = new Float32Array(p.a.count * 3);
    for (let i = 0; i < p.a.count; i++) for (let k = 0; k < 3; k++) positions[i * 3 + k] = bin.readFloatLE(p.base + i * stride + k * 4);
    const ix = read(prim.indices);
    const indices = new Uint32Array(ix.a.count);
    for (let i = 0; i < ix.a.count; i++) indices[i] = ix.a.componentType === 5125 ? bin.readUInt32LE(ix.base + i * 4) : bin.readUInt16LE(ix.base + i * 2);
    meshes.push({ name: node.name ?? mesh.name, positions, indices, extras: mesh.extras ?? {} });
  }
  return { json, meshes };
}

export interface FeatureRow { gmlId: string; mesh: string; triStart: number; triCount: number; groundOffsetM: number; lod: string }

export function featureRows(variant: "low" | "high"): FeatureRow[] {
  const file = JSON.parse(readFileSync(join(SOURCES_DIR, "context-features.json"), "utf8")) as Record<"low" | "high", { columns: string[]; rows: (string | number)[][] }>;
  const { columns, rows } = file[variant];
  const at = (name: string) => columns.indexOf(name);
  return rows.map((r) => ({ gmlId: r[at("gml_id")] as string, mesh: r[at("mesh")] as string, triStart: r[at("tri_start")] as number, triCount: r[at("tri_count")] as number, groundOffsetM: r[at("ground_offset_m")] as number, lod: r[at("lod")] as string }));
}

/** SceneContext.loadGlb as the explorer provides it: GLTFLoader with the role plugin, bytes from gteki/. */
export function nodeLoadGlb(): (uri: string) => Promise<GLTF> {
  return (uri) => {
    const bytes = readGlbBytes(uri);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const loader = new GLTFLoader();
    loader.register(glbPrimitivePlugin);
    return new Promise((resolve, reject) => loader.parse(buffer, "", resolve, reject));
  };
}

export { THREE };
