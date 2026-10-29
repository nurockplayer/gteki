import { auditPolyline, type SceneProbe } from "./route-clip-audit.ts";
import type { PolylinePoint } from "@gteki/navigation";

/** Check every used fallback segment independently, including its endpoints. */
export function auditFallbackSegments(probe:SceneProbe, segments:readonly {edgeId:string;points:readonly PolylinePoint[]}[]) {
  const totals={segments:0,samples:0,offFloor:0,noFloor:0,wallHits:0};
  const failed:string[]=[];
  for (const segment of segments) {
    const result=auditPolyline(probe,segment.points);
    totals.segments++; totals.samples+=result.samples; totals.offFloor+=result.offFloor; totals.noFloor+=result.noFloor; totals.wallHits+=result.wallHits;
    if (result.offFloor || result.noFloor || result.wallHits) failed.push(segment.edgeId);
  }
  return {totals,failed:[...new Set(failed)].sort()};
}

/** Gate only explicit fallback entries and the audited navmesh segments. */
export function fallbackGate(input:{fallback:{failed:readonly string[]}; unlisted:readonly string[]; navmesh:{offFloor:number;noFloor:number;wallHits:number}; incompleteRoutes:number}) {
  return {ok:input.incompleteRoutes===0 && input.fallback.failed.length===0 && input.unlisted.length===0 && input.navmesh.offFloor===0 && input.navmesh.noFloor===0 && input.navmesh.wallHits===0, clippedFallbacks:[...input.fallback.failed], unlisted:[...new Set(input.unlisted)].sort(), navmesh:input.navmesh,incompleteRoutes:input.incompleteRoutes};
}
