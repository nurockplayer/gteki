import type { Poi, StationBundle } from "@gteki/schema";

/**
 * Name/alias search over station POIs. Japanese-aware normalisation:
 * NFKC, case-fold, katakana→hiragana, long-vowel / punctuation / whitespace folding,
 * plus romaji aliases supplied by the bundle (no automatic kanji→kana guessing).
 * Matching also folds 号/號 to 番 in exit numbers (22号出口 = 22番出口; the digits must match as a whole
 * number), drops the station's own name from the front of a query (池袋東口 also searches 東口), skips
 * subsequence fuzz for queries under 4 characters, and breaks score ties by match quality, then id.
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
