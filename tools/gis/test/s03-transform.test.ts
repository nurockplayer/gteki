import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readZip } from '../src/zip.js';
import {
  applyAffine, assertS03Bytes, checkInternal, classifyNodes, collectS03Strings, compatibleFloors, directionSummary, distanceToPolygonEdge,
  distanceToSegment, floorMappingSha256, guardS03Receipt, holeShellRelation, mutualNearest, nearestPointOnSegment, outsideNodeDiagnostic, parseS03Members,
  pointInPolygon, receiptIdentity, residualStats, ringContainsInclusive, selfIntersectionCheck, sourceDefectRecords, transformS03,
  type Affine, type Point2, type Polygon2, type S03Link,
} from '../src/s03-transform.js';

const nav: Affine = [2, 0, 0, 2, 10, 20], drawing: Affine = [0.01, 0, 0, 0.01, 0, 0];
const square: Polygon2 = [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]];
const fixtureMembers = () => [
  { name: 'nested/v5_nav.json', value: { d: [{ id: 7, t: nav, l: [{ id: 11 }] }], n: [{ id: 101, mx: 2, my: 3, l: [{ lid: 11 }] }], l: [] } },
  { name: 'nested/com-map.geojson', value: { drawings: [{ id: 7, ref_frame: { transform: drawing }, levels: [{ id: 11, properties: { name: 'B1F' } }] }] } },
  { name: 'nested/geojson-level-geom-B1F.geojson', value: { type: 'FeatureCollection', id: 11, drawing_id: 7, features: [{ type: 'Feature', properties: { name: 'SYNTH-S03-private-shop' }, geometry: { type: 'Polygon', coordinates: square } }] } },
  { name: 'nested/com-entity.geojson', value: { entities: [{ properties: { description: 'SYNTH-private-description', translated: { text: 'SYNTH-private-localized' } } }] } },
];
const encode = (members = fixtureMembers()) => members.map(m => ({ name: m.name, data: Buffer.from(JSON.stringify(m.value)) }));
// Same fixture with hand-picked level features; only synthetic geometry is used.
const withLevelFeatures = (features: unknown[]) => encode(fixtureMembers()).map(entry => entry.name.endsWith('geojson-level-geom-B1F.geojson')
  ? { name: entry.name, data: Buffer.from(JSON.stringify({ ...(JSON.parse(entry.data.toString()) as Record<string, unknown>), features })) } : entry);
const polygonFeature = (coordinates: unknown) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } });
const project = (lat: number, lon: number): [number, number] => [lon, lat];

// Minimal in-memory, uncompressed ZIP. Only synthetic JSON is passed to it.
function fixtureZip(entries: readonly { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), local = Buffer.alloc(30), central = Buffer.alloc(46);
    let crc = 0xffffffff;
    for (const b of entry.data) {
      crc ^= b;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18); local.writeUInt32LE(entry.data.length, 22); local.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20); central.writeUInt32LE(entry.data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    const chunk = Buffer.concat([local, name, entry.data]);
    locals.push(chunk); centrals.push(Buffer.concat([central, name])); offset += chunk.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe('S03 affine and geometry checks (synthetic only)', () => {
  it('uses every coefficient in the documented order and composes both steps', () => {
    expect(applyAffine([2, 3], [2, 3, 5, 7, 11, 13])).toEqual([30, 40]);
    expect(transformS03([2, 3], [2, 3, 5, 7, 11, 13], [17, 19, 23, 29, 31, 37])).toEqual([1461, 1767]);
    expect(transformS03([2, 3], nav, drawing)[0]).toBeCloseTo(0.14, 12);
    expect(transformS03([2, 3], nav, drawing)[1]).toBeCloseTo(0.26, 12);
  });
  it('tests closed surfaces, concavities, holes and nearest edges', () => {
    const withHole: Polygon2 = [...square, [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]]];
    expect(pointInPolygon([0.1, 0.1], withHole)).toBe(true);
    expect(pointInPolygon([0.5, 0.5], withHole)).toBe(false);
    expect(pointInPolygon([0.2, 0.5], withHole)).toBe(true);
    expect(pointInPolygon([1, 0.5], square)).toBe(true);
    expect(pointInPolygon([2, 0.5], square)).toBe(false);
    expect(distanceToPolygonEdge([2, 0.5], square)).toBe(1);
    expect(distanceToPolygonEdge([0.5, 0.5], withHole)).toBeCloseTo(0.3, 12);
    expect(distanceToSegment([3, 4], [0, 0], [0, 0])).toBe(5);
    const concave: Polygon2 = [[[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2], [0, 0]]];
    expect(pointInPolygon([0.5, 1.5], concave)).toBe(true);
    expect(pointInPolygon([1.5, 1.5], concave)).toBe(false);
  });
  it('accepts the correct composition and clearly rejects swapped order without tuning', () => {
    const inputs = parseS03Members(encode()), project = (lat: number, lon: number): [number, number] => [lon, lat];
    const good = checkInternal(inputs, project), bad = checkInternal(inputs, project, true);
    expect(good).toMatchObject({ status: 'PASS', inside_count: 1, inside_share: 1 });
    expect(good.levels['11']).toMatchObject({ node_count: 1, outside_count: 0, outside_edge_distance_m: { count: 0, min_m: null } });
    expect(bad).toMatchObject({ status: 'FAIL', inside_count: 0, inside_share: 0 });
    expect(bad.levels['11']!.outside_edge_distance_m.min_m).toBeCloseTo(Math.hypot(9.04, 19.06), 10);
  });
  it('keeps invalid negative-control coordinates outside and distances unknown', () => {
    const inputs = parseS03Members(encode()); inputs.navTransform = [2, 0, 0, 2, 1000, 1000];
    const bad = checkInternal(inputs, (lat, lon) => [lon, lat], true);
    expect(bad).toMatchObject({ status: 'FAIL', outside_unprojectable_count: 1 });
    expect(bad.levels['11']).toMatchObject({ outside_count: 1, outside_edge_distance_m: { count: 0, min_m: null, median_m: null, p90_m: null, max_m: null } });
  });
  it('uses only the node own-level polygons and reports per-level failures', () => {
    const inputs = parseS03Members(encode());
    inputs.levels.push({ ...inputs.levels[0]!, id: 12, polygons: [[[[40, 40], [41, 40], [41, 41], [40, 41], [40, 40]]]] });
    inputs.nodes.push({ ...inputs.nodes[0]!, index: 1, sourceId: 102, levelId: 12 });
    const result = checkInternal(inputs, (lat, lon) => [lon, lat]);
    expect(result.status).toBe('FAIL');
    expect(result.levels['11']!.inside_count).toBe(1);
    expect(result.levels['12']!.inside_count).toBe(0);
  });
  it('uses interpolated percentiles and preserves empty samples', () => {
    expect(residualStats([4, 1, 3, 2])).toEqual({ count: 4, min_m: 1, median_m: 2.5, p90_m: 3.7, max_m: 4 });
    expect(residualStats([]).median_m).toBeNull();
  });
});

