/** Drape private walk edges onto the scene floor; output must stay outside the public repo. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as THREE from "three";
import { enuToRenderer } from "@gteki/geo";
import { nodeDisplayZ, routePolyline, type PolylinePoint, type RouteResult } from "@gteki/navigation";
import { parseStationFiles, type Edge, type Node, type StationBundle } from "@gteki/schema";
import { castAll } from "../../../apps/web/src/explorer/raycast.ts";
import { auditPolyline, loadScene, sceneProbe, violations, type SampleDetail, type SceneProbe } from "./route-clip-audit.ts";

type Point = { x: number; y: number; z: number };
const point = (p: Point): PolylinePoint => ({ ...p, zKnown: false, stepIndex: 0, floorId: "" });
const clean = (probe: SceneProbe, pts: Point[]) => violations(auditPolyline(probe, pts.map(point))) === 0;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ray = new THREE.Raycaster();
function floorAt(probe: SceneProbe, x: number, y: number, band: number, tolerance: number): number | undefined {
  ray.set(new THREE.Vector3(...enuToRenderer({ x, y, z: band + 3 })), new THREE.Vector3(0, -1, 0));
  ray.far = 6;
  return castAll(ray, probe.ground).map(h => h.point.y).filter(z => Math.abs(z - band) <= tolerance)
    .sort((a, b) => Math.abs(a - band) - Math.abs(b - band) || a - b)[0];
}
function drawn(bundle: StationBundle, edge: Edge): PolylinePoint[] {
  const nodes = new Map(bundle.nodes.map(n => [n.id, n]));
  return routePolyline(bundle, { ok: true, nodeIds: [edge.from, edge.to], steps: [{ edgeId: edge.id, fromNodeId: edge.from, toNodeId: edge.to, reversed: false, mode: edge.mode, lengthM: edge.lengthM ?? 0, fromFloorId: nodes.get(edge.from)!.floorId, toFloorId: nodes.get(edge.to)!.floorId }] } as unknown as RouteResult);
}

/** Drape selected edges without mutating the input bundle. */
export function drapeEdges(probe: SceneProbe, bundle: StationBundle, edgeIds: Set<string>, opts: { maxCells?: number; nodeIds?: Set<string> } = {}): {
  nodes: Map<string, number>; geometry: Map<string, Point[]>; unresolved: { edgeId: string; reason: string }[]; sceneGaps: Map<string, boolean>;
} {
  const selected = bundle.edges.filter(e => edgeIds.has(e.id)).sort((a, b) => a.id.localeCompare(b.id));
  const nodes = new Map<string, number>(), geometry = new Map<string, Point[]>(), unresolved: { edgeId: string; reason: string }[] = [];
  const byId = new Map(bundle.nodes.map(n => [n.id, n]));
  const floors = new Map(bundle.floors.map(f => [f.id, f]));
  for (const id of [...new Set(selected.flatMap(e => [e.from, e.to]))].sort()) {
    const n = byId.get(id)!;
    if (n.position.z !== null || opts.nodeIds && !opts.nodeIds.has(id)) continue;
    const z = floorAt(probe, n.position.x, n.position.y, floors.get(n.floorId)?.renderElevationM ?? 0, 2);
    if (z !== undefined) nodes.set(id, z);
  }
  const updated = { ...bundle, nodes: bundle.nodes.map(n => nodes.has(n.id) ? { ...n, renderZ: nodes.get(n.id)! } : n) };
  const updatedNodes = new Map(updated.nodes.map(n => [n.id, n]));
  const position = (n: Node): Point => ({ x: n.position.x, y: n.position.y, z: nodeDisplayZ(n, floors.get(n.floorId)).z });
  for (const edge of selected) {
    if (edge.mode !== "walk" || violations(auditPolyline(probe, drawn(updated, edge))) === 0) continue;
    const start = position(updatedNodes.get(edge.from)!), goal = position(updatedNodes.get(edge.to)!);
    const minX = Math.floor((Math.min(start.x, goal.x) - 15) * 2) / 2, minY = Math.floor((Math.min(start.y, goal.y) - 15) * 2) / 2;
    const width = Math.ceil((Math.max(start.x, goal.x) + 15 - minX) * 2) + 1, height = Math.ceil((Math.max(start.y, goal.y) + 15 - minY) * 2) + 1;
    if (width * height > (opts.maxCells ?? 250000)) { unresolved.push({ edgeId: edge.id, reason: "lattice size cap exceeded" }); continue; }
    const xy = (i: number): [number, number] => [minX + (i % width) / 2, minY + Math.floor(i / width) / 2];
    const nearest = (p: Point): { i: number; p: Point } | undefined => {
      const candidates: { i: number; p: Point; d: number }[] = [];
      const cx = Math.round((p.x - minX) * 2), cy = Math.round((p.y - minY) * 2);
      for (let y = Math.max(0, cy - 6); y <= Math.min(height - 1, cy + 6); y++) for (let x = Math.max(0, cx - 6); x <= Math.min(width - 1, cx + 6); x++) {
        const i = y * width + x, [px, py] = xy(i), d = Math.hypot(px - p.x, py - p.y);
        if (d > 3) continue;
        const z = floorAt(probe, px, py, p.z, 0.3);
        if (z !== undefined && clean(probe, [p, { x: px, y: py, z }])) candidates.push({ i, p: { x: px, y: py, z }, d });
      }
      return candidates.sort((a, b) => a.d - b.d || a.i - b.i)[0];
    };
    const s = nearest(start), g = nearest(goal);
    if (!s || !g) { unresolved.push({ edgeId: edge.id, reason: "no lattice path" }); continue; }
    type State = { i: number; p: Point; cost: number; score: number; prev?: State };
    const heap: State[] = [];
    const push = (v: State) => { heap.push(v); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p]!.score <= v.score) break; heap[i] = heap[p]!; i = p; } heap[i] = v; };
    const pop = (): State => { const first = heap[0]!, last = heap.pop()!; if (heap.length) { let i = 0; while (2 * i + 1 < heap.length) { let c = 2 * i + 1; if (c + 1 < heap.length && heap[c + 1]!.score < heap[c]!.score) c++; if (heap[c]!.score >= last.score) break; heap[i] = heap[c]!; i = c; } heap[i] = last; } return first; };
    const best = new Map<number, number>();
    push({ ...s, cost: 0, score: Math.hypot(s.p.x - goal.x, s.p.y - goal.y) }); best.set(s.i, 0);
    let found: State | undefined;
    while (heap.length) {
      const cur = pop(); if (cur.cost !== best.get(cur.i)) continue;
      if (cur.i === g.i && clean(probe, [cur.p, goal])) { found = cur; break; }
      const cx = cur.i % width, cy = Math.floor(cur.i / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || cx + dx < 0 || cx + dx >= width || cy + dy < 0 || cy + dy >= height) continue;
        const i = (cy + dy) * width + cx + dx, cost = cur.cost + Math.hypot(dx, dy) / 2;
        if (cost >= (best.get(i) ?? Infinity)) continue;
        const [x, y] = xy(i), z = floorAt(probe, x, y, cur.p.z, 0.3);
        if (z === undefined || !clean(probe, [cur.p, { x, y, z }])) continue;
        best.set(i, cost); push({ i, p: { x, y, z }, cost, score: cost + Math.hypot(x - goal.x, y - goal.y), prev: cur });
      }
    }
    if (!found) { unresolved.push({ edgeId: edge.id, reason: "no lattice path" }); continue; }
    const cells: Point[] = []; for (let c: State | undefined = found; c; c = c.prev) cells.push(c.p); cells.reverse();
    const raw = [start, ...cells, goal], simplified: Point[] = [start];
    for (let i = 0; i < raw.length - 1;) { let j = raw.length - 1; while (j > i + 1 && !clean(probe, [raw[i]!, raw[j]!])) j--; simplified.push(raw[j]!); i = j; }
    const count = violations(auditPolyline(probe, simplified.map(point)));
    if (count) unresolved.push({ edgeId: edge.id, reason: `still ${count} violations` }); else geometry.set(edge.id, simplified);
  }
  const sceneGaps = new Map<string, boolean>();
  for (const edge of selected) {
    if (edge.attributes?.sceneGapReason !== "drape-unresolved" && (edge.attributes?.sceneGap !== undefined || edge.attributes?.sceneGapReason !== undefined)) continue;
    const finalEdge = geometry.has(edge.id) ? { ...edge, geometry: geometry.get(edge.id)! } : edge;
    const finalBundle = { ...updated, edges: updated.edges.map(e => e.id === edge.id ? finalEdge : e) };
    const detail: SampleDetail[] = [];
    const audit = auditPolyline(probe, drawn(finalBundle, finalEdge), { skipInteriorFloor: edge.mode === "elevator", detail });
    const interiorWall = detail.some((sample, i) => sample.wallBefore && !detail.slice(Math.max(0, i - 2), i + 2).some(d => d.floor === "none"));
    const flag = audit.offFloor > 0 || interiorWall;
    if (flag || edge.attributes?.sceneGapReason === "drape-unresolved" && violations(audit) === 0) sceneGaps.set(edge.id, flag);
  }
  return { nodes, geometry, unresolved, sceneGaps };
}

