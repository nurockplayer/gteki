import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { docsRoot, getStoreRoot, getStoredSource, writeJson, TOOL_VERSION } from './common.js';
import { axisSwapCheck, decodeCsvBytes } from './csv-profile.js';
import { CONTEXT_ROLE, loadContextConfig, type StationContextConfig } from './context.js';
import { assertNoSourceValues, resolveConstantZ, resolveStationFrame, type OverlayFrameConfig, type OverlayZConfig } from './context-overlay.js';
import { toolFingerprint } from './provenance.js';
import { valueSha256 } from './poi.js';

/**
 * Point landmarks as visual context only (`gis context-landmarks <station>`): the Shinjuku cultural-property list, projected into the
 * same station frame as the context overlay and selected by the same closed origin disc.
 *
 * The director ruling of 2026-10-23 ships coordinates, 名称 and 文化財分類 and nothing else. `説明`, `URL`, `画像`, address, phone,
 * owner and every other column never leave this module: the leak guard scans the row-derived content of every output against every
 * column value except the two shipped ones. The file declares no CRS, so the coordinates are used as JGD2011 geographic and the CRS
 * is recorded as UNKNOWN and not asserted. Output is `gteki_role context`, `NOT_FOR_ROUTING`, `visual_only` and never routable.
 */
export const LANDMARKS_POLICY_VERSION = 'context-landmarks-v1';
/** The only property keys a landmark feature may carry (director ruling, nothing else). */
export const LANDMARK_PROPERTY_KEYS = ['class', 'credit', 'gteki_role', 'kind', 'name', 'navigation_use', 'row_hash', 'source_id', 'source_sha256', 'visual_only'] as const;
/**
 * The CRS block every output carries: the file declares none, so the projection assumption is recorded as an assumption, not a fact.
 * EPSG:6668 (JGD2011 geographic 2D) is the datum of the station origin; JGD2011 and WGS84 agree to well under a metre over a 700 m disc.
 */
export const LANDMARK_CRS = {
  declared: null,
  status: 'UNKNOWN',
  assumed_for_projection: 'JGD2011 geographic (EPSG:6668); JGD2011 and WGS84 differ by well under 1 m here',
  asserted: false,
} as const;
export const LANDMARK_FIELDS = ['class', 'lat', 'lon', 'name'] as const;

export interface LandmarksFields { lat: string; lon: string; name: string; class: string }
export interface LandmarksCredit { ja: string; en: string }
export interface LandmarksWindow { kind: 'origin_disc'; radius_m: number }
export interface LandmarksConfig {
  source_id: string;
  frame: OverlayFrameConfig;
  z: OverlayZConfig;
  window: LandmarksWindow;
  fields: LandmarksFields;
  credit: LandmarksCredit;
  notes?: string;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reject any key outside `allowed` and require every key in `required`, naming the offending field. */
function checkKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], where: string): void {
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) throw new Error(`${where} has unknown key ${JSON.stringify(key)} (allowed: ${[...required, ...optional].join(', ')})`);
  for (const key of required) if (!Object.hasOwn(value, key)) throw new Error(`${where} is missing ${JSON.stringify(key)}`);
}

/**
 * Strict landmarks config: unknown keys, wrong types and missing fields are errors that name the field. `frame` and `z` have the same
 * shape as the overlay's, so the same station facts and the same station.json checks back them.
 */
