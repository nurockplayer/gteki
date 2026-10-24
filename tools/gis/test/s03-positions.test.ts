import { describe, expect, it } from 'vitest';
import {
  POSITIONS_FLOOR_MAPPING_SHA256, S03_POSITIONS_POLICY, assertPositionCounts, buildPositionsReceipt, enuToGeodetic, joinS03Pois,
  locateSelection, parseS03EntityId, partAreaCentroid, positionsIdentity, representativePoint, splitSelections, uncertaintyFor,
  type PointedPosition, type PositionsDigestFacts, type S03Selection,
} from '../src/s03-positions.js';
import { S03_FLOOR_ORDINALS, floorMappingSha256, pointInPolygon, type Point2, type Polygon2, type S03Inputs } from '../src/s03-transform.js';
import { stationEnuProjector } from '../src/station-enu.js';

const square = (x: number, y: number, size: number): Polygon2 => [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]];

/** Synthetic shipped POIs and their research records; only the structure and counts mirror the real files. */
function buildDocs(counts: Record<string, number> = { ticket_gate: 23, transfer: 3, platform: 19 }) {
  const shipped: unknown[] = [], research: unknown[] = [];
  let featureId = 1000;
  for (const category of ['ticket_gate', 'transfer', 'platform']) for (let index = 1; index <= counts[category]!; index++) {
    const id = `poi:synth-${category}:${index}`, text = `合成${category}${index}`;
    shipped.push({ id, category, names: [{ lang: 'ja', text }], evidence: { sourceIds: ['tokyo-s03-zip'] } });
    research.push({ id, category, names: [{ lang: 'ja', text }], s03: { entityId: `$id ${featureId++}`, levels: ['B1F'] } });
  }
  shipped.push({ id: 'poi:other:1', category: 'exit', names: [{ lang: 'ja', text: '合成出口' }], evidence: { sourceIds: ['other-source'] } });
  research.push({ id: 'poi:other:1', category: 'exit', names: [{ lang: 'ja', text: '合成出口' }] });
  return { shipped: { pois: shipped }, research: { pois: research } };
}

