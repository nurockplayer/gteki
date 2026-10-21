import { describe, expect, it } from 'vitest';
import { inspectPoiCsv, inspectPoiGeoJson, poiGeoJsonMember, verifyPoiEvidence } from '../src/poi.js';

describe('POI source inspection', () => {
  it.each([
    { type: 'link', properties: { name: 'EPSG:6668', href: 'https://example.invalid/projected.crs' } },
    { properties: { name: 'EPSG:6668' } },
    { type: 'other', properties: { name: 'EPSG:6668' } },
    { type: 'name', properties: { name: 'EPSG:6668', href: 'https://example.invalid/projected.crs' } },
    { type: 'name', properties: { name: ['EPSG:6668'] } },
  ])('withholds geographic fields for linked or malformed CRS: %j', crs => {
    const report = inspectPoiGeoJson('synthetic', 'a'.repeat(64), 'layer.geojson', {
      type: 'FeatureCollection', crs, features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [139.7, 35.7] } }],
    }) as any;
    expect(report.crs_status).toBe('UNKNOWN');
    expect(report.declared_crs).toEqual(crs);
    expect(report.bbox).toBeNull();
    expect(report.observations[0]).toMatchObject({ longitude: null, latitude: null, raw_coordinates: [139.7, 35.7] });
  });

  it('withholds geographic fields for conflicting root and geometry CRS declarations', () => {
    const report = inspectPoiGeoJson('synthetic', 'a'.repeat(64), 'layer.geojson', {
      type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:6677' } },
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', crs: { type: 'name', properties: { name: 'EPSG:6668' } }, coordinates: [139.7, 35.7] } }],
    }) as any;
    expect(report.crs_status).toBe('UNKNOWN');
    expect(report.bbox).toBeNull();
    expect(report.observations[0]).toMatchObject({ longitude: null, latitude: null });
  });

  it('uses only recognized literal CSV coordinate headers and keeps source identities separate', () => {
    const csv = Buffer.from('店舗ID,店舗名,緯度,経度,score\nE27,新宿店,35.69,139.70,99\nE01,西口店,35.69,139.69,100\n');
    const central = inspectPoiCsv('toei-stores-shinjuku-csv', 'a'.repeat(64), csv) as any;
    const west = inspectPoiCsv('toei-stores-shinjuku-nishiguchi-csv', 'b'.repeat(64), csv) as any;
    expect(central.observations[0]).toMatchObject({ source_id: 'toei-stores-shinjuku-csv', native_id: 'E27', latitude: 35.69, longitude: 139.7, verification: 'UNVERIFIED', routable: false });
    expect(west.observations[1]).toMatchObject({ source_id: 'toei-stores-shinjuku-nishiguchi-csv', native_id: 'E01' });
    const unrelated = inspectPoiCsv('other-source', 'c'.repeat(64), csv) as any;
    expect(unrelated.observations.every((row: any) => row.latitude === null && row.longitude === null)).toBe(true);
    expect(unrelated.observations.some((row: any) => row.latitude === 99 || row.longitude === 100)).toBe(false);
  });

  it('preserves duplicate CSV headers and rejects non-decimal coordinate values', () => {
    const csv = Buffer.from('施設名,緯度,緯度,経度,extra\n店,0x23,35.6,139.7,1e2\n');
    const report = inspectPoiCsv('toei-stores-shinjuku-csv', 'f'.repeat(64), csv) as any;
    expect(report.headers).toEqual(['施設名', '緯度', '緯度', '経度', 'extra']);
    expect(report.duplicate_headers).toEqual(['緯度']);
    expect(report.observations[0]).toMatchObject({ name: '店', latitude: null, longitude: 139.7 });
    expect(report.columns[4]).toMatchObject({ header: 'extra', blank_count: 0, distinct_values: { values: { '1e2': 1 } } });
  });

  it('ignores inherited feature, CRS, coordinate, and property fields', () => {
    const inheritedProperties = { name: 'inherited name', id: 'inherited-id', operator: 'inherited operator' };
    const inheritedGeometry = { coordinates: [139.7, 35.69] };
    const feature = Object.assign(Object.create({ properties: inheritedProperties }), {
      geometry: Object.assign(Object.create(inheritedGeometry), { type: 'Point' }),
    });
    const parsed = Object.assign(Object.create({ crs: { properties: { name: 'EPSG:4326' } } as any }), {
      type: 'FeatureCollection', features: [feature],
    });
    const report = inspectPoiGeoJson('tokyo-shinjuku-facilities-zip', 'd'.repeat(64), 'features.geojson', parsed) as any;
    expect(report.crs.properties.name).toBeNull();
    expect(report.bbox).toBeNull();
    expect(report.observations).toEqual([]);
    expect(report.crs_interpretation).toContain('RFC7946');
  });

  it('preserves numeric GeoJSON points as unverified observations without deriving place names', () => {
    const report = inspectPoiGeoJson('plateau-13104-related-2025', 'e'.repeat(64), 'related.geojson', {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { station_name: 'Shinjuku', station_id: 'S01' }, geometry: { type: 'Point', coordinates: [139.7, 35.69] } }],
    }) as any;
    expect(report.observations[0]).toMatchObject({ source_id: 'plateau-13104-related-2025', source_sha256: 'e'.repeat(64), native_id: null, name: null, raw_coordinates: [139.7, 35.69], coordinate_reference: { name: null, status: 'RFC7946_ASSUMPTION' }, longitude: 139.7, latitude: 35.69, verification: 'UNVERIFIED', routable: false });
    expect(report.topology).toBeUndefined();
    expect(report.candidate_edges).toEqual([]);
  });

  it('retains projected EPSG:6677 and S03 local coordinates without treating them as lon/lat', () => {
    const feature = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2, 12] } };
    const projected = inspectPoiGeoJson('projected', 'a'.repeat(64), 'projected.geojson', {
      type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:6677' } }, features: [feature],
    }) as any;
    expect(projected.observations[0]).toMatchObject({ raw_coordinates: [1, 2, 12], coordinate_reference: { name: 'EPSG:6677', status: 'UNSUPPORTED_DECLARED_CRS' }, longitude: null, latitude: null });
    expect(projected.bbox).toBeNull();
    expect(projected.raw_coordinates_bbox).toEqual([1, 2, 1, 2]);

    const local = inspectPoiGeoJson('s03', 'b'.repeat(64), 'path-level-geom-001.geojson', { type: 'FeatureCollection', features: [feature] }) as any;
    expect(local.observations[0]).toMatchObject({ raw_coordinates: [1, 2, 12], coordinate_reference: { name: null, status: 'LOCAL_COORDINATES' }, longitude: null, latitude: null });
    expect(local.bbox).toBeNull();
  });

  it('accepts only exact recognized geographic CRS identifiers', () => {
    for (const name of ['garbageEPSG:4326', 'https://evil.example/def/crs/epsg/0/4326']) {
      const report = inspectPoiGeoJson('crs', 'c'.repeat(64), 'layer.geojson', { type: 'FeatureCollection', crs: { type: 'name', properties: { name } }, features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } }] }) as any;
      expect(report.observations[0]).toMatchObject({ coordinate_reference: { name, status: 'UNSUPPORTED_DECLARED_CRS' }, longitude: null, latitude: null });
      expect(report.bbox).toBeNull();
    }
    const report = inspectPoiGeoJson('crs', 'd'.repeat(64), 'layer.geojson', { type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'http://www.opengis.net/def/crs/EPSG/0/4326' } }, features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } }] }) as any;
    expect(report.observations[0]).toMatchObject({ coordinate_reference: { status: 'DECLARED' }, longitude: 1, latitude: 2 });
  });

  it('honors GeoJSON 2008 feature CRS and treats an explicit null CRS as unknown', () => {
    const projected = inspectPoiGeoJson('crs', 'a'.repeat(64), 'layer.geojson', {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: {},
        geometry: { type: 'Point', crs: { type: 'name', properties: { name: 'EPSG:6677' } }, coordinates: [1, 2] },
      }],
    }) as any;
    expect(projected.observations[0]).toMatchObject({
      raw_coordinates: [1, 2], coordinate_reference: { name: 'EPSG:6677', status: 'UNSUPPORTED_DECLARED_CRS' }, longitude: null, latitude: null,
    });
    expect(projected.bbox).toBeNull();

    const unknown = inspectPoiGeoJson('crs', 'b'.repeat(64), 'layer.geojson', {
      type: 'FeatureCollection', crs: null,
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } }],
    }) as any;
    expect(unknown.observations[0]).toMatchObject({ coordinate_reference: { name: null }, longitude: null, latitude: null });
    expect(unknown.observations[0].coordinate_reference.status).toBe('UNKNOWN');
    expect(unknown.bbox).toBeNull();
    expect(unknown.crs_status).toBe('UNKNOWN');
  });

  it('marks mixed effective feature CRSs and withholds a layer bbox', () => {
    const report = inspectPoiGeoJson('crs', 'c'.repeat(64), 'layer.geojson', {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', crs: { type: 'name', properties: { name: 'EPSG:4326' } }, properties: {}, geometry: { type: 'Point', coordinates: [139.7, 35.7] } },
        { type: 'Feature', crs: { type: 'name', properties: { name: 'EPSG:6677' } }, properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } },
      ],
    }) as any;
    expect(report.observations.map((row: any) => row.coordinate_reference.status)).toEqual(['DECLARED', 'UNSUPPORTED_DECLARED_CRS']);
    expect(report.observations.every((row: any) => row.longitude === null && row.latitude === null)).toBe(true);
    expect(report.crs_status).toBe('MIXED');
    expect(report.bbox).toBeNull();
  });

  it('resolves nested geometry CRS overrides and withholds lon/lat for mixed geographic CRS', () => {
    const nested = inspectPoiGeoJson('nested-crs', 'f'.repeat(64), 'nested.geojson', {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: {
        type: 'GeometryCollection', geometries: [
          { type: 'Point', crs: { type: 'name', properties: { name: 'EPSG:6668' } }, coordinates: [139, 35] },
          { type: 'Point', crs: { type: 'name', properties: { name: 'EPSG:6677' } }, coordinates: [1, 2] },
        ],
      } }],
    }) as any;
    expect(nested.crs_status).toBe('MIXED');
    expect(nested.bbox).toBeNull();

    const geographic = inspectPoiGeoJson('mixed-geographic', 'a'.repeat(64), 'mixed.geojson', {
      type: 'FeatureCollection', features: [
        { type: 'Feature', crs: { type: 'name', properties: { name: 'EPSG:6668' } }, properties: {}, geometry: { type: 'Point', coordinates: [139, 35] } },
        { type: 'Feature', crs: { type: 'name', properties: { name: 'EPSG:4326' } }, properties: {}, geometry: { type: 'Point', coordinates: [140, 36] } },
      ],
    }) as any;
    expect(geographic.crs_status).toBe('MIXED');
    expect(geographic.bbox).toBeNull();
    expect(geographic.observations.every((row: any) => row.longitude === null && row.latitude === null)).toBe(true);
  });

  it('treats invalid feature geometry as incomplete while allowing null geometry', () => {
    const invalid = inspectPoiGeoJson('invalid-geometry', 'b'.repeat(64), 'invalid.geojson', {
      type: 'FeatureCollection', features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [139.7, 35.7] } },
        { type: 'Feature', properties: {} },
      ],
    }) as any;
    expect(invalid.bbox).toBeNull();
    expect(invalid.bbox_status).toBe('INCOMPLETE_LIMIT_REACHED');

    const absent = inspectPoiGeoJson('null-geometry', 'c'.repeat(64), 'null.geojson', {
      type: 'FeatureCollection', features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [139.7, 35.7] } },
        { type: 'Feature', properties: {}, geometry: null },
      ],
    }) as any;
    expect(absent.bbox).toEqual([139.7, 35.7, 139.7, 35.7]);
    expect(absent.bbox_status).toBe('COMPUTED_GEOGRAPHIC');
  });

  it('marks depth and unsupported geometry traversal as incomplete for bbox purposes', () => {
    let nested: unknown = [139.7, 35.7];
    for (let index = 0; index < 14; index++) nested = [nested];
    const deep = inspectPoiGeoJson('depth', 'd'.repeat(64), 'deep.geojson', {
      type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: nested } }],
    }) as any;
    expect(deep.bbox).toBeNull();
    expect(deep.bbox_status).toBe('INCOMPLETE_LIMIT_REACHED');

    const unsupported = inspectPoiGeoJson('unsupported', 'e'.repeat(64), 'unsupported.geojson', {
      type: 'FeatureCollection', features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [139.7, 35.7] } },
        { type: 'Feature', properties: {}, geometry: { type: 'CircularString', coordinates: [[139.6, 35.6], [139.8, 35.8]] } },
      ],
    }) as any;
    expect(unsupported.bbox).toBeNull();
    expect(unsupported.bbox_status).toBe('INCOMPLETE_LIMIT_REACHED');
  });

  it('preserves bbox counts in a ZIP GeoJSON member summary', () => {
    const geo = inspectPoiGeoJson('member', 'e'.repeat(64), 'member.geojson', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [139.7, 35.7] } }] }) as any;
    const member = poiGeoJsonMember('member.geojson', 42, geo) as any;
    expect(member).toMatchObject({ kind: 'GEOJSON', bbox_counts: { coordinate_visits: 1, coordinate_positions: 1, visit_limit: 1_000_000 }, bbox_status: 'COMPUTED_GEOGRAPHIC' });
  });

  it('rejects geographic coordinates outside longitude and latitude ranges', () => {
    const report = inspectPoiGeoJson('bad-range', 'c'.repeat(64), 'bad.geojson', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [181, 35] } }] }) as any;
    expect(report.observations[0]).toMatchObject({ raw_coordinates: [181, 35], longitude: null, latitude: null });
    expect(report.bbox).toBeNull();
  });

  it('keeps recognized geographic CRS coordinates raw when either axis is outside its valid range', () => {
    const report = inspectPoiGeoJson('declared-bad-range', 'd'.repeat(64), 'bad.geojson', {
      type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:4326' } },
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [139, 91] } }],
    }) as any;
    expect(report.observations[0]).toMatchObject({
      raw_coordinates: [139, 91], coordinate_reference: { name: 'EPSG:4326', status: 'DECLARED' }, longitude: null, latitude: null,
    });
    expect(report.bbox).toBeNull();
  });

  it('rejects literal-value artifact pointers that escape the report directory', async () => {
    const result = await verifyPoiEvidence({
      source_id: 'plateau-13104-related-2025', source_sha256: 'a'.repeat(64),
      literal_values_artifact: { store_path: '../outside.json', sha256: 'b'.repeat(64), bytes: 10, tables: 0 },
    });
    expect(result.status).toBe('FAIL');
    expect(result.errors[0]).toContain('unsafe path');
  });

  it('retains boolean property literals and refuses to infer candidates from missing endpoint IDs',()=>{
    const report=inspectPoiGeoJson('tokyo-shinjuku-facilities-zip','a'.repeat(64),'layer.geojson',{
      type:'FeatureCollection',features:[{type:'Feature',properties:{line_id:'literal',from_node_id:'',to_node_id:'end',nonphysical:false},geometry:{type:'LineString',coordinates:[[139.7,35.6],[139.71,35.61]]}}]
    }) as any;
    expect(report.property_keys).toContain('nonphysical');
    expect(report.literal_field_distributions.nonphysical).toMatchObject({blank_count:0,distinct_values:{values:{false:1}}});
    expect(report.candidate_edges).toEqual([]);
    expect(report.crs_interpretation).toContain('assumption');
  });
});
