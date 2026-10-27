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
        out.push({ shop: shop.id, row: row.opening_id, piece, x: x + ux * t, y: y + uy * t, z: row.base_z, yawDeg, sx, sy, sz: 1 });
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
function paintSignAtlas(signs: readonly ShopSign[], pxPerM: number): { canvas: HTMLCanvasElement; slots: SignSlot[] } {
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
      for (const part of parts) {
        if (part.material.name !== "gteki_reveal_dark") continue;
        const pos = part.geometry.getAttribute("position");
        part.geometry.computeBoundingBox();
        const bounds = part.geometry.boundingBox!;
        const uv = new Float32Array(pos.count * 2);
        for (let i = 0; i < pos.count; i++) {
          uv[i * 2] = (pos.getX(i) - bounds.min.x) / (bounds.max.x - bounds.min.x);
          uv[i * 2 + 1] = (pos.getY(i) - bounds.min.y) / (bounds.max.y - bounds.min.y);
        }
        part.geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      }
      assets.set(id, { gltf, parts });
    } catch (err) {
      console.warn(`[ikebukuro] shop kit: ${id}: ${err instanceof Error ? err.message : String(err)}; keeping the PLATEAU panels`);
    }
  }
  const placements = wanted.filter((p) => assets.has(p.piece));
  // A sign belongs to a drawn shopfront: a shop whose piece failed keeps the bare PLATEAU panel and no sign.
  const drawn = new Set(placements.map((p) => p.shop));
  const signs = shopSigns(shops, openings, pieces).filter((s) => drawn.has(s.shop));
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
        signs: 0, signDrawCalls: 0, signTriangles: 0,
      };
      let interior: THREE_NS.MeshBasicMaterial | undefined;
      const interiorOf = () => {
        if (interior) return interior;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 512;
        const g = canvas.getContext("2d")!;
        const gradient = g.createLinearGradient(0, 0, 0, 512);
        gradient.addColorStop(0, "#fff3dc");
        gradient.addColorStop(0.55, "#f6d3a1");
        gradient.addColorStop(1, "#c9a073");
        g.fillStyle = gradient;
        g.fillRect(0, 0, 512, 512);
        g.fillStyle = "#fff8e9";
        g.fillRect(0, 0, 512, 512 * 0.08);
        let seed = 61;
        const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
        const colours = ["#b99b7c", "#c7b09a", "#a9aaa0", "#d7b896"];
        for (const y of [190, 300, 410]) {
          g.fillStyle = "rgba(138,106,74,0.35)";
          g.fillRect(0, y, 512, 9);
          for (let x = 20; x < 490; x += 40) {
            g.fillStyle = colours[Math.floor(rnd() * colours.length)]!;
            const h = 20 + rnd() * 32;
            g.fillRect(x, y - h, 18 + rnd() * 12, h);
          }
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        interior = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
        owned.push(texture, interior);
        return interior;
      };
      const lit = new Map<THREE_NS.Material, THREE_NS.Material>();
      const litOf = (src: THREE_NS.Material) => {
        if (src.name === "gteki_reveal_dark") return interiorOf();
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

      if (signs.length) {
        // One unlit atlas face batch: every sign quad lit from within, one draw call.
        const { canvas, slots } = paintSignAtlas(signs, SIGN_PX_PER_M);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
        owned.push(texture, material);
        const parts = signs.map((sign, i) => {
          const slot = slots[i]!;
          const geo = new THREE.PlaneGeometry(sign.width, sign.height);
          // Map the plane's 0..1 UVs onto this sign's atlas rectangle (CanvasTexture flips Y).
          const u0 = slot.x / canvas.width, u1 = (slot.x + slot.w) / canvas.width;
          const vTop = 1 - slot.y / canvas.height, vBot = 1 - (slot.y + slot.h) / canvas.height;
          const uv = geo.getAttribute("uv") as THREE_NS.BufferAttribute;
          for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), vBot + uv.getY(k) * (vTop - vBot));
          q.setFromAxisAngle(up, sign.yawDeg * DEG);
          const matrix = new THREE.Matrix4().compose(toRenderer(sign.x, sign.y, sign.z), q, new THREE.Vector3(1, 1, 1));
          return { geometry: geo, material, matrix };
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
