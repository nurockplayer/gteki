/** Public Ikebukuro route comparison; failures remain explicit, never joined across missing edges. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { init, importNavMesh, NavMeshQuery } from "recast-navigation";
import { createRouter, DEFAULT_PROFILE, nodeDisplayZ, routeBetween, routePolyline, type PolylinePoint, type RouteResult, type RouteStep } from "@gteki/navigation";
import { parseStationFiles, type StationBundle } from "@gteki/schema";
import { auditPolyline, loadScene, sceneProbe } from "./route-clip-audit.ts";

type V3 = { x: number; y: number; z: number };
const extents = { x: 1, y: 0.6, z: 1 };
const distance = (a: V3, b: V3) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
const length = (points: readonly V3[]) => points.slice(1).reduce((n, p, i) => n + distance(points[i]!, p), 0);
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a,b) => a-b);
  if (!sorted.length) return null;
  if (p === 0.5 && sorted.length % 2 === 0) return (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  return sorted[Math.ceil(p * sorted.length) - 1]!;
};

/** Query between already snapped renderer points, rejecting Detour's partial paths. */
export function queryCompletePath(query: NavMeshQuery, from: V3, to: V3): V3[] | null {
  const result = query.computePath(from, to, { halfExtents: extents, maxPathPolys: 2048, maxStraightPathPoints: 2048 });
  const last = result.path.at(-1);
  const first = result.path[0];
  if (!result.success || !first || !last || distance(first, from) > 0.01 || distance(last, to) > 0.01) return null;
  return result.path;
}

/** Snap in renderer coordinates, enforcing the node's height separately from search extents. */
export function snapNode(query: NavMeshQuery, p: V3): V3 | null {
  const hit = query.findClosestPoint(p, { halfExtents: extents });
  return hit.success && hit.polyRef && Math.abs(hit.point.y - p.y) <= 0.6 ? hit.point : null;
}

function loadBundle(): StationBundle {
  const dir = path.join(process.cwd(), "stations", "ikebukuro", "gteki");
  const read = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  const result = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"), read("tenants.json"));
  if (!result.ok) throw new Error(`public bundle invalid: ${JSON.stringify(result.issues).slice(0, 500)}`);
  return result.bundle;
}

