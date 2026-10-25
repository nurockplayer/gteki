import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getStoredSource, getStoreRoot, packageRoot, repoRoot, writeJson } from './common.js';
import { assertNoSourceValues } from './context-overlay.js';
import { stationEnuProjector } from './station-enu.js';
import { toolFingerprint } from './provenance.js';
import { readZip } from './zip.js';
import {
  S03_DATUM, S03_FLOOR_ORDINALS, assertS03Bytes, floorMappingSha256, parseS03Members, residualStats, transformS03,
  type Affine, type Point2, type Project, type S03Inputs, type S03Link,
} from './s03-transform.js';

/**
 * WP7 path transform: the S03 navigation nodes and links (`v5_nav.json`) under the same two affine transforms and the
 * station ENU projector the position tools use, emitted as walkable segments. This is evidence only. The CRS/datum is
 * an explicit input, default `UNKNOWN`, and no value passed here confirms it, so every output stays `NOT_FOR_ROUTING`
 * and `UNVERIFIED`. Nothing is written to `stations/**`: placement stays HOLD until the CRS is confirmed.
 */
export const S03_PATHS_POLICY = 's03-paths-v1';
export const S03_PATH_SOURCE_ID = 'tokyo-s03-zip';
export const S03_PATHS_STATION_PATH = 'stations/shinjuku/gteki/station.json';
export const CRS_UNKNOWN = 'UNKNOWN';
/** The source credit the private document carries; the public receipt carries no source value. */
export const S03_PATHS_CREDIT = '出典：東京都都市整備局「新宿駅周辺の施設情報等」';

/** The evidence the path transform stands on, quoted from docs/gis/crs/shinjuku-s03-v0.md (PR #505) and the v4 transform-check receipt. */
export interface S03PathsEvidence {
  source_zip_sha256: string; node_count: number; link_count: number;
  check_a: { node_count: number; inside_count: number; inside_share: number; status: string; failing_levels: { level_id: number; inside_share: number }[] };
  check_b: { pairs_within_5m: number; median_m: number; p90_m: number; max_m: number;
    mean_offset_m: { east: number; north: number }; mean_offset_applied: boolean };
}
/**
 * The run fails closed if the stored ZIP is not the one these numbers were measured on, or if the node and link counts
 * differ, so the quoted residuals cannot go stale behind a different input.
 */
export const S03_PATHS_EVIDENCE: S03PathsEvidence = {
  source_zip_sha256: 'fc3466270c08593a300e652c7997021f85151bf0f435e17ee9fcb7935ed4ba31',
  node_count: 2506, link_count: 2653,
  check_a: { node_count: 2506, inside_count: 2463, inside_share: 0.982841, status: 'FAIL',
    failing_levels: [{ level_id: 64677, inside_share: 0.917355 }] },
  check_b: { pairs_within_5m: 15, median_m: 1.853869309, p90_m: 3.366510600, max_m: 3.418081058,
    mean_offset_m: { east: 0.934294041, north: 0.127433023 }, mean_offset_applied: false },
};

/** The restriction labels travel on the document and on every record, so a lifted record cannot read as a route. */
export const PATH_RECORD_LABELS = Object.freeze({ navigation_use: 'NOT_FOR_ROUTING', verification: 'UNVERIFIED', gteki_role: 'evidence' });

/** Why a segment cannot be used for routing yet; counts only in the public receipt, never coordinates or source labels. */
export const PATH_REASON = {
  CRS_UNCONFIRMED: 'CRS_UNCONFIRMED',
  CHECK_A_CONTAINMENT_FAIL: 'CHECK_A_CONTAINMENT_FAIL',
  CHECK_B_RESIDUAL_UNVERIFIED: 'CHECK_B_RESIDUAL_UNVERIFIED',
  FLOOR_ORDINAL_UNVERIFIED: 'FLOOR_ORDINAL_UNVERIFIED',
  CROSS_LEVEL_DEVICE_UNKNOWN: 'CROSS_LEVEL_DEVICE_UNKNOWN',
  ONE_WAY: 'ONE_WAY',
  SELF_LOOP: 'SELF_LOOP',
  ZERO_LENGTH: 'ZERO_LENGTH',
} as const;
export type PathReason = (typeof PATH_REASON)[keyof typeof PATH_REASON];

const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positiveInt = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const lonLat = (point: Point2): boolean => point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;

