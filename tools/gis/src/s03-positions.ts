import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getStoredSource, getStoreRoot, packageRoot, repoRoot, writeJson } from './common.js';
import { assertNoSourceValues } from './context-overlay.js';
import { geodeticToEcef, stationEnuProjector } from './station-enu.js';
import { toolFingerprint } from './provenance.js';
import { readZip } from './zip.js';
import {
  S03_DATUM, S03_FLOOR_ORDINALS, assertS03Bytes, floorMappingSha256, nearestPointOnSegment, parseS03Members, pointInPolygon,
  residualStats, type Point2, type Polygon2, type S03Inputs, type S03Level,
} from './s03-transform.js';

/**
 * WP8 representative points for the S03 gates and transfers (gteki-1b ruling, 2026-10-24). One point per candidate,
 * for search display only: approximate, NOT_FOR_ROUTING, gteki_role context, floor UNVERIFIED. The 19 platforms stay
 * name-only. This is not a rights PASS and it does not release routing use.
 *
 * Entity identity: the entity ids are read from the research record of the same 45 POIs, read-only, and joined to the
 * shipped POIs by POI id. `s03.entityId` there is the numeric feature id of its `geojson-level-geom-*.geojson` member,
 * not a com-entity id. `stations/**` is never written by this tool.
 */
export const S03_POSITIONS_POLICY = 's03-positions-v1';
export const UNCERTAINTY_FLOOR_M = 5;
export const POSITION_LABEL = 'approximate (±max(5 m, polygon radius))';
export const S03_CREDIT = '出典：東京都都市整備局「新宿駅周辺の施設情報等」';
export const STATION_PATH = 'stations/shinjuku/gteki/station.json';
export const POIS_PATH = 'stations/shinjuku/gteki/pois.json';
export const ENTITY_SOURCE_PATH = 'docs/research/lines/shinjuku-line-pois.json';
export const S03_SOURCE_ID = 'tokyo-s03-zip';
/** The counts the ruling names; anything else fails closed and reports the difference. */
export const EXPECTED_S03_POI_COUNTS: Readonly<Record<string, number>> = { ticket_gate: 23, transfer: 3, platform: 19 };
/**
 * The counts this data must produce: 26 candidates (23 gates, 3 transfers), one of them unpointed because its geometry
 * is excluded by the WP7 topology ruling, and 19 platforms that keep no point. Any other outcome stops the run.
 */
export const EXPECTED_POSITION_COUNTS = { pointed: 25, unpointed: 1, platforms: 19 } as const;
export const CANDIDATE_CATEGORIES = ['ticket_gate', 'transfer'] as const;
export const SKIPPED_CATEGORY = 'platform';
/**
 * The one candidate the reviewed data leaves unpointed, and why. The count check alone would accept any substitution,
 * so the identity, the reason and the level are pinned here as well.
 */
export const EXPECTED_UNPOINTED = { poi_id: 'poi:keio-gate:1', reason: 'SOURCE_DEFECT_HOLE_OUTSIDE_SHELL', floor_ordinal: -1 } as const;

const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const point = (value: readonly number[]): Point2 => [value[0]!, value[1]!];

export type PositionMethod = 'area_weighted_centroid' | 'largest_part_closest_point';
export const POSITION_METHODS: readonly PositionMethod[] = ['area_weighted_centroid', 'largest_part_closest_point'];

export interface S03Selection {
  poiId: string;
  category: (typeof CANDIDATE_CATEGORIES)[number] | typeof SKIPPED_CATEGORY;
  entityId: number;
  levelLabel: string;
}

/**
 * `s03.entityId` arrives either as a positive safe integer or as the source's `$id <n>` reference text. Nothing else
 * is coerced: an unrecognised form fails closed rather than being guessed.
 */
export function parseS03EntityId(value: unknown, poiId: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string') {
    const match = /^\$id (\d+)$/.exec(value);
    if (match) {
      const id = Number(match[1]);
      if (Number.isSafeInteger(id) && id > 0) return id;
    }
  }
  throw new Error(`${poiId}: unsupported s03.entityId ${JSON.stringify(value)}; expected a positive integer or "$id <n>"`);
}

