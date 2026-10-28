import type { LocalizedText, Poi, StationBundle, Tenant } from "@gteki/schema";
import type { SearchHit, SearchIndex, TenantMatch } from "./index.ts";

/** Fold scripts and formatting only; readings and translations come from aliases. */
export function normalizeJa(s: string): string {
  return s.normalize("NFKC").toLowerCase()
    .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replace(/[\s\p{P}−〜～~ー<>]/gu, "");
}

/**
 * Matching key: normalizeJa plus exit-number folding, so 22号出口 / 22號出口 / 22番出口 are one text.
 * 号 / 號 fold only before 出口 or at the end (not 1号線 "line 1" or 3号車 "car 3"). normalizeJa itself is
 * unchanged because the Godot port mirrors its goldens.
 */
export function searchKey(s: string): string {
  return normalizeJa(s).replace(/(\d)[号號](?=出|口|でぐち|$)/g, "$1番");
}

/** One searchable text: a POI name/alias, or a brand printed in that POI's tenant directory. */
interface IndexedText {
  original: string;
  normalized: string;
  /** Set for brand texts; the store POI itself stays the hit. */
  tenant?: Tenant;
}

interface IndexedPoi {
  poi: Poi;
  routable: boolean;
  texts: IndexedText[];
}

/** One query form to score: the typed query, or what is left after dropping the station's own name. */
interface QueryForm {
  normalized: string;
  chars: string[];
  tokens: string[];
  runs: string[];
  /** Taken off the score: a literal match beats a stripped one. */
  penalty: number;
  /** Subsequence fuzz is noise on short queries (東口 -> ...東剪票口, JR -> Tobu Tojo Line Central Gate). */
  fuzzy: boolean;
  /** Contains "<digits>番": a precise exit reference, so the digits must match as a whole number. */
  numbered: boolean;
}

/** Subsequence fuzz only for queries of at least this many normalised characters. */
const MIN_FUZZY_CHARS = 4;
/** Station-name stripping needs at least this many characters left to search. */
const MIN_REMAINDER_CHARS = 2;
const STRIPPED_PENALTY = 2;
/**
 * A brand in a store's directory scores this much below the same match on the store's own name/alias,
 * so 「東武」 still finds 東武百貨店 itself before a store that merely lists 東武ストア (#419).
 */
const TENANT_PENALTY = 25;
const STATION_WORD = /^(?:駅|站|えき|station|eki)/;

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

