import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { docsRoot, getStoredSource, getStoreRoot, repoRoot, writeJson, TOOL_VERSION } from './common.js';
import { loadFrame, toGltf, fromGltf, type Point3 } from './crs.js';
import { stationEnuProjector, stationHorizontal, stationOriginSha256, isStationEnuFrame, type StationEnuFrame } from './station-enu.js';
import { buildContextWindow, type ContextWindow, type Disc } from './context-window.js';
import { CONTEXT_ROLE, explorerRoleFromName, loadContextConfig, type StationContextConfig } from './context.js';
import { toolFingerprint } from './provenance.js';
import { readZip } from './zip.js';

/**
 * Visual-only 2D context overlay (KSJ N02 station and railway lines, KSJ N03 municipal boundary rings) in the station frame.
 *
 * Geometry only: the output keeps geometry, `kind` (station | railway | border) and a sha256 of the source feature. No source
 * property (name, code, operator, line, class, municipality) is copied, hashed per field, or written to any output. Unknown
 * stays unknown: the axis order and CRS are read from the file and the run fails when they are not unambiguous; z is a
 * per-station constant from the overlay config, never draped on terrain and never lifted. Layers are grouped by source, so
 * each run's receipt, credit and leak guard cover exactly one source.
 */
export const OVERLAY_POLICY_VERSION = 'context-overlay-v2';
export type OverlayKind = 'station' | 'railway' | 'border';
export const OVERLAY_KINDS: readonly OverlayKind[] = ['station', 'railway', 'border'];
/** The only property keys any overlay feature may carry. */
export const OVERLAY_PROPERTY_KEYS = ['clipped', 'credit', 'feature_hash', 'gteki_role', 'kind', 'navigation_use', 'source_id', 'source_sha256', 'visual_only'] as const;

export function parseOverlayKinds(value: string | readonly string[]): OverlayKind[] {
  const items = typeof value === 'string' ? value.split(',').map((v) => v.trim()) : [...value];
  if (!items.length || items.some((k) => !OVERLAY_KINDS.includes(k as OverlayKind))) throw new Error(`Invalid --kinds ${JSON.stringify(typeof value === 'string' ? value : value.join(','))}: expected station, railway and/or border (comma separated)`);
  return OVERLAY_KINDS.filter((k) => items.includes(k));
}

/** Source geometry of a layer: open lines as they are, or (border polygons) the rings of a Polygon/MultiPolygon as closed lines. */
export type OverlayLayerGeometry = 'lines' | 'polygon_rings';
export interface OverlayLayerConfig {
  source_id: string; kind: OverlayKind; member: string; ribbon_width_m: number;
  geometry?: OverlayLayerGeometry;
  /**
   * Keep only the municipality polygon whose code matches the station's ward (border layers). The code and the property
   * name are selection inputs only: neither is copied into the GeoJSON, the GLB, the receipt or the sidecar.
   */
  select?: { kind: 'municipality_code'; property: string; code: string };
}
export interface OverlayZConfig {
  mode: 'constant'; z_m: number; basis: string; datum_asserted: false;
  /** The station lead's value, re-read from this file on every run; a mismatch fails the run. */
  check: { path: string; floor_ordinal: number; field: 'renderElevationM' };
}
export type OverlayFrameConfig = { mode: 'station-enu-frame'; frame_id: string } | { mode: 'origin-only'; station_json: string };
/** Clip of the projected geometry to a disc around the station frame origin (x = y = 0). */
export interface OverlayClipConfig { kind: 'origin_disc'; radius_m: number }
/** Feature selection window: one closed disc around the station frame origin (the director's 700 m decision). */
export interface OverlayWindowConfig { kind: 'origin_disc'; radius_m: number }
export interface OverlayConfig { frame: OverlayFrameConfig; z: OverlayZConfig; layers: OverlayLayerConfig[]; clip?: OverlayClipConfig; window?: OverlayWindowConfig; notes?: string }
/** Parts shorter than this (metres) are dropped after clipping. */
export const CLIP_MIN_PART_M = 0.01;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------------------------------------------------
// Source reading: axis order, CRS, geometry

export type AxisOrder = 'lon,lat' | 'lat,lon';
const inLon = (v: number): boolean => v >= 122 && v <= 154, inLat = (v: number): boolean => v >= 24 && v <= 46;
/** Classify one position by the Japan ranges (longitude 122-154, latitude 24-46 are disjoint, so the order is unambiguous or the position is refused). */
export function axisOrderOfPosition(p: unknown): AxisOrder {
  if (!Array.isArray(p) || p.length < 2 || !finite(p[0]) || !finite(p[1])) throw new Error('GeoJSON position is not two finite numbers');
  const [a, b] = p as [number, number];
  if (inLon(a) && inLat(b)) return 'lon,lat';
  if (inLat(a) && inLon(b)) return 'lat,lon';
  throw new Error(`GeoJSON position (${a}, ${b}) is outside the Japan latitude/longitude ranges in either axis order; refusing to guess`);
}
const ACCEPTED_CRS = new Set(['urn:ogc:def:crs:EPSG::6668', 'urn:ogc:def:crs:EPSG::6697']);
export function crsNameOf(collection: Record<string, unknown>): string {
  const crs = collection.crs as { properties?: { name?: unknown } } | undefined;
  const name = crs?.properties?.name;
  if (typeof name !== 'string') throw new Error('Source GeoJSON declares no CRS; refusing to guess (expected JGD2011 geographic, EPSG:6668 or EPSG:6697)');
  if (!ACCEPTED_CRS.has(name)) throw new Error(`Source GeoJSON CRS ${name} is not a JGD2011 geographic CRS the overlay accepts (EPSG:6668 / EPSG:6697)`);
  return name;
}

type LonLat = [number, number];
interface SourcePart { lonLat: LonLat[] }
/**
 * Source geometry as parts of [lon, lat], with the axis order read from the data (every vertex must agree).
 * `lines` takes LineString / MultiLineString as they are; `polygon_rings` takes the rings of a Polygon / MultiPolygon
 * (exterior and holes alike) as closed lines. No ring role or source attribute is carried onward.
 */
