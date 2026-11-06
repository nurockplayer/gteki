// Batch 2 (#94): the station's own mobile kit bundle dresses Shinjuku's escalators in the default scene.
// The GLB is decoded without its texture images: placement, batching and the kit report never read pixels, and
// node has no image decoder (the same approach as stations/ikebukuro/scene/kit_signs.test.ts). Everything
// else — geometry, transforms, material names, the manifest — is the shipped file.
import { readFileSync } from "node:fs";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { StationScene } from "@gteki/scene-api";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildScene } from "../gteki/scene.ts";
import { KIT_BUDGET } from "../scene/kit/config.ts";
import type { Plan } from "../scene/layout.ts";
import type { KitSwapReport } from "../scene/kit/types.ts";
import { withCanvasStub } from "./helpers/scene-digest.ts";
import { digestSceneLists } from "./helpers/station-digest.ts";
import { cutStairwells, stairwellWells } from "../../../apps/web/src/explorer/stairwellCut.ts";

const { bundle } = loadShinjukuBundle(), plan = planJson as unknown as Plan;

/** The Golden Slice of #94: the three graph edges of the mid-station tower the batch was reviewed on. */
const GOLDEN_SLICE = ["e:e1fa653048b94a5695777d1063b34417", "e:2692fe08625f4a3f92d69a1380a58ccd", "e:fd3365c80feb4bcab0437f74db5ad68d"];

