import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { docsRoot, readJson, writeJson, getStoredSource } from './common.js';
import { projectLonLat } from './crs.js';
import { catalogCoverage,r1BboxContainment } from './coverage.js';
import { toolFingerprint } from './provenance.js';
import { r1GeoEvidence } from './r1.js';
import { crsName } from './crs-declaration.js';
import { assertNetworkInspectionCurrent } from './network-evidence.js';
import { assertPoiInspectionCurrent, assertVintageResearchCurrent } from './inspection-evidence.js';

export type BboxLayerInput = {
  layer_id: string;
  layer_role: 'plateau_ubld' | 'hokonavi_network' | 'hokonavi_csv_pair' | 'station_map' | 'poi_facility';
  source_id: string;
  source_ids?: string[];
  source_crs: string | null;
  source_crs_bbox: number[] | null;
  bbox_axis_order: 'latitude,longitude' | 'longitude,latitude' | 'unknown';
  feature_count?: number | null;
  crs_status?: string;
  bbox_status?: string;
};

export type OverlapLayer = BboxLayerInput & {
  /** Normalized shared horizontal JGD2011 longitude,latitude bbox for source-level relation tests. */
  bbox_jgd2011_lon_lat: [number, number, number, number] | null;
  bbox_epsg_6677: [number, number, number, number] | null;
  metric_status: 'KNOWN' | 'UNKNOWN' | 'CONDITIONAL_ON_INFERRED_CRS';
  metric_note: string | null;
};

type PreparedOverlapLayer = OverlapLayer & {
  /** Transient calculation data; omitted from the small persisted metadata report. */
  projected_bbox_boundary_segments: Array<[[number, number], [number, number]]> | null;
};

export type OverlapPair = {
  layer_a: string;
  layer_b: string;
  source_id_a: string;
  source_id_b: string;
  bbox_relation: 'INTERSECTS' | 'DISJOINT' | 'UNKNOWN';
  /** Intersection in shared JGD2011 geographic lon,lat order. */
  intersection_bbox_jgd2011_lon_lat: [number, number, number, number] | null;
  /** Approximate boundary-to-boundary distance using projected bbox edges sampled at 32 segments per edge. */
  minimum_separation_m: number | null;
  status: 'COMPUTED_BBOX_ONLY' | 'UNKNOWN_CRS_OR_BBOX';
  metric_status?: 'KNOWN' | 'UNKNOWN' | 'CONDITIONAL_ON_INFERRED_CRS';
  conditional_bbox_comparison?: { relation: 'INTERSECTS' | 'DISJOINT'; status: 'CONDITIONAL_ON_CRS_ASSUMPTION'; assumption: string };
};

export type StationOverlapReport = {
  station_id: 'ikebukuro' | 'shinjuku';
  method: string;
  layers: OverlapLayer[];
  pairs: OverlapPair[];
  interpretation_limit: string;
  verification: 'UNVERIFIED';
  tool_input_sha256?: string;
  input_sources?: Array<{source_id:string;sha256:string}>;
  mesh_coverage?: ReturnType<typeof catalogCoverage>;
  r1_bbox_containment?: ReturnType<typeof r1BboxContainment>;
  bounded_vintage_research?: { report:string;status:string;comparison:unknown;byte_totals:unknown };
};

const LIMIT = 'BBox overlap only. It does not establish that features coincide, share a floor, or connect; it is not routing evidence.';

function validBbox(bbox: number[] | null): bbox is [number, number, number, number] {
  return bbox !== null && bbox.length === 4 && bbox.every(Number.isFinite) && bbox[0]! <= bbox[2]! && bbox[1]! <= bbox[3]!;
}

