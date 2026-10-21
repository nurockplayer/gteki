// Procedural surface materials for the Ikebukuro B1 passages.
// Everything is generated at runtime on a canvas, so no third-party texture
// rights are involved. Textures assume UV0 is metric (1 unit = 1 m), which the
// Blender build guarantees (box projection).
import type * as THREE_NS from "three";
type ThreeNS = typeof THREE_NS;

type Paint = (g: CanvasRenderingContext2D, size: number, rnd: () => number) => void;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvasTexture(THREE: ThreeNS, size: number, metres: number, paint: Paint, seed: number, srgb = true) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  paint(g, size, rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / metres, 1 / metres);
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
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

/** 600 mm porcelain tiles, light grey, slight per-tile tone shift, thin grout. Rough variant is greyscale (three reads roughnessMap.g). */
function floorPaint(rough: boolean): Paint {
  return (g, size, rnd) => {
    const tiles = 4; // 2.4 m canvas
    const t = size / tiles;
    for (let i = 0; i < tiles; i++)
      for (let j = 0; j < tiles; j++) {
        const v = rnd() * 10 - 5;
        g.fillStyle = rough ? `rgb(${88 + v * 2},${88 + v * 2},${88 + v * 2})` : `rgb(${204 + v},${203 + v},${198 + v})`;
        g.fillRect(i * t, j * t, t, t);
      }
    if (!rough) speckle(g, size, rnd, 9000, 0.18, "#f2f1ec", "#97948d");
    g.fillStyle = rough ? "rgb(210,210,210)" : "#adaaa3";
    for (let i = 0; i <= tiles; i++) {
      g.fillRect(i * t - 1, 0, 2, size);
      g.fillRect(0, i * t - 1, size, 2);
    }
  };
}

/** Enamel wall panels 1.2 m x 0.6 m with recessed seams. */
const wallPaint: Paint = (g, size, rnd) => {
  // canvas = 2.4 m x 2.4 m: 2 panels across, 4 rows
  g.fillStyle = "#e3e1db";
  g.fillRect(0, 0, size, size);
  const w = size / 2, h = size / 4;
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 4; j++) {
      const v = rnd() * 6 - 3;
      g.fillStyle = `rgb(${226 + v},${224 + v},${218 + v})`;
      g.fillRect(i * w + 2, j * h + 2, w - 4, h - 4);
    }
  g.fillStyle = "#c2bfb8";
  for (let i = 0; i <= 2; i++) g.fillRect(i * w - 1.5, 0, 3, size);
  for (let j = 0; j <= 4; j++) g.fillRect(0, j * h - 1, size, 2);
};

/** 600 mm ceiling panels with darker T-bar grid. */
const ceilingPaint: Paint = (g, size, rnd) => {
  g.fillStyle = "#e1e3e4";
  g.fillRect(0, 0, size, size);
  speckle(g, size, rnd, 4000, 0.1, "#f4f5f6", "#b4b6b8");
  g.fillStyle = "#b9bcbe";
  const t = size / 4;
  for (let i = 0; i <= 4; i++) {
    g.fillRect(i * t - 2, 0, 4, size);
    g.fillRect(0, i * t - 2, size, 4);
  }
};

/** Granite-like stair treads. */
const stairPaint: Paint = (g, size, rnd) => {
  g.fillStyle = "#77736d";
  g.fillRect(0, 0, size, size);
  speckle(g, size, rnd, 14000, 0.5, "#b9b4ab", "#3f3c38");
};

/** Columns / partitions: satin off-white with a stainless kick band look. */
const columnPaint: Paint = (g, size, rnd) => {
  const grd = g.createLinearGradient(0, 0, size, 0);
  grd.addColorStop(0, "#c2c6ca");
  grd.addColorStop(0.5, "#d3d7db");
  grd.addColorStop(1, "#bdc1c5");
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  speckle(g, size, rnd, 2500, 0.08, "#ffffff", "#777777");
};

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

