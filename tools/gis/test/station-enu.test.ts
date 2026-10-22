import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadFrame, toLocal } from '../src/crs.js';
import { assertStationEnuFrame, createStationEnuFrame, isStationEnuFrame, stationEnuProjector, stationLocal } from '../src/station-enu.js';

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
