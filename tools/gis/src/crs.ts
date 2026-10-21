import proj4 from 'proj4';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { docsRoot, packageRoot, readJson, writeJson, safeSourceId } from './common.js';
import { assertStationEnuFrame, isStationEnuFrame, stationLocal, type StationEnuFrame } from './station-enu.js';

export const CRS_6697 = 'http://www.opengis.net/def/crs/EPSG/0/6697';
export const IX_PROJ = '+proj=tmerc +lat_0=36 +lon_0=139.833333333333333 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs';
const GEOGRAPHIC = '+proj=longlat +ellps=GRS80 +no_defs';
/** Transform JGD2011 longitude/latitude coordinates into Japan Plane Rectangular IX. */
export function projectLonLat(point: [number, number]): [number, number] {
  const [E, N] = proj4(GEOGRAPHIC, IX_PROJ, point);
  return [E, N];
}
export type Point3 = [number, number, number];
export interface Frame {
  frame_id: string;
  source_id: string;
  source_sha256: string;
  verification: 'UNVERIFIED';
  origin_E: number;
  origin_N: number;
  origin_H: number;
  source_envelope: { lower: number[]; upper: number[]; srsName: string | null };
  horizontal_crs: 'EPSG:6677';
  projection: string;
  vertical_datum: string;
  axis_order: string;
  purpose: string;
}
export function assertAxis(point: number[], srsName: string | null = CRS_6697): asserts point is Point3 {
  if (srsName !== CRS_6697) throw new Error(`Unsupported source CRS ${srsName}; required EPSG:6697`);
  if (point.length !== 3 || !point.every(Number.isFinite) || point[0] < 20 || point[0] > 46 || point[1] < 122 || point[1] > 154)
    throw new Error(`EPSG:6697 requires Japan latitude,longitude,height; received ${point}`);
}
export function project(point: number[]): Point3 {
  assertAxis(point);
  const [E, N] = proj4(GEOGRAPHIC, IX_PROJ, [point[1], point[0]]);
  return [E, N, point[2]];
}
export function unproject(point: Point3): Point3 {
  const [lon, lat] = proj4(IX_PROJ, GEOGRAPHIC, [point[0], point[1]]);
  return [lat, lon, point[2]];
}
/** Either an envelope processing frame (EPSG:6677 offset, arbitrary origin) or a station-enu frame (the station reference frame). */
export type AnyFrame = Frame | StationEnuFrame;
export function toLocal(point: number[], frame: AnyFrame): Point3 {
  if (isStationEnuFrame(frame)) { assertAxis(point); return stationLocal(point, frame); }
  const [E, N, H] = project(point);
  return [E - frame.origin_E, N - frame.origin_N, H - frame.origin_H];
}
export function fromLocal(point: Point3, frame: Frame): Point3 {
  return unproject([point[0] + frame.origin_E, point[1] + frame.origin_N, point[2] + frame.origin_H]);
}
export function toGltf([E, N, U]: Point3): Point3 { return [E, U, -N]; }
export function fromGltf([x, y, z]: Point3): Point3 { return [x, -z, y]; }
export function framePath(frameId: string): string {
  if (!/^[a-z0-9-]+$/.test(frameId)) throw new Error('Invalid frame id');
  return join(packageRoot, 'frames', `${frameId}.json`);
}
export async function loadFrame(frameId: string): Promise<AnyFrame> {
  const raw = await readJson<Frame | StationEnuFrame>(framePath(frameId));
  if (isStationEnuFrame(raw)) { assertStationEnuFrame(raw, frameId); return raw; }
  const frame = raw as Frame;
  if (frame.frame_id !== frameId || frame.projection !== IX_PROJ || ![frame.origin_E, frame.origin_N, frame.origin_H].every(Number.isFinite)) throw new Error('Invalid frame');
  return frame;
}
export async function frameFromEnvelope(sourceId: string, frameId: string): Promise<Frame> {
  safeSourceId(sourceId);
  const inventory = await readJson<{ source_sha256: string; envelope: Frame['source_envelope'] | null }>(join(docsRoot, 'gis', 'inventory', `${sourceId}.inventory.json`));
  if (!inventory.envelope) throw new Error('No source envelope; cannot choose a processing origin');
  const { lower, upper, srsName } = inventory.envelope;
  assertAxis(lower, srsName); assertAxis(upper, srsName);
  const centre = lower.map((x, i) => (x + upper[i]) / 2);
  const [E, N, H] = project(centre);
  const frame: Frame = { frame_id: frameId, source_id: sourceId, source_sha256: inventory.source_sha256, verification: 'UNVERIFIED',
    origin_E: Math.round(E), origin_N: Math.round(N), origin_H: Math.round(H), source_envelope: inventory.envelope,
    horizontal_crs: 'EPSG:6677', projection: IX_PROJ,
    vertical_datum: 'JGD2011 orthometric height, Tokyo Peil (TP); unchanged; no geoid or ellipsoid conversion',
    axis_order: 'source latitude,longitude,height; local East,North,Up; glTF East,Up,-North',
    purpose: 'Arbitrary processing origin: projected envelope centre rounded to 1 m; NOT a station reference point' };
  await writeJson(framePath(frameId), frame);
  return frame;
}
export async function crsRoundtrip(frameId: string) {
  const frame = await loadFrame(frameId);
  if (isStationEnuFrame(frame)) throw new Error('crs-roundtrip checks envelope frames (EPSG:6677 projection); a station-enu frame is pinned by test/fixtures/station-enu-vectors.json instead');
  const samples: number[][] = [];
  for (const lat of [frame.source_envelope.lower[0], frame.source_envelope.upper[0]])
    for (const lon of [frame.source_envelope.lower[1], frame.source_envelope.upper[1]])
      for (const H of [frame.source_envelope.lower[2], frame.source_envelope.upper[2]]) samples.push([lat, lon, H]);
  const points = samples.map(source => {
    assertAxis(source, frame.source_envelope.srsName);
    const local = toLocal(source, frame), inverse = fromLocal(local, frame), projected = toLocal(inverse, frame);
    return { source, local, gltf: toGltf(local), inverse, horizontal_error_m: Math.hypot(projected[0] - local[0], projected[1] - local[1]),
      angular_error_deg: Math.max(Math.abs(source[0] - inverse[0]), Math.abs(source[1] - inverse[1])) };
  });
  const controlFixture = JSON.parse(await readFile(join(packageRoot, 'test', 'fixtures', 'gsi-bl2xy-controls.json'), 'utf8')) as { retrieved_date: string; source: string; controls: Array<{ url: string; latitude: number; longitude: number; response: { publicX: string; publicY: string } }> };
  const independentControls = controlFixture.controls.map(control => {
    const [easting, northing] = project([control.latitude, control.longitude, 0]);
    const deltaE = easting - Number(control.response.publicY);
    const deltaN = northing - Number(control.response.publicX);
    return { url: control.url, latitude: control.latitude, longitude: control.longitude, expected_E_m: Number(control.response.publicY), expected_N_m: Number(control.response.publicX), computed_E_m: easting, computed_N_m: northing, delta_E_m: deltaE, delta_N_m: deltaN, max_abs_error_m: Math.max(Math.abs(deltaE), Math.abs(deltaN)) };
  });
  const max_control_error_m = Math.max(...independentControls.map(control => control.max_abs_error_m));
  if (max_control_error_m > 0.0005) throw new Error(`GSI independent CRS control exceeds 0.5 mm: ${max_control_error_m} m`);
  const report = { frame, points, max_horizontal_error_m: Math.max(...points.map(p => p.horizontal_error_m)), max_angular_error_deg: Math.max(...points.map(p => p.angular_error_deg)),
    independent_reference: `${controlFixture.source}; JGD2011 zone IX controls dated ${controlFixture.retrieved_date}. GSI publicY is easting and publicX is northing.`, independent_controls: independentControls, max_independent_control_error_m: max_control_error_m,
    verification: 'UNVERIFIED' };
  if (report.max_horizontal_error_m >= 1e-6 || report.max_angular_error_deg >= 1e-9) throw new Error('CRS roundtrip tolerance exceeded');
  await writeJson(join(docsRoot, 'gis', 'crs', `${frameId}.json`), report);
  await mkdir(join(docsRoot, 'gis', 'crs'), { recursive: true });
  const controlLines = independentControls.map(c => `- ${c.latitude}, ${c.longitude}: ΔE ${c.delta_E_m} m; ΔN ${c.delta_N_m} m; max |Δ| ${c.max_abs_error_m} m ([GSI request](${c.url})).`).join('\n');
  await writeFile(join(docsRoot, 'gis', 'crs', `${frameId}.md`), `# ${frameId}\n\n${frame.purpose}\n\nSource: ${frame.source_id} (${frame.source_sha256}).\n\nProjection: \`${IX_PROJ}\`. EPSG:6697 serialized latitude, longitude, height → EPSG:6677 East, North.\n\nOrigin E/N/H: ${frame.origin_E}, ${frame.origin_N}, ${frame.origin_H} m. ${frame.vertical_datum}. glTF: x=E, y=U, z=-N.\n\nEight envelope corners: maximum inverse→forward horizontal error ${report.max_horizontal_error_m} m; forward→inverse angular error ${report.max_angular_error_deg} degrees.\n\nIndependent control: [GSI Survey Calculation Site bl2xy](https://vldb.gsi.go.jp/sokuchi/surveycalc/surveycalc/bl2xy.pl), lead-supplied responses dated 2026-10-20, JGD2011, zone IX. GSI publicY is easting and publicX is northing; maximum absolute coordinate error is ${max_control_error_m} m (required ≤ 0.0005 m).\n\n${controlLines}\n\nUNVERIFIED; these controls validate projection parameters, not station alignment.\n`);
  return report;
}
