/**
 * Differential proof for the explorer's BVH ray tests on a real station: the Shinjuku scene module (whatever
 * version is checked out), ray-tested the way the explorer does (walk, ground, camera, sky), plus random
 * stress rays. Every hit list must equal three's brute-force intersectObjects exactly (objects, distances,
 * faces, order). Heavy: run with `pnpm test:heavy:box`. Writes its numbers to .qa/ray-bvh/shinjuku.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { WALKER_BODY, type StationScene } from "@gteki/scene-api";
import { nodeDisplayZ } from "@gteki/navigation";
import { loadShinjukuBundle } from "../../../../stations/shinjuku/data/bundle.ts";
import { buildScene } from "../../../../stations/shinjuku/gteki/scene.ts";
import { R } from "./geometry.ts";
import { FOLLOW } from "./followCamera.ts";
import { STREET } from "./streetBackdrop.ts";
import { castAll, castCamera, explorerTargets, type ExplorerTargets } from "./raycast.ts";
import { prepareRayTrees } from "./meshBvh.ts";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TWO_SIDED = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
/** castCamera's brute-force twin: blockers two-sided for the test, three's own intersectObjects. */
function bruteCamera(ray: THREE.Raycaster, targets: THREE.Object3D[], twoSided: ReadonlySet<THREE.Object3D>): THREE.Intersection[] {
  const saved = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  for (const o of targets) {
    if (!twoSided.has(o)) continue;
    const m = o as THREE.Mesh;
    saved.set(m, m.material);
    m.material = Array.isArray(m.material) ? m.material.map(() => TWO_SIDED) : TWO_SIDED;
  }
  try {
    return ray.intersectObjects(targets, false);
  } finally {
    for (const [m, material] of saved) m.material = material;
  }
}

function differs(got: THREE.Intersection[], want: THREE.Intersection[]): string | null {
  if (got.length !== want.length) return `${got.length} hits vs ${want.length}`;
  for (let i = 0; i < want.length; i++) {
    const g = got[i]!, w = want[i]!;
    if (g.object !== w.object) return `hit ${i}: object ${g.object.name} vs ${w.object.name}`;
    if (g.distance !== w.distance) return `hit ${i}: distance ${g.distance} vs ${w.distance}`;
    if (g.faceIndex !== w.faceIndex || g.face?.materialIndex !== w.face?.materialIndex) return `hit ${i}: face ${g.faceIndex} vs ${w.faceIndex}`;
    if (!g.point.equals(w.point)) return `hit ${i}: point`;
  }
  return null;
}

interface Mix { name: string; rays: number; hits: number; mismatches: string[]; maxFirstDelta: number; bruteMs: number; bvhMs: number }

