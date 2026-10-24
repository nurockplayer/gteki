// Lane E station catalog, batches A-C: station-specific stair and escalator dressing placed on the surveyed anchors
// of scene/kit_placements.json (pipeline/build_kit_catalog.py). Presentation only, same rules as kit.ts: a catalog
// piece never enters `walkable`, `colliders` or the walk graph, and the pieces are not a survey layout.
//
// Files: scene/kit_catalog.json names the pieces; scene/kit_placements.json gives each surveyed anchor the catalog id
// of each part, its ENU origin and travel direction, and the quality tiers that draw that part (`tiers`). The station
// ships batch A (the 5 escalator ids) and batch B (the 21 `main_route` stair handrails), desktop tier only, and
// batch C: the 61 stair nosing strips, on both tiers. An id whose GLB the station does not ship is treated as "not
// in this batch" and skipped silently (one summary line); a GLB that is declared but fails to load warns and drops
// its own placements only.
//
// Batch C is merged, not instanced: 61 strips would be 61 draws per tier, so the loader bakes each placement into a
// cloned geometry and merges them into a handful of spatial clusters (one BufferGeometry each) that share one
// material. Lane E's C3 build drops every per-id AO image; the strips sample one packed AO atlas per tier through
// TEXCOORD_1 (three's `aoMap` with `channel = 1`), which the loader fetches with the host's texture loader.
//
// Frame: the Lane E pieces put the start socket at the origin with travel along local -Z (the end socket is at
// -Z), width along local X and up along +Y. The catalog's `yaw_deg` is a counter-clockwise turn about ENU +Z taking
// local +Y (travel) onto `dir`; the station frame maps ENU (x, y, z) to renderer (x, z, -y), so the same angle turns
// about renderer +Y and the same number applies. `mirror` reflects local X (the width axis). It is false everywhere
// today, and a mirrored instance keeps a negative determinant, so its faces render with reversed winding; no catalog
// entry uses it.
import type * as THREE_NS from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { SceneContext } from "@gteki/scene-api";
import { KIT_ENV_INTENSITY, visibleParts } from "./kit.ts";
import kitCatalogAtlas from "./kit_catalog_atlas.json";
type ThreeNS = typeof THREE_NS;

export type Tier = "low" | "high";

// Thin handrails and escalator balustrades are local detail: keep 50 m from the sphere surface (not the
// anchor, so long flights stay intact), rather than drawing them through walls out to the 180 m fog limit.
export const CULL_M = 50;

/** Merged nosing meshes per tier: enough spatial clusters that frustum culling still rejects most of them. */
export const NOSING_CLUSTERS = 8;

/** Separate from render callbacks so invisible dressing also skips the GTAO depth/normal pass. */
export function catalogVisibility(THREE: ThreeNS) {
  const meshes: THREE_NS.Mesh[] = [];
  const at = new THREE.Vector3(), sphere = new THREE.Sphere();
  return {
    add(group: THREE_NS.Group) {
      for (const child of group.children) meshes.push(child as THREE_NS.Mesh);
    },
    update(camera: THREE_NS.Camera) {
      camera.getWorldPosition(at);
      // Reuse both scratch objects; no per-frame arrays, closures, vectors or spheres.
      for (const mesh of meshes) {
        // InstancedMesh keeps its own bounds (union of its instances); a merged nosing cluster uses its geometry's.
        const bound = (mesh as THREE_NS.InstancedMesh).boundingSphere ?? mesh.geometry.boundingSphere;
        if (!bound) continue;
        mesh.updateWorldMatrix(true, false);
        sphere.copy(bound).applyMatrix4(mesh.matrixWorld);
        const reach = CULL_M + sphere.radius;
        mesh.visible = at.distanceToSquared(sphere.center) <= reach * reach;
      }
    },
    clear() {
      meshes.length = 0;
    },
  };
}

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
/** Batch C: the packed AO atlas every nosing of a tier samples, under the same tier folder. */
export const NOSING_ATLAS = "atlas/nosing_ao.png";
export const nosingAtlasUri = (low: boolean) => `kit/catalog/${tierName(low)}/${NOSING_ATLAS}`;
/** The kinds whose tier folder ships a packed AO atlas (scene/kit_catalog_atlas.json, written by
 *  pipeline/sync_kit_catalog.py). A kind missing from the file has no atlas: its parts draw unoccluded. */
