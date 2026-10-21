// Procedural surface materials for the Ikebukuro B1 passages.
// Everything is generated at runtime (canvas + shader), so no third-party texture
// rights are involved. Textures assume UV0 is metric (1 unit = 1 m), which the
// Blender build guarantees (box projection): horizontal faces uv = (x, y), vertical faces uv = (along, elevation).
import type * as THREE_NS from "three";
type ThreeNS = typeof THREE_NS;

type Paint = (g: CanvasRenderingContext2D, size: number, rnd: () => number) => void;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function tileTexture(THREE: ThreeNS, c: HTMLCanvasElement, metres: number, srgb: boolean, anisotropy = 8) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / metres, 1 / metres);
  t.anisotropy = anisotropy;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

function canvasTexture(THREE: ThreeNS, size: number, metres: number, paint: Paint, seed: number, srgb = true) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  paint(c.getContext("2d")!, size, rng(seed));
  return tileTexture(THREE, c, metres, srgb);
}

function speckle(g: CanvasRenderingContext2D, size: number, rnd: () => number, n: number, alpha: number, light: string, dark: string) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rnd() < 0.5 ? light : dark;
    g.globalAlpha = alpha * (0.4 + rnd() * 0.6);
    const r = 0.6 + rnd() * 1.6;
    g.fillRect(rnd() * size, rnd() * size, r, r);
  }
  g.globalAlpha = 1;
}

// ---- height fields -> normal maps ------------------------------------------------------------------------

/**
 * Tangent-space normal map (RGBA8, OpenGL convention: +Y = up the texture, i.e. toward smaller image rows) from a
 * height field `h` (0..1, row-major, size x size, wrapping). `heightM` is the height of 1.0 in metres and
 * `metresPerPx` the texel pitch, so slopes are physical: a 3 mm groove over 7 mm tilts the normal ~25 degrees.
 */
