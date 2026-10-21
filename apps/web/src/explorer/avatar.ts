import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Procedural third-person player avatar: a ~1.70 m modern Tokyo commuter (navy jacket over a light
 * hoodie, slim charcoal trousers, white sneakers, black daypack). Everything is built from smooth
 * procedural geometry (no assets, no textures) and animated by a procedural locomotion model:
 * idle -> walk -> run blended by speed, with two-bone IK legs so the stance foot never slides or
 * sinks. Origin is at the feet (y = 0 is the floor); the avatar faces -Z.
 */
export interface AvatarRig {
  readonly root: THREE.Group;
  /** speedMps: actual horizontal speed this frame (0 idle, ~1.45 walk, ~3.4 run). */
  update(dt: number, speedMps: number): void;
  setEnvMap(env: THREE.Texture | null, intensity?: number): void;
  dispose(): void;
}

export function createAvatar(opts?: { quality?: "low" | "high" }): AvatarRig {
  const quality = opts?.quality ?? "high";
  return new Avatar(DETAIL[quality]);
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

type Pt = readonly [number, number];

/** Smooth 1-D function through the given (x, y) knots (Catmull-Rom, then linear lookup). */
function tableFn(pts: readonly Pt[]): (x: number) => number {
  const sorted = [...pts].sort((a, b) => a[0] - b[0]);
  const curve = new THREE.SplineCurve(sorted.map(([x, y]) => new THREE.Vector2(x, y)));
  const s = curve.getPoints(200);
  return (x: number): number => {
    const first = s[0]!;
    if (x <= first.x) return first.y;
    for (let i = 1; i < s.length; i++) {
      const b = s[i]!;
      if (b.x >= x) {
        const a = s[i - 1]!;
        const d = b.x - a.x;
        return d > 1e-9 ? lerp(a.y, b.y, (x - a.x) / d) : b.y;
      }
    }
    return s[s.length - 1]!.y;
  };
}

/* ------------------------------------------------------------------------------------------ */
/* level of detail                                                                             */
/* ------------------------------------------------------------------------------------------ */

interface Detail {
  limbSeg: number;
  limbRings: number;
  cap: number;
  torsoSeg: number;
  torsoRings: number;
  shoeSeg: number;
  shoeRings: number;
  headSeg: number;
  headRings: number;
  clumpSeg: number;
  clumpRings: number;
  tubeSeg: number;
  tubeRadial: number;
  packSeg: number;
  handSeg: number;
}

const DETAIL: Record<"low" | "high", Detail> = {
  high: {
    limbSeg: 14, limbRings: 3, cap: 2,
    torsoSeg: 28, torsoRings: 13,
    shoeSeg: 14, shoeRings: 10,
    headSeg: 22, headRings: 15,
    clumpSeg: 8, clumpRings: 5,
    tubeSeg: 22, tubeRadial: 5,
    packSeg: 16,
    handSeg: 4,
  },
  low: {
    limbSeg: 8, limbRings: 2, cap: 1,
    torsoSeg: 14, torsoRings: 7,
    shoeSeg: 9, shoeRings: 6,
    headSeg: 12, headRings: 8,
    clumpSeg: 5, clumpRings: 3,
    tubeSeg: 8, tubeRadial: 3,
    packSeg: 8,
    handSeg: 3,
  },
};

/* ------------------------------------------------------------------------------------------ */
/* body dimensions (metres)                                                                    */
/* ------------------------------------------------------------------------------------------ */

const HIPS_Y = 0.945; // pelvis pivot height at the idle pose
const THIGH_X = 0.09; // lateral offset of each hip joint
const THIGH_DY = -0.04; // hip joint below the pelvis pivot
const L_THIGH = 0.435;
const L_SHIN = 0.405;
const ANKLE_H = 0.072; // ankle pivot height above the sole
const SPINE_DY = 0.065;
const CHEST_DY = 0.075;
const CHEST_Y = HIPS_Y + SPINE_DY + CHEST_DY; // 1.085, torso meshes are authored in world y minus this
const SHOULDER_X = 0.165;
const SHOULDER_DY = 0.3;
const NECK_DY = 0.375;
const HEAD_DY = 0.065;
const HEAD_CY = 0.05; // skull centre above the head pivot
const L_UPPER_ARM = 0.29;
const L_FOREARM = 0.26;
const TORSO_DEPTH = 0.72; // z radius / x radius of the torso cross-section

/* ------------------------------------------------------------------------------------------ */
/* geometry helpers                                                                            */
/* ------------------------------------------------------------------------------------------ */

/** Strip attributes the avatar does not use so geometries can be merged. */
function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.hasAttribute("uv")) g.deleteAttribute("uv");
  ensureColor(g);
  return g;
}

/** Per-vertex shading term (baked ambient occlusion / painted tone), in 0..1+. */
type Shade = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number;

function ensureColor(g: THREE.BufferGeometry): void {
  if (g.hasAttribute("color")) return;
  const n = g.getAttribute("position").count;
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
}

/** Multiply a baked shading term (optionally tinted, in linear RGB) into the geometry's vertex colours. */
function bake(g: THREE.BufferGeometry, fn: Shade | null, tint?: readonly [number, number, number]): THREE.BufferGeometry {
  ensureColor(g);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const nor = g.getAttribute("normal") as THREE.BufferAttribute;
  const col = g.getAttribute("color") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const v = fn ? fn(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i)) : 1;
    col.setXYZ(i, col.getX(i) * v * (tint ? tint[0] : 1), col.getY(i) * v * (tint ? tint[1] : 1), col.getZ(i) * v * (tint ? tint[2] : 1));
  }
  col.needsUpdate = true;
  return g;
}

function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(list.map(prep), false);
  if (!merged) throw new Error("avatar: geometry merge failed");
  for (const g of list) g.dispose();
  return merged;
}

/** Re-smooth a procedurally deformed (non-indexed-seam) geometry. */
function smoothed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  const m = mergeVertices(g, 1e-5);
  m.computeVertexNormals();
  g.dispose();
  return m;
}

