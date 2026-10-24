import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { FadeAwareGTAOPass, POSTFX_HIGH, qaPostFxSettings } from "./postfx.ts";
import { AVATAR_DITHER_DISCARD } from "./avatarDither.ts";
import { createAvatarRig } from "./avatarSelection.ts";
import { fadeUniform, skinnedAvatarFixture } from "./avatarGlb.fixture.ts";

describe("FadeAwareGTAOPass", () => {
  afterEach(() => vi.restoreAllMocks());

  const args = [null, null, null] as unknown as Parameters<GTAOPass["render"]>;
  const makePass = () => new FadeAwareGTAOPass(new THREE.Scene(), new THREE.PerspectiveCamera(), 8, 8);
  const makeAvatar = () => {
    const root = new THREE.Group();
    const lit = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
    const a = new THREE.Mesh(new THREE.BoxGeometry(), lit);
    const b = new THREE.Mesh(new THREE.BoxGeometry(), lit);
    const c = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    root.add(a, b, c);
    return { root, lit, meshes: [a, b, c] };
  };
  /** The material each mesh is drawn with, sampled inside GTAO's scene draw. */
  const sampleDraws = (meshes: THREE.Mesh[], draws: THREE.Material[][]) =>
    vi.spyOn(GTAOPass.prototype, "render").mockImplementation(() => { draws.push(meshes.map((m) => m.material as THREE.Material)); });

  it("draws an opaque avatar with its own materials and a dithered one with dithered normal twins", () => {
    const { root, meshes } = makeAvatar();
    const originals = meshes.map((m) => m.material as THREE.Material);
    const draws: THREE.Material[][] = [];
    sampleDraws(meshes, draws);
    const pass = makePass();
    for (const fade of [1, 0.5, 1]) {
      pass.setFade(root, fade);
      pass.render(...args);
    }
    expect(draws[0]).toEqual(originals);
    expect(draws[2]).toEqual(originals);
    for (const m of draws[1]!) {
      expect(m).toBeInstanceOf(THREE.MeshNormalMaterial);
      expect(m.allowOverride).toBe(false); // GTAO's override material must not replace the twin
      expect(m.blending).toBe(THREE.NoBlending);
    }
    expect(meshes.map((m) => m.material)).toEqual(originals); // restored for the main render
  });

  it("keeps each source's side and shares one twin between meshes with the same material", () => {
    const { root, meshes, lit } = makeAvatar();
    const draws: THREE.Material[][] = [];
    sampleDraws(meshes, draws);
    const pass = makePass();
    pass.setFade(root, 0.3);
    pass.render(...args);
    const [a, b, c] = draws[0]!;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a!.side).toBe(lit.side);
    expect(c!.side).toBe(THREE.FrontSide);
  });

  it("patches the twins with the shared dither on the pass's own fade uniform", () => {
    const { root, meshes } = makeAvatar();
    const draws: THREE.Material[][] = [];
    sampleDraws(meshes, draws);
    const pass = makePass();
    pass.setFade(root, 0.6);
    pass.render(...args);
    expect(pass.fadeUniform.value).toBe(0.6);
    const twin = draws[0]![0]!;
    const shader = { uniforms: {} as Record<string, THREE.IUniform>, fragmentShader: THREE.ShaderLib.normal.fragmentShader };
    twin.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain(AVATAR_DITHER_DISCARD);
    expect(shader.uniforms.uAvatarFade).toBe(pass.fadeUniform);
    expect(twin.customProgramCacheKey()).toBe(twin.customProgramCacheKey());
  });

  it("reuses the same twins every frame (nothing allocated, no new programs) and follows the fade", () => {
    const { root, meshes } = makeAvatar();
    const draws: THREE.Material[][] = [];
    sampleDraws(meshes, draws);
    const pass = makePass();
    for (const fade of [0.9, 0.4, 0.7]) {
      pass.setFade(root, fade);
      pass.render(...args);
      expect(pass.fadeUniform.value).toBe(fade);
    }
    expect(draws[1]).toEqual(draws[0]);
    expect(draws[2]).toEqual(draws[0]);
  });

  it("restores the materials even when the draw throws", () => {
    const { root, meshes } = makeAvatar();
    const originals = meshes.map((m) => m.material);
    vi.spyOn(GTAOPass.prototype, "render").mockImplementation(() => { throw new Error("boom"); });
    const pass = makePass();
    pass.setFade(root, 0.3);
    expect(() => pass.render(...args)).toThrow("boom");
    expect(meshes.map((m) => m.material)).toEqual(originals);
  });

  it("leaves meshes outside the registered object, and array-material meshes, alone", () => {
    const { root, meshes } = makeAvatar();
    const other = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const multi = new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]);
    root.add(multi);
    const before = [other.material, multi.material];
    const seen: unknown[][] = [];
    vi.spyOn(GTAOPass.prototype, "render").mockImplementation(() => { seen.push([other.material, multi.material]); });
    const pass = makePass();
    pass.setFade(root, 0.2);
    pass.render(...args);
    expect(seen[0]).toEqual(before);
    expect(meshes.length).toBe(3);
  });

  it("draws everything untouched when no avatar is registered or the registered one is empty", () => {
    const render = vi.spyOn(GTAOPass.prototype, "render").mockImplementation(() => {});
    const pass = makePass();
    pass.setFade(null, 0.1);
    pass.render(...args);
    pass.setFade(new THREE.Group(), 0.1);
    pass.render(...args);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("disposes its twins", () => {
    const { root, meshes } = makeAvatar();
    const draws: THREE.Material[][] = [];
    sampleDraws(meshes, draws);
    const pass = makePass();
    pass.setFade(root, 0.5);
    pass.render(...args);
    const dispose = vi.spyOn(draws[0]![0]!, "dispose");
    pass.dispose();
    expect(dispose).toHaveBeenCalled();
  });

  it("follows the current rig root after an async skinned avatar swap", async () => {
    const asset = skinnedAvatarFixture();
    // The existing GTAO path supports single-material meshes; array-material coverage remains a visual gate.
    const mesh: THREE.SkinnedMesh = asset.mesh;
    mesh.material = asset.materials[0]!;
    const rig = createAvatarRig({ quality: "low", glbUrl: "/avatar.glb", loader: { loadAsync: async () => asset } });
    const previousRoot = rig.root;
    const pass = makePass();
    pass.setFade(previousRoot, 0.4);
    await rig.loadGlb();
    const original = mesh.material;
    let drawn: THREE.Material | undefined;
    vi.spyOn(GTAOPass.prototype, "render").mockImplementation(() => { drawn = mesh.material as THREE.Material; });
    pass.setFade(rig.root, 0.4); // same per-frame root lookup as Explorer
    pass.render(...args);
    expect(rig.root).not.toBe(previousRoot);
    expect(drawn).toBeInstanceOf(THREE.MeshNormalMaterial);
    expect(fadeUniform(drawn!).value).toBe(0.4);
    expect(mesh.material).toBe(original);
    rig.dispose();
    pass.dispose();
  });
});

describe("QA postprocessing settings", () => {
  it("keeps reflections enabled when the parameter is absent", () => {
    expect(qaPostFxSettings("").reflections).toBe(true);
  });

  it.each(["0", "off", "false", "OFF", "False"])("disables reflections for %s", (value) => {
    expect(qaPostFxSettings(`?qaReflections=${value}`).reflections).toBe(false);
  });

  it.each(["1", "on", "true", "", "unexpected"])("preserves the default for %s", (value) => {
    expect(qaPostFxSettings(`?qaReflections=${value}`).reflections).toBe(true);
  });

  it("changes only reflections and preserves a custom tier", () => {
    const base = {
      ...POSTFX_HIGH,
      bloom: { ...POSTFX_HIGH.bloom, strength: 0.7 },
      ao: { ...POSTFX_HIGH.ao, radius: 0.8 },
      grade: { ...POSTFX_HIGH.grade, contrast: 1.4 },
      msaa: 2,
    };
    const result = qaPostFxSettings("?qaReflections=off", base);
    expect(result).toEqual({ ...base, reflections: false });
    expect(result).not.toBe(base);
  });
});
