import { describe, expect, it } from 'vitest';
import { decodeCsvBytes, loadStationWindows, profileCsv, safeColumnName, verdictFor, xlsxRecords, type StationWindow } from '../src/csv-profile.js';
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

  it('describes long or blank headers instead of quoting them', () => {
    expect(safeColumnName('緯度', 0)).toBe('緯度');
    expect(safeColumnName('x'.repeat(41), 3)).toBe('(column 4: free-text header of 41 characters)');
    expect(safeColumnName('  ', 1)).toBe('(column 2: blank header)');
  });

  it('keeps row values out of the Markdown report and withholds guarded column names', () => {
    const p = profileCsv(Buffer.from('名称,guarded term,lat,lon\nSECRET-ROW-VALUE,v,35.7002,139.7002\n'), [STATION]);
    const md = renderProfileMarkdown([{ spec: 'synthetic', catalog_id: null, sha256: 'a'.repeat(64), bytes: 10, profile: p, error: null, package: null, verdict: { verdict: 'UNKNOWN', reasons: ['x'] } }], [STATION], new Set(['guarded term']));
    expect(md).not.toContain('SECRET-ROW-VALUE');
    expect(md).not.toContain('guarded term');
    expect(md).toContain('name withheld by the literal guard');
    expect(md).toContain('`名称`');
  });

  it('reads the first worksheet of an OOXML workbook', () => {
    const entries = [
      { name: 'xl/sharedStrings.xml', data: Buffer.from('<sst><si><t>name</t></si><si><t>緯度</t></si><si><t>経度</t></si></sst>') },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.from('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>a</t></is></c><c r="C2"><v>139.7</v></c></row></sheetData></worksheet>') },
    ];
    expect(xlsxRecords(entries)).toEqual([['name', '緯度', '経度'], ['a', '', '139.7']]);
  });

  it('builds the real station windows from the context configs and station.json origins', async () => {
    const windows = await loadStationWindows();
    expect(windows.map((w) => w.station)).toEqual(['ikebukuro', 'shinjuku']);
    expect(windows[0].discs.length).toBeGreaterThan(1);
    expect(windows[1].discs).toHaveLength(1);
    expect(windows[1].discs[0].r).toBe(250);
  });
});
