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
import { stationHorizontal, stationLocal, isStationEnuFrame, type StationEnuFrame } from '../src/station-enu.js';
import { buildContextWindow } from '../src/context-window.js';
import { loadContextConfig, explorerRoleFromName } from '../src/context.js';
import {
  assertNoSourceValues, assertOverlayConfig, clipPolylineToDisc, axisOrderOfPosition, originDiscWindow, overlayBBox, overlayGeoJson, parseOverlayKinds, polylineMeetsAnyDisc, publicOverlayReceipt, selectLayer, writeOverlayGlb,
  OVERLAY_PROPERTY_KEYS, type LayerInput, type OverlayMeta, type OverlayProjection, type OverlayReceiptInput,
} from '../src/context-overlay.js';
import { loadSources } from '../src/acquire.js';

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
  return { origin: { lat: f.origin.lat, lon: f.origin.lon }, project: (lat, lon) => stationHorizontal([lat, lon], f) };
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
async function select(collection: unknown, kind: 'railway' | 'station' = 'railway', z = 32.5, clip: number | null = null) {
  const window = await buildContextWindow({ r_origin_m: 250, r_exit_m: 0 }, { stationId: 'ikebukuro' });
  const input: LayerInput = { layer: { ...layer, kind }, sourceSha256: 'a'.repeat(64), memberSha256: 'b'.repeat(64), collection };
  return { window, ...selectLayer(input, await projection(), window, z, clip) };
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
      expect(overlay.layers.map((l) => l.kind).sort()).toEqual(['border', 'railway', 'station']);
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
    expect(sha(one)).toBe('e1389b8a0b53736041b9c6b266171b5e442f3916b6bdf288422ff61ed2072ae3');
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
      layers: [counts], feature_hashes: { railway: features.map((f) => f.feature_hash) }, bbox: overlayBBox(features), outputs: {}, tool_input_sha256: 'd'.repeat(64), policy_version: 'context-overlay-v1', clip: { kind: 'origin_disc', radius_m: 250 },
    } };
  }
  it('has the expected shape: tags, counts, sorted hashes and no source value', async () => {
    const { input: i, values } = await input();
    const r = publicOverlayReceipt(i, values) as Record<string, any>;
    expect(r).toMatchObject({ gteki_role: 'context', navigation_use: 'NOT_FOR_ROUTING', visual_only: true, command: 'context-overlay', totals: { selected: 3 } });
    expect(Object.keys(r).sort()).toEqual(['bbox_local_ENU', 'clip', 'command', 'credit', 'feature_hashes', 'feature_hashes_sha256', 'frame', 'gteki_role', 'layers', 'navigation_use', 'note', 'outputs', 'policy_version', 'run_id', 'source', 'station_id', 'tool_input_sha256', 'tool_version', 'totals', 'verification', 'visual_only', 'window', 'z_basis']);
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
    expect(await run('ikebukuro', '--clip-radius=-3')).toContain('--clip-radius must be a non-negative');
    expect(await run('ikebukuro', '--clip-radius', 'abc')).toContain('--clip-radius must be a non-negative');
    expect(await run('nowhere')).toContain('No context config for station nowhere');
  }, 60_000);
});

