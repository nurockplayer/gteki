import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import * as common from '../src/common.js';
import { bboxIntersectsDisc, buildContextGlb, contextGlb, contextNodeName, EXPLORER_ROLE_WORDS, explorerRoleFromName, loadContextConfig, type ContextInput } from '../src/context.js';
import { scanContextFeatures, type ContextFeatureRecord } from '../src/context-scan.js';
import { loadFrame } from '../src/crs.js';
import { loadSources } from '../src/acquire.js';
import { isStationEnuFrame, type StationEnuFrame } from '../src/station-enu.js';

const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const fixture = (name: string): string => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
const inputs: ContextInput[] = [
  { sourceId: 'synthetic-bldg', sourceSha256: 'a'.repeat(64), kind: 'bldg', path: fixture('context-bldg.gml'), attributionText: '出典：SYNTHETIC attribution' },
  { sourceId: 'synthetic-tran', sourceSha256: 'b'.repeat(64), kind: 'tran', path: fixture('context-tran.gml'), attributionText: '出典：SYNTHETIC attribution' },
];
async function stationFrame(): Promise<StationEnuFrame> {
  const frame = await loadFrame('ikebukuro-station-enu-v0');
  if (!isStationEnuFrame(frame)) throw new Error('expected a station-enu frame');
  return frame;
}
async function build(radiusM = 250) {
  const dir = await mkdtemp(join(tmpdir(), 'gteki-context-')); dirs.push(dir);
  const outputPath = join(dir, 'context.glb');
  const frame = await stationFrame();
  const report = await buildContextGlb({ frame, radiusM, inputs, outputPath });
  const document = await new NodeIO().readBinary(await readFile(outputPath));
  return { dir, outputPath, frame, report, document };
}
const triangles = (report: Awaited<ReturnType<typeof build>>['report'], id: string): number => Number(report.per_feature.find((f) => f.gml_id === id)!.triangles);

