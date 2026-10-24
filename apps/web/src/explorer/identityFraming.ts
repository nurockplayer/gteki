import * as THREE from "three";
import { FOLLOW, followPose } from "./followCamera.ts";

export interface FramingBoard {
  centre: THREE.Vector3;
  front: THREE.Vector3;
  blocked: boolean;
  nameCorners: readonly THREE.Vector3[];
  visible?: (cameraPos: THREE.Vector3, centre: THREE.Vector3) => boolean;
}
/** NDC rectangle: x increases right, y increases up. */
export interface NdcRect { x0: number; y0: number; x1: number; y1: number }
// NDC spans 2 vertically: cap the name box at half the viewport height to avoid oversized close boards.
export const MAX_NAME_HEIGHT_NDC = 1;
export const IDENTITY_RANGE_M = 30;
export const LOOK_PITCH = { min: -1.1, max: 0.5 } as const;

/** Pure placement: choose a nearby readable board and frame its name at the follow lens. */
export function identityFraming(head: THREE.Vector3, yaw: number, _pitch: number, boards: readonly FramingBoard[], aspect: number, fovDeg: number, guideHeading?: number, free: NdcRect = { x0: -1, y0: -1, x1: 1, y1: 1 }): { yaw: number; pitch: number } | null {
  const camera = new THREE.PerspectiveCamera(fovDeg, aspect, 0.05, 100);
  const tanV = Math.tan(THREE.MathUtils.degToRad(fovDeg / 2)), tanH = tanV * camera.aspect;
  const left = Math.max(-1, free.x0), right = Math.min(1, free.x1);
  const bottom = Math.max(-0.4, free.y0), top = Math.min(0.7, free.y1);
  if (left >= right || bottom >= top) return null;
  const minX = left + (right - left) * 0.2, maxX = right - (right - left) * 0.2;
  const targetX = (minX + maxX) / 2;
  const targetY = THREE.MathUtils.clamp(0.25, bottom + (top - bottom) * 0.2, top - (top - bottom) * 0.2);
  // Nearest first, independent of traversal order except at identical distances.
  const candidates = boards.slice().sort((a, b) => head.distanceToSquared(a.centre) - head.distanceToSquared(b.centre));
  for (const board of candidates) {
    const toward = board.centre.clone().sub(head), distance = toward.length();
    if (board.blocked || distance > IDENTITY_RANGE_M || distance < 0.1 || board.front.dot(toward.clone().negate().normalize()) <= 0.2) continue;
    let y = Math.atan2(-toward.x, -toward.z);
    if (guideHeading !== undefined && Math.cos(y - guideHeading) < -1e-9) continue;
    let p = THREE.MathUtils.clamp(Math.atan2(toward.y, Math.hypot(toward.x, toward.z)), LOOK_PITCH.min, LOOK_PITCH.max);
    const project = () => {
      const pose = followPose(head, y, p);
      camera.position.copy(pose.pivot).addScaledVector(pose.back, FOLLOW.defaultDistance);
      camera.lookAt(pose.target);
      camera.updateMatrixWorld(true);
      return board.centre.clone().project(camera);
    };
    // Compensate for the shoulder and the follow target's drop; centre slightly above mid-frame.
    for (let i = 0; i < 8; i++) {
      const ndc = project();
      y -= Math.atan((ndc.x - targetX) * tanH);
      p = THREE.MathUtils.clamp(p + Math.atan((ndc.y - targetY) * tanV), LOOK_PITCH.min, LOOK_PITCH.max);
    }
    const ndc = project();
    if (ndc.x < minX || ndc.x > maxX || ndc.y < bottom || ndc.y > top || Math.abs(ndc.z) > 1) continue;
    const name = board.nameCorners.map((p) => p.clone().project(camera));
    if (!name.length || name.some((p) => Math.abs(p.z) > 1) || Math.max(...name.map((p) => p.y)) - Math.min(...name.map((p) => p.y)) > MAX_NAME_HEIGHT_NDC) continue;
    if (board.front.dot(camera.position.clone().sub(board.centre).normalize()) <= 0.2) continue;
    if (board.visible && !board.visible(camera.position.clone(), board.centre.clone())) continue;
    // Keep yaw continuous around the current camera heading.
    return { yaw: yaw + Math.atan2(Math.sin(y - yaw), Math.cos(y - yaw)), pitch: p };
  }
  return null;
}
