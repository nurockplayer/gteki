import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as common from '../src/common.js';
import { assertNoSourceValues } from '../src/context-overlay.js';
import {
  assertLandmarksConfig, collectSourceValues, contextLandmarks, maskCreditText, maskShippedFieldValues, LANDMARK_CRS, LANDMARKS_POLICY_VERSION, LANDMARK_PROPERTY_KEYS,
  landmarksGeoJson, parseLandmarksCsv, type LandmarksConfig,
} from '../src/context-landmarks.js';
import { stationEnuProjector } from '../src/station-enu.js';
import { loadSources } from '../src/acquire.js';

// Only the repository root is redirected: the station.json fixture, the synthetic CSV and every output stay in a temp directory.
vi.mock('../src/common.js', async (importOriginal) => {
  const actual = await importOriginal<typeof common>();
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { ...actual, repoRoot: await mkdtemp(join(tmpdir(), 'gteki-landmarks-')) };
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await rm(common.repoRoot, { recursive: true, force: true }); });

const sha = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const ORIGIN = { lat: 35.687, lon: 139.6994 };
const project = stationEnuProjector({ ...ORIGIN, hM: 0 });
/** The latitude (same meridian) whose station-frame north offset is `north` metres, by bisection. */
function latAtNorth(north: number): number {
  let lo = ORIGIN.lat - 0.02, hi = ORIGIN.lat + 0.02;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (project(mid, ORIGIN.lon, 0)[1] < north) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
const HEADER = ['ID', '名称', '文化財分類', '所在地_連結表記', '緯度', '経度', '所有者等', '説明', 'URL', '画像'];
const BOUNDARY_INSIDE = 699.99995, BOUNDARY_OUTSIDE = 700.00005;
/** Synthetic rows: inside the 700 m disc, a blank and an invalid coordinate, the boundary (inside and just outside), and a far row. */
const ROWS: string[][] = [
  ['1', '架空の戦跡甲', '記念物', '東京都新宿区架空一丁目1番', String(latAtNorth(100)), String(ORIGIN.lon), '新宿区', 'テスト説明文甲', '', ''],
  ['2', '', '', '東京都新宿区架空二丁目2番', String(latAtNorth(300)), String(ORIGIN.lon), '新宿区', 'テスト説明文乙', '', ''],
  ['3', '架空の建造物乙', '建造物', '東京都新宿区架空三丁目3番', String(latAtNorth(2000)), String(ORIGIN.lon), 'テスト所有者別', 'テスト説明文丙', '', ''],
  ['4', '架空の座標無し', '記念物', '東京都新宿区架空四丁目4番', '', String(ORIGIN.lon), '新宿区', 'テスト説明文丁', '', ''],
  ['5', '架空の座標不正', '記念物', '東京都新宿区架空五丁目5番', 'abc', String(ORIGIN.lon), '新宿区', 'テスト説明文戊', '', ''],
  ['6', '架空の境界丙', '記念物', '東京都新宿区架空六丁目6番', String(latAtNorth(BOUNDARY_INSIDE)), String(ORIGIN.lon), '新宿区', 'テスト説明文己', '', ''],
  ['7', '架空の外丁', '記念物', '東京都新宿区架空七丁目7番', String(latAtNorth(BOUNDARY_OUTSIDE)), String(ORIGIN.lon), '新宿区', 'テスト説明文庚', '', ''],
];
const csvText = (rows: string[][], header: string[] = HEADER): string => [header, ...rows].map((row) => row.map((cell) => `"${cell.replace(/"/gu, '""')}"`).join(',')).join('\r\n');
/** The real source is UTF-16LE with a BOM; write the fixture the same way so the encoding path is exercised. */
const utf16 = (text: string): Buffer => Buffer.from('\ufeff' + text, 'utf16le');

async function setup(options: { gate?: string; csv?: string; stationHeight?: number } = {}) {
  const stationPath = join(common.repoRoot, 'stations', 'shinjuku', 'gteki', 'station.json');
  await mkdir(dirname(stationPath), { recursive: true });
  const station = { station: { id: 'shinjuku', origin: { lat: ORIGIN.lat, lon: ORIGIN.lon, hM: null, crs: 'EPSG:6668' } }, floors: [{ ordinal: 0, renderElevationM: options.stationHeight ?? 0 }] };
  await writeFile(stationPath, JSON.stringify(station));
  const csvPath = join(common.repoRoot, 'source.csv');
  const bytes = utf16(options.csv ?? csvText(ROWS));
  await writeFile(csvPath, bytes);
  const source = loadSources().find((s) => s.source_id === 'tokyo-muni-shinjuku-cultural-properties-csv')!;
  const manifest = { ...source, publish_gate: options.gate ?? 'CONDITIONAL' };
  const storeRoot = join(common.repoRoot, 'store');
  vi.spyOn(common, 'getStoreRoot').mockReturnValue(storeRoot);
  vi.spyOn(common, 'getStoredSource').mockResolvedValue({
    path: csvPath, source: manifest,
    record: { source_id: manifest.source_id, resolved_url: manifest.expected_url, bytes: bytes.length, sha256: sha(bytes), store_path: 'raw/synthetic/source.csv', size_check: 'MATCH', http_status: 200, requested_at: '2026-10-24T00:00:00Z', completed_at: '2026-10-24T00:00:01Z' },
  } as unknown as Awaited<ReturnType<typeof common.getStoredSource>>);
  const run = (runOptions: { radiusM?: number } = {}) => contextLandmarks('shinjuku', { receiptDir: join(common.repoRoot, 'receipts'), ...runOptions });
  return { station, stationPath, storeRoot, bytes, run };
}

describe('context-landmarks: gate and source reading', () => {
  it('refuses a HOLD gate and runs at CONDITIONAL', async () => {
    const held = await setup({ gate: 'HOLD' });
    await expect(held.run()).rejects.toThrow(/publish_gate HOLD; context-landmarks refuses to run/);
    const open = await setup({ gate: 'CONDITIONAL' });
    const receipt = (await open.run()) as Record<string, any>;
    expect(receipt.source).toMatchObject({ publish_gate: 'CONDITIONAL', source_id: 'tokyo-muni-shinjuku-cultural-properties-csv' });
  });

  it('fails when a configured column is missing from the header', async () => {
    const header = HEADER.filter((name) => name !== '文化財分類');
    const rows = ROWS.map((row) => row.filter((_, index) => HEADER[index] !== '文化財分類'));
    const { run } = await setup({ csv: csvText(rows, header) });
    await expect(run()).rejects.toThrow(/has no column "文化財分類"/);
  });

  it('skips and counts a blank and an invalid coordinate, never guessing them', async () => {
    const { run } = await setup();
    const receipt = (await run()) as Record<string, any>;
    expect(receipt.rows_in_source).toBe(7);
    expect(receipt.rows_invalid_coordinates).toBe(2);
    expect(receipt.selected).toBe(3);
    expect(receipt.outside_window).toBe(2);
  });

  it('refuses a swapped-axis file', async () => {
    const swapped = ROWS.map((row) => [row[0]!, row[1]!, row[2]!, row[3]!, row[5]!, row[4]!, row[6]!, row[7]!, row[8]!, row[9]!]);
    const { run } = await setup({ csv: csvText(swapped) });
    await expect(run()).rejects.toThrow(/axis check is SWAPPED/);
  });

  it('fails when station.json no longer carries the configured z', async () => {
    const { run } = await setup({ stationHeight: 5 });
    await expect(run()).rejects.toThrow(/z basis no longer matches/);
  });
});

describe('context-landmarks: selection', () => {
  it('selects the closed disc (inside, on the boundary), not just outside it, and honours --radius', async () => {
    const { run } = await setup();
    const receipt = (await run()) as Record<string, any>;
    expect(receipt.selected).toBe(3);
    const geojson = JSON.parse(await readFile(join(common.repoRoot, 'store', receipt.outputs.geojson.store_path), 'utf8')) as { features: Array<{ properties: { name: string | null } }> };
    const names = geojson.features.map((f) => f.properties.name);
    expect(names).toContain('架空の戦跡甲');
    expect(names).toContain('架空の境界丙');
    expect(names).not.toContain('架空の外丁');
    expect(receipt.window).toMatchObject({ kind: 'origin_disc', radius_m: 700 });

    const narrow = (await run({ radiusM: 250 })) as Record<string, any>;
    expect(narrow.selected).toBe(1);
    expect(narrow.window).toMatchObject({ radius_m: 250 });
    expect(narrow.run_id).not.toBe(receipt.run_id);
  });
});

describe('context-landmarks: shipped fields and leak guards', () => {
  it('ships exactly the allowed property set; no other column value reaches an output', async () => {
    const { run, storeRoot } = await setup();
    const receipt = (await run()) as Record<string, any>;
    const geojsonText = await readFile(join(storeRoot, receipt.outputs.geojson.store_path as string), 'utf8');
    const provenanceText = await readFile(join(storeRoot, receipt.outputs.provenance.store_path as string), 'utf8');
    const receiptText = JSON.stringify(receipt);
    const geojson = JSON.parse(geojsonText) as { features: Array<{ properties: Record<string, unknown> }> };
    for (const feature of geojson.features) expect(Object.keys(feature.properties).sort()).toEqual([...LANDMARK_PROPERTY_KEYS].sort());
    const first = geojson.features.find((f) => f.properties.name === '架空の戦跡甲')!;
    expect(first.properties).toMatchObject({ gteki_role: 'context', navigation_use: 'NOT_FOR_ROUTING', visual_only: true, kind: 'landmark', class: '記念物' });
    expect(first.properties.credit).toEqual({ ja: expect.stringContaining('新宿区'), en: expect.stringContaining('Shinjuku City') });
    // 説明, address and the owner column never ship; the owner cell 新宿区 only appears as part of the mandated credit.
    for (const text of [geojsonText, provenanceText, receiptText]) {
      for (const marker of ['テスト説明文甲', 'テスト所有者別', '架空一丁目1番']) expect(text).not.toContain(marker);
    }
    expect(receipt.leak_guard.exempted_as_credit_substring).toBeUndefined();
    expect(receipt.leak_guard.credit_occurrences_masked).toMatchObject({ store_geojson: expect.any(Number), store_provenance: expect.any(Number), receipt: 2 });
    expect(receipt.leak_guard.credit_masking).toMatch(/no source value is exempted/u);
  });

  it('masks the mandated credit instead of exempting its substrings, so the same value still trips outside it', async () => {
    const { bytes, run } = await setup();
    const { header, rows } = parseLandmarksCsv(bytes);
    const guard = collectSourceValues(rows, new Set([header.indexOf('名称'), header.indexOf('文化財分類')]));
    expect(guard.has('新宿区')).toBe(true);
    const credit = { ja: '出典：新宿区（CC BY 4.0）', en: 'Source: Shinjuku City (CC BY 4.0).' };
    const inside = maskCreditText(JSON.stringify({ credit }), credit);
    expect(inside.occurrences).toBe(2);
    expect(inside.text).not.toContain('新宿区');
    expect(() => assertNoSourceValues(inside.text, guard, 'The landmark GeoJSON')).not.toThrow();
    const outside = maskCreditText(JSON.stringify({ credit, owner: '新宿区' }), credit).text;
    expect(() => assertNoSourceValues(outside, guard, 'The landmark GeoJSON')).toThrow(/source property value/);
    const receipt = (await run()) as Record<string, any>;
    expect(receipt.leak_guard.credit_occurrences_masked).toMatchObject({ receipt: 2 });
  });

  it('trips the store leak guard when a description value is injected into the GeoJSON', async () => {
    const { bytes } = await setup();
    const { header, rows } = parseLandmarksCsv(bytes);
    const guard = collectSourceValues(rows, new Set([header.indexOf('名称'), header.indexOf('文化財分類')]));
    expect(guard.has('テスト説明文甲')).toBe(true);
    const credit = { ja: 'c', en: 'd' };
    const injected = landmarksGeoJson([{ row_index: 0, x: 0, y: 0, z: 0, name: '架空の戦跡甲', class: '記念物', row_hash: 'a'.repeat(64) }], {
      station_id: 'shinjuku', frame_label: 'origin-only', z_m: 0, z_basis: 'symbolic street z = 0', source_id: 'synthetic', source_sha256: 'b'.repeat(64), window_label: 'origin_disc 700 m', credit,
    }).replace('"row_hash"', '"説明":"テスト説明文甲","row_hash"');
    expect(() => assertNoSourceValues(maskCreditText(injected, credit).text, guard, 'The landmark GeoJSON')).toThrow(/source property value/);
  });

  it('keeps the receipt literal-free: hashed class histogram, UNKNOWN CRS, NOT_FOR_ROUTING', async () => {
    const { run } = await setup();
    const receipt = (await run()) as Record<string, any>;
    const text = JSON.stringify(receipt);
    expect(text).not.toContain('架空の戦跡甲');
    expect(text).not.toContain('記念物');
    expect(receipt.classes).toEqual({ [sha('記念物')]: 2 });
    expect(receipt).toMatchObject({ policy_version: LANDMARKS_POLICY_VERSION, gteki_role: 'context', navigation_use: 'NOT_FOR_ROUTING', visual_only: true, verification: 'UNVERIFIED', selected: 3, name_null: 1, class_null: 1 });
    expect(receipt.crs).toEqual(LANDMARK_CRS);
    expect(receipt.crs.status).toBe('UNKNOWN');
    expect(receipt.crs.declared).toBeNull();
    expect(receipt.crs.asserted).toBe(false);
    expect(receipt.text_fields).toMatchObject({ URL: 'excluded (0/7 filled)', 画像: 'excluded (0/7 filled)' });
    expect(receipt.row_hashes_sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(receipt.bbox_local_ENU).not.toBeNull();
  });

  it('keeps the digest stable across runs and changes it with the radius and the source hash', async () => {
    const first = await setup();
    const a = (await first.run()) as Record<string, any>;
    const b = (await first.run()) as Record<string, any>;
    expect(b.run_id).toBe(a.run_id);
    const wider = (await first.run({ radiusM: 800 })) as Record<string, any>;
    expect(wider.run_id).not.toBe(a.run_id);
    expect(wider.selected).toBe(4);
    const other = await setup({ csv: csvText([...ROWS, ['8', '架空の遠景戊', '記念物', '東京都新宿区架空八丁目8番', String(latAtNorth(3000)), String(ORIGIN.lon), '新宿区', 'テスト説明文辛', '', '']]) });
    const c = (await other.run()) as Record<string, any>;
    expect(c.source.source_sha256).not.toBe(a.source.source_sha256);
    expect(c.run_id).not.toBe(a.run_id);
  });
});

describe('context-landmarks: shipped-field masking', () => {
  const META = { station_id: 'shinjuku', frame_label: 'origin-only', z_m: 0, z_basis: 'symbolic street z = 0', source_id: 'synthetic', source_sha256: 'b'.repeat(64), window_label: 'origin_disc 700 m', credit: { ja: 'c', en: 'd' } };
  const POINT = { row_index: 0, x: 0, y: 0, z: 0, name: '架空寺本堂', class: '記念物', row_hash: 'a'.repeat(64) };
  /** A temple name that contains its owner's name: the real source has such rows (owner 130 cells, 種類 35, 所在地_町字 5). */
  const TEMPLE: string[][] = [['1', '架空寺本堂', '記念物', '東京都新宿区架空一丁目1番', String(latAtNorth(100)), String(ORIGIN.lon), '架空寺', 'テスト説明文甲', '', '']];

  it('passes when a shipped name contains another column cell as a substring', async () => {
    const { run } = await setup({ csv: csvText(TEMPLE) });
    const receipt = (await run()) as Record<string, any>;
    expect(receipt.selected).toBe(1);
    expect(receipt.leak_guard.shipped_field_values_masked).toBe(2);
    const geojson = JSON.parse(await readFile(join(common.repoRoot, 'store', receipt.outputs.geojson.store_path), 'utf8')) as { features: Array<{ properties: { name: string } }> };
    expect(geojson.features[0]!.properties.name).toBe('架空寺本堂');
  });

  it('still trips when the same owner value sits outside the shipped fields', () => {
    const guard = collectSourceValues(TEMPLE, new Set([1, 2]));
    expect(guard.has('架空寺')).toBe(true);
    const geojson = landmarksGeoJson([POINT], META);
    const masked = maskShippedFieldValues(maskCreditText(geojson, META.credit).text, [POINT.name, POINT.class]);
    expect(masked.occurrences).toBe(2);
    expect(() => assertNoSourceValues(masked.text, guard, 'The landmark GeoJSON')).not.toThrow();
    const injected = geojson.replace('"row_hash"', '"所有者":"架空寺","row_hash"');
    const injectedMasked = maskShippedFieldValues(maskCreditText(injected, META.credit).text, [POINT.name, POINT.class]);
    expect(() => assertNoSourceValues(injectedMasked.text, guard, 'The landmark GeoJSON')).toThrow(/source property value/);
  });

  it('passes in the GeoJSON when an owner cell equals a shipped name, but the receipt still forbids it', async () => {
    const rows = [['1', '架空寺本堂', '記念物', '東京都新宿区架空一丁目1番', String(latAtNorth(100)), String(ORIGIN.lon), '架空寺本堂', 'テスト説明文甲', '', '']];
    const { run } = await setup({ csv: csvText(rows) });
    const receipt = (await run()) as Record<string, any>;
    expect(receipt.selected).toBe(1);
    const guard = collectSourceValues(rows, new Set([1, 2]));
    expect(guard.has('架空寺本堂')).toBe(true);
    // The receipt is never masked this way: a name token there is still a leak.
    expect(() => assertNoSourceValues(JSON.stringify('架空寺本堂'), guard, 'The public landmark receipt')).toThrow(/source property value/);
  });
});

describe('context-landmarks: strict config', () => {
  const valid = (): Record<string, unknown> => ({
    source_id: 'tokyo-muni-shinjuku-cultural-properties-csv',
    frame: { mode: 'origin-only', station_json: 'stations/shinjuku/gteki/station.json' },
    z: { mode: 'constant', z_m: 0, basis: 'symbolic street z = 0', datum_asserted: false, check: { path: 'stations/shinjuku/gteki/station.json', floor_ordinal: 0, field: 'renderElevationM' } },
    window: { kind: 'origin_disc', radius_m: 700 },
    fields: { lat: '緯度', lon: '経度', name: '名称', class: '文化財分類' },
    credit: { ja: '出典：新宿区（CC BY 4.0）', en: 'Source: Shinjuku City (CC BY 4.0).' },
  });
  it('accepts the configured shape and rejects an absent section', () => {
    expect((assertLandmarksConfig('shinjuku', valid()) as LandmarksConfig).window.radius_m).toBe(700);
    expect(() => assertLandmarksConfig('shinjuku', undefined)).toThrow(/has no landmarks section/);
  });
  it('names the field on an unknown key, a wrong type and a missing field', () => {
    expect(() => assertLandmarksConfig('shinjuku', { ...valid(), extra: 1 })).toThrow(/unknown key "extra"/);
    expect(() => assertLandmarksConfig('shinjuku', { ...valid(), fields: { lat: '緯度', lon: '経度', name: '名称', class: 7 } })).toThrow(/fields\.class must be a non-empty column name/);
    expect(() => assertLandmarksConfig('shinjuku', { ...valid(), window: { kind: 'origin_disc', radius_m: -1 } })).toThrow(/window\.radius_m must be a positive number/);
    const missing = valid(); delete missing.credit;
    expect(() => assertLandmarksConfig('shinjuku', missing)).toThrow(/missing "credit"/);
  });
});
