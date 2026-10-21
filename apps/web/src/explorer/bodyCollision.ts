import * as THREE from "three";

/** A ray's nearest hit: its distance and the surface normal there, facing the ray's origin (see hitNormal). */
export interface BodyHit {
  distance: number;
  normal: THREE.Vector3;
}

/** The nearest hit along a ray, or null. `origin` and `dir` are scratch vectors: read them, never keep them. */
export type CastFn = (origin: THREE.Vector3, dir: THREE.Vector3, far: number) => BodyHit | null;

/** A move the body cannot make, and the surface that stops it. */
export interface BodyBlock {
  /** Unit normal of the blocking surface, facing the walker (not necessarily horizontal). */
  normal: THREE.Vector3;
}

/** Heights above the feet at which the walker's body is tested (knee-ish and chest-ish). */
export const BODY_HEIGHTS: readonly number[] = [0.5, 1.2];
/** Radial rays that sample the body disc. 12 leaves a convex corner at most ~6 cm inside the disc between two rays. */
export const BODY_RAYS = 12;
/** A surface counts as pushed into when the horizontal motion's component along its normal is below this. */
const INTO = -1e-6;

const RADIAL: readonly (readonly [number, number])[] = Array.from({ length: BODY_RAYS }, (_, i) => {
  const a = (i / BODY_RAYS) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)] as const;
});

const origin = new THREE.Vector3();
const dir = new THREE.Vector3();

/** Whether any radial ray of length `radius` from (x, y, z) hits a collider: the body disc there overlaps one. */
function touches(cast: CastFn, x: number, y: number, z: number, radius: number): boolean {
  origin.set(x, y, z);
  for (const [dx, dz] of RADIAL) {
    dir.set(dx, 0, dz);
    if (cast(origin, dir, radius)) return true;
  }
  return false;
}

const normalMatrix = new THREE.Matrix3();

/**
 * The world-space unit normal of a ray hit's face, flipped to face the ray's origin. A three.js face normal
 * is local to its mesh and follows the triangle's winding, and collider meshes mix windings (and render
 * double-sided), so the side it points to is taken from the ray, never from the winding.
 */
export function hitNormal(hit: THREE.Intersection, dir: THREE.Vector3): THREE.Vector3 {
  const n = (hit.face?.normal ?? dir.clone().negate()).clone();
  n.applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld)).normalize();
  return n.dot(dir) > 0 ? n.negate() : n;
}

/**
 * Whether moving the walker's body (a vertical cylinder of `radius`) from `from` to `to` runs into a collider,
 * and the surface that stops it (null when the move is free). At each height the move is refused when either
 *  - the sweep hits: a centreline ray and two side rays `radius` to either side of it (horizontal, perpendicular
 *    to the motion), cast from `from` toward `to`. The centreline looks `radius` past `to`; the side rays stop at it.
 *    A side ray that would start behind a surface the body already overlaps is skipped.
 *  - the body disc at `to` is pushed into a surface: a radial ray of length `radius` from `to` hits a surface
 *    whose normal opposes the horizontal motion (the move goes into it). Moving along a surface or away from it
 *    is allowed, so a walker that overlaps a wall can still leave. A disc that touches something it did not at
 *    `from` is refused whatever the normals say: a body never slips into overlap.
 * `cast` is the ray test against the colliders; having none at all is the caller's early-out.
 * Costs 3 + 2 + 12 rays per height (the 2 look sideways from `from` for a surface a side ray would start behind), plus
 * 12 more at `from` when the target disc touches something.
 */
export function bodyBlock(from: THREE.Vector3, to: THREE.Vector3, cast: CastFn, radius: number, heights: readonly number[] = BODY_HEIGHTS): BodyBlock | null {
  const mx = to.x - from.x;
  const my = to.y - from.y;
  const mz = to.z - from.z;
  const len = Math.hypot(mx, my, mz);
  if (len < 1e-6) return null;
  const flat = Math.hypot(mx, mz);
  for (const h of heights) {
    origin.set(from.x, from.y + h, from.z);
    dir.set(mx / len, my / len, mz / len);
    const ahead = cast(origin, dir, len + radius);
    if (ahead) return { normal: ahead.normal };
    if (flat <= 1e-6) continue;
    const px = (-mz / flat) * radius;
    const pz = (mx / flat) * radius;
    for (const side of [1, -1]) {
      // A side whose origin is already past a surface (the start disc overlaps it) is not swept: from there the
      // ray would cross that surface while the walker backs away from it. The target disc still guards that side.
      origin.set(from.x, from.y + h, from.z);
      dir.set(px * side, 0, pz * side).divideScalar(radius);
      if (cast(origin, dir, radius)) continue;
      origin.set(from.x + px * side, from.y + h, from.z + pz * side);
      dir.set(mx / len, my / len, mz / len);
      const beside = cast(origin, dir, len);
      if (beside) return { normal: beside.normal };
    }
    // The radial rays at the target: the surface they hit that the motion goes most directly into.
    let touched: THREE.Vector3 | null = null;
    let deepest = Infinity;
    origin.set(to.x, to.y + h, to.z);
    for (const [dx, dz] of RADIAL) {
      dir.set(dx, 0, dz);
      const hit = cast(origin, dir, radius);
      if (!hit) continue;
      const along = (hit.normal.x * mx + hit.normal.z * mz) / flat;
      if (along < deepest) {
        deepest = along;
        touched = hit.normal;
      }
    }
    if (!touched) continue;
    if (deepest < INTO) return { normal: touched };
    // Moving along or away from what it touches is fine, but a body that was clear must not slip into touching
    // (rounding a corner, or alongside a wall that starts ahead, no ray's normal opposes the motion).
    if (!touches(cast, from.x, from.y + h, from.z, radius)) return { normal: touched };
  }
  return null;
}

/**
 * The part of the horizontal move `from` -> `to` that runs along the surface `normal` (which stopped it), so
 * a walker nearly parallel to a wall slides along it instead of sticking. Null when nothing is left of the
 * move (head-on, or the surface is a floor or ceiling).
 */
export function slideAlong(from: THREE.Vector3, to: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3 | null {
  const nl = Math.hypot(normal.x, normal.z);
  if (nl < 1e-6) return null;
  const nx = normal.x / nl;
  const nz = normal.z / nl;
  const mx = to.x - from.x;
  const mz = to.z - from.z;
  const into = mx * nx + mz * nz;
  const sx = mx - into * nx;
  const sz = mz - into * nz;
  if (Math.hypot(sx, sz) < 1e-6) return null;
  return new THREE.Vector3(from.x + sx, to.y, from.z + sz);
}
