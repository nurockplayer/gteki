import * as THREE from "three";

/** Nearest hit distance along a ray, or null. `origin` and `dir` are scratch vectors: read them, never keep them. */
export type CastFn = (origin: THREE.Vector3, dir: THREE.Vector3, far: number) => number | null;

/** Heights above the feet at which the walker's body is tested (knee-ish and chest-ish). */
export const BODY_HEIGHTS: readonly number[] = [0.5, 1.2];
/** Radial rays that sample the body disc. 12 leaves a convex corner at most ~6 cm inside the disc between two rays. */
export const BODY_RAYS = 12;
/** A move that shrinks the clearance by no more than this is not "deeper". */
const SLACK = 1e-4;

const RADIAL: readonly (readonly [number, number])[] = Array.from({ length: BODY_RAYS }, (_, i) => {
  const a = (i / BODY_RAYS) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)] as const;
});

const origin = new THREE.Vector3();
const dir = new THREE.Vector3();

/** Distance from (x, y, z) to the nearest collider within `radius`, over the radial rays; `radius` when none is that close. */
function clearance(cast: CastFn, x: number, y: number, z: number, radius: number): number {
  let min = radius;
  origin.set(x, y, z);
  for (const [dx, dz] of RADIAL) {
    dir.set(dx, 0, dz);
    const d = cast(origin, dir, radius);
    if (d !== null && d < min) min = d;
  }
  return min;
}

/**
 * Whether moving the walker's body (a vertical cylinder of `radius`) from `from` to `to` runs into a collider.
 * At each height the move is refused when either
 *  - the sweep hits: a centreline ray and two side rays `radius` to either side of it (horizontal, perpendicular
 *    to the motion), cast from `from` toward `to`. The centreline looks `radius` past `to`; the side rays stop at it.
 *  - the body disc at `to` is pushed into a collider (nearer than `radius`) and further in than it is at `from`.
 *    A walker that already overlaps a wall can still step along or away from it, never deeper.
 * `cast` is the ray test against the colliders; having none at all is the caller's early-out.
 * Costs 3 + 12 rays per height in the open, up to 3 + 24 beside a wall.
 */
export function bodyBlocked(from: THREE.Vector3, to: THREE.Vector3, cast: CastFn, radius: number, heights: readonly number[] = BODY_HEIGHTS): boolean {
  const mx = to.x - from.x;
  const my = to.y - from.y;
  const mz = to.z - from.z;
  const len = Math.hypot(mx, my, mz);
  if (len < 1e-6) return false;
  const flat = Math.hypot(mx, mz);
  for (const h of heights) {
    origin.set(from.x, from.y + h, from.z);
    dir.set(mx / len, my / len, mz / len);
    if (cast(origin, dir, len + radius) !== null) return true;
    if (flat > 1e-6) {
      const px = (-mz / flat) * radius;
      const pz = (mx / flat) * radius;
      for (const side of [1, -1]) {
        origin.set(from.x + px * side, from.y + h, from.z + pz * side);
        dir.set(mx / len, my / len, mz / len);
        if (cast(origin, dir, len) !== null) return true;
      }
    }
    const next = clearance(cast, to.x, to.y + h, to.z, radius);
    if (next < radius && next < clearance(cast, from.x, from.y + h, from.z, radius) - SLACK) return true;
  }
  return false;
}
