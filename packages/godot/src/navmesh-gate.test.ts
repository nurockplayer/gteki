import { describe, expect, it } from "vitest";
import { fallbackGate } from "./navmesh-fallback-audit.ts";
import { measureFallbacks } from "./navmesh-fallback.ts";
import { fallbackDiff } from "./navmesh-fallback-diff.ts";
import fs from "node:fs";
import path from "node:path";

describe("fallback clip gate",()=>{
  const clean={offFloor:0,noFloor:0,wallHits:0};
  it("rejects a clipped fallback even when navmesh segments are clean",()=>{
    expect(fallbackGate({fallback:{failed:["edge"]},unlisted:[],navmesh:clean,incompleteRoutes:0}).ok).toBe(false);
  });
  it("rejects unlisted edges and navmesh clips",()=>{
    expect(fallbackGate({fallback:{failed:[]},unlisted:["edge"],navmesh:clean,incompleteRoutes:0}).ok).toBe(false);
    expect(fallbackGate({fallback:{failed:[]},unlisted:[],navmesh:{...clean,wallHits:1},incompleteRoutes:0}).ok).toBe(false);
    expect(fallbackGate({fallback:{failed:[]},unlisted:[],navmesh:clean,incompleteRoutes:0}).ok).toBe(true);
    expect(fallbackGate({fallback:{failed:[]},unlisted:[],navmesh:clean,incompleteRoutes:1}).ok).toBe(false);
  });
  it.each(["wallHits","offFloor","noFloor"] as const)("rejects connector %s",field=>{
    expect(fallbackGate({fallback:{failed:[]},unlisted:[],navmesh:clean,connector:{...clean,[field]:1},incompleteRoutes:0}).ok).toBe(false);
  });
});

describe("public station navmesh gate",()=>{
  it.each(["ikebukuro","shinjuku"])("audits %s against its committed fallback list",station=>{
    const file=path.resolve(`stations/${station}/navmesh-fallback.json`);
    const allowed=JSON.parse(fs.readFileSync(file,"utf8"));
    const previous=process.env.GTEKI_PRIVATE_DIR; delete process.env.GTEKI_PRIVATE_DIR;
    let result:ReturnType<typeof measureFallbacks>;
    try { result=measureFallbacks(station,file); } finally { if(previous!==undefined) process.env.GTEKI_PRIVATE_DIR=previous; }
    const diff=fallbackDiff(allowed,result.entries), segment=result.audit.segmentTotals.sceneRaycast;
    console.log(`${station} gate ${Math.round(result.elapsedMs)} ms, bake ${Math.round(result.audit.bakeProvenance.bakeMs)} ms`);
    const errors:string[]=[];
    if(diff.added.length) errors.push(`unlisted failed edges: ${diff.added.join(", ")}`);
    if(diff.removed.length) errors.push(`remove these from the list: ${diff.removed.join(", ")}`);
    if(diff.duplicateAllowed || diff.duplicateActual || diff.grew) errors.push("duplicate or growing fallback list");
    if(!result.audit.routesAudited || !result.audit.completeAuditedRoutes) errors.push("no completed routable routes were audited");
    if(result.audit.incompleteRoutes) errors.push(`incomplete routes not yet validated with fallback joins: ${result.audit.incompleteRoutes}`);
    if(result.audit.invalidJoinRoutes) errors.push(`invalid route joins: ${result.audit.invalidJoinRoutes}`);
    for(const kind of ["navmesh","connector"]) if(segment[kind].wallHits || segment[kind].offFloor || segment[kind].noFloor) errors.push(`${kind} clips: ${JSON.stringify(segment[kind])}`);
    for(const kind of ["navmesh","connector"]) if(result.audit.uniqueEdgeScene[kind].wallHits || result.audit.uniqueEdgeScene[kind].offFloor || result.audit.uniqueEdgeScene[kind].noFloor) errors.push(`unique ${kind} clips: ${JSON.stringify(result.audit.uniqueEdgeScene[kind])}`);
    if(result.audit.fallbackAudit.failed.length) errors.push(`fallback clips: ${JSON.stringify(result.audit.fallbackAudit.totals)}; edges: ${result.audit.fallbackAudit.failed.join(", ")}`);
    expect(errors,errors.join("\n")).toEqual([]);
  },180_000);
});
