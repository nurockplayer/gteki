import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ditherFade, sanitizeAvatarFade } from "./avatarDither.ts";
import type { AvatarRig } from "./avatar.ts";

/**
 * Procedural cat protagonist (#854 stage 1): an original orange cat in the mascot-v1 palette, built from
 * smooth three.js geometry only (no assets, no textures). One SkinnedMesh + one MeshStandardMaterial keeps
 * the low tier at one draw call plus its shadow pass. Origin at the feet (y = 0 is the floor); faces -Z, like
 * the human avatar. Three proportion sets share the same code: A near-realistic, B semi-stylised, C mascot.
 */
export type CatStyle = "A" | "B" | "C";

export function createCatAvatar(opts: { quality: "low" | "high"; style?: CatStyle }): AvatarRig {
  return new CatAvatar(PROFILES[opts.style ?? "B"], DETAIL[opts.quality ?? "high"]);
}

/* ------------------------------------------------------------------------------------------ */
/* small math helpers                                                                          */
/* ------------------------------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** sRGB hex to linear RGB, matching the avatar's vertex-colour convention. */
function linear(hex: number): readonly [number, number, number] {
  const c = new THREE.Color(hex).convertSRGBToLinear();
  return [c.r, c.g, c.b];
}

const ORANGE = linear(0xe8a15a);
const WHITE = linear(0xffffff);
const PINK = linear(0xf6b8b0);
const DARK = linear(0x2b1e18);
const NAVY = linear(0x0e2554);

type Rgb = readonly [number, number, number];
const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

/* ------------------------------------------------------------------------------------------ */
/* level of detail and proportions                                                             */
/* ------------------------------------------------------------------------------------------ */

interface Detail {
  bodySeg: number;
  bodyRings: number;
  headSeg: number;
  headRings: number;
  clumpSeg: number;
  clumpRings: number;
  legSeg: number;
  tailSeg: number;
  pawSeg: number;
  earSeg: number;
  kerchiefSeg: number;
}

const DETAIL: Record<"low" | "high", Detail> = {
  high: { bodySeg: 22, bodyRings: 16, headSeg: 24, headRings: 16, clumpSeg: 9, clumpRings: 7, legSeg: 10, tailSeg: 12, pawSeg: 9, earSeg: 8, kerchiefSeg: 18 },
  low: { bodySeg: 14, bodyRings: 10, headSeg: 14, headRings: 10, clumpSeg: 6, clumpRings: 5, legSeg: 7, tailSeg: 8, pawSeg: 6, earSeg: 5, kerchiefSeg: 12 },
};

/**
 * Proportions in metres. `headTop` is the overall model height (ear tips) each style must reach; `hipY` is
 * derived so the legs keep a slight bend at rest, and the head bone height follows from `headTop`.
 */
interface CatProfile {
  readonly headTop: number;
  readonly legUpper: number;
  readonly legLower: number;
  readonly pawH: number;
  readonly bodyW: number;
  readonly bodyR: number;
  readonly bodyY: number;
  readonly bodyFront: number;
  readonly bodyBack: number;
  readonly headW: number;
  readonly headR: number;
  readonly headD: number;
  readonly headZ: number;
  readonly earH: number;
  readonly earW: number;
  readonly eyeR: number;
  readonly kerchief: number;
  readonly legX: number;
  readonly neckR: number;
}

const PROFILES: Record<CatStyle, CatProfile> = {
  // Near-realistic: small head, long legs, slim body.
  A: { headTop: 0.36, legUpper: 0.105, legLower: 0.095, pawH: 0.026, bodyW: 0.05, bodyR: 0.055, bodyY: 0.245, bodyFront: -0.17, bodyBack: 0.16, headW: 0.048, headR: 0.05, headD: 0.052, headZ: -0.205, earH: 0.026, earW: 0.018, eyeR: 0.011, kerchief: 0.85, legX: 0.038, neckR: 0.038 },
  // Semi-stylised: head about 1.3x real, shorter legs, rounder body.
  B: { headTop: 0.40, legUpper: 0.088, legLower: 0.08, pawH: 0.03, bodyW: 0.066, bodyR: 0.072, bodyY: 0.232, bodyFront: -0.17, bodyBack: 0.16, headW: 0.075, headR: 0.068, headD: 0.072, headZ: -0.215, earH: 0.035, earW: 0.026, eyeR: 0.016, kerchief: 1, legX: 0.046, neckR: 0.05 },
  // Mascot v1: big head and round eyes, shortest legs, large neckerchief.
  C: { headTop: 0.45, legUpper: 0.075, legLower: 0.068, pawH: 0.027, bodyW: 0.078, bodyR: 0.082, bodyY: 0.207, bodyFront: -0.18, bodyBack: 0.16, headW: 0.088, headR: 0.085, headD: 0.082, headZ: -0.23, earH: 0.045, earW: 0.032, eyeR: 0.028, kerchief: 1.5, legX: 0.052, neckR: 0.058 },
};

