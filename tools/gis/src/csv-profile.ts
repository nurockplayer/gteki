import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { getStoreRoot, getStoredSource, repoRoot } from './common.js';
import { buildContextWindow, type Disc, type WindowSpec } from './context-window.js';
import { geometryPaths, pathMeetsDiscs, polygonMeetsDiscs, type Point as FramePoint } from './window-geometry.js';
import { stationEnuProjector } from './station-enu.js';
import proj4 from 'proj4';
import { IX_PROJ } from './crs.js';
import { readZip } from './zip.js';

/**
 * Offline evidence profile of a municipal CSV or ZIP (`gis csv-profile`). It reports schema facts only: encoding, counts,
 * column names, a declared CRS column and its distinct values, the lon/lat bbox, station-window counts and an axis-swap
 * check. No row value is returned: a column whose header is long (free text) is described, never quoted, and a CRS
 * column's values are listed only while they are few and short.
 */

export type StationWindow = { station: string; origin: { lat: number; lon: number }; discs: Disc[]; origin_radius_m: number; basis: string };
export type WindowCounts = { station: string; in_window: number; in_origin_disc: number; within_500m_of_origin: number; within_1000m_of_origin: number; in_window_if_axes_swapped: number };
export type CsvProfile = {
  kind: 'csv';
  encoding: 'UTF-8' | 'UTF-8 (BOM)' | 'UTF-16LE (BOM)' | 'UTF-16BE (BOM)' | 'Shift_JIS' | 'OOXML workbook (xlsx)';
  delimiter: 'comma' | 'tab' | 'n/a';
  rows: number;
  ragged_rows: number;
  columns: string[];
  lat_columns: string[];
  lon_columns: string[];
  crs_columns: string[];
  crs_values: Array<{ column: string; distinct: number; values: Array<{ value: string; rows: number }> | null }>;
  coordinates: { used_lat: string | null; used_lon: string | null; valid_rows: number; blank_rows: number; invalid_rows: number; bbox: { lon_min: number; lat_min: number; lon_max: number; lat_max: number } | null };
  axis_swap: { verdict: 'NO_COORDINATES' | 'NOT_SWAPPED' | 'SWAPPED' | 'MIXED' | 'INDETERMINATE'; as_is_in_japan: number; swapped_in_japan: number; as_is_in_tokyo_box: number };
  windows: WindowCounts[];
};
export type ZipMember = { extension: string; bytes: number; format: string; detail: Record<string, unknown> | null };
export type ZipProfile = { kind: 'zip'; members: ZipMember[]; vector_members: number; holds_vector_data: boolean | 'UNKNOWN'; coordinate_tables: number; formats: Record<string, number> };
export type Profile = CsvProfile | ZipProfile;

const LAT = /緯度|^lat(itude)?$/iu;
const LON = /経度|^lon(g|gitude)?$|^lng$/iu;
const CRS = /座標系|測地系|座標参照|^crs\b|epsg|coordinate.?system|spatial.?ref/iu;
const MAX_NAME = 40;
const MAX_CRS_VALUES = 8;
const MAX_CRS_VALUE_LENGTH = 60;
export const TOKYO_BOX = { latMin: 35.4, latMax: 35.95, lonMin: 138.9, lonMax: 140.0 };
const JAPAN_BOX = { latMin: 20, latMax: 46, lonMin: 122, lonMax: 154 };

export function decodeCsvBytes(buffer: Buffer): { text: string; encoding: CsvProfile['encoding'] } {
  const bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return { text: new TextDecoder('utf-16le', { fatal: true }).decode(buffer.subarray(2)), encoding: 'UTF-16LE (BOM)' };
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return { text: new TextDecoder('utf-16be', { fatal: true }).decode(buffer.subarray(2)), encoding: 'UTF-16BE (BOM)' };
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bom ? buffer.subarray(3) : buffer), encoding: bom ? 'UTF-8 (BOM)' : 'UTF-8' }; } catch { /* try Shift_JIS */ }
  try { return { text: new TextDecoder('shift_jis', { fatal: true }).decode(buffer), encoding: 'Shift_JIS' }; } catch { /* fall through */ }
  throw new Error('Input is neither valid UTF-8 nor Shift_JIS');
}