export function normalFromHeight(h: ArrayLike<number>, size: number, metresPerPx: number, heightM: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const k = heightM / (8 * metresPerPx); // Sobel weights sum to 4 per side, spacing 2 px
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)]!;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      // N = normalize(-dH/du, -dH/dv, 1), v = up the texture = -y
      const nx = -gx * k, ny = gy * k, inv = 1 / Math.hypot(nx, ny, 1);
      const o = (y * size + x) * 4;
      out[o] = (nx * inv * 0.5 + 0.5) * 255;
      out[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
      out[o + 2] = (inv * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
  return out;
}

/** Paints a greyscale height field (white = high) and returns it as 0..1 floats. `noise` adds per-texel grain. */
function heightField(size: number, paint: Paint, seed: number, noise = 0): Float32Array {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  const rnd = rng(seed);
  paint(g, size, rnd);
  const px = g.getImageData(0, 0, size, size).data;
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = px[i * 4]! / 255 + (noise ? (rnd() - 0.5) * noise : 0);
  return h;
}

function normalTexture(THREE: ThreeNS, size: number, metres: number, paint: Paint, seed: number, heightM: number, noise = 0) {
  const h = heightField(size, paint, seed, noise);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const img = g.createImageData(size, size);
  img.data.set(normalFromHeight(h, size, metres / size, heightM));
  g.putImageData(img, 0, 0);
  return tileTexture(THREE, c, metres, false);
}

const grey = (v: number) => `rgb(${v | 0},${v | 0},${v | 0})`;

// ---- floor: 600 mm porcelain tiles ------------------------------------------------------------------------

const FLOOR_TILES = 4; // 2.4 m canvas
/** Tile faces with a hair of per-tile tone shift, thin grout. Rough variant is greyscale (three reads roughnessMap.g). */
function floorPaint(rough: boolean): Paint {
  return (g, size, rnd) => {
    const t = size / FLOOR_TILES;
    for (let i = 0; i < FLOOR_TILES; i++)
      for (let j = 0; j < FLOOR_TILES; j++) {
        const v = rnd() * 10 - 5;
        g.fillStyle = rough ? `rgb(${88 + v * 2},${88 + v * 2},${88 + v * 2})` : `rgb(${204 + v},${203 + v},${198 + v})`;
        g.fillRect(i * t, j * t, t, t);
        // gentle diagonal sheen across each face: tiles never read as one flat colour
        const gr = g.createLinearGradient(i * t, j * t, (i + 1) * t, (j + 1) * t);
        const s = (rnd() - 0.5) * 2;
        gr.addColorStop(0, rough ? `rgba(255,255,255,${0.05 + 0.04 * s})` : `rgba(255,255,255,${0.05 + 0.04 * s})`);
        gr.addColorStop(1, `rgba(0,0,0,${0.04 - 0.03 * s})`);
        g.fillStyle = gr;
        g.fillRect(i * t, j * t, t, t);
      }
    if (!rough) speckle(g, size, rnd, 9000, 0.18, "#f2f1ec", "#97948d");
    else {
      // scuffed, hand-polished patches: the glossy floor is not uniformly glossy
      for (let n = 0; n < 90; n++) {
        const x = rnd() * size, y = rnd() * size, r = size * (0.015 + rnd() * 0.05);
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        const dark = rnd() < 0.5;
        gr.addColorStop(0, dark ? "rgba(40,40,40,0.28)" : "rgba(230,230,230,0.22)");
        gr.addColorStop(1, "rgba(128,128,128,0)");
        g.fillStyle = gr;
        g.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      g.globalAlpha = 0.12;
      g.strokeStyle = "rgb(170,170,170)";
      g.lineWidth = 0.6;
      for (let n = 0; n < 500; n++) {
        const x = rnd() * size, y = rnd() * size, a = rnd() * Math.PI, l = 4 + rnd() * 18;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    g.fillStyle = rough ? "rgb(210,210,210)" : "#aeaba4";
    const gw = rough ? 2 : 3;
    for (let i = 0; i <= FLOOR_TILES; i++) {
      g.fillRect(i * t - gw / 2, 0, gw, size);
      g.fillRect(0, i * t - gw / 2, size, gw);
    }
  };
}

const floorHeightPaint: Paint = (g, size, rnd) => {
  const t = size / FLOOR_TILES;
  g.fillStyle = grey(70); // grout
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < FLOOR_TILES; i++)
    for (let j = 0; j < FLOOR_TILES; j++) {
      const top = 205 + (rnd() - 0.5) * 10;
      g.fillStyle = grey(top - 38); // chamfered arris
      g.fillRect(i * t + 1.5, j * t + 1.5, t - 3, t - 3);
      g.fillStyle = grey(top);
      g.fillRect(i * t + 3.5, j * t + 3.5, t - 7, t - 7);
    }
};

// ---- walls and columns: shader-drawn cladding (see CLAD_*) -----------------------------------------------

// ---- ceiling: 600 mm lay-in tiles on a T-bar grid ---------------------------------------------------------

const CEIL_TILES = 4;
const ceilingPaint: Paint = (g, size, rnd) => {
  const t = size / CEIL_TILES;
  g.fillStyle = "#e1e3e4";
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < CEIL_TILES; i++)
    for (let j = 0; j < CEIL_TILES; j++) {
      const v = (rnd() - 0.5) * 5;
      g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 100})`;
      g.fillRect(i * t, j * t, t, t);
    }
  speckle(g, size, rnd, size * 5, 0.1, "#f4f5f6", "#b4b6b8");
  // pin-hole / fissure acoustic board
  g.fillStyle = "#8d9194";
  for (let n = 0; n < size * 7; n++) {
    g.globalAlpha = 0.18 + rnd() * 0.3;
    g.fillRect(rnd() * size, rnd() * size, 0.9 + rnd() * 1.1, 0.8 + rnd() * 0.6);
  }
  g.globalAlpha = 1;
  const bar = size / 100; // ~24 mm flange
  for (let i = 0; i <= CEIL_TILES; i++) {
    const p = i * t;
    // shadow gap each side of the flange, then the flange itself
    g.fillStyle = "rgba(70,74,78,0.55)";
    g.fillRect(p - bar * 0.5 - 1.2, 0, bar + 2.4, size);
    g.fillRect(0, p - bar * 0.5 - 1.2, size, bar + 2.4);
    g.fillStyle = "#c9cccd";
    g.fillRect(p - bar * 0.5, 0, bar, size);
    g.fillRect(0, p - bar * 0.5, size, bar);
  }
};

const ceilingHeightPaint: Paint = (g, size, rnd) => {
  const t = size / CEIL_TILES;
  g.fillStyle = grey(150); // tile face, a few mm behind the flange
  g.fillRect(0, 0, size, size);
  g.fillStyle = grey(95);
  for (let n = 0; n < size * 7; n++) g.fillRect(rnd() * size, rnd() * size, 1 + rnd(), 1);
  const bar = size / 100;
  g.fillStyle = grey(210);
  for (let i = 0; i <= CEIL_TILES; i++) {
    g.fillRect(i * t - bar * 0.5, 0, bar, size);
    g.fillRect(0, i * t - bar * 0.5, size, bar);
  }
};

// ---- stairs: granite --------------------------------------------------------------------------------------

/** Granite-like stair treads. */
const stairPaint: Paint = (g, size, rnd) => {
  g.fillStyle = "#77736d";
  g.fillRect(0, 0, size, size);
  // flamed / crystalline cloudiness first, then the grain on top
  for (let n = 0; n < 260; n++) {
    const x = rnd() * size, y = rnd() * size, r = size * (0.02 + rnd() * 0.06);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const l = rnd() < 0.5;
    gr.addColorStop(0, l ? "rgba(190,184,172,0.10)" : "rgba(40,38,34,0.12)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  speckle(g, size, rnd, size * 28, 0.5, "#b9b4ab", "#3f3c38");
};

const stairHeightPaint: Paint = (g, size, rnd) => {
  g.fillStyle = grey(128);
  g.fillRect(0, 0, size, size);
  for (let n = 0; n < size * 40; n++) {
    g.fillStyle = grey(70 + rnd() * 120);
    const r = 0.8 + rnd() * 1.6;
    g.fillRect(rnd() * size, rnd() * size, r, r);
  }
};

// ---- shader patches ----------------------------------------------------------------------------------------
// All lit surfaces are lit by a baked lightmap, which carries no normal-dependent shading. These patches add:
//  * relief shading: the perturbed normal re-weights the baked irradiance as if lit from above-front, so grout,
//    seams and grain show as relief and not only in the (dim) environment reflection;
//  * floor: large-scale tone drift that breaks the 2.4 m texture repeat;
//  * wall / column: large-format panel cladding drawn analytically (crisp seams at any distance, no texture
//    memory) measured from the *local floor* (see geomattrs.ts), with a skirting or a stainless kick plate;
//  * stairs: a non-slip nosing strip on each tread's front edge.

const GLSL_COMMON = /* glsl */ `
varying vec3 vWP;
float gtHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gtNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gtHash(i), gtHash(i + vec2(1.0, 0.0)), f.x), mix(gtHash(i + vec2(0.0, 1.0)), gtHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Surface gradient (per metre, tangent to the surface) of a scalar field s, after Mikkelsen's bump mapping.
vec3 gtGrad(vec3 N, vec3 P, float s) {
  vec3 dpx = dFdx(P), dpy = dFdy(P);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  return (dFdx(s) * r1 + dFdy(s) * r2) / (abs(det) < 1e-12 ? 1e-12 : det);
}
// Gaussian groove of half-width w and depth d around the nearest multiple of P. Returns (coverage, dH/dc);
// the groove widens to the pixel footprint (fw) with its depth scaled down, so it never aliases.
vec2 gtSeam(float c, float P, float w, float depth, float fw) {
  float x = c - P * floor(c / P + 0.5);
  float we = max(w, fw * 0.8);
  float g = exp(-(x * x) / (we * we));
  float amp = w / we;
  return vec2(g * amp, depth * amp * 2.0 * x / (we * we) * g);
}
`;

/** Boosted baked diffuse is capped here (linear), below the explorer's bloom threshold of 1.0. */
const BALANCE_KNEE = 0.85;
const glslReliefEnd = (relief: number, gain = 1) => /* glsl */ `
#include <lights_fragment_end>
${gain === 1 ? "" : `#ifdef USE_LIGHTMAP
{
  // Lightmap balance with a soft knee: dark baked light gets the full gain, which tapers so the boost never
  // lifts diffuse past the knee; anything the bake already made brighter keeps its own value.
  const float G = ${gain.toFixed(3)}, K = ${BALANCE_KNEE.toFixed(3)};
  float gtL0 = dot(reflectedLight.indirectDiffuse, vec3(0.2126, 0.7152, 0.0722));
  float gtL1 = max(gtL0, G * gtL0 / (1.0 + (G - 1.0) * gtL0 / K));
  reflectedLight.indirectDiffuse *= gtL1 / max(gtL0, 1e-5);
}
#endif`}
{
  vec3 gtUp = normalize(viewMatrix[1].xyz);
  vec3 gtL = normalize(gtUp * 0.75 + vec3(0.25, 0.0, 0.65));
  reflectedLight.indirectDiffuse *= max(1.0 + ${relief.toFixed(3)} * dot(normal - nonPerturbedNormal, gtL), 0.0);
  reflectedLight.indirectSpecular *= gtEnvBoost;
}
`;

interface CladSpec {
  /** Panel width and height (m). */
  pw: number;
  ph: number;
  /** Seam half-width and depth (m). */
  seamW: number;
  seamD: number;
  /** Height of the kick plate / skirting above the local floor (m). */
  kick: number;
  steel: boolean;
  /** Per-panel tone amplitude, in-panel mottle amplitude, seam darkening. */
  tone: number;
  mottle: number;
  seamDark: number;
  /** Faint accent band (height range above the floor, linear tint) or null. */
  band: [number, number, [number, number, number]] | null;
  /** Skirting colour (linear), used when the kick is not stainless. */
  skirt: [number, number, number];
  /** Extra environment reflection on the stainless plate. */
  steelEnv: number;
  /** Fine stone grain amplitude. */
  grain: number;
  /** Specular-only environment boost on the panels (envMapIntensity also lifts the diffuse, which the bake owns). */
  panelEnv: number;
}

const f4 = (n: number) => n.toFixed(4);
const v3 = (c: [number, number, number]) => `vec3(${f4(c[0])}, ${f4(c[1])}, ${f4(c[2])})`;

function cladGlsl(c: CladSpec): string {
  const band = c.band
    ? /* glsl */ `
  float bd = smoothstep(${f4(c.band[0])} - fw.y, ${f4(c.band[0])} + fw.y, hh) * (1.0 - smoothstep(${f4(c.band[1])} - fw.y, ${f4(c.band[1])} + fw.y, hh)) * useF;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * ${v3(c.band[2])}, bd);
  vec2 b0 = gtSeam(hh - ${f4(c.band[0])}, 100.0, ${f4(c.seamW * 0.7)}, ${f4(c.seamD * 0.7)}, fw.y) * useF;
  vec2 b1 = gtSeam(hh - ${f4(c.band[1])}, 100.0, ${f4(c.seamW * 0.7)}, ${f4(c.seamD * 0.7)}, fw.y) * useF;
  sV += vec2(0.0, b0.y + b1.y);
  seam = clamp(seam + (b0.x + b1.x) * 0.6, 0.0, 1.0);`
    : "";
  const kick = c.steel
    ? /* glsl */ `
  float brush = mix(0.5, gtNoise(vec2(pc.x * 2.5, pc.y * 520.0)) * 0.6 + gtNoise(vec2(pc.x * 9.0, pc.y * 130.0)) * 0.4, 1.0 - smoothstep(0.0006, 0.004, fw.y));
  float vgrad = mix(1.0, 0.72, smoothstep(0.0, ${f4(c.kick)}, pc.y)); // darker toward the top edge: reflects the column above
  vec3 steel = vec3(0.50, 0.53, 0.57) * (0.7 + 0.6 * brush) * vgrad;
  diffuseColor.rgb = mix(diffuseColor.rgb, steel, kickM);
  metalnessFactor = mix(metalnessFactor, 0.8, kickM);
  roughnessFactor = mix(roughnessFactor, 0.28 + 0.14 * brush, kickM);
  gtEnvBoost = mix(1.0, ${f4(c.steelEnv)} * (0.6 + 0.8 * brush), kickM);`
    : /* glsl */ `
  diffuseColor.rgb = mix(diffuseColor.rgb, ${v3(c.skirt)} * (0.9 + 0.2 * gtNoise(pc * vec2(1.5, 30.0))), kickM);
  roughnessFactor = mix(roughnessFactor, 0.5, kickM);`;
  return /* glsl */ `
float gtEnvBoost = ${f4(c.panelEnv)};
{
  vec2 pc = vPanelUv;
  float useF = vFloorOk * vVert;
  vec2 fw = fwidth(pc);
  float fwm = max(fw.x, fw.y);
  float hh = pc.y - useF * ${f4(c.kick)};
  float kickM = useF * (1.0 - smoothstep(-fw.y, fw.y, hh));
  float aaD = 1.0 - smoothstep(0.02, 0.07, fwm);

  vec2 sU = mix(gtSeam(pc.x, ${f4(c.pw)}, ${f4(c.seamW)}, ${f4(c.seamD)}, fw.x), gtSeam(pc.x, ${f4(c.pw * 2)}, ${f4(c.seamW)}, ${f4(c.seamD)}, fw.x), kickM);
  vec2 sV = gtSeam(hh, ${f4(c.ph)}, ${f4(c.seamW)}, ${f4(c.seamD)}, fw.y) * step(-0.02, hh);
  float seam = clamp(sU.x + sV.x, 0.0, 1.0);

  vec2 id = vec2(floor(pc.x / ${f4(c.pw)}), floor(max(hh, 0.0) / ${f4(c.ph)}));
  float t1 = gtHash(id + vec2(3.7, 1.3)), t2 = gtHash(id + vec2(8.1, 5.9));
  vec3 tone = vec3(1.0 + (t1 - 0.5) * ${f4(c.tone)}) * vec3(1.0 + (t2 - 0.5) * 0.03, 1.0, 1.0 - (t2 - 0.5) * 0.03);
  float mott = gtNoise(pc * vec2(4.0, 3.0) + id * 17.0) * 0.6 + gtNoise(pc * 17.0 + id * 5.0) * 0.4;
  tone *= 1.0 + (mott - 0.5) * ${f4(c.mottle)} * aaD;
  tone *= mix(1.0, mix(0.84, 1.0, smoothstep(0.0, 0.8, pc.y)), useF); // scuffed where bags and shoes reach
  // stone / enamel grain, only while a texel is bigger than a pixel's footprint
  float grain = gtHash(floor(pc * 190.0)) * 0.5 + gtHash(floor(pc * 61.0 + 7.0)) * 0.5;
  tone *= 1.0 + (grain - 0.5) * ${f4(c.grain)} * (1.0 - smoothstep(0.0015, 0.006, fwm));
  diffuseColor.rgb *= tone;
  // panels are never perfectly flat: a faint per-panel tilt and bow makes each one catch the light differently
  vec2 pf = fract(vec2(pc.x / ${f4(c.pw)}, max(hh, 0.0) / ${f4(c.ph)})) - 0.5;
  vec2 bow = vec2((t1 - 0.5) * 0.03 - pf.x * (t2 - 0.5) * 0.05, (t2 - 0.5) * 0.03 - pf.y * (t1 - 0.5) * 0.05) * (1.0 - kickM);
  ${band}
  diffuseColor.rgb *= 1.0 - ${f4(c.seamDark)} * seam;
  ${kick}

  vec3 gU = gtGrad(normal, -vViewPosition, pc.x);
  vec3 gV = gtGrad(normal, -vViewPosition, pc.y);
  normal = normalize(normal - ((sU.y + bow.x) * gU + (sV.y + bow.y) * gV));
}
`;
}

const STAIR_NOSE_W = 0.045;
const stairGlsl = /* glsl */ `
float gtEnvBoost = 1.0;
{
  float d = vNose;
  float fwn = fwidth(d);
  float onT = 1.0 - vVert;
  float strip = (1.0 - smoothstep(${f4(STAIR_NOSE_W)} - fwn, ${f4(STAIR_NOSE_W)} + fwn, d)) * onT;
  float aa = 1.0 - smoothstep(0.004, 0.012, fwn);
  float rp = 0.0125, ph = 6.2831853 * d / rp;
  float ribAmp = 0.0016 * strip * aa;
  float dHdd = -ribAmp * 0.5 * (6.2831853 / rp) * sin(ph);
  float ge = (d - ${f4(STAIR_NOSE_W)}) / 0.0016;
  float groove = exp(-ge * ge) * onT;
  dHdd += 0.0022 * groove * 2.0 * ge / 0.0016 * aa;
  // each step reads as its own slab
  float stepId = floor(vWP.y / 0.16 + 0.5);
  diffuseColor.rgb *= 1.0 + (gtHash(vec2(stepId, 4.0)) - 0.5) * 0.07;
  vec3 nose = vec3(0.44, 0.41, 0.33) * (0.80 + 0.4 * mix(0.5, 0.5 + 0.5 * cos(ph), aa));
  diffuseColor.rgb = mix(diffuseColor.rgb, nose, strip);
  diffuseColor.rgb *= 1.0 - 0.45 * groove * aa;
  roughnessFactor = mix(roughnessFactor, 0.85, strip);
  normal = normalize(normal - dHdd * gtGrad(normal, -vViewPosition, d));
}
`;

const floorGlsl = /* glsl */ `
float gtEnvBoost = 1.0;
{
  vec2 q = vWP.xz;
  float aaM = 1.0 - smoothstep(0.1, 0.5, max(fwidth(q.x), fwidth(q.y)));
  float m1 = gtNoise(q * 0.07), m2 = gtNoise(q * 0.33 + 11.0), m3 = gtNoise(q * 1.9 + 3.0);
  diffuseColor.rgb *= 1.0 + 0.07 * (m1 - 0.5) + 0.05 * (m2 - 0.5) + 0.03 * (m3 - 0.5) * aaM;
  roughnessFactor = clamp(roughnessFactor * (1.0 + 0.5 * (m2 - 0.5)), 0.05, 1.0);
}
`;

type Kind = "floor" | "wall" | "column" | "ceiling" | "stairs";

function patchLit(m: THREE_NS.MeshStandardMaterial, kind: Kind, relief: number, clad?: CladSpec) {
  const isClad = kind === "wall" || kind === "column";
  const gain = LIGHTMAP_BALANCE[kind === "column" ? "barriers" : kind] ?? 1;
  const isStair = kind === "stairs";
  const vHead = `varying vec3 vWP;
${isClad ? "attribute float aFloorY;\nvarying vec2 vPanelUv;\nvarying float vFloorOk;\nvarying float vVert;" : ""}
${isStair ? "attribute float aNose;\nvarying float vNose;\nvarying float vVert;" : ""}`;
  const vBody = `vec3 gtW = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWP = gtW;
${isClad ? `float gtOk = step(-500.0, aFloorY);
vFloorOk = gtOk;
vVert = 1.0 - step(0.5, abs(normal.y));
vPanelUv = vec2(uv.x, mix(uv.y, gtW.y - aFloorY, gtOk * vVert));` : ""}
${isStair ? "vNose = aNose;\nvVert = 1.0 - step(0.5, abs(normal.y));" : ""}`;
  const fHead = GLSL_COMMON + (isClad ? "varying vec2 vPanelUv;\nvarying float vFloorOk;\nvarying float vVert;\n" : "") + (isStair ? "varying float vNose;\nvarying float vVert;\n" : "");
  const fBody = isClad && clad ? cladGlsl(clad) : isStair ? stairGlsl : kind === "floor" ? floorGlsl : "float gtEnvBoost = 1.0;\n";
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\n${vHead}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${vBody}`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${fHead}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${fBody}`)
      .replace("#include <lights_fragment_end>", glslReliefEnd(relief, gain));
  };
  m.customProgramCacheKey = () => `gteki-ikebukuro-${kind}-2`;
}

const WALL_CLAD: CladSpec = {
  pw: 1.2, ph: 0.6, seamW: 0.0022, seamD: 0.0025, kick: 0.1, steel: false,
  tone: 0.06, mottle: 0.07, seamDark: 0.32, band: [1.02, 1.14, [0.92, 0.935, 0.95]],
  skirt: [0.27, 0.255, 0.23], steelEnv: 1, grain: 0.03, panelEnv: 1.5,
};
const COLUMN_CLAD: CladSpec = {
  pw: 0.6, ph: 0.9, seamW: 0.0025, seamD: 0.003, kick: 0.18, steel: true,
  tone: 0.05, mottle: 0.06, seamDark: 0.4, band: null,
  skirt: [0.1, 0.1, 0.1], steelEnv: 6, grain: 0.07, panelEnv: 2.5,
};

/** Environment-reflection strength per role (scene.ts assigns the shared envMap). */
/**
 * Baked-light balance per role (multiplies the lightmap intensity). The bake lights mostly the floor under
 * the downlights; real passages read bright because enamel walls, cladding and ceiling panels get wall-wash
 * and floor bounce the bake underestimates. Applied in the lit shader with a soft knee (BALANCE_KNEE), so no
 * boosted surface crosses the bloom threshold. Presentation only; the floor (and with it exposure) is unchanged.
 */
export const LIGHTMAP_BALANCE: Record<string, number> = { wall: 2.0, barriers: 1.9, ceiling: 2.0 };

export const ENV_INTENSITY: Record<string, number> = { floor: 0.35, ceiling: 0.05, transport: 0.9, wall: 0.2, barriers: 0.2, stairs_ramps: 0.2, floor_elements: 0.2 };

/** Generic lit shopfront: mullions and a warm interior gradient (no brands). */
const shopPaint: Paint = (g, size, rnd) => {
  const grd = g.createLinearGradient(0, 0, 0, size);
  grd.addColorStop(0, "#fff1d6");
  grd.addColorStop(0.55, "#f4c98f");
  grd.addColorStop(1, "#b98953");
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 18; i++) {
    g.fillStyle = `rgba(${120 + rnd() * 80},${80 + rnd() * 60},${50 + rnd() * 50},0.35)`;
    g.fillRect(rnd() * size, size * (0.45 + rnd() * 0.4), 10 + rnd() * 40, 20 + rnd() * 60);
  }
  g.fillStyle = "#3a352e";
  for (let i = 0; i <= 2; i++) g.fillRect(i * (size / 2) - 3, 0, 6, size);
};

/**
 * Daylight gain for street openings (linear, before ACES). The explorer's bloom keys on linear values above
 * 0.85, so the old 2.4 put the whole opening far over threshold and flooded every exit stair top.
 */
const SKY_GAIN = 1.0;

/**
 * Street opening at the top of an exit stair. Seen from below it is daylight, bright enough to read as
 * the way out, with only a soft halo under the explorer's bloom. Seen from above, once you stand at street
 * level, it is the pavement around the stairwell: neutral and below the bloom threshold, so the
 * destination stair stays readable on arrival.
 */
function skyMaterial(THREE: ThreeNS) {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const uniforms = { uSky: { value: new THREE.Color(0.86, 0.92, 1.0).multiplyScalar(SKY_GAIN) }, uStreet: { value: new THREE.Color(0.26, 0.255, 0.245) } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldP;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldP;\nuniform vec3 uSky;\nuniform vec3 uStreet;")
      .replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        // cameraPosition is not uploaded for MeshBasicMaterial: recover the eye from the view matrix.
        `vec3 eye = -transpose(mat3(viewMatrix)) * viewMatrix[3].xyz;
        float above = smoothstep(-0.05, 0.05, eye.y - vWorldP.y);
        vec4 diffuseColor = vec4( mix(uSky, uStreet, above), opacity );`,
      );
  };
  m.customProgramCacheKey = () => "gteki-ikebukuro-sky-1";
  return m;
}

/**
 * Box-filtered periodic bar (period 1, half-width hw, centred on integers) averaged over a footprint of
 * width w. Exact integral of the pulse train, so it converges to the duty cycle 2 * hw as w grows.
 */
const GLSL_PULSE = `
float gtPulse(float x, float hw, float w) {
  w = max(w, 1e-3);
  float a = x - 0.5 * w, b = x + 0.5 * w;
  float na = floor(a + 0.5), nb = floor(b + 0.5);
  float ca = clamp(fract(a + 0.5) - 0.5, -hw, hw), cb = clamp(fract(b + 0.5) - 0.5, -hw, hw);
  return ((nb - na) * 2.0 * hw + cb - ca) / w;
}`;

function beyondMaterial(THREE: ThreeNS) {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 band;\nvarying vec2 vBand;\nvarying vec3 vWorldP;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvBand = band;\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec2 vBand;\nvarying vec3 vWorldP;\n${GLSL_PULSE}`)
      .replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        // cameraPosition is not uploaded for basic materials; recover the eye from the view matrix.
        // All plane intersections and derivatives are computed unconditionally (uniform control flow);
        // only the shaded results are selected.
        `vec3 eye = -transpose(mat3(viewMatrix)) * viewMatrix[3].xyz;
        vec3 rd = normalize(vWorldP - eye);
        float H = max(vBand.y - vBand.x, 0.5);
        float ady = abs(rd.y);
        bool down = rd.y < 0.0;
        // Floor and ceiling hits (denominator-guarded) and the mirrored floor ray up to the ceiling.
        float tF = max((vBand.x - vWorldP.y) / min(rd.y, -0.004), 0.0);
        float tC = max((vBand.y - vWorldP.y) / max(rd.y, 0.004), 0.0);
        vec2 hF = vWorldP.xz + rd.xz * tF;
        vec2 hC = vWorldP.xz + rd.xz * tC;
        float tc = H / max(ady, 0.004);
        vec2 hR = hF + rd.xz * tc;
        vec2 qF = hF / 0.6, qC = hC / 0.6;
        vec2 qL = hC / vec2(2.4, 3.0), qR = hR / vec2(2.4, 3.0);
        vec2 wF = max(fwidth(qF), 1e-3), wC = max(fwidth(qC), 1e-3);
        vec2 wL = max(fwidth(qL), 1e-3), wRd = fwidth(qR);
        float t = down ? tF : tC;
        // Readable depth is short: legible for the first few metres, then it sinks into dim, featureless
        // dark by about 18 m, so it reads as "the station continues" and not as a hall of any size.
        float vis = smoothstep(1.0 / 18.0, 1.0 / 3.0, 1.0 / max(t, 0.01)); // even in screen space (~1/t)
        vis *= smoothstep(0.004, 0.06, ady);
        // Distant dark with a faint gradient (brighter toward the horizon line, darker at the extremes).
        vec3 farc = vec3(0.026, 0.028, 0.031) + vec3(0.03, 0.029, 0.027) * exp(-ady * 22.0);
        float hh = clamp((vWorldP.y - vBand.x) / H, 0.0, 1.0);
        float vig = 1.0 - 0.3 * pow(abs(hh - 0.45) * 2.0, 2.0);
        // Lamp dimensions in cell units (cells 2.4 m by 3.0 m): 0.34 m wide, 1.9 m long.
        const float lampX = 0.07, lampY = 0.32;
        // Floor: the station's own tile scale and brightness at the opening plane, then falloff.
        vec2 fF = fract(qF);
        float grout = 1.0 - smoothstep(0.035, 0.035 + wF.x, fF.x) * smoothstep(0.035, 0.035 + wF.y, fF.y);
        grout *= 1.0 - smoothstep(0.1, 0.4, max(wF.x, wF.y));
        vec3 floorC = mix(vec3(0.31, 0.30, 0.28), vec3(0.23, 0.222, 0.208), grout * exp(-tF / 5.0));
        // Glossy reflection of the ceiling fixtures, blurred with path length, strongest at grazing.
        vec2 wR = wRd * 0.75 + vec2(0.05 * (tF + tc) + 0.03) / vec2(2.4, 3.0);
        float refl = gtPulse(qR.x, lampX, wR.x) * gtPulse(qR.y, lampY, wR.y);
        float fres = 0.04 + 0.96 * pow(1.0 - ady, 5.0);
        floorC += vec3(1.0, 0.97, 0.9) * refl * fres * 0.8 * (1.0 - smoothstep(2.0, 14.0, tF + 0.5 * tc));
        // Ceiling: tile seams at the station's panel scale plus linear fixtures receding in rows.
        vec2 fC = fract(qC);
        float seam = 1.0 - smoothstep(0.02, 0.02 + wC.x, fC.x) * smoothstep(0.02, 0.02 + wC.y, fC.y);
        seam *= 1.0 - smoothstep(0.1, 0.4, max(wC.x, wC.y));
        vec3 ceilC = mix(vec3(0.13, 0.126, 0.118), vec3(0.07, 0.068, 0.064), seam * exp(-tC / 5.0));
        float lamp = gtPulse(qL.x, lampX, wL.x) * gtPulse(qL.y, lampY, wL.y);
        // Averaged (unresolved) fixtures stay under the bloom threshold (luminance 0.92); the extra core
        // emission is gated by resolution, so only fixtures resolved on both axes exceed it.
        float res = 1.0 - smoothstep(0.5, 1.0, max(wL.x / (2.0 * lampX), wL.y / (2.0 * lampY)));
        const vec3 lampC = vec3(1.0, 0.97, 0.91);
        ceilC = mix(ceilC, lampC * 0.95, lamp) + lampC * (0.75 * res * lamp);
        vec3 near = down ? floorC : ceilC;
        vec3 col = mix(farc * vig, near, vis);
        vec4 diffuseColor = vec4(col * diffuse, opacity);`,
      );
  };
  m.customProgramCacheKey = () => "gteki-ikebukuro-beyond-7";
  return m;
}

