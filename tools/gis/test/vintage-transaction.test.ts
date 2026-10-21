import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  root: `${process.env.TMPDIR ?? '/tmp'}/gis-vintage-transaction-${process.pid}`,
  failInspection: false, failStage: false, failPromotion: false, identicalMembers: false, inspections: 0,
  rich: false, networkCrs: undefined as unknown, networkBboxStatus: 'COMPUTED' as string | undefined, networkBbox: [139.69, 35.68, 139.71, 35.70] as unknown, combinedCrs: undefined as unknown, secondMember: false, vintageBbox: true, unresolved: 0, unsupportedExternal: 0, unsupportedRecords: 0, secondMemberCrs: 'EPSG:4326' as unknown,
}));
vi.mock('../src/common.js', async original => ({
  ...await original<typeof import('../src/common.js')>(),
  docsRoot: `${state.root}/docs`, getStoreRoot: () => `${state.root}/store`, ensurePrivateStore: vi.fn(),
  getGitCommit: async () => null,
  getStoredSource: async (id: string) => ({ path: id, record: { source_id: id, sha256: 'a'.repeat(64) } }),
  readJson: async (path: string) => path === 'plateau-13104-package-2023' ? { success: true, result: { resources: [1, 2].map(n => ({ url: `https://example.invalid/13104_synthetic_2023_citygml_${n}_op.zip` })) } }
    : path.includes('/networks/') ? (() => { const source_id = path.split('/').pop()!.replace(/\.json$/, ''); return { source_id, source_sha256: 'a'.repeat(64), tool_input_sha256: 'b'.repeat(64), input_sources: [{ source_id, sha256: 'a'.repeat(64) }], ...(state.combinedCrs === undefined ? {} : { network_inventory: { crs: state.combinedCrs } }), members: state.rich ? [{ file: 'synthetic.geojson', bbox: state.networkBbox, bbox_status: state.networkBboxStatus, crs: state.networkCrs }, ...(state.secondMember ? [{ file: 'second.geojson', bbox: state.networkBbox, bbox_status: state.networkBboxStatus, crs: { type: 'name', properties: { name: state.secondMemberCrs } } }] : [])] : [] }; })() : { cities: [] },
}));
vi.mock('../src/provenance.js', () => ({ toolFingerprint: async () => 'b'.repeat(64) }));
vi.mock('../src/citygml.js', () => ({ inspectCityGmlPath: async () => {
  state.inspections++;
  if (state.failInspection) throw new Error('injected CityGML failure');
  return { totals: { feature_count: 0, polygon_count: 0, bbox_lat_lon_height: state.rich && state.vintageBbox ? { min: [35.68, 139.69, 0], max: [35.70, 139.71, 10] } : null }, envelope: state.rich ? { srsName: 'EPSG:6697' } : null, unknowns: [],
    geometry_reference_summary: { total: 10, resolved: 10 - state.unresolved - state.unsupportedExternal, unresolved: state.unresolved, unsupported_external: state.unsupportedExternal, signed_reverse: 0, by_context: {} },
    unsupported_geometry_references: Array.from({ length: state.unsupportedRecords }, () => ({ target: '#x', owner_gml_id: null, context: 'boundary', reason: 'synthetic' })) };
} }));
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (state.failStage && String(args[0]).endsWith('1.new')) throw new Error('injected staging failure');
      return actual.writeFile(...args);
    },
    rename: async (from: string, to: string) => {
      if (state.failPromotion && from.endsWith('.new') && to.endsWith('/shinjuku-2023.md')) throw new Error('injected promotion failure');
      return actual.rename(from, to);
    },
  };
});

import { inspectVintages, type RangeFetcher } from '../src/vintage.js';

