import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getStoreRoot, packageRoot } from './common.js';
import { object } from './poi.js';
import { ownValue } from './values.js';

/**
 * Leak guard for the public repo: committed reports under docs/gis must contain no literal source field value
 * from any POI source. The verbatim values live only in the git-ignored store detail reports (out/poi/*.json);
 * this module extracts them from there and scans the committed tree for any that appear.
 */
export const MIN_LITERAL_LENGTH = 4;
const TEXT_FILE = /\.(?:json|md|txt|csv|ya?ml|geojson)$/iu;

function addStrings(value: unknown, into: Set<string>, minLength: number, depth = 0): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Pure numbers are ubiquitous (ids, counts, coordinates) and carry no free-text value; they are not scanned.
    if (trimmed.length >= minLength && !/^[-+]?\d+(?:\.\d+)?$/u.test(trimmed)) into.add(value);
  } else if (Array.isArray(value)) { if (depth < 8) for (const item of value) addStrings(item, into, minLength, depth + 1); }
  else if (value !== null && typeof value === 'object') { if (depth < 8) for (const item of Object.values(value)) addStrings(item, into, minLength, depth + 1); }
}

/**
 * Every free-text value of one detail report: CSV cells, GeoJSON/HERE feature and entity properties, root properties
 * and navigation link/node records. Schema keys, geometry and numeric values are not literals.
 */
export function detailLiterals(detail: unknown, minLength = MIN_LITERAL_LENGTH): Set<string> {
  const found = new Set<string>();
  const rows = (value: unknown): void => { if (Array.isArray(value)) for (const item of value) addStrings(item, found, minLength); };
  if (Array.isArray(detail)) { rows(detail); return found; }
  for (const member of Object.values(object(detail))) {
    const root = object(member);
    for (const list of [root.features, root.entities]) if (Array.isArray(list)) for (const item of list) addStrings(ownValue(object(item), 'properties'), found, minLength);
    addStrings(root.properties, found, minLength);
    rows(root.l); rows(root.n);
  }
  return found;
}

/** Literals from every `out/poi/*.json` detail in the store (stale details included: they are equally private). */
export async function storeDetailLiterals(storeRoot: string = getStoreRoot(), minLength = MIN_LITERAL_LENGTH): Promise<Map<string, string[]>> {
  const directory = join(storeRoot, 'out', 'poi'), literals = new Map<string, string[]>();
  for (const name of (await readdir(directory)).filter(entry => entry.endsWith('.json')).sort()) {
    for (const literal of detailLiterals(JSON.parse(await readFile(join(directory, name), 'utf8')), minLength)) literals.set(literal, [...literals.get(literal) ?? [], name]);
  }
  return literals;
}

/** Generic vocabulary that coincides with our own text (see codebooks/poi-literal-allowlist.json); it is not a source value. */
export async function loadLiteralAllowlist(): Promise<Set<string>> {
  const parsed = JSON.parse(await readFile(join(packageRoot, 'codebooks', 'poi-literal-allowlist.json'), 'utf8')) as { terms?: unknown };
  if (!Array.isArray(parsed.terms) || parsed.terms.some(term => typeof term !== 'string')) throw new Error('poi-literal-allowlist.json needs a string array `terms`');
  return new Set(parsed.terms as string[]);
}

/** Literals present in `text`, verbatim or as the JSON-escaped form a report writer would emit. */
export function literalsInText(text: string, literals: Iterable<string>): string[] {
  const hits: string[] = [];
  for (const literal of literals) if (text.includes(literal) || text.includes(JSON.stringify(literal).slice(1, -1))) hits.push(literal);
  return hits;
}

async function* textFiles(root: string): AsyncGenerator<string> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* textFiles(path); else if (entry.isFile() && TEXT_FILE.test(entry.name)) yield path;
  }
}

/** Files under `root` that contain any literal, with the number of distinct literals found in each. */
export async function scanTreeForLiterals(root: string, literals: Iterable<string>): Promise<Array<{ file: string; count: number }>> {
  const list = [...literals], leaks: Array<{ file: string; count: number }> = [];
  for await (const path of textFiles(root)) {
    const hits = literalsInText(await readFile(path, 'utf8'), list);
    if (hits.length) leaks.push({ file: path.slice(root.length + 1), count: hits.length });
  }
  return leaks.sort((a, b) => a.file.localeCompare(b.file));
}
