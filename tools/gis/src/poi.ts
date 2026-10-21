import { parse } from 'csv-parse/sync';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { assertPathWithinStore, docsRoot, ensurePrivateStore, getStoredSource, getStoreRoot, storeRelativePath } from './common.js';
import { toolFingerprint } from './provenance.js';
import { readZip, type ZipEntry } from './zip.js';
import { displayZipMemberName } from './zip-names.js';
import { commitReportFiles, type ReportFile } from './report-transaction.js';

const execFileAsync = promisify(execFile);
const MAX_CSV_BYTES = 64 * 1024 * 1024;
const MAX_PDF_TEXT_BYTES = 16 * 1024 * 1024;
const MAX_DISTRIBUTION_VALUES = 40;
const MAX_OBSERVATIONS = 100;
const MAX_EXCERPT_WORDS = 15;
const COORDINATES: Record<string, { latitude: readonly string[]; longitude: readonly string[] }> = {
  'toei-stores-shinjuku-csv': { latitude: ['緯度', 'latitude', 'lat'], longitude: ['経度', 'longitude', 'lon', 'lng'] },
  'toei-stores-shinjuku-nishiguchi-csv': { latitude: ['緯度', 'latitude', 'lat'], longitude: ['経度', 'longitude', 'lon', 'lng'] },
};
const IDENTIFIERS = ['施設ID', '店舗ID', 'id', 'ID', '店番号', '店舗コード'] as const;
const NAME_FIELDS = ['施設名', '店舗名', '名称', '駅名', '公園名', 'display_name', 'name', 'Name'] as const;
const STATION_FIELDS = ['駅名', 'station', 'station_name', 'stationName'] as const;
const LANDMARK_FIELDS = ['ランドマーク名', '名称', '公園名', 'landmark', 'landmark_name', 'landmarkName'] as const;
const OPERATOR_FIELDS = ['事業者', '事業者種別', '運営者', '運営会社', '会社名', 'operator', 'operator_name', 'operatorName'] as const;
const LINE_FIELDS = ['路線', '路線名', 'line', 'line_name', 'lineName'] as const;
const NODE_FIELDS = ['node_id', 'nodeId', 'nodeID', 'ノードID', '駅ID', 'station_id'] as const;
const EDGE_FIELDS = ['line_id', 'lineId', 'lineID', '路線ID', 'from_station_id', 'to_station_id', '起点駅ID', '終点駅ID'] as const;
const ATTRIBUTION_FIELDS = ['原典', '出典', '著作権', 'copyright', 'Copyright', 'source', 'Source', 'attribution'] as const;
const ENDPOINT_ID_FIELDS = ['from_node_id', 'start_node_id', 'to_node_id', 'end_node_id', 'from_id', 'to_id'] as const;

type Observation = {
  source_id: string;
  source_sha256: string;
  native_id: string | null;
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  raw_coordinates?: unknown[] | null;
  coordinate_reference?: { name: unknown; status: 'DECLARED' | 'RFC7946_ASSUMPTION' | 'LOCAL_COORDINATES' | 'UNSUPPORTED_DECLARED_CRS' | 'UNKNOWN' };
  verification: 'UNVERIFIED';
  routable: false;
};

function ownValue(row: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) if (Object.hasOwn(row, key)) return row[key];
  return undefined;
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() ? value : null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstOwnString(row: Record<string, unknown>, fields: readonly string[]): string | null {
  return stringValue(ownValue(row, fields));
}

function addCount(counts: Map<string, number>, value: unknown): void {
  const key = value === null || value === undefined ? '(blank)' : typeof value === 'object' ? '(non-scalar)' : typeof value === 'boolean' ? String(value) : stringValue(value) ?? '(blank)';
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function distribution(counts: Map<string, number>): { distinct_count: number; values: Record<string, number>; truncated: boolean } {
  const sorted = [...counts].sort(([a], [b]) => a.localeCompare(b));
  const truncated = sorted.length > MAX_DISTRIBUTION_VALUES;
  return { distinct_count: sorted.length, values: Object.fromEntries(sorted.slice(0, MAX_DISTRIBUTION_VALUES)), truncated };
}

function metadataInventory(parsed: unknown): Record<string, unknown> {
  const rootKeys = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed).sort() : [];
  const attribution = new Map<string, Map<string, number>>();
  let visited = 0;
  const visit = (value: unknown, depth: number): void => {
    if (depth > 8 || visited++ >= 100_000 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const child of value) visit(child, depth + 1); return; }
    const object = value as Record<string, unknown>;
    for (const field of ATTRIBUTION_FIELDS) if (Object.hasOwn(object, field)) {
      const values = attribution.get(field) ?? new Map<string, number>(); addCount(values, object[field]); attribution.set(field, values);
    }
    for (const key of Object.keys(object)) visit(object[key], depth + 1);
  };
  visit(parsed, 0);
  const sourceAttributions = Object.fromEntries([...attribution].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => [key, distribution(values)]));
  const root = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : Object.create(null) as Record<string, unknown>;
  const arrays = Object.fromEntries(Object.keys(root).filter((key) => Array.isArray(root[key])).map((key) => {
    const values = root[key] as unknown[];
    return [key, { count: values.length, first_item_types: [...new Set(values.slice(0, 10).map((value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value))], first_object_keys: [...new Set(values.slice(0, 10).filter((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)).flatMap((value) => Object.keys(value)))].sort().slice(0, 40) }];
  }));
  return {
    root_keys: rootKeys,
    root_arrays: arrays,
    entity_count: Object.hasOwn(root,'entities') && Array.isArray(root.entities) ? root.entities.length : null,
    drawing_count: Object.hasOwn(root,'drawings') && Array.isArray(root.drawings) ? root.drawings.length : null,
    feature_count: Object.hasOwn(root,'features') && Array.isArray(root.features) ? root.features.length : null,
    source_attributions: sourceAttributions,
    traversal_truncated: visited >= 100_000,
  };
}