export interface StationMaterials {
  byRole: Record<string, THREE_NS.Material>;
  setLightmap(tex: THREE_NS.Texture | null, intensity: number): void;
  dispose(): void;
}

export function createMaterials(THREE: ThreeNS, mobile: boolean): StationMaterials {
  const size = mobile ? 512 : 1024;
  const half = size / 2;
  const tex: THREE_NS.Texture[] = [];
  const keep = <T extends THREE_NS.Texture>(t: T) => (tex.push(t), t);
  const floorMap = keep(canvasTexture(THREE, size, 2.4, floorPaint(false), 11));
  const floorRough = keep(canvasTexture(THREE, half, 2.4, floorPaint(true), 11, false));
  const ceilMap = keep(canvasTexture(THREE, size, 2.4, ceilingPaint, 31));
  const stairMap = keep(canvasTexture(THREE, half, 1.2, stairPaint, 41));
  const shopMap = keep(canvasTexture(THREE, 256, 2.4, shopPaint, 61));
  // Relief maps are generated from height canvases; skipped on low quality, where the shader relief is a no-op.
  const floorNormal = mobile ? null : keep(normalTexture(THREE, size, 2.4, floorHeightPaint, 12, 0.0065, 0.02));
  const ceilNormal = mobile ? null : keep(normalTexture(THREE, half, 2.4, ceilingHeightPaint, 32, 0.012));
  const stairNormal = mobile ? null : keep(normalTexture(THREE, half, 1.2, stairHeightPaint, 42, 0.0016));

  const lit: THREE_NS.MeshStandardMaterial[] = [];
  const std = (p: THREE_NS.MeshStandardMaterialParameters, baked = true) => {
    const m = new THREE.MeshStandardMaterial(p);
    if (baked) lit.push(m);
    return m;
  };
  const floor = std({ map: floorMap, roughnessMap: floorRough, roughness: 1, metalness: 0, normalMap: floorNormal, envMapIntensity: ENV_INTENSITY.floor });
  const wall = std({ color: 0xdfe2e4, roughness: 0.42, metalness: 0, side: THREE.DoubleSide });
  const ceiling = std({ map: ceilMap, normalMap: ceilNormal, roughness: 0.95, side: THREE.DoubleSide });
  const stairs = std({ map: stairMap, normalMap: stairNormal, roughness: 0.7 });
  const barriers = std({ color: 0xc6cacf, roughness: 0.3, metalness: 0, side: THREE.DoubleSide });
  patchLit(floor, "floor", 0.9);
  patchLit(wall, "wall", 0.9, WALL_CLAD);
  patchLit(ceiling, "ceiling", 0.6);
  patchLit(stairs, "stairs", 0.8);
  patchLit(barriers, "column", 0.9, COLUMN_CLAD);

  const byRole: Record<string, THREE_NS.Material> = {
    floor,
    wall,
    ceiling,
    stairs_ramps: stairs,
    barriers,
    floor_elements: std({ color: 0x9b958c, roughness: 0.6 }),
    transport: std({ color: 0x9aa0a7, roughness: 0.38, metalness: 0.35 }),
    windows: std({ map: shopMap, emissiveMap: shopMap, emissive: 0xffffff, emissiveIntensity: 1.15, roughness: 0.15, side: THREE.DoubleSide }, false),
    doors: std({ map: shopMap, emissiveMap: shopMap, emissive: 0xffffff, emissiveIntensity: 1.35, roughness: 0.2, side: THREE.DoubleSide }, false),
    light_fixtures: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.97, 0.92).multiplyScalar(2.2) }),
    // Openings to the street at the top of exit stairs: daylight.
    portal_sky: skyMaterial(THREE),
    // Openings into spaces the open data does not model (fare areas, shops): a fogged continuation of the
    // opening's own floor and ceiling heights, ray-traced per pixel behind the opening (no geometry, no
    // layout claims), so it reads as "the station continues" with parallax instead of a flat bright wall.
    portal_beyond: beyondMaterial(THREE),
  };

  return {
    byRole,
    setLightmap(t, intensity) {
      for (const m of lit) {
        m.lightMap = t;
        m.lightMapIntensity = intensity;
        m.needsUpdate = true;
      }
    },
    dispose() {
      for (const m of new Set(Object.values(byRole))) m.dispose();
      for (const t of tex) t.dispose();
    },
  };
}
