/** Public Ikebukuro route comparison; failures remain explicit, never joined across missing edges. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { init, importNavMesh, NavMeshQuery, Detour, statusDetail, type NavMesh } from "recast-navigation";
import { createRouter, DEFAULT_PROFILE, nodeDisplayZ, routeBetween, routePolyline, type PolylinePoint, type RouteResult, type RouteStep } from "@gteki/navigation";
import { navmeshBundle } from "./navmesh-input.ts";
import { makeGreybox } from "./navmesh-greybox.ts";
import { qaFile } from "./navmesh-qa-path.ts";
import { auditPolyline, loadScene, sceneProbe, resampleAudit, type SampleDetail, type AuditCache } from "./route-clip-audit.ts";
import { diagnoseVerticalSnap, validateLinkSnap } from "./navmesh-links.ts";

import { buildConnectorPath } from "@gteki/navigation";

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

/** Obtain the complete corridor and preserve Detour off-mesh link identity and direction. */
export function queryPathWithLinks(nav: NavMesh, query: NavMeshQuery, from: V3, to: V3, diagnostics?: { straightLimit: boolean }): ({ point: V3; link?: { userId: number; end: V3 } })[] | null {
  const a=query.findClosestPoint(from, { halfExtents:extents }), b=query.findClosestPoint(to, { halfExtents:extents });
  if (!a.success || !a.polyRef || !b.success || !b.polyRef) return null;
  const corridor=query.findPath(a.polyRef,b.polyRef,from,to,{ maxPathPolys:2048 });
  try {
    if (!corridor.success || !corridor.polys.size || corridor.polys.get(corridor.polys.size-1)!==b.polyRef || statusDetail(corridor.status,Detour.DT_BUFFER_TOO_SMALL) || statusDetail(corridor.status,Detour.DT_OUT_OF_NODES)) return null;
    const refs=Array.from({length:corridor.polys.size},(_,i)=>corridor.polys.get(i));
    const result: ({ point: V3; link?: {userId:number;end:V3} })[]=[];
    const appendWalking=(start:V3,end:V3,polys:number[]) => {
      const straight=query.findStraightPath(start,end,polys,{ maxStraightPathPoints:2048 });
      try {
        if (statusDetail(straight.status,Detour.DT_BUFFER_TOO_SMALL)) { if (diagnostics) diagnostics.straightLimit = true; return false; }
        if (!straight.success) return false;
        for (let i=0;i<straight.straightPathCount;i++) result.push({point:{x:straight.straightPath.get(i*3),y:straight.straightPath.get(i*3+1),z:straight.straightPath.get(i*3+2)}});
        return true;
      } finally { straight.straightPath.destroy(); straight.straightPathFlags.destroy(); straight.straightPathRefs.destroy(); }
    };
    let start=from, offset=0;
    for (let i=1;i<refs.length-1;i++) {
      const poly=nav.getTileAndPolyByRef(refs[i]!);
      if (!poly.success) return null;
      if (poly.poly.getType()!==1) continue; // DT_POLYTYPE_OFFMESH_CONNECTION
      const ends=nav.getOffMeshConnectionPolyEndPoints(refs[i-1]!,refs[i]!);
      if (!ends.success || !appendWalking(start,ends.start,refs.slice(offset,i))) return null;
      result.push({point:ends.start,link:{userId:nav.getOffMeshConnectionByRef(refs[i]!).userId(),end:ends.end}});
      start=ends.end; offset=i+1;
    }
    if (!appendWalking(start,to,refs.slice(offset))) return null;
    if (!result.length || distance(result[0]!.point,from)>0.01 || distance(result.at(-1)!.point,to)>0.01) return null;
    return result;
  } finally { corridor.polys.destroy(); }
}

