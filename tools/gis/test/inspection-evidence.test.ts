import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  fingerprint: 'f'.repeat(64),
  sources: new Map<string, string>(),
  reportValues: new Map<string, unknown>(),
  poiEvidence: { status: 'PASS' as 'PASS' | 'FAIL', errors: [] as string[] },
  vintageEvidence: { status: 'PASS' as 'PASS' | 'FAIL', errors: [] as string[] },
}));

vi.mock('../src/common.js', () => ({
  docsRoot: '/fixture/docs',
  getStoredSource: async (sourceId: string) => {
    const sha256 = fixture.sources.get(sourceId);
    if (sourceId === 'tokyo-shinjuku-facilities-landing') return { record: { source_id: sourceId, sha256: 'e'.repeat(64) }, path: '/fixture/landing.html' };
    if (!sha256) throw new Error(`missing fixture source ${sourceId}`);
    return { record: { source_id: sourceId, sha256 }, path: `/fixture/${sourceId}` };
  },
  readJson: async (path: string) => {
    const key = path.endsWith('/vintages/shinjuku-2023.json') ? 'vintage' : path.split('/').pop()!.replace(/\.json$/, '');
    const value = fixture.reportValues.get(key);
    if (value === undefined) throw new Error(`missing fixture report ${key}`);
    return value;
  },
}));
vi.mock('../src/provenance.js', () => ({ toolFingerprint: async () => fixture.fingerprint }));
vi.mock('../src/poi.js', () => ({ verifyPoiEvidence: async () => fixture.poiEvidence }));
vi.mock('../src/vintage.js', () => ({ verifyVintageEvidence: async () => fixture.vintageEvidence }));
vi.mock('../src/rights.js', () => ({ htmlText: (value: string) => value }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: async () => '令和２年３月に公開したデータをもとに 令和５年２月２８日（火曜日）' };
});

import { assertPoiInspectionCurrent, assertVintageResearchCurrent } from '../src/inspection-evidence.js';
import { buildPoiResearch } from '../src/poi-research.js';

const sourceId = 'toei-stores-shinjuku-csv';
const sourceSha = 'a'.repeat(64);
const specId = 'tokyo-shinjuku-facilities-spec-pdf';
const specSha = 'b'.repeat(64);
const packageId = 'plateau-13104-package-2023';
const packageSha = 'c'.repeat(64);

function poiReport(overrides: Record<string, unknown> = {}) {
  return {
    source_id: sourceId,
    source_sha256: sourceSha,
    tool_input_sha256: fixture.fingerprint,
    input_sources: [{ source_id: sourceId, sha256: sourceSha }],
    row_count: 1,
    ...overrides,
  };
}

function vintageReport(overrides: Record<string, unknown> = {}) {
  return {
    source_id: packageId,
    package_sha256: packageSha,
    tool_input_sha256: fixture.fingerprint,
    input_sources: [{ source_id: packageId, sha256: packageSha }],
    archives: [], selected_member_records: [],
    ...overrides,
  };
}

beforeEach(() => {
  fixture.sources = new Map([[sourceId, sourceSha], [specId, specSha], [packageId, packageSha]]);
  fixture.reportValues = new Map();
  fixture.poiEvidence = { status: 'PASS', errors: [] };
  fixture.vintageEvidence = { status: 'PASS', errors: [] };
});

