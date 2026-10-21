import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { docsRoot, getStoredSource, getStoreRoot, packageRoot, readJson, repoRoot, writeJson, TOOL_VERSION, type SourceManifest } from './common.js';
import { loadFrame, toGltf, fromGltf, type Point3 } from './crs.js';
import { stationEnuProjector, stationLocal, isStationEnuFrame, STATION_ENU_FRAME_ID_PATTERN, type StationEnuFrame } from './station-enu.js';
import { scanContextFeatures, type ContextFeatureRecord, type ContextKind, type ContextScanSummary, type LodDigit } from './context-scan.js';
import { triangulate } from './triangulate.js';
import { toolFingerprint } from './provenance.js';
import { bboxIntersectsAnyDisc, buildContextWindow, meshesTouchedByWindow, missingMeshSources, WINDOW_RULE, type ContextWindow, type Disc, type NodeRule } from './context-window.js';

/** Bump when the selection, LOD, window or merge rules change; part of the run id. */
export const CONTEXT_POLICY_VERSION = 'context-v2';
export const CONTEXT_ROLE = 'context';
/** Every glTF node role word the explorer (packages/scene-api roleOf) acts on. Context node names must never match one. */
export const EXPLORER_ROLE_WORDS = ['floor', 'stairs_ramps', 'walkable', 'ramp', 'stairs', 'wall', 'walls', 'barriers', 'barrier', 'transport', 'collider', 'camera_blocker', 'sign', 'signs', 'signage'] as const;

export const SELECTION_RULE = `A top-level bldg:Building / tran:Road is selected when the XY bounding box of all its polygon vertices (every LOD) in the station frame intersects any closed disc of the window (the union of a disc of R_origin around the frame origin and a disc of R_exit around each exit connector / street-level graph node). Selected features are converted whole; geometry is never cut at the window edge. ${WINDOW_RULE}`;
export const LOD_POLICY = 'Buildings: LOD2 where the building has lod2Solid or a lod2MultiSurface boundary (all inline LOD2 polygons incl. installations), else LOD1; LOD0 is never converted; one LOD per building (a building whose LOD2 solid references do not all resolve to its own inline LOD2 polygons falls back to LOD1, never a mix). Roads: LOD3 only, because LOD1/LOD2 road geometry is flat at z=0; roads without LOD3 height are excluded and counted; no ground height is ever synthesised.';
export const LOD_POLICY_LOW = 'Variant low: buildings use LOD1 only (LOD0 is never converted; a building without LOD1 polygons is excluded and counted, never replaced by LOD2). Roads: LOD3 only, as in the high variant, because LOD1/LOD2 road geometry is flat at z=0; road triangles are reported separately so they can be dropped from low. No geometry is decimated or simplified; no ground height is ever synthesised.';

export type ContextVariant = 'high' | 'low';
export type MergeSpec = { mode: 'none' } | { mode: 'kind' } | { mode: 'tiles'; sizeM: number };
export const DEFAULT_MERGE = 'kind';
export function parseMergeSpec(text: string): MergeSpec {
  if (text === 'none') return { mode: 'none' };
  if (text === 'kind') return { mode: 'kind' };
  const match = /^tiles:(\d+(?:\.\d+)?)$/.exec(text);
  if (match) {
    const sizeM = Number(match[1]);
    if (!Number.isFinite(sizeM) || sizeM < 10 || sizeM > 5000) throw new Error('tiles:<size_m> needs a tile size between 10 and 5000 metres');
    return { mode: 'tiles', sizeM };
  }
  throw new Error(`Invalid --merge ${JSON.stringify(text)}: expected none, kind or tiles:<size_m>`);
}
export function mergeLabel(spec: MergeSpec): string { return spec.mode === 'tiles' ? `tiles:${spec.sizeM}` : spec.mode; }
export function parseVariant(text: string): ContextVariant {
  if (text === 'high' || text === 'low') return text;
  throw new Error(`Invalid --variant ${JSON.stringify(text)}: expected high or low`);
}

export const ALL_KINDS: readonly ContextKind[] = ['bldg', 'tran'];
/** `--kinds bldg,tran`: a non-empty subset of bldg and tran, returned in canonical order. */
export function parseKinds(value: string | readonly string[]): ContextKind[] {
  const items = typeof value === 'string' ? value.split(',').map((v) => v.trim()) : [...value];
  if (!items.length || items.some((k) => k !== 'bldg' && k !== 'tran')) throw new Error(`Invalid --kinds ${JSON.stringify(typeof value === 'string' ? value : value.join(','))}: expected bldg and/or tran (comma separated)`);
  return ALL_KINDS.filter((k) => items.includes(k));
}
const kindsLabel = (kinds: readonly ContextKind[]): string => kinds.join(',');

const MATERIALS: Record<string, [number, number, number, number]> = {
  building_wall: [0.78, 0.76, 0.72, 1], building_roof: [0.55, 0.5, 0.48, 1], building_other: [0.7, 0.69, 0.67, 1], road_surface: [0.36, 0.37, 0.39, 1],
  building: [0.7, 0.69, 0.67, 1],
};
const PER_FEATURE_MATERIALS = ['building_wall', 'building_roof', 'building_other', 'road_surface'];
const MERGED_MATERIALS = ['building', 'road_surface'];

