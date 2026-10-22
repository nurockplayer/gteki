import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { getStoreRoot, getStoredSource, packageRoot } from './common.js';
import { checkPoiLiterals, detailLiterals, type DetailProblem } from './poi-literals.js';
import { SUBSTRING_MIN_LENGTH, buildMatcher, isWording, literalsInProse, nfkc, redactProse, wholeValueLiteral, type LiteralMatcher } from './literal-match.js';
import { CreditUnavailableError, EXEMPT_PATHS, LITERAL_CLASSES, classACredit } from './literal-classes.js';
import { parseCsv } from './network.js';
import { readZip } from './zip.js';
import { valueSha256 } from './poi.js';

/**
 * Leak guard for non-POI source literals (issue #129, extends #124/#128). Class (b) sources (unclear or no-release
 * terms; docs/gis/rights/non-poi-literals.md) may not appear verbatim anywhere under docs/gis. Their literals are read
 * from the hash-verified store copies of the sources, not from the committed reports; a missing or altered store copy,
 * a missing or altered report detail, or a source that yields no literals is a FAIL, never a quiet PASS.
 */
export type ClassBResult = { literals: Map<string, string[]>; problems: DetailProblem[]; per_source: Array<{ source_id: string; literal_count: number }> };

const add = (into: Map<string, string[]>, sourceId: string, values: Iterable<string>): number => {
  let count = 0;
  for (const value of values) { into.set(value, [...new Set([...into.get(value) ?? [], sourceId])]); count++; }
  return count;
};

/** Free-text values of Hokonavi rows: CSV cells or GeoJSON feature and root properties. */
export function hokonaviLiterals(name: string, bytes: Buffer): Set<string> {
  const found = /\.csv$/iu.test(name) ? detailLiterals(parseCsv(bytes).rows, 1) : detailLiterals({ [name]: JSON.parse(bytes.toString('utf8')) as unknown }, 1);
  return new Set([...found].filter(isWording));
}

/** Labels of one MLIT walking-network codebook (the transcription of the specification's code tables). */
export function codebookLabels(codebook: unknown): Set<string> {
  const labels = new Set<string>();
  const visit = (value: unknown, depth = 0): void => {
    if (value === null || typeof value !== 'object' || depth > 8) return;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'label' && typeof entry === 'string') { if (isWording(entry)) labels.add(entry); }
      else visit(entry, depth + 1);
    }
  };
  visit(codebook);
  return labels;
}

/** Descriptions of PLATEAU codelist dictionaries, as the inventory resolves them. */
export function codelistLabels(map: ReadonlyMap<string, string>): Set<string> {
  const labels = new Set<string>();
  for (const label of map.values()) if (isWording(label)) labels.add(label);
  return labels;
}

