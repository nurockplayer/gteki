import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { guardBumpNormals } from "../scene/build.ts";

describe("station bump shader compatibility", () => {
  it("guards only the station material while preserving its texture and shared program cache", () => {
    const original = THREE.ShaderChunk.bumpmap_pars_fragment;
    const texture = new THREE.Texture();
    const a = new THREE.MeshStandardMaterial({ bumpMap: texture, bumpScale: 0.008 });
    const b = new THREE.MeshStandardMaterial();
    guardBumpNormals(a);
    guardBumpNormals(b);
    const shader = { fragmentShader: "#include <bumpmap_pars_fragment>" };
    a.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).not.toContain("#include <bumpmap_pars_fragment>");
    // Catch upstream chunk changes that would silently leave a normalization unguarded.
    expect(shader.fragmentShader).toContain("dot( sigmaX, sigmaX ) > 1e-20");
    expect(shader.fragmentShader).toContain("dot( perturbed, perturbed ) > 1e-20");
    expect(shader.fragmentShader).toContain("uniform sampler2D bumpMap;");
    expect(a.bumpMap).toBe(texture);
    expect(a.bumpScale).toBe(0.008);
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    expect(THREE.ShaderChunk.bumpmap_pars_fragment).toBe(original);
    a.dispose(); b.dispose(); texture.dispose();
  });
});
