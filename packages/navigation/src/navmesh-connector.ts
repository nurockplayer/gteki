import type { PolylinePoint } from "./present.ts";

type V3 = { x:number; y:number; z:number };
type NearestQuery = { findClosestPoint(node:V3, options:{halfExtents:V3}): {success:boolean;polyRef:number;point:V3} };
export type ConnectorPoint = PolylinePoint & { connector:true };

/** Build an authored vertical edge without asking Detour to choose a connector. */
export function buildConnectorPath(query: NearestQuery, from:V3, to:V3, line:readonly PolylinePoint[], validateSnap:(node:V3,snap:V3)=>boolean):
  { points:ConnectorPoint[]; reason:null; fromSnapped:boolean; toSnapped:boolean } | { points:null; reason:"snap_failed"|"join_gap"; fromSnapped:boolean; toSnapped:boolean } {
  const snap=(node:V3) => {
    const hit=query.findClosestPoint(node,{halfExtents:{x:1.5,y:0.6,z:1.5}});
    return hit.success && hit.polyRef && Math.abs(hit.point.y-node.y)<=0.6 && validateSnap(node,hit.point) ? hit.point : null;
  };
  const a=snap(from), b=snap(to), first=line[0], last=line.at(-1);
  const fromSnapped=!!a, toSnapped=!!b;
  if (!a || !b || !first || !last) return {points:null,reason:"snap_failed",fromSnapped,toSnapped};
  if (Math.hypot(a.x-first.x,a.z+first.y)>0.6 || Math.hypot(b.x-last.x,b.z+last.y)>0.6) return {points:null,reason:"join_gap",fromSnapped,toSnapped};
  const endpoint=(p:V3, reference:PolylinePoint):ConnectorPoint => ({...reference,x:p.x,y:-p.z,z:p.y,connector:true});
  return {points:[endpoint(a,first),...line.map(p=>({...p,connector:true as const})),endpoint(b,last)],reason:null,fromSnapped,toSnapped};
}