type AtlasDoc = Record<string, { path?: string; tiers?: Record<string, { max_isolated_mip?: number }> }>;
/** The catalog batch kind an id belongs to, as far as atlases go: `nosing`, `escalator` or null. */
export const atlasKindOf = (id: string): string | null =>
  id.endsWith("_nosing") ? "nosing" : id.includes("_escalator") ? "escalator" : null;
/** The atlas a tier ships for `kind`, or null when this tier has none. */
export function atlasUri(kind: string, low: boolean): string | null {
  const entry = (kitCatalogAtlas as AtlasDoc)[kind];
  if (!entry) return null;
  const tiers = entry.tiers ?? {};
  if (Object.keys(tiers).length && !tiers[tierName(low)]) return null; // shipped on one tier only
  return `kit/catalog/${tierName(low)}/${entry.path ?? `atlas/${kind}_ao.png`}`;
}
/** Lane E's recorded mip limit for a kind on a tier; `null` means "no limit recorded". It is a record only: three
 *  0.186 has no Texture.maxLevel, and the Lead's ruling on the final C3 build is not to clamp. */
export function atlasLimit(kind: string, low: boolean): number | null {
  const value = (kitCatalogAtlas as AtlasDoc)[kind]?.tiers?.[tierName(low)]?.max_isolated_mip;
  return typeof value === "number" ? value : null;
}
/** AO atlas sample state: TEXCOORD_1, data (no sRGB), top-down like the UVs, host userData preserved. The manifest's
 *  mip limit is recorded on the texture, not clamped (see atlasLimit). */
function prepareAtlas(THREE: ThreeNS, texture: THREE_NS.Texture, uri: string, kind: string, low: boolean): void {
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.channel = 1;
  Object.assign(texture.userData, { gteki_uri: uri, gteki_atlas_kind: kind });
  const limit = atlasLimit(kind, low);
  if (limit !== null) texture.userData.gteki_max_isolated_mip = limit;
  texture.needsUpdate = true;
}
export const nosingAtlasLimit = (low: boolean) => atlasLimit("nosing", low);

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
  /** One draw per visible GLB mesh per placement, before frustum culling and extra render passes. */
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

type Host = Pick<SceneContext, "assetUrl" | "loadGlb" | "loadTexture">;

