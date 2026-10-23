// Lane E station catalog, batch A: station-specific stair and escalator dressing placed on the surveyed anchors of
// scene/kit_placements.json (pipeline/build_kit_catalog.py). Presentation only, same rules as kit.ts: a catalog piece
// never enters `walkable`, `colliders` or the walk graph, and the pieces are not a survey layout.
//
// Files: scene/kit_catalog.json names the pieces; scene/kit_placements.json gives each surveyed anchor the catalog id
// of each part, its ENU origin and travel direction, and the quality tiers that draw that part (`tiers`). The station
// ships batch A (the 5 escalator ids) and batch B (the 21 `main_route` stair handrails), desktop tier only. An id
// whose GLB the station does not ship is treated as "not in this batch" and skipped silently (one summary line); a
// GLB that is declared but fails to load warns and drops its own placements only.
//
// Frame: the Lane E pieces put the start socket at the origin with travel along local -Z (the end socket is at
// -Z), width along local X and up along +Y. The catalog's `yaw_deg` is a counter-clockwise turn about ENU +Z taking
// local +Y (travel) onto `dir`; the station frame maps ENU (x, y, z) to renderer (x, z, -y), so the same angle turns
// about renderer +Y and the same number applies. `mirror` reflects local X (the width axis). It is false everywhere
// today, and a mirrored instance keeps a negative determinant, so its faces render with reversed winding; no catalog
// entry uses it.
import type * as THREE_NS from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { SceneContext } from "@gteki/scene-api";
import { KIT_ENV_INTENSITY, visibleParts } from "./kit.ts";
type ThreeNS = typeof THREE_NS;

export type Tier = "low" | "high";

/** One entry of scene/kit_placements.json `placements[]` (ENU metres). */
export interface CatalogPlacement {
  anchor: string;
  kind: "stair" | "escalator";
  /** PLATEAU's container for the installation: `building` (building-level) or a room suffix such as `room1`.
   *  Not a playability marker; every placement here lies inside the modelled, playable multi-level slice. */
  scope: string;
  /** Part name (`dressing`, or `nosing`/`rails` for stairs) -> Lane E catalog id. */
  ids: Record<string, string>;
  /** Piece origin: the bottom comb line for escalators, the floor under the first nosing for stairs. */
  origin: [number, number, number];
  /** Horizontal unit vector (east, north) up the flight. */
  dir: [number, number];
  /** Counter-clockwise about ENU +Z taking the piece's local +Y (travel) onto `dir`. */
  yaw_deg: number;
  mirror: boolean;
  /** Part name -> the tiers that draw it. A part whose list lacks "low" never loads on phones. */
  tiers: Record<string, Tier[]>;
}

export interface PlacementsFile {
  schema: string;
  placements: CatalogPlacement[];
}

/** The folder under gteki/ a tier reads catalog GLBs from. */
export const tierName = (low: boolean): Tier => (low ? "low" : "high");
export const catalogUri = (id: string, low: boolean) => `kit/catalog/${tierName(low)}/${id}.glb`;

/** One part of one placement that this tier draws. */
export interface CatalogPart {
  placement: CatalogPlacement;
  part: string;
  id: string;
}

/** Pure: the (placement, part, id) triples a tier draws, in file order. */
export function tierParts(placements: readonly CatalogPlacement[], low: boolean): CatalogPart[] {
  const tier = tierName(low);
  const out: CatalogPart[] = [];
  for (const p of placements)
    for (const [part, id] of Object.entries(p.ids)) if ((p.tiers[part] ?? []).includes(tier)) out.push({ placement: p, part, id });
  return out;
}

/** Where a piece stands in the renderer frame, and the yaw about +Y that turns its local -Z (travel) onto `dir`. */
export function piecePose(THREE: ThreeNS, p: CatalogPlacement, toRenderer: (x: number, y: number, z: number) => THREE_NS.Vector3) {
  return { centre: toRenderer(p.origin[0], p.origin[1], p.origin[2]), yaw: (p.yaw_deg * Math.PI) / 180 };
}

export interface CatalogStats {
  /** Part instances drawn (a stair placement's nosing and rails count as two). */
  parts: number;
  /** Placements with at least one part drawn, per placement kind. */
  byKind: Record<string, number>;
  uniqueGlbs: number;
  /** One draw per part per GLB: every placement of an id shares its InstancedMesh. */
  drawCalls: number;
  triangles: number;
}

