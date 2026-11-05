import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ditherFade, sanitizeAvatarFade } from "./avatarDither.ts";
import type { AvatarRig } from "./avatar.ts";

/**
 * Procedural cat protagonist (#854 stage 1): a neutral realistic short-hair cat, built from continuous lofted
 * surfaces only (no assets, no textures). One SkinnedMesh + one MeshStandardMaterial keeps the low tier at one
 * draw call plus its shadow pass. Origin at the feet (y = 0 is the floor); faces -Z, like the human avatar.
 *
 * PLACEHOLDER LOOK: plain grey coat, breed and coat pattern pending the Owner (#854). Four-legged and
 * realistic in proportion (Stray-like reference, nothing copied): no clothing, no collar, never upright.
 * The three styles are scale/finish variants of the same animal: A real scale, B 1.15x and the default
 * (phone readability), C the same size as B with subtle mackerel tabby stripes.
 *
 * Anatomy: the torso, neck and skull are ONE loft from rump to nose (elliptical sections along a spline,
 * capped), so no part is a primitive joined end to end and every limb starts inside its parent's mass.
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
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function linear(hex: number): readonly [number, number, number] {
  // The hex constructor already converts sRGB -> linear working space (#856); never convert twice.
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

const BACK = linear(0x7f7a75);
const FLANK = linear(0x9a948e);
const BELLY = linear(0xc8c2ba);
const NOSE = linear(0xb88e8c);
const INNER_EAR = linear(0xc9a3a0);
const EYE = linear(0xa39a52);
const PUPIL = linear(0x141210);
const STRIPE = linear(0x5e5953);

type Rgb = readonly [number, number, number];
const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const bar = (u: number, period: number): number => Math.pow(0.5 + 0.5 * Math.cos((u / period) * TAU), 8);
const fract = (x: number): number => x - Math.floor(x);

/** Uniform Catmull-Rom through four values. */
function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/* ------------------------------------------------------------------------------------------ */
/* body sections (style A, real scale, metres)                                                 */
/* ------------------------------------------------------------------------------------------ */

/** One cross-section of the body loft: centre height `y`, full height `h`, full width `w`, at body-z. */
export interface CatSection {
  readonly z: number;
  readonly y: number;
  readonly h: number;
  readonly w: number;
}

/**
 * Torso + neck + skull + muzzle as one loft, rump (+z) to nose (-z). Level back, belly clearance ~0.12 m
 * (chest station bottom), shoulders above the deep chest, head carried high.
 */
export const CAT_BODY_SECTIONS: readonly CatSection[] = [
  { z: -0.335, y: 0.250, h: 0.040, w: 0.045 }, // muzzle
  { z: -0.285, y: 0.265, h: 0.075, w: 0.085 }, // skull
  { z: -0.230, y: 0.245, h: 0.070, w: 0.070 }, // neck
  { z: -0.180, y: 0.205, h: 0.110, w: 0.095 }, // shoulder
  { z: -0.140, y: 0.190, h: 0.135, w: 0.100 }, // chest
  { z: 0.020, y: 0.205, h: 0.100, w: 0.090 }, // waist
  { z: 0.130, y: 0.200, h: 0.125, w: 0.115 }, // haunch
  { z: 0.220, y: 0.200, h: 0.090, w: 0.080 }, // rump
];

/* ------------------------------------------------------------------------------------------ */
/* level of detail                                                                             */
/* ------------------------------------------------------------------------------------------ */

interface Detail {
  bodySeg: number;
  bodyRings: number;
  legSeg: number;
  legRings: number;
  pawSeg: number;
  pawRings: number;
  earSeg: number;
  eyeSeg: number;
  tailSeg: number;
  tailRings: number;
}

const DETAIL: Record<"low" | "high", Detail> = {
  high: { bodySeg: 26, bodyRings: 44, legSeg: 9, legRings: 13, pawSeg: 9, pawRings: 5, earSeg: 7, eyeSeg: 9, tailSeg: 10, tailRings: 16 },
  low: { bodySeg: 14, bodyRings: 24, legSeg: 6, legRings: 8, pawSeg: 6, pawRings: 3, earSeg: 5, eyeSeg: 6, tailSeg: 6, tailRings: 10 },
};

/* ------------------------------------------------------------------------------------------ */
/* styles                                                                                      */
/* ------------------------------------------------------------------------------------------ */

interface CatProfile {
  /** Uniform scale of the whole rig: B and C are 1.15x the real-scale A. */
  readonly scale: number;
  /** Mackerel tabby bars painted into the vertex colours (style C only). */
  readonly stripes: boolean;
}

const PROFILES: Record<CatStyle, CatProfile> = {
  // Real scale, plain grey.
  A: { scale: 1, stripes: false },
  // 1.15x, plain grey: readable on a phone; the default.
  B: { scale: 1.15, stripes: false },
  // Same size as B, subtle mackerel tabby stripes.
  C: { scale: 1.15, stripes: true },
};

