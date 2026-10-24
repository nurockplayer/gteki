import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { docsRoot, getStoreRoot, getStoredSource, writeJson, TOOL_VERSION } from './common.js';
import { axisSwapCheck, decodeCsvBytes, JAPAN_BOX } from './csv-profile.js';
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
/** What the director ruling pins per station: the source, the four columns and the exact credit a config must carry. */
export interface LandmarksPolicy { source_id: string; fields: LandmarksFields; credit: LandmarksCredit }

/**
 * The pinned policy, in code, so a config edit cannot widen the ruling: a station is convertible only when its `landmarks` section
 * matches this exactly, and a station with no entry here is refused. The director ruling of 2026-10-23 names these four columns, this
 * source and this credit (新宿区 only); changing any of them is a new ruling, not a config change.
 */
export const LANDMARK_POLICIES: Readonly<Record<string, LandmarksPolicy>> = {
  shinjuku: {
    source_id: 'tokyo-muni-shinjuku-cultural-properties-csv',
    fields: { lat: '緯度', lon: '経度', name: '名称', class: '文化財分類' },
    credit: {
      ja: '出典：新宿区『文化財一覧（自治体標準データセット）』（CC BY 4.0、東京都オープンデータカタログサイト経由）。GTEki が加工して作成',
      en: 'Source: Shinjuku City, "文化財一覧（自治体標準データセット）" (CC BY 4.0, via the Tokyo Open Data Catalog). Modified by GTEki.',
    },
  },
};
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

/**
 * A coordinate cell is read only when the trimmed text is a plain signed decimal. `Number()` alone would also accept `0x23`,
 * `0b100011`, `0o43`, `1e1` and `Infinity`, silently projecting a cell the source never wrote as a coordinate; those are
 * counted as invalid instead. The caller trims the cell; a decimal too long for a double still fails the finite check.
 */
const PLAIN_DECIMAL = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/u;
export const parseLandmarkCoordinate = (raw: string): number => (PLAIN_DECIMAL.test(raw) ? Number(raw) : NaN);
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
  // The director ruling is pinned in code: the config may not rename a column, swap the source or reword the credit.
  const policy = LANDMARK_POLICIES[station];
  if (!policy) throw new Error(`Context config for ${station} has no pinned landmark policy in context-landmarks.ts; refusing to convert it`);
  if (value.source_id !== policy.source_id) throw new Error(`${where}: source_id is ${JSON.stringify(value.source_id)} but the pinned policy for ${station} is ${JSON.stringify(policy.source_id)}; refusing to convert`);
  for (const key of LANDMARK_FIELDS) {
    if ((fields[key] as string).trim() !== policy.fields[key]) throw new Error(`${where}: fields.${key} is ${JSON.stringify(fields[key])} but the pinned policy for ${station} names ${JSON.stringify(policy.fields[key])}; refusing to convert`);
  }
  if (credit.ja !== policy.credit.ja || credit.en !== policy.credit.en) throw new Error(`${where}: credit does not match the pinned director text for ${station}; refusing to convert`);
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

/** What a mandated credit string is replaced by before a leak scan (ASCII, so it cannot hold a source value). */
export const CREDIT_PLACEHOLDER = '<attribution-credit>';

/**
 * The mandated credit is fixed attribution text, not row content, but its wording contains source cells (the publisher's own ward and
 * prefecture names). Before a leak scan, every exact occurrence of `credit.ja` and `credit.en` is replaced by a fixed placeholder, in
 * the raw form (the GeoJSON is not re-encoded) and the JSON form (the provenance is pretty-printed and the receipt is JSON, so their
 * escapes differ). No source value is exempted: the FULL value set is scanned against the masked text, so the same value still trips
 * the guard anywhere outside the credit. Returns the masked text and how many occurrences were masked.
 */
export function maskCreditText(text: string, credit: LandmarksCredit, placeholder: string = CREDIT_PLACEHOLDER): { text: string; occurrences: number } {
  const forms = [...new Set([credit.ja, credit.en].flatMap((value) => [value, JSON.stringify(value).slice(1, -1)]))]
    .filter((form) => form !== '')
    .sort((a, b) => b.length - a.length);
  let masked = text, occurrences = 0;
  for (const form of forms) {
    const parts = masked.split(form);
    occurrences += parts.length - 1;
    masked = parts.join(placeholder);
  }
  return { text: masked, occurrences };
}

