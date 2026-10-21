import { describe, expect, it } from 'vitest';
import { geoJsonDeclaredCrs, inspectGeoJsonFeatures } from '../src/network.js';
import { bboxRelation, inventoryJson } from '../src/poi.js';
import { geometriesBbox, hasOverridingCrs, isIncompleteBboxStatus } from '../src/geo-bbox.js';
import { crsName, geographicCrs } from '../src/crs-declaration.js';

// SYNTHETIC geometry only. Each case is a regression: the pre-hardening code accepted the input as a complete,
// geographic bbox or CRS, which would let a vintage/overlap comparison report DISJOINT instead of UNKNOWN.
const SRC = { source_id: 'synthetic-hardening', sha256: 'synthetic-hash' };
const name = (value: unknown) => ({ type: 'name', properties: { name: value } });
const network = (extra: Record<string, unknown> = {}) => [
  { type: 'Feature', properties: { node_id: 'a' }, geometry: { type: 'Point', coordinates: [139.7, 35.6] } },
  { type: 'Feature', properties: { node_id: 'b' }, geometry: { type: 'Point', coordinates: [139.71, 35.6] } },
  { type: 'Feature', properties: { link_id: 'l', start_node_id: 'a', end_node_id: 'b' }, geometry: { type: 'LineString', coordinates: [[139.7, 35.6], [139.71, 35.6]] }, ...extra },
];
const inspect = (crs: unknown, features: any[] = network()) => inspectGeoJsonFeatures(features, SRC, crs, 'synthetic.geojson', 'network') as any;
const point = (coordinates: unknown, extra: Record<string, unknown> = {}) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates }, ...extra });

describe('GeoJSON CRS declarations', () => {
  it('(a) a linked crs carrying properties.name EPSG:6668 never selects an endpoint-distance method', () => {
    const linked = { type: 'link', properties: { name: 'EPSG:6668', href: 'https://example.invalid/crs.json', type: 'proj4' } };
    expect(crsName(linked)).toBeNull();
    for (const declaration of [linked, { type: 'link', properties: { name: 'EPSG:6668' } }, { type: 'name', properties: { name: 'EPSG:6668', href: 'https://example.invalid/x' } }, name(6668)]) {
      const report = inspect(declaration);
      expect(report.topology.geometry_endpoint_distance_method).toBeNull();
      expect(report.topology.geometry_endpoint_check_status).toBe('UNKNOWN_UNSUPPORTED_CRS');
      expect(report.topology.geometry_endpoint_mismatches_over_0_5m).toBeNull();
    }
    expect(inspect(name('EPSG:6668')).topology.geometry_endpoint_distance_method).toBe('GEOGRAPHIC_DEGREES_APPROX_METRES');
    expect(geographicCrs('EPSG:6668')).toBe(true);
    expect(geographicCrs('EPSG:6677')).toBe(false);
  });

  it('(b) an explicit "crs": null is UNKNOWN, not the RFC 7946 CRS84 assumption; an absent member stays the assumption', () => {
    const explicit = geoJsonDeclaredCrs({ type: 'FeatureCollection', crs: null, features: [] }) as any;
    expect(explicit).toMatchObject({ value: null, status: 'UNKNOWN' });
    const report = inspect(explicit);
    expect(report.crs.status).toBe('UNKNOWN');
    expect(report.topology.geometry_endpoint_distance_method).toBeNull();
    expect(geoJsonDeclaredCrs({ type: 'FeatureCollection', features: [] })).toBeNull();
    expect(inspect(geoJsonDeclaredCrs({ type: 'FeatureCollection', features: [] })).crs.status).toBe('ASSUMPTION');
    const declared = name('EPSG:6668');
    expect(geoJsonDeclaredCrs({ crs: declared })).toBe(declared);
  });

  it('(c) a feature-level or geometry-level crs (for example EPSG:6677) withholds the bbox and the distance method', () => {
    const projected = { type: 'name', properties: { name: 'EPSG:6677' } };
    const feature = [point([1, 2], { crs: projected })];
    expect(hasOverridingCrs(feature)).toBe(true);
    const report = inspect(name('EPSG:6668'), feature);
    expect(report).toMatchObject({ bbox: null, bbox_status: 'INCOMPLETE_OVERRIDING_CRS' });
    expect(inspect(name('EPSG:6668'), network({ crs: projected })).topology.geometry_endpoint_distance_method).toBeNull();
    const geometryLevel = [{ type: 'Feature', properties: {}, geometry: { type: 'Point', crs: projected, coordinates: [1, 2] } }];
    expect(inspect(name('EPSG:6668'), geometryLevel)).toMatchObject({ bbox: null, bbox_status: 'INCOMPLETE_OVERRIDING_CRS' });
    // The POI inventory never yields a numeric bbox for it either, so no relation can be computed.
    const poi = inventoryJson({ type: 'FeatureCollection', features: feature }, 'overriding.geojson') as any;
    expect(poi).toMatchObject({ bbox: null, bbox_status: 'INCOMPLETE_OVERRIDING_CRS' });
    expect(bboxRelation(poi.bbox, [139.69, 35.68, 139.71, 35.70])).toBe('UNKNOWN');
  });
});