function readParts(geometry: unknown, order: { value: AxisOrder | null }, mode: OverlayLayerGeometry = 'lines'): SourcePart[] {
  if (!isRecord(geometry)) throw new Error('Feature has no geometry object');
  const expected = mode === 'lines' ? 'LineString or MultiLineString' : 'Polygon or MultiPolygon';
  const lines: unknown[] = mode === 'lines'
    ? (geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates) ? geometry.coordinates : (() => { throw new Error(`Unsupported geometry type ${JSON.stringify(geometry.type)} (expected ${expected})`); })())
    : (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates) ? geometry.coordinates
      : geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates) ? (geometry.coordinates as unknown[]).flatMap((polygon) => { if (!Array.isArray(polygon)) throw new Error('MultiPolygon holds a polygon that is not an array of rings'); return polygon as unknown[]; })
        : (() => { throw new Error(`Unsupported geometry type ${JSON.stringify(geometry.type)} (expected ${expected})`); })());
  return lines.map((line) => {
    if (!Array.isArray(line) || line.length < 1) throw new Error('Line has no positions');
    return { lonLat: line.map((p) => {
      const o = axisOrderOfPosition(p);
      if (order.value === null) order.value = o; else if (order.value !== o) throw new Error('Source GeoJSON mixes axis orders; refusing to guess');
      const [a, b] = p as [number, number];
      return (o === 'lon,lat' ? [a, b] : [b, a]) as LonLat;
    }) };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Selection and projection

export interface OverlayFeature { kind: OverlayKind; source_index: number; feature_hash: string; parts: Point3[][]; clipped: boolean; vertices_before_clip: number }
export interface OverlayProjection {
  origin: { lat: number; lon: number };
  /** Station-frame [x east, y north] metres of a (lat, lon) pair. */
  project: (lat: number, lon: number) => [number, number];
}
function distanceToSegment(px: number, py: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}
/** Whether a polyline in station XY metres meets any closed disc (exact: segment distance, so a line crossing only a disc edge counts). */
export function polylineMeetsAnyDisc(line: ReadonlyArray<readonly [number, number]>, discs: readonly Disc[]): boolean {
  for (const d of discs) {
    if (line.length === 1) { if (Math.hypot(line[0]![0] - d.x, line[0]![1] - d.y) <= d.r) return true; continue; }
    for (let i = 0; i + 1 < line.length; i++) if (distanceToSegment(d.x, d.y, line[i] as [number, number], line[i + 1] as [number, number]) <= d.r) return true;
  }
  return false;
}

/**
 * Clip a polyline (station XY metres) to the closed disc of `radius` around (0, 0). Exact segment and circle intersections; a line
 * that leaves and re-enters yields several parts. Parts shorter than CLIP_MIN_PART_M (tangent touches, slivers) are dropped. A line
 * with a single vertex is kept only when that vertex is inside.
 */
export function clipPolylineToDisc(line: ReadonlyArray<readonly [number, number]>, radius: number): Array<Array<[number, number]>> {
  const r2 = radius * radius;
  const parts: Array<Array<[number, number]>> = [];
  if (line.length === 1) { const [x, y] = line[0]!; return x * x + y * y <= r2 ? [[[x, y]]] : []; }
  let current: Array<[number, number]> | null = null;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i]!, [bx, by] = line[i + 1]!;
    const dx = bx - ax, dy = by - ay;
    const A = dx * dx + dy * dy, B = ax * dx + ay * dy, C = ax * ax + ay * ay - r2;
    let t0 = 0, t1 = 1, hit = true;
    if (A === 0) hit = C <= 0;
    else {
      const disc = B * B - A * C;
      if (disc < 0) hit = false;
      else { const sq = Math.sqrt(disc); t0 = Math.max(0, (-B - sq) / A); t1 = Math.min(1, (-B + sq) / A); hit = t0 <= t1; }
    }
    if (!hit) { current = null; continue; }
    const entry: [number, number] = t0 <= 0 ? [ax, ay] : [ax + t0 * dx, ay + t0 * dy];
    const exit: [number, number] = t1 >= 1 ? [bx, by] : [ax + t1 * dx, ay + t1 * dy];
    if (current && t0 <= 0) current.push(exit); else { current = [entry, exit]; parts.push(current); }
    if (t1 < 1) current = null;
  }
  return parts.filter((p) => { let len = 0; for (let i = 0; i + 1 < p.length; i++) len += Math.hypot(p[i + 1]![0] - p[i]![0], p[i + 1]![1] - p[i]![1]); return len >= CLIP_MIN_PART_M; });
}

export interface LayerCounts { kind: OverlayKind; source_id: string; member: string; member_sha256: string; axis_order: AxisOrder | null; crs: string; features_in_source: number; outside_selection: number; outside_prefilter: number; outside_window: number; selected_before_clip: number; dropped_by_clip: number; selected: number; features_clipped: number; vertices_before_clip: number; vertices: number }
export interface LayerInput { layer: OverlayLayerConfig; sourceSha256: string; memberSha256: string; collection: unknown }

