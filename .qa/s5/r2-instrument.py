from pathlib import Path
p=Path('packages/godot/src/navmesh-fallback.ts')
s=p.read_text().replace('timeout:180_000','timeout:600_000')
s=s.replace('const result=measureFallbacks(station,undefined,!!baselineDest);','const result=measureFallbacks(station,undefined,!!baselineDest); fs.mkdirSync(`.qa/s5/r2-${process.env.S5_VARIANT}/${station}`,{recursive:true}); fs.writeFileSync(`.qa/s5/r2-${process.env.S5_VARIANT}/${station}/audit.json`,JSON.stringify(result.audit));')
p.write_text(s)
p=Path('packages/godot/src/navmesh-audit.ts');s=p.read_text()
s=s.replace('export function queryPathWithLinks(', 'function qaOriginalQueryPathWithLinks(',1)
import json
begin=s.index('function qaOriginalQueryPathWithLinks(')
pos=s.index('/** Snap a path')
body=s[begin:pos]
body=body.replace('    if (!result.length || distance(result[0]!.point,from)>0.01', '    qaCandidate={first:result[0]?.point,last:result.at(-1)?.point,length:length(result.map(v=>v.point)),links:result.filter(v=>v.link).map(v=>v.link)};\n    if (!result.length || distance(result[0]!.point,from)>0.01',1)
body='\n'.join(line.replace('return null;', '{ qaStage='+json.dumps(line.strip())+'; return null; }') if 'return null;' in line else line for line in body.split('\n'))
s=s[:begin]+body+s[pos:]
pos=s.index('/** Snap a path')
s=s[:pos]+'''let qaStage=""; let qaCandidate:any=null; const qaQueries:any[]=[];
export function queryPathWithLinks(nav:NavMesh,query:NavMeshQuery,from:V3,to:V3,diagnostics?:{straightLimit:boolean}) {
 qaStage=""; qaCandidate=null; const result=qaOriginalQueryPathWithLinks(nav,query,from,to,diagnostics);
 const a=query.findClosestPoint(from,{halfExtents:extents}),b=query.findClosestPoint(to,{halfExtents:extents});
 qaQueries.push({from,to,stage:qaStage,candidate:qaCandidate,a:{poly:a.polyRef,point:a.point},b:{poly:b.polyRef,point:b.point},result:result ? {first:result[0]?.point,last:result.at(-1)?.point,length:length(result.map(v=>v.point)),links:result.filter(v=>v.link).map(v=>v.link)}:null});
 return result;
}

'''+s[pos:]
s=s.replace('const routeSteps: RouteStep[][] = [];','const qaRoutes:any[]=[]; const routeSteps: RouteStep[][] = [];',1)
s=s.replace('stepUses += route.steps.length;', 'const qaRoute:any={pairKey,steps:route.steps,incomplete:false,invalid:false}; qaRoutes.push(qaRoute); stepUses += route.steps.length;',1)
s=s.replace('incomplete++;','qaRoute.incomplete=true; incomplete++;')
s=s.replace('invalidJoinRoutes++;','qaRoute.invalid=true; invalidJoinRoutes++;')
s=s.replace('JSON.stringify({ ...result, navPaths,','JSON.stringify({ ...result, qaRoutes, qaQueries, qaEntries:[...cache.values()].map(e=>({step:e.step,missing:e.missing,reason:e.reason,suspect:e.suspect,connectivity:e.connectivity,first:e.points?.[0],last:e.points?.at(-1)})), qaJoins:[...joinChecks], navPaths,',1)
p.write_text(s)