export interface ContextInput { sourceId: string; sourceSha256: string; kind: ContextKind; path: string; attributionText: string }
export interface ContextBuildArgs {
  frame: StationEnuFrame;
  /** Origin-disc-only window (legacy shape). Ignored when `window` is given. */
  radiusM?: number;
  window?: ContextWindow;
  inputs: ContextInput[];
  outputPath: string;
  /** Library default is the per-feature layout of PR #96 (`none`); the CLI/config default is `kind`. */
  merge?: MergeSpec;
  variant?: ContextVariant;
  /** Kinds to convert (default both). Inputs of an excluded kind are never opened. */
  kinds?: readonly ContextKind[];
}
export type ExclusionReason =
  | 'missing_gml_id' | 'duplicate_gml_id' | 'no_polygon_geometry'
  | 'building_lod0_only_not_converted' | 'building_lod2_unresolved_refs_and_no_lod1' | 'building_no_lod1_excluded_in_low_variant'
  | 'road_no_lod3_lod1_lod2_flat_z0' | 'road_lod3_flat_z0' | 'no_convertible_polygons';
interface SourceCounts {
  source_id: string; source_sha256: string; kind: ContextKind; features_in_source: number; outside_window: number; selected: number; converted: number;
  excluded: Partial<Record<ExclusionReason, number>>; lod_used: Record<string, number>; lod2_fallback_to_lod1: number; unresolved_refs_in_drawn_lod: number; skipped_degenerate_polygons: number;
  footprint_scan: ContextScanSummary; collect_pass_top_level_features: number;
}
interface Group { positions: number[]; normals: number[]; indices: number[] }
interface Built {
  gml_id: string; kind: ContextKind; type: 'Building' | 'Road'; source: ContextInput; lod_used: string; lod_fallback: string | null;
  groups: Map<string, Group>; polygons_converted: number; polygons_degenerate: number; unresolved_refs: number;
}
interface Bucket {
  name: string; kind: ContextKind; tile: [number, number] | null; groups: Map<string, Group>; triangles: number; features: number;
  lodUsed: Record<string, number>; sources: Map<string, string>; attributions: Set<string>; single: Built | null;
}

/** Whether a station-frame XY box meets the closed disc of radius R about the origin. */
export function bboxIntersectsDisc(box: { minX: number; minY: number; maxX: number; maxY: number }, radiusM: number): boolean {
  const dx = Math.max(box.minX, 0, -box.maxX), dy = Math.max(box.minY, 0, -box.maxY);
  return Math.hypot(dx, dy) <= radiusM;
}
export function contextNodeName(kind: ContextKind, gmlId: string): string { return kind === 'bldg' ? `ctx_bldg_${gmlId}` : `ctx_road_${gmlId}`; }
const pad = (n: number, width: number): string => String(n).padStart(width, '0');
/** Role-safe names of merged meshes: `ctx_bldg_all`, `ctx_road_all`, `ctx_bldg_t03_05` (tile column, tile row). */
export function contextMergedName(kind: ContextKind, tile: [number, number] | null, tileDigits = 2): string {
  const stem = kind === 'bldg' ? 'ctx_bldg_' : 'ctx_road_';
  return tile === null ? `${stem}all` : `${stem}t${pad(tile[0], tileDigits)}_${pad(tile[1], tileDigits)}`;
}
/** The explorer's role test for a node name (packages/scene-api roleOf, name branch), kept here so tests and the readback share it. */
export function explorerRoleFromName(name: string): string | null {
  const lower = name.toLowerCase();
  for (const role of EXPLORER_ROLE_WORDS) if (lower === role || lower.startsWith(`${role}_`) || lower.startsWith(`${role}.`)) return role;
  return null;
}

const flat = (range: [number, number] | undefined): boolean => !range || (Math.abs(range[0]) < 1e-9 && Math.abs(range[1]) < 1e-9);
const bump = <K extends string>(record: Partial<Record<K, number>>, key: K): void => { record[key] = (record[key] ?? 0) + 1; };

/** Decide which LOD a feature is drawn at from pass-1 facts alone. `null` lod means excluded with `reason`. */
function planFeature(record: ContextFeatureRecord, variant: ContextVariant): { lod: LodDigit | null; reason?: ExclusionReason } {
  if (record.type === 'Building') {
    if (variant === 'low') return record.polygons_by_lod[1] > 0 ? { lod: 1 } : { lod: null, reason: 'building_no_lod1_excluded_in_low_variant' };
    const has2 = record.lod_properties.some((p) => p === 'lod2Solid' || p === 'lod2MultiSurface') && record.polygons_by_lod[2] > 0;
    if (has2) return { lod: 2 };
    if (record.polygons_by_lod[1] > 0) return { lod: 1 };
    return { lod: null, reason: 'building_lod0_only_not_converted' };
  }
  if (record.polygons_by_lod[3] === 0) return { lod: null, reason: 'road_no_lod3_lod1_lod2_flat_z0' };
  if (flat(record.height_range_by_lod[3])) return { lod: null, reason: 'road_lod3_flat_z0' };
  return { lod: 3 };
}

function materialFor(kind: ContextKind, surface: string | null, normalY: number, merged: boolean): string {
  if (kind === 'tran') return 'road_surface';
  if (merged) return 'building'; // one material per kind in the merged layouts
  if (surface === 'WallSurface') return 'building_wall';
  if (surface === 'RoofSurface') return 'building_roof';
  if (surface === null) return normalY > 0.7 ? 'building_roof' : 'building_wall'; // LOD1 solids carry no surface semantics
  return 'building_other';
}

