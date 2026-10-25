import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CRS_UNKNOWN, PATH_RECORD_LABELS, PATH_REASON, S03_PATHS_POLICY, buildPaths, buildPathsReceipt, pathsIdentity,
  type PathInputs, type PathSegmentRecord, type PathsDigestFacts,
} from '../src/s03-paths.js';
import type { Affine, Point2, S03Inputs, S03Link } from '../src/s03-transform.js';

const nav: Affine = [2, 0, 0, 2, 10, 20], drawing: Affine = [0.01, 0, 0, 0.01, 0, 0];
/** Kept as a literal so the receipt test does not read the repository. */
const STATION_PATH = 'stations/synth/station.json';
/** Synthetic stand-in for the quoted evidence block; the real one is pinned in the module. */
const EVIDENCE = { source_zip_sha256: 'b'.repeat(64), node_count: 3, link_count: 2,
  check_a: { node_count: 3, inside_count: 2, inside_share: 0.666667, status: 'FAIL', failing_levels: [{ level_id: 11, inside_share: 0.5 }] },
  check_b: { pairs_within_5m: 1, median_m: 1, p90_m: 1, max_m: 1, mean_offset_m: { east: 0, north: 0 }, mean_offset_applied: false } };
/** Synthetic projection: the transform output is already treated as lon/lat, so ENU is [lon, lat]. */
const project = (lat: number, lon: number): [number, number] => [lon, lat];
const hash = (value: number): string => createHash('sha256').update(String(value)).digest('hex');
const level = (id: number, label: string, ordinal: number): PathInputs['levels'][number] => ({ id, label, ordinal });
const node = (sourceId: number, levelId: number, native: Point2): S03Inputs['nodes'][number] => ({ index: 0, sourceId, levelId, native });
const link = (sourceId: number, n1: number, n2: number, direction = 3, dz: number | null = null): S03Link => ({ sourceId, n1, n2, direction, dz });

/** One same-level bidirectional corridor link and one forward-only cross-level link, all synthetic. */
const base = (): PathInputs => ({
  navTransform: nav, drawingTransform: drawing,
  // Node 102 comes first so the output order is checked, not inherited.
  nodes: [node(102, 11, [2, 3]), node(101, 11, [3, 3]), node(103, 12, [4, 3])],
  links: [link(201, 101, 102, 3), link(202, 102, 103, 1)],
  levels: [level(12, '1F', 1), level(11, 'B1F', -1)],
});
const segment = (segments: readonly PathSegmentRecord[], linkId: number): PathSegmentRecord =>
  segments.find(entry => entry.link_id_sha256 === hash(linkId))!;