/** What a shipped name or class position is replaced by in the scanned copy of the store GeoJSON. */
export const SHIPPED_FIELD_PLACEHOLDER = '<shipped-field>';

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

/** Every feature's property keys must be exactly the ruled set: an extra or missing key fails before anything is written. */
export function assertLandmarkFeatureProperties(collection: unknown, where = 'The landmark GeoJSON'): void {
  const features = isRecord(collection) ? collection.features : undefined;
  if (!Array.isArray(features)) throw new Error(`${where} has no features array`);
  const allowed = new Set<string>(LANDMARK_PROPERTY_KEYS);
  features.forEach((feature, index) => {
    const properties = isRecord(feature) ? feature.properties : undefined;
    if (!isRecord(properties)) throw new Error(`${where}: feature ${index + 1} has no properties object`);
    for (const key of Object.keys(properties)) if (!allowed.has(key)) throw new Error(`${where}: feature ${index + 1} carries the property ${JSON.stringify(key)}, which is not in LANDMARK_PROPERTY_KEYS`);
    for (const key of allowed) if (!Object.hasOwn(properties, key)) throw new Error(`${where}: feature ${index + 1} is missing the property ${JSON.stringify(key)}`);
  });
}

/** Station-frame Point features; every feature carries the credit and the context tags, and nothing else from the source. */
export function landmarkFeatureCollection(points: readonly LandmarkPoint[], meta: LandmarksMeta): Record<string, unknown> {
  const collection: Record<string, unknown> = {
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
  };
  assertLandmarkFeatureProperties(collection);
  return collection;
}

export function landmarksGeoJson(points: readonly LandmarkPoint[], meta: LandmarksMeta): string {
  return JSON.stringify(landmarkFeatureCollection(points, meta));
}

/**
 * The text the store leak guard scans. The GeoJSON ships `name` and `class` by design, and a shipped string may contain another
 * column's cell as a substring (a temple name holds its owner's name), which the non-ASCII substring match would read as a leak. So the
 * scan copy is built from the feature objects with those two property POSITIONS set to the placeholder (an equal value anywhere else is
 * untouched and still fails), then the mandated credit is masked in the serialised copy.
 */
export function landmarkScanText(collection: Record<string, unknown>, credit: LandmarksCredit): { text: string; creditOccurrences: number; shippedFieldValuesMasked: number } {
  const features = collection.features;
  if (!Array.isArray(features)) throw new Error('The landmark GeoJSON has no features array');
  let shippedFieldValuesMasked = 0;
  const masked = {
    ...collection,
    features: features.map((feature) => {
      const properties = { ...(isRecord(feature) && isRecord(feature.properties) ? feature.properties : {}) };
      for (const key of ['name', 'class'] as const) {
        if (properties[key] === null || properties[key] === undefined) continue;
        properties[key] = SHIPPED_FIELD_PLACEHOLDER;
        shippedFieldValuesMasked++;
      }
      return { ...(isRecord(feature) ? feature : {}), properties };
    }),
  };
  const creditMasked = maskCreditText(JSON.stringify(masked), credit);
  return { text: creditMasked.text, creditOccurrences: creditMasked.occurrences, shippedFieldValuesMasked };
}

export function landmarksBBox(points: readonly LandmarkPoint[]): { min: [number, number, number]; max: [number, number, number] } | null {
  let box: { min: [number, number, number]; max: [number, number, number] } | null = null;
  for (const p of points) {
    const v: [number, number, number] = [p.x, p.y, p.z];
    box = box ? { min: box.min.map((n, k) => Math.min(n, v[k]!)) as [number, number, number], max: box.max.map((n, k) => Math.max(n, v[k]!)) as [number, number, number] } : { min: [...v], max: [...v] };
  }
  return box;
}

/**
 * A header name as it is compared everywhere: BOM stripped, NFC, trimmed (`trim` removes the full-width space too). Header names are
 * canonicalised once, so `" 名称"` and `"名称"` are the same column, not two.
 */
export function canonicalColumnName(name: string): string {
  return name.replace(/^﻿/u, '').normalize('NFC').trim();
}

