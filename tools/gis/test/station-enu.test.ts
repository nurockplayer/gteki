import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadFrame, toLocal } from '../src/crs.js';
import { assertStationEnuFrame, createStationEnuFrame, isStationEnuFrame, projectorOrigin, stationEnuProjector, stationHorizontal, stationLocal, type StationEnuFrame } from '../src/station-enu.js';

const vectors = JSON.parse(await readFile(fileURLToPath(new URL('./fixtures/station-enu-vectors.json', import.meta.url)), 'utf8')) as {
  produced_by: string; tolerance_m: number;
  origins: Array<{ id: string; origin: { lat: number; lon: number; hM: number }; points: Array<{ distance_m: number; lat: number; lon: number; h: number; expected: { x: number; y: number; z: number } }> }>;
};
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function stationsRoot(origin: unknown): Promise<{ root: string; file: string }> {
  const root = await mkdtemp(join(tmpdir(), 'gteki-stations-')); dirs.push(root);
  await mkdir(join(root, 'demo', 'gteki'), { recursive: true });
  const file = join(root, 'demo', 'gteki', 'station.json');
  await writeFile(file, JSON.stringify({ schema: 'gteki.station/0.1', station: { id: 'demo', origin } }, null, 2));
  return { root, file };
}

describe('station-enu projection (port of packages/geo StationFrame)', () => {
  it('records how the reference vectors were produced and covers 0, 250 and 435 m', () => {
    expect(vectors.produced_by).toMatch(/packages\/geo\/src\/index\.ts StationFrame\.toLocal/);
    expect(vectors.tolerance_m).toBe(0.001);
    for (const origin of vectors.origins) expect([...new Set(origin.points.map((p) => p.distance_m))].sort((a, b) => a - b)).toEqual([0, 250, 435]);
  });

  it.each(vectors.origins.flatMap((origin) => origin.points.map((point) => ({ id: origin.id, origin: origin.origin, point }))))('matches the packages/geo vector for $id at $point.distance_m m within 1 mm', ({ origin, point }) => {
    const [x, y, z] = stationEnuProjector(origin)(point.lat, point.lon, point.h);
    expect(Math.abs(x - point.expected.x)).toBeLessThan(1e-3);
    expect(Math.abs(y - point.expected.y)).toBeLessThan(1e-3);
    expect(Math.abs(z - point.expected.z)).toBeLessThan(1e-3);
    // The pinned distance really is the horizontal distance from the origin.
    expect(Math.abs(Math.hypot(x, y) - point.distance_m)).toBeLessThan(1e-3);
  });

  it('keeps z = height - hM and a horizontal position independent of the point height', () => {
    const project = stationEnuProjector({ lat: 35.7297, lon: 139.7114, hM: 12 });
    const low = project(35.731, 139.713, 0), high = project(35.731, 139.713, 80);
    expect(high[0]).toBe(low[0]); expect(high[1]).toBe(low[1]);
    expect(low[2]).toBe(-12); expect(high[2]).toBe(68);
    const origin = project(35.7297, 139.7114, 12);
    expect(Math.abs(origin[0]) + Math.abs(origin[1]) + Math.abs(origin[2])).toBeLessThan(1e-9);
  });

  it('is what crs.toLocal uses for a station-enu frame, and enforces the EPSG:6697 axis guard', async () => {
    const frame = await loadFrame('ikebukuro-station-enu-v0');
    expect(isStationEnuFrame(frame)).toBe(true);
    const point = [35.7312, 139.7131, 27.4];
    expect(toLocal(point, frame)).toEqual(stationLocal(point, frame as never));
    expect(() => toLocal([139.7131, 35.7312, 27.4], frame)).toThrow(/latitude,longitude,height/);
  });
});

