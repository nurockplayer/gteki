import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Edge, Floor, GraphFile, Node, StationManifestFile } from '../../../packages/schema/src/index.js';
import { repoRoot } from './common.js';
import { loadHeldGraph, type HeldGraphDocument } from './s03-nav-graph-route.js';
import { compatibleFloors, S03_FLOOR_ORDINALS } from './s03-transform.js';

const sourceId = 'tokyo-s03-zip';
const nodeId = (id: number): string => `p:sjk:s03:n:${id}`;
export interface PrivateSeam { nodes: Node[]; edges: Edge[]; floors: Floor[] }

/** Private additions only. Held coordinates already use station ENU; printed z remains the source's level order. */
export function buildPrivateSeam(held: HeldGraphDocument, e27: { manifest: StationManifestFile; graph: GraphFile },
  opts: { runId: string; today: string }): PrivateSeam {
  const floors: Floor[] = [], floorIds = new Map<number, string>();
  const ordinal = (label: string): number | null => S03_FLOOR_ORDINALS[label] ?? null;
  for (const node of held.nodes) {
    if (floorIds.has(node.level_id)) continue;
    const comparison = ordinal(node.level_label);
    const matches = e27.manifest.floors.filter(floor => comparison !== null && floor.ordinal !== null && compatibleFloors(floor.ordinal, comparison));
    if (matches.length === 1) floorIds.set(node.level_id, matches[0]!.id);
    else {
      const id = `p:sjk:s03:f:${node.level_id}`;
      const operatorId = e27.manifest.station.operators[0]!.id;
      floors.push({ id, operatorId, sourceLabels: [{ operatorId, label: node.level_label, sourceId }],
        ordinal: comparison, intermediate: comparison !== null && !Number.isInteger(comparison),
        elevationM: null, elevationSource: 'symbolic', renderElevationM: node.level_z ?? 0 });
      floorIds.set(node.level_id, id);
    }
  }
  const nodes: Node[] = held.nodes.map(node => ({ id: nodeId(node.source_id), floorId: floorIds.get(node.level_id)!,
    position: { x: node.east_m, y: node.north_m, z: node.level_z ?? null },
    kind: node.gate ? 'ticket_gate' : 'junction', inOut: null,
    sourceRefs: [{ sourceId, featureId: String(node.source_id) }] }));
  const evidence = (method: string) => ({ sourceIds: [sourceId], method, checkedDate: opts.today });
  const edges: Edge[] = held.edges.map(edge => ({ id: `p:sjk:s03:e:${edge.link_id}`,
    from: nodeId(edge.direction === 2 ? edge.to_node : edge.from_node),
    to: nodeId(edge.direction === 2 ? edge.from_node : edge.to_node),
    direction: edge.direction === 3 ? 'both' : 'forward',
    mode: edge.level_relation === 'same_level' ? 'walk'
      : edge.device === 'elevator' || edge.device === 'escalator' || edge.device === 'ramp' || edge.device === 'moving_walkway' ? edge.device : 'stairs',
    lengthM: edge.length_m, paid: edge.paid ?? null, crossesFareBoundary: edge.crossesFareBoundary ?? null,
    wheelchair: edge.wheelchair ?? null, steps: edge.steps ?? null, hours: null, closed: false, verification: 'unverified',
    geometryEvidence: evidence(`s03-nav-graph:${opts.runId}`), accessEvidence: null,
    attributes: { reasonCodes: edge.reason_codes.join(',') || null, s03LinkId: edge.link_id } }));

  const publicFloors = new Map(e27.manifest.floors.map(floor => [floor.id, floor.ordinal]));
  const en = new Map<string, { index: number; distance: number }>();
  const sn = new Map<number, { node: Node; distance: number }>();
  const gates = new Map<number, { node: Node; distance: number }>();
  // Same mutual-nearest rule as s03-transform, which returns only pairs within 5 m. Here the threshold is 15 m.
  for (const e of e27.graph.nodes) for (const [index, s] of held.nodes.entries()) {
    const eo = publicFloors.get(e.floorId), so = ordinal(s.level_label);
    if (eo == null || so === null || !compatibleFloors(eo, so)) continue;
    const distance = Math.hypot(s.east_m - e.position.x, s.north_m - e.position.y);
    const previousS = en.get(e.id), previousE = sn.get(index), previousGate = gates.get(index);
    if (!previousS || distance < previousS.distance || distance === previousS.distance && s.source_id < held.nodes[previousS.index]!.source_id)
      en.set(e.id, { index, distance });
    if (!previousE || distance < previousE.distance || distance === previousE.distance && e.id < previousE.node.id)
      sn.set(index, { node: e, distance });
    if (s.gate && e.kind === 'ticket_gate' && (!previousGate || distance < previousGate.distance || distance === previousGate.distance && e.id < previousGate.node.id))
      gates.set(index, { node: e, distance });
  }
  const stitch = (e: Node, index: number, distance: number, gate: boolean): Edge => ({
    id: `p:sjk:s03:e:seam:${e.id}:${held.nodes[index]!.source_id}`, from: e.id, to: nodes[index]!.id,
    direction: 'both', mode: 'walk', lengthM: distance, paid: null, crossesFareBoundary: null, wheelchair: null,
    steps: null, hours: null, closed: false, verification: 'unverified',
    geometryEvidence: evidence('s03-seam-nearest'), accessEvidence: null, attributes: { seam: gate ? 'gate' : true },
  });
  const seams = new Map<string, Edge>();
  for (const e of e27.graph.nodes) {
    const match = en.get(e.id);
    if (match && match.distance <= 15 && sn.get(match.index)?.node.id === e.id) {
      const edge = stitch(e, match.index, match.distance, false);
      seams.set(edge.id, edge);
    }
  }
  for (const [index, match] of gates) if (match.distance <= 30) {
    const edge = stitch(match.node, index, match.distance, true);
    seams.set(edge.id, edge);
  }
  return { nodes, edges: [...edges, ...seams.values()], floors };
}

/** Refuse public-tree output, including paths whose existing parent resolves through a symlink. */
function privateOutput(out: string): string {
  let ancestor = resolve(out);
  const tail: string[] = [];
  while (!existsSync(ancestor)) {
    tail.unshift(relative(dirname(ancestor), ancestor));
    ancestor = dirname(ancestor);
  }
  const output = resolve(realpathSync(ancestor), ...tail);
  const rel = relative(realpathSync(repoRoot), output);
  if (rel === '' || !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
    throw new Error('S03 private seam: refusing --out inside the git repo');
  return output;
}

/** Reads a held run and public base; writes only the requested private additions file, with no public receipt. */
export async function s03PrivateSeam(options: { run: string; out: string; privateTier: boolean }, storeRoot?: string) {
  if (!options.privateTier) throw new Error('S03 private seam: refusing without the explicit --private-tier flag');
  const out = privateOutput(options.out);
  const { document } = await loadHeldGraph(options.run, storeRoot);
  const base = join(repoRoot, 'stations/shinjuku/gteki');
  const manifest = JSON.parse(await readFile(join(base, 'station.json'), 'utf8')) as StationManifestFile;
  const graph = JSON.parse(await readFile(join(base, 'graph.json'), 'utf8')) as GraphFile;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const result = buildPrivateSeam(document, { manifest, graph }, { runId: options.run, today });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify({ nodes: result.nodes, edges: result.edges, ...(result.floors.length ? { floors: result.floors } : {}) }, null, 2)}\n`);
  return { nodes: result.nodes.length, edges: result.edges.length, seamEdges: result.edges.filter(edge => edge.attributes?.seam).length, newFloors: result.floors.length };
}
