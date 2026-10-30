import { describe, expect, it } from "vitest";
import { fallbackGate } from "./navmesh-fallback-audit.ts";
import { measureFallbacks, navPathsDiff, NAVMESH_BAKE } from "./navmesh-fallback.ts";
import { fallbackDiff } from "./navmesh-fallback-diff.ts";
import { baselineForAudit, clipBaselineDiff, makeClipBaseline } from "./navmesh-clip-baseline.ts";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** A PR checkout is a merge commit; compare against its first (base) parent. */
function previousVersion(file:string):unknown|null {
  const git=(args:string[])=>{const result=spawnSync("git",args,{encoding:"utf8"});if(result.status!==0) throw new Error(`cannot inspect PR base: git ${args[0]}`);return result.stdout;};
  git(["rev-parse","--verify","HEAD^1"]);
  const listed=git(["ls-tree","--name-only","HEAD^1","--",file]).trim();
  return listed ? JSON.parse(git(["show",`HEAD^1:${file}`])) : null;
}

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

describe("clip baseline ratchet",()=>{
  const c=(connectorWallHits:number,fallbackWallHits=0)=>({connectorWallHits,fallbackWallHits,navmeshWallHits:0,offFloor:0});
  it("fails increases, new edges, and improvements until the baseline is lowered",()=>{
    const base=makeClipBaseline({a:c(2)},3);
    expect(clipBaselineDiff(base,makeClipBaseline({a:c(2)},3))).toEqual({increased:[],lowered:[]});
    expect(clipBaselineDiff(base,makeClipBaseline({a:c(3),b:c(1)},4)).increased.join(" ")).toContain("b.connectorWallHits");
    expect(clipBaselineDiff(base,makeClipBaseline({a:c(1)},2)).lowered.join(" ")).toContain("a.connectorWallHits");
    expect(clipBaselineDiff(base,makeClipBaseline({a:c(1)},2)).lowered.join(" ")).toContain("total.unvalidatedJoins");
  });
  it("detects lost route coverage and new invalid joins even when incomplete stays constant",()=>{
    const before=makeClipBaseline({},3,{invalidJoins:0,routablePairs:10,failedRoutePairs:2});
    const after=makeClipBaseline({},3,{invalidJoins:1,routablePairs:9,failedRoutePairs:3});
    const errors=clipBaselineDiff(before,after).increased.join(" ");
    expect(errors).toContain("total.invalidJoins");expect(errors).toContain("total.routablePairs");expect(errors).toContain("total.failedRoutePairs");
  });
  it("rejects totals that do not equal their edge entries",()=>{
    const base=makeClipBaseline({a:c(1)},0);base.total.connectorWallHits=2;
    expect(()=>clipBaselineDiff(base,makeClipBaseline({a:c(1)},0))).toThrow("inconsistent baseline total");
  });
});

