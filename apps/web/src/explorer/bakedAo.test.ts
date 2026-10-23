import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { AO_MAP_HIGH_SCALE, applyBakedAo, bakedAoScale } from "./bakedAo.ts";

const uv1 = () => new THREE.BufferAttribute(new Float32Array(6), 2);
/** A one-triangle geometry, with or without a uv1 set. */
const geo = (withUv1 = true) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
  if (withUv1) g.setAttribute("uv1", uv1());
  return g;
};
const aoMat = (intensity = 1, channel = 1, name = "m") => {
  const m = new THREE.MeshStandardMaterial({ name });
  m.aoMap = new THREE.Texture();
  m.aoMap.channel = channel;
  m.aoMapIntensity = intensity;
  return m;
};
const rootOf = (...meshes: THREE.Mesh[]) => { const r = new THREE.Group(); r.add(...meshes); return r; };

afterEach(() => vi.restoreAllMocks());

describe("baked AO policy", () => {
  it("keeps the authored intensity on low (baked AO is the only contact darkening)", () => {
    const m = aoMat(1);
    const c = applyBakedAo(rootOf(new THREE.Mesh(geo(), m)), "low");
    expect(m.aoMapIntensity).toBe(1);
    expect(c).toEqual({ materials: 1, scaled: 0, disabled: 0, textureBytes: 0 });
  });

  it("scales by AO_MAP_HIGH_SCALE on high, where GTAO stacks with it", () => {
    const m = aoMat(1);
    const c = applyBakedAo(rootOf(new THREE.Mesh(geo(), m)), "high");
    expect(m.aoMapIntensity).toBeCloseTo(AO_MAP_HIGH_SCALE);
    expect(c).toEqual({ materials: 1, scaled: 1, disabled: 0, textureBytes: 0 });
    expect(bakedAoScale("high")).toBe(AO_MAP_HIGH_SCALE);
    expect(bakedAoScale("low")).toBe(1);
  });

  it("scales a station-authored intensity, not just 1", () => {
    const m = aoMat(0.5);
    applyBakedAo(rootOf(new THREE.Mesh(geo(), m)), "high");
    expect(m.aoMapIntensity).toBeCloseTo(0.5 * AO_MAP_HIGH_SCALE);
  });

  it("scales a shared material once", () => {
    const m = aoMat(1);
    const c = applyBakedAo(rootOf(new THREE.Mesh(geo(), m), new THREE.Mesh(geo(), m)), "high");
    expect(m.aoMapIntensity).toBeCloseTo(AO_MAP_HIGH_SCALE);
    expect(c.materials).toBe(1);
  });

  it("does not compound when the same station is applied again, and follows a tier change", () => {
    const m = aoMat(1);
    const root = rootOf(new THREE.Mesh(geo(), m));
    applyBakedAo(root, "high");
    const again = applyBakedAo(root, "high");
    expect(m.aoMapIntensity).toBeCloseTo(AO_MAP_HIGH_SCALE);
    expect(again.scaled).toBe(1);
    applyBakedAo(root, "low");
    expect(m.aoMapIntensity).toBe(1);
  });

  it("honours an explicit scale override", () => {
    const m = aoMat(1);
    applyBakedAo(rootOf(new THREE.Mesh(geo(), m)), "high", 0.25);
    expect(m.aoMapIntensity).toBe(0.25);
  });

  it("handles Mesh.material arrays", () => {
    const a = aoMat(1, 1, "a"), b = aoMat(0.8, 1, "b"), plain = new THREE.MeshStandardMaterial();
    const c = applyBakedAo(rootOf(new THREE.Mesh(geo(), [a, plain, b])), "high");
    expect(a.aoMapIntensity).toBeCloseTo(AO_MAP_HIGH_SCALE);
    expect(b.aoMapIntensity).toBeCloseTo(0.8 * AO_MAP_HIGH_SCALE);
    expect(c).toEqual({ materials: 2, scaled: 2, disabled: 0, textureBytes: 0 });
  });

  it("disables a UV1 aoMap used by a geometry without uv1, warning once per material", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = aoMat(1, 1, "nouv1-a");
    const ok = aoMat(1, 1, "has-uv1");
    const root = rootOf(new THREE.Mesh(geo(false), bad), new THREE.Mesh(geo(true), ok));
    const c = applyBakedAo(root, "high");
    expect(bad.aoMap).toBeNull();
    expect(ok.aoMap).not.toBeNull();
    expect(ok.aoMapIntensity).toBeCloseTo(AO_MAP_HIGH_SCALE);
    expect(c).toEqual({ materials: 2, scaled: 1, disabled: 1, textureBytes: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    // another material is warned about even with the same name (or none)...
    const twin = aoMat(1, 1, "nouv1-a");
    applyBakedAo(rootOf(new THREE.Mesh(geo(false), twin)), "high");
    expect(twin.aoMap).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    const unnamedA = aoMat(1, 1, ""), unnamedB = aoMat(1, 1, "");
    applyBakedAo(rootOf(new THREE.Mesh(geo(false), unnamedA), new THREE.Mesh(geo(false), unnamedB)), "high");
    expect(warn).toHaveBeenCalledTimes(4);
    // ...but the same material never warns twice
    unnamedA.aoMap = new THREE.Texture();
    unnamedA.aoMap.channel = 1;
    applyBakedAo(rootOf(new THREE.Mesh(geo(false), unnamedA)), "high");
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("reports the estimated bytes of each distinct aoMap texture once", () => {
    const sized = (w: number, h: number) => { const t = new THREE.Texture({ width: w, height: h } as unknown as HTMLImageElement); t.channel = 1; return t; };
    const shared = sized(512, 512);
    const a = aoMat(1, 1, "a"), b = aoMat(1, 1, "b"), c = aoMat(1, 1, "c");
    a.aoMap = shared;
    b.aoMap = shared; // two materials, one texture
    c.aoMap = sized(256, 256);
    const counts = applyBakedAo(rootOf(new THREE.Mesh(geo(), a), new THREE.Mesh(geo(), b), new THREE.Mesh(geo(), c)), "low");
    expect(counts.materials).toBe(3);
    expect(counts.textureBytes).toBe(Math.round((512 * 512 * 16) / 3) + Math.round((256 * 256 * 16) / 3));
  });

  it("disables the map when any one of a shared material's geometries lacks uv1", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = aoMat(1, 1, "shared-partial");
    const c = applyBakedAo(rootOf(new THREE.Mesh(geo(true), m), new THREE.Mesh(geo(false), m)), "high");
    expect(m.aoMap).toBeNull();
    expect(c).toEqual({ materials: 1, scaled: 0, disabled: 1, textureBytes: 0 });
  });

  it("leaves an aoMap on channel 0 alone when uv1 is absent (it samples uv)", () => {
    const m = aoMat(1, 0);
    const c = applyBakedAo(rootOf(new THREE.Mesh(geo(false), m)), "high");
    expect(m.aoMap).not.toBeNull();
    expect(c.disabled).toBe(0);
  });

  it("leaves materials without an aoMap untouched", () => {
    const m = new THREE.MeshStandardMaterial();
    m.aoMapIntensity = 0.7;
    const c = applyBakedAo(rootOf(new THREE.Mesh(geo(), m), new THREE.Mesh(geo(), new THREE.MeshBasicMaterial())), "high");
    expect(m.aoMapIntensity).toBe(0.7);
    expect(c).toEqual({ materials: 0, scaled: 0, disabled: 0, textureBytes: 0 });
  });
});
