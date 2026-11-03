import type { Edge, StationBundle } from "@gteki/schema";
import { edgePoints } from "./geometry.ts";
import { privateHolePlanes, type PolygonRegion } from "./privateLevels.ts";
import { floorExclusionCuts, outsideIntervals } from "./walkableModel.ts";

/** Private overlay only: close paths on a private floor inside an explicit hole, retaining a QA reason. */
export function privateFloorRoutingEdges(graph: Pick<StationBundle, "nodes" | "edges" | "floors">, regions: readonly PolygonRegion[]): Edge[] {
  if (!regions.length) return graph.edges;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const floors = new Map(graph.floors.map((floor) => [floor.id, floor]));
  const planes = privateHolePlanes(regions);
  return graph.edges.map((edge) => {
    const levels = [nodes.get(edge.from)?.floorId ?? "", nodes.get(edge.to)?.floorId ?? ""];
    const path = edgePoints(graph, edge, nodes, floors);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!, b = path[i]!;
      const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
      if (length2 < 1e-18) continue;
      const height = (p: { x: number; z: number }) => a.y + (b.y - a.y) * ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2;
      const kept = outsideIntervals(a, b, planes.flatMap((plane) => floorExclusionCuts(plane, levels, height)));
      if (kept.length !== 1 || kept[0]![0] > 1e-9 || kept[0]![1] < 1 - 1e-9) {
        return { ...edge, closed: true, attributes: { ...edge.attributes, privateFloorBlockedReason: "explicit-private-hole" } };
      }
    }
    return edge;
  });
}
