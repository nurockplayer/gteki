type Point3 = { x: number; y: number; z: number };
/** Whether any of `count` samples has a clear line of sight. */
export function anySampleClear(count: number, blocked: (i: number) => boolean): boolean {
  for (let i = 0; i < count; i++) if (!blocked(i)) return true;
  return false;
}

type Rect = { left: number; right: number; top: number; bottom: number };

/**
 * The centre and four inset corners of the part of a sign's screen box that lies over the minimap, in pixels.
 * Sampling there (not on the sign itself) catches a sign that covers the whole minimap between its own corners,
 * and ignores a clear part of the sign away from the minimap (#1110).
 */
export function overlapSamples(sign: Rect, map: Rect, out: { x: number; y: number }[], inset = 0.8): void {
  const left = Math.max(sign.left, map.left), right = Math.min(sign.right, map.right);
  const top = Math.max(sign.top, map.top), bottom = Math.min(sign.bottom, map.bottom);
  const x = (left + right) / 2, y = (top + bottom) / 2, hx = (right - left) / 2 * inset, hy = (bottom - top) / 2 * inset;
  const offsets = [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
  offsets.forEach(([dx, dy], i) => { out[i]!.x = x + dx * hx; out[i]!.y = y + dy * hy; });
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
