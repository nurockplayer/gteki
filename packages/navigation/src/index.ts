import type { Edge, EdgeMode, StationBundle } from "@gteki/schema";

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
  /** Ignore hours: hours === null is reported as an unknown, never assumed open. */
  /** Edge ids closed for this query in addition to edge.closed. */
  extraClosedEdgeIds?: string[];
}

export const DEFAULT_PROFILE: RouteProfile = { fare: "ticketed", stepFree: false };

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

export type RouteUnknown = "hours" | "paid" | "wheelchair" | "steps" | "length" | "access_evidence";

export interface RouteResult {
  ok: true;
  nodeIds: string[];
  steps: RouteStep[];
  totalLengthM: number;
  /** Estimated walking time (s): walk 1.2 m/s, stairs 0.5 m/s along length, escalator 0.75 m/s, lift 45 s per ride. */
  estimatedSeconds: number;
  floorChanges: number;
  crossesFareBoundary: boolean;
  /** Facts along the route that are UNKNOWN; UI must show them. */
  unknowns: { kind: RouteUnknown; edgeIds: string[] }[];
  /** Sources the route depends on (for provenance display). */
  sourceIds: string[];
  /** Latest checkedDate across the route's evidence. */
  evidenceCheckedDate: string | null;
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
  route(fromNodeId: string, toNodeIds: string | string[], profile?: RouteProfile): RouteResult | RouteFailure;
  /** True when this edge may be used under the profile (exposed for UI/debug overlays). */
  isTraversable(edge: Edge, profile: RouteProfile): boolean;
}

export { createRouter } from "./router.ts";