/** A header is quoted only when it is a short plain schema name; anything longer is a free-text value and is described. */
export function safeColumnName(name: string, index: number): string {
  const trimmed = name.trim();
  if (trimmed === '') return `(column ${index + 1}: blank header)`;
  if (trimmed.length > MAX_NAME) return `(column ${index + 1}: free-text header of ${trimmed.length} characters)`;
  return trimmed;
}

const inBox = (lat: number, lon: number, b: { latMin: number; latMax: number; lonMin: number; lonMax: number }): boolean => lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;

/** `profile.window` (evidence-profile selection only): the director's single origin disc, independent of the building window. */
export type ProfileWindow = { kind: 'origin_disc'; radius_m: number };
export type ContextConfig = { radius_m?: number; window?: WindowSpec; profile?: { window?: ProfileWindow }; status?: string };

/** The profile selection window from a context config: `profile.window` when present, else the building window spec. */
export function profileWindowSpec(config: ContextConfig): { spec: WindowSpec; basis: string } {
  const profile = config.profile?.window;
  if (profile) {
    if (profile.kind !== 'origin_disc') throw new Error(`profile.window.kind must be origin_disc, got ${JSON.stringify(profile.kind)}`);
    return { spec: { r_origin_m: profile.radius_m, r_exit_m: 0 }, basis: `profile config window: ${profile.radius_m} m origin disc only (director decision; the same radius as the context overlay clip)` };
  }
  const spec: WindowSpec = config.window ?? { r_origin_m: config.radius_m ?? 250, r_exit_m: 0 };
  return { spec, basis: config.window ? `context config window: ${spec.r_origin_m} m origin disc plus ${spec.r_exit_m} m exit discs` : `context config radius ${spec.r_origin_m} m origin disc only (no window spec; status ${config.status ?? 'unknown'})` };
}

/** Station windows: tools/gis/sources/context/<station>.json and stations/<id>/gteki/station.json origin. */
export async function loadStationWindows(stations: string[] = ['ikebukuro', 'shinjuku']): Promise<StationWindow[]> {
  const out: StationWindow[] = [];
  for (const station of stations) {
    const config = JSON.parse(await readFile(join(repoRoot, 'tools/gis/sources/context', `${station}.json`), 'utf8')) as ContextConfig;
    const manifest = JSON.parse(await readFile(join(repoRoot, 'stations', station, 'gteki/station.json'), 'utf8')) as { station?: { origin?: { lat?: number; lon?: number } } };
    const origin = manifest.station?.origin;
    if (!origin || typeof origin.lat !== 'number' || typeof origin.lon !== 'number') throw new Error(`stations/${station}/gteki/station.json has no origin`);
    const { spec, basis } = profileWindowSpec(config);
    const built = await buildContextWindow(spec, { stationId: station });
    out.push({ station, origin: { lat: origin.lat, lon: origin.lon }, discs: built.discs, origin_radius_m: spec.r_origin_m,
      basis: config.profile?.window ? basis : config.window ? `${basis} (${built.discs.length - 1} graph nodes)` : basis });
  }
  return out;
}

function windowCounts(points: Array<[number, number]>, windows: StationWindow[]): WindowCounts[] {
  return windows.map((w) => {
    const project = stationEnuProjector({ lat: w.origin.lat, lon: w.origin.lon, hM: 0 });
    const hit = (lat: number, lon: number, originOnly: boolean): boolean => {
      if (!inBox(lat, lon, JAPAN_BOX)) return false;
      const [x, y] = project(lat, lon, 0);
      return w.discs.some((d) => (!originOnly || d.origin === 'origin') && Math.hypot(x - d.x, y - d.y) <= d.r);
    };
    let inWindow = 0, inOrigin = 0, swapped = 0, r500 = 0, r1000 = 0;
    for (const [lat, lon] of points) {
      if (inBox(lat, lon, JAPAN_BOX)) { const [x, y] = project(lat, lon, 0); const d = Math.hypot(x, y); if (d <= 500) r500++; if (d <= 1000) r1000++; }
      if (hit(lat, lon, false)) inWindow++;
      if (hit(lat, lon, true)) inOrigin++;
      if (hit(lon, lat, false)) swapped++;
    }
    return { station: w.station, in_window: inWindow, in_origin_disc: inOrigin, within_500m_of_origin: r500, within_1000m_of_origin: r1000, in_window_if_axes_swapped: swapped };
  });
}

