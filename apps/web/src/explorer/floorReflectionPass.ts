// Screen-space reflections on floors (presentation only).
//
// Polished station floors mirror their fixtures, columns and passers-by; without that, a lightmapped
// concourse reads as matte plastic. This pass reuses the depth + view-normal buffers GTAOPass already
// renders, so it costs no extra scene draw: a reduced-resolution ray march, a separable blur (glossy
// stone, not a mirror, and no per-pixel noise) and a full-resolution composite. Only up-facing pixels
// reflect (floors, stair treads); reflections fade toward screen edges, with travel distance, with
// view distance and at steep view angles (Fresnel).
import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

export interface FloorReflectionSettings {
  /** Reflectance multiplier at grazing angles (0..1). */
  gloss: number;
  /** Fresnel F0 (head-on reflectance). */
  f0: number;
  /** Ray length (m) after which a reflection fades out. */
  maxDistance: number;
  /** View distance (m) beyond which floors stop reflecting. */
  fadeFar: number;
  /** Blur radius in half-res pixels. */
  blur: number;
  steps: number;
}

export const FLOOR_REFLECTION_DEFAULTS: FloorReflectionSettings = { gloss: 0.85, f0: 0.12, maxDistance: 20, fadeFar: 50, blur: 1.5, steps: 40 };

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const COMMON = /* glsl */ `
  uniform sampler2D tDepth, tNormal;
  uniform mat4 uProj, uInvProj;
  uniform vec3 uUpView;
  uniform float uFadeFar;
  vec3 viewPos(vec2 uv, float d) {
    vec4 p = uInvProj * vec4(vec3(uv, d) * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }
  vec2 project(vec3 p) {
    vec4 c = uProj * vec4(p, 1.0);
    return c.xy / c.w * 0.5 + 0.5;
  }
  /** How much this pixel is a reflective floor (up-facing, not too far). */
  float floorWeight(vec2 uv, out vec3 p, out vec3 n) {
    float d = texture2D(tDepth, uv).x;
    if (d >= 1.0) return 0.0;
    n = normalize(texture2D(tNormal, uv).xyz * 2.0 - 1.0);
    p = viewPos(uv, d);
    return smoothstep(0.9, 0.97, dot(n, uUpView)) * (1.0 - smoothstep(uFadeFar * 0.55, uFadeFar, length(p)));
  }`;

const traceShader = (steps: number) => /* glsl */ `
  #define STEPS ${steps}
  ${COMMON}
  uniform sampler2D tDiffuse;
  uniform float uGloss, uF0, uMaxDistance;
  uniform vec2 uResolution;
  varying vec2 vUv;
  // Interleaved gradient noise: a stable, low-discrepancy start offset the blur fully absorbs.
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  void main() {
    vec3 p, n;
    float w = floorWeight(vUv, p, n);
    if (w <= 0.0) { gl_FragColor = vec4(0.0); return; }
    vec3 v = normalize(p);
    vec3 r = reflect(v, n);
    float cosT = clamp(dot(-v, n), 0.0, 1.0);
    float fresnel = uF0 + (1.0 - uF0) * pow(1.0 - cosT, 5.0);
    float stepLen = 0.05 * (1.0 + ign(gl_FragCoord.xy));
    float t = 0.0, prevT = 0.0;
    vec3 o = p + n * 0.03;
    for (int i = 0; i < STEPS; i++) {
      prevT = t;
      t += stepLen;
      stepLen *= 1.1;
      if (t > uMaxDistance) break;
      vec3 q = o + r * t;
      if (q.z > -0.05) break;
      vec2 uv = project(q);
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
      float sd = texture2D(tDepth, uv).x;
      if (sd >= 1.0) continue;
      float sz = viewPos(uv, sd).z;
      float thickness = 0.3 + t * 0.08;
      if (q.z < sz && sz - q.z < thickness) {
        float a = prevT, b = t;
        for (int k = 0; k < 6; k++) {
          float m = 0.5 * (a + b);
          vec3 qm = o + r * m;
          vec2 um = project(qm);
          if (qm.z < viewPos(um, texture2D(tDepth, um).x).z) b = m; else a = m;
        }
        vec2 h = project(o + r * b);
        vec2 edge = smoothstep(vec2(0.0), vec2(0.1), h) * (1.0 - smoothstep(vec2(0.9), vec2(1.0), h));
        float fade = edge.x * edge.y * (1.0 - smoothstep(uMaxDistance * 0.45, uMaxDistance, b));
        // Rays heading back toward the camera find only the backs of things: fade them out.
        fade *= smoothstep(0.0, 0.25, -r.z + 0.25);
        float k = clamp(fresnel * uGloss * w * fade, 0.0, 0.7);
        gl_FragColor = vec4(texture2D(tDiffuse, h).rgb * k, k);
        return;
      }
    }
    gl_FragColor = vec4(0.0);
  }`;

