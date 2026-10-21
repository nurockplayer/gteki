import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import * as common from '../src/common.js';
import { assertMeshCoverage, bboxIntersectsDisc, HEIGHT_BASIS_FLATTENED, HEIGHT_BASIS_TP, GROUND_BASES, groundOffsetStats, spreadStats, buildContextGlb, contextGlb, contextMergedName, contextRunDigest, contextNodeName, EXPLORER_ROLE_WORDS, explorerRoleFromName, loadContextConfig, parseKinds, parseMergeSpec, type ContextInput, type ContextVariant, type MergeSpec } from '../src/context.js';
import { bboxIntersectsAnyDisc, buildContextWindow, meshCellBounds, meshCode3, meshesTouchedByWindow, readGraphWindowNodes, type NodeRule } from '../src/context-window.js';
import { scanContextFeatures, type ContextFeatureRecord, type ContextKind } from '../src/context-scan.js';
import { loadFrame } from '../src/crs.js';
import { loadSources } from '../src/acquire.js';
import { isStationEnuFrame, type StationEnuFrame } from '../src/station-enu.js';
import type { GroundOffsetStats } from '../src/context.js';

const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const fixture = (name: string): string => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
const inputs: ContextInput[] = [
  { sourceId: 'synthetic-bldg', sourceSha256: 'a'.repeat(64), kind: 'bldg', path: fixture('context-bldg.xml'), attributionText: '出典：SYNTHETIC attribution' },
  { sourceId: 'synthetic-tran', sourceSha256: 'b'.repeat(64), kind: 'tran', path: fixture('context-tran.xml'), attributionText: '出典：SYNTHETIC attribution' },
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
    expect((await readFile(fixture('context-bldg.xml')))[0]).toBe(0xef); // fixture starts with a BOM
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
    await scanContextFeatures(fixture('context-bldg.xml'), { kind: 'bldg', mode: 'footprint', project: stationEnuProjector(frame.origin), onFeature: (r) => records.push(r) });
    expect(records).toHaveLength(7);
    expect(records.every((r) => r.polygons === undefined)).toBe(true);
    const lod12 = records.find((r) => r.gml_id === 'bldg_lod12')!;
    expect(lod12.polygons_by_lod).toMatchObject({ 0: 1, 1: 6, 2: 8 });
    expect(lod12.lod_properties).toEqual(expect.arrayContaining(['lod0RoofEdge', 'lod1Solid', 'lod2Solid', 'lod2MultiSurface', 'lod2Geometry']));
    expect(lod12.bbox!.minX).toBeCloseTo(-90, 3); expect(lod12.bbox!.maxY).toBeCloseTo(40, 3);
    expect(lod12.height_range_by_lod[0]).toEqual([0, 0]);
    const collected: ContextFeatureRecord[] = [];
    await scanContextFeatures(fixture('context-bldg.xml'), { kind: 'bldg', mode: 'collect', retain: (id) => id === 'bldg_lod1only', onFeature: (r) => collected.push(r) });
    expect(collected.filter((r) => r.polygons !== undefined).map((r) => r.gml_id)).toEqual(['bldg_lod1only']);
    expect(collected.find((r) => r.gml_id === 'bldg_lod1only')!.polygons).toHaveLength(7); // LOD0 footprint + 6 LOD1 faces are retained; the converter picks the LOD
    expect(collected.find((r) => r.gml_id === 'bldg_edge')!.bbox).toBeNull(); // collect mode does not even parse unselected coordinates
  });

  it('refuses a non-6697 or undeclared CRS and DOCTYPE declarations rather than guessing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-bad-')); dirs.push(dir);
    const xml = await readFile(fixture('context-tran.xml'), 'utf8');
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
  it('ships READY Ikebukuro and Shinjuku configs of manifest sources (the Shinjuku decision is #39 comment 6324045059)', async () => {
    const sources = new Map(loadSources().map((s) => [s.source_id, s]));
    const ikebukuro = await loadContextConfig('ikebukuro');
    expect(ikebukuro).toMatchObject({ status: 'READY', frame_id: 'ikebukuro-station-enu-v0', radius_m: 250, merge: 'kind', window: { r_origin_m: 250, r_exit_m: 120, node_rule: { graph: 'stations/ikebukuro/gteki/graph.json', exit_kinds: ['exit'], street_floor_ids: ['street'], exit_poi_connectors: true } } });
    expect(ikebukuro.sources).toHaveLength(4);
    for (const id of ikebukuro.sources) expect(sources.get(id)!.station_ids).toContain('ikebukuro');
    const shinjuku = await loadContextConfig('shinjuku');
    expect(shinjuku.status).toBe('READY');
    expect(shinjuku.blocked_reason).toBeUndefined();
    expect(shinjuku.notes).toMatch(/6324045059/);
    for (const id of shinjuku.sources) expect(sources.get(id)!.station_ids).toContain('shinjuku');
    await expect(loadContextConfig('nowhere')).rejects.toThrow(/No context config/);
  });

  it('writes the GLB, sidecar and a receipt under docs/gis/context (not conversions) with window, rule, counts, sha and RSS', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-run-')); dirs.push(dir);
    const manifest = new Map(loadSources().map((s) => [s.source_id, s]));
    const paths: Record<string, string> = { 'plateau-13116-bldg-53394576': fixture('context-bldg.xml'), 'plateau-13116-bldg-53394577': fixture('context-bldg.xml'), 'plateau-13116-tran-53394576': fixture('context-tran.xml'), 'plateau-13116-tran-53394577': fixture('context-tran.xml') };
    vi.spyOn(common, 'getStoredSource').mockImplementation(async (id: string) => ({ path: paths[id]!, record: { source_id: id, sha256: createHash('sha256').update(id).digest('hex') }, source: manifest.get(id)! }) as Awaited<ReturnType<typeof common.getStoredSource>>);
    vi.spyOn(common, 'getStoreRoot').mockReturnValue(dir);
    const originalWrite = common.writeJson;
    const written: string[] = [];
    vi.spyOn(common, 'writeJson').mockImplementation(async (path, value) => { const target = path.startsWith(common.docsRoot) ? join(dir, 'docs', relative(common.docsRoot, path)) : path; written.push(relative(dir, target)); return originalWrite(target, value); });
    // Two bldg meshes carry the same fixture ids: the second copy must be excluded as duplicate, never emitted twice.
    const summary = await contextGlb('ikebukuro', { sourceIds: ['plateau-13116-bldg-53394576', 'plateau-13116-bldg-53394577', 'plateau-13116-tran-53394576', 'plateau-13116-tran-53394577'], exitRadiusM: 0, kinds: 'bldg,tran' });
    expect(summary).toMatchObject({ station_id: 'ikebukuro', verification: 'UNVERIFIED', navigation_use: 'NOT_FOR_ROUTING', visual_only: true, window: { center_station_xy_m: [0, 0], radius_m: 250 } });
    expect(summary.sources[1]!.excluded).toEqual({ duplicate_gml_id: 4, building_lod0_only_not_converted: 1 });
    expect(summary.sources[3]!.excluded).toMatchObject({ duplicate_gml_id: 1 });
    expect(summary.totals.converted).toBe(5);
    expect(summary).toMatchObject({ merge: 'kind', variant: 'high', totals: { meshes: 2, draw_calls: 2 } }); // the config default is merge kind
    expect(summary.mesh_coverage).toMatchObject({ needed_meshes: ['53394576', '53394577'], margin_m: 50, unused_sources: [] });
    expect(summary.selection_rule).toMatch(/intersects any closed disc/);
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
    expect(sidecar.feature_table.rows).toHaveLength(5);
    expect(summary.feature_table).toEqual(sidecar.feature_table); // the receipt carries the same compact feature table
    expect(sidecar.source_manifests[0].publish_gate).toBe('CONDITIONAL');
    // Receipt and sidecar never claim a rights clearance.
    expect(JSON.stringify(summary)).not.toMatch(/"(?:cleared|clearance)"/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Window (union of discs), mesh coverage, merged layouts and variants.

const IKEBUKURO_RULE: NodeRule = { graph: 'stations/ikebukuro/gteki/graph.json', exit_kinds: ['exit'], street_floor_ids: ['street'] };
const node = (id: string, kind: string, floorId: string, x: number, y: number) => ({ id, kind, floorId, position: { x, y, z: 33 }, inOut: 'boundary' });
/** Synthetic graph around the fixture features (station frame metres). Only e1 and s1 may attract a disc. */
async function writeGraph(dir: string, nodes: ReturnType<typeof node>[], stationId = 'ikebukuro'): Promise<string> {
  const path = join(dir, 'graph.json');
  await writeFile(path, JSON.stringify({ schema: 'gteki.station/0.1', stationId, nodes, edges: [] }));
  return path;
}
const SYNTH_NODES = [
  node('e1', 'exit', 'street', 300, 300), // exit connector; bldg_far_out (290..310) lies only in this 120 m disc
  node('s1', 'junction', 'street', 200, 120), // street-level, not an exit: bldg_corner_out (190..210, 170..190) lies only in this disc
  node('j1', 'junction', 'b1', 410, 405), // underground junction next to tran_far_out: matches neither field, so no disc
  node('t1', 'ticket_gate', 'b1', -400, -400),
];
async function buildWith(opts: { merge?: MergeSpec; variant?: ContextVariant; exitR?: number; inputsOverride?: ContextInput[]; nodes?: ReturnType<typeof node>[]; radius?: number; rule?: NodeRule; pois?: unknown[] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gteki-context-window-')); dirs.push(dir);
  const graphPath = await writeGraph(dir, opts.nodes ?? SYNTH_NODES);
  const poisPath = opts.pois ? await writePois(dir, opts.pois) : undefined;
  const frame = await stationFrame();
  const window = await buildContextWindow({ r_origin_m: opts.radius ?? 250, r_exit_m: opts.exitR ?? 120, node_rule: opts.rule ?? IKEBUKURO_RULE }, { stationId: 'ikebukuro', graphPath, ...(poisPath ? { poisPath } : {}) });
  const outputPath = join(dir, 'context.glb');
  const report = await buildContextGlb({ frame, window, inputs: opts.inputsOverride ?? inputs, outputPath, ...(opts.merge ? { merge: opts.merge } : {}), ...(opts.variant ? { variant: opts.variant } : {}) });
  const document = await new NodeIO().readBinary(await readFile(outputPath));
  return { dir, outputPath, frame, window, report, document };
}
async function writePois(dir: string, pois: unknown[], stationId = 'ikebukuro'): Promise<string> {
  const path = join(dir, 'pois.json');
  await writeFile(path, JSON.stringify({ schema: 'gteki.station/0.1', stationId, pois }));
  return path;
}
const poi = (id: string, category: string, connectorNodeIds: string[]) => ({ id, category, floorId: null, connectorNodeIds });
const POI_RULE: NodeRule = { ...IKEBUKURO_RULE, exit_poi_connectors: true };
const idsOf = (report: Awaited<ReturnType<typeof buildWith>>['report']): string[] => report.per_feature.map((f) => String(f.gml_id)).sort();

describe('window = union of discs', () => {
  it('selects a feature that meets only an exit disc and one that meets only a street-level node disc, but nothing from unmatched nodes', async () => {
    const base = await build(250); // origin disc only
    expect(idsOf(base.report)).not.toContain('bldg_far_out');
    const { report, window } = await buildWith({ merge: { mode: 'none' } });
    expect(window.discs.map((d) => d.id)).toEqual(['origin', 'e1', 's1']); // j1 (junction, b1) and t1 (ticket_gate, b1) get no disc
    expect(idsOf(report)).toEqual(['bldg_corner_out', 'bldg_edge', 'bldg_far_out', 'bldg_lod12', 'bldg_lod1only', 'bldg_lod2_unresolved', 'tran_lod123']);
    // far_out is 424 m from the origin: only the exit disc at (300,300) reaches it; whole, not cut.
    expect(report.bbox_local_ENU!.max[0]).toBeGreaterThan(309.99);
    expect(report.bbox_local_ENU!.max[1]).toBeGreaterThan(309.99);
    expect(report.sources[0]).toMatchObject({ features_in_source: 7, outside_window: 0, selected: 7, converted: 6, excluded: { building_lod0_only_not_converted: 1 } });
    expect(report.sources[1]).toMatchObject({ features_in_source: 4, outside_window: 1, converted: 1 }); // tran_far_out (400..420) is next to j1 only
    expect(report.window).toMatchObject({ radius_m: 250, r_origin_m: 250, r_exit_m: 120, disc_count: 3, node_rule: IKEBUKURO_RULE });
    expect(report.window.graph).toMatchObject({ nodes_total: 4, exit_connectors: 1, street_level_nodes: 2, selected_nodes: 2 });
  });

  it('r_exit 0 or no node rule leaves the origin disc; r_exit > 0 without a rule is refused', async () => {
    const zero = await buildWith({ merge: { mode: 'none' }, exitR: 0 });
    expect(zero.window.discs).toHaveLength(1);
    expect(idsOf(zero.report)).not.toContain('bldg_far_out');
    await expect(buildContextWindow({ r_origin_m: 250, r_exit_m: 120 }, { stationId: 'ikebukuro' })).rejects.toThrow(/needs a node_rule/);
    await expect(buildContextWindow({ r_origin_m: 0, r_exit_m: 0 }, { stationId: 'ikebukuro' })).rejects.toThrow(/radius/);
    await expect(buildContextWindow({ r_origin_m: 250, r_exit_m: -1 }, { stationId: 'ikebukuro' })).rejects.toThrow(/R_exit/);
  });

  it('tests the correct bbox against every disc (closed; the corner distance, not per-axis ranges)', () => {
    const discs = [{ x: 0, y: 0, r: 250, origin: 'origin' as const, id: 'origin' }, { x: 300, y: 300, r: 120, origin: 'node' as const, id: 'e1' }];
    expect(bboxIntersectsAnyDisc({ minX: 290, minY: 290, maxX: 310, maxY: 310 }, discs)).toBe(true); // exit disc only
    expect(bboxIntersectsAnyDisc({ minX: 190, minY: 170, maxX: 210, maxY: 190 }, discs)).toBe(false); // 255 m from origin, 142 m from the exit
    expect(bboxIntersectsAnyDisc({ minX: 180, minY: 300, maxX: 181, maxY: 301 }, discs)).toBe(true); // exactly 120 m from the exit centre: touching counts
    expect(bboxIntersectsAnyDisc({ minX: 179, minY: 300, maxX: 179.9, maxY: 301 }, discs)).toBe(false);
    expect(bboxIntersectsAnyDisc({ minX: 1000, minY: 1000, maxX: 1010, maxY: 1010 }, [])).toBe(false);
  });
});

describe('graph-derived exit / street-level rule', () => {
  it('reads the committed Ikebukuro graph: 20 exit connectors (kind exit), all on floor street, none other', async () => {
    const graphPath = fileURLToPath(new URL('../../../stations/ikebukuro/gteki/graph.json', import.meta.url));
    const bytes = await readFile(graphPath).catch(() => null);
    if (bytes === null) return; // standalone checkout without stations/
    const { facts, nodes } = await readGraphWindowNodes(IKEBUKURO_RULE, { stationId: 'ikebukuro' });
    expect(facts.graph_sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(facts).toMatchObject({ graph_path: 'stations/ikebukuro/gteki/graph.json', nodes_total: 62, exit_connectors: 20, street_level_nodes: 20, matched_by_both: 20, selected_nodes: 20 });
    expect(facts.kinds_by_floor).toEqual({ 'exit@street': 20, 'junction@b1': 36, 'stair_end@b1': 3, 'ticket_gate@b1': 3 });
    expect(nodes.every((n) => n.kind === 'exit' && n.floor_id === 'street')).toBe(true);
    expect(facts.max_selected_distance_m).toBeGreaterThan(248); expect(facts.max_selected_distance_m).toBeLessThan(249); // x39: the 249 m exit
  });

  it('applies exit_kinds and street_floor_ids independently, as written in the config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-graph-')); dirs.push(dir);
    const graphPath = await writeGraph(dir, SYNTH_NODES);
    const kindsOnly = await readGraphWindowNodes({ graph: IKEBUKURO_RULE.graph, exit_kinds: ['exit'], street_floor_ids: [] }, { stationId: 'ikebukuro', graphPath });
    expect(kindsOnly.nodes.map((n) => n.id)).toEqual(['e1']);
    const floorsOnly = await readGraphWindowNodes({ graph: IKEBUKURO_RULE.graph, exit_kinds: [], street_floor_ids: ['street'] }, { stationId: 'ikebukuro', graphPath });
    expect(floorsOnly.nodes.map((n) => n.id)).toEqual(['e1', 's1']);
    const both = await readGraphWindowNodes(IKEBUKURO_RULE, { stationId: 'ikebukuro', graphPath });
    expect(both.facts).toMatchObject({ exit_connectors: 1, street_level_nodes: 2, matched_by_both: 1, selected_nodes: 2 });
    expect(both.facts.selected.find((n) => n.id === 'e1')!.matched_by).toEqual(['exit_kind', 'street_floor']);
    expect(both.facts.selected.find((n) => n.id === 's1')!.matched_by).toEqual(['street_floor']);
  });

  it('refuses to guess: empty rule, wrong station, missing fields, absurd positions, wrong graph path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-graph-bad-')); dirs.push(dir);
    const good = await writeGraph(dir, SYNTH_NODES);
    await expect(readGraphWindowNodes({ graph: IKEBUKURO_RULE.graph, exit_kinds: [], street_floor_ids: [] }, { stationId: 'ikebukuro', graphPath: good })).rejects.toThrow(/at least one/);
    await expect(readGraphWindowNodes(IKEBUKURO_RULE, { stationId: 'shinjuku', graphPath: good })).rejects.toThrow(/does not match shinjuku/);
    const noFloor = await writeGraph(dir, [{ id: 'a', kind: 'exit', position: { x: 1, y: 2 } }] as never);
    await expect(readGraphWindowNodes(IKEBUKURO_RULE, { stationId: 'ikebukuro', graphPath: noFloor })).rejects.toThrow(/lacks string id\/kind\/floorId/);
    const far = await writeGraph(dir, [node('far', 'exit', 'street', 90000, 0)]);
    await expect(readGraphWindowNodes(IKEBUKURO_RULE, { stationId: 'ikebukuro', graphPath: far })).rejects.toThrow(/more than 5 km/);
    await expect(readGraphWindowNodes({ ...IKEBUKURO_RULE, graph: '../../etc/passwd' }, { stationId: 'ikebukuro' })).rejects.toThrow(/must be stations\/ikebukuro/);
  });
});

