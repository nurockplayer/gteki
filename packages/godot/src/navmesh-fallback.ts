import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { qaDirectory, qaRoot } from "./navmesh-qa-path.ts";
import { baselineForAudit } from "./navmesh-clip-baseline.ts";

type Failure = { edgeId:string; mode:string; reason:string|null; connectivity:string; gaps:{class:string}[] };
export type FallbackEntry = {edgeId:string; mode:string; reason:string};

/** The bake options every measurement uses; the committed navmesh paths carry them as their header. */
export const NAVMESH_BAKE = { cellSizeM:0.10, agentRadiusM:0.30, walkableClimbM:0.40, tileSize:256, withGreybox:true };

export type NavEdgePaths = { forward?: number[][]; reverse?: number[][] };
export type NavPaths = Record<string, NavEdgePaths>;

/** Compare committed per-edge walk paths with freshly computed ones, keyed `edgeId:forward|reverse`. */
export function navPathsDiff(committed:NavPaths, computed:NavPaths, toleranceM=0.05): { missing:string[]; extra:string[]; moved:string[] } {
  const index=(paths:NavPaths)=>{const map=new Map<string,number[][]>();for(const [edgeId,dirs] of Object.entries(paths ?? {})) for(const dir of ["forward","reverse"] as const){const points=dirs?.[dir];if(points) map.set(`${edgeId}:${dir}`,points);}return map;};
  const before=index(committed), after=index(computed), missing:string[]=[], extra:string[]=[], moved:string[]=[];
  for(const [key,points] of after) {if(!before.has(key)) missing.push(key); else if(!samePoints(before.get(key)!,points,toleranceM)) moved.push(key);}
  for(const key of before.keys()) if(!after.has(key)) extra.push(key);
  return {missing:missing.sort(),extra:extra.sort(),moved:moved.sort()};
}
const samePoints=(a:readonly number[][],b:readonly number[][],toleranceM:number)=>a.length===b.length && a.every((p,i)=>{const q=b[i]!;return p.length===q.length && p.every((v,axis)=>Math.abs(v-q[axis]!)<=toleranceM);});

/** Collapse directed failures into a stable edge list, preferring a diagnosed gap. */
export function fallbackEntries(failures:readonly Failure[]):FallbackEntry[] {
  const byId=new Map<string,{mode:string; gaps:Set<string>; reasons:Set<string>}>();
  for (const f of failures) {
    const entry=byId.get(f.edgeId) ?? {mode:f.mode,gaps:new Set<string>(),reasons:new Set<string>()};
    for(const g of f.gaps) entry.gaps.add(g.class);
    entry.reasons.add(f.reason === "no_path" && ["disconnected","query_limit","query_error"].includes(f.connectivity) ? f.connectivity : f.reason ?? f.connectivity);
    byId.set(f.edgeId,entry);
  }
  return [...byId].map(([edgeId,e])=>({edgeId,mode:e.mode,reason:[...e.gaps].sort()[0] ?? [...e.reasons].sort()[0]!})).sort((a,b)=>a.edgeId.localeCompare(b.edgeId));
}

/** Ensure private fallback data cannot be redirected into the repository by a symlink. */
export function fallbackDestination(file:string, privateDir?:string):string {
  const dest=path.resolve(file), parent=fs.realpathSync(path.dirname(dest));
  if (privateDir) {
    const root=fs.realpathSync(privateDir), rel=path.relative(root,parent);
    if (rel.startsWith(".."+path.sep) || rel===".." || path.isAbsolute(rel)) throw new Error("private fallback output must be under GTEKI_PRIVATE_DIR");
  }
  const resolved=path.join(parent,path.basename(dest));
  try { if (fs.lstatSync(resolved).isSymbolicLink()) throw new Error("fallback output must not be a symlink"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code!=="ENOENT") throw e; }
  return resolved;
}

