// Shopfront kit, batch 4 (#209): the Lane E shopfront GLBs placed in the surveyed PLATEAU door and window panels of
// scene/shop_openings.json, under the curated shops of scene/shop_placements.json. Presentation only, same rules as
// kit.ts: a shopfront never enters `walkable`, `colliders` or the walk graph, and the PLATEAU panel stays as it is.
// kind=placeholder shops are 示意店面 (illustrative, generic category text in our own words); kind=real shops carry a
// printed tie but are still visual only: no connector, node, coordinate or distance on the facade.
//
// Scaling. A row gets `n = max(1, round(width / bay_m))` bays side by side, each the piece scaled by `sx` along its
// front; the piece's glass top lands on the row's measured height (`sy = clamp(height / glass_top_m, 0.9, 1.15)`), so
// the fascia sits on the wall above the opening. A row lower than 1.8 m keeps its PLATEAU texture. The piece's local
// +X runs along the row's wall and its +Z (the depth 0..0.14, front face) along the wall normal, with the back plane
// 0.01 m in front of the opening plane.
//
// Signs are plain text in the GTEki sign font, one quad per shop on the widest placed row's fascia: no logo, image or
// brand artwork. All quads share one canvas atlas and one unlit material (lit from within): one draw call.
import type * as THREE_NS from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { SceneContext } from "@gteki/scene-api";
import { KIT_ENV_INTENSITY, type KitManifest, mergeByMaterial, pieceUri, tileGroups, tileSize, visibleParts } from "./kit.ts";
import { FONT } from "./signs.ts";
type ThreeNS = typeof THREE_NS;

export type Front = "glazing" | "door_glazing" | "open" | "shutter_half";

/** One entry of scene/shop_openings.json `openings[]`. */
export interface Opening {
  type: "Door" | "Window";
  opening_id: string;
  polygon_ids: string[];
  base_z: number;
  height: number;
  width: number;
  centre: [number, number, number];
  /** Counter-clockwise from +X seen from above (ENU), of the wall normal pointing toward the walk. */
  normal_deg: number;
  nearest_edge: string | null;
  edge_distance_m: number;
}

/** One entry of scene/shop_placements.json `shops[]`. A real shop carries its POI and sources; a placeholder does not. */
export interface Shop {
  id: string;
  kind: "real" | "placeholder";
  poiId?: string;
  openings: string[];
  front: Front;
  sign: { ja: string; en: string };
  accent: string;
  display: string;
  position_basis?: string;
  sourceIds?: string[];
  field_check?: string;
  ruling?: string;
}

/** The kit's shopfront uses: one piece id per role the shop fronts ask for. */
export const SHOP_USE = {
  glazing: "shopfront_glazing",
  door: "shopfront_door",
  shutterHalf: "shopfront_shutter_half",
} as const;

/** A row lower than this keeps its PLATEAU texture (no room for the fascia above the opening). */
export const MIN_SHOP_ROW_M = 1.8;
/** The piece's back plane stands this far in front of the opening plane (m). */
export const SHOP_BACK_OFFSET_M = 0.01;
/** The sign quad stands this far in front of the opening plane (m; the fascia face is at 0.128). */
export const SIGN_OFFSET_M = 0.148;
export const SIGN_HEIGHT_M = 0.5;
export const SIGN_MAX_WIDTH_M = 4.8;
/** Height of the fascia band above the glass top (m), in the piece's own frame. */
export const FASCIA_BAND_M = 0.6;

export interface ShopPieceSpec {
  /** The kit use this piece answers (SHOP_USE values). */
  use: string;
  /** Nominal bay width along the front (m): kit.json `bay_m`. */
  bay_m: number;
  height_m: number;
  glass_top_m: number;
}

export interface ShopPlacement {
  shop: string;
  /** `Opening.opening_id` the bay dresses. */
  row: string;
  /** First polygon id uniquely identifies the surveyed row. */
  polygon: string;
  piece: string;
  /** Bay centre on the floor, ENU metres. */
  x: number;
  y: number;
  z: number;
  /** Rotation of the piece's +X about up, degrees counter-clockwise seen from above (same angle in ENU and renderer). */
  yawDeg: number;
  sx: number;
  sy: number;
  sz: number;
}

export interface ShopSign {
  shop: string;
  ja: string;
  en: string;
  accent: string;
  /** Quad centre, ENU metres. */
  x: number;
  y: number;
  z: number;
  yawDeg: number;
  width: number;
  height: number;
}

