import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getStoreRoot, repoRoot, writeJson } from './common.js';
import {
  NAV_GRAPH_OPERATORS, S03_NAV_GRAPH_POLICY, writeHeldDocument, type S03GateTag,
} from './s03-nav-graph.js';
import { PATH_REASON } from './s03-paths.js';

/**
 * Held S03 walk routing: consumes a graph an `s03-nav-graph` run already wrote to the private store and routes only on
 * that graph's `v5_nav` edges between JR, Odakyu and Keio gate-tagged nodes. It recomputes nothing, never reads a Path
 * GeoJSON member, and stays off by default: it refuses unless `--held-diagnostic` is passed, and any edge carrying a
 * reason code refuses the route. Nothing here ships: the route document goes to the private store and the repository
 * gets a counts-only receipt. The 2026-10-24 ruling covers 25 approximate points and 19 platform names only; paths,
 * connectors, graphs and routes stay HOLD.
 */
export const S03_NAV_ROUTE_POLICY = 's03-nav-graph-route-v1';
/** The explicit opt-in: without it the command refuses before it reads anything. */
export const S03_NAV_ROUTE_FLAG = '--held-diagnostic';
/** Record labels every node, edge and result carries. */
export const NAV_ROUTE_LABELS = { navigation_use: 'NOT_FOR_ROUTING', verification: 'UNVERIFIED', gteki_role: 'evidence' } as const;
/** The unmet release condition the receipt records next to the consumed run. */
export const NAV_ROUTE_RELEASE_CONDITION = 'CRS evidence for the path frame is obtained AND the data lead signs off; until then nothing here is published, placed, routed on or bundled.';
/** The run ids `s03-nav-graph` writes: `nav-graph-` plus the first 20 hex characters of its digest. */
export const NAV_GRAPH_RUN_ID = /^nav-graph-[0-9a-f]{20}$/;

const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A node as the held `s03-nav-graph` document carries it. */
export interface HeldGraphNode {
  source_id: number; level_id: number; level_label: string; floor_ordinal: number;
  lon: number; lat: number; east_m: number; north_m: number; gate: S03GateTag | null;
}
/** An edge as the held `s03-nav-graph` document carries it. */
export interface HeldGraphEdge {
  link_id: number; from_node: number; to_node: number; direction: number; dz_m: number | null;
  length_m: number; level_relation: 'same_level' | 'cross_level'; reason_codes: string[];
}
export interface HeldGraphDocument {
  policy_version: string; digest: string; run_id: string; source_id: string;
  source_record?: { sha256?: unknown }; publish_gate?: unknown; digest_inputs?: { publish_gate?: unknown };
  publication?: { routing?: unknown };
  nodes: HeldGraphNode[]; edges: HeldGraphEdge[];
}

/** Refuse a run id that is not one `s03-nav-graph` writes, before it is joined into a path. */
export function assertRunId(runId: string): string {
  if (!NAV_GRAPH_RUN_ID.test(runId)) throw new Error(`S03 nav route: refusing run id ${JSON.stringify(runId)}: expected a nav-graph-<20 hex> id`);
  return runId;
}

