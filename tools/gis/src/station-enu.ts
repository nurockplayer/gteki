import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packageRoot, repoRoot, writeJson } from './common.js';

/**
 * The GTEki station frame, ported from packages/geo (StationFrame/EnuFrame), because tools/gis is standalone and
 * must not import workspace packages. x east and y north on the ENU tangent plane at the station origin
 * (GRS80: geodetic -> ECEF -> ENU, horizontal part evaluated at the origin height), z = source height - hM with
 * no curvature term. docs/core/contract.md "Frames" is the authority; test/fixtures/station-enu-vectors.json pins
 * this port to the packages/geo outputs within 1 mm.
 */
const A = 6378137.0; // GRS80 semi-major axis
const F = 1 / 298.257222101; // GRS80 flattening
const E2 = F * (2 - F);
const rad = (d: number): number => (d * Math.PI) / 180;

type Point3 = [number, number, number];

/**
 * How a frame defines z.
 *  - absent (Ikebukuro): z = source height - origin.hM, i.e. a TP height when hM is 0.
 *  - 'per_feature_ground' (Shinjuku): a horizontal-only symbolic frame. origin.hM is null on purpose and there is no vertical
 *    datum: the frame defines x/y only, and every context feature is flattened to symbolic street z = 0 by subtracting its own
 *    ground height (context.ts). `stationLocal` therefore refuses such a frame; use `stationHorizontal` / `projectorOrigin`.
 */
export type StationVerticalMode = 'per_feature_ground';
export interface StationOrigin { lat: number; lon: number; hM: number | null; datum: string; crs: 'EPSG:6697' | 'EPSG:6668' }
/** Hash only the station.json origin fields compared with the frame, in a fixed key order. */
export function stationOriginSha256(origin: { lat?: unknown; lon?: unknown; hM?: unknown; crs?: unknown }): string {
  const { lat, lon, hM, crs } = origin;
  return createHash('sha256').update(JSON.stringify({ lat, lon, hM, crs })).digest('hex');
}

export interface StationEnuFrame {
  frame_id: string;
  frame_kind: 'station-enu';
  station_id: string;
  station_json_path: string;
  station_json_sha256: string;
  verification: 'UNVERIFIED';
  origin: StationOrigin;
  source_crs: 'EPSG:6697';
  ellipsoid: 'GRS80';
  horizontal: string;
  vertical: string;
  axis_order: string;
  navigation_use: 'NOT_FOR_ROUTING';
  purpose: string;
  /** Present only on a horizontal-only symbolic frame; absent frames keep the TP / hM behaviour byte for byte. */
  vertical_mode?: StationVerticalMode;
  /** Present only with vertical_mode: the ellipsoidal height the ECEF origin of the horizontal projection is evaluated at. */
  horizontal_origin_height_m?: number;
}

export function geodeticToEcef(latDeg: number, lonDeg: number, h: number): Point3 {
  const p = rad(latDeg), l = rad(lonDeg), sp = Math.sin(p);
  const n = A / Math.sqrt(1 - E2 * sp * sp);
  return [(n + h) * Math.cos(p) * Math.cos(l), (n + h) * Math.cos(p) * Math.sin(l), (n * (1 - E2) + h) * sp];
}

/** Pure projector for one origin. Returns [east, north, height - hM] for a (lat, lon, height) triple. */
export function stationEnuProjector(origin: { lat: number; lon: number; hM: number | null }): (lat: number, lon: number, h: number) => Point3 {
  if (origin.hM === null) throw new Error('stationEnuProjector needs a numeric hM; for a per_feature_ground frame build the projector from projectorOrigin(frame)');
  const hM = origin.hM;
  const o = geodeticToEcef(origin.lat, origin.lon, hM);
  const sp = Math.sin(rad(origin.lat)), cp = Math.cos(rad(origin.lat)), sl = Math.sin(rad(origin.lon)), cl = Math.cos(rad(origin.lon));
  return (lat, lon, h) => {
    // The horizontal position never depends on the point's own height (packages/geo StationFrame.toLocal).
    const [x, y, z] = geodeticToEcef(lat, lon, hM);
    const dx = x - o[0], dy = y - o[1], dz = z - o[2];
    return [-sl * dx + cl * dy, -sp * cl * dx - sp * sl * dy + cp * dz, h - hM];
  };
}