function csvRows(buffer: Buffer): { headers: string[]; rows: string[][]; encoding: 'UTF-8' | 'Shift_JIS' } {
  if (buffer.length > MAX_CSV_BYTES) throw new Error(`CSV exceeds ${MAX_CSV_BYTES} byte inspector limit`);
  const data = buffer.subarray(buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 3 : 0);
  let text: string;
  let encoding: 'UTF-8' | 'Shift_JIS';
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); encoding = 'UTF-8'; }
  catch {
    text = new TextDecoder('shift_jis', { fatal: true }).decode(data);
    encoding = 'Shift_JIS';
  }
  const records = parse(text, { bom: true, skip_empty_lines: true, relax_column_count: false, trim: false, max_record_size: 1024 * 1024 }) as string[][];
  const headers = records.shift() ?? [];
  for (const [index, row] of records.entries()) if (row.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${row.length} fields; header has ${headers.length}`);
  return { headers, rows: records, encoding };
}

export function inspectPoiCsv(sourceId: string, sha256: string, buffer: Buffer): Record<string, unknown> {
  const { headers, rows, encoding } = csvRows(buffer);
  const recognized = Object.hasOwn(COORDINATES, sourceId) ? COORDINATES[sourceId] : undefined;
  const uniqueIndex = (fields: readonly string[]) => { const indexes = headers.flatMap((header, index) => fields.includes(header) ? [index] : []); return indexes.length === 1 ? indexes[0]! : -1; };
  const latitudeIndex = recognized ? uniqueIndex(recognized.latitude) : -1;
  const longitudeIndex = recognized ? uniqueIndex(recognized.longitude) : -1;
  const idIndex = uniqueIndex(IDENTIFIERS);
  const nameIndex = uniqueIndex(NAME_FIELDS);
  const columnStatistics = headers.map((header, index) => {
    const counts = new Map<string, number>(); let blankCount = 0;
    for (const row of rows) { const value = row[index] ?? ''; if (value.trim() === '') blankCount++; addCount(counts, value); }
    const values = distribution(counts);
    delete values.values['(blank)'];
    const distinctCount = new Set(rows.map((row) => row[index] ?? '').filter((value) => value.trim() !== '')).size;
    return { header, index, blank_count: blankCount, distinct_count: distinctCount, distinct_values: { ...values, distinct_count: distinctCount } };
  });
  const fieldDistribution = (fields: readonly string[]) => {
    const indexes = headers.flatMap((header, index) => fields.includes(header) ? [index] : []);
    return indexes.map((index) => ({ ...columnStatistics[index], field: headers[index], index }));
  };
  const observations: Observation[] = rows.slice(0, MAX_OBSERVATIONS).map((row) => ({
    source_id: sourceId,
    source_sha256: sha256,
    native_id: idIndex < 0 ? null : stringValue(row[idIndex]),
    name: nameIndex < 0 ? null : stringValue(row[nameIndex]),
    latitude: latitudeIndex < 0 ? null : numericValue(row[latitudeIndex]),
    longitude: longitudeIndex < 0 ? null : numericValue(row[longitudeIndex]),
    verification: 'UNVERIFIED',
    routable: false,
  }));
  return {
    format: 'CSV', encoding, row_count: rows.length, headers,
    duplicate_headers: [...new Set(headers.filter((header, index) => headers.indexOf(header) !== index))].sort(),
    coordinate_fields: { latitude: latitudeIndex < 0 ? null : { field: headers[latitudeIndex], index: latitudeIndex }, longitude: longitudeIndex < 0 ? null : { field: headers[longitudeIndex], index: longitudeIndex }, status: latitudeIndex >= 0 && longitudeIndex >= 0 ? 'LITERAL_FIELDS_FOUND' : 'UNKNOWN' },
    identifier_field: idIndex < 0 ? null : { field: headers[idIndex], index: idIndex }, name_field: nameIndex < 0 ? null : { field: headers[nameIndex], index: nameIndex },
    columns: columnStatistics,
    literal_field_distributions: { station: fieldDistribution(STATION_FIELDS), landmark: fieldDistribution(LANDMARK_FIELDS), operator: fieldDistribution(OPERATOR_FIELDS), line: fieldDistribution(LINE_FIELDS) },
    observations, observations_total: rows.length, observations_truncated: rows.length > MAX_OBSERVATIONS,
    topology: { status: 'INVENTORY_ONLY', candidate_edges: [] },
  };
}

function pointCoordinates(geometry: unknown): unknown[] | null {
  if (!geometry || typeof geometry !== 'object' || !Object.hasOwn(geometry, 'type') || !Object.hasOwn(geometry, 'coordinates')) return null;
  const geo = geometry as { type?: unknown; coordinates?: unknown };
  if (geo.type !== 'Point' || !Array.isArray(geo.coordinates) || geo.coordinates.length < 2) return null;
  if (geo.coordinates.some(value => typeof value !== 'number' || !Number.isFinite(value))) return null;
  return geo.coordinates;
}

function geographicCrs(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const normalized = name.trim().toUpperCase();
  const codes = ['4326', '4612', '6668'];
  if (codes.some(code => normalized === `EPSG:${code}` || normalized === `HTTP://WWW.OPENGIS.NET/DEF/CRS/EPSG/0/${code}` || normalized === `URN:OGC:DEF:CRS:EPSG::${code}`)) return true;
  return ['OGC:CRS84', 'CRS84', 'HTTP://WWW.OPENGIS.NET/DEF/CRS/OGC/1.3/CRS84', 'URN:OGC:DEF:CRS:OGC:1.3:CRS84'].includes(normalized);
}

function crsName(declaration: unknown): unknown {
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration) || !Object.hasOwn(declaration, 'type') || (declaration as Record<string, unknown>).type !== 'name' || !Object.hasOwn(declaration, 'properties')) return null;
  const properties = (declaration as Record<string, unknown>).properties;
  return properties && typeof properties === 'object' && !Array.isArray(properties) && !Object.hasOwn(properties, 'href') && !Object.hasOwn(properties, 'type') && Object.hasOwn(properties, 'name') && typeof (properties as Record<string, unknown>).name === 'string'
    ? (properties as Record<string, unknown>).name : null;
}