export function selectLayer(input: LayerInput, projection: OverlayProjection, window: ContextWindow, z: number, clipRadiusM: number | null = null): { features: OverlayFeature[]; counts: LayerCounts; sourceValues: Set<string> } {
  const { layer, collection } = input;
  if (!isRecord(collection) || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error(`${layer.member}: not a GeoJSON FeatureCollection`);
  const crs = crsNameOf(collection);
  // Generous degree box around everything the window can reach, so most of a nationwide file is skipped before projection.
  const reach = Math.max(...window.discs.map((d) => Math.hypot(d.x, d.y) + d.r)) * 1.05 + 10;
  const dLat = reach / 110000, dLon = reach / (110000 * Math.cos((projection.origin.lat * Math.PI) / 180));
  const order = { value: null as AxisOrder | null };
  const mode = layer.geometry ?? 'lines';
  const features: OverlayFeature[] = [];
  const sourceValues = new Set<string>();
  let outsideSelection = 0, outsidePrefilter = 0, outsideWindow = 0, vertices = 0, verticesBefore = 0, selectedBeforeClip = 0, droppedByClip = 0, featuresClipped = 0;
  (collection.features as unknown[]).forEach((raw, index) => {
    if (!isRecord(raw)) throw new Error(`${layer.member}: feature ${index} is not an object`);
    // municipality_code first, on the properties only: the station's own municipality polygon, never a neighbour's
    // boundary, and never a geometry the layer does not draw (other municipalities include distant islands).
    if (layer.select?.kind === 'municipality_code') {
      const props = isRecord(raw.properties) ? raw.properties : {};
      if (props[layer.select.property] !== layer.select.code) { outsideSelection++; return; }
    }
    const parts = readParts(raw.geometry, order, mode);
    let near = false;
    if (mode === 'polygon_rings') {
      // A ring may enclose the whole box with every vertex far outside it (a ward around the station), so test the ring bbox.
      for (const part of parts) {
        let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
        for (const [lon, lat] of part.lonLat) { minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); }
        if (minLon <= projection.origin.lon + dLon && maxLon >= projection.origin.lon - dLon && minLat <= projection.origin.lat + dLat && maxLat >= projection.origin.lat - dLat) near = true;
      }
    } else {
      for (const part of parts) for (const [lon, lat] of part.lonLat) if (Math.abs(lat - projection.origin.lat) <= dLat && Math.abs(lon - projection.origin.lon) <= dLon) near = true;
      // A long line can pass the box with no vertex inside it, so test segment boxes cheaply: fall through when any vertex pair spans the box.
      if (!near) for (const part of parts) for (let i = 0; i + 1 < part.lonLat.length && !near; i++) {
        const [lo0, la0] = part.lonLat[i]!, [lo1, la1] = part.lonLat[i + 1]!;
        if (Math.min(lo0, lo1) <= projection.origin.lon + dLon && Math.max(lo0, lo1) >= projection.origin.lon - dLon && Math.min(la0, la1) <= projection.origin.lat + dLat && Math.max(la0, la1) >= projection.origin.lat - dLat) near = true;
      }
    }
    if (!near) { outsidePrefilter++; return; }
    const local = parts.map((part) => part.lonLat.map(([lon, lat]) => projection.project(lat, lon)));
    if (!local.some((line) => polylineMeetsAnyDisc(line, window.discs))) { outsideWindow++; return; }
    selectedBeforeClip++;
    const before = local.reduce((n, line) => n + line.length, 0);
    verticesBefore += before;
    // Clip after projection and selection: a line wholly inside the disc is untouched; the others are cut at the circle.
    let outParts: Array<Array<[number, number]>> = local;
    let clipped = false;
    if (clipRadiusM !== null) {
      const r2 = clipRadiusM * clipRadiusM;
      outParts = local.flatMap((line) => (line.every(([x, y]) => x * x + y * y <= r2) ? [line] : (clipped = true, clipPolylineToDisc(line, clipRadiusM))));
    }
    if (!outParts.length) { droppedByClip++; featuresClipped++; return; }
    const after = outParts.reduce((n, line) => n + line.length, 0);
    if (clipped) featuresClipped++;
    features.push({ kind: layer.kind, source_index: index, feature_hash: sha256(JSON.stringify(raw)), clipped, vertices_before_clip: before, parts: outParts.map((line) => line.map(([x, y]) => [round3(x), round3(y), z] as Point3)) });
    vertices += after;
    // Source values of the selected features, kept only in memory for the leak guard.
    const props = isRecord(raw.properties) ? raw.properties : {};
    for (const [k, v] of Object.entries(props)) { sourceValues.add(`key:${k}`); if (typeof v === 'string' && v.length) sourceValues.add(v); else if (typeof v === 'number') sourceValues.add(String(v)); }
  });
  return { features, sourceValues, counts: { kind: layer.kind, source_id: layer.source_id, member: layer.member, member_sha256: input.memberSha256, axis_order: order.value, crs, features_in_source: collection.features.length, outside_selection: outsideSelection, outside_prefilter: outsidePrefilter, outside_window: outsideWindow, selected_before_clip: selectedBeforeClip, dropped_by_clip: droppedByClip, selected: features.length, features_clipped: featuresClipped, vertices_before_clip: verticesBefore, vertices } };
}

// ---------------------------------------------------------------------------------------------------------------------
// Outputs

export interface OverlayMeta {
  station_id: string; frame_label: string; credit: string; source_id: string; source_sha256: string;
  z_m: number; z_basis: string; window_label: string;
  clip?: { kind: string; radius_m: number | null } | null;
}
const NOTE_CRS = 'station-enu frame: coordinates are [x east, y north, z up] metres, not lon/lat';

export function overlayGeoJson(features: readonly OverlayFeature[], meta: OverlayMeta): string {
  return JSON.stringify({
    type: 'FeatureCollection', crs_note: NOTE_CRS, gteki_role: CONTEXT_ROLE, navigation_use: 'NOT_FOR_ROUTING', visual_only: true, station_id: meta.station_id, frame: meta.frame_label,
    z_basis: meta.z_basis, z_m: meta.z_m, clip: meta.clip ?? null, credit: meta.credit, policy_version: OVERLAY_POLICY_VERSION,
    features: features.map((f) => ({
      type: 'Feature',
      properties: { gteki_role: CONTEXT_ROLE, navigation_use: 'NOT_FOR_ROUTING', visual_only: true, kind: f.kind, source_id: meta.source_id, source_sha256: meta.source_sha256, feature_hash: f.feature_hash, clipped: f.clipped, credit: meta.credit },
      geometry: f.parts.length === 1 ? { type: 'LineString', coordinates: f.parts[0] } : { type: 'MultiLineString', coordinates: f.parts },
    })),
  });
}

/**
 * Fail-closed leak guard: no key name or string value of a selected source feature may appear in `text`. Every value is tested as an
 * exact JSON string, and a value with a non-ASCII character (the Japanese names and operators) as a plain substring too.
 */
