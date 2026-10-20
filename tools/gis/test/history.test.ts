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