/** The parsed S03 pieces the path transform needs: the two affines, the nodes and links, and the level ordinals. */
export interface PathInputs {
  navTransform: Affine;
  drawingTransform: Affine;
  nodes: S03Inputs['nodes'];
  links: readonly S03Link[];
  levels: readonly Pick<S03Inputs['levels'][number], 'id' | 'label' | 'ordinal'>[];
}

export interface PathNodeRecord {
  source_id: number; level_id: number; level_label: string; floor_ordinal: number;
  lon: number; lat: number; east_m: number; north_m: number;
}
export interface PathSegmentRecord {
  link_id_sha256: string; from_node_sha256: string; to_node_sha256: string;
  from_level_id: number; to_level_id: number; level_relation: 'same_level' | 'cross_level';
  direction: number; dz_m: number | null;
  from_east_m: number; from_north_m: number; to_east_m: number; to_north_m: number;
  length_m: number; reason_codes: PathReason[];
}
export interface BuiltPaths {
  nodes: PathNodeRecord[]; segments: PathSegmentRecord[];
  counts: { nodes: number; links: number; segments: number; same_level: number; cross_level: number; directions: { direction: number; count: number }[] };
  level_counts: { level_id: number; nodes: number; same_level_segments: number }[];
  reason_codes: { code: PathReason; count: number }[];
}

/**
 * Transform every node and turn every link into one segment. Malformed input fails closed rather than being skipped: an
 * unknown or duplicate id, an endpoint that is not a node, a direction outside 1/2/3, and a node that does not
 * transform into geographic range all stop the run. A self-loop and a link whose endpoints share one horizontal
 * position are not malformations in this source — it carries six of the first and two vertical transitions of the
 * second — so they are kept with `SELF_LOOP` / `ZERO_LENGTH` and no routing use.
 *
 * The level split follows WP7's classification: a link is `cross_level` when its endpoints sit on different levels or
 * it carries a non-zero `dz`, and `same_level` otherwise. The source has no stair/lift/escalator field, so a
 * cross-level segment's device stays UNKNOWN and is recorded as a reason code.
 */