export function assertNoSourceValues(text: string, sourceValues: ReadonlySet<string>, where: string): void {
  for (const entry of sourceValues) {
    if (entry.startsWith('key:')) { if (text.includes(JSON.stringify(entry.slice(4)))) throw new Error(`${where} would carry a source property key`); continue; }
    if (text.includes(JSON.stringify(entry))) throw new Error(`${where} would carry a source property value`);
    if (/[^\x00-\x7f]/.test(entry) && text.includes(entry)) throw new Error(`${where} would carry a source property value`);
  }
}

export interface RibbonSet { kind: OverlayKind; width_m: number; features: readonly OverlayFeature[] }
export interface GlbReadback { status: 'PASS'; node_count: number; triangle_count: number; expected_triangle_count: number; bbox_max_error_m: number; tolerance_m: number }
const RIBBON_NODE: Record<OverlayKind, string> = { station: 'ctx_station_all', railway: 'ctx_rail_all', border: 'ctx_border_all' };
const RIBBON_COLOR: Record<OverlayKind, [number, number, number, number]> = { station: [0.85, 0.55, 0.2, 1], railway: [0.45, 0.45, 0.5, 1], border: [0.6, 0.6, 0.6, 1] };

/** Flat ribbons (two triangles per segment, constant z) merged per kind. Visual-only; no routing meaning. */
export async function writeOverlayGlb(outputPath: string, sets: readonly RibbonSet[], meta: OverlayMeta & { feature_hashes_sha256: Record<string, string> }): Promise<{ readback: GlbReadback; triangles: Record<string, number>; segments_skipped_zero_length: number }> {
  const document = new Document(), buffer = document.createBuffer();
  document.getRoot().getAsset().copyright = meta.credit;
  const scene = document.createScene('UNVERIFIED NOT_FOR_ROUTING 2D context overlay (visual only)');
  const common = { gteki_role: CONTEXT_ROLE, navigation_use: 'NOT_FOR_ROUTING', visual_only: true, verification: 'UNVERIFIED', station_id: meta.station_id, frame: meta.frame_label, source_id: meta.source_id, source_sha256: meta.source_sha256, z_m: meta.z_m, z_basis: meta.z_basis, window: meta.window_label, credit: meta.credit, policy_version: OVERLAY_POLICY_VERSION };
  const expected: Record<string, number> = {};
  let skipped = 0, bbox: { min: Point3; max: Point3 } | null = null;
  for (const set of [...sets].sort((a, b) => (a.kind < b.kind ? -1 : 1))) {
    const positions: number[] = [], normals: number[] = [], indices: number[] = [];
    const half = set.width_m / 2;
    for (const f of set.features) for (const line of f.parts) for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i]!, b = line[i + 1]!;
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < 1e-6) { skipped++; continue; }
      const nx = (-dy / len) * half, ny = (dx / len) * half;
      const corners: Point3[] = [[a[0] - nx, a[1] - ny, a[2]], [b[0] - nx, b[1] - ny, b[2]], [b[0] + nx, b[1] + ny, b[2]], [a[0] + nx, a[1] + ny, a[2]]];
      const base = positions.length / 3;
      for (const c of corners) { positions.push(...toGltf(c)); normals.push(...toGltf([0, 0, 1])); bbox = bbox ? { min: bbox.min.map((v, k) => Math.min(v, c[k]!)) as Point3, max: bbox.max.map((v, k) => Math.max(v, c[k]!)) as Point3 } : { min: [...c], max: [...c] }; }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    if (!indices.length) continue;
    const name = RIBBON_NODE[set.kind];
    expected[name] = indices.length / 3;
    const extras = { ...common, kind: set.kind, merged: true, feature_count: set.features.length, ribbon_width_m: set.width_m, feature_hashes_sha256: meta.feature_hashes_sha256[set.kind] ?? null };
    const material = document.createMaterial(set.kind).setBaseColorFactor(RIBBON_COLOR[set.kind]).setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(true);
    const primitive = document.createPrimitive()
      .setAttribute('POSITION', document.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(positions)))
      .setAttribute('NORMAL', document.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(normals)))
      .setIndices(document.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Uint32Array(indices))).setMaterial(material);
    const mesh = document.createMesh(name).setExtras(extras).addPrimitive(primitive);
    scene.addChild(document.createNode(name).setExtras(extras).setMesh(mesh));
  }
  if (!Object.keys(expected).length) throw new Error('No overlay segment to draw; no GLB written');
  scene.setExtras({ ...common, kinds: Object.keys(expected).sort() });
  await mkdir(dirname(outputPath), { recursive: true });
  const io = new NodeIO();
  await writeFile(outputPath, await io.writeBinary(document));
  // Readback on the bytes just written.
  const reread = await io.readBinary(await readFile(outputPath));
  let triangles = 0, actual: { min: Point3; max: Point3 } | null = null;
  const names = new Set<string>();
  for (const node of reread.getRoot().listNodes()) {
    const name = node.getName(), extras = node.getExtras();
    if (explorerRoleFromName(name) !== null || !/^ctx_(rail|station|border)_all$/.test(name) || names.has(name)) throw new Error(`GLB validation: unsafe or duplicate overlay node name ${name}`);
    names.add(name);
    if (extras.gteki_role !== CONTEXT_ROLE || extras.navigation_use !== 'NOT_FOR_ROUTING' || extras.visual_only !== true || !extras.credit) throw new Error(`GLB validation: node ${name} lacks required context tags`);
    let nodeTriangles = 0;
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      nodeTriangles += (primitive.getIndices()?.getCount() ?? 0) / 3;
      const acc = primitive.getAttribute('POSITION')!;
      for (let i = 0; i < acc.getCount(); i++) {
        const p = fromGltf(acc.getElement(i, [0, 0, 0]) as Point3);
        actual = actual ? { min: actual.min.map((v, k) => Math.min(v, p[k]!)) as Point3, max: actual.max.map((v, k) => Math.max(v, p[k]!)) as Point3 } : { min: [...p], max: [...p] };
      }
    }
    if (nodeTriangles !== expected[name]) throw new Error(`GLB validation: node ${name} has ${nodeTriangles} triangles, expected ${expected[name]}`);
    triangles += nodeTriangles;
  }
  const want = bbox as { min: Point3; max: Point3 } | null, got = actual as { min: Point3; max: Point3 } | null;
  const bboxError = want && got ? Math.max(...want.min.map((v, i) => Math.abs(v - got.min[i]!)), ...want.max.map((v, i) => Math.abs(v - got.max[i]!))) : Infinity;
  const expectedTriangles = Object.values(expected).reduce((n, v) => n + v, 0);
  if (names.size !== Object.keys(expected).length || triangles !== expectedTriangles || bboxError > 0.001) throw new Error('GLB readback validation failed');
  return { readback: { status: 'PASS', node_count: names.size, triangle_count: triangles, expected_triangle_count: expectedTriangles, bbox_max_error_m: bboxError, tolerance_m: 0.001 }, triangles: expected, segments_skipped_zero_length: skipped };
}