function normalizeGeographicBbox(bbox: number[], axis: 'latitude,longitude' | 'longitude,latitude'): [number, number, number, number] {
  if (!validBbox(bbox)) throw new Error(`Invalid geographic bbox: ${bbox}`);
  const [xMin, yMin, xMax, yMax] = bbox;
  const normalized: [number,number,number,number] = axis === 'latitude,longitude' ? [yMin!, xMin!, yMax!, xMax!] : [xMin!, yMin!, xMax!, yMax!];
  assertGeographicRanges(normalized);
  return normalized;
}

function assertGeographicRanges(bbox: [number,number,number,number]): void {
  if (bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90)
    throw new Error('Invalid geographic bbox: longitude must be within [-180,180] and latitude within [-90,90]; axes were not swapped');
}

export function projectedGeographicBoundarySegments(lonLatBbox: [number, number, number, number], steps = 32): Array<[[number, number], [number, number]]> {
  if (!validBbox(lonLatBbox) || !Number.isInteger(steps) || steps < 1) throw new Error('Invalid geographic bbox or edge sampling count');
  assertGeographicRanges(lonLatBbox);
  const [minLon, minLat, maxLon, maxLat] = lonLatBbox;
  const lonLatPoints: Array<[number, number]> = [];
  const interpolate = (a: number, b: number, i: number) => a + (b - a) * i / steps;
  // Walk the closed source rectangle in order; each edge receives exactly `steps` segments.
  for (let i = 0; i < steps; i++) lonLatPoints.push([interpolate(minLon!, maxLon!, i), minLat!]);
  for (let i = 0; i < steps; i++) lonLatPoints.push([maxLon!, interpolate(minLat!, maxLat!, i)]);
  for (let i = 0; i < steps; i++) lonLatPoints.push([interpolate(maxLon!, minLon!, i), maxLat!]);
  for (let i = 0; i < steps; i++) lonLatPoints.push([minLon!, interpolate(maxLat!, minLat!, i)]);
  const projected = lonLatPoints.map(point => {
    const result=projectLonLat(point);
    if (result.length!==2 || !result.every(Number.isFinite)) throw new Error('Non-finite EPSG:6677 projection result');
    return result;
  });
  return projected.map((point, index) => [point, projected[(index + 1) % projected.length]!] as [[number, number], [number, number]]);
}

/** Convert a geographic bbox into its sampled projected axis-aligned context envelope. */
export function projectGeographicBbox(bbox: number[], axis: 'latitude,longitude' | 'longitude,latitude'): [number, number, number, number] {
  const normalized = normalizeGeographicBbox(bbox, axis);
  const projected = projectedGeographicBoundarySegments(normalized).flatMap(([a, b]) => [a, b]);
  return [Math.min(...projected.map(p => p[0])), Math.min(...projected.map(p => p[1])), Math.max(...projected.map(p => p[0])), Math.max(...projected.map(p => p[1]))];
}

/** Any INCOMPLETE_* bbox status (limit reached, malformed coordinates) withholds the metric. */
export function isIncompleteBboxStatus(status: string | undefined | null): boolean { return typeof status === 'string' && status.startsWith('INCOMPLETE_'); }

