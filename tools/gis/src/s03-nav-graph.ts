import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { getStoredSource, getStoreRoot, packageRoot, repoRoot, writeJson } from './common.js';
import { assertNoSourceValues } from './context-overlay.js';
import { parseS03EntityId } from './s03-positions.js';
import { PATH_RECORD_LABELS, PATH_REASON, S03_PATHS_EVIDENCE, S03_PATHS_STATION_PATH, buildPaths, type PathInputs } from './s03-paths.js';
import { stationEnuProjector } from './station-enu.js';
import { toolFingerprint } from './provenance.js';
import { readZip, type ZipEntry } from './zip.js';
import {
  S03_DATUM, S03_FLOOR_ORDINALS, assertS03Bytes, floorMappingSha256, nodeCheckA, parseS03Members, residualStats,
  type NodeCheckA, type Point2, type Project, type S03Level,
} from './s03-transform.js';

/**
 * Held S03 walk graph: the `v5_nav.json` nodes and links of `tokyo-s03-zip`, through the same nav affine, drawing affine
 * and station ENU projection as `s03-paths`, plus the gate/operator tag a node's own level attribute supports. Nothing
 * here ships: the graph is written to the private store and its receipt to `docs/gis/s03/`, and no record enters
 * `stations/**`, route results or the web bundle. The 2026-10-24 ruling covers 25 approximate points and 19 platform
 * names only; paths, connectors, graphs and routes stay HOLD.
 */
export const S03_NAV_GRAPH_POLICY = 's03-nav-graph-v1';
export const S03_NAV_GRAPH_SOURCE_ID = 'tokyo-s03-zip';
/** Read-only: the station origin the ENU frame comes from. This tool never writes `stations/**`. */
export const NAV_GRAPH_STATION_PATH = S03_PATHS_STATION_PATH;
/** The reviewed 45-POI line record: the only source that says which operator a `v5_nav.json` node's geometry belongs to. */
export const NAV_GRAPH_GATE_SOURCE_PATH = 'docs/research/lines/shinjuku-line-pois.json';
export const NAV_GRAPH_CREDIT = '出典：東京都都市整備局「新宿駅周辺の施設情報等」';
export const NAV_GRAPH_LABELS = PATH_RECORD_LABELS;
/** The one level dropped whole: it fails Check A at 0.917355 against the 95% rule (docs/gis/crs/shinjuku-s03-v0.md). */
export const DROPPED_LEVELS: readonly { level_id: number; reason: string; evidence: { inside_count: number; node_count: number; inside_share: number } }[] =
  [{ level_id: 64677, reason: PATH_REASON.CHECK_A_CONTAINMENT_FAIL, evidence: { inside_count: 333, node_count: 363, inside_share: 0.917355 } }];
/** A Path GeoJSON member: `crs: null`, an UNKNOWN local frame, never a graph input. */
export const PATH_GEOJSON_MEMBER = /^path-level-geom-.*\.geojson$/i;
/** The members a graph run may read: the nav member, its drawing map, and the level geometry the parser needs for Check A's inputs. */
export const NAV_GRAPH_MEMBER = /^(?:v5_nav\.json|com-map\.geojson|com-entity\.geojson|geojson-level-geom-.*\.geojson)$/i;
/** The three operator areas the graph is built for; a tag on another operator is kept and counted, not dropped. */
export const NAV_GRAPH_OPERATORS = ['jreast', 'odakyu', 'keio'] as const;

const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Refuse a Path GeoJSON member anywhere in a graph input. Its frame is UNKNOWN (`crs: null`); drawing-local is an
 * unverified hypothesis, so feeding it through the nav affine pair would transform it twice if it already is
 * drawing-local. The graph is built from `v5_nav.json` only (docs/gis/s03/paths-import-contract.md).
 */
export function assertNoPathGeojson(names: readonly string[]): void {
  for (const name of names) {
    const base = basename(name);
    if (PATH_GEOJSON_MEMBER.test(base))
      throw new Error(`S03 nav graph: refusing Path GeoJSON member ${base}: its frame is UNKNOWN (crs: null) and it is not a graph input; build the graph from v5_nav.json only`);
  }
}
/**
 * The member selection a graph run parses. Path GeoJSON is excluded before any parsing, and the selection re-derives
 * from the selected names that no Path member survived: a widened selector fails closed instead of reading one.
 */
