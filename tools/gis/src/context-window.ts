import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { repoRoot } from './common.js';
import { stationEnuProjector, type StationEnuFrame } from './station-enu.js';

/**
 * The context window: a union of closed discs in the station frame (x east, y north, metres).
 *  - one disc of R_origin around the frame origin;
 *  - one disc of R_exit around every exit connector and street-level node of stations/<id>/gteki/graph.json.
 * "Exit connector" and "street-level node" are decided only by explicit graph fields, listed in the context config
 * (`node_rule.exit_kinds` against `node.kind`, `node_rule.street_floor_ids` against `node.floorId`); nothing is guessed.
 * graph.json is read-only input and its sha256 is recorded.
 */

export interface Disc { x: number; y: number; r: number; origin: 'origin' | 'node'; id: string }
export interface NodeRule {
  graph: string; exit_kinds: string[]; street_floor_ids: string[];
  /** Also give a disc to every graph node that pois.json names (`connectorNodeIds`) for a POI whose `category` is in `exit_poi_categories`. */
  exit_poi_connectors?: boolean;
  /** Repo-relative pois.json; defaults to stations/<id>/gteki/pois.json. */
  pois?: string;
  /** POI `category` values that mean "exit" (default ["exit"]). */
  exit_poi_categories?: string[];
}
export interface WindowSpec { r_origin_m: number; r_exit_m: number; node_rule?: NodeRule; mesh_margin_m?: number }
export interface GraphNodeSummary { id: string; kind: string; floor_id: string; x: number; y: number; matched_by: Array<'exit_kind' | 'street_floor' | 'exit_poi_connector'>; distance_from_origin_m: number; poi_ids?: string[] }
export interface GraphWindowFacts {
  graph_path: string; graph_sha256: string; nodes_total: number; kinds_by_floor: Record<string, number>;
  exit_connectors: number; street_level_nodes: number; matched_by_both: number; selected_nodes: number; max_selected_distance_m: number;
  /** Only with exit_poi_connectors: the pois.json read (read-only) and what it added beyond the kind/floor rule. */
  pois: null | { pois_path: string; pois_sha256: string; categories: string[]; fields: string; pois_total: number; exit_pois: number; exit_pois_with_connectors: number; connector_nodes: number; added_beyond_kind_and_floor: string[] };
  selected: GraphNodeSummary[];
}
export interface ContextWindow {
  spec: { r_origin_m: number; r_exit_m: number; node_rule: NodeRule | null; mesh_margin_m: number };
  discs: Disc[];
  graph: GraphWindowFacts | null;
}

export const WINDOW_RULE = 'The window is the union of closed discs in the station frame: R_origin around the origin plus R_exit around every graph node whose kind is in node_rule.exit_kinds (exit connector) or whose floorId is in node_rule.street_floor_ids (street-level node). A feature is selected when its XY bbox meets any disc. With node_rule.exit_poi_connectors, every graph node that pois.json names in connectorNodeIds of a POI whose category is an exit category also gets a disc (an exit whose connector is a stair foot instead of a street node).';