function prepareLayer(layer: BboxLayerInput): PreparedOverlapLayer {
  if (isIncompleteBboxStatus(layer.bbox_status)) return { ...layer, bbox_jgd2011_lon_lat: null, bbox_epsg_6677: null, projected_bbox_boundary_segments: null, metric_status: 'UNKNOWN', metric_note: 'Source bbox is incomplete because its coordinate visit limit was reached or its coordinates were malformed.' };
  if (!validBbox(layer.source_crs_bbox)) return { ...layer, bbox_jgd2011_lon_lat: null, bbox_epsg_6677: null, projected_bbox_boundary_segments: null, metric_status: 'UNKNOWN', metric_note: 'Source bbox missing or invalid.' };
  if (layer.bbox_axis_order === 'unknown' || !layer.source_crs) return { ...layer, bbox_jgd2011_lon_lat: null, bbox_epsg_6677: null, projected_bbox_boundary_segments: null, metric_status: 'UNKNOWN', metric_note: 'Source CRS or coordinate axis order is unknown; no metric projection was inferred.' };
  const crs = layer.source_crs.toUpperCase();
  if (crs !== 'EPSG:6697' && crs !== 'HTTP://WWW.OPENGIS.NET/DEF/CRS/EPSG/0/6697' && crs !== 'EPSG:6668')
    return { ...layer, bbox_jgd2011_lon_lat: null, bbox_epsg_6677: null, projected_bbox_boundary_segments: null, metric_status: 'UNKNOWN', metric_note: `Unsupported source CRS ${layer.source_crs}; metric projection was not inferred.` };
  let geographic: [number,number,number,number],segments: Array<[[number,number],[number,number]]>;
  try {
    geographic = normalizeGeographicBbox(layer.source_crs_bbox, layer.bbox_axis_order);
    segments = projectedGeographicBoundarySegments(geographic, 32);
  } catch (error) {
    return { ...layer,bbox_jgd2011_lon_lat:null,bbox_epsg_6677:null,projected_bbox_boundary_segments:null,metric_status:'UNKNOWN',metric_note:error instanceof Error?error.message:String(error) };
  }
  const points = segments.flatMap(([a, b]) => [a, b]);
  const projected: [number, number, number, number] = [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
  return { ...layer, bbox_jgd2011_lon_lat: geographic, bbox_epsg_6677: projected, projected_bbox_boundary_segments: segments, metric_status: layer.crs_status==='INFERRED_FROM_SPEC'?'CONDITIONAL_ON_INFERRED_CRS':'KNOWN', metric_note: (layer.crs_status==='INFERRED_FROM_SPEC'?'CONDITIONAL on inferred CRS. ':'')+'Source geographic bbox normalized to JGD2011 lon,lat; edges sampled at 32 segments per edge and projected to EPSG:6677.' };
}

function pointSegmentDistance(point: [number, number], start: [number, number], end: [number, number]): number {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

function orientation(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** Minimum Euclidean distance between two 2D line segments in metres. */
export function segmentDistance(a: [[number, number], [number, number]], b: [[number, number], [number, number]]): number {
  const [a0, a1] = a, [b0, b1] = b;
  const o1 = orientation(a0, a1, b0), o2 = orientation(a0, a1, b1), o3 = orientation(b0, b1, a0), o4 = orientation(b0, b1, a1);
  const onSegment = (p: [number, number], q: [number, number], r: [number, number]) => q[0] >= Math.min(p[0], r[0]) && q[0] <= Math.max(p[0], r[0]) && q[1] >= Math.min(p[1], r[1]) && q[1] <= Math.max(p[1], r[1]);
  if ((o1 === 0 && onSegment(a0, b0, a1)) || (o2 === 0 && onSegment(a0, b1, a1)) || (o3 === 0 && onSegment(b0, a0, b1)) || (o4 === 0 && onSegment(b0, a1, b1)) || (o1 * o2 < 0 && o3 * o4 < 0)) return 0;
  return Math.min(pointSegmentDistance(a0, b0, b1), pointSegmentDistance(a1, b0, b1), pointSegmentDistance(b0, a0, a1), pointSegmentDistance(b1, a0, a1));
}

function boundaryDistance(a: PreparedOverlapLayer, b: PreparedOverlapLayer): number {
  let minimum = Infinity;
  for (const segmentA of a.projected_bbox_boundary_segments!) for (const segmentB of b.projected_bbox_boundary_segments!) minimum = Math.min(minimum, segmentDistance(segmentA, segmentB));
  return minimum;
}

function compare(a: PreparedOverlapLayer, b: PreparedOverlapLayer): OverlapPair {
  if (!a.bbox_jgd2011_lon_lat || !b.bbox_jgd2011_lon_lat || !a.projected_bbox_boundary_segments || !b.projected_bbox_boundary_segments) return { layer_a: a.layer_id, layer_b: b.layer_id, source_id_a: a.source_id, source_id_b: b.source_id, bbox_relation: 'UNKNOWN', intersection_bbox_jgd2011_lon_lat: null, minimum_separation_m: null, status: 'UNKNOWN_CRS_OR_BBOX' };
  const [ax0, ay0, ax1, ay1] = a.bbox_jgd2011_lon_lat;
  const [bx0, by0, bx1, by1] = b.bbox_jgd2011_lon_lat;
  const ix0 = Math.max(ax0, bx0), iy0 = Math.max(ay0, by0), ix1 = Math.min(ax1, bx1), iy1 = Math.min(ay1, by1);
  if (ix0 <= ix1 && iy0 <= iy1) return { layer_a: a.layer_id, layer_b: b.layer_id, source_id_a: a.source_id, source_id_b: b.source_id, bbox_relation: 'INTERSECTS', intersection_bbox_jgd2011_lon_lat: [ix0, iy0, ix1, iy1], minimum_separation_m: 0, status: 'COMPUTED_BBOX_ONLY' };
  return { layer_a: a.layer_id, layer_b: b.layer_id, source_id_a: a.source_id, source_id_b: b.source_id, bbox_relation: 'DISJOINT', intersection_bbox_jgd2011_lon_lat: null, minimum_separation_m: boundaryDistance(a, b), status: 'COMPUTED_BBOX_ONLY' };
}

export function buildOverlapReport(stationId: StationOverlapReport['station_id'], inputs: BboxLayerInput[]): StationOverlapReport {
  const layers = inputs.map(prepareLayer);
  const pairs: OverlapPair[] = [];
  for (let i = 0; i < layers.length; i++) for (let j = i + 1; j < layers.length; j++) {
    const a=layers[i]!,b=layers[j]!,pair=compare(a,b);
    // Keep unsupported/undeclared CRS comparisons separate from established JGD2011 results.
    // This raw rectangle calculation has no metric projection or datum-identification claim.
    if(pair.bbox_relation==='UNKNOWN'&&[a,b].some(l=>l.layer_role==='poi_facility')){
      const raw=(l:OverlapLayer):number[]|null=>{
        if(l.bbox_jgd2011_lon_lat)return l.bbox_jgd2011_lon_lat;
        if(l.layer_role!=='poi_facility'||l.source_crs!==null||l.crs_status!=='UNDECLARED_RFC7946_ASSUMPTION'||isIncompleteBboxStatus(l.bbox_status)||l.bbox_axis_order!=='longitude,latitude'||!validBbox(l.source_crs_bbox))return null;
        try{assertGeographicRanges(l.source_crs_bbox);return l.source_crs_bbox;}catch{return null;}
      };
      const x=raw(a),y=raw(b);
      if(x&&y)pair.conditional_bbox_comparison={relation:Math.max(x[0]!,y[0]!)<=Math.min(x[2]!,y[2]!)&&Math.max(x[1]!,y[1]!)<=Math.min(x[3]!,y[3]!)?'INTERSECTS':'DISJOINT',status:'CONDITIONAL_ON_CRS_ASSUMPTION',assumption:'Only if the POI serialized coordinates use longitude,latitude and are compatible with the other layer datum. Undeclared GeoJSON uses RFC 7946 as an assumption only; no datum transform or metric separation was inferred.'};
    }
    pairs.push({...pair,metric_status:[a,b].some(layer=>layer.metric_status==='UNKNOWN')?'UNKNOWN':[a,b].some(layer=>layer.metric_status==='CONDITIONAL_ON_INFERRED_CRS')?'CONDITIONAL_ON_INFERRED_CRS':'KNOWN'});
  }
  return { station_id: stationId, method: 'Pairwise bbox relation is computed on source bboxes normalized to JGD2011 longitude,latitude. Disjoint-bbox minimum separation is approximated by comparing projected EPSG:6677 boundary segments sampled at 32 segments per edge. Projected axis-aligned envelopes are retained as context only.',
    layers: layers.map(({projected_bbox_boundary_segments: _segments,...layer})=>layer), pairs, interpretation_limit: LIMIT, verification: 'UNVERIFIED' };
}

type CityReport = { source_id:string;source_sha256:string;totals?:{bbox_lat_lon_height:{min:number[];max:number[]}|null};envelope: { lower: number[]; upper: number[]; srsName: string | null } | null };
type GeoMember = { file: string; crs: { properties?: { name?: string } } | null; crs_status?: string; bbox: number[] | null; bbox_status?: string; feature_count: number };
type GeoReport = { members: GeoMember[]; bbox?: number[] | null; crs?: { properties?: { name?: string } } | null; crs_status?: string; bbox_status?: string };
type CsvReport = { bbox: number[] | null; crs: { value: string | null; status: string }; files?: { node_source_id?: string; link_source_id?: string } };

function cityLayer(sourceId: string, report: CityReport): BboxLayerInput {
  const e = report.envelope;
  return { layer_id: sourceId, layer_role: 'plateau_ubld', source_id: sourceId, source_crs: e?.srsName ?? null, source_crs_bbox: e ? [e.lower[0]!, e.lower[1]!, e.upper[0]!, e.upper[1]!] : null, bbox_axis_order: e ? 'latitude,longitude' : 'unknown' };
}

function geoLayers(sourceId: string, report: GeoReport): BboxLayerInput[] {
  const poi = ['tokyo-shinjuku-facilities-zip', 'plateau-13104-related-2025', 'plateau-13116-related-2025'].includes(sourceId);
  const crs = (value: Pick<GeoReport, 'crs' | 'crs_status'>): string | null => poi && value.crs_status !== 'DECLARED' ? null : (typeof crsName(value.crs) === 'string' ? crsName(value.crs) as string : null);
  const status = (value: Pick<GeoReport, 'crs_status'>): string | undefined => poi && value.crs_status === 'RFC7946_ASSUMPTION' ? 'UNDECLARED_RFC7946_ASSUMPTION' : value.crs_status;
  const members = (report.members ?? []).filter(m=>typeof m.feature_count==='number');
  if (!members.length && report.bbox) return [{ layer_id: `${sourceId}:all`, layer_role: sourceId.includes('stationmap') ? 'station_map' : 'hokonavi_network', source_id: sourceId, source_crs: crs(report), crs_status: status(report), source_crs_bbox: report.bbox, bbox_axis_order: crs(report) || status(report) === 'UNDECLARED_RFC7946_ASSUMPTION' ? 'longitude,latitude' : 'unknown', bbox_status: report.bbox_status }];
  return members.map((m, index) => ({ layer_id: `${sourceId}:${m.file || `member-${index + 1}`}`, layer_role: sourceId.includes('stationmap') ? 'station_map' : 'hokonavi_network', source_id: sourceId, source_crs: crs(m), crs_status: status(m), source_crs_bbox: m.bbox??null, bbox_axis_order: m.bbox && (crs(m) || status(m) === 'UNDECLARED_RFC7946_ASSUMPTION') ? 'longitude,latitude' : 'unknown', feature_count: m.feature_count, bbox_status: m.bbox_status }));
}

/** Read current generated reports and produce per-station bbox-only comparisons. */
export async function generateOverlapReports(): Promise<StationOverlapReport[]> {
  const root = join(docsRoot, 'gis');
  const fingerprint = await toolFingerprint();
  const poiIds = ['tokyo-shinjuku-facilities-zip', 'plateau-13104-related-2025', 'plateau-13116-related-2025'];
  const pois = await Promise.all(poiIds.map(id => readJson<GeoReport & { input_sources: Array<{ source_id: string; sha256: string }> }>(join(root, 'poi', `${id}.json`))));
  for (const [index, poi] of pois.entries()) await assertPoiInspectionCurrent(poi, poiIds[index]!, { fingerprint });
  const vintage = await readJson<any>(join(root, 'vintages', 'shinjuku-2023.json'));
  await assertVintageResearchCurrent(vintage, { fingerprint });
  const [ikeCity, shCity, r1Nodes, s01Network, stationMap] = await Promise.all([
    readJson<CityReport>(join(root, 'inventory', 'plateau-13116-ubld-53394576.inventory.json')),
    readJson<CityReport>(join(root, 'inventory', 'plateau-13104-ubld-53394536.inventory.json')),
    readJson<CsvReport>(join(root, 'networks', 'hokonavi-ikebukuro-walk-node-csv.json')),
    readJson<GeoReport>(join(root, 'networks', 'hokonavi-oedo-shinjuku-network-geojson.json')),
    readJson<GeoReport>(join(root, 'networks', 'hokonavi-oedo-shinjuku-stationmap-geojson.json')),
  ]);
  // Every consumed network inspection must match current acquisitions, tool inputs and lineage
  // before any comparison or write; a matching acquisition SHA alone is not enough.
  await assertNetworkInspectionCurrent(r1Nodes, 'hokonavi-ikebukuro-walk-node-csv', { fingerprint, linkSourceId: 'hokonavi-ikebukuro-walk-link-csv' });
  await assertNetworkInspectionCurrent(s01Network, 'hokonavi-oedo-shinjuku-network-geojson', { fingerprint });
  await assertNetworkInspectionCurrent(stationMap, 'hokonavi-oedo-shinjuku-stationmap-geojson', { fingerprint });
  const r1=await r1GeoEvidence();
  const ikeCsvBbox = r1Nodes.bbox ?? null;
  const ikeCsvSource = ['KNOWN','INFERRED_FROM_SPEC'].includes(r1Nodes.crs.status) ? r1Nodes.crs.value : null;
  const ikeLayers: BboxLayerInput[] = [cityLayer('plateau-13116-ubld-53394576', ikeCity), {
    layer_id: 'hokonavi-ikebukuro-walk-csv-pair', layer_role: 'hokonavi_csv_pair', source_id: r1Nodes.files?.node_source_id ?? 'hokonavi-ikebukuro-walk-node-csv', source_ids: [r1Nodes.files?.node_source_id ?? 'hokonavi-ikebukuro-walk-node-csv', r1Nodes.files?.link_source_id ?? 'hokonavi-ikebukuro-walk-link-csv'], crs_status:r1Nodes.crs.status,source_crs: ikeCsvSource, source_crs_bbox: ikeCsvBbox, bbox_axis_order: ikeCsvSource ? 'longitude,latitude' : 'unknown',
  }];
  for(const [source,bbox,count] of [[r1.node,r1.node_bbox,r1.nodes.features.length],[r1.link,r1.link_bbox,r1.links.features.length]] as const)ikeLayers.push({layer_id:source.record.source_id,layer_role:'hokonavi_network',source_id:source.record.source_id,source_crs:r1.crs.value,crs_status:r1.crs.status,source_crs_bbox:bbox,bbox_axis_order:'longitude,latitude',feature_count:count});
  const shLayers: BboxLayerInput[] = [cityLayer('plateau-13104-ubld-53394536', shCity), ...geoLayers('hokonavi-oedo-shinjuku-network-geojson', s01Network), ...geoLayers('hokonavi-oedo-shinjuku-stationmap-geojson', stationMap)];
  for(const [index,id] of poiIds.entries()){
    const poi=pois[index]!;
    const target=id.includes('13116')?ikeLayers:shLayers;
    target.push(...geoLayers(id,poi).map(layer=>({...layer,layer_role:'poi_facility' as const})));
  }
  const reports = [buildOverlapReport('ikebukuro', ikeLayers), buildOverlapReport('shinjuku', shLayers)];
  const catalog=await getStoredSource('plateau-catalog-ubld-mesh-533945');
  const catalogData=await readJson<unknown>(catalog.path);
  const actualBbox=(city:CityReport):number[]|null=>{const b=city.totals?.bbox_lat_lon_height;return b?[b.min[1]!,b.min[0]!,b.max[1]!,b.max[0]!]:null;};
  const envelope=(city:CityReport):number[]|null=>{const e=city.envelope;return e?[e.lower[1]!,e.lower[0]!,e.upper[1]!,e.upper[0]!]:null;};
  const acquired=Object.fromEntries(([['13116:53394576',ikeCity],['13104:53394536',shCity]] as const).map(([key,city])=>[key,{source_id:city.source_id,source_sha256:city.source_sha256,bbox:actualBbox(city),envelope:envelope(city)}]));
  for(const report of reports)report.mesh_coverage=catalogCoverage(catalogData,{source_id:catalog.record.source_id,sha256:catalog.record.sha256},report.layers.filter(layer=>layer.layer_role!=='plateau_ubld'&&layer.layer_role!=='poi_facility'),acquired);
  reports[1]!.bounded_vintage_research={report:'vintages/shinjuku-2023.json',status:vintage.status,comparison:vintage.comparison,byte_totals:vintage.byte_totals??null};
  if(reports[1]!.mesh_coverage){reports[1]!.mesh_coverage!.older_vintages.note='This latest catalog endpoint does not enumerate earlier vintages. Separate bounded 2023 v4/v3 evidence is recorded under bounded_vintage_research.';reports[1]!.mesh_coverage!.hold=reports[1]!.mesh_coverage!.hold.replace('older vintages UNKNOWN.','see separate bounded 2023 v4/v3 evidence; other vintages UNKNOWN.');}
  reports[0]!.r1_bbox_containment=r1BboxContainment(r1.nodes.features,r1.links.features,actualBbox(ikeCity));
  const out = join(root, 'overlap');
  await mkdir(out, { recursive: true });
  const inputIds = new Set(['plateau-13116-ubld-53394576','plateau-13104-ubld-53394536','hokonavi-ikebukuro-walk-node-csv','hokonavi-ikebukuro-walk-link-csv','hokonavi-ikebukuro-walk-node-geojson','hokonavi-ikebukuro-walk-link-geojson','hokonavi-oedo-shinjuku-network-geojson','hokonavi-oedo-shinjuku-stationmap-geojson','mlit-walk-network-spec-2018-03','mlit-walk-network-spec-2024-07','plateau-catalog-ubld-mesh-533945','plateau-13104-package-2023',...poiIds,...pois.flatMap(poi=>poi.input_sources.map(input=>input.source_id)),...vintage.input_sources.map((input:{source_id:string})=>input.source_id)]);
  const inputs=await Promise.all([...inputIds].map(id=>getStoredSource(id)));
  for (const report of reports) {
    report.tool_input_sha256=fingerprint;
    report.input_sources=inputs.map(({record})=>({source_id:record.source_id,sha256:record.sha256}));
    await writeJson(join(out, `${report.station_id}.json`), report);
    const lines = report.pairs.map(pair => `- ${pair.layer_a} ↔ ${pair.layer_b}: ${pair.bbox_relation}; boundary-distance approximation ${pair.minimum_separation_m === null ? 'UNKNOWN' : `${pair.minimum_separation_m.toFixed(3)} m`} (32 samples per edge; ${pair.status}; ${pair.metric_status}).`);
    await writeFile(join(out, `${report.station_id}.md`), `# ${report.station_id} bbox overlap report\n\n${report.method}\n\n${report.interpretation_limit}\n\n${lines.length ? lines.join('\n') : 'No layer pairs available.'}\n\nMesh catalog coverage: ${JSON.stringify(report.mesh_coverage)}\n\nR1 bbox containment: ${JSON.stringify(report.r1_bbox_containment??null)}\n`);
  }
  return reports;
}