describe('exit_poi_connectors: graph nodes that exit POIs name as connectors', () => {
  const repoFile = (name: string): string => fileURLToPath(new URL(`../../../stations/ikebukuro/gteki/${name}`, import.meta.url));

  it('Ikebukuro: exactly x36f, x4f and x13f join the 20 exit nodes (23 exit POIs with a connector), and pois.json sha256 is recorded', async () => {
    const poisBytes = await readFile(repoFile('pois.json')).catch(() => null);
    if (poisBytes === null) return; // standalone checkout without stations/
    const base = await readGraphWindowNodes(IKEBUKURO_RULE, { stationId: 'ikebukuro' });
    const { facts, nodes } = await readGraphWindowNodes(POI_RULE, { stationId: 'ikebukuro' });
    expect(base.facts.pois).toBeNull(); // off unless configured
    expect(facts.pois).toMatchObject({ pois_path: 'stations/ikebukuro/gteki/pois.json', categories: ['exit'], pois_total: 52, exit_pois: 38, exit_pois_with_connectors: 23, connector_nodes: 23, added_beyond_kind_and_floor: ['x13f', 'x36f', 'x4f'] });
    expect(facts.pois!.pois_sha256).toBe(createHash('sha256').update(poisBytes).digest('hex'));
    expect(facts.graph_sha256).toBe(base.facts.graph_sha256);
    expect(facts).toMatchObject({ exit_connectors: 20, street_level_nodes: 20, selected_nodes: 23 }); // the kind/floor counts are unchanged
    const added = nodes.filter((n) => !base.nodes.some((b) => b.id === n.id));
    expect(added.map((n) => [n.id, n.kind, n.floor_id, n.matched_by, n.poi_ids]).sort()).toEqual([
      ['x13f', 'stair_end', 'b1', ['exit_poi_connector'], ['exit-13']], ['x36f', 'stair_end', 'b1', ['exit_poi_connector'], ['exit-36']], ['x4f', 'stair_end', 'b1', ['exit_poi_connector'], ['exit-4']],
    ]);
    expect(Math.round(added.find((n) => n.id === 'x13f')!.distance_from_origin_m)).toBe(190);
    // The 20 exit nodes are all named by an exit POI too, so they carry both reasons.
    expect(nodes.find((n) => n.id === 'x39')!.matched_by).toEqual(['exit_kind', 'street_floor', 'exit_poi_connector']);
    const window = await buildContextWindow({ r_origin_m: 250, r_exit_m: 120, node_rule: POI_RULE }, { stationId: 'ikebukuro' });
    expect(window.discs).toHaveLength(24);
  });

  it('adds only connectors of exit POIs: other stair_end nodes, and connectors of non-exit POIs, get no disc', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-poi-')); dirs.push(dir);
    const graphPath = await writeGraph(dir, [...SYNTH_NODES, node('sa', 'stair_end', 'b1', -200, 10), node('sb', 'stair_end', 'b1', -210, 20), node('sc', 'stair_end', 'b1', -220, 30), node('g1', 'ticket_gate', 'b1', 5, 5)]);
    const poisPath = await writePois(dir, [poi('exit-9', 'exit', ['sa']), poi('exit-no-conn', 'exit', []), poi('gate-1', 'ticket_gate', ['sb', 'g1']), poi('shop', 'other', ['sc'])]);
    const withRule = await readGraphWindowNodes(POI_RULE, { stationId: 'ikebukuro', graphPath, poisPath });
    expect(withRule.nodes.map((n) => n.id)).toEqual(['e1', 's1', 'sa']);
    expect(withRule.facts.pois).toMatchObject({ exit_pois: 2, exit_pois_with_connectors: 1, connector_nodes: 1, added_beyond_kind_and_floor: ['sa'] });
    expect(withRule.facts.pois!.pois_sha256).toBe(createHash('sha256').update(await readFile(poisPath)).digest('hex'));
    // Without the option pois.json is not even read.
    const off = await readGraphWindowNodes(IKEBUKURO_RULE, { stationId: 'ikebukuro', graphPath, poisPath: join(dir, 'does-not-exist.json') });
    expect(off.nodes.map((n) => n.id)).toEqual(['e1', 's1']);
    // A configurable exit category.
    const gates = await readGraphWindowNodes({ ...POI_RULE, exit_poi_categories: ['ticket_gate'] }, { stationId: 'ikebukuro', graphPath, poisPath });
    expect(gates.nodes.map((n) => n.id)).toEqual(['e1', 's1', 'sb', 'g1']);
  });

  it('refuses to guess: unknown connector node, missing connectorNodeIds, wrong station, wrong path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-poi-bad-')); dirs.push(dir);
    const graphPath = await writeGraph(dir, SYNTH_NODES);
    const run = async (pois: unknown[], station = 'ikebukuro') => readGraphWindowNodes(POI_RULE, { stationId: 'ikebukuro', graphPath, poisPath: await writePois(dir, pois, station) });
    await expect(run([poi('exit-1', 'exit', ['nope'])])).rejects.toThrow(/connector node nope .*exit-1.*not in/);
    await expect(run([{ id: 'exit-2', category: 'exit' }])).rejects.toThrow(/exit POI exit-2 has no connectorNodeIds/);
    await expect(run([poi('exit-3', 'exit', [])], 'shinjuku')).rejects.toThrow(/does not match ikebukuro/);
    await expect(readGraphWindowNodes({ ...POI_RULE, pois: 'stations/ikebukuro/gteki/other.json' }, { stationId: 'ikebukuro', graphPath })).rejects.toThrow(/node_rule.pois must be/);
    await expect(readGraphWindowNodes({ ...POI_RULE, exit_poi_categories: [] }, { stationId: 'ikebukuro', graphPath, poisPath: await writePois(dir, []) })).rejects.toThrow(/must not be empty/);
  });

  it('a stair-foot exit disc selects features and the pois sha256 travels in the receipt and mesh extras', async () => {
    const nodes = [node('e1', 'exit', 'street', 0, 600), node('sa', 'stair_end', 'b1', 300, 300), node('sx', 'stair_end', 'b1', 410, 405)];
    const pois = [poi('exit-9', 'exit', ['sa']), poi('exit-1', 'exit', ['e1'])];
    const without = await buildWith({ merge: { mode: 'kind' }, nodes, pois });
    expect(idsOf(without.report)).not.toContain('bldg_far_out');
    const { report, document, window, dir } = await buildWith({ merge: { mode: 'kind' }, nodes, pois, rule: POI_RULE });
    expect(window.discs.map((d) => d.id)).toEqual(['origin', 'e1', 'sa']); // sx is a stair_end no exit POI names
    expect(idsOf(report)).toContain('bldg_far_out');
    expect(idsOf(report)).not.toContain('tran_far_out');
    const sha = createHash('sha256').update(await readFile(join(dir, 'pois.json'))).digest('hex');
    expect(report.window.graph!.pois!.pois_sha256).toBe(sha);
    for (const n of document.getRoot().listNodes()) { expect(n.getExtras().pois_sha256).toBe(sha); expect((n.getExtras().window as Record<string, unknown>).pois_sha256).toBe(sha); expect(n.getMesh()!.getExtras().pois_sha256).toBe(sha); }
    expect(document.getRoot().listScenes()[0]!.getExtras().pois_sha256).toBe(sha);
    expect(without.document.getRoot().listNodes()[0]!.getExtras().pois_sha256).toBeNull();
  });
});

