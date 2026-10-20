import type { Poi, StationBundle } from "@gteki/schema";

/**
 * Name/alias search over station POIs. Japanese-aware normalisation:
 * NFKC, case-fold, katakana→hiragana, long-vowel / punctuation / whitespace folding,
 * plus romaji aliases supplied by the bundle (no automatic kanji→kana guessing).
 */

export interface SearchHit {
  poi: Poi;
  score: number;
  /** The name/alias text that matched best. */
  matched: string;
  /** False when the POI has no verified connector node (search-only, not routable). */
  routable: boolean;
}

export interface SearchOptions {
  limit?: number;
  categories?: Poi["category"][];
  /** Restrict to POIs on these floors. */
  floorIds?: string[];
}

export interface SearchIndex {
  search(query: string, opts?: SearchOptions): SearchHit[];
}

export { createSearchIndex, normalizeJa } from "./search.ts";
export type { StationBundle };
