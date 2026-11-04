/** Public Ikebukuro route comparison; failures remain explicit, never joined across missing edges. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import * as THREE from "three";
import { init, importNavMesh, NavMeshQuery, Detour, statusDetail, type NavMesh } from "recast-navigation";
import { assembleSnapPath, snapJoinKey, buildConnectorPath, createRouter, DEFAULT_PROFILE, nodeDisplayZ, routeBetween, routePolyline, type PolylinePoint, type RouteResult, type RouteStep } from "@gteki/navigation";
import { skippedConnectorPath } from "../../../apps/web/src/explorer/greyboxConnectors.ts";
import { navmeshBundle, privateRegionsSha256 } from "./navmesh-input.ts";
import { floorScene, floorSplitPlan, parseFloors } from "./navmesh-floors.ts";
import { makeGreybox } from "./navmesh-greybox.ts";
import { qaFile } from "./navmesh-qa-path.ts";
import { auditPolyline, loadScene, sceneProbe, resampleAudit, type SampleDetail, type AuditCache } from "./route-clip-audit.ts";
import { diagnoseVerticalSnap, validateLinkSnap } from "./navmesh-links.ts";
import { makeFloorHeightNear, suspectVerticalEdges } from "./navmesh-suspect.ts";

import { auditFallbackSegments, fallbackGate } from "./navmesh-fallback-audit.ts";
import { dataWidth, diagnoseGaps } from "./navmesh-gaps.ts";
import { objectNames } from "./navmesh-source.ts";

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

/** Failed connectors retain main's built fallback geometry; it is never admitted as a snapped guide. */
export function connectorFallbackPolyline(bundle: Parameters<typeof routePolyline>[0], route: RouteResult, connectorPaths?: Parameters<typeof routePolyline>[2]): PolylinePoint[] {
  return routePolyline(bundle,route,connectorPaths);
}

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

/** Audit a gate using its own directed off-mesh connection, never a different gate or walking bypass. */
export function auditGatePath(nav: NavMesh, query: NavMeshQuery, from: V3, to: V3, line: readonly PolylinePoint[], validateSnap: (node: V3, snap: V3) => boolean,
  link: { connection: { userId: number; startPosition: V3; endPosition: V3 } } | undefined, reversed = false) {
  const built = buildConnectorPath(query, from, to, line, validateSnap);
  const reject = (pathRejection: "missing_link" | "wrong_link") => ({ ...built, points: null, missing: true, reason: "no_path" as const, pathRejection });
  if (!link) return reject("missing_link");
  if (!built.points) return { ...built, missing: true, pathRejection: null };
  const a = reversed ? link.connection.endPosition : link.connection.startPosition;
  const b = reversed ? link.connection.startPosition : link.connection.endPosition;
  // Select this connection explicitly: a shortest walking path can bypass a valid wide gate.
  let traversable = false;
  for (let i=0;i<nav.getMaxTiles() && !traversable;i++) {
    const tile=nav.getTile(i), header=tile.header(); if (!header) continue;
    for (let j=0;j<header.offMeshConCount() && !traversable;j++) {
      const connection=tile.offMeshCons(j);
      if (connection.userId() !== link.connection.userId || (reversed && !(connection.flags() & 1))) continue; // DT_OFFMESH_CON_BIDIR
      const endpoint=(offset:number)=>({x:connection.pos(offset),y:connection.pos(offset+1),z:connection.pos(offset+2)});
      if (distance(a,endpoint(reversed ? 3 : 0))>0.01 || distance(b,endpoint(reversed ? 0 : 3))>0.01) continue;
      const ends = new Map<number,number[]>();
      let next=tile.polys(connection.poly()).firstLink(), guard=0;
      while (next !== 0xffffffff && guard++ < header.maxLinkCount()) {
        const adjacent=tile.links(next);
        if (adjacent.ref()) ends.set(adjacent.edge(),[...(ends.get(adjacent.edge()) ?? []),adjacent.ref()]);
        next=adjacent.next();
      }
      if (!ends.has(0) || !ends.has(1)) continue;
      const connectionRef=nav.getPolyRefBase(tile)+connection.poly();
      // Verify the directed floor→connection→floor corridor, including the incoming floor link.
      for (const ref of ends.get(reversed ? 1 : 0)!) {
        const ground=nav.getTileAndPolyByRef(ref), groundHeader=ground.success ? ground.tile.header() : null;
        if (!ground.success || !groundHeader) continue;
        let entry=ground.poly.firstLink(), count=0;
        while (entry !== 0xffffffff && count++ < groundHeader.maxLinkCount()) {
          const adjacent=ground.tile.links(entry);
          if (adjacent.ref() === connectionRef) { traversable=true; break; }
          entry=adjacent.next();
        }
        if (traversable) break;
      }
    }
  }
  if (!traversable) return reject("wrong_link");
  return { ...built, missing: false, pathRejection: null, points: [
    { ...built.points[0]!, x: a.x, y: -a.z, z: a.y },
    ...built.points.slice(1,-1),
    { ...built.points.at(-1)!, x: b.x, y: -b.z, z: b.y },
  ] };
}

/** Snap a path's vertices to the floor height floorAt reports. Between two vertices the floor is sampled every 0.25 m of
 * plan length; where the straight line leaves it by more than 0.05 m, the path is split at the worst sample, at floor
 * height, and both halves are checked again (#669 r2: a ramp foot between vertices). */
export function floorSnapPath<P extends { x: number; y: number; z: number }>(points: readonly P[], floorAt: (p: P) => number): P[] {
  const dense: P[] = [];
  const refine = (a: P, b: P, depth: number) => {
    const span = Math.hypot(b.x-a.x, b.y-a.y), steps = Math.min(64, Math.ceil(span / 0.25));
    let worst: P | null = null, worstOff = 0.05;
    for (let i = 1; i < steps; i++) {
      const t = i / steps, q = { ...a, x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, z:a.z+(b.z-a.z)*t }, floorZ = floorAt(q);
      if (Math.abs(floorZ - q.z) > worstOff) { worstOff = Math.abs(floorZ - q.z); worst = { ...q, z:floorZ }; }
    }
    if (worst && depth < 8) { refine(a, worst, depth+1); dense.push(worst); refine(worst, b, depth+1); }
  };
  const snapped = points.map(p => ({ ...p, z:floorAt(p) }));
  snapped.forEach((p,i) => { if (i) refine(snapped[i-1]!, p, 0); dense.push(p); });
  return dense;
}

