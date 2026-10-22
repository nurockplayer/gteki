/**
 * Matching rules of the class (b) leak guard (issue #129). Pure functions, no I/O.
 *
 * Source codes versus source wording:
 * - A *code* is a pure number, one of our own markers, or a short ASCII token (at most three characters of
 *   `[A-Za-z0-9 +-./()]`, e.g. rank `SBS`, floor `B1F`). Codes carry no wording and stay readable in reports.
 * - Everything else is *wording*, however short: `1階`, `階段`, `歩道橋`, `あり` are source labels. Wording of four or more
 *   characters (NFKC) is found as a substring; shorter wording is found only as a whole JSON string/key or with a
 *   non-letter, non-digit neighbour on both sides, so it cannot match inside a longer word such as `階段室`.
 * - Allowlisted generic terms (codebooks/poi-literal-allowlist.json) are exempt only as substrings of our own prose. A whole
 *   JSON string value or key that equals a class (b) literal is always a leak, even when the word is also allowlisted.
 * - Comparison is on the NFKC form, so full-width digits and letters (`１階`) do not escape.
 */
const MARKERS = new Set(['(blank)', '(unavailable)', '(unknown)']);
export const SUBSTRING_MIN_LENGTH = 4;

export const nfkc = (value: string): string => value.normalize('NFKC');

/** True for a number, one of our markers or a short ASCII token: kept verbatim in committed reports and not scanned. */
export function isCodeValue(value: string): boolean {
  const trimmed = nfkc(value).trim();
  return MARKERS.has(trimmed) || /^[-+]?\d+(?:\.\d+)?$/u.test(trimmed) || /^[A-Za-z0-9 +\-./()%]{1,3}$/u.test(trimmed);
}

/** Wording that must be tested against the committed tree: not a code and not empty. */
export const isWording = (value: string): boolean => nfkc(value).trim().length > 0 && !isCodeValue(value);

const escapeRegex = (text: string): string => text.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
const SHORT_BOUNDARY = ['(?<![\\p{L}\\p{N}])', '(?![\\p{L}\\p{N}])'] as const;

export type LiteralMatcher = {
  /** NFKC-normalised trimmed literal -> the first original spelling (used for the hash). */
  readonly literals: ReadonlyMap<string, string>;
  readonly allowlist: ReadonlySet<string>;
  /** Allowlisted terms that are also exempt as a whole JSON value or key (our own enum values, see the allowlist file). */
  readonly structural: ReadonlySet<string>;
};

export function buildMatcher(literals: Iterable<string>, allowlist: Iterable<string> = [], structural: Iterable<string> = []): LiteralMatcher {
  const map = new Map<string, string>();
  for (const literal of literals) { const key = nfkc(literal).trim(); if (key && !map.has(key)) map.set(key, literal); }
  return { literals: map, allowlist: new Set([...allowlist].map(term => nfkc(term))), structural: new Set([...structural].map(term => nfkc(term))) };
}

const byLength = (a: string, b: string): number => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0);

type Span = { start: number; end: number; term: string; literal: boolean };

/** NFKC form of `text`, folded one code point at a time so every folded character maps back to its original range. */
function fold(text: string): { folded: string; starts: number[]; ends: number[] } {
  let folded = '', index = 0;
  const starts: number[] = [], ends: number[] = [];
  for (const char of text) {
    const next = index + char.length, normalized = char.normalize('NFKC');
    folded += normalized;
    for (let i = 0; i < normalized.length; i++) { starts.push(index); ends.push(next); }
    index = next;
  }
  return { folded, starts, ends };
}

/** Non-overlapping spans of class (b) literals and allowlisted terms in `normalized`, longest first at each position. */
function spans(normalized: string, matcher: LiteralMatcher): Span[] {
  const candidates = [...matcher.literals.keys()].filter(literal => normalized.includes(literal));
  const allowed = [...matcher.allowlist].filter(term => normalized.includes(term));
  if (candidates.length === 0) return [];
  const terms = [...new Set([...candidates, ...allowed])].sort(byLength);
  const pattern = terms.map(term => {
    const short = term.length < SUBSTRING_MIN_LENGTH && !matcher.allowlist.has(term);
    return short ? `${SHORT_BOUNDARY[0]}${escapeRegex(term)}${SHORT_BOUNDARY[1]}` : escapeRegex(term);
  }).join('|');
  const out: Span[] = [];
  for (const match of normalized.matchAll(new RegExp(pattern, 'gu'))) {
    const term = match[0]!;
    out.push({ start: match.index!, end: match.index! + term.length, term, literal: !matcher.allowlist.has(term) && matcher.literals.has(term) });
  }
  return out;
}

/** Class (b) literals found as wording inside one prose string (allowlisted generic terms and longer words are skipped). */
export function literalsInProse(text: string, matcher: LiteralMatcher): string[] {
  return [...new Set(spans(nfkc(text), matcher).filter(span => span.literal).map(span => span.term))];
}

/** The literal a whole string equals (a JSON string value or key), allowlisted or not, unless it is a structural value. */
export function wholeValueLiteral(value: string, matcher: LiteralMatcher): string | null {
  const key = nfkc(value).trim();
  return key !== '' && matcher.literals.has(key) && !matcher.structural.has(key) ? key : null;
}

/** Replace class (b) wording in a prose string with `token(original)`. Allowlisted terms and longer words are kept intact. */
export function redactProse(text: string, matcher: LiteralMatcher, token: (original: string) => string): { text: string; replaced: number } {
  const { folded, starts, ends } = fold(text);
  let out = '', cursor = 0, replaced = 0;
  for (const span of spans(folded, matcher)) {
    if (!span.literal || starts[span.start]! < cursor) continue;
    out += text.slice(cursor, starts[span.start]!) + token(matcher.literals.get(span.term)!);
    cursor = ends[span.end - 1]!; replaced++;
  }
  return { text: out + text.slice(cursor), replaced };
}