type GltfJson = {
  scene?: number;
  scenes: { nodes: number[] }[];
  nodes: { name?: string; mesh?: number; children?: number[]; extras?: Record<string, unknown>; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[];
  materials: { name?: string; extras?: Record<string, unknown>; doubleSided?: boolean }[];
  accessors: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
};

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** The shipped bundle as a THREE scene: node hierarchy, transforms, geometry and material names, no textures. */
function bundleGlb(): GLTF {
  const bytes = readFileSync(new URL("../gteki/assets/kit/mobile.glb", import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const d = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as GltfJson;
  const bin = bytes.subarray(28 + jsonLength);
  const accessor = (id: number) => {
    const a = d.accessors[id]!, view = d.bufferViews[a.bufferView!]!, comps = COMPONENTS[a.type]!;
    const size = a.componentType === 5126 ? 4 : a.componentType === 5123 ? 2 : a.componentType === 5125 ? 4 : 1;
    const get = a.componentType === 5126 ? (o: number) => bin.readFloatLE(o)
      : a.componentType === 5123 ? (o: number) => bin.readUInt16LE(o)
        : a.componentType === 5125 ? (o: number) => bin.readUInt32LE(o) : (o: number) => bin.readUInt8(o);
    const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = view.byteStride ?? comps * size;
    return { count: a.count, comps, get: (i: number, k: number) => get(base + i * stride + k * size) };
  };
  const materials = d.materials.map((m) => {
    const material = new THREE.MeshStandardMaterial({ name: m.name ?? "", side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
    Object.assign(material.userData, m.extras ?? {});
    return material;
  });
  const nodes = d.nodes.map((n) => {
    const group = new THREE.Group();
    group.name = n.name ?? "";
    Object.assign(group.userData, n.extras ?? {});
    if (n.translation) group.position.fromArray(n.translation);
    if (n.rotation) group.quaternion.fromArray(n.rotation);
    if (n.scale) group.scale.fromArray(n.scale);
    if (n.mesh !== undefined) for (const p of d.meshes[n.mesh]!.primitives) {
      const geometry = new THREE.BufferGeometry();
      for (const [name, id] of [["position", p.attributes.POSITION], ["normal", p.attributes.NORMAL], ["uv", p.attributes.TEXCOORD_0]] as const) {
        if (id === undefined) continue;
        const a = accessor(id), arr = new Float32Array(a.count * a.comps);
        for (let i = 0; i < a.count; i++) for (let k = 0; k < a.comps; k++) arr[i * a.comps + k] = a.get(i, k);
        geometry.setAttribute(name, new THREE.BufferAttribute(arr, a.comps));
      }
      if (p.indices !== undefined) {
        const a = accessor(p.indices), arr = new Uint32Array(a.count);
        for (let i = 0; i < a.count; i++) arr[i] = a.get(i, 0);
        geometry.setIndex(new THREE.BufferAttribute(arr, 1));
      }
      group.add(new THREE.Mesh(geometry, materials[p.material ?? 0]!));
    }
    return group;
  });
  d.nodes.forEach((n, i) => n.children?.forEach((c) => nodes[i]!.add(nodes[c]!)));
  const scene = new THREE.Group();
  for (const i of d.scenes[d.scene ?? 0]!.nodes) scene.add(nodes[i]!);
  return { scene, scenes: [scene] } as unknown as GLTF;
}

const ctx = (withBundle: boolean) => ({ THREE, bundle, quality: "low", ...(withBundle ? { loadGlb: async () => bundleGlb() } : {}) });

describe("the shipped mobile kit bundle dresses the escalators", () => {
  let off: StationScene, on: StationScene, report: KitSwapReport;

  beforeAll(async () => {
    // `?kit=0` is the off switch: the baseline the dressed scene must not disturb.
    vi.stubGlobal("location", { search: "?kit=0" });
    off = await withCanvasStub(() => buildScene(ctx(false) as never)) as StationScene;
    vi.unstubAllGlobals();
    // No query and no `location`: the shipping default, escalator role only, real bundle.
    on = await withCanvasStub(() => buildScene(ctx(true) as never)) as StationScene;
    report = on.root.userData.kitSwap as KitSwapReport;
  }, 120_000);

  afterAll(() => { off?.dispose(); on?.dispose(); vi.unstubAllGlobals(); });

  it("places the Golden Slice and every other escalator anchor it can fit, within KIT_BUDGET", () => {
    console.info(`kit report: ${JSON.stringify({
      tier: report.tier, budget: KIT_BUDGET, totals: report.totals, measured: report.measured, hidden: report.hidden,
      placed: report.placed.map((p) => `${p.anchorKey} ${p.assetId}`), dropped: report.dropped, gaps: report.gaps,
    }, null, 2)}`);
    expect(report.tier).toBe("mobile");
    expect(report.placed.length).toBeGreaterThan(0);
    expect(report.placed.every((p) => p.role === "escalator" && p.replaces === "escalator-balustrade")).toBe(true);
    const keys = new Set(report.placed.map((p) => p.anchorKey));
    for (const edge of GOLDEN_SLICE) expect([edge, keys.has(edge)]).toEqual([edge, true]);
    // 21 runs a piece fits get dressed, with no budget drops. 27d3ed49 stays procedural: 35.8° on a
    // symbolic height is outside the generator's range and is a stated data limit (kit-swap.md), not a
    // missing asset.
    expect(report.placed.length).toBe(21);
    expect(report.dropped.filter((d) => /budget/.test(d.reason))).toEqual([]);
    expect(report.dropped.filter((d) => /no piece fits/.test(d.reason)).map((d) => d.anchorKey).sort()).toEqual([
      "e:27d3ed498cc9423683ee7f502c5d2460",
    ]);
    expect(report.totals.draws).toBeLessThanOrEqual(KIT_BUDGET.maxDraws);
    // #751: 60k triangles and 30 draws are ACTIVE limits the distance LOD enforces at runtime; the resident
    // kit is guarded by whole-station geometry bytes, and 21 runs sit near 64,050 resident triangles by design.
    expect(report.totals.geometryBytes).toBeLessThanOrEqual(KIT_BUDGET.maxGeometryBytes);
    expect(report.measured.geometryBytes).toBeLessThanOrEqual(report.totals.geometryBytes);
    expect(report.totals.gpuTextureBytes).toBeLessThanOrEqual(KIT_BUDGET.maxGpuTextureBytes);
    expect(report.hidden["escalator-balustrade"]).toBeGreaterThan(0);
  });

  it("keeps the distance LOD's active kit inside the #751 active limits at every dressed run", () => {
    const layer = on.root.getObjectByName("kit-swap")!;
    const near = layer.children.filter((g) => g.name.startsWith("kit-near:"));
    // What the LOD leaves visible: its merged kit batches, counted the way lod.ts counts a draw.
    const load = () => {
      let triangles = 0, draws = 0;
      for (const group of near) for (const child of group.visible ? group.children : []) {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) continue;
        triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        draws += materials.reduce((n, m) => n + (m.transparent && m.side === THREE.DoubleSide && !m.forceSinglePass ? 2 : 1), 0);
      }
      return { triangles, draws };
    };
    for (const p of report.placed) {
      report.lod!.update({ x: p.position[0], y: -p.position[2], z: p.position[1] });
      const { triangles, draws } = load();
      expect(triangles, `${p.anchorKey} draws its own batch`).toBeGreaterThan(0);
      expect(draws, `${p.anchorKey} active draws`).toBeLessThanOrEqual(KIT_BUDGET.maxDraws);
      expect(triangles, `${p.anchorKey} active triangles`).toBeLessThanOrEqual(KIT_BUDGET.maxTriangles);
      expect([p.anchorKey, report.lod!.active.has(p.anchorKey)]).toEqual([p.anchorKey, true]);
    }
  });

  it("leaves walkable, colliders, camera blockers and the scene lists exactly as the flag-off scene", () => {
    expect(digestSceneLists(on)).toEqual(digestSceneLists(off));
    const meshes = (os: readonly THREE.Object3D[] | undefined) => (os ?? []).map((o) => {
      const m = o as THREE.Mesh;
      return [m.name, m.geometry?.attributes.position?.count, m.geometry?.index?.count];
    });
    expect(meshes(on.walkable)).toEqual(meshes(off.walkable));
    expect(meshes(on.colliders)).toEqual(meshes(off.colliders));
    expect(meshes(on.cameraBlockers)).toEqual(meshes(off.cameraBlockers));
    expect(on.spawnPoints).toEqual(off.spawnPoints);
    expect(on.walls).toEqual(off.walls);
  });

  it("switches the shipped geometry between kit and procedural clusters without changing physics", () => {
    const layer = on.root.getObjectByName("kit-swap")!;
    report.lod!.update({ x: 10000, y: 10000, z: 10000 });
    const far = layer.children.filter((g) => g.name === "kit-fallback");
    const pairs = layer.children.filter((g) => g.name.startsWith("kit-near:") && g.name !== "kit-near:static")
      .map((near, i) => ({ near, far: far[i]! }));
    const physical = digestSceneLists(on);
    const first = report.placed[0]!;
    for (const position of [
      { x: first.position[0], y: -first.position[2], z: first.position[1] },
      { x: 10000, y: 10000, z: 10000 },
      { x: first.position[0], y: -first.position[2], z: first.position[1] },
    ]) {
      report.lod!.update(position);
      for (const { near, far } of pairs) {
        expect(far.name).toBe("kit-fallback");
        expect(near.visible).toBe(!far.visible);
        expect(far.children.length).toBeGreaterThan(0);
      }
      expect(report.lod!.active.has(first.anchorKey)).toBe(position.x !== 10000);
      expect(digestSceneLists(on)).toEqual(physical);
    }
  });

  it("never turns the additional fallback representation into runtime slab bands or guard colliders", () => {
    const layer = new THREE.Group();
    for (const child of on.root.getObjectByName("kit-swap")!.children) {
      if (child.name === "kit-fallback") layer.add(child.clone(true));
    }
    const cut = cutStairwells(layer, stairwellWells(bundle, () => true), { tier: "low" });
    try {
      expect(cut.stats.cutTriangles).toBe(0);
      expect(cut.bandTriangles).toBe(0);
      expect(cut.walls).toEqual([]);
      expect(cut.colliders).toEqual([]);
    } finally { cut.dispose(); }
  });
});
