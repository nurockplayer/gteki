// Batch 3 (#94): production face layout, real GLB pivots/geometry, tier budgets and resource ownership.
// Canvas text widths are estimates (same CJK/Latin stub as signage.test.ts); no DOM, GPU or image decoder.
import crypto from "node:crypto";
import fs from "node:fs";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import kitJson from "./kit/kit.json";
import signage from "./signage.json";
import { type KitManifest, KIT_TILE_M, pieceUri } from "./kit.ts";
import { buildSigns, type SignLayout, type SignSpec } from "./signs.ts";
import { FLUSH_GAP_M, FRAME_PARTS, loadSignKit, signFramePlacements } from "./kit_signs.ts";

const kit = kitJson as KitManifest;
const ID = "gteki_sign_frame_9slice_h480_d80";
const spec = kit.pieces[ID]!.nine_slice!;
const signs = signage.signs as SignSpec[];
const here = (p: string) => new URL(p, import.meta.url);
const read = (p: string) => JSON.parse(fs.readFileSync(here(p), "utf8"));
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(here(p))).digest("hex");
const toRenderer = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

function stubDocument() {
  return { createElement: () => {
    const state: Record<string, unknown> = { font: "16px sans" };
    const context = new Proxy(state, {
      get(t, k: string) {
        if (k === "measureText") return (text: string) => ({ width:
          [...text].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e7f ? 1 : /\d/.test(ch) ? 0.6 : 0.56), 0)
          * Number(/(\d+(?:\.\d+)?)px/.exec(String(t.font))?.[1] ?? 16) });
        return k in t ? t[k] : () => undefined;
      },
      set(t, k: string, v) { t[k] = v; return true; },
    });
    return { width: 0, height: 0, getContext: () => context };
  } };
}
beforeEach(() => vi.stubGlobal("document", stubDocument()));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Decode POSITION/index accessors and the node hierarchy from the shipped GLB. Textures are irrelevant
 * to placement and triangle counts, so use a standard material in place of decoding the embedded images. */
function frameGlb(low: boolean): GLTF {
  const bytes = fs.readFileSync(here(`../gteki/${pieceUri(kit, ID, low)}`));
  const jsonBytes = bytes.readUInt32LE(12);
  const d = JSON.parse(bytes.subarray(20, 20 + jsonBytes).toString("utf8"));
  const bin = bytes.subarray(28 + jsonBytes);
  const accessor = (id: number, components: number) => {
    const a = d.accessors[id], view = d.bufferViews[a.bufferView];
    const size = a.componentType === 5123 ? 2 : 4;
    const get = a.componentType === 5126 ? (o: number) => bin.readFloatLE(o)
      : a.componentType === 5123 ? (o: number) => bin.readUInt16LE(o) : (o: number) => bin.readUInt32LE(o);
    return Array.from({ length: a.count * components }, (_, i) => get((view.byteOffset ?? 0) + (a.byteOffset ?? 0)
      + Math.floor(i / components) * (view.byteStride ?? components * size) + i % components * size));
  };
  const material = new THREE.MeshStandardMaterial();
  const nodes = d.nodes.map((n: { name: string; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[] }) => {
    const group = new THREE.Group();
    group.name = n.name;
    if (n.translation) group.position.fromArray(n.translation);
    if (n.rotation) group.quaternion.fromArray(n.rotation);
    if (n.scale) group.scale.fromArray(n.scale);
    if (n.mesh !== undefined) for (const p of d.meshes[n.mesh].primitives) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(accessor(p.attributes.POSITION, 3), 3));
      geometry.setIndex(accessor(p.indices, 1));
      group.add(new THREE.Mesh(geometry, material));
    }
    return group;
  });
  d.nodes.forEach((n: { children?: number[] }, i: number) => n.children?.forEach((c) => nodes[i].add(nodes[c])));
  const scene = new THREE.Group();
  for (const i of d.scenes[d.scene ?? 0].nodes) scene.add(nodes[i]);
  return { scene, scenes: [scene] } as unknown as GLTF;
}
const host = (low: boolean) => ({ assetUrl: vi.fn(() => "/asset"), loadGlb: vi.fn(async () => frameGlb(low)) });
const layout = (overrides: Partial<SignLayout> = {}): SignLayout => ({ id: "test", position: { x: 10, y: 20, z: 3 },
  facing: { x: 1, y: 0 }, ceilingZ: 4, scale: 1, widthM: 1.94, heightM: 0.42, ...overrides });
