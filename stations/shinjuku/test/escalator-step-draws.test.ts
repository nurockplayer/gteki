import { ESCALATOR_FLAT_M, escalatorHeight } from "@gteki/scene-api";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildStation, installLowTierSteps } from "../scene/build.ts";
import type { Plan } from "../scene/layout.ts";
import { batchKitPlacements } from "../scene/kit/batch.ts";
import type { KitManifest, KitPlacement, RunAnchor } from "../scene/kit/types.ts";
import { parseKitManifest } from "../scene/kit/manifest.ts";
import { stubAsset, stubManifestJson } from "./helpers/kit-stub.ts";
import { withCanvasStub } from "./helpers/scene-digest.ts";

/** The scene hook reads only renderer.info.render.frame: one pack per renderer frame. */
const rendererAt = (frame: number) => ({ info: { render: { frame } } }) as unknown as THREE.WebGLRenderer;

/** The station attached to a scene, with the shared step batch's scene-level hook installed (as both apps do). */
function sceneWithSteps(station: ReturnType<typeof buildStation>) {
  const scene = new THREE.Scene();
  scene.add(station.root);
  expect(installLowTierSteps(scene, station)).toBe(true);
  scene.updateMatrixWorld(true);
  return scene;
}

it.each(["low", "high"] as const)("animates every escalator slice with one low-tier draw; retains high-tier meshes (%s)", quality => {
  const { bundle } = loadShinjukuBundle();
  const station = withCanvasStub(() => buildStation(bundle, planJson as unknown as Plan, { quality, reuseLayout: true }));
  try {
    const meshes: THREE.InstancedMesh[] = [];
    station.root.traverse(o => { if (o instanceof THREE.InstancedMesh && o.name.startsWith("escalator-steps:")) meshes.push(o); });
    const counts = station.escalators.map(({ run }) => Math.ceil(Math.hypot(Math.hypot(run.b.x - run.a.x, run.b.y - run.a.y) || 1, run.b.z - run.a.z) / 0.4) + 2);
    expect(station.escalators.length).toBeGreaterThan(1);
    expect(station.escalators.some(esc => esc.speed !== 0)).toBe(true);
    expect(meshes).toHaveLength(quality === "low" ? 1 : station.escalators.length);
    expect(meshes.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(counts.reduce((sum, count) => sum + count, 0));
    for (const mesh of meshes) {
      expect(mesh.instanceMatrix.usage).toBe(THREE.DynamicDrawUsage);
      expect(mesh.geometry.index!.count).toBeGreaterThan(0);
      expect(mesh.geometry.groups).toHaveLength(0);
      expect(Array.isArray(mesh.material)).toBe(false);
    }
    let offset = 0;
    const before: THREE.Matrix4[] = [];
    for (const [i, esc] of station.escalators.entries()) {
      const range = quality === "low" ? esc.steps.userData.ranges[esc.run.edgeId] : esc.steps.userData;
      expect(range.count).toBe(counts[i]);
      if (quality === "low") {
        expect(range.offset).toBe(offset);
        expect(esc.steps).toBe(meshes[0]);
      } else {
        expect(esc.steps.name).toBe(`escalator-steps:${esc.run.edgeId}`);
        expect(esc.steps.count).toBe(counts[i]);
      }
      const matrix = new THREE.Matrix4();
      esc.steps.getMatrixAt((range.offset ?? 0) + 1, matrix);
      before.push(matrix);
      offset += counts[i]!;
    }
    station.update(0.2, 0.2);
    if (quality === "low") {
      const camera = new THREE.PerspectiveCamera(120, 1, 0.1, 10000);
      camera.position.set(0, 1000, 0);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
      const scene = sceneWithSteps(station);
      scene.onBeforeRender(rendererAt(1), scene, camera, null as never, null as never, null as never);
      expect(meshes[0]!.count).toBe(counts.reduce((sum, count) => sum + count, 0));
    }
    for (const [i, esc] of station.escalators.entries()) {
      const range = quality === "low" ? esc.steps.userData.ranges[esc.run.edgeId] : esc.steps.userData;
      const matrix = new THREE.Matrix4();
      esc.steps.getMatrixAt((range.offset ?? 0) + 1, matrix);
      const position = new THREE.Vector3().setFromMatrixPosition(matrix);
      const phase = 0.2 * esc.speed;
      const f = phase / range.L3;
      expect(position.x).toBeCloseTo(range.lo.x + (range.hi.x - range.lo.x) * f, 4);
      expect(position.y).toBeCloseTo(range.lo.z, 4);
      expect(position.z).toBeCloseTo(-(range.lo.y + (range.hi.y - range.lo.y) * f), 4);
      if (esc.speed !== 0) expect(matrix.equals(before[i]!)).toBe(false);
      const scale = new THREE.Vector3().setFromMatrixScale(matrix);
      if (quality === "high") expect(scale.toArray().map(v => Math.round(v * 1e5) / 1e5)).toEqual([1, 1, 1]);
      else expect(scale.distanceTo(range.scale)).toBeLessThan(1e-6);
    }
    const camera = new THREE.PerspectiveCamera(120, 1, 0.1, 10000);
    camera.position.set(0, 1000, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const scene = quality === "low" ? sceneWithSteps(station) : null;
    const cycleSeconds = Math.max(...counts) * 0.4 / 0.5;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    for (let sample = 0; sample <= 64; sample++) {
      station.update(0, sample * cycleSeconds / 64);
      if (scene) scene.onBeforeRender(rendererAt(sample + 2), scene, camera, null as never, null as never, null as never);
      for (const esc of station.escalators) {
        const range = quality === "low" ? esc.steps.userData.ranges[esc.run.edgeId] : esc.steps.userData;
        const dx = range.hi.x - range.lo.x, dy = range.hi.y - range.lo.y;
        const length = Math.hypot(dx, dy);
        const halfDepth = 0.4 * length / range.L3 / 2;
        let bottom = 0, top = 0;
        for (let i = 0; i < range.count; i++) {
          esc.steps.getMatrixAt((range.offset ?? 0) + i, matrix);
          position.setFromMatrixPosition(matrix);
          scale.setFromMatrixScale(matrix);
          const along = ((position.x - range.lo.x) * dx + (-position.z - range.lo.y) * dy) / length;
          expect(position.y).toBeCloseTo(range.lo.z + escalatorHeight(along, length, range.hi.z - range.lo.z), 4);
          expect(position.y).toBeLessThanOrEqual(range.hi.z + 1e-4);
          if (along <= 0.8) { expect(position.y).toBeCloseTo(range.lo.z, 4); bottom++; }
          if (along >= length - 0.8) { expect(position.y).toBeCloseTo(range.hi.z, 4); top++; }
          if (scale.x === 0) expect(along < -halfDepth + 1e-4 || along > length + halfDepth - 1e-4).toBe(true);
          if (along >= 0 && along <= length) expect(scale.x).toBeGreaterThan(0);
        }
        expect(bottom).toBeGreaterThanOrEqual(2);
        expect(top).toBeGreaterThanOrEqual(2);
        expect(esc.speed).toBe(0.5 * (esc.run.travel === 0 ? 0 : (esc.run.a.z <= esc.run.b.z ? 1 : -1) * esc.run.travel));
      }
    }
  } finally { station.dispose(); }
}, 120_000);

it("packs only camera-visible low-tier runs, animates the packed slice and keeps real tread thickness", () => {
  const { bundle } = loadShinjukuBundle();
  const station = withCanvasStub(() => buildStation(bundle, planJson as unknown as Plan, { quality: "low", reuseLayout: true }));
  try {
    const mesh = station.escalators[0]!.steps;
    const total = mesh.count;
    expect(mesh.frustumCulled).toBe(false);
    const moving = station.escalators.find(esc => esc.speed !== 0)!;
    const range = mesh.userData.ranges[moving.run.edgeId];
    const center = new THREE.Vector3((range.lo.x + range.hi.x) / 2, (range.lo.z + range.hi.z) / 2, -(range.lo.y + range.hi.y) / 2);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 60);
    camera.position.copy(center).add(new THREE.Vector3(0, 8, 12));
    camera.lookAt(center);
    const scene = sceneWithSteps(station);
    let frame = 0;
    const render = () => {
      camera.updateMatrixWorld(true);
      scene.onBeforeRender(rendererAt(++frame), scene, camera, null as never, null as never, null as never);
    };
    render();
    expect(mesh.count).toBeGreaterThan(0);
    expect(mesh.count).toBeLessThan(total);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const visible = station.escalators.filter(esc => frustum.intersectsBox(mesh.userData.ranges[esc.run.edgeId].bounds.clone().applyMatrix4(mesh.matrixWorld)));
    expect(mesh.count).toBe(visible.reduce((sum, esc) => sum + mesh.userData.ranges[esc.run.edgeId].count, 0));
    // #822: one pack per renderer frame. A second scene-hook call in the same frame writes nothing.
    const writes = vi.spyOn(mesh, "setMatrixAt");
    const sameFrame = rendererAt(frame + 1);
    scene.onBeforeRender(sameFrame, scene, camera, null as never, null as never, null as never);
    const written = writes.mock.calls.length;
    expect(written).toBeGreaterThan(0);
    expect(mesh.count).toBe(visible.reduce((sum, esc) => sum + mesh.userData.ranges[esc.run.edgeId].count, 0));
    scene.onBeforeRender(sameFrame, scene, camera, null as never, null as never, null as never);
    expect(writes.mock.calls.length).toBe(written);
    writes.mockRestore();
    frame++;
    const first = visible[0]!;
    const firstRange = mesh.userData.ranges[first.run.edgeId];
    const before = new THREE.Matrix4();
    mesh.getMatrixAt(1, before);
    station.update(0.2, 0.2);
    render();
    const after = new THREE.Matrix4();
    mesh.getMatrixAt(1, after);
    const phase = 0.2 * first.speed;
    const f = phase / firstRange.L3;
    const position = new THREE.Vector3().setFromMatrixPosition(after);
    expect(position.x).toBeCloseTo(firstRange.lo.x + (firstRange.hi.x - firstRange.lo.x) * f, 4);
    expect(position.y).toBeCloseTo(firstRange.lo.z, 4);
    expect(position.z).toBeCloseTo(-(firstRange.lo.y + (firstRange.hi.y - firstRange.lo.y) * f), 4);
    expect(first.speed).not.toBe(0);
    expect(after.equals(before)).toBe(false);
    const positions = mesh.geometry.getAttribute("position");
    const treadYs = Array.from({ length: 24 }, (_, i) => positions.getY(i));
    const thickness = Math.max(...treadYs) - Math.min(...treadYs);
    const effective = station.escalators.map(esc => thickness * mesh.userData.ranges[esc.run.edgeId].scale.y);
    console.info("Effective tread thickness (m)", Math.min(...effective), Math.max(...effective));
    // Real runs measure 0.0338704–0.0548607 m with the requested median-rise reference (2026-11-04 JST).
    // Their different inclines need a 38% envelope; unit-geometry scaling still fails this bound.
    const tolerance = 0.38;
    for (const value of effective) {
      expect(value).toBeGreaterThanOrEqual(0.04 * (1 - tolerance));
      expect(value).toBeLessThanOrEqual(0.04 * (1 + tolerance));
    }
    camera.position.set(0, 1000, 0);
    camera.lookAt(0, 2000, 0);
    render();
    expect(mesh.count).toBe(0);
    camera.position.copy(center).add(new THREE.Vector3(0, 8, 12));
    camera.lookAt(center);
    render();
    expect(mesh.count).toBeGreaterThan(0);
  } finally { station.dispose(); }
}, 120_000);

it("the standalone app installs the same low-tier scene hook (#822)", () => {
  // main.ts is a DOM entry point, so the app path is checked at its two ends: the call, and the hook packing.
  expect(readFileSync(new URL("../app/src/main.ts", import.meta.url), "utf8")).toContain("installLowTierSteps(scene, station)");
  const { bundle } = loadShinjukuBundle();
  const station = withCanvasStub(() => buildStation(bundle, planJson as unknown as Plan, { quality: "low", reuseLayout: true }));
  try {
    const scene = sceneWithSteps(station);
    const mesh = scene.getObjectByName("escalator-steps:all") as THREE.InstancedMesh;
    const moving = station.escalators.find(esc => esc.speed !== 0)!;
    const range = mesh.userData.ranges[moving.run.edgeId];
    const center = new THREE.Vector3((range.lo.x + range.hi.x) / 2, (range.lo.z + range.hi.z) / 2, -(range.lo.y + range.hi.y) / 2);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 60);
    camera.position.copy(center).add(new THREE.Vector3(0, 8, 12));
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
    scene.onBeforeRender(rendererAt(1), scene, camera, null as never, null as never, null as never);
    expect(mesh.count).toBeGreaterThan(0);
    expect(mesh.count).toBeLessThan(mesh.instanceMatrix.count);
  } finally { station.dispose(); }
}, 120_000);

