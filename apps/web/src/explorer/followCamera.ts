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
  /**
   * Boom length (m). Third-person FOV narrowed 60 -> 50 degrees (#94), which alone grows the avatar by
   * tan(30)/tan(25) = 1.24x on screen. Holding its size would need 3.4 * 1.24 = 4.2 m, but a longer boom meets
   * more walls and hanging signs and is clamped more often. 3.8 m was tried first, but at the default pitch it
   * lifts the camera to 2.58 m under a 2.6 m ceiling (the followCamera test holds it below 2.5 m, reached at
   * about 3.47 m), so ordinary walking would sit in the ceiling clamp. 3.45 m is the longest round boom that
   * clears it: the avatar ends up about 22% larger on screen and the view reads tighter and more architectural.
   * Going longer needs a lower `lift`, which is a separate change for Lane F QA.
   */
  defaultDistance: 3.45,
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
  /** A boom shorter than this (m) first tries a raised view over the shoulder before it is shortened. */
  comfortDistance: 1.6,
  /** Most the boom's elevation is raised above its nominal angle (radians, 50 degrees). */
  maxRaise: (50 * Math.PI) / 180,
  /** Raised booms tried, in equal steps up to `maxRaise` (10 degrees apart): the most extra casts per squeezed frame. */
  raiseSteps: 5,
  /** When no raised boom is comfortable, the longest one is still taken if it beats the unraised boom by this much (m). */
  raiseGain: 0.1,
  /** The avatar starts to fade when the camera is closer than this to the pivot (m)... */
  fadeStart: 1.0,
  /** Lowest avatar opacity (fraction of the screen-door dither kept), reached at `minDistance`, the closest the camera gets. */
  fadeMin: 0.25,
  /** Rate (1/s) at which the raise eases toward its wanted value (same damping as the camera position). */
  raiseDamping: 10,
} as const;

/** Vertical field of view (degrees) per camera mode. */
export const FOV = {
  /** Third person (walk and guide): narrower, closer to the Blender reference renders (43-49 degrees). */
  follow: 50,
  /** First person stays at 60: 50 feels tunnel-like at eye height on a phone. Lane F QA can revisit. */
  firstPerson: 60,
  /** Overview orbit view, unchanged; overview framing (frameAll/fitOverview) is fitted to it. */
  overview: 60,
  /** Time constant (s) of the exponential approach between modes. */
  settle: 0.25,
} as const;

/**
 * The vertical FOV a camera mode wants. On a slope, or with the boom squeezed under its comfortable distance, the
 * third-person lens widens to the first-person 60. It eases back to 50 when neither condition applies.
 */
export function targetFov(mode: "overview" | "walk" | "guide", firstPerson: boolean, wide = false): number {
  if (mode === "overview") return FOV.overview;
  return firstPerson || wide ? FOV.firstPerson : FOV.follow;
}

/** Boom squeeze for the lens: on below FOLLOW.comfortDistance, off again only above comfortDistance + SQUEEZE.release. */
export const SQUEEZE = { release: 0.3 } as const;

export function boomSqueezed(wasSqueezed: boolean, distance: number): boolean {
  return wasSqueezed
    ? distance <= FOLLOW.comfortDistance + SQUEEZE.release
    : distance < FOLLOW.comfortDistance;
}

/** Slope detection from the walker's smoothed vertical speed, with hysteresis and a hold so landings do not flutter the lens. */
export const SLOPE = {
  /** Smoothed |vertical speed| (m/s) above which the walker counts as on a slope. */
  enter: 0.25,
  /** ... and below which (for `hold` seconds) it counts as level again. */
  exit: 0.12,
  /** Seconds the slope state is kept after the speed drops below `exit`. */
  hold: 0.6,
  /** Time constant (s) of the vertical-speed smoothing. */
  smooth: 0.15,
} as const;

export interface SlopeState {
  /** Smoothed absolute vertical speed (m/s). */
  speed: number;
  on: boolean;
  /** Seconds spent below `exit` while on. */
  level: number;
}

export const NO_SLOPE: SlopeState = { speed: 0, on: false, level: 0 };

