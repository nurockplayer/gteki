import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CameraCut } from "../../../apps/web/src/explorer/cameraCut.ts";
import { installLightPreset, parseLightPreset, shaftGrade } from "./lightPreset.ts";

describe("lightpreset", () => {
  it("parses only a, b and c", () => {
    for (const p of ["a", "b", "c"]) expect(parseLightPreset(`?kit=0&lightpreset=${p}`)).toBe(p);
    for (const search of ["", "?lightpreset=", "?lightpreset=junk"]) expect(parseLightPreset(search)).toBeNull();
  });
  it("keeps A neutral everywhere", () => {
    for (const [s, r, d] of [[0, 0, 40], [0.5, 0, 20], [1, 0, 0], [2, 10, 10]]) {
      expect(shaftGrade("a", s!, r!, d!)).toEqual({ gain: 1, tint: [1, 1, 1] });
    }
  });
  it("grades B's warm shaft and cool pool", () => {
    expect(shaftGrade("b", 0.5, 0, 20).gain).toBeCloseTo(0.7);
    expect(shaftGrade("b", 0.3, 0, 20).tint).toEqual([1, 0.9, 0.78]);
    expect(shaftGrade("b", 0, 0, 40).gain).toBe(1);
    expect(shaftGrade("b", 0.9, 0, 12).gain).toBe(1);
    expect(shaftGrade("b", 1, 0, 0).gain).toBeCloseTo(1.9);
    expect(shaftGrade("b", 1, 0, 0).tint).toEqual([0.8, 0.9, 1]);
  });
  it("grades C's dim shaft and hard pool", () => {
    expect(shaftGrade("c", 0.5, 0, 20).gain).toBeCloseTo(0.4);
    expect(shaftGrade("c", 1, 0, 0).gain).toBeCloseTo(1.6);
    expect(shaftGrade("c", 1, 0, 6.5).gain).toBeCloseTo(1.6);
  });
  it("leaves fragments outside both regions neutral", () => {
    for (const p of ["a", "b", "c"] as const) {
      for (const [s, r, d, h] of [[0.5, 6, 12, 0], [-0.05, 0, 20, 0], [1.05, 0, 12, 0], [2, 10, 0, 3]]) {
        expect(shaftGrade(p, s!, r!, d!, h!)).toEqual({ gain: 1, tint: [1, 1, 1] });
      }
    }
  });
  it("leaves every material untouched without a flag", () => {
    const material = new THREE.MeshStandardMaterial();
    material.name = "mat.wall";
    const root = new THREE.Mesh(new THREE.BoxGeometry(), material);
    const hook = material.onBeforeCompile, key = material.customProgramCacheKey, version = material.version;
    installLightPreset(root, parseLightPreset(""));
    expect(material.onBeforeCompile).toBe(hook);
    expect(material.customProgramCacheKey).toBe(key);
    expect(material.version).toBe(version);
    root.geometry.dispose(); material.dispose();
  });
  it.each([true, false])("chains bump and camera cut hooks (cut first: %s)", (cutFirst) => {
    const material = new THREE.MeshStandardMaterial();
    material.name = "mat.wall";
    material.onBeforeCompile = (shader) => { shader.fragmentShader += "\n// bump retained"; };
    material.customProgramCacheKey = () => "bump-key";
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, 1);
    const root = new THREE.Group().add(mesh), cut = new CameraCut();
    if (cutFirst) cut.apply(root, [mesh]);
    installLightPreset(root, "c");
    if (!cutFirst) cut.apply(root, [mesh]);
    const shader = {
      uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    } as Parameters<typeof material.onBeforeCompile>[0];
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain("instanceMatrix * d6Position");
    expect(shader.fragmentShader).toContain("// bump retained");
    expect(shader.fragmentShader).toContain("d6Apply(outgoingLight)");
    expect(shader.uniforms).toHaveProperty("gtekiCutEnd");
    expect(material.customProgramCacheKey()).toContain("bump-key");
    expect(material.customProgramCacheKey()).toContain("shinjuku-d6-v3");
    expect(material.customProgramCacheKey()).toContain("gteki-camera-cut");
    mesh.geometry.dispose(); material.dispose(); mesh.dispose();
  });
});