const jaNames = (names: unknown): string[] => !Array.isArray(names) ? [] : names.flatMap(name =>
  record(name) && name.lang === 'ja' && typeof name.text === 'string' ? [name.text] : []);

const s03SourceIds = (poi: Record<string, unknown>): string[] => {
  const evidence = poi.evidence;
  return record(evidence) && Array.isArray(evidence.sourceIds) ? evidence.sourceIds.filter((id): id is string => typeof id === 'string') : [];
};

/**
 * Join the shipped POIs that cite the S03 ZIP to the research record that still carries `s03.entityId`, by POI id.
 * Every such POI must match exactly one research entry with the same id, category and single ja name, and every research
 * entry that declares an S03 entity must be matched back. The category counts the ruling names are enforced last.
 */
export function joinS03Pois(poisDocument: unknown, entityDocument: unknown): S03Selection[] {
  const pois = record(poisDocument) && Array.isArray(poisDocument.pois) ? poisDocument.pois : null;
  const research = record(entityDocument) && Array.isArray(entityDocument.pois) ? entityDocument.pois : null;
  if (!pois) throw new Error(`${POIS_PATH}: expected a pois array`);
  if (!research) throw new Error(`${ENTITY_SOURCE_PATH}: expected a pois array`);
  const researchById = new Map<string, Record<string, unknown>>();
  for (const entry of research) {
    if (!record(entry) || typeof entry.id !== 'string' || !entry.id) throw new Error(`${ENTITY_SOURCE_PATH}: POI without a string id`);
    if (researchById.has(entry.id)) throw new Error(`${ENTITY_SOURCE_PATH}: duplicate POI id ${entry.id}`);
    researchById.set(entry.id, entry);
  }
  const shipped = new Map<string, Record<string, unknown>>();
  for (const poi of pois) {
    if (!record(poi) || typeof poi.id !== 'string' || !poi.id) throw new Error(`${POIS_PATH}: POI without a string id`);
    if (shipped.has(poi.id)) throw new Error(`${POIS_PATH}: duplicate POI id ${poi.id}`);
    shipped.set(poi.id, poi);
  }
  const s03Pois = [...shipped.values()].filter(poi => s03SourceIds(poi).includes(S03_SOURCE_ID));
  const matched = new Set<string>();
  const selections: S03Selection[] = [];
  for (const poi of s03Pois) {
    const poiId = poi.id as string, entry = researchById.get(poiId);
    if (!entry) throw new Error(`${poiId}: cites ${S03_SOURCE_ID} but has no entry in ${ENTITY_SOURCE_PATH}`);
    if (matched.has(poiId)) throw new Error(`${poiId}: matched twice`);
    if (!record(entry.s03)) throw new Error(`${poiId}: entry in ${ENTITY_SOURCE_PATH} has no s03 block`);
    if (entry.category !== poi.category) throw new Error(`${poiId}: category ${String(poi.category)} differs from research ${String(entry.category)}`);
    const shippedNames = jaNames(poi.names), researchNames = jaNames(entry.names);
    if (shippedNames.length !== 1 || researchNames.length !== 1 || shippedNames[0] !== researchNames[0])
      throw new Error(`${poiId}: the ja name differs between ${POIS_PATH} and ${ENTITY_SOURCE_PATH}`);
    const levels = Array.isArray(entry.s03.levels) ? entry.s03.levels : null;
    if (!levels || levels.length !== 1 || typeof levels[0] !== 'string' || !Object.hasOwn(S03_FLOOR_ORDINALS, levels[0]))
      throw new Error(`${poiId}: s03.levels must name exactly one level of the asserted mapping`);
    const category = poi.category;
    if (category !== 'ticket_gate' && category !== 'transfer' && category !== SKIPPED_CATEGORY)
      throw new Error(`${poiId}: category ${String(category)} is neither a candidate nor ${SKIPPED_CATEGORY}`);
    matched.add(poiId);
    selections.push({ poiId, category, entityId: parseS03EntityId(entry.s03.entityId, poiId), levelLabel: levels[0] });
  }
  for (const entry of research) {
    if (record(entry.s03) && !matched.has(entry.id as string)) throw new Error(`${entry.id as string}: declares an S03 entity but is not an S03-citing POI in ${POIS_PATH}`);
  }
  const counts: Record<string, number> = {};
  for (const selection of selections) counts[selection.category] = (counts[selection.category] ?? 0) + 1;
  const actual = Object.keys(counts).sort().map(category => `${category}=${counts[category]}`).join(', ');
  const expected = Object.keys(EXPECTED_S03_POI_COUNTS).sort().map(category => `${category}=${EXPECTED_S03_POI_COUNTS[category]}`).join(', ');
  if (actual !== expected) throw new Error(`${S03_SOURCE_ID}: POI counts are ${actual}; the ruling names ${expected}`);
  const entityIds = new Set<number>();
  for (const selection of selections) {
    if (entityIds.has(selection.entityId)) throw new Error(`${selection.poiId}: S03 feature id ${selection.entityId} is claimed by more than one POI`);
    entityIds.add(selection.entityId);
  }
  return selections.sort((a, b) => a.poiId < b.poiId ? -1 : a.poiId > b.poiId ? 1 : 0);
}