/* ------------------------------------------------------------------------------------------ */
/* skeleton: 22 bones (hips, 3 spine, neck, head, 4 tail, 4 legs x upper/lower/paw)            */
/* ------------------------------------------------------------------------------------------ */

const HIPS = 0;
const SPINE1 = 1;
const SPINE2 = 2;
const SPINE3 = 3;
const NECK = 4;
const HEAD = 5;
const TAIL1 = 6;
const LEG_FL = 10;
const LEG_FR = 13;
const LEG_HL = 16;
const LEG_HR = 19;

type Weights = readonly (readonly [number, number])[];

/* ------------------------------------------------------------------------------------------ */
/* geometry helpers                                                                            */
/* ------------------------------------------------------------------------------------------ */

function smoothed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  const m = mergeVertices(g, 1e-5);
  m.computeVertexNormals();
  g.dispose();
  return m;
}

function flipWinding(g: THREE.BufferGeometry): void {
  const index = g.getIndex();
  if (!index) throw new Error("flipWinding expects indexed geometry");
  for (let i = 0; i + 2 < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  index.needsUpdate = true;
}

function paint(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => Rgb): void {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
    arr[i * 3] = c[0];
    arr[i * 3 + 1] = c[1];
    arr[i * 3 + 2] = c[2];
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
}

function skinGeometry(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => Weights): void {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const indices = new Uint16Array(pos.count * 4);
  const weights = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const list = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
    for (let k = 0; k < 4; k++) {
      indices[i * 4 + k] = list[k]?.[0] ?? 0;
      weights[i * 4 + k] = list[k]?.[1] ?? 0;
    }
  }
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
}

function rigid(g: THREE.BufferGeometry, bone: number): void {
  skinGeometry(g, () => [[bone, 1]]);
}

function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.hasAttribute("uv")) g.deleteAttribute("uv");
  return g;
}

function mergeParts(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(list.map(prep), false);
  if (!merged) throw new Error("cat avatar: geometry merge failed");
  for (const g of list) g.dispose();
  return merged;
}

function ellipsoid(rx: number, ry: number, rz: number, x: number, y: number, z: number, seg: number, rings: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg, rings);
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return g;
}

/** Tapered cylinder from `a` (radius rA) to `b` (radius rB), capped. */
function between(a: THREE.Vector3, b: THREE.Vector3, rA: number, rB: number, radial: number): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(rB, rA, len, radial, 1, false);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

/** Open band around `dir`, centred at `centre`. */
function band(centre: THREE.Vector3, dir: THREE.Vector3, rTop: number, rBottom: number, height: number, radial: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, height, radial, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
  g.translate(centre.x, centre.y, centre.z);
  return g;
}

/** Parameter of a point projected onto segment a -> b, clamped to 0..1. */
function along(a: THREE.Vector3, b: THREE.Vector3, x: number, y: number, z: number): number {
  const ax = b.x - a.x, ay = b.y - a.y, az = b.z - a.z;
  const len2 = ax * ax + ay * ay + az * az;
  return len2 > 1e-9 ? clamp(((x - a.x) * ax + (y - a.y) * ay + (z - a.z) * az) / len2, 0, 1) : 0;
}

/* ------------------------------------------------------------------------------------------ */
/* gait                                                                                        */
/* ------------------------------------------------------------------------------------------ */

const WALK_GAIT = { beta: 0.6, stride: 0.32, lift: 0.045 };
const TROT_GAIT = { beta: 0.42, stride: 0.52, lift: 0.06 };
const RUN_GAIT = { beta: 0.3, stride: 0.7, lift: 0.095 };

