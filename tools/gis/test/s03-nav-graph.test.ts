import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DROPPED_LEVELS, PATH_GEOJSON_MEMBER, S03_NAV_GRAPH_POLICY, assertNoPathGeojson, buildNavGraph, buildNavGraphReceipt,
  loadGateTags, navGraphIdentity, selectNavGraphMembers, writeHeldDocument,
  type NavGraphDigestFacts, type NavGraphInputs, type S03GateTag,
} from '../src/s03-nav-graph.js';
import { PATH_REASON } from '../src/s03-paths.js';
import type { Affine, Point2, S03Inputs, S03Link } from '../src/s03-transform.js';

const nav: Affine = [2, 0, 0, 2, 10, 20], drawing: Affine = [0.01, 0, 0, 0.01, 0, 0];
/** The transform output is already treated as lon/lat, so station ENU is [lon, lat]. */
const project = (lat: number, lon: number): Point2 => [lon, lat];
const hash = (value: number | string): string => createHash('sha256').update(String(value)).digest('hex');
const level = (id: number, label: string, ordinal: number): NavGraphInputs['levels'][number] => ({ id, label, ordinal });
const node = (sourceId: number, levelId: number, native: Point2, geometryId: number | null = null): S03Inputs['nodes'][number] =>
  ({ index: 0, sourceId, levelId, native, geometryId });
const link = (sourceId: number, n1: number, n2: number, direction = 3, dz: number | null = null): S03Link => ({ sourceId, n1, n2, direction, dz });
const gate = (poiId: string, operators: string[], line: string | null, name: string): S03GateTag =>
  ({ poi_id: poiId, operator_ids: operators, line, name });

/**
 * Two corridors on kept levels, one corridor on level 64677, one cross-level link and one one-way link. Node 104 carries
 * the geometry id of a reviewed gate; node 105 carries one no entry claims.
 */
const base = (): NavGraphInputs => ({
  navTransform: nav, drawingTransform: drawing,
  nodes: [node(101, 11, [2, 3]), node(102, 11, [3, 3]), node(103, 12, [4, 3]), node(104, 11, [5, 3], 901),
    node(105, 11, [6, 3], 902), node(106, 64677, [7, 3], 903)],
  links: [link(201, 101, 102, 3), link(202, 102, 103, 1), link(203, 103, 104, 3), link(204, 104, 105, 2), link(205, 105, 106, 3)],
  levels: [level(11, 'B1F', -1), level(12, '1F', 1), level(64677, '2F', 2)],
  gateTags: new Map([[901, gate('poi:keio-gate:1', ['keio'], 'keio-new', '京王新線　京王新線口')]]),
});

describe('S03 nav graph: nodes and edges come from v5_nav through the affine pair (synthetic only)', () => {
  it('applies the nav then drawing affine and projects into station ENU', () => {
    const graph = buildNavGraph(base(), project);
    // transformS03([2, 3]) = nav ([14, 26]) then drawing ([0.14, 0.26]); project returns [lon, lat].
    expect(graph.nodes.map(entry => entry.source_id)).toEqual([101, 102, 103, 104, 105]);
    expect(graph.nodes[0]).toMatchObject({ source_id: 101, level_id: 11, level_label: 'B1F', floor_ordinal: -1, east_m: 0.14, north_m: 0.26 });
    expect(graph.nodes[3]!.east_m).toBeCloseTo(0.20, 12);
    expect(graph.nodes[0]!.lon).toBeCloseTo(0.14, 12);
    expect(graph.nodes[0]!.lat).toBeCloseTo(0.26, 12);
    // One edge per surviving link, keyed by its source link id and carrying the transform's own measurements.
    expect(graph.edges.map(edge => edge.link_id)).toEqual([201, 202, 203, 204]);
    const corridor = graph.edges[0]!;
    expect(corridor).toMatchObject({ from_node: 101, to_node: 102, direction: 3, dz_m: null, level_relation: 'same_level' });
    expect(corridor.length_m).toBeCloseTo(0.02, 12);
  });
  it('tags a node only from its own level-entry geometry id, never by name or proximity', () => {
    const graph = buildNavGraph(base(), project);
    expect(graph.nodes.find(entry => entry.source_id === 104)!.gate).toEqual(gate('poi:keio-gate:1', ['keio'], 'keio-new', '京王新線　京王新線口'));
    // 902 is a geometry id no reviewed entry claims; 102 and 103 carry none at all.
    expect(graph.nodes.find(entry => entry.source_id === 105)!.gate).toBeNull();
    expect(graph.nodes.find(entry => entry.source_id === 102)!.gate).toBeNull();
    expect(graph.counts).toMatchObject({ tagged_nodes: 1, untagged_nodes: 4, source_nodes: 6, nodes: 5, source_links: 5, edges: 4 });
    expect(graph.line_counts).toEqual([{ operator_id: 'keio', nodes: 1, edges: 2 }]);
  });
  it('joins a gate tag through the reviewed entity id, in both entity-id forms', () => {
    const tags = loadGateTags({ pois: [
      { id: 'poi:jreast-gate:1', operatorIds: ['jreast'], names: [{ lang: 'ja', text: 'JR 中央西口（出口専用）' }], s03: { entityId: '$id 28993986' } },
      { id: 'poi:keio-gate:4', operatorIds: ['keio'], line: 'keio', names: [{ lang: 'ja', text: '京王線　ルミネ口' }, { lang: 'en', text: 'Keio' }], s03: { entityId: 29070276 } },
    ] });
    expect(tags.get(28993986)).toEqual(gate('poi:jreast-gate:1', ['jreast'], null, 'JR 中央西口（出口専用）'));
    expect(tags.get(29070276)).toEqual(gate('poi:keio-gate:4', ['keio'], 'keio', '京王線　ルミネ口'));
  });
});