const problemOf = (sourceId: string, error: unknown): DetailProblem => ({ source_id: sourceId, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' || /ENOENT|no such file/iu.test(String(error)) ? 'missing' : 'hash_mismatch', detail: String(error instanceof Error ? error.message : error) });

/**
 * Class (b) literals from the hash-verified store copies. `getStoredSource` re-hashes the stored bytes against the
 * recorded acquisition, so a missing, altered or never-acquired copy surfaces as a problem for that source.
 */
export const loadClassBLiterals = (): Promise<ClassBResult> => loadLiterals('b');
const isMlitOwner = (id: string): boolean => id.startsWith('mlit-walk-network-spec-');
const isE27Owner = (id: string): boolean => id.startsWith('hokonavi-oedo-shinjuku-');

/**
 * A class (b) word that is identical to an MLIT specification label is public through that specification (the PLATEAU
 * codelist descriptions `階段` and `横断歩道` are examples), so it cannot be a class (b) secret. Only MLIT owners deduct:
 * a re-acquired Ikebukuro value equal to an E27 or codelist literal stays guarded. If a deducted word is also owned by Hokonavi
 * E27 the check fails (and the word stays guarded), because E27 values must never be unguarded through an MLIT label.
 * Returns the class (b) literals without the deducted words, the deducted words, and the class (a) words that shield short
 * literals inside them (`known`).
 */
export function withoutClassA(classB: ClassBResult, classA: ClassBResult): ClassBResult & { overlap: string[]; known: string[] } {
  const owners = new Map<string, string[]>();
  for (const [literal, ids] of classA.literals) { const key = nfkc(literal).trim(); owners.set(key, [...new Set([...owners.get(key) ?? [], ...ids])]); }
  const literals = new Map<string, string[]>(), overlap: string[] = [], problems = [...classB.problems];
  for (const [literal, ids] of classB.literals) {
    const classAOwners = owners.get(nfkc(literal).trim()) ?? [];
    if (!classAOwners.some(isMlitOwner)) { literals.set(literal, ids); continue; }
    if (ids.some(isE27Owner)) {
      for (const id of ids.filter(isE27Owner)) problems.push({ source_id: id, reason: 'overlap', detail: `an E27 value (sha256 ${valueSha256(literal)}) equals an MLIT specification label; it stays guarded and needs a decision before the check can pass` });
      literals.set(literal, ids); continue;
    }
    overlap.push(literal);
  }
  return { literals, problems, per_source: classB.per_source.map(row => ({ ...row, literal_count: [...literals.values()].filter(ids => ids.includes(row.source_id)).length })), overlap: overlap.sort(), known: [...owners.keys()] };
}

/** Class (b) literals for the guard and the scrub: store-derived, without words that an MLIT specification makes public. */
export async function loadClassBMinusA(): Promise<ClassBResult & { overlap: string[]; known: string[] }> { return withoutClassA(await loadClassBLiterals(), await loadClassALiterals()); }

/** Class (a) source wording read from the store (Ikebukuro Hokonavi values, MLIT specification labels); CityGML names come from the committed inventories. */
export const loadClassALiterals = (): Promise<ClassBResult> => loadLiterals('a');

async function loadLiterals(cls: 'a' | 'b'): Promise<ClassBResult> {
  const literals = new Map<string, string[]>(), problems: DetailProblem[] = [], perSource: ClassBResult['per_source'] = [];
  const record = (sourceId: string, found: Set<string>): void => {
    perSource.push({ source_id: sourceId, literal_count: add(literals, sourceId, found) });
    if (found.size === 0) problems.push({ source_id: sourceId, reason: 'missing', detail: 'no literals extracted from the stored source' });
  };
  for (const entry of LITERAL_CLASSES.filter(item => item.class === cls && item.kind !== 'citygml' && item.kind !== 'unquoted')) {
    try {
      const stored = await getStoredSource(entry.source_id);
      if (entry.kind === 'hokonavi') {
        const bytes = await readFile(stored.path), found = new Set<string>();
        if (/\.zip$/iu.test(stored.path)) for (const member of await readZip(stored.path)) { if (/\.(?:geo)?json$/iu.test(member.name)) for (const value of hokonaviLiterals(member.name, member.data)) found.add(value); }
        else for (const value of hokonaviLiterals(stored.path, bytes)) found.add(value);
        record(entry.source_id, found);
      } else if (entry.kind === 'mlit-spec') {
        const found = new Set<string>();
        for (const version of ['2018-03', '2024-07']) {
          const book = JSON.parse(await readFile(join(packageRoot, 'codebooks', `mlit-walk-network-${version}.json`), 'utf8')) as { spec_source_id?: string; spec_sha256?: string };
          if (book.spec_source_id !== entry.source_id) continue;
          if (book.spec_sha256 !== stored.record.sha256) throw new Error(`Codebook specification hash mismatch: ${version}`);
          for (const label of codebookLabels(book)) found.add(label);
        }
        record(entry.source_id, found);
      } else {
        const { loadCodelists } = await import('./citygml.js');
        record(entry.source_id, codelistLabels(await loadCodelists(entry.source_id)));
      }
    } catch (error) { problems.push(problemOf(entry.source_id, error)); }
  }
  return { literals, problems, per_source: perSource };
}

/**
 * Committed reports that name a store detail (`detail` for networks, `feature_tree` for CityGML inventories) must find it
 * in the store, byte-identical to what the report recorded.
 */
export async function verifyReportDetails(docsGisDir: string, storeRoot: string = getStoreRoot()): Promise<DetailProblem[]> {
  const problems: DetailProblem[] = [];
  for (const [directory, pick, suffix] of [['networks', (r: any) => r?.detail, '.json'], ['inventory', (r: any) => r?.feature_tree, '.inventory.json']] as const) {
    const names = (await readdir(join(docsGisDir, directory)).catch(() => [] as string[])).filter(name => name.endsWith(suffix)).sort();
    for (const name of names) {
      const sourceId = name.slice(0, -suffix.length);
      let report: unknown;
      try { report = JSON.parse(await readFile(join(docsGisDir, directory, name), 'utf8')); } catch { problems.push({ source_id: sourceId, reason: 'missing', detail: `committed ${directory} report not readable` }); continue; }
      const pointer = pick(report), storePath = pointer?.store_path, sha256 = pointer?.sha256, bytes = pointer?.bytes;
      if (typeof storePath !== 'string' || typeof sha256 !== 'string' || typeof bytes !== 'number') { if (directory === 'networks' || (report as any)?.totals) problems.push({ source_id: sourceId, reason: 'missing', detail: `${directory}/${name} has no detail store_path/sha256/bytes` }); continue; }
      const absolute = resolve(storeRoot, storePath), inside = relative(resolve(storeRoot), absolute);
      if (isAbsolute(storePath) || inside.startsWith('..') || isAbsolute(inside)) { problems.push({ source_id: sourceId, reason: 'missing', detail: `detail store_path escapes the store: ${storePath}` }); continue; }
      let content: Buffer;
      try { content = await readFile(absolute); } catch { problems.push({ source_id: sourceId, reason: 'missing', detail: storePath }); continue; }
      const actual = createHash('sha256').update(content).digest('hex');
      if (actual !== sha256 || content.length !== bytes) problems.push({ source_id: sourceId, reason: 'hash_mismatch', detail: `${storePath}: expected ${sha256} / ${bytes} bytes, found ${actual} / ${content.length} bytes` });
    }
  }
  return problems;
}

/**
 * Class (a) values stay in committed reports only with their credit. The attribution text recorded for each class (a)
 * source must appear verbatim in the classification file, next to the table that lists those fields.
 */
export async function verifyCredits(classificationFile: string, credits: ReadonlyArray<{ source_id: string; attribution_text: string }>): Promise<Array<{ source_id: string; reason: string }>> {
  let text: string;
  try { text = await readFile(classificationFile, 'utf8'); } catch { return credits.length ? [{ source_id: '*', reason: 'classification file docs/gis/rights/non-poi-literals.md is missing' }] : []; }
  return credits.filter(credit => !credit.attribution_text || credit.attribution_text === 'unknown' || !text.includes(credit.attribution_text)).map(credit => ({ source_id: credit.source_id, reason: 'credit text absent from the classification file' }));
}

export const CREDIT_POINTER = 'rights/non-poi-literals.md';
const TEXT_FILE = /\.(?:json|md|txt|csv|ya?ml|geojson)$/iu;
const JSON_FILE = /\.(?:geo)?json$/iu;

async function* textFiles(root: string): AsyncGenerator<string> {
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* textFiles(path); else if (entry.isFile() && TEXT_FILE.test(entry.name)) yield path;
  }
}

/** Every string key and string value of a parsed JSON document. */
function jsonStrings(value: unknown, into: string[]): string[] {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const item of value) jsonStrings(item, into);
  else if (value !== null && typeof value === 'object') for (const [key, item] of Object.entries(value)) { into.push(key); jsonStrings(item, into); }
  return into;
}