// Entirely synthetic single-member ZIP, with no source data or geometry.
const plain = Buffer.from('<synthetic/>');
function zip(plain: Buffer): Buffer {
  const name = Buffer.from('udx/ubld/53394525.gml'); let crc = 0xffffffff;
  for (const byte of plain) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30 + name.length + plain.length);
  local.writeUInt32LE(0x04034b50); local.writeUInt32LE(crc, 14); local.writeUInt32LE(plain.length, 18); local.writeUInt32LE(plain.length, 22); local.writeUInt16LE(name.length, 26); name.copy(local, 30); plain.copy(local, 30 + name.length);
  const central = Buffer.alloc(46 + name.length); central.writeUInt32LE(0x02014b50); central.writeUInt32LE(crc, 16); central.writeUInt32LE(plain.length, 20); central.writeUInt32LE(plain.length, 24); central.writeUInt16LE(name.length, 28); name.copy(central, 46);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}
const fetcher: RangeFetcher = async (url, start, end) => {
  const bytes = zip(state.identicalMembers || url.includes('_2_op.zip') ? plain : Buffer.from('<different/>')); return { status: 206, final_url: url.replace('example.invalid', 'cdn.example.invalid'), headers: new Headers({ etag: '"stable"', 'content-range': `bytes ${start}-${end}/${bytes.length}` }), bytes: bytes.subarray(start, end + 1) };
};
async function snapshot(directory = `${state.root}/docs/gis`): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await snapshot(path)); else result[path] = await readFile(path, 'utf8');
  }
  return result;
}
beforeEach(async () => {
  state.rich = false; state.networkCrs = undefined; state.networkBboxStatus = 'COMPUTED'; state.networkBbox = [139.69, 35.68, 139.71, 35.70]; state.combinedCrs = undefined; state.secondMember = false; state.vintageBbox = true; state.unresolved = 0; state.unsupportedExternal = 0; state.unsupportedRecords = 0; state.secondMemberCrs = 'EPSG:4326'; state.failInspection = false; state.failStage = false; state.failPromotion = false; state.identicalMembers = false; state.inspections = 0;
  await rm(state.root, { recursive: true, force: true });
  const memberId = createHash('sha256').update(plain).digest('hex').slice(0, 16);
  for (const file of ['vintages/shinjuku-2023.json', 'vintages/shinjuku-2023.md', 'acquisitions/vintages/vintage-directory-citygml-2-op.zip.json', `acquisitions/vintages/vintage-member-${memberId}.json`]) {
    const path = join(state.root, 'docs/gis', file); await mkdir(dirname(path), { recursive: true }); await writeFile(path, `previous ${file}`);
  }
});
afterEach(async () => { await rm(state.root, { recursive: true, force: true }); });

