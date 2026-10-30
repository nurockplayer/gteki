import type { NavMeshQuery, OffMeshConnectionParams } from "recast-navigation";
import { auditPolyline, type SceneProbe, type SampleDetail } from "./route-clip-audit.ts";
import * as THREE from "three";
import { castAll } from "../../../apps/web/src/explorer/raycast.ts";

type Point = { x: number; y: number; z: number };
type VerticalEdge = { id: string; mode: string; from: string; to: string; direction: "both" | "forward" };
type Fallback = { point: Point; neighborId: string; edgeId: string };

/** Consume the adjacent graph approach together with its composite vertical connector. */
export function planFallbackRoute(steps: readonly {edgeId:string;fromNodeId:string;toNodeId:string;reversed:boolean}[], links: ReadonlyMap<string,{fallback?:{from?:{neighborId:string;edgeId:string};to?:{neighborId:string;edgeId:string}}}>) {
  const consumed = new Set<number>();
  for (let i=0;i<steps.length;i++) {
    const step=steps[i]!, link=links.get(step.edgeId); if (!link?.fallback) continue;
    const first=step.reversed ? link.fallback.to : link.fallback.from;
    const last=step.reversed ? link.fallback.from : link.fallback.to;
    if (first) {
      const prev=steps[i-1];
      if (!prev || prev.edgeId!==first.edgeId || prev.fromNodeId!==first.neighborId || prev.toNodeId!==step.fromNodeId || consumed.has(i-1)) return null;
      consumed.add(i-1);
    }
    if (last) {
      const next=steps[i+1];
      if (!next || next.edgeId!==last.edgeId || next.fromNodeId!==step.toNodeId || next.toNodeId!==last.neighborId || consumed.has(i+1)) return null;
      consumed.add(i+1);
    }
  }
  return consumed;
}

/** Classify one endpoint against the nearest polygon in the plan search box. */
export function diagnoseVerticalSnap(query: Pick<NavMeshQuery, "findClosestPoint">, probe: SceneProbe, node: Point) {
  const nearest=query.findClosestPoint(node,{halfExtents:{x:1.5,y:10000,z:1.5}});
  const found=nearest.success && !!nearest.polyRef && Math.abs(nearest.point.x-node.x)<=1.5 && Math.abs(nearest.point.z-node.z)<=1.5;
  const deltaZ=found ? nearest.point.y-node.y : null;
  const reason = !found ? "no_poly" : Math.abs(deltaZ!)>0.6 ? "height" : validateLinkSnap(probe,node,nearest.point);
  let greyboxFloorAtNode = false, floorSource:"scene"|"greybox"|"none" = "none", floorRule:"snap_no_floor"|"snap_height"|"approach_no_floor"|"approach_off_floor"|null = null;
  const ray=new THREE.Raycaster(), down=new THREE.Vector3(0,-1,0);
  if (reason === "height") {
    ray.set(new THREE.Vector3(node.x,node.y+0.6,node.z),down); ray.far=1.2;
    greyboxFloorAtNode=castAll(ray,probe.ground.filter(o=>o.userData.greybox===true)).length>0;
  }
  if (reason === "floor") {
    const snap=nearest.point, p=(v:Point)=>({x:v.x,y:-v.z,z:v.y,zKnown:true,floorId:"",stepIndex:0});
    ray.set(new THREE.Vector3(snap.x,snap.y+3,snap.z),down); ray.far=6;
    const hit=castAll(ray,probe.ground).sort((a,b)=>Math.abs(a.point.y-snap.y)-Math.abs(b.point.y-snap.y))[0];
    floorSource=hit ? (hit.object.userData.greybox===true ? "greybox" : "scene") : "none";
    if (!hit) floorRule="snap_no_floor";
    else if (Math.abs(hit.point.y-snap.y)>0.6) floorRule="snap_height";
    else { const approach=auditPolyline(probe,[p(node),p(snap)]); floorRule=approach.noFloor ? "approach_no_floor" : approach.offFloor ? "approach_off_floor" : null; }
  }
  if (reason === null) return {reason,deltaZ,walkableWithin3m:false,greyboxFloorAtNode,floorSource,floorRule};
  // Sample downward rays in a 3 m disc at the node's floor elevation; a negative result is not an exact geometry proof.
  let walkableWithin3m=false;
  for (let x=-3;x<=3 && !walkableWithin3m;x+=0.5) for (let z=-3;z<=3;z+=0.5) {
    if (x*x+z*z>9) continue;
    ray.set(new THREE.Vector3(node.x+x,node.y+0.6,node.z+z),down); ray.far=1.2;
    if (castAll(ray,probe.ground).length) { walkableWithin3m=true; break; }
  }
  return {reason,deltaZ,walkableWithin3m,greyboxFloorAtNode,floorSource,floorRule};
}

