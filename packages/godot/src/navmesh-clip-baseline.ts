export const clipFields=["connectorWallHits","fallbackWallHits","navmeshWallHits","offFloor"] as const;
type Field=typeof clipFields[number];
export type ClipCounts=Record<Field,number>;
type Coverage={unvalidatedJoins:number;invalidJoins:number;routablePairs:number;failedRoutePairs:number;suspectPolyline:number;suspectPolylineEdges:number};
export type ClipBaseline=Record<string,ClipCounts | (ClipCounts & Coverage)> & {total:ClipCounts & Coverage};
const zero=():ClipCounts=>({connectorWallHits:0,fallbackWallHits:0,navmeshWallHits:0,offFloor:0});

/** Construct a sorted baseline; zero-valued edges do not occupy the list. */
export function makeClipBaseline(counts:Record<string,ClipCounts>,unvalidatedJoins:number,coverage:{invalidJoins:number;routablePairs:number;failedRoutePairs:number;suspectPolyline?:number;suspectPolylineEdges?:number}={invalidJoins:0,routablePairs:0,failedRoutePairs:0}):ClipBaseline {
  const total={...zero(),unvalidatedJoins,suspectPolyline:coverage.suspectPolyline ?? 0,suspectPolylineEdges:coverage.suspectPolylineEdges ?? 0,...coverage};
  const result:Record<string,ClipCounts | typeof total>={};
  for(const id of Object.keys(counts).sort()) {
    if(id==="total") throw new Error("reserved baseline edge id");
    const count=counts[id]!;
    for(const f of clipFields) {if(!Number.isSafeInteger(count[f]) || count[f]<0) throw new Error("invalid clip count");total[f]+=count[f];}
    if(clipFields.some(f=>count[f])) result[id]={...count};
  }
  for(const value of [unvalidatedJoins,coverage.invalidJoins,coverage.routablePairs,coverage.failedRoutePairs,total.suspectPolyline,total.suspectPolylineEdges]) if(!Number.isSafeInteger(value) || value<0) throw new Error("invalid coverage count");
  return {...result,total} as ClipBaseline;
}

export function baselineForAudit(audit:{clipCounts:Record<string,ClipCounts>;incompleteRoutes:number;invalidJoinRoutes:number;routesAudited:number;failedRoutePairs:number;suspectPolyline?:{routes:number;edges:number}}) {
  return makeClipBaseline(audit.clipCounts,audit.incompleteRoutes,{invalidJoins:audit.invalidJoinRoutes,routablePairs:audit.routesAudited,failedRoutePairs:audit.failedRoutePairs,suspectPolyline:audit.suspectPolyline?.routes ?? 0,suspectPolylineEdges:audit.suspectPolyline?.edges ?? 0});
}

/** Every field must match: a decrease requires committing the smaller baseline. */
export function clipBaselineDiff(baseline:ClipBaseline,actual:ClipBaseline) {
  const increased:string[]=[],lowered:string[]=[];
  for(const [label,value] of [["baseline",baseline],["actual",actual]] as const) {
    if(!value?.total) throw new Error(`invalid ${label} total`);
    for(const f of clipFields) {
      const sum=Object.entries(value).filter(([id])=>id!=="total").reduce((n,[,entry])=>n+entry[f],0);
      if(sum!==value.total[f]) throw new Error(`inconsistent ${label} total: ${f}`);
    }
  }
  const keys=new Set([...Object.keys(baseline),...Object.keys(actual)]);
  for(const id of [...keys].sort()) {
    const expected=baseline[id] ?? zero(), observed=actual[id] ?? zero();
    for(const f of clipFields) {
      const a=expected[f],b=observed[f];
      if(!Number.isSafeInteger(a) || a<0 || !Number.isSafeInteger(b) || b<0) throw new Error(`invalid baseline: ${id}.${f}`);
      if(b>a) increased.push(`${id}.${f} (${a} → ${b})`);
      if(b<a) lowered.push(`${id}.${f} (${a} → ${b})`);
    }
  }
  for(const [label,value] of [["baseline",baseline.total?.unvalidatedJoins],["actual",actual.total?.unvalidatedJoins]] as const) if(!Number.isSafeInteger(value) || value!<0) throw new Error(`invalid ${label} join count`);
  if(actual.total.unvalidatedJoins>baseline.total.unvalidatedJoins) increased.push(`total.unvalidatedJoins (${baseline.total.unvalidatedJoins} → ${actual.total.unvalidatedJoins})`);
  if(actual.total.unvalidatedJoins<baseline.total.unvalidatedJoins) lowered.push(`total.unvalidatedJoins (${baseline.total.unvalidatedJoins} → ${actual.total.unvalidatedJoins})`);
  for(const field of ["invalidJoins","routablePairs","failedRoutePairs"] as const) {
    const a=baseline.total[field],b=actual.total[field];if(!Number.isSafeInteger(a) || a<0 || !Number.isSafeInteger(b) || b<0) throw new Error(`invalid coverage: ${field}`);
    if(field==="routablePairs" ? b<a : b>a) increased.push(`total.${field} (${a} → ${b})`);
  }
  // Ruling C introduces these counters once; every persisted value then ratchets down.
  for(const field of ["suspectPolyline","suspectPolylineEdges"] as const) {
    const a=baseline.total[field],b=actual.total[field];
    if(a===undefined && b===undefined) continue;
    if(!Number.isSafeInteger(b) || b<0 || (a!==undefined && (!Number.isSafeInteger(a) || a<0))) throw new Error(`invalid coverage: ${field}`);
    if(a!==undefined) { if(b>a) increased.push(`total.${field} (${a} → ${b})`); if(b<a) lowered.push(`total.${field} (${a} → ${b})`); }
  }
  return {increased,lowered};
}
