type Point = { x:number; y:number; z:number; suspectPolyline?:boolean; sceneGap?:boolean };
type Step = { edgeId:string; reversed:boolean };

/** Stable key for a directed pair of baked steps. */
export function snapJoinKey(from:Step, to:Step): string {
  const key = (s:Step) => `${s.edgeId}:${s.reversed ? "reverse" : "forward"}`;
  return `${key(from)}>${key(to)}`;
}

/** Shared guide assembly: canonical navmesh snaps, with explicitly unvalidated suspect graph steps. */
export function assembleSnapPath<P extends Point>(steps:readonly (readonly P[] | null)[], join:(from:P,to:P,stepIndex:number)=>readonly P[] | null, snap:(point:P)=>P|null = point=>point):
  { points:P[]; reason:null } | { points:null; reason:"snap_failed"|"join_gap" } {
  const points:P[] = [];
  const same = (a:Point,b:Point) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z) < 1e-6;
  for (const [i, source] of steps.entries()) {
    if (!source?.length) return { points:null, reason:"snap_failed" };
    const step=[...source];
    const start=source[0]!.suspectPolyline ? source[0]! : snap(source[0]!);
    const end=source.at(-1)!.suspectPolyline ? source.at(-1)! : snap(source.at(-1)!);
    if (!start || !end) return {points:null,reason:"snap_failed"};
    step[0]=start; step[step.length-1]=end;
    const last = points.at(-1), first = step[0]!;
    if (last && !same(last, first) && (last.suspectPolyline || first.suspectPolyline)) {
      points.push({...first,suspectPolyline:true,sceneGap:true});
    } else if (last && !same(last, first)) {
      const bridge = join(last, first, i);
      if (!bridge?.length || !same(bridge[0]!, last) || !same(bridge.at(-1)!, first)) return { points:null, reason:"join_gap" };
      points.push(...bridge.slice(1));
    }
    points.push(...step.slice(last ? 1 : 0));
  }
  return { points, reason:null };
}
