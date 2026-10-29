import * as THREE from "three";
import type { NavMeshQuery } from "recast-navigation";
import type { PolylinePoint } from "@gteki/navigation";
import { MODE_WIDTH } from "../../../apps/web/src/explorer/graphView.ts";
import { castCamera } from "../../../apps/web/src/explorer/raycast.ts";
import { auditPolyline, type SceneProbe, type SampleDetail } from "./route-clip-audit.ts";

export type GapClass = "narrow" | "scene_obstruction" | "step" | "missing_floor" | "low_ceiling" | "steep" | "erosion" | "thin_floor" | "other";
export function gapClass(width:number, clearance:number|null, jump:number|null, climb:number, floorMissing:boolean, evidence?:{freeHeight:number|null;slope:number|null;triangleWidth:number|null;radius:number;cell:number}):GapClass {
  if (clearance !== null && clearance < 0.6) return width < 0.8 ? "narrow" : "scene_obstruction";
  if (jump !== null && jump > climb) return "step";
  if (floorMissing) return "missing_floor";
  if (evidence?.freeHeight !== null && evidence?.freeHeight !== undefined && evidence.freeHeight < 1.7) return "low_ceiling";
  if (evidence?.slope !== null && evidence?.slope !== undefined && evidence.slope > 40) return "steep";
  if (evidence && clearance !== null && clearance >= 0.6 && clearance < 2*evidence.radius+2*evidence.cell) return "erosion";
  if (evidence?.triangleWidth !== null && evidence?.triangleWidth !== undefined && evidence.triangleWidth < 2*evidence.cell) return "thin_floor";
  return "other";
}
export function dataWidth(edge:{mode:string; attributes?:unknown}):number {
  const w=(edge.attributes as {width?:{m?:unknown}} | undefined)?.width?.m;
  return typeof w === "number" && Number.isFinite(w) && w>=0 ? w : MODE_WIDTH[edge.mode] ?? 2;
}

type Sample = { p:PolylinePoint; at:number; nav:boolean; floorZ:number|null; left:number|null; right:number|null; colliderKinds:string[]; nx:number; ny:number };
/** Diagnose missing polygons along one graph edge; distances are sampled estimates. */
export function diagnoseGaps(query:Pick<NavMeshQuery,"findClosestPoint">,probe:SceneProbe,line:readonly PolylinePoint[],width:number,climb:number, options:{radius:number;cell:number}={radius:0.3,cell:0.1}) {
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
    samples.push({p,at,nav,floorZ:detail[0]?.floorZ ?? null,left:side(1),right:side(-1),colliderKinds:kinds,nx,ny});
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
    let freeHeight:number|null=null, slope:number|null=null, triangleWidth:number|null=null;
    for (const sample of run) {
      if (sample.floorZ===null || Math.abs(sample.floorZ-sample.p.z)>0.6) continue;
      const p=sample.p;
      ray.set(new THREE.Vector3(p.x,p.z+0.6,-p.y),new THREE.Vector3(0,-1,0)); ray.far=1.2;
      const floorHits=castCamera(ray,probe.ground,new Set(probe.ground)).filter(h=>Math.abs(h.point.y-p.z)<=0.6).sort((a,b)=>Math.abs(a.point.y-p.z)-Math.abs(b.point.y-p.z));
      const floor=floorHits[0];
      if (!floor) continue;
      // Equally plausible stacked surfaces are not evidence for either floor.
      if (floorHits.some(h=>Math.abs(h.point.y-floor.point.y)>0.05 && Math.abs(Math.abs(h.point.y-p.z)-Math.abs(floor.point.y-p.z))<0.05)) continue;
      const mesh=floor.object as THREE.Mesh, face=floor.face, attr=mesh.geometry?.getAttribute("position");
      if (face && attr && !(mesh as THREE.InstancedMesh).isInstancedMesh) {
        const a=new THREE.Vector3().fromBufferAttribute(attr,face.a).applyMatrix4(mesh.matrixWorld);
        const b=new THREE.Vector3().fromBufferAttribute(attr,face.b).applyMatrix4(mesh.matrixWorld);
        const c=new THREE.Vector3().fromBufferAttribute(attr,face.c).applyMatrix4(mesh.matrixWorld);
        const cross=b.clone().sub(a).cross(c.clone().sub(a)), area2=cross.length();
        if (area2>1e-12) {
          const angle=Math.acos(Math.min(1,Math.abs(cross.y)/area2))*180/Math.PI;
          const longest=Math.max(a.distanceTo(b),b.distanceTo(c),c.distanceTo(a));
          slope=slope===null ? angle : Math.max(slope,angle);
          const w=area2/longest;
          if (w < 2*options.cell) {
            const supported=(sign:number)=>{
              ray.set(new THREE.Vector3(p.x+sample.nx*sign*2*options.cell,p.z+0.6,-p.y-sample.ny*sign*2*options.cell),new THREE.Vector3(0,-1,0)); ray.far=1.2;
              return castCamera(ray,probe.ground,new Set(probe.ground)).some(h=>Math.abs(h.point.y-p.z)<=0.6);
            };
            // A finely tessellated but wide floor is not a thin floor.
            if (!supported(1) && !supported(-1)) triangleWidth=triangleWidth===null ? w : Math.min(triangleWidth,w);
          }
        }
      }
      ray.set(floor.point.clone().add(new THREE.Vector3(0,0.02,0)),new THREE.Vector3(0,1,0)); ray.far=1.7;
      const blockers=[...new Set([...probe.ground,...probe.collider])];
      const above=castCamera(ray,blockers,new Set(blockers)).find(h=>!probe.collider.includes(h.object) || !probe.ignoreColliderHit?.(h,ray.ray.direction));
      if (above) { const h=above.distance+0.02; freeHeight=freeHeight===null ? h : Math.min(freeHeight,h); }
    }
    gaps.push({lengthM:after.at-before.at,leftM:left,rightM:right,clearanceM:clearance,jumpM:jump,floorMissing,class:gapClass(width,clearance,jump,climb,floorMissing,{freeHeight,slope,triangleWidth,radius:options.radius,cell:options.cell}),colliderKinds:[...new Set(run.flatMap(s=>s.colliderKinds))].sort()});
  }
  return gaps;
}
