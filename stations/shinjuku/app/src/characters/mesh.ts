import type * as THREE from "three";

// All coordinates, tailoring, faces and accessories below are original procedural
// artwork. +Y is up, -Z is forward. No texture, font, model or operator art is used.
export const BONE = { pelvis: 0, spine: 1, head: 2, leftShoulder: 3, leftElbow: 4,
  rightShoulder: 5, rightElbow: 6, leftHip: 7, leftKnee: 8, leftAnkle: 9,
  rightHip: 10, rightKnee: 11, rightAnkle: 12 } as const;
export const HIP = 0.93;
export const THIGH = 0.41;
export const SHIN = 0.43;
export const ANKLE = 0.09;
export const HEIGHTS = [1, 1.025, 0.97, 0.945, 1.04, 0.99, 0.96, 1.015] as const;
// Jacket, trousers, shirt, shoes, skin, hair, bag. No uniform or brand is represented.
const PALETTES = [
  [0x354e64, 0x4d535a, 0xe2dfd4, 0x353940, 0xd6a181, 0x302823, 0x99836a],
  [0x343a45, 0x333943, 0xdce2e4, 0x282b30, 0xe0ad8b, 0x26272b, 0x555247],
  [0x9a8b75, 0x4b4842, 0xe8e2d7, 0x44362f, 0xb87f60, 0x2f2926, 0x77776b],
  [0xd1cec4, 0x34383e, 0xe8e5dc, 0x393a38, 0xe5b596, 0x42332a, 0x707b7e],
  [0x292d34, 0x2e3038, 0xd7dfe1, 0x24272b, 0xc18b6c, 0x242327, 0x575b62],
  [0x677163, 0x424c4d, 0xddd9ca, 0x3d3530, 0xaf7658, 0x292725, 0x827568],
  [0x785e65, 0x41414c, 0xe4dbd5, 0x393039, 0xd2a083, 0x37302e, 0x6b6158],
  [0x66768a, 0x3d4653, 0xdfe2df, 0x30363e, 0xdfac86, 0x493b30, 0x74786b],
] as const;
export const OUTFITS = ["field jacket / backpack", "suit / glasses", "coat / tote",
  "knitwear / skirt", "suit / mask", "knitwear / shoulder bag", "jacket / skirt / tote", "coat / shoulder bag"] as const;
export const HAIR = ["side part", "short crop", "bob", "tied back", "short crop", "side part", "bob", "tied back"] as const;

type Ring = [y: number, rx: number, rz: number, x?: number, z?: number];
type Skin = [bone: number, next?: number, blend?: number];

/** A single indexed surface with smooth normals and blended joints. Separate
 * garment/face/accessory islands share one vertex-colour material and draw. */