async function main() {
  let station = "", navmeshFile = "", json = "", withGreybox = false, snapFallback = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--station" && args[i+1]) station = args[++i]!;
    else if (args[i] === "--navmesh" && args[i+1]) navmeshFile = args[++i]!;
    else if (args[i] === "--json" && args[i+1]) json = args[++i]!;
    else if (args[i] === "--with-greybox") withGreybox = true;
    else if (args[i] === "--snap-fallback") snapFallback = true;
    else throw new Error(`unknown or incomplete argument: ${args[i]}`);
  }
  if (!station || !navmeshFile || !json) throw new Error("use --station <station> --navmesh <file> --json <file>");
  const dest = qaFile(json);
  const loadStart = performance.now();
  const meshBytes = fs.readFileSync(navmeshFile);
  const provenance = JSON.parse(fs.readFileSync(path.join(path.dirname(navmeshFile), `${station}-bake.json`), "utf8"));
  if (provenance.station !== station || provenance.withGreybox !== withGreybox || provenance.meshSha256 !== createHash("sha256").update(meshBytes).digest("hex")) throw new Error("navmesh bake provenance does not match station, greybox flag, or binary; rebake first");
  if (!!provenance.snapFallback !== snapFallback) throw new Error("navmesh bake and audit disagree on --snap-fallback");
  await init();
  const nav = importNavMesh(meshBytes).navMesh, query = new NavMeshQuery(nav, { maxNodes: 8192 });
  const loadMs = performance.now() - loadStart, memoryAfterLoad = process.memoryUsage();
  const { bundle, privateBuild } = await navmeshBundle(station);
  if (provenance.privateBuild !== privateBuild) throw new Error("navmesh bake and audit disagree on private overlay; rebake first");
  if (provenance.bundleSha256 !== createHash("sha256").update(JSON.stringify(bundle)).digest("hex")) throw new Error("navmesh bake and audit bundle differ; rebake first");
  const router = createRouter(bundle, { allowUnverified: privateBuild }), scene = await loadScene(station, bundle);
  const grey = withGreybox ? makeGreybox(bundle, scene, privateBuild) : null;
  const probe = grey?.probe ?? sceneProbe(scene);
  const nodes = new Map(bundle.nodes.map(n => [n.id, n])), floors = new Map(bundle.floors.map(f => [f.id, f]));
  const edges = new Map(bundle.edges.map(e => [e.id, e]));
  const attached = new Set<number>(provenance.attachedLinkIds ?? []);
  type Fallback={neighborId:string;edgeId:string};
  type Link={edgeId:string;connection:{userId:number;startPosition:V3;endPosition:V3};fallback?:{from?:Fallback;to?:Fallback}};
  const links = new Map<number, Link>((provenance.links?.candidates ?? []).filter((v:Link)=>attached.has(v.connection.userId)).map((v:Link) => [v.connection.userId,v]));
  const linksByEdge = new Map([...links.values()].map(link => [link.edgeId, link]));
  const usedFallbackEdges = new Set<string>();
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
  type Entry = { points: PolylinePoint[] | null; missing: boolean; reason: "snap_failed" | "no_path" | "too_long" | "join_gap" | null; stairLink: boolean; connector: boolean; fallbackUsed:string[]; corridor: number[]; gapM: number; gapWidthM: number | null; step: RouteStep; fromSnapped: boolean; toSnapped: boolean; connectivity: "connected" | "disconnected" | "query_limit" | "query_error" | "unknown_snap" | "link_attached" | "link_unattached"; partialEndDistanceM: number | null; pathRejection: "missing_link" | "wrong_link" | "unexpected_link" | "reconstruction" | null };
  const cache = new Map<string, Entry>();
  // Approximate width from scene wall segments perpendicular to the graph edge.
  // This is a sampled cross-section, not proof of a doorway or clearance through the mesh.
  const crossSectionWidth = (route: RouteResult, step: RouteStep): number | null => {
    if (step.fromFloorId !== step.toFloorId) return null;
    const line = routePolyline(bundle, { ...route, nodeIds:[step.fromNodeId,step.toNodeId], steps:[step] });
    let narrow = Infinity;
    for (let i=1; i<line.length; i++) {
      const a=line[i-1]!, b=line[i]!, dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy);
      if (len < 1e-8) continue;
      const nx=-dy/len, ny=dx/len, n=Math.max(1,Math.ceil(len/0.5));
      for (let k=0; k<=n; k++) {
        const t=k/n, x=a.x+dx*t, y=a.y+dy*t, z=a.z+(b.z-a.z)*t;
        let left=Infinity, right=Infinity;
        for (const w of probe.walls) {
          if (w.zMax <= z+0.2 || w.zMin >= z+1.7) continue;
          if (Math.max(w.a.x,w.b.x)<x-5 || Math.min(w.a.x,w.b.x)>x+5 || Math.max(w.a.y,w.b.y)<y-5 || Math.min(w.a.y,w.b.y)>y+5) continue;
          const wx=w.b.x-w.a.x, wy=w.b.y-w.a.y, cross=nx*wy-ny*wx;
          if (Math.abs(cross)<1e-9) continue;
          const ox=w.a.x-x, oy=w.a.y-y, d=(ox*wy-oy*wx)/cross, u=(ox*ny-oy*nx)/cross;
          if (u<0 || u>1 || Math.abs(d)>5) continue;
          if (d>=0) left=Math.min(left,d); else right=Math.min(right,-d);
        }
        if (Number.isFinite(left) && Number.isFinite(right)) narrow=Math.min(narrow,left+right);
      }
    }
    return Number.isFinite(narrow) ? narrow : null;
  };
  const edgePath = (route: RouteResult, step: RouteStep): Entry => {
    const key = `${step.edgeId}\0${step.reversed ? 1 : 0}`;
    const cached = cache.get(key); if (cached) return cached;
    const from = nodePoint(step.fromNodeId), to = nodePoint(step.toNodeId), link = linksByEdge.get(step.edgeId);
    if (["stairs","escalator","elevator"].includes(step.mode)) {
      const line=routePolyline(bundle,{...route,nodeIds:[step.fromNodeId,step.toNodeId],steps:[step]});
      const built=buildConnectorPath(query,from,to,line,(node,snapped)=>validateLinkSnap(probe,node,snapped)===null);
      const entry: Entry = {points:built.points,missing:built.reason!==null,reason:built.reason,stairLink:false,connector:!!built.points,fallbackUsed:[],corridor:[],gapM:distance(from,to),gapWidthM:null,step,fromSnapped:built.fromSnapped,toSnapped:built.toSnapped,connectivity:link ? "link_attached" : "link_unattached",partialEndDistanceM:null,pathRejection:null};
      cache.set(key,entry); return entry;
    }
    const a = link ? (step.reversed ? link.connection.endPosition : link.connection.startPosition) : snap(step.fromNodeId);
    const b = link ? (step.reversed ? link.connection.startPosition : link.connection.endPosition) : snap(step.toNodeId);
    const pathDiagnostics = { straightLimit:false };
    let path = a && b ? queryPathWithLinks(nav,query,a,b,pathDiagnostics) : null;
    let pathRejection: Entry["pathRejection"] = null;
    if (["stairs","escalator","elevator"].includes(step.mode) && (!link || !path?.some(p=>p.link?.userId===link.connection.userId))) { if (path) pathRejection=link ? "wrong_link" : "missing_link"; path=null; }
    if (!["stairs","escalator","elevator"].includes(step.mode) && path?.some(p=>p.link)) { pathRejection="unexpected_link"; path=null; }
    const tooLong = step.mode === "stairs" && !!path && !path.some(p=>p.link) && length(path.map(p=>p.point)) > 2 * step.lengthM;
    let reason: "snap_failed" | "no_path" | "too_long" | null = !a || !b ? "snap_failed" : !path ? "no_path" : tooLong ? "too_long" : null;
    const stairLink = false;
    const fallbackUsed = new Set<string>();
    let points: (PolylinePoint & {connector?:boolean})[] | null = null;
    if (path && !reason) {
      points=[];
      for (const part of path) {
        const p=part.point;
        points.push({ x:p.x,y:-p.z,z:p.y,zKnown:true,stepIndex:0,floorId:distance(p,from)<=distance(p,to) ? step.fromFloorId:step.toFloorId });
        if (!part.link) continue;
        const link=links.get(part.link.userId), edge=link && edges.get(link.edgeId);
        if (!link || !edge) { points=null; break; }
        if (link.fallback && link.edgeId!==step.edgeId) { points=null; break; }
        const reversed=distance(part.point,link.connection.endPosition)<distance(part.point,link.connection.startPosition);
        if (reversed && edge.direction!=="both") { points=null; break; }
        const fromId=reversed ? edge.to:edge.from, toId=reversed ? edge.from:edge.to;
        const n1=nodes.get(fromId), n2=nodes.get(toId);
        if (!n1 || !n2) { points=null; break; }
        const linkStep={...step,edgeId:edge.id,mode:edge.mode,fromNodeId:fromId,toNodeId:toId,fromFloorId:n1.floorId,toFloorId:n2.floorId,reversed};
        const approach=(fb:Fallback, startId:string, endId:string) => {
          const via=edges.get(fb.edgeId), nStart=nodes.get(startId), nEnd=nodes.get(endId);
          if (!via || !nStart || !nEnd || via.direction!=="both") return null;
          const viaStep={...step,edgeId:via.id,mode:via.mode,fromNodeId:startId,toNodeId:endId,fromFloorId:nStart.floorId,toFloorId:nEnd.floorId,reversed:via.from!==startId};
          return routePolyline(bundle,{...route,nodeIds:[startId,endId],steps:[viaStep]}).map(q=>({...q,connector:true}));
        };
        const first=reversed ? link.fallback?.to : link.fallback?.from, last=reversed ? link.fallback?.from : link.fallback?.to;
        if (first) { const line=approach(first,first.neighborId,fromId); if (!line) {points=null;break;} points.push(...line); }
        points.push(...routePolyline(bundle,{...route,nodeIds:[fromId,toId],steps:[linkStep]}).map(q=>({...q,connector:true})));
        if (last) { const line=approach(last,toId,last.neighborId); if (!line) {points=null;break;} points.push(...line); }
        points.push({x:part.link.end.x,y:-part.link.end.z,z:part.link.end.y,zKnown:true,stepIndex:0,floorId:n2.floorId,connector:true});
        if (first || last) fallbackUsed.add(link.edgeId);
      }
    }
    if (!points && !reason) { reason="no_path"; pathRejection="reconstruction"; }
    const missing = reason !== null;
    let corridor: number[] = [];
    let partialEndDistanceM: number | null = null;
    let connectivity: Entry["connectivity"] = a && b ? "query_error" : "unknown_snap";
    if (a && b) {
      const start = query.findClosestPoint(a, { halfExtents: extents });
      const end = query.findClosestPoint(b, { halfExtents: extents });
      if (start.polyRef && end.polyRef) {
        const found = query.findPath(start.polyRef, end.polyRef, a, b, { maxPathPolys:2048 });
        if (found.success) {
          corridor = Array.from({ length:found.polys.size }, (_,i) => found.polys.get(i));
          const reached = corridor.at(-1) === end.polyRef;
          if (!reached && corridor.length) {
            const last = query.closestPointOnPoly(corridor.at(-1)!, b);
            if (last.success) partialEndDistanceM = distance(last.closestPoint, b);
          }
          const limited = statusDetail(found.status, Detour.DT_BUFFER_TOO_SMALL) || statusDetail(found.status, Detour.DT_OUT_OF_NODES);
          connectivity = limited ? "query_limit" : reached ? "connected" : "disconnected";
          if (!reached || missing || path?.some(p=>p.link)) corridor = [];
        }
        else if (statusDetail(found.status, Detour.DT_BUFFER_TOO_SMALL) || statusDetail(found.status, Detour.DT_OUT_OF_NODES)) connectivity = "query_limit";
        found.polys.destroy();
      }
    }
    if (pathDiagnostics.straightLimit) connectivity = "query_limit";
    const entry: Entry = { points, missing, reason, stairLink, connector:!!points?.some(p=>p.connector), fallbackUsed:[...fallbackUsed], corridor, gapM: distance(from, to), gapWidthM: missing && !stairLink ? crossSectionWidth(route,step) : null, step, fromSnapped: !!snap(step.fromNodeId), toSnapped: !!snap(step.toNodeId), connectivity, partialEndDistanceM, pathRejection };
    cache.set(key, entry); return entry;
  };
  const totals = () => ({ samples: 0, offFloor: 0, noFloor: 0, wallHits: 0 });
  const add = (target: ReturnType<typeof totals>, result: ReturnType<typeof auditPolyline>) => {
    target.samples += result.samples; target.offFloor += result.offFloor; target.noFloor += result.noFloor; target.wallHits += result.wallHits;
  };
  const auditCache: AuditCache = { floor: new Map(), wall: new Map() };
  const joinChecks = new Map<string, boolean>();
  const detailHeights = new Map<string, number | null>(), ambiguousHeights = new Set<string>();
  const heightKey = (p: PolylinePoint, entry: Entry) => `${entry.step.edgeId},${entry.step.reversed},${p.x},${p.y},${p.z}`;
  const heightAt = (p: PolylinePoint, entry: Entry | undefined, join: boolean): number | null => {
    if (!entry || join || entry.stairLink || !entry.corridor.length) return null;
    const key = heightKey(p, entry);
    if (detailHeights.has(key)) return detailHeights.get(key)!;
    const q = { x:p.x, y:p.z, z:-p.y };
    let value: number | null = null, min = Infinity, max = -Infinity;
    for (const ref of entry.corridor) {
      const closest = query.closestPointOnPoly(ref, q);
      if (!closest.success || !closest.isPointOverPoly) continue;
      const h = query.getPolyHeight(ref, q);
      if (h.success) { min = Math.min(min,h.height); max = Math.max(max,h.height); if (value === null || Math.abs(h.height-p.z) < Math.abs(value-p.z)) value = h.height; }
    }
    if (max-min > 0.05) { ambiguousHeights.add(key); value = null; }
    detailHeights.set(key, value); return value;
  };
  const rawTotal = totals(), sceneTotal = totals(), rawDiffs: number[] = [], detailDiffs: number[] = [];
  let detailMissing = 0, detailMissingFallback = 0, detailMissingJoin = 0, detailAmbiguous = 0, sceneMissing = 0, offFloorWithDetail = 0, offFloorWithoutDetail = 0;
  const heightCorrections: number[] = [];
  let detailLargeHeightJumps = 0, detailMaxHeightJump = 0;
  const wallClasses = { notInBake: 0, possibleCornerOrRaster: 0, join: 0, possibleDifferentCorridor: 0, unclassified: 0 };
  const wallLocations = new Map<string, number>();
  const navTotal = totals(), graphComparable = totals(), graphAll = totals(), ratios: number[] = [];
  const connectorRaw = totals(), walkingRaw = totals(), connectorDetail = totals(), walkingDetail = totals(), connectorScene = totals(), walkingScene = totals();
  let routeCount = 0, completed = 0, pure = 0, hybrid = 0, incomplete = 0, invalidJoinRoutes = 0, unpairedFallbackRoutes = 0, fallbackRoutesCompleted = 0, routeFailures = 0, stepUses = 0, joinsWithGap = 0, maxJoinGapM = 0;
  const routeSteps: RouteStep[][] = [];
  const usedVerticalSteps = new Map<string, RouteStep>();
  const affectedByMode: Record<string, number> = {};
  const pois = bundle.pois.filter(p => p.connectorNodeIds.length > 0);
  for (const from of pois) for (const to of pois) {
    if (from.id === to.id) continue;
    const route = routeBetween(router, { kind: "poi", poi: from }, to, DEFAULT_PROFILE);
    if (!route.ok) { routeFailures++; continue; }
    routeCount++; stepUses += route.steps.length; routeSteps.push(route.steps);
    for (const step of route.steps) if (["stairs","escalator","elevator"].includes(step.mode)) usedVerticalSteps.set(step.edgeId,step);
    const graph = routePolyline(bundle, route);
    const graphAudit = auditPolyline(probe, graph, { cache:auditCache });
    add(graphAll, graphAudit);
    const consumed=new Set<number>();
    const entries = route.steps.filter((_step,i)=>!consumed.has(i)).map(step => edgePath(route, step));
    if (entries.some(e => !e.points?.length)) {
      incomplete++;
      for (const mode of new Set(entries.filter(e => !e.points?.length).map(e => e.step.mode))) affectedByMode[mode] = (affectedByMode[mode] ?? 0) + 1;
      continue;
    }
    let invalidJoin=false;
    for (let i=1;i<entries.length;i++) {
      const p=entries[i-1]!.points!.at(-1)!, q=entries[i]!.points![0]!;
      if (Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)<1e-6) continue;
      const key=`${p.x},${p.y},${p.z};${q.x},${q.y},${q.z}`;
      let valid=joinChecks.get(key);
      if (valid===undefined) {
        const checked=auditPolyline(probe,[p,q],{cache:auditCache});
        const a={x:p.x,y:p.z,z:-p.y}, b={x:q.x,y:q.z,z:-q.y}, na=query.findClosestPoint(a,{halfExtents:extents}), nb=query.findClosestPoint(b,{halfExtents:extents});
        const path=na.success && nb.success && na.polyRef && nb.polyRef && distance(a,na.point)<=0.02 && distance(b,nb.point)<=0.02 ? queryPathWithLinks(nav,query,a,b) : null;
        valid=!checked.wallHits && !checked.offFloor && !checked.noFloor && !!path && !path.some(v=>v.link) && length(path.map(v=>v.point))<=distance(a,b)+0.3;
        joinChecks.set(key,valid);
      }
      if (!valid) { invalidJoin=true; break; }
    }
    if (invalidJoin) { incomplete++; invalidJoinRoutes++; continue; }
    type Marked = PolylinePoint & { join?: boolean; fallback?: boolean; connector?: boolean };
    const walked: Marked[] = [];
    for (const [entryIndex, entry] of entries.entries()) {
      const pts = entry.points!;
      // Keep both endpoints when snapping/fallback produces a gap, so the audit sees it.
      const last = walked.at(-1), first = pts[0];
      const joinGap = last && first ? Math.hypot(last.x-first.x, last.y-first.y, last.z-first.z) : 0;
      if (joinGap >= 1e-6) { joinsWithGap++; maxJoinGapM = Math.max(maxJoinGapM, joinGap); }
      const skip = last && first && joinGap < 1e-6 ? 1 : 0;
      walked.push(...pts.slice(skip).map((p, j) => ({ ...p, stepIndex: entryIndex, fallback: entry.stairLink, join: !!last && !skip && j === 0 })));
    }
    if (!walked.length) { incomplete++; continue; }
    completed++; if (consumed.size) fallbackRoutesCompleted++; for (const entry of entries) for (const id of entry.fallbackUsed) usedFallbackEdges.add(id); if (entries.some(e => e.connector)) hybrid++; else pure++;
    const samples = resampleAudit(walked) as Marked[];
    const rawDetails: SampleDetail[] = [];
    add(rawTotal, auditPolyline(probe, samples, { alreadySampled:true, detail:rawDetails, cache:auditCache }));
    const detailPoints = samples.map((p, i) => {
      const entry = entries[p.stepIndex];
      const z = heightAt(p, entry, !!p.join);
      if (z === null) { detailMissing++; if (p.join) detailMissingJoin++; else if (entry?.stairLink) detailMissingFallback++; else if (entry && ambiguousHeights.has(heightKey(p, entry))) detailAmbiguous++; }
      else heightCorrections.push(Math.abs(z-p.z));
      const floor = rawDetails[i]!.floorZ;
      if (floor !== undefined) rawDiffs.push(Math.abs(p.z-floor));
      return { ...p, z:z ?? p.z };
    });
    for (let i=1; i<detailPoints.length; i++) {
      const jump = Math.abs(detailPoints[i]!.z-detailPoints[i-1]!.z);
      detailMaxHeightJump = Math.max(detailMaxHeightJump, jump);
      if (jump > 0.3) detailLargeHeightJumps++;
    }
    const detailInfo: SampleDetail[] = [];
    add(navTotal, auditPolyline(probe, detailPoints, { alreadySampled:true, detail:detailInfo, cache:auditCache }));
    const scenePoints = samples.map((p,i) => {
      const z = rawDetails[i]!.floorZ;
      if (z === undefined) sceneMissing++;
      return { ...p, z:z ?? p.z };
    });
    const sceneInfo: SampleDetail[] = [];
    add(sceneTotal, auditPolyline(probe, scenePoints, { alreadySampled:true, cache:auditCache, detail:sceneInfo }));
    for (let i=0;i<samples.length;i++) {
      for (const [detail, target] of [[rawDetails[i]!, samples[i]!.connector ? connectorRaw:walkingRaw], [detailInfo[i]!, samples[i]!.connector ? connectorDetail:walkingDetail], [sceneInfo[i]!, samples[i]!.connector ? connectorScene:walkingScene]] as const) {
        target.samples++; if (detail.floor === "off") target.offFloor++; if (detail.floor === "none") target.noFloor++; if (detail.wallBefore) target.wallHits++;
      }
    }
    for (let i = 0; i < samples.length; i++) {
      const d = detailInfo[i]!, p = samples[i]!;
      if (d.floorZ !== undefined) detailDiffs.push(Math.abs(detailPoints[i]!.z-d.floorZ));
      if (d.floor === "off") { if (heightAt(p, entries[p.stepIndex], !!p.join) === null) offFloorWithoutDetail++; else offFloorWithDetail++; }
      if (!d.wallBefore) continue;
      const loc = d.wallPoint ?? { x:p.x, y:p.y, z:p.z };
      const id = d.wallCollider !== undefined ? `collider ${d.wallCollider} ${probe.collider[d.wallCollider]?.name || "unnamed"}` : `wall ${d.wallSegment ?? "unknown"}`;
      const locKey = `${id} at (${loc.x.toFixed(1)}, ${loc.y.toFixed(1)}, ${loc.z.toFixed(1)})`;
      wallLocations.set(locKey, (wallLocations.get(locKey) ?? 0)+1);
      if (p.join) { wallClasses.join++; continue; }
      if (d.wallCollider === undefined && d.wallSegment === undefined) { wallClasses.unclassified++; continue; }
      const object = d.wallCollider === undefined ? null : probe.collider[d.wallCollider] as import("three").Mesh;
      if (object && !object.geometry?.getAttribute("position")) { wallClasses.notInBake++; continue; }
      const step = entries[p.stepIndex]?.step;
      if (!step) { wallClasses.unclassified++; continue; }
      const edgeLine = routePolyline(bundle, { ...route, nodeIds:[step.fromNodeId,step.toNodeId], steps:[step] });
      let dist = Infinity;
      for (let j=1; j<edgeLine.length; j++) {
        const a=edgeLine[j-1]!, b=edgeLine[j]!, dx=b.x-a.x, dy=b.y-a.y;
        const t=Math.max(0,Math.min(1,((loc.x-a.x)*dx+(loc.y-a.y)*dy)/(dx*dx+dy*dy || 1)));
        dist=Math.min(dist,Math.hypot(loc.x-a.x-t*dx,loc.y-a.y-t*dy));
      }
      if (dist > 2) wallClasses.possibleDifferentCorridor++;
      else wallClasses.unclassified++;
    }
    add(graphComparable, graphAudit);
    const graphLength = length(graph); if (graphLength > 0) ratios.push(length(walked) / graphLength);
  }
  const failed = [...cache.values()].filter(e => e.missing);
  const diagnosed = new Map<string, ReturnType<typeof diagnoseVerticalSnap>>();
  for (const step of usedVerticalSteps.values()) {
    for (const nodeId of [step.fromNodeId,step.toNodeId]) {
      const key=`${step.edgeId}\0${nodeId}`;
      if (!diagnosed.has(key)) diagnosed.set(key,diagnoseVerticalSnap(query,probe,nodePoint(nodeId)));
    }
  }
  const failedEndpoints=[...diagnosed.values()].filter(d=>d.reason !== null);
  const dz=failedEndpoints.flatMap(d=>d.deltaZ === null ? [] : [d.deltaZ]);
  const absDz=dz.map(Math.abs);
  const distribution=(values:number[]) => ({count:values.length,p50:percentile(values,0.5),p95:percentile(values,0.95),max:values.length ? Math.max(...values) : null});
  const heights=failedEndpoints.filter(d=>d.reason==="height"), floorsRejected=failedEndpoints.filter(d=>d.reason==="floor");
  const snapDiagnosis={ failedEndpoints:failedEndpoints.length, noPoly:failedEndpoints.filter(d=>d.reason==="no_poly").length, height:heights.length, floor:floorsRejected.length, wall:failedEndpoints.filter(d=>d.reason==="wall").length, heightDetail:{above:heights.filter(d=>d.deltaZ!>0).length,below:heights.filter(d=>d.deltaZ!<0).length,greyboxFloorAtNode:heights.filter(d=>d.greyboxFloorAtNode).length}, floorDetail:{source:{scene:floorsRejected.filter(d=>d.floorSource==="scene").length,greybox:floorsRejected.filter(d=>d.floorSource==="greybox").length,none:floorsRejected.filter(d=>d.floorSource==="none").length}, rule:{snapNoFloor:floorsRejected.filter(d=>d.floorRule==="snap_no_floor").length,snapHeight:floorsRejected.filter(d=>d.floorRule==="snap_height").length,approachNoFloor:floorsRejected.filter(d=>d.floorRule==="approach_no_floor").length,approachOffFloor:floorsRejected.filter(d=>d.floorRule==="approach_off_floor").length,unknown:floorsRejected.filter(d=>d.floorRule===null).length}}, deltaZM:distribution(dz), absDeltaZM:distribution(absDz), sampledWalkableWithin3m:failedEndpoints.filter(d=>d.walkableWithin3m).length, sampledNoWalkableWithin3m:failedEndpoints.filter(d=>!d.walkableWithin3m).length };
  const failures = failed.map(e => ({ edgeId: e.step.edgeId, mode: e.step.mode, floor: e.step.fromFloorId, direction: e.step.reversed ? "reverse" : "forward", straightGapM: e.gapM, reason: e.reason, stairLink: e.stairLink, fromSnapped:e.fromSnapped, toSnapped:e.toSnapped, connectivity:e.connectivity, sampledWallCrossSectionM:e.gapWidthM }))
    .sort((a,b) => b.straightGapM-a.straightGapM || a.edgeId.localeCompare(b.edgeId));
  // Fresh uncached WASM path queries; excludes graph routing, floor probing and path reconstruction.
  const edgeTimes: number[] = [], routeTimes: number[] = [];
  const timedEdge = (step: RouteStep) => {
    if (["stairs","escalator","elevator"].includes(step.mode)) return;
    const a = snap(step.fromNodeId), b = snap(step.toNodeId);
    if (!a || !b) return;
    const start = performance.now(); queryCompletePath(query, a, b); edgeTimes.push(performance.now()-start);
  };
  for (const entry of cache.values()) timedEdge(entry.step);
  const uniqueQueryTimes = edgeTimes.slice(); edgeTimes.length = 0;
  for (const steps of routeSteps) {
    const start = performance.now(); for (const step of steps) timedEdge(step);
    routeTimes.push(performance.now()-start);
  }
  const runtime = { loadMs, memoryAfterLoad, edgeQueries:uniqueQueryTimes.length, edgeMs:{p50:percentile(uniqueQueryTimes,0.5),p95:percentile(uniqueQueryTimes,0.95)}, routes:routeTimes.length, routeMs:{p50:percentile(routeTimes,0.5),p95:percentile(routeTimes,0.95)}, estimateFactor:4 };
  const connectedNoPath = failed.filter(e => e.connectivity === "connected" && e.reason === "no_path");
  const partialDistances = failed.flatMap(e => e.partialEndDistanceM === null ? [] : [e.partialEndDistanceM]);
  const queryDiagnosis = { connectedNoPath: connectedNoPath.length, missingLink: connectedNoPath.filter(e => e.pathRejection === "missing_link").length, wrongLink: connectedNoPath.filter(e => e.pathRejection === "wrong_link").length, unexpectedLink: connectedNoPath.filter(e => e.pathRejection === "unexpected_link").length, reconstruction: connectedNoPath.filter(e => e.pathRejection === "reconstruction").length, other: connectedNoPath.filter(e => e.pathRejection === null).length, partialEndDistanceM:distribution(partialDistances) };
  const failureClasses: Record<string, number> = {};
  for (const e of failures) {
    const key = `${e.mode} | ${e.fromSnapped && e.toSnapped ? "both snapped" : "snap missing"} | ${e.connectivity} | ${e.reason}`;
    failureClasses[key] = (failureClasses[key] ?? 0)+1;
  }
  const result = { station, withGreybox, snapFallback, queryMaxNodes:8192, queryDiagnosis, linkAttachmentDiagnosis:provenance.linkAttachmentDiagnosis ?? null, fallbackRecoveredAttached:provenance.fallbackRecovered ?? 0, fallbackEdgesUsed:usedFallbackEdges.size, fallbackRoutesCompleted, unpairedFallbackRoutes, bakeProvenance: provenance, collisionAuditUsesOriginalGateObstacles: provenance.ignoreGates, affectedIncompleteRoutesByMode:affectedByMode, failureClasses, failureEdges:failures, greyboxRuns: grey?.grey.stats.runs ?? null, greyboxLandingPads:grey?.grey.stats.landingPads ?? null, runtime, orderedPoiPairs: pois.length * (pois.length-1), routesAudited: routeCount, failedRoutePairs: routeFailures, completeAuditedRoutes: completed, pureNavmeshRoutes: pure, routesWithConnectors: hybrid, incompleteRoutes: incomplete, invalidJoinRoutes, joinsWithGap, maxJoinGapM,
    edgeUses: stepUses, uniqueEdgesUsed: new Set([...cache.values()].map(e => e.step.edgeId)).size, directedEdgesQueried: cache.size,
    navmeshTotals: navTotal, snapDiagnosis, navmeshSegmentHeights:{default:walkingDetail,gateSceneRaycast:walkingScene}, segmentTotals:{ raw:{connector:connectorRaw,navmesh:walkingRaw}, detail:{connector:connectorDetail,navmesh:walkingDetail}, sceneRaycast:{connector:connectorScene,navmesh:walkingScene} }, diagnosis: { raw: rawTotal, detail: navTotal, sceneRaycast: sceneTotal,
      detailHeightUnavailableSamples: detailMissing, detailUnavailableStairFallback: detailMissingFallback, detailUnavailableJoin: detailMissingJoin, detailUnavailableAmbiguous: detailAmbiguous, detailLargeHeightJumps, detailMaxHeightJump, offFloorWithDetail, offFloorWithoutDetail, heightCorrectionM: { count:heightCorrections.length, p50:percentile(heightCorrections,0.5), p95:percentile(heightCorrections,0.95), max:heightCorrections.length ? heightCorrections.reduce((a,b)=>Math.max(a,b),0) : null }, sceneFloorUnavailableSamples: sceneMissing,
      rawAbsDzM: { count:rawDiffs.length, p50:percentile(rawDiffs,0.5), p95:percentile(rawDiffs,0.95), max:rawDiffs.length ? rawDiffs.reduce((a,b)=>Math.max(a,b),0) : null },
      detailAbsDzM: { count:detailDiffs.length, p50:percentile(detailDiffs,0.5), p95:percentile(detailDiffs,0.95), max:detailDiffs.length ? detailDiffs.reduce((a,b)=>Math.max(a,b),0) : null },
      wallClasses, topWalls:[...wallLocations.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([location,hits])=>({location,hits})) }, graphComparableTotals: graphComparable, graphAllRoutableTotals: graphAll,
    directedEdgesWithoutAcceptablePath: failures.length, uniqueEdgesWithoutAcceptablePath: new Set(failures.map(e => e.edgeId)).size, failuresByReason: { snapFailed: failures.filter(e => e.reason === "snap_failed").length, noPath: failures.filter(e => e.reason === "no_path").length, tooLong: failures.filter(e => e.reason === "too_long").length, joinGap: failures.filter(e => e.reason === "join_gap").length }, worst20: failures.slice(0,20),
    directedStairLinks: [...cache.values()].filter(e => e.step.mode === "stairs" && e.connector).length, uniqueStairsWithoutPath: new Set(failed.filter(e => e.step.mode === "stairs").map(e => e.step.edgeId)).size,
    snapDistanceM: { count: snapDistances.length, p50: percentile(snapDistances, 0.5), p95: percentile(snapDistances, 0.95), max: snapDistances.length ? Math.max(...snapDistances) : null },
    medianPathToGraphLength: percentile(ratios, 0.5) };
  fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, JSON.stringify(result, null, 2) + "\n");
  console.log(`link attachment ${JSON.stringify(result.linkAttachmentDiagnosis)}; query diagnosis ${JSON.stringify(queryDiagnosis)}; snap diagnosis ${JSON.stringify(snapDiagnosis)}; fallback attached ${result.fallbackRecoveredAttached}, used ${result.fallbackEdgesUsed}, completed routes ${fallbackRoutesCompleted}; navmesh segments ${JSON.stringify(result.navmeshSegmentHeights)}`);
  query.destroy(); nav.destroy(); scene.dispose();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
}
