import { valueSha256 } from './poi.js';
import { isCodeValue } from './literal-match.js';

/**
 * Committed-report form of non-POI source literals (issue #129, follow-up to #124). Class (b) sources (unclear or
 * no-release terms, see docs/gis/rights/non-poi-literals.md) never put their label or identifier text into docs/gis:
 * a literal becomes `{ value_sha256, value_type[, count] }` exactly as for POI values. The verbatim form is kept only in
 * the git-ignored store detail report.
 *
 * Source codes are not free text. A value that is purely numeric, one of our own markers, or a short ASCII token (at most
 * three characters, e.g. rank `SBS`) stays as the code: hashing it would make the code distributions unreadable and it
 * carries no source wording. Short non-ASCII wording (`1階`, `階段`, `あり`) is wording and is hashed like any label.
 */
export type HashedValue = { value_sha256: string; value_type: 'string' };
export type HashedCount = HashedValue & { count: number };

/** True for a numeric, marker or short ASCII code (see literal-match.ts); every other value, however short, is source wording. */
export const isEnumeratedCode = isCodeValue;

export const hashedValue = (value: string): HashedValue => ({ value_sha256: valueSha256(value), value_type: 'string' });
const compareHashed = (a: HashedCount, b: HashedCount): number => b.count - a.count || (a.value_sha256 < b.value_sha256 ? -1 : a.value_sha256 > b.value_sha256 ? 1 : 0);

/** Deterministic order independent of the literals: count descending, then hash. */
export function hashedDistribution(counts: Record<string, number>): HashedCount[] {
  return Object.entries(counts).map(([value, count]) => ({ ...hashedValue(value), count })).sort(compareHashed);
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCountMap = (value: unknown): value is Record<string, number> => isRecord(value) && Object.values(value).every(entry => typeof entry === 'number');

/** Code-keyed count map: codes stay, any other key moves to `value_hash_distribution`. Idempotent. */
function splitCodeMap(map: Record<string, unknown>): Record<string, unknown> {
  const codes: Array<[string, unknown]> = [], free: Array<[string, number]> = [];
  for (const [key, entry] of Object.entries(map)) {
    if (typeof entry === 'number' && key !== 'value_hash_distribution' && !isEnumeratedCode(key)) free.push([key, entry]); else codes.push([key, entry]);
  }
  if (free.length === 0) return Object.fromEntries(codes);
  const existing = codes.find(([key]) => key === 'value_hash_distribution')?.[1];
  const rows = [...(Array.isArray(existing) ? existing as HashedCount[] : []), ...hashedDistribution(Object.fromEntries(free))].sort(compareHashed);
  return Object.fromEntries([...codes.filter(([key]) => key !== 'value_hash_distribution'), ['value_hash_distribution', rows]]);
}

const ID_LISTS = new Set(['duplicate_ids', 'duplicate_node_ids', 'duplicate_link_ids', 'unreferenced_node_ids', 'inconsistent_link_ids', 'not_checkable_link_ids']);
const COUNT_MAP_KEYS = new Set(['categorical_values', 'distinct_values', 'literal_value_distribution']);
const hashIfFree = (value: unknown): unknown => typeof value === 'string' && !isEnumeratedCode(value) ? hashedValue(value) : value;

function redact(value: unknown, key: string | null, parent: string | null): unknown {
  if (Array.isArray(value)) {
    if (key !== null && ID_LISTS.has(key)) return value.map(hashIfFree);
    return value.map(entry => redact(entry, null, key));
  }
  if (!isRecord(value)) return value;
  const out: Array<[string, unknown]> = [];
  for (const [name, entry] of Object.entries(value)) {
    // Rank triplets are our own rendering of the code letters (S / A / B), not specification wording: they stay.
    if (name === 'decoded_label_counts' && isCountMap(entry) && !Object.keys(entry).every(label => /^[SABCZX](?: \/ [SABCZX])*$/u.test(label))) { out.push(['decoded_label_value_hash_distribution', hashedDistribution(entry)]); continue; }
    if (name === 'floor_labels_present_literally' && Array.isArray(entry) && entry.every(item => typeof item === 'string')) {
      const counts = isCountMap(value.floor_label_counts) ? value.floor_label_counts : null;
      const rows: Array<HashedValue & { count?: number }> = (entry as string[]).map(label => counts && typeof counts[label] === 'number' ? { ...hashedValue(label), count: counts[label]! } : hashedValue(label));
      out.push(['floor_label_value_hash_distribution', rows.sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || (a.value_sha256 < b.value_sha256 ? -1 : a.value_sha256 > b.value_sha256 ? 1 : 0))]);
      continue;
    }
    if (name === 'floor_label_counts' && 'floor_labels_present_literally' in value) continue;
    if (name === 'categorical_values' && isRecord(entry)) { out.push([name, Object.fromEntries(Object.entries(entry).map(([field, map]) => [field, isRecord(map) ? splitCodeMap(map) : map]))]); continue; }
    if ((name === 'distinct_values' || name === 'literal_value_distribution') && isRecord(entry)) { out.push([name, splitCodeMap(entry)]); continue; }
    if ((name === 'start_floor' || name === 'end_floor') && typeof entry === 'string') { out.push([name, hashIfFree(entry)]); continue; }
    if ((name === 'missing_node_id' && parent === 'dangling_links') || (name === 'node_id' && parent === 'self_loops')) { out.push([name, hashIfFree(entry)]); continue; }
    out.push([name, COUNT_MAP_KEYS.has(name) ? entry : redact(entry, name, key)]);
  }
  return Object.fromEntries(out);
}

/**
 * Public form of a network report (or a gap packet / summary that embeds one): source labels, floor labels, free-text
 * code-map keys and identifier lists become hashes. Idempotent, so already-public input passes through unchanged.
 */
export function publicNetworkReport<T>(report: T): T { return redact(report, null, null) as T; }

/** Public form of a CityGML inventory summary: codelist (class b) labels become hashes; gml:id and gml:name (class a) stay. */
export function publicInventorySummary<T>(summary: T): T {
  const copy = JSON.parse(JSON.stringify(summary)) as Record<string, unknown>;
  const resolution = copy.codelist_resolution;
  if (Array.isArray(resolution)) copy.codelist_resolution = resolution.map(row => {
    if (!isRecord(row) || !('label' in row)) return row;
    const { label, ...rest } = row;
    return { ...rest, label_hash: typeof label === 'string' ? hashedValue(label) : null };
  });
  const compact = copy.compact_features;
  if (Array.isArray(compact)) copy.compact_features = compact.map(row => {
    if (!isRecord(row) || !('function_label' in row)) return row;
    const { function_label, ...rest } = row;
    return { ...rest, function_label_hash: typeof function_label === 'string' ? hashedValue(function_label) : null };
  });
  return copy as T;
}