describe('S03 nav graph: level 64677 is dropped whole (synthetic only)', () => {
  it('removes every node on 64677 and every edge that touches one', () => {
    const graph = buildNavGraph(base(), project);
    expect(graph.nodes.map(entry => entry.source_id)).not.toContain(106);
    expect(graph.edges.map(edge => edge.link_id)).not.toContain(205);
    expect(graph.counts).toMatchObject({ dropped_nodes: 1, dropped_edges: 1 });
    expect(graph.dropped).toEqual([{ level_id: 64677, reason: PATH_REASON.CHECK_A_CONTAINMENT_FAIL, nodes: 1, edges: 1,
      evidence: DROPPED_LEVELS[0]!.evidence }]);
    // Nothing else is dropped: the one-way link and every other record stay, with their reason codes.
    expect(graph.other_drops).toEqual([]);
    expect(graph.edges.find(edge => edge.link_id === 202)!.reason_codes).toContain(PATH_REASON.ONE_WAY);
  });
});

describe('S03 nav graph: Path GeoJSON is never an input', () => {
  it('rejects a Path GeoJSON member with the frame it carries', () => {
    expect(PATH_GEOJSON_MEMBER.test('path-level-geom-1F.geojson')).toBe(true);
    expect(() => assertNoPathGeojson(['新宿駅/v5_nav.json', '新宿駅/path-level-geom-1F.geojson']))
      .toThrow(/refusing Path GeoJSON member path-level-geom-1F\.geojson: its frame is UNKNOWN \(crs: null\)/);
  });
  it('selects the nav members and reports how many Path members it left out', () => {
    const entries = [{ name: 's/新宿駅/v5_nav.json' }, { name: 's/新宿駅/com-map.geojson' }, { name: 's/新宿駅/geojson-level-geom-1F.geojson' },
      { name: 's/新宿駅/path-level-geom-1F.geojson' }, { name: 's/新宿駅/path-level-geom-B1F.geojson' }, { name: 's/新宿駅/README.txt' }];
    const { members, excluded_path_members } = selectNavGraphMembers(entries);
    expect(members.map(entry => entry.name)).toEqual(['s/新宿駅/v5_nav.json', 's/新宿駅/com-map.geojson', 's/新宿駅/geojson-level-geom-1F.geojson']);
    // Only Path members are counted; the unrelated README does not inflate the number.
    expect(excluded_path_members).toBe(2);
    expect(() => selectNavGraphMembers([{ name: 's/path-level-geom-1F.geojson' }])).toThrow(/carries no v5_nav\.json member/);
  });
});

const facts = (): NavGraphDigestFacts => ({ policy_version: S03_NAV_GRAPH_POLICY, tool_input_sha256: 'a'.repeat(64), zip_sha256: 'b'.repeat(64),
  station_json_sha256: 'c'.repeat(64), floor_mapping_sha256: 'd'.repeat(64), gate_source_sha256: 'e'.repeat(64), crs: 'UNKNOWN',
  publish_gate: 'CONDITIONAL', sources_yaml_sha256: 'f'.repeat(64) });
const receipt = (result = buildNavGraph(base(), project)) => {
  const identity = navGraphIdentity(facts());
  return buildNavGraphReceipt({ digest_inputs: facts(), digest: identity.digest, run_id: identity.run_id, publish_gate: 'CONDITIONAL',
    zip_sha256: 'b'.repeat(64), crs: 'UNKNOWN', result, excluded_path_members: 2,
    transform: { drawing_id: 35814, nav_member_sha256: '1'.repeat(64), map_member_sha256: '2'.repeat(64) },
    inputs: [{ role: 'station', path: 'stations/synth/station.json', sha256: 'c'.repeat(64) }],
    private_output: { path: 'out/s03/nav-graph-x.json', sha256: 'f'.repeat(64), bytes: 10 } });
};

