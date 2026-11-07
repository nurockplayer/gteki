import fs from 'node:fs';
import * as T from '../../../packages/godot/node_modules/three/build/three.module.js';
import {loadScene} from '../../../packages/godot/src/route-clip-audit.ts';
import {navmeshBundle} from '../../../packages/godot/src/navmesh-input.ts';
import {planBundle} from '../../../stations/shinjuku/gteki/scene.ts';
import {prepareLayout} from '../../../stations/shinjuku/scene/build-cache.ts';
import {applyLivePipeline} from '../live-pipeline.ts';
import {opaqueScene} from './opaque.ts';
import {reportViewer} from '../viewer.ts';
import {classifyRay} from '../../../stations/shinjuku/test/helpers/escape-classify.ts';
if(process.env.GTEKI_PRIVATE_DIR)throw Error('Public data only');
const label=process.argv[2],out=`.qa/221/escape/${label}`;fs.mkdirSync(out,{recursive:true});
const stamp=()=>new Date().toLocaleString('sv-SE',{timeZone:'Asia/Tokyo'})+' JST';
const {bundle}=await navmeshBundle('shinjuku');const scene=await loadScene('shinjuku',bundle,'high');
const {layout}=prepareLayout(planBundle(bundle),JSON.parse(fs.readFileSync('stations/shinjuku/data/plan.json','utf8')),{reuse:true,verifyGeneratedInput:true});
const runs=layout.runs.filter(r=>['stairs','escalator'].includes(r.mode)&&Math.hypot(r.b.x-r.a.x,r.b.y-r.a.y)>1e-6);
applyLivePipeline(bundle,scene);
let opaque: ReturnType<typeof opaqueScene>;
const viewerCamera=new T.PerspectiveCamera();let drawState="",maxTriangles=0,minTriangles=Infinity,lodChanges=0;
const viewAt=(p:T.Vector3)=>{viewerCamera.position.copy(p);const next=reportViewer(scene,viewerCamera);if(next!==drawState){for(const m of opaque?.meshes??[]){m.geometry.dispose();m.material.dispose();}opaque=opaqueScene(scene.root);drawState=next;maxTriangles=Math.max(maxTriangles,opaque.triangles);minTriangles=Math.min(minTriangles,opaque.triangles);lodChanges++;}};
const fsEye=new T.Vector3(18.3415,-14.16,-5.2725),fsTarget=new T.Vector3(18.7653,-11.16,-3.8336);
const ray=new T.Raycaster(fsEye,fsTarget.sub(fsEye).normalize(),.001,25);
viewAt(fsEye);
const orig=opaque!.original(ray),merged=opaque!.cast(ray);
if(Boolean(orig)!==Boolean(merged)||orig&&Math.abs(orig.distance-merged!.distance)>1e-4)throw Error(`Merged draw ray differs: ${orig?.distance} / ${merged?.distance}`);
const regression={hit:!!orig,point:orig?.point.toArray(),distance:orig?.distance};
const dirs:T.Vector3[]=[];
for(let i=0;i<64;i++){const y=(i+.5)/64,a=i*Math.PI*(3-Math.sqrt(5)),r=Math.sqrt(1-y*y);dirs.push(new T.Vector3(r*Math.cos(a),y,r*Math.sin(a)));}
for(const degrees of [-10,0,10])for(let i=0;i<32;i++){const a=i*2*Math.PI/32,e=degrees*Math.PI/180;dirs.push(new T.Vector3(Math.cos(e)*Math.cos(a),Math.sin(e),Math.cos(e)*Math.sin(a)));}
const samples:any[]=[],escapes:any[]=[],rangeMisses:any[]=[],flightStats:any[]=[];let rays=0;
for(const run of runs){
 const dx=run.b.x-run.a.x,dy=run.b.y-run.a.y,dz=run.b.z-run.a.z,L=Math.hypot(dx,dy,dz),H=Math.hypot(dx,dy);
 const distances:number[]=[];for(let d=0;d<L-1e-6;d+=.5)distances.push(d);distances.push(L);
 let count=0,rangeCount=0,points=0;
 for(const d of distances)for(const lateral of [-.6,0,.6]){
  const t=d/L,s=lateral*run.width/2,p={x:run.a.x+dx*t-dy/H*s,y:run.a.y+dy*t+dx/H*s,z:run.a.z+dz*t};
  const sample=samples.length;samples.push({edgeId:run.edgeId,mode:run.mode,d,lateral,point:p});points++;
  ray.ray.origin.set(p.x,p.z+1.62,-p.y);viewAt(ray.ray.origin);
  for(let direction=0;direction<dirs.length;direction++){
   ray.ray.direction.copy(dirs[direction]!);rays++;
   // Starting underground, a hit before the street crossing is necessarily first.
   // The repo's segment BVH rejects these without sorting all farther hits.
   if(opaque.blockedBelowStreet(ray))continue;
   const hit=opaque.cast(ray);
   // Only rays that miss inside 25 m get the 250 m horizon recast; for the rest the
   // near hit is that same ray's horizon hit.
   let horizon=hit;
   if(!hit){ray.far=250;horizon=opaque.cast(ray);ray.far=25;}
   const outcome=classifyRay(hit,horizon);
   if(outcome==="escape"){escapes.push([sample,direction,horizon?.point.toArray()??null]);count++;}
   else if(outcome==="rangeMiss"){rangeMisses.push([sample,direction,horizon!.point.toArray()]);rangeCount++;}
  }
 }
 flightStats.push({edgeId:run.edgeId,mode:run.mode,samples:points,escapes:count,rangeMisses:rangeCount});
 console.log(stamp(),label,flightStats.length+'/'+runs.length,run.edgeId,count,'escapes',rangeCount,'range misses');
}
fs.writeFileSync(`${out}/samples.json`,JSON.stringify(samples));fs.writeFileSync(`${out}/directions.json`,JSON.stringify(dirs.map(d=>d.toArray())));
fs.writeFileSync(`${out}/escapes.json`,JSON.stringify(escapes));fs.writeFileSync(`${out}/range-misses.json`,JSON.stringify(rangeMisses));
const summary={timestamp:stamp(),label,flights:runs.length,samples:samples.length,directions:dirs.length,rays,escapes:escapes.length,rangeMisses:rangeMisses.length,triangles:opaque!.triangles,minTriangles,maxTriangles,lodChanges,viewer:"app probe and update at every eye",regression,flightStats};
fs.writeFileSync(`${out}/summary.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify({...summary,flightStats:undefined}));scene.dispose();