/** Gates and transfers are candidates; platforms are listed and keep no point. */
export function splitSelections(selections: readonly S03Selection[]): { candidates: S03Selection[]; platforms: S03Selection[] } {
  return { candidates: selections.filter(selection => selection.category !== SKIPPED_CATEGORY),
    platforms: selections.filter(selection => selection.category === SKIPPED_CATEGORY) };
}

/**
 * Where a selected entity id lives. Exactly one used level feature is a point candidate; no used feature is a source
 * feature excluded by a WP7 ruling, recorded with its reason and never given a position; anything else fails closed.
 */
export type SelectionLocation =
  | { kind: 'feature'; level: S03Level; polygons: Polygon2[] }
  | { kind: 'excluded'; reason: string; levelId: number };
export function locateSelection(inputs: S03Inputs, selection: S03Selection): SelectionLocation {
  const hits = inputs.levels.flatMap(level => level.features.filter(feature => feature.featureId === selection.entityId)
    .map(feature => ({ level, polygons: feature.polygons })));
  if (hits.length === 1) return { kind: 'feature', ...hits[0]! };
  if (hits.length !== 0) throw new Error(`${selection.poiId}: S03 feature id ${selection.entityId} resolves to ${hits.length} used level features; expected at most one`);
  const defect = inputs.sourceDefects.find(entry => entry.featureId === selection.entityId);
  if (!defect) throw new Error(`${selection.poiId}: S03 feature id ${selection.entityId} is neither a used level feature nor a recorded source defect`);
  return { kind: 'excluded', reason: defect.kind, levelId: defect.levelId };
}

/**
 * The unpointed candidate must be exactly the one the lead ruled on, with its reason and its feature's level matching
 * the level it declares. Any substitution, an extra exclusion or a missing level file stops the run.
 */
