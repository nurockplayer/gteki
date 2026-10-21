import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { getStoreRoot, getStoredSource, packageRoot } from './common.js';
import { checkPoiLiterals, detailLiterals, scanTreeForLiterals, MIN_LITERAL_LENGTH, type DetailProblem } from './poi-literals.js';
import { LITERAL_CLASSES } from './literal-classes.js';
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
  if (/\.csv$/iu.test(name)) return detailLiterals(parseCsv(bytes).rows);
  const parsed: unknown = JSON.parse(bytes.toString('utf8'));
  return detailLiterals({ [name]: parsed });
}

/** Labels of one MLIT walking-network codebook (the transcription of the specification's code tables). */
export function codebookLabels(codebook: unknown): Set<string> {
  const labels = new Set<string>();
  const visit = (value: unknown, depth = 0): void => {
    if (value === null || typeof value !== 'object' || depth > 8) return;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'label' && typeof entry === 'string') { if (entry.trim().length >= MIN_LITERAL_LENGTH && !/^[-+]?\d+(?:\.\d+)?$/u.test(entry.trim())) labels.add(entry); }
      else visit(entry, depth + 1);
    }
  };
  visit(codebook);
  return labels;
}

/** Descriptions of PLATEAU codelist dictionaries, as the inventory resolves them. */
export function codelistLabels(map: ReadonlyMap<string, string>): Set<string> {
  const labels = new Set<string>();
  for (const label of map.values()) if (label.trim().length >= MIN_LITERAL_LENGTH && !/^[-+]?\d+(?:\.\d+)?$/u.test(label.trim())) labels.add(label);
  return labels;
}

