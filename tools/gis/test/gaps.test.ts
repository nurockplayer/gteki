import { expect, it } from 'vitest';
import { overlapHolds } from '../src/gaps.js';
import { buildOverlapReport, type BboxLayerInput } from '../src/overlap.js';

// SYNTHETIC bboxes written by hand; no station geometry or source coordinates.
const plateau: BboxLayerInput = {layer_id:'synthetic-plateau',layer_role:'plateau_ubld',source_id:'synthetic-plateau',source_crs:'EPSG:6697',source_crs_bbox:[35.7,139.7,35.71,139.71],bbox_axis_order:'latitude,longitude'};
const network: BboxLayerInput = {layer_id:'synthetic-network',layer_role:'hokonavi_network',source_id:'synthetic-network',source_crs:'EPSG:6668',source_crs_bbox:[139.7,35.6,139.71,35.61],bbox_axis_order:'longitude,latitude'};

it('B emits a geometry/graph pairing HOLD from computed disjoint source bboxes', () => {
  const report = buildOverlapReport('shinjuku',[plateau,network]);
  expect(report.pairs[0].bbox_relation).toBe('DISJOINT');
  expect(overlapHolds(report)[0]).toContain('only acquired PLATEAU underground file does not spatially cover');
});

it('B keeps incomplete bbox evidence UNKNOWN and never turns an intersection into connectivity', () => {
  const unknown=buildOverlapReport('ikebukuro',[plateau,{...network,source_crs:null,bbox_axis_order:'unknown'}]);
  expect(overlapHolds(unknown)[0]).toContain('UNKNOWN');
  const overlapping=buildOverlapReport('shinjuku',[plateau,{...network,source_crs_bbox:[139.7,35.7,139.71,35.71]}]);
  expect(overlapping.pairs[0].bbox_relation).toBe('INTERSECTS');
  expect(overlapHolds(overlapping)[0]).toContain('envelope overlap only');
});

it('keeps coordinate-limit-truncated POI evidence non-comparable in gap decisions', () => {
  const incompletePoi: BboxLayerInput = {
    source_id: 'synthetic-poi', layer_id: 'synthetic-poi', layer_role: 'poi_facility', source_crs: null,
    source_crs_bbox: [139.7, 35.7, 139.71, 35.71], bbox_axis_order: 'longitude,latitude',
    crs_status: 'UNDECLARED_RFC7946_ASSUMPTION', bbox_status: 'INCOMPLETE_LIMIT_REACHED',
  };
  const report = buildOverlapReport('shinjuku', [plateau, network, incompletePoi]);
  expect(report.pairs.filter(pair => pair.layer_a === 'synthetic-plateau' || pair.layer_b === 'synthetic-plateau')
    .map(pair => pair.bbox_relation)).toEqual(['DISJOINT', 'UNKNOWN']);
  expect(overlapHolds(report)[0]).toContain('UNKNOWN');
  expect(overlapHolds(report)[0]).not.toContain('every compared source-layer bbox is disjoint');
});