// Desktop GLB reveal bounds, shared by both tiers when low merges the backing into its palette.
const INTERIOR_RECTS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  [SHOP_USE.glazing]: [-1.17, 1.17, 0.33, 2.13],
  [SHOP_USE.door]: [-0.93, 0.93, 0.01, 2.1],
  [SHOP_USE.shutterHalf]: [-1.11, 1.11, 0, 1.95],
};

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The shopfront uses a kit manifest names, by id, with the bay width and height their placements scale from. */
export function shopPieces(kit: Pick<KitManifest, "pieces">): Record<string, ShopPieceSpec> {
  const out: Record<string, ShopPieceSpec> = {};
  for (const [id, p] of Object.entries(kit.pieces)) {
    const q = p as { use?: string; bay_m?: number; height_m?: number; glass_top_m?: number };
    if (!q.use?.startsWith("shopfront_") || typeof q.bay_m !== "number" || typeof q.height_m !== "number" || typeof q.glass_top_m !== "number") continue;
    out[id] = { use: q.use, bay_m: q.bay_m, height_m: q.height_m, glass_top_m: q.glass_top_m };
  }
  return out;
}

/** The piece role a shop front asks for on a Door or Window row. */
export function shopFrontUse(front: Front, type: Opening["type"]): string {
  switch (front) {
    case "glazing": return SHOP_USE.glazing;
    case "door_glazing": return type === "Door" ? SHOP_USE.door : SHOP_USE.glazing;
    case "open": return SHOP_USE.door;
    case "shutter_half": return SHOP_USE.shutterHalf;
  }
}

/** The piece id and spec that answer a use, lowest id first when a use is listed twice. */
function pieceFor(use: string, pieces: Readonly<Record<string, ShopPieceSpec>>): [string, ShopPieceSpec] | null {
  for (const id of Object.keys(pieces).sort()) if (pieces[id]!.use === use) return [id, pieces[id]!];
  return null;
}

/** The opening row a shop lists by its first polygon id (the extractor welds every panel of an opening). */
const rowOf = (openings: readonly Opening[], polygon: string) => openings.find((o) => o.polygon_ids[0] === polygon);

/**
 * Pure: the shopfront bays per opening row a shop lists, in shop then row then bay order. A row missing from
 * `openings`, below MIN_SHOP_ROW_M, or whose piece is not in `pieces` gets nothing (it keeps its PLATEAU texture).
 */
export function shopPlacements(
  shops: readonly Shop[],
  openings: readonly Opening[],
  pieces: Readonly<Record<string, ShopPieceSpec>>,
): ShopPlacement[] {
  const out: ShopPlacement[] = [];
  for (const shop of shops) {
    for (const polygon of shop.openings) {
      const row = rowOf(openings, polygon);
      if (!row || row.height < MIN_SHOP_ROW_M) continue;
      const found = pieceFor(shopFrontUse(shop.front, row.type), pieces);
      if (!found) continue;
      const [piece, spec] = found;
      const n = Math.max(1, Math.round(row.width / spec.bay_m));
      const sx = row.width / (n * spec.bay_m);
      const sy = clamp(row.height / spec.glass_top_m, 0.9, 1.15);
      // Local +X along the wall, local +Z along the wall normal.
      const yawDeg = (row.normal_deg + 90) % 360;
      const ux = Math.cos(yawDeg * DEG), uy = Math.sin(yawDeg * DEG);
      const nx = Math.cos(row.normal_deg * DEG), ny = Math.sin(row.normal_deg * DEG);
      const x = row.centre[0] + nx * SHOP_BACK_OFFSET_M, y = row.centre[1] + ny * SHOP_BACK_OFFSET_M;
      for (let k = 0; k < n; k++) {
        const t = (k - (n - 1) / 2) * spec.bay_m * sx;
        out.push({ shop: shop.id, row: row.opening_id, polygon, piece, x: x + ux * t, y: y + uy * t, z: row.base_z, yawDeg, sx, sy, sz: 1 });
      }
    }
  }
  return out;
}

/**
 * Pure: one sign per shop with non-empty `sign.ja`, on the fascia of its widest placed row (max 4.8 m wide less 0.1 m, 0.5 × sy m
 * tall, centred in the 0.6 m band above the glass top), 0.148 m in front of the opening plane.
 */
