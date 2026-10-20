import * as THREE from "three";

/**
 * See-through cut for visual-only meshes (signs) near the follow camera.
 *
 * Signs are merged into a few large meshes, so hiding whole objects would blank every sign in the station.
 * Instead each patched material discards fragments, with a screen-space dither, inside a tapered capsule from
 * the camera to the avatar's head: a sign between the two opens a hole onto the avatar, and one within the
 * camera's near distance (where the capsule is widest) disappears instead of being sliced by the near plane. The capsule is in view
 * space, so instancing and skinning need no world-position plumbing.
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
  private readonly patched = new WeakSet<THREE.Material>();
  /** Copies made where a material is shared with meshes that must stay solid; owned (and disposed) here. */
  private clones: THREE.Material[] = [];

  /**
   * Patch the materials of `meshes`. A material also drawn by a mesh outside `meshes` (anywhere under `root`)
   * is cloned for the see-through meshes, so walls sharing it keep every fragment.
   */
  apply(root: THREE.Object3D, meshes: readonly THREE.Object3D[]): void {
    const cut = new Set(meshes);
    const solid = new Set<THREE.Material>();
    root.traverse((o) => { if (!cut.has(o)) for (const m of materialsOf(o)) solid.add(m); });
    const copies = new Map<THREE.Material, THREE.Material>();
    for (const mesh of cut) {
      const m = (mesh as THREE.Mesh).material;
      if (!m) continue;
      const own = (mat: THREE.Material): THREE.Material => {
        if (!solid.has(mat)) return this.patch(mat);
        let copy = copies.get(mat);
        if (!copy) {
          // Material.clone() drops shader hooks; the scene's own customisation must survive on the copy.
          const fresh = mat.clone();
          fresh.onBeforeCompile = mat.onBeforeCompile;
          fresh.customProgramCacheKey = mat.customProgramCacheKey;
          copy = this.patch(fresh);
          copies.set(mat, copy);
          this.clones.push(copy);
        }
        return copy;
      };
      (mesh as THREE.Mesh).material = Array.isArray(m) ? m.map(own) : own(m);
    }
  }

  /** Each frame: the cut capsule runs from the camera to `head` (world). `enabled` false turns it off. */
  update(camera: THREE.Camera, head: THREE.Vector3, enabled: boolean): void {
    this.uniforms.gtekiCutEnd.value.copy(head).applyMatrix4(camera.matrixWorldInverse);
    if (enabled) this.uniforms.gtekiCutRadii.value.set(...CUT_AT_CAMERA, ...CUT_AT_HEAD);
    else this.uniforms.gtekiCutRadii.value.set(0, 0, 0, 0);
  }

  /** Drop clones; patched scene materials go with the scene that owns them. */
  clear(): void {
    for (const m of this.clones) m.dispose();
    this.clones = [];
  }

  private patch(mat: THREE.Material): THREE.Material {
    if (this.patched.has(mat)) return mat;
    this.patched.add(mat);
    const prev = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = (shader, renderer) => {
      prev.call(mat, shader, renderer);
      injectCut(shader, this.uniforms);
    };
    // three's default key is onBeforeCompile.toString(): evaluate the previous key against the previous hook, or
    // two signs with different scene hooks would share one program.
    mat.customProgramCacheKey = () => {
      const wrapped = mat.onBeforeCompile;
      mat.onBeforeCompile = prev;
      try { return `${prevKey.call(mat)}|gteki-camera-cut-1`; } finally { mat.onBeforeCompile = wrapped; }
    };
    mat.needsUpdate = true;
    return mat;
  }
}

/** Anything this close to the lens fills the view; near the avatar the hole stays head-sized. */
const CUT_AT_CAMERA = [0.6, 1.0] as const;
const CUT_AT_HEAD = [0.35, 0.6] as const;

function materialsOf(o: THREE.Object3D): THREE.Material[] {
  const m = (o as THREE.Mesh).material;
  return Array.isArray(m) ? m : m ? [m] : [];
}

/**
 * Splice the cut into a built-in material's shaders. Custom shaders without three's standard chunks are left
 * untouched (they stay solid rather than half-patched).
 */
export function injectCut(shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> }, uniforms: CameraCut["uniforms"]): boolean {
  const vs = shader.vertexShader, fs = shader.fragmentShader;
  if (!vs.includes("#include <common>") || !vs.includes("#include <project_vertex>") || !fs.includes("#include <common>") || !fs.includes("#include <clipping_planes_fragment>")) return false;
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = vs
    .replace("#include <common>", "#include <common>\nvarying vec3 gtekiViewPos;")
    .replace("#include <project_vertex>", "#include <project_vertex>\ngtekiViewPos = mvPosition.xyz;");
  shader.fragmentShader = fs
    .replace("#include <common>", "#include <common>\nvarying vec3 gtekiViewPos;\nuniform vec3 gtekiCutEnd;\nuniform vec4 gtekiCutRadii;")
    .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
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