describe('S03 unclosed source rings: exclude, never repair', () => {
  const openRing = [[0, 0], [1, 0], [1, 1], [0, 1]];
  it('excludes the feature, records the defect and keeps the other features on the level', () => {
    const inputs = parseS03Members(withLevelFeatures([polygonFeature([openRing]), polygonFeature(square)]));
    expect(sourceDefectRecords(inputs, project)).toEqual([{ kind: 'SOURCE_DEFECT_UNCLOSED_RING', level_id: 11, feature_index: 0, polygon_index: 0, ring_index: 0, endpoint_gap_m: 1 }]);
    expect(inputs.levels[0]).toMatchObject({ featuresTotal: 2, featuresUsed: 1, featuresExcludedUnclosedRing: 1 });
    expect(inputs.levels[0]!.polygons).toEqual([square]);
    const result = checkInternal(inputs, project);
    expect(result).toMatchObject({ status: 'PASS', node_count: 1, node_count_total: 1, inside_count: 1, inside_share: 1, levels_without_usable_polygons: [] });
    expect(result.levels['11']).toMatchObject({ node_count: 1, polygon_count: 1, inside_count: 1, features_total: 2, features_used: 1, features_excluded_unclosed_ring: 1, reason: null });
  });
  it('names the first unclosed ring by polygon and ring index without touching any position', () => {
    const multipolygon = { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [square, [[[0, 0], [1, 0], [1, 1], [0, 1.5]]]] } };
    const inputs = parseS03Members(withLevelFeatures([multipolygon]));
    expect(sourceDefectRecords(inputs, project)).toEqual([{ kind: 'SOURCE_DEFECT_UNCLOSED_RING', level_id: 11, feature_index: 0, polygon_index: 1, ring_index: 0, endpoint_gap_m: 1.5 }]);
    expect(inputs.levels[0]!.polygons).toEqual([]);
    expect(inputs.levels[0]!.featuresExcludedUnclosedRing).toBe(1);
  });
  it('keeps a level with no usable polygon and reports null inside metrics with a reason', () => {
    const inputs = parseS03Members(withLevelFeatures([polygonFeature([openRing])]));
    expect(inputs.levels[0]!.polygons).toEqual([]);
    const result = checkInternal(inputs, project);
    expect(result.status).toBe('FAIL');
    expect(result.levels_without_usable_polygons).toEqual([11]);
    expect(result.levels['11']).toMatchObject({ node_count: 1, polygon_count: 0, inside_count: null, inside_share: null, outside_count: null, outside_unprojectable_count: null,
      features_total: 1, features_used: 0, features_excluded_unclosed_ring: 1, reason: expect.stringContaining('SOURCE_DEFECT_UNCLOSED_RING') });
    expect(result.levels['11']!.outside_edge_distance_m).toEqual({ count: 0, min_m: null, median_m: null, p90_m: null, max_m: null });
    expect(result).toMatchObject({ node_count: 0, node_count_total: 1, inside_share: null, outside_unprojectable_count: 0 });
  });
  it('does not report a level with usable polygons but no nodes as unassessed', () => {
    const inputs = parseS03Members(encode());
    inputs.levels.push({ ...inputs.levels[0]!, id: 12, polygons: [square] });
    const result = checkInternal(inputs, project);
    expect(result.levels_without_usable_polygons).toEqual([]);
    expect(result.levels['12']).toMatchObject({ node_count: 0, polygon_count: 1, inside_share: null });
  });
  it('still fails closed when an unclosed feature also carries a structural malformation', () => {
    const entries = withLevelFeatures([polygonFeature([openRing]), polygonFeature([[[0, 0], [1, 0], [1, 1], [200, 0]]])]);
    expect(() => parseS03Members(entries)).toThrow(/invalid geographic coordinate/);
  });
  it('still fails closed when an unclosed ring also self-intersects, instead of excluding it', () => {
    // Topology is decided before any exclusion ruling, so the two defects cannot cancel each other out.
    const openBowtie = [[0, 0], [2, 2], [2, 0], [0, 2]];
    expect(() => parseS03Members(withLevelFeatures([polygonFeature([openBowtie])]))).toThrow(/ring 0 self-intersects/);
  });
  it('reports INCOMPLETE, not PASS, when a level carrying nodes has no usable polygon', () => {
    const inputs = parseS03Members(encode());
    // Level 11 keeps its usable square and its one inside node; level 12 has no polygons and a thousand nodes.
    inputs.levels.push({ ...inputs.levels[0]!, id: 12, polygons: [] });
    for (let index = 0; index < 1000; index++) inputs.nodes.push({ ...inputs.nodes[0]!, index: index + 1, sourceId: 200 + index, levelId: 12 });
    const result = checkInternal(inputs, project);
    expect(result).toMatchObject({ status: 'INCOMPLETE', node_count: 1, inside_count: 1, inside_share: 1, node_count_total: 1001,
      nodes_unassessed: 1000, levels_with_nodes_unassessed: [12], levels_without_usable_polygons: [12] });
    expect(result.reason).toContain('INCOMPLETE');
    // The same assessment without the unassessed nodes is a clean PASS.
    inputs.levels.pop(); inputs.nodes = inputs.nodes.slice(0, 1);
    expect(checkInternal(inputs, project)).toMatchObject({ status: 'PASS', nodes_unassessed: 0, levels_with_nodes_unassessed: [] });
  });
  it('compares complete positions on ring closure, including an optional third value', () => {
    const closed3d = [[139, 35, 0], [139.001, 35, 0], [139.001, 35.001, 0], [139, 35.001, 0], [139, 35, 0]];
    const closedInputs = parseS03Members(withLevelFeatures([polygonFeature([closed3d])]));
    expect(sourceDefectRecords(closedInputs, project)).toEqual([]);
    expect(closedInputs.levels[0]!.polygons).toHaveLength(1);
    // Same x/y endpoint at a different height is unclosed: the ring is not silently flattened for the closure test.
    const open3d = [...closed3d.slice(0, 4), [139, 35, 10]];
    const openInputs = parseS03Members(withLevelFeatures([polygonFeature([open3d])]));
    expect(sourceDefectRecords(openInputs, project)).toEqual([{ kind: 'SOURCE_DEFECT_UNCLOSED_RING', level_id: 11, feature_index: 0, polygon_index: 0, ring_index: 0, endpoint_gap_m: 0 }]);
    expect(openInputs.levels[0]!.polygons).toEqual([]);
    // The private provenance keeps the complete original tuples, so the two endpoints stay distinguishable in z.
    expect(openInputs.sourceDefects).toEqual([{ kind: 'SOURCE_DEFECT_UNCLOSED_RING', levelId: 11, featureId: null, featureIndex: 0, polygonIndex: 0, ringIndex: 0,
      first: [139, 35, 0], last: [139, 35, 10] }]);
  });
});

