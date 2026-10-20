import type { Edge, EdgeMode, LocalTime, StationBundle } from "@gteki/schema";

/**
 * Renderer-neutral router over the verified directed station graph.
 * Truth rules: only `verified` edges (plus `synthetic` in synthetic bundles) are traversable;
 * UNKNOWN facts never silently become permissive when a profile asks to avoid them.
 */

export type FarePolicy =
  /** Traveller has a ticket: may enter the paid area via fare-boundary edges. Unknown-paid edges allowed but reported. */
  | "ticketed"
  /** Traveller must stay outside the paid area: edges with paid !== false or crossesFareBoundary !== false are excluded. */
  | "unpaid_only";

export interface RouteProfile {
  fare: FarePolicy;
  /** Wheelchair/step-free routing: edges need wheelchair === true (unknown excluded). */
  stepFree: boolean;
  /** Avoid these modes entirely (e.g. ["escalator"]). */
  avoidModes?: EdgeMode[];
  /** Edge ids closed for this query in addition to edge.closed. */
  extraClosedEdgeIds?: string[];
  /**
   * Unknown opening hours (hours === null):
   * - "warn_unknown" (default): routable, reported in `unknowns` as kind "hours"; the UI must
   *   show "hours unverified". No open dataset for either station publishes passage hours.
   * - "require_known": excluded (strict, fail-closed).
   * Nothing is ever asserted to be open 24h without an `always` hours record.
   */
  hours?: "warn_unknown" | "require_known";
  /** Station-local departure time. When given, edges whose known hours are closed are excluded. */
  at?: LocalTime;
  /** ISO date "today" used to flag stale sources; omit for no staleness verdict. */
  today?: string;
  /** Source datasetDate older than this (days before `today`) marks the route stale. Default 730. */
  staleAfterDays?: number;
}

export const DEFAULT_PROFILE: RouteProfile = { fare: "ticketed", stepFree: false };
export const DEFAULT_STALE_AFTER_DAYS = 730;

export interface RouteStep {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  /** Traversal direction relative to the stored edge. */
  reversed: boolean;
  mode: EdgeMode;
  lengthM: number;
  fromFloorId: string;
  toFloorId: string;
}

export type RouteUnknown = "hours" | "paid" | "fare_boundary" | "wheelchair" | "steps" | "length" | "access_evidence";

export interface RouteResult {
  ok: true;
  nodeIds: string[];
  steps: RouteStep[];
  /** Walking distance in metres (stairs/ramps include the climb; lift rides add time, not length). */
  totalLengthM: number;
  /** Estimated walking time (s): walk 1.2 m/s, stairs 0.5 m/s along length, escalator 0.75 m/s, lift 45 s per ride. */
  estimatedSeconds: number;
  floorChanges: number;
  /** true if any edge crosses the fare boundary; null when none is known to but some crossing state is UNKNOWN. */
  crossesFareBoundary: boolean | null;
  /** Facts along the route that are UNKNOWN; UI must show them. */
  unknowns: { kind: RouteUnknown; edgeIds: string[] }[];
  /** Sources the route depends on (for provenance display). */
  sourceIds: string[];
  /** Latest checkedDate across the route's evidence. */
  evidenceCheckedDate: string | null;
  /** Oldest known source datasetDate the route depends on (the weakest dated link); null = no dated source. */
  oldestSourceDate: string | null;
  /** Sources the route depends on that have no datasetDate. */
  undatedSourceIds: string[];
  /**
   * true when oldestSourceDate is older than staleAfterDays before profile.today; null when not evaluable
   * (no `today`, or an undated dependency and no dated one already proves staleness).
   */
  stale: boolean | null;
  /** True when the route uses synthetic data: never present it as real directions. */
  synthetic: boolean;
  /** Edges with known opening windows used without a departure time (`profile.at`); UI must show the window. */
  timeRestricted: { edgeId: string; open: string; close: string; days?: string[] }[];
  /** Operators whose floors the route touches, in order of first appearance. */
  operatorIds: string[];
}

export type RouteFailureReason =
  | "unknown_start"
  | "unknown_goal"
  | "no_path"
  | "start_equals_goal";

export interface RouteFailure {
  ok: false;
  reason: RouteFailureReason;
  message: string;
}

export interface Router {
  /**
   * Cheapest route from any start to any goal, ranked by the router's cost (not walking length).
   * Unknown ids are ignored; `start_equals_goal` when any start already is a goal.
   */
  route(fromNodeIds: string | string[], toNodeIds: string | string[], profile?: RouteProfile): RouteResult | RouteFailure;
  /** True when this edge may be used under the profile (exposed for UI/debug overlays). */
  isTraversable(edge: Edge, profile: RouteProfile): boolean;
}

export { createRouter } from "./router.ts";
export { describeRoute, floorDisplayName, nodeDisplayZ, routePolyline, type Instruction, type InstructionKind, type PolylinePoint } from "./present.ts";