const trianglesOf = (g: THREE_NS.BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;

/** Loads the instanced catalog parts this tier draws (batches A and B). Never throws: an id that cannot be used
 *  drops its own placements only. Nosing parts are excluded here: batch C merges them (loadNosingKit). */
export async function loadKitCatalog(
  THREE: ThreeNS,
  host: Host,
  placements: readonly CatalogPlacement[],
  low: boolean,
): Promise<LoadedCatalogKit> {
  const wanted = tierParts(placements, low).filter((w) => w.part !== "nosing");
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
  // Batch A's escalators (and any later kind with a packed atlas) sample it through TEXCOORD_1. One texture per kind
  // per tier; without it the parts still draw, just without AO.
  const atlases = new Map<string, THREE_NS.Texture>();
  for (const kind of [...new Set(drawn.map((w) => atlasKindOf(w.id)).filter((k): k is string => k !== null))].sort()) {
    const uri = atlasUri(kind, low);
    if (!uri || host.assetUrl(uri) === null) continue;
    try {
      const texture = await host.loadTexture(uri, { colorSpace: "linear", flipY: false });
      prepareAtlas(THREE, texture, uri, kind, low);
      atlases.set(kind, texture);
      owned.push(texture);
    } catch (err) {
      console.warn(`[ikebukuro] kit catalog: ${kind} atlas ${uri}: ${err instanceof Error ? err.message : String(err)}; drawing without AO`);
    }
  }
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
      // A source material shared by an atlas kind and a plain kind needs one clone per look, so cache per atlas.
      const litWith = new Map<THREE_NS.Texture, Map<THREE_NS.Material, THREE_NS.Material>>();
      const litOf = (src: THREE_NS.Material, atlas: THREE_NS.Texture | undefined) => {
        if (atlas && !litWith.has(atlas)) litWith.set(atlas, new Map());
        const key = atlas ? litWith.get(atlas)! : lit;
        let m = key.get(src);
        if (!m) {
          m = src.clone();
          const std = m as THREE_NS.MeshStandardMaterial;
          if (std.isMeshStandardMaterial) {
            std.envMap = env;
            std.envMapIntensity = KIT_ENV_INTENSITY;
            if (atlas) {
              std.aoMap = atlas;
              std.aoMapIntensity = 1;
            }
          }
          key.set(src, m); // per-atlas caches only: a plain clone must never carry the atlas kind's aoMap
          owned.push(m);
        }
        return m;
      };
      const base = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      for (const id of [...assets.keys()].sort()) {
        const mine = drawn.filter((w) => w.id === id);
        if (!mine.length) continue;
        stats.parts += mine.length;
        // Catalog flights are sparse (today each shipped id has one placement). Keep bounds local to a flight,
        // even if a future catalog reuses an id at opposite ends of the station. Geometry/materials stay shared.
        for (const w of mine) assets.get(id)!.forEach((part, k) => {
          const im = new THREE.InstancedMesh(part.geometry, litOf(part.material, atlases.get(atlasKindOf(id) ?? "")), 1);
          owned.push(im); // its instance-matrix buffer is freed only by its own dispose()
          im.name = `kit_catalog:${id}:${w.placement.anchor}:${k}`;
          im.userData = { gteki_role: "kit_catalog", gteki_anchors: [w.placement.anchor], gteki_shadow: "none" };
          im.frustumCulled = true;
          // Like the other kits, thin dressing starts with no shadows. The opt-out also survives the explorer's
          // default-lighting fallback, which would otherwise turn opaque meshes into sun-shadow casters.
          im.castShadow = false;
          im.receiveShadow = false;
          const pose = piecePose(THREE, w.placement, toRenderer);
          q.setFromAxisAngle(up, pose.yaw);
          s.set(w.placement.mirror ? -1 : 1, 1, 1);
          base.compose(pose.centre, q, s).multiply(part.matrix);
          im.setMatrixAt(0, base);
          im.instanceMatrix.needsUpdate = true;
          im.computeBoundingBox();
          im.computeBoundingSphere();
          group.add(im);
          stats.drawCalls++;
          stats.triangles += trianglesOf(part.geometry);
        });
      }
      return { group, stats };
    },
    dispose() {
      for (const o of owned) o.dispose();
      for (const gltf of gltfs) disposeGltf(gltf);
    },
  };
}

/** Free a loaded GLTF's geometries, materials and their maps (shared maps are disposed once per material). */
function disposeGltf(gltf: GLTF) {
  gltf.scene.traverse((o) => {
    const m = o as THREE_NS.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const mat = m.material as THREE_NS.MeshStandardMaterial;
    for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.emissiveMap, mat.aoMap]) t?.dispose();
    mat.dispose();
  });
}

export interface NosingStats {
  /** Placed strips merged (a reused id counts once per placement). */
  parts: number;
  uniqueGlbs: number;
  /** Merged meshes = colour draws before frustum culling and extra render passes. */
  clusters: number;
  drawCalls: number;
  triangles: number;
}

