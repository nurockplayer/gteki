import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import { loadFrame } from '../src/crs.js';
import { stationLocal, isStationEnuFrame, type StationEnuFrame } from '../src/station-enu.js';
import { buildContextWindow } from '../src/context-window.js';
import { loadContextConfig, explorerRoleFromName } from '../src/context.js';
import {
  assertNoSourceValues, assertOverlayConfig, axisOrderOfPosition, overlayBBox, overlayGeoJson, parseOverlayKinds, polylineMeetsAnyDisc, publicOverlayReceipt, selectLayer, writeOverlayGlb,
  OVERLAY_PROPERTY_KEYS, type LayerInput, type OverlayMeta, type OverlayProjection, type OverlayReceiptInput,
} from '../src/context-overlay.js';

const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
const sha = (t: string): string => createHash('sha256').update(t).digest('hex');
const pkg = fileURLToPath(new URL('..', import.meta.url));
const repo = join(pkg, '..', '..');

async function frame(): Promise<StationEnuFrame> {
  const f = await loadFrame('ikebukuro-station-enu-v0');
  if (!isStationEnuFrame(f)) throw new Error('expected station-enu frame');
  return f;
}
async function projection(): Promise<OverlayProjection> {
  const f = await frame();
  return { origin: { lat: f.origin.lat, lon: f.origin.lon }, project: (lat, lon) => { const p = stationLocal([lat, lon, f.origin.hM], f); return [p[0], p[1]]; } };
}
/** lon/lat of a point `east`/`north` metres from the origin (small offsets; 1e-6 deg is far below the test tolerances). */
async function at(east: number, north: number): Promise<[number, number]> {
  const f = await frame();
  return [f.origin.lon + east / (111320 * Math.cos((f.origin.lat * Math.PI) / 180)), f.origin.lat + north / 110574];
}
// Synthetic NAME/CODE-like attribute values: none of them is real source data.
const NAME = '合成テスト線', OPERATOR = '合成事業者', CODE = '999999';
async function fixtureCollection(swap = false): Promise<Record<string, unknown>> {
  const pos = async (e: number, n: number): Promise<number[]> => { const [lon, lat] = await at(e, n); return swap ? [lat, lon] : [lon, lat]; };
  const feature = async (props: Record<string, unknown>, coords: number[][] | number[][][], type = 'LineString') => ({ type: 'Feature', properties: props, geometry: { type, coordinates: coords } });
  return {
    type: 'FeatureCollection', name: 'synthetic', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::6668' } },
    features: [
      await feature({ N02_003: NAME, N02_004: OPERATOR, N02_005c: CODE, N02_001: '11' }, [await pos(0, 0), await pos(100, 0)]),
      // Both end points outside the 250 m disc but the segment crosses it (edge crossing only).
      await feature({ N02_003: NAME, N02_004: OPERATOR }, [await pos(-400, 200), await pos(400, 200)]),
      await feature({ N02_003: NAME }, [await pos(5000, 5000), await pos(5100, 5000)]),
      await feature({ N02_003: NAME }, [[await pos(0, 100), await pos(0, 150)], [await pos(0, 160), await pos(0, 200)]], 'MultiLineString'),
      // Bounding box meets the disc corner region but the line does not: (200,200)-(300,200) is 282 m from the origin at its nearest point.
      await feature({ N02_003: NAME }, [await pos(200, 200), await pos(300, 200)]),
    ],
  };
}
const layer = { source_id: 'ksj-n02-2025', kind: 'railway' as const, member: 'synthetic.geojson', ribbon_width_m: 1.5 };
async function select(collection: unknown, kind: 'railway' | 'station' = 'railway', z = 32.5) {
  const window = await buildContextWindow({ r_origin_m: 250, r_exit_m: 0 }, { stationId: 'ikebukuro' });
  const input: LayerInput = { layer: { ...layer, kind }, sourceSha256: 'a'.repeat(64), memberSha256: 'b'.repeat(64), collection };
  return { window, ...selectLayer(input, await projection(), window, z) };
}
const meta: OverlayMeta = { station_id: 'ikebukuro', frame_label: 'ikebukuro-station-enu-v0', credit: 'SYNTHETIC credit', source_id: 'ksj-n02-2025', source_sha256: 'a'.repeat(64), z_m: 32.5, z_basis: 'render z = street floor renderElevationM', window_label: 'r_origin 250 m' };

