// 2026-11-06 JST: #849 public high-tier wall intersection probe.
import * as T from '../../packages/godot/node_modules/three/build/three.module.js';
import { loadScene } from '../../packages/godot/src/route-clip-audit.ts';
import { navmeshBundle } from '../../packages/godot/src/navmesh-input.ts';
import { createRouter, DEFAULT_PROFILE, routeBetween } from '../../packages/navigation/src/index.ts';
import { routeWaypoints } from '../../tests/e2e/lib/gteki.ts';
import { castAll, explorerTargets } from '../../apps/web/src/explorer/raycast.ts';
import { prepareRayTrees } from '../../apps/web/src/explorer/meshBvh.ts';
import { greyboxSceneProbes } from '../../apps/web/src/explorer/greyboxScene.ts';
import { wallToRenderer } from '../../apps/web/src/explorer/walker.ts';
import { floorProbe } from '../../apps/web/src/explorer/routeGaps.ts';
import { buildGreybox } from '../../apps/web/src/explorer/greybox.ts';
import { cutPortals } from '../../apps/web/src/explorer/portalCut.ts';
import { buildLiveScene } from '../../apps/web/src/explorer/liveScene.ts';

if (process.env.GTEKI_PRIVATE_DIR) throw new Error('Public data only');
process.env.GTEKI_ROOT = process.cwd();
const stamp = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }) + ' JST';
const { bundle } = await navmeshBundle('shinjuku');
const scene = await loadScene('shinjuku', bundle, 'high');
const router = createRouter(bundle);
const from = bundle.pois.find(p => p.id === 'poi:exit:1')!;
const to = bundle.pois.find(p => p.id === 'poi:platform:oedo')!;
const route = routeBetween(router, { kind: 'poi', poi: from }, to, DEFAULT_PROFILE);
if (!route.ok) throw new Error(JSON.stringify(route));
const wps = routeWaypoints('shinjuku', route.steps).map(w => w.p);
const node = bundle.graph.nodes.find(n => n.id === 'n:453ea111f1524cef8f3ac139bbf2e26b')!;
const target = { x: node.position.x, y: node.position.y, z: node.position.z ?? node.renderZ ?? 0 };
let acc = 0, best = { s: 0, d: Infinity };
for (let i = 1; i < wps.length; i++) {
 const a = wps[i-1]!, b = wps[i]!, vx=b.x-a.x, vy=b.y-a.y, vz=b.z-a.z;
 const t = Math.max(0, Math.min(1, ((target.x-a.x)*vx+(target.y-a.y)*vy+(target.z-a.z)*vz)/(vx*vx+vy*vy+vz*vz || 1)));
 const d = Math.hypot(target.x-a.x-vx*t, target.y-a.y-vy*t, (target.z-a.z-vz*t)*2), len=Math.hypot(vx,vy);
 if (d < best.d) best = {s:acc+len*t,d}; acc += len;
}
let remaining = Math.round(best.s * 10) / 10 - 6, walker = wps[0]!, heading = new T.Vector3();
for (let i=1;i<wps.length;i++) {
 const a=wps[i-1]!, b=wps[i]!, len=Math.hypot(b.x-a.x,b.y-a.y);
 if (remaining <= len && len > 0) { const t=remaining/len; walker={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t}; heading.set((b.x-a.x)/len,0,-(b.y-a.y)/len); break; }
 remaining-=len;
}
const eye = new T.Vector3(walker.x,walker.z+2.4,-walker.y).addScaledVector(heading,-3.45);
const right = new T.Vector3(-heading.z,0,heading.x);
const walkable=scene.walkable, colliders=scene.colliders ?? [], cameraBlockers=scene.cameraBlockers ?? [];
const originalTargets=explorerTargets(walkable,colliders,cameraBlockers); prepareRayTrees(originalTargets.camera);
const walls=(scene.walls ?? []).map(wallToRenderer), probes=greyboxSceneProbes(originalTargets.collider,walls);
const floor=floorProbe(new T.Raycaster(),originalTargets.ground,true), cache=new Map<string,boolean>();
const hasFloor=(p: {x:number;y:number;z:number}) => {const k=`${Math.round(p.x*100)},${Math.round(p.y*100)},${Math.round(p.z*100)}`; if(!cache.has(k)) cache.set(k,floor(p)); return cache.get(k)!;};
const traversable=(edge:any)=>router.isTraversable(edge,DEFAULT_PROFILE);
const greybox=buildGreybox(bundle,traversable,hasFloor,probes,'high');
const resources={geometries:[],materials:[],portalMeshes:new Map(),originals:new Map(),clippedMeshes:[],instances:[]};
cutPortals(scene.root,greybox.openings,resources,new Set(originalTargets.ground));
const live=buildLiveScene({root:scene.root,bundle,traversable,hasFloor,greybox,openings:greybox.openings,originalTargets,walkable,colliders,cameraBlockers,walls,tier:'high',recipe:null,portalInstances:resources.instances});
scene.root.updateMatrixWorld(true);
const meshes:T.Mesh[]=[];
for (const root of [scene.root, ...live.walkable]) root.traverseVisible(o=>{const m=o as T.Mesh;if(m.isMesh && !meshes.includes(m) && m.name !== 'walk proxies (invisible)' && m.name !== 'viewer probe (draws nothing)') meshes.push(m);});
prepareRayTrees(meshes);
console.log(stamp(),'route target',target,'projection',best,'walker',walker,'heading',heading.toArray(),'eye',eye.toArray(),'camera near/far 0.05/2000 m','meshes',meshes.length);
const counts=new Map<string,{n1:number;n20:number;point:number[];gap:number}>(), extents=new Map<string,T.Box3>();
const label=(h:T.Intersection)=>{const m=h.object as T.Mesh, mat=Array.isArray(m.material)?m.material[h.face?.materialIndex ?? 0]:m.material; return `${m.name || m.type}|${mat?.name || mat?.type}|${m.uuid.slice(0,8)}`;};
for(let ix=-120;ix<=120;ix++) for(let iy=0;iy<=80;iy++) {
 const aim=new T.Vector3(walker.x,walker.z+iy*.05,-walker.y).addScaledVector(heading,15).addScaledVector(right,ix*.05);
 const ray=new T.Raycaster(eye,aim.sub(eye).normalize(),0.001,30);
 const hits=castAll(ray,meshes).filter(h=>{const m=h.object as T.Mesh, mat=Array.isArray(m.material)?m.material[h.face?.materialIndex ?? 0]:m.material; return mat?.visible && mat.opacity>0;});
 for(let j=0;j<Math.min(hits.length,8);j++) {const h=hits[j]!, name=label(h); if(!extents.has(name))extents.set(name,new T.Box3()); extents.get(name)!.expandByPoint(h.point);
  for(let k=j+1;k<Math.min(hits.length,8);k++){const b=hits[k]!,gap=b.distance-h.distance;if(gap>.02)break;if(h.object===b.object && h.instanceId===b.instanceId)continue;
   const key=[name,label(b)].sort().join(' <> '), v=counts.get(key) ?? {n1:0,n20:0,point:h.point.toArray(),gap};v.n20++;if(gap<=.001)v.n1++;counts.set(key,v);
  }
 }
}
for(const [key,v] of [...counts].sort((a,b)=>b[1].n20-a[1].n20)) console.log(stamp(),'PAIR',key,JSON.stringify(v));
for(const [key,box] of extents) console.log(stamp(),'SAMPLED EXTENT',key,JSON.stringify({min:box.min.toArray(),max:box.max.toArray()}));
scene.dispose(); console.log(stamp(),'PASS');
