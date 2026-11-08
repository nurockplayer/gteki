import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The shipped cat GLB, parsed straight from its JSON chunk (no Three): the contract the build
 * script must keep and the runtime relies on (#854). The file itself is the source of record.
 */
interface GlbJson {
  meshes?: { primitives: { indices?: number }[] }[];
  accessors?: { count: number }[];
  images?: unknown[];
  nodes?: { name?: string; extras?: { gteki_cat?: { calib?: Record<string, number> } } }[];
  animations?: { name?: string }[];
}

function readGlbJson(url: URL): { json: GlbJson; bytes: number } {
  const data = readFileSync(url);
  expect(data.readUInt32LE(0)).toBe(0x46546c67); // magic "glTF"
  const jsonLength = data.readUInt32LE(12);
  expect(data.readUInt32LE(16)).toBe(0x4e4f534a); // chunk type "JSON"
  return { json: JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8")) as GlbJson, bytes: data.byteLength };
}

const { json, bytes } = readGlbJson(new URL("../../public/avatars/cat.glb", import.meta.url));
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
