/**
 * Procedural canvas textures — all original, generated at runtime (no third-party imagery).
 */
import * as THREE from "three";
import { OEDO_MAGENTA } from "./palette.ts";

/** #342 Q0: the pinned Noto Sans JP subset (registered by the explorer's loadSignFont), then system fallbacks. */
export const SIGN_FONT_STACK = "'GTEki Sign JP','Hiragino Sans','Noto Sans JP','Yu Gothic',sans-serif";
export const IDENTITY_FONT_STACK = SIGN_FONT_STACK;

/** Full-resolution canvas coordinates, also used by the CPU projection proxy.
 * Conservative ink/cap-height assumptions: Japanese 0.80 em; Latin capitals 0.72 em.
 * These are font-dependent assumptions, not a raster measurement of the fallback font.
 */
export const IDENTITY_ART = {
  width: 1024, height: 512,
  ja: { text: "新宿", x: 72, baseline: 198, fontSize: 184, capFraction: 0.80, inkWidth: 368 },
  kana: { text: "しんじゅく", x: 76, baseline: 292, fontSize: 64 },
  en: { text: "Shinjuku", x: 72, baseline: 405, fontSize: 112, capFraction: 0.72, inkWidth: 560 },
  name: { left: 60, top: 40, right: 964, bottom: 432 },
} as const;

/** Original GTEki typography; plain code/line name, no operator badge or copied layout. */
export function identityTexture(quality: "low" | "high") {
  const scale = quality === "high" ? 1 : 0.5;
  const [c, g] = canvas(IDENTITY_ART.width * scale, IDENTITY_ART.height * scale);
  g.scale(scale, scale);
  g.fillStyle = "#f6f2e9";
  g.fillRect(0, 0, IDENTITY_ART.width, IDENTITY_ART.height);
  g.fillStyle = OEDO_MAGENTA; // GTEki-defined, not official (OD-29); line text below.
  g.fillRect(24, 48, 12, 380);
  g.fillStyle = "#20242b";
  g.textBaseline = "alphabetic";
  for (const row of [IDENTITY_ART.ja, IDENTITY_ART.kana, IDENTITY_ART.en]) {
    g.font = `700 ${row.fontSize}px ${IDENTITY_FONT_STACK}`;
    g.fillText(row.text, row.x, row.baseline);
  }
  g.fillStyle = "#555961";
  g.fillRect(72, 440, 880, 2);
  g.font = `600 48px ${IDENTITY_FONT_STACK}`;
  // Line colour sits beside the line name it stands for (#342 ruling 3).
  g.fillStyle = OEDO_MAGENTA;
  g.fillRect(72, 457, 36, 36);
  g.fillStyle = "#555961";
  g.fillText("E27  都営大江戸線", 124, 493);
  const texture = new THREE.CanvasTexture(c);
  texture.name = "GTEki Shinjuku identity (original design)";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = quality === "high" ? 8 : 4;
  return texture;
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function finish(c: HTMLCanvasElement, repeat: number, aniso = 8, color = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Large-format porcelain tiles (grid of `n`×`n` per texture), subtle speckle + per-tile tone. */
export function tileTextures(opts: { base: string; grout: string; n: number; seed: number; speckle?: number }) {
  const S = 1024;
  const [c, g] = canvas(S, S);
  const [rc, rg] = canvas(S, S);
  const [bc, bg] = canvas(S, S);
  bg.fillStyle = "#b8b8b8";
  bg.fillRect(0, 0, S, S);
  const r = rng(opts.seed);
  const cell = S / opts.n;
  const base = new THREE.Color(opts.base);
  for (let i = 0; i < opts.n; i++)
    for (let j = 0; j < opts.n; j++) {
      const k = 0.94 + r() * 0.1;
      const col = base.clone().multiplyScalar(k);
      g.fillStyle = `#${col.getHexString()}`;
      g.fillRect(i * cell, j * cell, cell, cell);
      const rough = 172 + r() * 26;
      rg.fillStyle = `rgb(${rough},${rough},${rough})`;
      rg.fillRect(i * cell, j * cell, cell, cell);
    }
  // speckle
  const sp = opts.speckle ?? 0.05;
  // Fine mineral grain: many small, low-contrast flecks read as granite at floor scale.
  for (let i = 0; i < S * S * 0.026; i++) {
    const x = r() * S;
    const y = r() * S;
    const v = r();
    const size = r() > 0.94 ? 2 : 1;
    g.fillStyle = v > 0.56
      ? `rgba(244,239,229,${sp * 0.8})`
      : v > 0.34
        ? `rgba(132,126,115,${sp * 0.65})`
        : `rgba(25,25,25,${sp * 0.9})`;
    g.fillRect(x, y, size, size);
    bg.fillStyle = v > 0.5 ? "rgba(235,235,235,0.18)" : "rgba(40,40,40,0.18)";
    bg.fillRect(x, y, size, size);
  }
  // grout lines
  g.strokeStyle = opts.grout;
  g.lineWidth = 1.5;
  rg.strokeStyle = "rgb(205,205,205)";
  rg.lineWidth = 1;
  bg.strokeStyle = "#383838";
  bg.lineWidth = 1.5;
  for (let i = 0; i <= opts.n; i++) {
    for (const ctx of [g, rg, bg]) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, S);
      ctx.moveTo(0, i * cell);
      ctx.lineTo(S, i * cell);
      ctx.stroke();
    }
  }
  return { map: finish(c, 1), roughnessMap: finish(rc, 1, 8, false), bumpMap: finish(bc, 1, 8, false) };
}

