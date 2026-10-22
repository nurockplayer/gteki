// Screen-door dither shared by everything that draws the avatar body: its own materials (avatar.ts) and the
// normal-pass twins GTAO draws it with (postfx.ts). One GLSL snippet and one predicate, so the pattern and the
// "is it dithering" threshold in the main render and in GTAO's depth/normal buffers cannot drift apart.
import type * as THREE from "three";

/** Below this fade a fragment may be discarded (the GLSL guard); at or above it the body is drawn untouched. */
export const AVATAR_DITHER_ACTIVE_BELOW = 0.999;
export const AVATAR_DITHER_CACHE_KEY = "avatar-dither-fade";

/** Whether `fade` (already sanitized) makes the body dither at all. */
export function avatarDitherActive(fade: number): boolean {
  return fade < AVATAR_DITHER_ACTIVE_BELOW;
}

/** Fade as the shader sees it: finite, within [0, 1]; anything else counts as opaque. */
export function sanitizeAvatarFade(fade: number): number {
  return Number.isFinite(fade) ? Math.min(1, Math.max(0, fade)) : 1;
}

export const AVATAR_DITHER_UNIFORM_DECL = "uniform float uAvatarFade;\nvoid main() {";

/**
 * Interleaved-gradient noise on gl_FragCoord: fragments whose noise reaches the fade uniform are discarded.
 * Pixel-addressed, so any pass drawn at the same resolution as the main target keeps the very same fragments.
 */
export const AVATAR_DITHER_DISCARD = `#include <clipping_planes_fragment>
  if (uAvatarFade < ${AVATAR_DITHER_ACTIVE_BELOW}) {
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (ign >= uAvatarFade) discard;
  }`;

/** Patches a built-in material's fragment shader (any that has `main` and clipping_planes_fragment) with the dither. */
export function patchAvatarDither(shader: { uniforms: Record<string, THREE.IUniform>; fragmentShader: string }, uniform: { value: number }): void {
  shader.uniforms.uAvatarFade = uniform;
  shader.fragmentShader = shader.fragmentShader
    .replace("void main() {", AVATAR_DITHER_UNIFORM_DECL)
    .replace("#include <clipping_planes_fragment>", AVATAR_DITHER_DISCARD);
}

/**
 * Build-time patch (no per-frame work): one program per material type, the fade is a shared uniform object. The
 * shadow pass uses the depth material, so the body shadow does not fade.
 */
export function ditherFade(material: THREE.Material, uniform: { value: number }): void {
  material.onBeforeCompile = (shader) => patchAvatarDither(shader, uniform);
  material.customProgramCacheKey = () => AVATAR_DITHER_CACHE_KEY;
}
