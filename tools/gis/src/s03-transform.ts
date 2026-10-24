import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { getStoredSource, getStoreRoot, repoRoot, writeJson } from './common.js';
import { assertNoSourceValues } from './context-overlay.js';
import { stationEnuProjector, stationOriginSha256 } from './station-enu.js';
import { toolFingerprint } from './provenance.js';
import { readZip } from './zip.js';

// v2 excludes polygon features with an unclosed ring from Check A instead of rejecting the whole ZIP.
export const S03_TRANSFORM_POLICY = 's03-transform-check-v2';
export const UNCLOSED_RING_DEFECT = 'SOURCE_DEFECT_UNCLOSED_RING';
export const S03_DATUM = {
  declared: null,
  spec_statement: 'absent crs means WGS84 (S03 spec p8)',
  status: 'UNKNOWN',
  assumed_for_projection: 'WGS84 lon/lat used as JGD2011 geographic; no realization/epoch correction',
  asserted: false,
} as const;
const DATUM_NOTE = 'The combined residual includes datum/epoch, cartography and node-placement error; this check is not a survey certificate.';
const S03_CREDIT = '出典：東京都都市整備局「新宿駅周辺の施設情報等」';
const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
export type Point2 = readonly [number, number];
export type Affine = readonly [number, number, number, number, number, number];
export type Polygon2 = readonly (readonly Point2[])[];
export type Project = (lat: number, lon: number) => Point2;
/** A source feature excluded from Check A because one of its rings does not repeat its first position. */
export interface S03SourceDefect {
  kind: typeof UNCLOSED_RING_DEFECT;
  levelId: number;
  featureIndex: number;
  polygonIndex: number;
  ringIndex: number;
  first: Point2;
  last: Point2;
}
type JsonObject = Record<string, unknown>;
const record = (v: unknown): v is JsonObject => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const id = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const lonLat = (p: Point2): boolean => p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/** Coefficient order [a,b,c,d,e,f]: (a*x+c*y+e, b*x+d*y+f). No fitting or correction. */
export function applyAffine(point: Point2, t: Affine): [number, number] {
  return [t[0] * point[0] + t[2] * point[1] + t[4], t[1] * point[0] + t[3] * point[1] + t[5]];
}
export function transformS03(point: Point2, nav: Affine, drawing: Affine, swapped = false): [number, number] {
  return swapped ? applyAffine(applyAffine(point, drawing), nav) : applyAffine(applyAffine(point, nav), drawing);
}

export function distanceToSegment(point: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2));
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}
export function distanceToPolygonEdge(point: Point2, polygon: Polygon2): number {
  let nearest = Infinity;
  for (const ring of polygon) for (let i = 0; i + 1 < ring.length; i++) nearest = Math.min(nearest, distanceToSegment(point, ring[i]!, ring[i + 1]!));
  return nearest;
}
function inRing(point: Point2, ring: readonly Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
/** Closed polygon surface: outer and hole boundaries count as inside; hole interiors do not. */
export function pointInPolygon(point: Point2, polygon: Polygon2): boolean {
  if (!polygon.length) return false;
  if (distanceToPolygonEdge(point, polygon) <= 1e-9) return true;
  return inRing(point, polygon[0]!) && !polygon.slice(1).some(ring => inRing(point, ring));
}
/** Linear interpolation at (n-1)*p, matching the research note. Empty samples remain null. */
export function residualStats(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number): number | null => {
    if (!sorted.length) return null;
    const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
  };
  return { count: values.length, min_m: sorted[0] ?? null, median_m: percentile(0.5), p90_m: percentile(0.9), max_m: sorted.at(-1) ?? null };
}

