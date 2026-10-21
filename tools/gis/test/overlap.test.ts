import { describe, expect, it, vi } from 'vitest';
import { buildOverlapReport, projectGeographicBbox, segmentDistance } from '../src/overlap.js';
import * as crs from '../src/crs.js';
import { inspectPoiGeoJson } from '../src/poi.js';
import { catalogCoverage } from '../src/coverage.js';

describe('source bbox overlap reports', () => {
  it('phase 3 finding 4 keeps impossible geographic coordinates UNKNOWN without swapping axes',()=>{
    // SYNTHETIC: declared lon/lat bbox from the review probe, not station data.
    const invalid={layer_id:'synthetic-invalid',layer_role:'hokonavi_network' as const,source_id:'synthetic-invalid',source_crs:'EPSG:6668',source_crs_bbox:[35.7,139.7,35.8,139.8],bbox_axis_order:'longitude,latitude' as const};
    const valid={...invalid,layer_id:'synthetic-valid',source_crs_bbox:[139.7,35.7,139.8,35.8]};
    const report=buildOverlapReport('shinjuku',[invalid,valid]);
    expect(report.layers[0]).toMatchObject({metric_status:'UNKNOWN',bbox_jgd2011_lon_lat:null,bbox_epsg_6677:null,source_crs_bbox:invalid.source_crs_bbox});
    expect(report.layers[0].metric_note).toContain('axes were not swapped');
    expect(report.pairs[0]).toMatchObject({bbox_relation:'UNKNOWN',minimum_separation_m:null});
    expect(()=>projectGeographicBbox(invalid.source_crs_bbox,'longitude,latitude')).toThrow('Invalid geographic bbox');
    expect(()=>projectGeographicBbox([181,35.7,182,35.8],'longitude,latitude')).toThrow('Invalid geographic bbox');
  });

  it('phase 3 finding 4 refuses non-finite projected coordinates as metric evidence',()=>{
    const projection=vi.spyOn(crs,'projectLonLat').mockReturnValue([NaN,Infinity]);
    try{
      const report=buildOverlapReport('shinjuku',[{layer_id:'synthetic-failed-projection',layer_role:'hokonavi_network',source_id:'synthetic',source_crs:'EPSG:6668',source_crs_bbox:[139.7,35.7,139.8,35.8],bbox_axis_order:'longitude,latitude'}]);
      expect(report.layers[0]).toMatchObject({metric_status:'UNKNOWN',bbox_jgd2011_lon_lat:null,bbox_epsg_6677:null});
      expect(report.layers[0].metric_note).toContain('Non-finite');
    }finally{projection.mockRestore();}
  });
  it('projects geographic source envelopes and reports intersection and metric disjoint separation', () => {
    // Hand-written synthetic bboxes near the EPSG:6677 zone IX origin; these are not station data.
    const overlap = buildOverlapReport('shinjuku', [
      { layer_id: 'synthetic-city', layer_role: 'plateau_ubld', source_id: 'synthetic-city', source_crs: 'EPSG:6697', source_crs_bbox: [35.999, 139.832, 36.001, 139.835], bbox_axis_order: 'latitude,longitude' },
      { layer_id: 'synthetic-network', layer_role: 'hokonavi_network', source_id: 'synthetic-network', source_crs: 'EPSG:6668', source_crs_bbox: [139.834, 35.9995, 139.836, 36.0005], bbox_axis_order: 'longitude,latitude' },
      { layer_id: 'synthetic-far', layer_role: 'station_map', source_id: 'synthetic-far', source_crs: 'EPSG:6668', source_crs_bbox: [139.84, 36.002, 139.841, 36.003], bbox_axis_order: 'longitude,latitude' },
    ]);
    expect(overlap.pairs[0]?.bbox_relation).toBe('INTERSECTS');
    expect(overlap.pairs[0]?.minimum_separation_m).toBe(0);
    expect(overlap.pairs[0]?.intersection_bbox_jgd2011_lon_lat).not.toBeNull();
    expect(overlap.pairs[1]?.bbox_relation).toBe('DISJOINT');
    expect(overlap.pairs[1]?.minimum_separation_m).toBeGreaterThan(0);
    expect(overlap.pairs[1]?.intersection_bbox_jgd2011_lon_lat).toBeNull();
    expect(overlap.pairs[1]?.status).toBe('COMPUTED_BBOX_ONLY');
    expect(overlap.interpretation_limit).toContain('does not establish that features coincide');
  });

  it('keeps absent CRS metric comparisons UNKNOWN instead of assuming CSV coordinate semantics', () => {
    const report = buildOverlapReport('ikebukuro', [
      { layer_id: 'synthetic-known', layer_role: 'plateau_ubld', source_id: 'synthetic-known', source_crs: 'EPSG:6697', source_crs_bbox: [35.7, 139.7, 35.71, 139.71], bbox_axis_order: 'latitude,longitude' },
      { layer_id: 'synthetic-unknown', layer_role: 'hokonavi_csv_pair', source_id: 'synthetic-unknown', source_crs: null, source_crs_bbox: [139.7, 35.7, 139.71, 35.71], bbox_axis_order: 'unknown' },
    ]);
    expect(report.layers[1]?.bbox_epsg_6677).toBeNull();
    expect(report.pairs[0]).toMatchObject({ bbox_relation: 'UNKNOWN', minimum_separation_m: null, status: 'UNKNOWN_CRS_OR_BBOX' });
  });

  it('does not silently treat WGS84 CRS84 as the JGD2011 source datum',()=>{
    const report=buildOverlapReport('ikebukuro',[{layer_id:'synthetic-wgs84',layer_role:'hokonavi_network',source_id:'synthetic-wgs84',source_crs:'OGC:CRS84',source_crs_bbox:[139.7,35.7,139.71,35.71],bbox_axis_order:'longitude,latitude'}]);
    expect(report.layers[0].metric_status).toBe('UNKNOWN');
    expect(report.layers[0].bbox_jgd2011_lon_lat).toBeNull();
    expect(Object.hasOwn(report.layers[0],'projected_bbox_boundary_segments')).toBe(false);
  });

  it('respects serialized latitude-longitude order separately from GeoJSON longitude-latitude order', () => {
    const latlon = projectGeographicBbox([35.729, 139.711, 35.730, 139.712], 'latitude,longitude');
    const lonlat = projectGeographicBbox([139.711, 35.729, 139.712, 35.730], 'longitude,latitude');
    expect(latlon).toEqual(lonlat);
  });

  it('computes the known minimum between sampled boundary segments in EPSG:6677 metre units', () => {
    const distance = segmentDistance([[0, 0], [10, 0]], [[0, 3], [10, 3]]);
    expect(distance).toBe(3);
    expect(segmentDistance([[0, 0], [10, 0]], [[10, 0], [10, 5]])).toBe(0);
  });
});