/** Class (b) literals found in one committed file: whole JSON strings and keys exactly, wording inside prose by the rules of literal-match.ts. */
export function literalsInFile(name: string, text: string, matcher: LiteralMatcher): string[] {
  if (JSON_FILE.test(name)) {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return literalsInProse(text, matcher); }
    const strings = jsonStrings(parsed, []), hits = new Set<string>();
    for (const value of strings) { const whole = wholeValueLiteral(value, matcher); if (whole !== null) hits.add(whole); }
    // One prose pass over all strings (newline-joined, so no word spans two strings) keeps large reports fast.
    for (const hit of literalsInProse(strings.join('\n'), matcher)) hits.add(hit);
    return [...hits];
  }
  return literalsInProse(text, matcher);
}

/** Files under `root` that contain any class (b) literal, with the number of distinct literals found in each. */
export async function scanTreeForClassB(root: string, matcher: LiteralMatcher): Promise<Array<{ file: string; count: number }>> {
  const leaks: Array<{ file: string; count: number }> = [];
  for await (const path of textFiles(root)) {
    const hits = literalsInFile(path, await readFile(path, 'utf8'), matcher);
    if (hits.length) leaks.push({ file: path.slice(root.length + 1).split(sep).join('/'), count: hits.length });
  }
  return leaks.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const readJsonOrNull = async (path: string): Promise<unknown> => { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } };

/**
 * Every network and inventory report must name sources the classification knows. A new source that nobody classified
 * would otherwise be scanned against nothing and pass.
 */
export async function verifyRegistered(docsGisDir: string, registered: ReadonlySet<string> = new Set(LITERAL_CLASSES.map(entry => entry.source_id))): Promise<DetailProblem[]> {
  const problems: DetailProblem[] = [];
  for (const [directory, suffix] of [['networks', '.json'], ['inventory', '.inventory.json']] as const) {
    for (const name of (await readdir(join(docsGisDir, directory)).catch(() => [] as string[])).filter(entry => entry.endsWith(suffix)).sort()) {
      const doc = await readJsonOrNull(join(docsGisDir, directory, name));
      if (!isRecord(doc)) continue;
      const ids = new Set<string>();
      if (typeof doc.source_id === 'string') for (const id of doc.source_id.split('+')) ids.add(id);
      if (Array.isArray(doc.members)) for (const member of doc.members) if (isRecord(member) && typeof member.source_id === 'string') ids.add(member.source_id);
      for (const id of [...ids].sort()) if (!registered.has(id)) problems.push({ source_id: id, reason: 'unregistered', detail: `${directory}/${name} names a source that is not in LITERAL_CLASSES (docs/gis/rights/non-poi-literals.md)` });
    }
  }
  return problems;
}

type Credit = { source_id: string; attribution_text: string };

/** Class (a) wording kept in committed inventories: gml:name text and literal floor-label observations, by source. */
export function classAWording(inventories: Iterable<unknown>): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const add = (value: string, sourceId: string): void => { const key = nfkc(value).trim(); if (key.length >= 4) found.set(key, [...new Set([...found.get(key) ?? [], sourceId])]); };
  for (const doc of inventories) {
    if (!isRecord(doc)) continue;
    const sourceId = typeof doc.source_id === 'string' ? doc.source_id : '';
    if (Array.isArray(doc.floor_label_observations)) for (const row of doc.floor_label_observations) if (isRecord(row) && typeof row.value === 'string') add(row.value, sourceId);
    if (Array.isArray(doc.compact_features)) for (const row of doc.compact_features) if (isRecord(row) && Array.isArray(row.names)) for (const name of row.names) if (typeof name === 'string') add(name, sourceId);
  }
  return found;
}

/**
 * Class (a) values stay in committed files only with their credit. A file that keeps any class (a) wording (inventory
 * names, Ikebukuro Hokonavi values, MLIT specification labels) must carry the recorded credit of the source(s) behind that
 * wording or point at the classification file. Generated reports (inventory, gaps, networks) must carry the credit text
 * itself, in the Markdown companion and in a structured `credit` field of the JSON. Frozen history snapshots are covered
 * by history/README.md. Wording of four or more characters detects a file, and so does any MLIT specification label of any length; allowlisted generic
 * terms never count.
 */
/** Short class (a) labels that appear as data: a whole JSON string or key, or a whole line / table cell / list item of other text. */
function shortLabelHits(name: string, text: string, short: ReadonlySet<string>): string[] {
  if (short.size === 0) return [];
  let cells: string[];
  if (JSON_FILE.test(name)) {
    try { cells = jsonStrings(JSON.parse(text), []); } catch { cells = [text]; }
  } else cells = text.split('\n').flatMap(line => line.split('|')).map(cell => cell.replace(/^\s*(?:[-*+]\s+)?`?/u, '').replace(/`?\s*$/u, ''));
  return [...new Set(cells.map(cell => nfkc(cell).trim()).filter(cell => short.has(cell)))];
}

