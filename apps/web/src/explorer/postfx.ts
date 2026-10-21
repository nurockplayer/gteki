// High-quality post-processing chain for the explorer (presentation only).
//
// HDR scene (half float, MSAA) → GTAO → bloom on true highlights only → tone map (AgX) + sRGB → grade.
// Bloom keys on linear luma above 2.5, well over what lit white surfaces reach under the environment light:
// they stay crisp, and only emitters (fixtures, bright signs, daylight) get a halo. The grade adds gentle
// contrast, a vignette and dither so dark ceilings and fog never band. Everything here is renderer-neutral styling; it never changes what the scene shows.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { FloorReflectionPass } from "./floorReflectionPass.ts";

export interface PostFxSettings {
  bloom: { strength: number; radius: number; threshold: number };
  ao: { blend: number; radius: number; distanceFallOff: number; thickness: number };
  grade: { contrast: number; saturation: number; vignette: number; lift: number };
  msaa: number;
  /** Screen-space floor reflections (reuse GTAO's depth/normal buffers). */
  reflections: boolean;
}

export const POSTFX_HIGH: PostFxSettings = {
  bloom: { strength: 0.3, radius: 0.32, threshold: 2.5 },
  ao: { blend: 0.85, radius: 0.5, distanceFallOff: 1.0, thickness: 1.0 },
  grade: { contrast: 1.12, saturation: 1.2, vignette: 0.18, lift: 0.004 },
  msaa: 4,
  reflections: true,
};

/** Display-referred grade, after OutputPass (tone mapping + sRGB). */
export const GradeShader = {
  name: "GtekiGradeShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uVignette: { value: 0 },
    uLift: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uContrast, uSaturation, uVignette, uLift, uAspect;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);
      // Contrast pivots around mid-grey in display space; highlights and blacks keep their ends.
      col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 1.0);
      col = col + uLift * (1.0 - col);
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      float v = smoothstep(0.35, 1.05, length(d) * 1.25);
      col *= 1.0 - uVignette * v;
      // Triangular dither (±1/255) breaks the 8-bit banding of dark gradients.
      float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453)
              + fract(sin(dot(gl_FragCoord.xy + 17.0, vec2(39.3468, 11.135))) * 24634.6345) - 1.0;
      col += n / 255.0;
      gl_FragColor = vec4(col, c.a);
    }`,
};

export class PostFx {
  readonly composer: EffectComposer;
  private readonly gtao: GTAOPass;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, readonly settings: PostFxSettings = POSTFX_HIGH) {
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    // Half float keeps HDR highlights above 1 for the bloom threshold; MSAA restores the edge quality
    // the default framebuffer would have had (composer targets are not antialiased otherwise).
    // On high-DPI screens pixels are already small: MSAA there costs far more than it shows.
    const hiDpi = pr >= 1.5;
    const target = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: hiDpi ? 0 : settings.msaa });
    this.composer = new EffectComposer(renderer, target);
    // The supplied target is already in device pixels; size the composer in CSS pixels so passes added
    // below are not scaled by the pixel ratio a second time.
    this.composer.setSize(size.x, size.y);
    this.composer.addPass(new RenderPass(scene, camera));
    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    this.gtao.blendIntensity = settings.ao.blend;
    this.gtao.updateGtaoMaterial({ radius: settings.ao.radius, distanceFallOff: settings.ao.distanceFallOff, thickness: settings.ao.thickness });
    this.composer.addPass(this.gtao);
    if (settings.reflections) this.composer.addPass(new FloorReflectionPass(camera, this.gtao.depthTexture, this.gtao.normalTexture, undefined, hiDpi ? 0.25 : 0.5));
    const b = settings.bloom;
    this.bloom = new UnrealBloomPass(size, b.strength, b.radius, b.threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    const g = settings.grade;
    this.grade.uniforms.uContrast!.value = g.contrast;
    this.grade.uniforms.uSaturation!.value = g.saturation;
    this.grade.uniforms.uVignette!.value = g.vignette;
    this.grade.uniforms.uLift!.value = g.lift;
    this.grade.uniforms.uAspect!.value = size.x / Math.max(1, size.y);
    this.composer.addPass(this.grade);
  }

  get passes() {
    return this.composer.passes;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    this.grade.uniforms.uAspect!.value = w / Math.max(1, h);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  /** EffectComposer.dispose() frees only its own targets; each pass owns targets/materials too. */
  dispose(): void {
    for (const pass of this.composer.passes) {
      pass.dispose();
      // three's GTAOPass.dispose() leaves these two shader materials allocated.
      if (pass instanceof GTAOPass) { pass.gtaoMaterial.dispose(); pass.blendMaterial.dispose(); }
    }
    this.composer.dispose();
  }
}
