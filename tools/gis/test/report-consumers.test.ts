import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ reports: new Map<string, any>(), writes: vi.fn(), fingerprint: 'f'.repeat(64) }));
vi.mock('../src/common.js', () => ({
  docsRoot: '/fixture/docs', writeJson: fixture.writes,
  getStoredSource: async (id: string) => ({ path: id, record: { source_id: id, sha256: 'b'.repeat(64) } }),
  readJson: async (path: string) => {
    if (path.includes('/overlap/')) {
      const report = fixture.reports.get(`overlap-${path.split('/').at(-1)!.replace(/\.json$/, '')}`);
      if (!report) throw new Error('no optional overlap fixture');
      return report;
    }
    return fixture.reports.get(path.split('/').at(-1)!.replace(/\.json$/, '')) ?? {
    source_id: 'synthetic', source_sha256: 'b'.repeat(64), envelope: null, crs: { status: 'UNKNOWN', value: null }, members: [], bbox: null,
    };
  },
}));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), writeFile: fixture.writes }));
vi.mock('../src/provenance.js', () => ({ toolFingerprint: async () => fixture.fingerprint }));
vi.mock('../src/poi.js', () => ({ verifyPoiEvidence: async () => ({ status: 'PASS', errors: [] }) }));
vi.mock('../src/vintage.js', () => ({ verifyVintageEvidence: async (r: any) => ({ status: r.input_sources.some((s: any) => s.sha256 !== 'b'.repeat(64)) ? 'FAIL' : 'PASS', errors: ['stale vintage input'] }) }));
vi.mock('../src/acquire.js', () => ({ loadSources: () => [] }));
vi.mock('../src/r1.js', () => ({ r1GeoEvidence: async () => ({
  node: { record: { source_id: 'synthetic-node' } }, link: { record: { source_id: 'synthetic-link' } },
  node_bbox: null, link_bbox: null, nodes: { features: [] }, links: { features: [] }, crs: { value: null, status: 'UNKNOWN' },
}) }));
vi.mock('../src/coverage.js', () => ({ catalogCoverage: () => ({ older_vintages: {}, hold: 'HOLD' }), r1BboxContainment: () => null }));

import { generateOverlapReports } from '../src/overlap.js';
import { gapPacket } from '../src/gaps.js';

const poiIds = ['toei-stores-shinjuku-csv', 'toei-stores-shinjuku-nishiguchi-csv', 'tokyo-shinjuku-facilities-zip', 'tokyo-shinjuku-facilities-spec-pdf', 'plateau-13104-related-2025', 'plateau-13116-related-2025'];
// Network report file -> report identity (the CSV pair report has a combined node+link identity).
const networkReports: Record<string, string> = {
  'hokonavi-ikebukuro-walk-node-csv': 'hokonavi-ikebukuro-walk-node-csv+hokonavi-ikebukuro-walk-link-csv',
  'hokonavi-oedo-shinjuku-network-geojson': 'hokonavi-oedo-shinjuku-network-geojson',
  'hokonavi-oedo-shinjuku-stationmap-geojson': 'hokonavi-oedo-shinjuku-stationmap-geojson',
};
beforeEach(() => {
  fixture.writes.mockClear(); fixture.reports.clear();
  for (const id of poiIds) fixture.reports.set(id, {
    source_id: id, source_sha256: 'b'.repeat(64), tool_input_sha256: fixture.fingerprint,
    input_sources: [id, ...(id === 'tokyo-shinjuku-facilities-zip' ? ['tokyo-shinjuku-facilities-spec-pdf'] : [])].map(source_id => ({ source_id, sha256: 'b'.repeat(64) })),
    station_ids: ['shinjuku'], members: [{ file: 'point', feature_count: 1, bbox: [139.7, 35.7, 139.7, 35.7], crs_status: 'DECLARED', crs: { properties: { name: 'EPSG:6668' } } }],
  });
  for (const [file, source_id] of Object.entries(networkReports)) fixture.reports.set(file, {
    source_id, source_sha256: source_id.includes('+') ? `${'b'.repeat(64)}+${'b'.repeat(64)}` : 'b'.repeat(64), tool_input_sha256: fixture.fingerprint,
    input_sources: [file, ...(source_id.includes('+') ? ['hokonavi-ikebukuro-walk-link-csv'] : [])].map(id => ({ source_id: id, sha256: 'b'.repeat(64) })), envelope: null, crs: { status: 'UNKNOWN', value: null }, members: [], bbox: null,
  });
  fixture.reports.set('shinjuku-2023', {
    source_id: 'plateau-13104-package-2023', package_sha256: 'b'.repeat(64), tool_input_sha256: fixture.fingerprint,
    input_sources: [{ source_id: 'plateau-13104-package-2023', sha256: 'b'.repeat(64) }], archives: [], selected_member_records: [],
  });
});