/** A snap must land on a scene floor and the node-to-snap segment must not cross a wall. */
export function validateLinkSnap(probe: SceneProbe, node: Point, snapped: Point): "floor" | "wall" | null {
  const p = (v: Point) => ({ x:v.x, y:-v.z, z:v.y, zKnown:true, floorId:"", stepIndex:0 });
  const detail: SampleDetail[] = [];
  auditPolyline(probe, [p(snapped)], { detail });
  const floor = detail[0]?.floorZ;
  if (floor === undefined || Math.abs(floor-snapped.y) > 0.6) return "floor";
  if (auditPolyline(probe, [p(node),p(snapped)], { alreadySampled:true }).wallHits) return "wall";
  const approach=auditPolyline(probe,[p(node),p(snapped)]);
  if (approach.noFloor || approach.offFloor) return "floor";
  // Include intersections at a wall segment's endpoint, which the route checker deliberately excludes.
  const a=p(node), b=p(snapped), dx=b.x-a.x, dy=b.y-a.y;
  for (const w of probe.walls) {
    const wx=w.b.x-w.a.x, wy=w.b.y-w.a.y, d=dx*wy-dy*wx;
    if (Math.abs(d)<1e-10) continue;
    const ox=w.a.x-a.x, oy=w.a.y-a.y, t=(ox*wy-oy*wx)/d, u=(ox*dy-oy*dx)/d;
    const z=a.z+(b.z-a.z)*t;
    if (t>0 && t<1 && u>=0 && u<=1 && w.zMax>z+0.5 && w.zMin<z+1.5) return "wall";
  }
  return null;
}

/** Build candidates from edges already filtered by the caller for graph traversability.
 * A candidate still needs post-bake verification that Detour attached its user ID. */
export function verticalLinkCandidates(edges: readonly VerticalEdge[], nodePoint: (id: string) => Point | undefined, query: Pick<NavMeshQuery, "findClosestPoint">, validateSnap: (nodeId: string, node: Point, snapped: Point) => boolean, fallback?: (nodeId:string,node:Point)=>Fallback | null) {
  const candidates: { edgeId: string; connection: OffMeshConnectionParams; fallback?: {from?:Fallback;to?:Fallback} }[] = [];
  const failed: { edgeId: string; reason: "missing_node" | "snap_failed" | "unsafe_snap" }[] = [];
  let snapFailures = 0, noPolyStart = 0, noPolyEnd = 0;
  const vertical = edges.filter(e => ["stairs", "escalator", "elevator"].includes(e.mode)).slice().sort((a, b) => a.id.localeCompare(b.id));
  const snap = (point: Point) => {
    const result = query.findClosestPoint(point, { halfExtents: { x: 1.5, y: 0.6, z: 1.5 } });
    return result.success && result.polyRef && Math.abs(result.point.y - point.y) <= 0.6 ? result.point : null;
  };
  vertical.forEach((edge, index) => {
    const from = nodePoint(edge.from), to = nodePoint(edge.to);
    if (!from || !to) { failed.push({ edgeId: edge.id, reason: "missing_node" }); return; }
    let start = snap(from), end = snap(to);
    const fromFallback = !start && fallback ? fallback(edge.from,from) : null;
    const toFallback = !end && fallback ? fallback(edge.to,to) : null;
    start ??= fromFallback?.point ?? null; end ??= toFallback?.point ?? null;
    if (!start || !end) { noPolyStart += Number(!start); noPolyEnd += Number(!end); snapFailures += Number(!start) + Number(!end); failed.push({ edgeId: edge.id, reason: "snap_failed" }); return; }
    const startValid=!!fromFallback || validateSnap(edge.from, from, start), endValid=!!toFallback || validateSnap(edge.to, to, end);
    if (!startValid || !endValid) { failed.push({ edgeId: edge.id, reason: "unsafe_snap" }); return; }
    candidates.push({ edgeId: edge.id, connection: { startPosition: start, endPosition: end, radius: 0.3, bidirectional: edge.direction === "both", area: 0, flags: 1, userId: index + 1 }, ...(fromFallback || toFallback ? {fallback:{...(fromFallback ? {from:fromFallback} : {}),...(toFallback ? {to:toFallback} : {})}} : {}) });
  });
  return { candidates, failed, snapFailures, noPolyStart, noPolyEnd };
}