describe('S03 hole outside its shell: exclude, never repair', () => {
  const outsideHole: Polygon2 = [square[0]!, [[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]];
  it('excludes the whole feature, records the ring and the ENU offset, and keeps the other features', () => {
    // A hole with no position inside its shell is the exclusion ruling, not an excursion that leaves the shell.
    expect(holeShellRelation(outsideHole[1]!, square[0]!)).toEqual({ cross: false, overlap: false, leaves: false, touch: false });
    const inputs = parseS03Members(withLevelFeatures([polygonFeature(outsideHole), polygonFeature(square)]));
    // The feature is gone from Check A, and no ring was clipped, moved or dropped.
    expect(inputs.levels[0]).toMatchObject({ featuresTotal: 2, featuresUsed: 1, featuresExcludedUnclosedRing: 0, featuresExcludedHoleOutsideShell: 1 });
    expect(inputs.levels[0]!.polygons).toEqual([square]);
    const [defect] = sourceDefectRecords(inputs, project);
    expect(defect).toMatchObject({ kind: 'SOURCE_DEFECT_HOLE_OUTSIDE_SHELL', level_id: 11, feature_index: 0, polygon_index: 0, ring_index: 1 });
    // The public record carries the worst hole vertex's distance to the shell, not any source position.
    expect((defect as { max_offset_m: number }).max_offset_m).toBeCloseTo(Math.hypot(2, 2), 12);
    const result = checkInternal(inputs, project);
    expect(result).toMatchObject({ status: 'PASS', node_count: 1, inside_count: 1, levels_without_usable_polygons: [] });
    expect(result.levels['11']).toMatchObject({ polygon_count: 1, inside_count: 1, features_total: 2, features_used: 1,
      features_excluded_unclosed_ring: 0, features_excluded_hole_outside_shell: 1, reason: null });
  });
  it('names the polygon and hole ring of a multipolygon and leaves the level usable through its other part', () => {
    const shell = [[1.2, 1.2], [1.8, 1.2], [1.8, 1.8], [1.2, 1.8], [1.2, 1.2]];
    const multipolygon = { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [square, [shell, [[3, 3], [3.5, 3], [3.5, 3.5], [3, 3]]]] } };
    const inputs = parseS03Members(withLevelFeatures([multipolygon, polygonFeature(square)]));
    expect(sourceDefectRecords(inputs, project)[0]).toMatchObject({ kind: 'SOURCE_DEFECT_HOLE_OUTSIDE_SHELL', feature_index: 0, polygon_index: 1, ring_index: 1 });
    expect(inputs.levels[0]).toMatchObject({ featuresTotal: 2, featuresUsed: 1, featuresExcludedHoleOutsideShell: 1 });
    expect(checkInternal(inputs, project).status).toBe('PASS');
  });
  it('excludes a hole that only touches its shell and lies outside it, instead of failing closed', () => {
    // A hole contact is not an excursion: with no piece inside the shell this is the director's wholly-outside case.
    const touching: Point2[] = [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]];
    expect(holeShellRelation(touching, square[0]!)).toEqual({ cross: false, overlap: false, leaves: false, touch: true });
    const inputs = parseS03Members(withLevelFeatures([polygonFeature([square[0]!, touching]), polygonFeature(square)]));
    expect(inputs.levels[0]).toMatchObject({ featuresUsed: 1, featuresExcludedHoleOutsideShell: 1 });
    const [defect] = sourceDefectRecords(inputs, project);
    expect(defect).toMatchObject({ kind: 'SOURCE_DEFECT_HOLE_OUTSIDE_SHELL', level_id: 11, feature_index: 0, polygon_index: 0, ring_index: 1 });
    expect((defect as { max_offset_m: number }).max_offset_m).toBeCloseTo(Math.SQRT2, 12);
  });
  it('keeps the complete shell and hole tuples of an excluded hole, third value included', () => {
    const shell3d = [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]];
    const hole3d = [[2, 2, 3], [3, 2, 3], [3, 3, 3], [2, 3, 3], [2, 2, 3]];
    const inputs = parseS03Members(withLevelFeatures([polygonFeature([shell3d, hole3d])]));
    expect(inputs.sourceDefects).toEqual([{ kind: 'SOURCE_DEFECT_HOLE_OUTSIDE_SHELL', levelId: 11, featureId: null, featureIndex: 0, polygonIndex: 0, ringIndex: 1,
      vertices: hole3d, shell: shell3d }]);
    // The public record keeps only the horizontal ENU offset.
    expect((sourceDefectRecords(inputs, project)[0] as { max_offset_m: number }).max_offset_m).toBeCloseTo(Math.hypot(2, 2), 12);
  });
  it('keeps a level with no usable polygon and reports null inside metrics with a reason that names the ruling', () => {
    const inputs = parseS03Members(withLevelFeatures([polygonFeature(outsideHole)]));
    expect(inputs.levels[0]!.polygons).toEqual([]);
    const result = checkInternal(inputs, project);
    expect(result.status).toBe('FAIL');
    expect(result.levels_without_usable_polygons).toEqual([11]);
    expect(result.levels['11']).toMatchObject({ polygon_count: 0, inside_count: null, inside_share: null,
      features_excluded_hole_outside_shell: 1, reason: expect.stringContaining('SOURCE_DEFECT_HOLE_OUTSIDE_SHELL') });
  });
  it('counts each exclusion by kind and still fails closed on a self-intersecting ring', () => {
    const openRing = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const inputs = parseS03Members(withLevelFeatures([polygonFeature([openRing]), polygonFeature(outsideHole), polygonFeature(square)]));
    expect(inputs.sourceDefects.map(defect => defect.kind)).toEqual(['SOURCE_DEFECT_UNCLOSED_RING', 'SOURCE_DEFECT_HOLE_OUTSIDE_SHELL']);
    expect(checkInternal(inputs, project).levels['11']).toMatchObject({ features_excluded_unclosed_ring: 1, features_excluded_hole_outside_shell: 1, features_used: 1 });
    // A crossing ring is not an exclusion: it fails the run even on a feature the hole ruling would drop.
    const bowtieShell = [[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]];
    expect(() => parseS03Members(withLevelFeatures([polygonFeature([bowtieShell, [[3, 3], [4, 3], [4, 4], [3, 4], [3, 3]]])])))
      .toThrow(/self-intersects/);
  });
});

