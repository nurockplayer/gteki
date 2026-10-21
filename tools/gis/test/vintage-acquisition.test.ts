import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  writes: vi.fn(),
  packageResources: [
    { url: 'https://example.invalid/13104_synthetic_2023_citygml_1_op.zip' },
    { url: 'https://example.invalid/13104_synthetic_2023_citygml_2_op.zip' },
  ],
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
  } : path.includes('/networks/') ? { source_sha256: 'a'.repeat(64), members: [] } : { cities: [] }),
  writeJson: state.writes,
}));
vi.mock('../src/provenance.js', () => ({ toolFingerprint: async () => 'b'.repeat(64) }));

import { inspectVintages } from '../src/vintage.js';

describe('vintage acquisition publication boundary', () => {
  it('writes no acquisition record when a weak ETag cannot establish archive identity', async () => {
    state.writes.mockClear();
    const fetcher = vi.fn(async () => ({
      status: 206,
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
});
