import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createAvatar, type AvatarRig } from "./avatar.ts";

function stats(root: THREE.Object3D): { tris: number; meshes: number; allCast: boolean } {
  let tris = 0;
  let meshes = 0;
  let allCast = true;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    meshes++;
    allCast &&= o.castShadow;
    const g = o.geometry as THREE.BufferGeometry;
    tris += (g.index ? g.index.count : g.getAttribute("position").count) / 3;
  });
  return { tris, meshes, allCast };
}

function bbox(root: THREE.Object3D, precise = false): THREE.Box3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root, precise);
}

function footMinY(rig: AvatarRig): { left: number; right: number } {
  rig.root.updateMatrixWorld(true);
  const get = (n: string): number => {
    const o = rig.root.getObjectByName(n);
    if (!o) throw new Error(`missing ${n}`);
    return bbox(o, true).min.y;
  };
  return { left: Math.min(get("shoeL"), get("soleL")), right: Math.min(get("shoeR"), get("soleR")) };
}

function finiteTransforms(root: THREE.Object3D): boolean {
  let ok = true;
  root.traverse((o) => {
    for (const v of [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()]) if (!Number.isFinite(v)) ok = false;
  });
  return ok;
}

describe("avatar", () => {
  for (const quality of ["high", "low"] as const) {
    describe(quality, () => {
      it("builds a ~1.7 m figure centred on the origin within the budget", () => {
        const rig = createAvatar({ quality });
        const box = bbox(rig.root);
        const h = box.max.y - box.min.y;
        expect(h).toBeGreaterThan(1.6);
        expect(h).toBeLessThan(1.8);
        expect(box.min.y).toBeGreaterThan(-0.02);
        expect(box.min.y).toBeLessThan(0.02);
        const c = box.getCenter(new THREE.Vector3());
        expect(Math.abs(c.x)).toBeLessThan(0.1);
        expect(Math.abs(c.z)).toBeLessThan(0.12);
        const s = stats(rig.root);
        expect(s.meshes).toBeLessThanOrEqual(24);
        expect(s.tris).toBeLessThanOrEqual(quality === "high" ? 12000 : 5000);
        expect(s.allCast).toBe(true);
        rig.dispose();
      });

      it("keeps transforms finite and the feet on the floor at idle, walk and run", () => {
        for (const speed of [0, 1.45, 3.4]) {
          const rig = createAvatar({ quality });
          let lowest = Infinity;
          for (let i = 0; i < 600; i++) {
            rig.update(1 / 60, speed);
            if (i % 10 === 0) {
              expect(finiteTransforms(rig.root)).toBe(true);
              const f = footMinY(rig);
              lowest = Math.min(lowest, f.left, f.right);
              if (speed === 1.45 && i > 120) {
                // walking: one foot is always planted
                expect(Math.min(f.left, f.right)).toBeLessThanOrEqual(0.06);
              }
            }
          }
          expect(lowest).toBeGreaterThanOrEqual(-0.03);
          const box = bbox(rig.root);
          expect(Number.isFinite(box.min.y) && Number.isFinite(box.max.y)).toBe(true);
          expect(box.max.y - box.min.y).toBeGreaterThan(1.5);
          rig.dispose();
        }
      }, 60_000);
    });
  }

  it("faces -Z (toes and face forward, pack behind)", () => {
    const rig = createAvatar();
    for (let i = 0; i < 30; i++) rig.update(1 / 60, 0);
    rig.root.updateMatrixWorld(true);
    const shoe = bbox(rig.root.getObjectByName("shoeL")!, true);
    const ankle = new THREE.Vector3().setFromMatrixPosition(rig.root.getObjectByName("footL")!.matrixWorld);
    expect(shoe.min.z).toBeLessThan(ankle.z - 0.12); // toe ahead of the ankle
    expect(shoe.max.z).toBeLessThan(ankle.z + 0.12);
    const eyes = bbox(rig.root.getObjectByName("faceDetails")!, true).getCenter(new THREE.Vector3());
    const head = new THREE.Vector3().setFromMatrixPosition(rig.root.getObjectByName("head")!.matrixWorld);
    expect(eyes.z).toBeLessThan(head.z);
    const pack = bbox(rig.root.getObjectByName("backpack")!, true).getCenter(new THREE.Vector3());
    expect(pack.z).toBeGreaterThan(0.1);
  });

  it("plants the stance foot (no sliding) while walking", () => {
    const rig = createAvatar();
    const speed = 1.45;
    const dt = 1 / 60;
    for (let i = 0; i < 300; i++) rig.update(dt, speed);
    const sole = rig.root.getObjectByName("soleL") as THREE.Mesh;
    const lowestZ = (): { y: number; z: number } => {
      rig.root.updateMatrixWorld(true);
      const pos = sole.geometry.getAttribute("position");
      const p = new THREE.Vector3();
      let best = { y: Infinity, z: 0 };
      for (let k = 0; k < pos.count; k++) {
        p.fromBufferAttribute(pos, k).applyMatrix4(sole.matrixWorld);
        if (p.y < best.y) best = { y: p.y, z: p.z };
      }
      return best;
    };
    // While the foot is on the floor it should move backwards relative to the hips at ~ the walking speed.
    let planted = 0;
    let ok = 0;
    let prev = lowestZ();
    for (let i = 0; i < 120; i++) {
      rig.update(dt, speed);
      const cur = lowestZ();
      if (cur.y < 0.01 && prev.y < 0.01) {
        planted++;
        if (Math.abs((cur.z - prev.z) / dt - speed) < 1.2) ok++; // contact point rolls heel-to-toe, so allow slack
      }
      prev = cur;
    }
    expect(planted).toBeGreaterThan(30);
    expect(ok / planted).toBeGreaterThan(0.75);
  });

  it("blends continuously: no pose pops when the speed changes abruptly", () => {
    const rig = createAvatar();
    const names = ["hips", "chest", "head", "thighL", "shinL", "footL", "upperArmR", "forearmR"];
    const snap = (): THREE.Quaternion[] => names.map((n) => rig.root.getObjectByName(n)!.quaternion.clone());
    for (let i = 0; i < 120; i++) rig.update(1 / 60, 0);
    let prev = snap();
    let worst = 0;
    for (let i = 0; i < 240; i++) {
      rig.update(1 / 60, i < 60 ? 1.45 : i < 140 ? 3.4 : 0);
      const cur = snap();
      for (let k = 0; k < cur.length; k++) worst = Math.max(worst, cur[k]!.angleTo(prev[k]!));
      prev = cur;
    }
    expect(worst).toBeLessThan(1.0); // rad per 1/60 s frame (fast knee extension is ~0.5; a stance/swing flip would be >= pi/2)
  });

  it("applies and clears an environment map on every material, and disposes", () => {
    const rig = createAvatar({ quality: "low" });
    const tex = new THREE.Texture();
    rig.setEnvMap(tex, 0.7);
    const mats = new Set<THREE.MeshStandardMaterial>();
    rig.root.traverse((o) => {
      if (o instanceof THREE.Mesh) mats.add(o.material as THREE.MeshStandardMaterial);
    });
    expect(mats.size).toBeGreaterThan(5);
    for (const m of mats) {
      expect(m).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(m.envMap).toBe(tex);
      expect(m.envMapIntensity).toBeCloseTo(0.7);
      expect(m.emissive.getHex()).toBe(0);
    }
    rig.setEnvMap(null);
    for (const m of mats) expect(m.envMap).toBeNull();
    expect(() => rig.dispose()).not.toThrow();
    expect(() => rig.update(1 / 60, 1)).not.toThrow();
  });
});