describe('context selection and LOD policy (synthetic PLATEAU-shaped fixture)', () => {
  it('selects by bbox-vs-disc, keeps straddling features whole and drops the rest with counted reasons', async () => {
    const { report, document } = await build();
    const ids = report.per_feature.map((f) => f.gml_id).sort();
    expect(ids).toEqual(['bldg_edge', 'bldg_lod12', 'bldg_lod1only', 'bldg_lod2_unresolved', 'tran_lod123']);
    // Dropped: outside the disc (incl. a box whose corner is 254.8 m away although each axis range is < 250 m), LOD0-only, flat roads.
    expect(report.sources[0]).toMatchObject({ features_in_source: 7, outside_window: 2, selected: 5, converted: 4, excluded: { building_lod0_only_not_converted: 1 } });
    expect(report.sources[1]).toMatchObject({ features_in_source: 4, outside_window: 1, selected: 3, converted: 1, excluded: { road_no_lod3_lod1_lod2_flat_z0: 1, road_lod3_flat_z0: 1 } });
    expect(report.totals).toMatchObject({ features_in_sources: 11, outside_window: 3, selected_in_window: 8, converted: 5, excluded_total: 3 });
    expect(document.getRoot().listNodes().map((n) => n.getName()).sort()).toEqual(['ctx_bldg_bldg_edge', 'ctx_bldg_bldg_lod12', 'ctx_bldg_bldg_lod1only', 'ctx_bldg_bldg_lod2_unresolved', 'ctx_road_tran_lod123']);
    // The edge building spans x 240..270 m: whole, not cut at 250 m.
    expect(report.bbox_local_ENU!.max[0]).toBeGreaterThan(269.99);
    expect(report.bbox_local_ENU!.max[0]).toBeLessThan(270.01);
  });

  it('uses LOD2 over LOD1 (never both), LOD1 without LOD2, never LOD0, and a LOD1 fallback for unresolved LOD2 references', async () => {
    const { report } = await build();
    const byId = new Map(report.per_feature.map((f) => [f.gml_id, f]));
    // LOD1 box = 6 polygons / 12 triangles. LOD2 = ground + 4 walls + 2 roofs + 1 installation = 8 polygons / 16 triangles (not 12 + 16).
    expect(byId.get('bldg_lod1only')).toMatchObject({ lod_used: 'LOD1', polygons_converted: 6, triangles: 12 });
    expect(byId.get('bldg_lod12')).toMatchObject({ lod_used: 'LOD2', polygons_converted: 8, triangles: 16 });
    expect(byId.get('bldg_edge')).toMatchObject({ lod_used: 'LOD1', triangles: 12 });
    expect(byId.get('bldg_lod2_unresolved')).toMatchObject({ lod_used: 'LOD1', triangles: 12 });
    expect(byId.get('bldg_lod2_unresolved')!.lod_fallback).toMatch(/LOD1 used instead/);
    expect(report.sources[0]!.lod2_fallback_to_lod1).toBe(1);
    expect(report.totals.lod_used).toEqual({ LOD1: 3, LOD2: 1, LOD3: 1 });
    expect(report.per_feature.some((f) => f.gml_id === 'bldg_lod0only')).toBe(false);
  });

  it('draws roads from LOD3 only: LOD1/LOD2 flat z=0 geometry is skipped and counted, heights come from LOD3', async () => {
    const { report, document } = await build();
    expect(report.per_feature.find((f) => f.gml_id === 'tran_lod123')).toMatchObject({ lod_used: 'LOD3', polygons_converted: 2, triangles: 4, unresolved_refs: 0 });
    const road = document.getRoot().listNodes().find((n) => n.getName() === 'ctx_road_tran_lod123')!;
    const acc = road.getMesh()!.listPrimitives()[0]!.getAttribute('POSITION')!;
    for (let i = 0; i < acc.getCount(); i++) expect(acc.getElement(i, [0, 0, 0])[1]).toBeCloseTo(32.4, 3); // glTF y = TP height, nothing at z=0
    expect(report.sources[1]!.excluded).toEqual({ road_no_lod3_lod1_lod2_flat_z0: 1, road_lod3_flat_z0: 1 });
  });

  it('never invents heights: no vertex sits at a synthesised ground height and station z = TP - hM (hM 0)', async () => {
    const { report } = await build();
    expect(report.bbox_local_ENU!.min[2]).toBeCloseTo(32.4, 3);
    expect(report.bbox_local_ENU!.max[2]).toBeCloseTo(50.5, 3);
    expect(report.frame.origin.hM).toBe(0);
  });

  it('ignores appearance/texture data and tolerates a UTF-8 BOM', async () => {
    const { document, report } = await build();
    expect(document.getRoot().listTextures()).toHaveLength(0);
    expect(report.textures).toMatch(/not converted/);
    expect(report.sources[0]!.footprint_scan.polygons_without_lod).toBe(0);
    expect((await readFile(fixture('context-bldg.gml')))[0]).toBe(0xef); // fixture starts with a BOM
  });

  it('shrinking the radius shrinks the selection; the same inputs give identical bytes', async () => {
    const small = await build(80);
    expect(small.report.per_feature.map((f) => f.gml_id).sort()).toEqual(['bldg_lod12', 'bldg_lod1only']);
    const a = await build(), b = await build();
    expect(createHash('sha256').update(await readFile(a.outputPath)).digest('hex')).toBe(createHash('sha256').update(await readFile(b.outputPath)).digest('hex'));
    await expect(buildContextGlb({ frame: a.frame, radiusM: 0, inputs, outputPath: join(a.dir, 'x.glb') })).rejects.toThrow(/radius/);
    await expect(buildContextGlb({ frame: a.frame, radiusM: 5, inputs, outputPath: join(a.dir, 'y.glb') })).rejects.toThrow(/No context feature was converted/);
  });
});