export function selectNavGraphMembers<T extends { name: string }>(entries: readonly T[]): { members: T[]; excluded_path_members: number } {
  const members = entries.filter(entry => NAV_GRAPH_MEMBER.test(basename(entry.name)));
  assertNoPathGeojson(members.map(entry => entry.name));
  if (!members.some(entry => /^v5_nav\.json$/i.test(basename(entry.name)))) throw new Error('S03 nav graph: the input carries no v5_nav.json member');
  // Count Path members specifically, so an unrelated extra archive member cannot read as a Path exclusion.
  return { members, excluded_path_members: entries.filter(entry => PATH_GEOJSON_MEMBER.test(basename(entry.name))).length };
}

/**
 * Read the archive with the selector applied inside `readZip`, so every member the graph does not take is skipped by the
 * reader and never decompressed: a Path GeoJSON member's bytes, corrupt or not, are never opened or parsed. The Path
 * count comes from the names the reader skipped, since the returned entries no longer carry them; the selection then
 * re-checks that no Path member survived and that `v5_nav.json` is present.
 */
export async function readNavGraphMembers(zipBytes: Buffer): Promise<{ members: ZipEntry[]; excluded_path_members: number }> {
  let excludedPathMembers = 0;
  const entries = await readZip(zipBytes, {
    legacyFileNameEncoding: 'shift_jis',
    include: (name) => {
      const base = basename(name);
      if (PATH_GEOJSON_MEMBER.test(base)) { excludedPathMembers += 1; return false; }
      return NAV_GRAPH_MEMBER.test(base);
    },
  });
  return { members: selectNavGraphMembers(entries).members, excluded_path_members: excludedPathMembers };
}

/**
 * Write the held document under the private store and nowhere else. The directory is created, then the destination's
 * real path is checked against the real store root, so an `out/s03` symlink into `stations/**` or the web bundle is
 * refused instead of followed.
 */
export async function writeHeldDocument(storeRoot: string, relativePath: string, value: unknown): Promise<string> {
  const full = join(storeRoot, relativePath);
  await mkdir(dirname(full), { recursive: true });
  const [root, directory] = await Promise.all([realpath(storeRoot), realpath(dirname(full))]);
  const resolved = relative(root, join(directory, basename(full)));
  if (!resolved || resolved.startsWith('..') || isAbsolute(resolved))
    throw new Error(`S03 nav graph: the private output ${relativePath} resolves outside the store; refusing to write a held record at ${join(directory, basename(full))}`);
  await writeJson(full, value);
  return full;
}

/** The identity a `v5_nav.json` node's own attributes support: its level-entry geometry id, joined to a reviewed POI. */
export interface S03GateTag { poi_id: string; operator_ids: readonly string[]; line: string | null; name: string }

const jaNames = (names: unknown): string[] => !Array.isArray(names) ? [] : names.flatMap(name =>
  record(name) && name.lang === 'ja' && typeof name.text === 'string' ? [name.text] : []);

/**
 * Join the reviewed POI record by the entity id it records, which is the id a node's `l[].gid` points at. The source
 * writes no line, operator or gate field on a node or a link, so this join is the only tag a node carries: a node whose
 * geometry id is absent or matches no entry stays untagged, and nothing is attributed from name text or proximity.
 */
export function loadGateTags(document: unknown): Map<number, S03GateTag> {
  const pois = record(document) && Array.isArray(document.pois) ? document.pois : null;
  if (!pois) throw new Error(`${NAV_GRAPH_GATE_SOURCE_PATH}: expected a pois array`);
  const tags = new Map<number, S03GateTag>();
  for (const poi of pois) {
    if (!record(poi) || typeof poi.id !== 'string' || !poi.id) throw new Error(`${NAV_GRAPH_GATE_SOURCE_PATH}: POI without a string id`);
    if (!record(poi.s03) || poi.s03.entityId === undefined) continue;
    const entityId = parseS03EntityId(poi.s03.entityId, poi.id);
    if (tags.has(entityId)) throw new Error(`${NAV_GRAPH_GATE_SOURCE_PATH}: duplicate s03 entity ${entityId} (${poi.id})`);
    const names = jaNames(poi.names);
    if (names.length !== 1) throw new Error(`${poi.id}: expected exactly one ja name`);
    const operatorIds = Array.isArray(poi.operatorIds) ? poi.operatorIds.filter((id): id is string => typeof id === 'string') : [];
    tags.set(entityId, { poi_id: poi.id, operator_ids: operatorIds, line: typeof poi.line === 'string' ? poi.line : null, name: names[0]! });
  }
  return tags;
}

