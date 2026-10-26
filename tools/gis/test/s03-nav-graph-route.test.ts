import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NAV_ROUTE_RELEASE_CONDITION, S03_NAV_ROUTE_FLAG, S03_NAV_ROUTE_POLICY, assertHeldGraph, buildRouteReceipt, gateNodesInScope,
  gatePairCounts, loadHeldGraph, routeGatePair, s03NavGraphRoute, type HeldGraphDocument,
} from '../src/s03-nav-graph-route.js';
import { S03_NAV_GRAPH_POLICY, type S03GateTag } from '../src/s03-nav-graph.js';
import { PATH_REASON } from '../src/s03-paths.js';

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const gate = (poiId: string, operators: string[]): S03GateTag => ({ poi_id: poiId, operator_ids: operators, line: null, name: poiId });
const NODE = (sourceId: number, gateTag: S03GateTag | null) => ({
  source_id: sourceId, level_id: 11, level_label: 'B1F', level_z: -2, lon: 0, lat: 0, east_m: sourceId * 10, north_m: 0, gate: gateTag,
});
const EDGE = (linkId: number, from: number, to: number, length: number, reason_codes: string[] = [], direction = 3) =>
  ({ link_id: linkId, from_node: from, to_node: to, direction, dz_m: null, length_m: length, level_relation: 'same_level' as const, reason_codes });

/** A held run as `s03-nav-graph` writes it: a JR gate, a corridor and a Keio gate, both directions walkable. */
const held = (override: { edges?: HeldGraphDocument['edges']; digest?: string } = {}): HeldGraphDocument => {
  const digest = override.digest ?? 'a'.repeat(20);
  return {
    policy_version: S03_NAV_GRAPH_POLICY, digest, run_id: `nav-graph-${digest}`, source_id: 'tokyo-s03-zip',
    source_record: { sha256: 'b'.repeat(64) }, publish_gate: 'CONDITIONAL', publication: { routing: 'HOLD' },
    nodes: [NODE(1, gate('poi:jreast-gate:1', ['jreast'])), NODE(2, null), NODE(3, gate('poi:keio-gate:1', ['keio']))],
    edges: override.edges ?? [EDGE(101, 1, 2, 5), EDGE(102, 2, 3, 7)],
  };
};

describe('S03 nav route: held by default', () => {
  it('refuses to route unless the explicit diagnostic flag is given', async () => {
    await expect(s03NavGraphRoute({ run: `nav-graph-${'a'.repeat(20)}`, heldDiagnostic: false }, '/nonexistent'))
      .rejects.toThrow(/refusing to route/);
    expect(S03_NAV_ROUTE_FLAG).toBe('--held-diagnostic');
  });
  it('refuses a graph that does not declare routing HOLD, or whose run id and digest disagree', () => {
    expect(() => assertHeldGraph({ ...held(), publication: { routing: 'PASS' } })).toThrow(/routing HOLD/);
    expect(() => assertHeldGraph({ ...held(), run_id: `nav-graph-${'c'.repeat(20)}` })).toThrow(/does not match its digest/);
    expect(() => assertHeldGraph({ ...held(), policy_version: 'something-else' })).toThrow(S03_NAV_GRAPH_POLICY);
  });
});