describe('context tagging and node-name safety', () => {
  it('tags every node as visual-only, NOT_FOR_ROUTING context with full provenance and attribution', async () => {
    const { document, frame } = await build();
    const nodes = document.getRoot().listNodes();
    expect(nodes.length).toBe(5);
    for (const node of nodes) {
      const extras = node.getExtras();
      expect(extras).toMatchObject({ gteki_role: 'context', navigation_use: 'NOT_FOR_ROUTING', visual_only: true, verification: 'UNVERIFIED', frame_id: frame.frame_id, station_id: 'ikebukuro', station_json_sha256: frame.station_json_sha256, attribution_text: '出典：SYNTHETIC attribution' });
      expect(String(extras.source_id)).toMatch(/^synthetic-(bldg|tran)$/);
      expect(String(extras.source_sha256)).toMatch(/^[ab]{64}$/);
      expect(String(extras.lod_used)).toMatch(/^LOD[123]$/);
      expect(String(extras.gml_id).length).toBeGreaterThan(0);
    }
    expect(document.getRoot().getAsset().copyright).toBe('出典：SYNTHETIC attribution');
    expect(document.getRoot().listScenes()[0]!.getExtras()).toMatchObject({ gteki_role: 'context', navigation_use: 'NOT_FOR_ROUTING', visual_only: true });
  });

  it('keeps every node (and mesh) name clear of every walkable/collider/camera/sign role the explorer acts on', async () => {
    const { document } = await build();
    for (const node of document.getRoot().listNodes()) {
      expect(explorerRoleFromName(node.getName())).toBeNull();
      expect(node.getName()).toMatch(/^ctx_(bldg|road)_/);
      expect(explorerRoleFromName(node.getMesh()!.getName())).toBeNull();
    }
    // A hostile gml:id cannot make a context name a role: the ctx_ prefix always leads.
    for (const role of EXPLORER_ROLE_WORDS) for (const id of [role, `${role}_1`, `${role}.1`]) {
      expect(explorerRoleFromName(contextNodeName('bldg', id))).toBeNull();
      expect(explorerRoleFromName(contextNodeName('tran', id))).toBeNull();
    }
    // Sanity: the check itself catches role names.
    expect(explorerRoleFromName('floor')).toBe('floor'); expect(explorerRoleFromName('Wall_3')).toBe('wall'); expect(explorerRoleFromName('sign.001')).toBe('sign');
  });

  it('covers the explorer role vocabulary as it is defined in packages/scene-api today', async () => {
    const source = await readFile(fileURLToPath(new URL('../../../packages/scene-api/src/index.ts', import.meta.url)), 'utf8').catch(() => null);
    if (source === null) return; // standalone checkout without packages/
    const words = [...source.matchAll(/const (?:WALKABLE|COLLIDER|CAMERA|SEE_THROUGH)_ROLES = new Set\(\[([^\]]*)\]\)/g)].flatMap((m) => [...m[1]!.matchAll(/"([a-z_]+)"/g)].map((w) => w[1]!));
    expect(words.length).toBeGreaterThanOrEqual(15);
    for (const word of words) expect(EXPLORER_ROLE_WORDS as readonly string[]).toContain(word);
  });

  it('is not a role the explorer treats as walkable, collider, camera blocker or see-through', async () => {
    const { document } = await build();
    for (const node of document.getRoot().listNodes()) expect(String(node.getExtras().gteki_role)).toBe('context');
    expect(EXPLORER_ROLE_WORDS as readonly string[]).not.toContain('context');
  });
});

