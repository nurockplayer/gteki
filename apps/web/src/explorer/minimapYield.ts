type Point3 = { x: number; y: number; z: number };
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
