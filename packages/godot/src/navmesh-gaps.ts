import * as THREE from "three";
import type { NavMeshQuery } from "recast-navigation";
import type { PolylinePoint } from "@gteki/navigation";
import { MODE_WIDTH } from "../../../apps/web/src/explorer/graphView.ts";
import { castCamera } from "../../../apps/web/src/explorer/raycast.ts";
import { auditPolyline, type SceneProbe, type SampleDetail } from "./route-clip-audit.ts";

export type GapClass = "narrow" | "scene_obstruction" | "step" | "missing_floor" | "other";
export function gapClass(width:number, clearance:number|null, jump:number|null, climb:number, floorMissing:boolean):GapClass {
  if (clearance !== null && clearance < 0.6) return width < 0.8 ? "narrow" : "scene_obstruction";
  if (jump !== null && jump > climb) return "step";
  return floorMissing ? "missing_floor" : "other";
}
export function dataWidth(edge:{mode:string; attributes?:unknown}):number {
  const w=(edge.attributes as {width?:{m?:unknown}} | undefined)?.width?.m;
  return typeof w === "number" && Number.isFinite(w) && w>=0 ? w : MODE_WIDTH[edge.mode] ?? 2;
}

type Sample = { p:PolylinePoint; at:number; nav:boolean; floorZ:number|null; left:number|null; right:number|null; colliderKinds:string[] };
/** Diagnose missing polygons along one graph edge; distances are sampled estimates. */
export function diagnoseGaps(query:Pick<NavMeshQuery,"findClosestPoint">,probe:SceneProbe,line:readonly PolylinePoint[],width:number,climb:number) {
  if (line.length<2) return [];
  const samples:Sample[]=[]; let at=0;
  const ray=new THREE.Raycaster(), twoSided=new Set(probe.collider);
  const add=(p:PolylinePoint,dx:number,dy:number) => {
    const hit=query.findClosestPoint({x:p.x,y:p.z,z:-p.y},{halfExtents:{x:0.3,y:0.5,z:0.3}});
    const nav=!!(hit.success && hit.polyRef && Math.abs(hit.point.x-p.x)<=0.3 && Math.abs(hit.point.z+p.y)<=0.3 && Math.abs(hit.point.y-p.z)<=0.5);
    const detail:SampleDetail[]=[]; auditPolyline(probe,[p],{detail});
    const len=Math.hypot(dx,dy), nx=len ? -dy/len : 0, ny=len ? dx/len : 0, kinds:string[]=[];
    const side=(sign:number) => {
      let nearest=Infinity, nearestKind:string|null=null;
      for (const wall of probe.walls) {
        if (wall.zMax<=p.z+0.5 || wall.zMin>=p.z+1.5) continue;
        const wx=wall.b.x-wall.a.x, wy=wall.b.y-wall.a.y, sx=nx*sign, sy=ny*sign, cross=sx*wy-sy*wx;
        if (Math.abs(cross)<1e-9) continue;
        const ox=wall.a.x-p.x, oy=wall.a.y-p.y, d=(ox*wy-oy*wx)/cross, u=(ox*sy-oy*sx)/cross;
        if (d>=0 && d<=5 && u>=0 && u<=1 && d<nearest) { nearest=d; nearestKind="wall"; }
      }
      if (len) for (const height of [0.5,1.5]) {
        ray.set(new THREE.Vector3(p.x,p.z+height,-p.y),new THREE.Vector3(nx*sign,0,-ny*sign)); ray.far=5;
        const hit=castCamera(ray,probe.collider,twoSided).find(h=>!probe.ignoreColliderHit?.(h,ray.ray.direction));
        if (hit && hit.distance<nearest) { nearest=hit.distance; nearestKind=(hit.object.name || hit.object.type).split(/[:/_\s-]+/)[0] || "unnamed"; }
      }
      if (nearestKind) kinds.push(nearestKind);
      return Number.isFinite(nearest) ? nearest : null;
    };
    samples.push({p,at,nav,floorZ:detail[0]?.floorZ ?? null,left:side(1),right:side(-1),colliderKinds:kinds});
  };
  for (let i=1;i<line.length;i++) {
    const a=line[i-1]!,b=line[i]!,dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy), n=Math.max(1,Math.ceil(dist/0.25));
    for (let k=i===1?0:1;k<=n;k++) {
      const t=k/n; if (k) at+=dist/n;
      add({...b,x:a.x+dx*t,y:a.y+dy*t,z:a.z+(b.z-a.z)*t},dx,dy);
    }
  }
  const gaps:{lengthM:number;leftM:number|null;rightM:number|null;clearanceM:number|null;jumpM:number|null;floorMissing:boolean;class:GapClass;colliderKinds:string[]}[]=[];
  for (let i=0;i<samples.length;) {
    if (samples[i]!.nav) {i++;continue;}
    const start=i; while (i<samples.length && !samples[i]!.nav) i++; const end=i-1;
    const before=samples[Math.max(0,start-1)]!,after=samples[Math.min(samples.length-1,end+1)]!, run=samples.slice(start,end+1);
    const lefts=run.flatMap(s=>s.left===null?[]:[s.left]), rights=run.flatMap(s=>s.right===null?[]:[s.right]);
    const left=lefts.length?Math.min(...lefts):null,right=rights.length?Math.min(...rights):null;
    // Width needs both sides measured at the same sample; unknown space must not be guessed narrow.
    const widths=run.flatMap(s=>s.left!==null && s.right!==null?[s.left+s.right]:[]), clearance=widths.length?Math.min(...widths):null;
    const jump=before.floorZ!==null && after.floorZ!==null?Math.abs(before.floorZ-after.floorZ):null, floorMissing=run.some(s=>s.floorZ===null || Math.abs(s.floorZ-s.p.z)>0.6);
    gaps.push({lengthM:after.at-before.at,leftM:left,rightM:right,clearanceM:clearance,jumpM:jump,floorMissing,class:gapClass(width,clearance,jump,climb,floorMissing),colliderKinds:[...new Set(run.flatMap(s=>s.colliderKinds))].sort()});
  }
  return gaps;
}