describe('S03 paths: transform and level split (synthetic only)', () => {
  it('applies the nav then drawing affine and projects both endpoints into station ENU', () => {
    const result = buildPaths(base(), project);
    // transformS03([2, 3]) = nav ([14, 26]) then drawing ([0.14, 0.26]); project returns [lon, lat].
    expect(result.nodes.map(entry => entry.source_id)).toEqual([101, 102, 103]);
    expect(result.nodes[0]).toMatchObject({ source_id: 101, level_id: 11, level_label: 'B1F', floor_ordinal: -1, east_m: 0.16, north_m: 0.26 });
    expect(result.nodes[1]!.east_m).toBeCloseTo(0.14, 12);
    expect(result.nodes[2]).toMatchObject({ level_id: 12, level_label: '1F', floor_ordinal: 1, east_m: 0.18 });
    expect(result.nodes[2]!.lon).toBeCloseTo(0.18, 12);
    expect(result.nodes[2]!.lat).toBeCloseTo(0.26, 12);
    const corridor = segment(result.segments, 201);
    expect(corridor).toMatchObject({ from_level_id: 11, to_level_id: 11, level_relation: 'same_level', direction: 3, dz_m: null,
      from_east_m: 0.16, from_north_m: 0.26, to_east_m: 0.14, to_north_m: 0.26 });
    expect(corridor.length_m).toBeCloseTo(0.02, 12);
    // The endpoint node hashes are the hashes of the source node ids, not the raw ids.
    expect(corridor.from_node_sha256).toBe(hash(101));
    expect(corridor.to_node_sha256).toBe(hash(102));
    expect(corridor.link_id_sha256).toBe(hash(201));
  });
  it('splits levels structurally and attaches the reason codes that keep the segment out of routing', () => {
    const result = buildPaths(base(), project);
    expect(result.counts).toEqual({ nodes: 3, links: 2, segments: 2, same_level: 1, cross_level: 1,
      directions: [{ direction: 1, count: 1 }, { direction: 2, count: 0 }, { direction: 3, count: 1 }] });
    expect(result.level_counts).toEqual([{ level_id: 11, nodes: 2, same_level_segments: 1 }, { level_id: 12, nodes: 1, same_level_segments: 0 }]);
    expect(segment(result.segments, 201).reason_codes).toEqual([PATH_REASON.CRS_UNCONFIRMED, PATH_REASON.CHECK_A_CONTAINMENT_FAIL,
      PATH_REASON.CHECK_B_RESIDUAL_UNVERIFIED, PATH_REASON.FLOOR_ORDINAL_UNVERIFIED]);
    // The cross-level link also carries the unknown-device code; a single direction is one-way.
    const transition = segment(result.segments, 202);
    expect(transition).toMatchObject({ from_level_id: 11, to_level_id: 12, level_relation: 'cross_level', direction: 1 });
    expect(transition.length_m).toBeCloseTo(0.04, 12);
    expect(transition.reason_codes).toEqual([PATH_REASON.CRS_UNCONFIRMED, PATH_REASON.CHECK_A_CONTAINMENT_FAIL,
      PATH_REASON.CHECK_B_RESIDUAL_UNVERIFIED, PATH_REASON.FLOOR_ORDINAL_UNVERIFIED, PATH_REASON.CROSS_LEVEL_DEVICE_UNKNOWN, PATH_REASON.ONE_WAY]);
    expect(result.reason_codes).toEqual([{ code: PATH_REASON.CRS_UNCONFIRMED, count: 2 }, { code: PATH_REASON.CHECK_A_CONTAINMENT_FAIL, count: 2 },
      { code: PATH_REASON.CHECK_B_RESIDUAL_UNVERIFIED, count: 2 }, { code: PATH_REASON.FLOOR_ORDINAL_UNVERIFIED, count: 2 },
      { code: PATH_REASON.CROSS_LEVEL_DEVICE_UNKNOWN, count: 1 }, { code: PATH_REASON.ONE_WAY, count: 1 }]);
  });
  it('treats a same-level link with a non-zero dz as a cross-level segment and keeps reverse direction', () => {
    const inputs = { ...base(), nodes: [...base().nodes, node(104, 11, [5, 3])], links: [link(203, 101, 104, 2, 1.5)] };
    const [only] = buildPaths(inputs, project).segments;
    expect(only).toMatchObject({ from_level_id: 11, to_level_id: 11, level_relation: 'cross_level', direction: 2, dz_m: 1.5 });
    expect(only!.reason_codes).toContain(PATH_REASON.CROSS_LEVEL_DEVICE_UNKNOWN);
    expect(only!.reason_codes).toContain(PATH_REASON.ONE_WAY);
  });
});

