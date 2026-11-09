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
