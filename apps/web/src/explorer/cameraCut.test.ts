import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CameraCut, injectCut } from "./cameraCut.ts";

const builtIn = (name: "basic" | "standard") => ({ vertexShader: THREE.ShaderLib[name].vertexShader, fragmentShader: THREE.ShaderLib[name].fragmentShader, uniforms: {} as Record<string, THREE.IUniform> });
const compile = (mat: THREE.Material) => {
  const shader = builtIn("basic");
  mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader;
};
const mesh = (mat: THREE.Material | THREE.Material[]) => new THREE.Mesh(new THREE.BoxGeometry(), mat);

describe("camera see-through cut", () => {
  it("splices a view-space capsule discard into every built-in mesh material", () => {
    for (const name of ["basic", "lambert", "phong", "standard", "physical", "toon", "matcap", "normal", "depth", "distance", "shadow", "points"] as const) {
      const lib = THREE.ShaderLib[name]!;
      const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} as Record<string, THREE.IUniform> };
      expect(injectCut(shader, new CameraCut().uniforms), name).toBe(true);
      expect(shader.vertexShader).toContain("gtekiViewPos = mvPosition.xyz;");
      // Declared once, before main, and the discard opens main.
      expect(shader.fragmentShader.split("uniform vec4 gtekiCutRadii;").length, name).toBe(2);
      expect(shader.fragmentShader.indexOf("uniform vec4 gtekiCutRadii;")).toBeLessThan(shader.fragmentShader.indexOf("void main"));
      expect(shader.fragmentShader).toMatch(/void main\(\) \{\s*if \(gtekiCutRadii\.y > 0\.0\)/);
      expect(Object.keys(shader.uniforms)).toEqual(["gtekiCutEnd", "gtekiCutRadii"]);
    }
  });

  it("leaves custom shaders without three's chunks untouched", () => {
    const shader = { vertexShader: "void main() {}", fragmentShader: "void main() {}", uniforms: {} };
    expect(injectCut(shader, new CameraCut().uniforms)).toBe(false);
    expect(shader.fragmentShader).toBe("void main() {}");
  });

  it("cuts only sign-only built-in materials, in place; shared and custom-shader materials stay solid", () => {
    const shared = new THREE.MeshBasicMaterial(), own = new THREE.MeshBasicMaterial(), custom = new THREE.ShaderMaterial();
    const ownArray = [own, shared];
    const root = new THREE.Group();
    const wall = mesh(shared), sharedSign = mesh(shared), arraySign = mesh(ownArray), shaderSign = mesh(custom);
    root.add(wall, sharedSign, arraySign, shaderSign);
    const cut = new CameraCut().apply(root, [sharedSign, arraySign, shaderSign]);
    expect(cut).toEqual([arraySign]);
    // Nothing is swapped or copied.
    expect(sharedSign.material).toBe(shared);
    expect(arraySign.material).toBe(ownArray);
    expect(own.customProgramCacheKey()).toContain("gteki-camera-cut");
    expect(shared.customProgramCacheKey()).not.toContain("gteki-camera-cut");
    expect(custom.customProgramCacheKey()).not.toContain("gteki-camera-cut");
  });

  it("chains the scene's onBeforeCompile and keeps hook identity in the program key", () => {
    const calls: string[] = [];
    const hookA = () => { calls.push("A"); }, hookB = () => { calls.push("B"); };
    const a = new THREE.MeshBasicMaterial(), b = new THREE.MeshBasicMaterial(), keyed = new THREE.MeshBasicMaterial();
    a.onBeforeCompile = hookA; b.onBeforeCompile = hookB;
    keyed.customProgramCacheKey = () => "scene-key";
    const root = new THREE.Group();
    const signA = mesh(a), signB = mesh(b), signK = mesh(keyed);
    root.add(signA, signB, signK);
    new CameraCut().apply(root, [signA, signB, signK]);
    expect(a.customProgramCacheKey()).toContain(hookA.toString());
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
    expect(keyed.customProgramCacheKey()).toMatch(/^scene-key\|gteki-camera-cut-\d+$/);
    expect(compile(a).fragmentShader).toContain("gtekiCutRadii");
    expect(calls).toEqual(["A"]);
  });

  it("clear restores scene hooks, and a material reused as a sign later compiles under a new key", () => {
    const mat = new THREE.MeshBasicMaterial();
    const sceneHook = mat.onBeforeCompile, sceneKey = mat.customProgramCacheKey();
    const cut = new CameraCut();
    const a = new THREE.Group(), signA = mesh(mat);
    a.add(signA);
    cut.apply(a, [signA]);
    const firstKey = mat.customProgramCacheKey();
    let released = 0;
    mat.addEventListener("dispose", () => { released++; });
    cut.clear();
    // The renderer drops this material's cut programs.
    expect(released).toBe(1);
    expect(mat.onBeforeCompile).toBe(sceneHook);
    expect(mat.customProgramCacheKey()).toBe(sceneKey);
    // Next station: the same material on a wall and a sign stays solid.
    const b = new THREE.Group(), wall = mesh(mat), signB = mesh(mat);
    b.add(wall, signB);
    expect(cut.apply(b, [signB])).toEqual([]);
    expect(mat.customProgramCacheKey()).toBe(sceneKey);
    cut.clear();
    // Sign-only again: a fresh key (three caches programs per material and key) and exactly one cut.
    const c = new THREE.Group(), signC = mesh(mat);
    c.add(signC);
    cut.apply(c, [signC]);
    expect(mat.customProgramCacheKey()).not.toBe(firstKey);
    expect(compile(mat).fragmentShader.split("uniform vec4 gtekiCutRadii;").length).toBe(2);
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

  it("reports which parts of a world segment cut materials still draw", () => {
    const cut = new CameraCut();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 2, 4);
    camera.lookAt(0, 1.6, 0);
    camera.updateMatrixWorld();
    const head = new THREE.Vector3(0, 1.6, 0);
    const from = camera.position.clone();
    // Off: everything draws.
    expect(cut.drawnSpans(from, new THREE.Vector3(0, 1.6, -20))).toEqual([[0, 1]]);
    cut.update(camera, head, true);
    // Straight through the avatar's head and on: the capsule core (camera → head) is cut, the rest draws.
    const through = cut.drawnSpans(from, new THREE.Vector3(0, 1.6 - 0.4 * 5, -20));
    expect(through).toHaveLength(1);
    const len = from.distanceTo(new THREE.Vector3(0, -0.4, -20));
    const axisLen = from.distanceTo(head);
    expect(through[0]![0] * len).toBeGreaterThan(axisLen);
    expect(through[0]![0] * len).toBeLessThan(axisLen + 0.35 + 0.1);
    expect(through[0]![1]).toBe(1);
    // Sideways away from the avatar: only the first ~0.6 m (the core at the lens) is cut.
    const side = cut.drawnSpans(from, new THREE.Vector3(20, 2, 4));
    expect(side).toHaveLength(1);
    expect(side[0]![0] * 20).toBeGreaterThan(0.5);
    expect(side[0]![0] * 20).toBeLessThan(0.7);
    // Far from the capsule: everything draws.
    expect(cut.drawnSpans(new THREE.Vector3(30, 2, 30), new THREE.Vector3(40, 2, 30))).toEqual([[0, 1]]);
    // A material is cut only once patched.
    const sign = new THREE.MeshStandardMaterial();
    expect(cut.cuts(sign)).toBe(false);
    const signMesh = mesh(sign);
    cut.apply(new THREE.Group().add(signMesh), [signMesh]);
    expect(cut.cuts(sign)).toBe(true);
    cut.update(camera, head, false);
    expect(cut.drawnSpans(from, new THREE.Vector3(0, 1.6, -20))).toEqual([[0, 1]]);
  });
});