describe('context-overlay: clip to the origin disc', () => {
  const R = 250;
  const norm = (p: readonly number[]): number => Math.hypot(p[0]!, p[1]!);
  it('splits a line crossing the circle twice, with both intersections on the circle within 1e-6', () => {
    const parts = clipPolylineToDisc([[-400, 200], [400, 200]], R);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(2);
    for (const p of parts[0]!) expect(Math.abs(norm(p) - R)).toBeLessThan(1e-6);
    expect(parts[0]![0]![0]).toBeCloseTo(-Math.sqrt(R * R - 200 * 200), 6);
    expect(parts[0]![1]![0]).toBeCloseTo(Math.sqrt(R * R - 200 * 200), 6);
  });
  it('keeps a line fully inside unchanged with clipped false, and cuts the edge-crossing one', async () => {
    const { features, counts } = await select(await fixtureCollection(), 'railway', 32.5, R);
    const byIndex = new Map(features.map((f) => [f.source_index, f]));
    const inside = byIndex.get(0)!, whole = await select(await fixtureCollection());
    expect(inside.clipped).toBe(false);
    expect(inside.parts).toEqual(whole.features.find((f) => f.source_index === 0)!.parts);
    expect(byIndex.get(3)!.clipped).toBe(false);
    const cut = byIndex.get(1)!;
    expect(cut.clipped).toBe(true);
    expect(cut.vertices_before_clip).toBe(2);
    for (const p of cut.parts[0]!) expect(Math.abs(norm(p) - R)).toBeLessThan(1e-3);
    expect(counts).toMatchObject({ selected_before_clip: 3, selected: 3, features_clipped: 1, dropped_by_clip: 0, vertices_before_clip: 8, vertices: 8 });
    // Feature hash stays the hash of the source feature, clipped or not.
    expect(cut.feature_hash).toBe(whole.features.find((f) => f.source_index === 1)!.feature_hash);
  });
  it('turns a line that exits and re-enters into a MultiLineString', async () => {
    const parts = clipPolylineToDisc([[0, 0], [150, 0], [150, 60], [50, 60]], 100);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual([[0, 0], [100, 0]]);
    expect(parts[1]![0]![0]).toBeCloseTo(80, 9); expect(parts[1]![0]![1]).toBe(60);
    expect(parts[1]![1]).toEqual([50, 60]);
    const f = await frame();
    const collection = { type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::6668' } }, features: [{ type: 'Feature', properties: { N02_003: NAME }, geometry: { type: 'LineString', coordinates: await Promise.all([[0, 0], [150, 0], [150, 60], [50, 60]].map((p) => at(p[0]!, p[1]!))) } }] };
    expect(f.origin.lat).toBeGreaterThan(0);
    const { features } = await select(collection, 'railway', 32.5, 100);
    expect(features).toHaveLength(1);
    expect(features[0]!.parts).toHaveLength(2);
    expect(JSON.parse(overlayGeoJson(features, meta)).features[0].geometry.type).toBe('MultiLineString');
  });
  it('drops tangent touches and slivers shorter than 0.01 m, and drops a feature with nothing left', async () => {
    expect(clipPolylineToDisc([[-50, 100], [50, 100]], 100)).toEqual([]);
    expect(clipPolylineToDisc([[0, 99.999], [0, 200]], 100)).toEqual([]);
    expect(clipPolylineToDisc([[500, 500]], 100)).toEqual([]);
    expect(clipPolylineToDisc([[5, 5]], 100)).toEqual([[[5, 5]]]);
    // Lines meeting the 250 m selection window but with no part inside a 100 m clip disc are dropped, and counted.
    const { features, counts } = await select(await fixtureCollection(), 'railway', 32.5, 100);
    expect(features.map((f) => f.source_index)).toEqual([0]);
    expect(counts).toMatchObject({ selected_before_clip: 3, dropped_by_clip: 2, selected: 1 });
  });
  it('clipping disabled (null) leaves every geometry whole with clipped false', async () => {
    const { features, counts } = await select(await fixtureCollection(), 'railway', 32.5, null);
    expect(features.every((f) => !f.clipped)).toBe(true);
    expect(counts).toMatchObject({ features_clipped: 0, vertices: 8, vertices_before_clip: 8 });
    expect(features.find((f) => f.source_index === 1)!.parts[0]!.map((p) => Math.round(p[0]!))).toEqual([-400, 400]);
  });
  it('reads the radius from config for both stations and validates it', async () => {
    for (const station of ['ikebukuro', 'shinjuku']) {
      const overlay = assertOverlayConfig(station, (await loadContextConfig(station) as { overlay?: unknown }).overlay);
      expect(overlay.clip).toEqual({ kind: 'origin_disc', radius_m: 700 });
    }
    const good = { frame: { mode: 'origin-only', station_json: 'stations/x/gteki/station.json' }, z: { mode: 'constant', z_m: 0, basis: 'b', datum_asserted: false, check: { path: 'p', floor_ordinal: 0, field: 'renderElevationM' } }, layers: [{ source_id: 's', kind: 'station', member: 'm', ribbon_width_m: 2 }] };
    expect(() => assertOverlayConfig('x', { ...good, clip: { kind: 'origin_disc', radius_m: 700 } })).not.toThrow();
    expect(() => assertOverlayConfig('x', { ...good, clip: { kind: 'box', radius_m: 700 } })).toThrow(/overlay.clip/);
    expect(() => assertOverlayConfig('x', { ...good, clip: { kind: 'origin_disc', radius_m: 0 } })).toThrow(/overlay.clip/);
  });
  it('is deterministic: pinned GeoJSON hash for the clipped synthetic fixture, bbox follows the clipped geometry', async () => {
    const one = await select(await fixtureCollection(), 'railway', 32.5, R), two = await select(await fixtureCollection(), 'railway', 32.5, R);
    const text = overlayGeoJson(one.features, { ...meta, clip: { kind: 'origin_disc', radius_m: R } });
    expect(text).toBe(overlayGeoJson(two.features, { ...meta, clip: { kind: 'origin_disc', radius_m: R } }));
    expect(sha(text)).toBe('71c86d6129375ef8686a36852ca1e443f6d027402f9ba8bd93a63f3c411739d1');
    const box = overlayBBox(one.features)!;
    expect(box.max[0]).toBeLessThanOrEqual(R + 1e-3);
    expect(box.min[0]).toBeGreaterThanOrEqual(-R - 1e-3);
    const dir = await mkdtemp(join(tmpdir(), 'gteki-overlay-')); dirs.push(dir);
    await writeOverlayGlb(join(dir, 'c.glb'), [{ kind: 'railway', width_m: 1.5, features: one.features }], { ...meta, feature_hashes_sha256: {} });
    expect(sha((await readFile(join(dir, 'c.glb'))).toString('latin1'))).toBe('25b017fa766c1ddcd1c1b69016a91e1a1ddcea9bc2fb3ca54c6bb78cb4df1028');
  });
  it('the receipt carries the clip block, the note and the clipped geometry bbox', async () => {
    const { features, counts, sourceValues } = await select(await fixtureCollection(), 'railway', 32.5, R);
    const r = publicOverlayReceipt({
      run_id: 'overlay-x', station_id: 'ikebukuro', frame: {}, window: {}, z: {}, credit: 'SYNTHETIC credit',
      source: { source_id: 'ksj-n02-2025', source_sha256: 'a'.repeat(64), bytes: 1, license_name: 'CC BY 4.0', license_url: null, publish_gate: 'CONDITIONAL' },
      layers: [counts], feature_hashes: { railway: features.map((f) => f.feature_hash) }, bbox: overlayBBox(features), outputs: {}, tool_input_sha256: 'd'.repeat(64), policy_version: 'context-overlay-v1', clip: { kind: 'origin_disc', radius_m: R },
    }, sourceValues) as Record<string, any>;
    expect(r.clip).toEqual({ kind: 'origin_disc', radius_m: R, center: 'station frame origin', features_clipped: 1, vertices_before: 8, vertices_after: 8 });
    expect(r.note).toContain('clipped to a 250 m disc');
    expect(r.note).toContain('not the full source line');
    expect(r.bbox_local_ENU.max[0]).toBeLessThanOrEqual(R + 1e-3);
    const off = publicOverlayReceipt({ run_id: 'x', station_id: 'ikebukuro', frame: {}, window: {}, z: {}, credit: 'c', source: r.source, layers: [(await select(await fixtureCollection())).counts], feature_hashes: {}, bbox: null, outputs: {}, tool_input_sha256: 'd'.repeat(64), policy_version: 'v', clip: { kind: 'none', radius_m: null } }, new Set()) as Record<string, any>;
    expect(off.clip).toMatchObject({ kind: 'none', radius_m: null, features_clipped: 0 });
    expect(off.note).toContain('not clipped');
  });
  it('--clip-radius 0 and none are accepted by the CLI parser path (config default is overridden)', async () => {

    const dir = await mkdtemp(join(tmpdir(), 'gteki-overlay-cli-')); dirs.push(dir);
    const run = async (...args: string[]): Promise<string> => {
      try { await promisify(execFile)(join(pkg, 'node_modules', '.bin', 'tsx'), ['src/cli.ts', 'context-overlay', ...args], { cwd: pkg, env: { ...process.env, GTEKI_GIS_STORE: join(dir, 'store') } }); return 'ok'; }
      catch (error) { return (error as { stderr?: string }).stderr ?? String(error); }
    };
    // Past argument validation the run reaches the (empty) store and fails there, not on --clip-radius.
    for (const v of ['0', 'none', '500']) expect(await run('ikebukuro', '--clip-radius', v)).not.toContain('--clip-radius must be');
  }, 60_000);
});

describe('context-overlay: border rings (KSJ N03)', () => {
  // Synthetic attribute values in the N03 field shape: none of them is source data.
  const WARD_NAME = '合成市', WARD_CODE = '999999', OTHER_CODE = '888888';
  const borderLayer = { source_id: 'ksj-n03-2026', kind: 'border' as const, member: 'synthetic-n03.geojson', ribbon_width_m: 2, geometry: 'polygon_rings' as const, select: { kind: 'municipality_code' as const, property: 'N03_007', code: WARD_CODE } };
  const borderMeta: OverlayMeta = { station_id: 'ikebukuro', frame_label: 'ikebukuro-station-enu-v0', credit: 'SYNTHETIC credit', source_id: 'ksj-n03-2026', source_sha256: 'a'.repeat(64), z_m: 32.5, z_basis: 'render z = street floor renderElevationM', window_label: 'origin_disc 700 m' };
  async function rect(e0: number, n0: number, e1: number, n1: number): Promise<number[][]> {
    return [await at(e0, n0), await at(e1, n0), await at(e1, n1), await at(e0, n1), await at(e0, n0)];
  }
  /** One MultiPolygon municipality containing the origin and one Polygon neighbour that does not. */
  async function borderCollection(): Promise<Record<string, unknown>> {
    const feature = (code: string, coordinates: unknown, type: string) => ({ type: 'Feature', properties: { N03_004: WARD_NAME, N03_007: code }, geometry: { type, coordinates } });
    return {
      type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::6668' } },
      features: [feature(WARD_CODE, [[await rect(-500, -500, 500, 500)]], 'MultiPolygon'), feature(OTHER_CODE, [await rect(800, -500, 1400, 500)], 'Polygon')],
    };
  }
  async function selectBorder(collection: unknown, clip: number | null = null) {
    const window = originDiscWindow({ kind: 'origin_disc', radius_m: 700 });
    const input: LayerInput = { layer: borderLayer, sourceSha256: 'a'.repeat(64), memberSha256: 'b'.repeat(64), collection };
    return { window, ...selectLayer(input, await projection(), window, 32.5, clip) };
  }

  it("reads Polygon and MultiPolygon rings as closed lines and keeps only the station municipality's polygon", async () => {
    const { features, counts } = await selectBorder(await borderCollection());
    expect(counts).toMatchObject({ features_in_source: 2, outside_selection: 1, selected: 1 });
    expect(features).toHaveLength(1);
    expect(features[0]!.kind).toBe('border');
    const ring = features[0]!.parts[0]!;
    expect(ring).toHaveLength(5);
    expect([ring[0]![0], ring[0]![1]]).toEqual([ring[4]![0], ring[4]![1]]); // the ring is closed
    expect(ring.every((p) => p[2] === 32.5)).toBe(true);
    expect(new Set(features[0]!.parts.flat().map((p) => p[2]))).toEqual(new Set([32.5]));
  });

  it('clips the rings to the 700 m disc: every vertex inside and the source hash unchanged', async () => {
    // A wide municipality ring: its top and bottom edges pass 300 m from the origin, its sides are 1200 m out.
    const big = { type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::6668' } }, features: [{ type: 'Feature', properties: { N03_004: WARD_NAME, N03_007: WARD_CODE }, geometry: { type: 'MultiPolygon', coordinates: [[await rect(-1200, -300, 1200, 300)]] } }] };
    const whole = await selectBorder(big), clipped = await selectBorder(big, 700);
    expect(clipped.counts).toMatchObject({ selected_before_clip: 1, selected: 1, features_clipped: 1, dropped_by_clip: 0 });
    expect(clipped.features[0]!.parts).toHaveLength(2);
    for (const line of clipped.features[0]!.parts) for (const p of line) expect(Math.hypot(p[0]!, p[1]!)).toBeLessThanOrEqual(700 + 1e-3);
    expect(clipped.features[0]!.vertices_before_clip).toBe(5);
    expect(clipped.features[0]!.feature_hash).toBe(whole.features[0]!.feature_hash);
  });

  it('carries no N03 property: the allow-list only, and no source key or value in the GeoJSON, GLB or receipt', async () => {
    const { features, sourceValues, counts } = await selectBorder(await borderCollection());
    const text = overlayGeoJson(features, borderMeta);
    for (const f of (JSON.parse(text) as { features: Array<{ properties: Record<string, unknown> }> }).features) expect(Object.keys(f.properties).sort()).toEqual([...OVERLAY_PROPERTY_KEYS]);
    for (const needle of [WARD_NAME, WARD_CODE, OTHER_CODE, 'N03_', '"N03_007"']) expect(text).not.toContain(needle);
    expect(() => assertNoSourceValues(text, sourceValues, 'geojson')).not.toThrow();
    const dir = await mkdtemp(join(tmpdir(), 'gteki-overlay-')); dirs.push(dir);
    const path = join(dir, 'border.glb');
    const glb = await writeOverlayGlb(path, [{ kind: 'border', width_m: 2, features }], { ...borderMeta, feature_hashes_sha256: {} });
    expect(glb.triangles).toEqual({ ctx_border_all: 2 * 4 });
    const glbText = (await readFile(path)).toString('latin1') + JSON.stringify((await new NodeIO().readBinary(await readFile(path))).getRoot().listNodes().map((n) => n.getExtras()));
    for (const needle of [WARD_CODE, OTHER_CODE, 'N03_']) expect(glbText).not.toContain(needle);
    expect(glbText).not.toContain(WARD_NAME);
    const r = publicOverlayReceipt({
      run_id: 'overlay-border', station_id: 'ikebukuro', frame: {}, window: { kind: 'origin_disc', radius_m: 700 }, z: {}, credit: borderMeta.credit,
      source: { source_id: 'ksj-n03-2026', source_sha256: 'a'.repeat(64), bytes: 1, license_name: 'CC BY 4.0', license_url: null, publish_gate: 'CONDITIONAL' },
      layers: [counts], feature_hashes: { border: features.map((f) => f.feature_hash) }, bbox: overlayBBox(features), outputs: {}, tool_input_sha256: 'd'.repeat(64), policy_version: 'context-overlay-v1', clip: { kind: 'origin_disc', radius_m: 700 },
    }, sourceValues) as Record<string, any>;
    expect(r.totals).toMatchObject({ selected: 1, outside_selection: 1 });
    expect(r.layers[0].kind).toBe('border');
    expect(r.note).toContain('municipality');
    for (const needle of [WARD_NAME, WARD_CODE, OTHER_CODE, 'N03_']) expect(JSON.stringify(r)).not.toContain(needle);
  });

  it('the registered N03-2026 credit carries the page notice verbatim', () => {
    const source = loadSources().find((s) => s.source_id === 'ksj-n03-2026')!;
    expect(source.license_name).toBe('CC BY 4.0');
    expect(source.publish_gate).toBe('CONDITIONAL');
    expect(source.attribution_text).toContain('出典：国土交通省国土数値情報ダウンロードサイト（https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html）を加工して作成');
    expect(source.attribution_text).toContain('測量法に基づく国土地理院長承認（複製）R 7JHf 351');
    expect(source.expected_url).toBe('https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2026/N03-20260101_13_GML.zip');
    expect(source.expected_url_match).toBe(true);
    // The credit with the notice passes the leak guard of the synthetic border fixture it ships with.
    const r = publicOverlayReceipt({
      run_id: 'r', station_id: 'ikebukuro', frame: {}, window: {}, z: {}, credit: source.attribution_text,
      source: { source_id: 'ksj-n03-2026', source_sha256: 'a'.repeat(64), bytes: 1, license_name: 'CC BY 4.0', license_url: null, publish_gate: 'CONDITIONAL' },
      layers: [], feature_hashes: {}, bbox: null, outputs: {}, tool_input_sha256: 'd'.repeat(64), policy_version: 'v', clip: { kind: 'none', radius_m: null },
    }, new Set()) as Record<string, any>;
    expect(r.credit).toContain('R 7JHf 351');
  });

  it('selects with the config window: one 700 m origin disc, a 650 m line in and a 750 m line out', async () => {
    expect(originDiscWindow({ kind: 'origin_disc', radius_m: 700 })).toMatchObject({ spec: { r_origin_m: 700, r_exit_m: 0, node_rule: null }, discs: [{ x: 0, y: 0, r: 700, origin: 'origin', id: 'origin' }], graph: null });
    const near = { type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::6668' } }, features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [await at(-650, 0), await at(650, 0)] } }] };
    const far = { type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::6668' } }, features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [await at(-100, 730), await at(100, 730)] } }] };
    const input = (collection: unknown): LayerInput => ({ layer: { ...layer, source_id: 'ksj-n02-2025' }, sourceSha256: 'a'.repeat(64), memberSha256: 'b'.repeat(64), collection });
    const window = originDiscWindow({ kind: 'origin_disc', radius_m: 700 });
    expect(selectLayer(input(near), await projection(), window, 32.5).counts).toMatchObject({ selected: 1, outside_window: 0 });
    expect(selectLayer(input(far), await projection(), window, 32.5).counts).toMatchObject({ selected: 0, outside_window: 1 });
    for (const station of ['ikebukuro', 'shinjuku']) {
      const overlay = assertOverlayConfig(station, (await loadContextConfig(station) as { overlay?: unknown }).overlay);
      expect(overlay.window).toEqual({ kind: 'origin_disc', radius_m: 700 });
      expect(overlay.layers.find((l) => l.kind === 'border')).toMatchObject({ source_id: 'ksj-n03-2026', member: 'N03-20260101_13.geojson', geometry: 'polygon_rings', select: { kind: 'municipality_code', property: 'N03_007', code: station === 'ikebukuro' ? '13116' : '13104' } });
    }
  });

  it('accepts border in --kinds and rejects a border layer without ring reading or origin selection', () => {
    expect(parseOverlayKinds('border')).toEqual(['border']);
    expect(parseOverlayKinds('station,railway,border')).toEqual(['station', 'railway', 'border']);
    const good = { frame: { mode: 'origin-only', station_json: 'stations/x/gteki/station.json' }, z: { mode: 'constant', z_m: 0, basis: 'b', datum_asserted: false, check: { path: 'p', floor_ordinal: 0, field: 'renderElevationM' } }, layers: [borderLayer] };
    expect(() => assertOverlayConfig('x', good)).not.toThrow();
    expect(() => assertOverlayConfig('x', { ...good, layers: [{ ...borderLayer, geometry: 'lines' }] })).toThrow(/border layer/);
    expect(() => assertOverlayConfig('x', { ...good, layers: [{ ...borderLayer, select: undefined }] })).toThrow(/border layer/);
    expect(() => assertOverlayConfig('x', { ...good, layers: [{ ...borderLayer, select: { kind: 'municipality_code', property: 'N03_007', code: '' } }] })).toThrow(/select for x/);
    expect(() => assertOverlayConfig('x', { ...good, window: { kind: 'origin_disc', radius_m: 0 } })).toThrow(/overlay.window/);
  });
});
