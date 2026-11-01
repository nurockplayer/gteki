import * as THREE from "three";
import type { PolylinePoint } from "@gteki/navigation";
import type { GapClass } from "./navmesh-gaps.ts";

export type BridgeGap = {startM:number;endM:number;class:GapClass};
export type BridgeGeometry = {positions:number[];indices:number[]};

/** Build strips without removing scene obstacles. A ceiling requires a clear volume. */
export function bridgeGapGeometry(line:readonly PolylinePoint[], gaps:readonly BridgeGap[],width:number, ceilingClear?:(vertices:THREE.Vector3[])=>boolean):BridgeGeometry {
  const positions:number[]=[],indices:number[]=[];
  if (line.length<2 || !(width>0)) return {positions,indices};
  const distances=[0];
  for (let i=1;i<line.length;i++) distances.push(distances[i-1]!+Math.hypot(line[i]!.x-line[i-1]!.x,line[i]!.y-line[i-1]!.y));
  const total=distances.at(-1)!; if (total<1e-6) return {positions,indices};
  const at=(d:number)=>{
    let i=1; while(i<distances.length-1 && distances[i]!<d) i++;
    const a=line[i-1]!,b=line[i]!,span=distances[i]!-distances[i-1]!;
    const t=span ? (d-distances[i-1]!)/span : 0;
    return new THREE.Vector3(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t,-a.y-(b.y-a.y)*t);
  };
  const quad=(v:THREE.Vector3[],reverse:boolean)=>{
    const base=positions.length/3; for(const p of v) positions.push(p.x,p.y,p.z);
    if(reverse) indices.push(base,base+2,base+1,base,base+3,base+2); else indices.push(base,base+1,base+2,base,base+2,base+3);
  };
  for(const gap of gaps) {
    if(!["missing_floor","step","thin_floor","erosion","other"].includes(gap.class)) continue;
    const start=Math.max(0,gap.startM-0.5),end=Math.min(total,gap.endM+0.5);
    if (!(end>start)) continue;
    const coarse=[start,...distances.filter(d=>d>start && d<end),end], stops=[start];
    for(let j=1;j<coarse.length;j++) { const a=coarse[j-1]!,b=coarse[j]!,n=Math.max(1,Math.ceil((b-a)/0.5)); for(let t=1;t<=n;t++) stops.push(a+(b-a)*t/n); }
    const first=at(start), last=at(end);
    if (gap.class === "step" && Math.atan2(Math.abs(last.y-first.y),end-start)*180/Math.PI>35) continue;
    const stripPoint=(d:number)=>{const p=at(d); if(gap.class==="step") p.y=first.y+(last.y-first.y)*(d-start)/(end-start); return p;};
    for(let k=1;k<stops.length;k++) {
      const a=stripPoint(stops[k-1]!),b=stripPoint(stops[k]!),dir=b.clone().sub(a); dir.y=0;
      const len=dir.length(); if(len<1e-6) continue;
      const along=dir.divideScalar(len),across=new THREE.Vector3(along.z,0,-along.x), offset=across.clone().multiplyScalar(width/2);
      const vertices=[a.clone().sub(offset),b.clone().sub(offset),b.clone().add(offset),a.clone().add(offset)];
      quad(vertices,false);
      if (ceilingClear?.(vertices)) quad(vertices.map(v=>v.clone().add(new THREE.Vector3(0,2.4,0))),true);
    }
  }
  return {positions,indices};
}

/** A floor-only square landing in renderer coordinates. */
export function linkPadGeometry(p:{x:number;y:number;z:number}):BridgeGeometry {
  const h=0.75;
  return {positions:[p.x-h,p.y,p.z+h,p.x+h,p.y,p.z+h,p.x+h,p.y,p.z-h,p.x-h,p.y,p.z-h],indices:[0,1,2,0,2,3]};
}

/** Reject a landing footprint crossed by scene collision geometry. */
export function linkPadClear(probe:import("./route-clip-audit.ts").SceneProbe,p:PolylinePoint,audit:typeof import("./route-clip-audit.ts").auditPolyline):boolean {
  const at=(x:number,y:number)=>({...p,x:p.x+x,y:p.y+y});
  const corners=[at(-0.75,-0.75),at(0.75,-0.75),at(0.75,0.75),at(-0.75,0.75)];
  const checks=[[0,1],[1,2],[2,3],[3,0],[0,2],[1,3]];
  return checks.every(([a,b])=>!audit(probe,[corners[a!]!,corners[b!]!]).wallHits);
}

/** Extract the upward triangles for floor probes; ceilings remain collider geometry. */
export function bridgeFloorTriangles(geometry:BridgeGeometry):number[] {
  const out:number[]=[];
  for(let i=0;i+2<geometry.indices.length;i+=3) {
    const v=(index:number)=>new THREE.Vector3(...geometry.positions.slice(index*3,index*3+3) as [number,number,number]);
    const a=v(geometry.indices[i]!),b=v(geometry.indices[i+1]!),c=v(geometry.indices[i+2]!);
    if (b.clone().sub(a).cross(c.clone().sub(a)).y>1e-9) out.push(...a.toArray(),...b.toArray(),...c.toArray());
  }
  return out;
}

/** A landing approach preserves scene walls and rejects ramps too steep for the bake. */
export function linkStripGeometry(probe:import("./route-clip-audit.ts").SceneProbe,a:PolylinePoint,b:PolylinePoint,audit:typeof import("./route-clip-audit.ts").auditPolyline) {
  const len=Math.hypot(b.x-a.x,b.y-a.y);
  if (len<1e-6) return {geometry:null,reason:"empty" as const};
  if (audit(probe,[a,b],{alreadySampled:true}).wallHits) return {geometry:null,reason:"wall" as const};
  if (Math.atan2(Math.abs(b.z-a.z),len)*180/Math.PI>40) return {geometry:null,reason:"steep" as const};
  const strip=bridgeGapGeometry([a,b],[{startM:0,endM:len,class:"other"}],1.5), floor=bridgeFloorTriangles(strip);
  return {geometry:{positions:floor,indices:Array.from({length:floor.length/3},(_,i)=>i)},reason:null};
}
