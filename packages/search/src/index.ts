import type { Poi, StationBundle } from "@gteki/schema";

/**
 * Name/alias search over station POIs. Japanese-aware normalisation:
 * NFKC, case-fold, katakana→hiragana, long-vowel / punctuation / whitespace folding,
 * plus romaji aliases supplied by the bundle (no automatic kanji→kana guessing).
 * Matching also folds 号/號 to 番 in exit numbers (22号出口 = 22番出口; the digits must match as a whole
 * number), drops the station's own name from the front of a query (池袋東口 also searches 東口), skips
 * subsequence fuzz for queries under 4 characters, and breaks score ties by match quality, then id.
 *
 * Store brand directories (#419): a tenant is indexed as extra texts of its store POI and scores below a
 * direct match on the store's own name/alias (fixed penalty). One hit per store: the best tenant plus a
 * count of the other tenants of that store that also matched.
 */

/** A brand that matched in a store's printed directory, in the requested language (ja, then first). */
export interface TenantMatch {
  id: string;
  name: string;
  /** The store's own floor label as printed ("8F", "本館 2F"); never a station floor id. */
  floorLabel: string;
  category?: string;
}

export interface SearchHit {
  poi: Poi;
  score: number;
  /** The name/alias text that matched best (the brand, when the match came from a tenant listing). */
  matched: string;
  /** False when the POI has no verified connector node (search-only, not routable). */
  routable: boolean;
  /** Set when the best match on this store was one of its listed tenants. */
  tenant?: TenantMatch;
  /** Other tenants of the same store that also matched (absent when none). */
  moreTenants?: number;
}

export interface SearchOptions {
  limit?: number;
  categories?: Poi["category"][];
  /** Restrict to POIs on these floors. */
  floorIds?: string[];
  /** Preferred language for the tenant brand/floor strings (then ja, then the first entry). */
  lang?: string;
}

export interface SearchIndex {
  search(query: string, opts?: SearchOptions): SearchHit[];
}

export { createSearchIndex, normalizeJa } from "./search.ts";
export type { StationBundle };