function scaleXZ(g: THREE.BufferGeometry, sx: number, sz: number): void {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const nor = g.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, pos.getX(i) * sx);
    pos.setZ(i, pos.getZ(i) * sz);
    let nx = nor.getX(i) / sx;
    let nz = nor.getZ(i) / sz;
    const ny = nor.getY(i);
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    nz /= l;
    nor.setXYZ(i, nx, ny / l, nz);
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
  g.computeBoundingBox();
  g.computeBoundingSphere();
}

interface LatheSpec {
  /** [y, r] stations along the axis (any order). */
  stations: readonly Pt[];
  segs: number;
  rings: number;
  capSteps: number;
  /** Height of the rounded cap below the first / above the last station (0 = open end). */
  capBottom?: number;
  capTop?: number;
  sx?: number;
  sz?: number;
  phiStart?: number;
  phiLength?: number;
}

/** Lathe through a smooth radius profile with optional elliptical end caps. */
function lathe(spec: LatheSpec): THREE.BufferGeometry {
  const st = [...spec.stations].sort((a, b) => a[0] - b[0]);
  const curve = new THREE.SplineCurve(st.map(([y, r]) => new THREE.Vector2(r, y)));
  const body = curve.getSpacedPoints(Math.max(2, spec.rings));
  const first = st[0]!;
  const last = st[st.length - 1]!;
  const pts: THREE.Vector2[] = [];
  const cb = spec.capBottom ?? 0;
  const ct = spec.capTop ?? 0;
  if (cb > 0) {
    for (let i = 0; i < spec.capSteps; i++) {
      const a = (i / spec.capSteps) * (Math.PI / 2);
      pts.push(new THREE.Vector2(first[1] * Math.sin(a), first[0] - cb * Math.cos(a)));
    }
  }
  // Pin the ends of the sampled body exactly on the first / last stations.
  body[0] = new THREE.Vector2(first[1], first[0]);
  body[body.length - 1] = new THREE.Vector2(last[1], last[0]);
  pts.push(...body);
  if (ct > 0) {
    for (let i = 1; i <= spec.capSteps; i++) {
      const a = Math.PI / 2 - (i / spec.capSteps) * (Math.PI / 2);
      pts.push(new THREE.Vector2(last[1] * Math.sin(a), last[0] + ct * Math.cos(a)));
    }
  }
  const g = new THREE.LatheGeometry(pts, spec.segs, spec.phiStart ?? 0, spec.phiLength ?? TAU);
  if (spec.sx !== undefined || spec.sz !== undefined) scaleXZ(g, spec.sx ?? 1, spec.sz ?? 1);
  return g;
}

/** A tapered limb segment hanging from its pivot (y = 0) down to y = -length, ball-capped at both ends. */
function limb(d: Detail, length: number, rTop: number, rows: readonly Pt[], rBottom: number, bottomCap = rBottom): THREE.BufferGeometry {
  const stations: Pt[] = [[0, rTop], ...rows.map(([t, r]) => [-t * length, r] as Pt), [-length, rBottom]];
  return lathe({ stations, segs: d.limbSeg, rings: d.limbRings * 2, capSteps: d.cap, capTop: rTop, capBottom: bottomCap });
}

function ellipsoid(
  rx: number, ry: number, rz: number,
  x: number, y: number, z: number,
  seg: number, rings: number,
  rot: readonly [number, number, number] = [0, 0, 0],
): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg, rings);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], "YXZ")),
    new THREE.Vector3(rx, ry, rz),
  );
  g.applyMatrix4(m);
  return g;
}

/** Super-ellipsoid "rounded box" (L-p ball), smooth shaded. */
function roundedBox(hx: number, hy: number, hz: number, x: number, y: number, z: number, seg: number, p = 4.5, taperTop = 1): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.7)));
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i);
    const ny = pos.getY(i);
    const nz = pos.getZ(i);
    const m = (Math.abs(nx) ** p + Math.abs(ny) ** p + Math.abs(nz) ** p) ** (1 / p);
    const k = m > 1e-9 ? 1 / m : 1;
    const taper = lerp(1, taperTop, (ny * k + 1) / 2);
    pos.setXYZ(i, nx * k * hx * taper + x, ny * k * hy + y, nz * k * hz + z);
  }
  return smoothed(g);
}

interface ShoeSpec {
  zBack: number;
  zFront: number;
  yBottom: number;
  top: readonly Pt[];
  half: readonly Pt[];
  n: number;
  spring: number;
}

/** Foot-shaped super-ellipsoid; local origin is the ankle pivot, toe points to -Z. */
function shoeShape(d: Detail, s: ShoeSpec): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, d.shoeSeg, d.shoeRings);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  const topFn = tableFn(s.top);
  const halfFn = tableFn(s.half);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const sx = pos.getX(i);
    const sy = pos.getY(i); // length coordinate -1 (toe) .. 1 (heel)
    const sz = pos.getZ(i);
    const rho = Math.hypot(sx, sz);
    const ang = Math.atan2(sz, sx);
    const rs = (Math.abs(Math.cos(ang)) ** s.n + Math.abs(Math.sin(ang)) ** s.n) ** (-1 / s.n);
    const u = rho * rs * Math.cos(ang);
    const v = rho * rs * Math.sin(ang);
    const z = lerp(s.zFront, s.zBack, (sy + 1) / 2);
    const top = topFn(z);
    const hh = (top - s.yBottom) / 2;
    let y = (top + s.yBottom) / 2 + v * hh;
    if (z < -0.1) y += s.spring * (-0.1 - z) ** 2 * (v + 1) * 0.5;
    pos.setXYZ(i, u * halfFn(z), y, z);
  }
  return smoothed(g);
}

