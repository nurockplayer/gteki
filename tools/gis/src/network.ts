import { parse } from 'csv-parse/sync';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { docsRoot, getStoreRoot, getStoredSource, writeJson } from './common.js';
import { toolFingerprint } from './provenance.js';
import { crsName } from './crs-declaration.js';
import { geometriesBbox, hasOverridingCrs } from './geo-bbox.js';
import { readZip } from './zip.js';
import { attributeDecoding,codebookInputs } from './attributes.js';
import { compareNetworkRepresentations, r1GeoEvidence } from './r1.js';

type RawRow = Record<string, string>;
type XY = [number, number];
type StatusValue<T> = { value: T | null; status: 'KNOWN' | 'UNKNOWN' };
type GeoJsonAcquisition = { features: any[]; source_id: string; sha256: string; member: string };
const FEATURE_ORIGIN = Symbol('originating acquisition');

const KNOWN_IDS = {
  nodeId: ['node_id', 'nodeid', 'nodeID', 'ノードID'],
  linkId: ['link_id', 'linkid', 'linkID', 'リンクID'],
  startId: ['start_node_id', 'start_id', 'from_node_id', '起点ノードID'],
  endId: ['end_node_id', 'end_id', 'to_node_id', '終点ノードID'],
  x: ['x', 'longitude', 'lon', '経度'],
  y: ['y', 'latitude', 'lat', '緯度'],
  elevation: ['elevation', 'height', '標高'],
  floor: ['floor', '階層'],
  startX: ['start_x', 'start_lon', 'start_longitude'],
  startY: ['start_y', 'start_lat', 'start_latitude'],
  endX: ['end_x', 'end_lon', 'end_longitude'],
  endY: ['end_y', 'end_lat', 'end_latitude'],
} as const;

const NORMALIZED_ALIASES: Record<string, readonly string[]> = {
  route_type: ['route_type', 'route_kind'], route_structure: ['rt_struct', '経路の構造'], direction: ['direction', 'direction_code', '方向'],
  in_out: ['in_out'], gate: ['gate', 'ticket_gate', '改札'], ticket: ['ticket', '切符'], elevator: ['elevator', 'elevator_code', 'エレベーター'],
  stairs: ['stairs', 'stair', 'stair_code', '階段'], escalator: ['escalator', 'escalator_code', 'エスカレーター'],
  ramp: ['ramp', 'ramp_code', 'スロープ'], width_class: ['width_class', 'width', '有効幅員'],
  slope_class: ['slope_class', 'slope', 'vtcl_slope', '縦断勾配'], step_class: ['step_class', 'step', 'lev_diff', '段差'],
};

const EXPLICIT_NODE_ID_FIELDS = KNOWN_IDS.nodeId;
const EXPLICIT_LINK_ID_FIELDS = KNOWN_IDS.linkId;
const GENERIC_ID_FIELDS = ['id', 'ID', '施設ID'] as const;
const NODE_ID_FIELDS = [...KNOWN_IDS.nodeId, ...GENERIC_ID_FIELDS] as const;
const LINK_ID_FIELDS = [...KNOWN_IDS.linkId, ...GENERIC_ID_FIELDS] as const;

function headerKey(row: RawRow, aliases: readonly string[]): string | null {
  return Object.keys(row).find((name) => aliases.includes(name)) ?? null;
}

function nullable(row: RawRow, key: string | null): string | null {
  if (!key) return null;
  const value = row[key];
  return value == null || value.trim() === '' ? null : value;
}

function nativeIdentifier(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return String(value);
  return null;
}

function csvIdentifier(row: RawRow, key: string | null): string | null {
  return key === null ? null : resolveIdentifier(row, [key]);
}

function resolveIdentifier(record: Record<string, any>, fields: readonly string[]): string | null {
  return nativeIdentifier(firstDefined(record, fields));
}

function namedRawFields(row: RawRow): Record<string, StatusValue<string>> {
  return Object.fromEntries(Object.entries(NORMALIZED_ALIASES).map(([name, aliases]) => [name, statusValue(nullable(row, headerKey(row, aliases)))]));
}

function statusValue<T>(value: T | null): StatusValue<T> {
  return { value, status: value === null ? 'UNKNOWN' : 'KNOWN' };
}

function decodeCsv(buffer: Buffer): { text: string; encoding: 'UTF-8' | 'Shift_JIS' } {
  const data = buffer.subarray(buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 3 : 0);
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(data), encoding: 'UTF-8' };
  } catch {
    try {
      return { text: new TextDecoder('shift_jis', { fatal: true }).decode(data), encoding: 'Shift_JIS' };
    } catch (error) {
      throw new Error(`CSV is neither valid UTF-8 nor Shift_JIS: ${String(error)}`);
    }
  }
}

export function parseCsv(buffer: Buffer): { rows: RawRow[]; encoding: 'UTF-8' | 'Shift_JIS' } {
  const decoded = decodeCsv(buffer);
  const rows = parse(decoded.text, { columns: true, bom: true, comment: '#', skip_empty_lines: true, relax_column_count: false, trim: false }) as RawRow[];
  return { rows, encoding: decoded.encoding };
}