interface S03Node { index: number; sourceId: number; levelId: number; native: Point2 }
interface S03Level {
  id: number; ordinal: number; polygons: Polygon2[]; nonPolygonFeatures: number; memberSha256: string;
  featuresTotal: number; featuresUsed: number; featuresExcludedUnclosedRing: number;
}
export interface S03Inputs {
  navTransform: Affine; drawingTransform: Affine; drawingId: number;
  nodes: S03Node[]; levels: S03Level[]; sourceValues: Set<string>; sourceDefects: S03SourceDefect[];
  navSha256: string; mapSha256: string;
}
// Comparison labels from the note, never physical elevations; source zlevel is deliberately unused.
const FLOOR_ORDINALS: Readonly<Record<string, number>> = { B5F: -5, B4F: -4, B3F: -3, MB2F: -2.5, B2F: -2, B1F: -1, M1F: -0.5, '1F': 1, '2F': 2, '3F': 3, '4F': 4 };

/** Guard all string leaves, including nested/localized properties and nav tuple properties, without a length exemption. */
export function collectS03Strings(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === 'string') into.add(value);
  else if (Array.isArray(value)) for (const entry of value) collectS03Strings(entry, into);
  else if (record(value)) for (const entry of Object.values(value)) collectS03Strings(entry, into);
  return into;
}

/** Check the buffer that will actually be parsed, in addition to getStoredSource's on-disk check. */
export function assertS03Bytes(bytes: Buffer, expected: { sha256: string; bytes: number }): void {
  if (sha256(bytes) !== expected.sha256 || bytes.length !== expected.bytes) throw new Error('tokyo-s03-zip: SHA-256/byte-count mismatch against acquisition record');
}

/**
 * Basename lookup is deliberate: the source ZIP uses a legacy Japanese parent directory. Ambiguity fails closed.
 * The one tolerated malformation is an unclosed polygon ring: that feature is excluded from Check A and recorded as
 * a source defect. The ring is never closed, repaired or edited, and every other malformation still throws.
 */