export function profileCsv(buffer: Buffer, windows: StationWindow[]): CsvProfile {
  const { text, encoding } = decodeCsvBytes(buffer);
  const firstLine = text.split(/\r?\n/u, 1)[0] ?? '';
  const delimiter = (firstLine.match(/\t/gu)?.length ?? 0) > (firstLine.match(/,/gu)?.length ?? 0) ? 'tab' : 'comma';
  const records = parse(text, { relax_column_count: true, relax_quotes: true, skip_empty_lines: true, delimiter: delimiter === 'tab' ? '\t' : ',' }) as string[][];
  return profileTable(records, encoding, delimiter, windows);
}

/** Reads the first worksheet of an OOXML workbook into rows of strings (shared strings, inline strings and numbers only). */
export function xlsxRecords(entries: Array<{ name: string; data: Buffer }>): string[][] {
  const get = (n: string): string | undefined => entries.find((e) => e.name === n)?.data.toString('utf8');
  const unescape = (t: string): string => t.replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&amp;/gu, '&');
  const shared = [...(get('xl/sharedStrings.xml') ?? '').matchAll(/<si[^>]*>([\s\S]*?)<\/si>/gu)].map((m) => unescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/gu)].map((t) => t[1]).join('')));
  const sheetName = entries.map((e) => e.name).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(n)).sort()[0];
  const sheet = sheetName ? get(sheetName) : undefined;
  if (!sheet) throw new Error('OOXML workbook has no worksheet');
  const rows: string[][] = [];
  for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gu)) {
    const cells: string[] = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
      const ref = /\br="([A-Z]+)\d+"/u.exec(c[1])?.[1] ?? '';
      const col = [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const type = /\bt="([^"]+)"/u.exec(c[1])?.[1];
      const body = c[2] ?? '';
      let value = '';
      if (type === 's') value = shared[Number(/<v>([\s\S]*?)<\/v>/u.exec(body)?.[1])] ?? '';
      else if (type === 'inlineStr') value = unescape([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/gu)].map((t) => t[1]).join(''));
      else value = unescape(/<v>([\s\S]*?)<\/v>/u.exec(body)?.[1] ?? '');
      if (col >= 0) { while (cells.length < col) cells.push(''); cells[col] = value; }
    }
    rows.push(cells);
  }
  return rows;
}

export function profileTable(records: string[][], encoding: CsvProfile['encoding'], delimiter: CsvProfile['delimiter'], windows: StationWindow[]): CsvProfile {
  if (records.length === 0) throw new Error('CSV has no header row');
  const header = records[0].map((h) => h.replace(/^﻿/u, ''));
  const data = records.slice(1);
  const columns = header.map(safeColumnName);
  const idx = (re: RegExp): number[] => header.flatMap((h, i) => (re.test(h.trim()) ? [i] : []));
  const latIdx = idx(LAT), lonIdx = idx(LON), crsIdx = idx(CRS);
  const crsValues = crsIdx.map((i) => {
    const counts = new Map<string, number>();
    for (const row of data) { const v = (row[i] ?? '').trim(); if (v !== '') counts.set(v, (counts.get(v) ?? 0) + 1); }
    const listable = counts.size <= MAX_CRS_VALUES && [...counts.keys()].every((v) => v.length <= MAX_CRS_VALUE_LENGTH);
    return { column: columns[i], distinct: counts.size, values: listable ? [...counts].map(([value, rows]) => ({ value, rows })).sort((a, b) => b.rows - a.rows) : null };
  });
  const li = latIdx[0], oi = lonIdx[0];
  const points: Array<[number, number]> = [];
  let blank = 0, invalid = 0;
  if (li !== undefined && oi !== undefined) {
    for (const row of data) {
      const a = (row[li] ?? '').trim(), b = (row[oi] ?? '').trim();
      if (a === '' || b === '') { blank++; continue; }
      const lat = Number(a), lon = Number(b);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) { invalid++; continue; }
      points.push([lat, lon]);
    }
  }
  const bbox = points.length ? { lon_min: Math.min(...points.map((p) => p[1])), lat_min: Math.min(...points.map((p) => p[0])), lon_max: Math.max(...points.map((p) => p[1])), lat_max: Math.max(...points.map((p) => p[0])) } : null;
  const asIs = points.filter(([lat, lon]) => inBox(lat, lon, JAPAN_BOX)).length;
  const swapped = points.filter(([lat, lon]) => !inBox(lat, lon, JAPAN_BOX) && inBox(lon, lat, JAPAN_BOX)).length;
  const tokyo = points.filter(([lat, lon]) => inBox(lat, lon, TOKYO_BOX)).length;
  let verdict: CsvProfile['axis_swap']['verdict'];
  if (points.length === 0) verdict = 'NO_COORDINATES';
  else if (asIs / points.length >= 0.9) verdict = 'NOT_SWAPPED';
  else if (swapped / points.length >= 0.9) verdict = 'SWAPPED';
  else if (asIs > 0 && swapped > 0) verdict = 'MIXED';
  else verdict = 'INDETERMINATE';
  // Window counts use the as-is order unless the whole file is swapped; the swapped count is always reported next to it.
  return {
    kind: 'csv', encoding, delimiter, rows: data.length, ragged_rows: data.filter((r) => (delimiter === 'n/a' ? r.length > header.length : r.length !== header.length)).length, columns,
    lat_columns: latIdx.map((i) => columns[i]), lon_columns: lonIdx.map((i) => columns[i]), crs_columns: crsIdx.map((i) => columns[i]), crs_values: crsValues,
    coordinates: { used_lat: li === undefined ? null : columns[li], used_lon: oi === undefined ? null : columns[oi], valid_rows: points.length, blank_rows: blank, invalid_rows: invalid, bbox },
    axis_swap: { verdict, as_is_in_japan: asIs, swapped_in_japan: swapped, as_is_in_tokyo_box: tokyo },
    windows: windowCounts(points, windows),
  };
}