describe('S03 positions: entity id join (synthetic only)', () => {
  it('accepts the source "$id <n>" reference text and a positive integer, and coerces nothing else', () => {
    expect(parseS03EntityId('$id 28993980', 'poi:x')).toBe(28993980);
    expect(parseS03EntityId(28993980, 'poi:x')).toBe(28993980);
    for (const bad of ['28993980', '$id', '$id -1', '$id 0', 0, -3, 1.5, null, { id: 1 }])
      expect(() => parseS03EntityId(bad, 'poi:x'), JSON.stringify(bad)).toThrow(/unsupported s03\.entityId/);
  });
  it('joins every S03-citing POI to exactly one research entry and splits candidates from platforms', () => {
    const { shipped, research } = buildDocs();
    const selections = joinS03Pois(shipped, research);
    expect(selections).toHaveLength(45);
    const { candidates, platforms } = splitSelections(selections);
    expect(candidates).toHaveLength(26);
    expect(platforms).toHaveLength(19);
    expect(new Set(candidates.map(selection => selection.category))).toEqual(new Set(['ticket_gate', 'transfer']));
    expect(platforms.every(selection => selection.category === 'platform')).toBe(true);
    // The unrelated POI is not selected at all.
    expect(selections.some(selection => selection.poiId === 'poi:other:1')).toBe(false);
    // Deterministic order, so the private output has no run-to-run drift.
    expect(selections.map(selection => selection.poiId)).toEqual([...selections.map(selection => selection.poiId)].sort());
  });
  it('fails closed and reports the difference when a count differs from the ruling', () => {
    const { shipped, research } = buildDocs({ ticket_gate: 22, transfer: 3, platform: 19 });
    expect(() => joinS03Pois(shipped, research)).toThrow(/POI counts are platform=19, ticket_gate=22, transfer=3; the ruling names platform=19, ticket_gate=23, transfer=3/);
  });
  it('fails closed on a category or ja-name disagreement, a duplicate entity id and an unmatched research entry', () => {
    const category = buildDocs();
    (category.research.pois as Array<{ category: string }>)[0]!.category = 'transfer';
    expect(() => joinS03Pois(category.shipped, category.research)).toThrow(/category/);
    const name = buildDocs();
    (name.research.pois as Array<{ names: Array<{ text: string }> }>)[0]!.names[0]!.text = '合成別名';
    expect(() => joinS03Pois(name.shipped, name.research)).toThrow(/ja name differs/);
    const duplicate = buildDocs();
    const entries = duplicate.research.pois as Array<{ s03: { entityId: string } }>;
    entries[1]!.s03.entityId = entries[0]!.s03.entityId;
    expect(() => joinS03Pois(duplicate.shipped, duplicate.research)).toThrow(/claimed by more than one POI/);
    const extra = buildDocs();
    (extra.research.pois as unknown[]).push({ id: 'poi:ghost:1', category: 'ticket_gate', names: [{ lang: 'ja', text: '合成幽霊' }], s03: { entityId: '$id 999999', levels: ['B1F'] } });
    expect(() => joinS03Pois(extra.shipped, extra.research)).toThrow(/not an S03-citing POI/);
  });
  it('locates a feature id at one used level feature, at a recorded source defect, or nowhere fatal', () => {
    const levels = [{ id: 11, label: 'B1F', ordinal: -1, features: [{ featureIndex: 0, featureId: 7, polygons: [square(0, 0, 1)] }] }];
    const selection = (entityId: number): S03Selection => ({ poiId: `poi:synth:${entityId}`, category: 'ticket_gate', entityId, levelLabel: 'B1F' });
    const inputs = { levels, sourceDefects: [] } as unknown as S03Inputs;
    expect(locateSelection(inputs, selection(7))).toMatchObject({ kind: 'feature', polygons: [square(0, 0, 1)] });
    expect(() => locateSelection(inputs, selection(8))).toThrow(/neither a used level feature nor a recorded source defect/);
    // A feature excluded whole by a WP7 ruling is located, but only as an unpointed candidate with its reason.
    const excluded = { levels, sourceDefects: [{ kind: 'SOURCE_DEFECT_HOLE_OUTSIDE_SHELL', levelId: 11, featureId: 8 }] } as unknown as S03Inputs;
    expect(locateSelection(excluded, selection(8))).toEqual({ kind: 'excluded', reason: 'SOURCE_DEFECT_HOLE_OUTSIDE_SHELL', levelId: 11 });
    const twice = { levels: [...levels, { ...levels[0]!, id: 12 }], sourceDefects: [] } as unknown as S03Inputs;
    expect(() => locateSelection(twice, selection(7))).toThrow(/resolves to 2 used level features/);
  });
  it('fails closed unless exactly 25 points, 1 unpointed candidate and 19 platforms result', () => {
    expect(() => assertPositionCounts(25, 1, 19)).not.toThrow();
    expect(() => assertPositionCounts(26, 0, 19)).toThrow(/produced pointed=26, unpointed=0, platforms=19; the reviewed data produces pointed=25, unpointed=1, platforms=19/);
    expect(() => assertPositionCounts(25, 0, 20)).toThrow(/pointed=25, unpointed=0, platforms=20/);
  });
});