/** Delimited CSV as rows of cells, decoded by the shared encoding detection; the delimiter is whichever separates the header. */
export function parseLandmarksCsv(bytes: Buffer): { header: string[]; rows: string[][] } {
  const { text } = decodeCsvBytes(bytes);
  const firstLine = text.split(/\r?\n/u, 1)[0] ?? '';
  const delimiter = (firstLine.match(/\t/gu)?.length ?? 0) > (firstLine.match(/,/gu)?.length ?? 0) ? '\t' : ',';
  const records = parse(text, { relax_column_count: true, relax_quotes: true, skip_empty_lines: true, delimiter }) as string[][];
  if (!records.length) throw new Error('the CSV has no header row');
  const header = records[0]!.map(canonicalColumnName);
  // A repeated header name would make a column ambiguous (a whitespace-shadowed duplicate would let a second column sit behind the
  // approved name); a ragged row would shift every cell after the gap. Both fail, and the message names a header name or a line, never
  // a cell value.
  const seen = new Set<string>();
  for (const name of header) {
    if (seen.has(name)) throw new Error(`the CSV header repeats the column name ${JSON.stringify(name)}; refusing to read it`);
    seen.add(name);
  }
  records.slice(1).forEach((row, index) => {
    if (row.length !== header.length) throw new Error(`the CSV data row ${index + 1} (line ${index + 2}) has ${row.length} cells where the header has ${header.length}; refusing to read a ragged file`);
  });
  return { header, rows: records.slice(1) };
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
  // Hash the exact bytes that will be parsed, not just the record's claim: a copy altered after acquisition never reaches the parser.
  if (sha256(bytes) !== stored.record.sha256) throw new Error(`${stored.path} does not hash to the acquisition record (${stored.record.sha256}); refusing to parse it`);

  const { projection, frameFacts, frameLabel } = await resolveStationFrame(station, landmarks.frame);
  const { z, zFacts } = await resolveConstantZ(landmarks.z);

  // Header: the four configured columns must be there under exactly those names.
  const { header, rows } = parseLandmarksCsv(bytes);
  // Exact equality of the canonical names, and exactly one match: the pinned column is never a whitespace variant, and an ambiguous
  // header is refused rather than resolved to the first hit.
  const columnIndex = (column: string): number => {
    const wanted = canonicalColumnName(column);
    const found = header.flatMap((name, index) => (name === wanted ? [index] : []));
    if (found.length === 0) throw new Error(`${landmarks.source_id}: the CSV has no column ${JSON.stringify(column)} (named by landmarks.fields)`);
    if (found.length !== 1) throw new Error(`${landmarks.source_id}: the CSV has ${found.length} columns named ${JSON.stringify(column)}; refusing an ambiguous header`);
    return found[0]!;
  };
  const latColumn = columnIndex(landmarks.fields.lat), lonColumn = columnIndex(landmarks.fields.lon);
  const nameColumn = columnIndex(landmarks.fields.name), classColumn = columnIndex(landmarks.fields.class);

  // Coordinates: only a plain signed decimal is read; a blank, non-decimal or invalid pair is skipped and counted, never guessed.
  const located: Array<{ row_index: number; lat: number; lon: number }> = [];
  rows.forEach((row, rowIndex) => {
    const lat = parseLandmarkCoordinate((row[latColumn] ?? '').trim()), lon = parseLandmarkCoordinate((row[lonColumn] ?? '').trim());
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return;
    located.push({ row_index: rowIndex, lat, lon });
  });
  const invalidCoordinates = rows.length - located.length;
  // The file declares no CRS, so the axis order is the only thing a range check can settle: refuse anything but the stated order.
  const axis = axisSwapCheck(located.map((p) => [p.lat, p.lon] as [number, number]));
  if (axis.verdict !== 'NOT_SWAPPED') {
    throw new Error(`${landmarks.source_id}: the axis check is ${axis.verdict} (${axis.as_is_in_japan} positions read as latitude/longitude lie inside the Japan ranges, ${axis.swapped_in_japan} only after swapping); refusing to guess the axis order`);
  }
  // The 90% verdict above still admits a minority of bad pairs, which would project kilometres away as if they were real. Every
  // located point must be inside the Japan box as labelled; the profile's 90% report threshold is left as it is.
  const outsideJapan = located.filter((p) => p.lat < JAPAN_BOX.latMin || p.lat > JAPAN_BOX.latMax || p.lon < JAPAN_BOX.lonMin || p.lon > JAPAN_BOX.lonMax);
  if (outsideJapan.length) throw new Error(`${landmarks.source_id}: ${outsideJapan.length} of ${located.length} located positions lie outside the Japan ranges read as latitude/longitude; refusing to convert a mixed or out-of-range file`);

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

  // Leak guards, entirely in memory: the three files are built and every guard runs before anything is written. The store outputs may
  // ship 名称 and 文化財分類 only; the receipt may ship no row value at all. No value is exempted: the mandated credit strings are
  // masked in a copy of each text, and the GeoJSON's shipped name/class positions too; each copy is scanned against the full value set
  // and the written text stays unmasked.
  const storeGuard = collectSourceValues(rows, new Set([nameColumn, classColumn]));
  const receiptGuard = collectSourceValues(rows);
  const maskedCredits: Record<string, number> = {};
  let shippedFieldValuesMasked = 0;
  const outputs: Record<string, unknown> = {};
  let geojsonText: string | null = null, provenanceText: string | null = null;
  if (points.length) {
    const geojsonRel = `out/${runId}.geojson`, provenanceRel = `out/${runId}.provenance.json`;
    const collection = landmarkFeatureCollection(points, meta);
    const scan = landmarkScanText(collection, landmarks.credit);
    maskedCredits.store_geojson = scan.creditOccurrences;
    shippedFieldValuesMasked = scan.shippedFieldValuesMasked;
    assertNoSourceValues(scan.text, storeGuard, 'The landmark GeoJSON');
    geojsonText = JSON.stringify(collection);
    outputs.geojson = { store_path: geojsonRel, sha256: sha256(geojsonText), bytes: Buffer.byteLength(geojsonText) };
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
    provenanceText = `${JSON.stringify(provenance, null, 2)}\n`;
    const maskedProvenance = maskCreditText(provenanceText, landmarks.credit);
    maskedCredits.store_provenance = maskedProvenance.occurrences;
    assertNoSourceValues(maskedProvenance.text, storeGuard, 'The landmark provenance');
    outputs.provenance = { store_path: provenanceRel, sha256: sha256(provenanceText), bytes: Buffer.byteLength(provenanceText) };
  }

  const filled = (column: string): string => {
    const index = header.indexOf(canonicalColumnName(column));
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
      row_values_scanned_in_store_outputs: storeGuard.size,
      row_values_scanned_in_receipt: receiptGuard.size,
      credit_occurrences_masked: { store_geojson: maskedCredits.store_geojson ?? 0, store_provenance: maskedCredits.store_provenance ?? 0, receipt: 0 },
      shipped_field_values_masked: shippedFieldValuesMasked,
      credit_masking: 'the mandated credit strings and the shipped name/class values are masked before scanning; no source value is exempted',
    },
    outputs,
    tool_input_sha256: fingerprint,
    tool_version: TOOL_VERSION,
  };
  // The receipt carries the credit by design; measure its masked occurrences on the assembled text, then scan the final text (the
  // count differs only in digits, never in the credit occurrences, so one measurement is enough).
  receipt.leak_guard.credit_occurrences_masked.receipt = maskCreditText(JSON.stringify(receipt), landmarks.credit).occurrences;
  assertNoSourceValues(maskCreditText(JSON.stringify(receipt), landmarks.credit).text, receiptGuard, 'The public landmark receipt');

  // Every guard has passed: write the three files now, nothing earlier.
  if (geojsonText !== null && provenanceText !== null) {
    await mkdir(join(getStoreRoot(), 'out'), { recursive: true });
    await writeFile(join(getStoreRoot(), (outputs.geojson as { store_path: string }).store_path), geojsonText);
    await writeFile(join(getStoreRoot(), (outputs.provenance as { store_path: string }).store_path), provenanceText);
  }
  const receiptDir = options.receiptDir ?? join(docsRoot, 'gis', 'context');
  await writeJson(join(receiptDir, `${runId}.json`), receipt);
  return { ...receipt, store_paths: { geojson: outputs.geojson ?? null, provenance: outputs.provenance ?? null }, receipt_path: `docs/gis/context/${runId}.json` };
}
