import type { Edge, StationBundle } from "@gteki/schema";
import { edgePoints, type V3 } from "./geometry.ts";

/** An edge's floorless samples, extended into the adjacent modelled floor. */
export interface UnmodelledEdgeRun {
  edge: Edge;
  points: V3[];
}

/** Find passage candidates without changing the station or retaining its geometry on disk. */
export function unmodelledRunsByEdge(bundle: StationBundle, traversable: (edge: Edge) => boolean, hasFloor: (p: V3) => boolean): UnmodelledEdgeRun[] {
  const nodes = new Map(bundle.nodes.map((node) => [node.id, node]));
  const floors = new Map(bundle.floors.map((floor) => [floor.id, floor]));
  const out: UnmodelledEdgeRun[] = [];
  for (const edge of bundle.edges) {
    if (!traversable(edge) || !["walk", "gate", "moving_walkway", "ramp"].includes(edge.mode)) continue;
    const points = edgePoints(bundle, edge, nodes, floors).map((p) => ({ x: p.x, y: -p.z, z: p.y }));
    if (points.length < 2) continue;
    const samples: V3[] = [points[0]!];
    const distances = [0];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      const count = Math.max(1, Math.ceil(length / 0.5));
      const start = distances.at(-1)!;
      for (let k = 1; k <= count; k++) {
        samples.push({ x: a.x + (b.x - a.x) * k / count, y: a.y + (b.y - a.y) * k / count, z: a.z + (b.z - a.z) * k / count });
        distances.push(start + length * k / count);
      }
    }
    const pointAt = (distance: number): V3 => {
      let k = 1;
      while (k < distances.length - 1 && distances[k]! < distance) k++;
      const a = samples[k - 1]!, b = samples[k]!;
      const span = distances[k]! - distances[k - 1]!;
      const t = span ? (distance - distances[k - 1]!) / span : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    };
    const bare = samples.map((p) => edge.attributes?.sceneGap === true || !hasFloor(p));
    for (let i = 0; i < samples.length; i++) {
      if (!bare[i]) continue;
      let end = i;
      while (end + 1 < samples.length && bare[end + 1]) end++;
      const length = distances[end]! - distances[i]!;
      if (length >= 1 || edge.attributes?.sceneGap === true) {
        const start = Math.max(0, distances[i]! - 0.5);
        const finish = Math.min(distances.at(-1)!, distances[end]! + 0.5);
        const inside = samples.filter((_p, k) => distances[k]! > start && distances[k]! < finish);
        out.push({ edge, points: [pointAt(start), ...inside, pointAt(finish)] });
      }
      i = end;
    }
  }
  return out;
}