describe('JIS X 0410 3rd-level mesh codes and window coverage', () => {
  it('maps known points to their codes', () => {
    expect(meshCode3(35.7297, 139.7114)).toBe('53394576'); // Ikebukuro station origin
    expect(meshCode3(35.6812, 139.7671)).toBe('53394611'); // Tokyo Station
    expect(meshCode3(35.0, 135.0)).toBe('52354000'); // 35 N 135 E: p = 52 (35 x 1.5 = 52.5), q = 4, u = 35, v = r = w = 0
    expect(meshCode3(0, 100)).toBe('00000000');
    expect(meshCode3(35.7297, 139.7126)).toBe('53394577'); // just east of the 139.7125 cell edge
    expect(meshCode3(35.7334, 139.7114)).toBe('53394586'); // just north of the 35.733333 cell edge
    expect(() => meshCode3(NaN, 139)).toThrow(/undefined/);
    expect(() => meshCode3(35, 99)).toThrow(/undefined/);
  });

  it('gives exact cell bounds that round-trip, with adjacent codes sharing edges', () => {
    const cell = meshCellBounds('53394576');
    expect(cell.latMin).toBeCloseTo(35.725, 12); expect(cell.latMax).toBeCloseTo(35 + 44 / 60, 12);
    expect(cell.lonMin).toBeCloseTo(139.7, 12); expect(cell.lonMax).toBeCloseTo(139.7125, 12);
    expect(meshCellBounds('53394577').lonMin).toBeCloseTo(cell.lonMax, 12);
    expect(meshCellBounds('53394586').latMin).toBeCloseTo(cell.latMax, 12);
    for (const code of ['53394576', '53394577', '53394586', '53394525', '53394611', '52354000']) {
      const c = meshCellBounds(code);
      expect(meshCode3((c.latMin + c.latMax) / 2, (c.lonMin + c.lonMax) / 2)).toBe(code);
      expect(meshCode3(c.latMin, c.lonMin)).toBe(code); // south-west corner belongs to the cell
    }
    expect(() => meshCellBounds('5339457')).toThrow(/8-digit/);
    expect(() => meshCellBounds('53394876')).toThrow(/2nd level/);
  });

  it("agrees with the PLATEAU catalog's own mesh list and with the served file envelopes", async () => {
    const catalog = JSON.parse(await readFile(fixture('plateau-catalog-meshes-13116-13104.json'), 'utf8')) as { meshes: Record<string, string[]>; served_envelopes: { by_source: Record<string, { lower: number[]; upper: number[] }> } };
    // Every catalog mesh code is a valid cell whose centre maps back to it.
    for (const codes of Object.values(catalog.meshes)) for (const code of codes) { const c = meshCellBounds(code); expect(meshCode3((c.latMin + c.latMax) / 2, (c.lonMin + c.lonMax) / 2)).toBe(code); }
    // The two Ikebukuro files' CityModel envelopes sit on their cells (features straddle an edge by up to 0.00042 deg, about 38 m).
    for (const [sourceId, env] of Object.entries(catalog.served_envelopes.by_source)) {
      const cell = meshCellBounds(/(\d{8})$/.exec(sourceId)![1]!);
      expect(env.lower[0]!).toBeGreaterThan(cell.latMin - 0.0005); expect(env.upper[0]!).toBeLessThan(cell.latMax + 0.0005);
      expect(env.lower[1]!).toBeGreaterThan(cell.lonMin - 0.0005); expect(env.upper[1]!).toBeLessThan(cell.lonMax + 0.0005);
    }
    // The meshes the Ikebukuro window needs exist in the catalog as bldg and tran.
    const frame = await stationFrame();
    const window = await buildContextWindow({ r_origin_m: 250, r_exit_m: 120, node_rule: IKEBUKURO_RULE }, { stationId: 'ikebukuro' }).catch(() => null);
    if (window === null) return; // standalone checkout without stations/
    for (const margin of [0, 50]) for (const mesh of meshesTouchedByWindow(window.discs, frame, margin).meshes) { expect(catalog.meshes['13116-bldg']).toContain(mesh); expect(catalog.meshes['13116-tran']).toContain(mesh); }
  });

  it('computes the cells a window touches: the Ikebukuro origin disc and exit discs need 53394576 and 53394577 only; far discs add cells', async () => {
    const frame = await stationFrame();
    expect(meshesTouchedByWindow([{ x: 0, y: 0, r: 250, origin: 'origin', id: 'origin' }], frame).meshes).toEqual(['53394576', '53394577']);
    const graphPath = fileURLToPath(new URL('../../../stations/ikebukuro/gteki/graph.json', import.meta.url));
    if (await readFile(graphPath).then(() => true, () => false)) {
      const window = await buildContextWindow({ r_origin_m: 250, r_exit_m: 120, node_rule: IKEBUKURO_RULE }, { stationId: 'ikebukuro' });
      expect(window.discs).toHaveLength(21);
      expect(meshesTouchedByWindow(window.discs, frame, 0).meshes).toEqual(['53394576', '53394577']);
      expect(meshesTouchedByWindow(window.discs, frame, 50).meshes).toEqual(['53394576', '53394577']);
      expect(meshesTouchedByWindow(window.discs, frame, 110).meshes).toContain('53394586'); // 40 m of slack before the northern neighbour matters
      // Adding the three stair-foot exit discs (x13f is 190 m out, its disc reaches 310 m) does not change the meshes.
      const withPois = await buildContextWindow({ r_origin_m: 250, r_exit_m: 120, node_rule: { ...IKEBUKURO_RULE, exit_poi_connectors: true } }, { stationId: 'ikebukuro' });
      expect(withPois.discs).toHaveLength(24);
      for (const margin of [0, 50, 100]) expect(meshesTouchedByWindow(withPois.discs, frame, margin).meshes).toEqual(['53394576', '53394577']);
      expect(meshesTouchedByWindow(withPois.discs, frame, 110).meshes).toContain('53394586');
    }
    // A disc 1 km west touches the western neighbour, a closed boundary counts, and a disc well inside one cell touches one cell.
    expect(meshesTouchedByWindow([{ x: -1000, y: 0, r: 120, origin: 'node', id: 'w' }], frame).meshes).toEqual(['53394575', '53394576']);
    expect(meshesTouchedByWindow([{ x: -400, y: 0, r: 50, origin: 'node', id: 'in' }], frame).meshes).toEqual(['53394576']);
    expect(meshesTouchedByWindow([{ x: 0, y: 0, r: 100, origin: 'origin', id: 'o' }], frame).meshes).toEqual(['53394576', '53394577']); // 99 m east of the origin is the 139.7125 edge
  });
});

describe('fail closed on missing meshes', () => {
  const all4 = ['plateau-13116-bldg-53394576', 'plateau-13116-bldg-53394577', 'plateau-13116-tran-53394576', 'plateau-13116-tran-53394577'];
  function mockStore(dir: string, paths: Record<string, string>) {
    const manifest = new Map(loadSources().map((s) => [s.source_id, s]));
    const stored = vi.spyOn(common, 'getStoredSource').mockImplementation(async (id: string) => {
      if (!(id in paths)) throw Object.assign(new Error(`ENOENT: no acquisition record for ${id}`), { code: 'ENOENT' });
      return { path: paths[id]!, record: { source_id: id, sha256: createHash('sha256').update(id).digest('hex') }, source: manifest.get(id)! } as Awaited<ReturnType<typeof common.getStoredSource>>;
    });
    vi.spyOn(common, 'getStoreRoot').mockReturnValue(dir);
    const writes = vi.spyOn(common, 'writeJson').mockResolvedValue(undefined);
    return { stored, writes };
  }
  const paths = (): Record<string, string> => ({ [all4[0]!]: fixture('context-bldg.xml'), [all4[1]!]: fixture('context-bldg.xml'), [all4[2]!]: fixture('context-tran.xml'), [all4[3]!]: fixture('context-tran.xml') });

  it('names the mesh whose bldg/tran source is not in the config and converts nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-missing-')); dirs.push(dir);
    const { stored, writes } = mockStore(dir, paths());
    await expect(contextGlb('ikebukuro', { sourceIds: all4.slice(0, 3), exitRadiusM: 0, kinds: 'bldg,tran' })).rejects.toThrow(/53394577 tran \(not in the context config\)/);
    await expect(contextGlb('ikebukuro', { sourceIds: [all4[0]!, all4[2]!], exitRadiusM: 0, kinds: 'bldg,tran' })).rejects.toThrow(/53394577 bldg \(not in the context config\), 53394577 tran \(not in the context config\)/);
    expect(stored).not.toHaveBeenCalled(); // coverage is checked before any source is read
    expect(writes).not.toHaveBeenCalled();
  });

  it('fails when an exit disc pushes the window onto a mesh the config does not list (never clips silently)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-exit-')); dirs.push(dir);
    const { writes } = mockStore(dir, paths());
    const graphPath = await writeGraph(dir, [node('west_exit', 'exit', 'street', -1000, 0)]);
    const poisPath = await writePois(dir, [poi('exit-w', 'exit', ['west_exit'])]);
    await expect(contextGlb('ikebukuro', { sourceIds: all4, graphPath, poisPath, kinds: 'bldg,tran' })).rejects.toThrow(/needs 3rd-level meshes 53394575, 53394576, 53394577.*53394575 bldg \(not in the context config\), 53394575 tran \(not in the context config\)/s);
    expect(writes).not.toHaveBeenCalled();
    // The same window without the exit disc is complete.
    await expect(contextGlb('ikebukuro', { sourceIds: all4, graphPath, poisPath, exitRadiusM: 0 })).resolves.toMatchObject({ mesh_coverage: { needed_meshes: ['53394576', '53394577'] } });
  });

  it('fails with the mesh and source named when a configured needed source is not acquired', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-unacquired-')); dirs.push(dir);
    const p = paths(); delete p[all4[3]!];
    const { writes } = mockStore(dir, p);
    await expect(contextGlb('ikebukuro', { sourceIds: all4, exitRadiusM: 0, kinds: 'bldg,tran' })).rejects.toThrow(/not acquired or not usable: meshes 53394577: plateau-13116-tran-53394577/);
    expect(writes).not.toHaveBeenCalled();
  });

  it('ignores configured sources whose mesh the window does not touch, and reports them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-unused-')); dirs.push(dir);
    mockStore(dir, paths());
    const frame = await stationFrame();
    const window = await buildContextWindow({ r_origin_m: 250, r_exit_m: 0 }, { stationId: 'ikebukuro' });
    expect(assertMeshCoverage('ikebukuro', window, frame, [...all4, 'plateau-13116-bldg-53394586'])).toMatchObject({ meshes: ['53394576', '53394577'], unusedSources: ['plateau-13116-bldg-53394586'], neededSources: all4 });
    expect(() => assertMeshCoverage('ikebukuro', window, frame, ['plateau-13116-bldg-53394586'])).toThrow(/53394576 bldg/);
  });
});