function convertFeature(record: ContextFeatureRecord, plan: { lod: LodDigit }, input: ContextInput, frame: StationEnuFrame, counts: SourceCounts, merged: boolean): Built | null {
  const polygons = record.polygons ?? [];
  let lod: LodDigit = plan.lod, fallback: string | null = null;
  const inlineIds = (digit: LodDigit): Set<string> => new Set(polygons.filter((p) => p.lod === digit && p.polygon_id !== null).map((p) => p.polygon_id!));
  const unresolvedAt = (digit: LodDigit): number => { const ids = inlineIds(digit); return record.refs.filter((r) => r.lod === digit && !ids.has(r.target)).length; };
  if (record.type === 'Building' && lod === 2 && unresolvedAt(2) > 0) {
    if (record.polygons_by_lod[1] === 0) { bump(counts.excluded, 'building_lod2_unresolved_refs_and_no_lod1'); return null; }
    lod = 1; fallback = 'LOD2 solid references did not all resolve to inline LOD2 polygons of this building; LOD1 used instead (never a mix)';
    counts.lod2_fallback_to_lod1++;
  }
  counts.unresolved_refs_in_drawn_lod += unresolvedAt(lod);
  const built: Built = { gml_id: record.gml_id!, kind: input.kind, type: record.type, source: input, lod_used: `LOD${lod}`, lod_fallback: fallback, groups: new Map(), polygons_converted: 0, polygons_degenerate: 0, unresolved_refs: unresolvedAt(lod) };
  for (const polygon of polygons) {
    if (polygon.lod !== lod) continue; // never two LODs for one feature; LOD0 is never drawn
    const rings = polygon.rings.map((ring) => ring.map((p) => toGltf(stationLocal(p, frame))));
    const geometry = triangulate(rings);
    if (!geometry) { built.polygons_degenerate++; counts.skipped_degenerate_polygons++; continue; }
    const material = materialFor(input.kind, polygon.surface, geometry.normal[1], merged);
    let group = built.groups.get(material);
    if (!group) { group = { positions: [], normals: [], indices: [] }; built.groups.set(material, group); }
    const offset = group.positions.length / 3;
    for (const p of geometry.positions) { group.positions.push(p[0], p[1], p[2]); group.normals.push(geometry.normal[0], geometry.normal[1], geometry.normal[2]); }
    for (const i of geometry.indices) group.indices.push(offset + i);
    built.polygons_converted++;
  }
  if (!built.polygons_converted) { bump(counts.excluded, 'no_convertible_polygons'); return null; }
  return built;
}

const triangleTotal = (groups: Map<string, Group>): number => { let n = 0; for (const g of groups.values()) n += g.indices.length / 3; return n; };

