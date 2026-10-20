import type { Poi, StationBundle } from "@gteki/schema";
import type { SearchHit, SearchIndex } from "./index.ts";

/** Fold scripts and formatting only; readings and translations come from aliases. */
export function normalizeJa(s: string): string {
  return s.normalize("NFKC").toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replace(/[\s\p{P}\u2212\u301c\uff5e~ー<>]/gu, "");
}

interface IndexedPoi {
  poi: Poi;
  name: string;
  routable: boolean;
  texts: { original: string; normalized: string }[];
}

/**
 * Split a normalised query where the script changes (digits / latin / kana / kanji), so word
 * order differences like "でぐち35" vs "35ばんでぐち" still match all parts.
 */
export function scriptRuns(normalized: string): string[] {
  const kind = (c: string) => (/\p{Nd}/u.test(c) ? "d" : /[a-z]/.test(c) ? "l" : /\p{Script=Hiragana}/u.test(c) ? "h" : /\p{Script=Han}/u.test(c) ? "k" : "o");
  const runs: string[] = [];
  let current = "";
  let currentKind = "";
  for (const c of normalized) {
    const k = kind(c);
    if (current && k !== currentKind) { runs.push(current); current = ""; }
    current += c;
    currentKind = k;
  }
  if (current) runs.push(current);
  return runs;
}

/** Ordered subsequence matching, penalising skipped characters within the match. */
function fuzzyScore(query: string[], candidate: string[]): number {
  if (query.length > candidate.length) return 0;
  // Track every possible start to avoid a poor early match hiding a tighter later one.
  let starts = new Map<number, number>();
  for (let q = 0; q < query.length; q++) {
    const next = new Map<number, number>();
    let latestStart = -1;
    for (let c = 0; c < candidate.length; c++) {
      if (candidate[c] === query[q]) {
        if (q === 0) next.set(c, c);
        else if (latestStart >= 0) next.set(c, latestStart);
      }
      const start = starts.get(c);
      if (start !== undefined) latestStart = Math.max(latestStart, start);
    }
    if (next.size === 0) return 0;
    starts = next;
  }
  let best = 0;
  for (const [end, start] of starts) {
    const gaps = end - start + 1 - query.length;
    best = Math.max(best, 40 / (1 + gaps));
  }
  return best;
}

function scoreText(query: string, queryChars: string[], tokens: string[], candidate: string): number {
  if (candidate === query) return 100;
  if (candidate.startsWith(query)) return 80;
  // Japanese compounds are head-final (中央改札, 35番出口): a suffix match names the thing itself.
  if (candidate.endsWith(query)) return 70;
  if (candidate.includes(query)) return 60;
  const runs = scriptRuns(query);
  const tokenScore = (tokens.length > 1 && tokens.every((token) => candidate.includes(token))) ||
    (runs.length > 1 && runs.every((run) => candidate.includes(run))) ? 40 : 0;
  return Math.max(tokenScore, fuzzyScore(queryChars, [...candidate]));
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function createSearchIndex(bundle: StationBundle): SearchIndex {
  const entries: IndexedPoi[] = bundle.pois.map((poi) => ({
    poi,
    name: poi.names[0]?.text ?? "",
    routable: poi.connectorNodeIds.length > 0,
    texts: [...poi.names, ...poi.aliases].map(({ text }) => ({ original: text, normalized: normalizeJa(text) })),
  }));

  return {
    search(query, opts = {}) {
      const normalized = normalizeJa(query);
      if (!normalized) return [];
      const queryChars = [...normalized];
      const latinQuery = query.normalize("NFKC").toLowerCase().trim();
      const tokens = /^[a-z0-9]+(?:\s+[a-z0-9]+)+$/.test(latinQuery)
        ? latinQuery.split(/\s+/).map(normalizeJa) : [];
      const categories = opts.categories === undefined ? null : new Set(opts.categories);
      const floors = opts.floorIds === undefined ? null : new Set(opts.floorIds);
      const hits: { hit: SearchHit; name: string }[] = [];
      for (const entry of entries) {
        if (categories && !categories.has(entry.poi.category)) continue;
        if (floors && (entry.poi.floorId === null || !floors.has(entry.poi.floorId))) continue;
        let score = 0;
        let matched = "";
        for (const text of entry.texts) {
          const candidateScore = scoreText(normalized, queryChars, tokens, text.normalized);
          if (candidateScore > score) {
            score = candidateScore;
            matched = text.original;
          }
        }
        if (score > 0) hits.push({
          hit: { poi: entry.poi, score: score + (entry.routable ? 5 : 0), matched, routable: entry.routable },
          name: entry.name,
        });
      }
      hits.sort((a, b) => b.hit.score - a.hit.score || compareText(a.name, b.name) || compareText(a.hit.poi.id, b.hit.poi.id));
      return hits.slice(0, Math.max(0, opts.limit ?? 10)).map(({ hit }) => hit);
    },
  };
}
