// The ambient crowd keeps its route logic and draw budget while being drawn as articulated commuters.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { LOW_QUALITY_MAX_COUNT, buildCrowd } from "./crowd.ts";

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

  it("keeps the high-quality parts exactly as they were", () => {
    const c = make(150);
    const expected: Record<string, number> = {
      torso: 336, shirt: 136, skirt: 108, head: 436, hair_short: 180, hair_long: 276, hair_tail: 252, upper_arm: 96, forearm: 96, hand: 84,
      thigh: 108, shin: 96, shoe: 176, backpack: 272, shoulder_bag: 184,
    };
    for (const [n, t] of Object.entries(expected)) expect(tris(named(c, n))).toBe(t);
    let all = 0;
    for (const m of meshes(c)) all += tris(m) * m.count;
    expect(all).toBe(388008);
    c.dispose();
  });

  it("holds the low-quality crowd (56 people) to 60k triangles in at most 15 draws", () => {
    expect(LOW_QUALITY_MAX_COUNT).toBeGreaterThanOrEqual(56);
    expect(LOW_QUALITY_MAX_COUNT).toBeLessThan(150);
    const count = 56;
    const c = make(count);
    const high = make(150);
    expect(meshes(c).length).toBeLessThanOrEqual(15);
    let all = 0, allHigh = 0;
    for (const m of meshes(c)) all += tris(m) * m.count;
    for (const m of meshes(high)) allHigh += tris(m) * m.count;
    expect(all).toBeLessThanOrEqual(60_000); // triangles per person x count
    expect(all / count).toBeLessThanOrEqual(60_000 / count);
    expect(all / count).toBeLessThan((allHigh / 150) * 0.5); // coarser than high quality in every part that matters
    // every part is no richer than its high-quality twin
    for (const m of meshes(c)) expect(tris(m)).toBeLessThanOrEqual(tris(named(high, m.name.replace("crowd_", ""))));
    c.dispose();
    high.dispose();
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

  /** Every vertex of the rigid shoe (upper and sole), transformed by its instance matrix, over 6 s = several gait cycles. */
  function soleTrack(count: number) {
    const long = [{ id: "L", from: "a", to: "b", verification: "verified", geometry: [{ x: 0, y: 0, z: 0 }, { x: 4000, y: 0, z: 0 }] }];
    const c = buildCrowd(THREE, long, toRenderer, count, new THREE.Texture(), {});
    const shoe = named(c, "shoe");
    const pos = shoe.geometry.getAttribute("position");
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    const dt = 1 / 120;
    const lowest: number[][] = [[], []];
    let nSole = 0;
    for (let v = 0; v < pos.count; v++) if (pos.getY(v) < -0.045) nSole++;
    for (let k = 0; k < 120 * 6; k++) {
      c.update(dt, k * dt);
      for (let side = 0; side < 2; side++) {
        shoe.getMatrixAt(side, m);
        let lo = Infinity;
        for (let v = 0; v < pos.count; v++) lo = Math.min(lo, p.fromBufferAttribute(pos, v).applyMatrix4(m).y);
        lowest[side]!.push(lo);
      }
    }
    c.dispose();
    return { lowest, nSole, tris: tris(shoe) };
  }

  for (const [label, count] of [["low", 56], ["high", 150]] as const) {
    it(`keeps every sole vertex above the floor through the whole gait cycle (${label} quality)`, () => {
      const { lowest, nSole, tris: t } = soleTrack(count);
      expect(nSole).toBeGreaterThan(10);
      expect(t).toBe(label === "low" ? 84 : 176);
      for (const side of [0, 1]) {
        const lo = lowest[side]!;
        expect(Math.min(...lo)).toBeGreaterThanOrEqual(-0.002); // floor is y = 0
        // and the stance foot really stands on it (no hovering): most of the stance 60 % has a vertex within 2 mm of the floor
        expect(lo.filter((y) => Math.abs(y) <= 0.002).length / lo.length).toBeGreaterThan(0.45);
        expect(Math.max(...lo)).toBeLessThan(0.25);
      }
    });
  }
});