export interface LoadedNosingKit {
  /** The strips that will be drawn (empty when the tier ships no atlas or no nosing GLB). */
  placements: readonly CatalogPart[];
  /** Catalog ids this tier draws but the station does not ship, or that failed to load. */
  skippedIds: readonly string[];
  /** Build the merged cluster meshes. `env` lights them (the scene's own PMREM environment). */
  build(THREE: ThreeNS, env: THREE_NS.Texture, toRenderer: (x: number, y: number, z: number) => THREE_NS.Vector3): { group: THREE_NS.Group; stats: NosingStats };
  dispose(): void;
}

/** The same texture object, the same decoded image, or (for GLB-embedded images, which arrive as a fresh ImageBitmap
 *  per load) an image of the same shape. */
function sameTexture(a: THREE_NS.Texture | null | undefined, b: THREE_NS.Texture | null | undefined) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.source === b.source) return true;
  const ia = a.image as { src?: string; width?: number; height?: number } | null;
  const ib = b.image as { src?: string; width?: number; height?: number } | null;
  if (!ia || !ib) return false;
  if (ia.src && ib.src && ia.src === ib.src) return true;
  return typeof ia.width === "number" && ia.width === ib.width && ia.height === ib.height;
}

/** Two catalog materials that may share one merged material: same look, whatever the source map objects. Anything
 *  that differs visibly (colour, finish, emissive strength, alpha cutoff, vertex colours, base-colour map) is not. */
function sameLook(a: THREE_NS.MeshStandardMaterial, b: THREE_NS.MeshStandardMaterial) {
  return a.name === b.name && a.color.equals(b.color) && a.roughness === b.roughness && a.metalness === b.metalness &&
    a.emissive.equals(b.emissive) && a.opacity === b.opacity && a.side === b.side && a.transparent === b.transparent &&
    a.vertexColors === b.vertexColors && a.emissiveIntensity === b.emissiveIntensity && a.alphaTest === b.alphaTest &&
    sameTexture(a.map, b.map);
}

/** A clone of a part's geometry with `matrix` baked in. The clone is always indexed first, so a cluster never mixes
 *  indexed and non-indexed inputs (mergeGeometries refuses that). `applyMatrix4` rewrites positions and normals but
 *  leaves the winding, so a mirror (negative determinant) reverses every triangle to keep face normals outwards. */
function bakedGeometry(THREE: ThreeNS, source: THREE_NS.BufferGeometry, matrix: THREE_NS.Matrix4): THREE_NS.BufferGeometry {
  const g = source.clone();
  g.applyMatrix4(matrix);
  if (!g.index) {
    const count = g.getAttribute("position").count;
    const order = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
    for (let i = 0; i < count; i++) order[i] = i;
    g.setIndex(new THREE.BufferAttribute(order, 1));
  }
  if (matrix.determinant() < 0) {
    const index = g.index!;
    for (let t = 0; t < index.count; t += 3) {
      const b = index.getX(t + 1);
      index.setX(t + 1, index.getX(t + 2));
      index.setX(t + 2, b);
    }
  }
  return g;
}

/** Deterministic k-means over the strip centres, seeded farthest-first, so one tier's clusters never depend on
 *  iteration order. Returns the (0-based, seed-ordered) cluster of each centre; empty clusters get no mesh. */
