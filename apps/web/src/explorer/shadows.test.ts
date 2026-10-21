import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SHADOW_HALF_EXTENT_M, SHADOW_MAP_SIZE, SHADOW_NORMAL_BIAS, SHADOW_OVERVIEW_MAX_HALF_M, SHADOW_RADIUS, SHADOW_Y_PAD_M, applyStationShadows, meshShadowFlags, overviewHalfExtent, shadowYRange, shadowsActive } from "./shadows.ts";

const box = (mat: THREE.Material | THREE.Material[] = new THREE.MeshStandardMaterial(), at: [number, number, number] = [0, 0, 0]) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  m.position.set(...at);
  return m;
};
const rootOf = (...kids: THREE.Object3D[]) => { const r = new THREE.Group(); r.add(...kids); return r; };
const apply = (root: THREE.Object3D, quality: "low" | "high" = "high", lighting: "default" | "scene" = "default") => applyStationShadows(root, quality, lighting);

describe("shadow constants", () => {
  it("keeps the tuned starting values", () => {
    expect([SHADOW_HALF_EXTENT_M, SHADOW_MAP_SIZE, SHADOW_RADIUS, SHADOW_NORMAL_BIAS]).toEqual([14, 2048, 3, 0.02]);
  });
});

describe("shadowsActive", () => {
  it("is high tier in default lighting only", () => {
    expect(shadowsActive("high", "default")).toBe(true);
    expect(shadowsActive("low", "default")).toBe(false);
    expect(shadowsActive("high", "scene")).toBe(false);
  });
});

describe("meshShadowFlags", () => {
  it("lets an opaque lit mesh cast and receive", () => {
    for (const mat of [new THREE.MeshStandardMaterial(), new THREE.MeshPhysicalMaterial(), new THREE.MeshLambertMaterial(), new THREE.MeshPhongMaterial()]) {
      expect(meshShadowFlags(box(mat))).toEqual({ cast: true, receive: true });
    }
  });

  it("lets an unlit mesh cast but never receive", () => {
    expect(meshShadowFlags(box(new THREE.MeshBasicMaterial()))).toEqual({ cast: true, receive: false });
  });

  it("skips transparent, faded, hidden, colour-less and non-depth-writing materials", () => {
    const bad = [
      new THREE.MeshStandardMaterial({ transparent: true }),
      new THREE.MeshStandardMaterial({ opacity: 0.5 }),
      Object.assign(new THREE.MeshStandardMaterial(), { visible: false }),
      new THREE.MeshStandardMaterial({ colorWrite: false }),
      new THREE.MeshStandardMaterial({ depthWrite: false }),
    ];
    for (const mat of bad) expect(meshShadowFlags(box(mat))).toEqual({ cast: false, receive: false });
  });

  it("needs every material of a multi-material mesh to qualify", () => {
    expect(meshShadowFlags(box([new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()]))).toEqual({ cast: true, receive: true });
    expect(meshShadowFlags(box([new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial({ transparent: true })]))).toEqual({ cast: false, receive: false });
    expect(meshShadowFlags(box([new THREE.MeshStandardMaterial(), new THREE.MeshBasicMaterial()]))).toEqual({ cast: true, receive: false });
  });

  it("ignores lines, points, sprites and groups", () => {
    for (const o of [new THREE.Line(), new THREE.LineSegments(), new THREE.Points(), new THREE.Sprite(), new THREE.Group()]) {
      expect(meshShadowFlags(o)).toEqual({ cast: false, receive: false });
    }
  });
});

