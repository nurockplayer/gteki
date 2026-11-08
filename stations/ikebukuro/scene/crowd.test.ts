// The ambient crowd keeps its route logic and draw budget while being drawn as articulated commuters.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GATE_HOLD_S, LOW_QUALITY_MAX_COUNT, QUEUE_GAP_M, QUEUE_STOP_M, buildCrowd, transformLowCrowdVertex, type Lane } from "./crowd.ts";
import crowdLanes from "./crowd_lanes.json";
import graph from "../gteki/graph.json";
import station from "../gteki/station.json";

const edges = [
  { id: "e1", from: "a", to: "j", verification: "verified", geometry: [{ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }] },
  { id: "e2", from: "j", to: "b", verification: "verified", geometry: [{ x: 30, y: 0, z: 0 }, { x: 30, y: 25, z: 0 }, { x: 55, y: 25, z: 1.5 }] },
  { id: "e3", from: "j", to: "c", verification: "verified", geometry: [{ x: 30, y: 0, z: 0 }, { x: 60, y: -10, z: 0 }] },
  { id: "e4", from: "x", to: "y", verification: "candidate", geometry: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }] },
];
const lanes = { e1: { stepM: 2, left: Array(15).fill(1.2), right: Array(15).fill(0.9) }, e3: { stepM: 2, left: Array(16).fill(0.8), right: Array(16).fill(1.1) } };
const toRenderer = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);
const make = (count: number, es = edges, band?: "morning" | "midday" | "evening") => buildCrowd(THREE, es, toRenderer, count, new THREE.Texture(), lanes, band);

const meshes = (c: ReturnType<typeof make>) => c.group.children as THREE.InstancedMesh[];
const named = (c: ReturnType<typeof make>, n: string) => meshes(c).find((m) => m.name === `crowd_${n}` || (n === "torso" && m.name === "crowd_low"))!;
const tris = (m: THREE.InstancedMesh) => m.geometry.index!.count / 3;