export function assertUnpointed(unpointed: readonly { poi_id: string; reason: string; level_id: number }[],
  candidates: readonly S03Selection[], inputs: S03Inputs): void {
  if (unpointed.length !== 1) throw new Error(`S03 positions: ${unpointed.length} unpointed candidates; the ruling names exactly ${EXPECTED_UNPOINTED.poi_id}`);
  const [entry] = unpointed as [typeof unpointed[number]];
  if (entry.poi_id !== EXPECTED_UNPOINTED.poi_id)
    throw new Error(`S03 positions: ${entry.poi_id} is unpointed; the ruling names only ${EXPECTED_UNPOINTED.poi_id}`);
  if (entry.reason !== EXPECTED_UNPOINTED.reason)
    throw new Error(`${entry.poi_id}: unpointed reason ${entry.reason}; the ruling names ${EXPECTED_UNPOINTED.reason}`);
  const selection = candidates.find(candidate => candidate.poiId === entry.poi_id);
  if (!selection) throw new Error(`${entry.poi_id}: unpointed but not a gate or transfer candidate`);
  const level = inputs.levels.find(candidate => candidate.id === entry.level_id);
  if (!level) throw new Error(`${entry.poi_id}: excluded feature level ${entry.level_id} is not a parsed S03 level`);
  if (level.label !== selection.levelLabel)
    throw new Error(`${entry.poi_id}: excluded feature level ${level.label} differs from its declared s03.levels ${selection.levelLabel}`);
  // The ordinal is pinned too, so a declaration and a parsed level that change together still fail.
  const declaredOrdinal = S03_FLOOR_ORDINALS[selection.levelLabel];
  if (declaredOrdinal !== EXPECTED_UNPOINTED.floor_ordinal)
    throw new Error(`${entry.poi_id}: declared s03.levels ${selection.levelLabel} has ordinal ${declaredOrdinal}; the ruling names ordinal ${EXPECTED_UNPOINTED.floor_ordinal}`);
  if (level.ordinal !== EXPECTED_UNPOINTED.floor_ordinal)
    throw new Error(`${entry.poi_id}: excluded feature level ${level.label} has ordinal ${level.ordinal}; the ruling names ordinal ${EXPECTED_UNPOINTED.floor_ordinal}`);
}

/** Point candidates and platforms against the counts this data must produce; any other outcome stops the run. */
export function assertPositionCounts(pointed: number, unpointed: number, platforms: number): void {
  const actual = `pointed=${pointed}, unpointed=${unpointed}, platforms=${platforms}`;
  const expected = `pointed=${EXPECTED_POSITION_COUNTS.pointed}, unpointed=${EXPECTED_POSITION_COUNTS.unpointed}, platforms=${EXPECTED_POSITION_COUNTS.platforms}`;
  if (actual !== expected) throw new Error(`S03 positions produced ${actual}; the reviewed data produces ${expected}`);
}

const ringAreaCentroid = (ring: readonly Point2[]): { area: number; centroid: Point2 } => {
  let twiceArea = 0, x = 0, y = 0;
  for (let index = 0; index + 1 < ring.length; index++) {
    const [x1, y1] = ring[index]!, [x2, y2] = ring[index + 1]!, cross = x1 * y2 - x2 * y1;
    twiceArea += cross; x += (x1 + x2) * cross; y += (y1 + y2) * cross;
  }
  const area = twiceArea / 2;
  if (area === 0) return { area: 0, centroid: point(ring[0]!) };
  return { area: Math.abs(area), centroid: [x / (6 * area), y / (6 * area)] };
};

/** Net area and area-weighted centroid of one part: the shell less its holes, whatever the ring orientations are. */
export function partAreaCentroid(part: Polygon2): { area: number; centroid: Point2 } {
  const shell = ringAreaCentroid(part[0]!);
  let area = shell.area, x = shell.centroid[0] * shell.area, y = shell.centroid[1] * shell.area;
  for (const hole of part.slice(1)) {
    const inner = ringAreaCentroid(hole);
    area -= inner.area; x -= inner.centroid[0] * inner.area; y -= inner.centroid[1] * inner.area;
  }
  return area > 0 ? { area, centroid: [x / area, y / area] } : { area: 0, centroid: shell.centroid };
}

const nearestBoundaryPoint = (from: Point2, part: Polygon2): Point2 => {
  let best: Point2 | null = null, bestDistance = Infinity;
  for (const ring of part) for (let index = 0; index + 1 < ring.length; index++) {
    const candidate = nearestPointOnSegment(from, ring[index]!, ring[index + 1]!);
    const distance = Math.hypot(candidate[0] - from[0], candidate[1] - from[1]);
    if (distance < bestDistance) { bestDistance = distance; best = candidate; }
  }
  if (!best) throw new Error('polygon part has no edge to fall back to');
  return best;
};

