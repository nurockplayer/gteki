import * as THREE from "three";

type LightPreset = "a" | "b" | "c";
const TOP = new THREE.Vector3(-31.93, -23.74, -151.94);
const BOTTOM = new THREE.Vector3(-22.07, -42.87, -117.78);
const LENGTH = TOP.distanceTo(BOTTOM);
const warm = [1, 0.90, 0.78] as const;
const cool = [0.94, 0.97, 1] as const;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function parseLightPreset(search: string): LightPreset | null {
  const value = new URLSearchParams(search).get("lightpreset");
  return value === "a" || value === "b" || value === "c" ? value : null;
}

/** landingHeight is world Y minus B.y; four-argument callers sample B's height. */
export function shaftGrade(preset: LightPreset, s: number, r: number, landingDist: number, landingHeight = 0): { gain: number; tint: [number, number, number] } {
  const shaft = (1 - smooth(5, 6, r)) * smooth(-0.05, -0.05 + 1 / LENGTH, s)
    * (1 - smooth(1.05 - 1 / LENGTH, 1.05, s));
  const pool = (1 - smooth(preset === "c" ? 6.5 : 0, 7, landingDist))
    * (1 - smooth(2, 3, Math.abs(landingHeight)));
  const dip = smooth(0, 0.5, s) * (1 - smooth(0.5, 0.9, s));
  const gain = 1 + shaft * (preset === "c" ? -0.6 : preset === "b" ? -0.4 * dip : 0);
  const tint = [0, 1, 2].map((i) => {
    const shaftTint = 1 + shaft * (preset === "b" ? warm[i]! - 1 : 0);
    return shaftTint + (cool[i]! - shaftTint) * (preset === "a" ? 0 : pool);
  }) as [number, number, number];
  return { gain: gain + ((preset === "a" ? 1 : 1.6) - gain) * pool, tint };
}

const fragment = `
varying vec3 d6World;
uniform vec3 d6Top, d6Bottom, d6ShaftTint, d6Cool, d6Accent;
// shaft base gain, mid-run dip, pool gain, pool inner radius
uniform vec4 d6Grade;
uniform float d6Haze, d6Wall;
void d6Apply(inout vec3 colour) {
  vec3 axis = d6Bottom - d6Top;
  float len = length(axis);
  float s = dot(d6World - d6Top, axis) / dot(axis, axis);
  float r = length(d6World - d6Top - s * axis);
  float shaft = (1.0 - smoothstep(5.0, 6.0, r))
    * smoothstep(-0.05, -0.05 + 1.0 / len, s)
    * (1.0 - smoothstep(1.05 - 1.0 / len, 1.05, s));
  float landing = (1.0 - smoothstep(d6Grade.w, 7.0, length(d6World.xz - d6Bottom.xz)))
    * (1.0 - smoothstep(2.0, 3.0, abs(d6World.y - d6Bottom.y)));
  float dip = smoothstep(0.0, 0.5, s) * (1.0 - smoothstep(0.5, 0.9, s));
  float gain = mix(1.0, d6Grade.x - d6Grade.y * dip, shaft);
  gain = mix(gain, d6Grade.z, landing);
  vec3 tint = mix(vec3(1.0), d6ShaftTint, shaft);
  // A's pool gain is 1, and its tint stays neutral.
  tint = mix(tint, d6Cool, landing);
  colour *= gain * tint;
  colour = mix(colour, d6Cool * 0.5,
    d6Haze * shaft * (1.0 - exp(-0.035 * distance(cameraPosition, d6World))));
  colour += d6Accent * d6Wall * landing
    * (1.0 - smoothstep(1.0, 1.2, d6World.y - d6Bottom.y));
}
`;

/** Patches existing draws only. Null exits before traversal or any material mutation. */
export function installLightPreset(root: THREE.Object3D, preset: LightPreset | null): void {
  if (preset === null) return;
  const uniforms = {
    d6Top: { value: TOP }, d6Bottom: { value: BOTTOM },
    d6ShaftTint: { value: new THREE.Vector3(...(preset === "b" ? warm : [1, 1, 1] as const)) },
    d6Cool: { value: new THREE.Vector3(...(preset === "a" ? [1, 1, 1] as const : cool)) },
    d6Grade: { value: new THREE.Vector4(preset === "c" ? 0.4 : 1, preset === "b" ? 0.4 : 0, preset === "a" ? 1 : 1.6, preset === "c" ? 6.5 : 0) },
    d6Haze: { value: preset === "c" ? 1 : 0 },
    d6Accent: { value: new THREE.Color("#E8318A").multiplyScalar(0.4) },
  };
  const patched = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    let fallback = false;
    for (let p: THREE.Object3D | null = mesh; p; p = p.parent) {
      if (p.name === "kit-fallback") fallback = true;
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const wall = material.name === "mat.wall" || mesh.name === "escalator-shell-sides";
      const selected = /^mat\.(wall|ceiling|floor|floorPaid|floorPlatform)$/.test(material.name)
        || /^escalator-shell-(sides|soffits)$/.test(mesh.name)
        || mesh.name === "escalator-steps:e:ac906cd95e89401b9b11858e02f20895" || mesh.name === "escalator-steps:all"
        || /^kit:toei-nwd-m[36]:/.test(mesh.name) || fallback || mesh.name === "linear-light:underground";
      if (!selected || patched.has(material)) continue;
      patched.add(material);
      const previous = material.onBeforeCompile;
      const previousKey = material.customProgramCacheKey;
      material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer);
        Object.assign(shader.uniforms, uniforms, { d6Wall: { value: wall ? 1 : 0 } });
        shader.vertexShader = `varying vec3 d6World;\n${shader.vertexShader}`.replace("#include <project_vertex>", `#include <project_vertex>
          vec4 d6Position = vec4(transformed, 1.0);
          #ifdef USE_BATCHING
            d6Position = batchingMatrix * d6Position;
          #endif
          #ifdef USE_INSTANCING
            d6Position = instanceMatrix * d6Position;
          #endif
          d6World = (modelMatrix * d6Position).xyz;`);
        shader.fragmentShader = fragment + shader.fragmentShader.replace("#include <opaque_fragment>", "d6Apply(outgoingLight);\n#include <opaque_fragment>");
      };
      material.customProgramCacheKey = () => {
        const wrapped = material.onBeforeCompile;
        material.onBeforeCompile = previous;
        try { return `${previousKey.call(material)}|shinjuku-d6-v1`; }
        finally { material.onBeforeCompile = wrapped; }
      };
      material.needsUpdate = true;
    }
  });
}
