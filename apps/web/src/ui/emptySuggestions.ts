import type { Poi, PoiCategory } from "@gteki/schema";

export type SuggestGroupKey = "recent" | "popular";
export interface SuggestGroup { key: SuggestGroupKey; pois: Poi[] }

/** Category order for the empty list: from = where people start, to = where people go. Categories not listed are dropped. */
export const FROM_ORDER: PoiCategory[] = ["ticket_gate", "platform", "transfer", "other", "exit"];
export const TO_ORDER: PoiCategory[] = ["shop", "transfer", "platform", "ticket_gate", "toilet", "other", "exit"];

/** Routable, station-ordered suggestions for an empty search field. */
export function emptySuggestions(
  pois: readonly Poi[],
  which: "from" | "to",
  opts: { filter: PoiCategory | null; recentIds: readonly string[]; limit?: number },
): SuggestGroup[] {
  const limit = Math.max(0, opts.limit ?? 12);
  if (limit === 0) return [];
  const order = which === "from" ? FROM_ORDER : TO_ORDER;
  const allowed = new Set(order);
  const byId = new Map(pois.map((poi) => [poi.id, poi]));
  const eligible = (poi: Poi) => poi.connectorNodeIds.length > 0 && allowed.has(poi.category) && (!opts.filter || poi.category === opts.filter);
  const recent: Poi[] = [];
  const recentIds = new Set<string>();
  for (const id of opts.recentIds) {
    if (recent.length >= Math.min(5, limit)) break;
    const poi = byId.get(id);
    if (!poi || recentIds.has(id) || !eligible(poi)) continue;
    recentIds.add(id);
    recent.push(poi);
  }
  const popular = pois
    .map((poi, index) => ({ poi, index, categoryIndex: order.indexOf(poi.category) }))
    .filter(({ poi, categoryIndex }) => categoryIndex >= 0 && !recentIds.has(poi.id) && eligible(poi))
    .sort((a, b) => a.categoryIndex - b.categoryIndex || a.index - b.index)
    .slice(0, limit - recent.length)
    .map(({ poi }) => poi);
  const groups: SuggestGroup[] = [];
  if (recent.length) groups.push({ key: "recent", pois: recent });
  if (popular.length) groups.push({ key: "popular", pois: popular });
  return groups;
}

/** Most recent first, deduplicated, max 5. */
export function pushRecent(ids: readonly string[], id: string, max = 5): string[] {
  return [id, ...new Set(ids.filter((existing) => existing !== id))].slice(0, Math.max(0, max));
}

/** localStorage key per station: `gteki.recent.<stationKey>`. */
export function readRecent(storage: Pick<Storage, "getItem"> | null, stationKey: string): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(`gteki.recent.${stationKey}`) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}

export function writeRecent(storage: Pick<Storage, "setItem"> | null, stationKey: string, ids: readonly string[]): void {
  try { storage?.setItem(`gteki.recent.${stationKey}`, JSON.stringify(ids)); } catch { /* storage unavailable */ }
}

function nameIn(poi: Poi, lang: "ja" | "en"): string | undefined {
  return poi.names.find((name) => name.lang === lang)?.text ?? poi.names[0]?.text;
}

/** Up to three useful example queries present in the station. */
export function exampleQueries(pois: readonly Poi[], lang: "ja" | "en", toiletWord: string): string[] {
  const shop = pois.find((poi) => poi.category === "shop" && poi.connectorNodeIds.length > 0);
  const gate = pois.find((poi) => poi.category === "ticket_gate" && poi.connectorNodeIds.length > 0);
  const queries = [shop && nameIn(shop, lang), gate && nameIn(gate, lang), pois.some((poi) => poi.category === "toilet") ? toiletWord : undefined];
  return [...new Set(queries.filter((query): query is string => Boolean(query)))];
}