/** Two bounded passes per source, then one GLB. No store or docs access: the CLI wrapper adds provenance around it. */
export async function buildContextGlb(args: ContextBuildArgs) {
  const { frame, outputPath } = args;
  const kinds = parseKinds(args.kinds ?? ALL_KINDS);
  const inputs = args.inputs.filter((i) => kinds.includes(i.kind));
  const merge: MergeSpec = args.merge ?? { mode: 'none' };
  const variant: ContextVariant = args.variant ?? 'high';
  if (!isStationEnuFrame(frame)) throw new Error('context conversion requires a station-enu frame');
  const window = args.window ?? await buildContextWindow({ r_origin_m: args.radiusM as number, r_exit_m: 0 }, { stationId: frame.station_id });
  if (!inputs.length) throw new Error(`context conversion needs at least one source of kind ${kindsLabel(kinds)}`);
  const merged = merge.mode !== 'none';
  const discs: readonly Disc[] = window.discs;
  const project = stationEnuProjector(frame.origin);
  // Tile grid anchor: the window bounding box floored to the tile size, so tile names are stable across variants and sources.
  const windowMin = { x: Math.min(...discs.map((d) => d.x - d.r)), y: Math.min(...discs.map((d) => d.y - d.r)) };
  const windowMax = { x: Math.max(...discs.map((d) => d.x + d.r)), y: Math.max(...discs.map((d) => d.y + d.r)) };
  const tileSize = merge.mode === 'tiles' ? merge.sizeM : 0;
  const gridX0 = tileSize ? Math.floor(windowMin.x / tileSize) * tileSize : 0, gridY0 = tileSize ? Math.floor(windowMin.y / tileSize) * tileSize : 0;
  const tilesAcross = tileSize ? Math.max(Math.ceil((windowMax.x - gridX0) / tileSize), Math.ceil((windowMax.y - gridY0) / tileSize)) : 0;
  const tileDigits = Math.max(2, String(tilesAcross).length);
  let tilesClamped = 0;
  const tileOf = (box: { minX: number; minY: number; maxX: number; maxY: number }): [number, number] => {
    const raw: [number, number] = [Math.floor(((box.minX + box.maxX) / 2 - gridX0) / tileSize), Math.floor(((box.minY + box.maxY) / 2 - gridY0) / tileSize)];
    const clamped: [number, number] = [Math.max(0, raw[0]), Math.max(0, raw[1])];
    if (clamped[0] !== raw[0] || clamped[1] !== raw[1]) tilesClamped++; // the centre of a huge feature can sit outside the window box; its tile is for culling only
    return clamped;
  };

  const document = new Document(), buffer = document.createBuffer();
  const attribution = [...new Set(inputs.map((i) => i.attributionText))].join(' / ');
  document.getRoot().getAsset().copyright = attribution;
  const scene = document.createScene('UNVERIFIED NOT_FOR_ROUTING street-level context (visual only)');
  const materials = Object.fromEntries((merged ? MERGED_MATERIALS : PER_FEATURE_MATERIALS).map((name) => [name, document.createMaterial(name).setBaseColorFactor(MATERIALS[name]!).setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(true)]));
  const seenIds = new Set<string>();
  const perSource: SourceCounts[] = [];
  const perFeature: Array<Record<string, unknown>> = [];
  const selectedIds: string[] = [];
  const buckets = new Map<string, Bucket>();
  const order: Bucket[] = [];
  let tilesUsed = 0;

  const bucketFor = (built: Built, tile: [number, number] | null): Bucket => {
    const name = merge.mode === 'none' ? contextNodeName(built.kind, built.gml_id) : contextMergedName(built.kind, merge.mode === 'tiles' ? tile : null, tileDigits);
    let bucket = buckets.get(name);
    if (!bucket) {
      bucket = { name, kind: built.kind, tile: merge.mode === 'tiles' ? tile : null, groups: new Map(), triangles: 0, features: 0, lodUsed: {}, sources: new Map(), attributions: new Set(), single: merge.mode === 'none' ? built : null };
      buckets.set(name, bucket); order.push(bucket);
      if (bucket.tile) tilesUsed++;
    }
    return bucket;
  };

  for (const input of inputs) {
    const empty = (): ContextScanSummary => ({ envelope: null, srs_names: [], top_level_features: 0, other_top_level_elements: {}, polygons_without_lod: 0, unconsumed_coordinate_elements: {}, unsupported_geometry_elements: {}, external_href_count: 0 });
    const counts: SourceCounts = { source_id: input.sourceId, source_sha256: input.sourceSha256, kind: input.kind, features_in_source: 0, outside_window: 0, selected: 0, converted: 0, excluded: {}, lod_used: {}, lod2_fallback_to_lod1: 0, unresolved_refs_in_drawn_lod: 0, skipped_degenerate_polygons: 0, footprint_scan: empty(), collect_pass_top_level_features: 0 };
    // Pass 1: ids + XY bbox + LOD facts only.
    const plans = new Map<string, { lod: LodDigit; tile: [number, number] | null }>();
    counts.footprint_scan = await scanContextFeatures(input.path, {
      kind: input.kind, mode: 'footprint', project,
      onFeature: (record) => {
        counts.features_in_source++;
        if (record.gml_id === null) { bump(counts.excluded, 'missing_gml_id'); return; }
        if (!record.bbox) { bump(counts.excluded, 'no_polygon_geometry'); return; }
        if (!bboxIntersectsAnyDisc(record.bbox, discs)) { counts.outside_window++; return; }
        counts.selected++;
        if (seenIds.has(record.gml_id) || plans.has(record.gml_id)) { bump(counts.excluded, 'duplicate_gml_id'); return; }
        const plan = planFeature(record, variant);
        if (plan.lod === null) { bump(counts.excluded, plan.reason!); return; }
        plans.set(record.gml_id, { lod: plan.lod, tile: merge.mode === 'tiles' ? tileOf(record.bbox) : null });
      },
    });
    // Pass 2: only the selected, convertible features are retained, converted on arrival and discarded.
    const collectScan = await scanContextFeatures(input.path, {
      kind: input.kind, mode: 'collect', retain: (id) => plans.has(id),
      onFeature: (record) => {
        const plan = record.gml_id === null ? undefined : plans.get(record.gml_id);
        if (!plan || seenIds.has(record.gml_id!)) return;
        seenIds.add(record.gml_id!);
        selectedIds.push(record.gml_id!);
        const built = convertFeature(record, plan, input, frame, counts, merged);
        if (!built) return;
        const bucket = bucketFor(built, plan.tile);
        const triStart = bucket.triangles;
        const triangles = triangleTotal(built.groups);
        for (const [material, group] of built.groups) {
          let target = bucket.groups.get(material);
          if (!target) { target = { positions: [], normals: [], indices: [] }; bucket.groups.set(material, target); }
          const offset = target.positions.length / 3;
          for (const v of group.positions) target.positions.push(v);
          for (const v of group.normals) target.normals.push(v);
          for (const i of group.indices) target.indices.push(offset + i);
        }
        bucket.triangles += triangles; bucket.features++;
        bucket.lodUsed[built.lod_used] = (bucket.lodUsed[built.lod_used] ?? 0) + 1;
        bucket.sources.set(input.sourceId, input.sourceSha256); bucket.attributions.add(input.attributionText);
        counts.converted++;
        counts.lod_used[built.lod_used] = (counts.lod_used[built.lod_used] ?? 0) + 1;
        // tri_start/tri_count index the merged mesh's triangle sequence (in the per-feature layout every node starts at 0).
        perFeature.push({ gml_id: built.gml_id, node: bucket.name, mesh: bucket.name, type: built.type, source_id: input.sourceId, lod_used: built.lod_used, lod_fallback: built.lod_fallback, polygons_converted: built.polygons_converted, polygons_degenerate: built.polygons_degenerate, unresolved_refs: built.unresolved_refs, triangles, tri_start: triStart, tri_count: triangles });
      },
    });
    counts.collect_pass_top_level_features = collectScan.top_level_features;
    if (collectScan.top_level_features !== counts.footprint_scan.top_level_features || counts.converted + (counts.excluded.no_convertible_polygons ?? 0) + (counts.excluded.building_lod2_unresolved_refs_and_no_lod1 ?? 0) !== plans.size) throw new Error(`Context passes disagree for ${input.sourceId}: the source changed between passes or a selected feature went missing`);
    perSource.push(counts);
  }
  if (!order.length) throw new Error('No context feature was converted; no GLB written');

  // Feature table coverage: in every merged mesh the feature ranges tile [0, triangles) exactly once (one material per mesh).
  const ranges = new Map<string, Array<[number, number]>>();
  for (const row of perFeature) { const list = ranges.get(row.mesh as string) ?? []; list.push([row.tri_start as number, row.tri_count as number]); ranges.set(row.mesh as string, list); }
  if (merged) for (const bucket of order) {
    let cursor = 0;
    for (const [start, count] of ranges.get(bucket.name) ?? []) { if (start !== cursor) throw new Error(`Feature table does not tile ${bucket.name} at triangle ${cursor}`); cursor += count; }
    if (cursor !== bucket.triangles) throw new Error(`Feature table covers ${cursor} of ${bucket.triangles} triangles of ${bucket.name}`);
  }

  // Emit meshes: per-feature nodes in file order; merged meshes sorted by name.
  const emitted = merged ? [...order].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) : order;
  const windowExtras = { kinds, r_origin_m: window.spec.r_origin_m, r_exit_m: window.spec.r_exit_m, disc_count: discs.length, node_rule: window.spec.node_rule, mesh_margin_m: window.spec.mesh_margin_m, graph_sha256: window.graph?.graph_sha256 ?? null, pois_sha256: window.graph?.pois?.pois_sha256 ?? null };
  let triangleCount = 0, drawCalls = 0;
  const meshReport: Array<Record<string, unknown>> = [];
  const trianglesByKind: Record<ContextKind, number> = { bldg: 0, tran: 0 };
  let localBBox: { min: Point3; max: Point3 } | null = null;
  for (const bucket of emitted) {
    const common = { gteki_role: CONTEXT_ROLE, navigation_use: 'NOT_FOR_ROUTING', visual_only: true, verification: 'UNVERIFIED', geometry_status: 'UNVERIFIED_RAW_CONVERSION', frame_id: frame.frame_id, station_id: frame.station_id, station_json_sha256: frame.station_json_sha256, attribution_text: [...bucket.attributions].join(' / '), height_basis: 'EPSG:6697 orthometric height as published (TP); station z = height - origin.hM; no ground height synthesised' };
    const extras = bucket.single
      ? { ...common, kinds, gml_id: bucket.single.gml_id, feature_type: bucket.single.type, source_id: bucket.single.source.sourceId, source_sha256: bucket.single.source.sourceSha256, lod_used: bucket.single.lod_used, lod_fallback: bucket.single.lod_fallback }
      : { ...common, merged: true, merge: mergeLabel(merge), variant, kinds, kind: bucket.kind === 'bldg' ? 'building' : 'road', tile: bucket.tile, feature_count: bucket.features, source_ids: [...bucket.sources.keys()].sort(), source_sha256s: Object.fromEntries([...bucket.sources].sort(([a], [b]) => (a < b ? -1 : 1))), lod_used: Object.fromEntries(Object.entries(bucket.lodUsed).sort(([a], [b]) => (a < b ? -1 : 1))), graph_sha256: window.graph?.graph_sha256 ?? null, pois_sha256: window.graph?.pois?.pois_sha256 ?? null, window: windowExtras, feature_table: 'sidecar and receipt: gml_id, source_id, lod, mesh, tri_start, tri_count' };
    const node = document.createNode(bucket.name).setExtras(extras);
    const mesh = document.createMesh(bucket.name).setExtras(extras);
    for (const [material, group] of [...bucket.groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const positions = document.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(group.positions));
      const normals = document.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(group.normals));
      const indices = document.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Uint32Array(group.indices));
      mesh.addPrimitive(document.createPrimitive().setAttribute('POSITION', positions).setAttribute('NORMAL', normals).setIndices(indices).setMaterial(materials[material]!));
      drawCalls++;
      for (let i = 0; i < group.positions.length; i += 3) {
        const p = fromGltf([group.positions[i]!, group.positions[i + 1]!, group.positions[i + 2]!]);
        localBBox = localBBox ? { min: localBBox.min.map((v, k) => Math.min(v, p[k]!)) as Point3, max: localBBox.max.map((v, k) => Math.max(v, p[k]!)) as Point3 } : { min: [...p], max: [...p] };
      }
    }
    node.setMesh(mesh);
    scene.addChild(node);
    triangleCount += bucket.triangles; trianglesByKind[bucket.kind] += bucket.triangles;
    if (merged) meshReport.push({ name: bucket.name, kind: bucket.kind === 'bldg' ? 'building' : 'road', tile: bucket.tile, features: bucket.features, triangles: bucket.triangles, primitives: bucket.groups.size, materials: [...bucket.groups.keys()].sort(), lod_used: bucket.lodUsed, source_ids: [...bucket.sources.keys()].sort() });
  }
  const nodeCount = emitted.length;
  const sceneWindow = { kinds, center_station_xy_m: [0, 0] as [number, number], radius_m: window.spec.r_origin_m, r_origin_m: window.spec.r_origin_m, r_exit_m: window.spec.r_exit_m, disc_count: discs.length, mesh_margin_m: window.spec.mesh_margin_m, node_rule: window.spec.node_rule, graph: window.graph, rule: WINDOW_RULE };
  scene.setExtras({
    gteki_role: CONTEXT_ROLE, navigation_use: 'NOT_FOR_ROUTING', visual_only: true, verification: 'UNVERIFIED', station_id: frame.station_id, frame_id: frame.frame_id,
    station_json_sha256: frame.station_json_sha256, graph_sha256: window.graph?.graph_sha256 ?? null, pois_sha256: window.graph?.pois?.pois_sha256 ?? null, window: windowExtras, kinds, merge: mergeLabel(merge), variant,
    selection_rule: SELECTION_RULE, lod_policy: variant === 'low' ? LOD_POLICY_LOW : LOD_POLICY, policy_version: CONTEXT_POLICY_VERSION, attribution_text: attribution,
  });
  await mkdir(dirname(outputPath), { recursive: true });
  const io = new NodeIO();
  await writeFile(outputPath, await io.writeBinary(document));

  // Readback: counts, bbox and the tagging/naming invariants are checked on the bytes just written.
  const reread = await io.readBinary(await readFile(outputPath));
  let actualTriangles = 0, actualPrimitives = 0;
  let actual: { min: Point3; max: Point3 } | null = null;
  const names = new Set<string>();
  for (const node of reread.getRoot().listNodes()) {
    const extras = node.getExtras(), name = node.getName();
    if (explorerRoleFromName(name) !== null || !/^ctx_(bldg|road)_/.test(name)) throw new Error(`GLB validation: unsafe context node name ${name}`);
    if (node.getMesh() && (node.getMesh()!.getName() !== name || explorerRoleFromName(node.getMesh()!.getName()) !== null)) throw new Error(`GLB validation: unsafe or mismatched mesh name for ${name}`);
    if (names.has(name)) throw new Error(`GLB validation: duplicate node name ${name}`);
    names.add(name);
    const provenanceOk = extras.merged === true
      ? Array.isArray(extras.source_ids) && extras.source_ids.length > 0 && typeof extras.source_sha256s === 'object' && extras.source_sha256s !== null && typeof extras.lod_used === 'object' && extras.lod_used !== null && typeof extras.window === 'object' && extras.window !== null && (extras.graph_sha256 ?? null) === (window.graph?.graph_sha256 ?? null) && (extras.pois_sha256 ?? null) === (window.graph?.pois?.pois_sha256 ?? null)
      : !!extras.source_id && !!extras.source_sha256 && !!extras.lod_used;
    if (extras.gteki_role !== CONTEXT_ROLE || extras.navigation_use !== 'NOT_FOR_ROUTING' || extras.visual_only !== true || extras.frame_id !== frame.frame_id || extras.station_json_sha256 !== frame.station_json_sha256 || !provenanceOk || !extras.attribution_text) throw new Error(`GLB validation: node ${name} lacks required context tags`);
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      actualPrimitives++;
      actualTriangles += (primitive.getIndices()?.getCount() ?? 0) / 3;
      const acc = primitive.getAttribute('POSITION')!;
      for (let i = 0; i < acc.getCount(); i++) {
        const p = fromGltf(acc.getElement(i, [0, 0, 0]) as Point3);
        actual = actual ? { min: actual.min.map((v, k) => Math.min(v, p[k]!)) as Point3, max: actual.max.map((v, k) => Math.max(v, p[k]!)) as Point3 } : { min: [...p], max: [...p] };
      }
    }
  }
  const expected = localBBox as { min: Point3; max: Point3 } | null, got = actual as { min: Point3; max: Point3 } | null;
  const bboxError = expected && got ? Math.max(...expected.min.map((v, i) => Math.abs(v - got.min[i]!)), ...expected.max.map((v, i) => Math.abs(v - got.max[i]!))) : Infinity;
  const validation = { status: 'PASS', node_count: names.size, expected_node_count: nodeCount, triangle_count: actualTriangles, expected_triangle_count: triangleCount, primitive_count: actualPrimitives, bbox_max_error_m: bboxError, tolerance_m: 0.001, all_node_names_clear_of_explorer_roles: true, all_nodes_tagged_context: true, feature_table_covers_every_triangle_once: merged ? true : 'n/a (one node per feature)' };
  if (names.size !== nodeCount || actualTriangles !== triangleCount || actualPrimitives !== drawCalls || bboxError > 0.001) throw new Error(`GLB readback validation failed: ${JSON.stringify(validation)}`);

  const excluded: Partial<Record<ExclusionReason, number>> = {};
  for (const counts of perSource) for (const [reason, n] of Object.entries(counts.excluded)) excluded[reason as ExclusionReason] = (excluded[reason as ExclusionReason] ?? 0) + n;
  const lodUsed = perSource.reduce<Record<string, number>>((acc, s) => { for (const [k, v] of Object.entries(s.lod_used)) acc[k] = (acc[k] ?? 0) + v; return acc; }, {});
  const featuresByKind = { building: perSource.filter((s) => s.kind === 'bldg').reduce((n, s) => n + s.converted, 0), road: perSource.filter((s) => s.kind === 'tran').reduce((n, s) => n + s.converted, 0) };
  return {
    verification: 'UNVERIFIED' as const, navigation_use: 'NOT_FOR_ROUTING' as const, visual_only: true, geometry_status: 'UNVERIFIED_RAW_CONVERSION' as const,
    station_id: frame.station_id, frame, window: sceneWindow, selection_rule: SELECTION_RULE, lod_policy: variant === 'low' ? LOD_POLICY_LOW : LOD_POLICY, policy_version: CONTEXT_POLICY_VERSION,
    variant, merge: mergeLabel(merge), kinds,
    sources: perSource,
    totals: {
      features_in_sources: perSource.reduce((n, s) => n + s.features_in_source, 0), outside_window: perSource.reduce((n, s) => n + s.outside_window, 0), selected_in_window: perSource.reduce((n, s) => n + s.selected, 0),
      converted: perFeature.length, excluded, excluded_total: Object.values(excluded).reduce((n, v) => n + v, 0), triangles: triangleCount,
      triangles_by_kind: { building: trianglesByKind.bldg, road: trianglesByKind.tran }, features_by_kind: featuresByKind,
      lod_used: lodUsed, nodes: nodeCount, meshes: nodeCount, draw_calls: drawCalls,
    },
    layout: { merge: mergeLabel(merge), mesh_count: nodeCount, draw_calls: drawCalls, tile_size_m: tileSize || null, tiles_used: tilesUsed, tile_grid_origin_station_xy_m: tileSize ? [gridX0, gridY0] : null, tile_centres_clamped_to_grid: tilesClamped, materials: merged ? MERGED_MATERIALS : PER_FEATURE_MATERIALS, meshes: meshReport },
    bbox_local_ENU: localBBox as { min: Point3; max: Point3 } | null, textures: 'not converted: PLATEAU texture lineage is aerial photography and its licence is unassessed',
    attribution_text: attribution, selected_gml_ids_sha256: createHash('sha256').update([...selectedIds].sort().join('\n')).digest('hex'), per_feature: perFeature, validation,
  };
}