/** Flat webbing ribbon along a curve; `outward` gives the surface normal at each sample. */
function ribbon(points: readonly THREE.Vector3[], width: number, thick: number, samples: number, outward: (p: THREE.Vector3) => THREE.Vector3): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([...points], false, "centripetal");
  const radial = 8;
  const pos: number[] = [];
  const idx: number[] = [];
  const t = new THREE.Vector3();
  const n = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const p = curve.getPointAt(u);
    curve.getTangentAt(u, t);
    n.copy(outward(p));
    b.crossVectors(t, n).normalize();
    n.crossVectors(b, t).normalize();
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * TAU;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const cc = Math.sign(c) * Math.abs(c) ** 0.45;
      const ss = Math.sign(s) * Math.abs(s) ** 0.45;
      pos.push(
        p.x + b.x * cc * width * 0.5 + n.x * ss * thick * 0.5,
        p.y + b.y * cc * width * 0.5 + n.y * ss * thick * 0.5,
        p.z + b.z * cc * width * 0.5 + n.z * ss * thick * 0.5,
      );
    }
  }
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const bb = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const dd = (i + 1) * radial + ((j + 1) % radial);
      idx.push(a, c, bb, bb, c, dd);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tube(points: readonly THREE.Vector3[], radius: number, d: Detail, closed = false): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([...points], closed, "centripetal");
  return new THREE.TubeGeometry(curve, d.tubeSeg, radius, d.tubeRadial, closed);
}

/* ------------------------------------------------------------------------------------------ */
/* materials                                                                                   */
/* ------------------------------------------------------------------------------------------ */

function makeMaterials() {
  const std = (color: number, roughness: number, side: THREE.Side = THREE.FrontSide, metalness = 0): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, side, envMapIntensity: 0.6, vertexColors: true });
  return {
    skin: std(0xcfa283, 0.55),
    hair: std(0x2a2523, 0.72),
    jacket: std(0x26324b, 0.85, THREE.DoubleSide),
    shirt: std(0xc9ccd1, 0.88),
    trousers: std(0x2d3036, 0.86),
    pack: std(0x1e1f22, 0.82),
    sneaker: std(0xd8d8d4, 0.6),
    sole: std(0x6c6b66, 0.7),
    face: std(0xffffff, 0.5),
  };
}

type Materials = ReturnType<typeof makeMaterials>;

/* ------------------------------------------------------------------------------------------ */
/* rig                                                                                          */
/* ------------------------------------------------------------------------------------------ */

interface Leg {
  side: -1 | 1; // -1 = left (-X), +1 = right (+X)
  thigh: THREE.Group;
  knee: THREE.Group;
  foot: THREE.Group;
}

interface Arm {
  side: -1 | 1;
  shoulder: THREE.Group;
  upper: THREE.Group;
  elbow: THREE.Group;
  hand: THREE.Group;
}

interface FootSample {
  f: number; // forward offset of the contact reference relative to the hip axis (m)
  lift: number; // swing clearance (m)
  pitch: number; // toes-up positive (rad)
}

interface GroundSample {
  oy: number; // ankle height needed so the lowest sole point is on the floor
  zr: number; // z (rotated) of the contact reference relative to the ankle
}

// Sole contact landmarks relative to the ankle pivot: [z, y].
const SOLE_PTS: readonly Pt[] = [
  [0.07, -ANKLE_H],
  [-0.105, -ANKLE_H],
  [-0.172, -0.05],
];
const Z_FLAT = -0.02;

function groundSample(theta: number, out: GroundSample): void {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  let best = Infinity;
  let bz = 0;
  for (const [pz, py] of SOLE_PTS) {
    const yy = py * c - pz * s;
    if (yy < best) {
      best = yy;
      bz = py * s + pz * c;
    }
  }
  out.oy = -best;
  out.zr = lerp(Z_FLAT, bz, smoothstep(0, 0.1, Math.abs(theta)));
}

function sampleFoot(phi: number, beta: number, stride: number, w: number, out: FootSample): void {
  const p = phi - Math.floor(phi);
  const ths = lerp(0.3, 0.1, w);
  const toff = lerp(0.42, 0.5, w);
  const shift = 0;
  if (p < beta) {
    const u = p / beta;
    out.f = stride * (beta / 2 - p) + shift;
    out.lift = 0;
    out.pitch = ths * (1 - smoothstep(0, 0.22, u)) - toff * smoothstep(0.45, 1, u);
  } else {
    const q = (p - beta) / (1 - beta);
    const f0 = (-stride * beta) / 2;
    const f1 = (stride * beta) / 2;
    const m = -stride * (1 - beta);
    const q2 = q * q;
    const q3 = q2 * q;
    out.f = (2 * q3 - 3 * q2 + 1) * f0 + (q3 - 2 * q2 + q) * m + (-2 * q3 + 3 * q2) * f1 + (q3 - q2) * m + shift;
    out.lift = lerp(0.09, 0.26, w) * Math.sin(Math.PI * (q + 0.07 * Math.sin(TAU * q))) ** 1.2;
    out.pitch = lerp(-toff, ths, smoothstep(0.1, 0.9, q));
  }
}

const WALK_BETA = 0.6;
const RUN_BETA = 0.3;

class Avatar implements AvatarRig {
  readonly root = new THREE.Group();
  private readonly materials: Materials;
  private readonly hips = new THREE.Group();
  private readonly spine = new THREE.Group();
  private readonly chest = new THREE.Group();
  private readonly neck = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legs: Leg[] = [];
  private readonly arms: Arm[] = [];

  private time = 0;
  private phase = 0;
  private speed = 0;
  private speedVel = 0;

  // scratch
  private readonly foot: FootSample = { f: 0, lift: 0, pitch: 0 };
  private readonly foot2: FootSample = { f: 0, lift: 0, pitch: 0 };
  private readonly gnd: GroundSample = { oy: 0, zr: 0 };
  private readonly invHips = new THREE.Matrix4();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v4 = new THREE.Vector3();
  private readonly m1 = new THREE.Matrix4();
  private readonly q1 = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly e1 = new THREE.Euler();
  private disposed = false;

  constructor(private readonly d: Detail) {
    this.materials = makeMaterials();
    this.root.name = "avatar";
    this.build();
    this.hips.rotation.order = "YXZ";
    this.update(0.0001, 0);
  }

  /* ----- construction ----------------------------------------------------------------------- */