describe('S03 paths: fail-closed input (synthetic only)', () => {
  it('stops on a malformed node, level, link or projection', () => {
    expect(() => buildPaths({ ...base(), nodes: [node(101, 11, [2, 3]), node(101, 11, [3, 3])] }, project)).toThrow(/duplicate node id 101/);
    expect(() => buildPaths({ ...base(), nodes: [node(101, 99, [2, 3])] }, project)).toThrow(/unknown level 99/);
    expect(() => buildPaths({ ...base(), nodes: [node(101, 11, [Number.NaN, 3])] }, project)).toThrow(/no finite native position/);
    expect(() => buildPaths({ ...base(), levels: [level(11, 'B1F', -1), level(11, '1F', 1)] }, project)).toThrow(/duplicate level id 11/);
    expect(() => buildPaths({ ...base(), levels: [level(11, 'B1F', -1), level(12, '1F', Number.NaN)] }, project)).toThrow(/no finite comparison ordinal/);
    expect(() => buildPaths({ ...base(), links: [link(201, 101, 102), link(201, 101, 103)] }, project)).toThrow(/duplicate link id 201/);
    expect(() => buildPaths({ ...base(), links: [link(201, 101, 999)] }, project)).toThrow(/does not join two known nodes/);
    expect(() => buildPaths({ ...base(), links: [link(201, 101, 102, 0)] }, project)).toThrow(/direction 0; expected 1, 2 or 3/);
    expect(() => buildPaths({ ...base(), links: [] }, project)).toThrow(/carry no links/);
  });
  it('keeps a self-loop and a zero-horizontal vertical link as flagged segments, not a stopped run', () => {
    // Both patterns exist in the real source: six self-loops and two cross-level links with identical horizontal positions.
    const inputs = { ...base(), nodes: [node(101, 11, [2, 3]), node(102, 12, [2, 3])],
      links: [link(201, 101, 101, 3), link(202, 101, 102, 1, 3.2)] };
    const result = buildPaths(inputs, project);
    expect(result.counts.segments).toBe(2);
    const loop = segment(result.segments, 201), vertical = segment(result.segments, 202);
    expect(loop).toMatchObject({ from_level_id: 11, to_level_id: 11, length_m: 0, level_relation: 'same_level' });
    expect(loop.reason_codes).toContain(PATH_REASON.SELF_LOOP);
    expect(loop.reason_codes).not.toContain(PATH_REASON.ZERO_LENGTH);
    expect(vertical).toMatchObject({ from_level_id: 11, to_level_id: 12, length_m: 0, level_relation: 'cross_level', dz_m: 3.2 });
    expect(vertical.reason_codes).toContain(PATH_REASON.ZERO_LENGTH);
    expect(vertical.reason_codes).not.toContain(PATH_REASON.SELF_LOOP);
    expect(vertical.reason_codes).toContain(PATH_REASON.CROSS_LEVEL_DEVICE_UNKNOWN);
  });
  it('stops when the transform leaves geographic range or the station frame yields no position', () => {
    expect(() => buildPaths({ ...base(), navTransform: [1, 0, 0, 1, 1e5, 1e5] }, project)).toThrow(/outside geographic range/);
    expect(() => buildPaths(base(), () => [Number.NaN, 0])).toThrow(/does not project into the station frame/);
  });
});

