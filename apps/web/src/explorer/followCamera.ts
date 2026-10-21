import * as THREE from "three";

/**
 * Third-person follow framing for low-ceilinged interiors: the camera trails just above and behind the
 * walker's head, offset over the right shoulder, and aims well ahead so the passage's vanishing point
 * sits in the upper third of the frame. A steep lift would push the camera into (or above) a ~2.6 m
 * station ceiling, so height comes mostly from the user's pitch rather than a fixed lift.
 */
export const FOLLOW = {
  /** Upward bias added to the backward ray before normalising. */
  lift: 0.14,
  /** Sideways offset (m, to the walker's right) of the orbit pivot. */
  shoulder: 0.42,
  /** Look-at distance ahead of the pivot (m). */
  aim: 5,
  /** Clearance kept in front of whatever the backward ray hits (m). */
  clearance: 0.3,
  /** Closest the camera comes to the pivot (m). */
  minDistance: 0.55,
  defaultDistance: 3.4,
  /** The look-at point sits this far below the pivot's view line, so the whole body (feet too) stays in frame. */
  drop: 0.45,
} as const;

export interface FollowPose {
  /** Point the camera orbits around (head height, shifted over the shoulder). */
  pivot: THREE.Vector3;
  /** Unit vector from the pivot toward the camera. */
  back: THREE.Vector3;
  /** World point the camera looks at. */
  target: THREE.Vector3;
}

/** View direction for a yaw (radians, 0 = -Z) and pitch (radians, + = up). */
export function viewDirection(yaw: number, pitch: number): THREE.Vector3 {
  return new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

export function followPose(head: THREE.Vector3, yaw: number, pitch: number, shoulder: number = FOLLOW.shoulder): FollowPose {
  const dir = viewDirection(yaw, pitch);
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const pivot = head.clone().addScaledVector(right, shoulder);
  const back = dir.clone().negate().add(new THREE.Vector3(0, FOLLOW.lift, 0)).normalize();
  const target = pivot.clone().addScaledVector(dir, FOLLOW.aim);
  target.y -= FOLLOW.drop;
  return { pivot, back, target };
}

/** Camera distance along `back` given the first obstruction (if any) at `hitDistance`. */
export function clampDistance(wanted: number, hitDistance: number | null): number {
  if (hitDistance === null) return wanted;
  return Math.max(FOLLOW.minDistance, Math.min(wanted, hitDistance - FOLLOW.clearance));
}
