// The ambient crowd keeps its route logic and draw budget while being drawn as articulated commuters.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildCrowd } from "./crowd.ts";

const edges = [
  { id: "e1", from: "a", to: "j", verification: "verified", geometry: [{ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }] },
  { id: "e2", from: "j", to: "b", verification: "verified", geometry: [{ x: 30, y: 0, z: 0 }, { x: 30, y: 25, z: 0 }, { x: 55, y: 25, z: 1.5 }] },
  { id: "e3", from: "j", to: "c", verification: "verified", geometry: [{ x: 30, y: 0, z: 0 }, { x: 60, y: -10, z: 0 }] },
  { id: "e4", from: "x", to: "y", verification: "candidate", geometry: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }] },
];
const lanes = { e1: { stepM: 2, left: Array(15).fill(1.2), right: Array(15).fill(0.9) }, e3: { stepM: 2, left: Array(16).fill(0.8), right: Array(16).fill(1.1) } };
const toRenderer = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);
const make = (count: number, es = edges) => buildCrowd(THREE, es, toRenderer, count, new THREE.Texture(), lanes);

/** Torso positions (x, z) of a 14-person crowd from the build before the look upgrade, after 0, 1500 and 3000 steps of 1/60 s. */
const LEGACY_TORSO_XZ: number[][] = [[26.6641,-0.0074,44.9118,4.3382,57.0351,9.2916,36.3194,2.4424,30,-10.4755,30,-9.9897,30,-20.9566,9.4406,0.4687,30,-9.3895,17.6655,0.3869,30,-24.1098,30.0269,-25,52.1941,-25,47.65,5.6721],[0,0,0,0,24.1982,0.2656,2.7966,0.3186,45.3472,-25,0,0,0,0,0,0,49.5102,-25,0,0,0,0,0,0,30,-16.6755,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,43.2467,4.132,0,0]];

const meshes = (c: ReturnType<typeof make>) => c.group.children as THREE.InstancedMesh[];
const named = (c: ReturnType<typeof make>, n: string) => meshes(c).find((m) => m.name === `crowd_${n}`)!;
const tris = (m: THREE.InstancedMesh) => m.geometry.index!.count / 3;

describe("ikebukuro crowd", () => {
  it("keeps the return shape and one instanced mesh per part within the draw budget", () => {
    const c = make(40);
    expect(Object.keys(c).sort()).toEqual(["dispose", "group", "nearby", "update"]);
    expect(c.group.name).toBe("ikebukuro_crowd");
    expect(c.nearby()).toBe(0);
    const ms = meshes(c);
    expect(ms.length).toBeLessThanOrEqual(16);
    for (const m of ms) {
      expect(m).toBeInstanceOf(THREE.InstancedMesh);
      expect(m.userData.gteki_role).toBe("ambient_crowd");
      expect(m.instanceColor).toBeTruthy();
      expect(m.geometry.getAttribute("color")).toBeTruthy(); // baked ambient occlusion
    }
    c.dispose();
  });

  it("stays at ~3k triangles for the heaviest person (every optional part on) and well under on average", () => {
    const c = make(300);
    const always = ["torso", "head", "upper_arm", "forearm", "hand", "thigh", "shin", "shoe"];
    const pairs = new Set(["upper_arm", "forearm", "hand", "thigh", "shin", "shoe"]);
    let base = 0;
    for (const n of always) base += tris(named(c, n)) * (pairs.has(n) ? 2 : 1);
    const heaviest = (names: string[]) => Math.max(...names.map((n) => tris(named(c, n))));
    const worst = base + tris(named(c, "shirt")) + tris(named(c, "skirt")) * 2 + heaviest(["hair_short", "hair_long", "hair_tail"]) + heaviest(["backpack", "shoulder_bag"]);
    expect(worst).toBeLessThanOrEqual(3100);
    // the real crowd: only the parts people actually wear count
    let all = 0;
    for (const m of meshes(c)) all += tris(m) * m.count;
    expect(all / 300).toBeLessThan(2900);
    expect(all / 300).toBeGreaterThan(1800);
    c.dispose();
  });

  it("gives people varied hair, outerwear and heights", () => {
    const c = make(300);
    for (const n of ["hair_short", "hair_long", "hair_tail", "shirt", "skirt", "backpack", "shoulder_bag"]) {
      expect(named(c, n).count).toBeGreaterThan(5);
      expect(named(c, n).count).toBeLessThan(300);
    }
    expect(named(c, "hair_short").count + named(c, "hair_long").count + named(c, "hair_tail").count).toBe(300);
    const m = new THREE.Matrix4(), sc = new THREE.Vector3(), tmp = new THREE.Vector3(), qq = new THREE.Quaternion();
    const hs: number[] = [];
    const torso = named(c, "torso");
    for (let i = 0; i < 300; i++) { torso.getMatrixAt(i, m); m.decompose(tmp, qq, sc); hs.push(sc.y); }
    expect(Math.min(...hs)).toBeGreaterThanOrEqual(0.92 - 0.015); // (a leaning chest shears the decomposed scale a little)
    expect(Math.max(...hs)).toBeLessThanOrEqual(1.06 + 0.015);
    expect(Math.max(...hs) - Math.min(...hs)).toBeGreaterThan(0.08);
    const colors = new Set<number>();
    const col = new THREE.Color();
    for (let i = 0; i < 300; i++) { torso.getColorAt(i, col); colors.add(col.getHex()); }
    expect(colors.size).toBeGreaterThan(40);
    c.dispose();
  });

  it("walks exactly where it walked before (route, lanes and relocation logic untouched)", () => {
    const c = make(14);
    const torso = named(c, "torso");
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    const at = [0, 1500, 3000];
    let k = 0;
    for (const want of at) {
      while (k < want) { k++; c.update(1 / 60, k / 60); }
      const exp = LEGACY_TORSO_XZ[at.indexOf(want)]!;
      for (let i = 0; i < 14; i++) {
        torso.getMatrixAt(i, m);
        v.setFromMatrixPosition(m);
        expect(Math.abs(v.x - exp[2 * i]!)).toBeLessThan(0.06);
        expect(Math.abs(v.z - exp[2 * i + 1]!)).toBeLessThan(0.06);
      }
    }
    c.dispose();
  });

  it("keeps every instance matrix finite", () => {
    const c = make(60);
    for (let k = 0; k < 400; k++) c.update(1 / 30, k / 30);
    const m = new THREE.Matrix4();
    for (const mesh of meshes(c)) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        expect(m.elements.every(Number.isFinite)).toBe(true);
      }
    }
    c.dispose();
  });
});