describe('S03 polygon topology (fail closed)', () => {
  it('requires shell membership before a hole boundary can contain a point', () => {
    const holeOutside: Polygon2 = [square[0]!, [[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]];
    expect(pointInPolygon([2.5, 2], holeOutside)).toBe(false);
    expect(ringContainsInclusive([2.5, 2], holeOutside[1]!)).toBe(true);
    expect(pointInPolygon([0.2, 0.5], [square[0]!, [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]]])).toBe(true);
  });
  it('accepts a hole inside its shell, or sharing one position with it, and counts both rings as checked', () => {
    const inside = parseS03Members(withLevelFeatures([polygonFeature([square[0]!, [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]]])]));
    expect(inside.levels[0]!.polygons).toHaveLength(1);
    expect(inside.topology).toEqual({ rings_checked: 2, rings_skipped_large: 0, hole_shell_touches: 0 });
    // The containment test is inclusive, so a hole vertex on the shell boundary is not an outside vertex; a single
    // shared position is a legitimate boundary touch, counted, not a crossing.
    const touching = parseS03Members(withLevelFeatures([polygonFeature([square[0]!, [[0, 0], [0.5, 0.2], [0.2, 0.5], [0, 0]]])]));
    expect(touching.levels[0]!.polygons).toHaveLength(1);
    expect(sourceDefectRecords(touching, project)).toEqual([]);
    expect(touching.topology).toEqual({ rings_checked: 2, rings_skipped_large: 0, hole_shell_touches: 1 });
  });
  it('fails closed when a hole edge crosses a concave shell whose vertices are all inside', () => {
    // An L-shaped shell: the notch x > 1, y > 1 is outside. Every vertex of this hole is inside the L, yet the edge
    // from the bottom arm to the left arm passes through the notch.
    const ell: Point2[] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4], [0, 0]];
    const hole: Point2[] = [[2, 0.5], [0.5, 2], [0.5, 0.5], [2, 0.5]];
    expect(hole.slice(0, -1).every(vertex => ringContainsInclusive(vertex, ell))).toBe(true);
    expect(() => parseS03Members(withLevelFeatures([polygonFeature([ell, hole])]))).toThrow(/ring 1 cuts through its shell/);
  });
  it('fails closed when a hole edge runs along its shell', () => {
    // Sharing a stretch of boundary is not the director's exclusion, which covers only a hole wholly outside its shell.
    const alongShell = [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0]];
    expect(() => parseS03Members(withLevelFeatures([polygonFeature([square[0]!, alongShell])]))).toThrow(/ring 1 runs along its shell/);
  });
  it('fails closed when a hole edge leaves a concave shell through two shared positions', () => {
    // A U-shaped shell; its notch x in (1,4), y in (1,5) is outside. The hole edge from shell position (1,1) to shell
    // position (4,5) crosses the notch, yet each contact is a single point, so no edge relation sees the excursion.
    const shell: Point2[] = [[0, 0], [5, 0], [5, 5], [4, 5], [4, 1], [1, 1], [1, 5], [0, 5], [0, 0]];
    const hole: Point2[] = [[1, 1], [4, 5], [4.5, 0.5], [0.5, 0.5], [1, 1]];
    expect(holeShellRelation(hole, shell)).toEqual({ cross: false, overlap: false, leaves: true, touch: true });
    // Every hole vertex is inside or on the shell, so only the split-midpoint test can reject it.
    expect(hole.slice(0, -1).every(vertex => ringContainsInclusive(vertex, shell))).toBe(true);
    expect(() => parseS03Members(withLevelFeatures([polygonFeature([shell, hole])]))).toThrow(/ring 1 leaves its shell/);
  });
  it('accepts a hole sharing one position with its shell while every piece stays inside', () => {
    const hole: Point2[] = [[0, 0], [0.5, 0.2], [0.2, 0.5], [0, 0]];
    expect(holeShellRelation(hole, square[0]!)).toEqual({ cross: false, overlap: false, leaves: false, touch: true });
    expect(parseS03Members(withLevelFeatures([polygonFeature([square[0]!, hole])])).topology)
      .toEqual({ rings_checked: 2, rings_skipped_large: 0, hole_shell_touches: 1 });
  });
  it('skips the hole/shell test above the vertex cap and counts the ring as skipped', () => {
    // The same excursion as above, with an inside edge subdivided past the cap: the hole/shell test is skipped, so the
    // command accepts the feature, and the oversized hole ring is the one counted in rings_skipped_large.
    const shell: Point2[] = [[0, 0], [5, 0], [5, 5], [4, 5], [4, 1], [1, 1], [1, 5], [0, 5], [0, 0]];
    const subdivided = Array.from({ length: 2001 }, (_, index): Point2 => [4.5 - 4 * (index + 1) / 2002, 0.5]);
    const hole: Point2[] = [[1, 1], [4, 5], [4.5, 0.5], ...subdivided, [0.5, 0.5], [1, 1]];
    expect(hole.length - 1).toBeGreaterThan(2000);
    // Called directly, the hole test does see the excursion; the command skips it above the cap instead.
    expect(holeShellRelation(hole, shell).leaves).toBe(true);
    const inputs = parseS03Members(withLevelFeatures([polygonFeature([shell, hole])]));
    expect(inputs.levels[0]!.polygons).toHaveLength(1);
    expect(inputs.topology).toEqual({ rings_checked: 1, rings_skipped_large: 1, hole_shell_touches: 0 });
  });
  it('fails closed on a self-intersecting ring and never reports an unchecked large ring as clean', () => {
    const bowtie = [[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]];
    expect(selfIntersectionCheck(bowtie.map(([x, y]) => [x!, y!] as const))).toBe('SELF_INTERSECTING');
    expect(selfIntersectionCheck(square[0]!)).toBe('CLEAN');
    expect(() => parseS03Members(withLevelFeatures([polygonFeature([bowtie])]))).toThrow(/ring 0 self-intersects/);
    const huge = Array.from({ length: 2002 }, (_, index) => [index / 10000, index % 2] as const);
    huge.push([0, 0] as const);
    expect(selfIntersectionCheck(huge)).toBe('NOT_CHECKED_TOO_MANY_VERTICES');
  });
  it('treats a collinear overlap and a non-adjacent touch as non-simple', () => {
    // A notch doubling back along an earlier edge: the two edges share a stretch of positive length.
    const overlap = [[0, 0], [3, 0], [3, 1], [2, 1], [2, 0], [1, 0], [1, 1], [0, 1], [0, 0]] as const;
    expect(selfIntersectionCheck(overlap)).toBe('SELF_INTERSECTING');
    expect(() => parseS03Members(withLevelFeatures([polygonFeature([overlap])]))).toThrow(/ring 0 self-intersects/);
    // A pinched ring whose tip lands on a non-adjacent edge: one point of contact, no crossing.
    const pinched = [[0, 0], [4, 0], [4, 4], [2, 0], [0, 4], [0, 0]] as const;
    expect(selfIntersectionCheck(pinched)).toBe('SELF_INTERSECTING');
    expect(() => parseS03Members(withLevelFeatures([polygonFeature([pinched])]))).toThrow(/ring 0 self-intersects/);
  });
  it('does not read a repeated or redundant vertex as a self-touch, and rejects a ring without an interior', () => {
    // Repeated consecutive positions are zero-length edges, not edges: the ring itself stays simple.
    expect(selfIntersectionCheck([[0, 0], [1, 0], [1, 0], [1, 1], [0, 1], [0, 0]])).toBe('CLEAN');
    // A redundant collinear vertex only touches its neighbours at the shared position.
    expect(selfIntersectionCheck([[0, 0], [0.5, 0], [1, 0], [1, 1], [0, 1], [0, 0]])).toBe('CLEAN');
    expect(selfIntersectionCheck([[0, 0], [0, 0], [0, 0], [0, 0]])).toBe('DEGENERATE_RING');
    expect(() => parseS03Members(withLevelFeatures([polygonFeature([[[0, 0], [0, 0], [0, 0], [0, 0]]])])))
      .toThrow(/ring 0 has fewer than three distinct positions/);
  });
});

