import * as THREE from "three";

/** What a followShadow call settled on. */
export interface FollowShadowInfo {
  /** World metres per shadow-map texel across the frustum. */
  texelM: number;
  /** The shadow camera's near and far planes (metres along the light axis from the sun position). */
  near: number;
  far: number;
  /** The texel-snapped centre of the frustum, where `sun.target` now sits. */
  centre: THREE.Vector3;
}

/**
 * Fit `sun`'s shadow camera to a square of ±halfExtentM (in light space) around `target`, texel-snapped.
 * `yRange` is the world-Y span of geometry that can cast or receive inside it (e.g. the station's floor-to-roof range).
 *
 * A small frustum that follows the walker spends the whole shadow map on their surroundings (2·H / mapSize per
 * texel, 1.4 cm for H = 14 at 2048) instead of the whole station. Its edges only stay still on screen if the map
 * moves in whole texels, so the centre's coordinates across the light axis are rounded to multiples of the texel
 * size, in the very basis three orients its shadow camera with: world-fixed geometry then lands on the same
 * fractions of a texel every frame and its shadow edges do not shimmer. The along-axis component is free, so it is
 * kept.
 *
 * - The sun direction is `sun.position − sun.target.position` as found, and both move together, so it never drifts.
 *   Only a (nearly) vertical sun is nudged, to three's own 1e-4 rad tilt, so the basis stays well defined.
 * - Depth range: the world box [centre ± r in x/z, yRange in y] holds everything the frustum can see between
 *   the two heights (r allows for the slant of a low sun; a sun below ~5° elevation is treated as 5°, so the
 *   box stays finite and the lowest slants are cut off). The sun is put 1 m beyond the box's near side, near is
 *   then that 1 m and far spans the box. Neither depends on where the walker is while its centre stays
 *   within yRange (r is bounded for the worst height there), so walking never re-projects the camera.
 * - Sun and target are taken to be in world space (no parent transform); the target need not be in the scene.
 *
 * Throws a RangeError, before touching anything, for what cannot be fitted: a non-positive or non-finite
 * halfExtentM or mapSize, an empty or non-finite yRange, a non-finite target, or a zero-length sun direction.
 *
 * Allocation-free when `out` is given.
 */
