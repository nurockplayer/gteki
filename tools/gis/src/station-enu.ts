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

export interface StationOrigin { lat: number; lon: number; hM: number; datum: string; crs: 'EPSG:6697' }
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
}

export function geodeticToEcef(latDeg: number, lonDeg: number, h: number): Point3 {
  const p = rad(latDeg), l = rad(lonDeg), sp = Math.sin(p);
  const n = A / Math.sqrt(1 - E2 * sp * sp);
  return [(n + h) * Math.cos(p) * Math.cos(l), (n + h) * Math.cos(p) * Math.sin(l), (n * (1 - E2) + h) * sp];
}

/** Pure projector for one origin. Returns [east, north, height - hM] for a (lat, lon, height) triple. */
export function stationEnuProjector(origin: { lat: number; lon: number; hM: number }): (lat: number, lon: number, h: number) => Point3 {
  const o = geodeticToEcef(origin.lat, origin.lon, origin.hM);
  const sp = Math.sin(rad(origin.lat)), cp = Math.cos(rad(origin.lat)), sl = Math.sin(rad(origin.lon)), cl = Math.cos(rad(origin.lon));
  return (lat, lon, h) => {
    // The horizontal position never depends on the point's own height (packages/geo StationFrame.toLocal).
    const [x, y, z] = geodeticToEcef(lat, lon, origin.hM);
    const dx = x - o[0], dy = y - o[1], dz = z - o[2];
    return [-sl * dx + cl * dy, -sp * cl * dx - sp * sl * dy + cp * dz, h - origin.hM];
  };
}

const projectors = new WeakMap<StationEnuFrame, ReturnType<typeof stationEnuProjector>>();
/** Station-frame coordinates of an EPSG:6697 (latitude, longitude, height) point. */
export function stationLocal(point: number[], frame: StationEnuFrame): Point3 {
  let projector = projectors.get(frame);
  if (!projector) { projector = stationEnuProjector(frame.origin); projectors.set(frame, projector); }
  return projector(point[0]!, point[1]!, point[2]!);
}

export function isStationEnuFrame(value: unknown): value is StationEnuFrame {
  return typeof value === 'object' && value !== null && (value as { frame_kind?: unknown }).frame_kind === 'station-enu';
}

export function assertStationEnuFrame(frame: StationEnuFrame, frameId?: string): void {
  const o = frame.origin;
  if (frameId !== undefined && frame.frame_id !== frameId) throw new Error('Invalid station frame: frame_id does not match its file name');
  if (frame.frame_kind !== 'station-enu' || frame.source_crs !== 'EPSG:6697' || frame.ellipsoid !== 'GRS80') throw new Error('Invalid station frame: unsupported kind, CRS or ellipsoid');
  if (!o || o.crs !== 'EPSG:6697' || ![o.lat, o.lon, o.hM].every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error('Invalid station frame: origin needs finite lat, lon, hM and crs EPSG:6697');
  if (o.lat < 24 || o.lat > 46 || o.lon < 122 || o.lon > 154) throw new Error('Invalid station frame: origin is outside the Japan latitude/longitude guard');
  if (!/^[a-f0-9]{64}$/.test(frame.station_json_sha256) || frame.navigation_use !== 'NOT_FOR_ROUTING' || frame.verification !== 'UNVERIFIED') throw new Error('Invalid station frame: missing station.json hash or truth flags');
}

export const STATION_ENU_FRAME_ID_PATTERN = /^[a-z0-9-]+$/;

/**
 * Create a station-enu frame from stations/<id>/gteki/station.json (read-only; its sha256 is recorded).
 * Refuses, rather than guesses, when the vertical anchor is not a number or the CRS is not EPSG:6697: Shinjuku
 * has hM null / EPSG:6668 / symbolic floors, so its anchor is a station-lead decision, not a tool default.
 */
export async function createStationEnuFrame(stationId: string, frameId: string = `${stationId}-station-enu-v0`, options: { stationsRoot?: string; writeFrame?: boolean } = {}): Promise<StationEnuFrame> {
  if (!STATION_ENU_FRAME_ID_PATTERN.test(stationId)) throw new Error(`Invalid station id: ${stationId}`);
  if (!STATION_ENU_FRAME_ID_PATTERN.test(frameId)) throw new Error('Invalid frame id');
  const relative = `stations/${stationId}/gteki/station.json`;
  const path = join(options.stationsRoot ?? join(repoRoot, 'stations'), stationId, 'gteki', 'station.json');
  const bytes = await readFile(path);
  const manifest = JSON.parse(bytes.toString('utf8')) as { station?: { id?: unknown; origin?: { lat?: unknown; lon?: unknown; hM?: unknown; datum?: unknown; crs?: unknown } } };
  const station = manifest.station, origin = station?.origin;
  if (!station || station.id !== stationId || !origin) throw new Error(`${relative} has no station.origin for ${stationId}`);
  if (typeof origin.lat !== 'number' || typeof origin.lon !== 'number' || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lon)) throw new Error(`${relative}: origin lat/lon must be finite numbers`);
  if (typeof origin.hM !== 'number' || !Number.isFinite(origin.hM)) throw new Error(`${relative}: origin.hM is ${JSON.stringify(origin.hM)}; the vertical anchor of ${stationId} is undecided, so no station-enu frame is created (a station-lead decision, never defaulted to 0)`);
  if (origin.crs !== 'EPSG:6697') throw new Error(`${relative}: origin.crs is ${JSON.stringify(origin.crs)}; station-enu frames require EPSG:6697 (PLATEAU CityGML source CRS)`);
  const frame: StationEnuFrame = {
    frame_id: frameId, frame_kind: 'station-enu', station_id: stationId, station_json_path: relative,
    station_json_sha256: createHash('sha256').update(bytes).digest('hex'), verification: 'UNVERIFIED',
    origin: { lat: origin.lat, lon: origin.lon, hM: origin.hM, datum: typeof origin.datum === 'string' ? origin.datum : 'unknown', crs: 'EPSG:6697' },
    source_crs: 'EPSG:6697', ellipsoid: 'GRS80',
    horizontal: 'ENU tangent plane at the origin on GRS80 (geodetic -> ECEF -> ENU, evaluated at the origin height); x east, y north; no curvature term',
    vertical: 'z = source height - origin.hM, unchanged otherwise; PLATEAU EPSG:6697 heights are orthometric (TP), so z stays a TP height when hM is 0; no geoid or ellipsoid conversion',
    axis_order: 'source latitude,longitude,height; station x east, y north, z up; glTF (renderer) x east, y up, z -north',
    navigation_use: 'NOT_FOR_ROUTING',
    purpose: 'Station reference frame (docs/core/contract.md Frames) for visual-only context geometry; NOT an envelope processing origin and NOT a routing frame',
  };
  assertStationEnuFrame(frame);
  if (options.writeFrame !== false) await writeJson(join(packageRoot, 'frames', `${frameId}.json`), frame);
  return frame;
}