describe('S03 nav route: routing on the held graph (synthetic only)', () => {
  it('routes a clean fixture between a JR and a Keio gate on the shortest walk', () => {
    const route = routeGatePair(held(), 'poi:jreast-gate:1', 'poi:keio-gate:1');
    expect(route).toMatchObject({ outcome: 'ROUTED', nodes: [1, 2, 3], link_ids: [101, 102], length_m: 12, reason_codes: [] });
    // Node 2 carries no gate, so only the two tagged nodes are route endpoints.
    expect([...gateNodesInScope(held()).keys()]).toEqual([1, 3]);
  });
  it('counts the gate pairs and finds them reachable and routable on a clean graph', () => {
    const counts = gatePairCounts(held());
    expect(counts.scope_nodes).toBe(2);
    expect(counts.gate_nodes).toEqual([{ operator_id: 'jreast', nodes: 1 }, { operator_id: 'odakyu', nodes: 0 }, { operator_id: 'keio', nodes: 1 }]);
    expect(counts.pairs.find(pair => pair.operators === 'jreast-keio')).toEqual({ operators: 'jreast-keio', gate_pairs: 1, reachable_pairs: 1, routable_pairs: 1 });
  });
  it('refuses a route whose path hits a reason code, and reports the code', () => {
    const route = routeGatePair(held({ edges: [EDGE(101, 1, 2, 5, [PATH_REASON.CRS_UNCONFIRMED]), EDGE(102, 2, 3, 7)] }), 'poi:jreast-gate:1', 'poi:keio-gate:1');
    expect(route).toMatchObject({ outcome: 'REFUSED', nodes: [], length_m: null, reason_codes: [PATH_REASON.CRS_UNCONFIRMED] });
    // The topology still counts the pair as reachable, while no pair is routable on reason-coded edges.
    const counts = gatePairCounts(held({ edges: [EDGE(101, 1, 2, 5, [PATH_REASON.CRS_UNCONFIRMED]), EDGE(102, 2, 3, 7)] }));
    expect(counts.pairs.find(pair => pair.operators === 'jreast-keio')).toMatchObject({ reachable_pairs: 1, routable_pairs: 0 });
  });
  it('refuses a negative edge length instead of spinning the path reconstruction', () => {
    expect(() => assertHeldGraph(held({ edges: [EDGE(101, 1, 2, -1)] }))).toThrow(/negative length/);
  });
  it('counts a one-way pair the same whichever node id is lower', () => {
    // Edge 101 is `d` 1 (node 1 to node 2), so only the 1 -> 3 orientation walks it; the pair still counts once.
    const counts = gatePairCounts(held({ edges: [EDGE(101, 1, 2, 5, [], 1), EDGE(102, 2, 3, 7, [], 3)] }));
    expect(counts.pairs.find(pair => pair.operators === 'jreast-keio')).toMatchObject({ reachable_pairs: 1, routable_pairs: 1 });
  });
  it('counts a pair routable only where the shortest path the router takes is clean', () => {
    // 1-2-4 is shorter but reason-coded; 1-3-4 is clean but longer, so the router refuses and the count agrees.
    const document: HeldGraphDocument = { ...held(),
      nodes: [NODE(1, gate('poi:jreast-gate:1', ['jreast'])), NODE(2, null), NODE(3, null), NODE(4, gate('poi:keio-gate:1', ['keio']))],
      edges: [EDGE(101, 1, 2, 1), EDGE(102, 2, 4, 1, [PATH_REASON.CRS_UNCONFIRMED]), EDGE(103, 1, 3, 10), EDGE(104, 3, 4, 10)] };
    expect(routeGatePair(document, 'poi:jreast-gate:1', 'poi:keio-gate:1')).toMatchObject({ outcome: 'REFUSED' });
    expect(gatePairCounts(document).pairs.find(pair => pair.operators === 'jreast-keio')).toMatchObject({ reachable_pairs: 1, routable_pairs: 0 });
  });
  it('routes a one-way link in its printed direction, in both directions', () => {
    // `d` 1 is node 1 to node 2 and then node 2 to node 3: the JR gate reaches the Keio gate, never the reverse.
    expect(routeGatePair(held({ edges: [EDGE(101, 1, 2, 5, [], 1), EDGE(102, 2, 3, 7, [], 1)] }), 'poi:jreast-gate:1', 'poi:keio-gate:1'))
      .toMatchObject({ outcome: 'ROUTED', nodes: [1, 2, 3], link_ids: [101, 102] });
    // `d` 2 reverses both links: the Keio gate walks back to the JR gate, and the forward direction is refused as unreachable.
    expect(routeGatePair(held({ edges: [EDGE(101, 1, 2, 5, [], 2), EDGE(102, 2, 3, 7, [], 2)] }), 'poi:keio-gate:1', 'poi:jreast-gate:1'))
      .toMatchObject({ outcome: 'ROUTED', nodes: [3, 2, 1], link_ids: [102, 101] });
    expect(routeGatePair(held({ edges: [EDGE(101, 1, 2, 5, [], 2), EDGE(102, 2, 3, 7, [], 2)] }), 'poi:jreast-gate:1', 'poi:keio-gate:1'))
      .toMatchObject({ outcome: 'UNREACHABLE' });
  });
  it('does not walk a one-way edge backwards, and refuses an unknown gate', () => {
    // Edge 101 is `d` 1: node 1 to node 2 only, so the Keio gate cannot walk it back towards the JR gate.
    expect(routeGatePair(held({ edges: [EDGE(101, 1, 2, 5, [], 1), EDGE(102, 2, 3, 7, [], 3)] }), 'poi:keio-gate:1', 'poi:jreast-gate:1'))
      .toMatchObject({ outcome: 'UNREACHABLE' });
    expect(routeGatePair(held(), 'poi:nope', 'poi:keio-gate:1')).toMatchObject({ outcome: 'UNKNOWN_GATE' });
  });
});