export function inspectPoiGeoJson(sourceId: string, sha256: string, file: string, parsed: unknown): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== 'object' || !Object.hasOwn(parsed, 'type')) return null;
  const root = parsed as Record<string, unknown>;
  const rootCrsPresent = Object.hasOwn(root, 'crs');
  const declaredCrs = rootCrsPresent ? root.crs : null;
  const rootCrsName = crsName(declaredCrs);
  const localCoordinates = file.includes('path-level-geom');
  let features: unknown[];
  if (root.type === 'FeatureCollection' && Object.hasOwn(root, 'features') && Array.isArray(root.features)) features = root.features;
  else if (root.type === 'Feature') features = [root];
  else return null;
  const geometryCounts = new Map<string, number>();
  const propertyCounts = new Map<string, Map<string, number>>();
  const propertyPresent = new Map<string, number>();
  // Recognized literal fields are always inspected, independent of the generic per-feature
  // property cap; skipped generic properties are "unobserved", never "absent".
  const PROPERTY_CAP = 200;
  const relevantLiteralFields = new Set<string>([...STATION_FIELDS, ...LANDMARK_FIELDS, ...OPERATOR_FIELDS, ...LINE_FIELDS, ...NAME_FIELDS]);
  const propertyPresentFullyScanned = new Map<string, number>();
  let featuresOverPropertyCap = 0;
  const attributionCounts = new Map<string, Map<string, number>>();
  const endpointFieldSets = new Map<string, number>();
  const bboxKeys = ['bbox', 'BBOX', 'extent', 'Extent'] as const;
  const observations: Observation[] = [];
  let observationsTotal = 0;
  const candidateEdges: Array<{ line_id: string; from_id: string; to_id: string; source_id: string; source_sha256: string; verification: 'UNVERIFIED'; routable: false }> = [];
  const coordinateBounds = [Infinity, Infinity, -Infinity, -Infinity];
  let coordinateTraversalIncomplete = false;
  let coordinatePositionCount = 0;
  let geographicBoundsValid = true;
  let coordinateVisitCount = 0;
  let geometryVisitCount = 0;
  const geometryVisitLimit = 1_000_000;
  const effectiveCrsKeys = new Set<string>();
  type EffectiveCrs = { present: boolean; declaration: unknown; name: unknown; status: 'DECLARED' | 'RFC7946_ASSUMPTION' | 'LOCAL_COORDINATES' | 'UNSUPPORTED_DECLARED_CRS' | 'UNKNOWN'; key: string };
  const effectiveCrsRecords: EffectiveCrs[] = [];
  const crsReference = (present: boolean, declaration: unknown): EffectiveCrs => {
    const name = present ? crsName(declaration) : null;
    const status = !present ? localCoordinates ? 'LOCAL_COORDINATES' as const : 'RFC7946_ASSUMPTION' as const
      : name === null ? 'UNKNOWN' as const
        : geographicCrs(name) ? 'DECLARED' as const : 'UNSUPPORTED_DECLARED_CRS' as const;
    const key = !present ? status : declaration === null ? 'UNKNOWN:null' : `${status}:${JSON.stringify(name)}`;
    return { present, declaration, name, status, key };
  };
  const effectiveCrsFor = (feature: Record<string, unknown>, geometry: Record<string, unknown>, inherited?: EffectiveCrs): EffectiveCrs => {
    const declarations = [crsReference(rootCrsPresent, declaredCrs)];
    if (Object.hasOwn(feature, 'crs') && feature !== root) declarations.push(crsReference(true, feature.crs));
    if (inherited) declarations.push(inherited);
    if (Object.hasOwn(geometry, 'crs')) declarations.push(crsReference(true, geometry.crs));
    const present = declarations.filter(record => record.present);
    if (present.some(record => record.status === 'UNKNOWN') || new Set(present.map(record => record.key)).size > 1)
      return { present: true, declaration: present.map(record => record.declaration), name: null, status: 'UNKNOWN', key: 'UNKNOWN:conflicting-declarations' };
    return present.at(-1) ?? declarations[0]!;
  };
  // GeoJSON nesting depth above a position, per geometry type. Anything else is malformed
  // and must never contribute to a "complete" bbox.
  const COORDINATE_LEVELS: Record<string, number> = { Point: 0, MultiPoint: 1, LineString: 1, Polygon: 2, MultiLineString: 2, MultiPolygon: 3 };
  let geometryMalformed = false;
  let malformedGeometryCount = 0;
  const visitCoordinates = (value: unknown, level: number): void => {
    if (coordinateVisitCount >= 1_000_000) { coordinateTraversalIncomplete = true; return; }
    coordinateVisitCount++;
    if (level === 0) {
      if (!Array.isArray(value) || value.length < 2 || !value.every((item) => typeof item === 'number' && Number.isFinite(item))) { geometryMalformed = true; return; }
      coordinatePositionCount++;
      if (value[0] < -180 || value[0] > 180 || value[1] < -90 || value[1] > 90) geographicBoundsValid = false;
      coordinateBounds[0] = Math.min(coordinateBounds[0]!, value[0]); coordinateBounds[1] = Math.min(coordinateBounds[1]!, value[1]);
      coordinateBounds[2] = Math.max(coordinateBounds[2]!, value[0]); coordinateBounds[3] = Math.max(coordinateBounds[3]!, value[1]); return;
    }
    if (!Array.isArray(value)) { geometryMalformed = true; return; }
    for (const child of value) visitCoordinates(child, level - 1);
  };
  const visitGeometry = (feature: Record<string, unknown>, geometry: unknown, depth = 0, inherited?: EffectiveCrs): EffectiveCrs | undefined => {
    if (geometryVisitCount >= geometryVisitLimit) { coordinateTraversalIncomplete = true; return; }
    geometryVisitCount++;
    if (depth > 12) { coordinateTraversalIncomplete = true; return; }
    if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)) { coordinateTraversalIncomplete = true; return; }
    if (!Object.hasOwn(geometry, 'type')) { coordinateTraversalIncomplete = true; return; }
    const object = geometry as Record<string, unknown>;
    const effectiveCrs = effectiveCrsFor(feature, object, inherited);
    if (object.type === 'GeometryCollection') {
      if (!Object.hasOwn(object, 'geometries') || !Array.isArray(object.geometries)) { coordinateTraversalIncomplete = true; return; }
      for (const child of object.geometries) {
        if (geometryVisitCount >= geometryVisitLimit) { coordinateTraversalIncomplete = true; break; }
        if (child === null) { coordinateTraversalIncomplete = true; continue; }
        visitGeometry(feature, child, depth + 1, effectiveCrs);
      }
      return effectiveCrs;
    }
    if (object.type === 'Point' || object.type === 'MultiPoint' || object.type === 'LineString' || object.type === 'MultiLineString' || object.type === 'Polygon' || object.type === 'MultiPolygon') {
      effectiveCrsRecords.push(effectiveCrs);
      effectiveCrsKeys.add(effectiveCrs.key);
      if (Object.hasOwn(object, 'coordinates')) {
        geometryMalformed = false;
        visitCoordinates(object.coordinates, COORDINATE_LEVELS[object.type]!);
        if (geometryMalformed) { malformedGeometryCount++; geometryMalformed = false; }
      } else coordinateTraversalIncomplete = true;
      return effectiveCrs;
    }
    effectiveCrsRecords.push(effectiveCrs);
    effectiveCrsKeys.add(effectiveCrs.key);
    coordinateTraversalIncomplete = true;
    return effectiveCrs;
  };
  for (const featureValue of features) {
    if (!featureValue || typeof featureValue !== 'object' || Array.isArray(featureValue)) { coordinateTraversalIncomplete = true; continue; }
    if (!Object.hasOwn(featureValue, 'geometry')) { coordinateTraversalIncomplete = true; continue; }
    const feature = featureValue as Record<string, unknown>;
    if (feature.type !== 'Feature') coordinateTraversalIncomplete = true;
    const geometry = feature.geometry;
    const geometryType = geometry && typeof geometry === 'object' && Object.hasOwn(geometry, 'type') ? String((geometry as Record<string, unknown>).type) : '(null)';
    addCount(geometryCounts, geometryType);
    if (geometryType === 'LineString' || geometryType === 'MultiLineString') {
      const props = Object.hasOwn(featureValue, 'properties') && feature.properties && typeof feature.properties === 'object' && !Array.isArray(feature.properties) ? feature.properties as Record<string, unknown> : Object.create(null) as Record<string, unknown>;
      const fields = ENDPOINT_ID_FIELDS.filter((field) => Object.hasOwn(props, field));
      const key = fields.join(',') || '(none)'; endpointFieldSets.set(key, (endpointFieldSets.get(key) ?? 0) + 1);
    }
    const effectiveCrs = geometry === null ? undefined : visitGeometry(feature, geometry);
    const properties = Object.hasOwn(feature, 'properties') && feature.properties && typeof feature.properties === 'object' && !Array.isArray(feature.properties) ? feature.properties as Record<string, unknown> : Object.create(null) as Record<string, unknown>;
    const propertyKeys = Object.keys(properties);
    const overCap = propertyKeys.length > PROPERTY_CAP;
    if (overCap) featuresOverPropertyCap++;
    for (const [position, field] of propertyKeys.entries()) {
      if (position >= PROPERTY_CAP && !relevantLiteralFields.has(field)) continue;
      const map = propertyCounts.get(field) ?? new Map<string, number>();
      addCount(map, properties[field]); propertyCounts.set(field, map);
      propertyPresent.set(field, (propertyPresent.get(field) ?? 0) + 1);
      if (!overCap) propertyPresentFullyScanned.set(field, (propertyPresentFullyScanned.get(field) ?? 0) + 1);
    }
    for (const field of ATTRIBUTION_FIELDS) {
      if (!Object.hasOwn(properties, field)) continue;
      const map = attributionCounts.get(field) ?? new Map<string, number>(); addCount(map, properties[field]); attributionCounts.set(field, map);
    }
    if (sourceId === 'tokyo-shinjuku-facilities-zip' && geometryType === 'LineString') {
      const lineId = firstOwnString(properties, ['line_id', 'lineId', 'lineID']);
      const fromId = firstOwnString(properties, ['from_node_id', 'start_node_id', 'from_id']);
      const toId = firstOwnString(properties, ['to_node_id', 'end_node_id', 'to_id']);
      if (lineId && fromId && toId) candidateEdges.push({ line_id: lineId, from_id: fromId, to_id: toId, source_id: sourceId, source_sha256: sha256, verification: 'UNVERIFIED', routable: false });
    }
    const coordinates = pointCoordinates(geometry);
    if (!coordinates) continue;
    observationsTotal++;
    if (observations.length >= MAX_OBSERVATIONS) continue;
    const geographic = effectiveCrs?.status === 'DECLARED' || effectiveCrs?.status === 'RFC7946_ASSUMPTION';
    const inRange = typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number' && coordinates[0] >= -180 && coordinates[0] <= 180 && coordinates[1] >= -90 && coordinates[1] <= 90;
    observations.push({ source_id: sourceId, source_sha256: sha256,
      native_id: firstOwnString(properties, IDENTIFIERS), name: firstOwnString(properties, NAME_FIELDS),
      raw_coordinates: coordinates,
      coordinate_reference: { name: effectiveCrs?.name ?? null, status: effectiveCrs?.status ?? 'UNKNOWN' },
      longitude: geographic && inRange ? coordinates[0] as number : null, latitude: geographic && inRange ? coordinates[1] as number : null, verification: 'UNVERIFIED', routable: false });
  }
  const bboxPropertyKeys = bboxKeys.filter((key) => Object.hasOwn(root, key));
  const literalDistributions = Object.fromEntries([...propertyCounts].sort(([a], [b]) => a.localeCompare(b)).map(([field, counts]) => {
    const values = distribution(counts); const blanks = values.values['(blank)'] ?? 0; delete values.values['(blank)'];
    const distinctCount = Math.max(0, values.distinct_count - Number(blanks > 0));
    // Features over the cap never count a skipped generic property as absent.
    const exact = relevantLiteralFields.has(field) || featuresOverPropertyCap === 0;
    const absent = exact ? features.length - (propertyPresent.get(field) ?? 0) : features.length - featuresOverPropertyCap - (propertyPresentFullyScanned.get(field) ?? 0);
    return [field, { blank_count: absent + blanks, complete: exact, unobserved_feature_count: exact ? 0 : featuresOverPropertyCap, distinct_count: distinctCount, distinct_values: { ...values, distinct_count: distinctCount } }];
  }));
  const sourceAttributions = Object.fromEntries([...attributionCounts].sort(([a], [b]) => a.localeCompare(b)).map(([field, counts]) => [field, distribution(counts)]));
  const literalValueTables = [...propertyCounts].filter(([field]) => relevantLiteralFields.has(field)).sort(([a], [b]) => a.localeCompare(b)).map(([field, counts]) => {
    const values = Object.fromEntries([...counts].filter(([value]) => value !== '(blank)' && value !== '(non-scalar)').sort(([a], [b]) => a.localeCompare(b)));
    return { file, field, values, value_count: Object.keys(values).length, complete: true, blank_count: counts.get('(blank)') ?? 0 };
  });
  const mixedCrs = effectiveCrsKeys.size > 1;
  if (mixedCrs) for (const observation of observations) { observation.longitude = null; observation.latitude = null; }
  const bboxComplete = !coordinateTraversalIncomplete && malformedGeometryCount === 0;
  const rawBbox = bboxComplete && coordinateBounds[0] !== Infinity ? coordinateBounds : null;
  const bbox = !mixedCrs && effectiveCrsRecords.every((record) => record.status === 'DECLARED' || record.status === 'RFC7946_ASSUMPTION') && geographicBoundsValid ? rawBbox : null;
  const commonCrsName = mixedCrs ? null : effectiveCrsRecords.length ? effectiveCrsRecords[0]!.name : rootCrsName;
  const layerCrsStatus = mixedCrs ? 'MIXED' : effectiveCrsRecords[0]?.status ?? crsReference(rootCrsPresent, declaredCrs).status;
  return {
    file, format: 'GeoJSON', feature_count: features.length, bbox, raw_coordinates_bbox: rawBbox, bbox_status: coordinateTraversalIncomplete ? 'INCOMPLETE_LIMIT_REACHED' : malformedGeometryCount > 0 ? 'INCOMPLETE_MALFORMED_GEOMETRY' : bbox ? 'COMPUTED_GEOGRAPHIC' : 'UNKNOWN', bbox_counts: { coordinate_visits: coordinateVisitCount, coordinate_positions: coordinatePositionCount, geometry_visits: geometryVisitCount, geometry_visit_limit: geometryVisitLimit, malformed_geometries: malformedGeometryCount, visit_limit: 1_000_000 }, property_keys: [...propertyCounts.keys()].sort(), property_keys_truncated: propertyCounts.size >= 200 || featuresOverPropertyCap > 0, property_scan: { property_cap: PROPERTY_CAP, features_over_cap: featuresOverPropertyCap, recognized_literal_fields_exempt: true }, geometry_type_counts: distribution(geometryCounts),
    line_feature_count: (geometryCounts.get('LineString') ?? 0) + (geometryCounts.get('MultiLineString') ?? 0), endpoint_field_sets: Object.fromEntries([...endpointFieldSets].sort(([a], [b]) => a.localeCompare(b))),
    crs: { properties: { name: commonCrsName } }, crs_status: layerCrsStatus, declared_crs: declaredCrs,
    effective_crs_declarations: [...new Map(effectiveCrsRecords.filter(record=>record.present).map(record=>[JSON.stringify(record.declaration),record.declaration])).values()],
    crs_interpretation: mixedCrs ? 'Features declare or imply mixed coordinate reference systems; layer metrics are withheld' : layerCrsStatus === 'UNKNOWN' ? 'CRS explicitly unknown; no coordinate reference is assumed' : layerCrsStatus === 'DECLARED' || layerCrsStatus === 'UNSUPPORTED_DECLARED_CRS' ? 'Declared CRS retained verbatim; no reprojection performed' : layerCrsStatus === 'LOCAL_COORDINATES' ? 'Path coordinates are local per source format specification; no CRS declared or inferred' : 'RFC7946 longitude-latitude assumption; source declaration absent',
    bbox_property_keys: bboxPropertyKeys, literal_field_distributions: literalDistributions, literal_value_tables: literalValueTables, source_attributions: sourceAttributions, observations, observations_total: observationsTotal, observations_truncated: observationsTotal > MAX_OBSERVATIONS, candidate_edges: candidateEdges,
  };
}

