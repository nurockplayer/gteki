import type { Poi } from "@gteki/schema";

/**
 * The order the search category filter lists (#213), so the row does not reshuffle between stations.
 * Shop-like categories come first: the filter exists for merchants.
 */
export const CATEGORY_ORDER: readonly Poi["category"][] = [
  "shop", "service", "atm", "locker", "toilet", "exit", "ticket_gate", "platform",
  "escalator", "elevator", "stairs", "transfer", "other",
];

/** Only the categories the loaded station actually has, in the fixed order above. */
export function categoriesIn(pois: readonly Poi[]): Poi["category"][] {
  const present = new Set(pois.map((p) => p.category));
  return CATEGORY_ORDER.filter((c) => present.has(c));
}