// ---- ZIP members -------------------------------------------------------------------------------------------------

const VECTOR = new Set(['shp', 'geojson', 'json-geo', 'gml', 'gpkg', 'kml']);
function formatOf(name: string, data: Buffer): string {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  if (ext === 'json' || ext === 'geojson') {
    try { const j = JSON.parse(data.toString('utf8')) as { type?: string }; return typeof j.type === 'string' && /^(FeatureCollection|Feature|GeometryCollection|Point|LineString|Polygon|Multi)/u.test(j.type) ? 'geojson' : 'json'; } catch { return 'json-unparsed'; }
  }
  if (['shp', 'dbf', 'shx', 'prj', 'cpg', 'csv', 'pdf', 'gml', 'kml', 'gpkg', 'xml', 'txt', 'xlsx', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'dxf'].includes(ext)) return ext;
  return ext === '' ? 'no-extension' : `other(${ext})`;
}

function visit(coords: unknown, fn: (lon: number, lat: number) => void): void {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') { fn(coords[0], coords[1]); return; }
  for (const c of coords) visit(c, fn);
}

export function geojsonDetail(data: Buffer, windows: StationWindow[]): Record<string, unknown> {
  const doc = JSON.parse(data.toString('utf8')) as { type?: string; features?: Array<{ geometry?: { type?: string; coordinates?: unknown } | null }>; crs?: { properties?: { name?: string } } };
  const features = doc.type === 'FeatureCollection' && Array.isArray(doc.features) ? doc.features : [];
  const types: Record<string, number> = {};
  // Segment- and containment-based: a road crossing a disc with both endpoints outside, or a polygon
  // enclosing a disc, still touches it (vertex inclusion alone missed both).
  const perWindow = windows.map((w) => {
    const project = stationEnuProjector({ lat: w.origin.lat, lon: w.origin.lon, hM: 0 });
    return { w, discs: w.discs, toFrame: (lon: number, lat: number): FramePoint => { const [x, y] = project(lat, lon, 0); return [x, y]; }, n: 0 };
  });
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity, swapped = 0, asIs = 0;
  for (const f of features) {
    const t = f.geometry?.type ?? 'null';
    types[t] = (types[t] ?? 0) + 1;
    let asIsVertices = 0;
    const hits = new Set<number>();
    visit(f.geometry?.coordinates, (lon, lat) => {
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      if (inBox(lat, lon, JAPAN_BOX)) { asIs++; asIsVertices++; } else if (inBox(lon, lat, JAPAN_BOX)) swapped++;
    });
    if (asIsVertices > 0) {
      const paths = geometryPaths(f.geometry);
      perWindow.forEach((p, i) => {
        if (paths.lines.some((line) => pathMeetsDiscs(line.map(([lon, lat]) => p.toFrame(lon, lat)), p.discs))) hits.add(i);
        else if (paths.polygons.some((rings) => polygonMeetsDiscs(rings.map((ring) => ring.map(([lon, lat]) => p.toFrame(lon, lat))), p.discs))) hits.add(i);
      });
    }
    hits.forEach((i) => { perWindow[i].n++; });
  }
  return { features: features.length, geometry_types: types, declared_crs_member: doc.crs?.properties?.name ?? null,
    bbox: Number.isFinite(minLon) ? { lon_min: minLon, lat_min: minLat, lon_max: maxLon, lat_max: maxLat } : null, vertices_as_is_in_japan: asIs, vertices_swapped_in_japan: swapped,
    features_touching_window: Object.fromEntries(perWindow.map((p) => [p.w.station, p.n])) };
}