/* ------------------------------------------------------------------------------------------ */
/* rig constants (style A, real scale, metres; the root scales B and C)                        */
/* ------------------------------------------------------------------------------------------ */

const HIPS_Y = 0.202;
const HIPS_Z = 0.13;

/** Trunk bone rest positions, each relative to the previous bone. */
const SPINE_STEPS: readonly (readonly [number, number, number])[] = [
  [0, 0.002, -0.07], // spine1
  [0, 0.0, -0.07], // spine2
  [0, 0.004, -0.07], // spine3
  [0, 0.014, -0.085], // neck
  [0, 0.043, -0.09], // head
];

/** Foreleg: shoulder joint, wrist target and the two IK segments (upper arm, forearm). */
const FORE = { x: 0.032, shoulderY: 0.213, shoulderZ: -0.16, wristY: 0.045, wristZ: -0.15, l1: 0.09, l2: 0.1, rTop: 0.024, rMid: 0.016, rEnd: 0.012 };
/** Hind leg: hip joint, hock target and the IK segments (thigh, shin). The metatarsus rides the paw bone. */
const HIND = { x: 0.045, hipY: 0.212, hipZ: 0.13, hockY: 0.082, hockZ: 0.145, l1: 0.11, l2: 0.12, rTop: 0.034, rMid: 0.018, rEnd: 0.012, meta: 0.07 };
/** Flat paw: 0.026 wide, 0.012 tall, 0.034 long, flush with the leg end. */
const FOOT = { rx: 0.013, ry: 0.006, rz: 0.017, top: 0.012 };
/** Ear shell: 0.04 tall, 0.035 wide, buried 0.012 m at the base. */
const EAR = { h: 0.04, w: 0.035, bury: 0.012, x: 0.028, y: 0.288, z: -0.272, out: 0.3, back: 0.18 };
/** Slanted flat eye, 0.011 radius, 0.026 m off centre, protruding under 0.004 m. */
const EYE_AT = { z: -0.3, r: 0.011, out: 0.026, up: 0.35, slant: 0.3 };

/** Tail: 0.28 m leaving the rump slightly downwards, gentle S with the tip lifted. */
const TAIL_PATH: readonly (readonly [number, number, number])[] = [
  [0, 0.205, 0.205],
  [0, 0.187, 0.273],
  [0, 0.195, 0.339],
  [0, 0.225, 0.399],
  [0, 0.27, 0.444],
];
const TAIL_RADII: readonly (readonly [number, number])[] = [
  [0.016, 0.016],
  [0.0145, 0.0145],
  [0.013, 0.013],
  [0.0115, 0.0115],
  [0.01, 0.01],
];

/**
 * Sit: rump on the floor with the forelegs straight and vertical under the shoulders. With this body (0.29 m
 * hips->shoulder) and foreleg (0.19 m) that is a 29 deg spine incline; a steeper spine would lift the front
 * paws off the floor or bend the forelegs.
 */
const SIT_INCLINE = 0.506;
const SIT_DROP = 0.117;

/* ------------------------------------------------------------------------------------------ */
/* bone indices                                                                                */
/* ------------------------------------------------------------------------------------------ */

const HIPS = 0;
const SPINE1 = 1;
const SPINE2 = 2;
const SPINE3 = 3;
const NECK = 4;
const HEAD = 5;
const EAR_L = 6;
const EAR_R = 7;
const TAIL1 = 8;
const LEG_FL = 12;
const LEG_FR = 15;
const LEG_HL = 18;
const LEG_HR = 21;

type Weights = readonly (readonly [number, number])[];

/* ------------------------------------------------------------------------------------------ */
/* geometry helpers                                                                            */
/* ------------------------------------------------------------------------------------------ */

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

/** Flip the triangles if the closed surface ended up inside-out, so no part can vanish under FrontSide. */
function orientOutward(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const index = g.getIndex();
  if (!index) return g;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  let vol = 0;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
    const cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);
    vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  if (vol < 0) flipWinding(g);
  return g;
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
  for (const g of list) if (!g.hasAttribute("normal")) g.computeVertexNormals();
  const merged = mergeGeometries(list.map(prep), false);
  if (!merged) throw new Error("cat avatar: geometry merge failed");
  for (const g of list) g.dispose();
  return merged;
}

/** Sample the section table: linear in z (so rings never cross), smooth in y/h/w. */
function sampleSections(st: readonly CatSection[], rings: number): CatSection[] {
  const out: CatSection[] = [];
  const n = st.length;
  for (let i = 0; i < rings; i++) {
    const u = (i / (rings - 1)) * (n - 1);
    const seg = Math.min(n - 2, Math.floor(u));
    const t = u - seg;
    const p0 = st[Math.max(0, seg - 1)]!;
    const p1 = st[seg]!;
    const p2 = st[seg + 1]!;
    const p3 = st[Math.min(n - 1, seg + 2)]!;
    out.push({
      z: lerp(p1.z, p2.z, t),
      y: catmull(p0.y, p1.y, p2.y, p3.y, t),
      h: catmull(p0.h, p1.h, p2.h, p3.h, t),
      w: catmull(p0.w, p1.w, p2.w, p3.w, t),
    });
  }
  return out;
}

