/**
 * What one search row says about a POI, kept free of three.js and the page so it can be unit tested.
 *
 * Line POIs imported from Tokyo's S03 (and the merchant listings) carry a Japanese name only, no
 * station floor and no verified entrance (#411, #214). Their data does carry a note saying what is
 * unverified (the March 2020 date, the unverified location); the row must show that note rather than
 * an empty second line, and the route error must say what the data actually holds — "position only"
 * was never true for the 603 search-only POIs that have no position at all.
 */
import type { Poi } from "@gteki/schema";

export type SearchOnlyRole = "origin" | "destination";

const ROLE = {
  origin: { ja: "出発地", en: "this origin" },
  destination: { ja: "目的地", en: "this destination" },
} as const;

/** Search-only results show their own note; routable results show English and floor. */
export function searchRowSub(poi: Poi, floorShort: string): string {
  const note = poi.notes?.find((n) => n.lang === "ja")?.text.trim() ?? "";
  if (poi.connectorNodeIds.length === 0 && note) return note;
  const en = poi.descriptions?.find((n) => n.lang === "en")?.text.trim() ?? poi.names.find((n) => n.lang === "en")?.text.trim() ?? "";
  const line = [en, floorShort.trim()].filter(Boolean).join(" · ");
  if (line) return line;
  return note;
}

/**
 * Why a search-only endpoint cannot be guided to, from the fields the data actually holds: an approximate
 * search-display position (25 gates and transfers) or a name alone (the other 603 search-only POIs).
 */
export function searchOnlyText(poi: Poi, role: SearchOnlyRole): string {
  const { ja: word, en: noun } = ROLE[role];
  const approximate = poi.approximatePosition;
  const ja = approximate
    ? `この${word}はおおよその位置（±${Math.ceil(approximate.uncertaintyM)} m・検索表示のみ）だけで、検証済みの入口がありません。`
    : `この${word}は名前だけが分かっており、位置も検証済みの入口もありません。`;
  const en = approximate
    ? `Only an approximate position (search display only) — ${noun} has no verified entrance in the surveyed data.`
    : `Only the name is known — ${noun} has no confirmed position and no verified entrance in the surveyed data.`;
  return `${ja} ${en}`;
}