export interface NavGraphNode {
  source_id: number; level_id: number; level_label: string; floor_ordinal: number;
  lon: number; lat: number; east_m: number; north_m: number; gate: S03GateTag | null; check_a: NodeCheckA;
}
/** Check A per level: nodes by their own footprint test, edges charged to the level of their from-node (the dropped-level rule). */
export interface CheckALevel { level_id: number; nodes_pass: number; nodes_fail: number; nodes_unassessed: number; edges_pass: number; edges_fail: number }
export interface NavGraphEdge {
  link_id: number; from_node: number; to_node: number; direction: number; dz_m: number | null;
  length_m: number; level_relation: 'same_level' | 'cross_level'; reason_codes: string[];
}
export interface DroppedLevel { level_id: number; reason: string; nodes: number; edges: number; evidence: { inside_count: number; node_count: number; inside_share: number } }
export interface BuiltNavGraph {
  nodes: NavGraphNode[]; edges: NavGraphEdge[];
  counts: {
    source_nodes: number; nodes: number; source_links: number; edges: number;
    dropped_nodes: number; dropped_edges: number; tagged_nodes: number; untagged_nodes: number;
    isolated_nodes: number; same_level_edges: number; cross_level_edges: number;
    directions: { direction: number; count: number }[];
  };
  dropped: DroppedLevel[];
  check_a: { nodes: Record<NodeCheckA, number>; edges: { pass: number; fail: number }; levels: CheckALevel[] };
  /** Nothing else is dropped: every remaining link stays with its reason codes. This says so in the receipt. */
  other_drops: readonly never[];
  line_counts: { operator_id: string; nodes: number; edges: number }[];
}

/** The graph inputs: the path transform's inputs plus the geometry-id tags, so nodes and edges come from v5_nav only. */
export interface NavGraphInputs extends PathInputs { gateTags: ReadonlyMap<number, S03GateTag>; levels: S03Level[] }

/**
 * Build the held walk graph. Levels, nodes and links are the path transform's own: the same affines, the same projection,
 * the same level relation, direction and reason codes, so the two tools cannot disagree about a link. On top of that the
 * builder drops the levels that fail Check A (64677) with every node on them and every edge that touches one, and tags a
 * node from its geometry id where a reviewed gate/platform entry claims it.
 */