function makeForm(normalized: string, tokens: string[], penalty: number): QueryForm {
  const chars = [...normalized];
  return {
    normalized, chars, tokens, runs: scriptRuns(normalized), penalty,
    fuzzy: chars.length >= MIN_FUZZY_CHARS,
    numbered: /\d番/.test(normalized),
  };
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The station's own name as people prefix it to a query (池袋東口, "ikebukuro east exit"), longest first. */
function stationPrefixes(names: readonly string[]): string[] {
  const out = new Set<string>();
  for (const name of names) {
    const base = searchKey(name.split(/[（(]/)[0] ?? "");
    for (const form of [base, base.replace(/(?:駅|站|えき|station|eki)$/, "")]) {
      if (form.length >= 2) out.add(form);
    }
  }
  return [...out].sort((a, b) => b.length - a.length || compareText(a, b));
}

/** Drop a leading station name from the query; null when it is not there or nothing else is left. */
function stripStation(prefixes: readonly string[], normalized: string, latinTokens: string[]): QueryForm | null {
  for (const prefix of prefixes) {
    if (!normalized.startsWith(prefix)) continue;
    const rest = normalized.slice(prefix.length).replace(STATION_WORD, "");
    if ([...rest].length < MIN_REMAINDER_CHARS) return null;
    // Latin tokens: drop the words that spell the station name (and a following "station" / "eki").
    let tokens: string[] = [];
    if (latinTokens.length > 1) {
      let used = "";
      let i = 0;
      while (i < latinTokens.length && used.length < prefix.length) used += latinTokens[i++];
      if (used === prefix) {
        tokens = latinTokens.slice(i);
        if (tokens[0] !== undefined && STATION_WORD.exec(tokens[0])?.[0] === tokens[0]) tokens = tokens.slice(1);
        if (tokens.length < 2) tokens = [];
      }
    }
    return makeForm(rest, tokens, STRIPPED_PENALTY);
  }
  return null;
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

/** First occurrence of `query` in `candidate` that does not continue a longer number ("2番" in "22番"). */
function wholeNumberAt(candidate: string, query: string): number {
  for (let i = candidate.indexOf(query); i >= 0; i = candidate.indexOf(query, i + 1)) {
    if (i === 0 || !/\p{Nd}/u.test(candidate[i - 1]!)) return i;
  }
  return -1;
}

function scoreText(q: QueryForm, candidate: string): number {
  const query = q.normalized;
  if (candidate === query) return 100;
  if (q.numbered) {
    // "2番出口" is that exit only: no token / fuzzy matching, and not inside "22番出口".
    const at = /^\p{Nd}/u.test(query) ? wholeNumberAt(candidate, query) : candidate.indexOf(query);
    if (at < 0) return 0;
    return at === 0 ? 80 : at + query.length === candidate.length ? 70 : 60;
  }
  if (candidate.startsWith(query)) return 80;
  // Japanese compounds are head-final (中央改札, 35番出口): a suffix match names the thing itself.
  if (candidate.endsWith(query)) return 70;
  if (candidate.includes(query)) return 60;
  const tokenScore = (q.tokens.length > 1 && q.tokens.every((token) => candidate.includes(token))) ||
    (q.runs.length > 1 && q.runs.every((run) => candidate.includes(run))) ? 40 : 0;
  return Math.max(tokenScore, q.fuzzy ? fuzzyScore(q.chars, [...candidate]) : 0);
}

/** Match quality for ties: exact name > name starts with the query > anything else; then the shorter matched name. */
type Quality = { rank: number; length: number };

function qualityOf(text: string, form: QueryForm): Quality {
  return { rank: text === form.normalized ? 2 : text.startsWith(form.normalized) ? 1 : 0, length: text.length };
}

/** Negative when `a` is the better match. Shared by the per-POI text choice and the result sorter. */
function compareQuality(a: Quality, b: Quality): number {
  return b.rank - a.rank || a.length - b.length;
}

/** The requested language, then ja, then the first entry (a brand is never translated). */
function pickText(texts: LocalizedText[], lang: string | undefined): string {
  return (texts.find((t) => lang !== undefined && t.lang === lang) ?? texts.find((t) => t.lang === "ja") ?? texts[0])?.text ?? "";
}

/** The tenant fields a hit exposes, picked in the reader's language. */
function tenantMatch(tenant: Tenant, lang: string | undefined): TenantMatch {
  const match: TenantMatch = { id: tenant.id, name: pickText(tenant.names, lang), floorLabel: pickText(tenant.floorLabel, lang) };
  if (tenant.category && tenant.category.length > 0) match.category = pickText(tenant.category, lang);
  return match;
}

interface BestText {
  score: number;
  matched: string;
  quality: Quality;
}

const EMPTY_BEST: BestText = { score: 0, matched: "", quality: { rank: 0, length: 0 } };

/** Keep whichever scored text matches better (score, then match quality). */
function betterText(current: BestText, score: number, matched: string, quality: Quality): BestText {
  if (score > current.score || (score === current.score && compareQuality(quality, current.quality) < 0))
    return { score, matched, quality };
  return current;
}

export function createSearchIndex(bundle: StationBundle): SearchIndex {
  const tenantsByPoi = new Map<string, Tenant[]>();
  for (const tenant of bundle.tenants ?? []) {
    const list = tenantsByPoi.get(tenant.poiId);
    if (list) list.push(tenant);
    else tenantsByPoi.set(tenant.poiId, [tenant]);
  }
  const entries: IndexedPoi[] = bundle.pois.map((poi) => {
    const texts: IndexedText[] = [...poi.names, ...poi.aliases, ...(poi.descriptions ?? [])].map(({ text }) => ({ original: text, normalized: searchKey(text) }));
    // A store's directory only adds texts to the store itself: one card per store, never one per brand.
    for (const tenant of tenantsByPoi.get(poi.id) ?? [])
      for (const { text } of [...tenant.names, ...tenant.aliases])
        texts.push({ original: text, normalized: searchKey(text), tenant });
    return { poi, routable: poi.connectorNodeIds.length > 0, texts };
  });
  const prefixes = stationPrefixes(bundle.station.names.map(({ text }) => text));

  return {
    search(query, opts = {}) {
      const normalized = searchKey(query);
      if (!normalized) return [];
      const latinQuery = query.normalize("NFKC").toLowerCase().trim();
      const tokens = /^[a-z0-9]+(?:\s+[a-z0-9]+)+$/.test(latinQuery)
        ? latinQuery.split(/\s+/).map(normalizeJa) : [];
      const forms = [makeForm(normalized, tokens, 0)];
      // A query that is only the station name stays as typed; "池袋東口" also searches "東口".
      const stripped = prefixes.length ? stripStation(prefixes, normalized, tokens) : null;
      if (stripped) forms.push(stripped);
      const categories = opts.categories === undefined ? null : new Set(opts.categories);
      const floors = opts.floorIds === undefined ? null : new Set(opts.floorIds);
      const hits: { hit: SearchHit; quality: Quality }[] = [];
      for (const entry of entries) {
        if (categories && !categories.has(entry.poi.category)) continue;
        if (floors && (entry.poi.floorId === null || !floors.has(entry.poi.floorId))) continue;
        let direct = EMPTY_BEST;
        let viaTenant: (BestText & { tenant: Tenant }) | null = null;
        const matchedTenants = new Set<string>();
        for (const text of entry.texts) {
          for (const form of forms) {
            const raw = scoreText(form, text.normalized);
            if (raw <= 0) continue;
            const score = raw - form.penalty;
            if (score <= 0) continue;
            // The tenant penalty ranks a brand below direct matches but never drops it: a typo'd brand (fuzzy, at most 20)
            // still finds its store, last.
            const candidateScore = text.tenant ? Math.max(1, score - TENANT_PENALTY) : score;
            const quality = qualityOf(text.normalized, form);
            if (text.tenant) {
              matchedTenants.add(text.tenant.id);
              const current: BestText & { tenant: Tenant } = viaTenant ?? { ...EMPTY_BEST, tenant: text.tenant };
              const next = betterText(current, candidateScore, text.original, quality);
              viaTenant = next === current ? current : { ...next, tenant: text.tenant };
            } else {
              direct = betterText(direct, candidateScore, text.original, quality);
            }
          }
        }
        // A brand listed by the store only wins when the store itself matched nothing better.
        const useTenant = viaTenant !== null &&
          (viaTenant.score > direct.score || (viaTenant.score === direct.score && compareQuality(viaTenant.quality, direct.quality) < 0));
        const best = useTenant ? viaTenant! : direct;
        if (best.score <= 0) continue;
        const hit: SearchHit = { poi: entry.poi, score: best.score + (entry.routable ? 5 : 0), matched: best.matched, routable: entry.routable };
        if (useTenant) {
          hit.tenant = tenantMatch(viaTenant!.tenant, opts.lang);
          if (matchedTenants.size > 1) hit.moreTenants = matchedTenants.size - 1;
        }
        hits.push({ hit, quality: best.quality });
      }
      // Ties: better match quality, then the shorter matched name, then id (stable regardless of bundle order).
      hits.sort((a, b) => b.hit.score - a.hit.score || compareQuality(a.quality, b.quality) || compareText(a.hit.poi.id, b.hit.poi.id));
      return hits.slice(0, Math.max(0, opts.limit ?? 10)).map(({ hit }) => hit);
    },
  };
}