/** Section lookup by body-z, for painting and for placing face parts on the surface. */
function sectionLookup(rings: readonly CatSection[]): (z: number) => CatSection {
  return (z: number): CatSection => {
    if (z <= rings[0]!.z) return rings[0]!;
    for (let i = 1; i < rings.length; i++) {
      const b = rings[i]!;
      if (b.z >= z) {
        const a = rings[i - 1]!;
        const d = b.z - a.z;
        const t = d > 1e-9 ? (z - a.z) / d : 0;
        return { z, y: lerp(a.y, b.y, t), h: lerp(a.h, b.h, t), w: lerp(a.w, b.w, t) };
      }
    }
    return rings[rings.length - 1]!;
  };
}

/** Closed loft through elliptical sections, with a rounded cap beyond each end. */
function loft(rings: readonly CatSection[], segs: number, capFront: number, capBack: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const n = rings.length;
  for (let i = 0; i < n; i++) {
    const s = rings[i]!;
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * TAU;
      positions.push(Math.cos(a) * (s.w / 2), s.y + Math.sin(a) * (s.h / 2), s.z);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      const a = i * segs + j;
      const b = i * segs + j1;
      const c = (i + 1) * segs + j1;
      const d = (i + 1) * segs + j;
      indices.push(a, c, b, a, d, c);
    }
  }
  const front = rings[0]!;
  const back = rings[n - 1]!;
  const fIdx = positions.length / 3;
  positions.push(0, front.y - front.h * 0.12, front.z - capFront);
  for (let j = 0; j < segs; j++) indices.push(fIdx, (j + 1) % segs, j);
  const bIdx = positions.length / 3;
  positions.push(0, back.y + back.h * 0.06, back.z + capBack);
  const base = (n - 1) * segs;
  for (let j = 0; j < segs; j++) indices.push(bIdx, base + j, base + (j + 1) % segs);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  return orientOutward(g);
}

/**
 * Closed swept tube along a smooth path with elliptical cross-sections. Weights and colours are given per
 * station parameter `u` (0 at the first point, 1 at the last), so limbs blend across their joints.
 */
function sweep(
  path: readonly THREE.Vector3[],
  radii: readonly (readonly [number, number])[],
  segs: number,
  rings: number,
  ref: THREE.Vector3,
  colorAt: (u: number, x: number, y: number, z: number) => Rgb,
  weightsAt: (u: number) => Weights,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(path.map((p) => p.clone()), false, "centripetal");
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const us: number[] = [];
  const radiusAt = (u: number): readonly [number, number] => {
    const t = clamp(u, 0, 1) * (radii.length - 1);
    const i = Math.min(radii.length - 2, Math.floor(t));
    const f = t - i;
    const a = radii[i]!;
    const b = radii[i + 1]!;
    return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
  };
  const p = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const n1 = new THREE.Vector3();
  const n2 = new THREE.Vector3();
  for (let i = 0; i < rings; i++) {
    const u = i / (rings - 1);
    curve.getPointAt(u, p);
    curve.getTangentAt(u, tangent);
    n1.copy(ref).cross(tangent);
    if (n1.lengthSq() < 1e-8) n1.set(1, 0, 0);
    n1.normalize();
    n2.copy(tangent).cross(n1).normalize();
    const [ra, rb] = radiusAt(u);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * TAU;
      const x = p.x + n1.x * ra * Math.cos(a) + n2.x * rb * Math.sin(a);
      const y = p.y + n1.y * ra * Math.cos(a) + n2.y * rb * Math.sin(a);
      const z = p.z + n1.z * ra * Math.cos(a) + n2.z * rb * Math.sin(a);
      positions.push(x, y, z);
      const c = colorAt(u, x, y, z);
      colors.push(c[0], c[1], c[2]);
      us.push(u);
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      const a = i * segs + j;
      const b = i * segs + j1;
      const c = (i + 1) * segs + j1;
      const d = (i + 1) * segs + j;
      indices.push(a, c, b, a, d, c);
    }
  }
  const firstU = 0;
  const lastU = 1;
  const capStart = positions.length / 3;
  const head = curve.getPointAt(0);
  const headTan = curve.getTangentAt(0);
  const r0 = radiusAt(0);
  positions.push(head.x - headTan.x * r0[0] * 0.6, head.y - headTan.y * r0[0] * 0.6, head.z - headTan.z * r0[0] * 0.6);
  const c0 = colorAt(firstU, 0, 0, 0);
  colors.push(c0[0], c0[1], c0[2]);
  us.push(firstU);
  for (let j = 0; j < segs; j++) indices.push(capStart, (j + 1) % segs, j);
  const capEnd = positions.length / 3;
  const tail = curve.getPointAt(1);
  const tailTan = curve.getTangentAt(1);
  const r1 = radiusAt(1);
  positions.push(tail.x + tailTan.x * r1[0] * 0.6, tail.y + tailTan.y * r1[0] * 0.6, tail.z + tailTan.z * r1[0] * 0.6);
  const c1 = colorAt(lastU, 0, 0, 0);
  colors.push(c1[0], c1[1], c1[2]);
  us.push(lastU);
  const base = (rings - 1) * segs;
  for (let j = 0; j < segs; j++) indices.push(capEnd, base + j, base + ((j + 1) % segs));

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  orientOutward(g);

  const indices4 = new Uint16Array((positions.length / 3) * 4);
  const weights4 = new Float32Array((positions.length / 3) * 4);
  for (let i = 0; i < positions.length / 3; i++) {
    const list = weightsAt(us[i]!);
    for (let k = 0; k < 4; k++) {
      indices4[i * 4 + k] = list[k]?.[0] ?? 0;
      weights4[i * 4 + k] = list[k]?.[1] ?? 0;
    }
  }
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices4, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights4, 4));
  return g;
}