describe('S03 outside-node diagnostic (diagnostic only)', () => {
  it('classifies floor-transition ends from direction codes and cross-level edge structure', () => {
    const nodes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(sourceId => ({ sourceId, levelId: sourceId % 2 ? 11 : 12 }));
    nodes[6]!.levelId = 11; nodes[7]!.levelId = 11; // 7 and 8 share a level
    nodes[10]!.levelId = 11; nodes[11]!.levelId = 11;
    const link = (sourceId: number, n1: number, n2: number, direction: number, dz: number | null): S03Link => ({ sourceId, n1, n2, direction, dz });
    const links = [link(1, 1, 2, 1, -1), link(2, 3, 4, 2, 1), link(3, 5, 6, 3, 2), link(4, 7, 8, 3, null),
      link(5, 9, 10, 1, -1), link(6, 9, 10, 3, 1), link(7, 11, 12, 3, 1)];
    const classes = classifyNodes(nodes, links);
    expect([...classes.values()]).toEqual([1, 1, 2, 2, 3, 3, 0, 0, 4, 4, 3, 3]);
  });
  it('treats a same-level dz of zero as a corridor link, not a floor transition', () => {
    const nodes = [1, 2, 3, 4].map(sourceId => ({ sourceId, levelId: 11 }));
    const classes = classifyNodes(nodes, [
      { sourceId: 1, n1: 1, n2: 2, direction: 3, dz: 0 },
      { sourceId: 2, n1: 3, n2: 4, direction: 2, dz: 1.5 },
    ]);
    expect([...classes.values()]).toEqual([0, 0, 2, 2]);
  });
  it('summarises edge direction as a mean unit vector, resultant length and 8 sectors', () => {
    expect(directionSummary([[0, 0], [0, 0], [0, 0], [0, 0]], [[1, 0], [0, 1], [-1, 0], [0, -1]]))
      .toMatchObject({ count: 4, mean_vector_east: 0, mean_vector_north: 0, mean_resultant_length: 0, sectors: [1, 0, 1, 0, 1, 0, 1, 0] });
    expect(directionSummary([[0, 0], [0, 0], [0, 0]], [[2, 0], [5, 0], [0, 0]]))
      .toMatchObject({ count: 2, mean_vector_east: 1, mean_vector_north: 0, mean_resultant_length: 1, sectors: [2, 0, 0, 0, 0, 0, 0, 0] });
    expect(directionSummary([], [])).toMatchObject({ count: 0, mean_vector_east: null, mean_resultant_length: null, circular_spread_deg: null,
      mean_bearing_deg_ccw_from_east: null, mean_bearing_deg_compass: null });
    // Bearings are counter-clockwise from east in the raw field and clockwise from north in the compass field.
    const north = directionSummary([[0, 0]], [[0, 1]]), west = directionSummary([[0, 0]], [[-1, 0]]);
    expect(north.mean_bearing_deg_ccw_from_east).toBeCloseTo(90, 12);
    expect(north.mean_bearing_deg_compass).toBeCloseTo(0, 12);
    expect(north.circular_spread_deg).toBeCloseTo(0, 12);
    expect(west.mean_bearing_deg_ccw_from_east).toBeCloseTo(180, 12);
    expect(west.mean_bearing_deg_compass).toBeCloseTo(270, 12);
    expect(west.circular_spread_deg).toBeCloseTo(0, 12);
    expect(nearestPointOnSegment([2, 1], [0, 0], [2, 0])).toEqual([2, 0]);
    expect(nearestPointOnSegment([-1, 0], [0, 0], [0, 0])).toEqual([0, 0]);
  });
  it('explains outside nodes without changing the main Check A result', () => {
    const inputs = parseS03Members(encode());
    inputs.levels[0]!.polygons = [[[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]]];
    const before = checkInternal(inputs, project);
    expect(before.levels['11']!.outside_count).toBe(1);
    const diagnostic = outsideNodeDiagnostic(inputs, project, { east: -2, north: -2 });
    const after = checkInternal(inputs, project);
    expect(after).toEqual(before);
    expect(diagnostic).toMatchObject({ diagnostic_only: true, main_check_a_modified: false, offset_diagnostic: { diagnostic_offset_applied: true, adopted: false, main_check_a_modified: false } });
    // One outside node is suppressed in public: its spread and direction histogram would describe that single position.
    expect(diagnostic.levels['11']).toEqual({ node_count: 1, outside_node_count: 1, suppressed: 'fewer than 3 nodes' });
    expect(diagnostic.private_levels['11']!.position_enu.mean_east_m).toBeCloseTo(0.14, 12);
    expect(diagnostic.private_levels['11']!.position_enu.mean_north_m).toBeCloseTo(0.26, 12);
    expect(diagnostic.offset_diagnostic.overall).toMatchObject({ node_count: 1, inside_count: 1, inside_share: 1 });
    expect(before.levels['11']!.inside_count).toBe(0);
  });
  it('suppresses public per-level statistics below three outside nodes and keeps absolute ENU means private', () => {
    const inputs = parseS03Members(encode());
    inputs.levels[0]!.polygons = [[[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]]];
    inputs.nodes.push({ ...inputs.nodes[0]!, index: 1, sourceId: 102, native: [4, 5] }, { ...inputs.nodes[0]!, index: 2, sourceId: 103, native: [6, 7] });
    const diagnostic = outsideNodeDiagnostic(inputs, project);
    const summary = diagnostic.levels['11']!;
    expect(summary).toMatchObject({ node_count: 3, outside_node_count: 3, position_enu: { count: 3 }, directions: { count: 3 } });
    expect(Object.keys(summary.position_enu!)).toEqual(['count', 'sd_east_m', 'sd_north_m', 'rms_radius_m']);
    expect(summary.directions!.mean_resultant_length).toBeGreaterThan(0);
    expect(summary.directions!.mean_bearing_deg_compass).toBeCloseTo((90 - summary.directions!.mean_bearing_deg_ccw_from_east! + 360) % 360, 12);
    expect(JSON.stringify(diagnostic.levels)).not.toMatch(/mean_east_m|mean_north_m/);
    // The means locate nodes, so only the private provenance carries them.
    expect(diagnostic.private_levels['11']!.position_enu.mean_east_m).toBeCloseTo(0.18, 12);
    expect(diagnostic.private_levels['11']!.position_enu.mean_north_m).toBeCloseTo(0.3, 12);
  });
});

