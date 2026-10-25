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

/** The slice's on-screen extent as a share of each axis of the free area (accepted range 0.5 to 0.8). */
export const OVERVIEW_FILL = 0.65;

/**
 * The least share of the viewport's shorter side an occluded phone overview keeps (#109): the band between
 * the panel and the route card is short, and the plain fill would shrink the map to about a quarter of the
 * screen. The map then reaches past the band, under the panel and the card, rather than into a speck.
 */
export const OVERVIEW_MIN_VIEWPORT_SHARE = 0.5;

/** A slice smaller than this (m, per ground axis) is framed as if it were this big, so a point never zooms to the floor. */
export const MIN_SLICE_M = 24;

/** The walking camera's far plane (m). The overview may need a deeper one: it sits as far as its free area makes it. */
export const CAMERA_FAR_M = 2000;

/**
 * The far plane the overview camera needs for a pose at `distance` framing a slice of `radius` (m): the base
 * plane, or far enough to hold the whole slice beyond the camera. A phone's free strip is short, which pushes
 * the frame kilometres out; past the far plane every corner is culled and the overview shows nothing.
 */
export function overviewFar(distance: number, radius: number, base = CAMERA_FAR_M): number {
  return Math.max(base, distance + 2 * radius);
}

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
  return pointsBounds(routablePoints(bundle, isTraversable));
}

/** The routable network's points (renderer frame): every point of every traversable edge, with display heights. */
export function routablePoints(bundle: StationBundle, isTraversable: (edge: Edge) => boolean): THREE.Vector3[] {
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const floors = new Map(bundle.floors.map((f) => [f.id, f]));
  const out: THREE.Vector3[] = [];
  for (const edge of bundle.edges) {
    if (isTraversable(edge)) out.push(...edgePoints(bundle, edge, nodes, floors));
  }
  return out;
}

/** The slice box of `points`, lifted by the label height; null for no points. */
export function pointsBounds(points: readonly THREE.Vector3[]): Aabb | null {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of points) {
    min.min(p);
    max.max(p);
  }
  if (!(min.x <= max.x)) return null;
  max.y += LABEL_LIFT_M;
  return { min, max };
}

export interface ScreenBox { x0: number; y0: number; x1: number; y1: number }

/** A rectangle in CSS px, top-left origin. */
export interface ViewRect { x: number; y: number; w: number; h: number }

/**
 * The part of the canvas the UI leaves unobstructed: an optional panel and an optional persistent strip
 * along the canvas bottom (the credit line). The panel is a top bar on a phone (so the free area is below
 * it) and a left column on a desktop (so it is to the right); rather than sniff the layout, this tries the
 * four rectangles the panel's edges leave and keeps the one with the largest usable short side — which is
 * also the one that lets the slice be framed biggest. A panel over the whole canvas (or none at all) leaves
 * the canvas as it is. `bottomInsetPx` is the height of the strip; no rectangle reaches into it.
 * An optional top-right `corner` is clipped to the canvas; if it intersects the chosen area, keep
 * the better of the area left of it or below it (short side first, then area).
 */
export function freeArea(viewport: { w: number; h: number }, panel: ViewRect | null, bottomInsetPx = 0, corner: ViewRect | null = null): ViewRect {
  // The strip blocks the whole width, so the usable canvas simply ends above it.
  const h = Math.max(1, viewport.h - Math.max(0, bottomInsetPx));
  const full: ViewRect = { x: 0, y: 0, w: viewport.w, h };
  const key = (c: ViewRect) => Math.min(c.w, c.h) * 1e6 + c.w * c.h;
  const pick = (candidates: ViewRect[], fallback: ViewRect): ViewRect => {
    let best = fallback, bestKey = -Infinity;
    for (const c of candidates) {
      if (c.w <= 0 || c.h <= 0) continue;
      const k = key(c);
      if (k > bestKey) { bestKey = k; best = c; }
    }
    return best;
  };
  let best = full;
  if (panel) {
    // Only the panel's part over the canvas blocks.
    const x0 = Math.max(0, panel.x), y0 = Math.max(0, panel.y);
    const x1 = Math.min(viewport.w, panel.x + panel.w), y1 = Math.min(h, panel.y + panel.h);
    if (x1 > x0 && y1 > y0) best = pick([
      { x: 0, y: y1, w: viewport.w, h: h - y1 }, // below a top bar
      { x: x1, y: 0, w: viewport.w - x1, h },    // right of a left column
      { x: 0, y: 0, w: viewport.w, h: y0 },      // above a bottom bar
      { x: 0, y: 0, w: x0, h },                 // left of a right column
    ], full);
  }
  if (corner) {
    const x0 = Math.max(0, corner.x), y0 = Math.max(0, corner.y);
    const x1 = Math.min(viewport.w, corner.x + corner.w), y1 = Math.min(h, corner.y + corner.h);
    if (x1 > x0 && y1 > y0 && x0 < best.x + best.w && x1 > best.x && y0 < best.y + best.h && y1 > best.y) {
      best = pick([
        { ...best, w: Math.max(0, x0 - best.x) },
        { ...best, y: y1, h: Math.max(0, best.y + best.h - y1) },
      ], best);
    }
  }
  return best;
}


