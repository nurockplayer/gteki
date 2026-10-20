import { mkdtemp, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensurePrivateStore } from '../src/common.js';

describe('external store permissions', () => {
  it('forces the store root to 0700 and makes new store files 0600 and directories 0700', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'gteki-gis-perm-'));
    const previous = process.umask();
    try {
      const store = join(parent, 'store');
      await mkdir(store, { mode: 0o755 });
      ensurePrivateStore(store);
      expect((await stat(store)).mode & 0o777).toBe(0o700);
      await mkdir(join(store, 'out'));
      await writeFile(join(store, 'out', 'model.glb'), 'synthetic');
      expect((await stat(join(store, 'out'))).mode & 0o777).toBe(0o700);
      expect((await stat(join(store, 'out', 'model.glb'))).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(previous);
      await rm(parent, { recursive: true, force: true });
    }
  });
});
