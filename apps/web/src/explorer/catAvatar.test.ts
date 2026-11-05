import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createAvatar } from "./avatar.ts";
import { avatarKind } from "./avatarSelection.ts";
import { createCatAvatar, type CatStyle } from "./catAvatar.ts";
import { FOLLOW_CAT, followPose } from "./followCamera.ts";
import { fadeUniform } from "./avatarGlb.fixture.ts";

const HEAD_TOP: Record<CatStyle, number> = { A: 0.36, B: 0.4, C: 0.45 };
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
  it("frames a 1.0 m cat pivot at about 1.84 m camera height", () => {
    const head = new THREE.Vector3(0, FOLLOW_CAT.pivotY, 0);
    const pose = followPose(head, 0, -0.12, FOLLOW_CAT.shoulder, FOLLOW_CAT.lift, FOLLOW_CAT.drop);
    const cam = pose.pivot.clone().addScaledVector(pose.back, FOLLOW_CAT.distance);
    expect(Math.abs(cam.y - 1.84)).toBeLessThanOrEqual(0.05);
    expect(cam.z).toBeGreaterThan(2); // behind a cat facing -Z
  });
});