interface PawSample {
  /** Forward offset relative to the leg's standing position (m). */
  f: number;
  lift: number;
  swing: number;
}

/** One paw's analytic stance/swing sample: planted through `beta` of the cycle, sweeping back at ground speed. */
function samplePaw(phi: number, beta: number, stride: number, lift: number, out: PawSample): void {
  const p = phi - Math.floor(phi);
  const half = (stride * beta) / 2;
  if (p < beta) {
    out.f = half - stride * p;
    out.lift = 0;
    out.swing = 0;
  } else {
    const q = (p - beta) / (1 - beta);
    const e = q * q * (3 - 2 * q);
    out.f = -half + stride * beta * e;
    out.lift = lift * Math.sin(Math.PI * q);
    out.swing = Math.sin(Math.PI * q);
  }
}

interface Leg {
  key: "FL" | "FR" | "HL" | "HR";
  side: -1 | 1;
  front: boolean;
  parent: THREE.Bone;
  upper: THREE.Bone;
  lower: THREE.Bone;
  paw: THREE.Bone;
  l1: number;
  l2: number;
  baseX: number;
  baseZ: number;
  walk: number;
  trot: number;
  run: number;
}

/* ------------------------------------------------------------------------------------------ */
/* rig                                                                                         */
/* ------------------------------------------------------------------------------------------ */

class CatAvatar implements AvatarRig {
  readonly root = new THREE.Group();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly mesh: THREE.SkinnedMesh;
  private readonly skeleton: THREE.Skeleton;
  private readonly geometry: THREE.BufferGeometry;
  private readonly bones: THREE.Bone[] = [];
  private readonly legs: Leg[] = [];
  private readonly tail: THREE.Bone[] = [];
  private readonly hips: THREE.Bone;
  private readonly spine1: THREE.Bone;
  private readonly spine2: THREE.Bone;
  private readonly spine3: THREE.Bone;
  private readonly neck: THREE.Bone;
  private readonly head: THREE.Bone;
  private readonly fade = { value: 1 };

  private readonly hipsBase = new THREE.Vector3();
  private readonly hipY: number;
  private readonly neckY: number;
  private readonly neckZ: number;
  private readonly headY: number;

  private time = 0;
  private phase = 0;
  private speed = 0;
  private speedVel = 0;
  private idle = 0;
  private sit = 0;
  private disposed = false;

  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v4 = new THREE.Vector3();
  private readonly v5 = new THREE.Vector3();
  private readonly v6 = new THREE.Vector3();
  private readonly v7 = new THREE.Vector3();
  private readonly v8 = new THREE.Vector3();
  private readonly v9 = new THREE.Vector3();
  private readonly v10 = new THREE.Vector3();
  private readonly v11 = new THREE.Vector3();
  private readonly v12 = new THREE.Vector3();
  private readonly m1 = new THREE.Matrix4();
  private readonly m2 = new THREE.Matrix4();
  private readonly m3 = new THREE.Matrix4();
  private readonly q1 = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly q3 = new THREE.Quaternion();
  private readonly q4 = new THREE.Quaternion();
  private readonly q5 = new THREE.Quaternion();
  private readonly e1 = new THREE.Euler();
  private readonly sWalk: PawSample = { f: 0, lift: 0, swing: 0 };
  private readonly sTrot: PawSample = { f: 0, lift: 0, swing: 0 };
  private readonly sRun: PawSample = { f: 0, lift: 0, swing: 0 };