export interface StationWindowConfig { r_origin_m?: number; r_exit_m: number; node_rule?: NodeRule; mesh_margin_m?: number }
export interface StationContextConfig {
  station: string; status: 'READY' | 'BLOCKED'; frame_id: string; radius_m: number; sources: string[]; blocked_reason?: string; notes?: string;
  window?: StationWindowConfig; merge?: string; variant?: ContextVariant; kinds?: ContextKind[];
}
export async function loadContextConfig(station: string): Promise<StationContextConfig> {
  if (!STATION_ENU_FRAME_ID_PATTERN.test(station)) throw new Error(`Invalid station id: ${station}`);
  let config: StationContextConfig;
  try { config = await readJson<StationContextConfig>(join(packageRoot, 'sources', 'context', `${station}.json`)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`No context config for station ${station}`); throw error; }
  if (config.station !== station) throw new Error(`Context config station mismatch for ${station}`);
  if (config.window?.r_origin_m !== undefined && config.window.r_origin_m !== config.radius_m) throw new Error(`Context config for ${station}: window.r_origin_m ${config.window.r_origin_m} differs from radius_m ${config.radius_m}`);
  if (config.merge !== undefined) parseMergeSpec(config.merge);
  if (config.variant !== undefined) parseVariant(config.variant);
  if (config.kinds !== undefined) parseKinds(config.kinds);
  return config;
}