describe('station-enu frame creation', () => {
  it('reads station.json read-only, records its sha256 and keeps the truth flags', async () => {
    const { root, file } = await stationsRoot({ lat: 35.7297, lon: 139.7114, hM: 0, datum: 'JGD2011', crs: 'EPSG:6697' });
    const before = await readFile(file);
    const frame = await createStationEnuFrame('demo', 'demo-station-enu-v0', { stationsRoot: root, writeFrame: false });
    expect(frame).toMatchObject({ frame_kind: 'station-enu', station_id: 'demo', source_crs: 'EPSG:6697', verification: 'UNVERIFIED', navigation_use: 'NOT_FOR_ROUTING', origin: { lat: 35.7297, lon: 139.7114, hM: 0 } });
    expect(frame.station_json_sha256).toBe(createHash('sha256').update(before).digest('hex'));
    expect(await readFile(file)).toEqual(before);
    expect(() => assertStationEnuFrame(frame)).not.toThrow();
  });

  it('refuses an undecided vertical anchor (hM null, as Shinjuku) and a non-6697 CRS instead of defaulting', async () => {
    const symbolic = await stationsRoot({ lat: 35.687, lon: 139.6994, hM: null, datum: 'JGD2011', crs: 'EPSG:6668' });
    await expect(createStationEnuFrame('demo', 'demo-v0', { stationsRoot: symbolic.root, writeFrame: false })).rejects.toThrow(/vertical anchor of demo is undecided/);
    const wrongCrs = await stationsRoot({ lat: 35.687, lon: 139.6994, hM: 0, datum: 'JGD2011', crs: 'EPSG:6668' });
    await expect(createStationEnuFrame('demo', 'demo-v0', { stationsRoot: wrongCrs.root, writeFrame: false })).rejects.toThrow(/require EPSG:6697/);
    await expect(createStationEnuFrame('../evil', 'x', { stationsRoot: wrongCrs.root, writeFrame: false })).rejects.toThrow(/Invalid station id/);
  });

  it('commits an Ikebukuro frame that validates and matches the vector-fixture origin', async () => {
    const frame = await loadFrame('ikebukuro-station-enu-v0');
    if (!isStationEnuFrame(frame)) throw new Error('expected a station-enu frame');
    expect(frame.origin).toMatchObject(vectors.origins.find((o) => o.id === 'ikebukuro')!.origin);
    expect(frame.station_json_path).toBe('stations/ikebukuro/gteki/station.json');
  });
});