/** Local station-frame bounding box of the drawn features (null when none). */
export function overlayBBox(features: readonly OverlayFeature[]): { min: Point3; max: Point3 } | null {
  let box: { min: Point3; max: Point3 } | null = null;
  for (const f of features) for (const line of f.parts) for (const p of line) box = box ? { min: box.min.map((v, k) => Math.min(v, p[k]!)) as Point3, max: box.max.map((v, k) => Math.max(v, p[k]!)) as Point3 } : { min: [...p], max: [...p] };
  return box;
}

// ---------------------------------------------------------------------------------------------------------------------
// Public receipt

export interface OverlayReceiptInput {
  run_id: string; station_id: string; frame: Record<string, unknown>; window: Record<string, unknown>; z: Record<string, unknown>; credit: string;
  source: { source_id: string; source_sha256: string; bytes: number; license_name: string; license_url: string | null; publish_gate: string };
  layers: LayerCounts[]; feature_hashes: Record<string, string[]>; bbox: { min: Point3; max: Point3 } | null;
  outputs: Record<string, unknown>; tool_input_sha256: string; policy_version: string;
  clip: { kind: string; radius_m: number | null };
}
/**
 * The committed receipt: allow-listed counts, hashes, schema-level facts and the credit. Built field by field (nothing is spread from
 * the source), then checked against the selected features' source values; any hit fails the run.
 */
export function publicOverlayReceipt(input: OverlayReceiptInput, sourceValues: ReadonlySet<string>): Record<string, unknown> {
  const totals = { features_in_source: 0, outside_selection: 0, outside_prefilter: 0, outside_window: 0, selected_before_clip: 0, dropped_by_clip: 0, selected: 0, vertices_before_clip: 0, vertices: 0 };
  for (const l of input.layers) { totals.features_in_source += l.features_in_source; totals.outside_selection += l.outside_selection; totals.outside_prefilter += l.outside_prefilter; totals.outside_window += l.outside_window; totals.selected += l.selected; totals.vertices += l.vertices; totals.selected_before_clip += l.selected_before_clip; totals.dropped_by_clip += l.dropped_by_clip; totals.vertices_before_clip += l.vertices_before_clip; }
  const clipActive = input.clip.radius_m !== null;
  const clip = { kind: input.clip.kind, radius_m: input.clip.radius_m, center: 'station frame origin', features_clipped: input.layers.reduce((n, l) => n + l.features_clipped, 0), vertices_before: totals.vertices_before_clip, vertices_after: totals.vertices };
  const hashesByKind = Object.fromEntries(Object.entries(input.feature_hashes).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, [...v].sort()]));
  const receipt = {
    run_id: input.run_id, command: 'context-overlay', policy_version: input.policy_version, station_id: input.station_id,
    gteki_role: CONTEXT_ROLE, navigation_use: 'NOT_FOR_ROUTING', visual_only: true, verification: 'UNVERIFIED',
    note: 'Geometry, kind and a per-feature source hash only. No source name, code or attribute is copied;' +
      (input.layers.some((l) => l.kind === 'railway') ? ' no railway class or track level is shown (the source has no underground versus at-grade field);' : '') +
      (input.layers.some((l) => l.kind === 'border') ? ' the border layer ships the ring lines of the municipality configured for the station (selected by code in the overlay config; the station origin need not fall inside it), and that municipality\'s name and code are not copied;' : '') +
      (clipActive ? ` the geometry is clipped to a ${input.clip.radius_m} m disc around the station frame origin and is not the full source line; feature_hash is the hash of the whole source feature.` : ' the geometry is not clipped (clip disabled for this run); selected features are kept whole.') +
      (totals.selected === 0 ? ' No feature of this source meets the window: no GeoJSON and no GLB are written for this run, and the layer counts record where each source feature left the selection.' : ''),
    clip,
    frame: input.frame, window: input.window, z_basis: input.z, credit: input.credit, source: input.source,
    layers: input.layers.map((l) => ({ kind: l.kind, source_id: l.source_id, member: l.member, member_sha256: l.member_sha256, axis_order: l.axis_order, crs: l.crs, features_in_source: l.features_in_source, outside_selection: l.outside_selection, outside_prefilter: l.outside_prefilter, outside_window: l.outside_window, selected_before_clip: l.selected_before_clip, dropped_by_clip: l.dropped_by_clip, selected: l.selected, features_clipped: l.features_clipped, vertices_before_clip: l.vertices_before_clip, vertices: l.vertices })),
    totals, feature_hashes_sha256: Object.fromEntries(Object.entries(hashesByKind).map(([k, v]) => [k, sha256(JSON.stringify(v))])), feature_hashes: hashesByKind,
    bbox_local_ENU: input.bbox, outputs: input.outputs, tool_input_sha256: input.tool_input_sha256, tool_version: TOOL_VERSION,
  };
  assertNoSourceValues(JSON.stringify(receipt), sourceValues, 'The public overlay receipt');
  return receipt;
}

// ---------------------------------------------------------------------------------------------------------------------
// Station wrapper (store)

