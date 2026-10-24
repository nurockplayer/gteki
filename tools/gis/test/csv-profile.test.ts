import { describe, expect, it } from 'vitest';
import { decodeCsvBytes, geojsonDetail, loadStationWindows, profileCsv, safeColumnName, shpDetail, verdictFor, xlsxRecords, type StationWindow, type ZipProfile } from '../src/csv-profile.js';
import { renderProfileMarkdown } from '../src/csv-profile-md.js';

// Shift_JIS bytes: 名称 = 96 BC 8F CC, 緯度 = 88 DC 93 78, 経度 = 8C 6F 93 78.
const SJIS_NAME = Buffer.from([0x96, 0xbc, 0x8f, 0xcc]);
const SJIS_LAT = Buffer.from([0x88, 0xdc, 0x93, 0x78]);
const SJIS_LON = Buffer.from([0x8c, 0x6f, 0x93, 0x78]);
const sjisCsv = (rows: string[]): Buffer => Buffer.concat([SJIS_NAME, Buffer.from(','), SJIS_LAT, Buffer.from(','), SJIS_LON, Buffer.from('\r\n' + rows.join('\r\n') + '\r\n')]);

const STATION: StationWindow = { station: 'testville', origin: { lat: 35.7, lon: 139.7 }, discs: [{ x: 0, y: 0, r: 250, origin: 'origin', id: 'origin' }, { x: 1000, y: 0, r: 100, origin: 'node', id: 'exit-a' }], origin_radius_m: 250, basis: 'synthetic' };
// 0.001 degree of latitude is about 111 m; 0.0002 about 22 m.
const IN_ORIGIN = 'A,35.7002,139.7002';
const OUT = 'B,35.72,139.72';
const IN_EXIT_DISC = 'C,35.7,139.7118'; // about 1,070 m east of the origin: inside the 100 m disc around the node at x = 1000

function shapeBuffer(type: number, paths: Array<Array<[number, number]>>): Buffer {
  const points = paths.flat(), point = [1, 11, 21].includes(type), multipoint = [8, 18, 28].includes(type);
  const xyOffset = point ? 4 : multipoint ? 40 : 44 + paths.length * 4;
  const extra = point ? (type === 11 ? 16 : type === 21 ? 8 : 0) : (type > 10 ? (16 + points.length * 8) * (type < 20 ? 2 : 1) : 0);
  const content = Buffer.alloc(xyOffset + points.length * 16 + extra);
  content.writeInt32LE(type, 0);
  if (!point) {
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    content.writeDoubleLE(Math.min(...xs), 4); content.writeDoubleLE(Math.min(...ys), 12);
    content.writeDoubleLE(Math.max(...xs), 20); content.writeDoubleLE(Math.max(...ys), 28);
    if (multipoint) content.writeInt32LE(points.length, 36);
    else {
      content.writeInt32LE(paths.length, 36); content.writeInt32LE(points.length, 40);
      let start = 0;
      paths.forEach((path, i) => { content.writeInt32LE(start, 44 + i * 4); start += path.length; });
    }
  }
  points.forEach(([x, y], i) => { content.writeDoubleLE(x, xyOffset + i * 16); content.writeDoubleLE(y, xyOffset + i * 16 + 8); });
  const header = Buffer.alloc(100), record = Buffer.alloc(8);
  header.writeInt32BE(9994, 0); header.writeInt32BE((108 + content.length) / 2, 24);
  header.writeInt32LE(1000, 28); header.writeInt32LE(type, 32);
  record.writeInt32BE(1, 0); record.writeInt32BE(content.length / 2, 4);
  return Buffer.concat([header, record, content]);
}