/** Yellow tactile paving: linear (guidance) bars. */
export function tactileTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = "#e8b81c";
  g.fillRect(0, 0, S, S);
  const grad = (x: number, w: number) => {
    const gr = g.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, "#b88a0a");
    gr.addColorStop(0.5, "#ffd84a");
    gr.addColorStop(1, "#b88a0a");
    return gr;
  };
  for (let i = 0; i < 4; i++) {
    const x = 16 + i * 60;
    g.fillStyle = grad(x, 34);
    g.beginPath();
    g.roundRect(x, 10, 34, S - 20, 17);
    g.fill();
  }
  g.strokeStyle = "rgba(0,0,0,0.25)";
  g.lineWidth = 4;
  g.strokeRect(0, 0, S, S);
  return finish(c, 1);
}

/** Wall cladding: enamel panels with vertical joints and an accent stripe band. */
export function wallTexture(accent: string) {
  const W = 512;
  const H = 512;
  const [c, g] = canvas(W, H);
  const [bc, bg] = canvas(W, H);
  const [rc, rg] = canvas(W, H);
  bg.fillStyle = "#a9a9a9";
  bg.fillRect(0, 0, W, H);
  rg.fillStyle = "#bebebe";
  rg.fillRect(0, 0, W, H);
  // lower kick zone (dark), upper panels (light)
  g.fillStyle = "#e8e3d9";
  g.fillRect(0, 0, W, H);
  const lowerTop = H * (1 - 1.05 / 3.2);
  g.fillStyle = "#63645e";
  g.fillRect(0, lowerTop, W, H - lowerTop);
  // accent stripe ~2.35 m
  const stripeY = H * (1 - 2.35 / 3.2);
  g.fillStyle = accent;
  g.fillRect(0, stripeY, W, H * (0.09 / 3.2));
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.fillRect(0, stripeY, W, 2);
  // panel joints every 1.2 m (texture spans 2.4 m)
  g.strokeStyle = "rgba(69,64,57,0.2)";
  g.lineWidth = 2;
  for (const x of [0, W / 2]) {
    g.beginPath();
    g.moveTo(x + 1, 0);
    g.lineTo(x + 1, H);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(0, lowerTop);
  g.lineTo(W, lowerTop);
  g.stroke();
  for (const x of [0, W / 2]) {
    bg.fillStyle = "#303030";
    bg.fillRect(x, 0, 2, H);
    rg.fillStyle = "#f2f2f2";
    rg.fillRect(x, 0, 3, H);
    g.fillStyle = "rgba(255,255,255,0.3)";
    g.fillRect(x + 2, 0, 1, H);
  }
  bg.fillStyle = "#444444";
  bg.fillRect(0, lowerTop, W, 2);
  const noise = rng(53);
  for (let i = 0; i < 2200; i++) {
    const v = 175 + Math.floor(noise() * 35);
    rg.fillStyle = `rgb(${v},${v},${v})`;
    rg.fillRect(noise() * W, noise() * H, 2, 2);
  }
  const t = finish(c, 1);
  t.repeat.set(1, 1);
  return { map: t, bumpMap: finish(bc, 1, 8, false), roughnessMap: finish(rc, 1, 8, false) };
}

export function ceilingTexture() {
  const S = 512;
  const [c, g] = canvas(S, S);
  const [bc, bg] = canvas(S, S);
  const [rc, rg] = canvas(S, S);
  g.fillStyle = "#b9bab8";
  g.fillRect(0, 0, S, S);
  bg.fillStyle = "#a5a5a5";
  bg.fillRect(0, 0, S, S);
  rg.fillStyle = "#c9c9c9";
  rg.fillRect(0, 0, S, S);
  g.strokeStyle = "rgba(38,38,36,0.2)";
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath();
    g.moveTo((i * S) / 4, 0);
    g.lineTo((i * S) / 4, S);
    g.moveTo(0, (i * S) / 4);
    g.lineTo(S, (i * S) / 4);
    g.stroke();
    bg.fillStyle = "#555654";
    bg.fillRect((i * S) / 4 - 1, 0, 2, S);
    bg.fillRect(0, (i * S) / 4 - 1, S, 2);
  }
  // Subtle longitudinal service slot, repeated every two ceiling panels.
  g.fillStyle = "#5b5d5a";
  g.fillRect(0, 0, 3, S);
  g.fillRect(S / 2 - 1, 0, 3, S);
  g.fillRect(S - 3, 0, 3, S);
  // Recessed access hatch and small latch: generic maintenance detail, not a facility claim.
  g.strokeStyle = "#a4aaac";
  g.lineWidth = 3;
  g.strokeRect(265, 265, 108, 108);
  bg.strokeStyle = "#555555";
  bg.lineWidth = 3;
  bg.strokeRect(265, 265, 108, 108);
  g.fillStyle = "#80888a";
  g.fillRect(355, 316, 6, 12);
  const r = rng(7);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.03})`;
    g.fillRect(r() * S, r() * S, 1, 1);
    const v = 205 + Math.floor(r() * 32);
    rg.fillStyle = `rgb(${v},${v},${v})`;
    rg.fillRect(r() * S, r() * S, 2, 2);
  }
  return { map: finish(c, 1), bumpMap: finish(bc, 1, 8, false), roughnessMap: finish(rc, 1, 8, false) };
}

export type SignIcon = "exit" | "train" | "gate" | "elevator" | "toilet" | "none" | "nomap";

/** Original wayfinding sign graphic (GTEki design; not a reproduction of operator signage). */
export const SIGN_ROW_HEIGHT = 128;

export function signTexture(lines: { arrow?: "left" | "right" | "up" | "down" | "upLeft" | "upRight" | null; icon: SignIcon; ja: string; en: string; tone: "exit" | "dark" | "line" | "warn" }[], widthPx = 1024) {
  const rowH = SIGN_ROW_HEIGHT;
  const H = rowH * lines.length;
  const [c, g] = canvas(widthPx, H);
  lines.forEach((l, i) => {
    const y0 = i * rowH;
    // Warnings are light notice panels: a near-black board reads as a hole once a camera is close.
    const light = l.tone === "exit" || l.tone === "warn";
    const bg = l.tone === "exit" ? "#f4c81a" : l.tone === "warn" ? "#ecebe6" : "#1d1f22";
    const fg = light ? "#121212" : "#ffffff";
    g.fillStyle = bg;
    g.fillRect(0, y0, widthPx, rowH);
    if (i > 0) {
      g.fillStyle = light ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.18)";
      g.fillRect(0, y0, widthPx, 2);
    }
    let x = 24;
    // icon tile
    if (l.icon !== "none") {
      g.fillStyle = light ? "#121212" : l.icon === "train" ? OEDO_MAGENTA : "#ffffff";
      g.beginPath();
      g.roundRect(x, y0 + 14, 100, 100, 12);
      g.fill();
      drawIcon(g, l.icon, x, y0 + 14, 100, light ? bg : l.icon === "train" ? "#ffffff" : "#1d1f22");
      x += 124;
    }
    g.fillStyle = fg;
    g.textBaseline = "alphabetic";
    g.font = `700 54px ${SIGN_FONT_STACK}`;
    g.fillText(l.ja, x, y0 + 66);
    g.font = "600 34px 'GTEki Sign JP','Helvetica Neue','Inter','Arial',sans-serif";
    g.globalAlpha = 0.9;
    g.fillText(l.en, x, y0 + 108);
    g.globalAlpha = 1;
    if (l.arrow) drawArrow(g, l.arrow, widthPx - 124, y0 + 14, 100, fg);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { texture: t, aspect: widthPx / H };
}

function drawArrow(g: CanvasRenderingContext2D, dir: string, x: number, y: number, s: number, col: string) {
  const ang = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2, upLeft: (-3 * Math.PI) / 4, upRight: -Math.PI / 4 }[dir] ?? 0;
  g.save();
  g.translate(x + s / 2, y + s / 2);
  g.rotate(ang);
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(-s * 0.38, -s * 0.11);
  g.lineTo(s * 0.05, -s * 0.11);
  g.lineTo(s * 0.05, -s * 0.3);
  g.lineTo(s * 0.42, 0);
  g.lineTo(s * 0.05, s * 0.3);
  g.lineTo(s * 0.05, s * 0.11);
  g.lineTo(-s * 0.38, s * 0.11);
  g.closePath();
  g.fill();
  g.restore();
}

function drawIcon(g: CanvasRenderingContext2D, icon: SignIcon, x: number, y: number, s: number, col: string) {
  g.save();
  g.translate(x, y);
  g.fillStyle = col;
  g.strokeStyle = col;
  g.lineWidth = s * 0.07;
  g.lineCap = "round";
  g.lineJoin = "round";
  const u = s / 100;
  if (icon === "exit") {
    // door + walking figure
    g.strokeRect(58 * u, 18 * u, 26 * u, 66 * u);
    g.beginPath();
    g.arc(36 * u, 24 * u, 7 * u, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(34 * u, 34 * u);
    g.lineTo(30 * u, 56 * u);
    g.lineTo(42 * u, 68 * u);
    g.lineTo(44 * u, 84 * u);
    g.moveTo(30 * u, 56 * u);
    g.lineTo(20 * u, 70 * u);
    g.lineTo(14 * u, 82 * u);
    g.moveTo(33 * u, 40 * u);
    g.lineTo(46 * u, 50 * u);
    g.lineTo(56 * u, 46 * u);
    g.moveTo(33 * u, 40 * u);
    g.lineTo(22 * u, 48 * u);
    g.stroke();
  } else if (icon === "train") {
    g.beginPath();
    g.roundRect(24 * u, 14 * u, 52 * u, 60 * u, 14 * u);
    g.fill();
    g.fillStyle = OEDO_MAGENTA;
    g.fillRect(31 * u, 24 * u, 38 * u, 20 * u);
    g.beginPath();
    g.arc(36 * u, 60 * u, 5 * u, 0, Math.PI * 2);
    g.arc(64 * u, 60 * u, 5 * u, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = col;
    g.beginPath();
    g.moveTo(32 * u, 78 * u);
    g.lineTo(22 * u, 90 * u);
    g.moveTo(68 * u, 78 * u);
    g.lineTo(78 * u, 90 * u);
    g.stroke();
  } else if (icon === "gate") {
    for (const gx of [18, 44, 70]) g.fillRect(gx * u, 34 * u, 12 * u, 50 * u);
    g.fillRect(14 * u, 30 * u, 72 * u, 8 * u);
    g.beginPath();
    g.moveTo(30 * u, 58 * u);
    g.lineTo(44 * u, 58 * u);
    g.moveTo(56 * u, 58 * u);
    g.lineTo(70 * u, 58 * u);
    g.stroke();
  } else if (icon === "elevator") {
    g.strokeRect(20 * u, 14 * u, 60 * u, 72 * u);
    g.beginPath();
    g.moveTo(50 * u, 14 * u);
    g.lineTo(50 * u, 86 * u);
    g.stroke();
    g.beginPath();
    g.moveTo(35 * u, 30 * u);
    g.lineTo(28 * u, 40 * u);
    g.lineTo(42 * u, 40 * u);
    g.closePath();
    g.moveTo(65 * u, 40 * u);
    g.lineTo(58 * u, 30 * u);
    g.lineTo(72 * u, 30 * u);
    g.closePath();
    g.fill();
  } else if (icon === "toilet") {
    g.beginPath();
    g.arc(30 * u, 22 * u, 7 * u, 0, Math.PI * 2);
    g.arc(70 * u, 22 * u, 7 * u, 0, Math.PI * 2);
    g.fill();
    g.fillRect(23 * u, 32 * u, 14 * u, 30 * u);
    g.fillRect(25 * u, 62 * u, 4 * u, 24 * u);
    g.fillRect(31 * u, 62 * u, 4 * u, 24 * u);
    g.beginPath();
    g.moveTo(70 * u, 32 * u);
    g.lineTo(58 * u, 66 * u);
    g.lineTo(82 * u, 66 * u);
    g.closePath();
    g.fill();
    g.fillRect(65 * u, 66 * u, 4 * u, 20 * u);
    g.fillRect(71 * u, 66 * u, 4 * u, 20 * u);
    g.fillRect(49 * u, 14 * u, 2 * u, 72 * u);
  } else if (icon === "nomap") {
    g.beginPath();
    g.arc(50 * u, 50 * u, 32 * u, 0, Math.PI * 2);
    g.stroke();
    g.font = `800 ${46 * u}px sans-serif`;
    g.textAlign = "center";
    g.fillText("?", 50 * u, 66 * u);
  }
  g.restore();
}
