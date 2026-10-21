import * as THREE from "three";

// Sun-shadow policy (presentation only, #94 Part B item 4): which station meshes cast and receive, and the
// constants of the walker-following shadow frustum (followShadow.ts). Pure, so it is testable without a GL context.

/** Half-width (m, in light space) of the sun's shadow frustum around the walker: 1.4 cm per texel at 2048. */
export const SHADOW_HALF_EXTENT_M = 14;
export const SHADOW_MAP_SIZE = 2048;
/** PCF blur radius, in shadow-map texels. */
export const SHADOW_RADIUS = 3;
/** Shadow normal bias (m): large enough to stop acne on the glancing sun, small enough not to detach contacts. */
export const SHADOW_NORMAL_BIAS = 0.02;
/** Slack (m) added below the lowest and above the highest drawn mesh when fitting the frustum's depth range. */
export const SHADOW_Y_PAD_M = 0.5;
/** Largest half-width (m) the overview fit may use; a station wider than this gets coarser shadows rather than none. */
export const SHADOW_OVERVIEW_MAX_HALF_M = 300;

/** Shadows exist on the high tier and while the core sun is on (default lighting); a scene-lit station owns its shadows. */
export function shadowsActive(quality: "low" | "high", lighting: "default" | "scene"): boolean {
  return quality === "high" && lighting === "default";
}

export interface MeshShadowFlags {
  cast: boolean;
  /** The mesh is lit, so a shadow on it shows. A station's own `receiveShadow = true` is kept on top of this. */
  receive: boolean;
}

const LIT_FLAGS = ["isMeshStandardMaterial", "isMeshLambertMaterial", "isMeshPhongMaterial", "isMeshToonMaterial"] as const;
const isLit = (m: THREE.Material): boolean => LIT_FLAGS.some((k) => (m as unknown as Record<string, unknown>)[k] === true);

/**
 * What one mesh should do. Only opaque, drawn meshes take part: a transparent, faded (`opacity < 1`), invisible,
 * colour-less (depth-only) or non-depth-writing material would cast a solid shadow of something that is not
 * solid. Receiving also needs a lit material (a `MeshBasicMaterial` ignores light, so a shadow would not show).
 * Lines, points and sprites are not meshes and never take part.
 */
export function meshShadowFlags(mesh: THREE.Object3D): MeshShadowFlags {
  const m = mesh as THREE.Mesh;
  if (!m.isMesh || !m.material) return { cast: false, receive: false };
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  if (mats.length === 0) return { cast: false, receive: false };
  const drawn = mats.every((x) => x.visible !== false && !x.transparent && x.opacity >= 1 && x.depthWrite !== false && x.colorWrite !== false);
  return { cast: drawn, receive: drawn && mats.every(isLit) };
}

export interface StationShadows {
  /** Meshes that now cast / receive. */
  casters: number;
  receivers: number;
  /** World box of those meshes (empty when there are none): its Y span is the frustum's depth range. */
  bounds: THREE.Box3;
}

/**
 * Sets castShadow / receiveShadow on every drawn mesh under `root`, once at attach (never per frame), and reports
 * what it set. Does nothing (and touches nothing) unless `shadowsActive(quality, lighting)`. Subtrees with
 * `visible === false` (hidden colliders, camera blockers) are skipped whole; nothing outside `root` is visited, so
 * the route, the overlays and the avatar are never touched. A mesh that fails the policy has castShadow cleared;
 * a `receiveShadow = true` the station set is always kept.
 */
export function applyStationShadows(root: THREE.Object3D, quality: "low" | "high", lighting: "default" | "scene"): StationShadows {
  const out: StationShadows = { casters: 0, receivers: 0, bounds: new THREE.Box3() };
  if (!shadowsActive(quality, lighting)) return out;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const visit = (o: THREE.Object3D): void => {
    if (!o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const f = meshShadowFlags(m);
      m.castShadow = f.cast;
      if (f.receive) m.receiveShadow = true;
      if (m.castShadow) out.casters++;
      if (m.receiveShadow) out.receivers++;
      if ((m.castShadow || m.receiveShadow) && meshWorldBox(m, box)) out.bounds.union(box);
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  return out;
}

/** World box of one mesh from its geometry (or instance) box; false when it has none. */
function meshWorldBox(mesh: THREE.Mesh, out: THREE.Box3): boolean {
  const inst = mesh as THREE.InstancedMesh;
  let local: THREE.Box3 | null;
  if (inst.isInstancedMesh) { inst.computeBoundingBox(); local = inst.boundingBox; }
  else { if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox(); local = mesh.geometry.boundingBox; }
  if (!local || local.isEmpty()) return false;
  out.copy(local).applyMatrix4(mesh.matrixWorld);
  return !out.isEmpty();
}

/** The frustum depth range for a station's drawn geometry: its Y span, padded. */
export function shadowYRange(bounds: THREE.Box3): [number, number] {
  return [bounds.min.y - SHADOW_Y_PAD_M, bounds.max.y + SHADOW_Y_PAD_M];
}

/**
 * Half-width of a frustum that covers the whole station from above. The shadow camera is square in light space,
 * which is not aligned with the station and shears with height, so this takes the footprint's half-diagonal plus half
 * the height span, with a little slack, capped at SHADOW_OVERVIEW_MAX_HALF_M. Never below the walking half-extent.
 */
export function overviewHalfExtent(bounds: THREE.Box3): number {
  const sx = bounds.max.x - bounds.min.x, sy = bounds.max.y - bounds.min.y, sz = bounds.max.z - bounds.min.z;
  const half = 0.5 * Math.hypot(sx, sz) + 0.5 * sy + 2;
  return Math.min(SHADOW_OVERVIEW_MAX_HALF_M, Math.max(SHADOW_HALF_EXTENT_M, half));
}
