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
 * The route's own line, cut into the runs that stay on one floor. A pair of consecutive points is drawn
 * only when both are on `floorId` AND the step ending at the second point stays on one floor: the drawn
 * geometry of a stair/escalator/elevator is never flattened into a corridor. No points are synthesised.
 */
export function routeOnFloor(points: readonly PolylinePoint[], floorId: string, steps: readonly RouteStep[]): Array<Array<{ x: number; y: number }>> {
  const runs: Array<Array<{ x: number; y: number }>> = [];
  let run: Array<{ x: number; y: number }> | null = null;
  const flush = () => {
    if (run && run.length >= 2) runs.push(run);
    run = null;
  };
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    if (point.floorId !== floorId) { flush(); continue; }
    const previous = i > 0 ? points[i - 1]! : null;
    const step = point.stepIndex >= 0 ? steps[point.stepIndex] : undefined;
    // No step for the vertex that ends this segment: it may be a stair, so drop the segment rather
    // than flatten it onto the floor. Missing evidence is never filled in by a guess.
    const missingStep = point.stepIndex >= 0 && !step;
    const leavesFloor = !!step && step.fromFloorId !== step.toFloorId;
    if (!previous || previous.floorId !== floorId || missingStep || leavesFloor) {
      flush();
      run = [{ x: point.x, y: point.y }];
      continue;
    }
    if (run === null) run = [{ x: previous.x, y: previous.y }];
    run.push({ x: point.x, y: point.y });
  }
  flush();
  return runs;
}

/** A step that changes floor, with the point on the floor it leaves where the change begins. */
export interface FloorTransition {
  stepIndex: number;
  /** Polyline index of the point the change starts from. */
  startIndex: number;
  fromFloorId: string;
  toFloorId: string;
  mode: RouteStep["mode"];
  x: number;
  y: number;
}

/**
 * Every floor-changing step of the route (computed once per route, not per frame). A step whose start
 * point has no polyline evidence is dropped rather than given a made-up position.
 */
export function floorTransitions(points: readonly PolylinePoint[], steps: readonly RouteStep[]): FloorTransition[] {
  const transitions: FloorTransition[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (step.fromFloorId === step.toFloorId) continue;
    let start: { index: number; x: number; y: number } | null = null;
    if (i === 0) {
      start = points[0] ? { index: 0, x: points[0].x, y: points[0].y } : null;
    } else {
      for (let j = points.length - 1; j >= 0; j--) {
        if (points[j]!.stepIndex === i - 1) { start = { index: j, x: points[j]!.x, y: points[j]!.y }; break; }
      }
    }
    if (start) transitions.push({ stepIndex: i, startIndex: start.index, fromFloorId: step.fromFloorId, toFloorId: step.toFloorId, mode: step.mode, x: start.x, y: start.y });
  }
  return transitions;
}

/** How close to a drawn segment the player must be for progress to move onto it, in metres. */
export const ON_ROUTE_M = 3;

function segmentDistance(points: readonly PolylinePoint[], seg: number, east: number, north: number): number {
  const a = points[seg]!, b = points[seg + 1]!;
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((east - a.x) * dx + (north - a.y) * dy) / lengthSq));
  return Math.hypot(east - (a.x + t * dx), north - (a.y + t * dy));
}

/** Whether routeOnFloor would draw segment `seg`: both ends on the floor, with a known same-floor step. */
function drawnOnFloor(points: readonly PolylinePoint[], steps: readonly RouteStep[], floorId: string, seg: number): boolean {
  const a = points[seg], b = points[seg + 1];
  if (!a || !b || a.floorId !== floorId || b.floorId !== floorId) return false;
  const step = b.stepIndex >= 0 ? steps[b.stepIndex] : undefined;
  if (b.stepIndex >= 0 && !step) return false;
  return !step || step.fromFloorId === step.toFloorId;
}

/**
 * Walk forward inside one same-floor run: segments are considered only up to the next floor-changing
 * (or unproven) step, and the first one within `ON_ROUTE_M` wins — earliest, never nearest, so two
 * visits to the same coordinates keep the earlier one. Off the route, progress does not move at all.
 */
function forwardOnFloor(
  points: readonly PolylinePoint[],
  steps: readonly RouteStep[],
  floorId: string,
  east: number,
  north: number,
  seg: number,
): number {
  for (let candidate = seg; candidate < points.length - 1; candidate++) {
    if (!drawnOnFloor(points, steps, floorId, candidate)) break;
    if (segmentDistance(points, candidate, east, north) <= ON_ROUTE_M) return candidate;
  }
  return seg;
}

/**
 * After currentFloorId becomes `floorId`: the first segment past the cross-floor step that lands
 * there, taken only when the player is at that step's own connector. Steps whose start is already
 * behind `seg` cannot be it; a floor the route never reaches after this point leaves progress
 * untouched.
 */
function segAfterFloorChange(
  points: readonly PolylinePoint[],
  steps: readonly RouteStep[],
  floorId: string,
  seg: number,
  east: number,
  north: number,
): number {
  for (const transition of floorTransitions(points, steps)) {
    if (transition.toFloorId !== floorId || transition.startIndex < seg) continue;
    // A reading that flickers back near an earlier connector must not skip the route to a later
    // one: the step only counts where the player actually stands at it.
    if (Math.hypot(east - transition.x, north - transition.y) > ON_ROUTE_M) continue;
    // The step's own end is the last vertex carrying its index: the target floor's landing point.
    let endIndex = -1;
    for (let j = points.length - 1; j > transition.startIndex; j--) {
      if (points[j]!.stepIndex === transition.stepIndex) { endIndex = j; break; }
    }
    if (endIndex < 0 || points[endIndex]!.floorId !== floorId) continue;
    return Math.min(endIndex, points.length - 2);
  }
  return seg;
}

/**
 * Forward-only route progress, as the index of the polyline segment the player is on (segment `seg`
 * runs from point `seg` to point `seg + 1`). Within a same-floor run it advances to the first drawn
 * segment within `ON_ROUTE_M`; a floor change may only cross through a floor-changing step that lands
 * on the new floor. There is no backward move: without a new route, progress never decreases.
 */
export function advanceRouteSeg(
  points: readonly PolylinePoint[],
  steps: readonly RouteStep[],
  floorId: string,
  east: number,
  north: number,
  seg: number,
  floorChanged: boolean,
): number {
  if (points.length < 2) return 0;
  const current = Math.max(0, Math.min(seg, points.length - 2));
  const base = floorChanged ? segAfterFloorChange(points, steps, floorId, current, east, north) : current;
  return forwardOnFloor(points, steps, floorId, east, north, base);
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