it('propagates inferred CRS to both layer and pair metrics',()=>{
  const common={source_id:'synthetic',source_crs:'EPSG:6668',source_crs_bbox:[139.7,35.7,139.71,35.71],bbox_axis_order:'longitude,latitude' as const};
  const report=buildOverlapReport('ikebukuro',[{...common,layer_id:'a',layer_role:'plateau_ubld'},{...common,layer_id:'b',layer_role:'hokonavi_csv_pair',crs_status:'INFERRED_FROM_SPEC'}]);
  expect(report.layers[1]!.metric_status).toBe('CONDITIONAL_ON_INFERRED_CRS');
  expect(report.pairs[0]!.metric_status).toBe('CONDITIONAL_ON_INFERRED_CRS');
});

it('keeps undeclared POI raw bbox comparisons conditional without inventing datum metrics',()=>{
  const report=buildOverlapReport('shinjuku',[
    {source_id:'city',layer_id:'city',layer_role:'plateau_ubld',source_crs:'EPSG:6697',source_crs_bbox:[35.7,139.7,35.71,139.71],bbox_axis_order:'latitude,longitude'},
    {source_id:'poi',layer_id:'poi',layer_role:'poi_facility',source_crs:null,source_crs_bbox:[139.705,35.705,139.715,35.715],bbox_axis_order:'longitude,latitude',crs_status:'UNDECLARED_RFC7946_ASSUMPTION'},
  ]);
  expect(report.pairs[0]).toMatchObject({bbox_relation:'UNKNOWN',minimum_separation_m:null,conditional_bbox_comparison:{relation:'INTERSECTS',status:'CONDITIONAL_ON_CRS_ASSUMPTION'}});
  expect(report.layers[1]!.bbox_epsg_6677).toBeNull();
});

