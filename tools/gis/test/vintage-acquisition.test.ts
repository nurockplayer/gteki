import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  writes: vi.fn(),
  packageResources: [
    { url: 'https://example.invalid/13104_synthetic_2023_citygml_1_op.zip' },
    { url: 'https://example.invalid/13104_synthetic_2023_citygml_2_op.zip' },
  ],
  networkOverride: null as null | ((report: Record<string, unknown>) => Record<string, unknown>),
}));
vi.mock('../src/common.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/common.js')>(),
  ensurePrivateStore: vi.fn(),
  getStoredSource: vi.fn(async (sourceId: string) => ({
    path: sourceId,
    record: { source_id: sourceId, sha256: 'a'.repeat(64) },
  })),
  readJson: vi.fn(async (path: string) => path === 'plateau-13104-package-2023' ? {
    success: true, result: { resources: state.packageResources },
  } : path.includes('/networks/') ? (() => {
    const sourceId = path.split('/').pop()!.replace(/\.json$/, '');
    const report = { source_id: sourceId, source_sha256: 'a'.repeat(64), tool_input_sha256: 'b'.repeat(64), input_sources: [{ source_id: sourceId, sha256: 'a'.repeat(64) }], members: [] };
    return state.networkOverride ? state.networkOverride(report) : report;
  })() : { cities: [] }),
  writeJson: state.writes,
}));
vi.mock('../src/provenance.js', () => ({ toolFingerprint: async () => 'b'.repeat(64) }));

import { inspectVintages } from '../src/vintage.js';

describe('vintage acquisition publication boundary', () => {
  it('writes no acquisition record when a weak ETag cannot establish archive identity', async () => {
    state.writes.mockClear();
    const fetcher = vi.fn(async () => ({
      status: 206, final_url: 'https://example.invalid/archive.zip',
      headers: new Headers({ 'content-range': 'bytes 0-0/100', etag: 'W/"synthetic"' }),
      bytes: Buffer.alloc(1),
    }));
    await expect(inspectVintages({ fetcher })).rejects.toThrow('requires a strong ETag');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(state.writes).not.toHaveBeenCalled();
  });

  it('rejects duplicate same-kind archive resources before fetching or writing acquisition evidence', async () => {
    const previousResources = state.packageResources;
    state.packageResources = [
      { url: 'https://example.invalid/folder-a/13104_synthetic_2023_citygml_2_op.zip' },
      { url: 'https://example.invalid/folder-b/13104_synthetic_2023_citygml_2_op.zip' },
      { url: 'https://example.invalid/13104_synthetic_2023_citygml_1_op.zip' },
    ];
    state.writes.mockClear();
    const fetcher = vi.fn();
    try {
      await expect(inspectVintages({ fetcher })).rejects.toThrow('exactly one acquired resource for citygml_2_op.zip; found 2');
      expect(fetcher).not.toHaveBeenCalled();
      expect(state.writes).not.toHaveBeenCalled();
    } finally {
      state.packageResources = previousResources;
    }
  });
  it.each([
    ['a stale tool fingerprint', (r: Record<string, unknown>) => ({ ...r, tool_input_sha256: 'c'.repeat(64) }), 'Stale network inspection tool fingerprint'],
    ['a different source identity', (r: Record<string, unknown>) => ({ ...r, source_id: 'hokonavi-ikebukuro-walk-node-csv' }), 'Network inspection source_id mismatch'],
    ['missing lineage', (r: Record<string, unknown>) => { const { input_sources: _drop, ...rest } = r; return rest; }, 'lacks acquisition lineage'],
    ['a stale lineage input hash', (r: Record<string, unknown>) => ({ ...r, input_sources: [{ source_id: 'mlit-walk-network-spec-2018-03', sha256: 'd'.repeat(64) }] }), 'Stale network inspection input source SHA-256'],
    ['lineage that omits its own acquisition', (r: Record<string, unknown>) => ({ ...r, input_sources: [{ source_id: 'mlit-walk-network-spec-2018-03', sha256: 'a'.repeat(64) }] }), 'omits its own acquisition'],
  ])('fails closed before fetching or writing when the network inspection has %s', async (_label, mutate, message) => {
    state.writes.mockClear();
    const fetcher = vi.fn();
    state.networkOverride = mutate;
    try {
      await expect(inspectVintages({ fetcher })).rejects.toThrow(message);
      expect(fetcher).not.toHaveBeenCalled();
      expect(state.writes).not.toHaveBeenCalled();
    } finally {
      state.networkOverride = null;
    }
  });
});