function valueCounts(rows: RawRow[], field: string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = row[field];
    const value = raw == null || String(raw).trim() === '' ? '(blank)' : String(raw);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

function isCategoricalField(field: string): boolean {
  const mappedCategoricalFields = Object.values(NORMALIZED_ALIASES).flat();
  return mappedCategoricalFields.includes(field) || /route|direction|floor|階|in.?out|gate|ticket|elevator|lift|stairs|escalator|ramp|width|slope|step|経路|方向|改札|切符|幅員|勾配|段差|階段|昇降/i.test(field);
}

function fieldStats(rows: RawRow[]): Record<string, { blank_count: number; distinct_count: number; distinct_values?: Record<string, number> }> {
  const fields = [...new Set(rows.flatMap((r) => Object.keys(r)))].sort();
  return Object.fromEntries(fields.map((field) => [field, {
    blank_count: rows.filter((r) => r[field] == null || String(r[field]).trim() === '').length,
    distinct_count: new Set(rows.map((r) => r[field] == null || String(r[field]).trim() === '' ? null : String(r[field])).filter((v): v is string => v !== null)).size,
    ...(isCategoricalField(field) ? { distinct_values: valueCounts(rows, field) } : {}),
  }]));
}

function duplicateValues(values: Array<string | null>): string[] {
  const counts = new Map<string, number>();
  for (const value of values) if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([value]) => value).sort();
}

function weakComponents(nodeIds: Set<string>, links: Array<{ start: string | null; end: string | null }>): string[][] {
  const adjacency = new Map<string, Set<string>>([...nodeIds].map((id) => [id, new Set<string>()]));
  for (const { start, end } of links) {
    if (start && end && adjacency.has(start) && adjacency.has(end)) {
      adjacency.get(start)!.add(end);
      adjacency.get(end)!.add(start);
    }
  }
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const id of [...nodeIds].sort()) {
    if (seen.has(id)) continue;
    const stack = [id];
    const component: string[] = [];
    seen.add(id);
    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);
      for (const next of adjacency.get(current) ?? []) if (!seen.has(next)) { seen.add(next); stack.push(next); }
    }
    components.push(component.sort());
  }
  return components;
}

function componentSummary(components: string[][]): Array<{ node_count: number }> {
  return components.map((component) => ({ node_count: component.length }));
}

