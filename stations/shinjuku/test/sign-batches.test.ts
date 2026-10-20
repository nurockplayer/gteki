import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildStation, type BuiltStation } from "../scene/build.ts";
import type { Plan } from "../scene/layout.ts";

const { bundle } = loadShinjukuBundle();

describe("wayfinding sign batches", () => {
  let station: BuiltStation;
  beforeAll(() => {
    // The test checks atlas layout and draw grouping, not raster output.
    const context = new Proxy({}, {
      get: (_target, key) => key === "createLinearGradient" || key === "createRadialGradient"
        ? () => ({ addColorStop() {} })
        : () => undefined,
    });
    vi.stubGlobal("document", { createElement: () => ({ width: 1, height: 1, getContext: () => context }) });
    station = buildStation(bundle, planJson as unknown as Plan, { quality: "high" });
  }, 60_000);
  afterAll(() => {
    station?.dispose();
    vi.unstubAllGlobals();
  });

  it("keeps one metadata group per sign while merging static faces into atlas meshes", () => {
    expect(station.signs.length).toBeGreaterThan(0);
    const ids = station.signs.map((sign) => sign.userData.nodeId);
    expect(ids.every((id) => typeof id === "string")).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);

    const faceMeshes: THREE.Mesh[] = [];
    station.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name.startsWith("sign-faces:")) faceMeshes.push(o);
    });
    expect(faceMeshes.length).toBeGreaterThan(0);
    expect(faceMeshes.length).toBeLessThanOrEqual(8);
    expect(new Set(faceMeshes.map((mesh) => mesh.material)).size).toBe(faceMeshes.length);
    expect(faceMeshes.reduce((sum, mesh) => sum + Number(mesh.userData.faceCount), 0)).toBe(station.signs.length * 2);
  });

  it("keeps every merged face UV inside one original sign's atlas content rect", () => {
    const faceMeshes: THREE.Mesh[] = [];
    station.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name.startsWith("sign-faces:")) faceMeshes.push(o);
    });
    for (const mesh of faceMeshes) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect(material.map).toBeInstanceOf(THREE.CanvasTexture);
      const image = material.map!.image as HTMLCanvasElement;
      expect(image.width).toBeLessThanOrEqual(4096);
      expect(image.height).toBeLessThanOrEqual(4096);
      const rects = mesh.userData.atlasRects as { u0: number; v0: number; u1: number; v1: number }[];
      const uv = mesh.geometry.getAttribute("uv");
      expect(rects.length).toBe(Number(mesh.userData.faceCount));
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i), v = uv.getY(i);
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThanOrEqual(1);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        expect(rects.some((r) => u >= r.u0 - 1e-6 && u <= r.u1 + 1e-6 && v >= r.v0 - 1e-6 && v <= r.v1 + 1e-6)).toBe(true);
      }
    }
  });
});