describe("applyStationShadows", () => {
  it("sets flags on drawn meshes at any depth and counts them", () => {
    const a = box(), b = box(undefined, [3, 0, 0]), nested = new THREE.Group();
    nested.add(b);
    const root = rootOf(a, nested);
    const r = apply(root);
    expect([a.castShadow, a.receiveShadow, b.castShadow, b.receiveShadow]).toEqual([true, true, true, true]);
    expect(r).toMatchObject({ casters: 2, receivers: 2 });
  });

  it("skips invisible subtrees whole (hidden colliders and camera blockers)", () => {
    const hidden = box(), under = box(), group = new THREE.Group();
    hidden.visible = false;
    group.visible = false;
    group.add(under);
    const r = apply(rootOf(hidden, group));
    expect([hidden.castShadow, hidden.receiveShadow, under.castShadow, under.receiveShadow]).toEqual([false, false, false, false]);
    expect(r.casters).toBe(0);
    expect(r.bounds.isEmpty()).toBe(true);
  });

  it("leaves transparent meshes and unlit receivers alone", () => {
    const glass = box(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4 }));
    const basic = box(new THREE.MeshBasicMaterial());
    const r = apply(rootOf(glass, basic));
    expect([glass.castShadow, glass.receiveShadow]).toEqual([false, false]);
    expect([basic.castShadow, basic.receiveShadow]).toEqual([true, false]);
    expect(r).toMatchObject({ casters: 1, receivers: 0 });
  });

  it("clears a station's castShadow on a transparent mesh but keeps its receiveShadow = true", () => {
    const glass = box(new THREE.MeshStandardMaterial({ transparent: true }));
    glass.castShadow = true;
    glass.receiveShadow = true;
    const basic = box(new THREE.MeshBasicMaterial());
    basic.receiveShadow = true;
    apply(rootOf(glass, basic));
    expect([glass.castShadow, glass.receiveShadow, basic.receiveShadow]).toEqual([false, true, true]);
  });

  it("never touches anything outside the root", () => {
    const inside = box(), outside = box(), overlay = box();
    const scene = new THREE.Group();
    scene.add(rootOf(inside), outside, overlay);
    apply(scene.children[0]!);
    expect(inside.castShadow).toBe(true);
    expect([outside.castShadow, outside.receiveShadow, overlay.castShadow, overlay.receiveShadow]).toEqual([false, false, false, false]);
  });

  it("does nothing on the low tier or in scene lighting", () => {
    for (const [quality, lighting] of [["low", "default"], ["high", "scene"], ["low", "scene"]] as const) {
      const m = box();
      m.receiveShadow = true;
      const r = apply(rootOf(m), quality, lighting);
      expect([m.castShadow, m.receiveShadow]).toEqual([false, true]);
      expect(r.casters + r.receivers).toBe(0);
      expect(r.bounds.isEmpty()).toBe(true);
    }
  });

  it("reports the world box of the drawn meshes only, including parent transforms", () => {
    const wall = box(undefined, [0, 2, 0]);
    const far = new THREE.Mesh(new THREE.BoxGeometry(1000, 1000, 1000), new THREE.MeshStandardMaterial());
    far.visible = false;
    const group = new THREE.Group();
    group.position.set(10, 5, -4);
    group.add(wall);
    const r = apply(rootOf(group, far));
    expect(r.bounds.min.toArray()).toEqual([9.5, 6.5, -4.5]);
    expect(r.bounds.max.toArray()).toEqual([10.5, 7.5, -3.5]);
  });

  it("includes instanced meshes", () => {
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial(), 2);
    inst.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, 0));
    inst.setMatrixAt(1, new THREE.Matrix4().makeTranslation(8, 0, 0));
    const r = apply(rootOf(inst));
    expect(inst.castShadow).toBe(true);
    expect(r.bounds.max.x).toBeCloseTo(8.5);
  });
});

describe("fit helpers", () => {
  it("pads the Y range", () => {
    expect(shadowYRange(new THREE.Box3(new THREE.Vector3(0, -3, 0), new THREE.Vector3(1, 9, 1)))).toEqual([-3 - SHADOW_Y_PAD_M, 9 + SHADOW_Y_PAD_M]);
  });

  it("covers the station footprint and height from above, within the cap and above the walking extent", () => {
    const b = (x: number, y: number, z: number) => new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(x, y, z));
    expect(overviewHalfExtent(b(100, 10, 100))).toBeGreaterThanOrEqual(0.5 * Math.hypot(100, 100));
    expect(overviewHalfExtent(b(4, 3, 4))).toBe(SHADOW_HALF_EXTENT_M);
    expect(overviewHalfExtent(b(5000, 10, 5000))).toBe(SHADOW_OVERVIEW_MAX_HALF_M);
  });
});