export function buildNavGraph(inputs: NavGraphInputs, project: Project): BuiltNavGraph {
  const paths = buildPaths(inputs, project);
  const checkA = nodeCheckA(inputs, project);
  const geometryById = new Map(inputs.nodes.map(node => [node.sourceId, node.geometryId]));
  const nodeIdByHash = new Map(inputs.nodes.map(node => [sha256(String(node.sourceId)), node.sourceId]));
  const linkIdByHash = new Map(inputs.links.map(link => [sha256(String(link.sourceId)), link.sourceId]));
  const levelById = new Map(paths.nodes.map(node => [node.source_id, node.level_id]));
  const droppedLevels = DROPPED_LEVELS.map(dropped => dropped.level_id);
  const dropped = new Set(paths.nodes.filter(node => droppedLevels.includes(node.level_id)).map(node => node.source_id));
  const edges: NavGraphEdge[] = [], droppedEdgeOwner: number[] = [];
  for (const segment of paths.segments) {
    // buildPaths resolved both endpoints against its own v5_nav node table, so a miss here is a wiring error.
    const from = nodeIdByHash.get(segment.from_node_sha256), to = nodeIdByHash.get(segment.to_node_sha256);
    if (from === undefined || to === undefined) throw new Error('S03 nav graph: a segment endpoint is not a v5_nav node');
    if (dropped.has(from) || dropped.has(to)) {
      const fromLevel = levelById.get(from), toLevel = levelById.get(to);
      droppedEdgeOwner.push(droppedLevels.includes(fromLevel!) ? fromLevel! : toLevel!);
      continue;
    }
    const linkId = linkIdByHash.get(segment.link_id_sha256);
    if (linkId === undefined) throw new Error('S03 nav graph: a segment is not a v5_nav link');
    // Check A clears its code only when both endpoints pass their own footprint test; every other code stays as the path transform set it.
    const bothInside = checkA.get(from) === 'PASS' && checkA.get(to) === 'PASS';
    edges.push({ link_id: linkId, from_node: from, to_node: to, direction: segment.direction, dz_m: segment.dz_m,
      length_m: segment.length_m, level_relation: segment.level_relation,
      reason_codes: segment.reason_codes.filter(code => !(bothInside && code === PATH_REASON.CHECK_A_CONTAINMENT_FAIL)) });
  }
  // Link order keeps the private document readable and the output independent of the path transform's hash ordering.
  edges.sort((a, b) => a.link_id - b.link_id);
  const nodes: NavGraphNode[] = paths.nodes.filter(node => !dropped.has(node.source_id)).map(node => ({
    source_id: node.source_id, level_id: node.level_id, level_label: node.level_label, floor_ordinal: node.floor_ordinal,
    lon: node.lon, lat: node.lat, east_m: node.east_m, north_m: node.north_m, check_a: checkA.get(node.source_id)!,
    gate: geometryById.get(node.source_id) === null || geometryById.get(node.source_id) === undefined
      ? null : inputs.gateTags.get(geometryById.get(node.source_id)!) ?? null,
  }));
  const incident = new Map<number, number>();
  for (const edge of edges) {
    incident.set(edge.from_node, (incident.get(edge.from_node) ?? 0) + 1);
    incident.set(edge.to_node, (incident.get(edge.to_node) ?? 0) + 1);
  }
  const nodeById = new Map(nodes.map(node => [node.source_id, node]));
  const taggedNodes = nodes.filter(node => node.gate).length;
  return {
    nodes, edges,
    counts: {
      source_nodes: inputs.nodes.length, nodes: nodes.length, source_links: inputs.links.length, edges: edges.length,
      dropped_nodes: dropped.size, dropped_edges: droppedEdgeOwner.length,
      tagged_nodes: taggedNodes, untagged_nodes: nodes.length - taggedNodes,
      isolated_nodes: nodes.filter(node => !incident.has(node.source_id)).length,
      same_level_edges: edges.filter(edge => edge.level_relation === 'same_level').length,
      cross_level_edges: edges.filter(edge => edge.level_relation === 'cross_level').length,
      directions: [1, 2, 3].map(direction => ({ direction, count: edges.filter(edge => edge.direction === direction).length })),
    },
    // A dropped edge is charged to the dropped level one of its endpoints sits on, so the counts per level add up.
    check_a: checkASummary(nodes, edges, levelById),
    dropped: DROPPED_LEVELS.map(level => ({ ...level,
      nodes: paths.nodes.filter(node => node.level_id === level.level_id).length,
      edges: droppedEdgeOwner.filter(owner => owner === level.level_id).length })),
    other_drops: [],
    line_counts: lineCounts(nodes, edges, nodeById),
  };
}

/** Check A counts: a node passes or fails its own footprint; an edge passes only when it no longer carries the code, i.e. both ends pass. */
function checkASummary(nodes: readonly NavGraphNode[], edges: readonly NavGraphEdge[], levelById: ReadonlyMap<number, number>): BuiltNavGraph['check_a'] {
  const count = (values: readonly NodeCheckA[], value: NodeCheckA) => values.filter(entry => entry === value).length;
  const levels = [...new Set(nodes.map(node => node.level_id))].sort((a, b) => a - b).map(levelId => {
    const levelNodes = nodes.filter(node => node.level_id === levelId).map(node => node.check_a);
    const levelEdges = edges.filter(edge => levelById.get(edge.from_node) === levelId);
    return { level_id: levelId, nodes_pass: count(levelNodes, 'PASS'), nodes_fail: count(levelNodes, 'FAIL'), nodes_unassessed: count(levelNodes, 'UNASSESSED'),
      edges_pass: levelEdges.filter(edge => !edge.reason_codes.includes(PATH_REASON.CHECK_A_CONTAINMENT_FAIL)).length,
      edges_fail: levelEdges.filter(edge => edge.reason_codes.includes(PATH_REASON.CHECK_A_CONTAINMENT_FAIL)).length };
  });
  const nodeChecks = nodes.map(node => node.check_a);
  return { nodes: { PASS: count(nodeChecks, 'PASS'), FAIL: count(nodeChecks, 'FAIL'), UNASSESSED: count(nodeChecks, 'UNASSESSED') },
    edges: { pass: edges.filter(edge => !edge.reason_codes.includes(PATH_REASON.CHECK_A_CONTAINMENT_FAIL)).length,
      fail: edges.filter(edge => edge.reason_codes.includes(PATH_REASON.CHECK_A_CONTAINMENT_FAIL)).length }, levels };
}