export function buildPaths(inputs: PathInputs, project: Project): BuiltPaths {
  const levelById = new Map<number, PathInputs['levels'][number]>();
  for (const level of inputs.levels) {
    if (!positiveInt(level.id)) throw new Error(`S03 paths: level id ${String(level.id)} is not a positive integer`);
    if (levelById.has(level.id)) throw new Error(`S03 paths: duplicate level id ${level.id}`);
    if (!finite(level.ordinal)) throw new Error(`S03 paths: level ${level.id} has no finite comparison ordinal`);
    levelById.set(level.id, level);
  }
  const nodeIds = new Set<number>(), nodes: PathNodeRecord[] = [];
  for (const node of inputs.nodes) {
    if (!positiveInt(node.sourceId)) throw new Error(`S03 paths: node id ${String(node.sourceId)} is not a positive integer`);
    if (nodeIds.has(node.sourceId)) throw new Error(`S03 paths: duplicate node id ${node.sourceId}`);
    nodeIds.add(node.sourceId);
    const level = levelById.get(node.levelId);
    if (!level) throw new Error(`S03 paths: node ${node.sourceId} sits on unknown level ${node.levelId}`);
    if (!Array.isArray(node.native) || node.native.length !== 2 || !node.native.every(finite))
      throw new Error(`S03 paths: node ${node.sourceId} has no finite native position`);
    const ll = transformS03(node.native, inputs.navTransform, inputs.drawingTransform);
    // The same range test the transform check applies: a transformed node outside geographic range stops the run.
    if (!lonLat(ll)) throw new Error(`S03 paths: transformed node ${node.sourceId} is outside geographic range`);
    const [east, north] = project(ll[1], ll[0]);
    if (!finite(east) || !finite(north)) throw new Error(`S03 paths: node ${node.sourceId} does not project into the station frame`);
    nodes.push({ source_id: node.sourceId, level_id: node.levelId, level_label: level.label, floor_ordinal: level.ordinal,
      lon: ll[0], lat: ll[1], east_m: east, north_m: north });
  }
  nodes.sort((a, b) => a.source_id - b.source_id);
  const nodeById = new Map(nodes.map(node => [node.source_id, node]));
  const linkIds = new Set<number>(), segments: PathSegmentRecord[] = [];
  for (const link of inputs.links) {
    if (!positiveInt(link.sourceId)) throw new Error(`S03 paths: link id ${String(link.sourceId)} is not a positive integer`);
    if (linkIds.has(link.sourceId)) throw new Error(`S03 paths: duplicate link id ${link.sourceId}`);
    linkIds.add(link.sourceId);
    if (![1, 2, 3].includes(link.direction)) throw new Error(`S03 paths: link ${link.sourceId} has direction ${String(link.direction)}; expected 1, 2 or 3`);
    const from = nodeById.get(link.n1), to = nodeById.get(link.n2);
    if (!from || !to) throw new Error(`S03 paths: link ${link.sourceId} does not join two known nodes`);
    const length = Math.hypot(to.east_m - from.east_m, to.north_m - from.north_m);
    const levelRelation = from.level_id !== to.level_id || link.dz !== null && link.dz !== 0 ? 'cross_level' : 'same_level';
    const reasonCodes: PathReason[] = [PATH_REASON.CRS_UNCONFIRMED, PATH_REASON.CHECK_A_CONTAINMENT_FAIL,
      PATH_REASON.CHECK_B_RESIDUAL_UNVERIFIED, PATH_REASON.FLOOR_ORDINAL_UNVERIFIED];
    if (levelRelation === 'cross_level') reasonCodes.push(PATH_REASON.CROSS_LEVEL_DEVICE_UNKNOWN);
    // Direction 1 is n1 to n2, 2 is n2 to n1, 3 is both; a single direction is not walkable backwards.
    if (link.direction !== 3) reasonCodes.push(PATH_REASON.ONE_WAY);
    // Neither a self-loop nor a vertical transition with no horizontal step is walkable, but the source carries both,
    // so they are flagged and kept rather than failing the whole run.
    if (link.n1 === link.n2) reasonCodes.push(PATH_REASON.SELF_LOOP);
    else if (!(length > 0)) reasonCodes.push(PATH_REASON.ZERO_LENGTH);
    segments.push({ link_id_sha256: sha256(String(link.sourceId)), from_node_sha256: sha256(String(link.n1)), to_node_sha256: sha256(String(link.n2)),
      from_level_id: from.level_id, to_level_id: to.level_id, level_relation: levelRelation, direction: link.direction, dz_m: link.dz,
      from_east_m: from.east_m, from_north_m: from.north_m, to_east_m: to.east_m, to_north_m: to.north_m, length_m: length, reason_codes: reasonCodes });
  }
  // Hash order makes the private document reproducible regardless of the source array order.
  segments.sort((a, b) => a.link_id_sha256 < b.link_id_sha256 ? -1 : a.link_id_sha256 > b.link_id_sha256 ? 1 : 0);
  if (!segments.length) throw new Error('S03 paths: the navigation members carry no links; there is nothing walkable to emit');
  const sameLevel = segments.filter(segment => segment.level_relation === 'same_level').length;
  return {
    nodes, segments,
    counts: { nodes: nodes.length, links: inputs.links.length, segments: segments.length, same_level: sameLevel,
      cross_level: segments.length - sameLevel, directions: [1, 2, 3].map(direction => ({ direction, count: segments.filter(segment => segment.direction === direction).length })) },
    level_counts: [...levelById.values()].sort((a, b) => a.id - b.id).map(level => ({ level_id: level.id,
      nodes: nodes.filter(node => node.level_id === level.id).length,
      same_level_segments: segments.filter(segment => segment.level_relation === 'same_level' && segment.from_level_id === level.id).length })),
    reason_codes: (Object.values(PATH_REASON) as PathReason[])
      .map(code => ({ code, count: segments.filter(segment => segment.reason_codes.includes(code)).length })).filter(entry => entry.count > 0),
  };
}

export interface PathsDigestFacts {
  policy_version: string; tool_input_sha256: string; zip_sha256: string; station_json_sha256: string;
  floor_mapping_sha256: string; crs: string; publish_gate: string; sources_yaml_sha256: string;
}
/** Receipt identity: the facts object is hashed in this key order and truncated to 20 hex characters. */
export function pathsIdentity(facts: PathsDigestFacts) {
  const digest = sha256(JSON.stringify(facts)).slice(0, 20);
  return { digest_inputs: facts, digest, run_id: `paths-${digest}` };
}