  constructor(private readonly p: CatProfile, private readonly d: Detail) {
    this.root.name = "cat-avatar";
    this.hipY = p.pawH + (p.legUpper + p.legLower) * 0.96;
    const hipsY = this.hipY + 0.045;
    const spine3Y = hipsY + 0.012;
    this.neckY = spine3Y + 0.02;
    this.neckZ = -0.13;
    this.headY = p.headTop - 0.02 - p.headR * 0.78 - p.earH;
    this.hipsBase.set(0, hipsY, 0.11);

    this.hips = this.bone("hips", null, 0, hipsY, 0.11);
    this.spine1 = this.bone("spine1", this.hips, 0, 0.006, -0.065);
    this.spine2 = this.bone("spine2", this.spine1, 0, 0.004, -0.065);
    this.spine3 = this.bone("spine3", this.spine2, 0, 0.002, -0.065);
    this.neck = this.bone("neck", this.spine3, 0, 0.02, -0.045);
    this.head = this.bone("head", this.neck, 0, this.headY - this.neckY, p.headZ + 0.13);

    // Tail: four bones curving back and up from the rump.
    const deltas: readonly (readonly [number, number])[] = [[0.022, 0.055], [0.03, 0.055], [0.026, 0.05], [0.006, 0.045]];
    let parent: THREE.Bone = this.hips;
    let py = hipsY;
    let pz = 0.11;
    let ty = p.bodyY + 0.015;
    let tz = p.bodyBack - 0.01;
    for (let i = 0; i < 4; i++) {
      const b = this.bone(`tail${i + 1}`, parent, 0, ty - py, tz - pz);
      this.tail.push(b);
      parent = b;
      py = ty;
      pz = tz;
      const delta = deltas[i]!;
      ty += delta[0];
      tz += delta[1];
    }

    this.geometry = this.buildGeometry();
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, envMapIntensity: 0.6 });
    ditherFade(this.material, this.fade);
    this.mesh = new THREE.SkinnedMesh(this.geometry, this.material);
    this.mesh.name = "cat-body";
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.add(this.hips);
    this.root.add(this.mesh);
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
    this.mesh.bind(this.skeleton);
    this.update(0.0001, 0);
  }

  private bone(name: string, parent: THREE.Bone | null, x: number, y: number, z: number): THREE.Bone {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    this.bones.push(b);
    if (parent) parent.add(b);
    return b;
  }

  /* ----- construction ----------------------------------------------------------------------- */

  private buildGeometry(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    this.buildBody(parts);
    this.buildNeck(parts);
    this.buildHead(parts);
    this.buildKerchief(parts);
    this.buildLegs(parts);
    this.buildTail(parts);
    if (this.bones.length !== 22) throw new Error(`cat avatar: expected 22 bones, got ${this.bones.length}`);
    return mergeParts(parts);
  }

  private buildBody(parts: THREE.BufferGeometry[]): void {
    const p = this.p;
    const g = new THREE.SphereGeometry(1, this.d.bodySeg, this.d.bodyRings);
    g.deleteAttribute("normal");
    g.deleteAttribute("uv");
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const zc = (p.bodyFront + p.bodyBack) / 2;
    const half = (p.bodyBack - p.bodyFront) / 2;
    for (let i = 0; i < pos.count; i++) {
      const nx = pos.getX(i);
      const ny = pos.getY(i);
      const nz = pos.getZ(i);
      pos.setXYZ(i, nx * p.bodyW, p.bodyY + nz * p.bodyR, zc + ny * half);
    }
    flipWinding(g);
    const body = smoothed(g);
    paint(body, (x, y, z) => {
      const k = 0.8 + 0.2 * smoothstep(p.bodyY - p.bodyR, p.bodyY + p.bodyR, y);
      const white = z < p.bodyFront + 0.09 && y < p.bodyY + 0.005;
      return shade(white ? WHITE : ORANGE, k);
    });
    skinGeometry(body, (x, _y, z) => trunkWeights(z));
    parts.push(body);
  }

  private buildNeck(parts: THREE.BufferGeometry[]): void {
    const p = this.p;
    const a = this.v1.set(0, this.neckY + 0.005, this.neckZ + 0.01);
    const b = this.v2.set(0, this.headY - p.headR * 0.2, p.headZ + p.headD * 0.5);
    const g = between(a.clone(), b.clone(), p.neckR, p.neckR * 0.8, this.d.legSeg);
    paint(g, () => shade(ORANGE, 0.95));
    skinGeometry(g, (x, y, z) => {
      const t = along(a, b, x, y, z);
      return t < 0.5
        ? [[SPINE3, 0.5 * (1 - t * 2)], [NECK, 0.5 + 0.5 * (t * 2)]]
        : [[NECK, 1 - (t - 0.5)], [HEAD, t - 0.5]];
    });
    parts.push(g);
  }

  private buildHead(parts: THREE.BufferGeometry[]): void {
    const p = this.p;
    const d = this.d;
    const cy = 0.02;
    // Geometry is authored in the bind pose (root space), so head parts sit at the head bone's rest position.
    const hy = this.headY;
    const hz = p.headZ;

    // Skull: a soft ellipsoid, slightly fuller at the cheeks.
    const skull = new THREE.SphereGeometry(1, d.headSeg, d.headRings);
    skull.deleteAttribute("normal");
    skull.deleteAttribute("uv");
    const sp = skull.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) {
      const nx = sp.getX(i);
      const ny = sp.getY(i);
      const nz = sp.getZ(i);
      const cheek = 1 + 0.06 * (1 - Math.abs(ny)) * (nz < 0 ? 1 : 0.4);
      sp.setXYZ(i, nx * p.headW * cheek, hy + cy + ny * p.headR, hz + nz * p.headD + 0.004);
    }
    const head = smoothed(skull);
    paint(head, (_x, y) => shade(ORANGE, 0.86 + 0.14 * smoothstep(hy + cy - p.headR, hy + cy + p.headR, y)));
    rigid(head, HEAD);
    parts.push(head);

    // Muzzle and nose.
    const muzzle = ellipsoid(p.headW * 0.5, p.headR * 0.36, p.headD * 0.42, 0, hy + cy - p.headR * 0.42, hz - p.headD * 0.9, d.clumpSeg, d.clumpRings);
    paint(muzzle, () => WHITE);
    rigid(muzzle, HEAD);
    parts.push(muzzle);
    const nose = ellipsoid(p.headW * 0.13, p.headR * 0.09, p.headD * 0.07, 0, hy + cy - p.headR * 0.28, hz - p.headD * 0.985, d.clumpSeg, d.clumpRings);
    paint(nose, () => PINK);
    rigid(nose, HEAD);
    parts.push(nose);

    // Round eyes on the skull surface.
    const ex = p.headW * 0.42;
    const ey = cy + p.headR * 0.22;
    const nz = -Math.sqrt(Math.max(0.05, 1 - (ex / p.headW) ** 2 - ((ey - cy) / p.headR) ** 2));
    for (const side of [-1, 1] as const) {
      const eye = ellipsoid(p.eyeR, p.eyeR, p.eyeR, side * ex, hy + ey, hz + nz * p.headD - p.eyeR * 0.55, d.clumpSeg, d.clumpRings);
      paint(eye, () => DARK);
      rigid(eye, HEAD);
      parts.push(eye);
    }

    // Ears: cones on top, pink inner cone just in front of each.
    for (const side of [-1, 1] as const) {
      parts.push(this.ear(side, 1, p.headW * 0.52, ORANGE, 0));
      parts.push(this.ear(side, 0.62, p.headW * 0.5, PINK, -0.008));
    }
  }

  private ear(side: -1 | 1, scale: number, x: number, color: Rgb, zOff: number): THREE.BufferGeometry {
    const p = this.p;
    const h = p.earH * scale;
    const g = new THREE.ConeGeometry(p.earW * scale, h, this.d.earSeg);
    g.translate(0, h / 2, zOff);
    g.rotateZ(-side * 0.18);
    g.rotateX(-0.08);
    g.translate(side * x, this.headY + 0.02 + p.headR * 0.78, p.headZ + 0.004);
    paint(g, () => color);
    rigid(g, HEAD);
    return g;
  }

  private buildKerchief(parts: THREE.BufferGeometry[]): void {
    const p = this.p;
    const k = p.kerchief;
    const a = this.v3.set(0, this.neckY + 0.005, this.neckZ + 0.01);
    const b = this.v4.set(0, this.headY - p.headR * 0.2, p.headZ + p.headD * 0.5);
    const centre = this.v5.copy(a).lerp(b, 0.35);
    const dir = this.v6.copy(b).sub(a).normalize();
    const r = p.neckR * 1.35;
    const cloth = band(centre.clone(), dir, r * 1.05 * k, r * 1.25 * k, 0.035 * k, this.d.kerchiefSeg);
    paint(cloth, () => NAVY);
    rigid(cloth, NECK);
    parts.push(cloth);
    const knot = ellipsoid(p.neckR * 0.4 * k, p.neckR * 0.34 * k, p.neckR * 0.3 * k, 0, centre.y - 0.01 * k, centre.z - r * 0.95 * k, this.d.clumpSeg, this.d.clumpRings);
    paint(knot, () => NAVY);
    rigid(knot, NECK);
    parts.push(knot);
  }

  private buildLegs(parts: THREE.BufferGeometry[]): void {
    const k = this.p.bodyR / 0.072;
    const defs: readonly (readonly [Leg["key"], -1 | 1, boolean, number])[] = [
      ["FL", -1, true, LEG_FL], ["FR", 1, true, LEG_FR], ["HL", -1, false, LEG_HL], ["HR", 1, false, LEG_HR],
    ];
    for (const [key, side, front, index] of defs) {
      const parent = front ? this.spine3 : this.hips;
      const parentY = front ? this.hipY + 0.057 : this.hipY + 0.045;
      const parentZ = front ? -0.085 : 0.11;
      const bx = side * this.p.legX;
      const bz = front ? -0.105 : 0.08;
      const upper = this.bone(`upper${key}`, parent, bx, this.hipY - parentY, bz - parentZ);
      const lower = this.bone(`lower${key}`, upper, 0, -this.p.legUpper, 0);
      const paw = this.bone(`paw${key}`, lower, 0, -this.p.legLower, 0);
      this.legs.push({
        key, side, front, parent, upper, lower, paw,
        l1: this.p.legUpper, l2: this.p.legLower,
        baseX: bx, baseZ: bz,
        walk: key === "FL" ? 0.25 : key === "FR" ? 0.75 : key === "HL" ? 0 : 0.5,
        trot: key === "FL" || key === "HR" ? 0.5 : 0,
        run: key === "HL" || key === "HR" ? 0.5 : 0,
      });

      const knee = this.v7.set(bx, this.hipY - this.p.legUpper, bz);
      const foot = this.v8.set(bx, this.p.pawH, bz);
      const thigh = between(new THREE.Vector3(bx, this.hipY, bz), knee.clone(), 0.032 * k, 0.024 * k, this.d.legSeg);
      paint(thigh, () => shade(ORANGE, 0.94));
      rigid(thigh, index);
      parts.push(thigh);
      const shin = between(knee.clone(), foot.clone(), 0.022 * k, 0.016 * k, this.d.legSeg);
      paint(shin, () => shade(ORANGE, 0.9));
      rigid(shin, index + 1);
      parts.push(shin);
      const pawGeo = ellipsoid(0.034 * k, this.p.pawH, 0.048 * k, bx, this.p.pawH, bz - 0.012, this.d.pawSeg, Math.max(4, this.d.pawSeg - 2));
      paint(pawGeo, () => WHITE);
      rigid(pawGeo, index + 2);
      parts.push(pawGeo);
    }
  }

  private buildTail(parts: THREE.BufferGeometry[]): void {
    const p = this.p;
    const k = p.bodyR / 0.072;
    const radii = [0.021, 0.018, 0.015, 0.011, 0.006];
    const points: THREE.Vector3[] = [];
    let y = p.bodyY + 0.015;
    let z = p.bodyBack - 0.01;
    points.push(new THREE.Vector3(0, y, z));
    const deltas: readonly (readonly [number, number])[] = [[0.022, 0.055], [0.03, 0.055], [0.026, 0.05], [0.006, 0.045]];
    for (const [dy, dz] of deltas) {
      y += dy;
      z += dz;
      points.push(new THREE.Vector3(0, y, z));
    }
    for (let i = 0; i < 4; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const g = between(a.clone(), b.clone(), radii[i]! * k, radii[i + 1]! * k, this.d.tailSeg);
      paint(g, (x, yy, zz) => {
        const t = (i + along(a, b, x, yy, zz)) / 4;
        const ring = (t > 0.42 && t < 0.5) || (t > 0.6 && t < 0.68);
        return shade(t > 0.84 || ring ? DARK : ORANGE, 0.94);
      });
      skinGeometry(g, (x, yy, zz) => {
        const t = along(a, b, x, yy, zz);
        const w = 0.5 * smoothstep(0.6, 1, t);
        const bone = TAIL1 + i;
        return i < 3 ? [[bone, 1 - w], [bone + 1, w]] : [[bone, 1]];
      });
      parts.push(g);
    }
  }

  /* ----- public API --------------------------------------------------------------------------- */

  setEnvMap(env: THREE.Texture | null, intensity = 0.6): void {
    this.material.envMap = env;
    this.material.envMapIntensity = intensity;
    this.material.needsUpdate = true;
  }

  setFade(opacity: number): void {
    this.fade.value = sanitizeAvatarFade(opacity);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.geometry.dispose();
    this.material.dispose();
    this.skeleton.dispose();
  }

  /* ----- animation ----------------------------------------------------------------------------- */

  update(dt: number, speedMps: number): void {
    if (!(dt > 0) || this.disposed) return;
    const step = Math.min(dt, 0.1);
    const target = Number.isFinite(speedMps) ? Math.max(0, speedMps) : 0;

    // Critically damped speed smoothing (same model as the human avatar).
    const omega = 2 / 0.16;
    const x = omega * step;
    const ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = this.speed - target;
    const temp = (this.speedVel + omega * change) * step;
    this.speedVel = (this.speedVel - omega * temp) * ex;
    this.speed = Math.max(0, target + (change + temp) * ex);
    if (target === 0 && this.speed < 0.002) {
      this.speed = 0;
      this.speedVel = 0;
    }
    const s = this.speed;
    this.time += step;

    this.idle = s < 0.05 ? this.idle + step : 0;
    const sitTarget = this.idle > 4 ? 1 : 0;
    this.sit = clamp(this.sit + clamp(sitTarget - this.sit, -step * 1.8, step * 1.8), 0, 1);

    const moving = smoothstep(0.02, 0.25, s);
    const wWalk = 1 - smoothstep(0.85, 1.2, s);
    const wRun = smoothstep(2.0, 2.4, s);
    const wTrot = Math.max(0, 1 - wWalk - wRun);
    const stride = WALK_GAIT.stride * wWalk + TROT_GAIT.stride * wTrot + RUN_GAIT.stride * wRun;
    this.phase = (this.phase + (s * step) / Math.max(stride, 0.12)) % 1;
    const t = this.time;
    const breathe = Math.sin(TAU * 0.3 * t);

    // Body: a little bob and undulation on the move, breathing at rest, rump lowered when sitting.
    const bob = moving * 0.008 * Math.cos(4 * Math.PI * this.phase);
    this.hips.position.set(this.hipsBase.x, this.hipsBase.y + bob - 0.075 * this.sit, this.hipsBase.z);
    const lean = 0.03 * moving;
    this.hips.rotation.set(lean + 0.22 * this.sit + 0.004 * breathe * (1 - moving), 0.03 * Math.sin(TAU * this.phase) * moving, 0.02 * Math.sin(TAU * this.phase) * moving, "YXZ");
    this.spine1.rotation.set(-0.015 * moving + 0.01 * breathe * (1 - moving), 0.04 * Math.sin(TAU * this.phase + 0.6) * moving, 0, "YXZ");
    this.spine2.rotation.set(-0.02 * moving + 0.014 * breathe * (1 - moving), 0.03 * Math.sin(TAU * this.phase + 1.1) * moving, 0, "YXZ");
    this.spine3.rotation.set(-0.02 * moving, 0.02 * Math.sin(TAU * this.phase + 1.6) * moving, 0, "YXZ");
    this.neck.rotation.set(-0.5 * this.hips.rotation.x + 0.03 * Math.sin(t * 0.7) * (1 - moving), 0.04 * Math.sin(t * 0.4) * (1 - moving), 0, "YXZ");
    this.head.rotation.set(-0.3 * this.hips.rotation.x + 0.05 * Math.sin(t * 0.9 + 1) * (1 - moving), 0.06 * Math.sin(t * 0.35) * (1 - moving), 0, "YXZ");

    // Tail: slow idle sway, a travelling wave on the move, curled around when sitting.
    const sway = 0.16 * Math.sin(t * 1.1) * (1 - 0.5 * moving) + 0.09 * Math.sin(TAU * this.phase) * moving;
    for (let i = 0; i < 4; i++) {
      this.tail[i]!.rotation.set(0.04 * (1 - moving) * Math.sin(t * 0.7 + i), sway + 0.05 * Math.sin(t * 1.1 - i * 0.7) + 0.3 * this.sit, 0);
    }

    this.root.updateMatrixWorld(true);

    for (const leg of this.legs) {
      samplePaw(this.phase + leg.walk, WALK_GAIT.beta, WALK_GAIT.stride, WALK_GAIT.lift, this.sWalk);
      samplePaw(this.phase + leg.trot, TROT_GAIT.beta, TROT_GAIT.stride, TROT_GAIT.lift, this.sTrot);
      samplePaw(this.phase + leg.run, RUN_GAIT.beta, RUN_GAIT.stride, RUN_GAIT.lift, this.sRun);
      const f = (this.sWalk.f * wWalk + this.sTrot.f * wTrot + this.sRun.f * wRun) * moving;
      const lift = (this.sWalk.lift * wWalk + this.sTrot.lift * wTrot + this.sRun.lift * wRun) * moving;
      const swing = (this.sWalk.swing * wWalk + this.sTrot.swing * wTrot + this.sRun.swing * wRun) * moving;
      this.v1.set(leg.baseX, this.p.pawH + lift, leg.baseZ - f);
      this.solveLeg(leg, this.v1, -0.3 * swing);
    }
  }

  /** Two-bone IK placing the paw at `target` (root space); the lower bone and paw follow the solved chain. */
  private solveLeg(leg: Leg, target: THREE.Vector3, pawPitch: number): void {
    const { v2, v3, v4, v5, v6, v7, v8, v9, m1, m2, q1, q2, q3, q4, q5 } = this;
    // Parent frame relative to the root (the explorer's transform on root cancels out).
    m1.copy(this.root.matrixWorld).invert().multiply(leg.parent.matrixWorld);
    m2.copy(m1).invert();
    const local = v2.copy(target).applyMatrix4(m2);
    const origin = leg.upper.position;
    const d = v3.set(local.x - origin.x, local.y - origin.y, local.z - origin.z);
    let dist = d.length();
    if (dist < 1e-6) d.set(0, -1, 0);
    const dir = v4.copy(d).normalize();
    dist = clamp(dist, Math.abs(leg.l1 - leg.l2) + 0.015, (leg.l1 + leg.l2) * 0.999);
    const top = v5.copy(origin).addScaledVector(dir, dist);
    const cosA = (leg.l1 * leg.l1 + dist * dist - leg.l2 * leg.l2) / (2 * leg.l1 * dist);
    const a = Math.acos(clamp(cosA, -1, 1));
    // Hind knee points forward (-Z); front elbow points backward (+Z).
    const bend = v6.set(0, 0, leg.front ? 1 : -1);
    bend.addScaledVector(dir, -bend.dot(dir));
    if (bend.lengthSq() < 1e-8) bend.set(1, 0, 0);
    bend.normalize();
    const thigh = v7.copy(dir).multiplyScalar(Math.cos(a)).addScaledVector(bend, Math.sin(a));
    const knee = v8.copy(origin).addScaledVector(thigh, leg.l1);
    const lowerDir = v9.copy(top).sub(knee).normalize();

    this.basisQuat(thigh, q1);
    this.basisQuat(lowerDir, q2);
    leg.upper.quaternion.copy(q1);
    leg.lower.quaternion.copy(q3.copy(q1).invert().multiply(q2));

    // The paw stays level with the floor, pitched slightly during swing.
    q5.setFromRotationMatrix(m1);
    q4.setFromEuler(this.e1.set(pawPitch, 0, 0, "YXZ"));
    q4.premultiply(q5.invert());
    leg.paw.quaternion.copy(q3.copy(q2).invert().multiply(q4));
  }

  /** Rotation taking the bone's -Y axis onto `dir`. */
  private basisQuat(dir: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
    const y = this.v10.copy(dir).negate();
    const x = this.v11.set(0, 0, -1).cross(y);
    if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
    x.normalize();
    const z = this.v12.copy(x).cross(y);
    this.m3.makeBasis(x, y, z);
    return out.setFromRotationMatrix(this.m3);
  }
}

/* ------------------------------------------------------------------------------------------ */
/* skin weights                                                                                */
/* ------------------------------------------------------------------------------------------ */

/** Trunk weights: smooth two-bone blends between the four body bones along z. */
function trunkWeights(z: number): Weights {
  const zs = [0.11, 0.045, -0.02, -0.085];
  if (z >= zs[0]!) return [[HIPS, 1]];
  for (let i = 0; i < 3; i++) {
    const hi = zs[i]!;
    const lo = zs[i + 1]!;
    if (z >= lo) return [[HIPS + i, (z - lo) / (hi - lo)], [HIPS + i + 1, (hi - z) / (hi - lo)]];
  }
  return [[SPINE3, 1]];
}
