type Point3 = { x: number; y: number; z: number };
/** Whether any of `count` samples has a clear line of sight. */
export function anySampleClear(count: number, blocked: (i: number) => boolean): boolean {
  for (let i = 0; i < count; i++) if (!blocked(i)) return true;
  return false;
}

type Rect = { left: number; right: number; top: number; bottom: number };

type Point2 = { x: number; y: number };
const clipScratch: Point2[][] = [[], []];

/** Sample the clipped sign polygon over the minimap, in pixels. */
export function overlapSamples(quad: readonly Point2[], map: Rect, out: Point2[], inset = 0.8): number {
  let input = clipScratch[0]!, output = clipScratch[1]!;
  input.length = 0;
  input.push(...quad);
  for (let edge = 0; edge < 4; edge++) {
    output.length = 0;
    const axis = edge < 2 ? "x" : "y";
    const bound = [map.left, map.right, map.top, map.bottom][edge]!;
    const inside = (p: Point2) => edge % 2 === 0 ? p[axis] >= bound : p[axis] <= bound;
    let previous = input[input.length - 1];
    for (const current of input) {
      if (previous && inside(previous) !== inside(current)) {
        const t = (bound - previous[axis]) / (current[axis] - previous[axis]);
        output.push({ x: previous.x + (current.x - previous.x) * t, y: previous.y + (current.y - previous.y) * t });
      }
      if (inside(current)) output.push(current);
      previous = current;
    }
    [input, output] = [output, input];
  }
  if (input.length < 3) return 0;
  let x = 0, y = 0;
  for (const point of input) { x += point.x; y += point.y; }
  x /= input.length; y /= input.length;
  out[0]!.x = x; out[0]!.y = y;
  for (let i = 0; i < input.length; i++) {
    out[i + 1]!.x = x + (input[i]!.x - x) * inset;
    out[i + 1]!.y = y + (input[i]!.y - y) * inset;
  }
  return input.length + 1;
}

/** Where a ray meets a rectangular sign face spanned by `a→b` and `a→c`; false when it misses the face. */
export function rayOnQuad(origin: Point3, dir: Point3, a: Point3, b: Point3, c: Point3, out: Point3): boolean {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const denom = nx * dir.x + ny * dir.y + nz * dir.z;
  if (Math.abs(denom) < 1e-12) return false;
  const t = (nx * (a.x - origin.x) + ny * (a.y - origin.y) + nz * (a.z - origin.z)) / denom;
  if (t <= 0) return false;
  out.x = origin.x + dir.x * t; out.y = origin.y + dir.y * t; out.z = origin.z + dir.z * t;
  const px = out.x - a.x, py = out.y - a.y, pz = out.z - a.z;
  const u = (px * ux + py * uy + pz * uz) / (ux * ux + uy * uy + uz * uz);
  const v = (px * vx + py * vy + pz * vz) / (vx * vx + vy * vy + vz * vz);
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}

export type FaceEligibility = { centre: Point3; normal: Point3; cameraPos: Point3; viewZ: readonly number[]; near: number; maxDistance: number };

export function faceEligible(face: FaceEligibility): boolean {
  const dx = face.cameraPos.x - face.centre.x;
  const dy = face.cameraPos.y - face.centre.y;
  const dz = face.cameraPos.z - face.centre.z;
  if (dx * dx + dy * dy + dz * dz > face.maxDistance * face.maxDistance ||
      face.normal.x * dx + face.normal.y * dy + face.normal.z * dz <= 0) return false;
  for (const z of face.viewZ) if (z > -face.near) return false;
  return true;
}

/** Whether a view-space point is in the shader's fully discarded core. */
export function insideCameraCut(point: Point3, end: Point3, radii: { x: number; y: number; z: number; w: number }): boolean {
  if (radii.y <= 0) return false;
  const lengthSq = end.x * end.x + end.y * end.y + end.z * end.z;
  const t = Math.max(0, Math.min(1, (point.x * end.x + point.y * end.y + point.z * end.z) / Math.max(lengthSq, 1e-6)));
  const x = point.x - end.x * t, y = point.y - end.y * t, z = point.z - end.z * t;
  const radius = radii.x + (radii.z - radii.x) * t;
  return x * x + y * y + z * z <= radius * radius;
}

export type YieldRect = { left: number; right: number; top: number; bottom: number; behind: boolean; distance: number };
export type YieldState = { lastOverlap: number };

export function minimapYield(rects: readonly YieldRect[], minimap: Pick<YieldRect, "left" | "right" | "top" | "bottom">, now: number, state: YieldState): boolean {
  for (const rect of rects) {
    if (!rect.behind && rect.distance <= 15 && rect.left < minimap.right && rect.right > minimap.left && rect.top < minimap.bottom && rect.bottom > minimap.top) {
      state.lastOverlap = now;
      return true;
    }
  }
  return now - state.lastOverlap < 0.6;
}
