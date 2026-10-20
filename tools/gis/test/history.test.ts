import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { archiveStaleConversions } from '../src/history.js';

describe('conversion receipt history', () => {
  it('moves receipts from other tool fingerprints to history and keeps current ones', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gteki-gis-history-'));
    try {
      await mkdir(join(root, 'conversions'));
      await writeFile(join(root, 'conversions', 'current.json'), JSON.stringify({ semantic_inputs: { tool_input_sha256: 'a'.repeat(64) } }));
      await writeFile(join(root, 'conversions', 'stale.json'), JSON.stringify({ semantic_inputs: { tool_input_sha256: 'b'.repeat(64) } }));
      await writeFile(join(root, 'conversions', 'unlabelled.json'), JSON.stringify({}));
      expect(await archiveStaleConversions('a'.repeat(64), root)).toEqual(['stale.json', 'unlabelled.json']);
      expect(await readdir(join(root, 'conversions'))).toEqual(['current.json']);
      expect(await readdir(join(root, 'history', 'conversions', `tool-${'b'.repeat(16)}`))).toEqual(['stale.json']);
      expect(await readdir(join(root, 'history', 'conversions', 'tool-unknown'))).toEqual(['unlabelled.json']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('real-run receipt invalidation', () => {
  it('marks an existing real-run receipt invalidated by an out-of-band command', async () => {
    const { invalidateRealRunReceipt } = await import('../src/history.js');
    const { readFile } = await import('node:fs/promises');
    const root = await mkdtemp(join(tmpdir(), 'gteki-gis-invalidate-'));
    try {
      expect(await invalidateRealRunReceipt('gis inspect-citygml x', root)).toBe(false);
      await writeFile(join(root, 'real-run.json'), JSON.stringify({ completed_at: '2026-10-20T00:00:00Z', commands: [] }));
      expect(await invalidateRealRunReceipt('gis inspect-citygml x', root)).toBe(true);
      const receipt = JSON.parse(await readFile(join(root, 'real-run.json'), 'utf8'));
      expect(receipt.invalidated.by_command).toBe('gis inspect-citygml x');
      expect(receipt.completed_at).toBe('2026-10-20T00:00:00Z');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