function clusterByDistance(THREE: ThreeNS, centres: readonly THREE_NS.Vector3[], k: number): number[] {
  const n = centres.length;
  if (k >= n) return centres.map((_, i) => i);
  const mean = new THREE.Vector3();
  for (const c of centres) mean.add(c);
  mean.divideScalar(n);
  let first = 0, close = Infinity;
  for (let i = 0; i < n; i++) {
    const d = centres[i]!.distanceToSquared(mean);
    if (d < close) { close = d; first = i; }
  }
  const nearest = centres.map((c) => c.distanceToSquared(centres[first]!));
  const centroids = [centres[first]!.clone()];
  while (centroids.length < k) {
    let pick = 0, far = -1;
    for (let i = 0; i < n; i++) if (nearest[i]! > far) { far = nearest[i]!; pick = i; }
    centroids.push(centres[pick]!.clone());
    for (let i = 0; i < n; i++) nearest[i] = Math.min(nearest[i]!, centres[i]!.distanceToSquared(centres[pick]!));
  }
  const labels = new Array<number>(n).fill(-1);
  for (let iter = 0; iter < 12; iter++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let pick = 0, best = Infinity;
      for (let j = 0; j < k; j++) {
        const d = centres[i]!.distanceToSquared(centroids[j]!);
        if (d < best) { best = d; pick = j; }
      }
      if (labels[i] !== pick) { labels[i] = pick; moved = true; }
    }
    const sums = centroids.map(() => new THREE.Vector3()), counts = centroids.map(() => 0);
    for (let i = 0; i < n; i++) { sums[labels[i]!]!.add(centres[i]!); counts[labels[i]!]!++; }
    for (let j = 0; j < k; j++) if (counts[j]) centroids[j]!.copy(sums[j]!.divideScalar(counts[j]!));
    if (!moved) break;
  }
  return labels;
}

/**
 * Batch C: loads the nosing strips this tier draws and merges them per spatial cluster into one geometry each, with
 * one shared material that samples the tier's packed AO atlas through TEXCOORD_1. Never throws: a tier without the
 * atlas or a GLB that fails to load drops its own placements only. The merge runs once, in build(), after every
 * loaded strip is in (no progressive rebuilds).
 */