const builtSigns = (frame = false) => buildSigns(THREE, signs, toRenderer, 1, 1, 4096,
  frame ? { facePlaneM: spec.face_plane_m } : undefined);

describe("sign frame kit contract", () => {
  it("copies both library tiers exactly, with the same nine-slice recipe and declarations", () => {
    for (const low of [false, true]) {
      const entry = read(`../../../assets/library/${low ? "mobile/" : ""}manifest.json`).assets.find((a: { id: string }) => a.id === ID);
      const { recipe: _recipe, ...numbers } = entry.params.nine_slice;
      expect(spec).toEqual(numbers);
      const uri = pieceUri(kit, ID, low);
      expect(uri).toBe(`kit/${low ? "low" : "high"}/${ID}.glb`);
      expect(sha(`../gteki/${uri}`)).toBe(entry.sha256);
      expect(sha(`../../../assets/library/${low ? "mobile/" : ""}glb/${ID}.glb`)).toBe(entry.sha256);
      for (const file of ["../data/graph.src.json", "../gteki/station.json"]) {
        const d = read(file);
        expect(d.assets.find((a: { id: string }) => a.id === "b1").files).toContain(uri);
        expect(d.sources.find((s: { id: string }) => s.id === "gteki-kit-0-1-0").sha256[uri]).toBe(entry.sha256);
      }
    }
    expect(read("../gteki/station.json").sources).toEqual(read("../data/graph.src.json").sources);
  });

  it("applies the recipe on hand-made signs, including ceiling drop, scaled and flush signs", () => {
    const [p] = signFramePlacements([layout()], spec);
    expect(p!.widthM).toBe(2); // 1.94 m face plus the two fixed side bars
    expect(p!.parts.slice(0, 3)).toEqual([
      { part: "end_L", x: -0.95, y: 0, sx: 1, sy: 1 },
      { part: "end_R", x: 0.95, y: 0, sx: 1, sy: 1 },
      { part: "span", x: 0, y: 0, sx: 1.9, sy: 1 },
    ]);
    const rods = p!.parts.filter((p) => p.part === "rod");
    expect(rods.map((p) => p.x)).toEqual([-0.88, 0.88]);
    for (const rod of rods) { expect(rod.y).toBeCloseTo(0.278, 10); expect(rod.sy).toBeCloseTo(0.722, 10); }
    expect(p!.parts.filter((p) => p.part === "rod_canopy").map((p) => p.y)).toEqual([1, 1]);
    const [short] = signFramePlacements([layout({ scale: 0.5, heightM: 0.21 })], spec);
    expect(short!.parts[0]!.sy).toBe(0.5);
    expect(short!.parts.find((p) => p.part === "rod")!.y).toBeCloseTo(0.158, 10);
    for (const gap of [0, 0.02, 0.0205]) {
      const [flush] = signFramePlacements([layout({ ceilingZ: 3.24 + gap })], spec);
      expect(flush!.parts.map((p) => p.part)).toEqual(["end_L", "end_R", "span"]);
    }
    const [tinyGap] = signFramePlacements([layout({ ceilingZ: 3.27 })], spec);
    expect(tinyGap!.parts.some((p) => p.part === "hanger")).toBe(false);
    expect(tinyGap!.parts.find((p) => p.part === "rod")!.sy).toBeCloseTo(0.03, 10);
  });

  it("clamps unsupported widths and reports the sign id at build time", async () => {
    const loaded = await loadSignKit(THREE, host(false), kit, false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { placements } = loaded.build(THREE, new THREE.Texture(), toRenderer,
      [layout({ id: "too-wide", widthM: 7 }), layout({ id: "too-small", widthM: 0.1 })]);
    expect(placements.map((p) => p.widthM)).toEqual([6.1, 0.5]);
    expect(warn.mock.calls.map((c) => c[0])).toEqual([expect.stringContaining("too-wide"), expect.stringContaining("too-small")]);
    loaded.dispose();
  });

  it("uses the fitted production widths: exactly one centred frame per sign, all openings contain both faces", () => {
    const built = builtSigns(true);
    const placed = signFramePlacements(built.layouts, spec);
    expect(placed.map((p) => p.sign.id)).toEqual(signs.map((s) => s.id));
    expect(new Set(placed.map((p) => p.sign.id)).size).toBe(signs.length);
    const outside = placed.filter((p) => p.widthM !== p.requestedWidthM);
    console.info(`[kit sign frames] signs=${signs.length}; outside 0.5-6.1 m: ${JSON.stringify(outside.map((p) => p.sign.id))}`);
    expect(outside).toEqual([]);
    for (const [i, p] of placed.entries()) {
      expect(p.sign.position).toEqual(signs[i]!.position);
      expect(p.sign.facing).toEqual(signs[i]!.facing);
      expect(p.widthM).toBeGreaterThanOrEqual(0.5);
      expect(p.widthM).toBeLessThanOrEqual(6.1);
      const faces = built.group.userData.faces.filter((f: { id: string }) => f.id === p.sign.id);
      for (const face of faces) {
        expect(face.widthM * face.scale, p.sign.id).toBeLessThanOrEqual(p.widthM - 2 * spec.bar_m + 1e-9);
        expect(face.heightM * face.scale, p.sign.id).toBeLessThanOrEqual(spec.opening_h_m * p.sign.scale + 1e-9);
      }
      const gap = p.sign.ceilingZ! - p.sign.position.z - spec.outer_h_m / 2 * p.sign.scale;
      expect(p.parts.filter((q) => q.part === "rod").length).toBe(gap > FLUSH_GAP_M ? 2 : 0);
      for (const rod of p.parts.filter((q) => q.part === "rod")) {
        expect(p.sign.position.z + rod.y + rod.sy * spec.rod_unit_m).toBeCloseTo(p.sign.ceilingZ!, 9);
      }
    }
    expect(placed.some((p) => p.parts.length === 3)).toBe(true); // actual flush signs, not only fixtures
    built.dispose();
  });

  it("recesses front/back faces within the kit depth while retaining today's exact fallback", () => {
    const s: SignSpec = { id: "pair", position: { x: 0, y: 0, z: 0 }, facing: { x: 0, y: -1 },
      exits: [{ id: "exit", label: "1", ja: null, en: null }], gates: [],
      back: [{ exits: [{ id: "exit", label: "2", ja: null, en: null }], gates: [] }] };
    for (const scale of [1, 0.5]) for (const frame of [false, true]) {
      const b = buildSigns(THREE, [{ ...s, scale }], toRenderer, 1, 1, 4096,
        frame ? { facePlaneM: spec.face_plane_m } : undefined);
      const box = b.group.children[0] as THREE.Mesh;
      box.geometry.computeBoundingBox();
      const face = b.group.children[1] as THREE.Mesh;
      const pos = face.geometry.getAttribute("position");
      const zs = Array.from({ length: pos.count }, (_, i) => pos.getZ(i));
      const offset = frame ? 0.027 : 0.041 * scale;
      expect(Math.max(...zs)).toBeCloseTo(offset, 6);
      expect(Math.min(...zs)).toBeCloseTo(-offset, 6);
      expect(box.geometry.boundingBox!.max.z).toBeLessThan(offset - 0.0005);
      if (frame) expect(offset).toBeLessThan(spec.depth_m / 2);
      b.dispose();
    }
  });
});

describe("sign frame loader and real tier geometry", () => {
  it("loads the selected tier once and builds tiled, correctly oriented, visual-only instances", async () => {
    for (const low of [false, true]) {
      const h = host(low), loaded = await loadSignKit(THREE, h, kit, low);
      expect(h.loadGlb).toHaveBeenCalledExactlyOnceWith(`kit/${low ? "low" : "high"}/${ID}.glb`);
      expect(loaded.facePlaneM).toBe(spec.face_plane_m);
      const a = layout(), b = layout({ id: "far", position: { x: 100, y: 20, z: 3 } });
      const out = loaded.build(THREE, new THREE.Texture(), toRenderer, [a, b]);
      expect(out.stats.tiles).toBe(2);
      expect(Math.abs(a.position.x - b.position.x)).toBeGreaterThan(low ? KIT_TILE_M.low : KIT_TILE_M.high);
      const span = out.group.children.find((m) => m.name === "kit_sign_frame:span:0:-2")
        ?? out.group.children.find((m) => m.name.startsWith("kit_sign_frame:span:"));
      expect(span).toBeDefined();
      const matrix = new THREE.Matrix4();
      (span as THREE.InstancedMesh).getMatrixAt(0, matrix);
      expect(new THREE.Vector3(0, 0, 1).transformDirection(matrix).toArray()).toEqual([1, 0, expect.closeTo(0, 6)]);
      // The span's imported 2.54 m pivot has been removed, leaving it centred on the sign.
      expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([10, 3, -20]);
      out.group.traverse((o) => {
        expect(o.userData.gteki_role).toBe("kit_sign_frame");
        if ((o as THREE.InstancedMesh).isInstancedMesh) {
          expect(o.frustumCulled).toBe(true);
          expect((o as THREE.InstancedMesh).boundingSphere).not.toBeNull();
        }
      });
      loaded.dispose();
    }
    const source = fs.readFileSync(here("./scene.ts"), "utf8");
    expect(source).toContain("root.add(signKit.build(THREE, env, toRenderer, signs.layouts).group)");
    expect(source).toContain("signKit.dispose()");
  });

  it("keeps original signs when the asset is missing, rejected or incomplete, and frees failed assets", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const incomplete = frameGlb(false);
    incomplete.scene.children[0]!.remove(incomplete.scene.children[0]!.children.find((p) => p.name === "VIS_span")!);
    const cases = [
      { assetUrl: () => null, loadGlb: async () => frameGlb(false) },
      { assetUrl: () => "/asset", loadGlb: async (): Promise<GLTF> => { throw new Error("decode failed"); } },
      { assetUrl: () => "/asset", loadGlb: async () => incomplete },
    ];
    const meshes: THREE.Mesh[] = [];
    incomplete.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const dispose = meshes.map((m) => vi.spyOn(m.geometry, "dispose"));
    for (const h of cases) {
      const loaded = await loadSignKit(THREE, h, kit, false);
      expect(loaded.facePlaneM).toBeUndefined();
      const out = loaded.build(THREE, new THREE.Texture(), toRenderer, [layout()]);
      expect(out.placements).toEqual([]);
      expect(out.group.children).toEqual([]);
      loaded.dispose();
    }
    expect(warn).toHaveBeenCalledTimes(3);
    for (const spy of dispose) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("disposes every instance, cloned material, shared source geometry/material and texture exactly once", async () => {
    const gltf = frameGlb(false);
    const sourceMaterials = new Set<THREE.Material>(), geometries = new Set<THREE.BufferGeometry>();
    const texture = new THREE.Texture();
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      sourceMaterials.add(m.material as THREE.Material);
      (m.material as THREE.MeshStandardMaterial).map = texture;
      geometries.add(m.geometry);
    });
    const loaded = await loadSignKit(THREE, { assetUrl: () => "/asset", loadGlb: async () => gltf }, kit, false);
    const instances: THREE.InstancedMesh[] = [];
    for (let i = 0; i < 2; i++) loaded.build(THREE, new THREE.Texture(), toRenderer, [layout()]).group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) instances.push(o as THREE.InstancedMesh);
    });
    expect(instances.length).toBeGreaterThan(FRAME_PARTS.length);
    const cloned = new Set(instances.map((m) => m.material as THREE.Material));
    expect([...cloned].every((m) => !sourceMaterials.has(m))).toBe(true);
    const spies = [...instances, ...cloned, ...sourceMaterials, ...geometries, texture].map((r) => vi.spyOn(r, "dispose"));
    loaded.dispose();
    loaded.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("reports all-frame triangles per real tier and tests the phone option without suspension", async () => {
    const built = builtSigns(true);
    for (const low of [false, true]) {
      const totals: number[] = [];
      for (const omitPhoneRods of [false, true]) {
        const loaded = await loadSignKit(THREE, host(low), kit, low, { omitPhoneRods });
        const out = loaded.build(THREE, new THREE.Texture(), toRenderer, built.layouts);
        totals.push(out.stats.trianglesAllTiles);
        expect(out.placements).toHaveLength(signs.length);
        // Independent per-part accessor counts; some short gaps fit a rod without its fixed-height collar.
        const triangles = low ? { end_L: 60, end_R: 60, span: 40, hanger: 40, rod: 28, rod_canopy: 36 }
          : { end_L: 174, end_R: 174, span: 88, hanger: 168, rod: 36, rod_canopy: 156 };
        const expected = signFramePlacements(built.layouts, spec, low && omitPhoneRods)
          .reduce((total, frame) => total + frame.parts.reduce((n, part) => n + triangles[part.part], 0), 0);
        expect(out.stats.trianglesAllTiles).toBe(expected);
        if (low && omitPhoneRods) expect(out.group.children.every((m) => !/:(rod|hanger)/.test(m.name))).toBe(true);
        loaded.dispose();
      }
      console.info(`[kit sign frames] ${low ? "phone" : "desktop"}: rods=${totals[0]}, without phone rods=${totals[1]}`);
      if (low) expect(totals[1]).toBeLessThan(totals[0]!);
      else expect(totals[1]).toBe(totals[0]); // phone option never changes desktop
    }
    built.dispose();
  });
});