it('keeps missing, incomplete, and projected POI bboxes incomparable instead of DISJOINT',()=>{
  const city={source_id:'city',layer_id:'city',layer_role:'plateau_ubld' as const,source_crs:'EPSG:6697',source_crs_bbox:[35.7,139.7,35.71,139.71],bbox_axis_order:'latitude,longitude' as const};
  const incomplete={source_id:'poi',layer_id:'poi-incomplete',layer_role:'poi_facility' as const,source_crs:null,source_crs_bbox:[139.7,35.7,139.71,35.71],bbox_axis_order:'longitude,latitude' as const,crs_status:'UNDECLARED_RFC7946_ASSUMPTION',bbox_status:'INCOMPLETE_LIMIT_REACHED'};
  const missing={...incomplete,layer_id:'poi-missing',source_crs_bbox:null,bbox_status:'UNKNOWN'};
  const projected={...incomplete,layer_id:'poi-epsg-6677',source_crs:'EPSG:6677',source_crs_bbox:[1,2,3,4],bbox_axis_order:'longitude,latitude' as const,crs_status:'DECLARED',bbox_status:'UNKNOWN'};
  const report=buildOverlapReport('shinjuku',[city,incomplete,missing,projected]);
  expect(report.pairs.map(pair=>pair.bbox_relation)).toEqual(['UNKNOWN','UNKNOWN','UNKNOWN','UNKNOWN','UNKNOWN','UNKNOWN']);
  expect(report.pairs.every(pair=>pair.minimum_separation_m===null)).toBe(true);
  expect(report.pairs.every(pair=>pair.conditional_bbox_comparison===undefined)).toBe(true);
  expect(report.layers[1]!.metric_note).toContain('incomplete');
  expect(report.layers[3]).toMatchObject({bbox_jgd2011_lon_lat:null,bbox_epsg_6677:null,metric_status:'UNKNOWN'});
});

it('propagates an inspected limit-truncated POI through overlap and coverage as UNKNOWN',()=>{
  const coordinates=Array.from({length:1_000_001},(_,index)=>[139+index/10_000_000,35]);
  const poi=inspectPoiGeoJson('large','a'.repeat(64),'large.geojson',{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'MultiPoint',coordinates}}]}) as any;
  expect(poi).toMatchObject({bbox:null,bbox_status:'INCOMPLETE_LIMIT_REACHED',bbox_counts:{coordinate_visits:1_000_000,coordinate_positions:999_999,visit_limit:1_000_000}});
  const report=buildOverlapReport('shinjuku',[
    {source_id:'city',layer_id:'city',layer_role:'plateau_ubld',source_crs:'EPSG:6697',source_crs_bbox:[35.7,139.7,35.71,139.71],bbox_axis_order:'latitude,longitude'},
    {source_id:'poi',layer_id:'poi',layer_role:'poi_facility',source_crs:null,source_crs_bbox:poi.bbox,bbox_axis_order:'unknown',crs_status:'UNDECLARED_RFC7946_ASSUMPTION',bbox_status:poi.bbox_status},
  ]);
  expect(report.pairs[0]).toMatchObject({bbox_relation:'UNKNOWN',minimum_separation_m:null});
  expect(report.pairs[0]?.conditional_bbox_comparison).toBeUndefined();
  expect(report.layers[1]).toMatchObject({bbox_jgd2011_lon_lat:null,bbox_epsg_6677:null,metric_status:'UNKNOWN'});
  const coverage=catalogCoverage({cities:[]},{source_id:'synthetic',sha256:'synthetic'},[report.layers[1]!],{});
  expect(coverage).toMatchObject({status:'UNKNOWN',any_catalogued_nominal_mesh_touches_hokonavi_bbox_meshes:null,hokonavi_layers:[{bbox:null,third_meshes_touched:[]}]});
  const flaggedCoverage=catalogCoverage({cities:[]},{source_id:'synthetic',sha256:'synthetic'},[{layer_id:'partial',bbox_jgd2011_lon_lat:[139.7,35.7,139.71,35.71],metric_status:'KNOWN',bbox_status:'INCOMPLETE_LIMIT_REACHED'}],{});
  expect(flaggedCoverage).toMatchObject({status:'UNKNOWN',any_catalogued_nominal_mesh_touches_hokonavi_bbox_meshes:null,hokonavi_layers:[{metric_status:'UNKNOWN',bbox:null,third_meshes_touched:[]}]});
});
