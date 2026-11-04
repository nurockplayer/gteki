#!/bin/sh
# #826 targeted diagnosis, 2026-11-05 JST. Container-only source instrumentation.
# usage: sh .qa/826/probe-navmesh.sh <station>
# Writes .qa/826/probe/<station>/{audit,navmesh-*}.json; audit.json gains `qaEdgeProbe`.
# Coordinates: PolylinePoint = {x, y = north, z = height}; NavMeshQuery = {x, y = height, z = -north}.
set -eu
station="${1:?usage: probe-navmesh.sh <station>}"
export QA_OUT=".qa/826/probe"
mkdir -p "$QA_OUT/$station"
python3 - <<'PY'
import os
from pathlib import Path
out = os.environ["QA_OUT"]
p = Path('packages/godot/src/navmesh-fallback.ts'); s = p.read_text()
assert s.count('timeout:180_000') == 1
s = s.replace('timeout:180_000', 'timeout:900_000', 1)
needle = '  const result=measureFallbacks(station,undefined,!!baselineDest);'
assert s.count(needle) == 1
s = s.replace(needle, needle + '\n  fs.mkdirSync(`${process.env.QA_OUT}/${station}`,{recursive:true}); fs.writeFileSync(`${process.env.QA_OUT}/${station}/audit.json`,JSON.stringify(result.audit));')
p.write_text(s)