export async function verifyClassACredits(docsGisDir: string, credits: ReadonlyArray<Credit>, options: { classA?: ReadonlyMap<string, string[]>; allowlist?: ReadonlySet<string> } = {}): Promise<Array<{ file: string; reason: string }>> {
  const problems: Array<{ file: string; reason: string }> = [];
  const textOf = (sourceId: string): string => credits.find(credit => credit.source_id === sourceId)?.attribution_text ?? '';
  const inventories: unknown[] = [];
  for (const name of (await readdir(join(docsGisDir, 'inventory')).catch(() => [] as string[])).filter(entry => entry.endsWith('.inventory.json')).sort()) inventories.push(await readJsonOrNull(join(docsGisDir, 'inventory', name)));
  const owners = classAWording(inventories);
  for (const [literal, ids] of options.classA ?? []) { const key = nfkc(literal).trim(); if (key.length >= 4 || ids.some(isMlitOwner)) owners.set(key, [...new Set([...owners.get(key) ?? [], ...ids])]); }
  if (owners.size === 0) return problems;
  const allow = options.allowlist ?? new Set<string>();
  // Wording of four or more characters is found anywhere. A short MLIT label (`階段`, `なし`) is ordinary prose when it sits inside a sentence,
  // so it demands the credit only where it is data: a whole JSON string/key, or a whole line / table cell of a text file.
  const short = new Set([...owners.keys()].filter(key => key.length < SUBSTRING_MIN_LENGTH && !allow.has(key)));
  const matcher = buildMatcher([...owners.keys()].filter(key => !short.has(key) && (key.length >= SUBSTRING_MIN_LENGTH || allow.has(key))), allow, allow);
  const history = await readFile(join(docsGisDir, 'history', 'README.md'), 'utf8').catch(() => '');
  const generated = /^(?:inventory|gaps|networks)\//u;
  for await (const path of textFiles(docsGisDir)) {
    const file = path.slice(docsGisDir.length + 1).split(sep).join('/');
    if (file === CREDIT_POINTER) continue;
    const text = await readFile(path, 'utf8');
    const hits = [...new Set([...literalsInFile(path, text, matcher), ...shortLabelHits(path, text, short)])];
    if (hits.length === 0) continue;
    // A hit is credited when any source that owns the wording has its credit text in the file (or, for hand-written and frozen files, a pointer).
    const credited = (haystack: string): boolean => hits.every(hit => (owners.get(hit) ?? []).some(id => { const credit = textOf(id); return credit !== '' && haystack.includes(credit); }));
    if (generated.test(file)) {
      if (!credited(text)) problems.push({ file, reason: 'keeps class (a) values without the recorded credit text of their source' });
      if (JSON_FILE.test(file)) {
        const doc = JSON.parse(text) as Record<string, unknown>, credit = isRecord(doc.credit) ? doc.credit : null;
        if (!credit || typeof credit.attribution_text !== 'string' || typeof credit.classification !== 'string' || !credit.classification.includes(CREDIT_POINTER) || !credited(credit.attribution_text)) problems.push({ file, reason: 'class (a) values without a `credit` field (attribution_text and classification) naming the recorded credit' });
      }
    } else if (!(text.includes(CREDIT_POINTER) || credited(text) || (file.startsWith('history/') && (history.includes(CREDIT_POINTER) || credited(history))))) {
      problems.push({ file, reason: 'keeps class (a) values without the credit or a pointer to docs/gis/rights/non-poi-literals.md' });
    }
  }
  return problems.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : cmpText(a.reason, b.reason)));
}
const cmpText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export type CheckLiteralsOptions = {
  /** Directory of the acquisition records the MLIT credit text is composed from (default docs/gis/acquisitions). */
  acquisitionsDir?: string;
  classB?: () => Promise<ClassBResult>;
  credits?: ReadonlyArray<Credit>;
  classificationFile?: string;
  registered?: ReadonlySet<string>;
  classA?: () => Promise<ClassBResult>;
  /** Allowlisted terms that are also exempt as whole JSON values (codebooks `structural_values`). */
  structural?: ReadonlySet<string>;
  skipPoi?: boolean;
};

