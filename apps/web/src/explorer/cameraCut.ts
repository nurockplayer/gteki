import * as THREE from "three";

/**
 * See-through cut for visual-only meshes (signs) near the follow camera.
 *
 * Signs are merged into a few large meshes, so hiding whole objects would blank every sign in the station.
 * Instead each patched material discards fragments, with a screen-space dither, inside a tapered capsule from
 * the camera to the avatar's head: a sign between the two opens a hole onto the avatar, and one within the
 * camera's near distance (where the capsule is widest) disappears instead of being sliced by the near plane.
 * The capsule is in view space, so instancing and skinning need no world-position plumbing.
 *
 * Known limit: the high-quality GTAO pass draws the scene with its own override MeshNormalMaterial, so a cut
 * sign still feeds that pass's depth/normals. A flat hanging sign adds little occlusion and no artefact showed
 * in the Ikebukuro check; cutting it there too would mean overriding GTAOPass internals.
 */
export class CameraCut {
  /** Shared by every patched material; updated once per frame. */
  readonly uniforms = {
    gtekiCutEnd: { value: new THREE.Vector3() },
    /** (inner, outer) metres at the camera end, then at the head end: fully cut inside inner, untouched beyond outer. All 0 disables the cut. */
    gtekiCutRadii: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  /** Patched materials and the hooks they had before, restored on clear (a scene may reuse its materials). */
  private readonly patched = new Map<THREE.Material, Hooks>();
  /**
   * Part of the program cache key, new for every apply: three caches programs per material and per key, and a
   * reused material compiled under an earlier key would keep that program's stale uniform bindings.
   */
  private generation = 0;

  /**
   * Patch the materials of `meshes` in place and return the meshes that are now cut. A material also drawn by a
   * mesh outside `meshes` (anywhere under `root`) stays solid, as does a custom ShaderMaterial: a sign is cut only
   * through built-in mesh materials of its own, so walls never lose fragments and scene materials are never copied.
   */
  apply(root: THREE.Object3D, meshes: readonly THREE.Object3D[]): THREE.Object3D[] {
    const cut = new Set(meshes);
    const solid = new Set<THREE.Material>();
    root.traverse((o) => { if (!cut.has(o)) for (const m of materialsOf(o)) solid.add(m); });
    const key = `gteki-camera-cut-${++this.generation}`;
    return [...cut].filter((mesh) => {
      const own = materialsOf(mesh).filter((m) => !solid.has(m) && !(m as THREE.ShaderMaterial).isShaderMaterial && !(m as THREE.SpriteMaterial).isSpriteMaterial);
      for (const m of own) this.patch(m, key);
      return own.length > 0;
    });
  }

  /** Each frame: the cut capsule runs from the camera to `head` (world). `enabled` false turns it off. */
  update(camera: THREE.Camera, head: THREE.Vector3, enabled: boolean): void {
    this.uniforms.gtekiCutEnd.value.copy(head).applyMatrix4(camera.matrixWorldInverse);
    if (enabled) this.uniforms.gtekiCutRadii.value.set(...CUT_AT_CAMERA, ...CUT_AT_HEAD);
    else this.uniforms.gtekiCutRadii.value.set(0, 0, 0, 0);
  }

  /**
   * Give every patched material its own hooks back. dispose() only releases the renderer's programs for it (the
   * material stays usable and recompiles), so a scene that keeps its materials across loads never piles up cut programs.
   */
  clear(): void {
    for (const [mat, hooks] of this.patched) { Object.assign(mat, hooks); mat.dispose(); mat.needsUpdate = true; }
    this.patched.clear();
  }

  private patch(mat: THREE.Material, key: string): void {
    if (this.patched.has(mat)) return;
    const hooks: Hooks = { onBeforeCompile: mat.onBeforeCompile, customProgramCacheKey: mat.customProgramCacheKey };
    this.patched.set(mat, hooks);
    const prev = hooks.onBeforeCompile;
    const prevKey = hooks.customProgramCacheKey;
    mat.onBeforeCompile = (shader, renderer) => {
      prev.call(mat, shader, renderer);
      injectCut(shader, this.uniforms);
    };
    // three's default key is onBeforeCompile.toString(): evaluate the previous key against the previous hook, or
    // two signs with different scene hooks would share one program.
    mat.customProgramCacheKey = () => {
      const wrapped = mat.onBeforeCompile;
      mat.onBeforeCompile = prev;
      try { return `${prevKey.call(mat)}|${key}`; } finally { mat.onBeforeCompile = wrapped; }
    };
    mat.needsUpdate = true;
  }
}

/** Anything this close to the lens fills the view; near the avatar the hole stays head-sized. */
const CUT_AT_CAMERA = [0.6, 1.0] as const;
const CUT_AT_HEAD = [0.35, 0.6] as const;

/** Own or inherited hook functions, captured to be restored. */
type Hooks = Pick<THREE.Material, "onBeforeCompile" | "customProgramCacheKey">;

function materialsOf(o: THREE.Object3D): THREE.Material[] {
  const m = (o as THREE.Mesh).material;
  return Array.isArray(m) ? m : m ? [m] : [];
}

/**
 * Splice the cut into a material's shaders: every built-in mesh material (three's vertex `<project_vertex>` chunk
 * gives the view-space position). Shaders without that chunk are left untouched (solid rather than half-patched).
 */
export function injectCut(shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> }, uniforms: CameraCut["uniforms"]): boolean {
  const vs = shader.vertexShader, fs = shader.fragmentShader;
  if (!vs.includes("#include <project_vertex>") || !MAIN.test(vs) || !MAIN.test(fs)) return false;
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = vs
    .replace(MAIN, "varying vec3 gtekiViewPos;\n$&")
    .replace("#include <project_vertex>", "#include <project_vertex>\ngtekiViewPos = mvPosition.xyz;");
  shader.fragmentShader = fs.replace(MAIN, `varying vec3 gtekiViewPos;
uniform vec3 gtekiCutEnd;
uniform vec4 gtekiCutRadii;
$&
if (gtekiCutRadii.y > 0.0) {
  // Distance to the segment camera (view origin) → head; dithered between the inner and outer radius there.
  float gtekiT = clamp(dot(gtekiViewPos, gtekiCutEnd) / max(dot(gtekiCutEnd, gtekiCutEnd), 1e-6), 0.0, 1.0);
  vec2 gtekiR = mix(gtekiCutRadii.xy, gtekiCutRadii.zw, gtekiT);
  float gtekiKeep = smoothstep(gtekiR.x, gtekiR.y, length(gtekiViewPos - gtekiCutEnd * gtekiT));
  float gtekiNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (gtekiKeep <= gtekiNoise) discard;
}`);
  return true;
}

const MAIN = /void\s+main\s*\(\s*(void)?\s*\)\s*\{/;