describe('merged output', () => {
  const sortedRanges = (report: Awaited<ReturnType<typeof buildWith>>['report'], mesh: string) => report.per_feature.filter((f) => f.mesh === mesh).map((f) => [Number(f.tri_start), Number(f.tri_count), String(f.gml_id)] as const).sort((a, b) => a[0] - b[0]);

  it('merge kind: exactly two meshes (one building, one road), one material and one primitive each, role-safe names', async () => {
    const { report, document } = await buildWith({ merge: { mode: 'kind' } });
    const nodes = document.getRoot().listNodes();
    expect(nodes.map((n) => n.getName()).sort()).toEqual(['ctx_bldg_all', 'ctx_road_all']);
    expect(document.getRoot().listMeshes().map((m) => m.getName()).sort()).toEqual(['ctx_bldg_all', 'ctx_road_all']);
    expect(report.totals).toMatchObject({ meshes: 2, nodes: 2, draw_calls: 2, converted: 7 });
    for (const n of nodes) {
      expect(explorerRoleFromName(n.getName())).toBeNull();
      const prims = n.getMesh()!.listPrimitives();
      expect(prims).toHaveLength(1); // single material per kind
      expect(n.getMesh()!.getName()).toBe(n.getName());
    }
    expect(nodes.find((n) => n.getName() === 'ctx_bldg_all')!.getMesh()!.listPrimitives()[0]!.getMaterial()!.getName()).toBe('building');
    expect(nodes.find((n) => n.getName() === 'ctx_road_all')!.getMesh()!.listPrimitives()[0]!.getMaterial()!.getName()).toBe('road_surface');
    expect(document.getRoot().listMaterials().map((m) => m.getName()).sort()).toEqual(['building', 'road_surface']);
    expect(contextMergedName('bldg', null)).toBe('ctx_bldg_all'); expect(contextMergedName('tran', null)).toBe('ctx_road_all');
    expect(contextMergedName('bldg', [3, 5])).toBe('ctx_bldg_t03_05');
  });

  it('keeps provenance in the mesh extras without per-feature nodes', async () => {
    const { report, document, frame } = await buildWith({ merge: { mode: 'kind' } });
    for (const node of document.getRoot().listNodes()) {
      for (const extras of [node.getExtras(), node.getMesh()!.getExtras()]) {
        expect(extras).toMatchObject({ gteki_role: 'context', navigation_use: 'NOT_FOR_ROUTING', visual_only: true, verification: 'UNVERIFIED', merged: true, merge: 'kind', variant: 'high', frame_id: frame.frame_id, station_json_sha256: frame.station_json_sha256, attribution_text: '出典：SYNTHETIC attribution' });
        expect(extras.window).toMatchObject({ r_origin_m: 250, r_exit_m: 120, disc_count: 3, node_rule: IKEBUKURO_RULE });
        expect(String(extras.graph_sha256)).toMatch(/^[a-f0-9]{64}$/);
        expect(extras.graph_sha256).toBe(report.window.graph!.graph_sha256);
      }
    }
    const bldg = document.getRoot().listNodes().find((n) => n.getName() === 'ctx_bldg_all')!.getExtras(), road = document.getRoot().listNodes().find((n) => n.getName() === 'ctx_road_all')!.getExtras();
    expect(bldg).toMatchObject({ kind: 'building', source_ids: ['synthetic-bldg'], source_sha256s: { 'synthetic-bldg': 'a'.repeat(64) }, feature_count: 6, lod_used: { LOD1: 5, LOD2: 1 } });
    expect(road).toMatchObject({ kind: 'road', source_ids: ['synthetic-tran'], source_sha256s: { 'synthetic-tran': 'b'.repeat(64) }, feature_count: 1, lod_used: { LOD3: 1 } });
    expect(document.getRoot().listScenes()[0]!.getExtras()).toMatchObject({ merge: 'kind', variant: 'high', graph_sha256: report.window.graph!.graph_sha256, station_json_sha256: frame.station_json_sha256 });
  });

  it('feature table: every triangle of a merged mesh belongs to exactly one gml_id, in contiguous ranges', async () => {
    const merged = await buildWith({ merge: { mode: 'kind' } });
    const perFeature = await buildWith({ merge: { mode: 'none' } });
    const readCounts = new Map(merged.document.getRoot().listNodes().map((n) => [n.getName(), n.getMesh()!.listPrimitives().reduce((t, p) => t + p.getIndices()!.getCount() / 3, 0)]));
    let covered = 0;
    for (const [mesh, triangles] of readCounts) {
      const ranges = sortedRanges(merged.report, mesh);
      let cursor = 0;
      for (const [start, count] of ranges) { expect(start).toBe(cursor); expect(count).toBeGreaterThan(0); cursor += count; }
      expect(cursor).toBe(triangles); // exactly the GLB's triangle count: no gaps, no overlaps
      expect(new Set(ranges.map((r) => r[2])).size).toBe(ranges.length);
      covered += cursor;
    }
    expect(covered).toBe(merged.report.totals.triangles);
    // Same geometry as the per-feature layout, feature by feature.
    expect(merged.report.totals.triangles).toBe(perFeature.report.totals.triangles);
    for (const row of merged.report.per_feature) expect(row.tri_count).toBe(perFeature.report.per_feature.find((f) => f.gml_id === row.gml_id)!.tri_count);
    expect(merged.report.bbox_local_ENU).toEqual(perFeature.report.bbox_local_ENU);
    expect(merged.report.totals.triangles_by_kind).toEqual({ building: 12 * 5 + 16, road: 4 });
    expect(merged.report.validation).toMatchObject({ status: 'PASS', feature_table_covers_every_triangle_once: true });
  });

  it('merged layouts are deterministic and differ from none only in packaging', async () => {
    const a = await buildWith({ merge: { mode: 'kind' } }), b = await buildWith({ merge: { mode: 'kind' } });
    expect(createHash('sha256').update(await readFile(a.outputPath)).digest('hex')).toBe(createHash('sha256').update(await readFile(b.outputPath)).digest('hex'));
    expect(a.report.layout).toMatchObject({ merge: 'kind', mesh_count: 2, draw_calls: 2, tile_size_m: null });
    expect(a.report.layout.meshes.map((m) => m.name)).toEqual(['ctx_bldg_all', 'ctx_road_all']);
  });

  it('tiles:<size>: a few meshes per kind on a window-anchored grid, whole features, each triangle in exactly one tile', async () => {
    const spec = parseMergeSpec('tiles:200');
    expect(spec).toEqual({ mode: 'tiles', sizeM: 200 });
    const { report, document } = await buildWith({ merge: spec });
    const names = document.getRoot().listNodes().map((n) => n.getName());
    expect(names.length).toBeGreaterThan(2); expect(names.length).toBeLessThan(report.totals.converted);
    for (const name of names) { expect(name).toMatch(/^ctx_(bldg|road)_t\d{2}_\d{2}$/); expect(explorerRoleFromName(name)).toBeNull(); }
    expect(new Set(names).size).toBe(names.length);
    expect(report.layout).toMatchObject({ merge: 'tiles:200', tile_size_m: 200, tiles_used: names.length });
    // Window box: x in [-250, 420], y in [-250, 420] -> grid origin (-400, -400); the centre of bldg_lod1only (60, 40) falls in tile (2, 2).
    expect(report.layout.tile_grid_origin_station_xy_m).toEqual([-400, -400]);
    expect(report.per_feature.find((f) => f.gml_id === 'bldg_lod1only')!.mesh).toBe('ctx_bldg_t02_02');
    expect(report.per_feature.find((f) => f.gml_id === 'bldg_far_out')!.mesh).toBe('ctx_bldg_t03_03'); // centre (300, 300)
    expect(report.layout.tile_centres_clamped_to_grid).toBe(0);
    let covered = 0;
    for (const node of document.getRoot().listNodes()) {
      const ranges = sortedRanges(report, node.getName());
      let cursor = 0;
      for (const [start, count] of ranges) { expect(start).toBe(cursor); cursor += count; }
      expect(cursor).toBe(node.getMesh()!.listPrimitives().reduce((t, p) => t + p.getIndices()!.getCount() / 3, 0));
      expect(node.getExtras()).toMatchObject({ merged: true, merge: 'tiles:200', gteki_role: 'context', feature_count: ranges.length });
      expect(node.getExtras().tile).toHaveLength(2);
      covered += cursor;
    }
    expect(covered).toBe(report.totals.triangles);
    const kind = await buildWith({ merge: { mode: 'kind' } });
    expect(report.totals.triangles).toBe(kind.report.totals.triangles);
    expect(() => parseMergeSpec('tiles:5')).toThrow(/between 10 and 5000/);
    expect(() => parseMergeSpec('tiles:')).toThrow(/Invalid --merge/);
    expect(() => parseMergeSpec('grid')).toThrow(/none, kind or tiles/);
  });

  it('merge none keeps one node per feature for debugging, with the old per-class materials', async () => {
    const { report, document } = await buildWith({ merge: { mode: 'none' } });
    expect(document.getRoot().listNodes()).toHaveLength(7);
    expect(document.getRoot().listMaterials().map((m) => m.getName())).toEqual(['building_wall', 'building_roof', 'building_other', 'road_surface']);
    expect(report.per_feature.every((f) => f.tri_start === 0 && f.tri_count === f.triangles)).toBe(true);
    expect(report.validation.feature_table_covers_every_triangle_once).toMatch(/n\/a/);
  });
});

describe('low variant', () => {
  async function withLod2OnlyBuilding(): Promise<ContextInput[]> {
    // A copy of the bldg fixture in which bldg_lod12 has no LOD1 solid (LOD2 only).
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-lod2only-')); dirs.push(dir);
    const xml = await readFile(fixture('context-bldg.xml'), 'utf8');
    const start = xml.indexOf('<bldg:Building gml:id="bldg_lod12">'), end = xml.indexOf('</bldg:Building>', start);
    const block = xml.slice(start, end), lod1 = /<bldg:lod1Solid>[\s\S]*?<\/bldg:lod1Solid>/.exec(block)!;
    const path = join(dir, 'bldg-lod2only.xml');
    await writeFile(path, xml.slice(0, start) + block.replace(lod1[0], '') + xml.slice(end));
    return [{ ...inputs[0]!, path }, inputs[1]!];
  }

  it('draws buildings from LOD1 only, never LOD0 or LOD2, and keeps the LOD3 roads', async () => {
    const high = await buildWith({ merge: { mode: 'none' }, variant: 'high' });
    const low = await buildWith({ merge: { mode: 'none' }, variant: 'low' });
    const byId = new Map(low.report.per_feature.map((f) => [f.gml_id, f]));
    expect(byId.get('bldg_lod12')).toMatchObject({ lod_used: 'LOD1', triangles: 12 }); // LOD2 (16 triangles) is not used in low
    expect(byId.get('bldg_lod2_unresolved')).toMatchObject({ lod_used: 'LOD1', lod_fallback: null }); // low never needs the LOD2 -> LOD1 fallback
    for (const f of low.report.per_feature.filter((f) => f.type === 'Building')) expect(f.lod_used).toBe('LOD1');
    expect(low.report.per_feature.find((f) => f.gml_id === 'tran_lod123')).toMatchObject({ lod_used: 'LOD3', triangles: 4 });
    expect(low.report.totals.lod_used).toEqual({ LOD1: 6, LOD3: 1 });
    expect(high.report.totals.lod_used).toEqual({ LOD1: 5, LOD2: 1, LOD3: 1 });
    expect(low.report.totals.triangles_by_kind).toEqual({ building: 72, road: 4 });
    expect(high.report.totals.triangles_by_kind).toEqual({ building: 76, road: 4 });
    expect(low.report.variant).toBe('low'); expect(low.report.lod_policy).toMatch(/LOD1 only/);
    expect(low.report.sources[0]!.lod2_fallback_to_lod1).toBe(0);
    expect(low.document.getRoot().listScenes()[0]!.getExtras()).toMatchObject({ variant: 'low' });
  });

  it('excludes and counts a building without LOD1 instead of substituting LOD2 or LOD0', async () => {
    const lod2only = await withLod2OnlyBuilding();
    const high = await buildWith({ merge: { mode: 'kind' }, variant: 'high', inputsOverride: lod2only });
    const low = await buildWith({ merge: { mode: 'kind' }, variant: 'low', inputsOverride: lod2only });
    expect(high.report.per_feature.find((f) => f.gml_id === 'bldg_lod12')).toMatchObject({ lod_used: 'LOD2' });
    expect(idsOf(low.report)).not.toContain('bldg_lod12');
    expect(idsOf(low.report)).not.toContain('bldg_lod0only');
    // lod0only (LOD0 footprint only) and the LOD2-only building: both counted under the low-variant reason.
    expect(low.report.sources[0]!.excluded).toEqual({ building_no_lod1_excluded_in_low_variant: 2 });
    expect(low.report.totals.excluded).toMatchObject({ building_no_lod1_excluded_in_low_variant: 2 });
    expect(low.report.totals.triangles_by_kind.building).toBe(12 * 5); // five LOD1 buildings
  });

  it('reports building and road triangle counts separately in the receipt, per variant, and merged meshes carry the variant', async () => {
    const low = await buildWith({ merge: { mode: 'kind' }, variant: 'low' });
    expect(low.report.totals.triangles_by_kind).toEqual({ building: 72, road: 4 });
    expect(low.report.totals.features_by_kind).toEqual({ building: 6, road: 1 });
    expect(low.report.layout.meshes.map((m) => [m.name, m.triangles])).toEqual([['ctx_bldg_all', 72], ['ctx_road_all', 4]]);
    expect(low.document.getRoot().listNodes().every((n) => n.getExtras().variant === 'low')).toBe(true);
    expect(() => parseMergeSpec('kind')).not.toThrow();
  });
});

