import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as THREE from "three";
import { routePolyline, type PolylinePoint, type RouteResult } from "@gteki/navigation";
import { castCamera } from "../../../apps/web/src/explorer/raycast.ts";
import { fallbackDestination, measureFallbacks } from "./navmesh-fallback.ts";
import { navmeshBundle } from "./navmesh-input.ts";
import { makeGreybox } from "./navmesh-greybox.ts";
import { loadScene, sceneProbe, type SceneProbe } from "./route-clip-audit.ts";

import { objectNames as names } from "./navmesh-source.ts";

const v3=(p:THREE.Vector3)=>({x:p.x,y:p.y,z:p.z});
function faceKind(normal:THREE.Vector3) {return Math.abs(normal.y)<=0.5 ? "wall-like" : normal.y>0 ? "floor-like" : "ceiling-like";}
function faceNormal(hit:THREE.Intersection) {
  const matrix=hit.object.matrixWorld.clone(),mesh=hit.object as THREE.InstancedMesh;
  if(mesh.isInstancedMesh && hit.instanceId!==undefined) {const local=new THREE.Matrix4();mesh.getMatrixAt(hit.instanceId,local);matrix.multiply(local);}
  return (hit.face?.normal ?? new THREE.Vector3()).clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(matrix)).normalize();
}

/** Clip a triangle to the body's height, then find its nearest point in plan. */
function nearestInCorridor(triangle:THREE.Triangle,center:THREE.Vector3):{point:THREE.Vector3;distance:number}|null {
  let poly=[triangle.a.clone(),triangle.b.clone(),triangle.c.clone()];
  for(const [limit,sign] of [[center.y+0.05,1],[center.y+1.7,-1]] as const) {
    const output:THREE.Vector3[]=[];
    for(let i=0;i<poly.length;i++) {const a=poly[i]!,b=poly[(i+1)%poly.length]!,da=sign*(a.y-limit),db=sign*(b.y-limit);
      if(da>=0) output.push(a); if((da>=0)!==(db>=0)) output.push(a.clone().lerp(b,da/(da-db)));}
    poly=output;if(!poly.length)return null;
  }
  const flat=(p:THREE.Vector3)=>new THREE.Vector3(p.x,0,p.z),target=flat(center);
  let best:{point:THREE.Vector3;distance:number}|null=null;
  for(let i=1;i+1<poly.length;i++) {
    const a=poly[0]!,b=poly[i]!,c=poly[i+1]!,tri=new THREE.Triangle(flat(a),flat(b),flat(c));
    const bary=tri.getBarycoord(target,new THREE.Vector3());
    if(bary && bary.x>=-1e-9 && bary.y>=-1e-9 && bary.z>=-1e-9) return {point:new THREE.Vector3(center.x,a.y*bary.x+b.y*bary.y+c.y*bary.z,center.z),distance:0};
  }
  for(let i=0;i<poly.length;i++) {const a=poly[i]!,b=poly[(i+1)%poly.length]!,dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((center.x-a.x)*dx+(center.z-a.z)*dz)/(dx*dx+dz*dz || 1))),point=a.clone().lerp(b,t),distance=Math.hypot(point.x-center.x,point.z-center.z);if(!best || distance<best.distance) best={point,distance};}
  return best && best.distance<=0.3+1e-9 ? best : null;
}

