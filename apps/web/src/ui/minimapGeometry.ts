import { nodeDisplayZ } from "@gteki/navigation";
import type { PolylinePoint, RouteStep } from "@gteki/navigation";
import type { Edge, Poi, StationBundle } from "@gteki/schema";
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

/**
 * The route's own line, cut into the runs that stay on one floor: a run needs two consecutive points on
 * `floorId`, so a route that leaves and re-enters the floor yields separate runs (never a line across a level).
 */
export function routeOnFloor(points: readonly PolylinePoint[], floorId: string): Array<Array<{ x: number; y: number }>> {
  const runs: Array<Array<{ x: number; y: number }>> = [];
  let run: Array<{ x: number; y: number }> | null = null;
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    if (point.floorId !== floorId) {
      if (run && run.length >= 2) runs.push(run);
      run = null;
      continue;
    }
    if (run === null) {
      const previous = i > 0 ? points[i - 1]! : null;
      run = previous && previous.floorId === floorId ? [{ x: previous.x, y: previous.y }] : [];
    }
    run.push({ x: point.x, y: point.y });
  }
  if (run && run.length >= 2) runs.push(run);
  return runs;
}

/**
 * The first step that takes the route off `floorId`, and where on this floor it starts. A same-floor
 * stair/escalator is not a floor change. The start point is the last polyline point the previous step
 * ends at (the start point itself when step 0 leaves the floor).
 */
export function nextFloorChange(
  points: readonly PolylinePoint[],
  steps: readonly RouteStep[],
  floorId: string,
): { x: number; y: number; mode: RouteStep["mode"]; toFloorId: string } | null {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (step.fromFloorId !== floorId || step.toFloorId === floorId) continue;
    let start: { x: number; y: number } | null = null;
    if (i === 0) {
      start = points[0] ? { x: points[0].x, y: points[0].y } : null;
    } else {
      for (let j = points.length - 1; j >= 0; j--) {
        if (points[j]!.stepIndex === i - 1) { start = { x: points[j]!.x, y: points[j]!.y }; break; }
      }
    }
    return start ? { ...start, mode: step.mode, toFloorId: step.toFloorId } : null;
  }
  return null;
}

/** Room kept between a point and the rim for its marker, in viewBox units. */
export const RIM_MARGIN_PX = 8;

/**
 * A toMinimap result's place on the minimap: inside the circle (with a marker margin) or its screen
 * bearing for a rim chevron — 0° is up and angles grow clockwise, matching SVG's rotate().
 */
export function rimBearing(px: { x: number; y: number }, radiusPx: number): { inside: boolean; angleDeg: number } {
  // atan2(0, -0) is π, not 0: a point at the centre has no bearing, and up is the harmless default.
  const raw = px.x === 0 && px.y === 0 ? 0 : Math.atan2(px.x, -px.y) * 180 / Math.PI;
  return {
    inside: Math.hypot(px.x, px.y) <= radiusPx - RIM_MARGIN_PX,
    angleDeg: ((raw % 360) + 360) % 360,
  };
}

/**
 * POIs the map may draw on a floor: a recorded display position on that floor AND a verified connector
 * (a routable entrance). A centroid without a connector, a null position or a null floor is search-only
 * evidence and gets no point.
 */
export function floorPois(bundle: StationBundle, floorId: string): Poi[] {
  return bundle.pois.filter((poi) => poi.displayPosition !== null && poi.floorId === floorId && poi.connectorNodeIds.length > 0);
}
