import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '', csv: '', failStage: false, failPromotion: false }));
vi.mock('../src/common.js', async original => ({
  ...await original<typeof import('../src/common.js')>(),
  get docsRoot() { return `${state.root}/docs`; },
  getStoredSource: async (id: string) => ({
    path: state.csv, record: { source_id: id, sha256: 'a'.repeat(64), bytes: 40 },
    source: { commercial_use: 'UNKNOWN', modification_allowed: 'UNKNOWN', redistribution_allowed: 'UNKNOWN', attribution_text: 'x', station_ids: ['shinjuku'] },
  }),
}));
vi.mock('../src/provenance.js', () => ({ toolFingerprint: async () => 'b'.repeat(64) }));
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      // Staging the Markdown (second bundle member) or writing it directly fails.
      if (state.failStage && (String(args[0]).endsWith('1.new') || String(args[0]).endsWith('.md'))) throw new Error('injected markdown failure');
      return actual.writeFile(...args);
    },
    rename: async (from: string, to: string) => {
      if (state.failPromotion && to.endsWith('.md')) throw new Error('injected markdown promotion failure');
      return actual.rename(from, to);
    },
  };
});

import { inspectPoi } from '../src/poi.js';

const ID = 'toei-stores-shinjuku-csv';
describe('POI report publication bundle', () => {
  beforeEach(async () => {
    state.failStage = false; state.failPromotion = false;
    state.root = await mkdtemp(join(tmpdir(), 'gis-poi-publication-'));
    process.env.GTEKI_GIS_STORE = join(state.root, 'store');
    state.csv = join(state.root, 'source.csv');
    await writeFile(state.csv, 'name,lat,lon\nSYNTHETIC,35.7,139.7\n');
    await mkdir(join(state.root, 'docs', 'gis', 'poi'), { recursive: true });
    await writeFile(join(state.root, 'docs', 'gis', 'poi', `${ID}.json`), 'OLD-JSON\n');
    await writeFile(join(state.root, 'docs', 'gis', 'poi', `${ID}.md`), 'OLD-MARKDOWN\n');
  });
  afterEach(async () => { delete process.env.GTEKI_GIS_STORE; await rm(state.root, { recursive: true, force: true }); });

  const poiFile = (name: string) => readFile(join(state.root, 'docs', 'gis', 'poi', name), 'utf8');

  it('publishes JSON and Markdown together', async () => {
    const report = await inspectPoi(ID);
    expect(JSON.parse(await poiFile(`${ID}.json`)).source_sha256).toBe('a'.repeat(64));
    expect(await poiFile(`${ID}.md`)).toContain(`# POI inventory: ${ID}`);
    expect(report.verification).toBe('UNVERIFIED');
  });

  // Regression: JSON used to be replaced before the Markdown write, leaving a partial bundle.
  it.each(['failStage', 'failPromotion'] as const)('leaves the previous JSON and Markdown untouched when the Markdown step fails (%s)', async mode => {
    state[mode] = true;
    await expect(inspectPoi(ID)).rejects.toThrow('injected markdown');
    expect(await poiFile(`${ID}.json`)).toBe('OLD-JSON\n');
    expect(await poiFile(`${ID}.md`)).toBe('OLD-MARKDOWN\n');
    expect((await readdir(join(state.root, 'docs', 'gis'))).filter(name => name.startsWith('.rights-stage-'))).toEqual([]);
  });
});