/** The held document is only usable while it says it is held and the run id matches its own digest. */
export function assertHeldGraph(document: unknown): HeldGraphDocument {
  if (!record(document)) throw new Error('S03 nav route: the held graph document is not an object');
  if (document.policy_version !== S03_NAV_GRAPH_POLICY) throw new Error(`S03 nav route: the held graph is ${String(document.policy_version)}, not ${S03_NAV_GRAPH_POLICY}`);
  if (typeof document.run_id !== 'string' || !NAV_GRAPH_RUN_ID.test(document.run_id)) throw new Error('S03 nav route: the held graph carries no nav-graph run id');
  if (document.run_id !== `nav-graph-${String(document.digest)}`) throw new Error('S03 nav route: the held graph run id does not match its digest');
  if (!record(document.publication) || document.publication.routing !== 'HOLD')
    throw new Error('S03 nav route: the graph does not declare routing HOLD; refusing to route on it');
  if (!Array.isArray(document.nodes) || !Array.isArray(document.edges)) throw new Error('S03 nav route: the held graph carries no nodes or no edges');
  for (const node of document.nodes as unknown[])
    if (!record(node) || !finite(node.source_id) || !finite(node.east_m) || !finite(node.north_m))
      throw new Error('S03 nav route: a held graph node has no numeric id or position');
  for (const edge of document.edges as unknown[])
    if (!record(edge) || !finite(edge.link_id) || !finite(edge.from_node) || !finite(edge.to_node) || !finite(edge.length_m)
      || !Array.isArray(edge.reason_codes) || ![1, 2, 3].includes(edge.direction as number))
      throw new Error('S03 nav route: a held graph edge is malformed');
  // Dijkstra needs non-negative weights: a negative length would spin the predecessor chain instead of ending it.
  for (const edge of document.edges as { length_m: number }[])
    if (edge.length_m < 0) throw new Error('S03 nav route: a held graph edge has a negative length');
  return document as unknown as HeldGraphDocument;
}

/**
 * Read one held run from the private store and nowhere else. The path is built from the validated run id, the read is
 * relative to the store root, and the document's own run id and digest must agree with the requested run.
 */
export async function loadHeldGraph(runId: string, storeRoot: string = getStoreRoot()): Promise<{ document: HeldGraphDocument; sha256: string; store_path: string }> {
  assertRunId(runId);
  const storePath = `out/s03/${runId}.json`;
  const bytes = await readFile(join(storeRoot, storePath));
  const document = assertHeldGraph(JSON.parse(bytes.toString('utf8')));
  if (document.run_id !== runId) throw new Error(`S03 nav route: ${runId} holds ${document.run_id}; refusing a mismatched run`);
  return { document, sha256: sha256(bytes), store_path: storePath };
}

/** A gate node: its own reviewed tag names one of the three operator areas this route scope covers. */
export function gateNodesInScope(document: HeldGraphDocument): Map<number, S03GateTag> {
  const gates = new Map<number, S03GateTag>();
  for (const node of document.nodes)
    if (node.gate && node.gate.operator_ids.some(operator => (NAV_GRAPH_OPERATORS as readonly string[]).includes(operator)))
      gates.set(node.source_id, node.gate);
  return gates;
}

export interface RouteArc { to: number; link_id: number; length_m: number; reason_codes: readonly string[] }
/** `d` 1 is n1→n2, 2 is n2→n1, 3 is both: a single-direction link is not walkable backwards. */
export function buildAdjacency(edges: readonly HeldGraphEdge[], options: { cleanOnly?: boolean } = {}): Map<number, RouteArc[]> {
  const adjacency = new Map<number, RouteArc[]>();
  const from = (node: number, to: number, edge: HeldGraphEdge): void => {
    const list = adjacency.get(node) ?? [];
    list.push({ to, link_id: edge.link_id, length_m: edge.length_m, reason_codes: edge.reason_codes });
    adjacency.set(node, list);
  };
  for (const edge of edges) {
    if (options.cleanOnly && edge.reason_codes.length) continue;
    if (edge.direction === 1 || edge.direction === 3) from(edge.from_node, edge.to_node, edge);
    if (edge.direction === 2 || edge.direction === 3) from(edge.to_node, edge.from_node, edge);
  }
  return adjacency;
}

export interface ShortestPath { nodes: number[]; link_ids: number[]; length_m: number; reason_codes: string[] }
/**
 * Dijkstra over the walk length. Ties keep the lower node id, so the same graph and pair always give the same path.
 * The reason codes collected are those of the arcs the path takes, in path order.
 */