describe("ikebukuro crowd", () => {
  it("scales head-count by time band while preserving the unbanded and morning counts", () => {
    const maxCount = 100;
    for (const [band, expected] of [[undefined, 100], ["morning", 100], ["midday", 60], ["evening", 40]] as const) {
      const c = make(maxCount, edges, band);
      const count = named(c, "torso").count;
      expect(count).toBe(expected);
      c.dispose();
    }
    const rounded = make(7, edges, "midday");
    expect(named(rounded, "torso").count).toBe(4);
    rounded.dispose();
  });

  it("keeps high-quality geometry when a high-tier crowd is thinned by its band", () => {
    const c = make(150, edges, "evening");
    expect(meshes(c)).toHaveLength(15);
    expect(tris(named(c, "torso"))).toBe(336);
    expect(named(c, "torso").count).toBe(60);
    c.dispose();
  });
  it("keeps the return shape and merged phone mesh within the draw budget", () => {
    const c = make(40);
    expect(Object.keys(c).sort()).toEqual(["dispose", "group", "nearby", "queued", "setCameraNearFade", "update"]);
    expect(c.group.name).toBe("ikebukuro_crowd");
    expect(c.nearby()).toBe(0);
    const ms = meshes(c);
    expect(ms.length).toBeLessThanOrEqual(2);
    for (const m of ms) {
      expect(m).toBeInstanceOf(THREE.InstancedMesh);
      expect(m.userData.gteki_role).toBe("ambient_crowd");
      expect(m.geometry.getAttribute("palette0")).toBeTruthy();
      expect(m.geometry.getAttribute("palette1")).toBeTruthy();
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
    expect(meshes(c)).toHaveLength(15);
    for (const [n, t] of Object.entries(expected)) expect(tris(named(c, n))).toBe(t);
    let all = 0;
    for (const m of meshes(c)) all += tris(m) * m.count;
    expect(all).toBe(388008);
    c.dispose();
  });

  it("draws the low-quality crowd (56 moving people) in at most two draws", () => {
    expect(LOW_QUALITY_MAX_COUNT).toBeGreaterThanOrEqual(56);
    expect(LOW_QUALITY_MAX_COUNT).toBeLessThan(150);
    const count = 56;
    const c = make(count);
    expect(meshes(c).length).toBeLessThanOrEqual(2);
    let all = 0;
    for (const m of meshes(c)) all += tris(m) * m.count;
    expect(all).toBeLessThanOrEqual(60_000);
    const mesh = meshes(c)[0]!;
    expect(mesh.count).toBe(count);
    const palette = mesh.geometry.getAttribute("palette1");
    expect(new Set(Array.from({ length: count }, (_, i) => palette.getX(i))).size).toBeGreaterThan(4); // hair
    expect(new Set(Array.from({ length: count }, (_, i) => palette.getW(i))).size).toBeGreaterThan(4); // bags
    const before = mesh.instanceMatrix.array.slice();
    const phase = mesh.geometry.getAttribute("phase");
    const phaseBefore = phase.array.slice();
    c.update(1 / 30, 1 / 30);
    expect(mesh.instanceMatrix.array).not.toEqual(before);
    expect(phase.array).not.toEqual(phaseBefore);
    expect(mesh.geometry.getAttribute("look").count).toBe(count);
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
    const c = buildCrowd(THREE, long, toRenderer, LOW_QUALITY_MAX_COUNT + 1, new THREE.Texture(), {});
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

  it("keeps GPU-transformed low-quality shoes on the floor during stance and above it during swing", () => {
    const long = [{ id: "L", from: "a", to: "b", verification: "verified", geometry: [{ x: 0, y: 0, z: 0 }, { x: 4000, y: 0, z: 0 }] }];
    const c = buildCrowd(THREE, long, toRenderer, 56, new THREE.Texture(), {});
    const mesh = named(c, "low"), pos = mesh.geometry.getAttribute("position"), parts = mesh.geometry.getAttribute("part");
    const shoes: number[][] = [[], []], support: number[] = [];
    for (let v = 0; v < pos.count; v++) {
      if (parts.getX(v) !== 6) continue;
      const side = parts.getW(v) > 0 ? 0 : 1;
      shoes[side]!.push(v);
      if (side === 0 && pos.getY(v) - 0.072 <= -0.045) support.push(pos.getZ(v), pos.getY(v) - 0.072);
    }
    const sole = new Float64Array(support), m = new THREE.Matrix4(), p = new THREE.Vector3();
    const phase = mesh.geometry.getAttribute("phase"), stride = mesh.geometry.getAttribute("stride");
    mesh.getMatrixAt(0, m);
    expect(shoes[0]!.length).toBeGreaterThan(10);
    let stance = 0, swing = 0;
    for (let k = 0; k <= 240; k++) {
      phase.setX(0, k * Math.PI * 2 / 240);
      for (let side = 0; side < 2; side++) {
        let lowest = Infinity;
        for (const v of shoes[side]!) {
          const vertex = transformLowCrowdVertex(
            [pos.getX(v), pos.getY(v), pos.getZ(v)],
            [parts.getX(v), parts.getY(v), parts.getZ(v), parts.getW(v)], phase.getX(0), sole, stride.getX(0),
          );
          lowest = Math.min(lowest, p.fromArray(vertex).applyMatrix4(m).y);
        }
        expect(lowest).toBeGreaterThanOrEqual(-0.00001);
        const lift = Math.sin(phase.getX(0)) * (side === 0 ? 1 : -1);
        if (lift <= 0) { expect(Math.abs(lowest)).toBeLessThanOrEqual(0.01); stance++; }
        if (lift > 0.9) { expect(lowest).toBeGreaterThan(0.03); swing++; }
      }
    }
    expect(stance).toBeGreaterThan(200);
    expect(swing).toBeGreaterThan(40);
    c.dispose();
  });

  it("keeps low-tier stance sole contact vertices fixed in world space for all 56 walkers", () => {
    const long = [{ id: "L", from: "a", to: "b", verification: "verified", geometry: [{ x: 0, y: 0, z: 0 }, { x: 4000, y: 0, z: 0 }] }];
    const c = buildCrowd(THREE, long, toRenderer, 56, new THREE.Texture(), {});
    const mesh = named(c, "low"), pos = mesh.geometry.getAttribute("position"), parts = mesh.geometry.getAttribute("part");
    const contact = [-1, -1], support: number[] = [];
    for (let v = 0; v < pos.count; v++) {
      if (parts.getX(v) !== 6) continue;
      const side = parts.getW(v) > 0 ? 0 : 1;
      if (contact[side] === -1 || pos.getY(v) < pos.getY(contact[side]!)) contact[side] = v;
      if (side === 0 && pos.getY(v) - 0.072 <= -0.045) support.push(pos.getZ(v), pos.getY(v) - 0.072);
    }
    const sole = new Float64Array(support), m = new THREE.Matrix4(), world = new THREE.Vector3();
    const phase = mesh.geometry.getAttribute("phase"), stride = mesh.geometry.getAttribute("stride");
    const anchors = Array.from({ length: 56 }, () => [null, null] as (THREE.Vector3 | null)[]);
    const samples = Array.from({ length: 56 }, () => [0, 0]);
    let maxDrift = 0, maxFloorError = 0, completeStances = 0;
    for (let k = 0; k < 480; k++) {
      c.update(1 / 120, k / 120);
      for (let i = 0; i < 56; i++) {
        mesh.getMatrixAt(i, m);
        for (const side of [0, 1]) {
          const p = ((phase.getX(i) + side * Math.PI) / (2 * Math.PI)) % 1;
          if (p < 0.5) {
            if (samples[i]![side]! >= 30) completeStances++;
            anchors[i]![side] = null;
            samples[i]![side] = 0;
            continue;
          }
          const v = contact[side]!;
          world.fromArray(transformLowCrowdVertex(
            [pos.getX(v), pos.getY(v), pos.getZ(v)],
            [parts.getX(v), parts.getY(v), parts.getZ(v), parts.getW(v)], phase.getX(i), sole, stride.getX(i),
          )).applyMatrix4(m);
          const anchor = anchors[i]![side] ?? (anchors[i]![side] = world.clone());
          maxDrift = Math.max(maxDrift, Math.hypot(world.x - anchor.x, world.z - anchor.z));
          maxFloorError = Math.max(maxFloorError, Math.abs(world.y));
          samples[i]![side]!++;
        }
      }
    }
    expect(completeStances).toBeGreaterThan(400);
    expect(maxDrift).toBeLessThanOrEqual(0.02);
    expect(maxFloorError).toBeLessThanOrEqual(0.01);
    console.info({ maxDrift, maxFloorError, completeStances });
    c.dispose();
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

  for (const [label, count] of [["high", 150]] as const) {
    it(`keeps every sole vertex above the floor through the whole gait cycle (${label} quality)`, () => {
      const { lowest, nSole, tris: t } = soleTrack(count);
      expect(nSole).toBeGreaterThan(10);
      expect(t).toBe(176);
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

  it("extends hiding for the cat and restores the legacy radius when disabled", () => {
    const w = firstWalker();
    const c = buildCrowd(THREE, LONG, toRenderer, 1, new THREE.Texture(), {});
    renderFrom(c, w.s, 1.2);
    c.update(0, 0);
    expect(hidden(c)).toBe(false);
    c.setCameraNearFade(1.4, 2.6);
    c.update(0, 0);
    expect(hidden(c)).toBe(true);
    renderFrom(c, w.s, 3);
    c.update(0, 0);
    expect(hidden(c)).toBe(false);
    renderFrom(c, w.s, 1.2);
    c.setCameraNearFade(0, 0);
    c.update(0, 0);
    expect(hidden(c)).toBe(false);
    c.dispose();
  });

  it("gives every high-tier part mesh one normal twin carrying the colour shader's near-fade uniform", () => {
    const c = make(150);
    const ms = meshes(c);
    expect(ms.length).toBeGreaterThan(1);
    const twins = ms.map((m) => m.userData.gteki_gtao_twin as THREE.Material | undefined);
    expect(twins[0]).toBeInstanceOf(THREE.MeshNormalMaterial);
    expect(twins.every((t) => t === twins[0])).toBe(true);
    expect(twins[0]!.allowOverride).toBe(false);
    expect(twins[0]!.blending).toBe(THREE.NoBlending);

    const compile = (material: THREE.Material) => {
      const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: "void main() {}\n#include <project_vertex>", fragmentShader: "void main() {\n#include <clipping_planes_fragment>\n}" };
      material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
      return shader;
    };
    const colour = compile(named(c, "torso").material as THREE.Material);
    const normal = compile(twins[0]!);
    expect(normal.uniforms.uNearFade).toBe(colour.uniforms.uNearFade);
    expect(normal.fragmentShader).toContain("discard");
    expect(normal.vertexShader).toContain("vCrowdView = -mvPosition.xyz;");
    c.setCameraNearFade(1.4, 2.6);
    expect((colour.uniforms.uNearFade!.value as THREE.Vector2).toArray()).toEqual([1.4, 2.6]);
    c.dispose();
  });

  it("gives the low-tier merged mesh no twin", () => {
    const c = make(40);
    expect(meshes(c)[0]!.userData.gteki_gtao_twin).toBeUndefined();
    c.dispose();
  });

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

// The access fences stand on the outline of the routable coverage areas, so a pedestrian beyond it would be
// standing where the player cannot follow. crowd.ts keeps shoulders this far inside the lane (m).
describe("ikebukuro crowd stays on the routable floor", () => {
  type XY = { x: number; y: number };
  const polys = (station.coverage.areas as { status: string; polygon?: XY[] }[]).filter((a) => a.status === "routable" && a.polygon).map((a) => a.polygon!);
  const inPoly = (x: number, y: number, poly: XY[]) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!, b = poly[j]!;
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
  const routable = (x: number, y: number) => polys.some((p) => inPoly(x, y, p));
  const lanes = (crowdLanes as { lanes: Record<string, Lane> }).lanes;
  type RealEdge = Parameters<typeof buildCrowd>[1][number];
  const edges = (graph as { edges: RealEdge[] }).edges;

  it("clamps every lane's extreme offsets (both sides, every interval, every polyline vertex) inside the routable union", () => {
    let samples = 0;
    const outside: string[] = [];
    for (const e of edges) {
      const lane = lanes[e.id];
      if (e.verification !== "verified" || !lane) continue;
      const g = e.geometry;
      let acc = 0;
      for (let i = 1; i < g.length; i++) {
        const a = g[i - 1]!, b = g[i]!, len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 1e-9) continue;
        const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len; // to the right of from->to: (uy, -ux)
        for (let t = 0; t <= len + 1e-9; t += 0.05) {
          const d = acc + Math.min(t, len);
          const k = Math.min(lane.left.length - 1, Math.floor(d / lane.stepM));
          const x = a.x + ux * Math.min(t, len), y = a.y + uy * Math.min(t, len);
          // the extremes crowd.ts allows: the lane less the 0.2 m shoulder margin, and everything between
          for (const off of [-Math.max(0, lane.left[k]! - 0.2), 0, Math.max(0, lane.right[k]! - 0.2)]) {
            samples++;
            if (!routable(x + uy * off, y - ux * off)) outside.push(`${e.id} @${d.toFixed(2)} m, offset ${off.toFixed(2)}`);
          }
        }
        acc += len;
      }
    }
    expect(samples).toBeGreaterThan(10000);
    expect(outside).toEqual([]);
  });

  it("keeps every sampled pedestrian of the real crowd inside the routable union (gates queueing)", () => {
    const toRenderer = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y); // ENU -> renderer frame
    const gateIds = (graph as { nodes: { id: string; kind?: string }[] }).nodes.filter((n) => n.kind === "ticket_gate").map((n) => n.id);
    const c = buildCrowd(THREE, edges, toRenderer, 150, new THREE.Texture(), lanes, undefined, gateIds);
    const torso = named(c, "torso");
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    let samples = 0, outside = 0;
    for (let k = 0; k < 9000; k++) {
      c.update(1 / 30, k / 30);
      if (k % 10) continue;
      for (let i = 0; i < torso.count; i++) {
        torso.getMatrixAt(i, m);
        if (m.elements[0] === 0) continue; // hidden (relocating / too near the camera)
        v.setFromMatrixPosition(m);
        samples++;
        if (!routable(v.x, -v.z)) outside++;
      }
    }
    expect(samples).toBeGreaterThan(7000);
    expect(outside).toBe(0);
    c.dispose();
  }, 60_000); // 9000 simulated frames: ~2 s alone, over vitest's 5 s default when other files run in parallel
});

// Gate queues (#627): commuters heading through a ticket gate line up, keep a gap, and each waits briefly.
describe("ikebukuro crowd gate queues", () => {
  const toRenderer = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);
  type RealNode = { id: string; kind?: string; position: { x: number; y: number; z: number | null } };
  type RealEdge = Parameters<typeof buildCrowd>[1][number];
  const nodes = (graph as { nodes: RealNode[] }).nodes;
  const gateIds = nodes.filter((n) => n.kind === "ticket_gate").map((n) => n.id);
  const edges = (graph as { edges: RealEdge[] }).edges;
  const lanes = (crowdLanes as { lanes: Record<string, Lane> }).lanes;
  /** Each gate's own edge polyline, renderer frame, running from the junction end to the gate. */
  const gateEdges = gateIds.map((id) => {
    const e = edges.find((x) => x.from === id || x.to === id)!;
    const pts = e.geometry.map((g) => toRenderer(g.x, g.y, g.z as number));
    if (e.from === id) pts.reverse();
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z);
    return { id, pts, total, floorY: pts[pts.length - 1]!.y };
  });
  /** Perpendicular offset from the gate's edge and remaining distance along it to the gate. */
  function project(g: (typeof gateEdges)[number], x: number, z: number) {
    let off = Infinity, rem = Infinity, acc = 0;
    for (let i = 1; i < g.pts.length; i++) {
      const a = g.pts[i - 1]!, b = g.pts[i]!;
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), len2 = len * len;
      const t = len2 > 1e-9 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
      const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
      if (d < off) { off = d; rem = g.total - (acc + len * t); }
      acc += len;
    }
    return { off, rem };
  }
  const build = (count: number) => buildCrowd(THREE, edges, toRenderer, count, new THREE.Texture(), lanes, "morning", gateIds);

  it("forms lines at gates, keeps the gap and holds each front for GATE_HOLD_S", () => {
    const count = 150;
    const c = build(count);
    const torso = named(c, "torso");
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    const last = Array.from({ length: count }, () => new THREE.Vector2(NaN, NaN));
    const front = new Float64Array(count), frontAgent = gateEdges.map(() => -1);
    let maxQueued = 0, maxFront = 0;
    const gaps: string[] = [];
    const dt = 1 / 30;
    for (let k = 0; k < 120 / dt; k++) {
      c.update(dt, k * dt);
      maxQueued = Math.max(maxQueued, c.queued());
      const perGate: { rem: number; i: number }[][] = gateEdges.map(() => []);
      for (let i = 0; i < count; i++) {
        torso.getMatrixAt(i, m);
        if (m.elements[0] === 0) { last[i]!.set(NaN, NaN); continue; } // hidden
        p.setFromMatrixPosition(m);
        const prev = last[i]!;
        const moved = Math.hypot(p.x - prev.x, p.z - prev.y);
        prev.set(p.x, p.z);
        if (moved >= 0.002) continue; // still easing its gait or walking
        let best = -1, bestOff = 1.5, bestRem = 0;
        for (let gi = 0; gi < gateEdges.length; gi++) {
          const g = gateEdges[gi]!, end = g.pts[g.pts.length - 1]!;
          if (Math.hypot(p.x - end.x, p.z - end.z) > 13) continue; // nowhere near this gate's line
          const pr = project(g, p.x, p.z);
          if (pr.off < bestOff) { best = gi; bestOff = pr.off; bestRem = pr.rem; }
        }
        if (best >= 0) perGate[best]!.push({ rem: bestRem, i });
      }
      for (let gi = 0; gi < gateEdges.length; gi++) {
        const line = perGate[gi]!.sort((a, b) => a.rem - b.rem);
        for (let k2 = 1; k2 < line.length; k2++) {
          const gap = line[k2]!.rem - line[k2 - 1]!.rem;
          if (gap < QUEUE_GAP_M - 0.1) gaps.push(`${gateEdges[gi]!.id}: ${gap.toFixed(3)} m`);
        }
        // The person at the front of the line may stand at the stop mark only for the gate hold.
        const lead = line[0];
        const next = lead !== undefined && lead.rem <= QUEUE_STOP_M + 0.05 ? lead.i : -1;
        const was = frontAgent[gi]!;
        if (was >= 0 && was !== next) front[was] = 0;
        frontAgent[gi] = next;
        if (next >= 0) {
          front[next] = front[next]! + dt;
          maxFront = Math.max(maxFront, front[next]!);
        }
      }
    }
    expect(maxQueued).toBeGreaterThanOrEqual(2);
    expect(gaps).toEqual([]);
    expect(maxFront).toBeLessThanOrEqual(GATE_HOLD_S + 0.1);
    c.dispose();
  }, 60_000);

  it("keeps a gate in the camera's view lined up for a visible share of the morning (#627)", () => {
    // Tuning target for the evidence shots: at 150 morning commuters, the gate the player stands at
    // has three or more people standing still for at least a third of the time (measured 44%).
    const count = 150;
    const c = build(count);
    const torso = named(c, "torso");
    const gateId = "g_jr_c2";
    const node = nodes.find((n) => n.id === gateId)!;
    const edge = edges.find((e) => e.from === gateId || e.to === gateId)!;
    const other = nodes.find((n) => n.id === (edge.from === gateId ? edge.to : edge.from))!;
    // Stand at the gate and look down its approach, the way the evidence spec shoots it.
    const camera = new THREE.PerspectiveCamera(70, 1.5, 0.05, 200);
    camera.position.set(node.position.x, 1.6, -node.position.y);
    camera.lookAt(other.position.x, 1.2, -other.position.y);
    camera.updateMatrixWorld(true);
    const fire = () => torso.onBeforeRender(null as never, null as never, camera, null as never, null as never, null as never);
    fire(); // the crowd reads the camera before its first update, as the rendered scene does
    const gx = node.position.x, gz = -node.position.y;

    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    const prev = new Float32Array(count * 2), seen = new Uint8Array(count);
    const dt = 1 / 60;
    for (let f = 0; f < 60 / dt; f++) { c.update(dt, f * dt); fire(); }
    let samples = 0, atLeast3 = 0;
    for (let f = 0; f < 180 / dt; f++) {
      c.update(dt, f * dt);
      if (f % 30) continue; // sample every 0.5 s of station time
      fire();
      let standing = 0;
      for (let i = 0; i < count; i++) {
        torso.getMatrixAt(i, m);
        if (m.elements[0] === 0) { seen[i] = 0; continue; } // hidden near the lens
        v.setFromMatrixPosition(m);
        const still = seen[i] === 1 && Math.hypot(v.x - prev[i * 2]!, v.z - prev[i * 2 + 1]!) < 0.05;
        prev[i * 2] = v.x; prev[i * 2 + 1] = v.z; seen[i] = 1;
        if (still && Math.hypot(v.x - gx, v.z - gz) <= 12) standing++;
      }
      samples++;
      if (standing >= 3) atLeast3++;
    }
    expect(atLeast3 / samples).toBeGreaterThanOrEqual(0.35);
    c.dispose();
  }, 120_000);

  it("stands a queued walker with both soles planted (high quality)", () => {
    const count = 150;
    const c = build(count);
    const torso = named(c, "torso"), shoe = named(c, "shoe");
    const shoePos = shoe.geometry.getAttribute("position");
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    const last = Array.from({ length: count }, () => new THREE.Vector2(NaN, NaN));
    const still = new Int32Array(count);
    let found = -1;
    for (let k = 0; k < 4000 && found < 0; k++) {
      c.update(1 / 30, k / 30);
      for (let i = 0; i < count; i++) {
        torso.getMatrixAt(i, m);
        if (m.elements[0] === 0) { still[i] = 0; last[i]!.set(NaN, NaN); continue; }
        p.setFromMatrixPosition(m);
        const prev = last[i]!;
        const moved = Math.hypot(p.x - prev.x, p.z - prev.y);
        prev.set(p.x, p.z);
        still[i] = Number.isFinite(moved) && moved < 0.002 ? still[i]! + 1 : 0;
        if (still[i] === 5) found = i;
      }
    }
    expect(found).toBeGreaterThanOrEqual(0);
    torso.getMatrixAt(found, m);
    p.setFromMatrixPosition(m);
    const gate = gateEdges.reduce((a, b) => (Math.hypot(p.x - b.pts[b.pts.length - 1]!.x, p.z - b.pts[b.pts.length - 1]!.z)
      < Math.hypot(p.x - a.pts[a.pts.length - 1]!.x, p.z - a.pts[a.pts.length - 1]!.z) ? b : a));
    for (const side of [0, 1]) {
      shoe.getMatrixAt(found * 2 + side, m);
      let lo = Infinity;
      for (let v = 0; v < shoePos.count; v++) lo = Math.min(lo, p.fromBufferAttribute(shoePos, v).applyMatrix4(m).y);
      // Lift 0 on both feet: the sole touches down (only the two-bone IK's reach clamp can lift it a little).
      expect(lo).toBeGreaterThan(gate.floorY - 0.005);
      expect(lo).toBeLessThan(gate.floorY + 0.04);
    }
    c.dispose();
  }, 60_000);

  it("stands a queued walker with both soles planted (low quality)", () => {
    const count = 56;
    const c = buildCrowd(THREE, edges, toRenderer, count, new THREE.Texture(), lanes, "morning", gateIds);
    const mesh = named(c, "low"), phase = mesh.geometry.getAttribute("phase"), stride = mesh.geometry.getAttribute("stride");
    const pos = mesh.geometry.getAttribute("position"), parts = mesh.geometry.getAttribute("part");
    const m = new THREE.Matrix4(), last = Array.from({ length: count }, () => new THREE.Vector2(NaN, NaN)), still = new Int32Array(count);
    let found = -1;
    for (let k = 0; k < 4000 && found < 0; k++) {
      c.update(1 / 30, k / 30);
      for (let i = 0; i < count; i++) {
        mesh.getMatrixAt(i, m);
        if (m.elements[0] === 0) { still[i] = 0; last[i]!.set(NaN, NaN); continue; }
        const x = m.elements[12]!, z = m.elements[14]!;
        const prev = last[i]!;
        const moved = Math.hypot(x - prev.x, z - prev.y);
        prev.set(x, z);
        still[i] = Number.isFinite(moved) && moved < 0.002 ? still[i]! + 1 : 0;
        if (still[i] === 20) found = i; // 0.67 s: the planted-phase easing (<= 0.3 s) has finished
      }
    }
    expect(found).toBeGreaterThanOrEqual(0);
    mesh.getMatrixAt(found, m);
    const x = m.elements[12]!, z = m.elements[14]!;
    const gate = gateEdges.reduce((a, b) => (Math.hypot(x - b.pts[b.pts.length - 1]!.x, z - b.pts[b.pts.length - 1]!.z)
      < Math.hypot(x - a.pts[a.pts.length - 1]!.x, z - a.pts[a.pts.length - 1]!.z) ? b : a));
    const shoes: number[][] = [[], []], support: number[] = [];
    for (let v = 0; v < pos.count; v++) {
      if (parts.getX(v) !== 6) continue;
      const side = parts.getW(v) > 0 ? 0 : 1;
      shoes[side]!.push(v);
      if (side === 0 && pos.getY(v) - 0.072 <= -0.045) support.push(pos.getZ(v), pos.getY(v) - 0.072);
    }
    const sole = new Float64Array(support), p = new THREE.Vector3();
    expect(Math.abs(Math.sin(phase.getX(found)))).toBeLessThan(1e-5); // neither leg carries the swing lift
    for (const side of [0, 1]) {
      let lo = Infinity;
      for (const v of shoes[side]!) {
        lo = Math.min(lo, p.fromArray(transformLowCrowdVertex(
          [pos.getX(v), pos.getY(v), pos.getZ(v)],
          [parts.getX(v), parts.getY(v), parts.getZ(v), parts.getW(v)], phase.getX(found), sole, stride.getX(found),
        )).applyMatrix4(m).y);
      }
      expect(Math.abs(lo - gate.floorY)).toBeLessThan(0.01); // the shader grounds both soles at this phase
    }
    c.dispose();
  }, 60_000);
});

describe("ikebukuro crowd relocation", () => {
  // A camera at the origin looking along -Z, and three verified passages: 200 m straight ahead on the
  // view axis (anything 12-40 m out is inside the frustum, so it never takes a relocation), 200 m
  // straight behind (out of view, so the old rule took it and the new ahead rule must not), and 200 m
  // across the view 12 m ahead of the camera (ahead, but out of the frustum past ~11 m of lateral
  // offset: the only legal landing spots).
  const cross = { id: "cross", from: "c1", to: "c2", verification: "verified", geometry: [{ x: -100, y: 12, z: 0 }, { x: 100, y: 12, z: 0 }] };
  const RELOCATION_EDGES = [
    { id: "axis", from: "a1", to: "a2", verification: "verified", geometry: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 200, z: 0 }] },
    { id: "behind", from: "b1", to: "b2", verification: "verified", geometry: [{ x: 0, y: -200, z: 0 }, { x: 0, y: 0, z: 0 }] },
    cross,
  ] as unknown as typeof edges;
  const EYE = 1.6;
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
  camera.position.set(0, EYE, 0);
  camera.lookAt(0, 1.0, -10);
  camera.updateMatrixWorld(true);

  /** Instance translations and world scale, as last written by update(). */
  function read(c: ReturnType<typeof make>) {
    const mesh = named(c, "torso"), m = new THREE.Matrix4(), out: { x: number; y: number; z: number; scale: number }[] = [];
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      const e = m.elements;
      out.push({ x: e[12]!, y: e[13]!, z: e[14]!, scale: Math.hypot(e[0]!, e[1]!, e[2]!) });
    }
    return out;
  }

  it("lands relocations in front of the camera and never inside the padded view", () => {
    const c = make(80, RELOCATION_EDGES);
    const before = read(c);
    // Every call stands for a rendered frame: a relocated person stays hidden until one shows the new spot.
    for (let i = 0; i < 60; i++) {
      named(c, "torso").onBeforeRender(null as never, null as never, camera, null as never, null as never, null as never);
      c.update(0, 0); // dt = 0, so the only movement is a relocation
    }
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const moved = read(c).flatMap((p, i) => {
      const b = before[i]!;
      if (p.scale < 1e-6 || b.scale < 1e-6 || Math.hypot(p.x - b.x, p.z - b.z) < 0.5) return [];
      const d = Math.hypot(p.x, p.y + 1.1 - EYE, p.z);
      return [{
        ahead: -p.z, // the camera's forward vector is (0, 0, -1) horizontally
        inView: frustum.intersectsSphere(new THREE.Sphere(new THREE.Vector3(p.x, p.y + 0.9, p.z), 1.2 + 0.12 * d)),
      }];
    });
    expect(moved.length).toBeGreaterThan(20);
    expect(moved.filter((m) => m.ahead > 0).length / moved.length).toBeGreaterThan(0.75);
    expect(moved.filter((m) => m.inView)).toHaveLength(0);
    c.dispose();
  });
});
