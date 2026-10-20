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

/** 600 mm porcelain tiles, warm light grey, slight per-tile tone shift, thin grout. */
function floorPaint(rough: boolean): Paint {
  return (g, size, rnd) => {
    const tiles = 4; // 2.4 m canvas
    const t = size / tiles;
    for (let i = 0; i < tiles; i++)
      for (let j = 0; j < tiles; j++) {
        const v = rnd() * 10 - 5;
        g.fillStyle = rough ? `rgb(${88 + v * 2},0,0)` : `rgb(${196 + v},${191 + v},${182 + v})`;
        g.fillRect(i * t, j * t, t, t);
      }
    if (!rough) speckle(g, size, rnd, 9000, 0.25, "#efe9df", "#8f877c");
    g.fillStyle = rough ? "rgb(210,0,0)" : "#8e877d";
    for (let i = 0; i <= tiles; i++) {
      g.fillRect(i * t - 1.5, 0, 3, size);
      g.fillRect(0, i * t - 1.5, size, 3);
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
  g.fillStyle = "#a7a49d";
  for (let i = 0; i <= 2; i++) g.fillRect(i * w - 2, 0, 4, size);
  for (let j = 0; j <= 4; j++) g.fillRect(0, j * h - 1.5, size, 3);
};

/** 600 mm ceiling panels with darker T-bar grid. */
const ceilingPaint: Paint = (g, size, rnd) => {
  g.fillStyle = "#d6d6d2";
  g.fillRect(0, 0, size, size);
  speckle(g, size, rnd, 4000, 0.12, "#ffffff", "#9a9a96");
  g.fillStyle = "#8d8d89";
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
  grd.addColorStop(0, "#d9dadc");
  grd.addColorStop(0.5, "#eceef0");
  grd.addColorStop(1, "#d3d5d8");
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
    ceiling: std({ map: ceilMap, roughness: 0.85, side: THREE.DoubleSide }),
    stairs_ramps: std({ map: stairMap, roughness: 0.7 }),
    barriers: std({ map: colMap, roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide }),
    floor_elements: std({ color: 0x9b958c, roughness: 0.6 }),
    transport: std({ color: 0x3b3f45, roughness: 0.3, metalness: 0.8 }),
    windows: std({ map: shopMap, emissiveMap: shopMap, emissive: 0xffffff, emissiveIntensity: 1.15, roughness: 0.15, side: THREE.DoubleSide }, false),
    doors: std({ map: shopMap, emissiveMap: shopMap, emissive: 0xffffff, emissiveIntensity: 1.35, roughness: 0.2, side: THREE.DoubleSide }, false),
    light_fixtures: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.97, 0.92).multiplyScalar(4) }),
    // Openings to the street at the top of exit stairs: daylight.
    portal_sky: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.86, 0.92, 1.0).multiplyScalar(3.2), side: THREE.DoubleSide }),
    // Openings into spaces the open data does not model (fare areas, shops): soft dim glow, never a solid wall.
    portal_beyond: new THREE.MeshBasicMaterial({ color: 0x4a4740, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
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
