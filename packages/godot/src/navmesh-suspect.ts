/**
 * Vertical graph edges whose display heights cannot be built. A suspect edge gets no off-mesh link in the bake,
 * and the audit routes its step along the graph polyline without counting its samples as clips.
 */
import * as THREE from "three";
import { enuToRenderer } from "@gteki/geo";
import { nodeDisplayZ } from "@gteki/navigation";
import type { Edge, StationBundle } from "@gteki/schema";
import { castAll } from "../../../apps/web/src/explorer/raycast.ts";

export type SuspectEdge = { edgeId: string; mode: string; reason: "display_height_approx" | "slope" | "end_height"; detail: string };
/** ENU metres, z up. Returns the walkable surface height nearest to z within ±1.5 m, or null. */
export type FloorHeightNear = (x: number, y: number, z: number) => number | null;

const VERTICAL = new Set(["stairs", "escalator", "elevator"]);
const SLOPE_LIMIT = 1, END_HEIGHT_LIMIT_M = 0.3, REACH_M = 1.5;

/** Ray-test the walkable set straight down from z+1.5 m and straight up from z-1.5 m; keep the hit nearer z. */
export function makeFloorHeightNear(probe: { ground: readonly THREE.Object3D[] }): FloorHeightNear {
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
  return (x, y, z) => {
    const [ax, ay, az] = enuToRenderer({ x, y, z: z + REACH_M });
    ray.set(new THREE.Vector3(ax, ay, az), down); ray.far = 2 * REACH_M;
    const above = castAll(ray, probe.ground)[0]?.point.y ?? null;
    const [bx, by, bz] = enuToRenderer({ x, y, z: z - REACH_M });
    ray.set(new THREE.Vector3(bx, by, bz), up); ray.far = 2 * REACH_M;
    const below = castAll(ray, probe.ground)[0]?.point.y ?? null;
    // Renderer y is ENU z, so the hit heights compare directly with z.
    const candidates = [above, below].filter((h): h is number => h !== null);
    if (!candidates.length) return null;
    return candidates.reduce((best, h) => Math.abs(h - z) < Math.abs(best - z) ? h : best);
  };
}

/** Traversable vertical edges (stairs, escalator, elevator) whose heights cannot be built, sorted by edge id. */
export function suspectVerticalEdges(bundle: StationBundle, floorHeightNear: FloorHeightNear, traversable: (edge: Edge) => boolean): SuspectEdge[] {
  const nodes = new Map(bundle.nodes.map(n => [n.id, n])), floors = new Map(bundle.floors.map(f => [f.id, f]));
  const out: SuspectEdge[] = [];
  for (const edge of bundle.edges) {
    if (!VERTICAL.has(edge.mode) || !traversable(edge)) continue;
    const a = nodes.get(edge.from), b = nodes.get(edge.to);
    if (!a || !b) continue;
    const za = nodeDisplayZ(a, floors.get(a.floorId)).z, zb = nodeDisplayZ(b, floors.get(b.floorId)).z;
    const details: string[] = [];
    let slope = false;
    if (edge.mode === "stairs" || edge.mode === "escalator") {
      const rise = zb - za;
      const line = edge.geometry?.length ? edge.geometry : [a.position, b.position];
      const plan = line.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - line[i]!.x, p.y - line[i]!.y), 0);
      const ratio = plan > 0 ? Math.abs(rise) / plan : rise !== 0 ? Infinity : 0;
      if (ratio > SLOPE_LIMIT) {
        slope = true;
        details.push(`rise ${rise.toFixed(2)} m over plan ${plan.toFixed(2)} m (slope ${ratio.toFixed(2)})`);
      }
    }
    for (const [label, node, z] of [["from", a, za], ["to", b, zb]] as const) {
      const floor = floorHeightNear(node.position.x, node.position.y, z);
      if (floor !== null && Math.abs(floor - z) > END_HEIGHT_LIMIT_M) details.push(`${label} end ${z.toFixed(2)} m vs floor ${floor.toFixed(2)} m`);
    }
    // The importer flags edges whose display heights it could not model (#644): the committed source of truth.
    const approx = edge.attributes?.displayHeightApprox === true;
    if (approx) details.unshift("attributes.displayHeightApprox");
    if (!details.length) continue;
    out.push({ edgeId: edge.id, mode: edge.mode, reason: approx ? "display_height_approx" : slope ? "slope" : "end_height", detail: details.join("; ") });
  }
  return out.sort((x, y) => x.edgeId.localeCompare(y.edgeId));
}
