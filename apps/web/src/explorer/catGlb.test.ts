import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The shipped cat GLB, parsed straight from its JSON chunk (no Three): the contract the build
 * script must keep and the runtime relies on (#854). The file itself is the source of record.
 */
interface GlbJson {
  meshes?: { primitives: { indices?: number; attributes?: Record<string, number> }[] }[];
  accessors?: { count: number; bufferView: number; byteOffset?: number; componentType: number; type: string; normalized?: boolean }[];
  bufferViews?: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  images?: unknown[];
  nodes?: { name?: string; extras?: { gteki_cat?: { calib?: Record<string, number> } } }[];
  skins?: { joints: number[] }[];
  animations?: { name?: string }[];
}

function readGlbJson(url: URL): { json: GlbJson; bin: Buffer; bytes: number } {
  const data = readFileSync(url);
  expect(data.readUInt32LE(0)).toBe(0x46546c67); // magic "glTF"
  const jsonLength = data.readUInt32LE(12);
  expect(data.readUInt32LE(16)).toBe(0x4e4f534a); // chunk type "JSON"
  const binHeader = 20 + jsonLength;
  const binLength = data.readUInt32LE(binHeader);
  expect(data.readUInt32LE(binHeader + 4)).toBe(0x004e4942); // chunk type "BIN\0"
  return {
    json: JSON.parse(data.subarray(20, binHeader).toString("utf8")) as GlbJson,
    bin: data.subarray(binHeader + 8, binHeader + 8 + binLength),
    bytes: data.byteLength,
  };
}

function readAccessor(json: GlbJson, bin: Buffer, index: number): number[][] {
  const accessor = json.accessors![index]!;
  const view = json.bufferViews![accessor.bufferView]!;
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type as "SCALAR" | "VEC2" | "VEC3" | "VEC4"];
  const componentBytes = { 5121: 1, 5123: 2, 5126: 4 }[accessor.componentType as 5121 | 5123 | 5126];
  const stride = view.byteStride ?? components * componentBytes;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const read = (offset: number): number => {
    if (accessor.componentType === 5126) return bin.readFloatLE(offset);
    if (accessor.componentType === 5121) {
      const value = bin.readUInt8(offset);
      return accessor.normalized ? value / 255 : value;
    }
    const value = bin.readUInt16LE(offset);
    return accessor.normalized ? value / 65535 : value;
  };
  return Array.from({ length: accessor.count }, (_, row) =>
    Array.from({ length: components }, (_, column) => read(start + row * stride + column * componentBytes)),
  );
}

const { json, bin, bytes } = readGlbJson(new URL("../../public/avatars/cat.glb", import.meta.url));
const nodes = json.nodes ?? [];
const names = new Set(nodes.map((n) => n.name));
const clips = (json.animations ?? []).map((a) => a.name);

describe("cat.glb (#854)", () => {
  it("stays inside the avatar budget: one mesh, one primitive, <= 5000 triangles, no images, <= 1.2 MB", () => {
    expect(bytes).toBeLessThanOrEqual(1_200_000);
    expect(json.meshes).toHaveLength(1);
    expect(json.meshes![0]!.primitives).toHaveLength(1);
    const indices = json.meshes![0]!.primitives[0]!.indices;
    expect(indices).toBeDefined();
    expect(json.accessors![indices!]!.count / 3).toBeLessThanOrEqual(5_000);
    expect(json.images ?? []).toHaveLength(0);
  });

  it("carries the node names the explorer and the clips address", () => {
    for (const name of ["root", "neck", "head", "ear_L", "ear_R", "tail_01", "tail_02", "tail_03", "tail_04"]) {
      expect(names.has(name), name).toBe(true);
    }
  });

  it("skins every vertex to a named bone, with no exporter neutral_bone", () => {
    expect(names.has("neutral_bone")).toBe(false);
    const skins = json.skins ?? [];
    expect(skins).toHaveLength(1);
    const joints = skins[0]!.joints.map((index) => nodes[index]?.name);
    expect(joints).not.toContain("neutral_bone");
    expect(joints).toContain("head");
  });

  it("weights every eye vertex to head (#1060)", () => {
    const primitive = json.meshes![0]!.primitives[0]!;
    const colors = readAccessor(json, bin, primitive.attributes!.COLOR_0!);
    const joints = readAccessor(json, bin, primitive.attributes!.JOINTS_0!);
    const weights = readAccessor(json, bin, primitive.attributes!.WEIGHTS_0!);
    const skinJoints = json.skins![0]!.joints;
    const srgb = (channel: number): number => (channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055) * 255;
    const eyeColors = [[0xa3, 0x9a, 0x52], [0x14, 0x12, 0x10]];
    const eyeVertices = colors.flatMap((color, index) => {
      const rgb = color.slice(0, 3).map(srgb);
      return eyeColors.some((target) => rgb.every((channel, i) => Math.abs(channel - target[i]!) <= 2)) ? [index] : [];
    });

    expect(eyeVertices.length).toBeGreaterThan(0);
    for (const vertex of eyeVertices) {
      const strongestSlot = weights[vertex]!.reduce((best, weight, slot, all) => weight > all[best]! ? slot : best, 0);
      const jointIndex = skinJoints[joints[vertex]![strongestSlot]!];
      expect(nodes[jointIndex!]?.name, `eye vertex ${vertex}`).toBe("head");
    }
  });

  it("ships the locomotion clips and a finite positive walk/trot/run calibration", () => {
    for (const name of ["idle", "sit", "walk", "trot", "run"]) expect(clips, name).toContain(name);
    const calib = nodes
      .map((n) => n.extras?.gteki_cat?.calib)
      .filter((c): c is Record<string, number> => Boolean(c));
    expect(calib).toHaveLength(1);
    for (const speed of ["walk", "trot", "run"]) {
      expect(Number.isFinite(calib[0]![speed]), speed).toBe(true);
      expect(calib[0]![speed]!, speed).toBeGreaterThan(0);
    }
  });
});