export interface LoadedCatalogKit {
  /** The parts that will be drawn (empty when no GLB loaded or the tier draws none). */
  placements: readonly CatalogPart[];
  /** Catalog ids this tier draws but the station does not ship, or that failed to load. */
  skippedIds: readonly string[];
  /** Build the instanced pieces. `env` lights them (the scene's own PMREM environment). */
  build(THREE: ThreeNS, env: THREE_NS.Texture, toRenderer: (x: number, y: number, z: number) => THREE_NS.Vector3): { group: THREE_NS.Group; stats: CatalogStats };
  dispose(): void;
}

type Host = Pick<SceneContext, "assetUrl" | "loadGlb">;

/** Loads the catalog parts this tier draws. Never throws: an id that cannot be used drops its own placements only. */
export async function loadKitCatalog(
  THREE: ThreeNS,
  host: Host,
  placements: readonly CatalogPlacement[],
  low: boolean,
): Promise<LoadedCatalogKit> {
  const wanted = tierParts(placements, low);
  const assets = new Map<string, ReturnType<typeof visibleParts>>();
  const gltfs: GLTF[] = [];
  const skipped = new Set<string>();
  for (const id of [...new Set(wanted.map((w) => w.id))].sort()) {
    const uri = catalogUri(id, low);
    if (host.assetUrl(uri) === null) {
      skipped.add(id); // not part of this batch: the station ships other catalog ids only
      continue;
    }
    try {
      const gltf = await host.loadGlb(uri);
      gltfs.push(gltf);
      const parts = visibleParts(THREE, gltf);
      if (!parts.length) throw new Error(`${uri} has no visible mesh`);
      assets.set(id, parts);
    } catch (err) {
      skipped.add(id);
      console.warn(`[ikebukuro] kit catalog: ${id}: ${err instanceof Error ? err.message : String(err)}; skipping`);
    }
  }
  const drawn = wanted.filter((w) => assets.has(w.id));
  const skippedParts = wanted.length - drawn.length;
  if (wanted.length)
    console.info(
      `[ikebukuro] kit catalog (${tierName(low)}): ${drawn.length} of ${wanted.length} parts drawn from ${assets.size} GLBs, ` +
        `${skippedParts} skipped (${skipped.size} ids not shipped or unloadable)`,
    );

  const owned: { dispose(): void }[] = [];
  return {
    placements: drawn,
    skippedIds: [...skipped].sort(),
    build(THREE, env, toRenderer) {
      const group = new THREE.Group();
      group.name = "ikebukuro_kit_catalog";
      group.userData = { gteki_role: "kit_catalog" };
      const byKind: Record<string, number> = {};
      for (const kind of [...new Set(drawn.map((w) => w.placement.kind))].sort())
        byKind[kind] = new Set(drawn.filter((w) => w.placement.kind === kind).map((w) => w.placement.anchor)).size;
      const stats: CatalogStats = { parts: 0, byKind, uniqueGlbs: assets.size, drawCalls: 0, triangles: 0 };
      if (!drawn.length) return { group, stats };
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
      for (const id of [...assets.keys()].sort()) {
        const mine = drawn.filter((w) => w.id === id);
        if (!mine.length) continue;
        stats.parts += mine.length;
        assets.get(id)!.forEach((part, k) => {
          const im = new THREE.InstancedMesh(part.geometry, litOf(part.material), mine.length);
          owned.push(im); // its instance-matrix buffer is freed only by its own dispose()
          im.name = `kit_catalog:${id}:${k}`;
          im.userData = { gteki_role: "kit_catalog", gteki_anchors: mine.map((w) => w.placement.anchor) };
          mine.forEach((w, i) => {
            const pose = piecePose(THREE, w.placement, toRenderer);
            q.setFromAxisAngle(up, pose.yaw);
            s.set(w.placement.mirror ? -1 : 1, 1, 1);
            base.compose(pose.centre, q, s).multiply(part.matrix);
            im.setMatrixAt(i, base);
          });
          im.instanceMatrix.needsUpdate = true;
          im.computeBoundingSphere();
          group.add(im);
          stats.drawCalls++;
          stats.triangles += triOf(part.geometry) * mine.length;
        });
      }
      return { group, stats };
    },
    dispose() {
      for (const o of owned) o.dispose();
      for (const gltf of gltfs)
        gltf.scene.traverse((o) => {
          const m = o as THREE_NS.Mesh;
          if (!m.isMesh) return;
          m.geometry.dispose();
          const mat = m.material as THREE_NS.MeshStandardMaterial;
          for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.emissiveMap, mat.aoMap]) t?.dispose();
          mat.dispose();
        });
    },
  };
}