export function followShadow(sun: THREE.DirectionalLight, target: THREE.Vector3, halfExtentM: number, mapSize: number, yRange: readonly [number, number], out: FollowShadowInfo = { texelM: 0, near: 0, far: 0, centre: new THREE.Vector3() }): FollowShadowInfo {
  const [y0, y1] = yRange;
  if (!(halfExtentM > 0) || !Number.isFinite(halfExtentM)) throw new RangeError(`followShadow: halfExtentM must be positive, got ${halfExtentM}`);
  if (!(mapSize > 0) || !Number.isFinite(mapSize)) throw new RangeError(`followShadow: mapSize must be positive, got ${mapSize}`);
  if (!Number.isFinite(y0) || !Number.isFinite(y1) || y1 < y0) throw new RangeError(`followShadow: bad yRange [${y0}, ${y1}]`);
  if (!Number.isFinite(target.x + target.y + target.z)) throw new RangeError("followShadow: target is not finite");
  const dir = _dir.subVectors(sun.position, sun.target.position);
  if (!(dir.lengthSq() > 0) || !Number.isFinite(dir.lengthSq())) throw new RangeError("followShadow: sun and its target coincide, or are not finite");
  dir.normalize();

  // Horizontal heading and elevation. A sun this close to vertical is tilted to three's own fallback (1e-4 rad, towards +z,
  // as Matrix4.lookAt does), so the camera's basis, which we mirror below, is always the plain one.
  let c = Math.hypot(dir.x, dir.z);
  if (c < VERTICAL_EPS / 2) {
    const e = Math.sign(dir.y) || 1;
    if (c === 0) dir.set(0, 0, 1);
    else dir.set(dir.x / c, 0, dir.z / c);
    dir.multiplyScalar(VERTICAL_EPS).setY(e * Math.sqrt(1 - VERTICAL_EPS * VERTICAL_EPS));
    c = VERTICAL_EPS;
  }
  // THREE.Matrix4.lookAt(eye, target, up = +y), with z = eye − target = dir: x = up × z, y = z × x.
  const right = _right.set(dir.z / c, 0, -dir.x / c);
  const up = _up.crossVectors(dir, right);

  const texel = (2 * halfExtentM) / mapSize;
  const centre = out.centre.copy(target);
  const du = Math.round(target.dot(right) / texel) * texel - target.dot(right);
  const dv = Math.round(target.dot(up) / texel) * texel - target.dot(up);
  centre.addScaledVector(right, du).addScaledVector(up, dv);

  // Footprint of the frustum on a plane y: lateral ±H along `right`, and along the heading it is shifted by
  // c·(y − centre.y)/e and stretched to ±H/|e| (e = dir.y). r bounds that, per axis, for any plane in yRange and
  // any centre height in it (the worst shift is the full span), so it does not follow the walker's height.
  const e = Math.max(Math.abs(dir.y), MIN_ELEVATION_SIN);
  const shift = Math.max(y1 - y0, Math.abs(y0 - centre.y), Math.abs(y1 - centre.y));
  const along = (c * shift + halfExtentM) / e;
  const hx = Math.abs(dir.x) / c, hz = Math.abs(dir.z) / c;
  const r = Math.max(hx * along + hz * halfExtentM, hz * along + hx * halfExtentM);

  // Extremes of the 8 box corners projected on the light axis, relative to the centre.
  const spread = r * (Math.abs(dir.x) + Math.abs(dir.z));
  const sMax = spread + Math.max((y0 - centre.y) * dir.y, (y1 - centre.y) * dir.y);
  const sMin = -spread + Math.min((y0 - centre.y) * dir.y, (y1 - centre.y) * dir.y);
  const distance = Math.max(sMax + DEPTH_MARGIN_M, DEPTH_MARGIN_M); // the eye must stay on dir's side of the centre
  const near = distance - sMax, far = distance - sMin + DEPTH_MARGIN_M;

  sun.target.position.copy(centre);
  sun.position.copy(centre).addScaledVector(dir, distance);
  sun.target.updateMatrixWorld();
  sun.updateMatrixWorld();

  const shadow = sun.shadow;
  if (shadow.mapSize.x !== mapSize || shadow.mapSize.y !== mapSize) {
    shadow.mapSize.set(mapSize, mapSize);
    // three allocates a map only while `map` is null, and would leak the old one.
    shadow.map?.depthTexture?.dispose();
    shadow.map?.dispose();
    shadow.map = null;
  }
  const cam = shadow.camera;
  const changed = cam.left !== -halfExtentM || cam.right !== halfExtentM || cam.top !== halfExtentM || cam.bottom !== -halfExtentM
    || Math.abs(cam.near - near) > PLANE_EPS || Math.abs(cam.far - far) > PLANE_EPS;
  if (changed) {
    cam.left = -halfExtentM; cam.right = halfExtentM; cam.top = halfExtentM; cam.bottom = -halfExtentM;
    cam.near = near; cam.far = far;
    cam.updateProjectionMatrix();
  }

  out.texelM = texel;
  out.near = cam.near;
  out.far = cam.far;
  return out;
}

/** Horizontal part of a unit sun direction below which it is tilted to this (three's own fallback for a vertical camera). */
const VERTICAL_EPS = 1e-4;
/** sin(5°): the lowest sun slant the depth box accounts for. */
const MIN_ELEVATION_SIN = 0.0872;
/** Slack (m) beyond the box on the near and far side, which also keeps near well above zero. */
const DEPTH_MARGIN_M = 1;
/** Near/far differences below this (m) are rounding, not a change worth a new projection matrix. */
const PLANE_EPS = 1e-6;

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