/**
 * Screen-space bounding box (px, origin top-left of the viewport) of `points` as `camera` sees them now.
 * Points behind the camera or past the far plane are ignored; null when none is in view range.
 * `camera` must have current world matrices (`updateMatrixWorld`) and projection.
 */
export function screenBox(points: readonly THREE.Vector3[], camera: THREE.Camera, width: number, height: number): ScreenBox | null {
  const p = new THREE.Vector3();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of points) {
    p.copy(q).project(camera);
    if (p.z < -1 || p.z > 1) continue;
    const x = (p.x * 0.5 + 0.5) * width, y = (-p.y * 0.5 + 0.5) * height;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return x0 <= x1 ? { x0, y0, x1, y1 } : null;
}

/** The box's larger side as a share of the viewport's shorter side (the quantity the fit targets). */
export function extentShare(box: ScreenBox, width: number, height: number): number {
  return Math.max(box.x1 - box.x0, box.y1 - box.y0) / Math.min(width, height);
}

/** The 8 corners of an Aabb. */
export function boxCorners(box: Aabb): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

export interface FrameView {
  /** Vertical field of view, degrees (a three.js PerspectiveCamera's `fov`). */
  fovDeg: number;
  /** Viewport width / height. */
  aspect: number;
  /** Camera near plane (m): the fit keeps the whole box farther than this. */
  near?: number;
  /** Canvas size in CSS px; only read to place `free`. Defaults to `aspect` × 1 (the whole view is free). */
  viewport?: { w: number; h: number };
  /**
   * The unobstructed part of the view to fit into (CSS px, top-left origin, e.g. `freeArea(...)`). The fit
   * fills a share of this rect's width and of its height, and centres the slice in it, so the slice never
   * sits under the search panel or the credit line. Default: the whole viewport.
   */
  free?: ViewRect;
  /**
   * The points to size and centre on, when the box is only their AABB. The overview passes the routable
   * network's own points — the same set `overviewFrame().bbox` measures — so the fit and the reported
   * extent agree: an AABB's 8 corners can project well outside a diagonal point band and inflate the fit.
   * Default: the box's 8 corners.
   */
  points?: readonly THREE.Vector3[];
  /**
   * A floor for both fit axes, as a share of the viewport's shorter side (#109). Free by default. A phone
   * whose panel and route card leave only a short band still gets a readable map: the outline then grows
   * past that band rather than shrinking to a speck in it. The larger of the two projected sides is at
   * least this share of `min(viewport.w, viewport.h)`, so the map is never clipped sideways.
   */
  minViewportShare?: number;
}

export interface FramePose { target: THREE.Vector3; position: THREE.Vector3; distance: number }

interface Extent { cx: number; cy: number; ndcW: number; ndcH: number; widthPx: number; heightPx: number }