export function shopSigns(
  shops: readonly Shop[],
  openings: readonly Opening[],
  pieces: Readonly<Record<string, ShopPieceSpec>>,
): ShopSign[] {
  const out: ShopSign[] = [];
  for (const shop of shops) {
    if (!shop.sign.ja) continue;
    let best: { row: Opening; spec: ShopPieceSpec } | null = null;
    for (const polygon of shop.openings) {
      const row = rowOf(openings, polygon);
      if (!row || row.height < MIN_SHOP_ROW_M) continue;
      const found = pieceFor(shopFrontUse(shop.front, row.type), pieces);
      if (!found) continue;
      if (!best || row.width > best.row.width) best = { row, spec: found[1] };
    }
    if (!best) continue;
    const { row, spec } = best;
    const sy = clamp(row.height / spec.glass_top_m, 0.9, 1.15);
    out.push({
      shop: shop.id,
      ja: shop.sign.ja,
      en: shop.sign.en,
      accent: shop.accent,
      x: row.centre[0] + Math.cos(row.normal_deg * DEG) * SIGN_OFFSET_M,
      y: row.centre[1] + Math.sin(row.normal_deg * DEG) * SIGN_OFFSET_M,
      z: row.base_z + (spec.glass_top_m + FASCIA_BAND_M / 2) * sy,
      yawDeg: (row.normal_deg + 90) % 360,
      width: Math.min(SIGN_MAX_WIDTH_M, row.width) - 0.1,
      height: SIGN_HEIGHT_M * sy,
    });
  }
  return out;
}

/** Blade and board placements follow the widest drawable row, as the fascia sign does. */
export function shopBladeSigns(shops: readonly Shop[], openings: readonly Opening[], pieces: Readonly<Record<string, ShopPieceSpec>>): ShopSign[] {
  return shopSigns(shops, openings, pieces).flatMap((sign) => {
    const shop = shops.find((s) => s.id === sign.shop)!;
    const rows = shop.openings.map((p) => rowOf(openings, p)).filter((r): r is Opening => !!r && r.height >= MIN_SHOP_ROW_M && !!pieceFor(shopFrontUse(shop.front, r.type), pieces));
    const row = rows.reduce((a, b) => b.width > a.width ? b : a);
    const spec = pieceFor(shopFrontUse(shop.front, row.type), pieces)![1];
    const bottom = row.base_z + spec.glass_top_m * clamp(row.height / spec.glass_top_m, 0.9, 1.15);
    if (bottom < row.base_z + 2.2) return [];
    const yaw = (row.normal_deg + 90) * DEG, normal = row.normal_deg * DEG;
    return [{ ...sign, x: row.centre[0] + Math.cos(yaw) * row.width / 2 + Math.cos(normal) * 0.35,
      y: row.centre[1] + Math.sin(yaw) * row.width / 2 + Math.sin(normal) * 0.35,
      z: bottom + 0.45, yawDeg: sign.yawDeg + 90, width: 0.45, height: 0.9 }];
  });
}

export interface ShopBoard { shop: string; display: string; x: number; y: number; z: number; yawDeg: number }
export function shopABoards(shops: readonly Shop[], openings: readonly Opening[], pieces: Readonly<Record<string, ShopPieceSpec>>): ShopBoard[] {
  const out: ShopBoard[] = [];
  for (const shop of shops) {
    if (!["cafe", "bakery", "deli", "sweets"].includes(shop.display)) continue;
    const rows = shop.openings.map((p) => rowOf(openings, p)).filter((r): r is Opening => !!r && r.height >= MIN_SHOP_ROW_M && !!pieceFor(shopFrontUse(shop.front, r.type), pieces));
    if (!rows.length) continue;
    const row = rows.reduce((a, b) => b.width > a.width ? b : a);
    if (row.edge_distance_m < 2) continue;
    const yaw = (row.normal_deg + 90) * DEG, normal = row.normal_deg * DEG;
    out.push({ shop: shop.id, display: shop.display, x: row.centre[0] + Math.cos(yaw) * row.width * 0.3 + Math.cos(normal) * 0.6,
      y: row.centre[1] + Math.sin(yaw) * row.width * 0.3 + Math.sin(normal) * 0.6, z: row.base_z, yawDeg: (row.normal_deg + 90) % 360 });
  }
  return out;
}