export function shortestPath(adjacency: ReadonlyMap<number, readonly RouteArc[]>, from: number, to: number): ShortestPath | null {
  if (from === to) return { nodes: [from], link_ids: [], length_m: 0, reason_codes: [] };
  const distance = new Map<number, number>([[from, 0]]), previous = new Map<number, { node: number; arc: RouteArc }>();
  const settled = new Set<number>();
  for (;;) {
    let current: number | undefined;
    for (const [node, length] of distance)
      if (!settled.has(node) && (current === undefined || length < distance.get(current)! || (length === distance.get(current)! && node < current))) current = node;
    if (current === undefined) return null;
    if (current === to) break;
    settled.add(current);
    for (const arc of adjacency.get(current) ?? []) {
      const length = distance.get(current)! + arc.length_m;
      const known = distance.get(arc.to);
      if (known === undefined || length < known) { distance.set(arc.to, length); previous.set(arc.to, { node: current, arc }); }
    }
  }
  const nodes = [to], link_ids: number[] = [], reason_codes: string[] = [];
  for (let node = to; node !== from;) {
    const step = previous.get(node)!;
    nodes.push(step.node);
    link_ids.push(step.arc.link_id);
    for (const code of step.arc.reason_codes) if (!reason_codes.includes(code)) reason_codes.push(code);
    node = step.node;
  }
  return { nodes: nodes.reverse(), link_ids: link_ids.reverse(), length_m: distance.get(to)!, reason_codes };
}

export type RouteOutcome = 'ROUTED' | 'REFUSED' | 'UNREACHABLE' | 'UNKNOWN_GATE';
export interface GateRoute {
  from_poi: string; to_poi: string; outcome: RouteOutcome;
  nodes: number[]; link_ids: number[]; length_m: number | null; reason_codes: string[];
}
/** A `poi_id` names exactly one tagged node; an unknown or ambiguous gate refuses rather than guessing. */
function nodeForPoi(gates: ReadonlyMap<number, S03GateTag>, poiId: string): number | null {
  const matches = [...gates].filter(([, gate]) => gate.poi_id === poiId).map(([node]) => node);
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Route one gate pair. Any edge the path would take that carries a reason code refuses the route: the graph is held and
 * every reason code says so, so a clean fixture is the only input that can yield `ROUTED`.
 */
export function routeGatePair(document: HeldGraphDocument, fromPoi: string, toPoi: string, adjacency = buildAdjacency(document.edges)): GateRoute {
  const gates = gateNodesInScope(document), from = nodeForPoi(gates, fromPoi), to = nodeForPoi(gates, toPoi);
  if (from === null || to === null) return { from_poi: fromPoi, to_poi: toPoi, outcome: 'UNKNOWN_GATE', nodes: [], link_ids: [], length_m: null, reason_codes: [] };
  const path = shortestPath(adjacency, from, to);
  if (!path) return { from_poi: fromPoi, to_poi: toPoi, outcome: 'UNREACHABLE', nodes: [], link_ids: [], length_m: null, reason_codes: [] };
  if (path.reason_codes.length) return { from_poi: fromPoi, to_poi: toPoi, outcome: 'REFUSED', nodes: [], link_ids: [], length_m: null, reason_codes: path.reason_codes };
  return { from_poi: fromPoi, to_poi: toPoi, outcome: 'ROUTED', nodes: path.nodes, link_ids: path.link_ids, length_m: path.length_m, reason_codes: [] };
}

export interface OperatorPairCount {
  operators: string; gate_pairs: number; reachable_pairs: number; routable_pairs: number;
}
/**
 * Counts per unordered operator pair over the in-scope gate nodes. A pair is checked in both directions, so a one-way
 * link counts the same whichever node id is lower. `reachable_pairs` ignores reason codes (topology only);
 * `routable_pairs` is the router's own verdict, i.e. a shortest path exists in some direction and carries no reason code.
 */
export function gatePairCounts(document: HeldGraphDocument): { gate_nodes: { operator_id: string; nodes: number }[]; scope_nodes: number; pairs: OperatorPairCount[] } {
  const gates = gateNodesInScope(document);
  const adjacency = buildAdjacency(document.edges);
  const ids = [...gates.keys()].sort((a, b) => a - b);
  const paths = (from: number, to: number): ShortestPath[] => [shortestPath(adjacency, from, to), shortestPath(adjacency, to, from)]
    .filter((path): path is ShortestPath => path !== null);
  const pairs: OperatorPairCount[] = [];
  for (let i = 0; i < NAV_GRAPH_OPERATORS.length; i++) for (let j = i; j < NAV_GRAPH_OPERATORS.length; j++) {
    const first = NAV_GRAPH_OPERATORS[i]!, second = NAV_GRAPH_OPERATORS[j]!;
    let gatePairs = 0, reachable = 0, routable = 0;
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      const operatorsFirst = gates.get(ids[a]!)!.operator_ids, operatorsSecond = gates.get(ids[b]!)!.operator_ids;
      // Same-operator pairs need both ends on that operator; cross pairs count either orientation once.
      const matches = first === second
        ? operatorsFirst.includes(first) && operatorsSecond.includes(second)
        : (operatorsFirst.includes(first) && operatorsSecond.includes(second)) || (operatorsFirst.includes(second) && operatorsSecond.includes(first));
      if (!matches) continue;
      gatePairs += 1;
      const both = paths(ids[a]!, ids[b]!);
      if (both.length) reachable += 1;
      if (both.some(path => path.reason_codes.length === 0)) routable += 1;
    }
    pairs.push({ operators: `${first}-${second}`, gate_pairs: gatePairs, reachable_pairs: reachable, routable_pairs: routable });
  }
  const gate_nodes = NAV_GRAPH_OPERATORS.map(operator => ({ operator_id: operator, nodes: [...gates.values()].filter(gate => gate.operator_ids.includes(operator)).length }));
  return { gate_nodes, scope_nodes: gates.size, pairs };
}

