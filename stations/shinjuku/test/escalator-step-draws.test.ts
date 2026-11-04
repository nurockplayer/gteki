import { expect, it } from "vitest";
import * as THREE from "three";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildStation } from "../scene/build.ts";
import type { Plan } from "../scene/layout.ts";
import { withCanvasStub } from "./helpers/scene-digest.ts";

it.each(["low", "high"] as const)("animates every escalator slice with one low-tier draw; retains high-tier meshes (%s)", quality => {
  const { bundle } = loadShinjukuBundle();
  const station = withCanvasStub(() => buildStation(bundle, planJson as unknown as Plan, { quality, reuseLayout: true }));
  try {
    const meshes: THREE.InstancedMesh[] = [];
    station.root.traverse(o => { if (o instanceof THREE.InstancedMesh && o.name.startsWith("escalator-steps:")) meshes.push(o); });
    const counts = station.escalators.map(({ run }) => Math.ceil(Math.hypot(Math.hypot(run.b.x - run.a.x, run.b.y - run.a.y) || 1, run.b.z - run.a.z) / 0.4));
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
      station.root.updateMatrixWorld(true);
      const mesh = meshes[0]!;
      mesh.onBeforeRender(null as never, null as never, camera, mesh.geometry, mesh.material as THREE.Material, null as never);
      expect(mesh.count).toBe(counts.reduce((sum, count) => sum + count, 0));
    }
    for (const [i, esc] of station.escalators.entries()) {
      const range = quality === "low" ? esc.steps.userData.ranges[esc.run.edgeId] : esc.steps.userData;
      const matrix = new THREE.Matrix4();
      esc.steps.getMatrixAt((range.offset ?? 0) + 1, matrix);
      const position = new THREE.Vector3().setFromMatrixPosition(matrix);
      const phase = ((0.2 * esc.speed % 0.4) + 0.4) % 0.4;
      const f = (0.4 + phase) / range.L3;
      expect(position.x).toBeCloseTo(range.lo.x + (range.hi.x - range.lo.x) * f, 4);
      expect(position.y).toBeCloseTo(range.lo.z + (range.hi.z - range.lo.z) * f - 0.03, 4);
      expect(position.z).toBeCloseTo(-(range.lo.y + (range.hi.y - range.lo.y) * f), 4);
      if (esc.speed !== 0) expect(matrix.equals(before[i]!)).toBe(false);
      const scale = new THREE.Vector3().setFromMatrixScale(matrix);
      if (quality === "high") expect(scale.toArray().map(v => Math.round(v * 1e5) / 1e5)).toEqual([1, 1, 1]);
      else expect(scale.distanceTo(range.scale)).toBeLessThan(1e-6);
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
    station.root.updateMatrixWorld(true);
    const render = () => {
      camera.updateMatrixWorld(true);
      mesh.onBeforeRender(null as never, null as never, camera, mesh.geometry, mesh.material as THREE.Material, null as never);
    };
    render();
    expect(mesh.count).toBeGreaterThan(0);
    expect(mesh.count).toBeLessThan(total);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const visible = station.escalators.filter(esc => frustum.intersectsBox(mesh.userData.ranges[esc.run.edgeId].bounds.clone().applyMatrix4(mesh.matrixWorld)));
    expect(mesh.count).toBe(visible.reduce((sum, esc) => sum + mesh.userData.ranges[esc.run.edgeId].count, 0));
    const first = visible[0]!;
    const firstRange = mesh.userData.ranges[first.run.edgeId];
    const before = new THREE.Matrix4();
    mesh.getMatrixAt(1, before);
    station.update(0.2, 0.2);
    render();
    const after = new THREE.Matrix4();
    mesh.getMatrixAt(1, after);
    const phase = ((0.2 * first.speed % 0.4) + 0.4) % 0.4;
    const f = (0.4 + phase) / firstRange.L3;
    const position = new THREE.Vector3().setFromMatrixPosition(after);
    expect(position.x).toBeCloseTo(firstRange.lo.x + (firstRange.hi.x - firstRange.lo.x) * f, 4);
    expect(position.y).toBeCloseTo(firstRange.lo.z + (firstRange.hi.z - firstRange.lo.z) * f - 0.03, 4);
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