/** The origin the projector is built from: the frame origin itself, except that a per_feature_ground frame (hM null) evaluates the horizontal ECEF origin at `horizontal_origin_height_m`. */
export function projectorOrigin(frame: Pick<StationEnuFrame, 'origin' | 'vertical_mode' | 'horizontal_origin_height_m'>): { lat: number; lon: number; hM: number } {
  const o = frame.origin;
  if (frame.vertical_mode === undefined) {
    if (o.hM === null) throw new Error('Station frame has hM null but no vertical_mode: its vertical anchor is undecided');
    return { lat: o.lat, lon: o.lon, hM: o.hM };
  }
  if (o.hM !== null || typeof frame.horizontal_origin_height_m !== 'number') throw new Error('Invalid per_feature_ground frame: origin.hM must be null and horizontal_origin_height_m a number');
  return { lat: o.lat, lon: o.lon, hM: frame.horizontal_origin_height_m };
}

const projectors = new WeakMap<StationEnuFrame, ReturnType<typeof stationEnuProjector>>();
const projectorFor = (frame: StationEnuFrame): ReturnType<typeof stationEnuProjector> => {
  let projector = projectors.get(frame);
  if (!projector) { projector = stationEnuProjector(projectorOrigin(frame)); projectors.set(frame, projector); }
  return projector;
};
/** Station-frame coordinates of an EPSG:6697 (latitude, longitude, height) point. Not defined for a per_feature_ground frame (no vertical datum). */
export function stationLocal(point: number[], frame: StationEnuFrame): Point3 {
  if (frame.vertical_mode !== undefined) throw new Error(`Frame ${frame.frame_id} has vertical_mode ${frame.vertical_mode}: it defines no vertical datum, so a source height has no station z without a per-feature ground height`);
  return projectorFor(frame)(point[0]!, point[1]!, point[2]!);
}
/** Station x (east), y (north) of an EPSG:6697 / EPSG:6668 (latitude, longitude, ...) point; valid for every frame. */
export function stationHorizontal(point: number[], frame: StationEnuFrame): [number, number] {
  const p = projectorFor(frame)(point[0]!, point[1]!, 0);
  return [p[0], p[1]];
}

export function isStationEnuFrame(value: unknown): value is StationEnuFrame {
  return typeof value === 'object' && value !== null && (value as { frame_kind?: unknown }).frame_kind === 'station-enu';
}