describe("public station navmesh gate",()=>{
  it.each(["ikebukuro","shinjuku"])("audits %s against its committed fallback list",station=>{
    const file=path.resolve(`stations/${station}/navmesh-fallback.json`);
    const allowed=JSON.parse(fs.readFileSync(file,"utf8"));
    const baseline=JSON.parse(fs.readFileSync(path.resolve(`stations/${station}/navmesh-clip-baseline.json`),"utf8"));
    const suspectAllowed=JSON.parse(fs.readFileSync(path.resolve(`stations/${station}/navmesh-suspect.json`),"utf8"));
    const previous=process.env.GTEKI_PRIVATE_DIR; delete process.env.GTEKI_PRIVATE_DIR;
    let result:ReturnType<typeof measureFallbacks>;
    try { result=measureFallbacks(station,file); } finally { if(previous!==undefined) process.env.GTEKI_PRIVATE_DIR=previous; }
    const diff=fallbackDiff(allowed,result.entries), segment=result.audit.segmentTotals.sceneRaycast;
    const suspectComputed=result.audit.bakeProvenance.suspectEdges as {edgeId:string}[], suspectDiff=fallbackDiff(suspectAllowed,suspectComputed);
    console.log(`${station} gate ${Math.round(result.elapsedMs)} ms, bake ${Math.round(result.audit.bakeProvenance.bakeMs)} ms`);
    const errors:string[]=[];
    if(process.env.GITHUB_EVENT_NAME==="pull_request") {
      const oldFallback=previousVersion(`stations/${station}/navmesh-fallback.json`),oldBaseline=previousVersion(`stations/${station}/navmesh-clip-baseline.json`);
      if(oldFallback) {const prior=fallbackDiff(oldFallback as typeof allowed,allowed);if(prior.added.length) errors.push(`fallback list grew from PR base: ${prior.added.join(", ")}`);}
      if(oldBaseline) {const prior=clipBaselineDiff(oldBaseline as typeof baseline,baseline);if(prior.increased.length) errors.push(`clip baseline grew from PR base: ${prior.increased.join(", ")}`);}
      const oldSuspect=previousVersion(`stations/${station}/navmesh-suspect.json`);
      if(oldSuspect) {const prior=fallbackDiff(oldSuspect as typeof suspectAllowed,suspectAllowed);if(prior.added.length) errors.push(`suspect list grew from PR base: ${prior.added.join(", ")}`);}
    }
    if(diff.added.length) errors.push(`unlisted failed edges: ${diff.added.join(", ")}`);
    if(diff.removed.length) errors.push(`remove these from the list: ${diff.removed.join(", ")}`);
    if(diff.duplicateAllowed || diff.duplicateActual || diff.grew) errors.push("duplicate or growing fallback list");
    if(suspectDiff.added.length) errors.push(`unlisted suspect edges: ${suspectDiff.added.join(", ")}`);
    if(suspectDiff.removed.length) errors.push(`remove these from the suspect list: ${suspectDiff.removed.join(", ")}`);
    if(suspectDiff.duplicateAllowed || suspectDiff.duplicateActual) errors.push("duplicate suspect list entries");
    if(!result.audit.routesAudited || !result.audit.completeAuditedRoutes) errors.push("no completed routable routes were audited");
    const clips=clipBaselineDiff(baseline,baselineForAudit(result.audit));
    if(clips.increased.length) errors.push(`clip baseline exceeded: ${clips.increased.join(", ")}`);
    if(clips.lowered.length) errors.push(`lower the baseline for: ${clips.lowered.join(", ")}`);
    const committedPaths=JSON.parse(fs.readFileSync(path.resolve(`stations/${station}/navmesh-paths.json`),"utf8"));
    const pathsDiff=navPathsDiff(committedPaths.edges,result.audit.navPaths);
    const staleKeys=[...pathsDiff.missing,...pathsDiff.extra,...pathsDiff.moved].slice(0,10);
    if(pathsDiff.missing.length+pathsDiff.extra.length+pathsDiff.moved.length) errors.push(`navmesh paths stale (${staleKeys.join(", ")}): run pnpm tsx packages/godot/src/navmesh-fallback.ts --station ${station} --write-paths stations/${station}/navmesh-paths.json`);
    if(JSON.stringify(committedPaths.bake)!==JSON.stringify(NAVMESH_BAKE)) errors.push(`navmesh paths bake header is ${JSON.stringify(committedPaths.bake)}, expected ${JSON.stringify(NAVMESH_BAKE)}: regenerate with --write-paths`);
    const header={version:committedPaths.version,station:committedPaths.station,frame:committedPaths.frame};
    if(header.version!==1 || header.station!==station || header.frame!=="ENU") errors.push(`navmesh paths header is ${JSON.stringify(header)}, expected ${JSON.stringify({version:1,station,frame:"ENU"})}: the app reads these coordinates in that frame`);
    for(const kind of ["navmesh","connector"]) if(segment[kind].noFloor || result.audit.uniqueEdgeScene[kind].noFloor) errors.push(`${kind} has samples without floor`);
    if(result.audit.fallbackAudit.totals.noFloor) errors.push(`fallback has ${result.audit.fallbackAudit.totals.noFloor} samples without floor`);
    expect(errors,errors.join("\n")).toEqual([]);
  },180_000);
});