/** Query obstacle triangles inside a vertical 0.30 m corridor. */
export function corridorBlockers(probe:SceneProbe,center:THREE.Vector3) {
  const bounds=new THREE.Box3(new THREE.Vector3(center.x-0.3,center.y+0.05,center.z-0.3),new THREE.Vector3(center.x+0.3,center.y+1.7,center.z+0.3));
  const found:{object:THREE.Object3D;point:THREE.Vector3;normal:THREE.Vector3;distance:number}[]=[];
  const objects=[...new Set([...probe.collider,...probe.ground])];
  for(const object of objects) {
    const mesh=object as THREE.Mesh,geom=mesh.geometry,attr=geom?.getAttribute("position"); if(!attr) continue;
    const inst=mesh as THREE.InstancedMesh, count=inst.isInstancedMesh ? inst.count : 1, matrix=new THREE.Matrix4(),temp=new THREE.Matrix4();
    let best:typeof found[number]|undefined;
    for(let n=0;n<count;n++) {
      if(inst.isInstancedMesh) inst.getMatrixAt(n,temp); else temp.identity(); matrix.multiplyMatrices(mesh.matrixWorld,temp);
      if(!geom.boundingBox) geom.computeBoundingBox(); if(geom.boundingBox && !bounds.intersectsBox(geom.boundingBox.clone().applyMatrix4(matrix))) continue;
      const index=geom.index, size=index?.count ?? attr.count;
      for(let i=0;i+2<size;i+=3) {
        const get=(j:number)=>new THREE.Vector3().fromBufferAttribute(attr,index ? index.getX(i+j) : i+j).applyMatrix4(matrix);
        const tri=new THREE.Triangle(get(0),get(1),get(2)); if(!bounds.intersectsTriangle(tri)) continue;
        const normal=tri.getNormal(new THREE.Vector3());
        const closest=nearestInCorridor(tri,center);if(!closest) continue;
        if(probe.ground.includes(object) && normal.y>0.5 && closest.point.y-center.y<0.3) continue;
        const localNormal=normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld).invert()).normalize();
        const direction=closest.point.clone().sub(center).setY(0).normalize();
        const hit={object,point:closest.point,face:{a:0,b:0,c:0,normal:localNormal,materialIndex:0}} as THREE.Intersection;
        if(probe.ignoreColliderHit?.(hit,direction)) continue;
        if(!best || closest.distance<best.distance) best={object,point:closest.point,normal,distance:closest.distance};
      }
    }
    if(best) found.push(best);
  }
  const output=found.map(x=>({...names(x.object),point:v3(x.point),facing:faceKind(x.normal),distance:x.distance}));
  for(const wall of probe.walls) {
    if(wall.zMax<=center.y+0.05 || wall.zMin>=center.y+1.7) continue;
    const ax=wall.a.x,az=-wall.a.y,bx=wall.b.x,bz=-wall.b.y,dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((center.x-ax)*dx+(center.z-az)*dz)/(dx*dx+dz*dz || 1)));
    const x=ax+t*dx,z=az+t*dz,distance=Math.hypot(x-center.x,z-center.z);
    if(distance<=0.3) output.push({name:"wall segment",parents:[],source:"unknown",point:{x,y:Math.max(center.y+0.05,wall.zMin),z},facing:"wall-like",distance});
  }
  return output.sort((a,b)=>a.distance-b.distance).slice(0,3);
}

/** First overhead hit, preserving triangle winding to identify an upper floor slab. */
export function ceilingAbove(probe:SceneProbe,center:THREE.Vector3) {
  const objects=[...new Set([...probe.collider,...probe.ground])],ray=new THREE.Raycaster(center.clone().add(new THREE.Vector3(0,0.05,0)),new THREE.Vector3(0,1,0),0,5);
  const hit=castCamera(ray,objects,new Set(objects)).find(h=>!probe.ignoreColliderHit?.(h,ray.ray.direction));
  if(!hit) return null;
  const normal=faceNormal(hit);
  return {...names(hit.object),height:hit.point.y-center.y,point:v3(hit.point),isUpperFloorSlab:normal.y>0.7 || (probe.ground.includes(hit.object) && hit.point.y-center.y>1.7)};
}

function atDistance(line:readonly PolylinePoint[],distance:number) {
  let remaining=distance;
  for(let i=1;i<line.length;i++) {const a=line[i-1]!,b=line[i]!,len=Math.hypot(b.x-a.x,b.y-a.y); if(remaining<=len || i===line.length-1) {const t=len ? Math.max(0,Math.min(1,remaining/len)) : 0; return {point:new THREE.Vector3(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t,-a.y-(b.y-a.y)*t),floorId:t<0.5 ? a.floorId:b.floorId,dx:b.x-a.x,dy:b.y-a.y};} remaining-=len; }
  return null;
}