const SOURCE_ID = /^plateau-(\d{5})-(bldg|tran)-(\d{8})$/;
export interface MeshCoverageReport {
  method: string; needed_meshes: string[]; margin_m: number; needed_sources: string[]; unused_sources: string[]; excluded_kind_sources: string[]; kinds: ContextKind[];
  missing: Array<{ mesh: string; kind: 'bldg' | 'tran'; reason: string }>;
}
/** Fail closed: every 3rd-level mesh the window touches needs a configured bldg and tran source. Returns what the window needs. */
export function assertMeshCoverage(station: string, window: ContextWindow, frame: Pick<StationEnuFrame, 'origin'>, sourceIds: readonly string[], kinds: readonly ContextKind[] = ALL_KINDS): { meshes: string[]; unusedSources: string[]; excludedKindSources: string[]; neededSources: string[] } {
  const coverage = meshesTouchedByWindow(window.discs, frame, window.spec.mesh_margin_m);
  const missing = missingMeshSources(coverage.meshes, sourceIds, kinds);
  const needed = new Set(coverage.meshes);
  const neededSources: string[] = [], unusedSources: string[] = [], excludedKindSources: string[] = [];
  for (const id of sourceIds) { const m = SOURCE_ID.exec(id); if (m && !kinds.includes(m[2] as ContextKind)) excludedKindSources.push(id); else if (m && needed.has(m[3]!)) neededSources.push(id); else unusedSources.push(id); }
  if (missing.length) {
    const list = missing.map((m) => `${m.mesh} ${m.kind} (not in the context config)`).join(', ');
    throw new Error(`Context window for ${station} needs 3rd-level meshes ${coverage.meshes.join(', ')}, but no ${kinds.join('/')} source is configured for: ${list}. Nothing was converted (a silently clipped window is refused). Add the sources to tools/gis/sources/sources.yaml and tools/gis/sources/context/${station}.json and acquire them, or shrink the window.`);
  }
  return { meshes: coverage.meshes, unusedSources, excludedKindSources, neededSources };
}