export function shpDetail(data: Buffer, prjText: string | null, windows: StationWindow[]): Record<string, unknown> {
  if (data.length < 100 || data.readInt32BE(0) !== 9994) return { header: 'not a shapefile header' };
  const shapeType = data.readInt32LE(32);
  const base: Record<string, unknown> = { shape_type_code: shapeType, bbox_native: { x_min: data.readDoubleLE(36), y_min: data.readDoubleLE(44), x_max: data.readDoubleLE(52), y_max: data.readDoubleLE(60) } };
  const geographic = prjText !== null && /^GEOGCS|^GEOGCRS/u.test(prjText.trim());
  const zone9 = prjText !== null && /Zone_?9|Zone_IX|zone 9/iu.test(prjText);
  if (!geographic && !zone9) return { ...base, window_evaluation: 'not evaluated: CRS is not geographic and not Japan Plane Rectangular zone IX' };
  const toLonLat = (x: number, y: number): [number, number] => (geographic ? [x, y] : (proj4(IX_PROJ, '+proj=longlat +ellps=GRS80 +no_defs', [x, y]) as [number, number]));
  // Segment- and containment-based, like GeoJSON: a polyline crossing a disc with both endpoints outside
  // still counts, and a polygon ring that encloses a disc counts too. Rings are kept per part, so no
  // segment is invented between parts.
  const perWindow = windows.map((w) => {
    const project = stationEnuProjector({ lat: w.origin.lat, lon: w.origin.lon, hM: 0 });
    return { w, discs: w.discs, toFrame: (lon: number, lat: number): FramePoint => { const [x, y] = project(lat, lon, 0); return [x, y]; }, n: 0 };
  });
  const areal = [5, 15, 25].includes(shapeType);
  const point = [1, 11, 21].includes(shapeType), multipoint = [8, 18, 28].includes(shapeType);
  let records = 0, minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  if (point || multipoint || [3, 5, 13, 15, 23, 25].includes(shapeType)) {
    for (let o = 100; o + 8 <= data.length;) {
      const length = data.readUInt32BE(o + 4) * 2;
      const rec = o + 8;
      if (rec + length > data.length) break;
      if (length < 4 || data.readInt32LE(rec) === 0 || length < (point ? 20 : multipoint ? 40 : 44)) { o = rec + length; continue; }
      const numParts = point || multipoint ? 0 : data.readInt32LE(rec + 36);
      const numPoints = point ? 1 : data.readInt32LE(rec + (multipoint ? 36 : 40));
      const pts = point ? rec + 4 : multipoint ? rec + 40 : rec + 44 + numParts * 4;
      if (numPoints < 0 || numParts < 0 || pts + numPoints * 16 > rec + length) { o = rec + length; continue; }
      const parts: number[] = [];
      for (let i = 0; i < numParts; i++) parts.push(data.readInt32LE(rec + 44 + i * 4));
      const points: Array<[number, number]> = [];
      for (let i = 0; i < numPoints && pts + i * 16 + 16 <= data.length; i++) {
        const [lon, lat] = toLonLat(data.readDoubleLE(pts + i * 16), data.readDoubleLE(pts + i * 16 + 8));
        minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
        points.push([lon, lat]);
      }
      const bounds = numParts ? [...parts, numPoints] : [0, numPoints];
      // Per-window frames differ, so build each path in its own frame from the geographic points.
      const geographic = point || multipoint ? points.map((p) => [p]) : bounds.slice(0, -1).map((start, k) => points.slice(start, bounds[k + 1]));
      perWindow.forEach((p, k) => {
        const rings = geographic.map((path) => path.map(([lon, lat]) => p.toFrame(lon, lat)));
        const hit = areal ? polygonMeetsDiscs(rings, p.discs) : rings.some((ring) => pathMeetsDiscs(ring, p.discs));
        if (hit) p.n++;
      });
      records++;
      o = rec + length;
    }
  } else return { ...base, window_evaluation: 'not evaluated: shape type is not a point, multipoint, polyline or polygon' };
  return { ...base, crs_interpretation: geographic ? 'geographic longitude/latitude' : 'Japan Plane Rectangular zone IX (EPSG:6677 parameters)', records_read: records,
    bbox_lonlat: Number.isFinite(minLon) ? { lon_min: minLon, lat_min: minLat, lon_max: maxLon, lat_max: maxLat } : null, records_touching_window: Object.fromEntries(perWindow.map((p) => [p.w.station, p.n])) };
}

