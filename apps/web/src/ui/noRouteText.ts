import type { Poi } from "@gteki/schema";
import type { RouteFailure } from "@gteki/navigation";
import type { Strings } from "../i18n.ts";

/** Text for a failed route card, with explicit wording for unlocated shop destinations. */
export function noRouteText(t: Strings, failure: RouteFailure, destination: Poi | null): string {
  if (failure.reason === "unknown_goal" && destination?.category === "shop") return t.shopNoRoute;
  return t.noRouteWhy[failure.reason] ?? failure.message;
}
