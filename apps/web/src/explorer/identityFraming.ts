import * as THREE from "three";
import { FOLLOW, followPose } from "./followCamera.ts";

export interface FramingBoard { centre: THREE.Vector3; front: THREE.Vector3; blocked: boolean }
export const IDENTITY_RANGE_M = 30;
export const LOOK_PITCH = { min: -1.1, max: 0.5 } as const;

/** Pure placement: choose a nearby readable board and frame its name at the follow lens. */
export function identityFraming(head: THREE.Vector3, yaw: number, _pitch: number, boards: readonly FramingBoard[], aspect: number, fovDeg: number, guideHeading?: number): { yaw: number; pitch: number } | null {
  const camera = new THREE.PerspectiveCamera(fovDeg, Math.min(aspect, 9 / 19.5), 0.05, 100);
  const tanV = Math.tan(THREE.MathUtils.degToRad(fovDeg / 2)), tanH = tanV * camera.aspect;
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
      y -= Math.atan(ndc.x * tanH);
      p = THREE.MathUtils.clamp(p + Math.atan((ndc.y - 0.25) * tanV), LOOK_PITCH.min, LOOK_PITCH.max);
    }
    const ndc = project();
    if (Math.abs(ndc.x) > 0.6 || ndc.y < -0.4 || ndc.y > 0.7 || Math.abs(ndc.z) > 1) continue;
    if (board.front.dot(camera.position.clone().sub(board.centre).normalize()) <= 0.2) continue;
    // Keep yaw continuous around the current camera heading.
    return { yaw: yaw + Math.atan2(Math.sin(y - yaw), Math.cos(y - yaw)), pitch: p };
  }
  return null;
}