export function parseS03Members(entries: readonly { name: string; data: Buffer }[]): S03Inputs {
  const members = new Map<string, { name: string; data: Buffer }>();
  const parsed = new Map<string, unknown>(), sourceValues = new Set<string>();
  const fail = (member: string, reason: string): never => { throw new Error(`Malformed S03 ZIP member ${member}: ${reason}`); };
  for (const entry of entries) {
    const base = posix.basename(entry.name);
    if (members.has(base)) fail(base, 'duplicate basename');
    members.set(base, entry);
    // Read every JSON member, including entities/path files, so the receipt guard covers all S03 strings.
    if (/\.(?:geo)?json$/i.test(base)) {
      let value: unknown;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(entry.data)); }
      catch { fail(base, 'invalid UTF-8 or JSON'); }
      parsed.set(base, value);
      collectS03Strings(value, sourceValues);
    }
  }
  const required = (base: string): JsonObject => {
    if (!members.has(base)) throw new Error(`Missing S03 ZIP member ${base}`);
    const value = parsed.get(base);
    if (!record(value)) fail(base, 'expected JSON object');
    return value as JsonObject;
  };
  const noCrsOverride = (value: unknown, member: string): void => {
    if (Array.isArray(value)) for (const entry of value) noCrsOverride(entry, member);
    else if (record(value)) {
      if (Object.hasOwn(value, 'crs')) fail(member, 'explicit crs needs a separate interpretation; absent-CRS assumption cannot be used');
      for (const entry of Object.values(value)) if (entry !== value.coordinates) noCrsOverride(entry, member);
    }
  };
  const affine = (v: unknown, member: string): Affine => {
    if (!Array.isArray(v) || v.length !== 6 || !v.every(finite)) fail(member, 'expected six finite affine coefficients');
    return v as unknown as Affine;
  };
  const navName = 'v5_nav.json', mapName = 'com-map.geojson';
  const nav = required(navName), map = required(mapName);
  noCrsOverride(nav, navName); noCrsOverride(map, mapName);
  if (!Array.isArray(nav.d) || nav.d.length !== 1 || !record(nav.d[0])) fail(navName, 'expected exactly one drawing');
  if (!Array.isArray(map.drawings) || map.drawings.length !== 1 || !record(map.drawings[0])) fail(mapName, 'expected exactly one drawing');
  const nd = (nav.d as JsonObject[])[0]!, md = (map.drawings as JsonObject[])[0]!;
  if (!id(md.id) || nd.id !== md.id) fail(mapName, 'drawing id must match v5_nav.json');
  const drawingId = md.id as number;
  const navTransform = affine(nd.t, navName);
  if (!record(md.ref_frame)) fail(mapName, 'missing ref_frame');
  const drawingTransform = affine((md.ref_frame as JsonObject).transform, mapName);
  if (!Array.isArray(md.levels) || !md.levels.length) fail(mapName, 'missing levels');
  const levelIds = new Set<number>();
  const position = (v: unknown, member: string): Point2 => {
    if (!Array.isArray(v) || (v.length !== 2 && v.length !== 3) || !v.every(finite) || !lonLat(v as unknown as Point2)) fail(member, 'invalid geographic coordinate');
    const p = v as number[];
    return [p[0]!, p[1]!];
  };
  const ring = (v: unknown, member: string): Point2[] => {
    if (!Array.isArray(v) || v.length < 4) fail(member, 'polygon ring must have at least four positions');
    return (v as unknown[]).map(p => position(p, member));
  };
  const closed = (points: Point2[]): boolean => points[0]![0] === points.at(-1)![0] && points[0]![1] === points.at(-1)![1];
  const polygon = (v: unknown, member: string): Point2[][] => {
    if (!Array.isArray(v) || !v.length) fail(member, 'polygon has no rings');
    return (v as unknown[]).map(r => ring(r, member));
  };
  const sourceDefects: S03SourceDefect[] = [];
  const levels: S03Level[] = (md.levels as unknown[]).map(raw => {
    if (!record(raw) || !id(raw.id) || !record(raw.properties) || typeof raw.properties.name !== 'string') fail(mapName, 'invalid level id/properties');
    const level = raw as { id: number; properties: { name: string } }, label = level.properties.name;
    if (levelIds.has(level.id)) fail(mapName, 'duplicate level id');
    levelIds.add(level.id);
    if (!Object.hasOwn(FLOOR_ORDINALS, label)) fail(mapName, 'level has no comparison ordinal in the research rule');
    const member = `geojson-level-geom-${label}.geojson`, doc = required(member);
    noCrsOverride(doc, member);
    if (doc.type !== 'FeatureCollection' || doc.id !== level.id || doc.drawing_id !== drawingId || !Array.isArray(doc.features)) fail(member, 'invalid collection, level id or drawing id');
    const polygons: Polygon2[] = [];
    let nonPolygonFeatures = 0, featuresUsed = 0, featuresExcludedUnclosedRing = 0;
    const features = doc.features as unknown[];
    features.forEach((rawFeature, featureIndex) => {
      if (!record(rawFeature) || rawFeature.type !== 'Feature' || !record(rawFeature.geometry)) fail(member, 'invalid feature/geometry');
      const geometry = (rawFeature as JsonObject).geometry as JsonObject;
      const parts: unknown[] = [];
      if (geometry.type === 'Polygon') parts.push(geometry.coordinates);
      else if (geometry.type === 'MultiPolygon') {
        if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.length) fail(member, 'invalid multipolygon');
        parts.push(...(geometry.coordinates as unknown[]));
      } else if (geometry.type === 'Point') { position(geometry.coordinates, member); nonPolygonFeatures++; return; }
      else if (geometry.type === 'LineString') {
        if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) fail(member, 'invalid line');
        for (const p of geometry.coordinates as unknown[]) position(p, member);
        nonPolygonFeatures++; return;
      } else fail(member, 'unsupported geometry type');
      // Parse every ring of every part first, so an unrelated malformation still fails closed on an excluded feature.
      const parsed = parts.map((part, polygonIndex) => ({ polygonIndex, rings: polygon(part, member) }));
      const unclosed = parsed.flatMap(({ polygonIndex, rings }) => rings.map((positions, ringIndex) => ({ positions, polygonIndex, ringIndex })))
        .find(({ positions }) => !closed(positions));
      if (unclosed) {
        // Whole-feature exclusion, first offending ring only; reported by numeric level id and zero-based indexes.
        featuresExcludedUnclosedRing++;
        sourceDefects.push({ kind: UNCLOSED_RING_DEFECT, levelId: level.id, featureIndex, polygonIndex: unclosed.polygonIndex, ringIndex: unclosed.ringIndex,
          first: unclosed.positions[0]!, last: unclosed.positions.at(-1)! });
        return;
      }
      featuresUsed++;
      for (const part of parsed) polygons.push(part.rings);
    });
    // A level whose polygon features were all excluded stays in the output with null inside metrics; a level with no polygon feature at all still fails.
    if (!polygons.length && !featuresExcludedUnclosedRing) fail(member, 'no polygons to test');
    return { id: level.id, ordinal: FLOOR_ORDINALS[label]!, polygons, nonPolygonFeatures, memberSha256: sha256(members.get(member)!.data),
      featuresTotal: features.length, featuresUsed, featuresExcludedUnclosedRing };
  });
  if (!Array.isArray(nd.l) || nd.l.length !== levels.length || new Set(nd.l.map(l => record(l) ? l.id : null)).size !== levels.length || nd.l.some(l => !record(l) || !levelIds.has(l.id as number))) fail(navName, 'drawing levels do not match com-map.geojson');
  if (!Array.isArray(nav.n) || !nav.n.length) fail(navName, 'missing nodes');
  const nodeIds = new Set<number>();
  const nodes: S03Node[] = (nav.n as unknown[]).map((n, index) => {
    if (!record(n) || !id(n.id) || !finite(n.mx) || !finite(n.my) || !Array.isArray(n.l) || n.l.length !== 1 || !record(n.l[0]) || !levelIds.has(n.l[0].lid as number)) fail(navName, `invalid node or ambiguous level at index ${index}`);
    const node = n as { id: number; mx: number; my: number; l: Array<{ lid: number }> };
    if (nodeIds.has(node.id)) fail(navName, `duplicate node id at index ${index}`);
    nodeIds.add(node.id);
    return { index, sourceId: node.id, levelId: node.l[0]!.lid, native: [node.mx, node.my] };
  });
  return { navTransform, drawingTransform, drawingId, nodes, levels, sourceValues, sourceDefects, navSha256: sha256(members.get(navName)!.data), mapSha256: sha256(members.get(mapName)!.data) };
}