function dbfDetail(data: Buffer): Record<string, unknown> {
  if (data.length < 33) return { header: 'too short' };
  const records = data.readUInt32LE(4), headerLength = data.readUInt16LE(8);
  const fields: string[] = [];
  for (let o = 32; o + 32 <= headerLength && data[o] !== 0x0d; o += 32) {
    const raw = data.subarray(o, o + 11);
    const end = raw.indexOf(0);
    let name: string;
    try { name = new TextDecoder('shift_jis', { fatal: true }).decode(end < 0 ? raw : raw.subarray(0, end)); } catch { name = raw.toString('latin1').replace(/\0.*$/u, ''); }
    fields.push(name);
  }
  return { records, field_count: fields.length, field_names: fields.map((f, i) => safeColumnName(f, i)) };
}

export async function profileZip(path: string, windows: StationWindow[]): Promise<ZipProfile> {
  const entries = await readZip(path, { maxEntryBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 });
  const members: ZipMember[] = [];
  const prjOf = (name: string): string | null => { const prj = entries.find((x) => x.name.replace(/\.prj$/iu, '') === name.replace(/\.shp$/iu, '') && /\.prj$/iu.test(x.name)); return prj ? prj.data.toString('utf8') : null; };
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;
    const format = formatOf(e.name, e.data);
    let detail: Record<string, unknown> | null = null;
    try {
      if (format === 'geojson') detail = geojsonDetail(e.data, windows);
      else if (format === 'shp') detail = shpDetail(e.data, prjOf(e.name), windows);
      else if (format === 'dbf') detail = dbfDetail(e.data);
      else if (format === 'csv') { const p = profileCsv(e.data, windows); detail = { profile: p }; }
      else if (format === 'prj') { const m = /^(?:PROJCS|GEOGCS|GEOGCRS|PROJCRS)\["([^"]{1,80})"/u.exec(e.data.toString('utf8')); detail = { crs_name: m ? m[1] : null }; }
    } catch (error) { detail = { error: error instanceof Error ? error.message : String(error) }; }
    members.push({ extension: (e.name.split('.').pop() ?? '').toLowerCase(), bytes: e.data.length, format, detail });
  }
  const formats: Record<string, number> = {};
  for (const m of members) formats[m.format] = (formats[m.format] ?? 0) + 1;
  const vector = members.filter((m) => VECTOR.has(m.format) || (m.format === 'geojson')).length;
  return { kind: 'zip', members, vector_members: vector, holds_vector_data: vector > 0 ? true : members.length > 0 ? false : 'UNKNOWN', coordinate_tables: members.filter((m) => m.format === 'csv' && (m.detail?.profile as CsvProfile | undefined)?.coordinates.valid_rows).length, formats };
}

// ---- Source lookup and verdict -----------------------------------------------------------------------------------

export type Spec = { source_id: string; doc_id: string | null };
export const parseSpec = (spec: string): Spec => { const [source_id, doc_id] = spec.split(':'); return { source_id, doc_id: doc_id ?? null }; };