describe('inspection evidence freshness', () => {
  it('rejects a stale CSV receipt even when its displayed tool fingerprint is current', async () => {
    const spoofed = poiReport({ source_sha256: '9'.repeat(64), row_count: 999 });
    await expect(assertPoiInspectionCurrent(spoofed, sourceId)).rejects.toThrow('Stale POI inspection source SHA-256');
  });

  it('requires the expected identity and current tool fingerprint', async () => {
    await expect(assertPoiInspectionCurrent(poiReport({ source_id: 'different-source' }), sourceId)).rejects.toThrow('source_id mismatch');
    await expect(assertPoiInspectionCurrent(poiReport({ tool_input_sha256: '0'.repeat(64) }), sourceId)).rejects.toThrow('tool fingerprint');
  });

  it('checks every declared input and requires the report own-source lineage', async () => {
    const staleInput = poiReport({ input_sources: [{ source_id: sourceId, sha256: sourceSha }, { source_id: specId, sha256: '0'.repeat(64) }] });
    await expect(assertPoiInspectionCurrent(staleInput, sourceId)).rejects.toThrow('Stale POI inspection input source SHA-256');
    await expect(assertPoiInspectionCurrent(poiReport({ input_sources: [] }), sourceId)).rejects.toThrow('omits its own acquisition');
  });

  it('requires the current S03 specification lineage for the facilities ZIP', async () => {
    const facilities = {
      source_id: 'tokyo-shinjuku-facilities-zip', source_sha256: 'd'.repeat(64),
      tool_input_sha256: fixture.fingerprint,
      input_sources: [{ source_id: 'tokyo-shinjuku-facilities-zip', sha256: 'd'.repeat(64) }],
    };
    fixture.sources.set('tokyo-shinjuku-facilities-zip', 'd'.repeat(64));
    await expect(assertPoiInspectionCurrent(facilities, 'tokyo-shinjuku-facilities-zip')).rejects.toThrow('omits required S03 specification');
    facilities.input_sources.push({ source_id: specId, sha256: '0'.repeat(64) });
    await expect(assertPoiInspectionCurrent(facilities, 'tokyo-shinjuku-facilities-zip')).rejects.toThrow('Stale POI inspection input source SHA-256');
  });

  it('fails when literal artifact lineage verification fails', async () => {
    fixture.poiEvidence = { status: 'FAIL', errors: ['artifact source hash mismatch'] };
    await expect(assertPoiInspectionCurrent(poiReport(), sourceId)).rejects.toThrow('artifact source hash mismatch');
  });

  it('validates saved inspections inside research preparation before returning report content', async () => {
    const ids = [sourceId, 'toei-stores-shinjuku-nishiguchi-csv', 'tokyo-shinjuku-facilities-zip', specId, 'plateau-13104-related-2025', 'plateau-13116-related-2025'];
    for (const id of ids) {
      const sha = fixture.sources.get(id) ?? 'd'.repeat(64);
      fixture.sources.set(id, sha);
      fixture.reportValues.set(id, { ...poiReport({ source_id: id, source_sha256: sha, input_sources: [{ source_id: id, sha256: sha }] }) });
    }
    fixture.sources.set('tokyo-shinjuku-facilities-zip', 'd'.repeat(64));
    const facilities = fixture.reportValues.get('tokyo-shinjuku-facilities-zip') as Record<string, unknown>;
    facilities.input_sources = [{ source_id: 'tokyo-shinjuku-facilities-zip', sha256: 'd'.repeat(64) }, { source_id: specId, sha256: specSha }];
    fixture.reportValues.set('vintage', vintageReport());
    fixture.reportValues.set(sourceId, poiReport({ source_sha256: '9'.repeat(64), row_count: 999 }));
    await expect(buildPoiResearch([])).rejects.toThrow('Stale POI inspection source SHA-256');

    fixture.reportValues.set(sourceId, poiReport());
    const report = await buildPoiResearch([]);
    expect(report.path).toContain('/research/poi-rights-and-vintages.md');
    expect(report.content).toContain(`Tool-input SHA-256: \`${fixture.fingerprint}\``);
  });

  it('rejects stale vintage package identity, fingerprint, inputs, and evidence', async () => {
    await expect(assertVintageResearchCurrent(vintageReport({ package_sha256: '0'.repeat(64) }))).rejects.toThrow('Stale 2023 vintage package SHA-256');
    await expect(assertVintageResearchCurrent(vintageReport({ tool_input_sha256: '0'.repeat(64) }))).rejects.toThrow('Stale 2023 vintage tool fingerprint');
    await expect(assertVintageResearchCurrent(vintageReport({ input_sources: [] }))).rejects.toThrow('omits its current package acquisition');
    fixture.vintageEvidence = { status: 'FAIL', errors: ['range artifact hash mismatch'] };
    await expect(assertVintageResearchCurrent(vintageReport())).rejects.toThrow('range artifact hash mismatch');
  });
});