function ellipsoid(rx: number, ry: number, rz: number, x: number, y: number, z: number, seg: number, rings: number, quat?: THREE.Quaternion): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg, rings);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    quat ?? new THREE.Quaternion(),
    new THREE.Vector3(rx, ry, rz),
  );
  g.applyMatrix4(m);
  return g;
}

/** Joint position of the middle of a two-bone chain, same analytic solution the IK uses. */
function chainJoint(a: THREE.Vector3, b: THREE.Vector3, l1: number, l2: number, bendSign: number): THREE.Vector3 {
  const d = b.clone().sub(a);
  const dist = clamp(d.length(), Math.abs(l1 - l2) + 0.015, (l1 + l2) * 0.999);
  const dir = d.normalize();
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const ang = Math.acos(clamp(cosA, -1, 1));
  const bend = new THREE.Vector3(0, 0, bendSign);
  bend.addScaledVector(dir, -bend.dot(dir));
  if (bend.lengthSq() < 1e-8) bend.set(1, 0, 0);
  bend.normalize();
  return a.clone().addScaledVector(dir, Math.cos(ang) * l1).addScaledVector(bend, Math.sin(ang) * l1);
}

/* ------------------------------------------------------------------------------------------ */
/* gait                                                                                        */
/* ------------------------------------------------------------------------------------------ */

