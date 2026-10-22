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
/**
 * Only geometry that starts below the walker's head casts: a mesh whose lowest point is under feet + this (m).
 * Ceilings, upper-level slabs and walls of the levels above sit higher, so a sun from above never darkens an
 * interior that is lit by its own fixtures; props, walls and gates on the walker's floor cast onto it.
 */
export const CAST_HEADROOM_M = 2.2;
/** The caster set is recomputed only when the walker's floor Y moves more than this (m): a level change, stairs or an escalator. */
export const CAST_RETUNE_M = 0.5;
/** A caster whose world box is taller than this (m) spans more than two levels: a merged mesh a station should split. */
export const TALL_CANDIDATE_SPAN_M = 6;

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

/** A mesh the policy accepted as a caster, with the lowest and highest Y of its world box (-Infinity both when it has none). */
export interface ShadowCandidate {
  mesh: THREE.Mesh;
  minY: number;
  maxY: number;
}

export interface StationShadows {
  /** Meshes that now cast / receive. After applyStationShadows `casters` is every candidate; `setCasters` narrows it. */
  casters: number;
  receivers: number;
  /** The casting candidates, fixed at attach. */
  candidates: ShadowCandidate[];
  /** Candidates taller than TALL_CANDIDATE_SPAN_M: merged meshes spanning several levels, for stations to split. */
  tallCandidates: number;
  /** World box of those meshes (empty when there are none): its Y span is the frustum's depth range. */
  bounds: THREE.Box3;
}

/**
 * Sets castShadow / receiveShadow on every drawn mesh under `root`, once at attach (never per frame), and reports
 * what it set. Does nothing (and touches nothing) unless `shadowsActive(quality, lighting)`. Subtrees with
 * `visible === false` (hidden colliders, camera blockers) are skipped whole; nothing outside `root` is visited, so
 * the route, the overlays and the avatar are never touched. A mesh that fails the policy has castShadow cleared;
 * a `receiveShadow = true` the station set is always kept. A node with `userData.gteki_shadow === "none"` (a glTF
 * extra lands there too) never casts, nor does anything under it; receiving follows the usual rule.
 */
export function applyStationShadows(root: THREE.Object3D, quality: "low" | "high", lighting: "default" | "scene"): StationShadows {
  const out: StationShadows = { casters: 0, receivers: 0, candidates: [], tallCandidates: 0, bounds: new THREE.Box3() };
  if (!shadowsActive(quality, lighting)) return out;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const visit = (o: THREE.Object3D, optOut: boolean): void => {
    if (!o.visible) return;
    const optedOut = optOut || o.userData?.gteki_shadow === "none";
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const f = meshShadowFlags(m);
      m.castShadow = f.cast && !optedOut;
      if (f.receive) m.receiveShadow = true;
      if (m.castShadow) out.casters++;
      if (m.receiveShadow) out.receivers++;
      const hasBox = (m.castShadow || m.receiveShadow) && meshWorldBox(m, box);
      if (hasBox) out.bounds.union(box);
      if (m.castShadow) {
        out.candidates.push({ mesh: m, minY: hasBox ? box.min.y : -Infinity, maxY: hasBox ? box.max.y : -Infinity });
        if (hasBox && box.max.y - box.min.y > TALL_CANDIDATE_SPAN_M) out.tallCandidates++;
      }
    }
    for (const c of o.children) visit(c, optedOut);
  };
  visit(root, false);
  return out;
}

/**
 * Narrows the candidates to those that start below `floorY + headroom` (see CAST_HEADROOM_M) and sets each mesh's
 * castShadow; returns how many cast. Allocation-free. A candidate on a level above the walker does not cast; one on a
 * level below does (its ceiling is under the walker's feet, so it only shades the level out of view).
 */
export function setCasters(candidates: readonly ShadowCandidate[], floorY: number, headroom = CAST_HEADROOM_M): number {
  const limit = floorY + headroom;
  let n = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const on = c.minY < limit;
    c.mesh.castShadow = on;
    if (on) n++;
  }
  return n;
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