/** Separable 9-tap gaussian on premultiplied (rgb * k, k). */
const BLUR = /* glsl */ `
  uniform sampler2D tInput;
  uniform vec2 uDir;
  varying vec2 vUv;
  void main() {
    vec4 s = texture2D(tInput, vUv) * 0.2270270270;
    s += texture2D(tInput, vUv + uDir * 1.3846153846) * 0.3162162162;
    s += texture2D(tInput, vUv - uDir * 1.3846153846) * 0.3162162162;
    s += texture2D(tInput, vUv + uDir * 3.2307692308) * 0.0702702703;
    s += texture2D(tInput, vUv - uDir * 3.2307692308) * 0.0702702703;
    gl_FragColor = s;
  }`;

const COMPOSITE = /* glsl */ `
  ${COMMON}
  uniform sampler2D tDiffuse, tRefl;
  varying vec2 vUv;
  void main() {
    vec4 base = texture2D(tDiffuse, vUv);
    vec3 p, n;
    // Re-mask at full resolution so the half-res blur never bleeds onto columns, people or walls.
    float w = floorWeight(vUv, p, n);
    vec4 r = texture2D(tRefl, vUv);
    float k = r.a * step(0.0001, w);
    vec3 refl = r.a > 1e-4 ? r.rgb / r.a : vec3(0.0);
    gl_FragColor = vec4(mix(base.rgb, refl, k), base.a);
  }`;

/** Needs a GTAOPass earlier in the chain for its depth and view-normal targets. */
export class FloorReflectionPass extends Pass {
  private readonly trace: THREE.ShaderMaterial;
  private readonly blur: THREE.ShaderMaterial;
  private readonly composite: THREE.ShaderMaterial;
  private readonly quad = new FullScreenQuad();
  private readonly a: THREE.WebGLRenderTarget;
  private readonly b: THREE.WebGLRenderTarget;
  private readonly up = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    depth: THREE.Texture,
    normal: THREE.Texture,
    readonly settings: FloorReflectionSettings = FLOOR_REFLECTION_DEFAULTS,
    /** Trace/blur resolution relative to the composer's (device-pixel) size. */
    private readonly scale = 0.5,
  ) {
    super();
    const shared = {
      tDepth: { value: depth },
      tNormal: { value: normal },
      uProj: { value: new THREE.Matrix4() },
      uInvProj: { value: new THREE.Matrix4() },
      uUpView: { value: new THREE.Vector3(0, 1, 0) },
      uFadeFar: { value: settings.fadeFar },
    };
    const mat = (name: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({ name, uniforms, vertexShader: VERT, fragmentShader, depthTest: false, depthWrite: false });
    this.trace = mat("GtekiFloorReflectionTrace", traceShader(settings.steps), {
      ...shared,
      tDiffuse: { value: null },
      uGloss: { value: settings.gloss },
      uF0: { value: settings.f0 },
      uMaxDistance: { value: settings.maxDistance },
      uResolution: { value: new THREE.Vector2(1, 1) },
    });
    this.blur = mat("GtekiFloorReflectionBlur", BLUR, { tInput: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.composite = mat("GtekiFloorReflectionComposite", COMPOSITE, { ...shared, tDiffuse: { value: null }, tRefl: { value: null } });
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.a = new THREE.WebGLRenderTarget(1, 1, opts);
    this.b = new THREE.WebGLRenderTarget(1, 1, opts);
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width * this.scale)), h = Math.max(1, Math.round(height * this.scale));
    this.a.setSize(w, h);
    this.b.setSize(w, h);
    this.trace.uniforms.uResolution!.value.set(w, h);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    for (const m of [this.trace, this.composite]) {
      m.uniforms.uProj!.value.copy(this.camera.projectionMatrix);
      m.uniforms.uInvProj!.value.copy(this.camera.projectionMatrixInverse);
      m.uniforms.uUpView!.value.copy(this.up.set(0, 1, 0).transformDirection(this.camera.matrixWorldInverse));
    }
    this.trace.uniforms.tDiffuse!.value = readBuffer.texture;
    this.draw(renderer, this.trace, this.a);
    const r = this.settings.blur;
    for (let i = 0; i < 2; i++) {
      this.blur.uniforms.tInput!.value = this.a.texture;
      this.blur.uniforms.uDir!.value.set(r / this.a.width, 0);
      this.draw(renderer, this.blur, this.b);
      this.blur.uniforms.tInput!.value = this.b.texture;
      this.blur.uniforms.uDir!.value.set(0, r / this.a.height);
      this.draw(renderer, this.blur, this.a);
    }
    this.composite.uniforms.tDiffuse!.value = readBuffer.texture;
    this.composite.uniforms.tRefl!.value = this.a.texture;
    this.draw(renderer, this.composite, this.renderToScreen ? null : writeBuffer);
  }

  private draw(renderer: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.trace.dispose();
    this.blur.dispose();
    this.composite.dispose();
    this.a.dispose();
    this.b.dispose();
    this.quad.dispose();
  }
}
