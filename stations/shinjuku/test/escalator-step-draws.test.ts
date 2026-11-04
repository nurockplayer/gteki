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
