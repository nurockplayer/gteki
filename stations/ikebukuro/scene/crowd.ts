// Ambient pedestrians for immersion. They walk only along verified graph edge polylines
// (with a small lateral offset), so the crowd never suggests a route the data lacks.
// Presentation: smooth procedural commuters in the style of the player avatar (lathe / superellipsoid
// parts, jacket over shirt, hair cap, rounded shoes with a darker sole, elbow and knee joints), drawn as
// one InstancedMesh per part with per-instance colour; no per-agent objects, no physics.
import type * as THREE_NS from "three";

interface P3 { x: number; y: number; z: number | null }
interface Edge { id: string; from: string; to: string; verification: string; geometry: P3[] }

/** cum: 3D arc length (walking speed); hcum: horizontal distance, the axis crowd_lanes.json is sampled on. */
interface Path { pts: THREE_NS.Vector3[]; cum: number[]; hcum: number[]; length: number; from: string; to: string; lane?: Lane }
/** Safe lateral extent (m) over each stepM interval of horizontal distance along an edge (the last ends at the end node), from pipeline/build_station.py. */
export interface Lane { stepM: number; left: number[]; right: number[] }
/** phase: gait phase in radians, advanced by distance walked (one cycle per two steps). bobPhase: the earlier build's bob phase
 * (one cycle per ~1.45 m); it only feeds the near-camera / visibility decisions, which must not change with the new pose. */
interface Agent { path: number; forward: boolean; s: number; speed: number; offset: number; phase: number; bobPhase: number; hiddenUntil: number }

/* ------------------------------------------------------------------------------------------ */
/* appearance palettes (sRGB hex; albedos kept realistic so nothing washes out to grey)        */
/* ------------------------------------------------------------------------------------------ */

const SUIT = [0x1a1f2b, 0x222838, 0x14161b, 0x2b2e36, 0x1b2740, 0x30343c, 0x202a38];
const CASUAL = [0x3a4a3a, 0x54402f, 0x1f2a3a, 0x666a72, 0x76282c, 0x2c4a63, 0x82724f, 0x2b2c30, 0xada791, 0x3a4252];
const KNIT = [0x82858c, 0x2b3a55, 0x6a3835, 0x33503d, 0xcfc8ba, 0x1b1b1e, 0x45506b, 0x8a6a4a, 0x5b4660];
const TRENCH = [0xbfa882, 0xad9670, 0x8a8372, 0xd0c6b0, 0x474c54, 0x2a2f3a, 0x6d5a45];
const SHIRT = [0xe4e5e2, 0xe4e5e2, 0xe4e5e2, 0xbccce2, 0xdcd5c6, 0xd9c3cb, 0x9aa2af, 0xa8bfd8];
const TEE = [0xe4e5e2, 0x2a2c33, 0x7a2a2e, 0x2c4a63, 0xcfc8ba, 0x6b7a5e, 0xc9a24a];
const PANTS = [0x1b1d22, 0x2c3442, 0x5e5649, 0x2f4466, 0x41454c, 0xb0a48a, 0x3b3631, 0x26324a];
const SKIRT = [0x1b1d22, 0x2a3350, 0x6a5a48, 0x80858f, 0xc2b69c, 0x4a2f3a, 0x30343c];
const SKIN = [0xe0bfa3, 0xd5ad8c, 0xc99b7a, 0xe8cdb5, 0xdcb596, 0xc79a79];
const HAIR = [0x16130f, 0x16130f, 0x221b15, 0x2a1f16, 0x3a2b1f, 0x5a4636, 0x8f8f8f, 0x6b4a2e];
const SHOE = [0x14141a, 0x14141a, 0x14141a, 0x3a2a20, 0xdcdcd8, 0x70747b, 0x1f2a44, 0x5a3b2a];
const BAG = [0x15171a, 0x15171a, 0x3d2f25, 0x2f3a4a, 0x5a5f66, 0x7b6a52];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/* ------------------------------------------------------------------------------------------ */
/* small math                                                                                  */
/* ------------------------------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const gauss = (x: number, s: number) => Math.exp(-((x * x) / (s * s)));
const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

/** Smooth 1-D function through (x, y) knots (Catmull-Rom). */
function tableFn(pts: readonly (readonly [number, number])[]): (x: number) => number {
  const p = [...pts].sort((a, b) => a[0] - b[0]);
  return (x: number) => {
    if (x <= p[0]![0]) return p[0]![1];
    for (let i = 1; i < p.length; i++) {
      if (p[i]![0] >= x) {
        const a = p[Math.max(0, i - 2)]!, b = p[i - 1]!, c = p[i]!, d = p[Math.min(p.length - 1, i + 1)]!;
        return cr(a[1], b[1], c[1], d[1], (x - b[0]) / Math.max(1e-9, c[0] - b[0]));
      }
    }
    return p[p.length - 1]![1];
  };
}

/* ------------------------------------------------------------------------------------------ */
/* body dimensions (m); the model is authored facing +Z, origin on the floor                   */
/* ------------------------------------------------------------------------------------------ */

const HIPS_Y = 0.945; // pelvis pivot height at rest
const THIGH_X = 0.088; // lateral offset of each hip joint
const THIGH_DY = -0.04; // hip joint below the pelvis pivot
const L_THIGH = 0.435;
const L_SHIN = 0.405;
const ANKLE_H = 0.072; // ankle pivot above the sole
const CHEST_DY = 0.14; // chest pivot above the pelvis pivot
const CHEST_Y = HIPS_Y + CHEST_DY; // torso geometry is authored in world y minus this
const SHOULDER_X = 0.165;
const SHOULDER_DY = 0.288;
const L_UPPER_ARM = 0.29;
const L_FOREARM = 0.26;
const HEAD_PIVOT_DY = 0.44; // head pivot above the chest pivot
const HEAD_SCALE = 1.08;
const TORSO_DEPTH = 0.72; // z radius / x radius of the torso section
const TAIL_TOP = 0.99; // waist line where a long coat / skirt starts

/* ------------------------------------------------------------------------------------------ */
/* walk cycle (foot trajectory after the player avatar: stance is linear so planted feet do not */
/* slide; the swing is a Hermite arc; heel-strike then toe-off pitch)                           */
/* ------------------------------------------------------------------------------------------ */

const BETA = 0.6; // stance fraction of the cycle
interface FootSample { f: number; lift: number; pitch: number }

function sampleFoot(phi: number, stride: number, out: FootSample) {
  const p = phi - Math.floor(phi);
  if (p < BETA) {
    const u = p / BETA;
    out.f = stride * (BETA / 2 - p);
    out.lift = 0;
    out.pitch = 0.3 * (1 - smoothstep(0, 0.22, u)) - 0.29 * smoothstep(0.45, 1, u); // toes up positive
  } else {
    const q = (p - BETA) / (1 - BETA);
    const f0 = (-stride * BETA) / 2, f1 = (stride * BETA) / 2, m = -stride * (1 - BETA);
    const q2 = q * q, q3 = q2 * q;
    out.f = (2 * q3 - 3 * q2 + 1) * f0 + (q3 - 2 * q2 + q) * m + (-2 * q3 + 3 * q2) * f1 + (q3 - q2) * m;
    out.lift = 0.09 * Math.sin(Math.PI * (q + 0.07 * Math.sin(TAU * q))) ** 1.2;
    out.pitch = lerp(-0.29, 0.3, smoothstep(0.1, 0.9, q));
  }
}

// The planted foot is a rigid shoe that rolls about its lowest support point: the heel while the toes are up
// (heel-strike, pitch > 0) and the toe edge of the sole while the heel is up (toe-off, pitch < 0), so no sole
// vertex ever goes below the floor and the contact point stays fixed on it. The support points are the actual
// sole vertices of the shoe geometry in use (low and high quality differ), as (z, y) pairs relative to the ankle
// in the flat-foot pose; toe points to +Z.
/** Ankle displacement (from its flat-foot position) that puts the lowest sole vertex on the floor, fixed in z, at pitch th (toes up positive). */
function pivotOffset(th: number, sole: Float64Array, out: { dy: number; dz: number }) {
  const c = Math.cos(th), s = Math.sin(th);
  let low = Infinity, z0 = 0, z1 = 0;
  for (let k = 0; k < sole.length; k += 2) {
    const z = sole[k]!, y = sole[k + 1]!;
    const ry = y * c + z * s;
    if (ry < low) { low = ry; z0 = z; z1 = -y * s + z * c; }
  }
  out.dy = -ANKLE_H - low;
  out.dz = z0 - z1;
}