function coordinateOf(row: RawRow, xKey: string | null, yKey: string | null): XY | null {
  const xValue = nullable(row, xKey); const yValue = nullable(row, yKey);
  if (xValue === null || yValue === null) return null;
  const x = Number(xValue);
  const y = Number(yValue);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function distanceMetres(a: XY, b: XY, geographic: boolean): number {
  if (!geographic) return Math.hypot(a[0] - b[0], a[1] - b[1]);
  const lat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const dx = (a[0] - b[0]) * 111320 * Math.cos(lat);
  const dy = (a[1] - b[1]) * 110574;
  return Math.hypot(dx, dy);
}

export function inspectCsvPair(nodeRows: RawRow[], linkRows: RawRow[], source: { source_id: string; sha256: string; node_source_id?: string; link_source_id?: string; node_sha256?: string; link_sha256?: string; node_source_native_id?: string; link_source_native_id?: string }) {
  const nodeSample = nodeRows[0] ?? {};
  const linkSample = linkRows[0] ?? {};
  const nodeIdKey = headerKey(nodeSample, KNOWN_IDS.nodeId);
  const linkIdKey = headerKey(linkSample, KNOWN_IDS.linkId);
  const startKey = headerKey(linkSample, KNOWN_IDS.startId);
  const endKey = headerKey(linkSample, KNOWN_IDS.endId);
  const nodeX = headerKey(nodeSample, KNOWN_IDS.x);
  const nodeY = headerKey(nodeSample, KNOWN_IDS.y);
  const linkGeometryKey = headerKey(linkSample, ['geometry', 'geom', 'wkt', 'the_geom']);
  const nodeIds = nodeRows.map((r) => csvIdentifier(r, nodeIdKey));
  const linkIds = linkRows.map((r) => csvIdentifier(r, linkIdKey));
  const nodeIdsComplete = nodeIdKey !== null && nodeIds.every((id) => id !== null);
  const linkIdsComplete = linkIdKey !== null && linkIds.every((id) => id !== null);
  const knownNodes = new Set(nodeIds.filter((id): id is string => id !== null));
  const links = linkRows.map((row) => ({ start: csvIdentifier(row, startKey), end: csvIdentifier(row, endKey) }));
  const endpointsComplete = startKey !== null && endKey !== null && links.every((link) => link.start !== null && link.end !== null);
  const graphComplete = nodeIdsComplete && endpointsComplete;
  const dangling = links.flatMap((link, index) => {
    const missing = [link.start, link.end].filter((id): id is string => id !== null && !knownNodes.has(id));
    return missing.length ? [{ row: index + 1, start_id: link.start, end_id: link.end, missing_node_ids: missing }] : [];
  });
  const referenced = new Set(links.flatMap((link) => [link.start, link.end]).filter((id): id is string => id !== null));
  const geometryEndpointMismatches: Array<{ row: number; start_distance_m: number; end_distance_m: number }> = [];
  const nodeCoords = nodeRows.map((r) => coordinateOf(r, nodeX, nodeY)).filter((c): c is XY => c !== null);
  const nodeBbox = nodeCoords.length ? [Math.min(...nodeCoords.map((c) => c[0])), Math.min(...nodeCoords.map((c) => c[1])), Math.max(...nodeCoords.map((c) => c[0])), Math.max(...nodeCoords.map((c) => c[1]))] : null;
  const nodeFeatures = nodeRows.map((row, i) => ({
    source_id: source.node_source_id ?? source.source_id, source_sha256: source.node_sha256 ?? source.sha256,
    source_native_id: nodeIds[i], source_native_id_status: nodeIds[i] === null ? 'UNKNOWN' : 'KNOWN', raw_attributes: row,
    normalized: {
      coordinates: statusValue(coordinateOf(row, nodeX, nodeY)), elevation_m: statusValue(nullable(row, headerKey(row, KNOWN_IDS.elevation))),
      floor_label: statusValue(nullable(row, headerKey(row, KNOWN_IDS.floor))),
      floor_label_source: nullable(row, headerKey(row, KNOWN_IDS.floor)),
      attributes: namedRawFields(row),
    }, verification: 'UNVERIFIED' as const, routable: false as const,
  }));
  const linkFeatures = linkRows.map((row, i) => ({
    source_id: source.link_source_id ?? source.source_id, source_sha256: source.link_sha256 ?? source.sha256,
    source_native_id: linkIds[i], source_native_id_status: linkIds[i] === null ? 'UNKNOWN' : 'KNOWN', raw_attributes: row,
    normalized: { start_node_id: statusValue(csvIdentifier(row, startKey)), end_node_id: statusValue(csvIdentifier(row, endKey)), geometry: statusValue(nullable(row, linkGeometryKey)), floor_label: statusValue(nullable(row, headerKey(row, KNOWN_IDS.floor))), floor_label_source: nullable(row, headerKey(row, KNOWN_IDS.floor)), attributes: namedRawFields(row) },
    verification: 'UNVERIFIED' as const, routable: false as const,
  }));
  return {
    source_id: source.source_id, source_sha256: source.sha256,
    files: { node_source_id: source.node_source_id ?? source.source_id, link_source_id: source.link_source_id ?? source.source_id },
    counts: { nodes: nodeRows.length, links: linkRows.length },
    attribute_decoding: attributeDecoding(nodeRows, linkRows),
    crs: { value: null, status: 'UNKNOWN', note: 'No CRS declaration was found in the CSV pair; endpoint offsets cannot be safely expressed in metres.' },
    bbox: nodeBbox,
    headers: { node: Object.keys(nodeSample), link: Object.keys(linkSample) },
    mapped_fields: { node_id: nodeIdKey, link_id: linkIdKey, start_node_id: startKey, end_node_id: endKey, x: nodeX, y: nodeY, elevation: headerKey(nodeSample, KNOWN_IDS.elevation), floor: headerKey(nodeSample, KNOWN_IDS.floor) },
    unmapped_columns: { node: Object.keys(nodeSample).filter((k) => ![...Object.values(KNOWN_IDS), ...Object.values(NORMALIZED_ALIASES)].some((aliases) => (aliases as readonly string[]).includes(k))), link: Object.keys(linkSample).filter((k) => ![...Object.values(KNOWN_IDS), ...Object.values(NORMALIZED_ALIASES)].some((aliases) => (aliases as readonly string[]).includes(k))) },
    normalized_field_headers: Object.fromEntries(Object.entries(NORMALIZED_ALIASES).map(([name, aliases]) => [name, { node: headerKey(nodeSample, aliases), link: headerKey(linkSample, aliases) }])),
    field_statistics: { node: fieldStats(nodeRows), link: fieldStats(linkRows) },
    topology: {
      duplicate_node_ids: nodeIdsComplete ? duplicateValues(nodeIds) : null, duplicate_link_ids: linkIdsComplete ? duplicateValues(linkIds) : null, dangling_links: graphComplete ? dangling : null,
      self_loops: endpointsComplete ? links.flatMap((l, i) => l.start && l.start === l.end ? [{ row: i + 1, node_id: l.start }] : []) : null,
      unreferenced_node_ids: graphComplete ? [...new Set(nodeIds.filter((id): id is string => id !== null && !referenced.has(id)))] : null,
      weak_component_count: graphComplete ? weakComponents(knownNodes, links).length : null,
      weak_components: graphComplete ? componentSummary(weakComponents(knownNodes, links)) : null,
      completeness: { node_ids_complete: nodeIdsComplete, link_ids_complete: linkIdsComplete, endpoint_ids_complete: endpointsComplete, graph_complete: graphComplete, unknown_node_identifier_count: nodeIds.filter((id) => id === null).length, unknown_link_identifier_count: linkIds.filter((id) => id === null).length, unknown_endpoint_count: links.reduce((n, link) => n + Number(link.start === null) + Number(link.end === null), 0) },
      geometry_endpoint_mismatches_over_0_5m: null,
      geometry_endpoint_check_status: 'UNKNOWN_CRS_FOR_CSV',
      geometry_endpoint_coverage: { checked_links: 0, skipped_links: linkRows.length, total_links: linkRows.length, complete: false },
    },
    candidate_graph: {
      verification: 'UNVERIFIED', routable: false,
      nodes: nodeFeatures,
      edges: linkFeatures,
    },
    limitations: ['No edges were added; all links are copied from source rows.', 'No floor height or operator-floor equivalence was inferred.', 'Candidate output is not verified or routable.'],
  };
}

function geometryCoords(geometry: any): number[][] {
  if (!geometry) return [];
  const out: number[][] = [];
  // GeoJSON positions nest at most four levels deep; anything deeper is ignored instead of recursing without bound.
  const visit = (v: any, depth: number): void => { if (Array.isArray(v) && v.length >= 2 && v.slice(0, 2).every((x) => typeof x === 'number')) out.push(v); else if (Array.isArray(v) && depth < 4) v.forEach((child) => visit(child, depth + 1)); };
  visit(geometry.coordinates, 0);
  return out;
}

// Ordered vertices of a link, or null when its endpoints are ambiguous: a MultiLineString counts only when it
// has one part or every part starts exactly where the previous one ended.
function linkVertices(geometry: any): number[][] | null {
  if (/^LineString$/i.test(String(geometry?.type ?? ''))) return geometryCoords(geometry);
  if (!/^MultiLineString$/i.test(String(geometry?.type ?? '')) || !Array.isArray(geometry.coordinates)) return null;
  const parts = geometry.coordinates.map((part: any) => geometryCoords({ coordinates: part }));
  if (parts.length === 0 || parts.some((part: number[][]) => part.length < 2)) return null;
  for (let k = 1; k < parts.length; k += 1) {
    const prev = parts[k - 1]![parts[k - 1]!.length - 1]!;
    const next = parts[k]![0]!;
    if (prev[0] !== next[0] || prev[1] !== next[1]) return null;
  }
  return parts.flat();
}

/** Strict bbox: malformed, unsupported, over-budget or CRS-overriding geometry withholds it (status INCOMPLETE_*). */
function bboxResult(features: any[]) {
  return geometriesBbox(features.map((f) => f?.geometry), { overridingCrs: hasOverridingCrs(features) });
}

/**
 * The CRS declaration of a parsed GeoJSON document. An absent `crs` stays null (the RFC 7946 assumption path); an explicit
 * `"crs": null` is a declaration that no CRS applies, so it is UNKNOWN and never assumed to be CRS84.
 */
export function geoJsonDeclaredCrs(parsed: unknown): unknown {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.hasOwn(parsed, 'crs')) return null;
  const declared = (parsed as Record<string, unknown>).crs;
  return declared === null
    ? { value: null, status: 'UNKNOWN', note: 'Explicit "crs": null declares no CRS; coordinates are not assumed to be CRS84 and no datum is inferred.' }
    : declared;
}