/** The public receipt: counts, residual statistics and reason codes only. No coordinate, link hash or source label. */
export function buildPathsReceipt(args: {
  digest_inputs: PathsDigestFacts; digest: string; run_id: string; publish_gate: string; zip_sha256: string; crs: string;
  result: BuiltPaths; inputs: readonly { role: string; path: string; sha256: string }[];
  evidence: S03PathsEvidence;
  transform: { drawing_id: number; nav_member_sha256: string; map_member_sha256: string };
  private_output: { path: string; sha256: string; bytes: number };
}) {
  return {
    policy_version: S03_PATHS_POLICY,
    ...pathsIdentity(args.digest_inputs),
    source_id: S03_PATH_SOURCE_ID,
    source_sha256: args.zip_sha256,
    publish_gate: args.publish_gate,
    gteki_role: 'evidence',
    navigation_use: 'NOT_FOR_ROUTING',
    verification: 'UNVERIFIED',
    crs: { declared: args.crs, status: args.crs === CRS_UNKNOWN ? 'UNKNOWN' : 'DECLARED_UNVERIFIED', confirmed: false,
      rule: 'The S03 navigation members declare no CRS. This tool records the value it was given and confirms none: the datum stays UNKNOWN until the data research establishes it and a director ruling accepts it. A declared value is not a routing permission.' },
    counts: args.result.counts,
    reason_codes: args.result.reason_codes,
    segment_length_m: residualStats(args.result.segments.map(segment => segment.length_m)),
    level_counts: args.result.level_counts,
    transform: { ...args.transform, order: 'nav affine, then drawing affine, then horizontal station ENU; no fitted correction',
      scope: 'v5_nav.json only: the Path GeoJSON members carry their own UNKNOWN local frame and are never fed through this affine pair' },
    // The evidence behind the reason codes, quoted from docs/gis/crs/shinjuku-s03-v0.md; this tool does not recompute it.
    evidence: args.evidence,
    publication: { paths: 'HOLD', routing: 'HOLD',
      rule: 'The 2026-10-24 ruling covers 25 approximate points and 19 platform names only. Paths, connectors and routes are not cleared, no routing use is permitted, and nothing here is placed in stations/**.' },
    segment_rule: 'One segment per v5_nav.json link: both endpoint nodes transformed by the nav affine then the drawing affine, projected with the station ENU frame (GRS80, horizontal only, height 0); endpoints, length and the source link id hash stay in the private store. A cross-level link is one whose endpoints sit on different levels or whose dz is non-zero; the source names no stair, lift or escalator device, so the device stays UNKNOWN. A self-loop and a link whose endpoints share one horizontal position are kept and flagged SELF_LOOP / ZERO_LENGTH, never dropped. Every segment carries CHECK_A_CONTAINMENT_FAIL and CHECK_B_RESIDUAL_UNVERIFIED because the nodes it joins sit on geometry whose containment fails and whose datum is uncorrected.',
    labels_rule: 'Every record carries navigation_use NOT_FOR_ROUTING and verification UNVERIFIED with gteki_role evidence, on the document and on every node and segment. Nothing here is placed, verified or usable for routing.',
    public_receipt_rule: 'This receipt carries counts, residual statistics and reason codes only: no coordinate, no link or node hash, no level label and no other source value. Numeric ids follow the s03-transform-check precedent: level_counts[].level_id and the numeric transform.drawing_id are carried as numbers; entity and feature ids are not.',
    inputs: args.inputs.map(input => ({ role: input.role, path: input.path, sha256: input.sha256 })),
    outputs: { private: { store_path: args.private_output.path, sha256: args.private_output.sha256, bytes: args.private_output.bytes } },
  };
}

/**
 * Offline evidence only. The source gate and the placement HOLD are recorded, never read as permission to route or to
 * write `stations/**`. The CRS is an input with the default `UNKNOWN` and is never confirmed by this tool.
 */