describe('S03 positions: representative point (synthetic only)', () => {
  it('uses the area-weighted centroid when it falls inside the polygon', () => {
    const result = representativePoint([square(0, 0, 10)]);
    expect(result.method).toBe('area_weighted_centroid');
    expect(result.point[0]).toBeCloseTo(5, 12);
    expect(result.point[1]).toBeCloseTo(5, 12);
    expect(result.radius_m).toBeCloseTo(Math.hypot(5, 5), 12);
    expect(result).toMatchObject({ part_count: 1, vertex_count: 5 });
    expect(pointInPolygon(result.point, square(0, 0, 10))).toBe(true);
  });
  it('falls back to the closest point inside the largest part when the centroid leaves a U-shaped polygon', () => {
    const u: Polygon2 = [[[0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6], [0, 0]]];
    const result = representativePoint([u]);
    // The area-weighted centroid sits in the notch, so only the fallback can produce a point on the polygon.
    expect(result.method).toBe('largest_part_closest_point');
    expect(pointInPolygon(result.point, u)).toBe(true);
    expect(result.point[0]).toBeCloseTo(3, 12);
    expect(result.point[1]).toBeCloseTo(2, 12);
    expect(result.radius_m).toBeCloseTo(5, 12);
  });
  it('falls back to the largest part of a multipart feature and measures the radius over every part', () => {
    const small = square(0, 0, 2), large = square(10, 0, 4);
    const result = representativePoint([small, large]);
    expect(result.method).toBe('largest_part_closest_point');
    expect(result.point[0]).toBeCloseTo(10, 12);
    expect(result.point[1]).toBeCloseTo(1.8, 12);
    expect(pointInPolygon(result.point, large)).toBe(true);
    // The farthest vertex is a corner of the small part.
    expect(result.radius_m).toBeCloseTo(Math.hypot(10, 1.8), 12);
    expect(result).toMatchObject({ part_count: 2, vertex_count: 10 });
  });
  it('treats a centroid that falls in a hole as outside the part and returns a boundary point', () => {
    const holed: Polygon2 = [square(0, 0, 10)[0]!, [[3, 3], [3, 7], [7, 7], [7, 3], [3, 3]]];
    expect(partAreaCentroid(holed).area).toBeCloseTo(100 - 16, 12);
    const result = representativePoint([holed]);
    expect(result.method).toBe('largest_part_closest_point');
    expect(pointInPolygon(result.point, holed)).toBe(true);
    // The nearest boundary is the hole edge at x = 3.
    expect(result.point[0]).toBeCloseTo(3, 12);
    expect(result.point[1]).toBeCloseTo(5, 12);
  });
  it('keeps a centroid inside the shell out of the hole accounting and rejects parts without area', () => {
    const holed: Polygon2 = [square(0, 0, 10)[0]!, [[8, 8], [8, 9], [9, 9], [9, 8], [8, 8]]];
    expect(representativePoint([holed])).toMatchObject({ method: 'area_weighted_centroid' });
    expect(() => representativePoint([])).toThrow(/at least one polygon part/);
    expect(() => representativePoint([[square(0, 0, 1)[0]!, [...square(0, 0, 1)[0]!].reverse() as Point2[]]])).toThrow(/no positive area/);
  });
  it('applies the 5 m uncertainty floor and rounds up to 0.1 m', () => {
    expect(uncertaintyFor(1.414)).toBe(5);
    expect(uncertaintyFor(5)).toBe(5);
    expect(uncertaintyFor(5.0000000001)).toBe(5);
    expect(uncertaintyFor(5.01)).toBe(5.1);
    expect(uncertaintyFor(6)).toBe(6);
    expect(uncertaintyFor(6.1234)).toBe(6.2);
    // The radius and the floor agree on a small polygon: max(5, sqrt(2)).
    const result = representativePoint([square(0, 0, 2)]);
    expect(result.radius_m).toBeCloseTo(Math.SQRT2, 12);
    expect(uncertaintyFor(result.radius_m)).toBe(5);
  });
});