describe("ikebukuro crowd near-camera hiding", () => {
  const TAU = Math.PI * 2;
  const LONG = [{ id: "L", from: "a", to: "b", verification: "verified", geometry: [{ x: 0, y: 0, z: 0 }, { x: 4000, y: 0, z: 0 }] }];
  const EYE = 1.6, NEAR = 1.2;
  /** The single walker's start, replayed from the crowd's seeded stream (position along the edge, direction, speed, bob phase). */
  function firstWalker() {
    let st = 7 >>> 0;
    const r = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 4294967296);
    const s = r() * 4000, forward = r() < 0.5, speed = 1.15 + r() * 0.5;
    r(); // lane offset
    return { s, forward, speed, phase: r() * 6.28 };
  }
  // The earlier build's rule: the walker is lifted by |cos(phase)| * 2.5 cm (one phase cycle per 1.45 m) before the camera checks.
  const legacyBob = (phase: number) => Math.abs(Math.cos(phase)) * 0.025;
  const legacyHidden = (h: number, bob: number) => h * h + (bob + 1.1 - EYE) ** 2 < NEAR * NEAR;

  const camera = new THREE.PerspectiveCamera(70, 1.5, 0.05, 200);
  /** Put the camera EYE m high, h m (horizontally) beside the point x on the edge, and let the crowd see it as a rendered frame. */
  function renderFrom(c: ReturnType<typeof make>, x: number, h: number) {
    camera.position.set(x, EYE, h);
    camera.lookAt(x, 1.0, 0);
    camera.updateMatrixWorld(true);
    named(c, "torso").onBeforeRender(null as never, null as never, camera, null as never, null as never, null as never);
  }
  const hidden = (c: ReturnType<typeof make>) => {
    const m = new THREE.Matrix4();
    named(c, "torso").getMatrixAt(0, m);
    return m.determinant() === 0;
  };

  it("hides the walker at exactly the legacy distances (1.0947 m at camera height 1.6 m, bob 0.02381 m)", () => {
    const w = firstWalker();
    const c = buildCrowd(THREE, LONG, toRenderer, 1, new THREE.Texture(), {});
    // find the single step dt after which the legacy bob is 0.02381 m
    const f = (dt: number) => legacyBob(w.phase + (w.speed * dt * TAU) / 1.45) - 0.02381;
    let lo = 0, hi = 0;
    for (let dt = 1e-3; dt < 2; dt += 1e-3) if (f(dt) * f(dt + 1e-3) <= 0) { lo = dt; hi = dt + 1e-3; break; }
    expect(hi).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
    const dt = (lo + hi) / 2, bob = legacyBob(w.phase + (w.speed * dt * TAU) / 1.45);
    expect(bob).toBeCloseTo(0.02381, 5);
    const h = 1.0947;
    expect(legacyHidden(h, bob)).toBe(true); // origin/main hides this walker ...
    expect(h * h + (1.1 - EYE) ** 2).toBeGreaterThan(NEAR * NEAR); // ... which a flat pose would not
    renderFrom(c, w.s + (w.forward ? 1 : -1) * w.speed * dt, h);
    c.update(dt, dt);
    expect(hidden(c)).toBe(true);
    c.dispose();
  });

  it("makes the same near-camera hide / show decision as the legacy bob formula over many frames", () => {
    const w = firstWalker();
    const c = buildCrowd(THREE, LONG, toRenderer, 1, new THREE.Texture(), {});
    const dt = 1 / 60, flat = Math.sqrt(NEAR * NEAR - (1.1 - EYE) ** 2);
    let s = w.s, phase = w.phase, windows = 0, shown = 0;
    for (let k = 0; k < 900; k++) {
      s += (w.forward ? 1 : -1) * w.speed * dt;
      phase += (w.speed * dt * TAU) / 1.45;
      const bob = legacyBob(phase);
      const edge = Math.sqrt(NEAR * NEAR - (bob + 1.1 - EYE) ** 2); // legacy hides inside this horizontal distance
      let h: number;
      if (k % 2 === 0) {
        if (edge - flat < 1e-3) { renderFrom(c, s, flat + 0.2); c.update(dt, k * dt); continue; }
        h = (edge + flat) / 2; // inside the legacy radius, outside the radius of a flat walker
      } else h = edge + 0.02;
      renderFrom(c, s, h);
      c.update(dt, k * dt);
      expect(hidden(c)).toBe(legacyHidden(h, bob));
      if (legacyHidden(h, bob)) windows++; else shown++;
    }
    expect(windows).toBeGreaterThan(100);
    expect(shown).toBeGreaterThan(100);
    c.dispose();
  });
});