export async function loadNosingKit(
  THREE: ThreeNS,
  host: Host,
  placements: readonly CatalogPlacement[],
  low: boolean,
  isDisposed: () => boolean = () => false,
): Promise<LoadedNosingKit> {
  const wanted = tierParts(placements, low).filter((w) => w.part === "nosing");
  const atlasUri = nosingAtlasUri(low);
  const assets = new Map<string, ReturnType<typeof visibleParts>>();
  const gltfs: GLTF[] = [];
  const skipped = new Set<string>();
  const owned: { dispose(): void }[] = [];
  let atlas: THREE_NS.Texture | null = null;
  let source: THREE_NS.MeshStandardMaterial | null = null;
  const skipAll = () => { for (const w of wanted) skipped.add(w.id); };
  /** Free everything loaded so far (the caller disposed the kit mid-flight) and hand back an inert kit. */
  const abandoned = (): LoadedNosingKit => {
    for (const o of owned) o.dispose();
    owned.length = 0;
    for (const gltf of gltfs) disposeGltf(gltf);
    gltfs.length = 0;
    atlas = null;
    return {
      placements: [], skippedIds: [...skipped].sort(),
      build: (T: ThreeNS) => ({ group: new T.Group(), stats: { parts: 0, uniqueGlbs: 0, clusters: 0, drawCalls: 0, triangles: 0 } }),
      dispose() {},
    };
  };
  if (wanted.length && host.assetUrl(atlasUri) === null) skipAll(); // no atlas on this tier: batch C is not shipped
  else if (wanted.length) {
    try {
      // AO is data, not colour: no sRGB transfer; the strips' TEXCOORD_1 already addresses the atlas top-down.
      atlas = await host.loadTexture(atlasUri, { colorSpace: "linear", flipY: false });
      if (isDisposed()) return abandoned();
      prepareAtlas(THREE, atlas, atlasUri, "nosing", low);
      owned.push(atlas);
    } catch (err) {
      atlas = null;
      skipAll();
      console.warn(`[ikebukuro] kit catalog: nosing atlas ${atlasUri}: ${err instanceof Error ? err.message : String(err)}; skipping`);
    }
  }
  if (atlas) for (const id of [...new Set(wanted.map((w) => w.id))].sort()) {
    if (isDisposed()) return abandoned();
    const uri = catalogUri(id, low);
    if (host.assetUrl(uri) === null) {
      skipped.add(id); // not part of this batch: the station ships other catalog ids only
      continue;
    }
    try {
      const gltf = await host.loadGlb(uri);
      gltfs.push(gltf);
      const parts = visibleParts(THREE, gltf).filter((p) => {
        // One merged material: a part with a different look would be wrong under it, so leave that part out.
        const material = p.material as THREE_NS.MeshStandardMaterial;
        if (!material.isMeshStandardMaterial) {
          console.warn(`[ikebukuro] kit catalog: ${id}: a part is not MeshStandardMaterial; skipping that part`);
          return false;
        }
        // The merge needs these on every input. uv is batch C's base-colour map: optional, and a cluster drops it
        // only when one of its parts lacks it.
        const missing = ["position", "normal", "uv1"].filter((name) => !p.geometry.getAttribute(name));
        if (missing.length) {
          console.warn(`[ikebukuro] kit catalog: ${id}: a part lacks ${missing.join("/")}; skipping that part`);
          return false;
        }
        if (source && !sameLook(source, material)) {
          console.warn(`[ikebukuro] kit catalog: ${id}: material ${material.name} differs from ${source.name}; skipping that part`);
          return false;
        }
        if (!source) source = material; // the first accepted part of the first GLB sets the look
        return true;
      });
      if (!parts.length) throw new Error(`${uri} has no visible mesh`);
      assets.set(id, parts);
    } catch (err) {
      skipped.add(id);
      console.warn(`[ikebukuro] kit catalog: ${id}: ${err instanceof Error ? err.message : String(err)}; skipping`);
    }
  }
  const drawn = wanted.filter((w) => assets.has(w.id));
  if (wanted.length)
    console.info(
      `[ikebukuro] kit catalog (${tierName(low)}): nosing ${drawn.length} of ${wanted.length} strips from ${assets.size} GLBs, ` +
        `${wanted.length - drawn.length} skipped (${skipped.size} ids not shipped or unloadable)`,
    );
  return {
    placements: drawn,
    skippedIds: [...skipped].sort(),
    build(THREE, env, toRenderer) {
      const group = new THREE.Group();
      group.name = "ikebukuro_kit_catalog_nosing";
      group.userData = { gteki_role: "kit_catalog" };
      const stats: NosingStats = { parts: 0, uniqueGlbs: assets.size, clusters: 0, drawCalls: 0, triangles: 0 };
      if (!drawn.length || !source || !atlas) return { group, stats };
      const material = source.clone();
      material.envMap = env;
      material.envMapIntensity = KIT_ENV_INTENSITY;
      material.aoMap = atlas;
      material.aoMapIntensity = 1;
      owned.push(material);
      const centres = drawn.map((w) => piecePose(THREE, w.placement, toRenderer).centre);
      const labels = clusterByDistance(THREE, centres, Math.min(NOSING_CLUSTERS, drawn.length));
      const buckets = new Map<number, CatalogPart[]>();
      drawn.forEach((w, i) => buckets.set(labels[i]!, [...(buckets.get(labels[i]!) ?? []), w]));
      const base = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      for (const [cluster, mine] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
        const geoms: THREE_NS.BufferGeometry[] = [];
        for (const w of mine) {
          const pose = piecePose(THREE, w.placement, toRenderer);
          q.setFromAxisAngle(up, pose.yaw);
          s.set(w.placement.mirror ? -1 : 1, 1, 1);
          stats.parts++;
          for (const part of assets.get(w.id)!) {
            base.compose(pose.centre, q, s).multiply(part.matrix);
            geoms.push(bakedGeometry(THREE, part.geometry, base));
            stats.triangles += trianglesOf(part.geometry);
          }
        }
        // mergeGeometries needs one attribute set for every input: position, normal and uv1 are required per part, and
        // uv (the base-colour map's UVs) is kept only when every part of the cluster carries it.
        const keep = ["position", "normal", "uv1"].concat(geoms.every((g) => g.getAttribute("uv")) ? ["uv"] : []);
        for (const g of geoms) for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
        const merged = mergeGeometries(geoms, false);
        for (const g of geoms) g.dispose(); // mergeGeometries copies; the baked clones are throwaway
        if (!merged) {
          console.warn(`[ikebukuro] kit catalog: nosing cluster ${cluster}: merge failed; skipping`);
          continue;
        }
        merged.computeBoundingBox();
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, material);
        mesh.name = `kit_catalog:nosing:${cluster}`;
        mesh.userData = { gteki_role: "kit_catalog", gteki_anchors: mine.map((w) => w.placement.anchor), gteki_shadow: "none" };
        mesh.frustumCulled = true;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        owned.push(merged);
        group.add(mesh);
        stats.clusters++;
        stats.drawCalls++;
      }
      return { group, stats };
    },
    dispose() {
      for (const o of owned) o.dispose();
      for (const gltf of gltfs) disposeGltf(gltf);
    },
  };
}