describe("ikebukuro crowd gait", () => {
  /** One walker on a long straight edge, stepped at 120 Hz; tracks heel / ball / toe of each shoe and the knee angle. */
  function runOne() {
    const long = [{ id: "L", from: "a", to: "b", verification: "verified", geometry: [{ x: 0, y: 0, z: 0 }, { x: 4000, y: 0, z: 0 }] }];
    const c = buildCrowd(THREE, long, toRenderer, 1, new THREE.Texture(), {});
    const shoe = named(c, "shoe"), shin = named(c, "shin"), thigh = named(c, "thigh");
    const landmarks = [[0, -0.072, -0.07], [0, -0.072, 0.105], [0, -0.05, 0.172]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const m = new THREE.Matrix4(), a = new THREE.Matrix4(), b = new THREE.Matrix4(), p = new THREE.Vector3();
    const down = new THREE.Vector3(0, -1, 0);
    const dt = 1 / 120;
    // contacts[side][landmark] = world positions over time
    const contacts = [0, 1].map(() => landmarks.map(() => [] as THREE.Vector3[]));
    const knee: number[][] = [[], []];
    for (let k = 0; k < 120 * 12; k++) {
      c.update(dt, k * dt);
      for (let side = 0; side < 2; side++) {
        shoe.getMatrixAt(side, m);
        landmarks.forEach((l, li) => contacts[side]![li]!.push(p.copy(l).applyMatrix4(m).clone()));
        thigh.getMatrixAt(side, a);
        shin.getMatrixAt(side, b);
        knee[side]!.push(down.clone().transformDirection(a).angleTo(down.clone().transformDirection(b)));
      }
    }
    c.dispose();
    return { contacts, knee, dt };
  }

  it("plants the stance foot: a sole point on the floor does not move against it at walking speed", () => {
    const { contacts, dt } = runOne();
    for (const side of [0, 1]) {
      let planted = 0, slid = 0, speedSum = 0;
      for (const track of contacts[side]!) {
        for (let k = 1; k < track.length; k++) {
          const u = track[k - 1]!, w = track[k]!;
          if (u.y < 0.003 && w.y < 0.003) {
            const v = Math.hypot(w.x - u.x, w.z - u.z) / dt;
            planted++;
            speedSum += v;
            if (v > 0.3) slid++;
          }
        }
      }
      expect(planted).toBeGreaterThan(400);
      expect(speedSum / planted).toBeLessThan(0.08); // body speed is 1.15-1.65 m/s
      expect(slid / planted).toBeLessThan(0.03);
    }
  });

  it("bends the knee in the swing and straightens it in the stance", () => {
    const { knee } = runOne();
    for (const side of [0, 1]) {
      expect(Math.max(...knee[side]!)).toBeGreaterThan(0.7);
      expect(Math.min(...knee[side]!)).toBeLessThan(0.25);
    }
  });

  it("never pushes a foot through the floor or leaves it high", () => {
    const { contacts } = runOne();
    for (const side of [0, 1]) {
      const ys = contacts[side]!.flatMap((t) => t.map((v) => v.y));
      expect(Math.min(...ys)).toBeGreaterThan(-0.012);
      expect(Math.max(...ys)).toBeLessThan(0.25);
    }
  });
});