/** clipRadiusM: undefined = use the config; 0 = disable clipping; > 0 = override the disc radius. */
export interface OverlayRunOptions { clipRadiusM?: number; radiusM?: number; exitRadiusM?: number; kinds?: string | readonly string[]; glb?: boolean; graphPath?: string; poisPath?: string; receiptDir?: string }

export function assertOverlayConfig(station: string, overlay: unknown): OverlayConfig {
  if (!isRecord(overlay)) throw new Error(`Context config for ${station} has no overlay section`);
  const o = overlay as unknown as OverlayConfig;
  const f = o.frame as unknown as Record<string, unknown> | undefined;
  if (!f || !((f.mode === 'station-enu-frame' && typeof f.frame_id === 'string') || (f.mode === 'origin-only' && typeof f.station_json === 'string'))) throw new Error(`overlay.frame for ${station} must be station-enu-frame (frame_id) or origin-only (station_json)`);
  const z = o.z as unknown as Record<string, unknown> | undefined;
  if (!z || z.mode !== 'constant' || !finite(z.z_m) || typeof z.basis !== 'string' || !z.basis || z.datum_asserted !== false || !isRecord(z.check) || typeof z.check.path !== 'string' || !finite(z.check.floor_ordinal) || z.check.field !== 'renderElevationM') throw new Error(`overlay.z for ${station} must be a constant with a basis, datum_asserted false and a station.json check`);
  if (!Array.isArray(o.layers) || !o.layers.length) throw new Error(`overlay.layers for ${station} is empty`);
  for (const l of o.layers) if (!l || !OVERLAY_KINDS.includes(l.kind) || typeof l.source_id !== 'string' || typeof l.member !== 'string' || !finite(l.ribbon_width_m) || l.ribbon_width_m <= 0 || l.ribbon_width_m > 20) throw new Error(`overlay.layers entry for ${station} is invalid`);
  for (const l of o.layers) {
    if (l.geometry !== undefined && l.geometry !== 'lines' && l.geometry !== 'polygon_rings') throw new Error(`overlay.layers geometry for ${station} must be "lines" or "polygon_rings"`);
    if (l.select !== undefined && (!isRecord(l.select) || l.select.kind !== 'municipality_code' || typeof l.select.property !== 'string' || !l.select.property || typeof l.select.code !== 'string' || !l.select.code)) throw new Error(`overlay.layers select for ${station} must be { kind: "municipality_code", property, code }`);
    if (l.select !== undefined && l.kind !== 'border') throw new Error(`overlay.layers select for ${station} is only defined for the border kind`);
    if (l.kind === 'border' && (l.geometry !== 'polygon_rings' || l.select?.kind !== 'municipality_code')) throw new Error(`the border layer for ${station} must read polygon_rings of the station's municipality, selected by its code`);
  }
  if (o.clip !== undefined) {
    const c = o.clip as unknown as Record<string, unknown>;
    if (!isRecord(c) || c.kind !== 'origin_disc' || !finite(c.radius_m) || c.radius_m <= 0) throw new Error(`overlay.clip for ${station} must be { kind: "origin_disc", radius_m: positive number }`);
  }
  if (o.window !== undefined) {
    const w = o.window as unknown as Record<string, unknown>;
    if (!isRecord(w) || w.kind !== 'origin_disc' || !finite(w.radius_m) || w.radius_m <= 0) throw new Error(`overlay.window for ${station} must be { kind: "origin_disc", radius_m: positive number }`);
  }
  return o;
}

/** The overlay's own selection window from config: one closed disc around the station frame origin (the director's 700 m decision). */
export function originDiscWindow(config: OverlayWindowConfig): ContextWindow {
  return { spec: { r_origin_m: config.radius_m, r_exit_m: 0, node_rule: null, mesh_margin_m: 0 }, discs: [{ x: 0, y: 0, r: config.radius_m, origin: 'origin', id: 'origin' }], graph: null };
}

/**
 * One receipt per source: the layers are grouped by `source_id` and each group is written as its own run, so a receipt,
 * its credit and its leak guard always belong to exactly one licence record.
 */
export async function contextOverlay(station: string, options: OverlayRunOptions = {}): Promise<{ station_id: string; runs: Array<Record<string, unknown>> }> {
  const config = (await loadContextConfig(station)) as StationContextConfig & { overlay?: unknown };
  const overlay = assertOverlayConfig(station, config.overlay);
  const kinds = options.kinds === undefined ? [...OVERLAY_KINDS] : parseOverlayKinds(options.kinds);
  const layers = overlay.layers.filter((l) => kinds.includes(l.kind));
  if (!layers.length) throw new Error(`No overlay layer of kind ${kinds.join(',')} is configured for ${station}`);
  const groups = new Map<string, OverlayLayerConfig[]>();
  for (const layer of layers) groups.set(layer.source_id, [...(groups.get(layer.source_id) ?? []), layer]);
  const runs: Array<Record<string, unknown>> = [];
  for (const [sourceId, group] of groups) runs.push(await overlayRun(station, config, overlay, sourceId, group, options));
  return { station_id: station, runs };
}