probe_block = r'''
  // #826: why do these four edges have no navmesh path?
  const qaTargetIds=['e:82c9a2c2cd704a348fbeb423d07cb125','e:6ac033af77914fe5a9786676088b952c','e:65edd7ca50844b609d4dcb25bd296936','e:ed7e56a8e6234197be06280fcb24aecc'];
  const qaLinePoint=(line:{x:number;y:number;z:number}[],total:number,t:number)=>{let acc=t*total,seg=1;
    for(;;){const L=Math.hypot(line[seg]!.x-line[seg-1]!.x,line[seg]!.y-line[seg-1]!.y);
      if(seg>=line.length-1||acc<=L) {const u=Math.min(1,acc/(L||1)),p1=line[seg-1]!,p2=line[seg]!;
        return {t,x:p1.x+(p2.x-p1.x)*u,y:p1.y+(p2.y-p1.y)*u,z:p1.z+(p2.z-p1.z)*u};}
      acc-=L; seg++;}};
  const qaEdgeProbe=qaTargetIds.map((id)=>{
    const edge=edges.get(id); if(!edge) return {edgeId:id,missing:true} as Record<string,unknown>;
    const o:Record<string,unknown>={edgeId:id,mode:edge.mode,direction:edge.direction};
    const pFrom=nodePoint(edge.from), pTo=nodePoint(edge.to);
    const box=(p:V3,r:number)=>{const q=query.findClosestPoint(p,{halfExtents:{x:r,y:r,z:r}});
      return q.polyRef?{point:q.point,dy:Number((q.point.y-p.y).toFixed(3)),dxz:Number(Math.hypot(q.point.x-p.x,q.point.z-p.z).toFixed(3))}:null;};
    o.fromEnd={nodeId:edge.from,point:pFrom,snap:snapNode(query,pFrom),box15:box(pFrom,1.5),box3:box(pFrom,3)};
    o.toEnd={nodeId:edge.to,point:pTo,snap:snapNode(query,pTo),box15:box(pTo,1.5),box3:box(pTo,3)};
    if(edge.mode==="elevator") return o;
    const a=snapNode(query,pFrom), b=snapNode(query,pTo);
    if(!a||!b) return o;
    const start=query.findClosestPoint(a,{halfExtents:extents});
    const reach=(q:V3)=>{const s=query.findClosestPoint(q,{halfExtents:extents}); if(!s.polyRef) return null;
      const f=query.findPath(start.polyRef,s.polyRef,a,q,{maxPathPolys:2048});
      const reached=!!f.success&&f.polys.size>0&&f.polys.get(f.polys.size-1)===s.polyRef; f.polys.destroy(); return reached;};
    const grid:{dx:number;dz:number;ok:boolean|null}[]=[];
    for(const dx of [-2,-1,0,1,2]) for(const dz of [-2,-1,0,1,2]) grid.push({dx,dz,ok:reach({x:a.x+dx,y:a.y,z:a.z+dz})});
    o.island={reachableFromA:grid.filter(g=>g.ok).length,sampled:grid.length,toB:reach(b),grid};
    const qaStep:RouteStep={edgeId:edge.id,fromNodeId:edge.from,toNodeId:edge.to,reversed:false,mode:edge.mode,lengthM:edge.lengthM??0,fromFloorId:"",toFloorId:""};
    const line=routePolyline(bundle,oneStepRoute(qaStep));
    let total=0; for(let i=1;i<line.length;i++) total+=Math.hypot(line[i]!.x-line[i-1]!.x,line[i]!.y-line[i-1]!.y);
    const n=Math.max(1,Math.ceil(total/0.25)), pts:{t:number;x:number;y:number;z:number}[]=[];
    for(let i=0;i<=n;i++) pts.push(qaLinePoint(line,total,i/n));
    o.lineM=Number(total.toFixed(3));
    o.navAlong=pts.map(p=>{const q={x:p.x,y:p.z,z:-p.y};
      const hit=query.findClosestPoint(q,{halfExtents:{x:0.4,y:0.3,z:0.4}});
      return {t:Number(p.t.toFixed(3)),poly:!!hit.polyRef,dy:hit.polyRef?Number((hit.point.y-q.y).toFixed(3)):null};});
    const cross:unknown[]=[];
    for(let i=1;i<line.length;i++){const p1=line[i-1]!,p2=line[i]!;
      for(const w of probe.walls){ if(!(w.zMax>p1.z+0.05&&w.zMin<p1.z+1.7)) continue;
        const den=(p2.x-p1.x)*(w.b.y-w.a.y)-(p2.y-p1.y)*(w.b.x-w.a.x); if(Math.abs(den)<1e-9) continue;
        const tw=((w.a.x-p1.x)*(w.b.y-w.a.y)-(w.a.y-p1.y)*(w.b.x-w.a.x))/den;
        const uw=((w.a.x-p1.x)*(p2.y-p1.y)-(w.a.y-p1.y)*(p2.x-p1.x))/den;
        if(tw>0&&tw<1&&uw>=-1e-6&&uw<=1+1e-6) cross.push({role:w.role,source:w.source,zMin:w.zMin,zMax:w.zMax,a:[w.a.x,w.a.y],b:[w.b.x,w.b.y]});}}
    o.wallCrossings=cross;
    const ray=new THREE.Raycaster(), up=new THREE.Vector3(0,1,0), clear:{t:number;h:number|null;name:string|null}[]=[];
    for(let i=0;i<=20;i++){const p=pts[Math.round(i*(pts.length-1)/20)]!;
      const q=new THREE.Vector3(p.x,p.z,-p.y); ray.set(q,up); ray.far=6;
      const hits=ray.intersectObjects([...probe.ground,...probe.collider],true).filter(h=>h.point.y>q.y+0.1);
      clear.push({t:Number(p.t.toFixed(3)),h:hits.length?Number((hits[0]!.point.y-q.y).toFixed(2)):null,name:hits.length?(hits[0]!.object.name||hits[0]!.object.parent?.name||"unnamed"):null});}
    o.headroom=clear;
    return o;
  });
'''
p = Path('packages/godot/src/navmesh-audit.ts'); s = p.read_text()
needle = '  fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, JSON.stringify({ ...result, navPaths,'
assert s.count(needle) == 1
s = s.replace(needle, probe_block + needle.replace('{ ...result, navPaths,', '{ ...result, qaEdgeProbe, navPaths,'), 1)
p.write_text(s)
print('Container-only: 900 s timeout, audit dump, qaEdgeProbe', flush=True)
PY
date '+%F %T %Z'
pnpm tsx packages/godot/src/navmesh-fallback.ts --station "$station" --with-greybox \
  --write "$QA_OUT/$station/navmesh-fallback.json" \
  --write-baseline "$QA_OUT/$station/navmesh-clip-baseline.json" \
  --write-suspect "$QA_OUT/$station/navmesh-suspect.json" \
  --write-paths "$QA_OUT/$station/navmesh-paths.json"
date '+%F %T %Z'