async function storedFile(spec: Spec): Promise<{ path: string; bytes: number; sha256: string; record: Awaited<ReturnType<typeof getStoredSource>>['record'] }> {
  const { record, path } = await getStoredSource(spec.source_id);
  if (spec.doc_id === null) return { path, bytes: record.bytes, sha256: record.sha256, record };
  const doc = record.supporting_documents?.find((d) => d.id === spec.doc_id);
  if (!doc) throw new Error(`${spec.source_id} has no supporting document ${spec.doc_id}`);
  return { path: join(getStoreRoot(), doc.store_path), bytes: doc.bytes, sha256: doc.sha256, record };
}

export type PackageFacts = { license_id: string | null; resource_licenses: Array<string | null>; resources: number; terms_sha256: string | null; terms_bytes: number | null; terms_states_cc_by_4_0: boolean | null; terms_is_closure_notice: boolean | null; terms_has_exclusion_note_clause: boolean | null };

export async function packageFacts(sourceId: string): Promise<PackageFacts | null> {
  const { record } = await getStoredSource(sourceId);
  const pkg = record.supporting_documents?.find((d) => d.id === 'package-show') ?? (/package_show/u.test(record.resolved_url) ? { store_path: record.store_path } : undefined);
  if (!pkg) return null;
  const json = JSON.parse(await readFile(join(getStoreRoot(), pkg.store_path), 'utf8')) as { result?: { license_id?: string; resources?: Array<{ license?: string | null }> } };
  const resources = json.result?.resources ?? [];
  const terms = record.supporting_documents?.find((d) => d.id === 'portal-terms');
  let cc: boolean | null = null, closure: boolean | null = null, note: boolean | null = null;
  if (terms) {
    const text = (await readFile(join(getStoreRoot(), terms.store_path))).toString('utf8');
    cc = /クリエイティブ・コモンズ・ライセンス\s*表示\s*4\.0/u.test(text);
    closure = text.length < 5000 && /閉鎖|しばらくお待ち|closed/iu.test(text);
    note = /「注」があるものを除いて/u.test(text);
  }
  return { license_id: json.result?.license_id ?? null, resource_licenses: resources.map((r) => r.license ?? null), resources: resources.length, terms_sha256: terms?.sha256 ?? null, terms_bytes: terms?.bytes ?? null, terms_states_cc_by_4_0: cc, terms_is_closure_notice: closure, terms_has_exclusion_note_clause: note };
}

export type Verdict = { verdict: 'CLEAN_CANDIDATE' | 'NOT_CLEAN' | 'UNKNOWN'; reasons: string[] };