async function overlayRun(station: string, config: StationContextConfig, overlay: OverlayConfig, sourceId: string, layers: OverlayLayerConfig[], options: OverlayRunOptions): Promise<Record<string, unknown>> {
  const started = performance.now();
  const kinds = OVERLAY_KINDS.filter((k) => layers.some((l) => l.kind === k));

  // Frame: a stored station-enu frame, or (when the vertical anchor is undecided) the horizontal origin of station.json only.
  let projection: OverlayProjection, frameFacts: Record<string, unknown>, frameLabel: string;
  if (overlay.frame.mode === 'station-enu-frame') {
    const frame = await loadFrame(overlay.frame.frame_id);
    if (!isStationEnuFrame(frame) || frame.station_id !== station) throw new Error(`Frame ${overlay.frame.frame_id} is not a station-enu frame for ${station}`);
    const stationBytes = await readFile(join(repoRoot, frame.station_json_path));
    const o = (JSON.parse(stationBytes.toString('utf8')) as { station?: { origin?: { lat?: number; lon?: number; hM?: number | null; crs?: string } } }).station?.origin;
    if (!o || o.lat !== frame.origin.lat || o.lon !== frame.origin.lon || o.hM !== frame.origin.hM || o.crs !== frame.origin.crs) throw new Error(`${frame.station_json_path} origin no longer matches frame ${frame.frame_id}; regenerate it with station-frame`);
    projection = { origin: { lat: frame.origin.lat, lon: frame.origin.lon }, project: (lat, lon) => stationHorizontal([lat, lon], frame as StationEnuFrame) };
    frameLabel = frame.frame_id;
    frameFacts = { mode: 'station-enu-frame', frame_id: frame.frame_id, station_json_path: frame.station_json_path, station_origin_sha256: stationOriginSha256(o), origin_crs: frame.origin.crs };
  } else {
    const path = overlay.frame.station_json;
    if (path !== `stations/${station}/gteki/station.json`) throw new Error(`overlay.frame.station_json must be stations/${station}/gteki/station.json`);
    const bytes = await readFile(join(repoRoot, path));
    const o = (JSON.parse(bytes.toString('utf8')) as { station?: { origin?: { lat?: unknown; lon?: unknown; hM?: unknown; crs?: unknown } } }).station?.origin;
    if (!o || !finite(o.lat) || !finite(o.lon)) throw new Error(`${path}: origin lat/lon must be finite numbers`);
    const origin = { lat: o.lat, lon: o.lon };
    const project = stationEnuProjector({ ...origin, hM: 0 });
    projection = { origin, project: (lat, lon) => { const p = project(lat, lon, 0); return [p[0], p[1]]; } };
    frameLabel = 'origin-only';
    frameFacts = { mode: 'origin-only', note: 'horizontal ENU at the station.json origin (evaluated at height 0; no vertical anchor exists and none is asserted); same x/y as the station-enu frame would give to well under a millimetre', station_json_path: path, station_origin_sha256: stationOriginSha256(o), origin_crs: typeof o.crs === 'string' ? o.crs : 'unknown' };
  }

  // z: a per-station constant that must equal the station lead's value in station.json (re-read now).
  const zBytes = await readFile(join(repoRoot, overlay.z.check.path));
  const floors = (JSON.parse(zBytes.toString('utf8')) as { floors?: Array<{ ordinal?: unknown; renderElevationM?: unknown }> }).floors;
  const floor = Array.isArray(floors) ? floors.filter((fl) => fl.ordinal === overlay.z.check.floor_ordinal) : [];
  if (floor.length !== 1 || floor[0]!.renderElevationM !== overlay.z.z_m) throw new Error(`${overlay.z.check.path}: the ordinal-${overlay.z.check.floor_ordinal} floor renderElevationM is not ${overlay.z.z_m}; the z basis no longer matches the station lead's value`);
  const z = overlay.z.z_m;
  if (options.clipRadiusM !== undefined && (!Number.isFinite(options.clipRadiusM) || options.clipRadiusM < 0)) throw new Error('clip radius must be a non-negative number of metres (0 disables clipping)');
  const clipRadius: number | null = options.clipRadiusM !== undefined ? (options.clipRadiusM === 0 ? null : options.clipRadiusM) : (overlay.clip?.radius_m ?? null);
  const clipFacts = { kind: clipRadius === null ? 'none' : 'origin_disc', radius_m: clipRadius };
  const evidenceField = `floors[ordinal ${overlay.z.check.floor_ordinal}].${overlay.z.check.field}`;
  const zFacts = { mode: 'constant', z_m: z, basis: overlay.z.basis, datum_asserted: false, drape: 'none', baked_offset_m: 0, evidence_path: overlay.z.check.path, evidence_value_sha256: sha256(JSON.stringify({ field: evidenceField, value: z })), evidence_field: evidenceField };

  // Selection window: the overlay's own origin disc when configured (the director's 700 m decision), else the building window.
  const window = overlay.window
    ? originDiscWindow({ kind: 'origin_disc', radius_m: options.radiusM ?? overlay.window.radius_m })
    : await buildContextWindow(
      { r_origin_m: options.radiusM ?? config.window?.r_origin_m ?? config.radius_m, r_exit_m: options.exitRadiusM ?? config.window?.r_exit_m ?? 0, ...(config.window?.node_rule ? { node_rule: config.window.node_rule } : {}), ...(config.window?.mesh_margin_m !== undefined ? { mesh_margin_m: config.window.mesh_margin_m } : {}) },
      { stationId: station, ...(options.graphPath ? { graphPath: options.graphPath } : {}), ...(options.poisPath ? { poisPath: options.poisPath } : {}) },
    );

  const stored = await getStoredSource(sourceId);
  if (!stored.source.station_ids.includes(station)) throw new Error(`${sourceId} is not declared for station ${station}`);
  const wanted = new Set(layers.map((l) => l.member));
  const entries = await readZip(stored.path, { include: (name) => wanted.has(name) });
  const selected: Array<ReturnType<typeof selectLayer> & { layer: OverlayLayerConfig }> = [];
  for (const layer of layers) {
    const matches = entries.filter((e) => e.name === layer.member);
    if (matches.length !== 1) throw new Error(`${layer.member} is not exactly one member of ${layer.source_id}`);
    const bytes = matches[0]!.data;
    selected.push({ layer, ...selectLayer({ layer, sourceSha256: stored.record.sha256, memberSha256: sha256(bytes), collection: JSON.parse(bytes.toString('utf8')) }, projection, window, z, clipRadius) });
  }
  const features = selected.flatMap((s) => s.features);
  // A source whose features all fall outside the window is an honest empty result for that source (e.g. a ward boundary
  // farther than the clip radius); the receipt records the counts and no geometry is written. Other sources still run.
  const empty = features.length === 0;
  const sourceValues = new Set<string>(selected.flatMap((s) => [...s.sourceValues]));
  const credit = stored.source.attribution_text;
  const windowLabel = overlay.window
    ? `origin_disc ${window.discs[0]!.r} m, ${window.discs.length} disc`
    : `r_origin ${window.spec.r_origin_m} m, r_exit ${window.spec.r_exit_m} m, ${window.discs.length} discs`;
  const meta: OverlayMeta = { station_id: station, frame_label: frameLabel, credit, source_id: sourceId, source_sha256: stored.record.sha256, z_m: z, z_basis: overlay.z.basis, clip: clipFacts, window_label: windowLabel };

  const fingerprint = await toolFingerprint();
  const digest = sha256(JSON.stringify({ policy: OVERLAY_POLICY_VERSION, frame: frameFacts, window: window.spec, discs: window.discs.map((d) => [d.id, d.x, d.y, d.r]), graph: window.graph?.graph_sha256 ?? null, pois: window.graph?.pois?.pois_sha256 ?? null, z: zFacts, layers: selected.map((s) => [s.layer.kind, s.layer.member, s.counts.member_sha256, s.layer.ribbon_width_m]), source: stored.record.sha256, glb: options.glb !== false, clip: clipFacts, fingerprint })).slice(0, 20);
  const exitPart = window.spec.r_exit_m > 0 ? `-x${window.spec.r_exit_m}` : '';
  const kindsPart = kinds.length === OVERLAY_KINDS.length ? '' : `-${kinds.join('-')}`;

  const runId = `overlay-${station}-r${window.spec.r_origin_m}${exitPart}-${frameLabel}${kindsPart}-${digest}`;

  const geojson = empty ? '' : overlayGeoJson(features, meta);
  if (!empty) assertNoSourceValues(geojson, sourceValues, 'The overlay GeoJSON');
  const out = join(getStoreRoot(), 'out');
  await mkdir(out, { recursive: true });
  const byKind = (k: OverlayKind): OverlayFeature[] => features.filter((f) => f.kind === k);
  const featureHashes: Record<string, string[]> = {};
  for (const k of OVERLAY_KINDS) if (kinds.includes(k)) featureHashes[k] = byKind(k).map((f) => f.feature_hash);
  const hashDigests = Object.fromEntries(Object.entries(featureHashes).map(([k, v]) => [k, sha256(JSON.stringify([...v].sort()))]));
  const outputs: Record<string, unknown> = {};
  if (!empty) {
    const geojsonRel = `out/${runId}.geojson`;
    await writeFile(join(getStoreRoot(), geojsonRel), geojson);
    outputs.geojson = { store_path: geojsonRel, sha256: sha256(geojson), bytes: Buffer.byteLength(geojson) };
  }
  if (options.glb !== false && !empty) {
    const glbRel = `out/${runId}.glb`, glbPath = join(getStoreRoot(), glbRel);
    const glbInfo = await writeOverlayGlb(glbPath, layers.map((l) => ({ kind: l.kind, width_m: l.ribbon_width_m, features: byKind(l.kind) })), { ...meta, feature_hashes_sha256: hashDigests });
    const glbBytes = await readFile(glbPath);
    outputs.glb = { store_path: glbRel, sha256: sha256(glbBytes), bytes: glbBytes.length, nodes: Object.keys(glbInfo.triangles).sort(), triangles: glbInfo.triangles, readback: glbInfo.readback, segments_skipped_zero_length: glbInfo.segments_skipped_zero_length };
  }
  const counts = selected.map((s) => s.counts);
  const bbox = overlayBBox(features);
  const selectionRule = 'A feature is selected when any segment of its projected polyline meets a closed disc of the window; selected features are then clipped to the clip disc (when one is configured), after projection; without a clip they are kept whole.' +
    (layers.some((l) => l.kind === 'border') ? ' The border layer first keeps only the municipality polygon whose code matches the station\'s ward (the code and property name are not copied); its rings are read as closed lines and no ring role or name is carried.' : '');
  const windowFacts = overlay.window
    ? { kind: 'origin_disc', radius_m: window.discs[0]!.r, center: 'station frame origin', disc_count: window.discs.length, selection_rule: selectionRule }
    : { kind: 'graph_discs', r_origin_m: window.spec.r_origin_m, r_exit_m: window.spec.r_exit_m, disc_count: window.discs.length, mesh_margin_m: window.spec.mesh_margin_m, node_rule: window.spec.node_rule, graph_sha256: window.graph?.graph_sha256 ?? null, pois_sha256: window.graph?.pois?.pois_sha256 ?? null, selection_rule: selectionRule };
  const sourceFacts = { source_id: sourceId, source_sha256: stored.record.sha256, bytes: stored.record.bytes, license_name: stored.source.license_name, license_url: stored.source.license_url, publish_gate: stored.source.publish_gate };
  const receipt = publicOverlayReceipt({ run_id: runId, station_id: station, frame: frameFacts, window: windowFacts, z: zFacts, credit, source: sourceFacts, layers: counts, feature_hashes: featureHashes, bbox, outputs, tool_input_sha256: fingerprint, policy_version: OVERLAY_POLICY_VERSION, clip: clipFacts }, sourceValues);
  // Sidecar (private store): the receipt plus the per-feature table (source index, vertex count) and the stored-source records.
  const table = { columns: ['kind', 'source_index', 'feature_hash', 'vertices', 'vertices_before_clip', 'clipped'], rows: features.map((f) => [f.kind, f.source_index, f.feature_hash, f.parts.reduce((n, p) => n + p.length, 0), f.vertices_before_clip, f.clipped]) };
  const sidecarRel = `out/${runId}.provenance.json`;
  await writeJson(join(getStoreRoot(), sidecarRel), { ...receipt, feature_table: table, source_record: stored.record, source_manifest: stored.source, elapsed_ms: Math.round(performance.now() - started), peak_rss_bytes: process.resourceUsage().maxRSS * 1024 });
  const receiptDir = options.receiptDir ?? join(docsRoot, 'gis', 'context');
  await writeJson(join(receiptDir, `${runId}.json`), receipt);
  return { ...receipt, sidecar_path: sidecarRel, receipt_path: `docs/gis/context/${runId}.json` };
}