/* ------------------------------------------------------------------------------------------ */
/* geometry                                                                                    */
/* ------------------------------------------------------------------------------------------ */

type V3 = [number, number, number];
/** A cross-section: points c + a cos(t) + b sin(t) (superellipse). a = b = 0 is a pole. */
interface Ring { c: V3; a: V3; b: V3 }
const Yring = (y: number, rx: number, rz = rx, cz = 0, cx = 0): Ring => ({ c: [cx, y, cz], a: [rx, 0, 0], b: [0, 0, rz] });
const Zring = (z: number, hw: number, hh: number, cy: number, cx = 0): Ring => ({ c: [cx, cy, z], a: [hw, 0, 0], b: [0, hh, 0] });

/** The face budget of the whole person, by part: radial segments of each lofted piece (high quality). */
const SEG_HIGH = { torso: 14, torus: 10, head: 14, hair: 10, limb: 8, thigh: 9, shin: 8, shoe: 8, hand: 7, pack: 8 };
/** Low quality: coarser sections (even counts keep the soles flat), one cap step, fewer stations. */
const SEG_LOW = { torso: 8, torus: 6, head: 8, hair: 6, limb: 6, thigh: 6, shin: 6, shoe: 6, hand: 4, pack: 6 };
/** The quality is the one the scene already selects through the head-count: 56 on low, 150 on high. */
export const LOW_QUALITY_MAX_COUNT = 80;