function firstDefined(properties: Record<string, any>, names: readonly string[]): any {
  const key = Object.keys(properties).find((k) => names.includes(k));
  if (!key) return null;
  const value = properties[key];
  return typeof value === 'string' && value.trim() === '' ? null : value;
}

function geoJsonNormalizedAttributes(properties: Record<string, any>): Record<string, StatusValue<any>> {
  return Object.fromEntries(Object.entries(NORMALIZED_ALIASES).map(([name, aliases]) => [name, statusValue(firstDefined(properties, aliases))]));
}

function geoJsonMappedFields(fields: string[]): Record<string, string | null> {
  return Object.fromEntries(Object.entries(NORMALIZED_ALIASES).map(([name, aliases]) => [name, fields.find((field) => aliases.includes(field)) ?? null]));
}

function isGeographicLonLat(lon: unknown, lat: unknown): boolean {
  return typeof lon === 'number' && typeof lat === 'number' && Number.isFinite(lon) && Number.isFinite(lat)
    && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
}

export function inspectGeoJsonFeatures(features: any[], source: { source_id: string; sha256: string }, declaredCrs: unknown, fileName: string, mode: 'network' | 'stationmap') {
  const fields = [...new Set(features.flatMap((f) => Object.keys(f.properties ?? {})))].sort();
  const statsRows = features.map((f) => f.properties ?? {});
  const categoryFields = fields.filter(isCategoricalField);
  const classification = (feature: any): 'node' | 'link' | 'unknown' => {
    const geometryType = feature.geometry?.type ?? '';
    const properties = feature.properties ?? {};
    // Area or other unsupported geometry never takes a graph role, whatever role-like properties it carries.
    if (feature.geometry != null && !/^(Multi)?(Point|LineString)$/i.test(geometryType)) return 'unknown';
    const nodeEvidence = /^(Multi)?Point$/i.test(geometryType) || resolveIdentifier(properties, EXPLICIT_NODE_ID_FIELDS) !== null;
    const linkEvidence = /^(Multi)?LineString$/i.test(geometryType)
      || resolveIdentifier(properties, EXPLICIT_LINK_ID_FIELDS) !== null
      || (resolveIdentifier(properties, KNOWN_IDS.startId) !== null && resolveIdentifier(properties, KNOWN_IDS.endId) !== null);
    if (nodeEvidence === linkEvidence) return 'unknown';
    return nodeEvidence ? 'node' : 'link';
  };
  const classifications = features.map(classification);
  const ids = features.map((f, i) => {
    const properties = f.properties ?? {};
    if (classifications[i] === 'node') return resolveIdentifier(properties, NODE_ID_FIELDS);
    if (classifications[i] === 'link') return resolveIdentifier(properties, LINK_ID_FIELDS);
    const hasConflictingRoleIds = resolveIdentifier(properties, EXPLICIT_NODE_ID_FIELDS) !== null
      && resolveIdentifier(properties, EXPLICIT_LINK_ID_FIELDS) !== null;
    return hasConflictingRoleIds ? null : resolveIdentifier(properties, GENERIC_ID_FIELDS);
  });
  const nodeFeatures = features.filter((_, i) => classifications[i] === 'node');
  const linkFeatures = features.filter((_, i) => classifications[i] === 'link');
  const unknownFeatures = features.filter((_, i) => classifications[i] === 'unknown');
  const getNodeId = (f: any) => resolveIdentifier(f.properties ?? {}, NODE_ID_FIELDS);
  const nodeIdsOnly = nodeFeatures.map(getNodeId);
  const linkIdsOnly = linkFeatures.map((f) => resolveIdentifier(f.properties ?? {}, LINK_ID_FIELDS));
  const nodeIdsComplete = nodeFeatures.length > 0 && nodeIdsOnly.every((id) => id !== null);
  const linkIdsComplete = linkFeatures.length > 0 && linkIdsOnly.every((id) => id !== null);
  const nodeIds = new Set(nodeIdsOnly.filter((v): v is string => v !== null));
  const coordinateByNodeId = new Map<string, XY>();
  for (const feature of nodeFeatures) {
    const id = getNodeId(feature);
    const coords = geometryCoords(feature.geometry);
    // Only a single position is a usable node location; a multi-position MultiPoint leaves the endpoint check partial.
    if (id !== null && coords.length === 1 && coords[0]!.length >= 2) coordinateByNodeId.set(String(id), [coords[0]![0]!, coords[0]![1]!]);
  }
  const edgeReferences = linkFeatures.map((f) => ({
    start: nativeIdentifier(firstDefined(f.properties ?? {}, ['start_node_id', 'start_id', 'from_node_id', '起点ノードID'])),
    end: nativeIdentifier(firstDefined(f.properties ?? {}, ['end_node_id', 'end_id', 'to_node_id', '終点ノードID'])),
  }));
  const endpointIdsComplete = edgeReferences.length > 0 && edgeReferences.every((edge) => edge.start !== null && edge.end !== null);
  const graphComplete = nodeIdsComplete && endpointIdsComplete && unknownFeatures.length === 0;
  const duplicates = duplicateValues(ids);
  const referenced = new Set(edgeReferences.flatMap((e) => [e.start, e.end]).filter((v): v is string => v !== null));
  const graphLinks = edgeReferences;
  const graph = weakComponents(nodeIds, graphLinks);
  // Only a plain {type:"name"} declaration identifies a CRS; linked, typed, malformed or unknown structures never
  // contribute text from their other members (for example a link's name next to an href). A feature-level or
  // geometry-level `crs` overrides the collection CRS, so no single endpoint-distance method then applies.
  const bboxInfo = bboxResult(features);
  const namedCrs = declaredCrs == null ? 'CRS84' : typeof declaredCrs === 'string' ? declaredCrs : crsName(declaredCrs);
  const crsText = typeof namedCrs === 'string' && !bboxInfo.geometry_level_crs && !hasOverridingCrs(features) ? namedCrs : null;
  const distanceMethod = crsText === null ? null : /4326|6668|crs84/i.test(crsText) ? 'GEOGRAPHIC_DEGREES_APPROX_METRES'
    : /6677/i.test(crsText) ? 'PROJECTED_METRES' : null;
  const nodeIdsUnique = nodeIdsComplete && duplicateValues(nodeIdsOnly).length === 0;
  const endpointChecks = distanceMethod === null || !graphComplete || !nodeIdsUnique ? null : linkFeatures.map((feature, i) => {
    const points = linkVertices(feature.geometry);
    const aId = edgeReferences[i]!.start;
    const bId = edgeReferences[i]!.end;
    const a = aId ? coordinateByNodeId.get(aId) : undefined;
    const b = bId ? coordinateByNodeId.get(bId) : undefined;
    if (!a || !b || !points || points.length < 2 || points.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
    // Geographic CRSs are longitude,latitude here; an out-of-range position (e.g. swapped axes) cannot be
    // compared in metres, so the link is skipped and coverage becomes partial instead of guessing an axis order.
    if (distanceMethod === 'GEOGRAPHIC_DEGREES_APPROX_METRES' && ![a, b, ...points].every((p) => isGeographicLonLat(p[0], p[1]))) return null;
    const dStart = distanceMetres([points[0]![0]!, points[0]![1]!], a, distanceMethod === 'GEOGRAPHIC_DEGREES_APPROX_METRES');
    const last = points[points.length - 1]!;
    const dEnd = distanceMetres([last[0]!, last[1]!], b, distanceMethod === 'GEOGRAPHIC_DEGREES_APPROX_METRES');
    return { feature_index: i, start_distance_m: dStart, end_distance_m: dEnd };
  });
  const checkedEndpointLinks = endpointChecks?.filter((result) => result !== null) ?? [];
  const totalEndpointLinks = linkFeatures.length;
  const skippedEndpointLinks = totalEndpointLinks - checkedEndpointLinks.length;
  const endpointCoverageComplete = endpointChecks !== null && skippedEndpointLinks === 0;
  const endpointMismatches = endpointCoverageComplete ? checkedEndpointLinks.filter((result) => Math.max(result!.start_distance_m, result!.end_distance_m) > 0.5) : null;
  const endpointCheckStatus = distanceMethod === null ? 'UNKNOWN_UNSUPPORTED_CRS'
    : !graphComplete || !nodeIdsUnique ? 'UNKNOWN_INCOMPLETE_IDENTIFIERS'
    : skippedEndpointLinks > 0 ? 'PARTIAL_ENDPOINT_COVERAGE' : 'CHECKED_IN_METRES';
  const floorLabel = (f: any) => firstDefined(f.properties ?? {}, ['floor', 'floor_name', 'floor_label', '階層', '階']) ?? (/floor/i.test(fileName) ? firstDefined(f.properties ?? {}, ['short_name', 'name']) : null);
  const normal = (f: any, i: number) => ({
    source_id: f[FEATURE_ORIGIN]?.source_id ?? source.source_id, source_sha256: f[FEATURE_ORIGIN]?.sha256 ?? source.sha256,
    source_native_id: ids[i],
    candidate_kind: classifications[i]!,
    source_native_id_status: ids[i] == null ? 'UNKNOWN' : 'KNOWN',
    source_member: f[FEATURE_ORIGIN]?.member ?? f.__source_member ?? fileName,
    raw_attributes: f.properties ?? {}, geometry: f.geometry ?? null,
    normalized: { floor_label: statusValue(floorLabel(f)), floor_label_source: floorLabel(f), elevation_m: statusValue(null), start_node_id: statusValue(nativeIdentifier(firstDefined(f.properties ?? {}, ['start_node_id', 'start_id', 'from_node_id', '起点ノードID']))), end_node_id: statusValue(nativeIdentifier(firstDefined(f.properties ?? {}, ['end_node_id', 'end_id', 'to_node_id', '終点ノードID']))), geometry_status: f.geometry == null ? 'UNKNOWN' : 'KNOWN', attributes: geoJsonNormalizedAttributes(f.properties ?? {}) },
    verification: 'UNVERIFIED', routable: false,
  });
  const report: any = {
    source_id: source.source_id, source_sha256: source.sha256, file: fileName, mode,
    feature_count: features.length, geometry_type_counts: Object.fromEntries([...new Set(features.map((f) => f.geometry?.type ?? 'null'))].sort().map((t) => [t, features.filter((f) => (f.geometry?.type ?? 'null') === t).length])),
    crs: declaredCrs ?? { value: 'RFC 7946 default CRS84 longitude/latitude assumed because no crs member is present', status: 'ASSUMPTION' }, bbox: bboxInfo.bbox, bbox_status: bboxInfo.status,
    headers: fields, mapped_fields: geoJsonMappedFields(fields), blank_counts: Object.fromEntries(fields.map((f) => [f, statsRows.filter((r) => r[f] == null || String(r[f]).trim() === '').length])),
    categorical_values: Object.fromEntries(categoryFields.map((f) => [f, valueCounts(statsRows, f)])),
    floor_labels_present_literally: [...new Set(features.map(floorLabel).filter((v) => v !== null).map(String))].sort(),
    topology: { duplicate_ids: ids.every((id) => id !== null) ? duplicates : null, duplicate_node_ids: nodeIdsComplete ? duplicateValues(nodeIdsOnly) : null, duplicate_link_ids: linkIdsComplete ? duplicateValues(linkIdsOnly) : null, dangling_links: graphComplete ? edgeReferences.flatMap((e, i) => [e.start, e.end].filter((id) => id !== null && !nodeIds.has(id)).map((id) => ({ feature_index: i, missing_node_id: id }))) : null, self_loops: graphComplete ? edgeReferences.flatMap((e, i) => e.start !== null && e.start === e.end ? [{ feature_index: i, node_id: e.start }] : []) : null, unreferenced_node_ids: graphComplete ? [...nodeIds].filter((id) => !referenced.has(id)).sort() : null, weak_component_count: graphComplete ? graph.length : null, weak_components: graphComplete ? componentSummary(graph) : null, completeness: { classification_complete: unknownFeatures.length === 0, unknown_feature_count: unknownFeatures.length, node_ids_complete: nodeIdsComplete, link_ids_complete: linkIdsComplete, endpoint_ids_complete: endpointIdsComplete, graph_complete: graphComplete, unknown_node_identifier_count: nodeIdsOnly.filter((id) => id === null).length, unknown_link_identifier_count: linkIdsOnly.filter((id) => id === null).length, unknown_endpoint_count: edgeReferences.reduce((n, edge) => n + Number(edge.start === null) + Number(edge.end === null), 0) }, geometry_endpoint_mismatches_over_0_5m: endpointMismatches, geometry_endpoint_check_status: endpointCheckStatus, geometry_endpoint_distance_method: distanceMethod, geometry_endpoint_coverage: { checked_links: checkedEndpointLinks.length, skipped_links: skippedEndpointLinks, total_links: totalEndpointLinks, complete: endpointCoverageComplete } },
    attribute_decoding: attributeDecoding(nodeFeatures.map(f=>f.properties??{}),linkFeatures.map(f=>f.properties??{})),
    candidate_features: features.map(normal),
  };
  if (mode === 'stationmap') { delete report.candidate_features; delete report.topology; }
  return report;
}

export function inspectGeoJsonPair(node: GeoJsonAcquisition, link: GeoJsonAcquisition) {
  // Attach trusted acquisition identity before combining or classifying features.
  const originated = ({ features, source_id, sha256, member }: GeoJsonAcquisition) =>
    features.map(feature => ({ ...feature, [FEATURE_ORIGIN]: { source_id, sha256, member } }));
  return inspectGeoJsonFeatures([...originated(node), ...originated(link)], {
    source_id: `${node.source_id}+${link.source_id}`, sha256: `${node.sha256}+${link.sha256}`,
  }, null, 'R1 node+link GeoJSON pair', 'network');
}

export function archiveGeoJsonMemberReport(file: string, inspected: ReturnType<typeof inspectGeoJsonFeatures>) {
  return {
    file,
    feature_count: inspected.feature_count,
    geometry_type_counts: inspected.geometry_type_counts,
    crs: inspected.crs,
    bbox: inspected.bbox,
    bbox_status: inspected.bbox_status,
    headers: inspected.headers,
    mapped_fields: inspected.mapped_fields,
    blank_counts: inspected.blank_counts,
    categorical_values: inspected.categorical_values,
    attribute_decoding: inspected.attribute_decoding,
    floor_labels_present_literally: inspected.floor_labels_present_literally,
  };
}

export function archiveGeoJsonNetworkInventory(inspected: ReturnType<typeof inspectGeoJsonFeatures>) {
  return {
    feature_count: inspected.feature_count,
    geometry_type_counts: inspected.geometry_type_counts,
    crs: inspected.crs,
    bbox: inspected.bbox,
    bbox_status: inspected.bbox_status,
    headers: inspected.headers,
    mapped_fields: inspected.mapped_fields,
    blank_counts: inspected.blank_counts,
    categorical_values: inspected.categorical_values,
    attribute_decoding: inspected.attribute_decoding,
    floor_labels_present_literally: inspected.floor_labels_present_literally,
  };
}

export function candidateGraphFromGeoJsonInventory(inspected: ReturnType<typeof inspectGeoJsonFeatures>) {
  const candidates = inspected.candidate_features ?? [];
  return {
    verification: 'UNVERIFIED' as const,
    routable: false as const,
    nodes: candidates.filter((candidate: any) => candidate.candidate_kind === 'node'),
    edges: candidates.filter((candidate: any) => candidate.candidate_kind === 'link'),
    other_features: candidates.filter((candidate: any) => candidate.candidate_kind === 'unknown'),
  };
}

function geoJsonObjects(data: Buffer): any[] {
  const parsed = JSON.parse(data.toString('utf8'));
  if (parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) return parsed.features;
  if (parsed.type === 'Feature') return [parsed];
  throw new Error('ZIP member is not a GeoJSON Feature or FeatureCollection');
}

function renderNetworkMarkdown(report: any): string {
  const inventoryOnly = report.source_id.includes('stationmap');
  return `# Network inventory: ${report.source_id}\n\n- Files: ${JSON.stringify(report.files ?? report.members?.map((m: any) => m.file) ?? report.file)}\n- Counts: ${JSON.stringify(report.counts ?? report.totals ?? { features: report.feature_count })}\n- CRS: ${JSON.stringify(report.crs ?? report.network_inventory?.crs)}\n- Bbox: ${JSON.stringify(report.bbox ?? report.network_inventory?.bbox)}\n- Topology summary: ${JSON.stringify(report.topology ?? null)}\n- Attribute decoding: literal lookups only; applicable spec ${JSON.stringify(report.attribute_decoding?.applicable_spec_version??null)}. Full distributions and rank checks are in the companion JSON.\n- Distance consistency: ${JSON.stringify(report.distance_consistency??null)}\n\n${inventoryOnly ? 'Station-map files are listed as layer inventory only.' : 'All exported candidate records remain UNVERIFIED and non-routable. The inspector adds no connections.'}\n`;
}

async function getSourcePair(sourceId: string) {
  const source = await getStoredSource(sourceId);
  if (sourceId === 'hokonavi-ikebukuro-walk-node-csv') {
    return { node: source, link: await getStoredSource('hokonavi-ikebukuro-walk-link-csv') };
  }
  if (sourceId === 'hokonavi-ikebukuro-walk-link-csv') {
    return { node: await getStoredSource('hokonavi-ikebukuro-walk-node-csv'), link: source };
  }
  return { node: source, link: source };
}

export async function inspectNetwork(sourceId: string): Promise<any> {
  const specInputs=await codebookInputs(),fingerprint=await toolFingerprint();
  if (/^hokonavi-ikebukuro-walk-(node|link)-geojson$/.test(sourceId)) {
    const evidence=await r1GeoEvidence();
    const csvNode=await getStoredSource('hokonavi-ikebukuro-walk-node-csv'),csvLink=await getStoredSource('hokonavi-ikebukuro-walk-link-csv');
    const nodeRows=parseCsv(await readFile(csvNode.path)).rows,linkRows=parseCsv(await readFile(csvLink.path)).rows;
    const inspected=inspectGeoJsonPair(
      {features:evidence.nodes.features,...evidence.node.record,member:path.basename(evidence.node.record.store_path)},
      {features:evidence.links.features,...evidence.link.record,member:path.basename(evidence.link.record.store_path)},
    );
    inspected.crs=evidence.crs;
    inspected.counts={nodes:evidence.nodes.features.length,links:evidence.links.features.length};
    inspected.topology.metric_status='CONDITIONAL_ON_INFERRED_CRS';
    if(inspected.topology.geometry_endpoint_check_status==='CHECKED_IN_METRES')inspected.topology.geometry_endpoint_check_status='CONDITIONAL_ON_INFERRED_CRS';
    inspected.distance_consistency=evidence.distance;
    inspected.csv_comparison=compareNetworkRepresentations(nodeRows,linkRows,evidence.nodes.features,evidence.links.features);
    inspected.tool_input_sha256=fingerprint;
    inspected.input_sources=[evidence.node.record,evidence.link.record,csvNode.record,csvLink.record].map(r=>({source_id:r.source_id,sha256:r.sha256})).concat(specInputs);
    await writeJson(path.join(getStoreRoot(),'out',`${sourceId}.candidate-graph.json`),candidateGraphFromGeoJsonInventory(inspected));
    delete inspected.candidate_features;
    await writeJson(path.join(docsRoot,'gis','networks',`${sourceId}.json`),inspected);
    await writeFile(path.join(docsRoot,'gis','networks',`${sourceId}.md`),renderNetworkMarkdown(inspected));
    return inspected;
  }
  if (sourceId === 'hokonavi-ikebukuro-walk-node-csv' || sourceId === 'hokonavi-ikebukuro-walk-link-csv') {
    const pair = await getSourcePair(sourceId);
    const [nodeBuffer, linkBuffer] = await Promise.all([readFile(pair.node.path), readFile(pair.link.path)]);
    const node = parseCsv(nodeBuffer); const link = parseCsv(linkBuffer);
    const report: any = inspectCsvPair(node.rows, link.rows, {
      source_id: 'hokonavi-ikebukuro-walk-node-csv+hokonavi-ikebukuro-walk-link-csv',
      sha256: `${pair.node.record.sha256}+${pair.link.record.sha256}`,
      node_source_id: pair.node.record.source_id, link_source_id: pair.link.record.source_id,
      node_sha256: pair.node.record.sha256, link_sha256: pair.link.record.sha256,
      node_source_native_id: pair.node.source?.source_id ?? 'hokonavi-ikebukuro-walk-node-csv',
      link_source_native_id: pair.link.source?.source_id ?? 'hokonavi-ikebukuro-walk-link-csv',
    });
    const evidence=await r1GeoEvidence();
    report.crs=evidence.crs;
    report.topology.metric_status='CONDITIONAL_ON_INFERRED_CRS';
    report.distance_consistency={...evidence.distance,geometry_source_ids:[evidence.node.record.source_id,evidence.link.record.source_id],note:evidence.distance.note+' CSV contains no polyline geometry; these statistics use the acquired GeoJSON links.'};
    report.geojson_comparison=compareNetworkRepresentations(node.rows,link.rows,evidence.nodes.features,evidence.links.features);
    report.encoding = { node: node.encoding, link: link.encoding };
    report.tool_input_sha256=fingerprint;
    report.input_sources = [pair.node.record, pair.link.record,evidence.node.record,evidence.link.record].map((r: any) => ({ source_id: r.source_id, sha256: r.sha256 })).concat(specInputs);
    const out = path.join(getStoreRoot(), 'out', `${sourceId}.candidate-graph.json`);
    await writeJson(out, report.candidate_graph);
    delete report.candidate_graph;
    await writeJson(path.join(docsRoot, 'gis', 'networks', `${sourceId}.json`), report);
    await writeFile(path.join(docsRoot, 'gis', 'networks', `${sourceId}.md`), renderNetworkMarkdown(report));
    return report;
  }

  const source = await getStoredSource(sourceId);
  const files = await readZip(source.path);
  const isMap = sourceId.includes('stationmap');
  const memberReports = [];
  const allFeatures: any[] = [];
  const declaredCrsValues: unknown[] = [];
  const otherFiles: Array<{ file: string; uncompressed_bytes: number }> = [];
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.geojson') && !file.name.toLowerCase().endsWith('.json')) continue;
    const parsed = JSON.parse(file.data.toString('utf8'));
    let features: any[];
    try { features = geoJsonObjects(file.data); }
    catch (error) {
      if (file.name.toLowerCase().endsWith('.geojson')) throw error;
      otherFiles.push({ file: file.name, uncompressed_bytes: file.data.length });
      continue;
    }
    declaredCrsValues.push(geoJsonDeclaredCrs(parsed));
    if (isMap) {
      memberReports.push(inspectGeoJsonFeatures(features, { source_id: sourceId, sha256: source.record.sha256 }, geoJsonDeclaredCrs(parsed), file.name, 'stationmap'));
    } else {
      const inspected = inspectGeoJsonFeatures(features, { source_id: sourceId, sha256: source.record.sha256 }, geoJsonDeclaredCrs(parsed), file.name, 'stationmap');
      memberReports.push(archiveGeoJsonMemberReport(file.name, inspected));
      allFeatures.push(...features.map((feature) => ({ ...feature, __source_member: file.name })));
    }
  }
  const uniqueCrs = new Map(declaredCrsValues.map((crs) => [JSON.stringify(crs), crs]));
  const commonCrs = uniqueCrs.size === 1 ? uniqueCrs.values().next().value ?? null : { value: null, status: 'UNKNOWN', note: 'GeoJSON member layers declare different CRS values.' };
  const combined = !isMap ? inspectGeoJsonFeatures(allFeatures, { source_id: sourceId, sha256: source.record.sha256 }, commonCrs, 'combined GeoJSON network layers', 'network') : null;
  const report: any = { source_id: sourceId, source_sha256: source.record.sha256, archive_entry_count: files.length, members: memberReports, other_files: otherFiles, totals: { files: memberReports.length, features: memberReports.reduce((n, r) => n + r.feature_count, 0) }, ...(combined ? { network_inventory: archiveGeoJsonNetworkInventory(combined), topology: combined.topology,attribute_decoding:combined.attribute_decoding } : {}) };
  report.tool_input_sha256=fingerprint;
  report.input_sources=[{source_id:sourceId,sha256:source.record.sha256},...specInputs];
  if (memberReports.length === 0) throw new Error(`No GeoJSON members found in ${sourceId}`);
  if (!isMap && combined) {
    await writeJson(path.join(getStoreRoot(), 'out', `${sourceId}.candidate-graph.json`), candidateGraphFromGeoJsonInventory(combined));
  }
  await writeJson(path.join(docsRoot, 'gis', 'networks', `${sourceId}.json`), report);
  await writeFile(path.join(docsRoot, 'gis', 'networks', `${sourceId}.md`), renderNetworkMarkdown(report));
  return report;
}