export function buildCharacter(T: typeof THREE, outfit: number, far: boolean): THREE.BufferGeometry {
  const palette = PALETTES[outfit]!;
  const color = new T.Color();
  const position: number[] = [], colors: number[] = [], indices: number[] = [];
  const skinIndices: number[] = [], skinWeights: number[] = [];
  const radial = far ? 6 : 12;
  function vertex(x: number, y: number, z: number, tint: number, skin: Skin, shade = 1): number {
    const index = position.length / 3;
    position.push(x, y, z);
    color.setHex(tint).multiplyScalar(shade);
    colors.push(color.r, color.g, color.b);
    const w = skin[2] ?? 0;
    skinIndices.push(skin[0], skin[1] ?? skin[0], 0, 0);
    skinWeights.push(1 - w, w, 0, 0);
    return index;
  }
  function loft(rings: Ring[], tint: number | ((y: number) => number), skin: Skin | ((y: number, x: number, z: number) => Skin), n = radial): void {
    const start = position.length / 3;
    for (const [y, rx, rz, x = 0, z = 0] of rings) {
      for (let j = 0; j < n; j++) {
        const a = j / n * Math.PI * 2;
        // Quiet tonal variation suggests fabric panels without baked lighting.
        vertex(x + Math.cos(a) * rx, y, z + Math.sin(a) * rz, typeof tint === "function" ? tint(y) : tint,
          typeof skin === "function" ? skin(y, x + Math.cos(a) * rx, z + Math.sin(a) * rz) : skin,
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
  function ribbon(points: number[][], width: number, tint: number, bone: number): void {
    // Small original straps with thickness, rather than flat oversized blocks.
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      const shape = new T.CylinderGeometry(width, width, Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!), far ? 4 : 5, 1);
      shape.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0),
        new T.Vector3(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!).normalize()));
      shape.translate((a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2, (a[2]! + b[2]!) / 2);
      const start = position.length / 3, p = shape.getAttribute("position");
      for (let j = 0; j < p.count; j++) vertex(p.getX(j), p.getY(j), p.getZ(j), tint, [bone]);
      for (const index of shape.index!.array) indices.push(start + index);
      shape.dispose();
    }
  }
  const jacket = palette[0], trousers = palette[1], shirt = palette[2], shoe = palette[3];
  const skin = palette[4], hair = palette[5], bag = palette[6];
  const coat = outfit === 2 || outfit === 7;
  const skirt = outfit === 3 || outfit === 6;
  const suit = outfit === 1 || outfit === 4;
  const spine: Skin = [BONE.spine];
  // Rounded shoulder line, small neck opening, a fitted waist and tailored hem.
  loft([[coat ? 0.73 : 0.925, 0, 0], [coat ? 0.74 : 0.93, coat ? 0.203 : 0.159, 0.105],
    [coat ? 0.84 : 0.96, coat ? 0.191 : 0.165, 0.112], [1.06, 0.15, 0.103],
    [1.21, 0.163, 0.115], [1.34, 0.191, 0.113], [1.405, 0.196, 0.102],
    [1.445, 0.144, 0.084], [1.478, 0.063, 0.053], [1.48, 0.045, 0.042]], jacket,
  coat ? (y, x) => [BONE.spine, x < 0 ? BONE.leftHip : BONE.rightHip, Math.max(0, Math.min(1, (1.03 - y) / 0.12))] : spine);
  // Neck, anatomically quiet jaw/chin and a slightly flattened facial plane.
  oval(0, 1.495, 0, 0.044, 0.063, 0.043, skin, BONE.head, 4);
  loft([[1.527, 0.028, 0.031, 0, -0.014], [1.544, 0.053, 0.059, 0, -0.007],
    [1.575, 0.075, 0.076], [1.625, 0.088, 0.083], [1.684, 0.088, 0.082, 0, 0.002],
    [1.727, 0.066, 0.066, 0, 0.005], [1.754, 0.026, 0.027, 0, 0.008],
    [1.758, 0, 0, 0, 0.008]], skin, [BONE.head]);
  for (const side of [-1, 1]) oval(side * 0.087, 1.619, 0.002, 0.011, 0.022, 0.014, skin, BONE.head, 4, far ? 4 : 6);
  if (!far) {
    oval(0, 1.607, -0.081, 0.012, 0.022, 0.022, skin, BONE.head, 4, 6);
    for (const side of [-1, 1]) {
      oval(side * 0.032, 1.638, -0.078, 0.008, 0.003, 0.003, 0x44372f, BONE.head, 4, 6);
      oval(side * 0.032, 1.653, -0.077, 0.016, 0.002, 0.003, hair, BONE.head, 4, 6);
    }
    oval(0, 1.571, -0.074, 0.016, 0.002, 0.003, 0x976858, BONE.head, 4, 6);
  }
  // Hair cap follows the skull, with a higher forehead and lower nape.
  const hairStart = position.length / 3;
  const hairRows = far ? 4 : 6, hn = far ? 8 : 16;
  const crop = HAIR[outfit] === "short crop";
  for (let i = 0; i <= hairRows; i++) {
    for (let j = 0; j < hn; j++) {
      const a = j / hn * Math.PI * 2;
      const bob = HAIR[outfit] === "bob";
      const edge = (bob ? 1.9 : crop ? 1.43 : 1.48)
        + Math.sin(a) * (bob ? 0.47 : crop ? 0.27 : 0.36) + Math.cos(a) * (crop ? 0.02 : 0.08);
      const t = i / hairRows * edge;
      vertex(Math.sin(t) * Math.cos(a) * (bob ? 0.108 : crop ? 0.101 : 0.103),
        1.643 + Math.cos(t) * (crop ? 0.125 : 0.127) + Math.cos(a - 0.4) * Math.sin(t) * (crop ? 0.001 : 0.004),
        Math.sin(t) * Math.sin(a) * (bob ? 0.105 : 0.098) + 0.005,
        hair, [BONE.head], 0.97 + Math.cos(a + t) * 0.03);
    }
  }
  for (let i = 0; i < hairRows; i++) for (let j = 0; j < hn; j++) {
    const a = hairStart + i * hn + j, b = hairStart + i * hn + (j + 1) % hn;
    indices.push(a, b, a + hn, b, b + hn, a + hn);
  }
  if (HAIR[outfit] === "tied back") oval(0, 1.645, 0.097, 0.049, 0.052, 0.04, hair, BONE.head, 5, far ? 6 : 10);
  // Shirt insert and collars. These front-facing patches are original tailoring.
  const collar = outfit === 3 || outfit === 5
    ? [[1.475, 0.036, -0.055], [1.447, 0.052, -0.091], [1.429, 0, -0.108]]
    : [[1.475, 0.036, -0.055], [1.447, 0.05, -0.091], [1.41, 0.053, -0.116], [1.35, 0.03, -0.122], [1.3, 0, -0.126]];
  for (let i = 1; i < collar.length; i++) {
    const [ay, ax, az] = collar[i - 1]!, [by, bx, bz] = collar[i]!;
    patch([[-ax!, ay!, az!], [-bx!, by!, bz!], [bx!, by!, bz!], [ax!, ay!, az!]], shirt, BONE.spine);
  }
  if (suit || coat) {
    const lapel = new T.Color(jacket).multiplyScalar(0.79).getHex();
    for (const side of [-1, 1]) {
      const points = [[side * 0.068, 1.46, -0.059], [side * 0.14, 1.389, -0.097],
        [side * 0.1, 1.36, -0.109], [0, 1.24, -0.116]];
      patch(side > 0 ? points : points.reverse(), lapel, BONE.spine);
    }
  }
  if (suit) patch([[-0.014, 1.409, -0.115], [-0.009, 1.298, -0.124], [0, 1.278, -0.124],
    [0.009, 1.298, -0.124], [0.014, 1.409, -0.115]], outfit === 1 ? 0x646875 : 0x685565, BONE.spine);
  if (!far) {
    for (const y of [1.1, 1.2]) oval(0.012, y, -0.11, 0.004, 0.004, 0.003, 0x68635c, BONE.spine, 3, 5);
  }
  for (const side of [-1, 1]) {
    const shoulder = side < 0 ? BONE.leftShoulder : BONE.rightShoulder;
    const elbow = shoulder + 1;
    const x = side * 0.213;
    const armSkin = (y: number): Skin => [elbow, shoulder, Math.max(0, Math.min(1, (y - 1.095) / 0.15))];
    // Each sleeve is a continuous loft through its elbow, with blended skinning.
    loft([[0.908, 0.034, 0.036, x], [0.936, 0.04, 0.04, x], [1.025, 0.048, 0.044, x],
      [1.104, 0.045, 0.044, x], [1.173, 0.049, 0.049, x], [1.28, 0.061, 0.057, x],
      [1.364, 0.071, 0.063, x], [1.405, 0.062, 0.055, x], [1.425, 0.034, 0.035, x],
      [1.43, 0, 0, x]], jacket, armSkin, far ? 6 : 10);
    // Relaxed palm, tapered fingers and a thumb, all joined visually at the cuff.
    oval(x, 0.878, -0.004, 0.03, 0.064, 0.023, skin, elbow, far ? 4 : 6, far ? 6 : 8);
    if (!far) oval(x - side * 0.026, 0.89, -0.013, 0.012, 0.03, 0.012, skin, elbow, 4, 6);
    const hip = side < 0 ? BONE.leftHip : BONE.rightHip;
    const knee = hip + 1, ankle = hip + 2;
    const lx = side * 0.092;
    const legSkin = (y: number): Skin => y > 0.82 ? [hip, BONE.pelvis, Math.min(1, (y - 0.82) / 0.13)]
      : y > 0.64 ? [hip] : y < 0.39 ? [knee]
      : [knee, hip, (y - 0.39) / 0.25];
    loft([[0.09, 0.044, 0.047, lx], [0.135, 0.049, 0.052, lx], [0.28, 0.059, 0.058, lx, 0.005],
      [0.4, 0.055, 0.058, lx], [0.49, 0.058, 0.06, lx], [0.56, 0.064, 0.068, lx],
      [0.73, 0.077, 0.078, lx], [0.87, 0.08, 0.087, lx], [0.935, 0.061, 0.082, lx],
      [0.949, 0, 0, lx]], skirt ? y => y > 0.755 ? trousers : skin : trousers, legSkin, far ? 6 : 10);
    const sole = outfit === 0 || outfit === 3 || outfit === 5 ? 0xb8b9b4 : 0x24272b;
    loft([[0, 0, 0, lx, -0.042], [0, 0.058, 0.125, lx, -0.042],
      [0.025, 0.061, 0.127, lx, -0.042], [0.035, 0.058, 0.122, lx, -0.042]], sole, [ankle], far ? 6 : 10);
    loft([[0.026, 0.056, 0.119, lx, -0.043], [0.059, 0.057, 0.116, lx, -0.043],
      [0.1, 0.048, 0.086, lx, -0.015], [0.135, 0.039, 0.042, lx], [0.14, 0, 0, lx]], shoe, [ankle], far ? 6 : 10);
  }
  // A shared trouser/underskirt waist covers the proximal leg junction. The
  // upper thigh blends into the pelvis instead of hinging through the jacket.
  loft([[0.855, 0.141, 0.094], [0.89, 0.154, 0.101], [0.949, 0.15, 0.098],
    [0.955, 0, 0]], trousers, [BONE.pelvis]);
  if (skirt) loft([[0.624, 0.19, 0.12], [0.638, 0.2, 0.125], [0.76, 0.182, 0.119],
    [0.91, 0.164, 0.108], [0.973, 0.153, 0.105], [0.975, 0, 0]], trousers,
  (y, x) => [BONE.pelvis, x < 0 ? BONE.leftHip : BONE.rightHip, Math.max(0, Math.min(1, (0.975 - y) / 0.155))]);
  if (outfit === 0) {
    // 26 cm wide, 36 cm tall pack; curved shell, pocket, webbing and top handle.
    loft([[1.019, 0, 0, 0, 0.16], [1.035, 0.1, 0.058, 0, 0.163], [1.105, 0.127, 0.071, 0, 0.172],
      [1.285, 0.123, 0.07, 0, 0.172], [1.365, 0.092, 0.057, 0, 0.164],
      [1.389, 0, 0, 0, 0.15]], bag, spine);
    oval(0, 1.13, 0.232, 0.092, 0.068, 0.019, new T.Color(bag).multiplyScalar(0.87).getHex(), BONE.spine, far ? 4 : 5);
    for (const side of [-1, 1]) ribbon([[side * 0.09, 1.32, 0.18], [side * 0.146, 1.445, 0.035],
      [side * 0.15, 1.37, -0.105], [side * 0.142, 1.11, -0.102], [side * 0.096, 1.06, 0.15]], 0.01, bag, BONE.spine);
    if (!far) ribbon([[-0.032, 1.371, 0.16], [-0.027, 1.414, 0.16], [0.027, 1.414, 0.16], [0.032, 1.371, 0.16]], 0.008, 0x514c43, BONE.spine);
  } else if ([2, 5, 6, 7].includes(outfit)) {
    const tote = outfit === 2 || outfit === 6;
    oval(0.237, tote ? 0.917 : 0.97, 0.025, 0.059, tote ? 0.165 : 0.115, tote ? 0.122 : 0.1, bag, BONE.spine, far ? 4 : 6, far ? 6 : 10);
    ribbon(tote ? [[0.235, 1, -0.07], [0.237, 1.25, -0.07], [0.217, 1.432, 0], [0.237, 1.25, 0.12], [0.235, 1, 0.12]]
      : [[0.235, 1, -0.04], [0.1, 1.21, -0.12], [-0.16, 1.445, -0.03], [-0.16, 1.445, 0.035], [0.235, 1.02, 0.1]],
    0.008, bag, BONE.spine);
  }
  if (!far && outfit === 1) {
    for (const side of [-1, 1]) ribbon([[side * 0.009, 1.647, -0.086], [side * 0.054, 1.647, -0.077],
      [side * 0.054, 1.627, -0.077], [side * 0.009, 1.627, -0.086], [side * 0.009, 1.647, -0.086]], 0.002, 0x454345, BONE.head);
    ribbon([[-0.009, 1.64, -0.088], [0.009, 1.64, -0.088]], 0.002, 0x454345, BONE.head);
  }
  if (outfit === 4) oval(0, 1.599, -0.077, 0.064, 0.033, 0.018, 0xd8dcda, BONE.head, 4, far ? 6 : 10);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(position, 3));
  geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("skinIndex", new T.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new T.Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = `${OUTFITS[outfit]} / ${far ? "far" : "near"}`;
  return geometry;
}