export function assertLandmarksConfig(station: string, value: unknown): LandmarksConfig {
  if (value === undefined) throw new Error(`Context config for ${station} has no landmarks section`);
  if (!isRecord(value)) throw new Error(`Context config for ${station}: landmarks must be an object`);
  const where = `landmarks for ${station}`;
  checkKeys(value, ['source_id', 'frame', 'z', 'window', 'fields', 'credit'], ['notes'], where);
  if (typeof value.source_id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(value.source_id)) throw new Error(`${where}: source_id must be a lowercase source id, got ${JSON.stringify(value.source_id)}`);
  const frame = value.frame;
  if (!isRecord(frame)) throw new Error(`${where}: frame must be an object`);
  if (frame.mode === 'station-enu-frame') {
    checkKeys(frame, ['mode', 'frame_id'], [], `${where}: frame`);
    if (typeof frame.frame_id !== 'string' || !frame.frame_id) throw new Error(`${where}: frame.frame_id must be a non-empty string`);
  } else if (frame.mode === 'origin-only') {
    checkKeys(frame, ['mode', 'station_json'], [], `${where}: frame`);
    if (typeof frame.station_json !== 'string' || !frame.station_json) throw new Error(`${where}: frame.station_json must be a non-empty string`);
  } else throw new Error(`${where}: frame.mode must be "station-enu-frame" or "origin-only", got ${JSON.stringify(frame.mode)}`);
  const z = value.z;
  if (!isRecord(z)) throw new Error(`${where}: z must be an object`);
  checkKeys(z, ['mode', 'z_m', 'basis', 'datum_asserted', 'check'], [], `${where}: z`);
  if (z.mode !== 'constant') throw new Error(`${where}: z.mode must be "constant", got ${JSON.stringify(z.mode)}`);
  if (!finite(z.z_m)) throw new Error(`${where}: z.z_m must be a finite number, got ${JSON.stringify(z.z_m)}`);
  if (typeof z.basis !== 'string' || !z.basis.trim()) throw new Error(`${where}: z.basis must be a non-empty string`);
  if (z.datum_asserted !== false) throw new Error(`${where}: z.datum_asserted must be false (the z carries no datum)`);
  if (!isRecord(z.check)) throw new Error(`${where}: z.check must be an object`);
  checkKeys(z.check, ['path', 'floor_ordinal', 'field'], [], `${where}: z.check`);
  if (typeof z.check.path !== 'string' || !z.check.path) throw new Error(`${where}: z.check.path must be a non-empty string`);
  if (!finite(z.check.floor_ordinal)) throw new Error(`${where}: z.check.floor_ordinal must be a finite number`);
  if (z.check.field !== 'renderElevationM') throw new Error(`${where}: z.check.field must be "renderElevationM", got ${JSON.stringify(z.check.field)}`);
  const window = value.window;
  if (!isRecord(window)) throw new Error(`${where}: window must be an object`);
  checkKeys(window, ['kind', 'radius_m'], [], `${where}: window`);
  if (window.kind !== 'origin_disc') throw new Error(`${where}: window.kind must be "origin_disc", got ${JSON.stringify(window.kind)}`);
  if (!finite(window.radius_m) || window.radius_m <= 0) throw new Error(`${where}: window.radius_m must be a positive number of metres, got ${JSON.stringify(window.radius_m)}`);
  const fields = value.fields;
  if (!isRecord(fields)) throw new Error(`${where}: fields must be an object`);
  checkKeys(fields, LANDMARK_FIELDS, [], `${where}: fields`);
  for (const key of LANDMARK_FIELDS) {
    if (typeof fields[key] !== 'string' || !fields[key].trim()) throw new Error(`${where}: fields.${key} must be a non-empty column name, got ${JSON.stringify(fields[key])}`);
  }
  const names = LANDMARK_FIELDS.map((key) => (fields[key] as string).trim());
  if (new Set(names).size !== names.length) throw new Error(`${where}: fields.lat, fields.lon, fields.name and fields.class must name four different columns`);
  const credit = value.credit;
  if (!isRecord(credit)) throw new Error(`${where}: credit must be an object`);
  checkKeys(credit, ['ja', 'en'], [], `${where}: credit`);
  for (const key of ['ja', 'en'] as const) if (typeof credit[key] !== 'string' || !credit[key].trim()) throw new Error(`${where}: credit.${key} must be a non-empty string`);
  if (value.notes !== undefined && typeof value.notes !== 'string') throw new Error(`${where}: notes must be a string`);
  return value as unknown as LandmarksConfig;
}