/** ENU endpoint gap from the first and last positions, using the same station projector Check A uses. Nothing is closed or moved. */
export function sourceDefectRecords(inputs: S03Inputs, project: Project) {
  return inputs.sourceDefects.map(defect => {
    const first = project(defect.first[1], defect.first[0]), last = project(defect.last[1], defect.last[0]);
    return { kind: defect.kind, level_id: defect.levelId, feature_index: defect.featureIndex, polygon_index: defect.polygonIndex,
      ring_index: defect.ringIndex, endpoint_gap_m: Math.hypot(last[0] - first[0], last[1] - first[1]) };
  });
}
/** Policy fixed before looking at results: >=95% inside, both overall and on every assessed level with nodes. */
export const OVERWHELMING_INSIDE_SHARE = 0.95;
export function checkInternal(inputs: S03Inputs, project: Project, swapped = false) {
  const perLevel = inputs.levels.map(level => {
    const nodes = inputs.nodes.filter(n => n.levelId === level.id);
    const coverage = { features_total: level.featuresTotal, features_used: level.featuresUsed, features_excluded_unclosed_ring: level.featuresExcludedUnclosedRing,
      non_polygon_features_excluded: level.nonPolygonFeatures };
    const polygons = level.polygons.map(poly => poly.map(ring => ring.map(([lon, lat]) => project(lat, lon))));
    if (!polygons.length) {
      // Every polygon feature on this level was excluded as a source defect. Nothing is invented and the level stays visible.
      return [level.id, { ...coverage, node_count: nodes.length, polygon_count: 0, inside_count: null, inside_share: null,
        outside_count: null, outside_unprojectable_count: null, outside_edge_distance_m: residualStats([]),
        reason: 'No usable polygon: every polygon feature on this level was excluded for SOURCE_DEFECT_UNCLOSED_RING; inside metrics are null.' }] as const;
    }
    // Precomputed bboxes reduce the ground-level polygon checks without changing the closed-surface rule.
    const bounds = polygons.map(poly => {
      const outer = poly[0]!;
      return [Math.min(...outer.map(p => p[0])), Math.min(...outer.map(p => p[1])), Math.max(...outer.map(p => p[0])), Math.max(...outer.map(p => p[1]))];
    });
    let inside = 0, invalid = 0;
    const distances: number[] = [];
    for (const node of nodes) {
      const ll = transformS03(node.native, inputs.navTransform, inputs.drawingTransform, swapped);
      // The reversed transform can leave geographic space. No metric distance is asserted for such a point.
      if (!lonLat(ll)) { invalid++; continue; }
      const xy = project(ll[1], ll[0]);
      const contained = polygons.some((poly, i) => {
        const b = bounds[i]!;
        return xy[0] >= b[0]! - 1e-9 && xy[0] <= b[2]! + 1e-9 && xy[1] >= b[1]! - 1e-9 && xy[1] <= b[3]! + 1e-9 && pointInPolygon(xy, poly);
      });
      if (contained) inside++;
      else {
        let nearest = Infinity;
        for (const poly of polygons) nearest = Math.min(nearest, distanceToPolygonEdge(xy, poly));
        distances.push(nearest);
      }
    }
    return [level.id, { ...coverage, node_count: nodes.length, polygon_count: polygons.length, inside_count: inside, inside_share: nodes.length ? inside / nodes.length : null,
      outside_count: nodes.length - inside, outside_unprojectable_count: invalid, outside_edge_distance_m: residualStats(distances), reason: null }] as const;
  });
  const assessed = perLevel.flatMap(([, v]) => v.inside_share === null ? [] : [{ ...v, inside_count: v.inside_count ?? 0, outside_unprojectable_count: v.outside_unprojectable_count ?? 0 }]);
  // Only a level with no usable polygon is unassessed; a level with polygons but no nodes has nothing to test and is not listed here.
  const unassessed = perLevel.filter(([, v]) => v.polygon_count === 0).map(([levelId]) => levelId);
  const nodeCount = assessed.reduce((sum, v) => sum + v.node_count, 0), inside = assessed.reduce((sum, v) => sum + v.inside_count, 0);
  const overwhelming = nodeCount > 0 && inside / nodeCount >= OVERWHELMING_INSIDE_SHARE && assessed.every(v => !v.node_count || v.inside_share! >= OVERWHELMING_INSIDE_SHARE);
  const failed = 'Not overwhelmingly inside at the fixed threshold on every assessed level and overall; no transform adjustment applied.';
  return { status: overwhelming ? 'PASS' : 'FAIL', inside_threshold: OVERWHELMING_INSIDE_SHARE, node_count: nodeCount, node_count_total: inputs.nodes.length, inside_count: inside,
    inside_share: nodeCount ? inside / nodeCount : null, outside_unprojectable_count: assessed.reduce((sum, v) => sum + v.outside_unprojectable_count, 0),
    levels_without_usable_polygons: unassessed,
    reason: overwhelming ? 'Overwhelmingly inside at the fixed threshold on every assessed level and overall.'
      : unassessed.length ? `${failed} Levels in levels_without_usable_polygons were not assessed.` : failed,
    levels: Object.fromEntries(perLevel) };
}

