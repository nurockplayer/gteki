import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Floor, GraphFile, Node, StationManifestFile } from '../../../packages/schema/src/index.js';
import { repoRoot } from '../src/common.js';
import { type HeldGraphDocument } from '../src/s03-nav-graph-route.js';
import { S03_NAV_GRAPH_POLICY } from '../src/s03-nav-graph.js';
import { buildPrivateSeam, s03PrivateSeam } from '../src/s03-private-seam.js';

const runId = `nav-graph-${'a'.repeat(20)}`;
const opts = { runId, today: '2026-10-27' };
const floor: Floor = { id: 'e27-lower', operatorId: 'test', ordinal: -1, sourceLabels: [],
  intermediate: false, elevationM: null, elevationSource: 'unknown', renderElevationM: 0 };
const publicNode = (id: string, x: number, kind: Node['kind'] = 'junction'): Node => ({ id, floorId: floor.id,
  position: { x, y: 0, z: null }, kind, inOut: null, sourceRefs: [] });
function fixture() {
  const held: HeldGraphDocument = { policy_version: S03_NAV_GRAPH_POLICY, digest: 'a'.repeat(20), run_id: runId,
    source_id: 'tokyo-s03-zip', publication: { routing: 'HOLD' },
    nodes: [
      { source_id: 1, level_id: 10, level_label: 'B1F', level_z: -7, lon: 0, lat: 0, east_m: 0, north_m: 0,
        gate: { poi_id: 'test-gate', operator_ids: ['test'], line: null, name: 'Synthetic gate' } },
      { source_id: 2, level_id: 10, level_label: 'B1F', level_z: -7, lon: 0, lat: 0, east_m: 100, north_m: 0, gate: null },
      { source_id: 3, level_id: 20, level_label: '2F', level_z: 8, lon: 0, lat: 0, east_m: 200, north_m: 0, gate: null },
    ],
    edges: [
      { link_id: 11, from_node: 1, to_node: 2, direction: 3, dz_m: null, length_m: 100, level_relation: 'same_level', reason_codes: ['HELD_TEST', 'OTHER_TEST'] },
      { link_id: 12, from_node: 3, to_node: 2, direction: 2, dz_m: null, length_m: 100, level_relation: 'cross_level', device: 'elevator', reason_codes: [] },
      { link_id: 13, from_node: 1, to_node: 3, direction: 1, dz_m: null, length_m: 200, level_relation: 'cross_level', reason_codes: [] },
    ] };
  const manifest = { floors: [floor], station: { operators: [{ id: 'test', names: [] }] } } as unknown as StationManifestFile;
  const graph: GraphFile = { schema: 'gteki.station/0.1', stationId: 'synthetic', edges: [],
    nodes: [publicNode('near', 4), publicNode('twenty-away', 120), publicNode('gate', 25, 'ticket_gate')] };
  return { held, e27: { manifest, graph } };
}

describe('S03 private seam (synthetic only)', () => {
  it('keeps all held edges, maps direction and evidence, and adds the compatible seams and private floor', () => {
    const { held, e27 } = fixture();
    const result = buildPrivateSeam(held, e27, opts);
    expect(result.nodes.map(node => node.id)).toEqual(['p:sjk:s03:n:1', 'p:sjk:s03:n:2', 'p:sjk:s03:n:3']);
    expect(result.nodes[0]).toMatchObject({ floorId: floor.id, kind: 'ticket_gate', inOut: null,
      position: { x: 0, y: 0, z: -7 }, sourceRefs: [{ sourceId: 'tokyo-s03-zip', featureId: '1' }] });
    expect(result.nodes[2]).toMatchObject({ floorId: 'p:sjk:s03:f:20', kind: 'junction' });
    expect(result.floors).toMatchObject([{ id: 'p:sjk:s03:f:20', ordinal: 2, elevationM: null, renderElevationM: 8 }]);
    expect(result.edges.slice(0, 3)).toMatchObject([
      { id: 'p:sjk:s03:e:11', from: 'p:sjk:s03:n:1', to: 'p:sjk:s03:n:2', direction: 'both', mode: 'walk',
        lengthM: 100, attributes: { reasonCodes: 'HELD_TEST,OTHER_TEST', s03LinkId: 11 } },
      { id: 'p:sjk:s03:e:12', from: 'p:sjk:s03:n:2', to: 'p:sjk:s03:n:3', direction: 'forward', mode: 'elevator', attributes: { reasonCodes: null } },
      { id: 'p:sjk:s03:e:13', from: 'p:sjk:s03:n:1', to: 'p:sjk:s03:n:3', direction: 'forward', mode: 'stairs', steps: null },
    ]);
    for (const edge of result.edges) expect(edge).toMatchObject({ verification: 'unverified', hours: null, closed: false,
      paid: null, crossesFareBoundary: null, wheelchair: null, accessEvidence: null,
      geometryEvidence: { sourceIds: ['tokyo-s03-zip'], checkedDate: opts.today } });
    expect(result.edges[0]!.geometryEvidence.method).toBe(`s03-nav-graph:${runId}`);
    expect(result.edges.filter(edge => edge.attributes?.seam)).toMatchObject([
      { id: 'p:sjk:s03:e:seam:near:1', direction: 'both', mode: 'walk', lengthM: 4, attributes: { seam: true }, geometryEvidence: { method: 's03-seam-nearest' } },
      { id: 'p:sjk:s03:e:seam:gate:1', lengthM: 25, attributes: { seam: 'gate' } },
    ]);
    expect(result.edges.some(edge => edge.id.includes('twenty-away'))).toBe(false);
  });

  it('makes a private floor when E27 floor compatibility is ambiguous', () => {
    const { held, e27 } = fixture();
    e27.manifest.floors.push({ ...floor, id: 'another-lower' });
    const result = buildPrivateSeam(held, e27, opts);
    expect(result.nodes[0]!.floorId).toBe('p:sjk:s03:f:10');
    expect(result.floors.map(f => f.id)).toEqual(['p:sjk:s03:f:10', 'p:sjk:s03:f:20']);
  });

  it('refuses missing opt-in and repository output before loading a held run', async () => {
    await expect(s03PrivateSeam({ run: runId, out: '/unused/private/graph.s03.json', privateTier: false }, '/nonexistent'))
      .rejects.toThrow(/--private-tier/);
    await expect(s03PrivateSeam({ run: runId, out: join(repoRoot, 'tools/../graph.s03.json'), privateTier: true }, '/nonexistent'))
      .rejects.toThrow(/--out inside the git repo/);
  });
});
