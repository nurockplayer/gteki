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
  /** Lowered booms tried under a camera-only blocker, in equal elevation steps down to `lowestBoom`. */
  boomSteps: 6,
  /** Sine of the lowest boom elevation tried (a little below the pivot's level). */
  lowestBoom: -0.1,
  /** A lowered boom is taken at once when it keeps this fraction of the wanted distance. */
  boomKeep: 0.85,
  /** Otherwise the best lowered boom must beat the unlowered distance by this much (m), or the boom stays put. */
  boomGain: 0.25,
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

/**
 * Camera distance along `back` given the first obstruction (if any) at `hitDistance`. A camera-only
 * blocker (a ceiling) may pull the camera in past the usual minimum, down to the pivot, so a low ceiling
 * at a steep pitch never pushes it through.
 */
export function clampDistance(wanted: number, hitDistance: number | null, cameraOnly = false): number {
  if (hitDistance === null) return wanted;
  return Math.max(cameraOnly ? 0 : FOLLOW.minDistance, Math.min(wanted, hitDistance - FOLLOW.clearance));
}

/**
 * Camera distance for the ray's hits (nearest first). The nearest obstruction clamps as usual; a
 * camera-only blocker (a ceiling) then bounds the distance on its own, even behind a nearer wall whose
 * minimum would otherwise hold the camera past it.
 */
export function followDistance(wanted: number, hits: readonly { distance: number; cameraOnly: boolean }[]): number {
  const first = hits[0];
  let distance = clampDistance(wanted, first?.distance ?? null, first?.cameraOnly ?? false);
  const blocker = hits.find((h) => h.cameraOnly);
  if (blocker) distance = Math.min(distance, Math.max(0, blocker.distance - FOLLOW.clearance));
  return distance;
}

/**
 * Boom direction and camera distance for `cast`, which returns a ray's hits (nearest first) along a
 * candidate `back`. A camera-only blocker (a hanging sign box, a low cap) over the boom used to pull the
 * camera into the avatar although there was room below it; the camera now slides under it by lowering the
 * boom (never raising it, never below `FOLLOW.lowestBoom`), still looking at the same target. Walls and
 * floors keep their existing clamp: unless a blocker is what limits the camera, `back` is returned as is.
 */
export function followBoom(
  wanted: number,
  back: THREE.Vector3,
  cast: (back: THREE.Vector3) => readonly { distance: number; cameraOnly: boolean }[],
): { back: THREE.Vector3; distance: number } {
  const hits = cast(back);
  const d0 = followDistance(wanted, hits);
  const dWalls = followDistance(wanted, hits.filter((h) => !h.cameraOnly));
  const unchanged = { back, distance: d0 };
  if (d0 >= dWalls - 0.05) return unchanged;
  const flat = Math.hypot(back.x, back.z);
  if (flat < 1e-6 || back.y <= FOLLOW.lowestBoom) return unchanged;
  let best: { back: THREE.Vector3; distance: number } | null = null;
  for (let i = 1; i <= FOLLOW.boomSteps; i++) {
    const sin = back.y + ((FOLLOW.lowestBoom - back.y) * i) / FOLLOW.boomSteps;
    const cos = Math.sqrt(1 - sin * sin);
    const candidate = new THREE.Vector3((back.x / flat) * cos, sin, (back.z / flat) * cos);
    const distance = followDistance(wanted, cast(candidate));
    if (distance >= FOLLOW.boomKeep * wanted) return { back: candidate, distance };
    if (!best || distance > best.distance) best = { back: candidate, distance };
  }
  return best && best.distance >= d0 + FOLLOW.boomGain ? best : unchanged;
}
