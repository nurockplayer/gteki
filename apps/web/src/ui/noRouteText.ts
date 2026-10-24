import type { Poi } from "@gteki/schema";
import type { RouteFailure } from "@gteki/navigation";
import type { Strings } from "../i18n.ts";

/** A shop with no verified entrance and no position: the only case where "location not verified" is the honest wording. */
export function isUnlocatedShop(poi: Poi | null | undefined): boolean {
  return poi?.category === "shop" && poi.connectorNodeIds.length === 0 && poi.displayPosition === null;
}

/** Text for a failed route card, with explicit wording for unlocated shop destinations. */
export function noRouteText(t: Strings, failure: RouteFailure, destination: Poi | null): string {
  if (failure.reason === "unknown_goal" && isUnlocatedShop(destination)) return t.shopNoRoute;
  return t.noRouteWhy[failure.reason] ?? failure.message;
}
