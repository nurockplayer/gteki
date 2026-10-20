import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { docsRoot, readJson, writeJson } from './common.js';
import { projectLonLat } from './crs.js';

export type BboxLayerInput = {
  layer_id: string;
  layer_role: 'plateau_ubld' | 'hokonavi_network' | 'hokonavi_csv_pair' | 'station_map';
  source_id: string;
  source_ids?: string[];
  source_crs: string | null;
  source_crs_bbox: number[] | null;
  bbox_axis_order: 'latitude,longitude' | 'longitude,latitude' | 'unknown';
  feature_count?: number | null;
};

export type OverlapLayer = BboxLayerInput & {
  /** Normalized shared horizontal JGD2011 longitude,latitude bbox for source-level relation tests. */
  bbox_jgd2011_lon_lat: [number, number, number, number] | null;
  bbox_epsg_6677: [number, number, number, number] | null;
  metric_status: 'KNOWN' | 'UNKNOWN';
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
};

export type StationOverlapReport = {
  station_id: 'ikebukuro' | 'shinjuku';
  method: string;
  layers: OverlapLayer[];
  pairs: OverlapPair[];
  interpretation_limit: string;
  verification: 'UNVERIFIED';
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

function prepareLayer(layer: BboxLayerInput): PreparedOverlapLayer {
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
  return { ...layer, bbox_jgd2011_lon_lat: geographic, bbox_epsg_6677: projected, projected_bbox_boundary_segments: segments, metric_status: 'KNOWN', metric_note: 'Source geographic bbox normalized to JGD2011 lon,lat; edges sampled at 32 segments per edge and projected to EPSG:6677.' };
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
  for (let i = 0; i < layers.length; i++) for (let j = i + 1; j < layers.length; j++) pairs.push(compare(layers[i]!, layers[j]!));
  return { station_id: stationId, method: 'Pairwise bbox relation is computed on source bboxes normalized to JGD2011 longitude,latitude. Disjoint-bbox minimum separation is approximated by comparing projected EPSG:6677 boundary segments sampled at 32 segments per edge. Projected axis-aligned envelopes are retained as context only.',
    layers: layers.map(({projected_bbox_boundary_segments: _segments,...layer})=>layer), pairs, interpretation_limit: LIMIT, verification: 'UNVERIFIED' };
}

type CityReport = { envelope: { lower: number[]; upper: number[]; srsName: string | null } | null };
type GeoMember = { file: string; crs: { properties?: { name?: string } } | null; bbox: number[] | null; feature_count: number };
type GeoReport = { members: GeoMember[]; bbox?: number[] | null; crs?: { properties?: { name?: string } } | null };
type CsvReport = { bbox: number[] | null; crs: { value: string | null; status: string }; files?: { node_source_id?: string; link_source_id?: string } };

function cityLayer(sourceId: string, report: CityReport): BboxLayerInput {
  const e = report.envelope;
  return { layer_id: sourceId, layer_role: 'plateau_ubld', source_id: sourceId, source_crs: e?.srsName ?? null, source_crs_bbox: e ? [e.lower[0]!, e.lower[1]!, e.upper[0]!, e.upper[1]!] : null, bbox_axis_order: e ? 'latitude,longitude' : 'unknown' };
}

function geoLayers(sourceId: string, report: GeoReport): BboxLayerInput[] {
  const members = report.members ?? [];
  if (!members.length && report.bbox) return [{ layer_id: `${sourceId}:all`, layer_role: sourceId.includes('stationmap') ? 'station_map' : 'hokonavi_network', source_id: sourceId, source_crs: report.crs?.properties?.name ?? null, source_crs_bbox: report.bbox, bbox_axis_order: 'longitude,latitude' }];
  return members.map((m, index) => ({ layer_id: `${sourceId}:${m.file || `member-${index + 1}`}`, layer_role: sourceId.includes('stationmap') ? 'station_map' : 'hokonavi_network', source_id: sourceId, source_crs: m.crs?.properties?.name ?? null, source_crs_bbox: m.bbox, bbox_axis_order: m.bbox ? 'longitude,latitude' : 'unknown', feature_count: m.feature_count }));
}

/** Read current generated reports and produce per-station bbox-only comparisons. */
export async function generateOverlapReports(): Promise<StationOverlapReport[]> {
  const root = join(docsRoot, 'gis');
  const [ikeCity, shCity, r1Nodes, s01Network, stationMap] = await Promise.all([
    readJson<CityReport>(join(root, 'inventory', 'plateau-13116-ubld-53394576.inventory.json')),
    readJson<CityReport>(join(root, 'inventory', 'plateau-13104-ubld-53394536.inventory.json')),
    readJson<CsvReport>(join(root, 'networks', 'hokonavi-ikebukuro-walk-node-csv.json')),
    readJson<GeoReport>(join(root, 'networks', 'hokonavi-oedo-shinjuku-network-geojson.json')),
    readJson<GeoReport>(join(root, 'networks', 'hokonavi-oedo-shinjuku-stationmap-geojson.json')),
  ]);
  const ikeCsvBbox = r1Nodes.bbox ?? null;
  const ikeCsvSource = r1Nodes.crs.status === 'KNOWN' ? r1Nodes.crs.value : null;
  const ikeLayers: BboxLayerInput[] = [cityLayer('plateau-13116-ubld-53394576', ikeCity), {
    layer_id: 'hokonavi-ikebukuro-walk-csv-pair', layer_role: 'hokonavi_csv_pair', source_id: r1Nodes.files?.node_source_id ?? 'hokonavi-ikebukuro-walk-node-csv', source_ids: [r1Nodes.files?.node_source_id ?? 'hokonavi-ikebukuro-walk-node-csv', r1Nodes.files?.link_source_id ?? 'hokonavi-ikebukuro-walk-link-csv'], source_crs: ikeCsvSource, source_crs_bbox: ikeCsvBbox, bbox_axis_order: ikeCsvSource ? 'longitude,latitude' : 'unknown',
  }];
  const shLayers: BboxLayerInput[] = [cityLayer('plateau-13104-ubld-53394536', shCity), ...geoLayers('hokonavi-oedo-shinjuku-network-geojson', s01Network), ...geoLayers('hokonavi-oedo-shinjuku-stationmap-geojson', stationMap)];
  const reports = [buildOverlapReport('ikebukuro', ikeLayers), buildOverlapReport('shinjuku', shLayers)];
  const out = join(root, 'overlap');
  await mkdir(out, { recursive: true });
  for (const report of reports) {
    await writeJson(join(out, `${report.station_id}.json`), report);
    const lines = report.pairs.map(pair => `- ${pair.layer_a} ↔ ${pair.layer_b}: ${pair.bbox_relation}; boundary-distance approximation ${pair.minimum_separation_m === null ? 'UNKNOWN' : `${pair.minimum_separation_m.toFixed(3)} m`} (32 samples per edge; ${pair.status}).`);
    await writeFile(join(out, `${report.station_id}.md`), `# ${report.station_id} bbox overlap report\n\n${report.method}\n\n${report.interpretation_limit}\n\n${lines.length ? lines.join('\n') : 'No layer pairs available.'}\n`);
  }
  return reports;
}