export function assertStationEnuFrame(frame: StationEnuFrame, frameId?: string): void {
  const o = frame.origin;
  if (frameId !== undefined && frame.frame_id !== frameId) throw new Error('Invalid station frame: frame_id does not match its file name');
  if (frame.frame_kind !== 'station-enu' || frame.source_crs !== 'EPSG:6697' || frame.ellipsoid !== 'GRS80') throw new Error('Invalid station frame: unsupported kind, CRS or ellipsoid');
  if (frame.vertical_mode === undefined) {
    if (frame.horizontal_origin_height_m !== undefined) throw new Error('Invalid station frame: horizontal_origin_height_m is only valid with vertical_mode');
    if (!o || o.crs !== 'EPSG:6697' || ![o.lat, o.lon, o.hM].every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error('Invalid station frame: origin needs finite lat, lon, hM and crs EPSG:6697');
  } else {
    if (frame.vertical_mode !== 'per_feature_ground') throw new Error(`Invalid station frame: unsupported vertical_mode ${JSON.stringify(frame.vertical_mode)}`);
    if (!o || (o.crs !== 'EPSG:6668' && o.crs !== 'EPSG:6697') || o.hM !== null || ![o.lat, o.lon].every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error('Invalid per_feature_ground station frame: origin needs finite lat, lon, hM null and crs EPSG:6668 or EPSG:6697 (both JGD2011 horizontally)');
    if (typeof frame.horizontal_origin_height_m !== 'number' || !Number.isFinite(frame.horizontal_origin_height_m)) throw new Error('Invalid per_feature_ground station frame: horizontal_origin_height_m must be a finite number');
  }
  if (o.lat < 24 || o.lat > 46 || o.lon < 122 || o.lon > 154) throw new Error('Invalid station frame: origin is outside the Japan latitude/longitude guard');
  if (!/^[a-f0-9]{64}$/.test(frame.station_json_sha256) || frame.navigation_use !== 'NOT_FOR_ROUTING' || frame.verification !== 'UNVERIFIED') throw new Error('Invalid station frame: missing station.json hash or truth flags');
}

export const STATION_ENU_FRAME_ID_PATTERN = /^[a-z0-9-]+$/;

/** The symbolic frame of a station whose origin.hM is null on purpose (decision: GitHub #39 comment 6324045059, Shinjuku). */
export const PER_FEATURE_GROUND_VERTICAL = 'none: no vertical datum and origin.hM is null on purpose. The frame defines x/y only. Each context feature is flattened to symbolic street z = 0 by subtracting its own ground height (its CityGML ground-height attribute when it carries one, else the minimum source height of the LOD geometry actually drawn for that feature; never one constant for all features): z_local = z_source - groundHeight(feature). Source heights are EPSG:6697 orthometric (TP) and are only ever used as differences within one feature.';
export const PER_FEATURE_GROUND_HORIZONTAL = 'ENU tangent plane at the origin on GRS80 (geodetic -> ECEF -> ENU, ECEF origin evaluated at horizontal_origin_height_m); x east, y north; no curvature term. Origin CRS EPSG:6668 (JGD2011 geographic 2D) and source CRS EPSG:6697 (JGD2011 geographic 2D + JGD2011 height) share the JGD2011 horizontal datum on GRS80, so the source latitude/longitude are used as published with no horizontal transformation and no translation from any other frame';

/**
 * Create a station-enu frame from stations/<id>/gteki/station.json (read-only; its sha256 is recorded).
 * By default it refuses, rather than guesses, when the vertical anchor is not a number or the CRS is not EPSG:6697: Shinjuku
 * has hM null / EPSG:6668 / symbolic floors, so its anchor is a station-lead decision, not a tool default.
 * That decision (#39 comment 6324045059) is opt-in: `verticalMode: 'per_feature_ground'` accepts hM null and EPSG:6668 (or 6697),
 * and writes a horizontal-only symbolic frame (no vertical datum; per-feature ground flattening in context.ts).
 */
export async function createStationEnuFrame(stationId: string, frameId: string = `${stationId}-station-enu-v0`, options: { stationsRoot?: string; writeFrame?: boolean; verticalMode?: StationVerticalMode } = {}): Promise<StationEnuFrame> {
  if (!STATION_ENU_FRAME_ID_PATTERN.test(stationId)) throw new Error(`Invalid station id: ${stationId}`);
  if (!STATION_ENU_FRAME_ID_PATTERN.test(frameId)) throw new Error('Invalid frame id');
  if (options.verticalMode !== undefined && options.verticalMode !== 'per_feature_ground') throw new Error(`Unsupported vertical mode ${JSON.stringify(options.verticalMode)}: expected per_feature_ground`);
  const relative = `stations/${stationId}/gteki/station.json`;
  const path = join(options.stationsRoot ?? join(repoRoot, 'stations'), stationId, 'gteki', 'station.json');
  const bytes = await readFile(path);
  const manifest = JSON.parse(bytes.toString('utf8')) as { station?: { id?: unknown; origin?: { lat?: unknown; lon?: unknown; hM?: unknown; datum?: unknown; crs?: unknown } } };
  const station = manifest.station, origin = station?.origin;
  if (!station || station.id !== stationId || !origin) throw new Error(`${relative} has no station.origin for ${stationId}`);
  if (typeof origin.lat !== 'number' || typeof origin.lon !== 'number' || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lon)) throw new Error(`${relative}: origin lat/lon must be finite numbers`);
  const datum = typeof origin.datum === 'string' ? origin.datum : 'unknown';
  const sha = createHash('sha256').update(bytes).digest('hex');
  let frame: StationEnuFrame;
  if (options.verticalMode === 'per_feature_ground') {
    if (origin.hM !== null) throw new Error(`${relative}: origin.hM is ${JSON.stringify(origin.hM)}; vertical mode per_feature_ground is for a station whose hM is null on purpose`);
    if (origin.crs !== 'EPSG:6668' && origin.crs !== 'EPSG:6697') throw new Error(`${relative}: origin.crs is ${JSON.stringify(origin.crs)}; per_feature_ground frames accept EPSG:6668 or EPSG:6697 (both JGD2011 horizontally)`);
    if (datum !== 'JGD2011') throw new Error(`${relative}: origin.datum is ${JSON.stringify(origin.datum)}; per_feature_ground frames require JGD2011 (the horizontal datum of the EPSG:6697 PLATEAU sources)`);
    frame = {
      frame_id: frameId, frame_kind: 'station-enu', station_id: stationId, station_json_path: relative,
      station_json_sha256: sha, verification: 'UNVERIFIED',
      origin: { lat: origin.lat, lon: origin.lon, hM: null, datum, crs: origin.crs },
      source_crs: 'EPSG:6697', ellipsoid: 'GRS80',
      horizontal: PER_FEATURE_GROUND_HORIZONTAL,
      vertical: PER_FEATURE_GROUND_VERTICAL,
      axis_order: 'source latitude,longitude,height; station x east, y north, z up; glTF (renderer) x east, y up, z -north',
      navigation_use: 'NOT_FOR_ROUTING',
      purpose: 'Station reference frame (docs/core/contract.md Frames) for visual-only context geometry; NOT an envelope processing origin and NOT a routing frame',
      vertical_mode: 'per_feature_ground', horizontal_origin_height_m: 0,
    };
  } else {
    if (typeof origin.hM !== 'number' || !Number.isFinite(origin.hM)) throw new Error(`${relative}: origin.hM is ${JSON.stringify(origin.hM)}; the vertical anchor of ${stationId} is undecided, so no station-enu frame is created (a station-lead decision, never defaulted to 0)`);
    if (origin.crs !== 'EPSG:6697') throw new Error(`${relative}: origin.crs is ${JSON.stringify(origin.crs)}; station-enu frames require EPSG:6697 (PLATEAU CityGML source CRS)`);
    frame = {
      frame_id: frameId, frame_kind: 'station-enu', station_id: stationId, station_json_path: relative,
      station_json_sha256: sha, verification: 'UNVERIFIED',
      origin: { lat: origin.lat, lon: origin.lon, hM: origin.hM, datum, crs: 'EPSG:6697' },
      source_crs: 'EPSG:6697', ellipsoid: 'GRS80',
      horizontal: 'ENU tangent plane at the origin on GRS80 (geodetic -> ECEF -> ENU, evaluated at the origin height); x east, y north; no curvature term',
      vertical: 'z = source height - origin.hM, unchanged otherwise; PLATEAU EPSG:6697 heights are orthometric (TP), so z stays a TP height when hM is 0; no geoid or ellipsoid conversion',
      axis_order: 'source latitude,longitude,height; station x east, y north, z up; glTF (renderer) x east, y up, z -north',
      navigation_use: 'NOT_FOR_ROUTING',
      purpose: 'Station reference frame (docs/core/contract.md Frames) for visual-only context geometry; NOT an envelope processing origin and NOT a routing frame',
    };
  }
  assertStationEnuFrame(frame);
  if (options.writeFrame !== false) await writeJson(join(packageRoot, 'frames', `${frameId}.json`), frame);
  return frame;
}