  private mesh(name: string, geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh {
    ensureColor(geo);
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = false;
    parent.add(m);
    return m;
  }

  private group(name: string, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group {
    const g = this.name(new THREE.Group(), name);
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  private name<T extends THREE.Object3D>(o: T, n: string): T {
    o.name = n;
    return o;
  }

  private build(): void {
    const { d, materials: M } = this;
    const { hips, spine, chest, neck, head, root } = this;
    root.add(hips);
    hips.name = "hips";
    hips.position.set(0, HIPS_Y, 0);
    spine.name = "spine";
    spine.position.set(0, SPINE_DY, 0);
    hips.add(spine);
    chest.name = "chest";
    chest.position.set(0, CHEST_DY, 0);
    spine.add(chest);
    neck.name = "neck";
    neck.position.set(0, NECK_DY, 0);
    chest.add(neck);
    head.name = "head";
    head.position.set(0, HEAD_DY, 0);
    head.scale.setScalar(1.08);
    neck.add(head);

    this.buildPelvis(M, d);
    this.buildTorso(M, d);
    this.buildHead(M, d);
    for (const side of [-1, 1] as const) {
      this.buildLeg(side, M, d);
      this.buildArm(side, M, d);
    }
  }

  private buildPelvis(M: Materials, d: Detail): void {
    const wy = (y: number): number => y - HIPS_Y;
    const geo = lathe({
      stations: [
        [wy(0.8), 0.07],
        [wy(0.83), 0.105],
        [wy(0.86), 0.13],
        [wy(0.89), 0.138],
        [wy(0.93), 0.138],
        [wy(0.98), 0.134],
        [wy(1.03), 0.128],
        [wy(1.08), 0.12],
      ],
      segs: d.torsoSeg,
      rings: Math.round(d.torsoRings * 0.7),
      capSteps: d.cap,
      capBottom: 0.03,
      capTop: 0.02,
      sz: 0.68,
    });
    bake(geo, (_x, y) => 0.6 + 0.4 * smoothstep(0.8, 0.93, y + HIPS_Y));
    this.mesh("pelvis", geo, M.trousers, this.hips);
  }

  private buildTorso(M: Materials, d: Detail): void {
    const { chest } = this;
    const ly = (y: number): number => y - CHEST_Y;
    const gauss = (x: number, s: number): number => Math.exp(-((x * x) / (s * s)));

    // ---- jacket (unzipped: lathe with a front wedge removed) ----
    const jacketKnots: Pt[] = [
      [0.85, 0.176], [0.94, 0.169], [0.99, 0.158], [1.02, 0.153], [1.1, 0.15], [1.18, 0.154], [1.26, 0.16],
      [1.32, 0.16], [1.36, 0.152], [1.395, 0.138], [1.425, 0.11], [1.45, 0.082], [1.468, 0.066],
    ];
    const rJ = tableFn(jacketKnots);
    const w = 0.42; // half angle of the open front
    const jacketBody = lathe({
      stations: jacketKnots.map(([y, r]) => [ly(y), r] as Pt),
      segs: d.torsoSeg,
      rings: d.torsoRings,
      capSteps: d.cap,
      sz: TORSO_DEPTH,
      phiStart: Math.PI + w,
      phiLength: TAU - 2 * w,
    });
    const surf = (y: number, phi: number, inset = 0): THREE.Vector3 => {
      const r = rJ(y) - inset;
      return new THREE.Vector3(r * Math.sin(phi), ly(y), r * TORSO_DEPTH * Math.cos(phi));
    };
    const parts: THREE.BufferGeometry[] = [jacketBody];
    for (const sgn of [-1, 1]) {
      const edge: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) edge.push(surf(lerp(0.855, 1.462, i / 8), Math.PI + sgn * w));
      parts.push(tube(edge, 0.0085, d));
    }
    const hem: THREE.Vector3[] = [];
    const hemN = 20;
    for (let i = 0; i <= hemN; i++) hem.push(surf(0.852, Math.PI + w + ((TAU - 2 * w) * i) / hemN));
    parts.push(tube(hem, 0.0085, d));
    // collar: open at the front
    const gap = 0.9;
    const collar = new THREE.TorusGeometry(0.07, 0.021, 7, d.tubeSeg, TAU - gap);
    collar.rotateX(Math.PI / 2);
    collar.rotateY(-(1.5 * Math.PI + gap / 2));
    collar.translate(0, ly(1.463), 0.008);
    parts.push(collar);
    const jacket = mergeAll(parts);
    bake(jacket, (x, y, z, _nx, ny) => {
      const wy = y + CHEST_Y;
      let f = 0.8 + 0.2 * smoothstep(0.85, 1.03, wy);
      f *= 1 - 0.34 * gauss(Math.abs(x) - 0.15, 0.05) * gauss(wy - 1.26, 0.075);
      f *= 1 - 0.32 * smoothstep(1.44, 1.47, wy);
      if (z > 0.02) f *= 1 - 0.14 * smoothstep(1.0, 1.15, wy) * smoothstep(0.0, 0.09, z);
      return f * (1 + 0.05 * clamp(ny, 0, 1));
    });
    this.mesh("jacket", jacket, M.jacket, chest);

    // ---- shirt / hoodie ----
    const shirtYs = [0.862, 0.9, 0.94, 1.02, 1.1, 1.18, 1.26, 1.32, 1.36, 1.395, 1.425, 1.45, 1.468];
    const shirtBody = lathe({
      stations: shirtYs.map((y) => [ly(y), rJ(y) - (y > 1.44 ? 0.013 : 0.011)] as Pt),
      segs: d.torsoSeg,
      rings: d.torsoRings,
      capSteps: d.cap,
      sz: TORSO_DEPTH,
    });
    const crew = new THREE.TorusGeometry(0.056, 0.012, 6, d.tubeSeg);
    crew.rotateX(Math.PI / 2);
    crew.translate(0, ly(1.466), 0.004);
    const hoodGap = 1.5;
    const hood = new THREE.TorusGeometry(0.076, 0.026, 7, d.tubeSeg, TAU - hoodGap);
    hood.rotateX(Math.PI / 2);
    hood.rotateY(-(1.5 * Math.PI + hoodGap / 2));
    hood.rotateX(0.38);
    hood.translate(0, ly(1.45), 0.036);
    const shirt = mergeAll([shirtBody, crew, hood]);
    bake(shirt, (x, y, z, _nx, ny) => {
      const wy = y + CHEST_Y;
      let f = 0.92 * (0.7 + 0.3 * smoothstep(0.86, 1.08, wy));
      f *= 1 - 0.4 * smoothstep(0.04, 0.11, Math.abs(x));
      if (wy > 1.43 && z > 0.0) f *= 0.82;
      return f * (1 + 0.04 * clamp(ny, 0, 1));
    });
    this.mesh("shirt", shirt, M.shirt, chest);

    // ---- backpack ----
    const pack: THREE.BufferGeometry[] = [
      roundedBox(0.146, 0.205, 0.07, 0, ly(1.2), 0.198, d.packSeg, 4.2, 0.9),
      roundedBox(0.105, 0.105, 0.03, 0, ly(1.12), 0.272, d.packSeg, 4, 1),
      roundedBox(0.138, 0.062, 0.078, 0, ly(1.345), 0.2, d.packSeg, 4.2, 1),
    ];
    const handle = new THREE.TorusGeometry(0.035, 0.007, 5, d.tubeSeg > 14 ? 14 : 8, Math.PI);
    handle.rotateX(-0.25);
    handle.translate(0, ly(1.404), 0.2);
    pack.push(handle);
    const outward = (p: THREE.Vector3): THREE.Vector3 => {
      const r = rJ(p.y + CHEST_Y);
      return new THREE.Vector3(p.x / (r * r), 0.18, p.z / (r * r * TORSO_DEPTH * TORSO_DEPTH)).normalize();
    };
    for (const sgn of [-1, 1]) {
      const pts = [
        new THREE.Vector3(sgn * 0.092, ly(1.36), 0.15),
        new THREE.Vector3(sgn * 0.094, ly(1.405), 0.083),
        new THREE.Vector3(sgn * 0.093, ly(1.438), 0.0),
        surf(1.4, Math.PI - sgn * 0.98, -0.006).setX(sgn * 0.1),
        surf(1.32, Math.PI - sgn * 1.15, -0.006),
        surf(1.22, Math.PI - sgn * 1.33, -0.006),
        surf(1.12, Math.PI - sgn * 1.62, -0.006),
        surf(1.05, Math.PI - sgn * 2.2, -0.006),
        new THREE.Vector3(sgn * 0.125, ly(1.03), 0.16),
      ];
      pack.push(ribbon(pts, 0.042, 0.011, d.tubeSeg + 8, outward));
    }
    const packGeo = mergeAll(pack);
    bake(packGeo, (_x, y, z) => {
      const wy = y + CHEST_Y;
      return (0.8 + 0.2 * smoothstep(0.99, 1.3, wy)) * (z < 0.13 ? 0.9 : 1);
    });
    this.mesh("backpack", packGeo, M.pack, chest);
  }

  private buildHead(M: Materials, d: Detail): void {
    const { neck, head } = this;
    const neckGeo = lathe({
      stations: [[-0.06, 0.056], [-0.01, 0.05], [0.03, 0.046], [0.07, 0.047]],
      segs: d.limbSeg,
      rings: 5,
      capSteps: 2,
      capBottom: 0.01,
      capTop: 0.012,
    });
    neckGeo.translate(0, 0, 0.008);
    bake(neckGeo, (_x, y) => 1 - 0.5 * smoothstep(0.0, 0.1, y));
    this.mesh("neckMesh", neckGeo, M.skin, neck);

    // ---- skull: egg-shaped, narrower jaw ----
    const wx = 0.0775;
    const wz = 0.098;
    const hh = 0.1075;
    const kx = (ny: number): number => 1 - 0.3 * (ny < 0 ? -ny : 0) ** 1.7;
    const kz = (ny: number): number => 1 - 0.2 * (ny < 0 ? -ny : 0) ** 1.4;
    const skull = new THREE.SphereGeometry(1, d.headSeg, d.headRings);
    skull.deleteAttribute("normal");
    skull.deleteAttribute("uv");
    const sp = skull.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) {
      const nx = sp.getX(i);
      const ny = sp.getY(i);
      const nz = sp.getZ(i);
      sp.setXYZ(i, nx * wx * kx(ny), HEAD_CY + ny * hh, nz * wz * kz(ny) + 0.004);
    }
    /** Front surface z at lateral offset x and height y (head-local). */
    const frontZ = (x: number, y: number): number => {
      const ny = clamp((y - HEAD_CY) / hh, -1, 1);
      const nx = x / (wx * kx(ny));
      const nz = -Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      return nz * wz * kz(ny) + 0.004;
    };
    const skinParts: THREE.BufferGeometry[] = [smoothed(skull)];
    const sd = d.clumpSeg;
    const sr = d.clumpRings;
    // nose
    skinParts.push(ellipsoid(0.0085, 0.019, 0.013, 0, HEAD_CY - 0.014, frontZ(0, HEAD_CY - 0.014) - 0.001, sd, sr, [0.3, 0, 0]));
    skinParts.push(ellipsoid(0.0075, 0.01, 0.009, 0, HEAD_CY - 0.03, frontZ(0, HEAD_CY - 0.03) - 0.003, sd, sr));
    // ears
    for (const sgn of [-1, 1]) {
      skinParts.push(ellipsoid(0.0075, 0.023, 0.0145, sgn * (wx - 0.001), HEAD_CY - 0.004, 0.008, sd, sr, [0, 0, sgn * 0.15]));
    }
    const headGeo = mergeAll(skinParts);
    bake(headGeo, (x, y, z, _nx, ny) => {
      let f = 1 - 0.38 * smoothstep(-0.2, -0.9, ny) * smoothstep(HEAD_CY - 0.03, HEAD_CY - 0.07, y);
      if (Math.abs(x) > 0.07) f *= 0.92; // temples / ears slightly deeper
      if (z > 0.06) f *= 0.9;
      return f;
    });
    this.mesh("headMesh", headGeo, M.skin, head);

    // ---- face details (vertex coloured) ----
    const tint = (g: THREE.BufferGeometry, r: number, gg: number, b: number): THREE.BufferGeometry => {
      const col = new THREE.Color(r, gg, b).convertSRGBToLinear();
      return bake(g, null, [col.r, col.g, col.b]);
    };
    const face: THREE.BufferGeometry[] = [];
    const eyeY = HEAD_CY + 0.006;
    for (const sgn of [-1, 1]) {
      const ex = sgn * 0.031;
      face.push(tint(ellipsoid(0.0085, 0.0058, 0.004, ex, eyeY, frontZ(ex, eyeY) + 0.0008, sd, sr, [0, sgn * -0.3, 0]), 0.3, 0.22, 0.2));
    }
    this.mesh("faceDetails", mergeAll(face), M.face, head);

    // ---- hair: overlapping clumps for a voluminous short cut ----
    const cy = HEAD_CY;
    const hair: THREE.BufferGeometry[] = [
      // one smooth, slightly voluminous cap over the top / back, side volume covering the top of the ears
      ellipsoid(0.086, 0.082, 0.103, 0, cy + 0.04, 0.016, sd + 8, sr + 6),
      ellipsoid(0.08, 0.094, 0.073, 0, cy - 0.008, 0.036, sd + 4, sr + 2),
      ellipsoid(0.03, 0.05, 0.08, -0.066, cy + 0.03, 0.01, sd + 2, sr + 1),
      ellipsoid(0.03, 0.05, 0.08, 0.066, cy + 0.03, 0.01, sd + 2, sr + 1),
    ];
    const hairGeo = mergeAll(hair);
    bake(hairGeo, (x, y, z) => {
      const base = 0.5 + 0.5 * smoothstep(cy - 0.09, cy + 0.1, y);
      return base * (0.9 + 0.1 * Math.sin(x * 140 + z * 90 + y * 60));
    });
    this.mesh("hair", hairGeo, M.hair, head);
  }

  private buildLeg(side: -1 | 1, M: Materials, d: Detail): void {
    const tag = side < 0 ? "L" : "R";
    const thigh = this.group(`thigh${tag}`, this.hips, side * THIGH_X, THIGH_DY, 0);
    const knee = this.group(`shin${tag}`, thigh, 0, -L_THIGH, 0);
    const foot = this.group(`foot${tag}`, knee, 0, -L_SHIN, 0);
    this.legs.push({ side, thigh, knee, foot });
    const inward = (x: number): number => -side * x;

    const thighGeo = limb(d, L_THIGH, 0.074, [[0.14, 0.084], [0.5, 0.07], [0.85, 0.06]], 0.056);
    bake(thighGeo, (x, y, z) => {
      let f = 1 - 0.3 * smoothstep(0.02, 0.085, inward(x)) * smoothstep(0.1, 0.3, -y + 0.1);
      if (y > -0.04) f *= 0.8 + 0.2 * smoothstep(0.1, -0.04, y + 0.0);
      if (z > 0.03 && y < -0.38) f *= 0.86;
      return f;
    });
    this.mesh(`thighMesh${tag}`, thighGeo, M.trousers, thigh);
    const shinGeo = limb(d, L_SHIN, 0.056, [[0.15, 0.058], [0.45, 0.05], [0.85, 0.043]], 0.041, 0.041);
    bake(shinGeo, (x, y, z) => {
      let f = 1 - 0.22 * smoothstep(0.02, 0.055, inward(x));
      if (y < -0.36) f *= 0.88 + 0.12 * smoothstep(-0.405, -0.36, y);
      if (z > 0.03 && y > -0.1) f *= 0.88;
      return f;
    });
    this.mesh(`shinMesh${tag}`, shinGeo, M.trousers, knee);

    if (!this.shoeGeos) {
      const topTable: Pt[] = [[0.08, -0.012], [0.056, 0.014], [0.02, 0.026], [-0.025, 0.022], [-0.065, 0.008], [-0.105, -0.008], [-0.142, -0.022], [-0.176, -0.032]];
      const topFn = tableFn(topTable);
      const sd = d.handSeg + 2;
      const upperParts: THREE.BufferGeometry[] = [
        shoeShape(d, {
          zBack: 0.08,
          zFront: -0.178,
          yBottom: -0.052,
          top: topTable,
          half: [[0.08, 0.034], [0.06, 0.041], [0.02, 0.045], [-0.04, 0.047], [-0.09, 0.05], [-0.13, 0.05], [-0.178, 0.04]],
          n: 2.6,
          spring: 0.0,
        }),
        // tongue and heel tab
        ellipsoid(0.023, 0.012, 0.042, 0, topFn(-0.03) + 0.003, -0.03, sd, sd, [0.12, 0, 0]),
        // toe cap
        ellipsoid(0.043, 0.026, 0.045, 0, -0.026, -0.137, sd + 2, sd),
      ];
      const upper = mergeAll(upperParts);
      bake(upper, (_x, y) => 0.78 + 0.22 * smoothstep(-0.05, -0.0, y));
      const sole = shoeShape(d, {
        zBack: 0.084,
        zFront: -0.184,
        yBottom: -ANKLE_H,
        top: [[0.084, -0.042], [-0.184, -0.042]],
        half: [[0.084, 0.035], [0.06, 0.043], [0.02, 0.047], [-0.04, 0.049], [-0.09, 0.052], [-0.13, 0.052], [-0.184, 0.042]],
        n: 4,
        spring: 0.9,
      });
      bake(sole, (_x, y) => 0.82 + 0.18 * smoothstep(-0.072, -0.05, y));
      this.shoeGeos = { upper, sole };
    }
    this.mesh(`shoe${tag}`, this.shoeGeos.upper, M.sneaker, foot);
    this.mesh(`sole${tag}`, this.shoeGeos.sole, M.sole, foot);
  }

  private shoeGeos: { upper: THREE.BufferGeometry; sole: THREE.BufferGeometry } | null = null;

  private buildArm(side: -1 | 1, M: Materials, d: Detail): void {
    const tag = side < 0 ? "L" : "R";
    const shoulder = this.group(`shoulder${tag}`, this.chest, side * SHOULDER_X, SHOULDER_DY, 0);
    const upper = this.group(`upperArm${tag}`, shoulder, 0, 0, 0);
    const elbow = this.group(`forearm${tag}`, upper, 0, -L_UPPER_ARM, 0);
    const hand = this.group(`hand${tag}`, elbow, 0, -L_FOREARM, 0);
    this.arms.push({ side, shoulder, upper, elbow, hand });
    const inward = (x: number): number => -side * x;

    const upperGeo = limb(d, L_UPPER_ARM, 0.052, [[0.15, 0.056], [0.5, 0.051], [0.85, 0.047]], 0.046);
    bake(upperGeo, (x, y) => {
      let f = 1 - 0.3 * smoothstep(0.0, 0.05, inward(x)) * smoothstep(-0.02, -0.12, y);
      f *= 1 - 0.1 * smoothstep(-0.24, -0.3, y);
      return f;
    });
    this.mesh(`sleeveUpper${tag}`, upperGeo, M.jacket, upper);
    const foreGeo = limb(d, L_FOREARM, 0.046, [[0.12, 0.046], [0.5, 0.04], [0.9, 0.035]], 0.0345, 0.012);
    bake(foreGeo, (x, y) => {
      let f = 1 - 0.22 * smoothstep(0.0, 0.04, inward(x));
      if (y < -0.235) f *= 0.8; // ribbed cuff
      return f;
    });
    this.mesh(`sleeveFore${tag}`, foreGeo, M.jacket, elbow);

    // ---- hand: palm + slightly curled fingers + thumb (inward = toward the body) ----
    const handInward = -side;
    const hs = d.handSeg;
    const h: THREE.BufferGeometry[] = [
      ellipsoid(0.0165, 0.05, 0.039, 0, -0.046, 0, hs + 4, hs + 3),
      ellipsoid(0.0145, 0.045, 0.036, handInward * 0.004, -0.108, 0, hs + 4, hs + 3, [0, 0, handInward * 0.12]),
      ellipsoid(0.0105, 0.032, 0.0105, handInward * 0.012, -0.06, -0.037, hs + 2, hs + 2, [0.45, 0, handInward * 0.25]),
    ];
    const handGeo = mergeAll(h);
    bake(handGeo, (_x, y) => 0.88 + 0.12 * smoothstep(-0.17, -0.05, y) + 0.0);
    this.mesh(`handMesh${tag}`, handGeo, M.skin, hand);
  }

  /* ----- public API --------------------------------------------------------------------------- */

  setEnvMap(env: THREE.Texture | null, intensity = 0.6): void {
    for (const mat of Object.values(this.materials)) {
      mat.envMap = env;
      mat.envMapIntensity = intensity;
      mat.needsUpdate = true;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const geos = new Set<THREE.BufferGeometry>();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) geos.add(o.geometry as THREE.BufferGeometry);
    });
    for (const g of geos) g.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
  }

  /* ----- animation ----------------------------------------------------------------------------- */

  update(dt: number, speedMps: number): void {
    if (!(dt > 0) || this.disposed) return;
    const step = Math.min(dt, 0.1);
    const target = Number.isFinite(speedMps) ? Math.max(0, speedMps) : 0;

    // critically damped speed smoothing (no popping between idle / walk / run)
    const smoothTime = 0.16;
    const omega = 2 / smoothTime;
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
    const vs = this.speed;
    this.time += step;

    // gait parameters from the smoothed speed
    const g = smoothstep(0.04, 0.5, vs);
    const w = smoothstep(1.85, 2.7, vs);
    const strideLin = vs <= 1.45 ? 0.75 + 0.31 * vs : 1.2 + 0.5 * (vs - 1.45);
    // walk and run foot trajectories are sampled separately and cross-faded (no stance/swing flips)
    const strideW = Math.min(strideLin, 0.8 / WALK_BETA);
    const strideR = Math.min(strideLin, 0.64 / RUN_BETA);
    const stride = lerp(strideW, strideR, w);
    // phase advances by distance travelled / stride length: planted feet do not slide
    this.phase = (this.phase + (target * step) / Math.max(stride, 0.3)) % 1;
    const phiL = this.phase;
    const phiR = this.phase + 0.5;
    const t = this.time;
    const c1 = Math.cos(TAU * phiL);
    const s1 = Math.sin(TAU * phiL);

    // ---- idle contributions ----
    const breath = Math.sin(TAU * 0.26 * t);
    const shift = Math.sin(TAU * 0.11 * t);
    const idleW = 1 - g;

    // ---- pelvis ----
    const walkY = 0.92 + 0.025 * Math.cos(4 * Math.PI * (this.phase - WALK_BETA / 2));
    const runY = 0.862 - 0.03 * Math.cos(4 * Math.PI * (this.phase - RUN_BETA / 2));
    const gaitY = lerp(walkY, runY, w);
    const hipsY = lerp(HIPS_Y - 0.002 * breath, gaitY, g);
    const sway = lerp(0.012, 0.008, w) * g;
    const hipsX = -sway * s1 + 0.01 * shift * idleW;
    const hipsRoll = -lerp(0.035, 0.05, w) * s1 * g + 0.012 * shift * idleW;
    const hipsYaw = -lerp(0.09, 0.14, w) * c1 * g + 0.02 * Math.sin(TAU * 0.07 * t) * idleW;
    const lean = lerp(0.02, 0.17, w) * g;
    const hipsPitch = -0.15 * lean;
    this.hips.position.set(hipsX, hipsY, 0);
    this.hips.rotation.set(hipsPitch, hipsYaw, hipsRoll, "YXZ");
    this.hips.updateMatrix();

    // ---- torso ----
    const twist = lerp(0.12, 0.3, w) * g;
    const twistShare = (twist + (-hipsYaw * 0) + lerp(0.09, 0.14, w) * g) * 0.5;
    this.spine.rotation.set(-0.45 * lean + 0.004 * breath, twistShare * c1, -0.6 * hipsRoll, "YXZ");
    this.chest.rotation.set(-0.4 * lean + 0.012 * breath * (1 - 0.5 * g), twistShare * c1 + 0.03 * Math.sin(TAU * 0.07 * t + 1) * idleW, -0.3 * hipsRoll, "YXZ");

    const yawSum = this.hips.rotation.y + this.spine.rotation.y + this.chest.rotation.y;
    const pitchSum = this.hips.rotation.x + this.spine.rotation.x + this.chest.rotation.x;
    this.neck.rotation.set(0.01 * breath, -yawSum * 0.25, 0);
    this.head.rotation.set(-pitchSum * 0.8 + 0.02 * Math.sin(TAU * 0.09 * t + 2) * idleW + 0.01, -yawSum * 0.4 + 0.05 * Math.sin(TAU * 0.05 * t) * idleW, -this.chest.rotation.z * 0.5, "YXZ");

    // ---- legs (two-bone IK on world-planted ankle targets) ----
    const footL = this.footTarget(this.legs[0]!, phiL, strideW, strideR, w, g, t);
    void footL;
    this.footTarget(this.legs[1]!, phiR, strideW, strideR, w, g, t);

    // ---- arms ----
    const armAmp = lerp(0.32, 0.8, w) * g;
    const neutral = lerp(0.1, 0.22, w * g) + 0.04 * idleW;
    for (const arm of this.arms) {
      const s = arm.side; // -1 left
      // left arm swings forward when the right leg is forward (counter-phase to the same-side leg)
      const swing = (s < 0 ? -c1 : c1) * armAmp;
      const fwd = armAmp > 1e-4 ? 0.5 + 0.5 * (swing / armAmp) : 0.5;
      const idleSway = 0.025 * Math.sin(TAU * 0.11 * t + (s < 0 ? 0 : 1.3));
      arm.upper.rotation.set(neutral + swing + idleSway * idleW, (s < 0 ? 1 : -1) * 0.1 * w * g, s * (0.09 - 0.03 * w * g), "YXZ");
      const elbowBase = lerp(0.2 + 0.04 * breath * idleW, lerp(0.26 + 0.1 * fwd, 1.15 + 0.2 * fwd, w), g);
      arm.elbow.rotation.set(elbowBase, 0, 0);
      arm.hand.rotation.set(0.05 + 0.15 * w * g, 0, 0);
      arm.shoulder.rotation.set(0, 0, s * 0.015 * breath);
    }
  }

  /** Place one foot (IK) for the given cycle phase. */
  private footTarget(leg: Leg, phi: number, strideW: number, strideR: number, w: number, g: number, t: number): void {
    const { foot, foot2, gnd, v1, v2, v3, v4, q1, q2, m1 } = this;
    sampleFoot(phi, WALK_BETA, strideW, 0, foot);
    if (w > 0) {
      sampleFoot(phi, RUN_BETA, strideR, 1, foot2);
      foot.f = lerp(foot.f, foot2.f, w);
      foot.lift = lerp(foot.lift, foot2.lift, w);
      foot.pitch = lerp(foot.pitch, foot2.pitch, w);
    }
    groundSample(foot.pitch, gnd);
    const idleShift = 0.5 * Math.sin(TAU * 0.11 * t); // slow weight shift moves the feet very slightly
    void idleShift;
    const gaitX = leg.side * lerp(0.095, 0.075, w);
    const gaitZ = -(foot.f) - gnd.zr;
    const gaitY = foot.lift + gnd.oy;
    const idleX = leg.side * 0.1;
    const idleZ = leg.side * 0.006 - Z_FLAT * 0 - 0.0;
    const idleY = ANKLE_H;
    const tx = lerp(idleX, gaitX, g);
    const tz = lerp(idleZ, gaitZ, g);
    const ty = lerp(idleY, gaitY, g);
    const pitch = foot.pitch * g;
    const yaw = -leg.side * lerp(0.13, lerp(0.08, 0.03, w), g);

    // target in hips-local space
    this.invHips.copy(this.hips.matrix).invert();
    v1.set(tx, ty, tz).applyMatrix4(this.invHips);
    // hip joint is leg.thigh.position
    const hx = leg.thigh.position.x;
    const hy = leg.thigh.position.y;
    v2.set(v1.x - hx, v1.y - hy, v1.z);
    let len = v2.length();
    const maxLen = (L_THIGH + L_SHIN) * 0.994;
    const minLen = Math.abs(L_THIGH - L_SHIN) + 0.02;
    len = clamp(len, minLen, maxLen);
    v2.normalize();
    const cosKnee = (L_THIGH * L_THIGH + L_SHIN * L_SHIN - len * len) / (2 * L_THIGH * L_SHIN);
    const flex = Math.PI - Math.acos(clamp(cosKnee, -1, 1));
    const cosA = (L_THIGH * L_THIGH + len * len - L_SHIN * L_SHIN) / (2 * L_THIGH * len);
    const a = Math.acos(clamp(cosA, -1, 1));
    // bend plane: knee points forward (slightly outward)
    v3.set(leg.side * 0.1, 0, -1).normalize();
    v3.addScaledVector(v2, -v2.dot(v3)).normalize();
    // thigh direction (hip -> knee)
    v4.copy(v2).multiplyScalar(Math.cos(a)).addScaledVector(v3, Math.sin(a));
    // basis: Y = -thigh dir, X = fwd x Y, Z = X x Y
    const yAxis = v4.negate();
    const fwd = v3.set(0, 0, -1);
    const xAxis = fwd.clone().cross(yAxis);
    if (xAxis.lengthSq() < 1e-6) xAxis.set(1, 0, 0);
    xAxis.normalize();
    const zAxis = xAxis.clone().cross(yAxis);
    m1.makeBasis(xAxis, yAxis, zAxis);
    leg.thigh.quaternion.setFromRotationMatrix(m1);
    leg.knee.rotation.set(-flex, 0, 0);

    // foot orientation in the root frame: yaw * pitch, expressed relative to the shin
    q1.copy(this.hips.quaternion).multiply(leg.thigh.quaternion).multiply(leg.knee.quaternion).invert();
    this.e1.set(pitch, yaw, 0, "YXZ");
    q2.setFromEuler(this.e1);
    leg.foot.quaternion.copy(q1.multiply(q2));
  }
}
