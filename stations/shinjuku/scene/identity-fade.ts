import type * as THREE from "three";

// Hide boards at camera crossings; restore full coverage before the normal spawn view.
export const IDENTITY_FADE_NEAR = 1.6, IDENTITY_FADE_FAR = 3.0; // metres

export const IDENTITY_FADE_FRAGMENT = /* glsl */ `
uniform float gtekiIdentityNear;
uniform float gtekiIdentityFar;
varying vec3 vGtekiIdentityViewPosition;
float gtekiBayer2(vec2 p) {
  return 2.0 * p.x + 3.0 * p.y - 4.0 * p.x * p.y;
}
float gtekiIdentityThreshold(vec2 pixel) {
  vec2 p = mod(floor(pixel), 4.0);
  return (4.0 * gtekiBayer2(mod(p, 2.0)) + gtekiBayer2(floor(p / 2.0)) + 0.5) / 16.0;
}
`;

/** CPU mirror of shader coverage, for deterministic distance/dither acceptance. */
export function identityFadeCoverage(distance: number): number {
  const t = Math.max(0, Math.min(1, (distance - IDENTITY_FADE_NEAR) / (IDENTITY_FADE_FAR - IDENTITY_FADE_NEAR)));
  return t * t * (3 - 2 * t);
}

/** CPU mirror of the 4x4 Bayer discard; thresholds lie strictly between zero and one. */
export function identityDitherVisible(distance: number, x: number, y: number): boolean {
  const mod4 = (n: number) => ((Math.floor(n) % 4) + 4) % 4;
  const px = mod4(x), py = mod4(y);
  const bayer2 = (a: number, b: number) => 2 * a + 3 * b - 4 * a * b;
  const threshold = (4 * bayer2(px % 2, py % 2) + bayer2(Math.floor(px / 2), Math.floor(py / 2)) + 0.5) / 16;
  return identityFadeCoverage(distance) >= threshold;
}

/** Opaque screen-door fade, driven by the active camera in either station consumer. */
export function identityNearFade<T extends THREE.MeshBasicMaterial | THREE.MeshStandardMaterial>(material: T): T {
  const compile = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.defines = { ...material.defines, GTEKI_IDENTITY_NEAR_FADE: 1 };
  material.onBeforeCompile = function (shader, renderer) {
    compile.call(this, shader, renderer);
    shader.uniforms.gtekiIdentityNear = { value: IDENTITY_FADE_NEAR };
    shader.uniforms.gtekiIdentityFar = { value: IDENTITY_FADE_FAR };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGtekiIdentityViewPosition;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvGtekiIdentityViewPosition = mvPosition.xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${IDENTITY_FADE_FRAGMENT}`)
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
float gtekiIdentityCoverage = smoothstep(gtekiIdentityNear, gtekiIdentityFar, length(vGtekiIdentityViewPosition));
if (gtekiIdentityCoverage < gtekiIdentityThreshold(gl_FragCoord.xy)) discard;`);
  };
  material.customProgramCacheKey = () => `${key}|gteki-identity-near-fade-v1:${material.type}`;
  return material;
}
