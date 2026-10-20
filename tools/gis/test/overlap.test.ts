import { describe, expect, it, vi } from 'vitest';
import { buildOverlapReport, projectGeographicBbox, segmentDistance } from '../src/overlap.js';
import * as crs from '../src/crs.js';

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