describe('bounded streaming scanner', () => {
  it('footprint mode keeps only ids, bbox and LOD facts; collect mode retains only the requested features', async () => {
    const frame = await stationFrame();
    const { stationEnuProjector } = await import('../src/station-enu.js');
    const records: ContextFeatureRecord[] = [];
    await scanContextFeatures(fixture('context-bldg.gml'), { kind: 'bldg', mode: 'footprint', project: stationEnuProjector(frame.origin), onFeature: (r) => records.push(r) });
    expect(records).toHaveLength(7);
    expect(records.every((r) => r.polygons === undefined)).toBe(true);
    const lod12 = records.find((r) => r.gml_id === 'bldg_lod12')!;
    expect(lod12.polygons_by_lod).toMatchObject({ 0: 1, 1: 6, 2: 8 });
    expect(lod12.lod_properties).toEqual(expect.arrayContaining(['lod0RoofEdge', 'lod1Solid', 'lod2Solid', 'lod2MultiSurface', 'lod2Geometry']));
    expect(lod12.bbox!.minX).toBeCloseTo(-90, 3); expect(lod12.bbox!.maxY).toBeCloseTo(40, 3);
    expect(lod12.height_range_by_lod[0]).toEqual([0, 0]);
    const collected: ContextFeatureRecord[] = [];
    await scanContextFeatures(fixture('context-bldg.gml'), { kind: 'bldg', mode: 'collect', retain: (id) => id === 'bldg_lod1only', onFeature: (r) => collected.push(r) });
    expect(collected.filter((r) => r.polygons !== undefined).map((r) => r.gml_id)).toEqual(['bldg_lod1only']);
    expect(collected.find((r) => r.gml_id === 'bldg_lod1only')!.polygons).toHaveLength(7); // LOD0 footprint + 6 LOD1 faces are retained; the converter picks the LOD
    expect(collected.find((r) => r.gml_id === 'bldg_edge')!.bbox).toBeNull(); // collect mode does not even parse unselected coordinates
  });

  it('refuses a non-6697 or undeclared CRS and DOCTYPE declarations rather than guessing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-bad-')); dirs.push(dir);
    const xml = await readFile(fixture('context-tran.gml'), 'utf8');
    const common = { kind: 'tran' as const, mode: 'collect' as const, retain: () => false, onFeature: () => undefined };
    await writeFile(join(dir, 'wrong.gml'), xml.replace('EPSG/0/6697', 'EPSG/0/4326'));
    await expect(scanContextFeatures(join(dir, 'wrong.gml'), common)).rejects.toThrow(/expected EPSG:6697/);
    await writeFile(join(dir, 'nocrs.gml'), xml.replace(' srsName="http://www.opengis.net/def/crs/EPSG/0/6697"', ''));
    await expect(scanContextFeatures(join(dir, 'nocrs.gml'), common)).rejects.toThrow(/Missing CityModel envelope srsName/);
    await writeFile(join(dir, 'doctype.gml'), xml.replace('<core:CityModel', '<!DOCTYPE x [<!ENTITY a "b">]><core:CityModel'));
    await expect(scanContextFeatures(join(dir, 'doctype.gml'), common)).rejects.toThrow(/DOCTYPE/);
    await writeFile(join(dir, 'swapped.gml'), xml.replace(/<gml:posList>35\.7/, '<gml:posList>139.7'));
    await expect(scanContextFeatures(join(dir, 'swapped.gml'), { ...common, mode: 'footprint' as const, project: () => [0, 0, 0] })).rejects.toThrow(/axis guard/);
  });

  it('selects by the closed disc, not by the per-axis range', () => {
    expect(bboxIntersectsDisc({ minX: 240, minY: 0, maxX: 270, maxY: 20 }, 250)).toBe(true);
    expect(bboxIntersectsDisc({ minX: 190, minY: 170, maxX: 210, maxY: 190 }, 250)).toBe(false);
    expect(bboxIntersectsDisc({ minX: -10, minY: -10, maxX: 10, maxY: 10 }, 1)).toBe(true); // contains the origin
    expect(bboxIntersectsDisc({ minX: 250, minY: 0, maxX: 260, maxY: 5 }, 250)).toBe(true); // touching counts
    expect(bboxIntersectsDisc({ minX: 250.01, minY: 0, maxX: 260, maxY: 5 }, 250)).toBe(false);
  });
});