describe('vintage bundle transaction', () => {
  it('rejects colliding content identities from distinct archive resources before promotion', async () => {
    const previous = await snapshot(); state.identicalMembers = true;
    await expect(inspectVintages({ fetcher })).rejects.toThrow('Ambiguous vintage member receipt identity');
    expect(await snapshot()).toEqual(previous);
  });
  it('leaves all active receipts and reports unchanged on CityGML inspection failure', async () => {
    const previous = await snapshot(); state.failInspection = true;
    await expect(inspectVintages({ fetcher })).rejects.toThrow('injected CityGML failure');
    expect(await snapshot()).toEqual(previous);
  });
  it('leaves all active receipts and reports unchanged when the second archive fails', async () => {
    const previous = await snapshot();
    await expect(inspectVintages({ fetcher: async (...args) => {
      if (args[0].includes('_1_op.zip')) throw new Error('injected second archive failure');
      return fetcher(...args);
    } })).rejects.toThrow('injected second archive failure');
    expect(state.inspections).toBe(1);
    expect(await snapshot()).toEqual(previous);
  });
  it.each(['staging', 'promotion'])('restores the complete active bundle after a %s failure', async failure => {
    const previous = await snapshot(); state.failStage = failure === 'staging'; state.failPromotion = failure === 'promotion';
    await expect(inspectVintages({ fetcher })).rejects.toThrow(`injected ${failure} failure`);
    expect(await snapshot()).toEqual(previous);
  });
  it('publishes both validated archives with final URLs in all receipts and reports', async () => {
    const report = await inspectVintages({ fetcher });
    expect(state.inspections).toBe(2);
    expect(report.archives).toHaveLength(2);
    for (const file of Object.keys(await snapshot()).filter(p => p.endsWith('.json'))) {
      const value = JSON.parse(await readFile(file, 'utf8'));
      if (file.includes('/acquisitions/')) expect(value.final_url).toContain('https://cdn.example.invalid/');
      else expect(value.archives.every((a: any) => a.final_url.includes('https://cdn.example.invalid/'))).toBe(true);
    }
  });
  describe('network CRS structure in vintage comparisons', () => {
    const name = (value: unknown) => ({ type: 'name', properties: { name: value } });
    it('compares and selects meshes only from a validated {type:"name"} geographic CRS', async () => {
      state.rich = true; state.networkCrs = name('EPSG:6668');
      const report = await inspectVintages({ fetcher });
      expect(report.comparison.bbox_relations.length).toBeGreaterThan(0);
      expect(report.comparison.bbox_relations.every(r => r.relation === 'INTERSECTS' && r.layer_crs === 'EPSG:6668' && r.layer_crs_status === 'DECLARED_NAME')).toBe(true);
      expect(report.comparison.bbox_meshes.length).toBeGreaterThan(0);
    });
    // Regression: a linked CRS {type:"link", properties:{name, href}} was flattened to plain EPSG:6668 and returned INTERSECTS.
    it.each([
      ['linked', { type: 'link', properties: { name: 'EPSG:6668', href: 'https://example.invalid/crs' } }],
      ['name with an href', { type: 'name', properties: { name: 'EPSG:6668', href: 'https://example.invalid/crs' } }],
      ['name with a nested type', { type: 'name', properties: { name: 'EPSG:6668', type: 'proj4' } }],
      ['malformed name', name(6668)],
      ['unsupported projected name', name('EPSG:6677')],
      ['missing', undefined],
      ['assumed (not declared)', { value: 'RFC 7946 default CRS84 longitude/latitude assumed because no crs member is present', status: 'ASSUMPTION' }],
    ])('keeps a %s network CRS UNKNOWN with no mesh selection or bbox comparison', async (_label, crs) => {
      state.rich = true; state.networkCrs = crs;
      const report = await inspectVintages({ fetcher });
      expect(report.comparison.bbox_relations.length).toBeGreaterThan(0);
      expect(report.comparison.bbox_relations.every(r => r.relation === 'UNKNOWN' && r.layer_crs === null && r.layer_crs_status === 'UNKNOWN' && r.intersection_bbox_lat_lon === null)).toBe(true);
      expect(report.comparison.bbox_meshes).toEqual([]);
    });
    const unknownEverywhere = (report: Awaited<ReturnType<typeof inspectVintages>>) => {
      expect(report.comparison.bbox_relations.length).toBeGreaterThan(0);
      expect(report.comparison.bbox_relations.every(r => r.relation === 'UNKNOWN' && r.intersection_bbox_lat_lon === null)).toBe(true);
      expect(report.comparison.bbox_relations.some(r => r.relation === 'DISJOINT')).toBe(false);
      expect(report.comparison.bbox_meshes).toEqual([]);
    };
    it.each([
      ['INCOMPLETE_MALFORMED_GEOMETRY', 'INCOMPLETE_MALFORMED_GEOMETRY'],
      ['INCOMPLETE_LIMIT_REACHED', 'INCOMPLETE_LIMIT_REACHED'],
      ['INCOMPLETE_OVERRIDING_CRS', 'INCOMPLETE_OVERRIDING_CRS'],
      ['an absent bbox_status', undefined],
      ['an EMPTY bbox_status', 'EMPTY'],
    ])('keeps a network layer with %s UNKNOWN, never DISJOINT, even when a bbox is present', async (_label, status) => {
      state.rich = true; state.networkCrs = name('EPSG:6668'); state.networkBboxStatus = status;
      unknownEverywhere(await inspectVintages({ fetcher }));
    });
    it.each([
      ['a null bbox', null],
      ['a short bbox', [139.69, 35.68, 139.71]],
      ['a non-finite bbox', [139.69, 35.68, Number.NaN, 35.7]],
      ['an inverted bbox', [139.71, 35.70, 139.69, 35.68]],
      ['an out-of-range bbox (axes swapped)', [35.68, 139.69, 35.70, 139.71]],
    ])('keeps %s UNKNOWN', async (_label, bbox) => {
      state.rich = true; state.networkCrs = name('EPSG:6668'); state.networkBbox = bbox;
      unknownEverywhere(await inspectVintages({ fetcher }));
    });
    it('keeps every layer UNKNOWN when declarations conflict between members or the combined declaration is UNKNOWN', async () => {
      state.rich = true; state.networkCrs = name('EPSG:6668'); state.secondMember = true;
      unknownEverywhere(await inspectVintages({ fetcher }));
      state.secondMember = false; state.combinedCrs = { value: null, status: 'UNKNOWN', note: 'GeoJSON member layers declare different CRS values.' };
      unknownEverywhere(await inspectVintages({ fetcher }));
      state.combinedCrs = { value: null, status: 'UNKNOWN', note: 'Explicit "crs": null declares no CRS.' };
      unknownEverywhere(await inspectVintages({ fetcher }));
    });
    it.each([
      ['unresolved geometry references', { unresolved: 2 }],
      ['unsupported external geometry references', { unsupportedExternal: 1 }],
      ['unsupported reference records', { unsupportedRecords: 1 }],
    ])('keeps every relation UNKNOWN, with a reason, when the CityGML member has %s', async (_label, partial) => {
      state.rich = true; state.networkCrs = name('EPSG:6668'); Object.assign(state, partial);
      const report = await inspectVintages({ fetcher });
      expect(report.comparison.bbox_relations.length).toBeGreaterThan(0);
      expect(report.comparison.bbox_relations.every(r => r.relation === 'UNKNOWN' && r.intersection_bbox_lat_lon === null)).toBe(true);
      expect(report.comparison.bbox_relations.every(r => /geometry coverage is incomplete/.test(r.unknown_reason ?? ''))).toBe(true);
      expect(report.selected_member_records.every(m => m.inspection?.geometry_coverage?.complete === false)).toBe(true);
    });
    it('records complete geometry coverage and compares when every reference resolved', async () => {
      state.rich = true; state.networkCrs = name('EPSG:6668');
      const report = await inspectVintages({ fetcher });
      expect(report.selected_member_records.every(m => m.inspection?.geometry_coverage?.complete === true)).toBe(true);
      expect(report.comparison.bbox_relations.every(r => r.relation === 'INTERSECTS' && r.unknown_reason === null)).toBe(true);
    });
    it.each(['EPSG:6677', 'EPSG:9999'])('keeps a geographic EPSG:6668 layer UNKNOWN when another member declares %s (no combined declaration)', async other => {
      state.rich = true; state.networkCrs = name('EPSG:6668'); state.secondMember = true; state.secondMemberCrs = other;
      unknownEverywhere(await inspectVintages({ fetcher }));
    });
    it('keeps a relation UNKNOWN when the vintage CityGML bbox is missing', async () => {
      state.rich = true; state.networkCrs = name('EPSG:6668'); state.vintageBbox = false;
      const report = await inspectVintages({ fetcher });
      expect(report.comparison.bbox_relations.every(r => r.relation === 'UNKNOWN')).toBe(true);
    });
  });
});