describe('run-id digest', () => {
  it('changes when only the pois.json hash changes, so builds with different embedded provenance never share an artifact path', () => {
    const base = { frame: { frame_id: 'f' }, windowSpec: { r_origin_m: 250 }, discs: [['origin', 0, 0, 250]], graphSha256: 'a'.repeat(64), poisSha256: 'b'.repeat(64), merge: 'kind', variant: 'low', kinds: ['bldg'], sources: [['s', 'c'.repeat(64)]] as [string, string][], fingerprint: 'd'.repeat(64) };
    expect(contextRunDigest(base)).toMatch(/^[a-f0-9]{20}$/);
    expect(contextRunDigest({ ...base, poisSha256: 'e'.repeat(64) })).not.toBe(contextRunDigest(base));
    expect(contextRunDigest({ ...base, poisSha256: null })).not.toBe(contextRunDigest(base));
    expect(contextRunDigest({ ...base, graphSha256: 'f'.repeat(64) })).not.toBe(contextRunDigest(base));
    expect(contextRunDigest({ ...base })).toBe(contextRunDigest(base));
  });
});

describe('--kinds (buildings-only context)', () => {
  it('road meshes are geometry only: no tran attribute value or name reaches the GLB (Owner risk acceptance, #39)', async () => {
    for (const merge of [{ mode: 'none' }, { mode: 'kind' }, { mode: 'tiles', sizeM: 380 }] as MergeSpec[]) {
      const { document } = await buildWith({ merge });
      const roads = document.getRoot().listMeshes().filter((m) => m.getName().startsWith('ctx_road'));
      expect(roads.length).toBeGreaterThan(0);
      for (const mesh of roads) {
        for (const prim of mesh.listPrimitives()) expect(prim.listSemantics().sort()).toEqual(['NORMAL', 'POSITION']);
        const nodes = document.getRoot().listNodes().filter((n) => n.getMesh() === mesh);
        const text = JSON.stringify([mesh.getExtras(), ...nodes.map((n) => n.getExtras())]);
        expect(text).not.toMatch(/tran:|"function"|"usage"|"class"|TrafficArea_function|codeSpace/);
      }
    }
  });

  const all4 = ['plateau-13116-bldg-53394576', 'plateau-13116-bldg-53394577', 'plateau-13116-tran-53394576', 'plateau-13116-tran-53394577'];
  function mockStore(dir: string) {
    const manifest = new Map(loadSources().map((s) => [s.source_id, s]));
    const stored = vi.spyOn(common, 'getStoredSource').mockImplementation(async (id: string) => ({ path: fixture(id.includes('-bldg-') ? 'context-bldg.xml' : 'context-tran.xml'), record: { source_id: id, sha256: createHash('sha256').update(id).digest('hex') }, source: manifest.get(id)! }) as Awaited<ReturnType<typeof common.getStoredSource>>);
    vi.spyOn(common, 'getStoreRoot').mockReturnValue(dir);
    const originalWrite = common.writeJson;
    vi.spyOn(common, 'writeJson').mockImplementation(async (path, value) => originalWrite(path.startsWith(common.docsRoot) ? join(dir, 'docs', relative(common.docsRoot, path)) : path, value));
    return stored;
  }

  it('kinds=bldg: only ctx_bldg_* meshes, no tran source is read, kinds recorded in receipt, run id, window and extras', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-kinds-')); dirs.push(dir);
    const stored = mockStore(dir);
    const full = await contextGlb('ikebukuro', { sourceIds: all4, exitRadiusM: 0, kinds: 'bldg,tran' });
    stored.mockClear();
    const bldg = await contextGlb('ikebukuro', { sourceIds: all4, exitRadiusM: 0, kinds: 'bldg' });
    expect(stored.mock.calls.map((c) => c[0]).sort()).toEqual([all4[0], all4[1]]); // tran sources are never opened
    expect(bldg.kinds).toEqual(['bldg']); expect(full.kinds).toEqual(['bldg', 'tran']);
    expect(bldg.run_id).toMatch(/-high-kind-bldg-[a-f0-9]{20}$/);
    expect(full.run_id).toMatch(/-high-kind-[a-f0-9]{20}$/); expect(full.run_id).not.toMatch(/-bldg-/);
    expect(bldg.run_id).not.toBe(full.run_id);
    expect(bldg.window.kinds).toEqual(['bldg']);
    expect(bldg.sources.map((src) => src.kind)).toEqual(['bldg', 'bldg']);
    expect(bldg.totals).toMatchObject({ meshes: 1, draw_calls: 1, triangles_by_kind: { building: 52, road: 0 }, features_by_kind: { building: 4, road: 0 } });
    expect(bldg.layout.meshes.map((m) => m.name)).toEqual(['ctx_bldg_all']);
    expect(bldg.mesh_coverage).toMatchObject({ kinds: ['bldg'], needed_sources: [all4[0], all4[1]], excluded_kind_sources: [all4[2], all4[3]] });
    const doc = await new NodeIO().readBinary(await readFile(join(dir, bldg.store_path)));
    expect(doc.getRoot().listNodes().map((n) => n.getName())).toEqual(['ctx_bldg_all']);
    expect(doc.getRoot().listMaterials().map((m) => m.getName())).toEqual(['building', 'road_surface']); // fixed merged material set; no road geometry uses it
    for (const extras of [doc.getRoot().listNodes()[0]!.getExtras(), doc.getRoot().listMeshes()[0]!.getExtras(), doc.getRoot().listScenes()[0]!.getExtras()]) expect(extras.kinds).toEqual(['bldg']);
    expect((doc.getRoot().listNodes()[0]!.getExtras().window as { kinds: string[] }).kinds).toEqual(['bldg']);
    const receipt = JSON.parse(await readFile(join(dir, 'docs', 'gis', 'context', `${bldg.run_id}.json`), 'utf8'));
    expect(receipt).toMatchObject({ run_id: bldg.run_id, kinds: ['bldg'], window: { kinds: ['bldg'] } });
  });

  it('kinds=tran works too; coverage is checked only for the requested kinds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-kinds-tran-')); dirs.push(dir);
    const stored = mockStore(dir);
    // No tran source for mesh 53394577 is configured: fine for bldg, fatal for tran or both.
    const bldgOnly = [all4[0]!, all4[1]!, all4[2]!];
    await expect(contextGlb('ikebukuro', { sourceIds: bldgOnly, exitRadiusM: 0, kinds: 'bldg,tran' })).rejects.toThrow(/53394577 tran/);
    await expect(contextGlb('ikebukuro', { sourceIds: bldgOnly, exitRadiusM: 0, kinds: 'tran' })).rejects.toThrow(/no tran source is configured for: 53394577 tran/);
    await expect(contextGlb('ikebukuro', { sourceIds: [all4[0]!, all4[2]!, all4[3]!], exitRadiusM: 0, kinds: 'bldg' })).rejects.toThrow(/no bldg source is configured for: 53394577 bldg/);
    stored.mockClear();
    const ok = await contextGlb('ikebukuro', { sourceIds: [all4[0]!, all4[1]!], exitRadiusM: 0, kinds: ['bldg'] });
    expect(ok.mesh_coverage.needed_meshes).toEqual(['53394576', '53394577']);
    const tran = await contextGlb('ikebukuro', { sourceIds: all4, exitRadiusM: 0, kinds: 'tran' });
    expect(tran.run_id).toMatch(/-kind-tran-/);
    expect(tran.layout.meshes.map((m) => m.name)).toEqual(['ctx_road_all']);
    expect(tran.totals.triangles_by_kind).toEqual({ building: 0, road: 4 });
  });

  it('refuses invalid kinds; the Ikebukuro config defaults to both kinds (roads: Owner risk acceptance, geometry only)', async () => {
    expect(parseKinds('tran,bldg')).toEqual(['bldg', 'tran']); // canonical order, so the same run id either way
    expect(parseKinds('bldg,bldg')).toEqual(['bldg']);
    for (const bad of ['', 'ubld', 'bldg,road', 'all', ',']) expect(() => parseKinds(bad)).toThrow(/Invalid --kinds/);
    expect(() => parseKinds([])).toThrow(/Invalid --kinds/);
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-kinds-bad-')); dirs.push(dir);
    const stored = mockStore(dir);
    await expect(contextGlb('ikebukuro', { sourceIds: all4, kinds: 'road' })).rejects.toThrow(/Invalid --kinds "road"/);
    expect(stored).not.toHaveBeenCalled();
    const config = await loadContextConfig('ikebukuro');
    expect(config.kinds).toBeUndefined();
    await expect(buildContextGlb({ frame: await stationFrame(), radiusM: 250, inputs, outputPath: join(dir, 'x.glb'), kinds: ['bldg', 'x' as never] })).rejects.toThrow(/Invalid --kinds/);
    await expect(buildContextGlb({ frame: await stationFrame(), radiusM: 250, inputs: [inputs[0]!], outputPath: join(dir, 'y.glb'), kinds: ['tran'] })).rejects.toThrow(/at least one source of kind tran/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Shinjuku (decision: GitHub #39 comment 6324045059): per-feature ground flattening, poi_ids window, r_origin_m 0.

const SJ_ATTRIBUTION = '出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成';
const sjInputs: ContextInput[] = [
  { sourceId: 'synthetic-sj-bldg', sourceSha256: 'c'.repeat(64), kind: 'bldg', path: fixture('context-bldg-shinjuku.xml'), attributionText: SJ_ATTRIBUTION },
  { sourceId: 'synthetic-sj-tran', sourceSha256: 'd'.repeat(64), kind: 'tran', path: fixture('context-tran-shinjuku.xml'), attributionText: SJ_ATTRIBUTION },
];
const SJ_EXIT_IDS = ['poi:exit:1', 'poi:exit:2', 'poi:exit:3', 'poi:exit:4'];
const SJ_RULE: NodeRule = { graph: 'stations/shinjuku/gteki/graph.json', exit_kinds: [], street_floor_ids: [], poi_ids: SJ_EXIT_IDS };
/** Shinjuku-like graph: exits 1-4 near the origin on toei-nwd floors, exits 5 and 6 on B1 far away (only exit 5 reaches the fixture building sj_only_exit5). */
const SJ_NODES = [node('x1', 'exit', 'toei-nwd-0', 0, 0), node('x2', 'exit', 'toei-nwd-0', 10, 0), node('x3', 'exit', 'toei-nwd-1', 0, 10), node('x4', 'exit', 'toei-nwd-0', 10, 10), node('x5', 'exit', 'toei-nwd-m1', 500, 500), node('x6', 'exit', 'toei-nwd-m1', -500, -500)];
const SJ_POIS = [1, 2, 3, 4, 5, 6].map((n) => poi(`poi:exit:${n}`, 'exit', [`x${n}`]));
async function shinjukuFrame(): Promise<StationEnuFrame> {
  const frame = await loadFrame('shinjuku-station-enu-v0');
  if (!isStationEnuFrame(frame)) throw new Error('expected a station-enu frame');
  return frame;
}
async function buildSj(opts: { kinds?: ContextKind[]; groundAttrs?: string[]; merge?: MergeSpec; nodes?: ReturnType<typeof node>[]; pois?: unknown[]; rule?: NodeRule; exitR?: number; neighbourR?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gteki-context-sj-')); dirs.push(dir);
  const graphPath = await writeGraph(dir, opts.nodes ?? SJ_NODES, 'shinjuku');
  const poisPath = await writePois(dir, opts.pois ?? SJ_POIS, 'shinjuku');
  const window = await buildContextWindow({ r_origin_m: 0, r_exit_m: opts.exitR ?? 300, node_rule: opts.rule ?? SJ_RULE }, { stationId: 'shinjuku', graphPath, poisPath });
  const frame = await shinjukuFrame();
  const outputPath = join(dir, 'context.glb');
  const report = await buildContextGlb({ frame, window, inputs: sjInputs, outputPath, merge: opts.merge ?? { mode: 'none' }, kinds: opts.kinds ?? ['bldg'], ...(opts.groundAttrs ? { groundHeightAttributes: opts.groundAttrs } : {}), ...(opts.neighbourR !== undefined ? { exitNeighbourRadiusM: opts.neighbourR } : {}) });
  const document = await new NodeIO().readBinary(await readFile(outputPath));
  return { dir, outputPath, frame, window, report, document, graphPath, poisPath };
}
/** Min and max station z (glTF y) of one node's mesh. */
function zRange(document: Awaited<ReturnType<typeof buildSj>>['document'], name: string): [number, number] {
  const node = document.getRoot().listNodes().find((n) => n.getName() === name);
  if (!node) throw new Error(`no node ${name}`);
  let lo = Infinity, hi = -Infinity;
  for (const primitive of node.getMesh()!.listPrimitives()) { const acc = primitive.getAttribute('POSITION')!; for (let i = 0; i < acc.getCount(); i++) { const y = acc.getElement(i, [0, 0, 0])[1]!; lo = Math.min(lo, y); hi = Math.max(hi, y); } }
  return [lo, hi];
}
const near = (actual: number, expected: number): void => { expect(Math.abs(actual - expected)).toBeLessThan(2e-3); };
const sjIds = (report: Awaited<ReturnType<typeof buildSj>>['report']): string[] => report.per_feature.map((f) => String(f.gml_id)).sort();

describe('Shinjuku: each building is flattened to symbolic street z = 0 by its own ground height', () => {
  it('two buildings at different ground heights both end with base z = 0 and keep their relative roof heights', async () => {
    const { report, document } = await buildSj();
    expect(sjIds(report)).toEqual(['sj_a', 'sj_b', 'sj_c', 'sj_d', 'sj_gs', 'sj_lod2', 'sj_lod2only']);
    const a = zRange(document, 'ctx_bldg_sj_a'), b = zRange(document, 'ctx_bldg_sj_b'), d = zRange(document, 'ctx_bldg_sj_d');
    // sj_a: TP 30..45, sj_b: TP 40..52, sj_d: TP 36..60 -> base 0, roof = the building's own height.
    near(a[0], 0); near(a[1], 15);
    near(b[0], 0); near(b[1], 12);
    near(d[0], 0); near(d[1], 24);
    // One constant for all buildings would have left at least one base off zero.
    expect(new Set(report.per_feature.map((f) => f.ground_height_m)).size).toBeGreaterThan(3);
  });

  it('LOD2 drawn with bldg:GroundSurface: the ground is the GroundSurface minimum (not the lower wall bottom of a sunken entrance), with the spread recorded', async () => {
    const { report, document } = await buildSj();
    // sj_gs: LOD1 base 35, GroundSurface polygons at 36.0 and 36.5, walls down to 34.0, roof 50.
    expect(report.per_feature.find((f) => f.gml_id === 'sj_gs')).toMatchObject({ lod_used: 'LOD2', ground_height_m: 36, ground_basis: 'ground_surface_lod2', ground_surface_spread_m: 0.5 });
    const [lo, hi] = zRange(document, 'ctx_bldg_sj_gs');
    near(lo, -2); near(hi, 14); // the wall bottom sits 2 m below the street, it does not drag the base down
    // Buildings that do not use that basis carry no spread.
    expect(report.per_feature.filter((f) => f.ground_basis !== 'ground_surface_lod2').every((f) => f.ground_surface_spread_m === null)).toBe(true);
    expect(report.ground_offsets!.ground_surface_spread).toEqual({ count: 1, min_m: 0.5, median_m: 0.5, max_m: 0.5 });
  });

  it('LOD2 drawn without a GroundSurface falls back to the bottom of the lod1Solid, not the LOD2 minimum', async () => {
    const { report, document } = await buildSj();
    expect(report.per_feature.find((f) => f.gml_id === 'sj_lod2')).toMatchObject({ lod_used: 'LOD2', ground_height_m: 29, ground_basis: 'lod1_solid_bottom', ground_surface_spread_m: null }); // LOD2 starts at 31
    const [lo, hi] = zRange(document, 'ctx_bldg_sj_lod2');
    near(lo, 2); near(hi, 15);
    // A LOD1-drawn building uses its own lod1Solid bottom too.
    expect(report.per_feature.find((f) => f.gml_id === 'sj_a')).toMatchObject({ lod_used: 'LOD1', ground_height_m: 30, ground_basis: 'lod1_solid_bottom' });
  });

  it('last resort: a LOD2-only building without GroundSurface or lod1Solid uses the min z of the drawn LOD', async () => {
    const { report, document } = await buildSj();
    expect(report.per_feature.find((f) => f.gml_id === 'sj_lod2only')).toMatchObject({ lod_used: 'LOD2', ground_height_m: 32, ground_basis: 'min_z_of_drawn_lod' });
    const [lo, hi] = zRange(document, 'ctx_bldg_sj_lod2only');
    near(lo, 0); near(hi, 12);
  });

  it('priority: the configured ground-height attribute beats every other basis, then GroundSurface, lod1Solid, drawn-LOD min; counts per basis in priority order', async () => {
    const without = await buildSj();
    expect(without.report.ground_offsets!.buildings).toEqual({ count: 7, min_m: 29, median_m: 35, max_m: 40, basis_counts: { ground_height_attribute: 0, ground_surface_lod2: 1, lod1_solid_bottom: 5, min_z_of_drawn_lod: 1 } });
    expect(Object.keys(without.report.ground_offsets!.buildings!.basis_counts)).toEqual(['ground_height_attribute', 'ground_surface_lod2', 'lod1_solid_bottom', 'min_z_of_drawn_lod']);
    expect(without.report.per_feature.find((f) => f.gml_id === 'sj_c')).toMatchObject({ ground_height_m: 35, ground_basis: 'lod1_solid_bottom' });
    const withAttr = await buildSj({ groundAttrs: ['groundHeight'] });
    expect(withAttr.report.per_feature.find((f) => f.gml_id === 'sj_c')).toMatchObject({ ground_height_m: 33.5, ground_basis: 'ground_height_attribute' });
    expect(withAttr.report.per_feature.map((f) => [f.gml_id, f.ground_basis])).toEqual([['sj_a', 'lod1_solid_bottom'], ['sj_b', 'lod1_solid_bottom'], ['sj_c', 'ground_height_attribute'], ['sj_d', 'lod1_solid_bottom'], ['sj_lod2', 'lod1_solid_bottom'], ['sj_gs', 'ground_surface_lod2'], ['sj_lod2only', 'min_z_of_drawn_lod']]);
    // The attribute (33.5) sits 1.5 m below the building's own LOD1 base (35): the base is not forced to 0, the offset is the attribute.
    const [lo, hi] = zRange(withAttr.document, 'ctx_bldg_sj_c');
    near(lo, 1.5); near(hi, 13.5);
    expect(withAttr.report.ground_offsets!.buildings).toEqual({ count: 7, min_m: 29, median_m: 33.5, max_m: 40, basis_counts: { ground_height_attribute: 1, ground_surface_lod2: 1, lod1_solid_bottom: 4, min_z_of_drawn_lod: 1 } });
  });

  it('the low variant draws LOD1, so every building with a lod1Solid uses its bottom; the LOD2-only building is excluded there', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-sj-low-')); dirs.push(dir);
    const window = await buildContextWindow({ r_origin_m: 0, r_exit_m: 300, node_rule: SJ_RULE }, { stationId: 'shinjuku', graphPath: await writeGraph(dir, SJ_NODES, 'shinjuku'), poisPath: await writePois(dir, SJ_POIS, 'shinjuku') });
    const report = await buildContextGlb({ frame: await shinjukuFrame(), window, inputs: [sjInputs[0]!], outputPath: join(dir, 'low.glb'), variant: 'low', kinds: ['bldg'] });
    expect(report.ground_offsets!.buildings!.basis_counts).toEqual({ ground_height_attribute: 0, ground_surface_lod2: 0, lod1_solid_bottom: 6, min_z_of_drawn_lod: 0 });
    expect(report.per_feature.find((f) => f.gml_id === 'sj_gs')).toMatchObject({ lod_used: 'LOD1', ground_height_m: 35, ground_basis: 'lod1_solid_bottom' });
    expect(report.sources[0]!.excluded).toMatchObject({ building_no_lod1_excluded_in_low_variant: 1 });
  });

  it('records min, median and max of the subtracted ground heights and the count per basis, keys in priority order (median of an even count = mean of the middle two)', () => {
    expect(groundOffsetStats([])).toBeNull();
    const stats = groundOffsetStats([{ offset: 30, basis: 'min_z_of_drawn_lod' }, { offset: 41, basis: 'ground_height_attribute' }, { offset: 32, basis: 'lod1_solid_bottom' }, { offset: 35.1234, basis: 'ground_surface_lod2' }])!;
    expect(stats).toEqual({ count: 4, min_m: 30, median_m: 33.562, max_m: 41, basis_counts: { ground_height_attribute: 1, ground_surface_lod2: 1, lod1_solid_bottom: 1, min_z_of_drawn_lod: 1 } });
    expect(Object.keys(stats.basis_counts)).toEqual([...GROUND_BASES]);
    expect(spreadStats([])).toBeNull();
    expect(spreadStats([0.4, 0.1, 0.25, 0.8])).toEqual({ count: 4, min_m: 0.1, median_m: 0.325, max_m: 0.8 });
  });

  it('refuses a configured ground-height attribute that is not a number or has a non-metre unit, rather than guessing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-sj-bad-')); dirs.push(dir);
    const xml = await readFile(fixture('context-bldg-shinjuku.xml'), 'utf8');
    for (const [name, bad, pattern] of [['nan', xml.replace('uom="m">33.5<', 'uom="m">high<'), /not a finite number/], ['feet', xml.replace('uom="m">33.5<', 'uom="ft">33.5<'), /only metres are supported/]] as const) {
      const path = join(dir, `${name}.xml`); await writeFile(path, bad);
      await expect(scanContextFeatures(path, { kind: 'bldg', mode: 'collect', retain: () => true, groundHeightAttributes: ['groundHeight'], onFeature: () => undefined })).rejects.toThrow(pattern);
    }
    // Unconfigured: the attribute is ignored entirely (no ground_height on any record).
    const records: ContextFeatureRecord[] = [];
    await scanContextFeatures(fixture('context-bldg-shinjuku.xml'), { kind: 'bldg', mode: 'collect', retain: () => true, onFeature: (r) => records.push(r) });
    expect(records.some((r) => r.ground_height !== undefined)).toBe(false);
    const configured: ContextFeatureRecord[] = [];
    await scanContextFeatures(fixture('context-bldg-shinjuku.xml'), { kind: 'bldg', mode: 'collect', retain: () => true, groundHeightAttributes: ['groundHeight'], onFeature: (r) => configured.push(r) });
    expect(configured.filter((r) => r.ground_height !== undefined).map((r) => [r.gml_id, r.ground_height])).toEqual([['sj_c', { attribute: 'groundHeight', value_m: 33.5 }]]);
  });

  it('flattens roads per feature the same way when tran is requested', async () => {
    const { report, document } = await buildSj({ kinds: ['tran'] });
    expect(sjIds(report)).toEqual(['sj_road1', 'sj_road2']);
    expect(report.per_feature.map((f) => [f.gml_id, f.ground_height_m])).toEqual([['sj_road1', 31], ['sj_road2', 41.5]]);
    const r1 = zRange(document, 'ctx_road_sj_road1'), r2 = zRange(document, 'ctx_road_sj_road2');
    near(r1[0], 0); near(r1[1], 2); near(r2[0], 0); near(r2[1], 0.3);
    expect(report.ground_offsets).toMatchObject({ buildings: null, ground_surface_spread: null, roads: { count: 2, min_m: 31, median_m: 36.25, max_m: 41.5, basis_counts: { ground_height_attribute: 0, ground_surface_lod2: 0, lod1_solid_bottom: 0, min_z_of_drawn_lod: 2 } } }); // roads keep the drawn-LOD min
    expect(report.modifications).toEqual(['road surfaces flattened to street level']);
  });

  it('carries the modification notice and the vertical mode in the receipt, scene extras and every node and mesh extras', async () => {
    const { report, document } = await buildSj({ merge: { mode: 'kind' } });
    const notice = 'building bases flattened to street level';
    expect(report.modifications).toEqual([notice]);
    expect(report.modification_notice).toContain(notice);
    expect(report).toMatchObject({ vertical_mode: 'per_feature_ground', height_basis: 'per_feature_ground_flattened_symbolic_street_z0', attribution_text: SJ_ATTRIBUTION, frame: { vertical_mode: 'per_feature_ground', origin: { hM: null } } });
    expect(HEIGHT_BASIS_FLATTENED).toBe('per_feature_ground_flattened_symbolic_street_z0');
    const scene = document.getRoot().listScenes()[0]!.getExtras();
    expect(scene).toMatchObject({ gteki_role: 'context', navigation_use: 'NOT_FOR_ROUTING', visual_only: true, vertical_mode: 'per_feature_ground', height_basis: HEIGHT_BASIS_FLATTENED, modifications: [notice], attribution_text: SJ_ATTRIBUTION });
    expect(String(scene.modification_notice)).toContain(notice);
    expect((scene.ground_offsets as { buildings: GroundOffsetStats }).buildings.count).toBe(7);
    expect(scene.selection_rule).toMatch(/node_rule\.poi_ids/);
    for (const n of document.getRoot().listNodes()) for (const extras of [n.getExtras(), n.getMesh()!.getExtras()]) {
      expect(extras).toMatchObject({ gteki_role: 'context', navigation_use: 'NOT_FOR_ROUTING', visual_only: true, vertical_mode: 'per_feature_ground', height_basis: HEIGHT_BASIS_FLATTENED, modifications: [notice], attribution_text: SJ_ATTRIBUTION });
      expect(String(extras.modification_notice)).toContain(notice);
    }
    expect(document.getRoot().listNodes().map((n) => n.getName())).toEqual(['ctx_bldg_all']); // merge kind, ctx_bldg_* naming, no textures
    expect(document.getRoot().listTextures()).toHaveLength(0);
    expect(report.validation.status).toBe('PASS');
  });

  it('adds the road notice only when roads are converted', async () => {
    const { report } = await buildSj({ kinds: ['bldg', 'tran'], merge: { mode: 'kind' } });
    expect(report.modifications).toEqual(['building bases flattened to street level', 'road surfaces flattened to street level']);
  });
});

describe('Shinjuku: exit-neighbour ground-height spread (exit_neighbour_radius_m)', () => {
  // Exits 1-3 sit next to fixture buildings; exit 4 is far from everything; exit 5 (B1, not a window POI) sits inside sj_a.
  const NODES = [node('x1', 'exit', 'toei-nwd-0', 30, 50), node('x2', 'exit', 'toei-nwd-0', 110, 80), node('x3', 'exit', 'toei-nwd-1', -80, 50), node('x4', 'exit', 'toei-nwd-0', 500, -500), node('x5', 'exit', 'toei-nwd-m1', 45, 45), node('x6', 'exit', 'toei-nwd-m1', -500, -500)];

  it('per window POI: count, min/median/max of the subtracted ground height, basis counts and gml_ids of buildings within the radius of its connector', async () => {
    const { report } = await buildSj({ nodes: NODES, neighbourR: 30 });
    const n = report.exit_neighbours!;
    expect(n.radius_m).toBe(30);
    expect(n.pois.map((p) => p.poi_id)).toEqual(SJ_EXIT_IDS); // exits 5 and 6 are not window POIs: no entry
    expect(n.pois[0]).toEqual({ poi_id: 'poi:exit:1', connector_node_ids: ['x1'], count: 1, ground_height_m: { count: 1, min_m: 30, median_m: 30, max_m: 30 }, basis_counts: { ground_height_attribute: 0, ground_surface_lod2: 0, lod1_solid_bottom: 1, min_z_of_drawn_lod: 0 }, gml_ids: ['sj_a'] });
    expect(n.pois[1]).toMatchObject({ poi_id: 'poi:exit:2', count: 2, ground_height_m: { count: 2, min_m: 36, median_m: 38, max_m: 40 }, gml_ids: ['sj_b', 'sj_d'] });
    expect(n.pois[2]).toMatchObject({ poi_id: 'poi:exit:3', count: 2, ground_height_m: { count: 2, min_m: 29, median_m: 32.5, max_m: 36 }, basis_counts: { ground_surface_lod2: 1, lod1_solid_bottom: 1 }, gml_ids: ['sj_gs', 'sj_lod2'] });
    expect(n.pois[3]).toMatchObject({ poi_id: 'poi:exit:4', count: 0, ground_height_m: null, gml_ids: [] });
    expect(n.rule).toMatch(/footprint bbox/);
  });

  it('the radius is the config value: a smaller one drops the buildings, and without it (or on a TP frame) nothing is computed', async () => {
    const small = await buildSj({ nodes: NODES, neighbourR: 5 });
    expect(small.report.exit_neighbours!.pois.map((p) => p.count)).toEqual([0, 0, 0, 0]);
    const wide = await buildSj({ nodes: NODES, neighbourR: 60 });
    expect(wide.report.exit_neighbours!.pois[0]!.gml_ids).toEqual(['sj_a', 'sj_c']); // sj_c (40..60, 100..120) is 51 m from (30, 50)
    expect((await buildSj({ nodes: NODES })).report.exit_neighbours).toBeUndefined();
    expect('exit_neighbours' in (await build()).report).toBe(false);
    for (const bad of [0, -3, 501, Number.NaN]) await expect(buildSj({ nodes: NODES, neighbourR: bad })).rejects.toThrow(/exit_neighbour_radius_m/);
  });

  it('ships exit_neighbour_radius_m 30 in the Shinjuku config and not in Ikebukuro\'s', async () => {
    expect((await loadContextConfig('shinjuku')).exit_neighbour_radius_m).toBe(30);
    expect((await loadContextConfig('ikebukuro')).exit_neighbour_radius_m).toBeUndefined();
  });
});

describe('Shinjuku: window of 300 m discs around ground-level exits 1-4 (node_rule.poi_ids)', () => {
  it('gives a disc to the connector nodes of exits 1-4 only; exits 5 and 6 (kind exit, B1) get none and no origin disc exists', async () => {
    const { window, report } = await buildSj();
    expect(window.discs.map((d) => [d.id, d.x, d.y, d.r, d.origin])).toEqual([['x1', 0, 0, 300, 'node'], ['x2', 10, 0, 300, 'node'], ['x3', 0, 10, 300, 'node'], ['x4', 10, 10, 300, 'node']]);
    expect(window.graph).toMatchObject({ nodes_total: 6, selected_nodes: 4, exit_connectors: 0, street_level_nodes: 0, pois: { poi_ids: SJ_EXIT_IDS, connector_nodes: 4 } });
    expect(window.graph!.selected.map((n) => [n.id, n.matched_by, n.poi_ids])).toEqual([['x1', ['poi_id'], ['poi:exit:1']], ['x2', ['poi_id'], ['poi:exit:2']], ['x3', ['poi_id'], ['poi:exit:3']], ['x4', ['poi_id'], ['poi:exit:4']]]);
    // sj_only_exit5 lies only inside exit 5's disc: not selected when exits 5 and 6 are excluded; sj_far lies in none.
    expect(sjIds(report)).not.toContain('sj_only_exit5');
    expect(sjIds(report)).not.toContain('sj_far');
    expect(report.window).toMatchObject({ r_origin_m: 0, radius_m: 0, r_exit_m: 300, disc_count: 4, node_rule: { poi_ids: SJ_EXIT_IDS } });
    // Listing exit 5 as well does reach it: the rule is exactly the listed ids.
    const withFive = await buildSj({ rule: { ...SJ_RULE, poi_ids: [...SJ_EXIT_IDS, 'poi:exit:5'] } });
    expect(sjIds(withFive.report)).toContain('sj_only_exit5');
  });

  it('fails closed on a configured POI id that is missing, has no connector node, or names a node that is not in the graph', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-sj-poi-')); dirs.push(dir);
    const graphPath = await writeGraph(dir, SJ_NODES, 'shinjuku');
    const read = async (poiIds: string[], pois: unknown[]) => readGraphWindowNodes({ ...SJ_RULE, poi_ids: poiIds }, { stationId: 'shinjuku', graphPath, poisPath: await writePois(dir, pois, 'shinjuku') });
    await expect(read([...SJ_EXIT_IDS, 'poi:exit:9'], SJ_POIS)).rejects.toThrow(/poi:exit:9, which is not in .*pois\.json; refusing to guess/);
    await expect(read(SJ_EXIT_IDS, SJ_POIS.map((p) => (p.id === 'poi:exit:2' ? { ...p, connectorNodeIds: [] } : p)))).rejects.toThrow(/poi:exit:2 has no resolvable connectorNodeIds/);
    await expect(read(SJ_EXIT_IDS, SJ_POIS.map((p) => { const { connectorNodeIds, ...rest } = p; return p.id === 'poi:exit:3' ? rest : p; }))).rejects.toThrow(/poi:exit:3 has no resolvable connectorNodeIds/);
    await expect(read(SJ_EXIT_IDS, SJ_POIS.map((p) => (p.id === 'poi:exit:4' ? { ...p, connectorNodeIds: ['x404'] } : p)))).rejects.toThrow(/poi:exit:4 names connector node x404 that is not in/);
    await expect(read([], SJ_POIS)).rejects.toThrow(/poi_ids must be a non-empty array/);
    await expect(read(['poi:exit:1', 'poi:exit:1'], SJ_POIS)).rejects.toThrow(/poi_ids must be a non-empty array of distinct/);
    // Whole-window level: the failure stops the build, nothing is converted.
    await expect(buildContextWindow({ r_origin_m: 0, r_exit_m: 300, node_rule: { ...SJ_RULE, poi_ids: ['poi:exit:9'] } }, { stationId: 'shinjuku', graphPath, poisPath: await writePois(dir, SJ_POIS, 'shinjuku') })).rejects.toThrow(/poi:exit:9/);
  });

  it('r_origin_m 0 adds no disc; a window with no disc at all is refused; a positive R_origin still adds the origin disc', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-sj-r0-')); dirs.push(dir);
    const graphPath = await writeGraph(dir, SJ_NODES, 'shinjuku'), poisPath = await writePois(dir, SJ_POIS, 'shinjuku');
    const zero = await buildContextWindow({ r_origin_m: 0, r_exit_m: 300, node_rule: SJ_RULE }, { stationId: 'shinjuku', graphPath, poisPath });
    expect(zero.discs.some((d) => d.id === 'origin')).toBe(false);
    expect(zero.discs).toHaveLength(4);
    expect(zero.spec.r_origin_m).toBe(0);
    const some = await buildContextWindow({ r_origin_m: 100, r_exit_m: 300, node_rule: SJ_RULE }, { stationId: 'shinjuku', graphPath, poisPath });
    expect(some.discs.map((d) => d.id)).toEqual(['origin', 'x1', 'x2', 'x3', 'x4']);
    await expect(buildContextWindow({ r_origin_m: 0, r_exit_m: 0 }, { stationId: 'shinjuku' })).rejects.toThrow(/no disc.*radius/);
    await expect(buildContextWindow({ r_origin_m: 0, r_exit_m: 300, node_rule: SJ_RULE }, { stationId: 'shinjuku', graphPath: await writeGraph(dir, [], 'shinjuku'), poisPath })).rejects.toThrow(/names connector node x1 that is not in/);
    await expect(buildContextWindow({ r_origin_m: -1, r_exit_m: 300, node_rule: SJ_RULE }, { stationId: 'shinjuku', graphPath, poisPath })).rejects.toThrow(/radius/);
  });

  it('reads the committed Shinjuku graph: exits 1-4 on toei-nwd floors, the 4 connector positions, and exactly meshes 53394525, 26, 35 and 36', async () => {
    const dirOf = fileURLToPath(new URL('../../../stations/shinjuku/gteki/', import.meta.url));
    const graphBytes = await readFile(join(dirOf, 'graph.json')).catch(() => null);
    if (graphBytes === null) return; // standalone checkout without stations/
    const config = await loadContextConfig('shinjuku');
    const window = await buildContextWindow({ r_origin_m: config.window!.r_origin_m!, r_exit_m: config.window!.r_exit_m, node_rule: config.window!.node_rule!, mesh_margin_m: config.window!.mesh_margin_m! }, { stationId: 'shinjuku' });
    expect(window.graph!.selected.map((n) => [n.id, n.floor_id, n.x, n.y])).toEqual([
      ['n:4423521d79e54865b7c41e4aec29826d', 'toei-nwd-0', -58.1, 146.84], ['n:a06f3d191885497bac197b666c4daef9', 'toei-nwd-0', -59.9, 211.96],
      ['n:e4cfe61e944e4f5e8ad8caeb6d521750', 'toei-nwd-0', 2.85, -9.56], ['n:e6feaa2cc7514b68be2758b956baeb28', 'toei-nwd-1', -2.59, 3.56],
    ]);
    expect(window.graph!.selected.map((n) => n.poi_ids![0]).sort()).toEqual(SJ_EXIT_IDS);
    expect(window.graph!.graph_sha256).toBe(createHash('sha256').update(graphBytes).digest('hex'));
    expect(window.discs).toHaveLength(4); expect(window.discs.every((d) => d.r === 300 && d.id !== 'origin')).toBe(true);
    const frame = await shinjukuFrame();
    expect(meshesTouchedByWindow(window.discs, frame, window.spec.mesh_margin_m).meshes).toEqual(['53394525', '53394526', '53394535', '53394536']);
    expect(meshesTouchedByWindow(window.discs, frame, 0).meshes).toEqual(['53394525', '53394526']); // the north pair is brought in by the 50 m margin (exit 1's disc ends at y 512 m, the cell edge is at about 518 m)
    const sourceIds = config.sources;
    expect(assertMeshCoverage('shinjuku', window, frame, sourceIds, ['bldg']).neededSources).toEqual(['plateau-13104-bldg-53394525', 'plateau-13104-bldg-53394526', 'plateau-13104-bldg-53394535', 'plateau-13104-bldg-53394536']);
    // Fail closed: without the two north meshes the window is refused, never clipped.
    expect(() => assertMeshCoverage('shinjuku', window, frame, sourceIds.filter((id) => !/5339453[56]/.test(id)), ['bldg'])).toThrow(/53394535 bldg \(not in the context config\), 53394536 bldg/);
  });
});