describe('csv-profile', () => {
  it('decodes Shift_JIS, UTF-8 (with and without BOM) and UTF-16LE', () => {
    const sjis = decodeCsvBytes(sjisCsv(['x,1,2']));
    expect(sjis.encoding).toBe('Shift_JIS');
    expect(sjis.text.startsWith('名称,緯度,経度')).toBe(true);
    expect(decodeCsvBytes(Buffer.from('名称,緯度,経度\n')).encoding).toBe('UTF-8');
    expect(decodeCsvBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('名称,緯度,経度\n')])).encoding).toBe('UTF-8 (BOM)');
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('名称,緯度,経度\n', 'utf16le')]);
    const decoded = decodeCsvBytes(utf16);
    expect(decoded.encoding).toBe('UTF-16LE (BOM)');
    expect(decoded.text).toBe('名称,緯度,経度\n');
  });

  it('profiles a Shift_JIS file: rows, columns, lat/lon columns, bbox, no CRS column', () => {
    const p = profileCsv(sjisCsv([IN_ORIGIN, OUT, IN_EXIT_DISC]), [STATION]);
    expect(p.encoding).toBe('Shift_JIS');
    expect(p.rows).toBe(3);
    expect(p.columns).toEqual(['名称', '緯度', '経度']);
    expect(p.lat_columns).toEqual(['緯度']);
    expect(p.lon_columns).toEqual(['経度']);
    expect(p.crs_columns).toEqual([]);
    expect(p.coordinates).toMatchObject({ valid_rows: 3, blank_rows: 0, invalid_rows: 0 });
    expect(p.coordinates.bbox).toEqual({ lon_min: 139.7002, lat_min: 35.7, lon_max: 139.72, lat_max: 35.72 });
    expect(p.axis_swap.verdict).toBe('NOT_SWAPPED');
  });

  it('profiles a UTF-8 file with a tab delimiter, a CRS column and counts window membership', () => {
    const text = '名称\tlat\tlon\t座標参照系\nA\t35.7002\t139.7002\tJGD2011\nB\t35.72\t139.72\tJGD2011\nC\t35.7\t139.7118\t\n';
    const p = profileCsv(Buffer.from(text), [STATION]);
    expect(p.encoding).toBe('UTF-8');
    expect(p.delimiter).toBe('tab');
    expect(p.crs_columns).toEqual(['座標参照系']);
    expect(p.crs_values).toEqual([{ column: '座標参照系', distinct: 1, values: [{ value: 'JGD2011', rows: 2 }] }]);
    // A is inside the origin disc; C is only inside the exit-node disc; B is outside both.
    expect(p.windows).toEqual([{ station: 'testville', in_window: 2, in_origin_disc: 1, within_500m_of_origin: 1, within_1000m_of_origin: 1, in_window_if_axes_swapped: 0 }]);
  });

  it('profiles 200,000 CSV rows without spreading coordinates into call arguments', () => {
    const csv = Buffer.from('lat,lon\n' + '35.69,139.71\n35.71,139.69\n'.repeat(100_000));
    const p = profileCsv(csv, []);
    expect(p.rows).toBe(200_000);
    expect(p.coordinates).toMatchObject({ valid_rows: 200_000, blank_rows: 0, invalid_rows: 0 });
    expect(JSON.stringify(p.coordinates.bbox)).toBe('{"lon_min":139.69,"lat_min":35.69,"lon_max":139.71,"lat_max":35.71}');
    expect(p.axis_swap).toEqual({ verdict: 'NOT_SWAPPED', as_is_in_japan: 200_000, swapped_in_japan: 0, as_is_in_tokyo_box: 200_000 });
  });

  it('detects swapped axes: the latitude column holding longitudes', () => {
    const p = profileCsv(Buffer.from('name,lat,lon\nA,139.7002,35.7002\nB,139.72,35.72\n'), [STATION]);
    expect(p.axis_swap.verdict).toBe('SWAPPED');
    expect(p.axis_swap).toMatchObject({ as_is_in_japan: 0, swapped_in_japan: 2, as_is_in_tokyo_box: 0 });
    // The as-labelled count is 0; the count with the axes swapped finds the row at the origin.
    expect(p.windows[0]).toMatchObject({ in_window: 0, in_window_if_axes_swapped: 1 });
    const verdict = verdictFor(p, { license_id: 'CC-BY-4.0', resource_licenses: [null], resources: 1, terms_sha256: 'x', terms_bytes: 1, terms_states_cc_by_4_0: true, terms_is_closure_notice: false, terms_has_exclusion_note_clause: true });
    expect(verdict.verdict).toBe('NOT_CLEAN');
    expect(verdict.reasons.join(';')).toContain('SWAPPED');
  });

  it('reports blank coordinates and no-coordinate files without inventing a window count', () => {
    const blank = profileCsv(Buffer.from('name,緯度,経度\nA,,\nB,,\n'), [STATION]);
    expect(blank.coordinates).toMatchObject({ valid_rows: 0, blank_rows: 2 });
    expect(blank.axis_swap.verdict).toBe('NO_COORDINATES');
    const none = profileCsv(Buffer.from('name,depth\nA,1\n'), [STATION]);
    expect(none.lat_columns).toEqual([]);
    expect(none.windows[0].in_window).toBe(0);
  });

  it('gives CLEAN_CANDIDATE only with CC BY, valid non-swapped coordinates and a window count above 0', () => {
    const pkg = { license_id: 'CC-BY-4.0', resource_licenses: [null], resources: 1, terms_sha256: 'x', terms_bytes: 1, terms_states_cc_by_4_0: true, terms_is_closure_notice: false, terms_has_exclusion_note_clause: true };
    const inside = profileCsv(Buffer.from('name,lat,lon\nA,35.7002,139.7002\n'), [STATION]);
    expect(verdictFor(inside, pkg).verdict).toBe('CLEAN_CANDIDATE');
    const outside = profileCsv(Buffer.from('name,lat,lon\nB,35.72,139.72\n'), [STATION]);
    expect(verdictFor(outside, pkg).verdict).toBe('NOT_CLEAN');
    expect(verdictFor(inside, { ...pkg, license_id: 'pdl-jp-1.0' }).verdict).toBe('UNKNOWN');
    expect(verdictFor(inside, null).verdict).toBe('UNKNOWN');
    expect(verdictFor(inside, { ...pkg, terms_is_closure_notice: true }).verdict).toBe('NOT_CLEAN');
  });

  it('keeps the verdict UNKNOWN when the CC BY 4.0 portal-terms evidence is absent or silent', () => {
    const pkg = { license_id: 'CC-BY-4.0', resource_licenses: [null], resources: 1, terms_sha256: 'x', terms_bytes: 1, terms_states_cc_by_4_0: true, terms_is_closure_notice: false, terms_has_exclusion_note_clause: true };
    const inside = profileCsv(Buffer.from('name,lat,lon\nA,35.7002,139.7002\n'), [STATION]);
    // No portal-terms supporting document: the snapshot alone does not confirm the terms.
    const missing = verdictFor(inside, { ...pkg, terms_sha256: null, terms_bytes: null, terms_states_cc_by_4_0: null, terms_is_closure_notice: null });
    expect(missing.verdict).toBe('UNKNOWN');
    expect(missing.reasons.join(';')).toContain('portal-terms');
    // A terms page that does not state CC BY 4.0 is also not affirmative evidence.
    expect(verdictFor(inside, { ...pkg, terms_states_cc_by_4_0: null }).verdict).toBe('UNKNOWN');
    expect(verdictFor(inside, { ...pkg, terms_states_cc_by_4_0: false }).verdict).toBe('NOT_CLEAN');
  });

  it('counts a standalone GeoJSON Feature or bare geometry like a one-feature collection', () => {
    const point = { type: 'Point', coordinates: [139.7002, 35.7002] };
    const wrapped = geojsonDetail(Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: point }] })), [STATION]);
    expect(geojsonDetail(Buffer.from(JSON.stringify({ type: 'Feature', geometry: point })), [STATION]).features_touching_window).toEqual(wrapped.features_touching_window);
    expect(geojsonDetail(Buffer.from(JSON.stringify(point)), [STATION]).features_touching_window).toEqual(wrapped.features_touching_window);
    expect(Object.values(wrapped.features_touching_window as Record<string, number>)).toEqual([1]);
    const collection = geojsonDetail(Buffer.from(JSON.stringify({ type: 'GeometryCollection', geometries: [point] })), [STATION]);
    expect(collection.features_touching_window).toBeUndefined();
    expect(collection.window_evaluation).toMatch(/^not evaluated/);
  });

  it.each(['shp', 'geojson'])('requires evaluated %s window hits for a ZIP verdict, independently of CSV rows', (format) => {
    const pkg = { license_id: 'CC-BY-4.0', resource_licenses: [null], resources: 1, terms_sha256: 'x', terms_bytes: 1, terms_states_cc_by_4_0: true, terms_is_closure_notice: false, terms_has_exclusion_note_clause: true };
    const csv = profileCsv(Buffer.from('name,lat,lon\nA,35.7002,139.7002\n'), [STATION]);
    const vectorDetail = (lon: number, lat: number): Record<string, unknown> => format === 'shp'
      ? shpDetail(shapeBuffer(1, [[[lon, lat]]]), 'GEOGCS["JGD2011"]', [STATION])
      : geojsonDetail(Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] } }] })), [STATION]);
    const zip: ZipProfile = { kind: 'zip', members: [
      { extension: format, bytes: 10, format, detail: vectorDetail(139.72, 35.72) },
      { extension: 'csv', bytes: 10, format: 'csv', detail: { profile: csv } },
    ], vector_members: 1, holds_vector_data: true, coordinate_tables: 1, formats: { [format]: 1, csv: 1 } };
    const outside = verdictFor(zip, pkg);
    expect(outside.verdict).toBe('NOT_CLEAN');
    expect(outside.reasons.join(';')).toContain('0 vector feature(s) touch a window; 1 coordinate-table row(s) in window');
    zip.members[0].detail = vectorDetail(139.7002, 35.7002);
    const inside = verdictFor(zip, pkg);
    expect(inside.verdict).toBe('CLEAN_CANDIDATE');
    expect(inside.reasons.join(';')).toContain('1 vector feature(s) touch a window; 1 coordinate-table row(s) in window');
    zip.members.pop();
    zip.coordinate_tables = 0;
    delete zip.formats.csv;
    expect(verdictFor(zip, pkg).verdict).toBe('CLEAN_CANDIDATE');
  });

  it.each([
    null,
    { error: 'unreadable vector member' },
    shpDetail(shapeBuffer(1, [[[139.7002, 35.7002]]]), null, [STATION]),
  ])('keeps a ZIP UNKNOWN when its vector member is unevaluated despite CSV hits (%j)', (detail) => {
    const pkg = { license_id: 'CC-BY-4.0', resource_licenses: [null], resources: 1, terms_sha256: 'x', terms_bytes: 1, terms_states_cc_by_4_0: true, terms_is_closure_notice: false, terms_has_exclusion_note_clause: true };
    const csv = profileCsv(Buffer.from('lat,lon\n35.7002,139.7002\n'), [STATION]);
    const zip: ZipProfile = { kind: 'zip', members: [
      { extension: 'shp', bytes: 10, format: 'shp', detail },
      { extension: 'csv', bytes: 10, format: 'csv', detail: { profile: csv } },
    ], vector_members: 1, holds_vector_data: true, coordinate_tables: 1, formats: { shp: 1, csv: 1 } };
    const result = verdictFor(zip, pkg);
    expect(result.verdict).toBe('UNKNOWN');
    expect(result.reasons).toContain('no vector member was evaluated for station windows');
    expect(result.reasons.join(';')).toContain('0 vector feature(s) touch a window; 1 coordinate-table row(s) in window');
  });

  it('counts a GeoJSON segment crossing a disc and a polygon enclosing one', () => {
    // Both endpoints of the line are ~1 km from the origin, but the segment passes through the 250 m disc.
    const crossing = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[139.69, 35.7], [139.71, 35.7]] } }] }));
    expect(geojsonDetail(crossing, [STATION]).features_touching_window).toEqual({ testville: 1 });
    // Every edge of this box is about 500 m from the origin, and the disc (r 250 m) lies wholly inside it.
    const enclosing = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[139.695, 35.695], [139.705, 35.695], [139.705, 35.705], [139.695, 35.705], [139.695, 35.695]]] } }] }));
    expect(geojsonDetail(enclosing, [STATION]).features_touching_window).toEqual({ testville: 1 });
    // A feature far away is not counted.
    const far = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[139.60, 35.60], [139.61, 35.61]] } }] }));
    expect(geojsonDetail(far, [STATION]).features_touching_window).toEqual({ testville: 0 });
  });

  it('walks a Feature GeometryCollection line crossing a disc and includes member bounds', () => {
    const geometry = { type: 'GeometryCollection', geometries: [
      { type: 'LineString', coordinates: [[139.69, 35.7], [139.71, 35.7]] },
      { type: 'Point', coordinates: [139.72, 35.72] },
    ] };
    const detail = geojsonDetail(Buffer.from(JSON.stringify({ type: 'Feature', geometry })), [STATION]);
    expect(detail).toMatchObject({
      features: 1, geometry_types: { GeometryCollection: 1 },
      bbox: { lon_min: 139.69, lat_min: 35.7, lon_max: 139.72, lat_max: 35.72 },
      vertices_as_is_in_japan: 3, vertices_swapped_in_japan: 0,
      features_touching_window: { testville: 1 },
    });
  });

  it('walks two collection levels to a polygon enclosing a disc', () => {
    const geometry = { type: 'GeometryCollection', geometries: [{ type: 'GeometryCollection', geometries: [
      { type: 'Polygon', coordinates: [[[139.695, 35.695], [139.705, 35.695], [139.705, 35.705], [139.695, 35.705], [139.695, 35.695]]] },
    ] }] };
    const detail = geojsonDetail(Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry }] })), [STATION]);
    expect(detail).toMatchObject({
      bbox: { lon_min: 139.695, lat_min: 35.695, lon_max: 139.705, lat_max: 35.705 },
      vertices_as_is_in_japan: 5, features_touching_window: { testville: 1 },
    });
  });

  it('counts nested points and swapped vertices once per Feature without joining members', () => {
    const windows = [{ ...STATION, discs: [STATION.discs[0]] }];
    const profile = (coordinates: number[][]): Record<string, unknown> => geojsonDetail(Buffer.from(JSON.stringify({
      type: 'Feature', geometry: { type: 'GeometryCollection', geometries: [{ type: 'GeometryCollection',
        geometries: coordinates.map((point) => ({ type: 'Point', coordinates: point })),
      }] },
    })), windows);
    expect(profile([[139.69, 35.7], [139.71, 35.7]]).features_touching_window).toEqual({ testville: 0 });
    expect(profile([[139.7, 35.7], [139.7001, 35.7], [35.7, 139.7]])).toMatchObject({
      vertices_as_is_in_japan: 2, vertices_swapped_in_japan: 1, features_touching_window: { testville: 1 },
    });
  });

  it('evaluates 32 collection levels and marks deeper features unevaluated without partial results', () => {
    type Geometry = { type: string; coordinates?: number[]; geometries?: Geometry[] };
    const point: Geometry = { type: 'Point', coordinates: [139.7, 35.7] };
    const nested = (levels: number): Geometry => {
      let geometry = point;
      for (let i = 0; i < levels; i++) geometry = { type: 'GeometryCollection', geometries: [point, geometry] };
      return geometry;
    };
    const profile = (geometry: Geometry): Record<string, unknown> => geojsonDetail(Buffer.from(JSON.stringify({ type: 'Feature', geometry })), [STATION]);
    const atLimit = profile(nested(32));
    expect(atLimit.features_touching_window).toEqual({ testville: 1 });
    expect(atLimit.features_unevaluated).toBeUndefined();
    expect(profile(nested(33))).toMatchObject({
      features: 1, features_unevaluated: 1, bbox: null,
      vertices_as_is_in_japan: 0, vertices_swapped_in_japan: 0, features_touching_window: { testville: 0 },
    });
  });

  it('counts a shapefile polyline whose segment crosses a disc with both endpoints outside', () => {
    const points: Array<[number, number]> = [[139.69, 35.7], [139.71, 35.7]];
    const content = Buffer.alloc(44 + 4 + points.length * 16);
    content.writeInt32LE(3, 0);
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    content.writeDoubleLE(Math.min(...xs), 4); content.writeDoubleLE(Math.min(...ys), 12);
    content.writeDoubleLE(Math.max(...xs), 20); content.writeDoubleLE(Math.max(...ys), 28);
    content.writeInt32LE(1, 36); content.writeInt32LE(points.length, 40); content.writeInt32LE(0, 44);
    points.forEach(([x, y], i) => { content.writeDoubleLE(x, 48 + i * 16); content.writeDoubleLE(y, 56 + i * 16); });
    const header = Buffer.alloc(100);
    header.writeInt32BE(9994, 0); header.writeInt32BE((100 + 8 + content.length) / 2, 24);
    header.writeInt32LE(1000, 28); header.writeInt32LE(3, 32);
    const rec = Buffer.alloc(8);
    rec.writeInt32BE(1, 0); rec.writeInt32BE(content.length / 2, 4);
    const shape = Buffer.concat([header, rec, content]);
    const detail = shpDetail(shape, 'GEOGCS["JGD2011",DATUM["JGD2011"]]', [STATION]);
    expect(detail.records_touching_window).toEqual({ testville: 1 });
  });

  it.each([5, 15, 25])('counts containment and respects holes for shapefile polygon type %i', (type) => {
    const outer: Array<[number, number]> = [[139.69, 35.69], [139.71, 35.69], [139.71, 35.71], [139.69, 35.71], [139.69, 35.69]];
    const hole: Array<[number, number]> = [[139.695, 35.695], [139.705, 35.695], [139.705, 35.705], [139.695, 35.705], [139.695, 35.695]];
    const windows = [{ ...STATION, discs: [STATION.discs[0]] }];
    expect(shpDetail(shapeBuffer(type, [outer]), 'GEOGCS["JGD2011"]', windows).records_touching_window).toEqual({ testville: 1 });
    expect(shpDetail(shapeBuffer(type, [outer, hole]), 'GEOGCS["JGD2011"]', windows).records_touching_window).toEqual({ testville: 0 });
  });

  it.each([3, 13, 23])('keeps shapefile polyline type %i open', (type) => {
    const path: Array<[number, number]> = [[139.69, 35.7], [139.69, 35.71], [139.71, 35.71], [139.71, 35.7]];
    const windows = [{ ...STATION, discs: [STATION.discs[0]] }];
    expect(shpDetail(shapeBuffer(type, [path]), 'GEOGCS["JGD2011"]', windows).records_touching_window).toEqual({ testville: 0 });
  });

  it.each([1, 11, 21, 8, 18, 28])('tests shapefile point or multipoint type %i without connecting members', (type) => {
    const windows = [{ ...STATION, discs: [STATION.discs[0]] }];
    const profile = (points: Array<[number, number]>): Record<string, unknown> => shpDetail(shapeBuffer(type, [points]), 'GEOGCS["JGD2011"]', windows);
    expect(profile([[139.7, 35.7]])).toMatchObject({ records_read: 1, records_touching_window: { testville: 1 } });
    expect(profile([[139.69, 35.7]]).records_touching_window).toEqual({ testville: 0 });
    if ([8, 18, 28].includes(type)) {
      expect(profile([[139.69, 35.7], [139.71, 35.7]]).records_touching_window).toEqual({ testville: 0 });
      expect(profile([[139.7, 35.7], [139.7001, 35.7]]).records_touching_window).toEqual({ testville: 1 });
    }
  });

  it('skips a null-shape record and counts the following point at the disc centre', () => {
    const point = shapeBuffer(1, [[[STATION.origin.lon, STATION.origin.lat]]]);
    const nullRecord = Buffer.alloc(12);
    nullRecord.writeInt32BE(1, 0); nullRecord.writeInt32BE(2, 4);
    const shape = Buffer.concat([point.subarray(0, 100), nullRecord, point.subarray(100)]);
    shape.writeInt32BE(shape.length / 2, 24); shape.writeInt32BE(2, 112);
    const detail = shpDetail(shape, 'GEOGCS["JGD2011"]', [STATION]);
    expect(detail).toMatchObject({ records_read: 1, records_touching_window: { testville: 1 } });
  });

  it('describes long or blank headers instead of quoting them', () => {
    expect(safeColumnName('緯度', 0)).toBe('緯度');
    expect(safeColumnName('x'.repeat(41), 3)).toBe('(column 4: free-text header of 41 characters)');
    expect(safeColumnName('  ', 1)).toBe('(column 2: blank header)');
  });

  it.each(['guarded term', '(guarded term)', '(column 1: guarded term)'])('keeps row values out of the Markdown report and withholds column %s', (name) => {
    const p = profileCsv(Buffer.from(`名称,${name},lat,lon\nSECRET-ROW-VALUE,v,35.7002,139.7002\n`), [STATION]);
    const md = renderProfileMarkdown([{ spec: 'synthetic', catalog_id: null, sha256: 'a'.repeat(64), bytes: 10, profile: p, error: null, package: null, verdict: { verdict: 'UNKNOWN', reasons: ['x'] } }], [STATION], new Set(['guarded term']));
    expect(md).not.toContain('SECRET-ROW-VALUE');
    expect(md).not.toContain('guarded term');
    expect(md).toContain('name withheld by the literal guard');
    expect(md).toContain('`名称`');
  });

  it.each([
    ['lat,lon,crs', '35.7,139.7,guarded term'],
    ['lat,lon,crs guarded term', '35.7,139.7,JGD2011'],
    ['緯度guarded term,lon,crs', '35.7,139.7,JGD2011'],
    ['lat,経度guarded term,crs', '35.7,139.7,JGD2011'],
    ['lat,lon,crs', '35.7,139.7,(guarded term)'],
    ['lat,lon,(座標系guarded term)', '35.7,139.7,JGD2011'],
    ['(緯度guarded term),lon,crs', '35.7,139.7,JGD2011'],
    ['lat,(経度guarded term),crs', '35.7,139.7,JGD2011'],
  ])('withholds guarded CRS and coordinate text for header %s', (header, row) => {
    const p = profileCsv(Buffer.from(`${header}\n${row}\n`), [STATION]);
    const md = renderProfileMarkdown([{ spec: 'synthetic', catalog_id: null, sha256: 'a'.repeat(64), bytes: 10, profile: p, error: null, package: null, verdict: { verdict: 'UNKNOWN', reasons: ['x'] } }], [STATION], new Set(['guarded term']));
    expect(md).not.toContain('guarded term');
    expect(md).toContain('withheld by the literal guard');
  });

  it('reads the first worksheet of an OOXML workbook', () => {
    const entries = [
      { name: 'xl/sharedStrings.xml', data: Buffer.from('<sst><si><t>name</t></si><si><t>緯度</t></si><si><t>経度</t></si></sst>') },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.from('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>a</t></is></c><c r="C2"><v>139.7</v></c></row></sheetData></worksheet>') },
    ];
    expect(xlsxRecords(entries)).toEqual([['name', '緯度', '経度'], ['a', '', '139.7']]);
  });

  it.each(['guarded term', '(guarded term)', '(column 1: guarded term)'])('withholds DBF field %s and nested keys inside a ZIP member detail', (name) => {
    const zip: ZipProfile = { kind: 'zip', members: [{ extension: 'dbf', bytes: 10, format: 'dbf', detail: { records: 1, field_count: 1, field_names: [name], nested: { [name]: name } } }], vector_members: 0, holds_vector_data: false, coordinate_tables: 0, formats: { dbf: 1 } };
    const md = renderProfileMarkdown([{ spec: 'synthetic-zip', catalog_id: null, sha256: 'a'.repeat(64), bytes: 10, profile: zip, error: null, package: null, verdict: { verdict: 'UNKNOWN', reasons: ['x'] } }], [STATION], new Set(['guarded term']));
    expect(md).not.toContain('guarded term');
    expect(md).toContain('withheld by the literal guard');
  });

  it('builds both station windows from the profile.window config: one 700 m origin disc', async () => {
    const windows = await loadStationWindows();
    expect(windows.map((w) => w.station)).toEqual(['ikebukuro', 'shinjuku']);
    for (const w of windows) {
      expect(w.discs).toHaveLength(1);
      expect(w.discs[0]).toMatchObject({ x: 0, y: 0, r: 700, origin: 'origin' });
      expect(w.basis).toContain('700 m origin disc');
    }
  });
});
