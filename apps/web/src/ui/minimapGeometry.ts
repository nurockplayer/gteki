import { nodeDisplayZ } from "@gteki/navigation";
import type { Edge, StationBundle } from "@gteki/schema";
import { FLOOR_BAND_M } from "../explorer/labelVisibility.ts";
import type { ExplorerPose } from "../explorer/explorer.ts";

export type MinimapOrientation = "player-up" | "north-up";
export interface MapPoint { east: number; north: number }
export interface WalkSegment { mode: Edge["mode"]; points: MapPoint[] }

/** Nearest node in 3D within the display-height floor band; ties keep bundle order. */
export function currentFloorId(bundle: StationBundle, up: number, east: number, north: number): string | null {
  const floors = new Map(bundle.floors.map((floor) => [floor.id, floor]));
  let best = Infinity, floorId: string | null = null;
  for (const node of bundle.nodes) {
    const dz = nodeDisplayZ(node, floors.get(node.floorId)).z - up;
    if (Math.abs(dz) > FLOOR_BAND_M) continue;
    const distance = (node.position.x - east) ** 2 + (node.position.y - north) ** 2 + dz ** 2;
    if (distance < best) { best = distance; floorId = node.floorId; }
  }
  return floorId;
}

/** Evidenced centreline geometry only: no widths, footprints or cross-floor connectors. */
export function floorWalkGraph(bundle: StationBundle, floorId: string): WalkSegment[] {
  const nodes = new Map(bundle.nodes.map((node) => [node.id, node]));
  const segments: WalkSegment[] = [];
  for (const edge of bundle.edges) {
    const from = nodes.get(edge.from), to = nodes.get(edge.to);
    if (!from || !to || from.floorId !== floorId || to.floorId !== floorId || edge.mode === "elevator") continue;
    // Same normalisation as edgePoints(): a polyline needs ≥2 points, and its ends are the nodes.
    const raw = edge.geometry && edge.geometry.length >= 2 ? edge.geometry : [from.position, to.position];
    const points = raw.map((p, i) => ({
      east: i === 0 ? from.position.x : i === raw.length - 1 ? to.position.x : p.x,
      north: i === 0 ? from.position.y : i === raw.length - 1 ? to.position.y : p.y,
    }));
    segments.push({ mode: edge.mode, points });
  }
  return segments;
}

/** ENU to centre-relative SVG pixels (screen y down), using the body's heading. */
export function toMinimap(east: number, north: number, pose: ExplorerPose, orientation: MinimapOrientation, metresPerPx: number): { x: number; y: number } {
  const angle = orientation === "player-up" ? pose.headingDeg * Math.PI / 180 : 0;
  const de = (east - pose.east) / metresPerPx, dn = (north - pose.north) / metresPerPx;
  return { x: de * Math.cos(angle) - dn * Math.sin(angle), y: -de * Math.sin(angle) - dn * Math.cos(angle) };
}

export function arrowRotationDeg(pose: ExplorerPose, orientation: MinimapOrientation): number {
  return orientation === "player-up" ? 0 : pose.headingDeg;
}