export interface E27Point { id: string; xy: Point2; ordinal: number }
export interface S03Point { index: number; xy: Point2; ordinal: number; sourceId: number }
export function compatibleFloors(e27Ordinal: number, s03Ordinal: number): boolean { return e27Ordinal === s03Ordinal || e27Ordinal === 0 && s03Ordinal === 1; }
/** Mutual nearest over all compatible candidates; thresholds are applied only after reciprocity. Ties match the note's IDs. */
export function mutualNearest(e27: readonly E27Point[], s03: readonly S03Point[]) {
  const en = new Map<string, { node: S03Point; distance: number }>(), sn = new Map<number, { node: E27Point; distance: number }>();
  for (const e of e27) for (const s of s03) {
    if (!compatibleFloors(e.ordinal, s.ordinal)) continue;
    const distance = Math.hypot(s.xy[0] - e.xy[0], s.xy[1] - e.xy[1]);
    const previousS = en.get(e.id), previousE = sn.get(s.index);
    if (!previousS || distance < previousS.distance || distance === previousS.distance && s.sourceId < previousS.node.sourceId) en.set(e.id, { node: s, distance });
    if (!previousE || distance < previousE.distance || distance === previousE.distance && e.id < previousE.node.id) sn.set(s.index, { node: e, distance });
  }
  const pairs = e27.flatMap(e => {
    const match = en.get(e.id);
    if (!match || sn.get(match.node.index)?.node.id !== e.id) return [];
    return [{ e27_node_id: e.id, s03_node_index: match.node.index, distance_m: match.distance, d_east_m: match.node.xy[0] - e.xy[0], d_north_m: match.node.xy[1] - e.xy[1] }];
  }).sort((a, b) => a.e27_node_id < b.e27_node_id ? -1 : a.e27_node_id > b.e27_node_id ? 1 : 0);
  const selected = pairs.filter(p => p.distance_m <= 5);
  const meanEast = selected.length ? selected.reduce((sum, p) => sum + p.d_east_m, 0) / selected.length : null;
  const meanNorth = selected.length ? selected.reduce((sum, p) => sum + p.d_north_m, 0) / selected.length : null;
  // Numeric thresholds stay numeric: quoted numeric keys could collide with short source name strings in the leak guard.
  return { compatible_mutual_pairs_before_threshold: pairs.length, thresholds_m: [1, 2, 3, 5].map(t => ({ threshold_m: t, pair_count: selected.filter(p => p.distance_m <= t).length })),
    residuals_within_5m: residualStats(selected.map(p => p.distance_m)),
    mean_delta_within_5m: { d_east_m: meanEast, d_north_m: meanNorth, length_m: meanEast === null || meanNorth === null ? null : Math.hypot(meanEast, meanNorth), applied: false }, pairs: selected };
}