describe('Shinjuku: config, sources and the full command wrapper', () => {
  it('defaults to buildings only; READY with the 300 m exit 1-4 window, r_origin 0, the 4 needed meshes and a flattening frame', async () => {
    const config = await loadContextConfig('shinjuku');
    expect(config).toMatchObject({ status: 'READY', frame_id: 'shinjuku-station-enu-v0', radius_m: 0, kinds: ['bldg'], merge: 'kind', variant: 'high', window: { r_origin_m: 0, r_exit_m: 300, node_rule: { graph: 'stations/shinjuku/gteki/graph.json', exit_kinds: [], street_floor_ids: [], poi_ids: SJ_EXIT_IDS } } });
    expect(config.sources.filter((id) => id.includes('-bldg-')).sort()).toEqual(['plateau-13104-bldg-53394525', 'plateau-13104-bldg-53394526', 'plateau-13104-bldg-53394535', 'plateau-13104-bldg-53394536']);
    expect(config.sources.filter((id) => id.includes('-tran-')).sort()).toEqual(['plateau-13104-tran-53394525', 'plateau-13104-tran-53394526', 'plateau-13104-tran-53394535', 'plateau-13104-tran-53394536']);
    expect(parseKinds(config.kinds!)).toEqual(['bldg']);
    const frame = await shinjukuFrame();
    expect(frame).toMatchObject({ vertical_mode: 'per_feature_ground', horizontal_origin_height_m: 0, origin: { lat: 35.687, lon: 139.6994, hM: null, crs: 'EPSG:6668', datum: 'JGD2011' }, source_crs: 'EPSG:6697', navigation_use: 'NOT_FOR_ROUTING', verification: 'UNVERIFIED' });
  });

  it('lists 53394535 and 53394536 (bldg and tran) in sources.yaml like 53394525/26, with the decoded sizes measured on the host and the catalog URL in the same package directory', async () => {
    const sources = new Map(loadSources().map((s) => [s.source_id, s]));
    const reference = sources.get('plateau-13104-bldg-53394525')!;
    const catalog = JSON.parse(await readFile(fixture('plateau-catalog-meshes-13116-13104.json'), 'utf8')) as { meshes: Record<string, string[]> };
    for (const kind of ['bldg', 'tran'] as const) for (const mesh of ['53394535', '53394536']) {
      const entry = sources.get(`plateau-13104-${kind}-${mesh}`)!;
      expect(entry, `${kind} ${mesh}`).toBeDefined();
      expect(catalog.meshes[`13104-${kind}`]).toContain(mesh); // the catalog lists this mesh for this kind
      expect(entry).toMatchObject({ station_ids: ['shinjuku'], publisher: 'MLIT Project PLATEAU', official_url: reference.official_url, license_name: 'CC BY 4.0', attribution_text: SJ_ATTRIBUTION, expected_bytes: ({ 'bldg-53394535': 124173341, 'bldg-53394536': 138190372, 'tran-53394535': 31785752, 'tran-53394536': 25412513 } as Record<string, number>)[`${kind}-${mesh}`], publish_gate: 'CONDITIONAL', resolution: { kind: 'plateau_catalog_api', catalog_source_id: 'plateau-catalog-bldg-tran-13116-13104', match: `${mesh}_${kind}_6697_op.gml` } });
      expect(entry.expected_url).toBe(`https://assets.cms.plateau.reearth.io/assets/84/48ebed-93d8-4196-bdda-e1db9590d3d1/13104_shinjuku-ku_pref_2025_citygml_1_op/udx/${kind}/${mesh}_${kind}_6697_op.gml`);
      expect(entry.notes).toMatch(/decoded size served on 2026-10-22/);
    }
    expect(reference.expected_url.startsWith('https://assets.cms.plateau.reearth.io/assets/84/48ebed-93d8-4196-bdda-e1db9590d3d1/')).toBe(true);
  });

  it('writes a Shinjuku receipt: per-building offsets, offset stats, basis counts, notice, run id with r0 and bldg, feature table with the offset column', async () => {
    const dirOf = fileURLToPath(new URL('../../../stations/shinjuku/gteki/', import.meta.url));
    if (await readFile(join(dirOf, 'graph.json')).catch(() => null) === null) return;
    const dir = await mkdtemp(join(tmpdir(), 'gteki-context-sj-run-')); dirs.push(dir);
    const manifest = new Map(loadSources().map((s) => [s.source_id, s]));
    const bldgIds = ['plateau-13104-bldg-53394525', 'plateau-13104-bldg-53394526', 'plateau-13104-bldg-53394535', 'plateau-13104-bldg-53394536'];
    const stored = vi.spyOn(common, 'getStoredSource').mockImplementation(async (id: string) => ({ path: fixture('context-bldg-shinjuku.xml'), record: { source_id: id, sha256: createHash('sha256').update(id).digest('hex') }, source: manifest.get(id)! }) as Awaited<ReturnType<typeof common.getStoredSource>>);
    vi.spyOn(common, 'getStoreRoot').mockReturnValue(dir);
    const originalWrite = common.writeJson;
    vi.spyOn(common, 'writeJson').mockImplementation(async (path, value) => originalWrite(path.startsWith(common.docsRoot) ? join(dir, 'docs', relative(common.docsRoot, path)) : path, value));
    const summary = await contextGlb('shinjuku');
    expect(stored.mock.calls.map((c) => c[0]).sort()).toEqual(bldgIds); // default kinds bldg: no tran source is opened
    expect(summary.run_id).toMatch(/^context-shinjuku-r0-x300-shinjuku-station-enu-v0-high-kind-bldg-[a-f0-9]{20}$/);
    expect(summary.mesh_coverage).toMatchObject({ needed_meshes: ['53394525', '53394526', '53394535', '53394536'], kinds: ['bldg'], needed_sources: bldgIds });
    expect(summary).toMatchObject({ kinds: ['bldg'], merge: 'kind', vertical_mode: 'per_feature_ground', height_basis: HEIGHT_BASIS_FLATTENED, modifications: ['building bases flattened to street level'], window: { r_origin_m: 0, r_exit_m: 300, disc_count: 4 } });
    expect(summary.ground_offsets!.buildings).toEqual({ count: 7, min_m: 29, median_m: 35, max_m: 40, basis_counts: { ground_height_attribute: 0, ground_surface_lod2: 1, lod1_solid_bottom: 5, min_z_of_drawn_lod: 1 } });
    expect(summary.feature_table.columns).toEqual(['gml_id', 'source_id', 'lod', 'mesh', 'tri_start', 'tri_count', 'ground_offset_m', 'ground_basis', 'ground_surface_spread_m']);
    expect(summary.feature_table.rows.map((r) => [r[0], r[6], r[7], r[8]])).toEqual([['sj_a', 30, 'lod1_solid_bottom', null], ['sj_b', 40, 'lod1_solid_bottom', null], ['sj_c', 35, 'lod1_solid_bottom', null], ['sj_d', 36, 'lod1_solid_bottom', null], ['sj_lod2', 29, 'lod1_solid_bottom', null], ['sj_gs', 36, 'ground_surface_lod2', 0.5], ['sj_lod2only', 32, 'min_z_of_drawn_lod', null]]);
    const receipt = JSON.parse(await readFile(join(dir, 'docs', 'gis', 'context', `${summary.run_id}.json`), 'utf8'));
    expect(receipt).toMatchObject({ run_id: summary.run_id, vertical_mode: 'per_feature_ground', ground_offsets: { buildings: { count: 7 } }, modifications: ['building bases flattened to street level'] });
    expect(receipt.modification_notice).toContain('building bases flattened to street level');
    expect(receipt.window.graph.pois.poi_ids).toEqual(SJ_EXIT_IDS);
    expect(JSON.stringify(receipt)).not.toMatch(/"(?:cleared|clearance)"/);
    const sidecar = JSON.parse(await readFile(join(dir, summary.sidecar_path), 'utf8'));
    expect(sidecar.per_feature.map((f: Record<string, unknown>) => [f.gml_id, f.ground_height_m, f.ground_basis, f.ground_surface_spread_m])).toEqual(summary.feature_table.rows.map((r) => [r[0], r[6], r[7], r[8]]));
    // The other three bldg sources hold the same ids in this fixture-backed run: excluded as duplicates, never emitted twice.
    expect(summary.sources.map((src) => src.converted)).toEqual([7, 0, 0, 0]);
    // exit_neighbour_radius_m 30 from the config: one entry per window POI; no fixture building lies within 30 m of the real connectors.
    expect(receipt.exit_neighbours).toMatchObject({ radius_m: 30 });
    expect(receipt.exit_neighbours.pois.map((p: { poi_id: string; count: number }) => [p.poi_id, p.count])).toEqual(SJ_EXIT_IDS.map((id) => [id, 0]));
  });

  it('fails closed before reading any source when a needed Shinjuku mesh source is missing from the run', async () => {
    const dirOf = fileURLToPath(new URL('../../../stations/shinjuku/gteki/', import.meta.url));
    if (await readFile(join(dirOf, 'graph.json')).catch(() => null) === null) return;
    const stored = vi.spyOn(common, 'getStoredSource');
    await expect(contextGlb('shinjuku', { sourceIds: ['plateau-13104-bldg-53394525', 'plateau-13104-bldg-53394526'] })).rejects.toThrow(/53394535 bldg \(not in the context config\), 53394536 bldg/);
    expect(stored).not.toHaveBeenCalled();
  });
});