function beyondMaterial(THREE: ThreeNS) {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 band;\nvarying vec2 vBand;\nvarying vec3 vWorldP;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvBand = band;\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vBand;\nvarying vec3 vWorldP;")
      .replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        // cameraPosition is not uploaded for basic materials; recover the eye from the view matrix.
        `vec3 eye = -transpose(mat3(viewMatrix)) * viewMatrix[3].xyz;
        vec3 rd = normalize(vWorldP - eye);
        vec3 fogc = vec3(0.15, 0.145, 0.135); // lightmapped surfaces sit at ~0.1-0.25 linear before ACES
        vec3 col = fogc;
        float t = 1e3;
        // Renderer y is TP height; x/z are metric, so the floor tile and fixture grids match the station's.
        if (rd.y < -0.01) {
          t = (vBand.x - vWorldP.y) / rd.y;
          vec3 h = vWorldP + rd * t;
          vec2 q = h.xz / 0.6, w = fwidth(q);
          vec2 f = fract(q);
          float grout = 1.0 - smoothstep(0.035, 0.035 + w.x, f.x) * smoothstep(0.035, 0.035 + w.y, f.y);
          grout *= 1.0 - smoothstep(0.1, 0.4, max(w.x, w.y)); // no shimmer where tiles get sub-pixel
          col = mix(vec3(0.27, 0.26, 0.245), vec3(0.17, 0.165, 0.155), grout * exp(-t / 5.0));
        } else if (rd.y > 0.01) {
          t = (vBand.y - vWorldP.y) / rd.y;
          vec3 h = vWorldP + rd * t;
          vec2 q = h.xz / vec2(2.4, 3.0), w = fwidth(q);
          vec2 f = abs(fract(q) - 0.5);
          float lamp = (1.0 - smoothstep(0.07, 0.07 + w.x, f.x)) * (1.0 - smoothstep(0.32, 0.32 + w.y, f.y));
          lamp *= (1.0 - smoothstep(0.03, 0.12, max(w.x, w.y))) * exp(-t / 8.0); // grazing rays: fade, never streak
          col = mix(vec3(0.06, 0.058, 0.055), vec3(1.6, 1.55, 1.45), lamp);
        }
        col = mix(col, fogc, 1.0 - exp(-max(t, 0.0) / 10.0));
        vec4 diffuseColor = vec4(col * diffuse, opacity);`,
      );
  };
  m.customProgramCacheKey = () => "gteki-ikebukuro-beyond-4";
  return m;
}

export interface StationMaterials {
  byRole: Record<string, THREE_NS.Material>;
  setLightmap(tex: THREE_NS.Texture | null, intensity: number): void;
  dispose(): void;
}

export function createMaterials(THREE: ThreeNS, mobile: boolean): StationMaterials {
  const size = mobile ? 512 : 1024;
  const floorMap = canvasTexture(THREE, size, 2.4, floorPaint(false), 11);
  const floorRough = canvasTexture(THREE, size / 2, 2.4, floorPaint(true), 11, false);
  const wallMap = canvasTexture(THREE, size / 2, 2.4, wallPaint, 23);
  const ceilMap = canvasTexture(THREE, size / 2, 2.4, ceilingPaint, 31);
  const stairMap = canvasTexture(THREE, size / 2, 1.2, stairPaint, 41);
  const colMap = canvasTexture(THREE, 256, 1.2, columnPaint, 53);
  const shopMap = canvasTexture(THREE, 256, 2.4, shopPaint, 61);

  const lit: THREE_NS.MeshStandardMaterial[] = [];
  const std = (p: THREE_NS.MeshStandardMaterialParameters, baked = true) => {
    const m = new THREE.MeshStandardMaterial(p);
    if (baked) lit.push(m);
    return m;
  };
  const byRole: Record<string, THREE_NS.Material> = {
    floor: std({ map: floorMap, roughnessMap: floorRough, roughness: 1, metalness: 0, envMapIntensity: 0.6 }),
    wall: std({ map: wallMap, roughness: 0.42, metalness: 0, side: THREE.DoubleSide }),
    ceiling: std({ map: ceilMap, roughness: 0.95, side: THREE.DoubleSide }),
    stairs_ramps: std({ map: stairMap, roughness: 0.7 }),
    barriers: std({ map: colMap, roughness: 0.32, metalness: 0.15, side: THREE.DoubleSide }),
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
    setLightmap(tex, intensity) {
      for (const m of lit) {
        m.lightMap = tex;
        m.lightMapIntensity = intensity;
        m.needsUpdate = true;
      }
    },
    dispose() {
      for (const m of Object.values(byRole)) m.dispose();
      for (const t of [floorMap, floorRough, wallMap, ceilMap, stairMap, colMap, shopMap]) t.dispose();
    },
  };
}