/** The public receipt: counts, outcome counts and reason codes only. No coordinate, node or link id, gate name or level label. */
export function buildRouteReceipt(args: {
  graph: { run_id: string; digest: string; sha256: string; store_path: string; source_id: string; source_sha256: string | null; publish_gate: string | null };
  counts: ReturnType<typeof gatePairCounts>; routes: readonly GateRoute[]; reason_codes: Readonly<Record<string, number>>;
}) {
  const outcomes = ['ROUTED', 'REFUSED', 'UNREACHABLE', 'UNKNOWN_GATE'] as const;
  return {
    policy_version: S03_NAV_ROUTE_POLICY,
    held_graph: args.graph,
    navigation_use: NAV_ROUTE_LABELS.navigation_use,
    verification: NAV_ROUTE_LABELS.verification,
    gteki_role: NAV_ROUTE_LABELS.gteki_role,
    publication: { graph: 'HOLD', paths: 'HOLD', routing: 'HOLD',
      release_condition: NAV_ROUTE_RELEASE_CONDITION,
      rule: 'The 2026-10-24 ruling covers 25 approximate points and 19 platform names only. This route run writes a held document to the private store and this receipt; no record enters stations/**, route results or the web bundle.' },
    counts: { gate_nodes: args.counts.gate_nodes, scope_nodes: args.counts.scope_nodes, gate_pairs: args.counts.pairs },
    requested_routes: { total: args.routes.length, outcomes: outcomes.map(outcome => ({ outcome, count: args.routes.filter(route => route.outcome === outcome).length })) },
    reason_codes: Object.values(PATH_REASON).map(code => ({ code, count: args.reason_codes[code] ?? 0 })).filter(entry => entry.count > 0),
    route_rule: 'Only edges between gate-tagged nodes of the JR East, Odakyu and Keio areas are routed: the endpoints are the nodes whose own reviewed tag names one of those operators, the path is the shortest walk length over the held graph edges, and `d` 1/2 are one-way. Every node, edge and result is labelled NOT_FOR_ROUTING and UNVERIFIED.',
    refusal_rule: 'Any edge the path takes that carries a reason code refuses the route and lists the codes; a held graph carries CHECK_B_RESIDUAL_UNVERIFIED and FLOOR_ORDINAL_UNVERIFIED on every edge, so a real run reports reachability with zero ROUTED pairs.',
    receipt_rule: 'This receipt carries counts, run identity and reason codes only: no coordinate, no node or link id, no gate name, no level label and no route geometry.',
  };
}

