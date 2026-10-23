import type * as THREE from "three";

// All coordinates, tailoring, faces and accessories below are original procedural
// artwork. +Y is up, -Z is forward. No external texture, font, model or operator art is used.
export const BONE = { pelvis: 0, spine: 1, head: 2, leftShoulder: 3, leftElbow: 4,
  rightShoulder: 5, rightElbow: 6, leftHip: 7, leftKnee: 8, leftAnkle: 9,
  rightHip: 10, rightKnee: 11, rightAnkle: 12, hem: 13 } as const;
export const HIP = 0.93;
export const THIGH = 0.41;
export const SHIN = 0.43;
export const ANKLE = 0.09;
// The neck is attached to the head rig. Its coronal centre plane is the
// lower-hair limit: a nape may extend down, but cannot wrap across the throat.
export const NECK = { y: 1.491, z: 0.002, rx: 0.044, ry: 0.059, rz: 0.043,
  collarY: 1.478, chinY: 1.525 } as const;
const NAPE_TOP = NECK.y + NECK.ry;
const NAPE_BACK = NECK.z;
export const HEIGHTS = [1, 1.025, 0.97, 0.945, 1.04, 0.99, 0.96, 1.015] as const;
// Jacket, trousers, shirt, shoes, skin, hair, bag. No uniform or brand is represented.
const PALETTES = [
  [0x354e64, 0x4d535a, 0xe2dfd4, 0x353940, 0xd6a181, 0x302823, 0x99836a],
  [0x343a45, 0x333943, 0xdce2e4, 0x282b30, 0xe0ad8b, 0x26272b, 0x555247],
  [0x9a8b75, 0x4b4842, 0xe8e2d7, 0x44362f, 0xb87f60, 0x2f2926, 0x77776b],
  [0xd1cec4, 0x34383e, 0xe8e5dc, 0x393a38, 0xd4a082, 0x493326, 0x707b7e],
  [0x292d34, 0x2e3038, 0xd7dfe1, 0x24272b, 0xb67d5e, 0x777974, 0x575b62],
  [0x677163, 0x424c4d, 0xddd9ca, 0x3d3530, 0xaf7658, 0x292725, 0x827568],
  [0x785e65, 0x41414c, 0xe4dbd5, 0x393039, 0xd2a083, 0x37302e, 0x6b6158],
  [0x66768a, 0x3d4653, 0xdfe2df, 0x30363e, 0xc58e6e, 0x302721, 0x74786b],
] as const;
export const OUTFITS = ["field jacket / backpack", "suit / glasses", "coat / tote",
  "knitwear / skirt", "suit / mask", "knitwear / shoulder bag", "jacket / skirt / tote", "coat / shoulder bag"] as const;
export const HAIR = ["short side part", "crop / fade", "long layered", "bob", "grey / receding",
  "textured crop", "shoulder length / fringe", "swept bun"] as const;
// Index into an original 8-pixel roughness atlas. RGB vertex colour carries
// pigment and quiet crease occlusion; the atlas gives each surface its own BRDF.
export const SURFACE = { fabric: 0, skin: 1, hair: 2, leather: 3, sole: 4, metal: 5, bag: 6 } as const;
export const ROUGHNESS = [0.92, 0.74, 0.68, 0.48, 0.87, 0.36, 0.82, 1] as const;

type Ring = [y: number, rx: number, rz: number, x?: number, z?: number];
type Skin = [bone: number, next?: number, blend?: number];

/** A single indexed surface with smooth normals and blended joints. Separate
 * garment/face/accessory islands share one vertex-colour material and draw. */