function makeGeometry(THREE: typeof THREE_NS, low: boolean) {
  const SEG = low ? SEG_LOW : SEG_HIGH;
  const CS = low ? 1 : 2; // elliptical cap steps
  const subdivide = (rs: Ring[], sub: number): Ring[] => {
    if (sub <= 1 || rs.length < 3) return rs;
    const flat = rs.map((r) => [...r.c, ...r.a, ...r.b]);
    const out: number[][] = [];
    for (let i = 0; i < flat.length - 1; i++) {
      const p0 = flat[Math.max(0, i - 1)]!, p1 = flat[i]!, p2 = flat[i + 1]!, p3 = flat[Math.min(flat.length - 1, i + 2)]!;
      for (let s = 0; s < sub; s++) out.push(p1.map((_, k) => cr(p0[k]!, p1[k]!, p2[k]!, p3[k]!, s / sub)));
    }
    out.push(flat[flat.length - 1]!);
    return out.map((v) => ({ c: [v[0]!, v[1]!, v[2]!], a: [v[3]!, v[4]!, v[5]!], b: [v[6]!, v[7]!, v[8]!] }));
  };

  /** Round both ends of a ring sequence with elliptical caps (heights in m along the end tangent). */
  const caps = (rs: Ring[], h0: number, h1: number, steps: number): Ring[] => {
    const n = rs.length;
    const out = [...rs];
    const end = (last: Ring, prev: Ring, h: number, put: (r: Ring) => void) => {
      const d: V3 = [last.c[0] - prev.c[0], last.c[1] - prev.c[1], last.c[2] - prev.c[2]];
      const l = Math.hypot(...d) || 1;
      for (let k = 1; k <= steps; k++) {
        const ang = (k / steps) * (Math.PI / 2), sc = Math.cos(ang), sh = Math.sin(ang) * h / l;
        put({
          c: [last.c[0] + d[0] * sh, last.c[1] + d[1] * sh, last.c[2] + d[2] * sh],
          a: [last.a[0] * sc, last.a[1] * sc, last.a[2] * sc],
          b: [last.b[0] * sc, last.b[1] * sc, last.b[2] * sc],
        });
      }
    };
    if (h1 > 0) end(rs[n - 1]!, rs[n - 2]!, h1, (r) => out.push(r));
    if (h0 > 0) end(rs[0]!, rs[1]!, h0, (r) => out.unshift(r));
    return out;
  };

  /** Smooth closed surface through a ring sequence (poles collapse to one vertex). */
  const loft = (rings: Ring[], seg: number, n = 2, closed = false): THREE_NS.BufferGeometry => {
    const pos: number[] = [], idx: number[] = [], start: number[] = [], size: number[] = [];
    const cs: number[] = [], sn: number[] = [];
    for (let k = 0; k < seg; k++) {
      const c = Math.cos((k / seg) * TAU), s = Math.sin((k / seg) * TAU);
      cs.push(Math.sign(c) * Math.abs(c) ** (2 / n));
      sn.push(Math.sign(s) * Math.abs(s) ** (2 / n));
    }
    for (const r of rings) {
      start.push(pos.length / 3);
      if (!closed && Math.abs(r.a[0]) + Math.abs(r.a[1]) + Math.abs(r.a[2]) + Math.abs(r.b[0]) + Math.abs(r.b[1]) + Math.abs(r.b[2]) < 1e-6) {
        pos.push(...r.c);
        size.push(1);
      } else {
        for (let k = 0; k < seg; k++) pos.push(r.c[0] + r.a[0] * cs[k]! + r.b[0] * sn[k]!, r.c[1] + r.a[1] * cs[k]! + r.b[1] * sn[k]!, r.c[2] + r.a[2] * cs[k]! + r.b[2] * sn[k]!);
        size.push(seg);
      }
    }
    const last = closed ? rings.length : rings.length - 1;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % rings.length;
      const A = start[i]!, B = start[j]!, na = size[i]!, nb = size[j]!;
      if (na === 1 && nb === 1) continue;
      for (let k = 0; k < seg; k++) {
        const k1 = (k + 1) % seg;
        if (na === 1) idx.push(A, B + k, B + k1);
        else if (nb === 1) idx.push(A + k, B, A + k1);
        else idx.push(A + k, B + k, A + k1, A + k1, B + k, B + k1);
      }
    }
    // Orient outward: a closed surface has positive signed volume.
    let vol = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3;
      vol += pos[a]! * (pos[b + 1]! * pos[c + 2]! - pos[b + 2]! * pos[c + 1]!) - pos[a + 1]! * (pos[b]! * pos[c + 2]! - pos[b + 2]! * pos[c]!) + pos[a + 2]! * (pos[b]! * pos[c + 1]! - pos[b + 1]! * pos[c]!);
    }
    if (vol < 0) for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]!; idx[t + 1] = idx[t + 2]!; idx[t + 2] = x; }
    return finish(pos, idx);
  };

  const finish = (pos: number[], idx: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.setAttribute("color", new THREE.Float32BufferAttribute(new Array(pos.length).fill(1), 3));
    return g;
  };

  /** Multiply a baked shading term (ambient occlusion / painted tone, optionally tinted) into the vertex colours. */
  const bake = (g: THREE_NS.BufferGeometry, fn: ((x: number, y: number, z: number, nx: number, ny: number, nz: number) => number) | null, tint?: [number, number, number]) => {
    const p = g.getAttribute("position"), nr = g.getAttribute("normal"), col = g.getAttribute("color");
    for (let i = 0; i < p.count; i++) {
      const v = fn ? fn(p.getX(i), p.getY(i), p.getZ(i), nr.getX(i), nr.getY(i), nr.getZ(i)) : 1;
      col.setXYZ(i, col.getX(i) * v * (tint ? tint[0] : 1), col.getY(i) * v * (tint ? tint[1] : 1), col.getZ(i) * v * (tint ? tint[2] : 1));
    }
    return g;
  };
  const dark = (g: THREE_NS.BufferGeometry, k: number) => bake(g, null, [k, k, k]);

  const merge = (list: THREE_NS.BufferGeometry[]): THREE_NS.BufferGeometry => {
    let nv = 0, ni = 0;
    for (const g of list) { nv += g.getAttribute("position").count; ni += g.index!.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), idx = new Uint32Array(ni);
    let ov = 0, oi = 0;
    for (const g of list) {
      const n = g.getAttribute("position").count;
      pos.set(g.getAttribute("position").array as Float32Array, ov * 3);
      nor.set(g.getAttribute("normal").array as Float32Array, ov * 3);
      col.set(g.getAttribute("color").array as Float32Array, ov * 3);
      const gi = g.index!.array;
      for (let i = 0; i < gi.length; i++) idx[oi + i] = gi[i]! + ov;
      ov += n; oi += gi.length;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  };

  const ellipsoid = (rx: number, ry: number, rz: number, seg: number, rows: number) => {
    const rs: Ring[] = [];
    for (let j = 0; j <= rows; j++) {
      const ang = -Math.PI / 2 + (j / rows) * Math.PI;
      rs.push(Yring(ry * Math.sin(ang), rx * Math.cos(ang), rz * Math.cos(ang)));
    }
    return loft(rs, seg);
  };

  /** Torus around a vertical axis (collars). rx, rz: ring radii; tube: half-width and half-height of the section. */
  const torus = (y: number, rx: number, rz: number, tw: number, th: number, seg: number, tubeSeg: number, cz = 0) => {
    const rs: Ring[] = [];
    for (let k = 0; k < seg; k++) {
      const phi = (k / seg) * TAU, rad = Math.hypot(Math.cos(phi) * rz, Math.sin(phi) * rx) || 1;
      const nx = (Math.cos(phi) * rz) / rad, nz = (Math.sin(phi) * rx) / rad; // radial direction in the xz plane
      rs.push({ c: [rx * Math.cos(phi), y, rz * Math.sin(phi) + cz], a: [nx * tw, 0, nz * tw], b: [0, th, 0] });
    }
    return loft(rs, tubeSeg, 2, true);
  };

  /** A tapered limb hanging from its pivot (y = 0) down to -len, ball-capped at both ends. */
  const limb = (len: number, rTop: number, rows: readonly (readonly [number, number])[], rBot: number, seg: number, zs = 1, capBot = rBot) => {
    // low quality keeps only the widest station between the ends
    const kept = low ? [rows.reduce((m, r) => (r[1] > m[1] ? r : m))] : rows;
    const rs: Ring[] = [Yring(0, rTop, rTop * zs), ...kept.map(([t, r]) => Yring(-t * len, r, r * zs)), Yring(-len, rBot, rBot * zs)];
    return loft(caps(rs, rTop, capBot, CS), seg);
  };

  /** Ribbon along a smoothed path (straps). */
  const strap = (pts: V3[], halfW: number, halfT: number, outward: (p: V3) => V3) => {
    const sub = low ? 1 : 2;
    const path: V3[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!;
      for (let s = 0; s < sub; s++) path.push([0, 1, 2].map((k) => cr(p0[k]!, p1[k]!, p2[k]!, p3[k]!, s / sub)) as V3);
    }
    path.push(pts[pts.length - 1]!);
    const rs: Ring[] = path.map((p, i) => {
      const q = path[Math.min(path.length - 1, i + 1)]!, o = path[Math.max(0, i - 1)]!;
      const t = new THREE.Vector3(q[0] - o[0], q[1] - o[1], q[2] - o[2]).normalize();
      const on = outward(p);
      const n = new THREE.Vector3(on[0], on[1], on[2]);
      n.addScaledVector(t, -n.dot(t)).normalize();
      const w = new THREE.Vector3().crossVectors(t, n).normalize();
      return { c: p, a: [w.x * halfW, w.y * halfW, w.z * halfW], b: [n.x * halfT, n.y * halfT, n.z * halfT] };
    });
    return loft(caps(rs, halfT, halfT, 1), 4, 5);
  };

  /* ---------------- torso: jacket / coat body, shirt, tail ---------------- */
  const JACKET_HIGH: [number, number][] = [
    [0.85, 0.19], [0.93, 0.176], [1.02, 0.156], [1.12, 0.15], [1.22, 0.157], [1.3, 0.161], [1.36, 0.16], [1.4, 0.15], [1.435, 0.115], [1.468, 0.066],
  ];
  const JACKET: [number, number][] = low ? JACKET_HIGH.filter(([y]) => ![0.93, 1.12, 1.3].includes(y)) : JACKET_HIGH;
  const rJ = tableFn(JACKET);
  const ly = (y: number) => y - CHEST_Y;
  const rLin = (y: number) => {
    for (let i = 1; i < JACKET.length; i++) if (y <= JACKET[i]![0]) return lerp(JACKET[i - 1]![1], JACKET[i]![1], (y - JACKET[i - 1]![0]) / (JACKET[i]![0] - JACKET[i - 1]![0]));
    return JACKET[JACKET.length - 1]![1];
  };
  const torso = loft(caps(JACKET.map(([y, r]) => Yring(ly(y), r, r * TORSO_DEPTH)), 0.014, 0.022, CS), SEG.torso, 2.3);
  bake(torso, (x, y, z, _nx, ny) => {
    const wy = y + CHEST_Y;
    let f = 0.74 + 0.26 * smoothstep(0.85, 1.08, wy);
    f *= 1 - 0.34 * gauss(Math.abs(x) - 0.15, 0.05) * gauss(wy - 1.27, 0.075); // armpit
    f *= 1 - 0.3 * smoothstep(1.43, 1.47, wy); // neck base
    if (z > 0.02 && Math.abs(x) < 0.014 && wy > 0.88 && wy < 1.42) f *= 0.72; // zip / placket line
    f *= 0.9 + 0.1 * smoothstep(-0.1, 0.1, z); // back slightly deeper in tone
    return f * (1 + 0.06 * clamp(ny, 0, 1));
  });

  // Open-collar shirt: light V panel just proud of the coat front + a collar band around the neck.
  const panelCols = low ? 4 : 5;
  const ppos: number[] = [], pidx: number[] = [];
  const panelYs = low ? [1.452, 1.435, 1.4, 1.36, 1.22, 1.02] : [1.452, 1.435, 1.4, 1.36, 1.3, 1.22, 1.12, 1.03]; // includes the jacket's own stations: no chord cuts a corner
  const panelRows = panelYs.length;
  for (let j = 0; j < panelRows; j++) {
    const y = panelYs[j]!;
    const w = lerp(0.0, 0.44, smoothstep(1.02, 1.42, y) ** 0.8);
    for (let i = 0; i < panelCols; i++) {
      // on the lofted surface (linear between the stations, superellipse section), a little proud of it
      const phi = lerp(-w, w, i / (panelCols - 1)), r = rLin(y) + 0.009;
      ppos.push(r * Math.sign(phi) * Math.abs(Math.sin(phi)) ** (2 / 2.3), ly(y), r * TORSO_DEPTH * Math.cos(phi) ** (2 / 2.3));
    }
  }
  for (let j = 0; j < panelRows - 1; j++) for (let i = 0; i < panelCols - 1; i++) {
    const a = j * panelCols + i, b = a + 1, c = a + panelCols, d = c + 1;
    pidx.push(a, c, b, b, c, d);
  }
  let panel = finish(ppos, pidx);
  if (panel.getAttribute("normal").getZ(Math.floor(panelCols / 2)) < 0) { // face outward (+Z at the front)
    for (let t = 0; t < pidx.length; t += 3) { const x = pidx[t + 1]!; pidx[t + 1] = pidx[t + 2]!; pidx[t + 2] = x; }
    panel.dispose();
    panel = finish(ppos, pidx);
  }
  bake(panel, (x, y) => {
    const wy = y + CHEST_Y;
    return (0.7 + 0.3 * smoothstep(1.0, 1.4, wy)) * (1 - 0.4 * smoothstep(0.03, 0.06, Math.abs(x)) * smoothstep(1.46, 1.3, wy));
  });
  const collar = torus(ly(1.484), 0.06, 0.054, 0.014, 0.016, SEG.torus, low ? 3 : 4);
  bake(collar, (_x, _y, z) => 0.85 + 0.15 * smoothstep(-0.05, 0.05, z));
  const shirt = merge([panel, collar]);

  // Long coat / skirt: one flared tube per leg, hanging from the hip joint, so the hem swings with each leg and
  // a stepping thigh never pokes out through it. Above the jacket hem it stays inside the torso.
  const HIP_Y = HIPS_Y + THIGH_DY;
  const skirt = loft(
    caps([Yring(TAIL_TOP - HIP_Y, 0.06, 0.075), Yring(0, 0.08, 0.1), Yring(0.85 - HIP_Y, 0.092, 0.122), Yring(0.82 - HIP_Y, 0.114, 0.135), Yring(0.68 - HIP_Y, 0.13, 0.15), Yring(0.5 - HIP_Y, 0.14, 0.16)], 0.012, 0.01, 1),
    SEG.thigh,
    2.2,
  );
  bake(skirt, (_x, y, z) => (0.66 + 0.34 * smoothstep(-0.45, -0.02, y)) * (0.92 + 0.08 * smoothstep(-0.1, 0.1, z)));

  /* ---------------- head: skull + neck + ears + eyes ---------------- */
  const HC = 0.05; // skull centre above the head pivot
  const wx = 0.0775, wz = 0.098, hh = 0.1075;
  const kx = (ny: number) => 1 - 0.3 * (ny < 0 ? -ny : 0) ** 1.7;
  const kz = (ny: number) => 1 - 0.2 * (ny < 0 ? -ny : 0) ** 1.4;
  const skullRings: Ring[] = [];
  const SROWS = low ? 6 : 10;
  for (let j = 0; j <= SROWS; j++) {
    const ang = -Math.PI / 2 + (j / SROWS) * Math.PI, ny = Math.sin(ang), sc = Math.cos(ang);
    skullRings.push(Yring(HC + ny * hh, wx * kx(ny) * sc, wz * kz(ny) * sc, 0.004));
  }
  const frontZ = (x: number, y: number) => {
    const ny = clamp((y - HC) / hh, -1, 1), nx = x / (wx * kx(ny));
    return Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * wz * kz(ny) + 0.004;
  };
  const skull = loft(skullRings, SEG.head);
  bake(skull, (x, y, z, _nx, ny) => {
    let f = 1 - 0.26 * smoothstep(-0.2, -0.9, ny) * smoothstep(HC - 0.03, HC - 0.07, y);
    if (Math.abs(x) > 0.07) f *= 0.93;
    return f;
  });
  const neck = loft(caps([Yring(-0.1, 0.058, 0.055, 0.008), Yring(-0.01, 0.05, 0.048, 0.008), Yring(0.04, 0.046, 0.045, 0.008)], 0.01, 0.01, 1), low ? 5 : 8);
  bake(neck, (_x, y) => 1 - 0.45 * smoothstep(0.0, 0.08, y) - 0.1 * smoothstep(-0.06, -0.1, y));
  const nose = ellipsoid(0.0085, 0.019, 0.013, low ? 4 : 6, low ? 3 : 4).rotateX(-0.3).translate(0, HC - 0.014, frontZ(0, HC - 0.014) - 0.001);
  const ears = low ? [] : [-1, 1].map((s) => ellipsoid(0.0075, 0.023, 0.0145, 5, 4).translate(s * (wx - 0.001), HC - 0.004, 0.008));
  const eyes = [-1, 1].map((s) => dark(ellipsoid(0.0085, 0.0062, 0.004, low ? 4 : 5, low ? 2 : 3).translate(s * 0.031, HC + 0.006, frontZ(s * 0.031, HC + 0.006) + 0.0005), 0.16));
  const head = merge([skull, neck, nose, ...ears, ...eyes]);

  /* ---------------- hair: three silhouettes (short, long, ponytail) ---------------- */
  const hairCap = () => {
    const all = [
      Yring(-0.04, 0.062, 0.068, -0.036), Yring(-0.005, 0.075, 0.086, -0.027), Yring(0.03, 0.08, 0.098, -0.018), Yring(0.065, 0.088, 0.106, -0.01),
      Yring(0.095, 0.085, 0.108, -0.004), Yring(0.125, 0.068, 0.092, 0), Yring(0.15, 0.04, 0.055, 0),
    ];
    const rs = low ? [all[0]!, all[2]!, all[4]!, all[5]!] : all;
    return loft(caps(rs, 0.012, 0.016, CS), SEG.hair);
  };
  const hairShade = (g: THREE_NS.BufferGeometry) => bake(g, (x, y, z) => (0.5 + 0.5 * smoothstep(-0.1, 0.15, y)) * (0.92 + 0.08 * Math.sin(x * 120 + z * 80 + y * 50)));
  const hair0 = hairShade(hairCap());
  const hair1 = hairShade(merge([hairCap(), loft(caps([Yring(0.05, 0.075, 0.045, -0.075), Yring(-0.03, 0.085, 0.05, -0.085), Yring(-0.1, 0.09, 0.052, -0.09), Yring(-0.16, 0.088, 0.045, -0.085)], 0.02, 0.03, CS), low ? 5 : 8)]));
  const hair2 = hairShade(merge([hairCap(), loft(caps([Yring(0.1, 0.02, 0.02, -0.1), Yring(0.04, 0.026, 0.026, -0.12), Yring(-0.03, 0.024, 0.024, -0.125), Yring(-0.1, 0.016, 0.016, -0.12)], 0.03, 0.03, CS), low ? 4 : 6)]));

  /* ---------------- limbs ---------------- */
  const upperArm = limb(L_UPPER_ARM, 0.052, [[0.15, 0.056], [0.55, 0.05]], 0.046, SEG.limb);
  bake(upperArm, (x, y) => (1 - 0.3 * smoothstep(0.0, 0.05, Math.abs(x)) * smoothstep(-0.02, -0.12, y) * 0.8) * (1 - 0.1 * smoothstep(-0.24, -0.3, y)));
  const foreArm = limb(L_FOREARM, 0.046, [[0.15, 0.045], [0.6, 0.038]], 0.0345, SEG.limb, 1, 0.014);
  bake(foreArm, (_x, y) => (y < -0.235 ? 0.78 : 1));
  const hand = loft(caps([Yring(-0.012, 0.022, 0.028), Yring(-0.05, 0.0185, 0.037), Yring(-0.1, 0.0175, 0.039), Yring(-0.14, 0.0125, 0.031)], 0.01, 0.028, CS), SEG.hand);
  bake(hand, (_x, y) => 0.86 + 0.14 * smoothstep(-0.17, -0.05, y));
  const thigh = limb(L_THIGH, 0.07, [[0.14, 0.08], [0.55, 0.066]], 0.054, SEG.thigh);
  bake(thigh, (_x, y, z) => {
    let f = 1;
    if (y > -0.04) f *= 0.8 + 0.2 * smoothstep(0.1, -0.04, y);
    if (z > 0.03 && y < -0.38) f *= 0.88;
    return f;
  });
  const shin = limb(L_SHIN, 0.053, [[0.15, 0.054], [0.6, 0.044]], 0.039, SEG.shin);
  bake(shin, (_x, y, z) => (y < -0.36 ? 0.86 + 0.14 * smoothstep(-0.405, -0.36, y) : 1) * (z > 0.03 && y > -0.1 ? 0.9 : 1));

  /* ---------------- shoe: rounded upper + darker sole ---------------- */
  const upperTop = tableFn([[-0.08, -0.012], [-0.056, 0.014], [-0.02, 0.026], [0.025, 0.022], [0.065, 0.008], [0.105, -0.008], [0.142, -0.022], [0.176, -0.032]]);
  const half = tableFn([[-0.08, 0.034], [-0.06, 0.041], [-0.02, 0.045], [0.04, 0.047], [0.09, 0.05], [0.13, 0.05], [0.178, 0.04]]);
  const shoeRings = (low ? [-0.08, 0.0, 0.1, 0.176] : [-0.08, -0.03, 0.04, 0.11, 0.176]).map((z) => {
    const top = upperTop(z), bot = -0.052;
    return Zring(z, half(z), (top - bot) / 2, (top + bot) / 2);
  });
  const upper = loft(caps(shoeRings, 0.006, 0.006, CS), SEG.shoe, 2.6);
  bake(upper, (_x, y) => 0.8 + 0.2 * smoothstep(-0.05, 0.0, y));
  const soleRings = (low ? [-0.084, 0.1, 0.18] : [-0.084, 0.0, 0.1, 0.18]).map((z, i) => Zring(z, (low ? [0.035, 0.052, 0.04] : [0.035, 0.048, 0.052, 0.04])[i]!, 0.015, -0.057));
  const sole = dark(loft(caps(soleRings, 0.004, 0.004, 1), SEG.shoe, 3.4), 0.34);
  const shoe = merge([upper, sole]);
  // Rigid-foot support points: every vertex in the lower part of the shoe as (z, y), with duplicates folded.
  const solePts = (() => {
    const p = shoe.getAttribute("position"), seen = new Set<string>(), out: number[] = [];
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i), y = p.getY(i);
      if (y > -0.045) continue;
      const key = `${Math.round(z * 1e4)},${Math.round(y * 1e4)}`;
      if (!seen.has(key)) { seen.add(key); out.push(z, y); }
    }
    return new Float64Array(out);
  })();

  /* ---------------- bags ---------------- */
  const outward = (p: V3): V3 => {
    const r = rJ(p[1] + CHEST_Y);
    return [p[0] / (r * r), 0.18, p[2] / (r * r * TORSO_DEPTH * TORSO_DEPTH)];
  };
  const surf = (y: number, phi: number, inset = 0): V3 => {
    const r = rJ(y) - inset;
    return [r * Math.sin(phi), ly(y), r * TORSO_DEPTH * Math.cos(phi)];
  };
  const backpackBody = loft(caps([Yring(ly(1.0), 0.13, 0.06, -0.19), Yring(ly(1.12), 0.146, 0.07, -0.19), Yring(ly(1.3), 0.146, 0.07, -0.19), Yring(ly(1.4), 0.128, 0.062, -0.19)], 0.03, 0.03, CS), SEG.pack, 4.2);
  const pocket = loft(caps([Yring(ly(1.05), 0.09, 0.025, -0.255), Yring(ly(1.17), 0.1, 0.028, -0.255)], 0.02, 0.02, 1), low ? 6 : 8, 4);
  const straps = [-1, 1].map((s) => strap([
    [s * 0.1, ly(1.37), -0.17], [s * 0.098, ly(1.45), -0.06], surf(1.39, Math.PI - s * 0.95, -0.004), surf(1.25, Math.PI - s * 1.3, -0.004), [s * 0.14, ly(1.08), -0.08],
  ], 0.021, 0.006, outward));
  const backpack = merge([backpackBody, pocket, ...straps]);
  bake(backpack, (_x, y, z) => (0.78 + 0.22 * smoothstep(ly(1.0), ly(1.3), y)) * (z > -0.15 ? 0.82 : 1));

  const bagBody = loft(caps([Yring(0.86 - CHEST_Y, 0.052, 0.14, -0.01, 0.275), Yring(0.95 - CHEST_Y, 0.057, 0.16, -0.01, 0.275), Yring(1.04 - CHEST_Y, 0.052, 0.15, -0.01, 0.275)], 0.03, 0.02, CS), SEG.pack, 3.2);
  const bagStrap = strap([
    [0.27, 1.04 - CHEST_Y, 0.1], [0.245, 1.2 - CHEST_Y, 0.075], [0.19, 1.37 - CHEST_Y, 0.05], [0.14, ly(1.45), 0.0], [0.19, 1.37 - CHEST_Y, -0.06], [0.245, 1.2 - CHEST_Y, -0.09], [0.27, 1.04 - CHEST_Y, -0.12],
  ], 0.014, 0.006, (p) => [p[0] - 0.1, 0.6, p[2] * 4]);
  const shoulderBag = merge([bagBody, bagStrap]);
  bake(shoulderBag, (_x, y) => 0.7 + 0.3 * smoothstep(0.86 - CHEST_Y, 1.04 - CHEST_Y, y));

  return { torso, shirt, skirt, head, hair0, hair1, hair2, upperArm, foreArm, hand, thigh, shin, shoe, solePts, backpack, shoulderBag };
}