const problemOf = (sourceId: string, error: unknown): DetailProblem => ({ source_id: sourceId, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' || /ENOENT|no such file/iu.test(String(error)) ? 'missing' : 'hash_mismatch', detail: String(error instanceof Error ? error.message : error) });

/**
 * Class (b) literals from the hash-verified store copies. `getStoredSource` re-hashes the stored bytes against the
 * recorded acquisition, so a missing, altered or never-acquired copy surfaces as a problem for that source.
 */
export async function loadClassBLiterals(): Promise<ClassBResult> {
  const literals = new Map<string, string[]>(), problems: DetailProblem[] = [], perSource: ClassBResult['per_source'] = [];
  const record = (sourceId: string, found: Set<string>): void => {
    perSource.push({ source_id: sourceId, literal_count: add(literals, sourceId, found) });
    if (found.size === 0) problems.push({ source_id: sourceId, reason: 'missing', detail: 'no literals extracted from the stored source' });
  };
  for (const entry of LITERAL_CLASSES.filter(item => item.class === 'b')) {
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

export type CheckLiteralsOptions = {
  classB?: () => Promise<ClassBResult>;
  credits?: ReadonlyArray<{ source_id: string; attribution_text: string }>;
  classificationFile?: string;
  skipPoi?: boolean;
};

/**
 * `gis check-literals` (alias `check-poi-literals`): the POI guard of #128 plus the class (b) guard of #129. FAIL on any
 * leak, missing or altered detail, empty literal set or missing credit.
 */
export async function checkLiterals(docsGisDir: string, storeRoot: string = getStoreRoot(), allowlist: ReadonlySet<string> = new Set(), options: CheckLiteralsOptions = {}) {
  const poi = options.skipPoi ? null : await checkPoiLiterals(docsGisDir, storeRoot, allowlist);
  const classB = await (options.classB ?? loadClassBLiterals)();
  const reportProblems = await verifyReportDetails(docsGisDir, storeRoot);
  for (const term of allowlist) classB.literals.delete(term);
  const leaks = await scanTreeForLiterals(docsGisDir, classB.literals.keys());
  const credits = options.credits ?? await defaultCredits();
  const creditProblems = await verifyCredits(options.classificationFile ?? join(docsGisDir, 'rights', 'non-poi-literals.md'), credits);
  const nonPoiProblems = [...classB.problems, ...reportProblems];
  const nonPoi = {
    status: leaks.length || nonPoiProblems.length || creditProblems.length || classB.literals.size === 0 ? 'FAIL' as const : 'PASS' as const,
    scanned_literals: classB.literals.size, per_source: classB.per_source, detail_problems: nonPoiProblems, credit_problems: creditProblems,
    ...(classB.literals.size === 0 ? { error: 'no class (b) literals scanned' } : {}), leaking_files: leaks };
  const status = nonPoi.status === 'FAIL' || (poi !== null && poi.status === 'FAIL') ? 'FAIL' as const : 'PASS' as const;
  return { status, poi, non_poi: nonPoi };
}

async function defaultCredits(): Promise<Array<{ source_id: string; attribution_text: string }>> {
  const { loadSources } = await import('./acquire.js');
  const sources = loadSources();
  return LITERAL_CLASSES.filter(entry => entry.class === 'a').map(entry => ({ source_id: entry.source_id, attribution_text: sources.find(source => source.source_id === entry.source_id)?.attribution_text ?? '' }));
}


/**
 * Replace every class (b) literal in `text` with `value_sha256:<hex>` (verbatim and JSON-escaped forms; longest literal
 * first so a shorter label never cuts into a longer one). Used for frozen snapshots that no generator can rebuild offline.
 */
export function scrubText(text: string, literals: Iterable<string>): { text: string; replaced: number } {
  let result = text, replaced = 0;
  for (const literal of [...new Set(literals)].sort((a, b) => b.length - a.length || (a < b ? -1 : 1))) {
    const token = `value_sha256:${valueSha256(literal)}`;
    for (const form of new Set([literal, JSON.stringify(literal).slice(1, -1)])) {
      if (!form || !result.includes(form)) continue;
      const parts = result.split(form);
      replaced += parts.length - 1;
      result = parts.join(token);
    }
  }
  return { text: result, replaced };
}

async function* scrubTargets(path: string): AsyncGenerator<string> {
  if ((await stat(path)).isDirectory()) { for (const entry of (await readdir(path)).sort()) yield* scrubTargets(join(path, entry)); }
  else if (/\.(?:json|md|txt|csv|ya?ml|geojson)$/iu.test(path)) yield path;
}

/**
 * `gis scrub-literals <path...>`: one-time offline migration of committed files that no generator rebuilds without a
 * real run (history snapshots, the real-data summary, prose that quotes an identifier). Deterministic and idempotent;
 * JSON files must still parse afterwards. The fresh generators (inventory, network, summarize) write the structured form.
 */
export async function scrubLiterals(docsGisDir: string, targets: string[], allowlist: ReadonlySet<string>, classB?: ClassBResult): Promise<Array<{ file: string; replaced: number }>> {
  const loaded = classB ?? await loadClassBLiterals();
  if (loaded.problems.length) throw new Error(`Class (b) literals unavailable: ${loaded.problems.map(problem => `${problem.source_id} ${problem.reason}`).join('; ')}`);
  const literals = [...loaded.literals.keys()].filter(literal => !allowlist.has(literal));
  const changed: Array<{ file: string; replaced: number }> = [];
  for (const target of targets) {
    const absolute = resolve(docsGisDir, target);
    if (relative(resolve(docsGisDir), absolute).startsWith('..')) throw new Error(`Scrub target escapes docs/gis: ${target}`);
    for await (const file of scrubTargets(absolute)) {
      const before = await readFile(file, 'utf8'), after = scrubText(before, literals);
      if (after.replaced === 0) continue;
      if (file.endsWith('.json')) JSON.parse(after.text);
      await writeFile(file, after.text);
      changed.push({ file: relative(resolve(docsGisDir), file).split(sep).join('/'), replaced: after.replaced });
    }
  }
  return changed;
}
