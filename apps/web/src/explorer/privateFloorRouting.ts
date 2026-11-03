import type { Edge, StationBundle } from "@gteki/schema";
import { edgePoints } from "./geometry.ts";
import { privateHolePlanes, type PolygonRegion } from "./privateLevels.ts";
import { outsideIntervals } from "./walkableModel.ts";

/** Private overlay only: close paths with a flat segment inside an explicit hole, retaining a QA reason. */
export function privateFloorRoutingEdges(graph: Pick<StationBundle, "nodes" | "edges" | "floors">, regions: readonly PolygonRegion[]): Edge[] {
  if (!regions.length) return graph.edges;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const floors = new Map(graph.floors.map((floor) => [floor.id, floor]));
  const planes = privateHolePlanes(regions);
  return graph.edges.map((edge) => {
    const levels = new Set([nodes.get(edge.from)?.floorId, nodes.get(edge.to)?.floorId]);
    const candidates = planes.filter((plane) => levels.has(plane.level));
    if (!candidates.length) return edge;
    const path = edgePoints(graph, edge, nodes, floors);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!, b = path[i]!;
      if (Math.abs(a.y - b.y) >= 1e-6 || Math.hypot(a.x - b.x, a.z - b.z) < 1e-9) continue;
      const selected = candidates.filter((plane) => Math.abs(plane.y - a.y) < 1e-6);
      const kept = outsideIntervals(a, b, selected.flatMap((plane) => plane.triangles));
      if (kept.length !== 1 || kept[0]![0] > 1e-9 || kept[0]![1] < 1 - 1e-9) {
        return { ...edge, closed: true, attributes: { ...edge.attributes, privateFloorBlockedReason: "explicit-private-hole" } };
      }
    }
    return edge;
  });
}
