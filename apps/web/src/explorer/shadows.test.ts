import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CAST_HEADROOM_M, SHADOW_HALF_EXTENT_M, SHADOW_MAP_SIZE, SHADOW_NORMAL_BIAS, SHADOW_RADIUS, SHADOW_Y_PAD_M, TALL_CANDIDATE_SPAN_M, applyStationShadows, meshShadowFlags, setCasters, shadowYRange, shadowsActive } from "./shadows.ts";

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

describe("gteki_shadow opt-out", () => {
  it("drops a marked mesh and its whole subtree from the casters and candidates", () => {
    const solo = box(), group = new THREE.Group(), under = box(), deep = box(undefined, [2, 0, 0]), keep = box(undefined, [5, 0, 0]);
    solo.userData.gteki_shadow = "none";
    group.userData.gteki_shadow = "none";
    const mid = new THREE.Group();
    mid.add(deep);
    group.add(under, mid);
    solo.castShadow = true; // a station-set flag is cleared too
    const r = apply(rootOf(solo, group, keep));
    expect([solo.castShadow, under.castShadow, deep.castShadow, keep.castShadow]).toEqual([false, false, false, true]);
    expect(r.casters).toBe(1);
    expect(r.candidates.map((c) => c.mesh)).toEqual([keep]);
  });

  it("works for a glTF extra (userData) and leaves receiving on its usual rule", () => {
    const m = box();
    m.userData = { gteki_shadow: "none", other: 1 };
    const r = apply(rootOf(m));
    expect([m.castShadow, m.receiveShadow]).toEqual([false, true]);
    expect(r).toMatchObject({ casters: 0, receivers: 1 });
  });

  it("ignores other values", () => {
    const m = box();
    m.userData.gteki_shadow = "cast";
    expect(apply(rootOf(m)).casters).toBe(1);
  });
});

describe("tallCandidates", () => {
  it("counts casters whose box spans more than 6 m and records maxY", () => {
    const tall = new THREE.Mesh(new THREE.BoxGeometry(1, 6.5, 1), new THREE.MeshStandardMaterial());
    const exact = new THREE.Mesh(new THREE.BoxGeometry(1, TALL_CANDIDATE_SPAN_M, 1), new THREE.MeshStandardMaterial());
    const hiddenTall = new THREE.Mesh(new THREE.BoxGeometry(1, 20, 1), new THREE.MeshStandardMaterial());
    const optedOut = new THREE.Mesh(new THREE.BoxGeometry(1, 20, 1), new THREE.MeshStandardMaterial());
    hiddenTall.visible = false;
    optedOut.userData.gteki_shadow = "none";
    const r = apply(rootOf(tall, exact, box(), hiddenTall, optedOut));
    expect(TALL_CANDIDATE_SPAN_M).toBe(6);
    expect(r.tallCandidates).toBe(1);
    expect(r.candidates.map((c) => +c.maxY.toFixed(2))).toEqual([3.25, 3, 0.5]);
  });

  it("is 0 when shadows are inactive", () => {
    expect(apply(rootOf(new THREE.Mesh(new THREE.BoxGeometry(1, 20, 1), new THREE.MeshStandardMaterial())), "low").tallCandidates).toBe(0);
  });
});

describe("fit helpers", () => {
  it("pads the Y range", () => {
    expect(shadowYRange(new THREE.Box3(new THREE.Vector3(0, -3, 0), new THREE.Vector3(1, 9, 1)))).toEqual([-3 - SHADOW_Y_PAD_M, 9 + SHADOW_Y_PAD_M]);
  });
});

describe("setCasters (only geometry starting below the walker's head casts)", () => {
  /** A level: floor slab, a prop on it, a ceiling 3 m up (a thin double-sided plane), and the next level's slab above. */
  const level = () => {
    const prop = box(undefined, [0, 0.5, 0]);                                  // y 0 … 1
    const gate = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()); // y -1 … 1
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
    ceiling.position.y = 3;
    const slabUp = new THREE.Mesh(new THREE.BoxGeometry(40, 0.4, 40), new THREE.MeshStandardMaterial());
    slabUp.position.y = 6.3;                                                   // y 6.1 … 6.5
    const upperProp = box(undefined, [0, 6.8, 0]);                             // the level above: y 6.3 … 7.3
    const r = apply(rootOf(prop, gate, ceiling, slabUp, upperProp));
    return { prop, gate, ceiling, slabUp, upperProp, r };
  };

  it("keeps every policy-accepted mesh as a candidate with its world-box min Y", () => {
    const { r } = level();
    expect(r.candidates.map((c) => +c.minY.toFixed(2))).toEqual([0, -1, 3, 6.1, 6.3]);
  });

  it("lets a prop on the floor cast and not the ceiling 3 m above or the slab one level up", () => {
    const { prop, gate, ceiling, slabUp, upperProp, r } = level();
    expect(setCasters(r.candidates, 0)).toBe(2);
    expect([prop.castShadow, gate.castShadow, ceiling.castShadow, slabUp.castShadow, upperProp.castShadow]).toEqual([true, true, false, false, false]);
  });

  it("uses the headroom as the cut: 2.2 m by default", () => {
    const { ceiling, r } = level();
    expect(CAST_HEADROOM_M).toBe(2.2);
    setCasters(r.candidates, 0.9); // limit 3.1 > ceiling minY 3
    expect(ceiling.castShadow).toBe(true);
    setCasters(r.candidates, 0.7); // limit 2.9
    expect(ceiling.castShadow).toBe(false);
    expect(setCasters(r.candidates, 0, 10)).toBe(5);
  });

  it("flips with the walker's level: upstairs the lower level's ceiling and props cast (out of view), the upper level casts onto its own floor", () => {
    const { prop, ceiling, slabUp, upperProp, r } = level();
    setCasters(r.candidates, 6.3); // limit 8.5: everything starts below it
    expect([prop.castShadow, ceiling.castShadow, slabUp.castShadow, upperProp.castShadow]).toEqual([true, true, true, true]);
    setCasters(r.candidates, 0);
    expect([ceiling.castShadow, slabUp.castShadow, upperProp.castShadow]).toEqual([false, false, false]);
  });

  it("never touches receiveShadow or a mesh outside the candidates", () => {
    const { prop, r } = level();
    const other = box();
    other.castShadow = true;
    setCasters(r.candidates, 100);
    expect(prop.receiveShadow).toBe(true);
    expect(other.castShadow).toBe(true);
  });
});