describe('S03 nav graph: held receipt (synthetic only)', () => {
  it('carries counts, the dropped level id and the reason codes, but no coordinate, id, gate name or level label', () => {
    const publicReceipt = receipt();
    expect(publicReceipt.policy_version).toBe(S03_NAV_GRAPH_POLICY);
    expect(publicReceipt.counts).toMatchObject({ nodes: 5, edges: 4, dropped_nodes: 1, dropped_edges: 1, tagged_nodes: 1 });
    expect(publicReceipt.line_counts).toEqual([{ operator_id: 'keio', nodes: 1, edges: 2 }]);
    expect(publicReceipt.dropped_levels).toEqual([{ level_id: 64677, reason: PATH_REASON.CHECK_A_CONTAINMENT_FAIL, nodes: 1, edges: 1,
      evidence: DROPPED_LEVELS[0]!.evidence }]);
    expect(publicReceipt.members).toMatchObject({ excluded_path_geojson: 2 });
    // The publication gate is HOLD with the condition that releases it.
    expect(publicReceipt.publication).toMatchObject({ graph: 'HOLD', paths: 'HOLD', routing: 'HOLD' });
    expect(publicReceipt.publication.release_condition).toMatch(/CRS evidence for the path frame is obtained AND the data lead signs off/);
    const text = JSON.stringify(publicReceipt);
    for (const leaked of ['0.14', '0.20', 'B1F', 'level_label', 'east_m', 'poi:keio-gate:1', '京王新線', String(hash(201))])
      expect(text).not.toContain(leaked);
    expect(publicReceipt).not.toHaveProperty('nodes');
    expect(publicReceipt).not.toHaveProperty('edges');
  });
  it('names the run from policy, tool, ZIP, station.json, floor mapping, gate source, CRS, gate and manifest', () => {
    const baseIdentity = navGraphIdentity(facts());
    expect(baseIdentity.run_id).toMatch(/^nav-graph-[0-9a-f]{20}$/);
    for (const changed of [{ crs: 'EPSG:6668' }, { publish_gate: 'PASS' }, { policy_version: 's03-nav-graph-v2' },
      { zip_sha256: '1'.repeat(64) }, { station_json_sha256: '2'.repeat(64) }, { gate_source_sha256: '3'.repeat(64) }])
      expect(navGraphIdentity({ ...facts(), ...changed }).digest).not.toBe(baseIdentity.digest);
  });
});

/** The held graph must not reach anything that ships: these files are pinned at their shipped state. */
const SHIPPED = {
  'stations/shinjuku/gteki/graph.json': '06d6193124f0dc6d44a663c5a1bfdff224bcd0d71114fc303c154501555863be',
  'stations/shinjuku/gteki/station.json': '6d8aa6c738a336d47e9f610b776509bbb0a118ea3decb9149ea09618ca970e58',
  'stations/shinjuku/gteki/pois.json': '971ac9f302960eaeb17fe0eb3a0548957413fc0a1de5d2a5064b8ec1cedde177',
  'stations/shinjuku/data/import-report.json': 'b202aa9287f2cef6c510046c8e74e841384fd13f5ebafe6a69c69eaee8d50d94',
} as const;

describe('S03 nav graph: the held document stays in the private store', () => {
  it('writes inside the store and refuses an output directory that resolves outside it', async () => {
    const store = await mkdtemp(join(tmpdir(), 'gteki-store-')), outside = await mkdtemp(join(tmpdir(), 'gteki-outside-'));
    try {
      const written = await writeHeldDocument(store, 'out/s03/held.json', { held: true });
      expect(written).toBe(join(store, 'out/s03/held.json'));
      expect(JSON.parse(await readFile(written, 'utf8'))).toEqual({ held: true });
      // An out/s03 symlink into shipped data is refused instead of followed: nothing lands in the target.
      await mkdir(join(store, 'other'), { recursive: true });
      await symlink(outside, join(store, 'other', 's03'));
      await expect(writeHeldDocument(store, 'other/s03/held.json', { held: true })).rejects.toThrow(/resolves outside the store/);
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(store, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('S03 nav graph: nothing ships', () => {
  it('leaves the shipped Shinjuku graph and station data unchanged', async () => {
    for (const [path, pinned] of Object.entries(SHIPPED)) {
      const bytes = await readFile(new URL(`../../../${path}`, import.meta.url));
      expect(createHash('sha256').update(bytes).digest('hex'), `${path} is shipped data; the S03 graph stays behind HOLD`).toBe(pinned);
    }
  });
  it('has no write path into station data or the web bundle: only the store and a docs/gis/s03 receipt', async () => {
    const source = await readFile(new URL('../src/s03-nav-graph.ts', import.meta.url), 'utf8');
    // The only repository write is the receipt: no station data, no web bundle, no other repo path.
    const repoWrites = [...source.matchAll(/writeJson\(join\(repoRoot, ([^)]+)\)/g)].map(match => match[1]);
    expect(repoWrites).toEqual(['receiptPath']);
    expect(source).toContain("const receiptPath = `docs/gis/s03/${identity.run_id}.json`;");
  });
});