/**
 * `gis check-literals` (alias `check-poi-literals`): the POI guard of #128 plus the class (b) guard of #129. FAIL on any
 * leak, missing or altered detail, unregistered source, empty literal set, or missing class (a) credit.
 */
export async function checkLiterals(docsGisDir: string, storeRoot: string = getStoreRoot(), allowlist: ReadonlySet<string> = new Set(), options: CheckLiteralsOptions = {}) {
  // Injected class (b) literals (tests) come without a store, so class (a) wording is empty unless injected too.
  const classAResult = await (options.classA ?? (options.classB ? async (): Promise<ClassBResult> => ({ literals: new Map(), problems: [], per_source: [] }) : loadClassALiterals))();
  // A whole POI value equal to an allowlisted term leaks unless structural or a credited MLIT specification label (public, Owner decision (ii)).
  const mlitLabels = [...classAResult.literals].filter(([, ids]) => ids.some(isMlitOwner)).map(([literal]) => literal);
  const poi = options.skipPoi ? null : await checkPoiLiterals(docsGisDir, storeRoot, allowlist, new Set([...options.structural ?? [], ...mlitLabels]));
  const classB = withoutClassA(await (options.classB ?? loadClassBLiterals)(), classAResult);
  const reportProblems = await verifyReportDetails(docsGisDir, storeRoot);
  const unregistered = await verifyRegistered(docsGisDir, options.registered);
  const matcher = buildMatcher(classB.literals.keys(), allowlist, options.structural, classB.known);
  const leaks = await scanTreeForClassB(docsGisDir, matcher);
  const recorded = options.credits ? { credits: options.credits, problems: [] as Array<{ source_id: string; reason: string }> } : await defaultCredits({ acquisitionsDir: options.acquisitionsDir });
  const credits = recorded.credits;
  const creditProblems = [...recorded.problems, ...await verifyCredits(options.classificationFile ?? join(docsGisDir, 'rights', 'non-poi-literals.md'), credits)];
  const fileCredits = await verifyClassACredits(docsGisDir, credits, { classA: classAResult.literals, allowlist });
  const nonPoiProblems = [...classB.problems, ...classAResult.problems, ...reportProblems, ...unregistered];
  const nonPoi = {
    status: leaks.length || nonPoiProblems.length || creditProblems.length || fileCredits.length || classB.literals.size === 0 ? 'FAIL' as const : 'PASS' as const,
    scanned_literals: classB.literals.size, per_source: classB.per_source, public_through_class_a: classB.overlap, detail_problems: nonPoiProblems, credit_problems: creditProblems, file_credit_problems: fileCredits,
    ...(classB.literals.size === 0 ? { error: 'no class (b) literals scanned' } : {}), leaking_files: leaks,
    // Listed so the exemption is visible; these paths are never read by the scan.
    exempt_paths: EXEMPT_PATHS.map(entry => ({ path: entry.path, basis: entry.basis })) };
  const status = nonPoi.status === 'FAIL' || (poi !== null && poi.status === 'FAIL') ? 'FAIL' as const : 'PASS' as const;
  return { status, poi, non_poi: nonPoi };
}

/** The recorded credit text of every class (a) source; a source whose credit cannot be composed from the records is a problem, never a fallback. */
export async function defaultCredits(options: { acquisitionsDir?: string } = {}): Promise<{ credits: Credit[]; problems: Array<{ source_id: string; reason: string }> }> {
  const credits: Credit[] = [], problems: Array<{ source_id: string; reason: string }> = [];
  for (const entry of LITERAL_CLASSES.filter(item => item.class === 'a')) {
    try { credits.push({ source_id: entry.source_id, attribution_text: (await classACredit(entry.source_id, options))?.attribution_text ?? '' }); }
    catch (error) { if (!(error instanceof CreditUnavailableError)) throw error; problems.push({ source_id: entry.source_id, reason: error.reason }); credits.push({ source_id: entry.source_id, attribution_text: '' }); }
  }
  return { credits, problems };
}