/** Rule from the reassessment note section 7.5 (items 5) and 4.5/4.6. Every verdict stays evidence-only (publish gate HOLD). */
export function verdictFor(profile: Profile | null, pkg: PackageFacts | null, options: { crsDeclared?: boolean } = {}): Verdict {
  const reasons: string[] = [];
  if (!profile) return { verdict: 'UNKNOWN', reasons: ['no readable data file'] };
  const ccBy = pkg?.license_id === 'CC-BY-4.0';
  if (!pkg) return { verdict: 'UNKNOWN', reasons: ['no package_show snapshot'] };
  // The section 7 rule is a CC BY 4.0 rule. Any other dataset licence label is outside it: nothing is decided here.
  if (!ccBy) return { verdict: 'UNKNOWN', reasons: [`dataset licence label is ${pkg.license_id ?? 'absent'}, outside the CC BY 4.0 rule; the resource licence field is ${pkg.resource_licenses.length && pkg.resource_licenses.every((l) => l === null) ? 'null' : 'not all null'}; not assessed by this rule`] };
  // CLEAN_CANDIDATE needs the portal terms to state CC BY 4.0 affirmatively; an absent snapshot or an
  // unread terms page leaves the licence half-established, which is UNKNOWN, not a clean candidate.
  if (pkg.terms_sha256 === null) return { verdict: 'UNKNOWN', reasons: ['no portal-terms supporting document in the snapshot; CC BY 4.0 is not affirmatively established by the terms'] };
  if (pkg.terms_states_cc_by_4_0 === null) return { verdict: 'UNKNOWN', reasons: ['the portal-terms snapshot does not state CC BY 4.0; the licence is not affirmatively established by the terms'] };
  if (pkg.terms_is_closure_notice) reasons.push('portal terms snapshot is a closure notice');
  else if (pkg.terms_states_cc_by_4_0 === false) reasons.push('portal terms snapshot does not state CC BY 4.0');
  if (profile.kind === 'zip') {
    if (!profile.holds_vector_data) reasons.push(profile.coordinate_tables ? 'ZIP holds no vector files (coordinate tables only)' : 'ZIP holds no vector data');
    let touching = 0, crsKnown = false;
    for (const m of profile.members) {
      const d = m.detail as Record<string, unknown> | null;
      if (!d) continue;
      const hits = (d.records_touching_window ?? d.features_touching_window) as Record<string, number> | undefined;
      if (hits) touching += Object.values(hits).reduce((n, v) => n + v, 0);
      const csv = d.profile as CsvProfile | undefined;
      if (csv) touching += csv.windows.reduce((n, w) => n + w.in_window, 0);
      if (m.format === 'prj' && typeof d.crs_name === 'string') crsKnown = true;
      if (m.format === 'geojson' && d.declared_crs_member) crsKnown = true;
    }
    if (profile.holds_vector_data && touching === 0) reasons.push('no feature touches any station window');
    if (reasons.length) return { verdict: 'NOT_CLEAN', reasons };
    return { verdict: 'CLEAN_CANDIDATE', reasons: [`dataset-level CC BY 4.0 in the snapshot and terms; vector members present; ${crsKnown ? 'CRS declared by a member' : 'no CRS declared (bbox sanity only)'}; ${touching} feature(s)/row(s) touch a window`] };
  }
  if (profile.coordinates.valid_rows === 0) reasons.push(profile.lat_columns.length && profile.lon_columns.length ? 'lat/lon columns present but no valid coordinate rows' : 'no lat/lon columns');
  else {
    if (profile.axis_swap.verdict !== 'NOT_SWAPPED') reasons.push(`axis check ${profile.axis_swap.verdict}`);
    if (!options.crsDeclared && profile.axis_swap.as_is_in_tokyo_box === 0) reasons.push('no CRS stated and bbox sanity check fails');
    if (profile.windows.every((w) => w.in_window === 0 && (profile.axis_swap.verdict !== 'SWAPPED' || w.in_window_if_axes_swapped === 0))) reasons.push(profile.axis_swap.verdict === 'SWAPPED' ? 'no row inside any station window, as labelled or with the columns swapped' : 'no row inside any station window');
  }
  if (reasons.length === 0) return { verdict: 'CLEAN_CANDIDATE', reasons: ['dataset-level CC BY 4.0 in the snapshot and terms; lat/lon columns; bbox sanity passes (CRS value recorded as stated or UNKNOWN); window count above 0'] };
  return { verdict: 'NOT_CLEAN', reasons };
}

export async function profileSpec(specText: string, windows: StationWindow[]): Promise<{ spec: string; catalog_id: string | null; sha256: string; bytes: number; profile: Profile | null; error: string | null; package: PackageFacts | null; verdict: Verdict }> {
  const spec = parseSpec(specText);
  const file = await storedFile(spec);
  const pkg = await packageFacts(spec.source_id);
  const catalogId = /\/dataset\/(t\d+d\d+)/u.exec((await getStoredSource(spec.source_id)).source.official_url)?.[1] ?? null;
  let profile: Profile | null = null, error: string | null = null;
  try {
    const bytes = await readFile(file.path);
    if (bytes.subarray(0, 2).toString('latin1') === 'PK') {
      const entries = await readZip(file.path, { maxEntryBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 });
      profile = entries.some((e) => e.name === '[Content_Types].xml') && entries.some((e) => e.name.startsWith('xl/'))
        ? profileTable(xlsxRecords(entries), 'OOXML workbook (xlsx)', 'n/a', windows)
        : await profileZip(file.path, windows);
    } else profile = profileCsv(bytes, windows);
  } catch (e) { error = e instanceof Error ? e.message : String(e); }
  const crsDeclared = profile?.kind === 'csv' && profile.crs_values.some((c) => c.distinct > 0);
  return { spec: specText, catalog_id: catalogId, sha256: file.sha256, bytes: file.bytes, profile, error, package: pkg, verdict: verdictFor(profile, pkg, { crsDeclared }) };
}
