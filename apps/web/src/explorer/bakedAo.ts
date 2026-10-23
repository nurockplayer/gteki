// Baked ambient-occlusion policy (Issue #94 Part B item 5): how strongly the explorer applies a material's `aoMap`
// per quality tier. Pure (plain three objects, no GL) so it is testable without a renderer.
//
// Kit GLBs carry a baked `occlusionTexture` on UV1 (three: `aoMap`, channel 1, intensity 1). three applies an aoMap
// to indirect light only: hemisphere, environment and ambient, never to the sun.
import * as THREE from "three";

/**
 * High-tier multiplier on a material's authored `aoMapIntensity`. The screen-space GTAO pass (postfx.ts) already
 * darkens the same contact areas there, so the baked map is turned down to avoid double darkening. Low tier has no
 * GTAO: the baked map is the only contact darkening and keeps its authored strength (x1). Tuning value.
 *
 * The scale is keyed on quality, not on whether GTAO runs. Today GTAO runs if and only if the high-tier composer
 * exists, so the two agree; if GTAO ever gets its own switch, key this on that instead.
 */
export const AO_MAP_HIGH_SCALE = 0.6;

/** What `applyBakedAo` found under a root. */
export interface BakedAoCounts {
  /** Materials with an `aoMap` (shared materials count once). */
  materials: number;
  /** Of those, materials whose `aoMapIntensity` was set to something other than the authored value. */
  scaled: number;
  /** Of those, materials whose `aoMap` was removed because a geometry using it has no `uv1`. */
  disabled: number;
  /**
   * Estimated GPU bytes of the distinct `aoMap` textures of the materials counted in `materials` (width x height x 4 x 4/3
   * for the mip chain, each texture once; a disabled map still counts, as it was decoded). Lets QA see the tier's cost.
   */
  textureBytes: number;
}

export const bakedAoScale = (quality: "low" | "high"): number => (quality === "high" ? AO_MAP_HIGH_SCALE : 1);

type AoMaterial = THREE.Material & { aoMap: THREE.Texture | null; aoMapIntensity: number };
const hasAoMap = (m: THREE.Material | undefined): m is AoMaterial => !!m && !!(m as AoMaterial).aoMap;

/** Authored intensity per material, recorded the first time it is seen so re-applying never compounds. */
const authored = new WeakMap<THREE.Material, number>();
/** Materials already warned about (one `console.warn` per material; names may be empty or shared). */
const warned = new WeakSet<THREE.Material>();
/** Estimated bytes of a texture's mip chain as RGBA8; 0 while its image has no known size (not decoded yet). */
const textureBytes = (t: THREE.Texture): number => {
  const img = t.image as { width?: number; height?: number } | null | undefined;
  const w = img?.width ?? 0, h = img?.height ?? 0;
  return Math.round((w * h * 4 * 4) / 3);
};

/**
 * Applies the per-tier AO policy to every material under `root` that has an `aoMap`, including a station's own.
 * `aoMapIntensity` becomes authored x `scale` (default: `bakedAoScale(quality)`), computed from the recorded
 * authored value, so shared materials, arrays and repeated calls never multiply twice. An aoMap on channel 1 whose
 * material is used by a geometry without a `uv1` attribute would sample garbage: it is removed (`disabled`).
 *
 * Contract note: three multiplies `aoMap` into the indirect diffuse light, and that includes `lightMap`. A scene-lit
 * station that ships its own `aoMap` on top of an AO-baked lightmap darkens twice; ship one or the other.
 */
export function applyBakedAo(root: THREE.Object3D, quality: "low" | "high", scale: number = bakedAoScale(quality)): BakedAoCounts {
  const counts: BakedAoCounts = { materials: 0, scaled: 0, disabled: 0, textureBytes: 0 };
  const textures = new Set<THREE.Texture>();
  // material -> every mesh geometry that uses it (a material can be shared, or sit in a Mesh.material array)
  const users = new Map<AoMaterial, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!hasAoMap(m)) continue;
      const g = users.get(m);
      if (g) g.push(mesh.geometry); else users.set(m, [mesh.geometry]);
    }
  });
  for (const [m, geometries] of users) {
    counts.materials++;
    textures.add(m.aoMap!);
    if (m.aoMap!.channel === 1 && geometries.some((g) => !g.getAttribute("uv1"))) {
      if (!warned.has(m)) { warned.add(m); console.warn(`[bakedAo] material "${m.name}" has an aoMap on UV1 but a geometry using it has no uv1 attribute; aoMap disabled`); }
      m.aoMap = null;
      m.needsUpdate = true;
      counts.disabled++;
      continue;
    }
    if (!authored.has(m)) authored.set(m, m.aoMapIntensity);
    const next = authored.get(m)! * scale;
    if (m.aoMapIntensity !== next) m.aoMapIntensity = next;
    if (next !== authored.get(m)) counts.scaled++;
  }
  for (const t of textures) counts.textureBytes += textureBytes(t);
  return counts;
}