export interface RepresentativePoint { point: Point2; method: PositionMethod; radius_m: number; part_count: number; vertex_count: number }
const AREA_EPS = 1e-9;

/**
 * Area-weighted centroid of all parts; when that point lies outside every part, the closest point of the largest part's
 * boundary is used instead. The closed polygon surface counts a boundary position as inside, so the fallback is a
 * position on the source polygon, never an invented interior offset. `radius_m` is the largest distance from the chosen
 * point to any vertex of any part.
 */
export function representativePoint(parts: readonly Polygon2[]): RepresentativePoint {
  if (!parts.length) throw new Error('a representative point needs at least one polygon part');
  const metrics = parts.map(partAreaCentroid);
  const totalArea = metrics.reduce((sum, entry) => sum + entry.area, 0);
  if (!(totalArea > AREA_EPS)) throw new Error('polygon parts have no positive area; a representative point is undefined');
  const centroid: Point2 = [metrics.reduce((sum, entry) => sum + entry.centroid[0] * entry.area, 0) / totalArea,
    metrics.reduce((sum, entry) => sum + entry.centroid[1] * entry.area, 0) / totalArea];
  let chosen = centroid, method: PositionMethod = 'area_weighted_centroid';
  if (!parts.some((part, index) => metrics[index]!.area > 0 && pointInPolygon(centroid, part))) {
    let largest = 0;
    metrics.forEach((entry, index) => { if (entry.area > metrics[largest]!.area) largest = index; });
    chosen = nearestBoundaryPoint(centroid, parts[largest]!);
    if (!pointInPolygon(chosen, parts[largest]!)) throw new Error('the fallback point is not on the largest part');
    method = 'largest_part_closest_point';
  }
  let radius = 0, vertices = 0;
  for (const part of parts) for (const ring of part) for (const vertex of ring) {
    vertices++;
    radius = Math.max(radius, Math.hypot(vertex[0] - chosen[0], vertex[1] - chosen[1]));
  }
  return { point: chosen, method, radius_m: radius, part_count: parts.length, vertex_count: vertices };
}

/**
 * max(5 m, radius) rounded up to 0.1 m. The 1e-8 m tolerance keeps a binary floating tail (for example a radius of
 * 5.000000000000001) from adding a whole 0.1 m, while a real excess still rounds up.
 */
export function uncertaintyFor(radiusM: number): number {
  return Math.ceil(Math.max(UNCERTAINTY_FLOOR_M, radiusM) * 10 - 1e-7) / 10;
}

export interface PositionsDigestFacts {
  policy_version: string; tool_input_sha256: string; zip_sha256: string; station_json_sha256: string;
  pois_json_sha256: string; entity_source_sha256: string; floor_mapping_sha256: string;
  /** The effective publish gate this run shipped under, and the manifest bytes that state it. */
  publish_gate: string; sources_yaml_sha256: string;
}
/** Receipt identity: the facts object is hashed in this key order and truncated to 20 hex characters. */
export function positionsIdentity(facts: PositionsDigestFacts) {
  const digest = sha256(JSON.stringify(facts)).slice(0, 20);
  return { digest_inputs: facts, digest, run_id: `positions-${digest}` };
}
export const POSITIONS_FLOOR_MAPPING_SHA256 = (): string =>
  floorMappingSha256(Object.entries(S03_FLOOR_ORDINALS).map(([id, ordinal]) => ({ id, ordinal })));

const RAD = Math.PI / 180;
const A = 6378137.0, F = 1 / 298.257222101, E2 = F * (2 - F);
/**
 * Inverse of the horizontal station projection. ENU -> ECEF is exact (the forward frame is a pure rotation about the
 * origin); ECEF -> geodetic then has no closed form and is solved by fixed-point iteration to convergence. The height
 * it returns is dropped, because the forward frame evaluates every point at ellipsoidal height 0. The caller
 * re-projects the result and fails closed on any round-trip mismatch, so no position is reported that the frame does
 * not return.
 */