export interface NavRouteOptions { run: string; heldDiagnostic: boolean; from?: string; to?: string }
export interface NavRouteResult extends ReturnType<typeof buildRouteReceipt> { receipt_path: string; private_path: string; private_sha256: string }

/**
 * Offline evidence only, and only with `--held-diagnostic`. Reads the held run by id, counts the gate pairs, routes any
 * requested pair, writes the route document to the private store and the counts receipt to `docs/gis/s03/`. It never
 * writes `stations/**`, a route result or the web bundle.
 */
export async function s03NavGraphRoute(options: NavRouteOptions, storeRoot: string = getStoreRoot()): Promise<NavRouteResult> {
  if (!options.heldDiagnostic) throw new Error(`S03 nav route: refusing to route: this command is held and needs the explicit ${S03_NAV_ROUTE_FLAG} flag`);
  if ((options.from === undefined) !== (options.to === undefined)) throw new Error('S03 nav route: pass both --from and --to, or neither');
  const { document, sha256: graphSha, store_path } = await loadHeldGraph(options.run, storeRoot);
  const counts = gatePairCounts(document);
  const routes = options.from !== undefined && options.to !== undefined ? [routeGatePair(document, options.from, options.to)] : [];
  const sourceSha = record(document.source_record) && typeof document.source_record.sha256 === 'string' ? document.source_record.sha256 : null;
  // `s03-nav-graph` records the source's publish gate under the digest inputs; the top-level field is the fallback.
  const publishGate = typeof document.digest_inputs?.publish_gate === 'string' ? document.digest_inputs.publish_gate
    : typeof document.publish_gate === 'string' ? document.publish_gate : null;
  const reasonCodes = Object.fromEntries(Object.values(PATH_REASON).map(code => [code, document.edges.filter(edge => edge.reason_codes.includes(code)).length]));
  const identity = { policy_version: S03_NAV_ROUTE_POLICY, graph_run_id: document.run_id, graph_digest: document.digest,
    graph_sha256: graphSha, from: options.from ?? null, to: options.to ?? null };
  const digest = sha256(JSON.stringify(identity)).slice(0, 20);
  const runId = `nav-route-${digest}`;
  const privatePath = `out/s03/${runId}.json`;
  const privateDocument = {
    policy_version: S03_NAV_ROUTE_POLICY, digest, run_id: runId, identity,
    held_graph: { run_id: document.run_id, digest: document.digest, sha256: graphSha, store_path, source_id: document.source_id },
    labels: NAV_ROUTE_LABELS,
    publication: { graph: 'HOLD', paths: 'HOLD', routing: 'HOLD', release_condition: NAV_ROUTE_RELEASE_CONDITION },
    counts, reason_codes: reasonCodes,
    nodes: document.nodes.map(node => ({ source_id: node.source_id, level_id: node.level_id, level_label: node.level_label,
      floor_ordinal: node.floor_ordinal, lon: node.lon, lat: node.lat, east_m: node.east_m, north_m: node.north_m,
      gate: node.gate, ...NAV_ROUTE_LABELS })),
    edges: document.edges.map(edge => ({ ...edge, ...NAV_ROUTE_LABELS })),
    routes: routes.map(route => ({ ...route, ...NAV_ROUTE_LABELS })),
  };
  const privateText = `${JSON.stringify(privateDocument, null, 2)}\n`;
  await writeHeldDocument(storeRoot, privatePath, privateDocument);
  const receipt = buildRouteReceipt({ graph: { run_id: document.run_id, digest: document.digest, sha256: graphSha, store_path,
    source_id: document.source_id, source_sha256: sourceSha, publish_gate: publishGate }, counts, routes, reason_codes: reasonCodes });
  const receiptPath = `docs/gis/s03/${runId}.json`;
  await writeJson(join(repoRoot, receiptPath), receipt);
  return { ...receipt, receipt_path: receiptPath, private_path: privatePath, private_sha256: sha256(privateText) };
}