describe('Ikebukuro is unchanged by the Shinjuku support', () => {
  it('keeps the TP height basis, no modification field, no ground offsets and the 6-column feature table', async () => {
    const { report, document } = await build();
    expect(report.height_basis).toBeUndefined();
    expect('ground_offsets' in report || 'modifications' in report || 'vertical_mode' in report).toBe(false);
    expect(report.per_feature.every((f) => !('ground_height_m' in f))).toBe(true);
    const scene = document.getRoot().listScenes()[0]!.getExtras();
    expect(Object.keys(scene)).not.toEqual(expect.arrayContaining(['modifications']));
    for (const key of ['modifications', 'modification_notice', 'vertical_mode', 'ground_offsets', 'height_basis']) expect(key in scene).toBe(false);
    for (const n of document.getRoot().listNodes()) {
      expect(n.getExtras().height_basis).toBe(HEIGHT_BASIS_TP);
      expect('modifications' in n.getExtras() || 'vertical_mode' in n.getExtras()).toBe(false);
    }
    expect(scene.selection_rule).not.toMatch(/poi_ids/);
    expect(report.frame.vertical_mode).toBeUndefined();
    expect(report.frame.origin.hM).toBe(0);
  });

  it('a TP frame with the Ikebukuro origin still projects z = height - hM and its window text carries no poi_ids sentence', async () => {
    const { report } = await build();
    const rows = report.per_feature.filter((f) => f.gml_id === 'bldg_lod1only');
    expect(rows).toHaveLength(1);
    expect(report.window.rule).not.toMatch(/poi_ids/);
    expect(report.bbox_local_ENU!.min[2]).toBeGreaterThan(32); // TP heights (32.5 and up), not flattened
  });
});