export interface ContextRunOptions {
  radiusM?: number; exitRadiusM?: number; sourceIds?: string[]; frameId?: string; merge?: string; variant?: ContextVariant; kinds?: string | readonly string[];
  /** Test hook: read this file instead of the repo graph.json. */
  graphPath?: string; poisPath?: string;
}
/** CLI/store wrapper: validates the frame, resolves the window and the stored sources and writes the GLB, sidecar and receipt. */
export async function contextGlb(station: string, options: ContextRunOptions = {}) {
  const started = performance.now();
  const config = await loadContextConfig(station);
  if (config.status === 'BLOCKED') throw new Error(`Context for ${station} is blocked: ${config.blocked_reason ?? 'no reason recorded'}`);
  const merge = parseMergeSpec(options.merge ?? config.merge ?? DEFAULT_MERGE);
  const variant = options.variant !== undefined ? parseVariant(options.variant) : config.variant ?? 'high';
  const kinds = parseKinds(options.kinds ?? config.kinds ?? ALL_KINDS);
  const sourceIds = options.sourceIds?.length ? options.sourceIds : config.sources;
  const frame = await loadFrame(options.frameId ?? config.frame_id);
  if (!isStationEnuFrame(frame) || frame.station_id !== station) throw new Error(`Frame ${options.frameId ?? config.frame_id} is not a station-enu frame for ${station}`);
  const window = await buildContextWindow(
    { r_origin_m: options.radiusM ?? config.window?.r_origin_m ?? config.radius_m, r_exit_m: options.exitRadiusM ?? config.window?.r_exit_m ?? 0, ...(config.window?.node_rule ? { node_rule: config.window.node_rule } : {}), ...(config.window?.mesh_margin_m !== undefined ? { mesh_margin_m: config.window.mesh_margin_m } : {}) },
    { stationId: station, ...(options.graphPath ? { graphPath: options.graphPath } : {}), ...(options.poisPath ? { poisPath: options.poisPath } : {}) },
  );
  const radiusM = window.spec.r_origin_m;
  // station.json is read-only input. The frame must still describe its origin; a changed hash with the same origin is recorded, not fatal.
  const stationBytes = await readFile(join(repoRoot, frame.station_json_path));
  const stationNow = JSON.parse(stationBytes.toString('utf8')) as { station?: { origin?: { lat?: number; lon?: number; hM?: number | null; crs?: string } } };
  const o = stationNow.station?.origin;
  if (!o || o.lat !== frame.origin.lat || o.lon !== frame.origin.lon || o.hM !== frame.origin.hM || o.crs !== frame.origin.crs) throw new Error(`${frame.station_json_path} origin no longer matches frame ${frame.frame_id}; regenerate it with station-frame`);
  const stationJsonShaNow = createHash('sha256').update(stationBytes).digest('hex');

  // Fail closed on mesh coverage before any source is read or converted.
  for (const id of sourceIds) if (!SOURCE_ID.test(id)) throw new Error(`${id} is not a PLATEAU bldg/tran mesh source`);
  const coverage = assertMeshCoverage(station, window, frame, sourceIds, kinds);
  const inputs: ContextInput[] = [];
  const manifests: Array<{ record: unknown; source: SourceManifest }> = [];
  const notAcquired: Array<{ mesh: string; kind: string; source_id: string; error: string }> = [];
  for (const id of coverage.neededSources) {
    const match = SOURCE_ID.exec(id)!;
    try {
      const stored = await getStoredSource(id);
      if (!stored.source.station_ids.includes(station)) throw new Error(`${id} is not declared for station ${station}`);
      inputs.push({ sourceId: id, sourceSha256: stored.record.sha256, kind: match[2] as ContextKind, path: stored.path, attributionText: stored.source.attribution_text });
      manifests.push({ record: stored.record, source: stored.source });
    } catch (error) { notAcquired.push({ mesh: match[3]!, kind: match[2]!, source_id: id, error: (error as Error).message }); }
  }
  if (notAcquired.length) throw new Error(`Context window for ${station} needs sources that are not acquired or not usable: meshes ${[...new Set(notAcquired.map((m) => m.mesh))].join(', ')}: ${notAcquired.map((m) => `${m.source_id} (${m.error})`).join('; ')}. Nothing was converted; run \`gis acquire <source_id>\` for each.`);
  const meshCoverage: MeshCoverageReport = { method: 'JIS X 0410 3rd-level (8 digit) cells, projected into the station frame, tested against every disc of the window (closed; widened by margin_m)', needed_meshes: coverage.meshes, margin_m: window.spec.mesh_margin_m, needed_sources: coverage.neededSources, unused_sources: coverage.unusedSources, excluded_kind_sources: coverage.excludedKindSources, kinds, missing: [] };

  const fingerprint = await toolFingerprint();
  const digest = createHash('sha256').update(JSON.stringify({ frame, window: window.spec, discs: window.discs.map((d) => [d.id, d.x, d.y, d.r]), graph: window.graph?.graph_sha256 ?? null, merge: mergeLabel(merge), variant, kinds, sources: inputs.map((i) => [i.sourceId, i.sourceSha256]), policy: CONTEXT_POLICY_VERSION, fingerprint })).digest('hex').slice(0, 20);
  const exitPart = window.spec.r_exit_m > 0 ? `-x${window.spec.r_exit_m}` : '';
  const kindsPart = kinds.length === ALL_KINDS.length ? '' : `-${kinds.join('-')}`; // full (bldg+tran) runs keep the old id shape; a subset is visible in the id
  const runId = `context-${station}-r${radiusM}${exitPart}-${frame.frame_id}-${variant}-${mergeLabel(merge).replace(':', '')}${kindsPart}-${digest}`;
  const relativeOutput = `out/${runId}.glb`, outputPath = join(getStoreRoot(), relativeOutput);
  const report = await buildContextGlb({ frame, window, inputs, outputPath, merge, variant, kinds });
  const outputBytes = await readFile(outputPath), outputSha256 = createHash('sha256').update(outputBytes).digest('hex');
  const { per_feature, ...summaryBody } = report;
  // The feature table (gml_id -> mesh and triangle range) travels in the sidecar and, compactly, in the receipt.
  const columns = ['gml_id', 'source_id', 'lod', 'mesh', 'tri_start', 'tri_count'] as const;
  const featureTable = { columns, rows: per_feature.map((f) => [f.gml_id, f.source_id, f.lod_used, f.mesh, f.tri_start, f.tri_count]) };
  const featureTableSha256 = createHash('sha256').update(JSON.stringify(featureTable)).digest('hex');
  const sidecar = { ...report, run_id: runId, mesh_coverage: meshCoverage, feature_table: featureTable, feature_table_sha256: featureTableSha256, tool_version: TOOL_VERSION, tool_input_sha256: fingerprint, station_json_sha256_now: stationJsonShaNow, station_json_changed_since_frame: stationJsonShaNow !== frame.station_json_sha256,
    source_records: manifests.map((m) => m.record), source_manifests: manifests.map((m) => m.source), store_path: relativeOutput, output_sha256: outputSha256, output_bytes: outputBytes.length };
  await writeJson(outputPath.replace(/\.glb$/, '.provenance.json'), sidecar);
  const summary = {
    run_id: runId, ...summaryBody, mesh_coverage: meshCoverage, feature_table: featureTable, feature_table_sha256: featureTableSha256, per_feature_count: per_feature.length, tool_version: TOOL_VERSION, tool_input_sha256: fingerprint,
    station_json_sha256_now: stationJsonShaNow, station_json_changed_since_frame: stationJsonShaNow !== frame.station_json_sha256,
    store_path: relativeOutput, sidecar_path: relativeOutput.replace(/\.glb$/, '.provenance.json'), output_sha256: outputSha256, output_bytes: outputBytes.length,
    elapsed_ms: Math.round(performance.now() - started), peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
  };
  // Context receipts live beside, not inside, docs/gis/conversions so real-run/summarize never mistake them for ubld conversions.
  await writeJson(join(docsRoot, 'gis', 'context', `${runId}.json`), summary);
  return summary;
}