describe('strict bounded GeoJSON bbox', () => {
  const geometry = (type: string, coordinates: unknown) => ({ type, coordinates });
  it.each([
    ['LineString with a nested position among scalars', 'LineString', [139.7, 35.7, [140, 36]]],
    ['LineString that is a bare position', 'LineString', [139.7, 35.7]],
    ['LineString that is a bare scalar', 'LineString', 35.7],
    ['Point holding a position array', 'Point', [[139.7, 35.7]]],
    ['Point with a non-numeric member', 'Point', [139.7, 35.7, 'x']],
    ['Polygon with ring depth missing', 'Polygon', [[139.7, 35.7], [139.8, 35.8]]],
    ['MultiLineString with too little nesting', 'MultiLineString', [[139.7, 35.7], [139.8, 35.8]]],
    ['MultiPolygon with too little nesting', 'MultiPolygon', [[[139.7, 35.7], [139.8, 35.8]]]],
    ['MultiPoint with too much nesting', 'MultiPoint', [[[139.7, 35.7]]]],
    ['LineString with a null coordinate', 'LineString', [[139.7, null], [139.8, 35.8]]],
    ['missing coordinates', 'Point', undefined],
  ])('(d) %s gives an INCOMPLETE bbox and an UNKNOWN relation', (_label, type, coordinates) => {
    const result = geometriesBbox([geometry('Point', [139.6, 35.6]), geometry(type, coordinates)]);
    expect(result).toMatchObject({ bbox: null, status: 'INCOMPLETE_MALFORMED_GEOMETRY', malformed_geometries: 1 });
    expect(isIncompleteBboxStatus(result.status)).toBe(true);
    const features = [point([139.6, 35.6]), { type: 'Feature', properties: {}, geometry: geometry(type, coordinates) }];
    for (const report of [inspect(name('EPSG:6668'), features), inventoryJson({ type: 'FeatureCollection', features }, 'malformed.geojson') as any]) {
      expect(report.bbox).toBeNull();
      expect(report.bbox_status).toBe('INCOMPLETE_MALFORMED_GEOMETRY');
      expect(bboxRelation(report.bbox, [139.69, 35.68, 139.71, 35.70])).toBe('UNKNOWN');
    }
  });

  it('accepts exactly nested valid coordinates of every supported type, ignoring null geometry', () => {
    const position = [139.7, 35.7, 12];
    const result = geometriesBbox([
      geometry('Point', position), geometry('MultiPoint', [position, [139.8, 35.8]]), geometry('LineString', [position, [139.8, 35.8]]),
      geometry('Polygon', [[position, [139.8, 35.8], [139.8, 35.7], position]]), geometry('MultiLineString', [[position, [139.8, 35.8]]]),
      geometry('MultiPolygon', [[[position, [139.8, 35.8], [139.8, 35.7], position]]]),
      { type: 'GeometryCollection', geometries: [geometry('Point', [139.9, 35.9])] }, null,
    ]);
    expect(result).toMatchObject({ bbox: [139.7, 35.7, 139.9, 35.9], status: 'COMPUTED', malformed_geometries: 0 });
    expect(geometriesBbox([null])).toMatchObject({ bbox: null, status: 'EMPTY' });
  });

  it('(e) a depth or visit cutoff gives an INCOMPLETE/null bbox, never a partial one, and the relation is UNKNOWN', () => {
    let deep: unknown = [139.7, 35.7];
    for (let level = 0; level < 14; level++) deep = [deep];
    expect(geometriesBbox([geometry('Point', deep)])).toMatchObject({ bbox: null, status: 'INCOMPLETE_MALFORMED_GEOMETRY' });
    // An absurd nesting depth neither overflows the stack nor completes.
    let huge: unknown = [139.7, 35.7];
    for (let level = 0; level < 200_000; level++) huge = [huge];
    const hugeFeatures = [point(huge)];
    expect(inspect(name('EPSG:6668'), hugeFeatures)).toMatchObject({ bbox: null, bbox_status: 'INCOMPLETE_MALFORMED_GEOMETRY' });
    expect(inventoryJson({ type: 'FeatureCollection', features: hugeFeatures }, 'huge.geojson')).toMatchObject({ bbox: null, bbox_status: 'INCOMPLETE_MALFORMED_GEOMETRY' });
    // Visit budget: one position over the limit withholds even an otherwise valid bbox.
    const line = geometry('LineString', Array.from({ length: 50 }, (_, index) => [139 + index / 100, 35]));
    expect(geometriesBbox([line], { maxVisits: 1000 })).toMatchObject({ status: 'COMPUTED' });
    const limited = geometriesBbox([line], { maxVisits: 10 });
    expect(limited).toMatchObject({ bbox: null, status: 'INCOMPLETE_LIMIT_REACHED' });
    expect(bboxRelation(limited.bbox, [139.69, 35.68, 139.71, 35.70])).toBe('UNKNOWN');
    // GeometryCollection nesting beyond the bound is a cutoff, not a stack overflow.
    let nested: any = geometry('Point', [139.7, 35.7]);
    for (let level = 0; level < 5000; level++) nested = { type: 'GeometryCollection', geometries: [nested] };
    expect(geometriesBbox([nested])).toMatchObject({ bbox: null, status: 'INCOMPLETE_LIMIT_REACHED' });
    const collectionReport = inventoryJson({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: nested }] }, 'nested.geojson') as any;
    expect(collectionReport).toMatchObject({ bbox: null, bbox_status: 'INCOMPLETE_LIMIT_REACHED' });
  });

  it('keeps unsupported geometry (Path) on the existing POI status', () => {
    const report = inventoryJson({ type: 'FeatureCollection', crs: null, features: [{ geometry: { type: 'Path', coordinates: [[0, 900, 1000], [4]] }, properties: {} }] }, 'path.geojson') as any;
    expect(report).toMatchObject({ bbox: null, bbox_status: 'UNKNOWN_UNSUPPORTED_GEOMETRY', unsupported_geometry_count: 1 });
  });
});