/** Nearest wall-like collision face to either side of the gap center. */
export function sideFaces(probe:SceneProbe,p:THREE.Vector3,dx:number,dy:number) {
  const len=Math.hypot(dx,dy); if(!len) return {left:null,right:null};
  const ray=new THREE.Raycaster(),objects=[...new Set([...probe.collider,...probe.ground])],collider=new Set(objects),dir=new THREE.Vector3(-dy/len,0,-dx/len);
  const side=(sign:number)=>{ray.set(p.clone().add(new THREE.Vector3(0,0.5,0)),dir.clone().multiplyScalar(sign));ray.far=5;
    const hit=castCamera(ray,objects,collider).find(h=>!probe.ignoreColliderHit?.(h,ray.ray.direction) && !!h.face && Math.abs(faceNormal(h).y)<=0.5);
    let result=hit ? {...names(hit.object),distance:hit.distance,point:v3(hit.point)} : null;
    for(const wall of probe.walls) {
      if(wall.zMin>=p.y+0.5 || wall.zMax<=p.y+0.5) continue;
      const wx=wall.b.x-wall.a.x,wz=-(wall.b.y-wall.a.y),sx=dir.x*sign,sz=dir.z*sign,cross=sx*wz-sz*wx;
      if(Math.abs(cross)<1e-9) continue;
      const ox=wall.a.x-p.x,oz=-wall.a.y-p.z,d=(ox*wz-oz*wx)/cross,u=(ox*sz-oz*sx)/cross;
      if(d>=0 && d<=5 && u>=0 && u<=1 && (!result || d<result.distance)) result={name:"wall segment",parents:[],source:"unknown",distance:d,point:{x:p.x+sx*d,y:p.y+0.5,z:p.z+sz*d}};
    }
    return result;};
  return {left:side(1),right:side(-1)};
}