export async function s03Paths(options: { crs?: string } = {}) {
  const crs = options.crs ?? CRS_UNKNOWN;
  if (typeof crs !== 'string' || !crs) throw new Error('S03 paths: the CRS input must be a non-empty string');
  const stored = await getStoredSource(S03_PATH_SOURCE_ID), zipBytes = await readFile(stored.path);
  assertS03Bytes(zipBytes, stored.record);
  const inputs = parseS03Members(await readZip(zipBytes, { legacyFileNameEncoding: 'shift_jis' }));
  const stationBytes = await readFile(join(repoRoot, S03_PATHS_STATION_PATH));
  const station = JSON.parse(stationBytes.toString('utf8')) as { station?: { origin?: { lat?: unknown; lon?: unknown; crs?: unknown } } };
  const origin = station.station?.origin;
  if (!origin || !finite(origin.lat) || !finite(origin.lon) || Math.abs(origin.lon) > 180 || Math.abs(origin.lat) > 90 || origin.crs !== 'EPSG:6668')
    throw new Error(`${S03_PATHS_STATION_PATH}: invalid station geographic origin`);
  const frame = stationEnuProjector({ lat: origin.lat, lon: origin.lon, hM: 0 });
  const project: Project = (lat, lon) => { const p = frame(lat, lon, 0); return [p[0], p[1]]; };
  const result = buildPaths(inputs, project);
  // The quoted residuals are tied to one ZIP and one population; anything else stops the run rather than shipping stale evidence.
  if (stored.record.sha256 !== S03_PATHS_EVIDENCE.source_zip_sha256)
    throw new Error(`S03 paths: the stored ZIP ${stored.record.sha256} is not the ${S03_PATHS_EVIDENCE.source_zip_sha256} the recorded residuals were measured on; rerun s03-transform-check first`);
  if (result.nodes.length !== S03_PATHS_EVIDENCE.node_count || result.counts.links !== S03_PATHS_EVIDENCE.link_count)
    throw new Error(`S03 paths: ${result.nodes.length} nodes and ${result.counts.links} links; the recorded evidence is ${S03_PATHS_EVIDENCE.node_count} nodes and ${S03_PATHS_EVIDENCE.link_count} links`);
  const sourcesBytes = await readFile(join(packageRoot, 'sources', 'sources.yaml'));
  const digestInputs: PathsDigestFacts = { policy_version: S03_PATHS_POLICY, tool_input_sha256: await toolFingerprint(),
    zip_sha256: stored.record.sha256, station_json_sha256: sha256(stationBytes),
    floor_mapping_sha256: floorMappingSha256(Object.entries(S03_FLOOR_ORDINALS).map(([id, ordinal]) => ({ id, ordinal }))),
    crs, publish_gate: stored.source.publish_gate, sources_yaml_sha256: sha256(sourcesBytes) };
  const identity = pathsIdentity(digestInputs);
  const privatePath = `out/s03/${identity.run_id}.json`;
  const privateDocument = {
    policy_version: S03_PATHS_POLICY, digest_inputs: digestInputs, digest: identity.digest, run_id: identity.run_id,
    source_id: S03_PATH_SOURCE_ID, source_record: stored.record, credit: S03_PATHS_CREDIT,
    labels: PATH_RECORD_LABELS,
    datum: { tool_input: crs, ...S03_DATUM },
    frame: { station_json_path: S03_PATHS_STATION_PATH, station_json_sha256: sha256(stationBytes), ellipsoid: 'GRS80',
      horizontal_calculation_height_m: 0, projected_datum_asserted: false,
      floor_mapping_rule: 'The S03 level label maps to a comparison ordinal by assertion, from the same map WP7 uses; the level mapping stays UNVERIFIED.' },
    level_mapping: S03_FLOOR_ORDINALS,
    evidence: S03_PATHS_EVIDENCE,
    publication: { paths: 'HOLD', routing: 'HOLD' },
    counts: result.counts, reason_codes: result.reason_codes, level_counts: result.level_counts,
    segment_length_m: residualStats(result.segments.map(segment => segment.length_m)),
    // Each record carries the restriction labels too, so a point lifted out of the file cannot be read as a route.
    nodes: result.nodes.map(node => ({ ...node, labels: PATH_RECORD_LABELS })),
    segments: result.segments.map(segment => ({ ...segment, labels: PATH_RECORD_LABELS })),
  };
  // Exactly the bytes writeJson writes below, so the receipt hash describes the stored file.
  const privateText = `${JSON.stringify(privateDocument, null, 2)}\n`;
  const receipt = buildPathsReceipt({ digest_inputs: digestInputs, digest: identity.digest, run_id: identity.run_id,
    publish_gate: stored.source.publish_gate, zip_sha256: stored.record.sha256, crs, result,
    evidence: S03_PATHS_EVIDENCE,
    transform: { drawing_id: inputs.drawingId, nav_member_sha256: inputs.navSha256, map_member_sha256: inputs.mapSha256 },
    inputs: [{ role: 'station', path: S03_PATHS_STATION_PATH, sha256: sha256(stationBytes) }],
    private_output: { path: privatePath, sha256: sha256(privateText), bytes: Buffer.byteLength(privateText) } });
  // Validate the entire public receipt before writing any output.
  assertNoSourceValues(JSON.stringify(receipt), inputs.sourceValues, 'The public S03 paths receipt');
  await writeJson(join(getStoreRoot(), privatePath), privateDocument);
  const receiptPath = `docs/gis/s03/${identity.run_id}.json`;
  await writeJson(join(repoRoot, receiptPath), receipt);
  return { ...receipt, receipt_path: receiptPath };
}
