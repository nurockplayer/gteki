import * as THREE from "three";
import type { Edge, StationBundle } from "@gteki/schema";
import { edgePoints } from "./geometry.ts";

/**
 * Overview framing: where the orbit camera sits when the overview opens.
 *
 * The camera keeps one fixed viewing direction (the overview's look); only the target and the distance
 * are fitted, so the routable slice fills a chosen share of the viewport's shorter side whatever the
 * aspect (desktop landscape, portrait phone) and whatever shape the slice has.
 */

export interface Aabb { min: THREE.Vector3; max: THREE.Vector3 }

/** Direction from the target to the camera (renderer frame): the overview's established look, ~42 degrees up. */
export const OVERVIEW_OFFSET = new THREE.Vector3(0.55, 0.85, 0.75).normalize();

/** The slice's larger on-screen extent as a share of the viewport's shorter side (accepted range 0.5 to 0.8). */
export const OVERVIEW_FILL = 0.65;

/** A slice smaller than this (m, per ground axis) is framed as if it were this big, so a point never zooms to the floor. */
export const MIN_SLICE_M = 24;

/** Labels float this far above their entrance, so the slice reaches that high. */
const LABEL_LIFT_M = 2.4;

/**
 * The routable slice: every point the router can actually use (the edges the default profile may
 * traverse, with their display heights), lifted by the label height. Returns null when nothing is
 * routable, so the caller falls back to the scene bounds. Scene context (streets, backdrops) never counts.
 */
export function routableBounds(
  bundle: StationBundle,
  isTraversable: (edge: Edge) => boolean,
): Aabb | null {
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const floors = new Map(bundle.floors.map((f) => [f.id, f]));
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const edge of bundle.edges) {
    if (!isTraversable(edge)) continue;
    for (const p of edgePoints(bundle, edge, nodes, floors)) {
      min.min(p);
      max.max(p);
    }
  }
  if (!(min.x <= max.x)) return null;
  max.y += LABEL_LIFT_M;
  return { min, max };
}

export interface FrameView {
  /** Vertical field of view, degrees (a three.js PerspectiveCamera's `fov`). */
  fovDeg: number;
  /** Viewport width / height. */
  aspect: number;
  /** Camera near plane (m): the fit keeps the whole box farther than this. */
  near?: number;
}

export interface FramePose { target: THREE.Vector3; position: THREE.Vector3; distance: number }

interface Extent { cx: number; cy: number; ndcW: number; ndcH: number; widthPx: number; heightPx: number }

/** Screen extent (viewport height = 1 unit) of the box corners seen from `eye` along `forward`. */
function projectCorners(corners: readonly THREE.Vector3[], eye: THREE.Vector3, forward: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, tanV: number, aspect: number, near: number): Extent | null {
  const d = new THREE.Vector3();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const c of corners) {
    d.subVectors(c, eye);
    const depth = d.dot(forward);
    if (depth <= near) return null;
    const nx = d.dot(right) / (depth * tanV * aspect);
    const ny = d.dot(up) / (depth * tanV);
    x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, ndcW: x1 - x0, ndcH: y1 - y0, widthPx: ((x1 - x0) / 2) * aspect, heightPx: (y1 - y0) / 2 };
}

/**
 * Fit the camera to `box` along `offsetDir` (target to camera). The box's larger projected extent
 * (width or height on screen) lands at `fill` of the viewport's shorter side, and the box is centred on
 * screen, so with `fill` at most 0.8 nothing is clipped at any aspect. Uses the real perspective
 * projection of the 8 corners (not a bounding sphere), so a flat, long slice is framed tightly.
 *
 * Pure: no camera is touched. The caller puts `position` and `target` on the camera and orbit controls.
 */
export function frameBounds(box: Aabb, view: FrameView, fill = OVERVIEW_FILL, offsetDir: THREE.Vector3 = OVERVIEW_OFFSET): FramePose {
  const dir = offsetDir.clone().normalize();
  const forward = dir.clone().negate();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const tanV = Math.tan(THREE.MathUtils.degToRad(view.fovDeg) / 2);
  const near = view.near ?? 0.1;

  // Enlarge a tiny slice around its centre (per ground axis), so the fit stays sane.
  const size = new THREE.Vector3().subVectors(box.max, box.min);
  const centre = new THREE.Vector3().addVectors(box.min, box.max).multiplyScalar(0.5);
  const half = new THREE.Vector3(Math.max(size.x, MIN_SLICE_M) / 2, size.y / 2, Math.max(size.z, MIN_SLICE_M) / 2);
  const corners: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push(new THREE.Vector3(sx * half.x, sy * half.y, sz * half.z));

  const goal = fill * Math.min(view.aspect, 1);
  const target = centre.clone();
  const world = corners.map((c) => c.clone().add(centre));
  const eyeAt = (dist: number): THREE.Vector3 => target.clone().addScaledVector(dir, dist);
  const outline = (dist: number): Extent | null => {
    return projectCorners(world, eyeAt(dist), forward, right, up, tanV, view.aspect, near);
  };
  const larger = (dist: number): number => {
    const e = outline(dist);
    return e ? Math.max(e.widthPx, e.heightPx) : Infinity;
  };
  /** The distance at which the larger extent equals the goal (it falls monotonically as the camera backs away). */
  const solve = (): number => {
    let lo = near * 2;
    while (larger(lo) === Infinity && lo < 1e7) lo *= 2;
    let hi = Math.max(lo * 2, 1);
    while (larger(hi) > goal && hi < 1e7) hi *= 2;
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      if (larger(mid) > goal) lo = mid; else hi = mid;
    }
    return hi;
  };
  // The perspective outline's centre differs from the 3D centre; pan the target sideways until the outline
  // is centred on screen (the camera keeps its direction, so this is a pure pan), re-solving the distance.
  let distance = solve();
  for (let pass = 0; pass < 12; pass++) {
    const e = outline(distance);
    if (!e || (Math.abs(e.cx) < 1e-4 && Math.abs(e.cy) < 1e-4)) break;
    target.addScaledVector(right, e.cx * distance * tanV * view.aspect).addScaledVector(up, e.cy * distance * tanV);
    distance = solve();
  }
  return { target, position: eyeAt(distance), distance };
}
