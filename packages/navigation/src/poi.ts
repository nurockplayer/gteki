import type { Poi } from "@gteki/schema";
import type { RouteFailure, RouteProfile, RouteResult, Router } from "./index.ts";

/** A route endpoint: a POI (routed via its connectors) or a bare graph node (e.g. the avatar's nearest node). */
export type RouteEndpoint = { kind: "poi"; poi: Poi } | { kind: "node"; nodeId: string };

/** A destination POI routed via its connectors, or bare graph nodes with no destination fare state. */
export type RouteDestination = Poi | { kind: "nodes"; nodeIds: string[] };

/**
 * Route between POIs or graph nodes under the same truth rules as the router's edges: under
 * `unpaid_only` a POI endpoint must be known to be outside the paid area (`paid === false`); a
 * paid or unknown-paid POI fails closed, however unpaid the edges to its connectors are. Bare
 * node endpoints have no POI fare state or endpoint evidence. POI evidence joins the route's provenance.
 */
export function routeBetween(router: Router, from: RouteEndpoint, to: RouteDestination, profile: RouteProfile): RouteResult | RouteFailure {
  const starts = from.kind === "poi" ? from.poi.connectorNodeIds : [from.nodeId];
  if (starts.length === 0) return { ok: false, reason: "unknown_start", message: "origin has no verified entrance" };
  const goals = "kind" in to ? to.nodeIds : to.connectorNodeIds;
  if (goals.length === 0) return { ok: false, reason: "unknown_goal", message: "destination has no verified entrance" };
  if (profile.fare === "unpaid_only") {
    for (const [role, poi] of [["origin", from.kind === "poi" ? from.poi : null], ["destination", "kind" in to ? null : to]] as const)
      if (poi && poi.paid !== false)
        return { ok: false, reason: "no_path", message: `${role} ${poi.id} is ${poi.paid === true ? "inside" : "not known to be outside"} the paid area` };
  }
  return router.route(starts, goals, profile, [...(from.kind === "poi" ? [from.poi.evidence] : []), ...("kind" in to ? [] : [to.evidence])]);
}