describe("BVH ray tests on the Shinjuku scene module equal brute force", () => {
  let scene: StationScene;
  let targets: ExplorerTargets;
  let anchors: THREE.Vector3[];
  let bounds: THREE.Box3;
  let trees: ReturnType<typeof prepareRayTrees>;
  let memory: { heapMb: number; arrayBuffersMb: number };
  const mixes: Mix[] = [];

  beforeAll(async () => {
    const context = new Proxy({}, { get: (_t, key) => (key === "createLinearGradient" || key === "createRadialGradient") ? () => ({ addColorStop() {} }) : () => undefined });
    vi.stubGlobal("document", { createElement: () => ({ width: 1, height: 1, getContext: () => context }) });
    const { bundle } = loadShinjukuBundle();
    scene = (await buildScene({ THREE, bundle, quality: "low" } as never)) as StationScene;
    scene.root.updateMatrixWorld(true);
    targets = explorerTargets(scene.walkable, scene.colliders ?? [], scene.cameraBlockers ?? []);
    const floors = new Map(bundle.floors.map((f) => [f.id, f]));
    anchors = bundle.nodes.map((n) => R(n.position.x, n.position.y, nodeDisplayZ(n, floors.get(n.floorId)).z));
    bounds = new THREE.Box3();
    for (const o of targets.camera) bounds.expandByObject(o);
    const before = process.memoryUsage();
    trees = prepareRayTrees(targets.camera);
    const after = process.memoryUsage();
    memory = { heapMb: (after.heapUsed - before.heapUsed) / 2 ** 20, arrayBuffersMb: (after.arrayBuffers - before.arrayBuffers) / 2 ** 20 };
  }, 120_000);

  afterAll(() => {
    if (targets && trees) {
      const report = {
        targets: { ground: targets.ground.length, collider: targets.collider.length, sky: targets.sky.length, camera: targets.camera.length, blockers: targets.blockers.size },
        trees: { ...trees, mb: trees.bytes / 2 ** 20 },
        memory: { ...memory, workerPeakRssMb: process.resourceUsage().maxRSS / 1024 },
        mixes: mixes.map((m) => ({ ...m, mismatches: m.mismatches.length, firstMismatches: m.mismatches.slice(0, 5), bruteUsPerRay: (m.bruteMs * 1000) / m.rays, bvhUsPerRay: (m.bvhMs * 1000) / m.rays })),
      };
      mkdirSync(".qa/ray-bvh", { recursive: true });
      writeFileSync(".qa/ray-bvh/shinjuku.json", `${JSON.stringify(report, null, 2)}\n`);
    }
    scene?.dispose();
    vi.unstubAllGlobals();
  });

  const run = (name: string, seed: number, rays: number, aim: (r: () => number, ray: THREE.Raycaster) => { list: THREE.Object3D[]; camera?: boolean }) => {
    const r = rng(seed);
    const ray = new THREE.Raycaster();
    const mix: Mix = { name, rays, hits: 0, mismatches: [], maxFirstDelta: 0, bruteMs: 0, bvhMs: 0 };
    for (let i = 0; i < rays; i++) {
      const { list, camera } = aim(r, ray);
      let t = performance.now();
      const want = camera ? bruteCamera(ray, list, targets.blockers) : ray.intersectObjects(list, false);
      mix.bruteMs += performance.now() - t;
      t = performance.now();
      const got = camera ? castCamera(ray, list, targets.blockers) : castAll(ray, list);
      mix.bvhMs += performance.now() - t;
      if (want.length) mix.hits++;
      if (want.length && got.length) mix.maxFirstDelta = Math.max(mix.maxFirstDelta, Math.abs(want[0]!.distance - got[0]!.distance));
      const diff = differs(got, want);
      if (diff) mix.mismatches.push(`#${i} ${ray.ray.origin.toArray()} → ${ray.ray.direction.toArray()} far ${ray.far}: ${diff}`);
    }
    mixes.push(mix);
    return mix;
  };
  const near = (r: () => number, spread: number, lift: number) => anchors[Math.floor(r() * anchors.length)]!.clone().add(new THREE.Vector3((r() - 0.5) * spread, lift, (r() - 0.5) * spread));
  const check = (mix: Mix) => {
    expect(mix.mismatches.slice(0, 5)).toEqual([]);
    expect(mix.maxFirstDelta).toBeLessThanOrEqual(1e-6);
    expect(mix.hits).toBeGreaterThan(0);
  };

  it("has the ray targets and their trees", () => {
    expect(targets.camera.length).toBeGreaterThan(0);
    expect(trees.trees).toBeGreaterThan(0);
  });

  it("walk rays (blockedByColliders)", () => {
    check(run("walk", 11, 12_000, (r, ray) => {
      const a = r() * Math.PI * 2;
      ray.set(near(r, 8, r() < 0.5 ? 0.5 : 1.2), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
      ray.near = 0;
      ray.far = 0.3 + r() * 2 + WALKER_BODY.radiusM;
      return { list: targets.collider };
    }));
  }, 900_000);

  it("ground rays (groundAt, street footing probe)", () => {
    check(run("ground", 12, 12_000, (r, ray) => {
      const probe = r() < 0.3;
      ray.set(near(r, 8, probe ? 0.4 : 1.5), new THREE.Vector3(0, -1, 0));
      ray.near = 0;
      ray.far = probe ? 1.2 : 4;
      return { list: targets.ground };
    }));
  }, 900_000);

  it("camera rays (follow camera, shoulder probe, blockers two-sided)", () => {
    check(run("camera", 13, 14_000, (r, ray) => {
      const pivot = near(r, 6, 1.3 + r() * 0.6);
      const a = r() * Math.PI * 2;
      if (r() < 0.25) {
        ray.set(pivot, new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
        ray.far = FOLLOW.shoulder + 0.25;
      } else {
        const up = -0.3 + r() * 1.6;
        ray.set(pivot, new THREE.Vector3(Math.cos(a) * Math.cos(up), Math.sin(up), Math.sin(a) * Math.cos(up)));
        ray.far = FOLLOW.minDistance + r() * 9 + FOLLOW.clearance;
      }
      ray.near = 0;
      return { list: targets.camera, camera: true };
    }));
  }, 900_000);

  it("up rays (street probe sky test)", () => {
    check(run("sky", 14, 8_000, (r, ray) => {
      const tilt = r() < 0.7 ? 0 : r() * 0.3;
      const a = r() * Math.PI * 2;
      ray.set(near(r, 8, WALKER_BODY.eyeM), new THREE.Vector3(Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a)));
      ray.near = 0;
      ray.far = STREET.skyClearance;
      return { list: targets.sky };
    }));
  }, 900_000);

  it("stress rays across the whole station, unbounded", () => {
    const size = bounds.getSize(new THREE.Vector3());
    const at = (r: () => number) => new THREE.Vector3(r(), r(), r()).multiply(size).add(bounds.min);
    check(run("stress", 15, 6_000, (r, ray) => {
      const origin = at(r);
      ray.set(origin, at(r).sub(origin).normalize());
      ray.near = 0;
      ray.far = Infinity;
      return { list: targets.camera, camera: r() < 0.5 };
    }));
  }, 900_000);
});