/** Keep bbox completeness evidence when a GeoJSON layer is nested in an acquired ZIP. */
export function poiGeoJsonMember(file: string, bytes: number, geo: Record<string, unknown>): Record<string, unknown> & { file: string; bytes: number; kind: string } {
  return { file, bytes, kind: 'GEOJSON', feature_count: geo.feature_count, bbox: geo.bbox, bbox_status: geo.bbox_status, bbox_counts: geo.bbox_counts, raw_coordinates_bbox: geo.raw_coordinates_bbox, crs: geo.crs, crs_status: geo.crs_status, declared_crs: geo.declared_crs, crs_interpretation: geo.crs_interpretation, property_keys: geo.property_keys, property_keys_truncated: geo.property_keys_truncated, property_scan: geo.property_scan, geometry_type_counts: geo.geometry_type_counts, literal_field_distributions: geo.literal_field_distributions, source_attributions: geo.source_attributions, line_feature_count: geo.line_feature_count, endpoint_field_sets: geo.endpoint_field_sets };
}

async function zipReport(sourceId: string, sha256: string, filePath: string): Promise<Record<string, unknown>> {
  const entries = await readZip(filePath, { maxEntryBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 });
  const members: Array<{ file: string; bytes: number; kind: string; name_bytes_hex?: string; name_utf8_flag?: boolean; name_encoding_status?: string; name_cp437?: string | null; name_utf8?: string | null; name_cp932_candidate?: string | null; excerpt?: string; metadata?: Record<string, unknown>; feature_count?: unknown; bbox?: unknown; bbox_status?: unknown; bbox_counts?: unknown; raw_coordinates_bbox?: unknown; crs?: unknown; crs_status?: unknown; declared_crs?:unknown; crs_interpretation?:unknown; property_keys?:unknown; property_keys_truncated?:unknown; geometry_type_counts?: unknown; literal_field_distributions?: unknown; source_attributions?: unknown; line_feature_count?: unknown; endpoint_field_sets?: unknown }> = [];
  const nameFields = (entry: ZipEntry) => ({ name_bytes_hex: entry.name_bytes_hex, name_utf8_flag: entry.name_utf8_flag, name_encoding_status: entry.name_encoding_status, name_cp437: entry.name_cp437, name_utf8: entry.name_utf8, name_cp932_candidate: entry.name_cp932_candidate });
  const allObservations: Observation[] = [];
  const candidateEdges: unknown[] = [];
  const literalValueTables: unknown[] = [];
  let observationsTotal = 0;
  for (const entry of entries) {
    const lower = entry.name.toLowerCase();
    if (lower.endsWith('.geojson') || lower.endsWith('.json')) {
      try {
        const parsed = JSON.parse(entry.data.toString('utf8')) as unknown;
        const geo = inspectPoiGeoJson(sourceId, sha256, entry.name, parsed);
        if (geo) {
          members.push({ ...poiGeoJsonMember(entry.name, entry.data.length, geo), ...nameFields(entry) });
          if (Array.isArray(geo.observations)) {
            observationsTotal += Number(geo.observations_total ?? geo.observations.length);
            const remaining = Math.max(0, MAX_OBSERVATIONS - allObservations.length);
            allObservations.push(...(geo.observations as Observation[]).slice(0, remaining));
          }
          if (Array.isArray(geo.candidate_edges)) candidateEdges.push(...geo.candidate_edges);
          if (Array.isArray(geo.literal_value_tables)) literalValueTables.push(...geo.literal_value_tables);
        } else members.push({ file: entry.name, bytes: entry.data.length, kind: 'JSON_METADATA', ...nameFields(entry), metadata: metadataInventory(parsed) });
      } catch (error) {
        members.push({ file: entry.name, bytes: entry.data.length, kind: 'JSON_UNPARSED', ...nameFields(entry) });
        if (lower.endsWith('.geojson')) throw new Error(`Invalid GeoJSON member ${entry.name}: ${String(error)}`);
      }
    } else {
      const isText = lower.endsWith('readme') || lower.endsWith('.md') || lower.endsWith('.txt');
      if (isText) {
        const lines = entry.data.toString('utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const noticeLines = lines.filter((line) => /(?:原典|出典|著作権|copyright|attribution|license|licence|ライセンス|利用条件)/i.test(line)).slice(0, 20);
        members.push({ file: entry.name, bytes: entry.data.length, kind: 'README_OR_TEXT', ...nameFields(entry), metadata: { line_count: lines.length, notice_excerpts: noticeLines.map(excerpt) } });
      } else members.push({ file: entry.name, bytes: entry.data.length, kind: 'OTHER', ...nameFields(entry) });
    }
  }
  const sourceAttributions = members.flatMap((member) => member.source_attributions ? [{ file: member.file, fields: member.source_attributions }] : member.metadata && Object.keys((member.metadata as Record<string, unknown>).source_attributions as object ?? {}).length ? [{ file: member.file, fields: (member.metadata as Record<string, unknown>).source_attributions }] : []);
  const metadataMembers = members.filter((member) => member.kind === 'README_OR_TEXT' || member.kind === 'JSON_METADATA').map(({ file, bytes, kind, metadata }) => ({ file, bytes, kind, metadata }));
  const nameStatusCounts: Record<string, number> = {};
  for (const entry of entries) nameStatusCounts[entry.name_encoding_status] = (nameStatusCounts[entry.name_encoding_status] ?? 0) + 1;
  const undeclared = (nameStatusCounts.CANDIDATE_CP932_UNDECLARED ?? 0) + (nameStatusCounts.UNDECLARED_UNRESOLVED ?? 0);
  const filenameEncoding = { status: undeclared ? 'UNDECLARED_LEGACY_NAMES_PRESENT' : 'DECLARED_OR_ASCII', raw_filename_bytes_available: true, status_counts: nameStatusCounts,
    note: undeclared ? 'Member names without the ZIP UTF-8 flag are decoded per specification as CP437 (name_cp437 / file). Names that decode as valid CP932 are recorded only as name_cp932_candidate; the encoding is not declared by the archive. The raw name bytes (name_bytes_hex) are the member identity; no alias was adopted.' : 'All member names are ASCII or declare their encoding.' };
  return { format: 'ZIP', archive_entry_count: entries.length, filename_encoding: filenameEncoding, members, observations: allObservations, observations_total: observationsTotal, observations_truncated: observationsTotal > allObservations.length, literal_value_tables: literalValueTables, source_attributions: sourceAttributions, metadata_members: metadataMembers, topology: { status: candidateEdges.length ? 'EXPLICIT_LITERAL_ENDPOINT_IDS_ONLY' : 'INVENTORY_ONLY', candidate_edges: candidateEdges.slice(0, MAX_OBSERVATIONS), candidate_edges_truncated: candidateEdges.length > MAX_OBSERVATIONS } };
}

function excerpt(text: string): string {
  const input = text.trim();
  const segments = [...new Intl.Segmenter('ja', { granularity: 'word' }).segment(input)].filter((segment) => segment.isWordLike);
  const boundary = segments[MAX_EXCERPT_WORDS - 1];
  if (boundary) return input.slice(0, boundary.index + boundary.segment.length).trim();
  return input.split(/\s+/).slice(0, MAX_EXCERPT_WORDS).join(' ');
}

function wordCount(text: string): number {
  return [...new Intl.Segmenter('ja', { granularity: 'word' }).segment(text)].filter((segment) => segment.isWordLike).length;
}

async function pdfReport(pathname: string): Promise<Record<string, unknown>> {
  const executable = process.env.GTEKI_GIS_PDFTOTEXT || 'pdftotext';
  const result = await execFileAsync(executable, ['-layout', '-enc', 'UTF-8', pathname, '-'], {
    encoding: 'utf8', maxBuffer: MAX_PDF_TEXT_BYTES, timeout: 20_000, killSignal: 'SIGKILL',
  });
  const pages = result.stdout.split('\f');
  const references: Array<{ page: number; category: string; excerpt: string; quoted_words: number }> = [];
  const patterns = [
    ['field', /(?:フィールド名|項目名|データ項目|属性項目|「プロパティ」|(?:display_name|facility|station|landmark|operator|line)\s*["':]|(?:CRS|properties|coordinates?)\s*(?:is|が|:|=))/i],
    ['code', /(?:"(?:transform|height|width|local2m)"\s*:|コマンド整数|コード表|code\s*[:=])/i],
    ['data_date', /(?:(?:19|20)\d{2}[年./-]\s*\d{1,2}[月./-]|令和\s*[元0-9０-９]+年|公開日|更新日|基準日)/i],
  ] as const;
  pages.forEach((page, index) => {
    const lines = page.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const [category, pattern] of patterns) {
      const line = lines.find((value) => pattern.test(value));
      if (!line) continue;
      const text = excerpt(line);
      references.push({ page: index + 1, category, excerpt: text, quoted_words: wordCount(text) });
    }
  });
  return { format: 'PDF', page_count: pages.length - (pages.at(-1) === '' ? 1 : 0), text_extraction: 'pdftotext', references, excerpt_word_limit: MAX_EXCERPT_WORDS };
}

function isPoiSource(sourceId: string): boolean {
  return [
    'toei-stores-shinjuku-csv', 'toei-stores-shinjuku-nishiguchi-csv',
    'tokyo-shinjuku-facilities-zip', 'plateau-13104-related-2025', 'plateau-13116-related-2025',
    'tokyo-shinjuku-facilities-spec-pdf',
  ].includes(sourceId);
}

/** Inspect acquired POI inputs with literal source fields only. All observations remain unverified and non-routable. */
export async function inspectPoi(sourceId: string): Promise<Record<string, unknown>> {
  if (!isPoiSource(sourceId)) throw new Error(`Unsupported POI source_id: ${sourceId}`);
  const source = await getStoredSource(sourceId);
  const fingerprint = await toolFingerprint();
  const extension = path.extname(source.path).toLowerCase();
  let content: Record<string, unknown>;
  if (extension === '.csv' || sourceId.endsWith('-csv')) content = inspectPoiCsv(sourceId, source.record.sha256, await readFile(source.path));
  else if (extension === '.zip' || sourceId.endsWith('-zip') || sourceId.endsWith('-2025')) content = await zipReport(sourceId, source.record.sha256, source.path);
  else if (extension === '.pdf' || sourceId.endsWith('-pdf')) content = await pdfReport(source.path);
  else content = { format: 'UNKNOWN', note: `No inspector for acquired extension ${extension || '(none)'}` };
  const spec = sourceId === 'tokyo-shinjuku-facilities-zip' ? await getOptionalSpec() : null;
  const reportContent = { ...content };
  const literalTables = Array.isArray(reportContent.literal_value_tables) ? reportContent.literal_value_tables : null;
  delete reportContent.literal_value_tables;
  let literalValuesArtifact: { store_path: string; sha256: string; bytes: number; tables: number } | undefined;
  if (literalTables?.length) {
    const artifactName = `${sourceId}.literal-values.json`;
    const artifactText = `${JSON.stringify({ source_id: sourceId, source_sha256: source.record.sha256, tables: literalTables }, null, 2)}\n`;
    const artifactSha256 = createHash('sha256').update(artifactText).digest('hex');
    const artifactPath = await persistLiteralArtifact(artifactName, artifactText, artifactSha256);
    literalValuesArtifact = { store_path: artifactPath.store_path, sha256: artifactSha256, bytes: Buffer.byteLength(artifactText), tables: literalTables.length };
  }
  const report = {
    source_id: sourceId,
    source_sha256: source.record.sha256,
    source_bytes: source.record.bytes,
    tool_input_sha256: fingerprint,
    input_sources: [{ source_id: sourceId, sha256: source.record.sha256 }, ...(spec ? [{ source_id: spec.source_id, sha256: spec.sha256 }] : [])],
    rights: { commercial_use: source.source.commercial_use, modification_allowed: source.source.modification_allowed, redistribution_allowed: source.source.redistribution_allowed, attribution_text: source.source.attribution_text },
    rights_observations: { manifest_attribution: source.source.attribution_text, source_property_fields: ['原典', '出典', '著作権', 'copyright', 'Copyright', 'source', 'Source', 'attribution'] },
    station_ids: source.source.station_ids,
    verification: 'UNVERIFIED', routable: false,
    ...reportContent,
    ...(literalValuesArtifact ? { literal_values_artifact: literalValuesArtifact } : {}),
    ...(spec ? { specification_source: { source_id: spec.source_id, sha256: spec.sha256, report: await pdfReport(spec.path) } } : {}),
  };
  const outDir = path.join(docsRoot, 'gis', 'poi');
  // Prepare both renderings first, then publish JSON and Markdown as one rollback-capable bundle.
  const files: ReportFile[] = [
    { path: path.join(outDir, `${sourceId}.json`), content: `${JSON.stringify(report, null, 2)}\n` },
    { path: path.join(outDir, `${sourceId}.md`), content: renderPoiMarkdown(report) },
  ];
  await commitReportFiles(files, path.join(docsRoot, 'gis'));
  return report;
}

function renderPoiMarkdown(report: Record<string, any>): string {
  const memberSummary = Array.isArray(report.members) ? report.members.map((member: any) => `| ${displayZipMemberName(member)} | ${member.feature_count ?? 'UNKNOWN'} | ${JSON.stringify(member.bbox ?? null)} | ${JSON.stringify(member.crs ?? null)} |`).join('\n') : '';
  return `# POI inventory: ${report.source_id}\n\n- Source SHA-256: \`${report.source_sha256}\`\n- Tool-input SHA-256: \`${report.tool_input_sha256}\`\n- Station IDs: ${JSON.stringify(report.station_ids)}\n- Verification: ${report.verification}; routable: ${report.routable}\n- Rights observations: ${JSON.stringify(report.rights_observations)}\n${report.literal_values_artifact ? `- Literal-value artifact store path: \`${report.literal_values_artifact.store_path}\` (SHA-256 \`${report.literal_values_artifact.sha256}\`, ${report.literal_values_artifact.tables} tables)\n` : ''}${memberSummary ? `\n| Member | Features | Bbox | CRS |\n| --- | ---: | --- | --- |\n${memberSummary}\n` : ''}\nAll source observations remain unverified. This inventory makes no current-world verification, rights determination, routing, or coverage claim.\n`;
}

async function persistLiteralArtifact(filename: string, contents: string, sha256: string): Promise<{ store_path: string }> {
  const storeRoot = ensurePrivateStore();
  const storePath = storeRelativePath(sha256, filename);
  const fullPath = path.resolve(storeRoot, storePath);
  const parentPath = path.dirname(fullPath);
  await mkdir(parentPath, { recursive: true, mode: 0o700 });
  await assertPathWithinStore(storeRoot, parentPath);
  try {
    await writeFile(fullPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (!error || typeof error !== 'object' || !Object.hasOwn(error,'code') || (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    await assertPathWithinStore(storeRoot, fullPath);
    const existing = await readFile(fullPath);
    if (existing.length !== Buffer.byteLength(contents) || createHash('sha256').update(existing).digest('hex') !== sha256) throw new Error(`Existing content-addressed literal artifact failed integrity check: ${storePath}`);
  }
  await assertPathWithinStore(storeRoot, fullPath);
  return { store_path: storePath };
}

/** Rehash persisted literal-value artifacts and constrain resolution to the private store. */
export async function verifyPoiEvidence(report: unknown): Promise<{ status: 'PASS' | 'FAIL'; errors: string[] }> {
  const errors: string[] = [];
  if (!report || typeof report !== 'object' || !Object.hasOwn(report, 'source_id') || !Object.hasOwn(report, 'source_sha256')) return { status: 'FAIL', errors: ['POI report is missing its source identity.'] };
  const value = report as Record<string, unknown>;
  if (typeof value.source_id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(value.source_id) || typeof value.source_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.source_sha256)) return { status: 'FAIL', errors: ['POI report source identity or SHA-256 is malformed.'] };
  if (!Object.hasOwn(value, 'literal_values_artifact')) return { status: 'PASS', errors };
  const artifact = value.literal_values_artifact;
  if (!artifact || typeof artifact !== 'object' || !Object.hasOwn(artifact, 'store_path') || !Object.hasOwn(artifact, 'sha256') || !Object.hasOwn(artifact, 'bytes') || !Object.hasOwn(artifact, 'tables')) return { status: 'FAIL', errors: ['Literal-value artifact pointer is malformed.'] };
  const pointer = artifact as Record<string, unknown>;
  if (typeof pointer.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(pointer.sha256) || !Number.isSafeInteger(pointer.bytes) || (pointer.bytes as number) < 0 || !Number.isSafeInteger(pointer.tables) || (pointer.tables as number) < 0) return { status: 'FAIL', errors: ['Literal-value artifact pointer has an unsafe path or invalid integrity metadata.'] };
  const expectedStorePath = storeRelativePath(pointer.sha256, `${value.source_id}.literal-values.json`);
  if (pointer.store_path !== expectedStorePath) return { status: 'FAIL', errors: ['Literal-value artifact pointer has an unsafe path or invalid integrity metadata.'] };
  const storeRoot = getStoreRoot();
  const expectedPath = path.resolve(storeRoot, expectedStorePath);
  try {
    await assertPathWithinStore(storeRoot, expectedPath);
    const bytes = await readFile(expectedPath);
    if (bytes.length !== pointer.bytes) errors.push('Literal-value artifact byte count does not match the report.');
    if (createHash('sha256').update(bytes).digest('hex') !== pointer.sha256) errors.push('Literal-value artifact SHA-256 does not match the report.');
    const data = JSON.parse(bytes.toString('utf8')) as unknown;
    if (!data || typeof data !== 'object' || !Object.hasOwn(data, 'source_id') || !Object.hasOwn(data, 'source_sha256') || !Object.hasOwn(data, 'tables')) errors.push('Literal-value artifact shape is invalid.');
    else {
      const parsed = data as Record<string, unknown>;
      if (parsed.source_id !== value.source_id || parsed.source_sha256 !== value.source_sha256) errors.push('Literal-value artifact acquisition lineage does not match the report.');
      if (!Array.isArray(parsed.tables) || parsed.tables.length !== pointer.tables) errors.push('Literal-value artifact table count does not match the report.');
      else for (const table of parsed.tables) {
        if (!table || typeof table !== 'object' || !Object.hasOwn(table, 'values') || !Object.hasOwn(table, 'field') || !Object.hasOwn(table, 'value_count')) { errors.push('Literal-value artifact contains a malformed table.'); break; }
        const values = (table as Record<string, unknown>).values;
        if (!values || typeof values !== 'object' || Array.isArray(values) || !Number.isSafeInteger((table as Record<string, unknown>).value_count) || Object.keys(values).length !== (table as Record<string, unknown>).value_count || Object.values(values).some((count) => !Number.isSafeInteger(count) || (count as number) < 0)) { errors.push('Literal-value table has malformed or mismatched value counts.'); break; }
      }
    }
  } catch (error) { errors.push(`Unable to read literal-value artifact: ${String(error)}`); }
  return { status: errors.length ? 'FAIL' : 'PASS', errors };
}

async function getOptionalSpec(): Promise<{ source_id: string; sha256: string; path: string } | null> {
  try {
    const spec = await getStoredSource('tokyo-shinjuku-facilities-spec-pdf');
    return { source_id: spec.record.source_id, sha256: spec.record.sha256, path: spec.path };
  } catch (error) { throw new Error(`Required S03 specification is unavailable: ${error instanceof Error?error.message:String(error)}`); }
}