/** Start from the attached scene's first update. The next task runs after that frame has rendered; GLBs then
 * load serially (one in flight) and attach individually, without holding up buildScene or the explorer's ready. */
export function lazyKitCatalog(
  THREE: ThreeNS,
  host: Host,
  placements: readonly CatalogPlacement[],
  low: boolean,
  root: THREE_NS.Object3D,
  env: THREE_NS.Texture,
  toRenderer: (x: number, y: number, z: number) => THREE_NS.Vector3,
) {
  const wanted = tierParts(placements, low);
  // Batches A and B load and attach one id at a time; batch C's strips merge, so they load after them and attach
  // as a handful of cluster meshes once every strip is in.
  const instanced = wanted.filter((w) => w.part !== "nosing");
  const ids = [...new Set(instanced.map((w) => w.id))].sort();
  const nosingIds = [...new Set(wanted.filter((w) => w.part === "nosing").map((w) => w.id))];
  const loaded: (LoadedCatalogKit | LoadedNosingKit)[] = [];
  const groups: THREE_NS.Group[] = [];
  const visibility = catalogVisibility(THREE);
  let disposed = false;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finish!: () => void;
  // Resolves once the background build has ended (finished, failed or disposed); never rejects. Batch C's nosing
  // load runs inside the same load(), so settled() waits for it too.
  const done = new Promise<void>((resolve) => (finish = resolve));
  const attach = (kit: LoadedCatalogKit | LoadedNosingKit) => {
    const { group } = kit.build(THREE, env, toRenderer);
    if (group.children.length) {
      groups.push(group);
      root.add(group);
      visibility.add(group);
    }
  };
  const load = async () => {
    for (const id of ids) {
      if (disposed) return;
      if (host.assetUrl(catalogUri(id, low)) === null) continue;
      const selected = instanced.filter((w) => w.id === id).map((w) => ({
        ...w.placement, ids: { [w.part]: id },
      }));
      const kit = await loadKitCatalog(THREE, host, selected, low);
      if (disposed) { kit.dispose(); return; }
      loaded.push(kit);
      attach(kit);
    }
    if (!nosingIds.length) return;
    const nosing = await loadNosingKit(THREE, host, placements, low, () => disposed);
    if (disposed) { nosing.dispose(); return; }
    loaded.push(nosing);
    attach(nosing);
  };
  return {
    update: visibility.update,
    start() {
      if (started || disposed) return;
      started = true;
      // A station that ships batch C alone still has work to do after the instanced ids.
      if (!ids.length && !nosingIds.length) return finish();
      timer = setTimeout(() => {
        timer = undefined;
        void load()
          .catch((err) => console.warn("[ikebukuro] kit catalog: background build failed; skipping remaining pieces", err))
          .finally(finish);
      }, 0);
    },
    /** Starts the build if needed and resolves when it has ended: for hosts that export rather than render. */
    settled() {
      this.start();
      return done;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      finish();
      for (const group of groups) group.removeFromParent();
      for (const kit of loaded) kit.dispose();
      loaded.length = 0;
      groups.length = 0;
      visibility.clear();
    },
  };
}
