import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { qaDirectory } from "./navmesh-qa-path.ts";

type Failure = { edgeId:string; mode:string; reason:string|null; connectivity:string; gaps:{class:string}[] };
export type FallbackEntry = {edgeId:string; mode:string; reason:string};

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
export function measureFallbacks(station:string, fallbackList?:string) {
  if (!/^(ikebukuro|shinjuku)$/.test(station)) throw new Error("unsupported station");
  const dir=fs.mkdtempSync(path.join(qaDirectory(".qa/navmesh"),"fallback-")), start=performance.now();
  const run=(script:string,args:string[])=>{
    const child=spawnSync("pnpm",["tsx",`packages/godot/src/${script}`,...args],{encoding:"utf8",maxBuffer:32*1024*1024,timeout:180_000});
    if (child.status!==0) throw new Error(`${script} failed: ${child.error?.message ?? `exit ${child.status}`}`);
  };
  try {
    run("navmesh-bake.ts",["--station",station,"--with-greybox","--cell-size","0.10","--agent-radius","0.30","--walkable-climb","0.40","--tile-size","256","--out",dir]);
    const json=path.join(dir,"audit.json");
    run("navmesh-audit.ts",["--station",station,"--with-greybox","--navmesh",path.join(dir,`${station}.bin`),"--json",json,...(fallbackList ? ["--fallback-list",fallbackList] : [])]);
    const audit=JSON.parse(fs.readFileSync(json,"utf8"));
    const entries=fallbackEntries(audit.failureEdges as Failure[]);
    return {entries,audit,elapsedMs:performance.now()-start};
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}

function main() {
  const args=process.argv.slice(2); let station="",write="";
  for(let i=0;i<args.length;i++) {
    if(args[i]==="--station" && args[i+1]) station=args[++i]!;
    else if(args[i]==="--write" && args[i+1]) write=args[++i]!;
    else if(args[i]==="--with-greybox") { /* greybox is the default */ }
    else throw new Error(`unknown or incomplete argument: ${args[i]}`);
  }
  if(!station || !write) throw new Error("use --station <station> [--with-greybox] --write <path>");
  const dest=fallbackDestination(write,process.env.GTEKI_PRIVATE_DIR);
  const result=measureFallbacks(station);
  const dir=fs.mkdtempSync(path.join(path.dirname(dest),".fallback-"));
  try {
    const temporary=path.join(dir,"list.json");
    fs.writeFileSync(temporary,JSON.stringify(result.entries,null,2)+"\n",{mode:0o600,flag:"wx"});
    fs.renameSync(temporary,dest);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
  console.log(JSON.stringify({station,edges:result.entries.length,bakeMs:result.audit.bakeProvenance.bakeMs,elapsedMs:result.elapsedMs}));
}
if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) main();