describe('context-overlay: geometry only', () => {
  it('keeps exactly the allow-listed property keys and no source key, value or code anywhere', async () => {
    const { features, sourceValues } = await select(await fixtureCollection());
    const text = overlayGeoJson(features, meta);
    const parsed = JSON.parse(text) as { features: Array<{ properties: Record<string, unknown> }> };
    for (const f of parsed.features) expect(Object.keys(f.properties).sort()).toEqual([...OVERLAY_PROPERTY_KEYS]);
    for (const needle of [NAME, OPERATOR, CODE, 'N02_', '"11"']) expect(text).not.toContain(needle);
    expect(() => assertNoSourceValues(text, sourceValues, 'geojson')).not.toThrow();
    // No source value in the GLB extras either.
    const dir = await mkdtemp(join(tmpdir(), 'gteki-overlay-')); dirs.push(dir);
    const path = join(dir, 'o.glb');
    await writeOverlayGlb(path, [{ kind: 'railway', width_m: 1.5, features }], { ...meta, feature_hashes_sha256: { railway: 'c'.repeat(64) } });
    const glbText = (await readFile(path)).toString('latin1') + JSON.stringify((await new NodeIO().readBinary(await readFile(path))).getRoot().listNodes().map((n) => n.getExtras()));
    for (const needle of [OPERATOR, CODE, 'N02_']) expect(glbText).not.toContain(needle);
    expect(Buffer.from(glbText, 'latin1').includes(Buffer.from(NAME))).toBe(false);
  });

  it('the leak guard fails closed on a key, an exact value and a non-ASCII substring', () => {
    const values = new Set(['key:N02_003', NAME, '999999']);
    expect(() => assertNoSourceValues('{"a":"x"}', values, 'out')).not.toThrow();
    expect(() => assertNoSourceValues('{"N02_003":1}', values, 'out')).toThrow(/key/);
    expect(() => assertNoSourceValues('{"a":"999999"}', values, 'out')).toThrow(/value/);
    expect(() => assertNoSourceValues(`{"a":"prefix ${NAME} suffix"}`, values, 'out')).toThrow(/value/);
  });
});

