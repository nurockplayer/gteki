import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  AVATAR_DITHER_ACTIVE_BELOW,
  AVATAR_DITHER_CACHE_KEY,
  AVATAR_DITHER_DISCARD,
  AVATAR_DITHER_UNIFORM_DECL,
  avatarDitherActive,
  ditherFade,
  patchAvatarDither,
  sanitizeAvatarFade,
} from "./avatarDither.ts";

const compile = (material: THREE.Material, fragmentShader: string, uniforms: Record<string, THREE.IUniform> = {}) => {
  const shader = { uniforms, fragmentShader };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  return shader;
};

describe("avatarDitherActive / sanitizeAvatarFade", () => {
  it("dithers only below the GLSL guard", () => {
    expect(avatarDitherActive(1)).toBe(false);
    expect(avatarDitherActive(AVATAR_DITHER_ACTIVE_BELOW)).toBe(false);
    expect(avatarDitherActive(AVATAR_DITHER_ACTIVE_BELOW - 0.001)).toBe(true);
    expect(avatarDitherActive(0)).toBe(true);
  });

  it("quotes the same threshold in the GLSL", () => {
    expect(AVATAR_DITHER_DISCARD).toContain(`if (uAvatarFade < ${AVATAR_DITHER_ACTIVE_BELOW})`);
  });

  it("clamps to [0, 1] and treats non-finite as opaque", () => {
    expect(sanitizeAvatarFade(0.4)).toBe(0.4);
    expect(sanitizeAvatarFade(-2)).toBe(0);
    expect(sanitizeAvatarFade(7)).toBe(1);
    expect(sanitizeAvatarFade(Number.NaN)).toBe(1);
    expect(sanitizeAvatarFade(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("ditherFade", () => {
  it("patches the shared snippet into both the lit and the normal fragment shader", () => {
    const uniform = { value: 0.5 };
    for (const [material, source] of [
      [new THREE.MeshStandardMaterial(), THREE.ShaderLib.standard.fragmentShader],
      [new THREE.MeshNormalMaterial(), THREE.ShaderLib.normal.fragmentShader],
    ] as const) {
      ditherFade(material, uniform);
      const shader = compile(material, source);
      expect(shader.fragmentShader).toContain(AVATAR_DITHER_UNIFORM_DECL);
      expect(shader.fragmentShader).toContain(AVATAR_DITHER_DISCARD);
      expect(shader.fragmentShader).toContain("discard;");
      expect(shader.uniforms.uAvatarFade).toBe(uniform);
    }
  });

  it("keeps the program cache key stable so a frame never rebuilds a program", () => {
    const a = new THREE.MeshNormalMaterial();
    const b = new THREE.MeshStandardMaterial();
    ditherFade(a, { value: 1 });
    ditherFade(b, { value: 0.2 });
    expect(a.customProgramCacheKey()).toBe(AVATAR_DITHER_CACHE_KEY);
    expect(a.customProgramCacheKey()).toBe(a.customProgramCacheKey());
    expect(b.customProgramCacheKey()).toBe(AVATAR_DITHER_CACHE_KEY);
  });

  it("patching twice from the same source gives the same shader", () => {
    const uniform = { value: 1 };
    const one = { uniforms: {} as Record<string, THREE.IUniform>, fragmentShader: THREE.ShaderLib.normal.fragmentShader };
    const two = { uniforms: {} as Record<string, THREE.IUniform>, fragmentShader: THREE.ShaderLib.normal.fragmentShader };
    patchAvatarDither(one, uniform);
    patchAvatarDither(two, uniform);
    expect(one.fragmentShader).toBe(two.fragmentShader);
  });
});