/** Clip totals over the samples that count: samples of suspect edges never do (their heights cannot be built). */
export function countedTotals(details: readonly Pick<SampleDetail,"floor"|"wallBefore">[], samples: readonly { suspect?: boolean }[]) {
  const total = { samples: 0, offFloor: 0, noFloor: 0, wallHits: 0 };
  details.forEach((d, i) => {
    if (samples[i]?.suspect) return;
    total.samples++;
    if (d.floor === "off") total.offFloor++;
    if (d.floor === "none") total.noFloor++;
    if (d.wallBefore) total.wallHits++;
  });
  return total;
}

/** A missing hash also rejects meshes baked before private geometry entered provenance. */
export function assertPrivateRegionsProvenance(provenance: { privateRegionsSha256?: string }, regions: Parameters<typeof privateRegionsSha256>[0]): void {
  if (provenance.privateRegionsSha256 !== privateRegionsSha256(regions)) throw new Error("navmesh bake and audit private regions differ; rebake first");
}

async function main() {
  let station = "", navmeshFile = "", json = "", fallbackList = "", withGreybox = false, snapFallback = false, bridgeGaps = false, gate = false;
  let floorIds: string[] | undefined, splitPlan = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--station" && args[i+1]) station = args[++i]!;
    else if (args[i] === "--navmesh" && args[i+1]) navmeshFile = args[++i]!;
    else if (args[i] === "--json" && args[i+1]) json = args[++i]!;
    else if (args[i] === "--fallback-list" && args[i+1]) fallbackList = args[++i]!;
    else if (args[i] === "--gate") gate = true;
    else if (args[i] === "--floors" && args[i+1]) floorIds = parseFloors(args[++i]!);
    else if (args[i] === "--split-plan") splitPlan = true;
    else if (args[i] === "--with-greybox") withGreybox = true;
    else if (args[i] === "--snap-fallback") snapFallback = true;
    else if (args[i] === "--bridge-gaps") bridgeGaps = true;
    else throw new Error(`unknown or incomplete argument: ${args[i]}`);
  }
  if (splitPlan) {
    const { bundle } = await navmeshBundle(station, floorIds);
    console.log(JSON.stringify({ station, estimate: "sum of floor node bounding-box raster cells at 0.15 m, 64 bytes/cell; excludes scene/greybox/WASM overhead", groups: floorSplitPlan(bundle) }, null, 2));
    return;
  }
  if (gate && !fallbackList) throw new Error("--gate requires --fallback-list");
  if (!station || !navmeshFile || !json) throw new Error("use --station <station> --navmesh <file> --json <file>");
  const dest = qaFile(json);
  const loadStart = performance.now();
  const meshBytes = fs.readFileSync(navmeshFile);
  const provenance = JSON.parse(fs.readFileSync(path.join(path.dirname(navmeshFile), `${station}-bake.json`), "utf8"));
  if (provenance.station !== station || provenance.withGreybox !== withGreybox || provenance.meshSha256 !== createHash("sha256").update(meshBytes).digest("hex")) throw new Error("navmesh bake provenance does not match station, greybox flag, or binary; rebake first");
  if (JSON.stringify(provenance.floors) !== JSON.stringify(floorIds)) throw new Error("navmesh bake and audit disagree on --floors");
  if (!!provenance.bridgeGaps !== bridgeGaps) throw new Error("navmesh bake and audit disagree on --bridge-gaps");
  if (bridgeGaps && provenance.bridgePolicy !== "no-exemptions-v1") throw new Error("obsolete bridge mesh; rebake without exemptions");
  if (!!provenance.snapFallback !== snapFallback) throw new Error("navmesh bake and audit disagree on --snap-fallback");
  await init();
  const nav = importNavMesh(meshBytes).navMesh, query = new NavMeshQuery(nav, { maxNodes: 8192 });
  const loadMs = performance.now() - loadStart, memoryAfterLoad = process.memoryUsage();
  const { bundle, privateBuild, privateRegions, outOfSplit = [], sceneBundle = bundle } = await navmeshBundle(station, floorIds);
  if (provenance.privateBuild !== privateBuild) throw new Error("navmesh bake and audit disagree on private overlay; rebake first");
  if (provenance.bundleSha256 !== createHash("sha256").update(JSON.stringify(bundle)).digest("hex")) throw new Error("navmesh bake and audit bundle differ; rebake first");
  assertPrivateRegionsProvenance(provenance, privateBuild && withGreybox ? privateRegions : undefined);
  const router = createRouter(bundle, { allowUnverified: privateBuild }), scene = floorScene(await loadScene(station, sceneBundle), bundle, floorIds);
  const grey = withGreybox ? makeGreybox(bundle, scene, privateBuild, privateRegions) : null;
  const originalProbe = grey?.probe ?? sceneProbe(scene);
  // Recomputed exactly as the bake does; a difference means the bake and this audit see different inputs.
  const suspect = suspectVerticalEdges(bundle, makeFloorHeightNear(grey?.suspectProbe ?? originalProbe), e => router.isTraversable(e, DEFAULT_PROFILE));
  if (JSON.stringify(suspect) !== JSON.stringify(provenance.suspectEdges ?? null)) throw new Error("navmesh bake and audit disagree on suspect vertical edges; rebake first");
  // Keep the existing fallback construction separate from snap-only guide admission.
  const connectorPaths = grey?.connectors ? new Map([...grey.connectors.pathByEdge].map(([id,path]) => [id,path.map(q=>({x:q.x,y:-q.z,z:q.y}))])) : undefined;
  if (grey?.connectors) for (const edge of bundle.edges) if (grey.connectors.skippedEdgeIds.includes(edge.id)) connectorPaths!.set(edge.id,skippedConnectorPath(bundle,edge));
  const suspectIds = new Set(suspect.map(s => s.edgeId)), usedSuspect = new Set<string>();
  const bridgeFloorGeometry=new THREE.BufferGeometry(); bridgeFloorGeometry.setAttribute("position",new THREE.Float32BufferAttribute(provenance.bridgeFloorTriangles ?? [],3));
  const bridgeFloor=new THREE.Mesh(bridgeFloorGeometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})); bridgeFloor.userData.greybox=true; bridgeFloor.updateMatrixWorld(true);
  const probe={...originalProbe,ground:[...originalProbe.ground,...(bridgeGaps && bridgeFloorGeometry.getAttribute("position").count ? [bridgeFloor] : [])]};
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
  type Entry = { suspect: boolean; points: PolylinePoint[] | null; missing: boolean; reason: "snap_failed" | "no_path" | "too_long" | "join_gap" | null; stairLink: boolean; connector: boolean; fallbackUsed:string[]; corridor: number[]; gapM: number; gapWidthM: number | null; step: RouteStep; fromSnapped: boolean; toSnapped: boolean; connectivity: "connected" | "disconnected" | "query_limit" | "query_error" | "unknown_snap" | "link_attached" | "link_unattached"; partialEndDistanceM: number | null; gaps: ReturnType<typeof diagnoseGaps>; graph: PolylinePoint[]; pathRejection: "missing_link" | "wrong_link" | "unexpected_link" | "reconstruction" | null };
  const cache = new Map<string, Entry>();
  const canonicalSnaps=new Map<string,PolylinePoint|null>();
  const canonicalSnap=<P extends PolylinePoint>(p:P):P|null=>{
    const key=`${p.x},${p.y},${p.z}`;
    if(!canonicalSnaps.has(key)) { const hit=snapNode(query,{x:p.x,y:p.z,z:-p.y}); canonicalSnaps.set(key,hit ? {...p,x:hit.x,y:-hit.z,z:hit.y} : null); }
    const hit=canonicalSnaps.get(key); return hit ? {...p,x:hit.x,y:hit.y,z:hit.z} : null;
  };
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
    if (suspectIds.has(step.edgeId)) {
      usedSuspect.add(step.edgeId);
      const line = routePolyline(bundle,{...route,nodeIds:[step.fromNodeId,step.toNodeId],steps:[step]});
      const entry: Entry = {suspect:true,points:line.map(p=>({...p,suspectPolyline:true as const,sceneGap:true as const})),missing:false,reason:null,stairLink:false,connector:false,fallbackUsed:[],corridor:[],gapM:distance(from,to),gapWidthM:null,step,fromSnapped:false,toSnapped:false,connectivity:"unknown_snap",partialEndDistanceM:null,gaps:[],graph:line,pathRejection:null};
      cache.set(key,entry); return entry;
    }
    if (["stairs","escalator","elevator","gate"].includes(step.mode)) {
      const a = link && (step.reversed ? link.connection.endPosition : link.connection.startPosition);
      const b = link && (step.reversed ? link.connection.startPosition : link.connection.endPosition);
      // The off-mesh traversal retains the built connector's bends/landings, never its graph-node ends.
      // A link endpoint is authoritative even when the authored node is outside the navmesh.
      const built = grey?.connectors?.pathByEdge.get(step.edgeId);
      const interior = a && built?.length ? (distance(built[0]!,a) <= distance(built.at(-1)!,a) ? built : [...built].reverse()).slice(1,-1) : [];
      const linkPoints = a && b ? [a,...interior,b] : null;
      let points = linkPoints?.map((p,i) => ({x:p.x,y:-p.z,z:p.y,zKnown:true,stepIndex:0,floorId:i === linkPoints.length-1 ? step.toFloorId : step.fromFloorId,connector:true})) ?? null;
      // Preserve #791's explicit directed gate-link admission, using the baked endpoints.
      const gate = step.mode === "gate" && a && b && points
        ? auditGatePath(nav,query,a,b,points,(node,snapped)=>validateLinkSnap(probe,node,snapped)===null,link,step.reversed)
        : null;
      if (step.mode === "gate") points=gate?.points ?? null;
      const snappedPoints=points?.map((p,i)=>i===0 || i===points!.length-1 ? canonicalSnap(p) : p);
      const hasSnaps=!!snappedPoints?.[0] && !!snappedPoints?.at(-1);
      if(snappedPoints?.every((p):p is NonNullable<typeof p>=>p!==null)) {
        const samples=resampleAudit(snappedPoints), detail:SampleDetail[]=[]; auditPolyline(probe,samples,{alreadySampled:true,detail,cache:auditCache});
        const onFloor=samples.map((p,i)=>({...p,z:detail[i]?.floorZ ?? p.z}));
        const checked=auditPolyline(probe,onFloor,{alreadySampled:true,cache:auditCache});
        points=checked.wallHits || checked.offFloor || checked.noFloor ? null : snappedPoints;
      } else points=null;
      const entry: Entry = {suspect:false,points,missing:!points,reason:points ? null : link && hasSnaps ? "no_path" : step.mode === "gate" ? "no_path" : "snap_failed",stairLink:false,connector:!!points,fallbackUsed:link?.fallback ? [step.edgeId] : [],corridor:[],gapM:distance(from,to),gapWidthM:null,step,fromSnapped:!!snappedPoints?.[0],toSnapped:!!snappedPoints?.at(-1),connectivity:link ? "link_attached" : "link_unattached",partialEndDistanceM:null,gaps:[],graph:connectorFallbackPolyline(bundle,{...route,nodeIds:[step.fromNodeId,step.toNodeId],steps:[step]},connectorPaths),pathRejection:gate?.pathRejection ?? (link && !points ? "reconstruction":null)};

      cache.set(key,entry); return entry;
    }
    const a = link ? (step.reversed ? link.connection.endPosition : link.connection.startPosition) : snap(step.fromNodeId);
    const b = link ? (step.reversed ? link.connection.startPosition : link.connection.endPosition) : snap(step.toNodeId);
    const pathDiagnostics = { straightLimit:false };
    let path = a && b ? queryPathWithLinks(nav,query,a,b,pathDiagnostics) : null;
    let pathRejection: Entry["pathRejection"] = null;
    // Vertical steps were resolved by their own attached link above. Walking never borrows another link.
    if (path?.some(p=>p.link)) { pathRejection="unexpected_link"; path=null; }
    const reason: "snap_failed" | "no_path" | null = !a || !b ? "snap_failed" : !path ? "no_path" : null;
    const stairLink = false;
    const fallbackUsed = new Set<string>();
    const points: PolylinePoint[] | null = path?.map(({point:p}) => ({x:p.x,y:-p.z,z:p.y,zKnown:true,stepIndex:0,floorId:distance(p,from)<=distance(p,to) ? step.fromFloorId:step.toFloorId})) ?? null;
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
    const graph=routePolyline(bundle,{...route,nodeIds:[step.fromNodeId,step.toNodeId],steps:[step]});
    const edge=edges.get(step.edgeId);
    const gaps=missing && edge ? diagnoseGaps(query,probe,graph,dataWidth(edge),provenance.effectiveClimbM ?? provenance.climbM ?? 0.3,{radius:provenance.radiusM ?? 0.3,cell:provenance.cellSizeM ?? 0.1}) : [];
    const entry: Entry = { suspect:false, points, missing, reason, stairLink, connector:false, fallbackUsed:[...fallbackUsed], corridor, gapM: distance(from, to), gapWidthM: missing && !stairLink ? crossSectionWidth(route,step) : null, step, fromSnapped: !!snap(step.fromNodeId), toSnapped: !!snap(step.toNodeId), connectivity, partialEndDistanceM, gaps, graph, pathRejection };
    cache.set(key, entry); return entry;
  };
  const totals = () => ({ samples: 0, offFloor: 0, noFloor: 0, wallHits: 0 });
  const add = (target: ReturnType<typeof totals>, result: { samples: number; offFloor: number; noFloor: number; wallHits: number }) => {
    target.samples += result.samples; target.offFloor += result.offFloor; target.noFloor += result.noFloor; target.wallHits += result.wallHits;
  };
  const auditCache: AuditCache = { floor: new Map(), wall: new Map() };
  const joinChecks = new Map<string, PolylinePoint[] | null>();
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
  const wallName=(detail:SampleDetail)=>{const object=detail.wallCollider===undefined ? undefined : probe.collider[detail.wallCollider]; const wall=detail.wallSegment===undefined ? undefined : probe.walls[detail.wallSegment]; return object ? objectNames(object) : {name:wall ? "wall segment" : "unidentified collider",role:wall?.role ?? "",parents:[] as string[],source:wall?.source ?? "unknown",constructorName:"WallSegment",userDataKeys:[] as string[],materialName:""};};
  const clipSites:{kind:"connector"|"fallback";edgeId:string;mode:string;join:boolean;point:{x:number;y:number;z:number}|null;wall:ReturnType<typeof wallName>}[]=[];
  const completedConnectorKeys=new Set<string>();
  const completedEdgeKeys=new Set<string>();
  const clipCounts:Record<string,{connectorWallHits:number;fallbackWallHits:number;navmeshWallHits:number;offFloor:number}>=Object.create(null);
  const recordClip=(id:string,field:"connectorWallHits"|"fallbackWallHits"|"navmeshWallHits"|"offFloor")=>{const c=clipCounts[id] ??= {connectorWallHits:0,fallbackWallHits:0,navmeshWallHits:0,offFloor:0};c[field]++;};
  const onLine=(line:readonly PolylinePoint[],p:PolylinePoint)=>line.slice(1).some((b,j)=>{const a=line[j]!,dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy+(p.z-a.z)*dz)/(dx*dx+dy*dy+dz*dz || 1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy,p.z-a.z-t*dz)<0.05;});
  let suspectPolylineRoutes=0;
  let routeCount = 0, completed = 0, pure = 0, hybrid = 0, incomplete = 0, invalidJoinRoutes = 0, unpairedFallbackRoutes = 0, fallbackRoutesCompleted = 0, routeFailures = 0, stepUses = 0, joinsWithGap = 0, maxJoinGapM = 0;
  const routeSteps: RouteStep[][] = [];
  const usedVerticalSteps = new Map<string, RouteStep>();
  const affectedByMode: Record<string, number> = {};
  const pois = bundle.pois.filter(p => p.connectorNodeIds.length > 0);
  // POIs on the same connector nodes (a store tied to a gate shares the gate's node) have no route between them and
  // route identically to everything else: every pair still counts for coverage, but each node-set pair's route is
  // audited once, so a new POI on an existing node does not re-count the same clips.
  const nodeSet = (p: (typeof pois)[number]) => [...p.connectorNodeIds].sort().join("\n");
  const auditedPairs = new Set<string>();
  for (const from of pois) for (const to of pois) {
    if (from.id === to.id || nodeSet(from) === nodeSet(to)) continue;
    const route = routeBetween(router, { kind: "poi", poi: from }, to, DEFAULT_PROFILE);
    if (!route.ok) { routeFailures++; continue; }
    routeCount++;
    const pairKey = `${nodeSet(from)}\t${nodeSet(to)}`;
    if (auditedPairs.has(pairKey)) continue;
    auditedPairs.add(pairKey);
    stepUses += route.steps.length; routeSteps.push(route.steps);
    for (const step of route.steps) if (["stairs","escalator","elevator"].includes(step.mode)) usedVerticalSteps.set(step.edgeId,step);
    const graph = routePolyline(bundle, route);
    const graphAudit = auditPolyline(probe, graph, { cache:auditCache });
    add(graphAll, graphAudit);
    const consumed=new Set<number>();
    const entries = route.steps.filter((_step,i)=>!consumed.has(i)).map(step => edgePath(route, step));
    if(entries.some(e=>e.suspect)) { suspectPolylineRoutes++; continue; }
    if (entries.some(e => !e.points?.length)) {
      incomplete++;
      for (const mode of new Set(entries.filter(e => !e.points?.length).map(e => e.step.mode))) affectedByMode[mode] = (affectedByMode[mode] ?? 0) + 1;
      continue;
    }
    type Marked = PolylinePoint & { join?: boolean; fallback?: boolean; connector?: boolean; suspect?: boolean };
    const assembled = assembleSnapPath<Marked>(entries.map((entry, i) => entry.points!.map(p => ({ ...p, stepIndex:i, fallback:entry.stairLink, suspect:entry.suspect }))), (p,q,i) => {
      const key=snapJoinKey(entries[i-1]!.step,entries[i]!.step);
      if (!joinChecks.has(key)) {
        const path=queryPathWithLinks(nav,query,{x:p.x,y:p.z,z:-p.y},{x:q.x,y:q.z,z:-q.y});
        const points=path && !path.some(v=>v.link) && length(path.map(v=>v.point))<=distance(p,q)+0.3 ? path.map(v=>({...q,x:v.point.x,y:-v.point.z,z:v.point.y})) : null;
        joinChecks.set(key,points);
      }
      return joinChecks.get(key)?.map(v=>({...v,stepIndex:i,join:true})) ?? null;
    },canonicalSnap);
    if (!assembled.points) { incomplete++; if(assembled.reason==="join_gap") {invalidJoinRoutes++;} continue; }
    const walked=assembled.points;
    if (!walked.length) { incomplete++; continue; }
    completed++; if (consumed.size) fallbackRoutesCompleted++; for (const entry of entries) {for (const id of entry.fallbackUsed) usedFallbackEdges.add(id);const key=`${entry.step.edgeId}\0${entry.step.reversed ? 1:0}`;completedEdgeKeys.add(key);if(entry.connector) completedConnectorKeys.add(key);} if (entries.some(e => e.connector)) hybrid++; else pure++;
    const samples = resampleAudit(walked) as Marked[];
    const rawDetails: SampleDetail[] = [];
    auditPolyline(probe, samples, { alreadySampled:true, detail:rawDetails, cache:auditCache }); add(rawTotal, countedTotals(rawDetails, samples));
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
    auditPolyline(probe, detailPoints, { alreadySampled:true, detail:detailInfo, cache:auditCache }); add(navTotal, countedTotals(detailInfo, detailPoints));
    const scenePoints = samples.map((p,i) => {
      const z = rawDetails[i]!.floorZ;
      if (z === undefined) sceneMissing++;
      return { ...p, z:z ?? p.z };
    });
    const sceneInfo: SampleDetail[] = [];
    auditPolyline(probe, scenePoints, { alreadySampled:true, cache:auditCache, detail:sceneInfo }); add(sceneTotal, countedTotals(sceneInfo, scenePoints));
    for (let i=0;i<samples.length;i++) {
      if (samples[i]!.suspect) continue;
      for (const [detail, target] of [[rawDetails[i]!, samples[i]!.connector ? connectorRaw:walkingRaw], [detailInfo[i]!, samples[i]!.connector ? connectorDetail:walkingDetail], [sceneInfo[i]!, samples[i]!.connector ? connectorScene:walkingScene]] as const) {
        target.samples++; if (detail.floor === "off") target.offFloor++; if (detail.floor === "none") target.noFloor++; if (detail.wallBefore) target.wallHits++;
      }
      const sample=samples[i]!, detail=sceneInfo[i]!, entry=entries[sample.stepIndex];
      if (entry && detail.floor === "off") recordClip(entry.step.edgeId,"offFloor");
      if (entry && detail.wallBefore) recordClip(entry.step.edgeId,sample.connector ? "connectorWallHits" : "navmeshWallHits");
      if (sample.connector && detail.wallBefore && entry) {
        const join=!!sample.join || !onLine(entry.graph,sample) || (i>0 && !onLine(entry.graph,samples[i-1]!));
        clipSites.push({kind:"connector",edgeId:entry.step.edgeId,mode:entry.step.mode,join,point:detail.wallPoint ?? null,wall:wallName(detail)});
      }
    }
    for (let i = 0; i < samples.length; i++) {
      const d = detailInfo[i]!, p = samples[i]!;
      if (p.suspect) continue;
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
  // Include successful edges on incomplete routes as well as completed routes.
  const uniqueEdgeScene={navmesh:totals(),connector:totals()};
  // Connector samples by the step's mode; no-floor samples split by whether the explorer builds the edge.
  const connectorByMode:Record<string,ReturnType<typeof totals>>=Object.create(null);
  let noFloorOnBuiltEdge:number|null=grey?.connectors ? 0 : null, noFloorOnUnbuiltEdge:number|null=grey?.connectors ? 0 : null;
  for (const [key,entry] of cache) {
    if (!entry.points?.length || entry.suspect) continue;
    const samples=resampleAudit(entry.points) as (PolylinePoint & {connector?:boolean})[];
    const raw:SampleDetail[]=[]; auditPolyline(probe,samples,{alreadySampled:true,detail:raw,cache:auditCache});
    const projected=samples.map((p,i)=>({...p,z:raw[i]!.floorZ ?? p.z})), details:SampleDetail[]=[];
    auditPolyline(probe,projected,{alreadySampled:true,detail:details,cache:auditCache});
    for(let i=0;i<details.length;i++) {
      const d=details[i]!,target=samples[i]!.connector ? uniqueEdgeScene.connector : uniqueEdgeScene.navmesh;
      target.samples++; if(d.floor==="off") target.offFloor++; if(d.floor==="none") target.noFloor++; if(d.wallBefore) target.wallHits++;
      if(samples[i]!.connector) {
        const m=connectorByMode[entry.step.mode] ??= totals(); m.samples++; if(d.floor==="off") m.offFloor++; if(d.wallBefore) m.wallHits++;
        if(d.floor==="none") { m.noFloor++; if(grey?.connectors) { if(grey.connectors.pathByEdge.has(entry.step.edgeId)) noFloorOnBuiltEdge!++; else noFloorOnUnbuiltEdge!++; } }
      }
      if(!completedEdgeKeys.has(key)) {if(d.floor==="off") recordClip(entry.step.edgeId,"offFloor");if(d.wallBefore) recordClip(entry.step.edgeId,samples[i]!.connector ? "connectorWallHits":"navmeshWallHits");}
      if(samples[i]!.connector && d.wallBefore && !completedConnectorKeys.has(key)) clipSites.push({kind:"connector",edgeId:entry.step.edgeId,mode:entry.step.mode,join:!onLine(entry.graph,samples[i]!) || (i>0 && !onLine(entry.graph,samples[i-1]!)),point:d.wallPoint ?? null,wall:wallName(d)});
    }
  }
  const allowedFallbacks = fallbackList ? JSON.parse(fs.readFileSync(fallbackList,"utf8")) as {edgeId:string}[] : [];
  if (!Array.isArray(allowedFallbacks) || allowedFallbacks.some(e => !e || typeof e.edgeId!=="string")) throw new Error("invalid fallback list");
  const allowedIds=new Set(allowedFallbacks.map(e=>e.edgeId));
  const fallbackAudit=auditFallbackSegments(probe,failed.filter(e=>allowedIds.has(e.step.edgeId)).map(e=>({edgeId:e.step.edgeId,points:e.graph})));
  for (const entry of failed.filter(e=>allowedIds.has(e.step.edgeId))) {
    const details:SampleDetail[]=[]; auditPolyline(probe,entry.graph,{detail:details});
    for (const detail of details) {if(detail.floor==="off") recordClip(entry.step.edgeId,"offFloor");if(detail.wallBefore) {recordClip(entry.step.edgeId,"fallbackWallHits");clipSites.push({kind:"fallback",edgeId:entry.step.edgeId,mode:entry.step.mode,join:false,point:detail.wallPoint ?? null,wall:wallName(detail)});}}
  }
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
  const gateResult=fallbackGate({fallback:fallbackAudit,unlisted:failed.filter(e=>!allowedIds.has(e.step.edgeId)).map(e=>e.step.edgeId),navmesh:walkingScene,connector:connectorScene,incompleteRoutes:incomplete});
  const failures = failed.map(e => ({ edgeId: e.step.edgeId, mode: e.step.mode, floor: e.step.fromFloorId, direction: e.step.reversed ? "reverse" : "forward", straightGapM: e.gapM, reason: e.reason, stairLink: e.stairLink, fromSnapped:e.fromSnapped, toSnapped:e.toSnapped, connectivity:e.connectivity, sampledWallCrossSectionM:e.gapWidthM, gaps:e.gaps }))
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
  const gapClasses:Record<string,number> = {narrow:0,scene_obstruction:0,step:0,missing_floor:0,low_ceiling:0,steep:0,erosion:0,thin_floor:0,other:0,unclassified_disconnect:0};
  const blockingColliderKinds:Record<string,number>={};
  for (const e of failed) if (e.connectivity==="disconnected" && !e.gaps.length) gapClasses.unclassified_disconnect!++;
  for (const e of failed) for (const gap of e.gaps) { gapClasses[gap.class]!++; if (gap.class==="scene_obstruction") for (const kind of gap.colliderKinds) blockingColliderKinds[kind]=(blockingColliderKinds[kind] ?? 0)+1; }
  const failureClasses: Record<string, number> = {};
  for (const e of failures) {
    const key = `${e.mode} | ${e.fromSnapped && e.toSnapped ? "both snapped" : "snap missing"} | ${e.connectivity} | ${e.reason}`;
    failureClasses[key] = (failureClasses[key] ?? 0)+1;
  }
  const result = { auditedRoutePairs:auditedPairs.size, suspectPolyline:{routes:suspectPolylineRoutes,edges:usedSuspect.size,edgeIds:[...usedSuspect].sort()}, ...(floorIds ? { floors: floorIds, outOfSplit: outOfSplit.length, outOfSplitEdgeIds: outOfSplit } : {}), station, withGreybox, snapFallback, queryMaxNodes:8192, suspectEdges:[...usedSuspect].sort(), queryDiagnosis, fallbackAudit, clipSites, clipCounts, gateResult:gate ? gateResult : null, gapClasses, blockingColliderKinds, linkAttachmentDiagnosis:provenance.linkAttachmentDiagnosis ?? null, fallbackRecoveredAttached:provenance.fallbackRecovered ?? 0, fallbackEdgesUsed:usedFallbackEdges.size, fallbackRoutesCompleted, unpairedFallbackRoutes, bakeProvenance: provenance, collisionAuditUsesOriginalGateObstacles: provenance.ignoreGates, affectedIncompleteRoutesByMode:affectedByMode, failureClasses, failureEdges:failures, greyboxRuns: grey?.grey.stats.runs ?? null, greyboxLandingPads:grey?.grey.stats.landingPads ?? null, runtime, orderedPoiPairs: pois.length * (pois.length-1), routesAudited: routeCount, failedRoutePairs: routeFailures, completeAuditedRoutes: completed, pureNavmeshRoutes: pure, routesWithConnectors: hybrid, incompleteRoutes: incomplete, invalidJoinRoutes, joinsWithGap, maxJoinGapM,
    edgeUses: stepUses, uniqueEdgesUsed: new Set([...cache.values()].map(e => e.step.edgeId)).size, directedEdgesQueried: cache.size,
    navmeshTotals: navTotal, snapDiagnosis, navmeshSegmentHeights:{default:walkingDetail,gateSceneRaycast:walkingScene}, uniqueEdgeScene, connectorByMode, noFloorOnBuiltEdge, noFloorOnUnbuiltEdge, segmentTotals:{ raw:{connector:connectorRaw,navmesh:walkingRaw}, detail:{connector:connectorDetail,navmesh:walkingDetail}, sceneRaycast:{connector:connectorScene,navmesh:walkingScene} }, diagnosis: { raw: rawTotal, detail: navTotal, sceneRaycast: sceneTotal,
      detailHeightUnavailableSamples: detailMissing, detailUnavailableStairFallback: detailMissingFallback, detailUnavailableJoin: detailMissingJoin, detailUnavailableAmbiguous: detailAmbiguous, detailLargeHeightJumps, detailMaxHeightJump, offFloorWithDetail, offFloorWithoutDetail, heightCorrectionM: { count:heightCorrections.length, p50:percentile(heightCorrections,0.5), p95:percentile(heightCorrections,0.95), max:heightCorrections.length ? heightCorrections.reduce((a,b)=>Math.max(a,b),0) : null }, sceneFloorUnavailableSamples: sceneMissing,
      rawAbsDzM: { count:rawDiffs.length, p50:percentile(rawDiffs,0.5), p95:percentile(rawDiffs,0.95), max:rawDiffs.length ? rawDiffs.reduce((a,b)=>Math.max(a,b),0) : null },
      detailAbsDzM: { count:detailDiffs.length, p50:percentile(detailDiffs,0.5), p95:percentile(detailDiffs,0.95), max:detailDiffs.length ? detailDiffs.reduce((a,b)=>Math.max(a,b),0) : null },
      wallClasses, topWalls:[...wallLocations.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([location,hits])=>({location,hits})) }, graphComparableTotals: graphComparable, graphAllRoutableTotals: graphAll,
    directedEdgesWithoutAcceptablePath: failures.length, uniqueEdgesWithoutAcceptablePath: new Set(failures.map(e => e.edgeId)).size, failuresByReason: { snapFailed: failures.filter(e => e.reason === "snap_failed").length, noPath: failures.filter(e => e.reason === "no_path").length, tooLong: failures.filter(e => e.reason === "too_long").length, joinGap: failures.filter(e => e.reason === "join_gap").length }, worst20: failures.slice(0,20),
    directedStairLinks: [...cache.values()].filter(e => e.step.mode === "stairs" && e.connector).length, uniqueStairsWithoutPath: new Set(failed.filter(e => e.step.mode === "stairs").map(e => e.step.edgeId)).size,
    snapDistanceM: { count: snapDistances.length, p50: percentile(snapDistances, 0.5), p95: percentile(snapDistances, 0.95), max: snapDistances.length ? Math.max(...snapDistances) : null },
    medianPathToGraphLength: percentile(ratios, 0.5) };
  // Publish snapped walks, attached links and their junctions in ENU, rounded to 0.01 m.
  const navPaths: Record<string, { forward?: number[][]; reverse?: number[][]; suspectPolyline?:true }> = {};
  const navPathsScene = { samples: 0 }, navPathsRejected: string[] = [], navPathsDetours: string[] = [];
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const oneStepRoute = (step: RouteStep): RouteResult => ({ ok:true, profile:DEFAULT_PROFILE, nodeIds:[step.fromNodeId,step.toNodeId], steps:[step], totalLengthM:step.lengthM, estimatedSeconds:0, waitSeconds:0, floorChanges:step.fromFloorId===step.toFloorId ? 0 : 1, crossesFareBoundary:null, unknowns:[], sourceIds:[], endpointSourceIds:[], evidenceCheckedDate:null, oldestSourceDate:null, undatedSourceIds:[], expiredSourceIds:[], stale:null, synthetic:false, timeRestricted:[], operatorIds:[] });
  for (const edge of [...bundle.edges].sort((a,b) => a.id.localeCompare(b.id))) {
    if (!router.isTraversable(edge, DEFAULT_PROFILE)) continue;
    const dirs: { forward?: number[][]; reverse?: number[][]; suspectPolyline?:true } = {};
    for (const reversed of edge.direction === "both" ? [false, true] : [false]) {
      const fromNode = nodes.get(reversed ? edge.to : edge.from), toNode = nodes.get(reversed ? edge.from : edge.to);
      if (!fromNode || !toNode) continue;
      const step: RouteStep = { edgeId:edge.id, fromNodeId:fromNode.id, toNodeId:toNode.id, reversed, mode:edge.mode, lengthM:edge.lengthM ?? 0, fromFloorId:fromNode.floorId, toFloorId:toNode.floorId };
      const entry = edgePath(oneStepRoute(step), step);
      if (!entry.points || entry.points.length < 2 || entry.reason !== null) continue;
      if(entry.suspect) { dirs.suspectPolyline=true; dirs[reversed ? "reverse" : "forward"]=entry.points.map(p=>[round2(p.x),round2(p.y),round2(p.z)]); continue; }
      // A detour is not the edge: Detour may find an unrelated longer way round (#669 r1). Same rule as the stairs check.
      const graphM = length(routePolyline(bundle, oneStepRoute(step)).map(p => ({ x:p.x, y:p.z, z:-p.y })));
      if (!entry.connector && length(entry.points.map(p => ({ x:p.x, y:p.z, z:-p.y }))) > 1.5 * graphM + 2) { navPathsDetours.push(`${edge.id}:${reversed ? "reverse" : "forward"}`); continue; }
      // Commit the vertices at the scene's floor height (navmesh detail heights can sit above it), rounded as written, then
      // audit exactly that polyline with the route audit's samples: one that leaves the floor or meets a wall is not
      // committed, and the gate fails on it (#669 r2). An edge no audited route walks is checked here too.
      const floorAt = (p: PolylinePoint) => { const d: SampleDetail[] = []; auditPolyline(probe, [p], { alreadySampled:true, detail:d, cache:auditCache }); return d[0]?.floorZ ?? p.z; };
      const canonical=assembleSnapPath([entry.points],()=>null,canonicalSnap).points;
      if(!canonical) { navPathsRejected.push(`${edge.id}:${reversed ? "reverse":"forward"}`); continue; }
      const dense = floorSnapPath(canonical, floorAt);
      const points = dense.map(p => [round2(p.x), round2(p.y), round2(p.z)]);
      const committed = dense.map((p,i) => ({ ...p, x:points[i]![0]!, y:points[i]![1]!, z:points[i]![2]! }));
      const samples = resampleAudit(committed) as PolylinePoint[], details: SampleDetail[] = [];
      auditPolyline(probe, samples, { alreadySampled:true, detail:details, cache:auditCache });
      navPathsScene.samples += details.length;
      if (details.some(d => d.floor === "off" || d.floor === "none" || d.wallBefore)) { navPathsRejected.push(`${edge.id}:${reversed ? "reverse" : "forward"}`); continue; }
      if (reversed) dirs.reverse = points; else dirs.forward = points;
    }
    if (dirs.forward || dirs.reverse) navPaths[edge.id] = dirs;
  }
  // Bake junctions for every adjacent published direction, including routes selected by other profiles.
  const incoming = new Map<string, {step:RouteStep;point:PolylinePoint}[]>();
  const outgoing = new Map<string, {step:RouteStep;point:PolylinePoint}[]>();
  for (const entry of cache.values()) {
    const step=entry.step, points=navPaths[step.edgeId]?.[step.reversed ? "reverse" : "forward"];
    if (!points || !entry.points?.length || entry.suspect) continue;
    const ends = [[incoming,step.toNodeId,canonicalSnap(entry.points.at(-1)!)!],[outgoing,step.fromNodeId,canonicalSnap(entry.points[0]!)!]] as const;
    for (const [map,node,point] of ends) { const list=map.get(node) ?? []; list.push({step,point}); map.set(node,list); }
  }
  const publishedJoinEnds = new Map<string, readonly [number[],number[]]>();
  for (const [node,arrivals] of incoming) for (const a of arrivals) for (const b of outgoing.get(node) ?? []) {
    const key=snapJoinKey(a.step,b.step);
    const start=navPaths[a.step.edgeId]![a.step.reversed ? "reverse" : "forward"]!.at(-1)!;
    const end=navPaths[b.step.edgeId]![b.step.reversed ? "reverse" : "forward"]![0]!;
    publishedJoinEnds.set(key,[start,end]);
    if(start.every((v,i)=>v===end[i])) continue;
    const from={...a.point,x:start[0]!,y:start[1]!,z:start[2]!},to={...b.point,x:end[0]!,y:end[1]!,z:end[2]!};
    const path=queryPathWithLinks(nav,query,{x:from.x,y:from.z,z:-from.y},{x:to.x,y:to.z,z:-to.y});
    joinChecks.set(key,path && !path.some(v=>v.link) && length(path.map(v=>v.point))<=distance(from,to)+0.3 ? path.map(v=>({...to,x:v.point.x,y:-v.point.z,z:v.point.y})) : null);
  }
  const navJoins: Record<string,number[][]> = {};
  for (const [key,line] of joinChecks) {
    if (!line) continue;
    const floorAt = (p:PolylinePoint) => { const d:SampleDetail[]=[]; auditPolyline(probe,[p],{alreadySampled:true,detail:d,cache:auditCache}); return d[0]?.floorZ ?? p.z; };
    const points=floorSnapPath(line,floorAt).map(p=>({...p,x:round2(p.x),y:round2(p.y),z:round2(p.z)}));
    const ends=publishedJoinEnds.get(key);
    if (!ends) continue;
    const coordinates=(p:PolylinePoint)=>[p.x,p.y,p.z];
    if (coordinates(points[0]!).some((v,i)=>v!==ends[0][i]) || coordinates(points.at(-1)!).some((v,i)=>v!==ends[1][i])) { navPathsRejected.push(key); continue; }
    const checked=auditPolyline(probe,points,{cache:auditCache});
    if (checked.wallHits || checked.offFloor || checked.noFloor) { navPathsRejected.push(key); continue; }
    navJoins[key]=points.map(p=>[p.x,p.y,p.z]);
  }
  // Validate the same serialized paths that the runtime assembles, for the router's actual required joins.
  for(const steps of routeSteps) {
    if(steps.some(step=>navPaths[step.edgeId]?.suspectPolyline)) continue;
    const pieces=steps.map(step=>navPaths[step.edgeId]?.[step.reversed ? "reverse":"forward"]?.map(p=>({x:p[0]!,y:p[1]!,z:p[2]!})) ?? null);
    if(pieces.some(p=>!p)) continue;
    assembleSnapPath(pieces,(from,to,i)=>{
      const key=snapJoinKey(steps[i-1]!,steps[i]!);
      const line=navJoins[key]?.map(p=>({x:p[0]!,y:p[1]!,z:p[2]!}));
      if(!line && !navPathsRejected.includes(key)) navPathsRejected.push(key);
      return line ?? null;
    });
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, JSON.stringify({ ...result, navPaths, navJoins, navPathsScene, navPathsRejected, navPathsDetours }, null, 2) + "\n");
  console.log(`suspectPolyline ${suspectPolylineRoutes} routes, ${result.suspectPolyline.edges} edges`);
  console.log(`fallback audit ${JSON.stringify(fallbackAudit.totals)}; fallback clipped ${fallbackAudit.failed.length}; gaps ${JSON.stringify(gapClasses)}; collider kinds ${JSON.stringify(blockingColliderKinds)}; link attachment ${JSON.stringify(result.linkAttachmentDiagnosis)}; query diagnosis ${JSON.stringify(queryDiagnosis)}; snap diagnosis ${JSON.stringify(snapDiagnosis)}; fallback attached ${result.fallbackRecoveredAttached}, used ${result.fallbackEdgesUsed}, completed routes ${fallbackRoutesCompleted}; navmesh segments ${JSON.stringify(result.navmeshSegmentHeights)}`);
  query.destroy(); nav.destroy(); bridgeFloorGeometry.dispose(); (bridgeFloor.material as THREE.Material).dispose(); scene.dispose();
  if (gate && !gateResult.ok) process.exitCode=1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
}