async function main() {
  let station="",write=""; const args=process.argv.slice(2);
  for(let i=0;i<args.length;i++) {if(args[i]==="--station" && args[i+1]) station=args[++i]!; else if(args[i]==="--write" && args[i+1]) write=args[++i]!; else if(args[i]==="--with-greybox") {} else throw new Error(`unknown or incomplete argument: ${args[i]}`);}
  if(!station || !write) throw new Error("use --station <station> [--with-greybox] --write <path>");
  const dest=fallbackDestination(write,process.env.GTEKI_PRIVATE_DIR),{audit}=measureFallbacks(station,undefined,true);
  const input=await navmeshBundle(station),scene=await loadScene(station,input.bundle);
  const {bundle,privateBuild}=input;
  const grey=makeGreybox(bundle,scene,privateBuild),probe=grey.probe,edges=new Map(bundle.edges.map(e=>[e.id,e])),nodes=new Map(bundle.nodes.map(n=>[n.id,n]));
  const gaps:unknown[]=[];
  for(const f of audit.failureEdges) {
    const edge=edges.get(f.edgeId); if(!edge || ["stairs","escalator","elevator"].includes(edge.mode)) continue;
    const from=f.direction==="reverse" ? edge.to:edge.from,to=f.direction==="reverse" ? edge.from:edge.to,a=nodes.get(from),b=nodes.get(to); if(!a || !b) continue;
    const step={edgeId:edge.id,fromNodeId:from,toNodeId:to,reversed:f.direction==="reverse",mode:edge.mode,lengthM:edge.lengthM ?? 0,fromFloorId:a.floorId,toFloorId:b.floorId};
    const line=routePolyline(bundle,{nodeIds:[from,to],steps:[step]} as RouteResult);
    for(const gap of f.gaps) {const p=atDistance(line,(gap.startM+gap.endM)/2); if(!p) continue;
      const n=Math.max(1,Math.ceil((gap.endM-gap.startM)/0.25)), candidates:ReturnType<typeof corridorBlockers>=[];
      const ceilings:NonNullable<ReturnType<typeof ceilingAbove>>[]=[],left:NonNullable<ReturnType<typeof sideFaces>["left"]>[]=[],right:NonNullable<ReturnType<typeof sideFaces>["right"]>[]= [];
      for(let k=0;k<=n;k++) {const sample=atDistance(line,gap.startM+(gap.endM-gap.startM)*k/n);if(!sample)continue;
        candidates.push(...corridorBlockers(probe,sample.point));
        if(gap.class==="low_ceiling") {const ceiling=ceilingAbove(probe,sample.point);if(ceiling)ceilings.push(ceiling);}
        if(["erosion","other"].includes(gap.class)) {const sides=sideFaces(probe,sample.point,sample.dx,sample.dy);if(sides.left)left.push(sides.left);if(sides.right)right.push(sides.right);}
      }
      const selected:typeof candidates=[];for(const c of candidates.sort((a,b)=>a.distance-b.distance)) if(!selected.some(x=>x.name===c.name && x.source===c.source && JSON.stringify(x.parents)===JSON.stringify(c.parents))) {selected.push(c);if(selected.length===3)break;}
      gaps.push({edgeId:edge.id,mode:edge.mode,class:gap.class,at:{...v3(p.point),floorId:p.floorId},length:gap.lengthM,blockers:selected,...(gap.class==="low_ceiling" ? {ceiling:ceilings.sort((a,b)=>a.height-b.height)[0] ?? null} : {}),...(["erosion","other"].includes(gap.class) ? {sides:{left:left.sort((a,b)=>a.distance-b.distance)[0] ?? null,right:right.sort((a,b)=>a.distance-b.distance)[0] ?? null}} : {})});
    }
  }
  const clipSites=audit.clipSites.map((site:{wall:{name:string;parents:string[];source:string};point:unknown;kind:string;edgeId:string;mode:string;join:boolean})=>({kind:site.kind,edgeId:site.edgeId,mode:site.mode,point:site.point,wall:site.wall,location:site.join ? "join" : "authored_polyline"}));
  const failures=audit.failureEdges.filter((f:{mode:string})=>!["stairs","escalator","elevator"].includes(f.mode)).map((f:{edgeId:string;mode:string;reason:string;connectivity:string;direction:string;gaps:unknown[]})=>({edgeId:f.edgeId,mode:f.mode,reason:f.reason,connectivity:f.connectivity,direction:f.direction,gaps:f.gaps.length}));
  const result={station,failures,gaps,clipSites}; const dir=fs.mkdtempSync(path.join(path.dirname(dest),".obstacles-"));
  try {const temp=path.join(dir,"report.json");fs.writeFileSync(temp,JSON.stringify(result,null,2)+"\n",{mode:0o600,flag:"wx"});fs.renameSync(temp,dest);} finally {fs.rmSync(dir,{recursive:true,force:true});scene.dispose();}
  const bySource:Record<string,number>={},byFacing:Record<string,number>={};
  for(const g of gaps as {blockers:{source:string;facing:string}[]}[]) for(const b of g.blockers) {bySource[b.source]=(bySource[b.source] ?? 0)+1;byFacing[b.facing]=(byFacing[b.facing] ?? 0)+1;}
  for(const c of clipSites) bySource[c.wall.source]=(bySource[c.wall.source] ?? 0)+1;
  process.stdout.write(JSON.stringify({gaps:gaps.length,connectorClips:clipSites.filter((s:{kind:string})=>s.kind==="connector").length,fallbackClips:clipSites.filter((s:{kind:string})=>s.kind==="fallback").length,bySource,byFacing})+"\n");
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log=()=>{};console.info=()=>{};console.warn=()=>{};console.error=()=>{};
  main().catch(()=>{process.stderr.write("obstacle report failed\n");process.exitCode=1;});
}
