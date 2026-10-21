import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ failPromotion: false, failStage: false }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (state.failStage && String(args[0]).endsWith('1.new')) throw new Error('staging failure');
      return actual.writeFile(...args);
    },
    rename: async (from: string, to: string) => {
      if (state.failPromotion && from.endsWith('1.new')) throw new Error('promotion failure');
      return actual.rename(from, to);
    },
  };
});

import { commitReportFiles } from '../src/report-transaction.js';

let root: string;
afterEach(async () => {
  state.failPromotion = false; state.failStage = false;
  if (root) await rm(root, { recursive: true, force: true });
});
async function setup() {
  root = await mkdtemp(join(tmpdir(), 'gis-rights-transaction-'));
  await writeFile(join(root, 'old.json'), 'previous');
  return [{ path: join(root, 'old.json'), content: 'replacement' }, { path: join(root, 'new.json'), content: 'new report' }];
}

describe('rights report transaction', () => {
  it('publishes the prepared bundle and removes staging files', async () => {
    await commitReportFiles(await setup(), root);
    expect(await readFile(join(root, 'old.json'), 'utf8')).toBe('replacement');
    expect(await readFile(join(root, 'new.json'), 'utf8')).toBe('new report');
    expect((await readdir(root)).sort()).toEqual(['new.json', 'old.json']);
  });
  it('leaves every existing output unchanged on a staging error', async () => {
    const files = await setup(); state.failStage = true;
    await expect(commitReportFiles(files, root)).rejects.toThrow('staging failure');
    expect(await readFile(join(root, 'old.json'), 'utf8')).toBe('previous');
    expect(await readdir(root)).toEqual(['old.json']);
  });
  it('rolls back previously promoted outputs on a later promotion error', async () => {
    const files = await setup(); state.failPromotion = true;
    await expect(commitReportFiles(files, root)).rejects.toThrow('promotion failure');
    expect(await readFile(join(root, 'old.json'), 'utf8')).toBe('previous');
    expect(await readdir(root)).toEqual(['old.json']);
  });
  it('removes newly created outputs during rollback', async () => {
    const files = await setup(); state.failPromotion = true;
    await expect(commitReportFiles([{ path: join(root, 'created.json'), content: 'new' }, files[1]!], root)).rejects.toThrow('promotion failure');
    expect(await readdir(root)).toEqual(['old.json']);
  });
});
