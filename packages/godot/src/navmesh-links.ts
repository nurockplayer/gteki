import type { NavMeshQuery, OffMeshConnectionParams } from "recast-navigation";
import { auditPolyline, type SceneProbe, type SampleDetail } from "./route-clip-audit.ts";

type Point = { x: number; y: number; z: number };
type VerticalEdge = { id: string; mode: string; from: string; to: string; direction: "both" | "forward" };

/** A snap must land on a scene floor and the node-to-snap segment must not cross a wall. */
export function validateLinkSnap(probe: SceneProbe, node: Point, snapped: Point): "floor" | "wall" | null {
  const p = (v: Point) => ({ x:v.x, y:-v.z, z:v.y, zKnown:true, floorId:"", stepIndex:0 });
  const detail: SampleDetail[] = [];
  auditPolyline(probe, [p(snapped)], { detail });
  const floor = detail[0]?.floorZ;
  if (floor === undefined || Math.abs(floor-snapped.y) > 0.6) return "floor";
  if (auditPolyline(probe, [p(node),p(snapped)], { alreadySampled:true }).wallHits) return "wall";
  const approach=auditPolyline(probe,[p(node),p(snapped)]);
  if (approach.noFloor || approach.offFloor) return "floor";
  // Include intersections at a wall segment's endpoint, which the route checker deliberately excludes.
  const a=p(node), b=p(snapped), dx=b.x-a.x, dy=b.y-a.y;
  for (const w of probe.walls) {
    const wx=w.b.x-w.a.x, wy=w.b.y-w.a.y, d=dx*wy-dy*wx;
    if (Math.abs(d)<1e-10) continue;
    const ox=w.a.x-a.x, oy=w.a.y-a.y, t=(ox*wy-oy*wx)/d, u=(ox*dy-oy*dx)/d;
    const z=a.z+(b.z-a.z)*t;
    if (t>0 && t<1 && u>=0 && u<=1 && w.zMax>z+0.5 && w.zMin<z+1.5) return "wall";
  }
  return null;
}

/** Build candidates from edges already filtered by the caller for graph traversability.
 * A candidate still needs post-bake verification that Detour attached its user ID. */
export function verticalLinkCandidates(edges: readonly VerticalEdge[], nodePoint: (id: string) => Point | undefined, query: Pick<NavMeshQuery, "findClosestPoint">, validateSnap: (nodeId: string, node: Point, snapped: Point) => boolean) {
  const candidates: { edgeId: string; connection: OffMeshConnectionParams }[] = [];
  const failed: { edgeId: string; reason: "missing_node" | "snap_failed" | "unsafe_snap" }[] = [];
  let snapFailures = 0;
  const vertical = edges.filter(e => ["stairs", "escalator", "elevator"].includes(e.mode)).slice().sort((a, b) => a.id.localeCompare(b.id));
  const snap = (point: Point) => {
    const result = query.findClosestPoint(point, { halfExtents: { x: 1.5, y: 0.6, z: 1.5 } });
    return result.success && result.polyRef && Math.abs(result.point.y - point.y) <= 0.6 ? result.point : null;
  };
  vertical.forEach((edge, index) => {
    const from = nodePoint(edge.from), to = nodePoint(edge.to);
    if (!from || !to) { failed.push({ edgeId: edge.id, reason: "missing_node" }); return; }
    const start = snap(from), end = snap(to);
    if (!start || !end) { snapFailures += Number(!start) + Number(!end); failed.push({ edgeId: edge.id, reason: "snap_failed" }); return; }
    const startValid=validateSnap(edge.from, from, start), endValid=validateSnap(edge.to, to, end);
    if (!startValid || !endValid) { failed.push({ edgeId: edge.id, reason: "unsafe_snap" }); return; }
    candidates.push({ edgeId: edge.id, connection: { startPosition: start, endPosition: end, radius: 0.3, bidirectional: edge.direction === "both", area: 0, flags: 1, userId: index + 1 } });
  });
  return { candidates, failed, snapFailures };
}