/** Update a successfully draped edge and retain its previous route length. */
export function applyDrapeGeometry(edge: Edge, geometry: Point[]): void {
  const length = geometry.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - geometry[i]!.x, p.y - geometry[i]!.y), 0);
  // Scene-floor z stays numeric; geometryMethod records its provenance without making the route approximate.
  edge.geometry = geometry;
  edge.attributes = { ...edge.attributes, geometryMethod: "drape:scene-floor-lattice", lengthMethod: "drape-geometry", lengthMBeforeDrape: edge.lengthM };
  edge.lengthM = Math.round(length * 10) / 10;
  edge.geometryEvidence = { ...edge.geometryEvidence, method: `${edge.geometryEvidence.method}+drape` };
}

function resolvedPath(p: string): string {
  let ancestor = path.resolve(p); const tail: string[] = [];
  while (!fs.existsSync(ancestor)) { tail.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); }
  return path.resolve(fs.realpathSync(ancestor), ...tail);
}
function privateOutput(out: string): string {
  const output = resolvedPath(out), rel = path.relative(fs.realpathSync(repoRoot), output);
  if (rel === "" || !path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`)) throw new Error("refusing --out inside the git repo");
  return output;
}
/** Resolve and validate the input overlay and its output destination. */
export function drapePaths(privateDir: string, station: string, file: string, out: string): { input: string; output: string } {
  const root = resolvedPath(privateDir), additions = resolvedPath(path.join(root, "additions"));
  const input = resolvedPath(path.resolve(root, file)), output = privateOutput(out);
  const parts = path.relative(additions, input).split(path.sep);
  if (station !== "shinjuku" || parts.length !== 2 || parts[0] !== station || !/^graph(\..+)?\.json$/.test(parts[1]!))
    throw new Error("--file must be an additions/shinjuku/graph*.json overlay file");
  const rel = path.relative(additions, output);
  if (output !== input && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
    throw new Error("--out must be the input file or outside the private additions directory");
  return { input, output };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2), values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) { if (!["--station", "--private", "--file", "--out"].includes(args[i]!) || !args[i + 1]) throw new Error(`unknown or incomplete argument: ${args[i]}`); values[args[i]!] = args[i + 1]!; }
  const station = values["--station"], privateDir = values["--private"], file = values["--file"], out = values["--out"];
  if (!station || !privateDir || !file || !out) throw new Error("--station, --private, --file and --out are required");
  process.chdir(repoRoot);
  const { input, output } = drapePaths(privateDir, station, file, out);
  const doc = JSON.parse(fs.readFileSync(input, "utf8")) as { nodes: Node[]; edges: Edge[] };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-drape-"));
  try {
    fs.cpSync(path.join(privateDir, "additions"), path.join(tmp, "additions"), { recursive: true });
    const overlayModule = new URL("../../../tools/private-overlay/build-overlay.ts", import.meta.url).href;
    const { buildOverlay } = await import(overlayModule) as { buildOverlay: (o: { repoRoot: string; privateDir: string; stations: string[] }) => string[] };
    if (!buildOverlay({ repoRoot: process.cwd(), privateDir: tmp, stations: [station] }).includes(station)) throw new Error("station overlay not built");
    const dir = path.join(tmp, "overlay", station, "gteki"), read = (n: string) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")) as unknown;
    const parsed = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"), fs.existsSync(path.join(dir, "tenants.json")) ? read("tenants.json") : undefined, { privateTier: true });
    if (!parsed.ok) throw new Error(`overlay failed validation: ${JSON.stringify(parsed.issues).slice(0, 500)}`);
    const result = drapeEdges(sceneProbe(await loadScene(station, parsed.bundle)), parsed.bundle, new Set(doc.edges.map(e => e.id)), { nodeIds: new Set(doc.nodes.map(n => n.id)) });
    for (const n of doc.nodes) if (result.nodes.has(n.id)) n.renderZ = result.nodes.get(n.id)!;
    for (const e of doc.edges) {
      const geometry = result.geometry.get(e.id); if (geometry) applyDrapeGeometry(e, geometry);
      const flag = result.sceneGaps.get(e.id);
      if (flag === true) e.attributes = { ...e.attributes, sceneGap: true, sceneGapReason: "drape-unresolved" };
      else if (flag === false && e.attributes) { delete e.attributes.sceneGap; delete e.attributes.sceneGapReason; }
    }
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(doc, null, 2)}\n`);
    console.log(`nodes ${result.nodes.size}, edges ${result.geometry.size}, unresolved ${result.unresolved.length}, sceneGap flagged ${[...result.sceneGaps.values()].filter(Boolean).length}`);
    for (const u of result.unresolved) console.log(`${u.edgeId}: ${u.reason}`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e); process.exitCode = 1; });