export function buildCharacter(T: typeof THREE, outfit: number, far: boolean): THREE.BufferGeometry {
  const palette = PALETTES[outfit]!;
  const color = new T.Color();
  const position: number[] = [], colors: number[] = [], indices: number[] = [];
  const skinIndices: number[] = [], skinWeights: number[] = [], uv: number[] = [];
  let surface: number = SURFACE.fabric;
  let hemLoop: number[] = [];
  const radial = far ? 6 : 12;
  function vertex(x: number, y: number, z: number, tint: number, skin: Skin, shade = 1): number {
    if (surface === SURFACE.hair && y < NAPE_TOP + NECK.ry && z < NAPE_BACK) {
      // Long shell rims and side-lock tips used to curl inward below the jaw,
      // leaving thin dark bridges across the neck. Sweep the complete lower
      // hair volume behind its centre plane, blending over one neck radius
      // above the nape. Length, side volume, topology and head weights remain.
      z += (NAPE_BACK - z) * Math.min(1, (NAPE_TOP + NECK.ry - y) / NECK.ry);
    }
    const index = position.length / 3;
    position.push(x, y, z);
    uv.push((surface + 0.5) / ROUGHNESS.length, 0.5);
    color.setHex(tint).multiplyScalar(shade);
    colors.push(color.r, color.g, color.b);
    const w = skin[2] ?? 0;
    skinIndices.push(skin[0], skin[1] ?? skin[0], 0, 0);
    skinWeights.push(1 - w, w, 0, 0);
    return index;
  }
  function loft(rings: Ring[], tint: number | ((y: number) => number), skin: Skin | ((y: number, x: number, z: number) => Skin), n = radial, roundness = 1): void {
    if (far && rings.length >= 8) rings = rings.filter((_, i) => i === 0 || i === rings.length - 1 || i % 2 === 1);
    const start = position.length / 3;
    for (const [y, rx, rz, x = 0, z = 0] of rings) {
      for (let j = 0; j < n; j++) {
        const a = j / n * Math.PI * 2;
        const cx = Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** roundness;
        const sz = Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** roundness;
        // Quiet tonal variation suggests fabric panels without baked lighting.
        vertex(x + cx * rx, y, z + sz * rz, typeof tint === "function" ? tint(y) : tint,
          typeof skin === "function" ? skin(y, x + cx * rx, z + sz * rz) : skin,
          0.98 + Math.cos(a * 2) * 0.02);
      }
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < n; j++) {
        const a = start + i * n + j, b = start + i * n + (j + 1) % n;
        const c = a + n, d = b + n;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  function oval(x: number, y: number, z: number, rx: number, ry: number, rz: number,
    tint: number, bone: number, sections = far ? 4 : 6, n = radial): void {
    const rings: Ring[] = [];
    for (let i = 0; i <= sections; i++) {
      const a = i / sections * Math.PI;
      rings.push([y - Math.cos(a) * ry, Math.sin(a) * rx, Math.sin(a) * rz, x, z]);
    }
    loft(rings, tint, [bone], n);
  }
  function patch(points: number[][], tint: number, bone: number): void {
    const v = points.map(([x, y, z]) => vertex(x!, y!, z!, tint, [bone]));
    for (let i = 1; i < v.length - 1; i++) {
      const a = points[0]!, b = points[i]!, c = points[i + 1]!;
      const facing = (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
      indices.push(v[0]!, v[facing > 0 ? i + 1 : i]!, v[facing > 0 ? i : i + 1]!);
    }
  }
  function surfaceZ(rings: Ring[], x: number, y: number, n: number, front = true): number {
    const upper = rings.findIndex(r => r[0] >= y);
    const a = rings[Math.max(0, upper - 1)]!, b = rings[Math.max(0, upper)]!;
    // Intersect the actual loft triangles, including their diagonal, rather
    // than an ideal ellipse: decals must not sink through a low-poly facet.
    const point = (r: Ring, j: number) => {
      const angle = j / n * Math.PI * 2;
      return [(r[3] ?? 0) + Math.cos(angle) * r[1], r[0], (r[4] ?? 0) + Math.sin(angle) * r[2]];
    };
    for (let j = front ? n / 2 : 0; j < (front ? n : n / 2); j++) {
      const p = point(a, j), q = point(a, j + 1), r = point(b, j), t = point(b, j + 1);
      for (const [v0, v1, v2] of [[p, r, q], [q, r, t]] as [number[], number[], number[]][]) {
        const det = (v1[1]! - v2[1]!) * (v0[0]! - v2[0]!) + (v2[0]! - v1[0]!) * (v0[1]! - v2[1]!);
        if (Math.abs(det) < 1e-10) continue;
        const u = ((v1[1]! - v2[1]!) * (x - v2[0]!) + (v2[0]! - v1[0]!) * (y - v2[1]!)) / det;
        const v = ((v2[1]! - v0[1]!) * (x - v2[0]!) + (v0[0]! - v2[0]!) * (y - v2[1]!)) / det;
        if (u >= -1e-6 && v >= -1e-6 && u + v <= 1.000001) return u * v0[2]! + v * v1[2]! + (1 - u - v) * v2[2]!;
      }
    }
    return 0;
  }

  function ribbon(points: number[][], width: number, tint: number,
    skin: number | ((x: number, y: number, z: number) => Skin), depth = width): void {
    // One continuous swept surface, without allocating temporary geometries.
    // A flattened section gives webbing a fabric profile instead of a rope.
    const n = far ? 4 : 6, start = position.length / 3;
    const tangent = new T.Vector3(), u = new T.Vector3(), v = new T.Vector3();
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!, a = points[Math.max(0, i - 1)]!, b = points[Math.min(points.length - 1, i + 1)]!;
      tangent.set(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!).normalize();
      u.set(Math.abs(tangent.x) < 0.9 ? 1 : 0, Math.abs(tangent.x) < 0.9 ? 0 : 1, 0);
      u.addScaledVector(tangent, -u.dot(tangent)).normalize();
      v.crossVectors(tangent, u);
      for (let j = 0; j < n; j++) {
        const angle = j / n * Math.PI * 2, w = Math.cos(angle) * width, d = Math.sin(angle) * depth;
        const x = p[0]! + u.x * w + v.x * d, y = p[1]! + u.y * w + v.y * d, z = p[2]! + u.z * w + v.z * d;
        vertex(x, y, z, tint, typeof skin === "number" ? [skin] : skin(x, y, z));
      }
    }
    for (let i = 1; i < points.length; i++) for (let j = 0; j < n; j++) {
      const a = start + (i - 1) * n + j, b = start + (i - 1) * n + (j + 1) % n;
      indices.push(a, b, a + n, b, b + n, a + n);
    }
    for (let j = 1; j < n - 1; j++) {
      indices.push(start, start + j + 1, start + j);
      const end = start + (points.length - 1) * n;
      indices.push(end, end + j, end + j + 1);
    }
  }
  const jacket = palette[0], trousers = palette[1], shirt = palette[2], shoe = palette[3];
  const skin = palette[4], hair = palette[5], bag = palette[6];
  const coat = outfit === 2 || outfit === 7;
  const skirt = outfit === 3 || outfit === 6;
  const suit = outfit === 1 || outfit === 4;
  const spine: Skin = [BONE.spine];
  // Sloping clavicles and fitted deltoids. The coat hem is a complete loop
  // sharing ONE garment transform, never split between opposing thigh bones.
  if (coat) hemLoop = Array.from({ length: radial }, (_, i) => position.length / 3 + radial + i);
  const torso: Ring[] = [[coat ? 0.728 : 0.929, coat ? 0.208 : 0.148, coat ? 0.183 : 0.098],
    [coat ? 0.735 : 0.935, coat ? 0.216 : 0.158, coat ? 0.19 : 0.105],
    [coat ? 0.83 : 0.98, coat ? 0.198 : 0.157, coat ? 0.158 : 0.109], [1.06, 0.148, 0.104],
    [1.21, 0.158, 0.116], [1.34, 0.184, 0.11], [1.385, 0.183, 0.096],
    [1.422, 0.132, 0.075], [1.465, 0.058, 0.048], [1.478, 0.043, 0.04]];
  loft(torso, jacket,
  coat ? y => [BONE.spine, BONE.hem, Math.max(0, Math.min(1, (1.06 - y) / 0.22))] : spine);
  surface = SURFACE.skin;
  // Adult head: 23.6 cm chin-to-crown, broader cheekbones, tapered jaw and
  // brow/cheek/chin planes. Facial features stay small against the silhouette.
  oval(0, NECK.y, NECK.z, NECK.rx, NECK.ry, NECK.rz, skin, BONE.head, 4);
  const faceStart = position.length / 3;
  const face: Ring[] = [[1.525, 0.024, 0.027, 0, -0.025], [1.539, 0.044, 0.048, 0, -0.014],
    [1.566, 0.064, 0.065, 0, -0.008], [1.601, 0.086, 0.082, 0, -0.003],
    [1.628, 0.091, 0.077], [1.653, 0.09, 0.089], [1.69, 0.087, 0.084, 0, 0.004],
    [1.735, 0.065, 0.065, 0, 0.008], [1.757, 0.025, 0.026, 0, 0.009],
    [1.761, 0, 0, 0, 0.009]];
  loft(face, skin, [BONE.head], far ? 6 : 16);
  // Restrained orbital/temple occlusion remains readable in diffuse station light.
  for (let i = faceStart; i < position.length / 3; i++) {
    const y = position[i * 3 + 1]!, z = position[i * 3 + 2]!;
    const socket = z < -0.025 && Math.abs(y - 1.628) < 0.012 ? 0.84 : 1;
    const jaw = y < 1.57 ? 0.93 : 1;
    for (let c = 0; c < 3; c++) colors[i * 3 + c]! *= socket * jaw;
  }
  const crease = new T.Color(skin).multiplyScalar(0.62).getHex();
  for (const side of [-1, 1]) {
    oval(side * 0.091, 1.619, 0.005, 0.012, 0.025, 0.016, skin, BONE.head, 4, 6);
    if (!far) oval(side * 0.1, 1.619, 0.001, 0.004, 0.014, 0.008, crease, BONE.head, 3, 4);
  }
  if (!far) {
    // A connected wedge gives the bridge, tip and nostril wings distinct planes.
    // The tip projects 3 cm beyond the orbital plane, rather than a flat decal.
    const nose = [[0, 1.657, -0.083], [-0.009, 1.637, -0.086], [0.009, 1.637, -0.086],
      [-0.014, 1.604, -0.092], [0.014, 1.604, -0.092], [0, 1.614, -0.108], [0, 1.6, -0.1]];
    const ni = nose.map(([x, y, z]) => vertex(x!, y!, z!, skin, [BONE.head]));
    for (const [a, b, c] of [[0, 1, 5], [0, 5, 2], [1, 3, 5], [2, 5, 4], [3, 6, 5], [4, 5, 6]]) {
      indices.push(ni[a!]!, ni[c!]!, ni[b!]!);
    }
    function facialPatch(points: number[][], tint: number): void {
      const midpoint = (a: number[], b: number[]) => [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2];
      // Subdivide across cheek/orbit facets so the centre of a decal cannot
      // disappear into the head even when its perimeter is correctly fitted.
      for (let i = 1; i < points.length - 1; i++) {
        const a = points[0]!, b = points[i]!, c = points[i + 1]!;
        const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
        for (const triangle of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]) {
          patch(triangle.map(([x, y]) => [x!, y!, surfaceZ(face, x!, y!, 16) - 0.0025]), tint, BONE.head);
        }
      }
    }
    for (const side of [-1, 1]) {
      // Almond eyes and tapered brows sit on the orbital plane, without
      // separate protruding eyeballs/socket geometry or painted white sclera.
      facialPatch([[side * 0.021, 1.636], [side * 0.032, 1.641], [side * 0.047, 1.638],
        [side * 0.041, 1.633], [side * 0.028, 1.633]], 0x332b28);
      facialPatch([[side * 0.018, 1.654], [side * 0.032, 1.657], [side * 0.055, 1.653],
        [side * 0.039, 1.654], [side * 0.019, 1.65]], hair);
      facialPatch([[side * 0.022, 1.631], [side * 0.043, 1.631], [side * 0.033, 1.629]], crease);
    }
    facialPatch([[-0.014, 1.568], [-0.004, 1.57], [0, 1.569], [0.005, 1.57],
      [0.014, 1.568], [0, 1.566]], crease);

  }
  surface = SURFACE.hair;
  const hairStart = position.length / 3, hn = far ? 8 : 20, rows = far ? 3 : 6;
  const long = outfit === 2 || outfit === 3 || outfit === 6;
  if (outfit === 4) {
    // Receding grey temples and nape, open across the forehead AND crown.
    const count = far ? 8 : 16;
    for (let row = 0; row < 3; row++) for (let j = 0; j <= count; j++) {
      const a = -0.14 + j / count * (Math.PI + 0.28), back = Math.max(0, Math.sin(a));
      const y = [1.697 + back * 0.025, 1.655, 1.599 + Math.sin(a * 9) * 0.004][row]!;
      const r = [0.079, 0.094, 0.077][row]!;
      vertex(Math.cos(a) * r, y, Math.sin(a) * r + 0.009, hair, [BONE.head]);
    }
    for (let r = 0; r < 2; r++) for (let j = 0; j < count; j++) {
      const a = hairStart + r * (count + 1) + j, b = a + count + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  } else {
    const top = outfit === 0 ? 1.797 : outfit === 1 ? 1.768 : outfit === 5 ? 1.806 : 1.793;
    for (let row = 0; row <= rows; row++) for (let j = 0; j < hn; j++) {
      const a = j / hn * Math.PI * 2, front = Math.max(0, -Math.sin(a));
      const fringe = Math.max(0, Math.min(1, (front - 0.12) / 0.5));
      const t = row / rows, cap = Math.sin(Math.min(1, t * 1.65) * Math.PI / 2);
      let edge = 1.595 + fringe * 0.095;
      if (outfit === 2) edge = 1.5 + fringe * 0.185 + Math.sin(a * 3) * 0.009;
      if (outfit === 3) edge = 1.535 + fringe * 0.15;
      if (outfit === 6) edge = 1.435 + fringe * 0.237;
      if (outfit === 1) edge = 1.66 + fringe * 0.045;
      if (outfit === 0) edge += Math.cos(a) * 0.018 + front * 0.006;
      if (outfit === 5) edge = 1.625 + fringe * 0.065 + Math.cos(a * 3) * 0.008;
      if (outfit === 7) edge += front * 0.018;
      const lock = Math.sin(a * (outfit === 6 ? 9 : 7) + outfit * 1.7);
      edge += (far ? 0.002 : long ? 0.01 : 0.007) * lock * (0.3 + 0.7 * Math.max(front, Math.sin(a)));
      const y = top + (edge - top) * (1 - Math.cos(t * Math.PI / 2))
        + (outfit === 0 ? Math.cos(a + 0.5) * Math.sin(t * Math.PI) * 0.012 : 0);
      const width = long ? (outfit === 6 ? 0.117 : 0.115) : outfit === 1 ? 0.099 : 0.105;
      const nape = !long && Math.sin(a) > 0 ? Math.max(0, (t - 0.65) / 0.35) * 0.16 : 0;
      const volume = 1 - nape + Math.sin(a * 7 + t * 3 + outfit) * Math.sin(t * Math.PI) * (long ? 0.055 : 0.035)
        + (outfit === 5 ? Math.cos(a * 3 + t * 2) * 0.065 : 0);
      const sweep = outfit === 0 ? -0.016 * (1 - t) : outfit === 2 ? 0.012 * t * t : 0;
      vertex(Math.cos(a) * width * cap * volume + sweep, y,
        Math.sin(a) * (long ? 0.115 : 0.101) * cap * (0.88 + 0.12 * t) * volume + 0.012,
        hair, [BONE.head], (outfit === 1 && t > 0.65 ? 0.72 + 0.28 * (1 - t) : 0.91) + 0.09 * Math.abs(Math.cos(a * 2 + t)));
    }
    for (let row = 0; row < rows; row++) for (let j = 0; j < hn; j++) {
      const a = hairStart + row * hn + j, b = hairStart + row * hn + (j + 1) % hn;
      indices.push(a, b, a + hn, b, b + hn, a + hn);
    }
    // Bevel the cut edge back into the scalp, preventing daylight gaps at
    // the temple and giving the hairline a soft occluded rim.
    const edgeStart = hairStart + rows * hn, innerStart = position.length / 3;
    for (let j = 0; j < hn; j++) {
      const v = (edgeStart + j) * 3;
      vertex(position[v]! * 0.87, position[v + 1]! + 0.006, (position[v + 2]! - 0.012) * 0.87 + 0.012, hair, [BONE.head], 0.82);
    }
    for (let j = 0; j < hn; j++) {
      const a = edgeStart + j, b = edgeStart + (j + 1) % hn, c = innerStart + j, d = innerStart + (j + 1) % hn;
      indices.push(a, b, c, b, d, c);
    }
    if (long) {
      // A long cut is a volume below the skull, not a single-sided cap. Its
      // missing inner wall exposed only the bottom bevel in front views,
      // making that rim read as stray strands crossing the neck. Continue
      // the rim upward with inward-facing skin, tucked inside the head.
      let previous = innerStart;
      for (let row = rows - 1; row >= rows - 2; row--) {
        const next = position.length / 3;
        for (let j = 0; j < hn; j++) {
          const v = (hairStart + row * hn + j) * 3;
          vertex(position[v]! * 0.87, position[v + 1]! + 0.006,
            (position[v + 2]! - 0.012) * 0.87 + 0.012, hair, [BONE.head], 0.88);
        }
        for (let j = 0; j < hn; j++) {
          const a = previous + j, b = previous + (j + 1) % hn, c = next + j, d = next + (j + 1) % hn;
          indices.push(a, b, c, b, d, c);
        }
        previous = next;
      }
    }
    if (!far && outfit !== 1) for (let lock = 0; lock < (long ? 5 : 3); lock++) {
      const x = (lock - (long ? 2 : 1)) * (long ? 0.027 : 0.025);
      const y = outfit === 6 ? 1.681 : outfit === 3 ? 1.69 : 1.707 + x * (outfit === 0 ? 0.32 : 0.1);
      loft([[y - 0.013 - (lock % 2) * 0.006, 0.001, 0.001, x - 0.007, -0.087],
        [y, 0.01, 0.004, x, -0.087], [y + 0.021, 0.014, 0.006, x + 0.007, -0.077]],
      hair, [BONE.head], 4);
    }
    if (!far && outfit === 0) ribbon([[0.031, 1.799, -0.033], [0.034, 1.797, 0.011],
      [0.033, 1.777, 0.057]], 0.0022, 0x1e1917, BONE.head);
    if (long) for (const side of [-1, 1]) {
      // Side locks keep a visible volume beside the jaw, rather than a thin
      // cut edge on the rear shell. These merge visually into the crown.
      const bottom = outfit === 6 ? 1.438 : outfit === 2 ? 1.502 : 1.545;
      loft([[bottom, 0.014, 0.028, side * 0.097, 0.016],
        [bottom + 0.035, 0.027, 0.045, side * 0.102, 0.015],
        [1.63, 0.025, 0.048, side * 0.098, 0.012],
        [1.702, 0.019, 0.043, side * 0.083, 0.008]], hair, [BONE.head], far ? 4 : 8);
    }
    if (outfit === 7) {
      oval(0, 1.706, 0.127, 0.055, 0.057, 0.055, hair, BONE.head, 5, far ? 6 : 10);
      oval(0, 1.68, 0.166, 0.035, 0.034, 0.029, hair, BONE.head, 4, far ? 6 : 8);
    }
  }
  surface = SURFACE.fabric;
  // Raised neckline instead of a white V-shaped decal. The field jacket has
  // a crew shirt and open standing collar; knits have rolled ribbed necks.
  const knit = outfit === 3 || outfit === 5;
  const neckColor = knit ? new T.Color(jacket).multiplyScalar(0.86).getHex() : shirt;
  loft([[1.443, 0.059, 0.05], [1.465, 0.052, 0.048], [knit ? 1.496 : 1.483, 0.049, 0.045],
    [knit ? 1.496 : 1.483, 0.043, 0.04]], neckColor, spine);
  if (suit || coat) {
    // Shirt placket follows chest depth, with a real two-leaf collar at the
    // neck. The jacket lapels overlap the placket, giving a tailored opening.
    const placket = [[1.464, 0.035, -0.053], [1.44, 0.045, -0.076], [1.4, 0.047, -0.104],
      [1.34, 0.033, -0.117], [1.28, 0.019, -0.123]];
    for (let i = 1; i < placket.length; i++) {
      const [ay, ax, az] = placket[i - 1]!, [by, bx, bz] = placket[i]!;
      patch([[-ax!, ay!, az!], [-bx!, by!, bz!], [bx!, by!, bz!], [ax!, ay!, az!]], shirt, BONE.spine);
    }
    for (const side of [-1, 1]) {
      patch([[side * 0.007, 1.455, -0.064], [side * 0.041, 1.475, -0.049],
        [side * 0.066, 1.434, -0.084], [side * 0.031, 1.405, -0.111]], shirt, BONE.spine);
      const lapel = new T.Color(jacket).multiplyScalar(0.79).getHex();
      patch([[side * 0.064, 1.451, -0.055], [side * 0.134, 1.385, -0.089],
        [side * 0.092, 1.354, -0.108], [side * 0.017, 1.282, -0.127],
        [side * 0.047, 1.39, -0.11]], lapel, BONE.spine);
    }
  } else if (!knit) {
    for (const side of [-1, 1]) patch([[side * 0.05, 1.485, -0.025], [side * 0.079, 1.433, -0.071],
      [side * 0.036, 1.404, -0.107], [side * 0.036, 1.457, -0.058]],
    new T.Color(jacket).multiplyScalar(0.78).getHex(), BONE.spine);
    ribbon([[0, 0.958, -0.108], [0, 1.22, -0.118], [0, 1.414, -0.099]], 0.002, 0x626665, BONE.spine);
  }
  if (suit) {
    const tie = outfit === 1 ? 0x5b6070 : 0x6e5964;
    oval(0, 1.436, -0.09, 0.011, 0.014, 0.007, tie, BONE.spine, 3, 6);
    const tieRows = [[1.428, 0.007, -0.089], [1.4, 0.009, -0.111], [1.34, 0.011, -0.124],
      [1.3, 0.014, -0.129], [1.281, 0, -0.13]];
    for (let i = 1; i < tieRows.length; i++) {
      const [ay, ax, az] = tieRows[i - 1]!, [by, bx, bz] = tieRows[i]!;
      patch([[-ax!, ay!, az!], [-bx!, by!, bz!], [bx!, by!, bz!], [ax!, ay!, az!]], tie, BONE.spine);
    }
  }
  if (!far) for (const y of [1.1, 1.2]) oval(0.012, y, -0.111, 0.003, 0.003, 0.002, 0x57534e, BONE.spine, 3, 5);
  for (const side of [-1, 1]) {
    const shoulder = side < 0 ? BONE.leftShoulder : BONE.rightShoulder;
    const elbow = shoulder + 1;
    const x = side * 0.213;
    const armSkin = (y: number): Skin => [elbow, shoulder, Math.max(0, Math.min(1, (y - 1.095) / 0.15))];
    // The shoulder slopes into the upper arm. Its cap is below the clavicle,
    // not a second sphere sitting on top of it; wrists taper into visible cuffs.
    surface = SURFACE.fabric;
    loft([[0.923, 0.031, 0.033, x + side * 0.008], [0.952, 0.035, 0.035, x + side * 0.008],
      [1.04, 0.041, 0.04, x + side * 0.008], [1.13, 0.043, 0.044, x + side * 0.007],
      [1.235, 0.05, 0.051, x], [1.325, 0.058, 0.053, x - side * 0.005],
      [1.375, 0.052, 0.046, x - side * 0.018], [1.403, 0.032, 0.03, x - side * 0.04],
      [1.407, 0, 0, x - side * 0.048]], jacket, armSkin, far ? 6 : 10);
    loft([[0.909, 0.029, 0.031, x + side * 0.008], [0.922, 0.034, 0.035, x + side * 0.008],
      [0.943, 0.034, 0.035, x + side * 0.008]], suit ? shirt : new T.Color(jacket).multiplyScalar(0.76).getHex(), [elbow], far ? 6 : 10);
    surface = SURFACE.skin;
    // Palm and closed four-finger block with a separately angled thumb. Flat
    // finger ends and knuckle shoulders avoid an oval mitten silhouette.
    loft([[0.819, 0.009, 0.011, x + side * 0.006, -0.006],
      [0.824, 0.023, 0.017, x + side * 0.008, -0.007], [0.852, 0.025, 0.02, x + side * 0.01, -0.009],
      [0.883, 0.028, 0.022, x + side * 0.009, -0.005], [0.909, 0.022, 0.02, x + side * 0.008]], skin, [elbow], far ? 6 : 8);
    loft([[0.852, 0.004, 0.005, x - side * 0.031, -0.033],
      [0.861, 0.009, 0.01, x - side * 0.034, -0.031], [0.879, 0.01, 0.011, x - side * 0.026, -0.019],
      [0.897, 0.01, 0.011, x - side * 0.01, -0.006]], skin, [elbow], far ? 4 : 6);
    const hip = side < 0 ? BONE.leftHip : BONE.rightHip;
    const knee = hip + 1, ankle = hip + 2;
    const lx = side * 0.092;
    // Covered thigh vertices follow the garment envelope. The exposed knee
    // and calf retain the leg rig, without punching through the cloth above.
    const legSkin = (y: number): Skin => (skirt || coat) && y > 0.49
      ? [hip, BONE.hem, Math.max(0, Math.min(1, (y - 0.49) / 0.15))]
      : y > 0.82 ? [hip, BONE.pelvis, Math.min(1, (y - 0.82) / 0.13)]
      : y > 0.64 ? [hip] : y < 0.39 ? [knee]
      : [knee, hip, (y - 0.39) / 0.25];
    surface = skirt ? SURFACE.skin : SURFACE.fabric;
    let legRings: Ring[] = [[0.09, 0.044, 0.047, lx], [0.135, 0.049, 0.052, lx], [0.28, 0.059, 0.058, lx, 0.005],
      [0.4, 0.055, 0.058, lx], [0.49, 0.058, 0.06, lx], [0.56, 0.064, 0.068, lx],
      [0.73, 0.077, 0.078, lx], [0.87, 0.08, 0.087, lx], [0.935, 0.054, 0.074, lx],
      [0.949, 0, 0, lx]];
    if (skirt || coat) legRings = legRings.map(([y, rx, rz, x = 0, z = 0]) => {
      const hidden = Math.max(0, Math.min(1, (y - (skirt ? 0.64 : 0.73)) / 0.16));
      // Cull the bulk of covered anatomy inside the garment, as with a
      // dressed production mesh, while preserving an overlap below its hem.
      const fit = 1 - hidden * 0.35;
      return [y, rx * fit, rz * fit, x * fit, z];
    });
    loft(legRings, skirt ? y => y > 0.755 ? trousers : skin : trousers, legSkin, far ? 6 : 10);
    const sole = outfit === 0 || outfit === 3 || outfit === 5 ? 0xb8b9b4 : 0x24272b;
    surface = SURFACE.sole;
    loft([[0, 0, 0, lx, -0.042], [0, 0.058, 0.125, lx, -0.042],
      [0.025, 0.061, 0.127, lx, -0.042], [0.035, 0.058, 0.122, lx, -0.042]], sole, [ankle], far ? 6 : 12, 0.72);
    surface = SURFACE.leather;
    loft([[0.026, 0.056, 0.119, lx, -0.043], [0.054, 0.058, 0.116, lx, -0.043],
      [0.1, 0.048, 0.086, lx, -0.015], [0.135, 0.039, 0.042, lx], [0.14, 0, 0, lx]], shoe, [ankle], far ? 6 : 12, 0.78);
  }
  surface = SURFACE.fabric;
  // A shared trouser/underskirt waist covers the proximal leg junction. The
  // upper thigh blends into the pelvis instead of hinging through the jacket.
  loft([[0.855, 0.133, 0.087], [0.89, 0.142, 0.092], [0.949, 0.144, 0.094],
    [0.955, 0, 0]], trousers, [BONE.pelvis]);
  if (skirt) {
    hemLoop = Array.from({ length: radial }, (_, i) => position.length / 3 + radial + i);
    loft([[0.612, 0.231, 0.21], [0.618, 0.238, 0.217], [0.735, 0.215, 0.19],
      [0.87, 0.155, 0.1], [0.967, 0.142, 0.09]], trousers,
    y => [BONE.pelvis, BONE.hem, Math.max(0, Math.min(1, (0.95 - y) / 0.22))]);
  }
  surface = SURFACE.bag;
  if (outfit === 0) {
    // 26 cm wide, 36 cm tall pack; curved shell, pocket, webbing and top handle.
    loft([[1.019, 0, 0, 0, 0.16], [1.035, 0.1, 0.058, 0, 0.163], [1.105, 0.127, 0.071, 0, 0.172],
      [1.285, 0.123, 0.07, 0, 0.172], [1.365, 0.092, 0.057, 0, 0.164],
      [1.389, 0, 0, 0, 0.15]], bag, spine);
    oval(0, 1.13, 0.232, 0.092, 0.068, 0.019, new T.Color(bag).multiplyScalar(0.87).getHex(), BONE.spine, far ? 4 : 5);
    // Sample the SAME torso cross-sections as the jacket. Front webbing rests
    // 3 mm above it, wraps around the shoulder, then returns under the arm.
    function onTorso(x: number, y: number, front: boolean): number[] {
      return [x, y, surfaceZ(torso, x, y, radial, front) + (front ? -0.003 : 0.003)];
    }
    for (const side of [-1, 1]) {
      const points = [[side * 0.09, 1.32, 0.18], onTorso(side * 0.11, 1.405, false),
        onTorso(side * 0.115, 1.427, false), onTorso(side * 0.115, 1.427, true),
        onTorso(side * 0.11, 1.385, true), onTorso(side * 0.105, 1.34, true),
        onTorso(side * 0.095, 1.21, true), onTorso(side * 0.095, 1.11, true),
        onTorso(side * 0.136, 1.075, true), [side * 0.156, 1.1, 0.01], [side * 0.1, 1.105, 0.16]];
      // Webbing follows the jacket's spine rig (arm bones would lift it off
      // the chest during a swing); the shoulder is part of that same loft.
      ribbon(points, 0.011, bag, BONE.spine, 0.003);
    }
    if (!far) ribbon([[-0.032, 1.371, 0.16], [-0.027, 1.414, 0.16], [0.027, 1.414, 0.16], [0.032, 1.371, 0.16]], 0.008, 0x514c43, BONE.spine);
  } else if ([2, 5, 6, 7].includes(outfit)) {
    const tote = outfit === 2 || outfit === 6;
    oval(0.237, tote ? 0.917 : 0.97, 0.025, 0.059, tote ? 0.165 : 0.115, tote ? 0.122 : 0.1, bag, BONE.spine, far ? 4 : 6, far ? 6 : 10);
    ribbon(tote ? [[0.235, 1, -0.07], [0.237, 1.25, -0.07], [0.217, 1.432, 0], [0.237, 1.25, 0.12], [0.235, 1, 0.12]]
      : [[0.235, 1, -0.04], [0.1, 1.21, -0.12], [-0.16, 1.445, -0.03], [-0.16, 1.445, 0.035], [0.235, 1.02, 0.1]],
    0.008, bag, BONE.spine);
  }
  surface = SURFACE.metal;
  if (!far && outfit === 1) {
    for (const side of [-1, 1]) ribbon([[side * 0.009, 1.648, -0.096], [side * 0.054, 1.648, -0.086],
      [side * 0.054, 1.627, -0.096], [side * 0.009, 1.627, -0.096], [side * 0.009, 1.648, -0.096]], 0.002, 0x454345, BONE.head);
    for (const side of [-1, 1]) ribbon([[side * 0.054, 1.644, -0.087], [side * 0.092, 1.642, -0.008]], 0.002, 0x454345, BONE.head);
    ribbon([[-0.009, 1.64, -0.098], [0.009, 1.64, -0.098]], 0.002, 0x454345, BONE.head);
  }
  surface = SURFACE.fabric;
  if (outfit === 4) {
    loft([[1.557, 0.026, 0.006, 0, -0.071], [1.57, 0.052, 0.013, 0, -0.081],
      [1.599, 0.066, 0.022, 0, -0.096], [1.62, 0.046, 0.02, 0, -0.102],
      [1.632, 0.013, 0.007, 0, -0.1]], 0xc4cac5, [BONE.head], far ? 6 : 10);
    if (!far) for (const side of [-1, 1]) ribbon([[side * 0.054, 1.615, -0.087], [side * 0.094, 1.63, 0],
      [side * 0.05, 1.578, -0.077]], 0.0018, 0xc4cac5, BONE.head);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(position, 3));
  geometry.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("skinIndex", new T.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new T.Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.hemLoop = hemLoop;
  geometry.name = `${OUTFITS[outfit]} / ${far ? "far" : "near"}`;
  return geometry;
}
