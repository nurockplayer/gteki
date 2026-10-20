import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { docsRoot, getStoreRoot, getStoredSource, readJson, writeJson } from './common.js';
import { readZip } from './zip.js';
import { toolFingerprint } from './provenance.js';
import { ownValue } from './values.js';

/** Opening-time field names seen in the sources: `openinghour`, `opening hour` (S03 level files) and `hours` (S03 HERE entities). */
export const OPENING_TIME_FIELD = /opening.?hours?|^hours$/iu;
export const POI_SOURCES = ['tokyo-s10-shinjuku-csv', 'tokyo-s10-shinjuku-nishiguchi-csv', 'tokyo-s03-zip', 'plateau-13104-related', 'plateau-13116-related'];
export const RIGHTS_SOURCES = [...POI_SOURCES, 'tokyo-s10-catalog', 'tokyo-s03-spec', 'tokyo-s03-reference', 'tokyo-s03-catalog', 'plateau-13104-related-catalog', 'plateau-13116-related-catalog'];
export type Row = Record<string, unknown>;
export function object(value: unknown): Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : Object.create(null);
}
export function decodeText(buffer: Buffer): { text: string; encoding: 'UTF-8' | 'Shift_JIS' } {
  for (const [label, encoding] of [['utf-8', 'UTF-8'], ['shift_jis', 'Shift_JIS']] as const) {
    try { return { text: new TextDecoder(label, { fatal: true }).decode(buffer), encoding }; } catch { /* Try the next explicit encoding. */ }
  }
  throw new Error('Input is neither valid UTF-8 nor Shift_JIS');
}
const blank = (value: unknown): boolean => value === undefined || value === null || typeof value === 'string' && value.trim() === '';
const type = (value: unknown): string => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
export function fieldStatistics(rows: Row[], headers?: string[]) {
  const keys = headers ?? [...new Set(rows.flatMap(row => Object.keys(row)))].sort();
  return Object.fromEntries(keys.map(key => {
    const values = rows.map(row => ownValue(row, key)), counts = new Map<string, { value: unknown; count: number }>();
    for (const value of values) if (!blank(value)) {
      const encoded = JSON.stringify(value);
      const entry = counts.get(encoded) ?? { value, count: 0 }; entry.count++; counts.set(encoded, entry);
    }
    const distribution = [...counts.values()].sort((a, b) => b.count - a.count || JSON.stringify(a.value).localeCompare(JSON.stringify(b.value)));
    // Complete literals stay in the hashed external detail; Git gets at most five short values per field.
    const sample = /description/iu.test(key) ? [] : distribution.filter(item => JSON.stringify(item.value).length <= 40).slice(0, 5);
    return [key, { blank_count: values.filter(blank).length, missing_count: values.filter(value => value === undefined).length,
      types: [...new Set(values.map(type))].sort(), distinct_count: counts.size, literal_distribution: sample, omitted_distinct: counts.size - sample.length }];
  }));
}
export function inventoryCsv(bytes: Buffer) {
  const decoded = decodeText(bytes), matrix = parse(decoded.text, { bom: true, skip_empty_lines: true, relax_column_count: false }) as string[][];
  const headers = matrix.shift() ?? [];
  if (new Set(headers).size !== headers.length) throw new Error('Duplicate CSV headers are ambiguous');
  const all = matrix.map(values => Object.fromEntries(headers.map((key, index) => [key, values[index]])));
  const rows = all.filter(row => Object.values(row).some(value => !blank(value)));
  const coordinateFields = headers.filter(key => /^(?:lat|lon|lng|latitude|longitude|緯度|経度|座標)$/iu.test(key));
  return { summary: { file: 'resource.csv', format: 'CSV', encoding: decoded.encoding, headers, row_count: all.length, populated_row_count: rows.length,
    blank_row_count: all.length - rows.length, fields: fieldStatistics(all, headers), coordinates: 'UNKNOWN', coordinate_fields: coordinateFields,
    crs: 'UNKNOWN', bbox: null, geometry_types: {}, literal_location_fields: headers.filter(key => /場所|階|位置|location|floor/iu.test(key)), routable: false }, detail: all };
}
function coordinates(value: unknown, output: number[][]): void {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && value.every(v => typeof v === 'number' && Number.isFinite(v))) output.push(value as number[]);
  else for (const child of value) coordinates(child, output);
}
export function geometryInventory(geometries: unknown[]) {
  const types = new Map<string, number>(), points: number[][] = [];
  let unsupported = 0;
  const visit = (value: unknown): void => {
    const geometry = object(value), name = ownValue(geometry, 'type');
    if (typeof name !== 'string') { types.set('null_or_unknown', (types.get('null_or_unknown') ?? 0) + 1); return; }
    types.set(name, (types.get(name) ?? 0) + 1);
    if (name === 'GeometryCollection') { for (const child of Array.isArray(geometry.geometries) ? geometry.geometries : []) visit(child); }
    else if (['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(name)) coordinates(ownValue(geometry, 'coordinates'), points);
    else unsupported++;
  };
  for (const value of geometries) visit(value);
  const bounds = points.length ? points.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]) : null;
  return { geometry_types: Object.fromEntries(types), coordinate_tuple_count: points.length, unsupported_geometry_count: unsupported,
    // Path command tuples are not GeoJSON coordinates and must never enter a geographic bbox.
    bbox: unsupported ? null : bounds, bbox_status: unsupported ? 'UNKNOWN_UNSUPPORTED_GEOMETRY' : bounds ? 'COMPUTED_NATIVE_XY' : 'UNKNOWN' };
}
export function inventoryJson(value: unknown, file: string) {
  const root = object(value), features = Array.isArray(root.features) ? root.features : null;
  const rows: Row[] = features ? features.map(feature => object(ownValue(object(feature), 'properties'))) : Array.isArray(root.entities) ? root.entities.map(entity => object(ownValue(object(entity), 'properties'))) : [];
  const navLinks = Array.isArray(root.l) ? root.l.map(object) : [];
  const navNodes = Array.isArray(root.n) ? root.n.map(object) : [];
  const fields = fieldStatistics(rows), rootProperties = object(root.properties);
  const originKeys = Object.keys(fields).filter(key => /出典|原典|資料|著作|ライセンス|attribution|copyright|source|license|origin/iu.test(key));
  const literalKeys = Object.keys(fields).filter(key => OPENING_TIME_FIELD.test(key) || /floor|level|場所|階|location|時間|int_address|^(?:to|from)$/iu.test(key));
  return { file, format: features ? 'FeatureCollection' : navLinks.length ? 'HERE_NAVIGATION_JSON' : Array.isArray(root.entities) ? 'HERE_ENTITIES' : 'HERE_COMMUNITY',
    root_keys: Object.keys(root).sort(), feature_count: features?.length ?? null, entity_count: Array.isArray(root.entities) ? root.entities.length : null,
    fields, root_properties: rootProperties, crs: ownValue(root, 'crs') ?? 'UNKNOWN', crs_declared: Object.hasOwn(root, 'crs'),
    crs_note: Object.hasOwn(root, 'crs') && root.crs === null ? 'Explicit null; coordinates cannot be inferred (S03 specification p8).' : 'No datum inferred from coordinates or file name.',
    ...geometryInventory(features?.map(feature => ownValue(object(feature), 'geometry')) ?? []),
    origin_attribution_fields: Object.fromEntries(originKeys.map(key => [key, fields[key]])),
    origin_dataset: 'UNKNOWN', origin_note: 'Property names and generic CityGML metadata do not identify the exact origin/vintage/licence of this related layer.',
    literal_location_time_fields: Object.fromEntries(literalKeys.map(key => [key, fields[key]])),
    route_structure: { exported_edges: 0, source_link_count: navLinks.length, source_node_count: navNodes.length,
      link_fields: fieldStatistics(navLinks), node_fields: fieldStatistics(navNodes), start_end_fields: Object.keys(fieldStatistics(navLinks)).filter(key => /^(?:n1|n2|start|end|from|to)$/iu.test(key)),
      interpretation: 'n1/n2 are literal source references. Path geometry files describe drawing shapes, not route edges. No route is validated or exported.' }, routable: false };
}
export function bboxRelation(a: number[] | null, b: number[] | null): string {
  const valid = (box: number[] | null): box is number[] => !!box && box.length === 4 && box.every(Number.isFinite) && box[0] <= box[2] && box[1] <= box[3];
  if (!valid(a) || !valid(b)) return 'UNKNOWN';
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1] ? 'INTERSECTS' : 'DISJOINT';
}
export async function inspectPoi(sourceId: string) {
  if (!POI_SOURCES.includes(sourceId)) throw new Error(`Not a bounded POI source: ${sourceId}`);
  const stored = await getStoredSource(sourceId), bytes = await readFile(stored.path);
  const entries = sourceId.endsWith('-csv') ? null : await readZip(stored.path, sourceId === 'tokyo-s03-zip' ? { legacyFileNameEncoding: 'shift_jis' } : {});
  const csv = entries ? null : inventoryCsv(bytes);
  const members = entries ? entries.map(entry => {
    const decoded = decodeText(entry.data), value: unknown = JSON.parse(decoded.text);
    return { ...inventoryJson(value, entry.name), encoding: decoded.encoding, bytes: entry.data.length, sha256: createHash('sha256').update(entry.data).digest('hex') };
  }) : [csv!.summary];
  const identityChecks = sourceId.startsWith('plateau-') ? await import('./related.js').then(m => m.relatedIdentity(sourceId)) : [];
  for (const member of members) {
    const identity = identityChecks.find(row => row.member === member.file);
    if (identity && 'origin_dataset' in member) {
      (member as any).origin_dataset = identity.origin ?? 'UNKNOWN';
      (member as any).origin_note = identity.origin ? 'Official catalog origin attached only after equal ZIP/direct feature arrays; terms assessed separately in rights record.' : 'Feature identity failed; no origin is attached.';
    }
  }
  const spec = sourceId === 'tokyo-s03-zip' ? await getStoredSource('tokyo-s03-spec') : null;
  const stationInputs: Array<{ source_id: string; sha256: string }> = [];
  for (const id of new Set(identityChecks.flatMap(row => [row.direct_source_id, 'plateau-related-provenance']))) stationInputs.push({ source_id: id, sha256: (await getStoredSource(id)).record.sha256 });
  if (spec) stationInputs.push({ source_id: spec.source.source_id, sha256: spec.record.sha256 });
  const references: Array<{ station_id: string; layer_id: string; bbox: number[] | null; crs_status: string }> = [];
  for (const station of ['shinjuku', 'ikebukuro']) {
    const report = await readJson<any>(join(docsRoot, 'gis', 'overlap', `${station}.json`));
    stationInputs.push(...report.input_sources);
    for (const layer of report.layers) references.push({ station_id: station, layer_id: layer.layer_id, bbox: layer.bbox_jgd2011_lon_lat, crs_status: layer.metric_status });
  }
  const detail = entries ? Object.fromEntries(entries.map(entry => [entry.name, JSON.parse(decodeText(entry.data).text)])) : csv!.detail;
  const detailBytes = Buffer.from(`${JSON.stringify(detail)}\n`), detailSha = createHash('sha256').update(detailBytes).digest('hex');
  const detailPath = `out/poi/${sourceId}-${stored.record.sha256.slice(0, 12)}-${detailSha.slice(0, 12)}.json`;
  await writeJson(join(getStoreRoot(), detailPath), detail);
  // writeJson uses pretty JSON; hash the exact persisted detail rather than a compact preimage.
  const persisted = await readFile(join(getStoreRoot(), detailPath));
  const contextEvidence = spec ? [{ id: `${spec.source.source_id}#crs-null`, source_id: spec.source.source_id, supporting_document: null, sha256: spec.record.sha256, url: spec.record.resolved_url, section: 'PDF p8 §3.2.4 Level GeoJSON (CRS)', quote: 'CRS が null の場合、座標は推定できません。', format: 'pdf' as const }] : [];
  for (const clause of contextEvidence) await import('./rights.js').then(m => m.verifyEvidence(clause));
  const report = { source_id: sourceId, source_sha256: stored.record.sha256, tool_input_sha256: await toolFingerprint(),
    input_sources: [{ source_id: sourceId, sha256: stored.record.sha256 }, ...new Map(stationInputs.map(input => [input.source_id, input])).values()],
    context_evidence: contextEvidence,
    station_ids: stored.source.station_ids, members, identity_checks: identityChecks, detail: { store_path: detailPath, sha256: createHash('sha256').update(persisted).digest('hex'), bytes: persisted.length },
    station_relevance: members.flatMap(member => references.map(reference => ({ file: member.file, station_id: reference.station_id, reference_layer: reference.layer_id,
      relation: bboxRelation(member.bbox, reference.bbox), status: 'CONDITIONAL_NUMERIC_BBOX_ONLY', reference_crs_status: reference.crs_status,
      condition: 'Native XY must be longitude/latitude degrees in a compatible datum. CRS UNKNOWN is not resolved by range plausibility. No floor, point or route correspondence.' }))),
    coordinates: csv ? 'UNKNOWN' : 'SEE_MEMBERS', routable: false, verification: 'UNVERIFIED', publish_gate: 'HOLD',
    limitations: ['No POI becomes a node, edge, door or floor.', 'Literal location, opening-hour and level fields remain verbatim in the hashed detail.', 'No source currency, operator permission, complete coverage or navigability established.'] };
  await writeJson(join(docsRoot, 'gis', 'poi', `${sourceId}.json`), report);
  return report;
}