describe('per_feature_ground frame (Shinjuku: no vertical datum; decision #39 comment 6324045059)', () => {
  const shinjukuOrigin = { lat: 35.687, lon: 139.6994, hM: null, datum: 'JGD2011', crs: 'EPSG:6668' };

  it('is opt-in: reads station.json read-only, keeps hM null and EPSG:6668, and the default path still refuses', async () => {
    const { root, file } = await stationsRoot(shinjukuOrigin);
    const before = await readFile(file);
    const frame = await createStationEnuFrame('demo', 'demo-station-enu-v0', { stationsRoot: root, writeFrame: false, verticalMode: 'per_feature_ground' });
    expect(frame).toMatchObject({ frame_kind: 'station-enu', vertical_mode: 'per_feature_ground', horizontal_origin_height_m: 0, origin: { lat: 35.687, lon: 139.6994, hM: null, datum: 'JGD2011', crs: 'EPSG:6668' }, source_crs: 'EPSG:6697', ellipsoid: 'GRS80', navigation_use: 'NOT_FOR_ROUTING', verification: 'UNVERIFIED' });
    expect(frame.vertical).toMatch(/no vertical datum/);
    expect(frame.horizontal).toMatch(/JGD2011 horizontal datum/);
    expect(frame.station_json_sha256).toBe(createHash('sha256').update(before).digest('hex'));
    expect(await readFile(file)).toEqual(before);
    expect(() => assertStationEnuFrame(frame)).not.toThrow();
    await expect(createStationEnuFrame('demo', 'demo-v0', { stationsRoot: root, writeFrame: false })).rejects.toThrow(/vertical anchor of demo is undecided/);
  });

  it('refuses per_feature_ground for a numeric hM, a foreign CRS or datum, and an unknown mode', async () => {
    const numeric = await stationsRoot({ ...shinjukuOrigin, hM: 0 });
    await expect(createStationEnuFrame('demo', 'demo-v0', { stationsRoot: numeric.root, writeFrame: false, verticalMode: 'per_feature_ground' })).rejects.toThrow(/hM is null on purpose|origin\.hM is 0/);
    const crs = await stationsRoot({ ...shinjukuOrigin, crs: 'EPSG:4326' });
    await expect(createStationEnuFrame('demo', 'demo-v0', { stationsRoot: crs.root, writeFrame: false, verticalMode: 'per_feature_ground' })).rejects.toThrow(/accept EPSG:6668 or EPSG:6697/);
    const datum = await stationsRoot({ ...shinjukuOrigin, datum: 'Tokyo' });
    await expect(createStationEnuFrame('demo', 'demo-v0', { stationsRoot: datum.root, writeFrame: false, verticalMode: 'per_feature_ground' })).rejects.toThrow(/require JGD2011/);
    const ok = await stationsRoot(shinjukuOrigin);
    await expect(createStationEnuFrame('demo', 'demo-v0', { stationsRoot: ok.root, writeFrame: false, verticalMode: 'bogus' as never })).rejects.toThrow(/Unsupported vertical mode/);
  });

  it('commits a Shinjuku frame equal to what station-frame --vertical per_feature_ground derives from the committed station.json (apart from the recorded station.json hash)', async () => {
    const frame = await loadFrame('shinjuku-station-enu-v0');
    if (!isStationEnuFrame(frame)) throw new Error('expected a station-enu frame');
    expect(frame.station_json_path).toBe('stations/shinjuku/gteki/station.json');
    const station = await readFile(fileURLToPath(new URL('../../../stations/shinjuku/gteki/station.json', import.meta.url))).catch(() => null);
    if (station === null) return; // standalone checkout without stations/
    const derived = await createStationEnuFrame('shinjuku', 'shinjuku-station-enu-v0', { writeFrame: false, verticalMode: 'per_feature_ground' });
    const { station_json_sha256: _a, ...committed } = frame; const { station_json_sha256: _b, ...fresh } = derived;
    expect(committed).toEqual(fresh);
    expect(Object.keys(frame)).toEqual(Object.keys(derived)); // same file shape, so `gis station-frame` reproduces it byte for byte
    expect(frame.origin).toEqual({ lat: 35.687, lon: 139.6994, hM: null, datum: 'JGD2011', crs: 'EPSG:6668' });
  });

  it('projects horizontally exactly like an Ikebukuro-style TP frame at that origin, refuses a vertical z, and refuses mismatched frames', async () => {
    const frame = await loadFrame('shinjuku-station-enu-v0') as StationEnuFrame;
    expect(projectorOrigin(frame)).toEqual({ lat: 35.687, lon: 139.6994, hM: 0 });
    const tp = stationEnuProjector({ lat: 35.687, lon: 139.6994, hM: 0 });
    for (const [lat, lon, h] of [[35.687, 139.6994, 31], [35.6889, 139.6981, 44.4], [35.6841, 139.7017, 29.9]] as const) {
      const [x, y] = stationHorizontal([lat, lon, h], frame), [ex, ey] = tp(lat, lon, h);
      expect(x).toBe(ex); expect(y).toBe(ey);
    }
    expect(stationHorizontal([35.687, 139.6994, 31], frame).map((v) => Math.abs(v))).toEqual([0, 0]); // the origin maps to (0, 0)
    expect(Math.abs(stationHorizontal([35.688, 139.6994, 0], frame)[1] - 111)).toBeLessThan(1); // ~111 m per 0.001 deg of latitude
    expect(() => stationLocal([35.687, 139.6994, 31], frame)).toThrow(/defines no vertical datum/);
    expect(() => toLocal([35.687, 139.6994, 31], frame)).toThrow(/defines no vertical datum/);
    expect(() => stationEnuProjector(frame.origin)).toThrow(/needs a numeric hM/);
    expect(() => assertStationEnuFrame({ ...frame, origin: { ...frame.origin, hM: 5 } })).toThrow(/hM null/);
    expect(() => assertStationEnuFrame({ ...frame, horizontal_origin_height_m: undefined })).toThrow(/horizontal_origin_height_m must be a finite number/);
    expect(() => assertStationEnuFrame({ ...frame, vertical_mode: 'other' as never })).toThrow(/unsupported vertical_mode/);
    const { vertical_mode: _v, ...noMode } = frame;
    expect(() => assertStationEnuFrame(noMode as StationEnuFrame)).toThrow(/horizontal_origin_height_m is only valid with vertical_mode|origin needs finite lat, lon, hM/);
    expect(() => projectorOrigin(noMode as StationEnuFrame)).toThrow(/vertical anchor is undecided/);
  });

  it('does not change a TP frame: the default creation emits exactly the committed Ikebukuro keys and no new fields', async () => {
    const { root } = await stationsRoot({ lat: 35.7297, lon: 139.7114, hM: 0, datum: 'JGD2011', crs: 'EPSG:6697' });
    const fresh = await createStationEnuFrame('demo', 'demo-station-enu-v0', { stationsRoot: root, writeFrame: false });
    const committed = JSON.parse(await readFile(fileURLToPath(new URL('../frames/ikebukuro-station-enu-v0.json', import.meta.url)), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(fresh)).toEqual(Object.keys(committed));
    for (const key of ['frame_kind', 'source_crs', 'ellipsoid', 'horizontal', 'vertical', 'axis_order', 'navigation_use', 'purpose', 'verification', 'origin']) expect((fresh as unknown as Record<string, unknown>)[key]).toEqual(committed[key]);
    expect('vertical_mode' in fresh || 'horizontal_origin_height_m' in fresh).toBe(false);
  });
});