describe('S03 paths: digest and public receipt (synthetic only)', () => {
  const result = () => buildPaths(base(), project);
  const facts = (crs = CRS_UNKNOWN): PathsDigestFacts => ({ policy_version: S03_PATHS_POLICY, tool_input_sha256: 'a'.repeat(64), zip_sha256: 'b'.repeat(64),
    station_json_sha256: 'c'.repeat(64), floor_mapping_sha256: 'd'.repeat(64), crs, publish_gate: 'HOLD', sources_yaml_sha256: 'e'.repeat(64) });
  const receipt = (crs = CRS_UNKNOWN) => buildPathsReceipt({ digest_inputs: facts(crs), digest: pathsIdentity(facts(crs)).digest,
    run_id: pathsIdentity(facts(crs)).run_id, publish_gate: 'HOLD', zip_sha256: 'b'.repeat(64), crs, result: result(),
    evidence: EVIDENCE,
    transform: { drawing_id: 7, nav_member_sha256: '1'.repeat(64), map_member_sha256: '2'.repeat(64) },
    inputs: [{ role: 'station', path: STATION_PATH, sha256: 'c'.repeat(64) }],
    private_output: { path: 'out/s03/paths-x.json', sha256: 'f'.repeat(64), bytes: 10 } });
  it('names the run from policy, tool, ZIP, station.json, floor mapping, CRS, gate and manifest', () => {
    const baseIdentity = pathsIdentity(facts());
    expect(baseIdentity.run_id).toMatch(/^paths-[0-9a-f]{20}$/);
    expect(pathsIdentity(facts()).digest).toBe(baseIdentity.digest);
    for (const changed of [{ crs: 'EPSG:6668' }, { publish_gate: 'PASS' }, { policy_version: 's03-paths-v2' },
      { zip_sha256: '1'.repeat(64) }, { station_json_sha256: '2'.repeat(64) }, { floor_mapping_sha256: '3'.repeat(64) }])
      expect(pathsIdentity({ ...facts(), ...changed }).digest).not.toBe(baseIdentity.digest);
  });
  it('carries counts, lengths and reason codes but no coordinate, hash or level label', () => {
    const publicReceipt = receipt();
    expect(publicReceipt.counts).toEqual({ nodes: 3, links: 2, segments: 2, same_level: 1, cross_level: 1,
      directions: [{ direction: 1, count: 1 }, { direction: 2, count: 0 }, { direction: 3, count: 1 }] });
    expect(publicReceipt.segment_length_m.count).toBe(2);
    expect(publicReceipt.segment_length_m.min_m).toBeCloseTo(0.02, 12);
    expect(publicReceipt.segment_length_m.max_m).toBeCloseTo(0.04, 12);
    expect(publicReceipt.reason_codes).toEqual([{ code: PATH_REASON.CRS_UNCONFIRMED, count: 2 }, { code: PATH_REASON.CHECK_A_CONTAINMENT_FAIL, count: 2 },
      { code: PATH_REASON.CHECK_B_RESIDUAL_UNVERIFIED, count: 2 }, { code: PATH_REASON.FLOOR_ORDINAL_UNVERIFIED, count: 2 },
      { code: PATH_REASON.CROSS_LEVEL_DEVICE_UNKNOWN, count: 1 }, { code: PATH_REASON.ONE_WAY, count: 1 }]);
    expect(publicReceipt.navigation_use).toBe('NOT_FOR_ROUTING');
    expect(publicReceipt.verification).toBe('UNVERIFIED');
    // The containment failure, the residual evidence and the publication HOLD are recorded in the receipt.
    expect(publicReceipt.evidence.check_a.failing_levels).toEqual([{ level_id: 11, inside_share: 0.5 }]);
    expect(publicReceipt.publication).toMatchObject({ paths: 'HOLD', routing: 'HOLD' });
    expect(publicReceipt.transform.scope).toMatch(/never fed through this affine pair/);
    expect(publicReceipt.segment_rule).toMatch(/CHECK_A_CONTAINMENT_FAIL and CHECK_B_RESIDUAL_UNVERIFIED/);
    expect(publicReceipt.labels_rule).toMatch(/NOT_FOR_ROUTING/);
    const text = JSON.stringify(publicReceipt);
    for (const leaked of ['0.14', '0.16', '0.18', hash(201), hash(101), 'B1F', 'level_label', 'east_m'])
      expect(text).not.toContain(leaked);
    expect(publicReceipt).not.toHaveProperty('segments');
    expect(publicReceipt).not.toHaveProperty('nodes');
  });
  it('records a declared CRS without confirming it and keeps every restriction label', () => {
    expect(receipt().crs).toMatchObject({ declared: CRS_UNKNOWN, status: 'UNKNOWN', confirmed: false });
    const declared = receipt('EPSG:6668');
    expect(declared.crs).toMatchObject({ declared: 'EPSG:6668', status: 'DECLARED_UNVERIFIED', confirmed: false });
    expect(declared.navigation_use).toBe('NOT_FOR_ROUTING');
    expect(declared.verification).toBe('UNVERIFIED');
    // The record labels are the same object on every record, so a lifted segment cannot lose them.
    expect(PATH_RECORD_LABELS).toEqual({ navigation_use: 'NOT_FOR_ROUTING', verification: 'UNVERIFIED', gteki_role: 'evidence' });
  });
});

