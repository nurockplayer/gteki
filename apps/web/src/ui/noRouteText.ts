import type { Poi } from "@gteki/schema";
import type { RouteFailure } from "@gteki/navigation";
import type { Lang, Strings } from "../i18n.ts";

/** A shop with no verified entrance and no position: the only case where "location not verified" is the honest wording. */
export function isUnlocatedShop(poi: Poi | null | undefined): boolean {
  return poi?.category === "shop" && poi.connectorNodeIds.length === 0 && poi.displayPosition === null;
}

/**
 * The note to show beside a POI name where no route is given (search-only POIs). Names are copied from
 * Japanese sources, so the ja note is shown when there is none in `lang`, rather than nothing. Null when
 * there is no non-blank note in either language.
 */
export function poiNoteText(poi: Poi | undefined | null, lang: Lang): string | null {
  const notes = poi?.notes ?? [];
  const textIn = (l: Lang): string | null => {
    const text = notes.find((n) => n.lang === l)?.text.trim() ?? "";
    return text === "" ? null : text;
  };
  return textIn(lang) ?? textIn("ja");
}

/** Text for a failed route card, with explicit wording for unlocated shop destinations. */
export function noRouteText(t: Strings, failure: RouteFailure, destination: Poi | null): string {
  if (failure.reason === "unknown_goal" && isUnlocatedShop(destination)) return t.shopNoRoute;
  return t.noRouteWhy[failure.reason] ?? failure.message;
}