/**
 * Counts per operator area: the nodes a reviewed entry tags with that operator, and the edges incident to one of them.
 * A tag with two operators counts in both; every node without a resolvable tag stays untagged and out of these counts.
 */
function lineCounts(nodes: readonly NavGraphNode[], edges: readonly NavGraphEdge[], nodeById: ReadonlyMap<number, NavGraphNode>): { operator_id: string; nodes: number; edges: number }[] {
  const operators = new Set<string>();
  for (const node of nodes) for (const operator of node.gate?.operator_ids ?? []) operators.add(operator);
  // The three named areas first, in the ruling's order, then any other operator alphabetically.
  const rank = (operator: string): number => {
    const index = (NAV_GRAPH_OPERATORS as readonly string[]).indexOf(operator);
    return index === -1 ? NAV_GRAPH_OPERATORS.length : index;
  };
  const ordered = [...operators].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  return ordered.map(operator => ({
    operator_id: operator,
    nodes: nodes.filter(node => (node.gate?.operator_ids ?? []).includes(operator)).length,
    edges: edges.filter(edge => [edge.from_node, edge.to_node].some(id => (nodeById.get(id)?.gate?.operator_ids ?? []).includes(operator))).length,
  }));
}

export interface NavGraphDigestFacts {
  policy_version: string; tool_input_sha256: string; zip_sha256: string; station_json_sha256: string;
  floor_mapping_sha256: string; gate_source_sha256: string; crs: string; publish_gate: string; sources_yaml_sha256: string;
}
export function navGraphIdentity(facts: NavGraphDigestFacts) {
  const digest = sha256(JSON.stringify(facts)).slice(0, 20);
  return { digest_inputs: facts, digest, run_id: `nav-graph-${digest}` };
}

/** The public receipt: counts, dropped level ids and reason codes only. No coordinate, node or link id, gate name or level label. */
export function buildNavGraphReceipt(args: {
  digest_inputs: NavGraphDigestFacts; digest: string; run_id: string; publish_gate: string; zip_sha256: string; crs: string;
  result: BuiltNavGraph; excluded_path_members: number; inputs: readonly { role: string; path: string; sha256: string }[];
  transform: { drawing_id: number; nav_member_sha256: string; map_member_sha256: string };
  private_output: { path: string; sha256: string; bytes: number };
}) {
  return {
    policy_version: S03_NAV_GRAPH_POLICY,
    ...navGraphIdentity(args.digest_inputs),
    source_id: S03_NAV_GRAPH_SOURCE_ID,
    source_sha256: args.zip_sha256,
    publish_gate: args.publish_gate,
    gteki_role: 'evidence',
    navigation_use: 'NOT_FOR_ROUTING',
    verification: 'UNVERIFIED',
    crs: { declared: args.crs, status: args.crs === 'UNKNOWN' ? 'UNKNOWN' : 'DECLARED_UNVERIFIED', confirmed: false,
      rule: 'The S03 navigation members declare no CRS. The datum stays UNKNOWN until the data research establishes it and a director ruling accepts it; a graph built here routes nothing.' },
    counts: args.result.counts,
    line_counts: args.result.line_counts,
    dropped_levels: args.result.dropped,
    check_a: { ...args.result.check_a,
      rule: 'Check A per node: each node is tested against the footprint of its own level (the same polygons and containment rule as the transform check). An edge keeps CHECK_A_CONTAINMENT_FAIL unless both its endpoints pass; a node on a level with no usable polygon is UNASSESSED and keeps the code. Per-level edge counts charge an edge to the level of its from-node.' },
    other_drops: args.result.other_drops,
    edge_length_m: residualStats(args.result.edges.map(edge => edge.length_m)),
    reason_codes: Object.values(PATH_REASON).map(code => ({ code, count: args.result.edges.filter(edge => edge.reason_codes.includes(code)).length }))
      .filter(entry => entry.count > 0),
    members: { excluded_path_geojson: args.excluded_path_members,
      rule: 'The Path GeoJSON members of the archive are never read here: their frame is UNKNOWN (crs: null), so they are excluded before parsing and a Path member in the selection fails the run closed.' },
    transform: { ...args.transform, order: 'nav affine, then drawing affine, then horizontal station ENU; no fitted correction',
      scope: 'v5_nav.json only: nodes and links come from that member alone; the Path GeoJSON members carry their own UNKNOWN local frame' },
    evidence: S03_PATHS_EVIDENCE,
    publication: { graph: 'HOLD', paths: 'HOLD', routing: 'HOLD',
      release_condition: 'CRS evidence for the path frame is obtained AND the data lead signs off; until then nothing here is published, placed, routed on or bundled.',
      rule: 'The 2026-10-24 ruling covers 25 approximate points and 19 platform names only. This graph is written to the private store and this receipt; no record enters stations/**, route results or the web bundle.' },
    node_rule: 'One node per v5_nav.json node not on a dropped level: both affines applied to mx/my, then projected with the station ENU frame (GRS80, horizontal only, height 0). A node is tagged only from its own level-entry geometry id joined to a reviewed gate, transfer or platform entry; no line, operator or gate field exists on a node or link, so every untagged node stays UNKNOWN. Nothing is attributed by name text or proximity.',
    edge_rule: 'One edge per v5_nav.json link whose endpoints both survive the level drop: direction 1/2/3, dz, the straight-line ENU length, the level relation and the reason codes come from the path transform, except CHECK_A_CONTAINMENT_FAIL, which is cleared where both endpoints pass their own footprint test. So a cross-level edge keeps CROSS_LEVEL_DEVICE_UNKNOWN and a one-way edge keeps ONE_WAY. Self-loops and zero-length edges are kept and flagged, never dropped.',
    drop_rule: 'Level 64677 is dropped whole with its nodes and every edge touching one, because it fails Check A at 0.917355 against the fixed 95% rule. No other record is dropped; every surviving link keeps its reason codes.',
    labels_rule: 'Every node and edge record carries navigation_use NOT_FOR_ROUTING, verification UNVERIFIED and gteki_role evidence, on the document and on each record.',
    public_receipt_rule: 'This receipt carries counts, dropped numeric level ids, reason codes, length statistics and member counts only: no coordinate, no node or link id, no gate name and no level label. Numeric level ids follow the s03-transform-check precedent.',
    inputs: args.inputs.map(input => ({ role: input.role, path: input.path, sha256: input.sha256 })),
    outputs: { private: { store_path: args.private_output.path, sha256: args.private_output.sha256, bytes: args.private_output.bytes } },
  };
}

