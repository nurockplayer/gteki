import fs from 'node:fs';
import * as T from '../../../packages/godot/node_modules/three/build/three.module.js';
import {loadScene} from '../../../packages/godot/src/route-clip-audit.ts';
import {navmeshBundle} from '../../../packages/godot/src/navmesh-input.ts';
import {planBundle} from '../../../stations/shinjuku/gteki/scene.ts';
import {prepareLayout} from '../../../stations/shinjuku/scene/build-cache.ts';
import {pointInRings,roomFloorFill,spaceRole} from '../../../stations/shinjuku/scene/layout.ts';
import {applyLivePipeline} from '../live-pipeline.ts';
import {opaqueScene} from './opaque.ts';
import {reportViewer} from '../viewer.ts';
import {classifyRay,classifyEscape,footprintContains,type OpeningFootprint} from '../../../stations/shinjuku/test/helpers/escape-classify.ts';
if(process.env.GTEKI_PRIVATE_DIR)throw Error('Public data only');
const label=process.argv[2],out=`.qa/221/escape/${label}`;fs.mkdirSync(out,{recursive:true});
const stamp=()=>new Date().toLocaleString('sv-SE',{timeZone:'Asia/Tokyo'})+' JST';
// Street level and the openings the scene cuts: the band `cutStairwells` removes where a
// run sits 0.25–2.4 m under the slab, and any street-level connector polygon `buildLayout`
// voids because a run descends through it. The margin only widens those footprints.
// An escape only counts from an eye below the street; from an eye at or above it, any
// hit above the street is ordinary surface geometry, not evidence about the shell.
const STREET_Z=0,OPENING_MARGIN=.3,OPENING_SHARE=.9,HORIZON=250;
const {bundle}=await navmeshBundle('shinjuku');const scene=await loadScene('shinjuku',bundle,'high');
const plan=JSON.parse(fs.readFileSync('stations/shinjuku/data/plan.json','utf8'));
const {layout}=prepareLayout(planBundle(bundle),plan,{reuse:true,verifyGeneratedInput:true});
// Street-level floor the renderer draws (single-sided top): a crossing outside every cut
// but inside this cover passed through solid floor, so the missing face is the underside.
const streetCover=[...layout.levels.filter(lv=>Math.abs(lv.z)<.1).flatMap(lv=>lv.slabs),...layout.pads,...layout.streetPads,...layout.linkStrips,...roomFloorFill(layout,plan)].filter(s=>Math.abs(s.z)<.1);
const onStreetFloor=(p:{x:number;y:number})=>streetCover.some(s=>pointInRings(p,s.rings));
const runs=layout.runs.filter(r=>['stairs','escalator'].includes(r.mode)&&Math.hypot(r.b.x-r.a.x,r.b.y-r.a.y)>1e-6);
// Optional env filter, comma-separated edge-id prefixes (the hex after `e:`), for one flight set.
const filter=(process.env.GTEKI_ESCAPE_FLIGHTS??'').split(',').map(s=>s.trim()).filter(Boolean);
const selected=filter.length?runs.filter(r=>filter.some(f=>r.edgeId.slice(2).startsWith(f))):runs;
if(!selected.length)throw Error(`No flight matches ${filter.join(',')}`);
// Every run can open the street slab, and a neighbouring flight's mouth is a legitimate
// place for an escape to leave even when it is not this flight's own street end.
const bands:Extract<OpeningFootprint,{kind:"band"}>[]=[];
for(const r of runs){
 const dz=r.b.z-r.a.z;if(Math.abs(dz)<1e-6)continue;
 const t1=(STREET_Z-.25-r.a.z)/dz,t2=(STREET_Z-2.4-r.a.z)/dz,lo=Math.max(0,Math.min(t1,t2)),hi=Math.min(1,Math.max(t1,t2));
 if(hi<=lo)continue;
 const d={x:r.b.x-r.a.x,y:r.b.y-r.a.y};
 bands.push({kind:"band",id:r.edgeId,a:{x:r.a.x+d.x*lo,y:r.a.y+d.y*lo},b:{x:r.a.x+d.x*hi,y:r.a.y+d.y*hi},halfWidth:r.width/2});
}
// `buildLayout` also drops a whole street-level connector polygon from the slab when a run
// descends through it (a voided portal/plaza). That polygon is an opening in the scene too.
const planStreet=plan.levels.find((l:any)=>Math.abs(l.renderElevationM-STREET_Z)<.1);
const streetLevel=layout.levels.find(lv=>Math.abs(lv.z-STREET_Z)<.1);
const builtSpaceIds=new Set((streetLevel?.slabs??[]).map(s=>s.spaceId.split(':')[0]));
const openings:OpeningFootprint[]=[...bands];
for(const space of planStreet?.spaces??[]){
 if(spaceRole(space)!=="connector"||builtSpaceIds.has(space.id))continue;
 openings.push({kind:"rings",id:`void:${space.id}`,rings:space.rings});
}
const edgeById=new Map(bundle.edges.map(e=>[e.id,e])),nodeById=new Map(bundle.nodes.map(n=>[n.id,n]));
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
for(const run of selected){
 const dx=run.b.x-run.a.x,dy=run.b.y-run.a.y,dz=run.b.z-run.a.z,L=Math.hypot(dx,dy,dz),H=Math.hypot(dx,dy);
 const distances:number[]=[];for(let d=0;d<L-1e-6;d+=.5)distances.push(d);distances.push(L);
 const edge=edgeById.get(run.edgeId)!,upIsB=run.b.z>=run.a.z,upperNode=nodeById.get(upIsB?edge.to:edge.from)!,upperZ=upIsB?run.b.z:run.a.z;
 const own=bands.find(o=>o.id===run.edgeId);
 let count=0,rangeCount=0,points=0,underground=0,aboveStreetEye=0,ownEscapes=0,otherEscapes=0,elsewhere=0,throughFloorCount=0,openAir=0,neverClimbs=0,nearAbove=0,horizonAbove=0,noHit=0;
 const gapSamples=new Map<number,{sample:number,x:number,y:number,lateral:number}>();
 const gapLateral={left:0,centre:0,right:0},gapAzimuth:number[]=[0,0,0,0,0,0,0,0];
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
   if(outcome==="escape"){
    const dir=dirs[direction]!,origin=ray.ray.origin,eyeBelowStreet=origin.y<0;
    // Where an underground ray reaches the street plane, in plan coordinates
    // (plan y = -world z). From an eye at or above the street there is no shell
    // evidence: every hit above it is ordinary surface geometry.
    let crossing:{x:number,y:number}|null=null;
    if(eyeBelowStreet&&dir.y>1e-9){const ct=-origin.y/dir.y;if(ct<=HORIZON)crossing={x:origin.x+dir.x*ct,y:-(origin.z+dir.z*ct)};}
    const cls=eyeBelowStreet?classifyEscape(crossing,openings,OPENING_MARGIN):"aboveStreetEye" as const;
    // A shell-gap crossing over drawn street floor passed through solid slab: the
    // missing face is the floor's underside, not an open shaft mouth.
    const throughFloor=cls==="shellGap"&&crossing!==null&&onStreetFloor(crossing);
    const facts={elevationDeg:Math.round(Math.asin(dir.y)*180/Math.PI*100)/100,crossing,nearAboveStreet:!!(hit&&hit.point.y>.00001),horizonAboveStreet:!!(horizon&&horizon.point.y>.00001),noHit:!hit&&!horizon,eyeBelowStreet,class:cls,throughFloor};
    escapes.push([sample,direction,horizon?.point.toArray()??null,facts]);count++;
    if(facts.nearAboveStreet)nearAbove++;
    if(facts.horizonAboveStreet)horizonAbove++;
    if(facts.noHit)noHit++;
    if(!eyeBelowStreet)aboveStreetEye++;
    else{
     underground++;
     if(cls==="streetOpening"){if(crossing&&own&&footprintContains(own,crossing,OPENING_MARGIN))ownEscapes++;else otherEscapes++;}
     else{
      elsewhere++;
      if(crossing){if(throughFloor)throughFloorCount++;else openAir++;}
      if(dir.y<=0&&facts.noHit)neverClimbs++;
      if(!gapSamples.has(sample))gapSamples.set(sample,{sample,x:Math.round(p.x*100)/100,y:Math.round(p.y*100)/100,lateral});
      gapLateral[lateral<0?"left":lateral>0?"right":"centre"]++;
      // Plan direction of the leak, in 45° sectors from +x, for the "which face" evidence.
      const sector=Math.floor(((Math.atan2(-dir.z,dir.x)*180/Math.PI+360)%360)/45)%8;gapAzimuth[sector]=gapAzimuth[sector]!+1;
     }
    }
   }
   else if(outcome==="rangeMiss"){rangeMisses.push([sample,direction,horizon!.point.toArray()]);rangeCount++;}
  }
 }
 const opening=ownEscapes+otherEscapes,share=underground?opening/underground:0,sharePct=Math.round(share*1e4)/100;
 flightStats.push({edgeId:run.edgeId,mode:run.mode,width:run.width,samples:points,escapes:count,undergroundEscapes:underground,aboveStreetEye,rangeMisses:rangeCount,
  upperEnd:{node:upperNode.id,floorId:upperNode.floorId,z:Math.round(upperZ*100)/100,streetLevel:Math.abs(upperZ-STREET_Z)<.5},
  opening:own?{a:own.a,b:own.b,halfWidth:own.halfWidth}:null,
  insideOwnOpening:ownEscapes,insideOtherOpening:otherEscapes,elsewhere,throughFloor:throughFloorCount,openAir,neverClimbs,
  nearAboveStreet:nearAbove,horizonAboveStreet:horizonAbove,noHit,
  shellGapSamples:gapSamples.size,shellGapSampleShare:points?Math.round(gapSamples.size/points*1e4)/1e4:0,
  shellGapLateralByCount:gapLateral,shellGapAzimuthSectorsFromPlusX:gapAzimuth,
  shellGapEyes:[...gapSamples.values()],
  class:underground===0?"unknown":share>=OPENING_SHARE?"streetOpening":"shellGap",
  classReason:underground===0?"no eye below street: every sample stands at or above street level":`${sharePct}% of underground escapes leave inside a cut band or a voided street connector polygon (threshold ${OPENING_SHARE*100}%)`,
  openingShare:Math.round(share*1e4)/1e4});
 console.log(stamp(),label,flightStats.length+'/'+selected.length,run.edgeId,count,'escapes',rangeCount,'range misses',underground,'underground',opening,'inside openings',elsewhere,'elsewhere (',throughFloorCount,'through floor,',openAir,'open air )',aboveStreetEye,'above-street eyes');
}
fs.writeFileSync(`${out}/samples.json`,JSON.stringify(samples));fs.writeFileSync(`${out}/directions.json`,JSON.stringify(dirs.map(d=>d.toArray())));
fs.writeFileSync(`${out}/escapes.json`,JSON.stringify(escapes));fs.writeFileSync(`${out}/range-misses.json`,JSON.stringify(rangeMisses));
fs.writeFileSync(`${out}/street-openings.json`,JSON.stringify({streetZ:STREET_Z,margin:OPENING_MARGIN,openings},null,2));
const streetOpening=flightStats.reduce((n,f)=>n+f.insideOwnOpening+f.insideOtherOpening,0),shellGap=flightStats.reduce((n,f)=>n+f.elsewhere,0),aboveStreetEye=flightStats.reduce((n,f)=>n+f.aboveStreetEye,0),undergroundTotal=streetOpening+shellGap;
const summary={timestamp:stamp(),label,sceneSha:process.env.GTEKI_SCENE_SHA??null,flightFilter:filter,flights:selected.length,flightsAvailable:runs.length,samples:samples.length,directions:dirs.length,rays,escapes:escapes.length,rangeMisses:rangeMisses.length,escapeClasses:{underground:{total:undergroundTotal,streetOpening,shellGap,throughFloor:flightStats.reduce((n,f)=>n+f.throughFloor,0),openAir:flightStats.reduce((n,f)=>n+f.openAir,0),neverClimbs:flightStats.reduce((n,f)=>n+f.neverClimbs,0),shareStreetOpening:undergroundTotal?Math.round(streetOpening/undergroundTotal*1e4)/1e4:0},aboveStreetEye,all:{total:escapes.length,streetOpening,shellGap,aboveStreetEye}},streetOpenings:{streetZ:STREET_Z,marginM:OPENING_MARGIN,shareThreshold:OPENING_SHARE,bands:bands.length,voids:openings.length-bands.length,count:openings.length},triangles:opaque!.triangles,minTriangles,maxTriangles,lodChanges,viewer:"app probe and update at every eye",regression,flightStats};
fs.writeFileSync(`${out}/summary.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify({...summary,flightStats:undefined}));scene.dispose();