export function guardS03Receipt<T>(receipt: T, sourceValues: ReadonlySet<string>): T {
  assertNoSourceValues(JSON.stringify(receipt), sourceValues, 'The public S03 transform receipt');
  return receipt;
}

/** Offline evidence only: the source's HOLD gate is recorded, never used as permission to publish positions. */
export async function s03TransformCheck() {
  const stored = await getStoredSource('tokyo-s03-zip'), zipBytes = await readFile(stored.path);
  assertS03Bytes(zipBytes, stored.record);
  const inputs = parseS03Members(await readZip(zipBytes, { legacyFileNameEncoding: 'shift_jis' }));
  const graphPath = 'stations/shinjuku/gteki/graph.json', stationPath = 'stations/shinjuku/gteki/station.json';
  const [graphBytes, stationBytes] = await Promise.all([readFile(join(repoRoot, graphPath)), readFile(join(repoRoot, stationPath))]);
  const station = JSON.parse(stationBytes.toString('utf8')) as { station: { origin: { lat: number; lon: number; hM: number | null; crs: string } }; floors: Array<{ id: string; ordinal: number }> };
  const origin = station.station?.origin;
  if (!origin || !finite(origin.lat) || !finite(origin.lon) || !lonLat([origin.lon, origin.lat]) || origin.crs !== 'EPSG:6668') throw new Error(`${stationPath}: invalid station geographic origin`);
  if (!Array.isArray(station.floors) || station.floors.some(f => typeof f.id !== 'string' || !finite(f.ordinal)) || new Set(station.floors.map(f => f.id)).size !== station.floors.length) throw new Error(`${stationPath}: invalid comparison floors`);
  const frame = stationEnuProjector({ lat: origin.lat, lon: origin.lon, hM: 0 });
  const project: Project = (lat, lon) => { const p = frame(lat, lon, 0); return [p[0], p[1]]; };
  const asIs = checkInternal(inputs, project), swapped = checkInternal(inputs, project, true);
  // Public defect records carry only numeric ids and the ENU endpoint gap; source coordinates stay in the private store.
  const sourceDefects = sourceDefectRecords(inputs, project);
  const featuresTotal = inputs.levels.reduce((sum, l) => sum + l.featuresTotal, 0);
  const featuresUsed = inputs.levels.reduce((sum, l) => sum + l.featuresUsed, 0);
  const coverage = { features_total: featuresTotal, features_used: featuresUsed, features_excluded_unclosed_ring: sourceDefects.length,
    non_polygon_features_excluded: inputs.levels.reduce((sum, l) => sum + l.nonPolygonFeatures, 0),
    statement: `Check A uses all polygon features except ${sourceDefects.length} excluded for ${UNCLOSED_RING_DEFECT}.` };
  if (swapped.status !== 'FAIL') throw new Error('Swapped-order negative control unexpectedly passed the fixed containment threshold');
  const graph = JSON.parse(graphBytes.toString('utf8')) as { nodes: Array<{ id: string; floorId: string; position: { x: number; y: number } }> };
  const floorById = new Map(station.floors.map(f => [f.id, f.ordinal]));
  if (!Array.isArray(graph.nodes) || !graph.nodes.length) throw new Error(`${graphPath}: missing nodes`);
  const e27: E27Point[] = graph.nodes.map(n => {
    const ordinal = floorById.get(n.floorId);
    if (typeof n.id !== 'string' || !n.id || !finite(n.position?.x) || !finite(n.position?.y) || ordinal === undefined) throw new Error(`${graphPath}: invalid node or unknown floor`);
    return { id: n.id, xy: [n.position.x, n.position.y], ordinal };
  });
  if (new Set(e27.map(n => n.id)).size !== e27.length) throw new Error(`${graphPath}: duplicate node id`);
  const levels = new Map(inputs.levels.map(l => [l.id, l]));
  const nodes = inputs.nodes.map(n => {
    const ll = transformS03(n.native, inputs.navTransform, inputs.drawingTransform);
    if (!lonLat(ll)) throw new Error(`v5_nav.json: transformed node index ${n.index} is outside geographic range`);
    return { ...n, ll, xy: project(ll[1], ll[0]), ordinal: levels.get(n.levelId)!.ordinal };
  });
  const external = mutualNearest(e27, nodes), fingerprint = await toolFingerprint();
  // E27 node ids are source-derived literals: the per-pair list stays in the private provenance, never in the public receipt.
  const { pairs: externalPairs, ...externalSummary } = external;
  const stationSha = stationOriginSha256(origin), graphSha = sha256(graphBytes);
  const digestInputs = { policy_version: S03_TRANSFORM_POLICY, tool_input_sha256: fingerprint, zip_sha256: stored.record.sha256, station_origin_sha256: stationSha, e27_graph_sha256: graphSha };
  const digest = sha256(JSON.stringify(digestInputs)).slice(0, 20), runId = `transform-check-${digest}`;
  const geojsonRel = `out/s03-${runId}.geojson`, sidecarRel = `out/s03-${runId}.provenance.json`;
  const geojson = `${JSON.stringify({ type: 'FeatureCollection', gteki_role: 'evidence', navigation_use: 'NOT_FOR_ROUTING', verification: 'UNVERIFIED', crs_assumption: S03_DATUM,
    credit: S03_CREDIT, source_sha256: stored.record.sha256,
    features: nodes.map(n => ({ type: 'Feature', geometry: { type: 'Point', coordinates: n.ll }, properties: { s03_node_index: n.index, level_id: n.levelId, east_m: n.xy[0], north_m: n.xy[1], physical_height_m: null } })) })}\n`;
  const expected = { thresholds_m: [1, 2, 3, 5].map((t, i) => ({ threshold_m: t, pair_count: [4, 8, 12, 15][i]! })), median_m_rounded_2dp: 1.85 };
  const reproduced = JSON.stringify(external.thresholds_m) === JSON.stringify(expected.thresholds_m) && external.residuals_within_5m.median_m !== null && Number(external.residuals_within_5m.median_m.toFixed(2)) === expected.median_m_rounded_2dp;
  const receipt = guardS03Receipt({ ...digestInputs, run_id: runId, source_id: 'tokyo-s03-zip', source_bytes: zipBytes.length, publish_gate: stored.source.publish_gate,
    gteki_role: 'evidence', navigation_use: 'NOT_FOR_ROUTING', verification: 'UNVERIFIED', crs: S03_DATUM, datum_note: DATUM_NOTE,
    frame: { station_json_path: stationPath, e27_graph_path: graphPath, station_json_sha256: sha256(stationBytes), ellipsoid: 'GRS80', horizontal_calculation_height_m: 0, physical_height_m: null, floor_elevations_asserted: false },
    transform: { drawing_id: inputs.drawingId, level_ids: inputs.levels.map(l => l.id), nav_member_sha256: inputs.navSha256, map_member_sha256: inputs.mapSha256,
      nav_coefficients_sha256: sha256(JSON.stringify(inputs.navTransform)), drawing_coefficients_sha256: sha256(JSON.stringify(inputs.drawingTransform)), coefficient_hash_encoding: 'UTF-8 JSON array in source order',
      order: 'nav affine, then drawing affine, then horizontal ENU; no fitted correction', level_member_sha256: Object.fromEntries(inputs.levels.map(l => [l.id, l.memberSha256])) },
    source_defects: { count: sourceDefects.length, kinds: sourceDefects.length ? [UNCLOSED_RING_DEFECT] : [],
      rule: 'A polygon feature is excluded from Check A when any of its rings has a first position different from its last. Rings are never closed, repaired, dropped or otherwise modified; the whole feature is excluded.',
      endpoint_gap_rule: 'Horizontal ENU distance between the first and last ring positions, using the same station projector as Check A.',
      items: sourceDefects },
    internal: { as_is: asIs, swapped_order: swapped, coverage, negative_control_detected: true, invalid_coordinate_rule: 'Invalid geographic outputs count as outside and unprojectable; no edge distance is asserted for them.',
      containment_rule: 'Union of own-level polygon surfaces in horizontal ENU, including boundaries and excluding hole interiors; Point and LineString features excluded.',
      unclosed_ring_rule: 'Features with an unclosed ring are excluded from containment entirely (no implicit closure). A level left without usable polygons keeps null inside metrics and is not assessed.' },
    external: { e27_node_count: e27.length, s03_node_count: nodes.length, floor_rule: 'Label-derived comparison ordinals equal, or E27 ordinal 0 with S03 ordinal 1; no source zlevel or measured elevation is used.',
      selection_rule: 'Reciprocal nearest across all compatible-floor nodes, then threshold <= 1, 2, 3, 5 m. Equal distances break by numeric S03 source id and lexicographic E27 id.', delta_direction: 'S03 minus E27', node_index_basis: 'zero-based position in v5_nav.json n array',
      pair_list_rule: 'The per-pair list, which names E27 node ids, stays in the private provenance; this receipt reports counts, residuals and the unapplied mean offset only.', ...externalSummary,
      research_comparison: { reference: 'docs/stations/shinjuku/research/2026-10-21-tokyo-terminal-join.md', expected, reproduced,
        explanation: reproduced ? 'Counts and median rounded to two decimals reproduce the note; no correction applied.' : 'Current input hashes and node populations are recorded; the note is not reproduced. No parameters or coordinates were adjusted.' } },
    outputs: { geojson: { store_path: geojsonRel, sha256: sha256(geojson), bytes: Buffer.byteLength(geojson) }, provenance: { store_path: sidecarRel } },
  }, inputs.sourceValues);
  // Validate the entire public receipt before writing any output. Geometry and source IDs stay in the private store.
  await writeJson(join(getStoreRoot(), sidecarRel), { ...receipt, credit: S03_CREDIT, source_record: stored.record, source_manifest: stored.source,
    node_table: nodes.map(n => ({ index: n.index, source_id: n.sourceId, level_id: n.levelId })), check_b_pairs: externalPairs,
    // Private provenance keeps the untouched source endpoints; the public receipt keeps only their ENU gap.
    source_defect_endpoints: inputs.sourceDefects.map(d => ({ ...d, first: [...d.first], last: [...d.last] })) });
  await writeFile(join(getStoreRoot(), geojsonRel), geojson);
  const receiptPath = `docs/gis/s03/${runId}.json`;
  await writeJson(join(repoRoot, receiptPath), receipt);
  return { receipt_path: receiptPath, ...receipt };
}