it("fits kit rails to the same landing profile at the exact run endpoints", () => {
  const manifest: KitManifest = parseKitManifest(stubManifestJson({ extra: [stubAsset("rail", "dressing", "linear", {
    params: { rise_mm: 4000, run_mm: 8400 },
  })] }), "mobile");
  const run: RunAnchor = { role: "escalator", key: "run", floorId: "f", lo: { x: 0, y: 0, z: 0 },
    hi: { x: 0, y: 10.1, z: 4.05 }, width: 1, dir: { x: 0, y: 1 } };
  const placement: KitPlacement = { role: "escalator", anchorKey: "run", assetId: "rail", floorId: "f",
    rank: 1, position: [0, 0.003, 0], yaw: 0, replaces: "escalator-balustrade" };
  const along = [0.4, ESCALATOR_FLAT_M, 5, 9.2, 9.6];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(along.flatMap(s => [0, escalatorHeight(s, 10, 4) + 0.9, -s]), 3));
  geometry.setIndex([0, 1, 2, 2, 3, 4]);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()); mesh.name = "VIS_rail";
  const owned: { dispose(): void }[] = [];
  const batch = batchKitPlacements({ placed: [placement], runs: [run], manifest,
    provider: { instantiate: () => { const root = new THREE.Group(); root.add(mesh); return root; } },
    tint: [], track: v => { owned.push(v); return v; } });
  try {
    const positions = batch.meshes[0]!.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      expect(positions.getY(i)).toBeCloseTo(escalatorHeight(-positions.getZ(i), 10.1, 4.05) + 0.9, 4);
    }
  } finally { owned.forEach(v => v.dispose()); geometry.dispose(); mesh.material.dispose(); }
});