/** Bake and audit in a disposable .qa directory, retaining only aggregate results. */
export function measureFallbacks(station:string, fallbackList?:string, includeFallbackSites=false) {
  if (!/^(ikebukuro|shinjuku)$/.test(station)) throw new Error("unsupported station");
  const dir=fs.mkdtempSync(path.join(qaDirectory(path.join(qaRoot(),"navmesh")),"fallback-")), start=performance.now();
  const run=(script:string,args:string[])=>{
    const child=spawnSync("pnpm",["tsx",`packages/godot/src/${script}`,...args],{encoding:"utf8",maxBuffer:32*1024*1024,timeout:180_000});
    if (child.status!==0) throw new Error(`${script} failed: ${child.error?.message ?? `exit ${child.status}`}`);
  };
  try {
    run("navmesh-bake.ts",["--station",station,...(NAVMESH_BAKE.withGreybox ? ["--with-greybox"] : []),"--cell-size",String(NAVMESH_BAKE.cellSizeM),"--agent-radius",String(NAVMESH_BAKE.agentRadiusM),"--walkable-climb",String(NAVMESH_BAKE.walkableClimbM),"--tile-size",String(NAVMESH_BAKE.tileSize),"--out",dir]);
    const json=path.join(dir,"audit.json");
    run("navmesh-audit.ts",["--station",station,"--with-greybox","--navmesh",path.join(dir,`${station}.bin`),"--json",json,...(fallbackList ? ["--fallback-list",fallbackList] : [])]);
    let audit=JSON.parse(fs.readFileSync(json,"utf8"));
    const entries=fallbackEntries(audit.failureEdges as Failure[]);
    if (includeFallbackSites && !fallbackList) {
      const list=path.join(dir,"fallback.json"); fs.writeFileSync(list,JSON.stringify(entries),{mode:0o600});
      run("navmesh-audit.ts",["--station",station,"--with-greybox","--navmesh",path.join(dir,`${station}.bin`),"--json",json,"--fallback-list",list]);
      audit=JSON.parse(fs.readFileSync(json,"utf8"));
    }
    return {entries,audit,elapsedMs:performance.now()-start};
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}

function main() {
  const args=process.argv.slice(2); let station="",write="",writeBaseline="",writeSuspect="",writePaths="";
  for(let i=0;i<args.length;i++) {
    if(args[i]==="--station" && args[i+1]) station=args[++i]!;
    else if(args[i]==="--write" && args[i+1]) write=args[++i]!;
    else if(args[i]==="--write-baseline" && args[i+1]) writeBaseline=args[++i]!;
    else if(args[i]==="--write-suspect" && args[i+1]) writeSuspect=args[++i]!;
    else if(args[i]==="--write-paths" && args[i+1]) writePaths=args[++i]!;
    else if(args[i]==="--with-greybox") { /* greybox is the default */ }
    else throw new Error(`unknown or incomplete argument: ${args[i]}`);
  }
  if(!station || (!write && !writeBaseline && !writeSuspect && !writePaths)) throw new Error("use --station <station> [--with-greybox] [--write <path>] [--write-baseline <path>] [--write-suspect <path>] [--write-paths <path>]");
  const dest=write ? fallbackDestination(write,process.env.GTEKI_PRIVATE_DIR) : "", baselineDest=writeBaseline ? fallbackDestination(writeBaseline,process.env.GTEKI_PRIVATE_DIR) : "";
  const suspectDest=writeSuspect ? fallbackDestination(writeSuspect,process.env.GTEKI_PRIVATE_DIR) : "";
  const pathsDest=writePaths ? fallbackDestination(writePaths,process.env.GTEKI_PRIVATE_DIR) : "";
  if(dest && dest===baselineDest) throw new Error("fallback and baseline output must differ");
  if(suspectDest && [dest,baselineDest].includes(suspectDest)) throw new Error("suspect output must differ from fallback and baseline output");
  if(pathsDest && [dest,baselineDest,suspectDest].includes(pathsDest)) throw new Error("paths output must differ from fallback, baseline and suspect output");
  const result=measureFallbacks(station,undefined,!!baselineDest);
  const publish=(file:string,content:unknown)=>{const dir=fs.mkdtempSync(path.join(path.dirname(file),".fallback-"));try {const temporary=path.join(dir,"list.json");fs.writeFileSync(temporary,JSON.stringify(content,null,2)+"\n",{mode:0o600,flag:"wx"});fs.renameSync(temporary,file);} finally {fs.rmSync(dir,{recursive:true,force:true});}};
  if(dest) publish(dest,result.entries);
  if(baselineDest) publish(baselineDest,baselineForAudit(result.audit));
  if(suspectDest) publish(suspectDest,(result.audit.bakeProvenance.suspectEdges as {edgeId:string;mode:string;reason:string}[]).map(({edgeId,mode,reason})=>({edgeId,mode,reason})).sort((a,b)=>a.edgeId.localeCompare(b.edgeId)));
  if(pathsDest) publish(pathsDest,{version:1,station,frame:"ENU",bake:NAVMESH_BAKE,edges:result.audit.navPaths as NavPaths,detours:result.audit.navPathsDetours as string[]});
  console.log(JSON.stringify({station,edges:result.entries.length,bakeMs:result.audit.bakeProvenance.bakeMs,elapsedMs:result.elapsedMs}));
}
if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) main();
