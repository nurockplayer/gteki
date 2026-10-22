import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { getStoreRoot, packageRoot } from './common.js';
import { object, POI_SOURCES } from './poi.js';
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
  const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return [] as string[]; throw error; });
  for (const name of names.filter(entry => entry.endsWith('.json')).sort()) {
    for (const literal of detailLiterals(JSON.parse(await readFile(join(directory, name), 'utf8')), minLength)) literals.set(literal, [...literals.get(literal) ?? [], name]);
  }
  return literals;
}

export type LiteralAllowlist = { terms: Set<string>; structural: Set<string> };

/**
 * Generic vocabulary that coincides with our own text (see codebooks/poi-literal-allowlist.json); it is not a source value.
 * Every term needs a written reason; `structural_values` (whole JSON values exempt for class (b), #129) need one too.
 */
export async function loadLiteralAllowlistFile(): Promise<LiteralAllowlist> {
  const parsed = JSON.parse(await readFile(join(packageRoot, 'codebooks', 'poi-literal-allowlist.json'), 'utf8')) as { terms?: unknown; justifications?: unknown; structural_values?: unknown; structural_justifications?: unknown };
  const strings = (value: unknown, name: string): string[] => { if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) throw new Error(`poi-literal-allowlist.json needs a string array \`${name}\``); return value as string[]; };
  const terms = new Set(strings(parsed.terms, 'terms')), structural = new Set(strings(parsed.structural_values ?? [], 'structural_values'));
  const reasons = (value: unknown, name: string, required: ReadonlySet<string>): void => {
    const entries = value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>) : null;
    if (!entries) throw new Error(`poi-literal-allowlist.json needs an object \`${name}\``);
    const given = new Map(entries);
    for (const term of required) { const reason = given.get(term); if (typeof reason !== 'string' || reason.trim().length < 20) throw new Error(`poi-literal-allowlist.json \`${name}\` needs a reason of at least 20 characters for "${term}"`); }
    for (const term of given.keys()) if (!required.has(term)) throw new Error(`poi-literal-allowlist.json \`${name}\` explains "${term}", which is not listed`);
  };
  reasons(parsed.justifications, 'justifications', terms);
  reasons(parsed.structural_justifications ?? {}, 'structural_justifications', structural);
  for (const term of structural) if (!terms.has(term)) throw new Error(`poi-literal-allowlist.json structural value "${term}" must also be a listed term`);
  return { terms, structural };
}

export async function loadLiteralAllowlist(): Promise<Set<string>> { return (await loadLiteralAllowlistFile()).terms; }

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

/** Every string key and string value of a parsed JSON document. */
function jsonStrings(value: unknown, into: string[]): string[] {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const item of value) jsonStrings(item, into);
  else if (value !== null && typeof value === 'object') for (const [key, item] of Object.entries(value)) { into.push(key); jsonStrings(item, into); }
  return into;
}

/** JSON files under `root` with a whole string value or key equal (NFKC, trimmed) to one of `terms`. */
export async function scanTreeForWholeValues(root: string, terms: ReadonlySet<string>): Promise<Array<{ file: string; count: number }>> {
  const leaks: Array<{ file: string; count: number }> = [];
  if (terms.size === 0) return leaks;
  const wanted = new Map([...terms].map(term => [term.normalize('NFKC').trim(), term]));
  for await (const path of textFiles(root)) {
    if (!/\.(?:json|geojson)$/iu.test(path)) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(await readFile(path, 'utf8')); } catch { continue; }
    const hits = new Set(jsonStrings(parsed, []).map(value => wanted.get(value.normalize('NFKC').trim())).filter((term): term is string => term !== undefined));
    if (hits.size) leaks.push({ file: path.slice(root.length + 1), count: hits.size });
  }
  return leaks;
}