/**
 * Every non-blank cell of the rows in the given columns: the values a leak guard must never find outside the fields it allows.
 * `except` names column indices whose values may ship by design (名称 and 文化財分類).
 */
export function collectSourceValues(records: readonly (readonly string[])[], except: ReadonlySet<number> = new Set()): Set<string> {
  const values = new Set<string>();
  for (const row of records) row.forEach((cell, index) => {
    if (except.has(index)) return;
    const value = (cell ?? '').trim();
    if (value !== '') values.add(value);
  });
  return values;
}

/**
 * The mandated credit is fixed attribution text, not row content. A source cell equal to a ward or prefecture name inside it (the
 * publisher's own name) would otherwise be indistinguishable from a leak, so those coincidences are exempted and counted; every other
 * row value is still scanned. Nothing else is ever exempted.
 */
export function withoutCreditCoincidences(values: ReadonlySet<string>, credit: LandmarksCredit): { values: Set<string>; exempted: number } {
  const kept = new Set<string>();
  let exempted = 0;
  for (const value of values) {
    if (credit.ja.includes(value) || credit.en.includes(value)) exempted++;
    else kept.add(value);
  }
  return { values: kept, exempted };
}

export interface LandmarkPoint {
  row_index: number;
  x: number;
  y: number;
  z: number;
  name: string | null;
  class: string | null;
  row_hash: string;
}

export interface LandmarksMeta {
  station_id: string;
  frame_label: string;
  z_m: number;
  z_basis: string;
  credit: LandmarksCredit;
  source_id: string;
  source_sha256: string;
  window_label: string;
}

const NOTE_CRS = 'station-enu frame: coordinates are [x east, y north, z up] metres, not lon/lat';

/** Station-frame Point features; every feature carries the credit and the context tags, and nothing else from the source. */
export function landmarksGeoJson(points: readonly LandmarkPoint[], meta: LandmarksMeta): string {
  return JSON.stringify({
    type: 'FeatureCollection', crs_note: NOTE_CRS, gteki_role: CONTEXT_ROLE, navigation_use: 'NOT_FOR_ROUTING', visual_only: true,
    station_id: meta.station_id, frame: meta.frame_label, z_basis: meta.z_basis, z_m: meta.z_m, window: meta.window_label,
    crs: LANDMARK_CRS, credit: meta.credit, policy_version: LANDMARKS_POLICY_VERSION,
    features: points.map((p) => ({
      type: 'Feature',
      properties: {
        gteki_role: CONTEXT_ROLE, navigation_use: 'NOT_FOR_ROUTING', visual_only: true, kind: 'landmark',
        source_id: meta.source_id, source_sha256: meta.source_sha256, row_hash: p.row_hash, name: p.name, class: p.class, credit: meta.credit,
      },
      geometry: { type: 'Point', coordinates: [p.x, p.y, p.z] },
    })),
  });
}

export function landmarksBBox(points: readonly LandmarkPoint[]): { min: [number, number, number]; max: [number, number, number] } | null {
  let box: { min: [number, number, number]; max: [number, number, number] } | null = null;
  for (const p of points) {
    const v: [number, number, number] = [p.x, p.y, p.z];
    box = box ? { min: box.min.map((n, k) => Math.min(n, v[k]!)) as [number, number, number], max: box.max.map((n, k) => Math.max(n, v[k]!)) as [number, number, number] } : { min: [...v], max: [...v] };
  }
  return box;
}