/**
 * Offline evidence only. The graph and its receipt are the whole output; `stations/**`, the route results and the web
 * bundle are never written. Unlike the path transform there is no CRS input: a walk graph has no use for a declared
 * label, and the datum stays UNKNOWN regardless.
 */
export async function s03NavGraph() {
  const stored = await getStoredSource(S03_NAV_GRAPH_SOURCE_ID), zipBytes = await readFile(stored.path);
  assertS03Bytes(zipBytes, stored.record);
  const { members, excluded_path_members } = await readNavGraphMembers(zipBytes);
  const inputs = parseS03Members(members);
  const stationBytes = await readFile(join(repoRoot, NAV_GRAPH_STATION_PATH));
  const station = JSON.parse(stationBytes.toString('utf8')) as { station?: { origin?: { lat?: unknown; lon?: unknown; crs?: unknown } } };
  const origin = station.station?.origin;
  if (!origin || typeof origin.lat !== 'number' || !Number.isFinite(origin.lat) || typeof origin.lon !== 'number' || !Number.isFinite(origin.lon)
    || Math.abs(origin.lon) > 180 || Math.abs(origin.lat) > 90 || origin.crs !== 'EPSG:6668')
    throw new Error(`${NAV_GRAPH_STATION_PATH}: invalid station geographic origin`);
  const frame = stationEnuProjector({ lat: origin.lat, lon: origin.lon, hM: 0 });
  const project: Project = (lat, lon) => { const p = frame(lat, lon, 0); return [p[0], p[1]] as Point2; };
  const gateBytes = await readFile(join(repoRoot, NAV_GRAPH_GATE_SOURCE_PATH));
  const gateTags = loadGateTags(JSON.parse(gateBytes.toString('utf8')));
  const result = buildNavGraph({ ...inputs, gateTags }, project);
  // The quoted residuals are tied to one ZIP and one population; anything else stops the run rather than shipping stale evidence.
  if (stored.record.sha256 !== S03_PATHS_EVIDENCE.source_zip_sha256)
    throw new Error(`S03 nav graph: the stored ZIP ${stored.record.sha256} is not the ${S03_PATHS_EVIDENCE.source_zip_sha256} the recorded residuals were measured on; rerun s03-transform-check first`);
  if (inputs.nodes.length !== S03_PATHS_EVIDENCE.node_count || inputs.links.length !== S03_PATHS_EVIDENCE.link_count)
    throw new Error(`S03 nav graph: ${inputs.nodes.length} nodes and ${inputs.links.length} links; the recorded evidence is ${S03_PATHS_EVIDENCE.node_count} nodes and ${S03_PATHS_EVIDENCE.link_count} links`);
  const sourcesBytes = await readFile(join(packageRoot, 'sources', 'sources.yaml'));
  const digestInputs: NavGraphDigestFacts = { policy_version: S03_NAV_GRAPH_POLICY, tool_input_sha256: await toolFingerprint(),
    zip_sha256: stored.record.sha256, station_json_sha256: sha256(stationBytes),
    floor_mapping_sha256: floorMappingSha256(Object.entries(S03_FLOOR_ORDINALS).map(([id, ordinal]) => ({ id, ordinal }))),
    gate_source_sha256: sha256(gateBytes), crs: 'UNKNOWN', publish_gate: stored.source.publish_gate, sources_yaml_sha256: sha256(sourcesBytes) };
  const identity = navGraphIdentity(digestInputs);
  const privatePath = `out/s03/${identity.run_id}.json`;
  const privateDocument = {
    policy_version: S03_NAV_GRAPH_POLICY, digest_inputs: digestInputs, digest: identity.digest, run_id: identity.run_id,
    source_id: S03_NAV_GRAPH_SOURCE_ID, source_record: stored.record, credit: NAV_GRAPH_CREDIT, labels: NAV_GRAPH_LABELS,
    datum: { tool_input: 'UNKNOWN', ...S03_DATUM },
    frame: { station_json_path: NAV_GRAPH_STATION_PATH, station_json_sha256: sha256(stationBytes), ellipsoid: 'GRS80',
      horizontal_calculation_height_m: 0, projected_datum_asserted: false },
    gate_source: { path: NAV_GRAPH_GATE_SOURCE_PATH, sha256: sha256(gateBytes),
      rule: 'A node is tagged only where its own level-entry geometry id is the entity id of a reviewed gate, transfer or platform entry. The source writes no line, operator or gate field on a node or link; an untagged node stays UNKNOWN.' },
    publication: { graph: 'HOLD', paths: 'HOLD', routing: 'HOLD' },
    counts: result.counts, line_counts: result.line_counts, dropped_levels: result.dropped, check_a: result.check_a, other_drops: result.other_drops,
    reason_codes: Object.values(PATH_REASON).map(code => ({ code, count: result.edges.filter(edge => edge.reason_codes.includes(code)).length })).filter(entry => entry.count > 0),
    edge_length_m: residualStats(result.edges.map(edge => edge.length_m)),
    nodes: result.nodes.map(node => ({ ...node, labels: NAV_GRAPH_LABELS })),
    edges: result.edges.map(edge => ({ ...edge, labels: NAV_GRAPH_LABELS })),
  };
  const privateText = `${JSON.stringify(privateDocument, null, 2)}\n`;
  const receipt = buildNavGraphReceipt({ digest_inputs: digestInputs, digest: identity.digest, run_id: identity.run_id,
    publish_gate: stored.source.publish_gate, zip_sha256: stored.record.sha256, crs: 'UNKNOWN', result, excluded_path_members,
    transform: { drawing_id: inputs.drawingId, nav_member_sha256: inputs.navSha256, map_member_sha256: inputs.mapSha256 },
    inputs: [{ role: 'station', path: NAV_GRAPH_STATION_PATH, sha256: sha256(stationBytes) },
      { role: 'gate_identity', path: NAV_GRAPH_GATE_SOURCE_PATH, sha256: sha256(gateBytes) }],
    private_output: { path: privatePath, sha256: sha256(privateText), bytes: Buffer.byteLength(privateText) } });
  assertNoSourceValues(JSON.stringify(receipt), inputs.sourceValues, 'The public S03 nav graph receipt');
  await writeHeldDocument(getStoreRoot(), privatePath, privateDocument);
  const receiptPath = `docs/gis/s03/${identity.run_id}.json`;
  await writeJson(join(repoRoot, receiptPath), receipt);
  return { ...receipt, receipt_path: receiptPath };
}
