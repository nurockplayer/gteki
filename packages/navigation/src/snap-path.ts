type Point = { x:number; y:number; z:number };
type Step = { edgeId:string; reversed:boolean };

/** Stable key for a directed pair of baked steps. */
export function snapJoinKey(from:Step, to:Step): string {
  const key = (s:Step) => `${s.edgeId}:${s.reversed ? "reverse" : "forward"}`;
  return `${key(from)}>${key(to)}`;
}

/** Audit and runtime use the same assembly; only a navmesh path may fill a snap gap. */
export function assembleSnapPath<P extends Point>(steps:readonly (readonly P[] | null)[], join:(from:P,to:P,stepIndex:number)=>readonly P[] | null):
  { points:P[]; reason:null } | { points:null; reason:"snap_failed"|"join_gap" } {
  const points:P[] = [];
  const same = (a:Point,b:Point) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z) < 1e-6;
  for (const [i, step] of steps.entries()) {
    if (!step?.length) return { points:null, reason:"snap_failed" };
    const last = points.at(-1), first = step[0]!;
    if (last && !same(last, first)) {
      const bridge = join(last, first, i);
      if (!bridge?.length || !same(bridge[0]!, last) || !same(bridge.at(-1)!, first)) return { points:null, reason:"join_gap" };
      points.push(...bridge.slice(1));
    }
    points.push(...step.slice(last ? 1 : 0));
  }
  return { points, reason:null };
}