/** Delimited CSV as rows of cells, decoded by the shared encoding detection; the delimiter is whichever separates the header. */
export function parseLandmarksCsv(bytes: Buffer): { header: string[]; rows: string[][] } {
  const { text } = decodeCsvBytes(bytes);
  const firstLine = text.split(/\r?\n/u, 1)[0] ?? '';
  const delimiter = (firstLine.match(/\t/gu)?.length ?? 0) > (firstLine.match(/,/gu)?.length ?? 0) ? '\t' : ',';
  const records = parse(text, { relax_column_count: true, relax_quotes: true, skip_empty_lines: true, delimiter }) as string[][];
  if (!records.length) throw new Error('the CSV has no header row');
  return { header: records[0]!.map((h) => h.replace(/^﻿/u, '')), rows: records.slice(1) };
}

export interface LandmarksRunOptions { radiusM?: number; receiptDir?: string }

/**
 * Run the conversion for one station. The gate is checked before the CSV is read, and the stored file is re-hashed against its
 * acquisition record first (getStoredSource does that), so a stale or altered copy never reaches the parser.
 */
export async function contextLandmarks(station: string, options: LandmarksRunOptions = {}): Promise<Record<string, unknown>> {
  const started = performance.now();
  const config = (await loadContextConfig(station)) as StationContextConfig & { landmarks?: unknown };
  const landmarks = assertLandmarksConfig(station, config.landmarks);
  const radius = options.radiusM ?? landmarks.window.radius_m;
  if (!finite(radius) || radius <= 0) throw new Error('landmark radius must be a positive number of metres');

  // Fail closed on the gate before reading the source, then re-verify the stored bytes against the acquisition record.
  const stored = await getStoredSource(landmarks.source_id);
  if (stored.source.publish_gate !== 'CONDITIONAL' && stored.source.publish_gate !== 'GO') {
    throw new Error(`${landmarks.source_id} is at publish_gate ${stored.source.publish_gate}; context-landmarks refuses to run (it needs CONDITIONAL or GO)`);
  }
  if (!stored.source.station_ids.includes(station)) throw new Error(`${landmarks.source_id} is not declared for station ${station}`);
  const bytes = await readFile(stored.path);

  const { projection, frameFacts, frameLabel } = await resolveStationFrame(station, landmarks.frame);
  const { z, zFacts } = await resolveConstantZ(landmarks.z);

  // Header: the four configured columns must be there under exactly those names.
  const { header, rows } = parseLandmarksCsv(bytes);
  const columnIndex = (column: string): number => {
    const index = header.findIndex((name) => name.trim() === column.trim());
    if (index < 0) throw new Error(`${landmarks.source_id}: the CSV has no column ${JSON.stringify(column)} (named by landmarks.fields)`);
    return index;
  };
  const latColumn = columnIndex(landmarks.fields.lat), lonColumn = columnIndex(landmarks.fields.lon);
  const nameColumn = columnIndex(landmarks.fields.name), classColumn = columnIndex(landmarks.fields.class);

  // Coordinates: a blank or invalid pair is skipped and counted, never guessed or filled in.
  const located: Array<{ row_index: number; lat: number; lon: number }> = [];
  rows.forEach((row, rowIndex) => {
    const rawLat = (row[latColumn] ?? '').trim(), rawLon = (row[lonColumn] ?? '').trim();
    const lat = rawLat === '' ? NaN : Number(rawLat), lon = rawLon === '' ? NaN : Number(rawLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return;
    located.push({ row_index: rowIndex, lat, lon });
  });
  const invalidCoordinates = rows.length - located.length;
  // The file declares no CRS, so the axis order is the only thing a range check can settle: refuse anything but the stated order.
  const axis = axisSwapCheck(located.map((p) => [p.lat, p.lon] as [number, number]));
  if (axis.verdict !== 'NOT_SWAPPED') {
    throw new Error(`${landmarks.source_id}: the axis check is ${axis.verdict} (${axis.as_is_in_japan} positions read as latitude/longitude lie inside the Japan ranges, ${axis.swapped_in_japan} only after swapping); refusing to guess the axis order`);
  }

  // Selection: a closed origin disc in station-frame XY metres, at the configured constant z.
  const points: LandmarkPoint[] = [];
  let outsideWindow = 0, nameNull = 0, classNull = 0;
  for (const p of located) {
    const [x, y] = projection.project(p.lat, p.lon);
    if (Math.hypot(x, y) > radius) { outsideWindow++; continue; }
    const row = rows[p.row_index]!;
    const name = (row[nameColumn] ?? '').trim(), klass = (row[classColumn] ?? '').trim();
    if (!name) nameNull++;
    if (!klass) classNull++;
    // row_hash is the hash of the whole source row keyed by the header, in header order.
    const rowObject = Object.fromEntries(header.map((key, index) => [key, row[index] ?? '']));
    points.push({ row_index: p.row_index, x: round3(x), y: round3(y), z, name: name || null, class: klass || null, row_hash: valueSha256(rowObject) });
  }

  const classes = new Map<string, number>();
  for (const p of points) if (p.class !== null) { const hash = valueSha256(p.class); classes.set(hash, (classes.get(hash) ?? 0) + 1); }
  const classesHistogram = Object.fromEntries([...classes].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const rowHashesSha256 = sha256(JSON.stringify(points.map((p) => p.row_hash).sort()));

  const fingerprint = await toolFingerprint();
  const digest = sha256(JSON.stringify({
    policy: LANDMARKS_POLICY_VERSION, fingerprint, source: stored.record.sha256,
    station_origin_sha256: frameFacts.station_origin_sha256, radius_m: radius, z_m: z,
  })).slice(0, 20);
  const windowLabel = `origin_disc ${radius} m around the station frame origin`;
  const runId = `landmarks-${station}-r${radius}-${frameLabel}-${digest}`;
  const meta: LandmarksMeta = {
    station_id: station, frame_label: frameLabel, z_m: z, z_basis: landmarks.z.basis,
    credit: landmarks.credit, source_id: landmarks.source_id, source_sha256: stored.record.sha256, window_label: windowLabel,
  };

  // Leak guards, before anything is written. The store outputs may ship 名称 and 文化財分類 only; the receipt may ship no row value at all.
  const storeGuard = withoutCreditCoincidences(collectSourceValues(rows, new Set([nameColumn, classColumn])), landmarks.credit);
  const receiptGuard = withoutCreditCoincidences(collectSourceValues(rows), landmarks.credit);
  const store = join(getStoreRoot(), 'out');
  await mkdir(store, { recursive: true });
  const outputs: Record<string, unknown> = {};
  let provenanceRel: string | null = null;
  if (points.length) {
    const geojson = landmarksGeoJson(points, meta);
    assertNoSourceValues(geojson, storeGuard.values, 'The landmark GeoJSON');
    const geojsonRel = `out/${runId}.geojson`;
    await writeFile(join(getStoreRoot(), geojsonRel), geojson);
    outputs.geojson = { store_path: geojsonRel, sha256: sha256(geojson), bytes: Buffer.byteLength(geojson) };
    const provenance = {
      run_id: runId, command: 'context-landmarks', policy_version: LANDMARKS_POLICY_VERSION, station_id: station,
      gteki_role: CONTEXT_ROLE, navigation_use: 'NOT_FOR_ROUTING', visual_only: true, verification: 'UNVERIFIED',
      crs: LANDMARK_CRS, frame: frameFacts, window: { kind: 'origin_disc', radius_m: radius, center: 'station frame origin', selection_rule: 'closed disc (distance <= radius)' },
      z_basis: zFacts,
      credit: landmarks.credit,
      source: { source_id: landmarks.source_id, source_sha256: stored.record.sha256, bytes: stored.record.bytes, resolved_url: stored.record.resolved_url, store_path: stored.record.store_path, size_check: stored.record.size_check, http_status: stored.record.http_status, requested_at: stored.record.requested_at, completed_at: stored.record.completed_at },
      feature_table: { columns: ['row_index', 'row_hash', 'x_m', 'y_m', 'z_m', 'name_null', 'class_null'], rows: points.map((p) => [p.row_index, p.row_hash, p.x, p.y, p.z, p.name === null, p.class === null]) },
      elapsed_ms: Math.round(performance.now() - started), peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
    };
    const provenanceText = `${JSON.stringify(provenance, null, 2)}\n`;
    assertNoSourceValues(provenanceText, storeGuard.values, 'The landmark provenance');
    provenanceRel = `out/${runId}.provenance.json`;
    await writeFile(join(getStoreRoot(), provenanceRel), provenanceText);
    outputs.provenance = { store_path: provenanceRel, sha256: sha256(provenanceText), bytes: Buffer.byteLength(provenanceText) };
  }

  const filled = (column: string): string => {
    const index = header.findIndex((name) => name.trim() === column);
    if (index < 0) return 'excluded (column absent in this source)';
    return `excluded (${rows.filter((row) => (row[index] ?? '').trim() !== '').length}/${rows.length} filled)`;
  };
  const receipt = {
    run_id: runId, command: 'context-landmarks', policy_version: LANDMARKS_POLICY_VERSION, station_id: station,
    gteki_role: CONTEXT_ROLE, navigation_use: 'NOT_FOR_ROUTING', visual_only: true, verification: 'UNVERIFIED',
    note: 'Point landmarks as visual context only (coordinates, name and class). No description, URL, image, address, phone, owner or other column is copied, hashed per field or written to any output. The name and class are shipped verbatim under the director ruling of 2026-10-23; the receipt carries them only as a per-value hash histogram. The selection is a closed disc around the station frame origin (distance <= radius); nothing here is a route, exit, floor or opening time.',
    crs: LANDMARK_CRS,
    frame: frameFacts,
    window: { kind: 'origin_disc', radius_m: radius, center: 'station frame origin', selection_rule: 'closed disc (distance <= radius)', z_m: z, z_basis: landmarks.z.basis },
    z_basis: zFacts,
    rows_in_source: rows.length,
    rows_invalid_coordinates: invalidCoordinates,
    outside_window: outsideWindow,
    selected: points.length,
    name_null: nameNull,
    class_null: classNull,
    classes: classesHistogram,
    row_hashes_sha256: rowHashesSha256,
    bbox_local_ENU: landmarksBBox(points),
    source: { source_id: landmarks.source_id, source_sha256: stored.record.sha256, bytes: stored.record.bytes, license_name: stored.source.license_name, license_url: stored.source.license_url, publish_gate: stored.source.publish_gate },
    credit: landmarks.credit,
    text_fields: {
      '説明': 'UNKNOWN: excluded (third-party authorship not excluded; director ruling 2026-10-23)',
      'URL': filled('URL'),
      '画像': filled('画像'),
    },
    leak_guard: {
      scope: 'row-derived content of the store GeoJSON, the provenance and this receipt; every column value except name and class, and every column value here',
      row_values_scanned_in_store_outputs: storeGuard.values.size,
      row_values_scanned_in_receipt: receiptGuard.values.size,
      exempted_as_credit_substring: Math.max(storeGuard.exempted, receiptGuard.exempted),
      exempted_reason: 'a source cell equal to part of the mandated attribution text (a ward or prefecture name) is fixed credit text, not a leaked cell',
    },
    outputs,
    tool_input_sha256: fingerprint,
    tool_version: TOOL_VERSION,
  };
  assertNoSourceValues(JSON.stringify(receipt), receiptGuard.values, 'The public landmark receipt');
  const receiptDir = options.receiptDir ?? join(docsRoot, 'gis', 'context');
  await writeJson(join(receiptDir, `${runId}.json`), receipt);
  return { ...receipt, store_paths: { geojson: outputs.geojson ?? null, provenance: provenanceRel }, receipt_path: `docs/gis/context/${runId}.json` };
}
