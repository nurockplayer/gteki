import type { Poi } from "@gteki/schema";
import type { RouteFailure, RouteProfile, RouteResult, Router } from "./index.ts";

/** A route endpoint: a POI (routed via its connectors) or a bare graph node (e.g. the avatar's nearest node). */
export type RouteEndpoint = { kind: "poi"; poi: Poi } | { kind: "node"; nodeId: string };

/**
 * Route between POIs (or nodes) under the same truth rules as the router's edges: under
 * `unpaid_only` a POI must be known to be outside the paid area (`paid === false`); a paid or
 * unknown-paid POI fails closed, however unpaid the edges to its connectors are.
 * Both POIs' evidence joins the route's provenance.
 */
export function routeBetween(router: Router, from: RouteEndpoint, to: Poi, profile: RouteProfile): RouteResult | RouteFailure {
  const starts = from.kind === "poi" ? from.poi.connectorNodeIds : [from.nodeId];
  if (starts.length === 0) return { ok: false, reason: "unknown_start", message: "origin has no verified entrance" };
  if (to.connectorNodeIds.length === 0) return { ok: false, reason: "unknown_goal", message: "destination has no verified entrance" };
  if (profile.fare === "unpaid_only") {
    for (const [role, poi] of [["origin", from.kind === "poi" ? from.poi : null], ["destination", to]] as const)
      if (poi && poi.paid !== false)
        return { ok: false, reason: "no_path", message: `${role} ${poi.id} is ${poi.paid === true ? "inside" : "not known to be outside"} the paid area` };
  }
  return router.route(starts, to.connectorNodeIds, profile, [...(from.kind === "poi" ? [from.poi.evidence] : []), to.evidence]);
}