it.each(['fingerprint', 'input hash'])('rejects a stale second-station overlap %s before any gap output', async field => {
  fixture.reports.set('overlap-shinjuku', {
    station_id: 'shinjuku', layers: [], pairs: [], tool_input_sha256: field === 'fingerprint' ? 'a'.repeat(64) : fixture.fingerprint,
    input_sources: [{ source_id: 'plateau-13104-related-2025', sha256: field === 'input hash' ? 'a'.repeat(64) : 'b'.repeat(64) }],
  });
  await expect(gapPacket()).rejects.toThrow(/Stale overlap/);
  expect(fixture.writes).not.toHaveBeenCalled();
});

it('retains validated acquisition lineage in gap documents', async () => {
  await gapPacket();
  for (const [, report] of fixture.writes.mock.calls.filter(([path]) => path.endsWith('.json'))) {
    expect(report.input_sources).toEqual(expect.arrayContaining([{ source_id: 'plateau-13104-related-2025', sha256: 'b'.repeat(64) }, { source_id: 'plateau-13104-package-2023', sha256: 'b'.repeat(64) }]));
  }
});

it.each(['UNKNOWN', 'MIXED', 'UNSUPPORTED_DECLARED_CRS'])('does not promote a residual POI CRS name with %s status to KNOWN', async status => {
  fixture.reports.get('plateau-13104-related-2025').members[0].crs_status = status;
  const reports = await generateOverlapReports();
  const layer = reports[1]!.layers.find(l => l.source_id === 'plateau-13104-related-2025')!;
  expect(layer.metric_status).toBe('UNKNOWN');
  expect(layer.source_crs).toBeNull();
  expect(layer.crs_status).toBe(status);
});

describe.each([['overlap', generateOverlapReports], ['gap packet', gapPacket]] as const)('%s inspection freshness', (_name, generate) => {
  it.each(['tokyo-shinjuku-facilities-zip', 'plateau-13104-related-2025', 'plateau-13116-related-2025'])('rejects stale POI acquisition %s before writing', async id => {
    fixture.reports.get(id).source_sha256 = 'a'.repeat(64);
    await expect(generate()).rejects.toThrow('Stale POI inspection source SHA-256');
    expect(fixture.writes).not.toHaveBeenCalled();
  });
  it('rejects stale vintage package before writing', async () => {
    fixture.reports.get('shinjuku-2023').package_sha256 = 'a'.repeat(64);
    await expect(generate()).rejects.toThrow('Stale 2023 vintage package SHA-256');
    expect(fixture.writes).not.toHaveBeenCalled();
  });
  it('rejects stale POI specification lineage before writing', async () => {
    fixture.reports.get('tokyo-shinjuku-facilities-zip').input_sources[1].sha256 = 'a'.repeat(64);
    await expect(generate()).rejects.toThrow('Stale POI inspection input source SHA-256');
    expect(fixture.writes).not.toHaveBeenCalled();
  });
  it.each([
    ['hokonavi-ikebukuro-walk-node-csv', 'old tool fingerprint', (r: any) => { r.tool_input_sha256 = 'a'.repeat(64); }, 'Stale network inspection tool fingerprint'],
    ['hokonavi-ikebukuro-walk-node-csv', 'changed link acquisition inside the pair hash', (r: any) => { r.source_sha256 = `${'b'.repeat(64)}+${'a'.repeat(64)}`; }, 'Stale network inspection source SHA-256'],
    ['hokonavi-oedo-shinjuku-network-geojson', 'old tool fingerprint', (r: any) => { r.tool_input_sha256 = 'a'.repeat(64); }, 'Stale network inspection tool fingerprint'],
    ['hokonavi-oedo-shinjuku-network-geojson', 'stale lineage hash', (r: any) => { r.input_sources[0].sha256 = 'a'.repeat(64); }, 'Stale network inspection input source SHA-256'],
    ['hokonavi-ikebukuro-walk-node-csv', 'different report identity', (r: any) => { r.source_id = 'hokonavi-oedo-shinjuku-network-geojson'; }, 'Network inspection source_id mismatch'],
  ] as const)('rejects stale network report %s (%s) with an unchanged acquisition SHA before writing', async (file, _label, mutate, message) => {
    // Only the report's own tool/lineage/identity change; the acquisition itself is unchanged.
    expect(fixture.reports.get(file).source_sha256).toMatch(/^b{64}(\+b{64})?$/);
    mutate(fixture.reports.get(file));
    await expect(generate()).rejects.toThrow(message);
    expect(fixture.writes).not.toHaveBeenCalled();
  });
  it('rejects a stale station-map network report before overlap writes', async () => {
    fixture.reports.get('hokonavi-oedo-shinjuku-stationmap-geojson').tool_input_sha256 = 'a'.repeat(64);
    if (_name === 'overlap') {
      await expect(generate()).rejects.toThrow('Stale network inspection tool fingerprint');
      expect(fixture.writes).not.toHaveBeenCalled();
    } else await expect(generate()).resolves.toBeDefined(); // the gap packet does not consume the station-map report
  });
  it('accepts validated current reports', async () => {
    await generate();
    expect(fixture.writes).toHaveBeenCalled();
  });
});