// Strides are fitted to the 0.19 m foreleg: the paw target never exceeds the leg's reach at either extreme.
const WALK_GAIT = { beta: 0.6, stride: 0.2, lift: 0.03 };
const TROT_GAIT = { beta: 0.42, stride: 0.3, lift: 0.045 };
const RUN_GAIT = { beta: 0.3, stride: 0.42, lift: 0.07 };

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
  /** Standing ground contact height of this leg's chain end (wrist at the front, hock at the hind). */
  groundY: number;
  baseZ: number;
  /** Index of this leg's upper bone; lower and paw follow at +1 and +2. */
  boneBase: number;
  /** Rest joints in root space, for the geometry. */
  top: THREE.Vector3;
  mid: THREE.Vector3;
  end: THREE.Vector3;
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
  private readonly rings: readonly CatSection[];
  private readonly sectionAt: (z: number) => CatSection;
  private readonly hips: THREE.Bone;
  private readonly spine1: THREE.Bone;
  private readonly spine2: THREE.Bone;
  private readonly spine3: THREE.Bone;
  private readonly neck: THREE.Bone;
  private readonly head: THREE.Bone;
  private readonly earL: THREE.Bone;
  private readonly earR: THREE.Bone;
  private readonly fade = { value: 1 };

  private readonly hipsBase = new THREE.Vector3(0, HIPS_Y, HIPS_Z);

  private time = 0;
  private phase = 0;
  private speed = 0;
  private speedVel = 0;
  private idle = 0;
  private sit = 0;
  private disposed = false;
  /** Idle head look-around: current yaw, the yaw it is easing to, and when to pick the next one. */
  private lookYaw = 0;
  private lookTarget = 0;
  private lookNext = 2.5;
  /** Per-ear flick: when the current flick ends and when the next one is due. */
  private readonly earFlick = [
    { until: -1, next: 1.9 },
    { until: -1, next: 3.7 },
  ];

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
  private readonly m4 = new THREE.Matrix4();
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
    this.root.scale.setScalar(p.scale);
    this.rings = sampleSections(CAT_BODY_SECTIONS, d.bodyRings);
    this.sectionAt = sectionLookup(this.rings);

    // Trunk: hips -> spine -> neck -> head, each bone a child of the last.
    this.hips = this.bone("hips", null, 0, HIPS_Y, HIPS_Z);
    this.spine1 = this.bone("spine1", this.hips, ...SPINE_STEPS[0]!);
    this.spine2 = this.bone("spine2", this.spine1, ...SPINE_STEPS[1]!);
    this.spine3 = this.bone("spine3", this.spine2, ...SPINE_STEPS[2]!);
    this.neck = this.bone("neck", this.spine3, ...SPINE_STEPS[3]!);
    this.head = this.bone("head", this.neck, ...SPINE_STEPS[4]!);
    // Ear bones pivot at each ear's base, so an idle twitch moves only that ear.
    this.earL = this.bone("earL", this.head, -EAR.x, EAR.y - 0.265, EAR.z + 0.255);
    this.earR = this.bone("earR", this.head, EAR.x, EAR.y - 0.265, EAR.z + 0.255);

    // Tail: four bones following the S-path, the first rooted inside the rump.
    let parent: THREE.Bone = this.hips;
    for (let i = 0; i < 4; i++) {
      const node = TAIL_PATH[i]!;
      const prev = i === 0 ? [0, HIPS_Y, HIPS_Z] : TAIL_PATH[i - 1]!;
      const bone = this.bone(`tail${i + 1}`, parent, node[0] - prev[0], node[1] - prev[1], node[2] - prev[2]);
      this.tail.push(bone);
      parent = bone;
    }

    // Legs: bones first (rest chain solved analytically), then geometry along the solved joints.
    const legDefs: readonly (readonly [Leg["key"], -1 | 1, boolean, number])[] = [
      ["FL", -1, true, LEG_FL], ["FR", 1, true, LEG_FR], ["HL", -1, false, LEG_HL], ["HR", 1, false, LEG_HR],
    ];
    for (const [key, side, front, index] of legDefs) this.makeLeg(key, side, front, index);

    this.geometry = this.buildGeometry();
    // Transparent so the cat renders in the transparent pass: opaque would place it before the route's
    // always-on-top overlays (the dashed amber "not modelled" band, depthTest:false, renderOrder 21).
    // Those paint over anything opaque drawn earlier, so a 0.34 m cat standing inside one vanishes under the
    // tint. Drawn last in the transparent pass instead, the cat overwrites them while still writing depth, so
    // real geometry in front of it (glass, walls) still hides it. Human avatar and overlay look unchanged.
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, envMapIntensity: 0.6, transparent: true, depthWrite: true });
    ditherFade(this.material, this.fade);
    this.mesh = new THREE.SkinnedMesh(this.geometry, this.material);
    this.mesh.name = "cat-body";
    this.mesh.renderOrder = 30;
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

  /** Creates one leg's three bones and poses the rest chain exactly as the IK will at the standing target. */
  private makeLeg(key: Leg["key"], side: -1 | 1, front: boolean, index: number): void {
    const parent = front ? this.spine3 : this.hips;
    // spine3 sits at (0, HIPS_Y + 0.006, HIPS_Z - 0.21); the hips at (0, HIPS_Y, HIPS_Z).
    const parentY = front ? HIPS_Y + 0.006 : HIPS_Y;
    const parentZ = front ? HIPS_Z - 0.21 : HIPS_Z;
    const top = new THREE.Vector3(side * (front ? FORE.x : HIND.x), front ? FORE.shoulderY : HIND.hipY, front ? FORE.shoulderZ : HIND.hipZ);
    const end = new THREE.Vector3(side * (front ? FORE.x : HIND.x), front ? FORE.wristY : HIND.hockY, front ? FORE.wristZ : HIND.hockZ);
    const l1 = front ? FORE.l1 : HIND.l1;
    const l2 = front ? FORE.l2 : HIND.l2;
    const mid = chainJoint(top, end, l1, l2, front ? 1 : -1);
    const upper = this.bone(`upper${key}`, parent, top.x, top.y - parentY, top.z - parentZ);
    const lower = this.bone(`lower${key}`, upper, 0, -l1, 0);
    const paw = this.bone(`paw${key}`, lower, 0, -l2, 0);
    // Rest quaternions = the solved chain, so the bind pose is the standing pose (no pop on the first update).
    const du = mid.clone().sub(top).normalize();
    const dl = end.clone().sub(mid).normalize();
    const qu = this.basisQuat(du, new THREE.Quaternion());
    const ql = this.basisQuat(dl, new THREE.Quaternion());
    upper.quaternion.copy(qu);
    lower.quaternion.copy(qu.clone().invert().multiply(ql));
    paw.quaternion.copy(ql.clone().invert());
    this.legs.push({
      key, side, front, parent, upper, lower, paw, l1, l2,
      boneBase: index,
      baseX: side * (front ? FORE.x : HIND.x),
      groundY: front ? FORE.wristY : HIND.hockY,
      baseZ: front ? FORE.wristZ : HIND.hockZ,
      top, mid, end,
      walk: key === "FL" ? 0.25 : key === "FR" ? 0.75 : key === "HL" ? 0 : 0.5,
      trot: key === "FL" || key === "HR" ? 0.5 : 0,
      run: key === "HL" || key === "HR" ? 0.5 : 0,
    });
  }

  /* ----- construction ----------------------------------------------------------------------- */

  private buildGeometry(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    this.buildBody(parts);
    this.buildFace(parts);
    this.buildLegs(parts);
    this.buildTail(parts);
    if (this.bones.length !== 24) throw new Error(`cat avatar: expected 24 bones, got ${this.bones.length}`);
    return mergeParts(parts);
  }

  private coat(x: number, y: number, z: number): Rgb {
    const sec = this.sectionAt(z);
    const ny = clamp((y - sec.y) / (sec.h / 2), -1, 1);
    // Soft gradient by height, no hard bands: pale belly, mid flanks, darker back.
    let c = mix(BELLY, FLANK, smoothstep(-0.85, 0.05, ny));
    c = mix(c, BACK, smoothstep(0.05, 0.85, ny));
    const chest = 0.7 * smoothstep(-0.1, -0.17, z) * smoothstep(0.05, -0.55, ny);
    c = mix(c, BELLY, chest);
    const muzzle = 0.85 * smoothstep(-0.292, -0.33, z);
    c = mix(c, BELLY, muzzle);
    if (this.p.stripes) c = mix(c, STRIPE, 0.42 * bar(z, 0.09) * smoothstep(-0.2, 0.5, ny) * (1 - muzzle));
    return c;
  }

  private buildBody(parts: THREE.BufferGeometry[]): void {
    const body = loft(this.rings, this.d.bodySeg, 0.014, 0.03);
    paint(body, (x, y, z) => this.coat(x, y, z));
    skinGeometry(body, (_x, _y, z) => trunkWeights(z));
    parts.push(body);
  }

  private buildFace(parts: THREE.BufferGeometry[]): void {
    // Nose: a small dusty-rose triangle at the muzzle tip.
    const tip = this.sectionAt(-0.338);
    const nose = new THREE.ConeGeometry(0.011, 0.013, 3);
    nose.deleteAttribute("uv");
    nose.deleteAttribute("normal");
    nose.rotateX(Math.PI); // apex down
    nose.scale(1, 0.9, 0.55);
    nose.rotateX(-0.5);
    nose.translate(0, tip.y + 0.004, tip.z - 0.006);
    paint(nose, () => NOSE);
    rigid(nose, HEAD);
    parts.push(nose);

    // Eyes: flat slanted ellipses on the skull surface with a vertical pupil.
    const sec = this.sectionAt(EYE_AT.z);
    const a = sec.w / 2;
    const b = sec.h / 2;
    for (const side of [-1, 1] as const) {
      const nx = Math.sqrt(1 - EYE_AT.up * EYE_AT.up);
      const surf = new THREE.Vector3(side * nx * a, sec.y + EYE_AT.up * b, EYE_AT.z);
      const normal = new THREE.Vector3((side * nx) / (a * a), EYE_AT.up / (b * b), 0).normalize();
      const disc = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      const slant = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -side * EYE_AT.slant);
      const centre = surf.clone().addScaledVector(normal, -0.002);
      const iris = ellipsoid(EYE_AT.r, EYE_AT.r * 0.78, 0.0035, centre.x, centre.y, centre.z, this.d.eyeSeg, Math.max(4, Math.round(this.d.eyeSeg * 0.6)), disc.clone().multiply(slant));
      paint(iris, () => EYE);
      rigid(iris, HEAD);
      parts.push(iris);
      const pupilAt = surf.clone().addScaledVector(normal, 0.0016);
      const pupil = ellipsoid(0.0035, 0.0095, 0.002, pupilAt.x, pupilAt.y, pupilAt.z, this.d.eyeSeg, Math.max(4, Math.round(this.d.eyeSeg * 0.6)), disc);
      paint(pupil, () => PUPIL);
      rigid(pupil, HEAD);
      parts.push(pupil);
    }

    // Ears: thin triangular shells buried at the base, grey outside, dusty rose inside.
    for (const side of [-1, 1] as const) {
      const bone = side < 0 ? EAR_L : EAR_R;
      parts.push(this.ear(side, 1, EAR.x * side, EAR.y, EAR.z, BACK, 0, bone));
      parts.push(this.ear(side, 0.72, EAR.x * side, EAR.y, EAR.z - 0.0025, INNER_EAR, 0.002, bone));
    }
  }

  private ear(side: -1 | 1, scale: number, x: number, y: number, z: number, color: Rgb, zOff: number, bone: number): THREE.BufferGeometry {
    const h = EAR.h * scale;
    const g = new THREE.ConeGeometry(EAR.w * 0.5 * scale, h, this.d.earSeg, 1, false);
    g.deleteAttribute("uv");
    g.deleteAttribute("normal");
    g.scale(1, 1, 0.22);
    g.translate(0, h / 2 - EAR.bury, zOff);
    g.rotateZ(-side * EAR.out);
    g.rotateX(-EAR.back);
    g.translate(x, y, z);
    paint(g, () => color);
    rigid(g, bone);
    return g;
  }

  private buildLegs(parts: THREE.BufferGeometry[]): void {
    for (const leg of this.legs) {
      const upperBone = leg.boneBase;
      const lowerBone = upperBone + 1;
      const pawBone = upperBone + 2;
      const r = leg.front ? FORE : HIND;
      const path = [leg.top.clone(), leg.mid.clone(), leg.end.clone()];
      const radii: readonly (readonly [number, number])[] = [
        [r.rTop, r.rTop],
        [r.rMid, r.rMid],
        [r.rEnd, r.rEnd],
      ];
      const joint = leg.front ? FORE.l1 / (FORE.l1 + FORE.l2) : HIND.l1 / (HIND.l1 + HIND.l2);
      const legGeo = sweep(
        path,
        radii,
        this.d.legSeg,
        this.d.legRings,
        new THREE.Vector3(0, 0, 1),
        (u) => {
          let c = mix(FLANK, BELLY, smoothstep(0.2, 1, u));
          if (this.p.stripes) c = mix(c, STRIPE, 0.35 * bar(u * 1.6, 0.22));
          return c;
        },
        (u) => {
          const d = 0.12;
          if (u < joint - d) return [[upperBone, 1]];
          if (u < joint + d) {
            const t = (u - (joint - d)) / (2 * d);
            return [[upperBone, 1 - t], [lowerBone, t]];
          }
          return [[lowerBone, 1]];
        },
      );
      parts.push(legGeo);

      // Paw bone: a short leg-coloured taper from the wrist (front) or hock (hind) into the flat paw.
      const toe = leg.end.z - 0.004;
      const ankle = new THREE.Vector3(leg.end.x, FOOT.top - 0.001, toe);
      const pawTaper = sweep(
        [leg.end.clone(), ankle],
        [
          [r.rEnd, r.rEnd],
          [0.008, 0.008],
        ],
        this.d.legSeg,
        Math.max(3, Math.round(this.d.legRings * 0.4)),
        new THREE.Vector3(0, 0, 1),
        (u) => mix(FLANK, BELLY, smoothstep(0.3, 1, u)),
        () => [[pawBone, 1]],
      );
      parts.push(pawTaper);

      // Flat paw: a squashed ellipsoid flush with the taper, toes forward, pale on top.
      const foot = ellipsoid(FOOT.rx, FOOT.ry, FOOT.rz, leg.end.x, FOOT.ry, toe - 0.004, this.d.pawSeg, this.d.pawRings);
      paint(foot, (_x, y) => mix(BELLY, FLANK, 0.35 * smoothstep(0.006, 0.012, y)));
      rigid(foot, pawBone);
      parts.push(foot);
    }
  }

  private buildTail(parts: THREE.BufferGeometry[]): void {
    const path = TAIL_PATH.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const tail = sweep(
      path,
      TAIL_RADII,
      this.d.tailSeg,
      this.d.tailRings,
      new THREE.Vector3(0, 1, 0),
      (u) => {
        // Grey tail, slightly darker towards the tip; C adds faint tabby rings.
        let c = shade(BACK, 1 - 0.12 * smoothstep(0.55, 1, u));
        if (this.p.stripes) c = mix(c, STRIPE, 0.4 * bar(u * 4, 0.18));
        return c;
      },
      (u) => {
        const t = u * 4;
        const i = Math.min(3, Math.floor(t));
        const f = t - i;
        const w = 0.5 * smoothstep(0.5, 1, f);
        return i < 3 ? [[TAIL1 + i, 1 - w], [TAIL1 + i + 1, w]] : [[TAIL1 + 3, 1]];
      },
    );
    parts.push(tail);
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
    // ~0.6 s from stand to sit and back.
    this.sit = clamp(this.sit + clamp(sitTarget - this.sit, -step * 1.7, step * 1.7), 0, 1);

    const moving = smoothstep(0.02, 0.25, s);
    const wWalk = 1 - smoothstep(0.85, 1.2, s);
    const wRun = smoothstep(2.0, 2.4, s);
    const wTrot = Math.max(0, 1 - wWalk - wRun);
    const stride = WALK_GAIT.stride * wWalk + TROT_GAIT.stride * wTrot + RUN_GAIT.stride * wRun;
    this.phase = (this.phase + (s * step) / Math.max(stride, 0.12)) % 1;
    const t = this.time;
    const breathe = Math.sin(TAU * 0.3 * t);

    // Body: a little bob and undulation on the move, breathing at rest, rump on the floor when sitting.
    const bob = moving * 0.008 * Math.cos(4 * Math.PI * this.phase);
    this.hips.position.set(this.hipsBase.x, this.hipsBase.y + bob - SIT_DROP * this.sit, this.hipsBase.z);
    const lean = 0.03 * moving;
    this.hips.rotation.set(lean + SIT_INCLINE * this.sit + 0.004 * breathe * (1 - moving), 0.03 * Math.sin(TAU * this.phase) * moving, 0.02 * Math.sin(TAU * this.phase) * moving, "YXZ");
    this.spine1.rotation.set(-0.015 * moving + 0.01 * breathe * (1 - moving), 0.04 * Math.sin(TAU * this.phase + 0.6) * moving, 0, "YXZ");
    this.spine2.rotation.set(-0.02 * moving + 0.014 * breathe * (1 - moving), 0.03 * Math.sin(TAU * this.phase + 1.1) * moving, 0, "YXZ");
    this.spine3.rotation.set(-0.02 * moving, 0.02 * Math.sin(TAU * this.phase + 1.6) * moving, 0, "YXZ");
    // Idle look-around: a new head yaw in +-35 degrees every 3-6 s, eased into place; the neck follows a third.
    if (t >= this.lookNext) {
      this.lookTarget = (2 * fract(Math.sin(t * 7.7) * 43758.5453) - 1) * 0.61;
      this.lookNext = t + 3 + 3 * fract(Math.sin(t * 12.9) * 24634.6345);
    }
    this.lookYaw = clamp(this.lookYaw + (this.lookTarget - this.lookYaw) * Math.min(1, step * 4), -0.61, 0.61);
    const look = this.lookYaw * (1 - moving);
    // Keep the head level while the spine inclines into the sit.
    this.neck.rotation.set(-0.52 * this.hips.rotation.x + 0.03 * Math.sin(t * 0.7) * (1 - moving), 0.3 * look, 0, "YXZ");
    this.head.rotation.set(-0.32 * this.hips.rotation.x + 0.05 * Math.sin(t * 0.9 + 1) * (1 - moving), look, 0, "YXZ");

    // Ear flick: a quick 0.2 s twitch of one ear every 3-6 s while standing still.
    for (let i = 0; i < 2; i++) {
      const flick = this.earFlick[i]!;
      if (t >= flick.next) {
        flick.until = t + 0.2;
        flick.next = t + 3 + 3 * fract(Math.sin(t * (5.1 + i)) * 15731.743);
      }
      const k = t < flick.until ? Math.sin((Math.PI * (t - (flick.until - 0.2))) / 0.2) : 0;
      const bone = i === 0 ? this.earL : this.earR;
      bone.rotation.set(0, 0, (i === 0 ? 1 : -1) * 0.3 * k * (1 - moving));
    }

    // Tail: slow idle sway, a travelling wave on the move, laid on the floor around one side when sitting.
    const sway = 0.16 * Math.sin(t * 1.1) * (1 - 0.5 * moving) + 0.09 * Math.sin(TAU * this.phase) * moving;
    // Sit: undo the spine's 0.506 rad incline, then lay the tail on the floor and curl it round one side.
    const sitPitch = [-0.3, -0.3, -0.1, -0.05];
    const sitYaw = [0.25, 0.3, 0.3, 0.25];
    for (let i = 0; i < 4; i++) {
      this.tail[i]!.rotation.set(
        0.04 * (1 - moving) * Math.sin(t * 0.7 + i) + sitPitch[i]! * this.sit,
        sway + 0.05 * Math.sin(t * 1.1 - i * 0.7) + sitYaw[i]! * this.sit,
        0,
      );
    }

    this.root.updateMatrixWorld(true);

    for (const leg of this.legs) {
      samplePaw(this.phase + leg.walk, WALK_GAIT.beta, WALK_GAIT.stride, WALK_GAIT.lift, this.sWalk);
      samplePaw(this.phase + leg.trot, TROT_GAIT.beta, TROT_GAIT.stride, TROT_GAIT.lift, this.sTrot);
      samplePaw(this.phase + leg.run, RUN_GAIT.beta, RUN_GAIT.stride, RUN_GAIT.lift, this.sRun);
      const f = (this.sWalk.f * wWalk + this.sTrot.f * wTrot + this.sRun.f * wRun) * moving;
      const lift = (this.sWalk.lift * wWalk + this.sTrot.lift * wTrot + this.sRun.lift * wRun) * moving;
      const swing = (this.sWalk.swing * wWalk + this.sTrot.swing * wTrot + this.sRun.swing * wRun) * moving;
      // Sitting: the fore paws come under the (raised, shifted) shoulders; the hind paws fold forward.
      const parentFrame = this.m4.copy(this.root.matrixWorld).invert().multiply(leg.parent.matrixWorld);
      const shoulder = this.v5.copy(leg.upper.position).applyMatrix4(parentFrame);
      const sitZ = leg.front ? shoulder.z : leg.baseZ - 0.1;
      const sitX = leg.baseX + (leg.front ? 0 : leg.side * 0.017);
      const z = lerp(leg.baseZ, sitZ, this.sit);
      const x = lerp(leg.baseX, sitX, this.sit);
      this.v1.set(x, leg.groundY + lift, z - f);
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

/** Trunk weights: smooth two-bone blends along z, hips to head. */
function trunkWeights(z: number): Weights {
  const zs = [HIPS_Z, 0.06, -0.01, -0.08, -0.165, -0.255];
  const bs = [HIPS, SPINE1, SPINE2, SPINE3, NECK, HEAD];
  if (z >= zs[0]!) return [[HIPS, 1]];
  for (let i = 0; i < 5; i++) {
    const hi = zs[i]!;
    const lo = zs[i + 1]!;
    if (z >= lo) {
      const t = (z - lo) / (hi - lo);
      return [[bs[i]!, t], [bs[i + 1]!, 1 - t]];
    }
  }
  return [[HEAD, 1]];
}