/** One step of slope detection for a height change `dy` (m) over `dt` (s). Pure: returns a new state. */
export function stepSlope(s: SlopeState, dy: number, dt: number): SlopeState {
  if (!(dt > 0)) return s;
  const k = 1 - Math.exp(-dt / SLOPE.smooth);
  const speed = s.speed + (Math.abs(dy) / dt - s.speed) * k;
  if (!s.on) return { speed, on: speed > SLOPE.enter, level: 0 };
  const level = speed < SLOPE.exit ? s.level + dt : 0;
  return { speed, on: level < SLOPE.hold, level };
}

/** One framerate-independent step of `current` toward `target` (exponential, time constant `FOV.settle`); lands exactly within 0.01 degrees. */
export function approachFov(current: number, target: number, dt: number): number {
  const next = target + (current - target) * Math.exp(-Math.max(0, dt) / FOV.settle);
  return Math.abs(next - target) < 0.01 ? target : next;
}

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

/**
 * `back` rotated up by `raise` radians in its own vertical plane (yaw kept), written to `out` and returned.
 * The elevation never passes 85 degrees. `out` may be `back` itself.
 */
export function raisedBack(back: THREE.Vector3, raise: number, out: THREE.Vector3): THREE.Vector3 {
  const flat = Math.hypot(back.x, back.z);
  if (flat < 1e-6) return out.copy(back);
  const elevation = Math.min(Math.asin(Math.max(-1, Math.min(1, back.y))) + raise, (85 * Math.PI) / 180);
  const cos = Math.cos(elevation);
  return out.set((back.x / flat) * cos, Math.sin(elevation), (back.z / flat) * cos);
}

/**
 * How far to raise the boom (radians above nominal, 0 = leave it) when it would be shortened below
 * `FOLLOW.comfortDistance`. `current` is the distance the unraised `back` already gets. Raised booms are tried
 * in equal steps up to `FOLLOW.maxRaise`, lowest first, and the first whose clear distance reaches the
 * comfortable one wins, so the camera looks over the shoulder from the least extra height. The clear distance
 * is not monotonic in the raise (a slab or a stair lip can block a middling angle yet clear a steeper one), so
 * every step is tried. If none is comfortable the longest raised boom is taken when it beats `current` by
 * `FOLLOW.raiseGain`, else 0 and the boom is shortened as before. Costs nothing when `current` is already
 * comfortable, else at most `FOLLOW.raiseSteps` casts. `scratch` receives the candidate direction (no allocation here).
 */
export function constrainedPitch(
  wanted: number,
  back: THREE.Vector3,
  current: number,
  cast: (back: THREE.Vector3) => readonly { distance: number; cameraOnly: boolean }[],
  scratch: THREE.Vector3,
): number {
  const comfort = Math.min(FOLLOW.comfortDistance, wanted);
  if (current >= comfort) return 0;
  let best = 0;
  let bestDistance = current + FOLLOW.raiseGain;
  for (let i = 1; i <= FOLLOW.raiseSteps; i++) {
    const raise = (FOLLOW.maxRaise * i) / FOLLOW.raiseSteps;
    const distance = followDistance(wanted, cast(raisedBack(back, raise, scratch)));
    if (distance >= comfort) return raise;
    if (distance > bestDistance) { best = raise; bestDistance = distance; }
  }
  return best;
}

/** Eases `current` toward `target` with the camera's damping; `snap` jumps. Pure and allocation-free. */
export function easeRaise(current: number, target: number, dt: number, snap = false): number {
  if (snap) return target;
  const next = current + (target - current) * (1 - Math.exp(-Math.max(0, dt) * FOLLOW.raiseDamping));
  return Math.abs(next - target) < 1e-3 ? target : next;
}

/**
 * Avatar opacity for a camera `distanceM` from the pivot: 1 at `fadeStart` or farther, `fadeMin` at
 * `minDistance` (the closest the camera gets) or closer, smooth and monotonic between. A pure function of distance; the avatar renders it as
 * a screen-door dither, so there is no transparency and no sort.
 */
export function avatarFade(distanceM: number): number {
  if (!(distanceM < FOLLOW.fadeStart)) return 1;
  const t = Math.min(1, Math.max(0, (FOLLOW.fadeStart - distanceM) / (FOLLOW.fadeStart - FOLLOW.minDistance)));
  return 1 - (1 - FOLLOW.fadeMin) * t * t * (3 - 2 * t);
}
