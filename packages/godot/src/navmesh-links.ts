import type { NavMeshQuery, OffMeshConnectionParams } from "recast-navigation";

type Point = { x: number; y: number; z: number };
type VerticalEdge = { id: string; mode: string; from: string; to: string; direction: "both" | "forward" };

/** Build candidates from edges already filtered by the caller for graph traversability.
 * A candidate still needs post-bake verification that Detour attached its user ID. */
export function verticalLinkCandidates(edges: readonly VerticalEdge[], nodePoint: (id: string) => Point | undefined, query: Pick<NavMeshQuery, "findClosestPoint">, validateSnap: (nodeId: string, node: Point, snapped: Point) => boolean) {
  const candidates: { edgeId: string; connection: OffMeshConnectionParams }[] = [];
  const failed: { edgeId: string; reason: "missing_node" | "snap_failed" | "unsafe_snap" }[] = [];
  const vertical = edges.filter(e => ["stairs", "escalator", "elevator"].includes(e.mode)).slice().sort((a, b) => a.id.localeCompare(b.id));
  const snap = (point: Point) => {
    const result = query.findClosestPoint(point, { halfExtents: { x: 1.5, y: 0.6, z: 1.5 } });
    return result.success && result.polyRef && Math.abs(result.point.y - point.y) <= 0.6 ? result.point : null;
  };
  vertical.forEach((edge, index) => {
    const from = nodePoint(edge.from), to = nodePoint(edge.to);
    if (!from || !to) { failed.push({ edgeId: edge.id, reason: "missing_node" }); return; }
    const start = snap(from), end = snap(to);
    if (!start || !end) { failed.push({ edgeId: edge.id, reason: "snap_failed" }); return; }
    if (!validateSnap(edge.from, from, start) || !validateSnap(edge.to, to, end)) { failed.push({ edgeId: edge.id, reason: "unsafe_snap" }); return; }
    candidates.push({ edgeId: edge.id, connection: { startPosition: start, endPosition: end, radius: 0.3, bidirectional: edge.direction === "both", area: 0, flags: 1, userId: index + 1 } });
  });
  return { candidates, failed };
}
