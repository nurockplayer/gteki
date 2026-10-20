import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CameraCut, injectCut } from "./cameraCut.ts";

const builtIn = (name: "basic" | "standard") => ({ vertexShader: THREE.ShaderLib[name].vertexShader, fragmentShader: THREE.ShaderLib[name].fragmentShader, uniforms: {} as Record<string, THREE.IUniform> });

describe("camera see-through cut", () => {
  it("splices a view-space capsule discard into built-in materials", () => {
    for (const name of ["basic", "standard"] as const) {
      const shader = builtIn(name);
      expect(injectCut(shader, new CameraCut().uniforms)).toBe(true);
      expect(shader.vertexShader).toContain("gtekiViewPos = mvPosition.xyz;");
      expect(shader.fragmentShader).toContain("discard;");
      expect(Object.keys(shader.uniforms)).toEqual(["gtekiCutEnd", "gtekiCutRadii"]);
    }
  });

  it("leaves custom shaders without three's chunks untouched", () => {
    const shader = { vertexShader: "void main() {}", fragmentShader: "void main() {}", uniforms: {} };
    expect(injectCut(shader, new CameraCut().uniforms)).toBe(false);
    expect(shader.fragmentShader).toBe("void main() {}");
  });

  it("clones a material shared with a solid mesh and patches an unshared one in place", () => {
    const shared = new THREE.MeshBasicMaterial(), own = new THREE.MeshBasicMaterial();
    const root = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(), shared);
    const signA = new THREE.Mesh(new THREE.BoxGeometry(), shared), signB = new THREE.Mesh(new THREE.BoxGeometry(), [own, shared]);
    root.add(wall, signA, signB);
    const cut = new CameraCut();
    cut.apply(root, [signA, signB]);
    expect(wall.material).toBe(shared);
    expect(signA.material).not.toBe(shared);
    expect((signB.material as THREE.Material[])[0]).toBe(own);
    expect((signB.material as THREE.Material[])[1]).toBe(signA.material);
    expect(shared.customProgramCacheKey()).not.toContain("gteki-camera-cut");
    expect(own.customProgramCacheKey()).toContain("gteki-camera-cut");
    // Chains a scene's own onBeforeCompile.
    const calls: string[] = [];
    const custom = new THREE.MeshBasicMaterial();
    custom.onBeforeCompile = () => { calls.push("scene"); };
    const sign = new THREE.Mesh(new THREE.BoxGeometry(), custom); root.add(sign);
    cut.apply(root, [sign]);
    const shader = builtIn("basic");
    custom.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(calls).toEqual(["scene"]);
    expect(shader.fragmentShader).toContain("gtekiCutRadii");
  });

  it("puts the capsule end at the head in view space and disables it in overview", () => {
    const cut = new CameraCut();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 2, 4);
    camera.lookAt(0, 1.6, 0);
    camera.updateMatrixWorld();
    cut.update(camera, new THREE.Vector3(0, 1.6, 0), true);
    expect(cut.uniforms.gtekiCutEnd.value.z).toBeLessThan(0);
    expect(cut.uniforms.gtekiCutEnd.value.length()).toBeCloseTo(Math.hypot(0.4, 4), 5);
    const r = cut.uniforms.gtekiCutRadii.value;
    // Wider at the lens than at the head; inner < outer at both ends.
    expect(r.x).toBeLessThan(r.y);
    expect(r.z).toBeLessThan(r.w);
    expect(r.y).toBeGreaterThan(r.w);
    cut.update(camera, new THREE.Vector3(0, 1.6, 0), false);
    expect(r.toArray()).toEqual([0, 0, 0, 0]);
  });
});
