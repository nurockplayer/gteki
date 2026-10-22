// Kit batch 2 (#94): Lane E column pieces placed as sleeves on the PLATEAU column footprints in scene/columns.json
// (extracted once by pipeline/extract_columns.py). Presentation only, same rules as kit.ts: the original PLATEAU
// column stays in the `barriers` mesh and stays the collider, kit meshes never enter `walkable`, `colliders` or the
// walk graph, and a piece that fails to load leaves the flat PLATEAU column.
//
// Scaling. The pieces are 0.61 m wide and 2.8 m tall (bounds in assets/library/manifest.json). A sleeve is scaled in
// plan to the measured footprint plus SLEEVE_MARGIN_M on every side (so its walls stand clear of the PLATEAU faces and
// do not z-fight with them) and is never stretched in height: it is only squashed when the column is lower than the
// piece, and always stops SLEEVE_TOP_GAP_M under the column's top so its top face does not share a plane with the
// PLATEAU cap. A taller column keeps the flat PLATEAU surface above 2.8 m. The finish is the kit's generic tile or
// enamel, not a survey of the Ikebukuro columns.
import type * as THREE_NS from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { SceneContext } from "@gteki/scene-api";
import { KIT_ENV_INTENSITY, type KitManifest, type KitStats, pieceUri, tileGroups, tileSize, visibleParts } from "./kit.ts";
type ThreeNS = typeof THREE_NS;

export const COLUMN_USES = ["column_square", "column_round"] as const;
/** The sleeve stands this far off each PLATEAU face (m). */
export const SLEEVE_MARGIN_M = 0.02;
/** The sleeve's top stops this far under the PLATEAU column's top (m). */
export const SLEEVE_TOP_GAP_M = 0.01;

/** One entry of scene/columns.json `columns[]`. */
export interface Column {
  id: string;
  source: { installations: string[]; polygons: string[] };
  centre: [number, number];
  shape: "square" | "rect" | "round" | "polygon";
  width: number;
  depth: number;
  diameter?: number;
  sides?: number;
  /** Counter-clockwise from +X seen from above (ENU), of the `width` axis. */
  rotation_deg: number;
  base_z: number;
  top_z: number;
  height: number;
  level: string;
  closed: boolean;
  /** Library piece id, or null with a `reason`. */
  kit: string | null;
  reason?: string;
}

export interface ColumnsFile {
  schema: string;
  counts: Record<string, unknown>;
  columns: Column[];
}

export interface ColumnPlacement {
  /** `Column.id` this sleeve covers. */
  column: string;
  piece: string;
  /** Footprint centre at the column's base, ENU metres. */
  x: number;
  y: number;
  z: number;
  /** Rotation of the piece's +X about up, degrees counter-clockwise seen from above (the same angle in ENU and the renderer). */
  yawDeg: number;
  /** Scale along the piece's X, Y (up) and Z (the renderer axis the footprint's depth maps to). */
  sx: number;
  sy: number;
  sz: number;
}

export interface ColumnPieceSpec {
  /** Plan footprint of the piece (m): `pitch_m` in kit.json. */
  footprint_m: number;
  height_m: number;
}

/** Pure: the sleeve per kit-matched column, in file order. A column whose piece is not in `pieces` is left out. */
export function columnPlacements(columns: readonly Column[], pieces: Readonly<Record<string, ColumnPieceSpec>>): ColumnPlacement[] {
  const out: ColumnPlacement[] = [];
  for (const c of columns) {
    if (!c.kit) continue;
    const spec = pieces[c.kit];
    if (!spec) continue;
    const w = c.shape === "round" ? (c.diameter ?? c.width) : c.width;
    const d = c.shape === "round" ? (c.diameter ?? c.depth) : c.depth;
    out.push({
      column: c.id,
      piece: c.kit,
      x: c.centre[0],
      y: c.centre[1],
      z: c.base_z,
      yawDeg: c.rotation_deg,
      sx: (w + 2 * SLEEVE_MARGIN_M) / spec.footprint_m,
      sy: Math.min(1, (c.height - SLEEVE_TOP_GAP_M) / spec.height_m),
      sz: (d + 2 * SLEEVE_MARGIN_M) / spec.footprint_m,
    });
  }
  return out;
}

/** The column pieces a kit manifest names, by id, with the footprint and height their sleeve scales from. */
export function columnPieces(kit: Pick<KitManifest, "pieces">): Record<string, ColumnPieceSpec> {
  const out: Record<string, ColumnPieceSpec> = {};
  for (const [id, p] of Object.entries(kit.pieces)) {
    const h = (p as { height_m?: number }).height_m;
    if ((COLUMN_USES as readonly string[]).includes(p.use) && typeof h === "number") out[id] = { footprint_m: p.pitch_m, height_m: h };
  }
  return out;
}

interface PieceAsset {
  gltf: GLTF;
  parts: ReturnType<typeof visibleParts>;
}

export interface LoadedColumnKit {
  /** Sleeves that will be drawn (empty when no piece loaded). */
  placements: readonly ColumnPlacement[];
  build(THREE: ThreeNS, env: THREE_NS.Texture, toRenderer: (x: number, y: number, z: number) => THREE_NS.Vector3): { group: THREE_NS.Group; stats: KitStats };
  dispose(): void;
}

type Host = Pick<SceneContext, "assetUrl" | "loadGlb">;

/** Loads the column pieces for this tier. Never throws: a piece that cannot be used drops its own columns only. */
export async function loadColumnKit(THREE: ThreeNS, host: Host, kit: KitManifest, columns: readonly Column[], low: boolean): Promise<LoadedColumnKit> {
  const specs = columnPieces(kit);
  const needed = new Set(columns.filter((c) => c.kit && specs[c.kit]).map((c) => c.kit!));
  const assets = new Map<string, PieceAsset>();
  for (const id of [...needed].sort()) {
    const uri = pieceUri(kit, id, low);
    try {
      if (host.assetUrl(uri) === null) throw new Error(`${uri} is not in the station folder`);
      const gltf = await host.loadGlb(uri);
      const parts = visibleParts(THREE, gltf);
      if (!parts.length) throw new Error(`${uri} has no visible mesh`);
      assets.set(id, { gltf, parts });
    } catch (err) {
      console.warn(`[ikebukuro] kit: ${id}: ${err instanceof Error ? err.message : String(err)}; keeping the flat PLATEAU columns`);
    }
  }
  const placements = columnPlacements(columns, specs).filter((p) => assets.has(p.piece));
  const owned: { dispose(): void }[] = [];
  return {
    placements,
    build(THREE, env, toRenderer) {
      const group = new THREE.Group();
      group.name = "ikebukuro_kit_columns";
      group.userData = { gteki_role: "kit_column" };
      const stats: KitStats = { modules: placements.length, tiles: 0, drawCallsAllTiles: 0, trianglesAllTiles: 0, trianglesWorstTile: 0 };
      if (!placements.length) return { group, stats };
      const world = placements.map((p) => ({ centre: toRenderer(p.x, p.y, p.z), yaw: (p.yawDeg * Math.PI) / 180, p }));
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
            im.name = `kit_column:${id}:${key}`;
            im.userData = { gteki_role: "kit_column" };
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
