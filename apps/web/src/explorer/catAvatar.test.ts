import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createAvatar } from "./avatar.ts";
import { avatarKind } from "./avatarSelection.ts";
import { createCatAvatar, type CatStyle } from "./catAvatar.ts";
import { FOLLOW_CAT, followPose } from "./followCamera.ts";
import { fadeUniform } from "./avatarGlb.fixture.ts";

const HEAD_TOP: Record<CatStyle, number> = { A: 0.3, B: 0.34, C: 0.34 };
const STYLES: readonly CatStyle[] = ["A", "B", "C"];
const QUALITIES = ["low", "high"] as const;
const CASES = STYLES.flatMap((style) => QUALITIES.map((quality) => [style, quality] as const));

function skinned(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const out: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) out.push(o);
  });
  return out;
}

function triangles(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const g = o.geometry as THREE.BufferGeometry;
    count += (g.index ? g.index.count : g.getAttribute("position").count) / 3;
  });
  return count;
}

function finite(root: THREE.Object3D): boolean {
  let ok = true;
  root.traverse((o) => {
    for (const v of [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()]) if (!Number.isFinite(v)) ok = false;
  });
  return ok;
}

describe("cat avatar", () => {
  it.each(CASES)("style %s (%s) is one skinned draw within the human triangle budget", (style, quality) => {
    const rig = createCatAvatar({ quality, style });
    const meshes = skinned(rig.root);
    expect(meshes).toHaveLength(1);
    const mesh = meshes[0]!;
    expect(Array.isArray(mesh.material)).toBe(false);
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(material.isMeshStandardMaterial).toBe(true);
    expect(material.vertexColors).toBe(true);
    expect(mesh.castShadow).toBe(true);
    // Drawn after the route's always-on-top overlays (the amber no-model band renders at 21) but still writing
    // depth, so a cat standing inside one is visible and real geometry still occludes it.
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(true);
    expect(mesh.renderOrder).toBeGreaterThan(21);

    const human = createAvatar({ quality });
    expect(triangles(rig.root)).toBeLessThanOrEqual(triangles(human.root));

    const box = new THREE.Box3().setFromObject(rig.root);
    expect(Math.abs(box.max.y - HEAD_TOP[style])).toBeLessThanOrEqual(0.03);
    expect(box.min.y).toBeGreaterThan(-0.02);
    expect(box.min.y).toBeLessThan(0.02);
    rig.dispose();
    human.dispose();
  });

  it("keeps bone transforms finite at idle, walk, trot, run and after sitting", () => {
    for (const quality of QUALITIES) {
      const rig = createCatAvatar({ quality, style: "C" });
      for (const speed of [0, 0.6, 1.6, 3.2]) {
        for (let i = 0; i < 60; i++) {
          rig.update(1 / 60, speed);
          if (i % 10 === 0) expect(finite(rig.root)).toBe(true);
        }
      }
      // More than 4 s idle: the cat sits.
      for (let i = 0; i < 360; i++) rig.update(1 / 60, 0);
      expect(finite(rig.root)).toBe(true);
      rig.dispose();
    }
  });

  it("paints tabby stripes on style C only", () => {
    // Mean vertex brightness: the stripes darken a share of the coat, which no other style does.
    const brightness = (style: CatStyle): number => {
      const rig = createCatAvatar({ quality: "high", style });
      const mesh = skinned(rig.root)[0]!;
      const color = mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
      let sum = 0;
      for (let i = 0; i < color.count; i++) sum += color.getX(i) + color.getY(i) + color.getZ(i);
      rig.dispose();
      return sum / color.count;
    };
    const plain = brightness("B");
    expect(brightness("C")).toBeLessThan(plain * 0.99);
    expect(Math.abs(brightness("A") - plain)).toBeLessThan(plain * 0.02);
  });

  it("looks around and flicks its ears while idle, within the 35 degree head yaw", () => {
    const rig = createCatAvatar({ quality: "low", style: "B" });
    const head = rig.root.getObjectByName("head")!;
    const earL = rig.root.getObjectByName("earL")!;
    const earR = rig.root.getObjectByName("earR")!;
    expect(head).toBeDefined();
    let lo = Infinity;
    let hi = -Infinity;
    let earMoved = false;
    for (let i = 0; i < 60 * 30; i++) {
      rig.update(1 / 60, 0);
      lo = Math.min(lo, head.rotation.y);
      hi = Math.max(hi, head.rotation.y);
      if (Math.abs(earL.rotation.z) > 0.01 || Math.abs(earR.rotation.z) > 0.01) earMoved = true;
    }
    expect(hi).toBeLessThanOrEqual(0.65);
    expect(lo).toBeGreaterThanOrEqual(-0.65);
    expect(hi - lo).toBeGreaterThan(0.1);
    expect(earMoved).toBe(true);
    rig.dispose();
  });

  it("fades through the shared dither uniform and frees its geometry on dispose", () => {
    const rig = createCatAvatar({ quality: "high", style: "B" });
    const mesh = skinned(rig.root)[0]!;
    rig.setFade(0.5);
    expect(fadeUniform(mesh.material as THREE.Material).value).toBe(0.5);
    const dispose = vi.spyOn(mesh.geometry, "dispose");
    rig.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe("avatarKind", () => {
  const parse = (query: string) => avatarKind(new URLSearchParams(query));

  it("selects the cat only with ?avatar=cat and defaults to style B", () => {
    expect(parse("avatar=cat")).toEqual({ kind: "cat", catStyle: "B" });
    expect(parse("avatar=cat&catStyle=C")).toEqual({ kind: "cat", catStyle: "C" });
    expect(parse("avatar=cat&catStyle=Z")).toEqual({ kind: "cat", catStyle: "B" });
  });

  it.each(["", "avatar=procedural", "avatar=soft", "avatar=glb", "avatar=cat2", "catStyle=A"])("keeps the human avatar for %s", (query) => {
    expect(parse(query)).toEqual({ kind: "human" });
  });
});

describe("cat follow camera", () => {
  it("frames a 0.6 m cat pivot at about 1.25 m camera height", () => {
    const head = new THREE.Vector3(0, FOLLOW_CAT.pivotY, 0);
    const pose = followPose(head, 0, -0.12, FOLLOW_CAT.shoulder, FOLLOW_CAT.lift, FOLLOW_CAT.drop);
    const cam = pose.pivot.clone().addScaledVector(pose.back, FOLLOW_CAT.distance);
    expect(Math.abs(cam.y - 1.25)).toBeLessThanOrEqual(0.05);
    expect(cam.z).toBeGreaterThan(1.5); // behind a cat facing -Z
  });
});