/** Whether a station-frame XY box meets the closed disc (center cx,cy; radius R). */
export function bboxIntersectsCircle(box: { minX: number; minY: number; maxX: number; maxY: number }, cx: number, cy: number, radiusM: number): boolean {
  const dx = Math.max(box.minX - cx, 0, cx - box.maxX), dy = Math.max(box.minY - cy, 0, cy - box.maxY);
  return Math.hypot(dx, dy) <= radiusM;
}
export function bboxIntersectsAnyDisc(box: { minX: number; minY: number; maxX: number; maxY: number }, discs: readonly Disc[]): boolean {
  for (const d of discs) if (bboxIntersectsCircle(box, d.x, d.y, d.r)) return true;
  return false;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Read graph.json (read-only), classify nodes by the explicit rule and return the nodes that get a disc. */
export async function readGraphWindowNodes(rule: NodeRule, options: { stationId: string; graphPath?: string; poisPath?: string }): Promise<{ facts: GraphWindowFacts; nodes: GraphNodeSummary[] }> {
  if (!Array.isArray(rule.exit_kinds) || !Array.isArray(rule.street_floor_ids) || (!rule.exit_kinds.length && !rule.street_floor_ids.length)) throw new Error('node_rule needs at least one exit_kinds or street_floor_ids entry');
  const expectedRelative = `stations/${options.stationId}/gteki/graph.json`;
  if (options.graphPath === undefined && rule.graph !== expectedRelative) throw new Error(`node_rule.graph must be ${expectedRelative}`);
  if (options.graphPath === undefined && isAbsolute(rule.graph)) throw new Error('node_rule.graph must be repo-relative');
  const path = options.graphPath ?? resolve(repoRoot, rule.graph);
  const bytes = await readFile(path);
  const graph = JSON.parse(bytes.toString('utf8')) as { stationId?: unknown; nodes?: unknown };
  if (graph.stationId !== options.stationId) throw new Error(`${rule.graph}: stationId ${JSON.stringify(graph.stationId)} does not match ${options.stationId}`);
  if (!Array.isArray(graph.nodes)) throw new Error(`${rule.graph}: no nodes array`);
  const kinds = new Set(rule.exit_kinds), floors = new Set(rule.street_floor_ids);
  // Optional derived rule: connectors of exit POIs (explicit pois.json fields `category` and `connectorNodeIds`).
  let poiFacts: GraphWindowFacts['pois'] = null;
  const poiConnectors = new Map<string, string[]>();
  if (rule.exit_poi_connectors) {
    const poisRelative = rule.pois ?? `stations/${options.stationId}/gteki/pois.json`;
    if (options.poisPath === undefined && poisRelative !== `stations/${options.stationId}/gteki/pois.json`) throw new Error(`node_rule.pois must be stations/${options.stationId}/gteki/pois.json`);
    const poiBytes = await readFile(options.poisPath ?? resolve(repoRoot, poisRelative));
    const poiDoc = JSON.parse(poiBytes.toString('utf8')) as { stationId?: unknown; pois?: unknown };
    if (poiDoc.stationId !== options.stationId) throw new Error(`${poisRelative}: stationId ${JSON.stringify(poiDoc.stationId)} does not match ${options.stationId}`);
    if (!Array.isArray(poiDoc.pois)) throw new Error(`${poisRelative}: no pois array`);
    const categories = rule.exit_poi_categories ?? ['exit'];
    if (!categories.length) throw new Error('node_rule.exit_poi_categories must not be empty');
    let exitPois = 0, withConnectors = 0;
    for (const poi of poiDoc.pois as Array<Record<string, unknown>>) {
      if (typeof poi.id !== 'string' || typeof poi.category !== 'string') throw new Error(`${poisRelative}: a POI lacks string id/category`);
      if (!categories.includes(poi.category)) continue;
      exitPois++;
      if (!Array.isArray(poi.connectorNodeIds) || poi.connectorNodeIds.some((c) => typeof c !== 'string')) throw new Error(`${poisRelative}: exit POI ${poi.id} has no connectorNodeIds string array`);
      if (poi.connectorNodeIds.length) withConnectors++;
      for (const c of poi.connectorNodeIds as string[]) poiConnectors.set(c, [...(poiConnectors.get(c) ?? []), poi.id]);
    }
    poiFacts = { pois_path: poisRelative, pois_sha256: createHash('sha256').update(poiBytes).digest('hex'), categories, fields: 'pois[].category in exit categories; pois[].connectorNodeIds -> graph nodes[].id', pois_total: poiDoc.pois.length, exit_pois: exitPois, exit_pois_with_connectors: withConnectors, connector_nodes: poiConnectors.size, added_beyond_kind_and_floor: [] };
  }
  const graphIds = new Set((graph.nodes as Array<Record<string, unknown>>).map((n) => n.id));
  for (const c of poiConnectors.keys()) if (!graphIds.has(c)) throw new Error(`pois.json names connector node ${c} (exit POI ${poiConnectors.get(c)!.join(', ')}) that is not in ${rule.graph}; refusing to guess`);
  const kindsByFloor: Record<string, number> = {};
  const nodes: GraphNodeSummary[] = [];
  let exits = 0, streets = 0, both = 0;
  for (const raw of graph.nodes as Array<Record<string, unknown>>) {
    const pos = raw.position as { x?: unknown; y?: unknown } | undefined;
    if (typeof raw.id !== 'string' || typeof raw.kind !== 'string' || typeof raw.floorId !== 'string' || !pos || !finite(pos.x) || !finite(pos.y)) throw new Error(`${rule.graph}: node ${JSON.stringify(raw.id)} lacks string id/kind/floorId or finite position x,y`);
    if (Math.abs(pos.x) > 5000 || Math.abs(pos.y) > 5000) throw new Error(`${rule.graph}: node ${raw.id} is more than 5 km from the origin; refusing to guess`);
    const key = `${raw.kind}@${raw.floorId}`;
    kindsByFloor[key] = (kindsByFloor[key] ?? 0) + 1;
    const matchedBy: GraphNodeSummary['matched_by'] = [];
    if (kinds.has(raw.kind)) { matchedBy.push('exit_kind'); exits++; }
    if (floors.has(raw.floorId)) { matchedBy.push('street_floor'); streets++; }
    if (matchedBy.length === 2) both++;
    const viaPoi = poiConnectors.get(raw.id);
    if (viaPoi) { if (!matchedBy.length && poiFacts) poiFacts.added_beyond_kind_and_floor.push(raw.id); matchedBy.push('exit_poi_connector'); }
    if (matchedBy.length) nodes.push({ id: raw.id, kind: raw.kind, floor_id: raw.floorId, x: pos.x, y: pos.y, matched_by: matchedBy, distance_from_origin_m: Math.hypot(pos.x, pos.y), ...(viaPoi ? { poi_ids: viaPoi } : {}) });
  }
  const ids = new Set<string>();
  for (const n of nodes) { if (ids.has(n.id)) throw new Error(`${rule.graph}: duplicate node id ${n.id}`); ids.add(n.id); }
  const facts: GraphWindowFacts = {
    graph_path: rule.graph, graph_sha256: createHash('sha256').update(bytes).digest('hex'), nodes_total: graph.nodes.length, kinds_by_floor: Object.fromEntries(Object.entries(kindsByFloor).sort(([a], [b]) => (a < b ? -1 : 1))),
    exit_connectors: exits, street_level_nodes: streets, matched_by_both: both, selected_nodes: nodes.length, max_selected_distance_m: Math.round(nodes.reduce((m, n) => Math.max(m, n.distance_from_origin_m), 0) * 1000) / 1000,
    pois: poiFacts && { ...poiFacts, added_beyond_kind_and_floor: [...poiFacts.added_beyond_kind_and_floor].sort() },
    selected: nodes.map((n) => ({ ...n, distance_from_origin_m: Math.round(n.distance_from_origin_m * 1000) / 1000 })).sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
  return { facts, nodes };
}

/** Resolve the window from its spec: reads the graph only when a node rule and a positive R_exit are given. */
export async function buildContextWindow(spec: WindowSpec, options: { stationId: string; graphPath?: string; poisPath?: string }): Promise<ContextWindow> {
  if (!finite(spec.r_origin_m) || spec.r_origin_m <= 0 || spec.r_origin_m > 2000) throw new Error('radius must be a finite number of metres in (0, 2000] (R_origin)');
  if (!finite(spec.r_exit_m) || spec.r_exit_m < 0 || spec.r_exit_m > 2000) throw new Error('R_exit must be a finite number of metres in [0, 2000] (0 disables exit discs)');
  const margin = spec.mesh_margin_m ?? 0;
  if (!finite(margin) || margin < 0 || margin > 500) throw new Error('mesh_margin_m must be in [0, 500]');
  const discs: Disc[] = [{ x: 0, y: 0, r: spec.r_origin_m, origin: 'origin', id: 'origin' }];
  let graph: GraphWindowFacts | null = null;
  if (spec.r_exit_m > 0 && spec.node_rule) {
    const read = await readGraphWindowNodes(spec.node_rule, options);
    graph = read.facts;
    for (const n of read.nodes) discs.push({ x: n.x, y: n.y, r: spec.r_exit_m, origin: 'node', id: n.id });
  } else if (spec.r_exit_m > 0) throw new Error('R_exit > 0 needs a node_rule (exit_kinds / street_floor_ids) to find the exit connectors; set r_exit_m 0 to use the origin disc only');
  return { spec: { r_origin_m: spec.r_origin_m, r_exit_m: spec.r_exit_m, node_rule: spec.node_rule ?? null, mesh_margin_m: margin }, discs, graph };
}

// ---------------------------------------------------------------------------------------------------------------------
// JIS X 0410 3rd-level (8 digit) mesh codes: a 30" (latitude) x 45" (longitude) cell, i.e. 1/120 x 1/80 degree.
// code = pp uu q v r w with p = floor(lat * 1.5), u = floor(lon) - 100, q/v = 2nd level (0-7), r/w = 3rd level (0-9).

const LAT_CELLS_PER_DEG = 120, LON_CELLS_PER_DEG = 80;
const CELL_EPS = 1e-9;

export function meshCode3(lat: number, lon: number): string {
  if (!finite(lat) || !finite(lon) || lat < 0 || lat >= 66 || lon < 100 || lon >= 180) throw new Error(`mesh code undefined for latitude ${lat}, longitude ${lon}`);
  const n = Math.floor(lat * LAT_CELLS_PER_DEG + CELL_EPS), m = Math.floor((lon - 100) * LON_CELLS_PER_DEG + CELL_EPS);
  return `${String(Math.floor(n / 80)).padStart(2, '0')}${String(Math.floor(m / 80)).padStart(2, '0')}${Math.floor((n % 80) / 10)}${Math.floor((m % 80) / 10)}${n % 10}${m % 10}`;
}
export interface MeshCell { code: string; latMin: number; latMax: number; lonMin: number; lonMax: number }
export function meshCellBounds(code: string): MeshCell {
  if (!/^\d{8}$/.test(code)) throw new Error(`not an 8-digit mesh code: ${code}`);
  const p = Number(code.slice(0, 2)), u = Number(code.slice(2, 4)), q = Number(code[4]), v = Number(code[5]), r = Number(code[6]), w = Number(code[7]);
  if (q > 7 || v > 7) throw new Error(`invalid 2nd level digits in mesh code ${code}`);
  const n = p * 80 + q * 10 + r, m = u * 80 + v * 10 + w;
  return { code, latMin: n / LAT_CELLS_PER_DEG, latMax: (n + 1) / LAT_CELLS_PER_DEG, lonMin: 100 + m / LON_CELLS_PER_DEG, lonMax: 100 + (m + 1) / LON_CELLS_PER_DEG };
}

function pointInPolygon(px: number, py: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function distanceToSegment(px: number, py: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

export interface MeshCoverage { meshes: string[]; disc_count: number; margin_m: number }
/**
 * The 3rd-level meshes whose cell (projected into the station frame, edges subdivided) meets any disc of the window
 * (closed, so a cell touching a disc counts), widened by `marginM` metres. Pure geometry; no store or source access.
 */
export function meshesTouchedByWindow(discs: readonly Disc[], frame: Pick<StationEnuFrame, 'origin'>, marginM = 0): MeshCoverage {
  const project = stationEnuProjector(frame.origin);
  const o = frame.origin;
  const found = new Set<string>();
  const metresPerDegLat = 110000; // below the true minimum (110.57 km), so the candidate range is generous
  const cosLat = Math.cos((o.lat * Math.PI) / 180);
  for (const disc of discs) {
    const reach = disc.r + marginM;
    // Approximate centre of the disc in degrees; the 3% + 5 m slack covers the linearisation error at these scales.
    const latC = o.lat + disc.y / 110574, lonC = o.lon + disc.x / (111320 * cosLat);
    const dLat = (reach * 1.03 + 5) / metresPerDegLat, dLon = (reach * 1.03 + 5) / (metresPerDegLat * cosLat);
    const nMin = Math.floor((latC - dLat) * LAT_CELLS_PER_DEG), nMax = Math.floor((latC + dLat) * LAT_CELLS_PER_DEG);
    const mMin = Math.floor((lonC - dLon - 100) * LON_CELLS_PER_DEG), mMax = Math.floor((lonC + dLon - 100) * LON_CELLS_PER_DEG);
    for (let n = nMin; n <= nMax; n++) for (let m = mMin; m <= mMax; m++) {
      const code = meshCode3((n + 0.5) / LAT_CELLS_PER_DEG, 100 + (m + 0.5) / LON_CELLS_PER_DEG);
      if (found.has(code)) continue;
      const cell = meshCellBounds(code);
      const ring: Array<[number, number]> = [];
      const steps = 8;
      const edge = (la0: number, lo0: number, la1: number, lo1: number): void => {
        for (let s = 0; s < steps; s++) { const t = s / steps; const p = project(la0 + (la1 - la0) * t, lo0 + (lo1 - lo0) * t, 0); ring.push([p[0], p[1]]); }
      };
      edge(cell.latMin, cell.lonMin, cell.latMin, cell.lonMax); edge(cell.latMin, cell.lonMax, cell.latMax, cell.lonMax);
      edge(cell.latMax, cell.lonMax, cell.latMax, cell.lonMin); edge(cell.latMax, cell.lonMin, cell.latMin, cell.lonMin);
      let hit = pointInPolygon(disc.x, disc.y, ring);
      for (let i = 0; !hit && i < ring.length; i++) if (distanceToSegment(disc.x, disc.y, ring[i]!, ring[(i + 1) % ring.length]!) <= reach) hit = true;
      if (hit) found.add(code);
    }
  }
  return { meshes: [...found].sort(), disc_count: discs.length, margin_m: marginM };
}

/** Which of the needed meshes lack a configured bldg or tran source id (`plateau-<city>-<bldg|tran>-<mesh>`). */
export function missingMeshSources(needed: readonly string[], sourceIds: readonly string[]): Array<{ mesh: string; kind: 'bldg' | 'tran'; reason: 'not_in_context_config' }> {
  const have = new Set<string>();
  for (const id of sourceIds) { const m = /^plateau-\d{5}-(bldg|tran)-(\d{8})$/.exec(id); if (m) have.add(`${m[1]}:${m[2]}`); }
  const missing: Array<{ mesh: string; kind: 'bldg' | 'tran'; reason: 'not_in_context_config' }> = [];
  for (const mesh of needed) for (const kind of ['bldg', 'tran'] as const) if (!have.has(`${kind}:${mesh}`)) missing.push({ mesh, kind, reason: 'not_in_context_config' });
  return missing;
}
