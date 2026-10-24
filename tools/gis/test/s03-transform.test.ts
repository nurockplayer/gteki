import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readZip } from '../src/zip.js';
import {
  applyAffine, assertS03Bytes, checkInternal, collectS03Strings, compatibleFloors, distanceToPolygonEdge, distanceToSegment,
  guardS03Receipt, mutualNearest, parseS03Members, pointInPolygon, residualStats, sourceDefectRecords, transformS03, type Affine, type Polygon2,
} from '../src/s03-transform.js';

const nav: Affine = [2, 0, 0, 2, 10, 20], drawing: Affine = [0.01, 0, 0, 0.01, 0, 0];
const square: Polygon2 = [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]];
const fixtureMembers = () => [
  { name: 'nested/v5_nav.json', value: { d: [{ id: 7, t: nav, l: [{ id: 11 }] }], n: [{ id: 101, mx: 2, my: 3, l: [{ lid: 11 }] }] } },
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