describe('S03 positions: digest and public receipt (synthetic only)', () => {
  const facts = (): PositionsDigestFacts => ({ policy_version: S03_POSITIONS_POLICY, tool_input_sha256: 'a'.repeat(64), zip_sha256: 'b'.repeat(64),
    station_json_sha256: 'c'.repeat(64), pois_json_sha256: 'd'.repeat(64), entity_source_sha256: 'e'.repeat(64),
    floor_mapping_sha256: POSITIONS_FLOOR_MAPPING_SHA256() });
  it('names the run from policy, tool, ZIP, station.json, pois.json, entity source and floor mapping', () => {
    const base = positionsIdentity(facts());
    expect(base.run_id).toMatch(/^positions-[0-9a-f]{20}$/);
    expect(positionsIdentity(facts()).digest).toBe(base.digest);
    // A changed floor mapping, pois.json or station.json changes the digest.
    const movedMapping = floorMappingSha256(Object.entries(S03_FLOOR_ORDINALS).map(([id, ordinal]) => ({ id, ordinal })).map(floor => floor.id === 'B1F' ? { ...floor, ordinal: -2 } : floor));
    expect(positionsIdentity({ ...facts(), floor_mapping_sha256: movedMapping }).digest).not.toBe(base.digest);
    expect(positionsIdentity({ ...facts(), pois_json_sha256: 'f'.repeat(64) }).digest).not.toBe(base.digest);
    expect(positionsIdentity({ ...facts(), station_json_sha256: 'f'.repeat(64) }).digest).not.toBe(base.digest);
    expect(positionsIdentity({ ...facts(), policy_version: 's03-positions-v2' }).digest).not.toBe(base.digest);
  });
  it('carries counts, methods and the uncertainty distribution but no coordinate, name or source id', () => {
    const pointed: PointedPosition[] = [
      { poi_id: 'poi:synth-ticket_gate:1', s03_entity_id: 1000, category: 'ticket_gate', level_id: 11, level_label: 'B1F', floor_ordinal: -1,
        lon: 139.7001234, lat: 35.6905678, east_m: 12.5, north_m: -3.25, radius_m: 7.5, uncertainty_m: 7.5, method: 'area_weighted_centroid', part_count: 1, vertex_count: 5 },
      { poi_id: 'poi:synth-transfer:1', s03_entity_id: 1001, category: 'transfer', level_id: 11, level_label: 'B1F', floor_ordinal: -1,
        lon: 139.7002, lat: 35.6906, east_m: 18, north_m: -2, radius_m: 3, uncertainty_m: 5, method: 'largest_part_closest_point', part_count: 2, vertex_count: 10 },
    ];
    const receipt = buildPositionsReceipt({ digest_inputs: facts(), digest: positionsIdentity(facts()).digest, run_id: positionsIdentity(facts()).run_id,
      publish_gate: 'CONDITIONAL', zip_sha256: 'b'.repeat(64), pointed, unpointed: [{ reason: 'SOURCE_DEFECT_HOLE_OUTSIDE_SHELL' }],
      platform_count: 19, s03_poi_count: 45,
      inputs: [{ role: 'station', path: 'stations/synth/station.json', sha256: 'c'.repeat(64) }],
      private_output: { path: 'out/s03/positions-x.json', sha256: 'f'.repeat(64), bytes: 10 } });
    expect(receipt.counts).toEqual({ candidates: 3, pointed: 2, unpointed: 1, platforms_skipped: 19, s03_citing_pois: 45 });
    expect(receipt.unpointed).toEqual([{ reason: 'SOURCE_DEFECT_HOLE_OUTSIDE_SHELL', count: 1 }]);
    expect(receipt.methods).toEqual([{ method: 'area_weighted_centroid', count: 1 }, { method: 'largest_part_closest_point', count: 1 }]);
    expect(receipt.uncertainty_m).toMatchObject({ count: 2, min: 5, median: 6.25, p90: 7.25, max: 7.5 });
    expect(receipt.floor_counts).toEqual([{ floor_ordinal: -1, pointed: 2 }]);
    expect(receipt.label).toBe('approximate (±max(5 m, polygon radius))');
    expect(receipt.navigation_use).toBe('NOT_FOR_ROUTING');
    const text = JSON.stringify(receipt);
    for (const leaked of [String(pointed[0]!.lon), String(pointed[0]!.lat), String(pointed[0]!.east_m), String(pointed[0]!.north_m),
      'poi:synth', 's03_entity_id', 'B1F', 'level_label']) expect(text).not.toContain(leaked);
    expect(receipt).not.toHaveProperty('positions');
  });
  it('round-trips a station ENU position through lon/lat within a micrometre', () => {
    const origin = { lat: 35.6905, lon: 139.7004 }, frame = stationEnuProjector({ ...origin, hM: 0 });
    for (const [east, north] of [[0, 0], [25, -12], [-80, 45]] as const) {
      const { lat, lon } = enuToGeodetic(origin, east, north), back = frame(lat, lon, 0);
      expect(Math.hypot(back[0] - east, back[1] - north)).toBeLessThan(1e-4);
    }
  });
});