/** Screen extent (viewport height = 1 unit) of `corners` (any sample points) seen from `eye` along `forward`. */
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
 * Fit the camera to `box` along `offsetDir` (target to camera). The fit is per axis: the framed points'
 * projected width may reach `fill` of the free area's width and their projected height `fill` of its
 * height, and the axis that hits its limit first sets the distance — so a wide free area (a desktop's left
 * column) is not wasted on a wide slice. The outline is centred in that area, so with `fill` at most 0.8
 * nothing is clipped (nor hidden under a UI panel) at any aspect. Uses the real perspective projection of
 * `view.points` when given, else the box's 8 corners (not a bounding sphere), so a flat, long slice is
 * framed tightly — and the outline measured is the one a caller projecting the same points sees. Only the
 * target and the distance change; the viewing direction never does.
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
  // Where the slice goes: the free area's centre in NDC, and `fill` of its shorter side. The canvas is
  // `vw × vh`; the free area is given in its px. Extents below are in viewport-height units.
  const vw = view.viewport?.w ?? view.aspect;
  const vh = view.viewport?.h ?? 1;
  const free = view.free ?? { x: 0, y: 0, w: vw, h: vh };
  const cx = (2 * (free.x + free.w / 2)) / vw - 1;
  const cy = 1 - (2 * (free.y + free.h / 2)) / vh;

  // Enlarge a tiny slice around its centre (per ground axis), so the fit stays sane.
  const size = new THREE.Vector3().subVectors(box.max, box.min);
  const centre = new THREE.Vector3().addVectors(box.min, box.max).multiplyScalar(0.5);
  const half = new THREE.Vector3(Math.max(size.x, MIN_SLICE_M) / 2, size.y / 2, Math.max(size.z, MIN_SLICE_M) / 2);
  const corners: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push(new THREE.Vector3(sx * half.x, sy * half.y, sz * half.z));

  // Extent units are viewport heights: the free width in those units is (free.w / vw) * aspect.
  // Each axis gets its own goal; the axis that first reaches its goal sets the distance.
  // A floor in the same units keeps a short free band (a phone between its panel and route card) from
  // shrinking the map to a speck: the outline reaches past the band, so the caller only asks for it then.
  const minPx = (view.minViewportShare ?? 0) * Math.min(vw, vh);
  const goalW = Math.max(1e-6, fill * (free.w / vw) * view.aspect, minPx / vh);
  const goalH = Math.max(1e-6, fill * (free.h / vh), minPx / vh);
  const target = centre.clone();
  // The outline the fit sizes and centres: the caller's points (the routable network) when given, else the
  // grown box's corners.
  const world = view.points && view.points.length > 0 ? view.points : corners.map((c) => c.clone().add(centre));
  const radius = half.length();
  const eyeAt = (dist: number): THREE.Vector3 => target.clone().addScaledVector(dir, dist);
  const outline = (dist: number): Extent | null => {
    return projectCorners(world, eyeAt(dist), forward, right, up, tanV, view.aspect, near);
  };
  /** How far past its per-axis goal the outline is: 1 exactly at the fit, and it falls monotonically as the camera backs away. */
  const excess = (dist: number): number => {
    const e = outline(dist);
    return e ? Math.max(e.widthPx / goalW, e.heightPx / goalH) : Infinity;
  };
  const solve = (): number => {
    // Bracket the answer: `lo` is too close (Infinity counts as too close), `hi` is at or past the fit.
    let lo = near * 2;
    let hi = Math.max(lo * 2, 1);
    while ((excess(hi) === Infinity || excess(hi) > 1) && hi < 1e7) { lo = hi; hi *= 2; }
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      if (excess(mid) > 1) lo = mid; else hi = mid;
    }
    // A degenerate point set would otherwise zoom the camera into the box: never closer than its radius.
    return Math.max(hi, radius + near);
  };
  // The perspective outline's centre differs from the 3D centre; pan the target sideways until the outline
  // sits where the free area wants it (the camera keeps its direction, so this is a pure pan), re-solving
  // the distance.
  let distance = solve();
  for (let pass = 0; pass < 12; pass++) {
    const e = outline(distance);
    if (!e || (Math.abs(e.cx - cx) < 1e-4 && Math.abs(e.cy - cy) < 1e-4)) break;
    target.addScaledVector(right, (e.cx - cx) * distance * tanV * view.aspect).addScaledVector(up, (e.cy - cy) * distance * tanV);
    distance = solve();
  }
  return { target, position: eyeAt(distance), distance };
}