export function enuToGeodetic(origin: { lat: number; lon: number }, east: number, north: number): { lat: number; lon: number } {
  const [x0, y0, z0] = geodeticToEcef(origin.lat, origin.lon, 0);
  const p = origin.lat * RAD, l = origin.lon * RAD;
  const x = x0 - Math.sin(l) * east - Math.sin(p) * Math.cos(l) * north;
  const y = y0 + Math.cos(l) * east - Math.sin(p) * Math.sin(l) * north;
  const z = z0 + Math.cos(p) * north;
  const horizontal = Math.hypot(x, y);
  let lat = Math.atan2(z, horizontal * (1 - E2));
  for (let step = 0; step < 20; step++) {
    const sin = Math.sin(lat), next = Math.atan2(z + E2 * (A / Math.sqrt(1 - E2 * sin * sin)) * sin, horizontal);
    if (Math.abs(next - lat) < 1e-15) { lat = next; break; }
    lat = next;
  }
  return { lat: lat / RAD, lon: Math.atan2(y, x) / RAD };
}

/**
 * The restriction labels travel on every record, not only on the document, so a record lifted out of the file cannot be
 * read as a routing position.
 */
export const POSITION_RECORD_LABELS = Object.freeze({ position: POSITION_LABEL, navigation_use: 'NOT_FOR_ROUTING',
  gteki_role: 'context', floor: 'UNVERIFIED' });

export interface PointedPosition {
  poi_id: string; s03_entity_id: number; category: string; level_id: number; level_label: string; floor_ordinal: number;
  lon: number; lat: number; east_m: number; north_m: number; radius_m: number; uncertainty_m: number;
  method: PositionMethod; part_count: number; vertex_count: number;
  labels: typeof POSITION_RECORD_LABELS;
}

/** The public receipt: counts and distributions only. No coordinate, name or source id, and no dynamic string keys. */
export function buildPositionsReceipt(args: {
  digest_inputs: PositionsDigestFacts; digest: string; run_id: string; publish_gate: string; zip_sha256: string;
  pointed: readonly PointedPosition[]; unpointed: readonly { reason: string }[]; platform_count: number; s03_poi_count: number;
  inputs: readonly { role: string; path: string; sha256: string }[]; private_output: { path: string; sha256: string; bytes: number };
}) {
  const uncertainty = residualStats(args.pointed.map(position => position.uncertainty_m));
  const ordinals = [...new Set(args.pointed.map(position => position.floor_ordinal))].sort((a, b) => a - b);
  return {
    policy_version: S03_POSITIONS_POLICY,
    ...positionsIdentity(args.digest_inputs),
    source_id: S03_SOURCE_ID,
    source_sha256: args.zip_sha256,
    publish_gate: args.publish_gate,
    gteki_role: 'context',
    navigation_use: 'NOT_FOR_ROUTING',
    verification: 'UNVERIFIED',
    label: POSITION_LABEL,
    counts: { candidates: args.pointed.length + args.unpointed.length, pointed: args.pointed.length, unpointed: args.unpointed.length,
      platforms_skipped: args.platform_count, s03_citing_pois: args.s03_poi_count },
    unpointed: [...new Set(args.unpointed.map(entry => entry.reason))].sort().map(reason => ({ reason, count: args.unpointed.filter(entry => entry.reason === reason).length })),
    methods: POSITION_METHODS.map(method => ({ method, count: args.pointed.filter(position => position.method === method).length })).filter(entry => entry.count > 0),
    uncertainty_m: { rule: `max(${UNCERTAINTY_FLOOR_M} m, radius to the farthest vertex) rounded up to 0.1 m`,
      count: uncertainty.count, min: uncertainty.min_m, median: uncertainty.median_m, p90: uncertainty.p90_m, max: uncertainty.max_m },
    floor_counts: ordinals.map(ordinal => ({ floor_ordinal: ordinal, pointed: args.pointed.filter(position => position.floor_ordinal === ordinal).length })),
    floor_mapping: { verification: 'UNVERIFIED', rule: 'The S03 level label maps to a comparison ordinal by assertion (docs/gis/s03/...); it is not a station floor and not an elevation.' },
    position_rule: 'One representative point per gate or transfer: the area-weighted centroid of all parts of its S03 feature geometry in horizontal station ENU; if that point is outside every part, the closest point of the largest part boundary instead. A candidate whose feature is excluded by the WP7 topology ruling stays unpointed, with its reason code only. Platforms keep no point. Search display only; never routing or connectors.',
    public_receipt_rule: 'This receipt carries counts and distributions only: no coordinate, no POI name and no S03 entity or feature id. The `source_id` is GTEki\'s own registry id for the dataset, not a value read from the source.',
    inputs: args.inputs.map(input => ({ role: input.role, path: input.path, sha256: input.sha256 })),
    outputs: { private: { store_path: args.private_output.path, sha256: args.private_output.sha256, bytes: args.private_output.bytes } },
  };
}