describe('S03 reciprocal compatible-floor pairing', () => {
  it('pairs reciprocally before applying inclusive thresholds; excludes wrong and unknown floor ordinals', () => {
    const e27 = [
      { id: 'e1', xy: [0, 0] as const, ordinal: -1 }, { id: 'e2', xy: [10, 0] as const, ordinal: -1 },
      { id: 'e3', xy: [20, 0] as const, ordinal: -1 }, { id: 'e4', xy: [30, 0] as const, ordinal: 0 },
      { id: 'closer-to-e2', xy: [11.9, 0] as const, ordinal: -2 },
      { id: 'not-reciprocal', xy: [31, 0] as const, ordinal: 1 }, { id: 'no-floor', xy: [0, 0] as const, ordinal: -6 },
    ];
    const s03 = [
      { index: 0, sourceId: 100, xy: [1, 0] as const, ordinal: -1 }, { index: 1, sourceId: 101, xy: [12, 0] as const, ordinal: -1 },
      { index: 2, sourceId: 102, xy: [23, 0] as const, ordinal: -1 }, { index: 3, sourceId: 103, xy: [30, 4] as const, ordinal: 1 },
    ];
    const result = mutualNearest(e27, s03);
    expect(result.thresholds_m).toEqual([{ threshold_m: 1, pair_count: 1 }, { threshold_m: 2, pair_count: 2 }, { threshold_m: 3, pair_count: 3 }, { threshold_m: 5, pair_count: 4 }]);
    expect(result.pairs.map(p => p.e27_node_id)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(result.residuals_within_5m).toEqual({ count: 4, min_m: 1, median_m: 2.5, p90_m: 3.7, max_m: 4 });
    expect(result.mean_delta_within_5m).toMatchObject({ d_east_m: 1.5, d_north_m: 1, applied: false });
    expect(result.mean_delta_within_5m.length_m).toBeCloseTo(Math.hypot(1.5, 1), 12);
    expect(compatibleFloors(0, 1)).toBe(true); expect(compatibleFloors(1, 0)).toBe(false);
    expect(compatibleFloors(-1, -2)).toBe(false);
    expect(() => guardS03Receipt(result, new Set(['1', '2', '3', '5']))).not.toThrow();
  });
  it('uses source numeric ids and E27 lexical ids to break exact distance ties', () => {
    const result = mutualNearest([{ id: 'b', xy: [0, 0], ordinal: -1 }, { id: 'a', xy: [0, 0], ordinal: -1 }], [
      { index: 0, sourceId: 102, xy: [1, 0], ordinal: -1 }, { index: 1, sourceId: 101, xy: [-1, 0], ordinal: -1 },
    ]);
    expect(result.pairs).toEqual([{ e27_node_id: 'a', s03_node_index: 1, distance_m: 1, d_east_m: -1, d_north_m: 0 }]);
    expect(mutualNearest([], []).mean_delta_within_5m).toEqual({ d_east_m: null, d_north_m: null, length_m: null, applied: false });
  });
});

describe('S03 member, byte-integrity and publication boundaries', () => {
  it('reads a verified in-memory ZIP, and names a missing nav or per-level member', async () => {
    const entries = await readZip(fixtureZip(encode()), { legacyFileNameEncoding: 'shift_jis' });
    expect(parseS03Members(entries).nodes).toHaveLength(1);
    expect(() => parseS03Members(entries.filter(e => !e.name.endsWith('v5_nav.json')))).toThrow('Missing S03 ZIP member v5_nav.json');
    expect(() => parseS03Members(entries.filter(e => !e.name.includes('geojson-level-geom-')))).toThrow('Missing S03 ZIP member geojson-level-geom-B1F.geojson');
  });
  it('rejects malformed JSON and ambiguous member basenames with the member name', () => {
    const entries = encode(); entries[0]!.data = Buffer.from('{');
    expect(() => parseS03Members(entries)).toThrow('Malformed S03 ZIP member v5_nav.json: invalid UTF-8 or JSON');
    expect(() => parseS03Members([...encode(), { name: 'other/v5_nav.json', data: Buffer.from('{}') }])).toThrow('v5_nav.json: duplicate basename');
  });
  it('rejects malformed geometry, explicit CRS, multiple node floors and mismatched level identity', () => {
    for (const change of ['ring-length', 'invalid-coordinate', 'crs', 'node-level', 'level-id'] as const) {
      const entries = encode(), index = change === 'node-level' ? 0 : 2;
      const value = JSON.parse(entries[index]!.data.toString());
      if (change === 'ring-length') value.features[0].geometry.coordinates = [[[0, 0], [1, 0], [0, 0]]];
      if (change === 'invalid-coordinate') value.features[0].geometry.coordinates = [[[0, 0], [1, 0], [1, 1], [0, 0], [200, 0]]];
      if (change === 'crs') value.crs = null;
      if (change === 'node-level') value.n[0].l.push({ lid: 11 });
      if (change === 'level-id') value.id = 12;
      entries[index]!.data = Buffer.from(JSON.stringify(value));
      expect(() => parseS03Members(entries), change).toThrow(change === 'node-level' ? /v5_nav.json/ : /geojson-level-geom-B1F\.geojson/);
    }
  });
  it('hashes the floor mapping into the receipt identity, so changing one ordinal changes the run id', () => {
    const floors = [{ id: 'B1F', ordinal: -1 }, { id: '1F', ordinal: 1 }], moved = [{ id: 'B1F', ordinal: -2 }, { id: '1F', ordinal: 1 }];
    expect(floorMappingSha256(floors)).toBe(floorMappingSha256([...floors].reverse()));
    expect(floorMappingSha256(moved)).not.toBe(floorMappingSha256(floors));
    const facts = { policy_version: 'policy', tool_input_sha256: 'tool', zip_sha256: 'zip', station_origin_sha256: 'origin',
      floor_mapping_sha256: floorMappingSha256(floors), e27_graph_sha256: 'graph' };
    expect(receiptIdentity(facts).run_id).toMatch(/^transform-check-[0-9a-f]{20}$/);
    expect(receiptIdentity(facts).run_id).toBe(receiptIdentity({ ...facts }).run_id);
    const changed = receiptIdentity({ ...facts, floor_mapping_sha256: floorMappingSha256(moved) });
    expect(changed.run_id).not.toBe(receiptIdentity(facts).run_id);
    expect(changed.digest_inputs.floor_mapping_sha256).toBe(floorMappingSha256(moved));
  });
  it('fails SHA mismatch or byte-count mismatch before parsing', () => {
    const bytes = fixtureZip(encode()), expected = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
    expect(() => assertS03Bytes(bytes, expected)).not.toThrow();
    const corrupted = Buffer.from(bytes); corrupted[0] ^= 1;
    expect(() => assertS03Bytes(corrupted, expected)).toThrow(/SHA-256\/byte-count mismatch/);
    expect(() => assertS03Bytes(bytes, { ...expected, bytes: bytes.length + 1 })).toThrow(/mismatch/);
  });
  it('guards every source string including nested, localized, tuple and short values', () => {
    const inputs = parseS03Members(encode()), safe = { gteki_role: 'evidence', navigation_use: 'NOT_FOR_ROUTING', node_count: 1 };
    expect(guardS03Receipt(safe, inputs.sourceValues)).toBe(safe);
    for (const literal of ['SYNTH-S03-private-shop', 'SYNTH-private-description', 'SYNTH-private-localized', 'B1F']) {
      expect(() => guardS03Receipt({ ...safe, injected: literal }, inputs.sourceValues)).toThrow('would carry a source property value');
    }
    const strings = collectS03Strings({ p: [['name', 'SYNTH-tuple', 0]], 'properties:en': { short: 'A' }, properties: { nested: ['合成店舗名'] } });
    expect(strings).toEqual(new Set(['name', 'SYNTH-tuple', 'A', '合成店舗名']));
    expect(() => guardS03Receipt({ sentence: 'prefix 合成店舗名 suffix' }, strings)).toThrow(/source property value/);
    expect(() => guardS03Receipt({ injected: 'A' }, strings)).toThrow(/source property value/);
  });
});