/** Replace class (b) literals in a JSON document (whole strings and keys) or prose; used by `scrubLiterals`. */
function scrubJson(value: unknown, matcher: LiteralMatcher, token: (original: string) => string, count: { n: number }): unknown {
  const text = (input: string): string => {
    const whole = wholeValueLiteral(input, matcher);
    if (whole !== null) { count.n++; return token(matcher.literals.get(whole)!); }
    const result = redactProse(input, matcher, token);
    count.n += result.replaced;
    return result.text;
  };
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value)) return value.map(item => scrubJson(item, matcher, token, count));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [text(key), scrubJson(item, matcher, token, count)]));
  return value;
}

/**
 * Replace every class (b) literal in `text` (verbatim, NFKC-aware, longest first) with `value_sha256:<hex>`. A literal is
 * never replaced inside a longer known term (`エスカレータ` inside `エスカレーター`) or inside an allowlisted generic term.
 */
export function scrubText(text: string, literals: Iterable<string>, allowlist: Iterable<string> = [], structural: Iterable<string> = [], known: Iterable<string> = []): { text: string; replaced: number } {
  return redactProse(text, buildMatcher(literals, allowlist, structural, known), original => `value_sha256:${valueSha256(original)}`);
}

async function* scrubTargets(path: string): AsyncGenerator<string> {
  if ((await stat(path)).isDirectory()) { for (const entry of (await readdir(path)).sort()) yield* scrubTargets(join(path, entry)); }
  else if (TEXT_FILE.test(path)) yield path;
}

/**
 * `gis scrub-literals <path...>`: one-time offline migration of committed files that no generator rebuilds without a
 * real run (history snapshots, the real-data summary, prose that quotes an identifier). Deterministic and idempotent.
 * JSON is parsed and only whole string values, keys and wording inside strings are rewritten, then written back in the
 * 2-space form the generators use; a JSON file that does not round-trip in that form is refused instead of reformatted.
 * The fresh generators (inventory, network, summarize) write the structured `{ value_sha256, value_type, count }` form.
 */
export async function scrubLiterals(docsGisDir: string, targets: string[], allowlist: ReadonlySet<string>, classB?: ClassBResult, structural: ReadonlySet<string> = new Set()): Promise<Array<{ file: string; replaced: number }>> {
  const loaded = classB ?? await loadClassBMinusA();
  if (loaded.problems.length) throw new Error(`Class (b) literals unavailable: ${loaded.problems.map(problem => `${problem.source_id} ${problem.reason}`).join('; ')}`);
  const matcher = buildMatcher(loaded.literals.keys(), allowlist, structural, (loaded as { known?: string[] }).known ?? []), token = (original: string): string => `value_sha256:${valueSha256(original)}`;
  const changed: Array<{ file: string; replaced: number }> = [];
  for (const target of targets) {
    const absolute = resolve(docsGisDir, target);
    if (relative(resolve(docsGisDir), absolute).startsWith('..')) throw new Error(`Scrub target escapes docs/gis: ${target}`);
    for await (const file of scrubTargets(absolute)) {
      const before = await readFile(file, 'utf8'), name = relative(resolve(docsGisDir), file).split(sep).join('/');
      let after: string, replaced: number;
      if (JSON_FILE.test(file)) {
        const parsed: unknown = JSON.parse(before), count = { n: 0 };
        if (`${JSON.stringify(parsed, null, 2)}\n` !== before) {
          if (literalsInFile(file, before, matcher).length === 0) continue;
          throw new Error(`Refusing to rewrite ${name}: it is not 2-space JSON with a trailing newline, so a structural rewrite would reformat it`);
        }
        const scrubbed = scrubJson(parsed, matcher, token, count);
        after = `${JSON.stringify(scrubbed, null, 2)}\n`; replaced = count.n;
      } else ({ text: after, replaced } = redactProse(before, matcher, token));
      if (replaced === 0) continue;
      await writeFile(file, after);
      changed.push({ file: name, replaced });
    }
  }
  return changed;
}