async function main() {
  let station = "", navmeshFile = "", json = "";
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--station" && args[i+1]) station = args[++i]!;
    else if (args[i] === "--navmesh" && args[i+1]) navmeshFile = args[++i]!;
    else if (args[i] === "--json" && args[i+1]) json = args[++i]!;
    else throw new Error(`unknown or incomplete argument: ${args[i]}`);
  }
  if (station !== "ikebukuro" || !navmeshFile || !json) throw new Error("use --station ikebukuro --navmesh <file> --json <file>");
  const qa = path.resolve(".qa"), dest = path.resolve(json);
  if (!dest.startsWith(qa + path.sep)) throw new Error("JSON output must be under .qa/");
  const bundle = loadBundle(), router = createRouter(bundle), scene = await loadScene(station, bundle), probe = sceneProbe(scene);
  await init();
  const nav = importNavMesh(fs.readFileSync(navmeshFile)).navMesh, query = new NavMeshQuery(nav);
  const nodes = new Map(bundle.nodes.map(n => [n.id, n])), floors = new Map(bundle.floors.map(f => [f.id, f]));
  const edges = new Map(bundle.edges.map(e => [e.id, e]));
  const nodePoint = (id: string): V3 => {
    const n = nodes.get(id)!;
    return { x: n.position.x, y: nodeDisplayZ(n, floors.get(n.floorId)).z, z: -n.position.y };
  };
  const snapped = new Map<string, V3 | null>(), snapDistances: number[] = [];
  const snap = (id: string) => {
    if (!snapped.has(id)) {
      const p = nodePoint(id), s = snapNode(query, p);
      snapped.set(id, s); if (s) snapDistances.push(distance(p, s));
    }
    return snapped.get(id)!;
  };
  type Entry = { points: PolylinePoint[] | null; missing: boolean; reason: "snap_failed" | "no_path" | "too_long" | null; stairLink: boolean; gapM: number; step: RouteStep };
  const cache = new Map<string, Entry>();
  const edgePath = (route: RouteResult, step: RouteStep): Entry => {
    const key = `${step.edgeId}\0${step.reversed ? 1 : 0}`;
    const cached = cache.get(key); if (cached) return cached;
    const from = nodePoint(step.fromNodeId), to = nodePoint(step.toNodeId), a = snap(step.fromNodeId), b = snap(step.toNodeId);
    const path = a && b ? queryCompletePath(query, a, b) : null;
    const tooLong = step.mode === "stairs" && !!path && length(path) > 2 * step.lengthM;
    const reason = !a || !b ? "snap_failed" : !path ? "no_path" : tooLong ? "too_long" : null;
    const missing = reason !== null;
    const stairLink = step.mode === "stairs" && missing;
    let points: PolylinePoint[] | null = null;
    if (stairLink) {
      points = routePolyline(bundle, { ...route, nodeIds: [step.fromNodeId, step.toNodeId], steps: [step] });
    } else if (path && !missing) {
      points = path.map(p => ({ x: p.x, y: -p.z, z: p.y, zKnown: true, stepIndex: 0,
        floorId: distance(p, from) <= distance(p, to) ? step.fromFloorId : step.toFloorId }));
    }
    const entry: Entry = { points, missing, reason, stairLink, gapM: distance(from, to), step };
    cache.set(key, entry); return entry;
  };
  const totals = () => ({ samples: 0, offFloor: 0, noFloor: 0, wallHits: 0 });
  const add = (target: ReturnType<typeof totals>, result: ReturnType<typeof auditPolyline>) => {
    target.samples += result.samples; target.offFloor += result.offFloor; target.noFloor += result.noFloor; target.wallHits += result.wallHits;
  };
  const navTotal = totals(), graphComparable = totals(), graphAll = totals(), ratios: number[] = [];
  let routeCount = 0, completed = 0, pure = 0, hybrid = 0, incomplete = 0, routeFailures = 0, stepUses = 0, joinsWithGap = 0, maxJoinGapM = 0;
  const pois = bundle.pois.filter(p => p.connectorNodeIds.length > 0);
  for (const from of pois) for (const to of pois) {
    if (from.id === to.id) continue;
    const route = routeBetween(router, { kind: "poi", poi: from }, to, DEFAULT_PROFILE);
    if (!route.ok) { routeFailures++; continue; }
    routeCount++; stepUses += route.steps.length;
    const graph = routePolyline(bundle, route);
    const graphAudit = auditPolyline(probe, graph);
    add(graphAll, graphAudit);
    const entries = route.steps.map(step => edgePath(route, step));
    if (entries.some(e => !e.points?.length)) { incomplete++; continue; }
    const walked: PolylinePoint[] = [];
    for (const entry of entries) {
      const pts = entry.points!;
      // Keep both endpoints when snapping/fallback produces a gap, so the audit sees it.
      const last = walked.at(-1), first = pts[0];
      const joinGap = last && first ? Math.hypot(last.x-first.x, last.y-first.y, last.z-first.z) : 0;
      if (joinGap >= 1e-6) { joinsWithGap++; maxJoinGapM = Math.max(maxJoinGapM, joinGap); }
      const skip = last && first && joinGap < 1e-6 ? 1 : 0;
      walked.push(...pts.slice(skip));
    }
    if (!walked.length) { incomplete++; continue; }
    completed++; if (entries.some(e => e.stairLink)) hybrid++; else pure++;
    add(navTotal, auditPolyline(probe, walked)); add(graphComparable, graphAudit);
    const graphLength = length(graph); if (graphLength > 0) ratios.push(length(walked) / graphLength);
  }
  const failed = [...cache.values()].filter(e => e.missing);
  const failures = failed.map(e => ({ edgeId: e.step.edgeId, mode: e.step.mode, floor: e.step.fromFloorId, direction: e.step.reversed ? "reverse" : "forward", straightGapM: e.gapM, reason: e.reason, stairLink: e.stairLink }))
    .sort((a,b) => b.straightGapM-a.straightGapM || a.edgeId.localeCompare(b.edgeId));
  const result = { station, orderedPoiPairs: pois.length * (pois.length-1), routesAudited: routeCount, failedRoutePairs: routeFailures, completeAuditedRoutes: completed, pureNavmeshRoutes: pure, hybridStairFallbackRoutes: hybrid, incompleteRoutes: incomplete, joinsWithGap, maxJoinGapM,
    edgeUses: stepUses, uniqueEdgesUsed: new Set([...cache.values()].map(e => e.step.edgeId)).size, directedEdgesQueried: cache.size,
    navmeshTotals: navTotal, graphComparableTotals: graphComparable, graphAllRoutableTotals: graphAll,
    directedEdgesWithoutAcceptablePath: failures.length, uniqueEdgesWithoutAcceptablePath: new Set(failures.map(e => e.edgeId)).size, failuresByReason: { snapFailed: failures.filter(e => e.reason === "snap_failed").length, noPath: failures.filter(e => e.reason === "no_path").length, tooLong: failures.filter(e => e.reason === "too_long").length }, worst20: failures.slice(0,20),
    directedStairLinks: failed.filter(e => e.stairLink).length, uniqueStairsNeedingLinks: new Set(failed.filter(e => e.stairLink).map(e => e.step.edgeId)).size,
    snapDistanceM: { count: snapDistances.length, p50: percentile(snapDistances, 0.5), p95: percentile(snapDistances, 0.95), max: snapDistances.length ? Math.max(...snapDistances) : null },
    medianPathToGraphLength: percentile(ratios, 0.5) };
  fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  query.destroy(); nav.destroy(); scene.dispose();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
}
