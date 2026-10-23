import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as common from '../src/common.js';
import * as context from '../src/context.js';
import * as zip from '../src/zip.js';
import { loadFrame } from '../src/crs.js';
import { contextOverlay, OVERLAY_POLICY_VERSION, type OverlayFrameConfig } from '../src/context-overlay.js';
import { isStationEnuFrame, stationOriginSha256 } from '../src/station-enu.js';
import { describeZipName } from '../src/zip-names.js';
import { loadSources } from '../src/acquire.js';

// Redirect only the repository root: station.json fixtures and all outputs stay in a temp directory.
vi.mock('../src/common.js', async (importOriginal) => {
  const actual = await importOriginal<typeof common>();
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { ...actual, repoRoot: await mkdtemp(join(tmpdir(), 'gteki-overlay-run-')) };
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await rm(common.repoRoot, { recursive: true, force: true }); });
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const evidenceField = 'floors[ordinal 0].renderElevationM';

async function setup(mode: OverlayFrameConfig['mode']) {
  const frame = await loadFrame('ikebukuro-station-enu-v0');
  if (!isStationEnuFrame(frame)) throw new Error('expected station-enu frame');
  const stationPath = join(common.repoRoot, frame.station_json_path);
  await mkdir(join(common.repoRoot, 'stations', 'ikebukuro', 'gteki'), { recursive: true });
  const station = { station: { id: 'ikebukuro', origin: { ...frame.origin } }, floors: [{ ordinal: 0, renderElevationM: 32.5 }], assets: [] as string[] };
  const save = () => writeFile(stationPath, JSON.stringify(station));
  await save();
  const config = await context.loadContextConfig('ikebukuro');
  const overlay = {
    frame: mode === 'station-enu-frame' ? { mode, frame_id: frame.frame_id } : { mode, station_json: frame.station_json_path },
    z: { mode: 'constant', z_m: 32.5, basis: 'render z = street floor renderElevationM', datum_asserted: false, check: { path: frame.station_json_path, floor_ordinal: 0, field: 'renderElevationM' } },
    window: { kind: 'origin_disc', radius_m: 250 },
    layers: [{ source_id: 'ksj-n02-2025', kind: 'railway', member: 'synthetic.geojson', ribbon_width_m: 1.5 }],
  };
  vi.spyOn(context, 'loadContextConfig').mockResolvedValue({ ...config, overlay } as context.StationContextConfig);
  vi.spyOn(common, 'getStoreRoot').mockReturnValue(join(common.repoRoot, 'store'));
  const source = loadSources().find((s) => s.source_id === 'ksj-n02-2025')!;
  const data = Buffer.from(JSON.stringify({
    type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::6668' } },
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[frame.origin.lon, frame.origin.lat], [frame.origin.lon + 0.001, frame.origin.lat]] } }],
  }));
  vi.spyOn(common, 'getStoredSource').mockResolvedValue({ path: 'synthetic.zip', source, record: { sha256: sha(data.toString()), bytes: data.length } } as Awaited<ReturnType<typeof common.getStoredSource>>);
  vi.spyOn(zip, 'readZip').mockResolvedValue([{ name: 'synthetic.geojson', data, ...describeZipName(Buffer.from('synthetic.geojson'), true) }]);
  const run = async () => (await contextOverlay('ikebukuro', { receiptDir: join(common.repoRoot, 'receipts') })).runs[0]!;
  return { station, stationPath, save, overlay, run };
}

describe.each(['station-enu-frame', 'origin-only'] as const)('overlay station.json field hashes (%s)', (mode) => {
  it('keeps the run id and z evidence hash after unrelated edits, including origin key order and datum', async () => {
    const { station, stationPath, save, run } = await setup(mode);
    const beforeBytes = await readFile(stationPath, 'utf8');
    const before = await run();
    station.assets.push('synthetic-kit.glb');
    const { lat, lon, hM, crs } = station.station.origin;
    station.station.origin = { crs, datum: 'informational edit', hM, lon, lat };
    await save();
    expect(sha(await readFile(stationPath, 'utf8'))).not.toBe(sha(beforeBytes));
    const after = await run();
    expect(after.run_id).toBe(before.run_id);
    expect(after.frame).toEqual(before.frame);
    expect(after.frame).toMatchObject({ station_origin_sha256: sha(JSON.stringify({ lat, lon, hM, crs })) });
    expect(after.frame).not.toHaveProperty('station_json_sha256');
    expect(after.z_basis).toEqual(before.z_basis);
    expect(after.z_basis).toMatchObject({ evidence_field: evidenceField, evidence_value_sha256: sha(JSON.stringify({ field: evidenceField, value: 32.5 })) });
    expect(after.z_basis).not.toHaveProperty('evidence_sha256');
    expect(after.policy_version).toBe('context-overlay-v2');
    expect(OVERLAY_POLICY_VERSION).toBe('context-overlay-v2');
  });

  it('rejects a stale z basis, then changes the run id and evidence hash when the height and config agree', async () => {
    const { station, save, overlay, run } = await setup(mode);
    const before = await run();
    station.floors[0]!.renderElevationM = 33.5;
    await save();
    await expect(run()).rejects.toThrow(/z basis no longer matches/);
    overlay.z.z_m = 33.5;
    const after = await run();
    expect(after.run_id).not.toBe(before.run_id);
    expect(after.frame).toEqual(before.frame);
    expect(after.z_basis).toMatchObject({ evidence_value_sha256: sha(JSON.stringify({ field: evidenceField, value: 33.5 })) });
    expect(after.z_basis).not.toEqual(before.z_basis);
  });
});

it('still refuses an origin.lat that no longer matches the stored station frame', async () => {
  const { station, save, run } = await setup('station-enu-frame');
  station.station.origin.lat += 0.001;
  await save();
  await expect(run()).rejects.toThrow(/origin no longer matches frame/);
});

it('uses the same canonical origin hash for numeric and null height origins', () => {
  const origin = { lat: 35.687, lon: 139.6994, hM: null, crs: 'EPSG:6668' };
  expect(stationOriginSha256(origin)).toBe(sha(JSON.stringify(origin)));
  expect(stationOriginSha256({ ...origin, hM: 0 })).not.toBe(stationOriginSha256(origin));
});
