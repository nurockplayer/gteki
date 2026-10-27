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
    // 14 of the 19 runs a piece fits get dressed. The 3 MB geometry cap cuts the five shortest, at a 15th
    // placement that would total 3,200,400 B: e:904c66c3 is the one that breaches it, and e:88ef3d09,
    // e:42a9f882, e:296f6709, e:d573063b rank below it. The other two runs (e:4bee1c5e at 48.3 deg and
    // e:27d3ed49 at 35.7 deg, both outside the dressing generator's range) never fitted any piece.
    expect(report.placed.length).toBe(14);
    expect(report.dropped.filter((d) => /budget/.test(d.reason)).map((d) => d.anchorKey).sort()).toEqual([
      "e:296f6709397b47faa8cbf2c36135a619", "e:42a9f8829d984243af47ff8328e698f6", "e:88ef3d09d7b240b18754ee19bbeae3e1",
      "e:904c66c36c1440ea8c6261ec2356bf72", "e:d573063b997e42f3b146ffeec98aed38",
    ]);
    expect(report.dropped.filter((d) => /no piece fits/.test(d.reason)).map((d) => d.anchorKey).sort()).toEqual([
      "e:27d3ed498cc9423683ee7f502c5d2460", "e:4bee1c5e3544452db681f9aeccfe2346",
    ]);
    expect(report.totals.draws).toBeLessThanOrEqual(KIT_BUDGET.maxDraws);
    expect(report.totals.triangles).toBeLessThanOrEqual(KIT_BUDGET.maxTriangles);
    expect(report.totals.geometryBytes).toBeLessThanOrEqual(KIT_BUDGET.maxGeometryBytes);
    expect(report.totals.gpuTextureBytes).toBeLessThanOrEqual(KIT_BUDGET.maxGpuTextureBytes);
    expect(report.hidden["escalator-balustrade"]).toBeGreaterThan(0);
  });

  it("leaves walkable, colliders, camera blockers and the scene lists exactly as the flag-off scene", () => {
    expect(digestSceneLists(on)).toEqual(digestSceneLists(off));
    const meshes = (s: StationScene) => (ms: readonly THREE.Mesh[] | undefined) => (ms ?? []).map((m) => [m.name, m.geometry.attributes.position?.count, m.geometry.index?.count]);
    expect(meshes(on)(on.walkable)).toEqual(meshes(off)(off.walkable));
    expect(meshes(on)(on.colliders)).toEqual(meshes(off)(off.colliders));
    expect(meshes(on)(on.cameraBlockers)).toEqual(meshes(off)(off.cameraBlockers));
    expect(on.spawnPoints).toEqual(off.spawnPoints);
    expect(on.walls).toEqual(off.walls);
  });
});