/** Offline evidence only: the conditional gate is recorded, never read as permission for routing use. */
export async function s03Positions() {
  const stored = await getStoredSource(S03_SOURCE_ID), zipBytes = await readFile(stored.path);
  assertS03Bytes(zipBytes, stored.record);
  const inputs = parseS03Members(await readZip(zipBytes, { legacyFileNameEncoding: 'shift_jis' }));
  const [stationBytes, poisBytes, entityBytes] = await Promise.all([
    readFile(join(repoRoot, STATION_PATH)), readFile(join(repoRoot, POIS_PATH)), readFile(join(repoRoot, ENTITY_SOURCE_PATH))]);
  const station = JSON.parse(stationBytes.toString('utf8')) as { station?: { origin?: { lat?: unknown; lon?: unknown; crs?: unknown } } };
  const origin = station.station?.origin;
  if (!origin || !finite(origin.lat) || !finite(origin.lon) || Math.abs(origin.lon) > 180 || Math.abs(origin.lat) > 90 || origin.crs !== 'EPSG:6668')
    throw new Error(`${STATION_PATH}: invalid station geographic origin`);
  const frame = stationEnuProjector({ lat: origin.lat, lon: origin.lon, hM: 0 });
  const project = (lat: number, lon: number): Point2 => { const p = frame(lat, lon, 0); return [p[0], p[1]]; };
  const selections = joinS03Pois(JSON.parse(poisBytes.toString('utf8')), JSON.parse(entityBytes.toString('utf8')));
  const { candidates, platforms: skippedPlatforms } = splitSelections(selections);
  const platforms = skippedPlatforms.map(selection => ({ poi_id: selection.poiId, s03_entity_id: selection.entityId, category: selection.category }));
  const pointed: PointedPosition[] = [];
  const unpointed: Array<{ poi_id: string; s03_entity_id: number; category: string; reason: string; level_id: number }> = [];
  for (const selection of candidates) {
    const location = locateSelection(inputs, selection);
    if (location.kind === 'excluded') {
      // The feature is excluded whole by a WP7 ruling; the POI stays name-only and no geometry is repaired.
      unpointed.push({ poi_id: selection.poiId, s03_entity_id: selection.entityId, category: selection.category,
        reason: location.reason, level_id: location.levelId });
      continue;
    }
    const { level, polygons } = location;
    if (level.label !== selection.levelLabel)
      throw new Error(`${selection.poiId}: declared level differs from the feature's level file`);
    const parts = polygons.map(part => part.map(ring => ring.map(([lon, lat]) => project(lat, lon))));
    const representative = representativePoint(parts);
    const [east, north] = representative.point;
    const { lat, lon } = enuToGeodetic({ lat: origin.lat as number, lon: origin.lon as number }, east, north);
    // The tangent-plane inverse is horizontal; the re-projected ENU must return the same point within a millimetre.
    const roundTrip = project(lat, lon);
    if (Math.hypot(roundTrip[0] - east, roundTrip[1] - north) > 1e-3) throw new Error(`${selection.poiId}: lon/lat does not round-trip through the station frame`);
    pointed.push({ poi_id: selection.poiId, s03_entity_id: selection.entityId, category: selection.category,
      level_id: level.id, level_label: level.label, floor_ordinal: level.ordinal, lon, lat, east_m: east, north_m: north,
      radius_m: representative.radius_m, uncertainty_m: uncertaintyFor(representative.radius_m), method: representative.method,
      part_count: representative.part_count, vertex_count: representative.vertex_count, labels: POSITION_RECORD_LABELS });
  }
  assertUnpointed(unpointed, candidates, inputs);
  assertPositionCounts(pointed.length, unpointed.length, platforms.length);
  const sourcesBytes = await readFile(join(packageRoot, 'sources', 'sources.yaml'));
  const digestInputs: PositionsDigestFacts = { policy_version: S03_POSITIONS_POLICY, tool_input_sha256: await toolFingerprint(),
    zip_sha256: stored.record.sha256, station_json_sha256: sha256(stationBytes), pois_json_sha256: sha256(poisBytes),
    entity_source_sha256: sha256(entityBytes), floor_mapping_sha256: POSITIONS_FLOOR_MAPPING_SHA256(),
    publish_gate: stored.source.publish_gate, sources_yaml_sha256: sha256(sourcesBytes) };
  const identity = positionsIdentity(digestInputs);
  const privatePath = `out/s03/${identity.run_id}.json`;
  const privateDocument = {
    policy_version: S03_POSITIONS_POLICY, digest_inputs: digestInputs, digest: identity.digest, run_id: identity.run_id,
    source_id: S03_SOURCE_ID, source_record: stored.record, credit: S03_CREDIT,
    labels: POSITION_RECORD_LABELS,
    datum: S03_DATUM,
    frame: { station_json_path: STATION_PATH, station_json_sha256: sha256(stationBytes), ellipsoid: 'GRS80', horizontal_calculation_height_m: 0,
      projected_datum_asserted: false, floor_mapping_rule: 'The S03 level label maps to a comparison ordinal by assertion, from the same map WP7 uses; the level mapping stays UNVERIFIED.' },
    entity_source: { path: ENTITY_SOURCE_PATH, sha256: sha256(entityBytes),
      field_rule: 's03.entityId is the numeric feature id of its geojson-level-geom member, not a com-entity id. The file is read-only; stations/** is untouched.' },
    inputs: [{ role: 'pois', path: POIS_PATH, sha256: sha256(poisBytes) }, { role: 'entity_source', path: ENTITY_SOURCE_PATH, sha256: sha256(entityBytes) }],
    positions: pointed,
    unpointed,
    platforms_skipped: platforms,
  };
  // Exactly the bytes writeJson writes below, so the receipt hash describes the stored file.
  const privateText = `${JSON.stringify(privateDocument, null, 2)}\n`;
  const receipt = buildPositionsReceipt({ digest_inputs: digestInputs, digest: identity.digest, run_id: identity.run_id,
    publish_gate: stored.source.publish_gate, zip_sha256: stored.record.sha256, pointed, unpointed, platform_count: platforms.length,
    s03_poi_count: selections.length,
    inputs: [{ role: 'station', path: STATION_PATH, sha256: sha256(stationBytes) }, { role: 'pois', path: POIS_PATH, sha256: sha256(poisBytes) },
      { role: 'entity_source', path: ENTITY_SOURCE_PATH, sha256: sha256(entityBytes) }],
    private_output: { path: privatePath, sha256: sha256(privateText), bytes: Buffer.byteLength(privateText) } });
  // Validate the entire public receipt before writing any output.
  assertNoSourceValues(JSON.stringify(receipt), inputs.sourceValues, 'The public S03 positions receipt');
  await writeJson(join(getStoreRoot(), privatePath), privateDocument);
  const receiptPath = `docs/gis/s03/${identity.run_id}.json`;
  await writeJson(join(repoRoot, receiptPath), receipt);
  return { ...receipt, receipt_path: receiptPath };
}