interface Look {
  sh: number; sw: number; stride: number; stoop: number; headPitch: number; glance: number; glanceRate: number;
  hair: 0 | 1 | 2; open: boolean; tail: number; carry: "backpack" | "shoulderBag" | null; bagSide: 1 | -1;
}

export function buildCrowd(
  THREE: typeof THREE_NS,
  edges: Edge[],
  toRenderer: (x: number, y: number, z: number) => THREE_NS.Vector3,
  count: number,
  envMap: THREE_NS.Texture,
  lanes: Record<string, Lane> = {},
) {
  const paths: Path[] = [];
  for (const e of edges) {
    if (e.verification !== "verified" || e.geometry.some((p) => p.z === null)) continue;
    const pts = e.geometry.map((p) => toRenderer(p.x, p.y, p.z as number));
    const cum = [0], hcum = [0];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      cum.push(cum[i - 1]! + b.distanceTo(a));
      hcum.push(hcum[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z));
    }
    if (cum[cum.length - 1]! > 1) paths.push({ pts, cum, hcum, length: cum[cum.length - 1]!, from: e.from, to: e.to, lane: lanes[e.id] });
  }
  const byNode = new Map<string, number[]>();
  paths.forEach((p, i) => {
    for (const n of [p.from, p.to]) byNode.set(n, [...(byNode.get(n) ?? []), i]);
  });

  // Ends of the graph (exits): where people enter and leave.
  const deadEnds: { path: number; forward: boolean }[] = [];
  paths.forEach((p, i) => {
    if (byNode.get(p.from)?.length === 1) deadEnds.push({ path: i, forward: true });
    if (byNode.get(p.to)?.length === 1) deadEnds.push({ path: i, forward: false });
  });
  const rand = rng(7);
  const total = paths.reduce((s, p) => s + p.length, 0);
  const agents: Agent[] = [];
  for (let i = 0; i < count; i++) {
    // place proportionally to path length
    let r = rand() * total, k = 0;
    while (k < paths.length - 1 && r > paths[k]!.length) r -= paths[k++]!.length;
    agents.push({ path: k, forward: rand() < 0.5, s: r, speed: 1.15 + rand() * 0.5, offset: (rand() * 2 - 1) * 0.9, phase: 0, bobPhase: 0, hiddenUntil: -1 });
    const a = agents[i]!;
    a.phase = a.bobPhase = rand() * 6.28;
  }

  const geo = makeGeometry(THREE, count <= LOW_QUALITY_MAX_COUNT);
  // One material per surface type. Albedos are real-world values; the envMap is the only light, so it is
  // held down a little to keep dark coats dark.
  // Specular is cut back (MeshPhysicalMaterial.specularIntensity): with F0 = 0.04 against a bright studio envMap,
  // the fresnel term alone would turn a navy coat mid-grey.
  const mat = (rough: number, envMapIntensity: number, specularIntensity: number) =>
    new THREE.MeshPhysicalMaterial({ roughness: rough, metalness: 0, envMap, envMapIntensity, specularIntensity, vertexColors: true });
  const M = { cloth: mat(0.95, 0.7, 0.22), skin: mat(0.6, 0.7, 0.5), hair: mat(0.6, 0.7, 0.45), shoe: mat(0.5, 0.7, 0.6), bag: mat(0.85, 0.7, 0.3) };

  // Appearance has its own random stream: the walking stream (`rand`) is consumed exactly as before, so
  // where everyone walks and when is unchanged.
  const vr = rng(0x2f6e2b1);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(vr() * a.length)]!;
  const looks: Look[] = [];
  const cols: Record<string, number[]> = {};
  const colorOf = (key: string, i: number, hex: number) => { (cols[key] ??= [])[i] = hex; };
  const jitter = (hex: number, amt: number) => new THREE.Color(hex).multiplyScalar(1 - amt + vr() * 2 * amt).getHex();
  for (let i = 0; i < count; i++) {
    // legacy draws (carry choice, then 15 colour draws) keep the walking stream aligned with earlier builds
    const r = rand();
    rand(); // coat
    if (!(rand() < 0.6)) rand(); // trousers
    rand(); rand(); // skin, hair
    for (let k = 0; k < 11; k++) rand(); // bag colour per part
    const male = vr() < 0.52;
    const o = vr();
    // 0 suit, 1 casual jacket, 2 hoodie / knit, 3 trench, 4 skirt outfit
    const outfit = male ? (o < 0.36 ? 0 : o < 0.68 ? 1 : o < 0.85 ? 2 : 3) : o < 0.1 ? 0 : o < 0.28 ? 1 : o < 0.42 ? 2 : o < 0.64 ? 3 : 4;
    let coat: number, shirtHex = 0, open = false, tail = 0, leg: number;
    if (outfit === 0) {
      coat = pick(SUIT); open = vr() < 0.88; shirtHex = pick(SHIRT);
      leg = vr() < 0.7 ? jitter(coat, 0.1) : pick(PANTS.slice(0, 5));
    } else if (outfit === 1) {
      coat = pick(CASUAL); open = vr() < 0.4; shirtHex = pick(TEE); leg = pick(PANTS);
    } else if (outfit === 2) {
      coat = pick(KNIT); leg = pick(PANTS);
    } else if (outfit === 3) {
      coat = pick(TRENCH); open = vr() < 0.55; shirtHex = pick(male ? SHIRT : TEE); tail = 2; leg = male ? pick(PANTS.slice(0, 5)) : vr() < 0.5 ? 0x25262b : pick(PANTS.slice(0, 5));
    } else {
      coat = pick(vr() < 0.5 ? SUIT : vr() < 0.5 ? KNIT : CASUAL); open = vr() < 0.55; shirtHex = pick(SHIRT);
      tail = 1; leg = vr() < 0.55 ? 0x26272c : vr() < 0.5 ? 0x4a4a52 : pick(SKIN);
    }
    coat = jitter(coat, 0.06);
    const skin = pick(SKIN);
    const hairHex = jitter(pick(HAIR), 0.1);
    const hairR = vr();
    const hair = male ? 0 : hairR < 0.2 ? 0 : hairR < 0.65 ? 1 : 2;
    const sh = male ? 0.98 + vr() * 0.08 : 0.92 + vr() * 0.08;
    const sw = sh * (male ? 0.98 + vr() * 0.1 : 0.9 + vr() * 0.1);
    const speed = agents[i]!.speed;
    looks.push({
      sh, sw, stride: Math.min(0.75 + 0.31 * speed, 1.3) * (male ? 1 : 0.94), stoop: vr() < 0.2 ? 0.05 + vr() * 0.08 : vr() * 0.04, headPitch: vr() < 0.14 ? 0.25 + vr() * 0.2 : vr() * 0.06,
      glance: vr() * 6.28, glanceRate: 0.25 + vr() * 0.4, hair: hair as 0 | 1 | 2, open, tail,
      carry: r < 0.3 ? "backpack" : r < 0.55 ? "shoulderBag" : null, bagSide: vr() < 0.5 ? 1 : -1,
    });
    colorOf("coat", i, coat);
    colorOf("shirt", i, shirtHex);
    colorOf("tail", i, tail === 1 ? pick(SKIRT) : coat);
    colorOf("skin", i, skin);
    colorOf("hair", i, hairHex);
    colorOf("leg", i, leg);
    colorOf("shoe", i, pick(SHOE));
    colorOf("bag", i, pick(BAG));
  }

  /** One InstancedMesh per part. per = instances per person (2 for left/right); slots map people to instances for optional parts. */
  interface Part { mesh: THREE_NS.InstancedMesh; per: number; slots: Int32Array | null }
  const group = new THREE.Group();
  group.name = "ikebukuro_crowd";
  const c = new THREE.Color();
  const owned: THREE_NS.BufferGeometry[] = [];
  const make = (name: string, g: THREE_NS.BufferGeometry, m: THREE_NS.Material, per: number, has: ((l: Look, i: number) => boolean) | null, colorKey: string): Part => {
    owned.push(g);
    let slots: Int32Array | null = null, people = count;
    if (has) {
      slots = new Int32Array(count).fill(-1);
      people = 0;
      for (let i = 0; i < count; i++) if (has(looks[i]!, i)) slots[i] = people++;
    }
    const n = people * per;
    const mesh = new THREE.InstancedMesh(g, m, Math.max(1, n));
    mesh.count = n;
    mesh.name = `crowd_${name}`;
    for (let i = 0; i < count; i++) {
      for (let s = 0; s < per; s++) {
        const who = slots ? slots[i]! : i;
        if (who < 0) continue;
        mesh.setColorAt(who * per + s, c.setHex(cols[colorKey]![i]!));
      }
    }
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.userData.gteki_role = "ambient_crowd";
    group.add(mesh);
    return { mesh, per, slots };
  };
  const P = {
    torso: make("torso", geo.torso, M.cloth, 1, null, "coat"),
    shirt: make("shirt", geo.shirt, M.cloth, 1, (l) => l.open, "shirt"),
    skirt: make("skirt", geo.skirt, M.cloth, 2, (l) => l.tail > 0, "tail"),
    head: make("head", geo.head, M.skin, 1, null, "skin"),
    hair0: make("hair_short", geo.hair0, M.hair, 1, (l) => l.hair === 0, "hair"),
    hair1: make("hair_long", geo.hair1, M.hair, 1, (l) => l.hair === 1, "hair"),
    hair2: make("hair_tail", geo.hair2, M.hair, 1, (l) => l.hair === 2, "hair"),
    upperArm: make("upper_arm", geo.upperArm, M.cloth, 2, null, "coat"),
    foreArm: make("forearm", geo.foreArm, M.cloth, 2, null, "coat"),
    hand: make("hand", geo.hand, M.skin, 2, null, "skin"),
    thigh: make("thigh", geo.thigh, M.cloth, 2, null, "leg"),
    shin: make("shin", geo.shin, M.cloth, 2, null, "leg"),
    shoe: make("shoe", geo.shoe, M.shoe, 2, null, "shoe"),
    backpack: make("backpack", geo.backpack, M.bag, 1, (l) => l.carry === "backpack", "bag"),
    shoulderBag: make("shoulder_bag", geo.shoulderBag, M.bag, 1, (l) => l.carry === "shoulderBag", "bag"),
  };
  const parts = Object.values(P);
  const hairParts = [P.hair0, P.hair1, P.hair2];

  const pos = new THREE.Vector3(), dir = new THREE.Vector3(), side = new THREE.Vector3();
  let along = 0; // horizontal distance from the edge start at the last sample()
  const q = new THREE.Quaternion(), base = new THREE.Matrix4();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const bodyScale = new THREE.Vector3();
  // Camera position as last rendered (onBeforeRender gives the camera without any API change);
  // pedestrians that would fill the lens are hidden instead of blocking the view.
  const cam = new THREE.Vector3(1e9, 0, 0);
  const frustum = new THREE.Frustum(), viewProj = new THREE.Matrix4();
  let renders = 0;
  P.torso.mesh.onBeforeRender = (_r, _s, camera) => {
    renders++;
    cam.setFromMatrixPosition(camera.matrixWorld);
    frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  };
  // A fixed head-count spread over every verified passage is ~1 person per 30 m on phones. Instead,
  // people far from the camera and out of its view step back in on a passage 12-40 m away, still
  // out of view, so the crowd stays around the player without drawing more of them.
  const FAR_M = 50, SPAWN_MIN_M = 12, SPAWN_MAX_M = 40, MAX_MOVES_PER_FRAME = 2;
  // The camera's actual view volume, padded by a body-sized sphere (any aspect ratio or FOV).
  const body = new THREE.Sphere(new THREE.Vector3(), 1.2);
  // The pad grows ~7° with distance: the view used is the last rendered one, a frame behind a fast turn.
  const inView = (p: THREE_NS.Vector3) =>
    frustum.intersectsSphere(body.set(body.center.set(p.x, p.y + 0.9, p.z), 1.2 + 0.12 * p.distanceTo(cam)));
  function relocate(a: Agent): boolean {
    for (let attempt = 0; attempt < 8; attempt++) {
      let r = rand() * total, k = 0;
      while (k < paths.length - 1 && r > paths[k]!.length) r -= paths[k++]!.length;
      sample(paths[k]!, r);
      const dx = pos.x - cam.x, dy = pos.y + 1.1 - cam.y, dz = pos.z - cam.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < SPAWN_MIN_M || d > SPAWN_MAX_M || Math.abs(dy) > 6 || inView(pos)) continue;
      a.path = k;
      a.s = Math.min(paths[k]!.length, r);
      a.forward = rand() < 0.5;
      a.hiddenUntil = renders;
      return true;
    }
    return false;
  }
  const NEAR_CAM_M = 1.2;
  const up = new THREE.Vector3(0, 1, 0);

  function sample(p: Path, s: number) {
    let i = 1;
    while (i < p.cum.length - 1 && p.cum[i]! < s) i++;
    const t = Math.min(1, Math.max(0, (s - p.cum[i - 1]!) / Math.max(1e-6, p.cum[i]! - p.cum[i - 1]!)));
    pos.lerpVectors(p.pts[i - 1]!, p.pts[i]!, t);
    along = p.hcum[i - 1]! + t * (p.hcum[i]! - p.hcum[i - 1]!);
    dir.subVectors(p.pts[i]!, p.pts[i - 1]!).setY(0).normalize();
  }

  /* ---------------- pose: chained pivot matrices per person ---------------- */
  const eul = new THREE.Euler(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
  const vp = new THREE.Vector3(), vs = new THREE.Vector3(1, 1, 1), vsc = new THREE.Vector3(), axisX = new THREE.Vector3(1, 0, 0);
  const mHipsL = new THREE.Matrix4(), mHips = new THREE.Matrix4(), mHipsInv = new THREE.Matrix4(), mChest = new THREE.Matrix4(), mHead = new THREE.Matrix4();
  const mT = new THREE.Matrix4(), mA = new THREE.Matrix4(), mB = new THREE.Matrix4(), mC = new THREE.Matrix4();
  const ftL: FootSample = { f: 0, lift: 0, pitch: 0 }, ftR: FootSample = { f: 0, lift: 0, pitch: 0 };
  const gnd = { dy: 0, dz: 0 };
  const d3 = new THREE.Vector3(), u3 = new THREE.Vector3(), n3 = new THREE.Vector3(), t3 = new THREE.Vector3();
  const xAx = new THREE.Vector3(), yAx = new THREE.Vector3(), zAx = new THREE.Vector3();
  let clock = 0;

  /** local = translation * rotation (YXZ euler), written into out. */
  const loc = (out: THREE_NS.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number) => {
    eul.set(rx, ry, rz, "YXZ");
    return out.makeRotationFromEuler(eul).setPosition(x, y, z);
  };
  const put = (part: Part, i: number, side: number, m: THREE_NS.Matrix4) => {
    const who = part.slots ? part.slots[i]! : i;
    if (who >= 0) part.mesh.setMatrixAt(who * part.per + side, m);
  };
  const hide = (i: number) => {
    for (const part of parts) {
      if (part.per === 2) { put(part, i, 0, hidden); put(part, i, 1, hidden); } else put(part, i, 0, hidden);
    }
  };

  /** Two-bone leg to an ankle target given in the pelvis frame; writes the thigh quaternion and the knee flexion. */
  function legIK(s: number, tx: number, ty: number, tz: number, qThigh: THREE_NS.Quaternion): number {
    d3.set(tx - s * THIGH_X, ty - THIGH_DY, tz);
    const len = clamp(d3.length(), Math.abs(L_THIGH - L_SHIN) + 0.02, (L_THIGH + L_SHIN) * 0.994);
    u3.copy(d3).normalize();
    const cosKnee = (L_THIGH * L_THIGH + L_SHIN * L_SHIN - len * len) / (2 * L_THIGH * L_SHIN);
    const flex = Math.PI - Math.acos(clamp(cosKnee, -1, 1));
    const cosA = (L_THIGH * L_THIGH + len * len - L_SHIN * L_SHIN) / (2 * L_THIGH * len);
    const ang = Math.acos(clamp(cosA, -1, 1));
    // the knee points forward (a little outward); the bend plane holds the hip-ankle line and that direction
    const fwd = n3.set(s * 0.1, 0, 1).normalize();
    const fx = fwd.x, fy = fwd.y, fz = fwd.z;
    n3.addScaledVector(u3, -n3.dot(u3)).normalize();
    t3.copy(u3).multiplyScalar(Math.cos(ang)).addScaledVector(n3, Math.sin(ang));
    yAx.copy(t3).negate();
    xAx.set(yAx.y * fz - yAx.z * fy, yAx.z * fx - yAx.x * fz, yAx.x * fy - yAx.y * fx);
    if (xAx.lengthSq() < 1e-8) xAx.set(1, 0, 0);
    xAx.normalize();
    zAx.crossVectors(xAx, yAx);
    mC.makeBasis(xAx, yAx, zAx);
    qThigh.setFromRotationMatrix(mC);
    return flex;
  }

  const qThigh = new THREE.Quaternion(), qKnee = new THREE.Quaternion(), qFoot = new THREE.Quaternion(), qHipsL = new THREE.Quaternion();

  function pose(i: number, a: Agent, L: Look, bodyBase: THREE_NS.Matrix4) {
    const cyc = a.phase / TAU, ph = cyc - Math.floor(cyc);
    sampleFoot(ph, L.stride, ftL);
    sampleFoot(ph + 0.5, L.stride, ftR);
    const F = (L.stride * BETA) / 2;
    const fl = ftL.f / F, fr = ftR.f / F; // fore-aft fraction of each foot, ~ -1 (back) .. 1 (front)
    const stanceSide = Math.cos(TAU * (ph - BETA / 2)); // +1 over the left (+X) foot, -1 over the right
    const bob = Math.cos(2 * TAU * (ph - BETA / 2)); // pelvis rises over each stance foot

    // pelvis: bob, sway towards the stance foot, roll, counter-rotating yaw
    const hipsY = 0.918 + 0.026 * bob - L.stoop * 0.12;
    loc(mHipsL, 0.012 * stanceSide, hipsY, 0, 0.02, -0.075 * fl, 0.035 * stanceSide);
    mHips.multiplyMatrices(bodyBase, mHipsL);
    mHipsInv.copy(mHipsL).invert();
    qHipsL.setFromRotationMatrix(mHipsL);

    // chest: lean, counter-twist, counter-roll
    loc(mT, 0, CHEST_DY, 0, 0.03 + L.stoop, 0.11 * fl, -0.5 * 0.035 * stanceSide);
    mChest.multiplyMatrices(mHips, mT);
    // head: stabilised against the trunk, a slow look-around, optional phone-down tilt
    const gaze = Math.sin(clock * L.glanceRate * TAU + L.glance);
    loc(mT, 0, HEAD_PIVOT_DY, 0, -(0.03 + L.stoop) * 0.7 + L.headPitch, -0.11 * fl * 0.5 + 0.28 * gaze, 0.015 * stanceSide);
    mT.scale(vsc.setScalar(HEAD_SCALE));
    mHead.multiplyMatrices(mChest, mT);

    put(P.torso, i, 0, mChest);
    put(P.shirt, i, 0, mChest);
    put(P.head, i, 0, mHead);
    for (const h of hairParts) put(h, i, 0, mHead);
    if (L.carry === "backpack") put(P.backpack, i, 0, mChest);
    else if (L.carry === "shoulderBag") {
      if (L.bagSide > 0) put(P.shoulderBag, i, 0, mChest);
      else put(P.shoulderBag, i, 0, mA.multiplyMatrices(mChest, mB.makeRotationY(Math.PI)));
    }
    // arms: counter-swing to the same-side leg, elbow flexes more as the hand comes forward
    for (let sd = 0; sd < 2; sd++) {
      const s = sd === 0 ? 1 : -1; // +X is the person's left
      const fs = sd === 0 ? fl : fr;
      const bagArm = L.carry === "shoulderBag" && L.bagSide === s;
      const amp = bagArm ? 0.08 : 0.42;
      const abduct = bagArm ? 0.05 : 0.035 + 0.015 * Math.abs(fs); // sideways angle: arms hang close to the body (<= 3 deg)
      const fwd = -fs * amp + 0.07;
      const fwdN = bagArm ? 0.3 : clamp(0.5 - 0.5 * fs, 0, 1);
      eul.set(-fwd - (bagArm ? 0.05 : 0), 0, s * abduct, "XZY");
      mT.makeRotationFromEuler(eul).setPosition(s * SHOULDER_X, SHOULDER_DY, 0);
      mA.multiplyMatrices(mChest, mT); // upper arm
      put(P.upperArm, i, sd, mA);
      loc(mT, 0, -L_UPPER_ARM, 0, -(0.2 + 0.24 * fwdN + (bagArm ? 0.18 : 0)), 0, 0);
      mB.multiplyMatrices(mA, mT); // forearm
      put(P.foreArm, i, sd, mB);
      loc(mT, 0, -L_FOREARM, 0, -0.1, 0, 0);
      put(P.hand, i, sd, mC.multiplyMatrices(mB, mT));
    }

    // legs: foot trajectory -> two-bone IK -> thigh / shin / foot matrices
    for (let sd = 0; sd < 2; sd++) {
      const s = sd === 0 ? 1 : -1;
      const ft = sd === 0 ? ftL : ftR;
      pivotOffset(ft.pitch, geo.solePts, gnd);
      vp.set(s * 0.095, ANKLE_H + gnd.dy + ft.lift, ft.f + gnd.dz).applyMatrix4(mHipsInv);
      const flex = legIK(s, vp.x, vp.y, vp.z, qThigh);
      qKnee.setFromAxisAngle(axisX, flex);
      // foot orientation in the body frame: toe-out yaw * pitch; expressed relative to the shin
      eul.set(-ft.pitch, s * 0.1, 0, "YXZ");
      qb.setFromEuler(eul);
      qa.copy(qHipsL).multiply(qThigh).multiply(qKnee).invert();
      qFoot.multiplyQuaternions(qa, qb);
      mT.compose(vp.set(s * THIGH_X, THIGH_DY, 0), qThigh, vs);
      mA.multiplyMatrices(mHips, mT); // thigh
      put(P.thigh, i, sd, mA);
      if (L.tail > 0) {
        // long coat / skirt tube follows most of the thigh swing; skirts are shorter
        const k = L.tail === 2 ? 1 : 0.62;
        qa.identity().slerp(qThigh, 0.8);
        mT.compose(vp.set(s * THIGH_X, THIGH_DY + (TAIL_TOP - HIPS_Y - THIGH_DY) * (1 - k), 0), qa, vsc.set(1, k, 1));
        put(P.skirt, i, sd, mC.multiplyMatrices(mHips, mT));
      }
      mT.compose(vp.set(0, -L_THIGH, 0), qKnee, vs);
      mB.multiplyMatrices(mA, mT); // shin
      put(P.shin, i, sd, mB);
      qc.copy(qFoot);
      mT.compose(vp.set(0, -L_SHIN, 0), qc, vs);
      put(P.shoe, i, sd, mC.multiplyMatrices(mB, mT));
    }
  }

  let nearby = 0;
  function update(dt: number, _elapsed: number) {
    let near = 0, moves = 0;
    clock += dt;
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]!;
      if (moves < MAX_MOVES_PER_FRAME && cam.x < 1e8) {
        sample(paths[a.path]!, a.s);
        const dx = pos.x - cam.x, dy = pos.y + 1.1 - cam.y, dz = pos.z - cam.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > FAR_M && !inView(pos) && relocate(a)) moves++;
      }
      let p = paths[a.path]!;
      const L = looks[i]!;
      a.s += (a.forward ? 1 : -1) * a.speed * dt;
      a.phase += (a.speed * dt * TAU) / (L.stride * L.sw); // gait phase follows distance walked: planted feet do not slide
      a.bobPhase += (a.speed * dt * TAU) / 1.45; // the earlier build's phase: one cycle per ~1.45 m
      if (a.s > p.length || a.s < 0) {
        const node = a.s > p.length ? p.to : p.from;
        const options = (byNode.get(node) ?? []).filter((j) => j !== a.path);
        const next = options.length ? options[Math.floor(rand() * options.length)]! : a.path;
        if (next === a.path && !deadEnds.length) {
          a.forward = !a.forward;
          a.s = Math.min(p.length, Math.max(0, a.s));
        } else if (next === a.path) {
          // Dead end = an exit stair top: this person leaves; someone else enters at another exit,
          // one out of view. With every exit in view, they turn back instead.
          let enter: (typeof deadEnds)[number] | null = null;
          for (let attempt = 0; attempt < 6 && !enter; attempt++) {
            const e = deadEnds[Math.floor(rand() * deadEnds.length)]!;
            const q = paths[e.path]!;
            sample(q, e.forward ? 0 : q.length);
            if (cam.x > 1e8 || !inView(pos)) enter = e;
          }
          if (enter) {
            a.path = enter.path;
            p = paths[enter.path]!;
            a.forward = enter.forward;
            a.s = a.forward ? 0 : p.length;
            a.hiddenUntil = renders;
          } else {
            a.forward = !a.forward;
            a.s = Math.min(p.length, Math.max(0, a.s));
          }
        } else {
          a.path = next;
          p = paths[next]!;
          a.forward = p.from === node;
          a.s = a.forward ? 0 : p.length;
        }
      }
      sample(p, a.s);
      if (!a.forward) dir.negate();
      side.crossVectors(dir, up);
      // keep to the left like Tokyo pedestrians tend to, plus personal offset, clamped to the
      // surveyed walkable lane so nobody stands in a wall or off the floor.
      let off = -0.3 + a.offset * 0.4;
      if (p.lane?.left.length) {
        // The interval the walker is in; each value already holds over the whole interval. Lanes are
        // indexed by horizontal distance, so on stairs the 3D arc length a.s would run ahead of them.
        const k = Math.min(p.lane.left.length - 1, Math.max(0, Math.floor(along / p.lane.stepM)));
        // lanes are measured to walkable-cell centres; keep shoulders (~0.3 m) off the walls
        const left = Math.max(0, p.lane.left[k]! - 0.2);
        const right = Math.max(0, p.lane.right[k]! - 0.2);
        const edgeOff = a.forward ? off : -off; // edge frame: + = right of from->to
        off = (a.forward ? 1 : -1) * Math.min(right, Math.max(-left, edgeOff));
      } else {
        off = 0;
      }
      pos.addScaledVector(side, off);
      q.setFromAxisAngle(up, Math.atan2(dir.x, dir.z));
      base.compose(pos, q, bodyScale.set(L.sw, L.sh, L.sw)); // rendered pose: the feet stand on the true floor
      // Visibility and proximity decisions keep the earlier build's small vertical bob so who gets hidden
      // near the camera (and who counts as nearby) is unchanged; the pose above does not use it.
      const floorY = pos.y;
      pos.y += Math.abs(Math.cos(a.bobPhase)) * 0.025;
      const dx = pos.x - cam.x, dz = pos.z - cam.z, dy = pos.y + 1.1 - cam.y;
      if (dx * dx + dz * dz + dy * dy < 64) near++;
      // Someone who just moved stays hidden until a frame rendered after the move shows the spot out
      // of view: a turn of any speed between the move and the next frame never shows the jump.
      let shown = true;
      if (a.hiddenUntil >= 0) {
        if (renders > a.hiddenUntil && !inView(pos)) a.hiddenUntil = -1;
        else shown = false;
      }
      pos.y = floorY;
      if (!shown || dx * dx + dz * dz + dy * dy < NEAR_CAM_M * NEAR_CAM_M) {
        hide(i);
        continue;
      }
      pose(i, a, L, base);
    }
    for (const part of parts) part.mesh.instanceMatrix.needsUpdate = true;
    nearby = near;
  }
  update(0, 0);

  return {
    group,
    update,
    /** Pedestrians within 8 m of the last rendered camera (for ambience). */
    nearby: () => nearby,
    dispose() {
      owned.forEach((g) => g.dispose());
      Object.values(M).forEach((m) => m.dispose());
      parts.forEach((p) => p.mesh.dispose());
    },
  };
}