function mergeLeaks(...lists: Array<Array<{ file: string; count: number }>>): Array<{ file: string; count: number }> {
  const byFile = new Map<string, number>();
  for (const list of lists) for (const { file, count } of list) byFile.set(file, (byFile.get(file) ?? 0) + count);
  return [...byFile].map(([file, count]) => ({ file, count })).sort((a, b) => a.file.localeCompare(b.file));
}

export type DetailProblem = { source_id: string; reason: 'missing' | 'hash_mismatch' | 'unregistered' | 'overlap'; detail: string };

/**
 * Every committed POI report names its store detail (`detail.store_path`, `sha256`, `bytes`). A PASS is only meaningful when
 * all of those details are present and byte-identical to what the report recorded, because otherwise the scan silently
 * covers a subset of the literals.
 */
export async function verifyPoiDetails(poiDocsDir: string, storeRoot: string = getStoreRoot()): Promise<DetailProblem[]> {
  const problems: DetailProblem[] = [];
  const present = (await readdir(poiDocsDir).catch(() => [] as string[])).filter(name => name.endsWith('.json')).map(name => name.slice(0, -'.json'.length));
  for (const sourceId of [...new Set([...POI_SOURCES, ...present])].sort()) {
    let report: any;
    try { report = JSON.parse(await readFile(join(poiDocsDir, `${sourceId}.json`), 'utf8')); } catch { problems.push({ source_id: sourceId, reason: 'missing', detail: 'committed POI report not readable' }); continue; }
    const storePath = report?.detail?.store_path, expectedSha = report?.detail?.sha256, expectedBytes = report?.detail?.bytes;
    if (typeof storePath !== 'string' || typeof expectedSha !== 'string' || typeof expectedBytes !== 'number') { problems.push({ source_id: sourceId, reason: 'missing', detail: 'report has no detail.store_path/sha256/bytes' }); continue; }
    const absolute = resolve(storeRoot, storePath), inside = relative(resolve(storeRoot), absolute);
    if (isAbsolute(storePath) || inside.startsWith('..') || isAbsolute(inside)) { problems.push({ source_id: sourceId, reason: 'missing', detail: `detail.store_path escapes the store: ${storePath}` }); continue; }
    let bytes: Buffer;
    try { bytes = await readFile(absolute); } catch { problems.push({ source_id: sourceId, reason: 'missing', detail: storePath }); continue; }
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== expectedSha || bytes.length !== expectedBytes) problems.push({ source_id: sourceId, reason: 'hash_mismatch', detail: `${storePath}: expected ${expectedSha} / ${expectedBytes} bytes, found ${sha} / ${bytes.length} bytes` });
  }
  return problems;
}

/**
 * The full guard: verifies every referenced detail, then scans `docsGisDir` against every detail present in the store
 * (stale or unreferenced details are extra inputs). FAIL on any leak, any missing or mismatched detail, or zero literals.
 */
export async function checkPoiLiterals(docsGisDir: string, storeRoot: string = getStoreRoot(), allowlist: ReadonlySet<string> = new Set(), wholeValueExempt: ReadonlySet<string> = new Set()) {
  const detailProblems = await verifyPoiDetails(join(docsGisDir, 'poi'), storeRoot);
  const literals = await storeDetailLiterals(storeRoot);
  // An allowlisted term is exempt only inside prose: as a whole JSON value or key it is still a leak, unless `wholeValueExempt` lists it.
  const wholeOnly = new Set<string>();
  for (const term of allowlist) if (literals.delete(term) && !wholeValueExempt.has(term)) wholeOnly.add(term);
  const leaks = mergeLeaks(await scanTreeForLiterals(docsGisDir, literals.keys()), await scanTreeForWholeValues(docsGisDir, wholeOnly));
  const status = leaks.length || detailProblems.length || literals.size === 0 ? 'FAIL' as const : 'PASS' as const;
  return { status, scanned_literals: literals.size, allowlisted_generic_terms: allowlist.size, detail_problems: detailProblems,
    ...(literals.size === 0 ? { error: 'no literals scanned (store out/poi empty or without free-text values)' } : {}), leaking_files: leaks };
}