describe('S03 nav route: the held run is read, and the receipt stays counts-only', () => {
  it('reads the run by id from the private store and records its run id, digest and release condition', async () => {
    const store = await mkdtemp(join(tmpdir(), 'gteki-route-store-'));
    try {
      const document = held();
      await mkdir(join(store, 'out/s03'), { recursive: true });
      await writeFile(join(store, 'out/s03', `${document.run_id}.json`), JSON.stringify(document));
      const loaded = await loadHeldGraph(document.run_id, store);
      expect(loaded.document.run_id).toBe(document.run_id);
      expect(loaded.sha256).toBe(sha256(JSON.stringify(document)));
      const receipt = buildRouteReceipt({
        graph: { run_id: document.run_id, digest: document.digest, sha256: loaded.sha256, store_path: loaded.store_path,
          source_id: document.source_id, source_sha256: 'b'.repeat(64), publish_gate: 'CONDITIONAL' },
        counts: gatePairCounts(document), routes: [], reason_codes: {},
      });
      expect(receipt.policy_version).toBe(S03_NAV_ROUTE_POLICY);
      expect(receipt.held_graph).toMatchObject({ run_id: document.run_id, digest: document.digest, sha256: loaded.sha256 });
      expect(receipt.publication.release_condition).toBe(NAV_ROUTE_RELEASE_CONDITION);
      expect(receipt.navigation_use).toBe('NOT_FOR_ROUTING');
      expect(receipt.verification).toBe('UNVERIFIED');
      // No gate name, poi id, coordinate, node id or link id reaches the receipt.
      const text = JSON.stringify(receipt);
      expect(text).not.toContain('poi:');
      expect(text).not.toContain('京王');
      expect(text).not.toContain('east_m');
      expect(text).not.toContain('source_id":1');
    } finally { await rm(store, { recursive: true, force: true }); }
  });
  it('refuses a run id that is not one the graph tool writes, before touching the store', async () => {
    await expect(loadHeldGraph('../stations/shinjuku/gteki/graph', '/nonexistent')).rejects.toThrow(/refusing run id/);
  });
});

describe('S03 nav route: nothing ships', () => {
  it('has no write path into station data or the web bundle: only the store and a docs/gis/s03 receipt', async () => {
    const source = await readFile(new URL('../src/s03-nav-graph-route.ts', import.meta.url), 'utf8');
    const repoWrites = [...source.matchAll(/writeJson\(join\(repoRoot, ([^)]+)\)/g)].map(match => match[1]);
    expect(repoWrites).toEqual(['receiptPath']);
    expect(source).toContain('const receiptPath = `docs/gis/s03/${runId}.json`;');
  });
});