describe('context command wrapper', () => {
  it('ships a READY Ikebukuro config of manifest sources and a BLOCKED Shinjuku config that never converts', async () => {
    const sources = new Map(loadSources().map((s) => [s.source_id, s]));
    const ikebukuro = await loadContextConfig('ikebukuro');
    expect(ikebukuro).toMatchObject({ status: 'READY', frame_id: 'ikebukuro-station-enu-v0', radius_m: 250 });
    expect(ikebukuro.sources).toHaveLength(4);
    for (const id of ikebukuro.sources) expect(sources.get(id)!.station_ids).toContain('ikebukuro');
    const shinjuku = await loadContextConfig('shinjuku');
    expect(shinjuku.status).toBe('BLOCKED');
    for (const id of shinjuku.sources) expect(sources.get(id)!.station_ids).toContain('shinjuku');
    await expect(contextGlb('shinjuku')).rejects.toThrow(/blocked.*vertical anchor/s);
    await expect(loadContextConfig('nowhere')).rejects.toThrow(/No context config/);
  });

  it('writes the GLB, sidecar and a receipt under docs/gis/context (not conversions) with window, rule, counts, sha and RSS', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-run-')); dirs.push(dir);
    const manifest = new Map(loadSources().map((s) => [s.source_id, s]));
    const paths: Record<string, string> = { 'plateau-13116-bldg-53394576': fixture('context-bldg.gml'), 'plateau-13116-bldg-53394577': fixture('context-bldg.gml'), 'plateau-13116-tran-53394576': fixture('context-tran.gml') };
    vi.spyOn(common, 'getStoredSource').mockImplementation(async (id: string) => ({ path: paths[id]!, record: { source_id: id, sha256: createHash('sha256').update(id).digest('hex') }, source: manifest.get(id)! }) as Awaited<ReturnType<typeof common.getStoredSource>>);
    vi.spyOn(common, 'getStoreRoot').mockReturnValue(dir);
    const originalWrite = common.writeJson;
    const written: string[] = [];
    vi.spyOn(common, 'writeJson').mockImplementation(async (path, value) => { const target = path.startsWith(common.docsRoot) ? join(dir, 'docs', relative(common.docsRoot, path)) : path; written.push(relative(dir, target)); return originalWrite(target, value); });
    // Two bldg meshes carry the same fixture ids: the second copy must be excluded as duplicate, never emitted twice.
    const summary = await contextGlb('ikebukuro', { sourceIds: ['plateau-13116-bldg-53394576', 'plateau-13116-bldg-53394577', 'plateau-13116-tran-53394576'] });
    expect(summary).toMatchObject({ station_id: 'ikebukuro', verification: 'UNVERIFIED', navigation_use: 'NOT_FOR_ROUTING', visual_only: true, window: { center_station_xy_m: [0, 0], radius_m: 250 } });
    expect(summary.sources[1]!.excluded).toEqual({ duplicate_gml_id: 4, building_lod0_only_not_converted: 1 });
    expect(summary.totals.converted).toBe(5);
    expect(summary.selection_rule).toMatch(/intersects the closed disc/);
    expect(summary.lod_policy).toMatch(/LOD3 only/);
    expect(summary.validation.status).toBe('PASS');
    expect(summary.peak_rss_bytes).toBeGreaterThan(0);
    expect(summary.station_json_changed_since_frame).toBeTypeOf('boolean');
    const glb = await readFile(join(dir, summary.store_path));
    expect(createHash('sha256').update(glb).digest('hex')).toBe(summary.output_sha256);
    expect(written.some((p) => p.startsWith(join('docs', 'gis', 'context')))).toBe(true);
    expect(written.some((p) => p.includes('conversions'))).toBe(false);
    const sidecar = JSON.parse(await readFile(join(dir, summary.sidecar_path), 'utf8'));
    expect(sidecar.per_feature).toHaveLength(5);
    expect(sidecar.source_manifests[0].publish_gate).toBe('CONDITIONAL');
    // Receipt and sidecar never claim a rights clearance.
    expect(JSON.stringify(summary)).not.toMatch(/"(?:cleared|clearance)"/);
  });
});