describe('context-overlay: axis order and frame', () => {
  it('reads lon,lat and lat,lon from the data and maps a known point to the expected metres', async () => {
    expect(axisOrderOfPosition([139.7, 35.7])).toBe('lon,lat');
    expect(axisOrderOfPosition([35.7, 139.7])).toBe('lat,lon');
    const a = await select(await fixtureCollection(false)), b = await select(await fixtureCollection(true));
    expect(a.counts.axis_order).toBe('lon,lat');
    expect(b.counts.axis_order).toBe('lat,lon');
    // Same geometry whichever order the file uses (the feature hash differs: it hashes the source bytes as written).
    expect(a.features.map((f) => f.parts)).toEqual(b.features.map((f) => f.parts));
    const first = a.features.find((f) => f.source_index === 0)!;
    expect(first.parts[0]![0]![0]).toBeCloseTo(0, 1); expect(first.parts[0]![0]![1]).toBeCloseTo(0, 1);
    expect(first.parts[0]![1]![0]).toBeCloseTo(100, 0); expect(first.parts[0]![1]![1]).toBeCloseTo(0, 0);
  });
  it('a swapped (latitude, longitude) pair given to stationLocal as longitude first lands far away, so the regression is visible', async () => {
    const f = await frame();
    const right = stationLocal([f.origin.lat, f.origin.lon, 0], f), wrong = stationLocal([f.origin.lon, f.origin.lat, 0], f);
    expect(Math.hypot(right[0], right[1])).toBeLessThan(1);
    expect(Math.hypot(wrong[0], wrong[1])).toBeGreaterThan(1000);
  });
  it('refuses ambiguous, out-of-range, mixed-order and CRS-less input', async () => {
    expect(() => axisOrderOfPosition([0, 0])).toThrow(/refusing to guess/);
    expect(() => axisOrderOfPosition([139.7])).toThrow();
    const mixed = await fixtureCollection();
    (mixed.features as Array<{ geometry: { coordinates: number[][] } }>)[2]!.geometry.coordinates = [[35.7, 139.7], [35.7, 139.8]];
    await expect(select(mixed)).rejects.toThrow(/mixes axis orders/);
    const noCrs = await fixtureCollection(); delete noCrs.crs;
    await expect(select(noCrs)).rejects.toThrow(/no CRS/);
    const other = await fixtureCollection(); other.crs = { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::4326' } };
    await expect(select(other)).rejects.toThrow(/not a JGD2011/);
    await expect(select({ type: 'Feature' })).rejects.toThrow(/FeatureCollection/);
  });
  it('rejects geometry types other than LineString and MultiLineString', async () => {
    const c = await fixtureCollection();
    (c.features as Array<{ geometry: unknown }>)[0]!.geometry = { type: 'Point', coordinates: [139.7, 35.7] };
    await expect(select(c)).rejects.toThrow(/Unsupported geometry/);
  });
});

describe('context-overlay: window selection', () => {
  it('selects by exact geometry: edge-crossing line and multi-part line in, far line and corner-bbox line out', async () => {
    const { counts, features } = await select(await fixtureCollection());
    expect(features.map((f) => f.source_index)).toEqual([0, 1, 3]);
    expect(counts).toMatchObject({ features_in_source: 5, selected: 3, outside_prefilter: 1, outside_window: 1, vertices: 8 });
  });
  it('polylineMeetsAnyDisc is exact for crossings and single points', () => {
    const disc = [{ x: 0, y: 0, r: 10, origin: 'origin' as const, id: 'o' }];
    expect(polylineMeetsAnyDisc([[-50, 5], [50, 5]], disc)).toBe(true);
    expect(polylineMeetsAnyDisc([[-50, 11], [50, 11]], disc)).toBe(false);
    expect(polylineMeetsAnyDisc([[10, 0]], disc)).toBe(true);
    expect(polylineMeetsAnyDisc([[10.1, 0]], disc)).toBe(false);
  });
  it('keeps selected lines whole (the multi-part line keeps both parts)', async () => {
    const { features } = await select(await fixtureCollection());
    expect(features.find((f) => f.source_index === 3)!.parts.map((p) => p.length)).toEqual([2, 2]);
  });
});

describe('context-overlay: z basis', () => {
  it('stamps every vertex with the constant z and nothing else', async () => {
    const { features } = await select(await fixtureCollection(), 'railway', 32.5);
    expect(new Set(features.flatMap((f) => f.parts.flat().map((p) => p[2])))).toEqual(new Set([32.5]));
    const zero = await select(await fixtureCollection(), 'station', 0);
    expect(new Set(zero.features.flatMap((f) => f.parts.flat().map((p) => p[2])))).toEqual(new Set([0]));
  });
  it('records the station lead values per station and re-checks them against station.json', async () => {
    const want: Record<string, [number, string]> = { ikebukuro: [32.5, 'render z = street floor renderElevationM'], shinjuku: [0, 'symbolic street z = 0 (no datum asserted)'] };
    for (const [station, [z, basis]] of Object.entries(want)) {
      const overlay = assertOverlayConfig(station, (await loadContextConfig(station) as { overlay?: unknown }).overlay);
      expect(overlay.z).toMatchObject({ mode: 'constant', z_m: z, basis, datum_asserted: false });
      const floors = (JSON.parse(await readFile(join(repo, overlay.z.check.path), 'utf8')) as { floors: Array<{ ordinal: number; renderElevationM: number }> }).floors;
      expect(floors.filter((f) => f.ordinal === overlay.z.check.floor_ordinal).map((f) => f.renderElevationM)).toEqual([z]);
      expect(overlay.layers.map((l) => l.kind).sort()).toEqual(['railway', 'station']);
    }
    expect((await loadContextConfig('ikebukuro') as { overlay?: { frame: unknown } }).overlay!.frame).toEqual({ mode: 'station-enu-frame', frame_id: 'ikebukuro-station-enu-v0' });
    expect((await loadContextConfig('shinjuku') as { overlay?: { frame: { mode: string } } }).overlay!.frame.mode).toBe('origin-only');
  });
  it('rejects an overlay config without a z basis or with a datum claim', () => {
    const good = { frame: { mode: 'origin-only', station_json: 'stations/x/gteki/station.json' }, z: { mode: 'constant', z_m: 0, basis: 'b', datum_asserted: false, check: { path: 'p', floor_ordinal: 0, field: 'renderElevationM' } }, layers: [{ source_id: 's', kind: 'station', member: 'm', ribbon_width_m: 2 }] };
    expect(() => assertOverlayConfig('x', good)).not.toThrow();
    expect(() => assertOverlayConfig('x', { ...good, z: { ...good.z, datum_asserted: true } })).toThrow(/z for x/);
    expect(() => assertOverlayConfig('x', { ...good, z: { ...good.z, basis: '' } })).toThrow(/z for x/);
    expect(() => assertOverlayConfig('x', { ...good, layers: [] })).toThrow(/empty/);
    expect(() => assertOverlayConfig('x', undefined)).toThrow(/no overlay/);
  });
});

describe('context-overlay: determinism', () => {
  it('produces byte-identical GeoJSON with a pinned hash on the synthetic fixture', async () => {
    const one = overlayGeoJson((await select(await fixtureCollection())).features, meta);
    const two = overlayGeoJson((await select(await fixtureCollection())).features, meta);
    expect(one).toBe(two);
    expect(sha(one)).toBe('d5ef8be38d873ae6d0aed9c7b5f03bb5564955fc8ab9d81c2de97d4543653e1a');
  });
  it('writes a GLB whose readback matches, with role-safe node names and 2 triangles per segment', async () => {
    const { features } = await select(await fixtureCollection());
    const dir = await mkdtemp(join(tmpdir(), 'gteki-overlay-')); dirs.push(dir);
    const result = await writeOverlayGlb(join(dir, 'a.glb'), [{ kind: 'railway', width_m: 1.5, features }], { ...meta, feature_hashes_sha256: {} });
    expect(result.triangles).toEqual({ ctx_rail_all: 2 * (1 + 1 + 2) });
    expect(result.readback).toMatchObject({ status: 'PASS', node_count: 1 });
    expect(explorerRoleFromName('ctx_rail_all')).toBeNull();
    expect(explorerRoleFromName('ctx_station_all')).toBeNull();
    const again = await writeOverlayGlb(join(dir, 'b.glb'), [{ kind: 'railway', width_m: 1.5, features }], { ...meta, feature_hashes_sha256: {} });
    expect(sha((await readFile(join(dir, 'a.glb'))).toString('latin1'))).toBe(sha((await readFile(join(dir, 'b.glb'))).toString('latin1')));
    expect(again.readback.bbox_max_error_m).toBeLessThan(0.001);
    expect(overlayBBox(features)!.min[2]).toBe(32.5);
  });
});

describe('context-overlay: public receipt', () => {
  async function input(): Promise<{ input: OverlayReceiptInput; values: Set<string> }> {
    const { features, counts, sourceValues } = await select(await fixtureCollection());
    return { values: sourceValues, input: {
      run_id: 'overlay-x', station_id: 'ikebukuro', frame: { mode: 'station-enu-frame' }, window: { r_origin_m: 250 }, z: { z_m: 32.5, basis: 'render z = street floor renderElevationM' }, credit: 'SYNTHETIC credit',
      source: { source_id: 'ksj-n02-2025', source_sha256: 'a'.repeat(64), bytes: 1, license_name: 'CC BY 4.0', license_url: null, publish_gate: 'CONDITIONAL' },
      layers: [counts], feature_hashes: { railway: features.map((f) => f.feature_hash) }, bbox: overlayBBox(features), outputs: {}, tool_input_sha256: 'd'.repeat(64), policy_version: 'context-overlay-v1',
    } };
  }
  it('has the expected shape: tags, counts, sorted hashes and no source value', async () => {
    const { input: i, values } = await input();
    const r = publicOverlayReceipt(i, values) as Record<string, any>;
    expect(r).toMatchObject({ gteki_role: 'context', navigation_use: 'NOT_FOR_ROUTING', visual_only: true, command: 'context-overlay', totals: { selected: 3 } });
    expect(Object.keys(r).sort()).toEqual(['bbox_local_ENU', 'command', 'credit', 'feature_hashes', 'feature_hashes_sha256', 'frame', 'gteki_role', 'layers', 'navigation_use', 'note', 'outputs', 'policy_version', 'run_id', 'source', 'station_id', 'tool_input_sha256', 'tool_version', 'totals', 'verification', 'visual_only', 'window', 'z_basis']);
    expect(r.feature_hashes.railway).toEqual([...r.feature_hashes.railway].sort());
    for (const needle of [NAME, OPERATOR, CODE, 'N02_']) expect(JSON.stringify(r)).not.toContain(needle);
  });
  it('fails closed when any field would carry a source value or key', async () => {
    const { input: i, values } = await input();
    expect(() => publicOverlayReceipt({ ...i, credit: `credit ${NAME}` }, values)).toThrow(/source property value/);
    expect(() => publicOverlayReceipt({ ...i, source: { ...i.source, license_name: CODE } }, values)).toThrow(/source property value/);
    expect(() => publicOverlayReceipt({ ...i, outputs: { N02_003: 1 } }, values)).toThrow(/source property key/);
  });
});

describe('context-overlay: CLI argument validation', () => {
  it('parses --kinds', () => {
    expect(parseOverlayKinds('railway,station')).toEqual(['station', 'railway']);
    expect(parseOverlayKinds('station')).toEqual(['station']);
    expect(() => parseOverlayKinds('bldg')).toThrow(/Invalid --kinds/);
    expect(() => parseOverlayKinds('')).toThrow(/Invalid --kinds/);
  });
  it('the command fails before reading any source on bad arguments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gteki-overlay-cli-')); dirs.push(dir);
    const run = async (...args: string[]): Promise<string> => {
      try { await promisify(execFile)(join(pkg, 'node_modules', '.bin', 'tsx'), ['src/cli.ts', 'context-overlay', ...args], { cwd: pkg, env: { ...process.env, GTEKI_GIS_STORE: join(dir, 'store') } }); return 'ok'; }
      catch (error) { return (error as { stderr?: string }).stderr ?? String(error); }
    };
    expect(await run()).toContain('Missing argument 1 for context-overlay');
    expect(await run('ikebukuro', '--radius=-5')).toContain('--radius must be a positive number');
    expect(await run('ikebukuro', '--exit-radius', 'x')).toContain('--exit-radius must be a non-negative number');
    expect(await run('ikebukuro', '--kinds', 'bldg')).toContain('Invalid --kinds');
    expect(await run('ikebukuro', '--merge', 'kind')).toContain('takes only');
    expect(await run('nowhere')).toContain('No context config for station nowhere');
  }, 60_000);
});