/** WCAG relative luminance of a #rrggbb accent (0..1). */
export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const channel = (i: number) => {
    const c = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** Darken light accents for legible lettering on the pale sign face. */
export function signTextColour(accent: string): string {
  if (relativeLuminance(accent) <= 0.25) return accent;
  const rgb = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
  let scale = 1;
  let colour = accent;
  while (relativeLuminance(colour) > 0.25) {
    scale -= 0.01;
    colour = `#${rgb.map((c) => Math.round(c * scale).toString(16).padStart(2, "0")).join("")}`;
  }
  return colour;
}

export const SIGN_PX_PER_M = 320;
export const SIGN_GUTTER_PX = 8;

interface SignSlot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Paint one shelf-packed atlas page: every sign's accent panel and its fitted text. Never squeezes type. */
function paintSignAtlas(signs: readonly ShopSign[], pxPerM: number, bladeStart: number): { canvas: HTMLCanvasElement; slots: SignSlot[] } {
  const dims = signs.map((s) => ({ w: Math.max(1, Math.round(s.width * pxPerM)), h: Math.max(1, Math.round(s.height * pxPerM)) }));
  const width = Math.max(...dims.map((d) => d.w)) + 2 * SIGN_GUTTER_PX;
  const height = dims.reduce((n, d) => n + d.h + SIGN_GUTTER_PX, SIGN_GUTTER_PX);
  const page = document.createElement("canvas");
  page.width = width;
  page.height = height;
  const g = page.getContext("2d")!;
  const slots: SignSlot[] = [];
  let y = SIGN_GUTTER_PX;
  signs.forEach((sign, i) => {
    const slot = { x: SIGN_GUTTER_PX, y, w: dims[i]!.w, h: dims[i]!.h };
    slots.push(slot);
    y += slot.h + SIGN_GUTTER_PX;
    g.fillStyle = "#fbfaf7";
    g.fillRect(slot.x, slot.y, slot.w, slot.h);
    g.fillStyle = sign.accent;
    g.fillRect(slot.x, slot.y + slot.h * 0.88, slot.w, slot.h * 0.12);
    if (i >= bladeStart) {
      g.textAlign = "center"; g.textBaseline = "middle";
      const chars = [...sign.ja];
      const size = Math.min(slot.w * 0.7, slot.h * 0.75 / chars.length);
      g.font = `700 ${size}px ${FONT}`; g.fillStyle = signTextColour(sign.accent);
      chars.forEach((ch, n) => g.fillText(ch, slot.x + slot.w / 2, slot.y + slot.h * 0.08 + size * (n + 0.5)));
      return;
    }
    g.textAlign = "left";
    g.textBaseline = "middle";
    const jaSize = slot.h * 0.62, enSize = slot.h * 0.22;
    g.font = `700 ${jaSize}px ${FONT}`;
    const jaWidth = g.measureText(sign.ja).width;
    g.font = `500 ${enSize}px ${FONT}`;
    const enWidth = sign.en ? g.measureText(sign.en).width : 0;
    const gap = sign.en ? slot.h * 0.12 : 0;
    const scale = Math.min(1, slot.w * 0.88 / (jaWidth + gap + enWidth));
    const x = slot.x + (slot.w - (jaWidth + gap + enWidth) * scale) / 2;
    const textY = slot.y + slot.h * 0.44;
    g.fillStyle = signTextColour(sign.accent);
    g.font = `700 ${jaSize * scale}px ${FONT}`;
    g.fillText(sign.ja, x, textY);
    if (sign.en) {
      g.fillStyle = "#5b6168";
      g.font = `500 ${enSize * scale}px ${FONT}`;
      g.fillText(sign.en, x + (jaWidth + gap) * scale, textY);
    }
  });
  return { canvas: page, slots };
}

export interface ShopStats {
  /** Shops with a sign and at least one placed row. */
  shops: number;
  /** Placed bays (InstancedMesh instances). */
  modules: number;
  tiles: number;
  /** One draw per part per piece per tile (worst case: every tile in view). */
  drawCallsAllTiles: number;
  trianglesAllTiles: number;
  trianglesWorstTile: number;
  signs: number;
  signDrawCalls: number;
  signTriangles: number;
  interiorDrawCalls: number;
  interiorTriangles: number;
  spillDrawCalls: number;
  bladeSigns: number;
  aBoards: number;
}

export interface LoadedShopKit {
  /** Bays that will be drawn (empty when no piece loaded). */
  placements: readonly ShopPlacement[];
  signs: readonly ShopSign[];
  build(THREE: ThreeNS, env: THREE_NS.Texture, toRenderer: (x: number, y: number, z: number) => THREE_NS.Vector3): { group: THREE_NS.Group; stats: ShopStats };
  dispose(): void;
}

type Host = Pick<SceneContext, "assetUrl" | "loadGlb">;

/** Loads the shopfront pieces for this tier. Never throws: a piece that cannot be used drops its own rows only. */
export async function loadShopKit(
  THREE: ThreeNS,
  host: Host,
  kit: KitManifest,
  shops: readonly Shop[],
  openings: readonly Opening[],
  low: boolean,
): Promise<LoadedShopKit> {
  const pieces = shopPieces(kit);
  const wanted = shopPlacements(shops, openings, pieces);
  const needed = new Set(wanted.map((p) => p.piece));
  const assets = new Map<string, { gltf: GLTF; parts: ReturnType<typeof visibleParts> }>();
  for (const id of [...needed].sort()) {
    const uri = pieceUri(kit, id, low);
    try {
      if (host.assetUrl(uri) === null) throw new Error(`${uri} is not in the station folder`);
      const gltf = await host.loadGlb(uri);
      const parts = visibleParts(THREE, gltf);
      if (!parts.length) throw new Error(`${uri} has no visible mesh`);
      assets.set(id, { gltf, parts });
    } catch (err) {
      console.warn(`[ikebukuro] shop kit: ${id}: ${err instanceof Error ? err.message : String(err)}; keeping the PLATEAU panels`);
    }
  }
  const placements = wanted.filter((p) => assets.has(p.piece));
  // A sign belongs to a drawn shopfront: it is anchored only on rows whose piece loaded, so a shop whose pieces all
  // failed keeps the bare PLATEAU panels and no sign.
  const loaded = Object.fromEntries(Object.entries(pieces).filter(([id]) => assets.has(id)));
  const signs = shopSigns(shops, openings, loaded);
  const blades = shopBladeSigns(shops, openings, loaded);
  const boards = shopABoards(shops, openings, loaded);
  const owned: { dispose(): void }[] = [];
  return {
    placements,
    signs,
    build(THREE, env, toRenderer) {
      const group = new THREE.Group();
      group.name = "ikebukuro_kit_shops";
      group.userData = { gteki_role: "kit_shop" };
      const stats: ShopStats = {
        shops: new Set(placements.map((p) => p.shop)).size, modules: placements.length, tiles: 0,
        drawCallsAllTiles: 0, trianglesAllTiles: 0, trianglesWorstTile: 0,
        signs: 0, signDrawCalls: 0, signTriangles: 0, interiorDrawCalls: 0, interiorTriangles: 0, spillDrawCalls: 0, bladeSigns: 0, aBoards: 0,
      };
      const lit = new Map<THREE_NS.Material, THREE_NS.Material>();
      const litOf = (src: THREE_NS.Material) => {
        let m = lit.get(src);
        if (!m) {
          m = src.clone();
          const std = m as THREE_NS.MeshStandardMaterial;
          if (std.isMeshStandardMaterial) {
            std.envMap = env;
            std.envMapIntensity = KIT_ENV_INTENSITY;
          }
          lit.set(src, m);
          owned.push(m);
        }
        return m;
      };
      const base = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      const triOf = (g: THREE_NS.BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;

      if (placements.length) {
        const world = placements.map((p) => ({ centre: toRenderer(p.x, p.y, p.z), yaw: p.yawDeg * DEG, p }));
        const tiles = tileGroups(world.map((w) => ({ x: w.centre.x, z: w.centre.z })), tileSize(low));
        let worst = 0;
        for (const [key, idx] of [...tiles].sort(([a], [b]) => (a < b ? -1 : 1))) {
          stats.tiles++;
          let tileTris = 0;
          for (const id of [...assets.keys()].sort()) {
            const mine = idx.filter((wi) => world[wi]!.p.piece === id);
            if (!mine.length) continue;
            for (const part of assets.get(id)!.parts) {
              if (part.material.name === "gteki_reveal_dark") continue;
              const im = new THREE.InstancedMesh(part.geometry, litOf(part.material), mine.length);
              owned.push(im); // its instance-matrix buffer is freed only by its own dispose()
              im.name = `kit_shop:${id}:${key}`;
              im.userData = { gteki_role: "kit_shop" };
              mine.forEach((wi, i) => {
                const w = world[wi]!;
                q.setFromAxisAngle(up, w.yaw);
                s.set(w.p.sx, w.p.sy, w.p.sz);
                base.compose(w.centre, q, s).multiply(part.matrix);
                im.setMatrixAt(i, base);
              });
              im.instanceMatrix.needsUpdate = true;
              im.computeBoundingSphere();
              group.add(im);
              stats.drawCallsAllTiles++;
              tileTris += triOf(part.geometry) * mine.length;
            }
          }
          stats.trianglesAllTiles += tileTris;
          worst = Math.max(worst, tileTris);
        }
        stats.trianglesWorstTile = worst;
      }

      if (placements.length) {
        const displays = ["cafe", "bakery", "sweets", "deli", "pharmacy", "books", "fashion", "homeware", "department", "none"];
        const boardDisplays = ["cafe", "bakery", "deli", "sweets"];
        const cell = low ? 256 : 512, cols = 4, rows = 6;
        const canvas = document.createElement("canvas"); canvas.width = cols * cell; canvas.height = rows * cell;
        const g = canvas.getContext("2d")!;
        const rect = (x: number, y: number, w: number, h: number, colour: string) => { g.fillStyle = colour; g.fillRect(x, y, w, h); };
        const poly = (points: number[], colour: string) => { g.fillStyle = colour; g.beginPath(); g.moveTo(points[0]!, points[1]!); for (let i = 2; i < points.length; i += 2) g.lineTo(points[i]!, points[i + 1]!); g.closePath(); g.fill(); };
        for (let index = 0; index < 24; index++) {
          g.save(); g.translate((index % cols) * cell, Math.floor(index / cols) * cell); g.scale(cell / 512, cell / 512);
          if (index >= 20) {
            rect(0, 0, 512, 512, "#6b4d32"); rect(25, 25, 462, 462, "#1e3029");
            g.strokeStyle = "#e9e1c6"; g.lineWidth = 9; g.beginPath();
            if (index === 20) { g.arc(250, 220, 65, 0, Math.PI); g.moveTo(190, 220); g.lineTo(310, 220); }
            else if (index === 21) { g.ellipse(250, 230, 100, 55, 0, 0, Math.PI * 2); }
            else { g.arc(250, 220, 85, 0, Math.PI); }
            g.moveTo(100, 340); g.lineTo(410, 340); g.moveTo(150, 390); g.lineTo(370, 390); g.stroke();
          } else {
            const display = displays[Math.floor(index / 2)]!, variant = index % 2;
            const cool = display === "pharmacy" || display === "department";
            const dim = display === "none";
            rect(0, 0, 512, 512, dim ? "#63594e" : cool ? "#f4f8fb" : "#fff1d8");
            poly([0,0,110,85,110,350,0,512], dim ? "#514b43" : "#cbb8a1");
            poly([512,0,402,85,402,350,512,512], dim ? "#514b43" : "#d7c9b8");
            poly([0,512,110,350,402,350,512,512], dim ? "#48443e" : "#c89a6a");
            rect(110, 30, 292, 20, dim ? "#8b8270" : "#fffdf3");
            let seed = 71 + index * 193; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
            if (["books", "pharmacy", "bakery", "homeware"].includes(display)) {
              for (let y = 145; y <= 355; y += 70) {
                rect(115,y,282,8,"#806b59");
                for (let x = 120; x < 390; x += display === "books" ? 12 : 27) {
                  const colors = display === "pharmacy" ? ["#f6f8f5", "#a6c5ca", "#e6b8ad"] : display === "bakery" ? ["#b56d30", "#dfa85a", "#efc37c"] : ["#a36e5d", "#d9bd91", "#879995", "#e0d5c4"];
                  rect(x,y - 25 - rnd() * 22, display === "books" ? 9 : 19, 25 + rnd() * 20, colors[Math.floor(rnd() * colors.length)]!);
                }
              }
            } else if (display === "fashion") {
              rect(130,145,250,6,"#6e6158");
              for (let x = 145; x < 380; x += 39) poly([x,170,x+12,150,x+25,170,x+29,270,x-3,270], ["#b99383","#e6d8c7","#8b9290"][Math.floor(rnd()*3)]!);
            } else if (!dim) {
              rect(100, 295, 312, 90, "#ac8e75"); rect(110, 285, 292, 13, dim ? "#6d6255" : "#f9e9d7");
              for (let x = 130; x < 390; x += 38) rect(x, 255 + rnd()*12, 23, 24, ["#f4dfca","#b97c5b","#d4ac83","#e5b4b1"][Math.floor(rnd()*4)]!);
            }
            if (display === "bakery") for (let y = 135; y <= 345; y += 70) for (let x = 135; x < 390; x += 45) { g.fillStyle = "#d99a4d"; g.beginPath(); g.ellipse(x, y, 19, 10, 0, 0, Math.PI * 2); g.fill(); }
            if (display === "cafe") for (let x = 145; x < 380; x += 55) { rect(x, 255, 25, 25, "#fffaf1"); g.strokeStyle = "#fffaf1"; g.lineWidth = 5; g.beginPath(); g.arc(x+25,267,8,-Math.PI/2,Math.PI/2); g.stroke(); }
            if (display === "sweets" || display === "deli") { rect(105, 260, 302, 8, "#e7f3f3"); rect(105, 260, 8, 100, "#e7f3f3"); rect(399, 260, 8, 100, "#e7f3f3"); for (let x = 125; x < 390; x += 34) for (let y = 300; y < 355; y += 25) rect(x,y,22,12,display === "sweets" ? ["#efaeb7","#f7e5c7","#b7d0b0"][Math.floor(rnd()*3)]! : ["#ad7654","#d7b068","#82a073"][Math.floor(rnd()*3)]!); }
            if (display === "books") { rect(160,390,190,12,"#ad8f72"); for (let x=175; x<335; x+=40) { rect(x,374,32,6,"#a87060"); rect(x,367,30,6,"#e1d1a9"); } }
            if (display === "homeware") for (let x=145; x<380; x+=55) { g.fillStyle = "#e8d8c0"; g.beginPath(); g.ellipse(x, 325, 18, 10, 0, 0, Math.PI); g.fill(); rect(x-8,280,16,30,"#aeb5a4"); }
            if (display === "fashion") { g.fillStyle = "#c9b7a5"; g.beginPath(); g.arc(270,135,16,0,Math.PI*2); g.fill(); poly([258,153,282,153,293,230,247,230],"#d9c8b6"); for (const x of [170,270,370]) { g.fillStyle="rgba(255,248,216,0.35)"; g.beginPath(); g.ellipse(x,450,55,20,0,0,Math.PI*2); g.fill(); } }
            if (display === "department") { rect(130, 320, 105, 45, "#f8f5ef"); rect(275, 320, 105, 45, "#f8f5ef"); for (let x=150; x<375; x+=25) rect(x,300,10,20,"#d8b6ae"); }
            if (display === "cafe" || display === "department") for (let x = 155 + variant * 25; x < 390; x += 90) { rect(x,50,3,45,"#8f7866"); rect(x-13,92,29,12,"#fff8ce"); }
          }
          g.restore();
        }
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide }); owned.push(texture, material);
        const parts: { geometry: THREE_NS.BufferGeometry; material: THREE_NS.Material; matrix: THREE_NS.Matrix4 }[] = [];
        const mapCell = (geo: THREE_NS.BufferGeometry, index: number) => {
          const uv = geo.getAttribute("uv") as THREE_NS.BufferAttribute;
          for (let k = 0; k < uv.count; k++) uv.setXY(k, ((index % cols) + uv.getX(k)) / cols, 1 - (Math.floor(index / cols) + 1 - uv.getY(k)) / rows);
        };
        const counts = new Map<string, number>();
        for (const p of placements) {
          const key = `${p.shop}:${p.polygon}`, k = counts.get(key) ?? 0; counts.set(key, k + 1);
          const display = shops.find((s) => s.id === p.shop)!.display;
          const index = Math.max(0, displays.indexOf(display)) * 2 + k % 2;
          const rect = INTERIOR_RECTS[pieces[p.piece]!.use];
          if (!rect) continue;
          const [left, right, bottom, top] = rect;
          const geo = new THREE.PlaneGeometry(right - left, top - bottom);
          geo.translate((left + right) / 2, (bottom + top) / 2, 0.025); mapCell(geo, index);
          q.setFromAxisAngle(up, p.yawDeg * DEG); s.set(p.sx, p.sy, p.sz);
          parts.push({ geometry: geo, material, matrix: new THREE.Matrix4().compose(toRenderer(p.x,p.y,p.z),q,s) });
        }
        for (const board of boards) for (const angle of [-12, 12]) {
          const geo = new THREE.PlaneGeometry(0.5, 0.9); mapCell(geo, 20 + boardDisplays.indexOf(board.display));
          const rotation = new THREE.Quaternion().setFromAxisAngle(up, board.yawDeg * DEG).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), angle * DEG));
          const normal = (board.yawDeg - 90) * DEG, offset = -Math.sin(angle * DEG) * 0.45;
          parts.push({ geometry: geo, material, matrix: new THREE.Matrix4().compose(toRenderer(board.x + Math.cos(normal) * offset,board.y + Math.sin(normal) * offset,board.z + 0.45 * Math.cos(12 * DEG)), rotation, new THREE.Vector3(1,1,1)) });
        }
        const merged = mergeByMaterial(THREE, parts); for (const part of parts) part.geometry.dispose();
        if (merged.length) { const geo = merged[0]!.geometry; const mesh = new THREE.Mesh(geo, material); owned.push(geo); mesh.name = "kit_shop_interiors"; mesh.userData = { gteki_role: "kit_shop" }; group.add(mesh); stats.interiorDrawCalls = 1; stats.interiorTriangles = triOf(geo); stats.aBoards = boards.length; }
        const spillCanvas = document.createElement("canvas"); spillCanvas.width = 2; spillCanvas.height = 64;
        const sg = spillCanvas.getContext("2d")!; const gradient = sg.createLinearGradient(0,0,0,64); gradient.addColorStop(0,"rgba(255,255,255,0.35)"); gradient.addColorStop(1,"rgba(255,255,255,0)"); sg.fillStyle = gradient; sg.fillRect(0,0,2,64);
        const st = new THREE.CanvasTexture(spillCanvas); const sm = new THREE.MeshBasicMaterial({ map: st, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }); owned.push(st,sm);
        const spillParts: { geometry: THREE_NS.BufferGeometry; material: THREE_NS.Material; matrix: THREE_NS.Matrix4 }[] = [];
        for (const polygon of new Set(placements.map((p) => p.polygon))) {
          const row = rowOf(openings, polygon)!; const p = placements.find((p) => p.polygon === polygon)!; const display = shops.find((shop) => shop.id === p.shop)!.display;
          const geo = new THREE.PlaneGeometry(row.width, 1.4); const colour = new THREE.Color(display === "pharmacy" || display === "department" ? "#e7f3ff" : "#ffe0af");
          const colors = new Float32Array(geo.getAttribute("position").count * 3); for (let i=0; i<colors.length; i+=3) { colors[i]=colour.r; colors[i+1]=colour.g; colors[i+2]=colour.b; } geo.setAttribute("color", new THREE.BufferAttribute(colors,3));
          const normal = row.normal_deg * DEG; const centre = toRenderer(row.centre[0]+Math.cos(normal)*0.7,row.centre[1]+Math.sin(normal)*0.7,row.base_z+0.01);
          const rotation = new THREE.Quaternion().setFromAxisAngle(up,p.yawDeg*DEG).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2));
          spillParts.push({ geometry: geo, material: sm, matrix: new THREE.Matrix4().compose(centre,rotation,new THREE.Vector3(1,1,1)) });
        }
        const spill = mergeByMaterial(THREE,spillParts);
        if (spill.length) {
          const colors = new Float32Array(spillParts.flatMap((part) => Array.from((part.geometry.getAttribute("color") as THREE_NS.BufferAttribute).array)));
          spill[0]!.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        }
        for (const part of spillParts) part.geometry.dispose();
        if (spill.length) { const geo=spill[0]!.geometry; const mesh=new THREE.Mesh(geo,sm); owned.push(geo); mesh.name="kit_shop_spill"; mesh.userData={ gteki_role: "kit_shop" }; group.add(mesh); stats.spillDrawCalls=1; }
      }

      if (signs.length) {
        // One unlit atlas face batch: every sign quad lit from within, one draw call.
        const { canvas, slots } = paintSignAtlas([...signs, ...blades], SIGN_PX_PER_M, signs.length);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
        owned.push(texture, material);
        // Single-sided: a blade sign gets a second quad turned 180° so its text reads unmirrored from both ways.
        const parts = [...signs, ...blades].flatMap((sign, i) => {
          const slot = slots[i]!;
          const geo = new THREE.PlaneGeometry(sign.width, sign.height);
          // Map the plane's 0..1 UVs onto this sign's atlas rectangle (CanvasTexture flips Y).
          const u0 = slot.x / canvas.width, u1 = (slot.x + slot.w) / canvas.width;
          const vTop = 1 - slot.y / canvas.height, vBot = 1 - (slot.y + slot.h) / canvas.height;
          const uv = geo.getAttribute("uv") as THREE_NS.BufferAttribute;
          for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), vBot + uv.getY(k) * (vTop - vBot));
          const centre = toRenderer(sign.x, sign.y, sign.z);
          return (i >= signs.length ? [0, 180] : [0]).map((turn, j) => {
            q.setFromAxisAngle(up, (sign.yawDeg + turn) * DEG);
            const matrix = new THREE.Matrix4().compose(centre, q, new THREE.Vector3(1, 1, 1));
            return { geometry: j ? geo.clone() : geo, material, matrix };
          });
        });
        const merged = mergeByMaterial(THREE, parts);
        for (const p of parts) p.geometry.dispose(); // mergeByMaterial copies the vertices
        if (merged.length) {
          const mesh = new THREE.Mesh(merged[0]!.geometry, material);
          owned.push(merged[0]!.geometry);
          mesh.name = "kit_shop_signs";
          mesh.userData = { gteki_role: "kit_shop_sign" };
          group.add(mesh);
          stats.signs = signs.length;
          stats.bladeSigns = blades.length;
          stats.signDrawCalls = 1;
          stats.signTriangles = triOf(merged[0]!.geometry);
        }
      }
      return { group, stats };
    },
    dispose() {
      for (const o of owned) o.dispose();
      for (const { gltf } of assets.values()) {
        gltf.scene.traverse((o) => {
          const m = o as THREE_NS.Mesh;
          if (!m.isMesh) return;
          m.geometry.dispose();
          const mat = m.material as THREE_NS.MeshStandardMaterial;
          for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.emissiveMap, mat.aoMap]) t?.dispose();
          mat.dispose();
        });
      }
    },
  };
}
