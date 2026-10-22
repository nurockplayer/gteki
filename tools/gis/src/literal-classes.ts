import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { docsRoot, readJson } from './common.js';
import { isWording } from './literal-match.js';

/**
 * Classification of the non-POI sources whose values appear in committed GIS reports (issue #129), from recorded evidence
 * only. (a) the record shows a licence that covers that specific resource; (b) terms unclear or no-release. Unknown stays
 * unknown: nothing here invents a licence. The generated table is docs/gis/rights/non-poi-literals.md.
 */
/** `unquoted`: no text of this source is quoted in any committed report, so nothing is extracted from it. */
export type LiteralKind = 'citygml' | 'codelists' | 'hokonavi' | 'mlit-spec' | 'unquoted';
export type LiteralClassEntry = { source_id: string; class: 'a' | 'b'; kind: LiteralKind; values: string; basis: string; evidence: string[] };

const SOURCES = 'tools/gis/sources/sources.yaml';
const RESEARCH = 'docs/research/GTEki_Public_Data_Research_2026-10-20.md';
const OWNER_Q = 'docs/gis/decisions/owner-rights-questions.md';
const CODES = 'docs/gis/research/network-codes-and-coverage.md';
const ubld = (id: string): LiteralClassEntry => ({
  source_id: id, class: 'a', kind: 'citygml', values: 'gml:id and gml:name text',
  basis: 'The record names a licence and credit for this resource; the credit stays with the values. Publish gate CONDITIONAL. Owner question 8 (identity of the catalog-API file versus the CKAN-listed upload): Accept, recorded on #39 comment 6324726321 and in docs/gis/decisions/2026-10-22-owner-rights-answers.md (via #117).',
  evidence: [SOURCES, `${RESEARCH}#G3`, `${OWNER_Q}#8-catalog-api-plateau-files-versus-the-ckan-listed-upload`, `docs/gis/acquisitions/${id}.json`],
});
const codelist = (id: string): LiteralClassEntry => ({
  source_id: id, class: 'b', kind: 'codelists', values: 'codelist descriptions (function labels)',
  basis: 'The record gives licence `unknown`; no record shows rights for this archive.',
  evidence: [SOURCES, `${RESEARCH}#G3`, `docs/gis/acquisitions/${id}.json`],
});
const e27 = (id: string): LiteralClassEntry => ({
  source_id: id, class: 'b', kind: 'hokonavi', values: 'floor labels, floor ids, link and node ids',
  basis: 'The record names the package licence; Owner question 11 leaves the licence of the E27 resources unconfirmed. Its geometry ships under the Owner override of #16, which is not a licence record, so its values stay hashed in the docs reports.',
  evidence: [SOURCES, `${OWNER_Q}#11-e27-hokonavi-package-licence`, `${RESEARCH}#S01`, `docs/gis/acquisitions/${id}.json`],
});
/** Sources whose text no committed report quotes: classified so a future quote cannot slip in unclassified. Recorded terms only. */
const unquotedUnknown = (id: string, what: string): LiteralClassEntry => ({
  source_id: id, class: 'b', kind: 'unquoted', values: `none quoted (${what})`,
  basis: 'The record gives licence `unknown`; no record shows rights for this resource. No committed report quotes its text today, so there is nothing to extract; class (b) is the default, so any future quote must be hashed and this entry must then be given a kind that the guard can read.',
  evidence: [SOURCES, `docs/gis/acquisitions/${id}.json`],
});
const COMMENT = 'https://github.com/nurockplayer/gteki/pull/147#issuecomment-6330792563';
const ikebukuro = (id: string): LiteralClassEntry => ({
  source_id: id, class: 'a', kind: 'hokonavi', values: 'link and node ids, floor labels, source field values (Ikebukuro walking network)',
  basis: `Owner decision (i), ${COMMENT} (2026-10-22, relayed by gteki-80): keep the literals with attribution under the package-level PDL 1.0 notice, for Ikebukuro only. The recorded attribution text of this source stays with the values. ${id.endsWith('-csv') ? 'This CSV record gives PDL 1.0 with the digital.go.jp licence page, publish gate CONDITIONAL.' : 'This GeoJSON record gives PDL 1.0 with the MLIT site-terms page as licence URL, publish gate HOLD.'} The acquired CKAN snapshot carries the licence on the package, not on the four resources; the decision does not extend to Shinjuku E27 (Q11, the #16 override), which stays class (b).`,
  evidence: [SOURCES, `${RESEARCH}#R1`, CODES, `docs/gis/acquisitions/${id}.json`, COMMENT],
});
const spec = (id: string): LiteralClassEntry => ({
  source_id: id, class: 'a', kind: 'mlit-spec', values: 'code labels transcribed from the specification tables',
  basis: `director gteki-80's direct extension of the Owner's decision (ii) at ${COMMENT} (codebooks public), 2026-10-22; not a separate Owner statement. The same labels are already public in plain text in tools/gis/codebooks/mlit-walk-network-*.json, so hashing them in the reports would protect nothing. The record itself gives the MLIT site-terms page as licence URL, publish gate HOLD, and a note that no separate rights notice was found in the PDF text. The credit names the specification, its version, URL and snapshot SHA-256 from the acquisition record.`,
  evidence: [SOURCES, CODES, `docs/gis/acquisitions/${id}.json`, COMMENT],
});

export const CREDIT_FILE = 'docs/gis/rights/non-poi-literals.md';

export type SourceCredit = { source_id: string; attribution_text: string; license_name: string; license_url: string | null };
export type ReportCredit = { attribution_text: string; sources: SourceCredit[]; classification: string };

/**
 * Credit text of an MLIT specification, composed from the records: the recorded attribution sentence ("出典：国土交通省／
 * 加工して作成") widened with the specification title, version, URL and snapshot SHA-256 of the acquisition. The
 * codebook source notes use the same text.
 */
export function mlitSpecCreditText(title: string, version: string, url: string, sha256: string): string {
  return `出典：国土交通省「${title}」（版 ${version}、${url}、SHA-256 ${sha256}）／加工して作成`;
}

type Manifest = ReadonlyArray<Record<string, any>>;

/** A class (a) credit that cannot be composed from the records. `check-literals` reports it in `credit_problems`. */
export class CreditUnavailableError extends Error {
  constructor(readonly sourceId: string, readonly reason: string) { super(`Credit unavailable for ${sourceId}: ${reason}`); }
}

/** The credit one class (a) source's committed values must carry, or null for any other source. */
export async function classACredit(sourceId: string, options: { manifest?: Manifest; acquisitionsDir?: string } = {}): Promise<SourceCredit | null> {
  const entry = LITERAL_CLASSES.find(item => item.source_id === sourceId && item.class === 'a');
  if (!entry) return null;
  const manifest = options.manifest ?? (await import('./acquire.js')).loadSources() as unknown as Manifest;
  const source = manifest.find(item => item.source_id === sourceId);
  if (!source) return null;
  let attribution = String(source.attribution_text);
  if (entry.kind === 'mlit-spec') {
    const acquisition = await readJson<{ resolved_url?: string; sha256?: string }>(join(options.acquisitionsDir ?? join(docsRoot, 'gis', 'acquisitions'), `${sourceId}.json`)).catch(() => null);
    // The credit names the snapshot it was taken from; without the record there is nothing true to name, so fail instead of falling back.
    if (!acquisition?.resolved_url || !/^[0-9a-f]{64}$/u.test(acquisition.sha256 ?? '')) throw new CreditUnavailableError(sourceId, `acquisition record docs/gis/acquisitions/${sourceId}.json is missing or has no resolved_url / sha256`);
    attribution = mlitSpecCreditText(String(source.title), sourceId.replace('mlit-walk-network-spec-', ''), acquisition.resolved_url, acquisition.sha256!);
  }
  return { source_id: sourceId, attribution_text: attribution, license_name: String(source.license_name), license_url: source.license_url ?? null };
}

/** Credit block (`credit` field of a generated report) for the class (a) sources among `sourceIds`; null when none is class (a). */
export async function reportCredit(sourceIds: Iterable<string>, options: { manifest?: Manifest; acquisitionsDir?: string } = {}): Promise<ReportCredit | null> {
  const sources: SourceCredit[] = [];
  for (const id of [...new Set(sourceIds)].sort(cmp)) { const credit = await classACredit(id, options); if (credit) sources.push(credit); }
  return sources.length ? { attribution_text: [...new Set(sources.map(source => source.attribution_text))].join(' ; '), sources, classification: CREDIT_FILE } : null;
}

/** Source ids a network report quotes values from: its own sources plus the MLIT specifications behind its decoded labels. */
export function reportSourceIds(report: unknown): string[] {
  const ids = new Set<string>();
  if (isRecord(report)) {
    if (typeof report.source_id === 'string') for (const id of report.source_id.split('+')) ids.add(id);
    if (Array.isArray(report.members)) for (const member of report.members) if (isRecord(member) && typeof member.source_id === 'string') ids.add(member.source_id);
    // Station-map archives keep `attribute_decoding` inside each member, not at the root (#147 review).
    const decoded = (report.attribute_decoding !== undefined && report.attribute_decoding !== null)
      || (Array.isArray(report.members) && report.members.some(member => isRecord(member) && member.attribute_decoding !== undefined && member.attribute_decoding !== null));
    if (decoded) for (const version of ['2018-03', '2024-07']) ids.add(`mlit-walk-network-spec-${version}`);
  }
  return [...ids];
}

/** True when every source behind a network report is class (a): its source values may stay in the committed report. */
export function reportKeepsSourceValues(report: unknown): boolean {
  const own = isRecord(report) && typeof report.source_id === 'string' ? report.source_id.split('+') : [];
  return own.length > 0 && own.every(id => LITERAL_CLASSES.some(entry => entry.source_id === id && entry.class === 'a'));
}

export const LITERAL_CLASSES: LiteralClassEntry[] = [
  ubld('plateau-13116-ubld-53394576'), ubld('plateau-13104-ubld-53394536'),
  codelist('plateau-13116-codelists'), codelist('plateau-13104-codelists'),
  e27('hokonavi-oedo-shinjuku-network-geojson'), e27('hokonavi-oedo-shinjuku-stationmap-geojson'),
  ikebukuro('hokonavi-ikebukuro-walk-node-csv'), ikebukuro('hokonavi-ikebukuro-walk-link-csv'),
  ikebukuro('hokonavi-ikebukuro-walk-node-geojson'), ikebukuro('hokonavi-ikebukuro-walk-link-geojson'),
  spec('mlit-walk-network-spec-2018-03'), spec('mlit-walk-network-spec-2024-07'),
  {
    source_id: 'mlit-walk-network-spec-2024-07-diff', class: 'a', kind: 'unquoted', values: 'none quoted (2018-03 to 2024-07 comparison document)',
    basis: 'The record names PDL 1.0 (https://www.mlit.go.jp/link.html) and the credit 出典：国土交通省／加工して作成, the same terms as the two specifications. No committed report quotes this document and no codebook is transcribed from it, so no literal is read from it; its recorded credit is listed below.',
    evidence: [SOURCES, 'docs/gis/acquisitions/mlit-walk-network-spec-2024-07-diff.json'],
  },
  unquotedUnknown('plateau-13116-metadata', 'metadata ZIP'), unquotedUnknown('plateau-13104-metadata', 'metadata ZIP'),
  unquotedUnknown('plateau-13116-schemas', 'schemas ZIP'), unquotedUnknown('plateau-13104-schemas', 'schemas ZIP'),
  unquotedUnknown('plateau-catalog-ubld-13116-13104', 'catalog API snapshot'), unquotedUnknown('plateau-catalog-ubld-mesh-533945', 'catalog API snapshot'),
  unquotedUnknown('plateau-catalog-bldg-tran-13116-13104', 'catalog API snapshot'),
];

/**
 * Paths outside `docs/gis` that carry Hokonavi E27 ids and labels in clear. They are NOT scanned: the guard's scope is `docs/gis`.
 * Their basis is the Owner's decision to keep shipping the Shinjuku slice (Q11 against #16), not a rights PASS.
 */
export type ExemptPath = { path: string; basis: string; evidence: string[] };
const Q11_VS_16 = 'https://github.com/nurockplayer/gteki/issues/39#issuecomment-6325100917';
const OWNER_16 = 'https://github.com/nurockplayer/gteki/pull/16#issuecomment-6313815757';
const shipBasis = (what: string): string => `${what} Hokonavi E27 values ship here under the Owner's decision of 2026-10-22 that the Shinjuku E27-derived slice keeps shipping (${Q11_VS_16}, option (a)), on the Owner's #16 override of 2026-10-21 (${OWNER_16}), not on a rights PASS. Q11 = No: no file claims that PDL 1.0 covers the E27 resources.`;
export const EXEMPT_PATHS: ExemptPath[] = [
  { path: 'stations/shinjuku/**', basis: shipBasis('The shipped Shinjuku slice (data, graph, POIs, station JSON).'), evidence: [Q11_VS_16, OWNER_16] },
  { path: 'tests/e2e/specs/__goldens__/02-navigation.spec.ts/**', basis: shipBasis('Route goldens of the shipped slice.'), evidence: [Q11_VS_16, OWNER_16] },
  { path: 'stations/shinjuku/tools/import-e27.ts', basis: shipBasis('The importer holds the E27 source-label code that builds the shipped slice.'), evidence: [Q11_VS_16, OWNER_16] },
];

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
type Segment = string | number;
type Row = { file: string; path: string; source_id: string; class: 'a' | 'b'; count: number };

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalized = (segments: Segment[]): string => segments.map(s => typeof s === 'number' ? '[]' : `.${s}`).join('').replace(/\.\[\]/g, '[]').replace(/^\./, '');
const cityOf = (file: string): string => file.match(/13(?:104|116)/u)?.[0] ?? '13116';

/** Hokonavi sources behind a network report (a pair report names both its node and link files). */
function networkSources(doc: Record<string, unknown>): string[] {
  const id = typeof doc.source_id === 'string' ? doc.source_id : '';
  return id.includes('+') ? id.split('+') : id ? [id] : [];
}

function sourceFor(file: string, segments: Segment[], networkOf: (segments: Segment[]) => string[]): string[] {
  const path = normalized(segments);
  if (/(?:^|\.)label_hash|function_label_hash/u.test(path)) return [`plateau-${cityOf(file)}-codelists`];
  return networkOf(segments);
}

function collect(doc: unknown, visit: (segments: Segment[], node: Record<string, unknown>) => void, segments: Segment[] = []): void {
  if (Array.isArray(doc)) { doc.forEach((item, index) => collect(item, visit, [...segments, index])); return; }
  if (!isRecord(doc)) return;
  visit(segments, doc);
  for (const [key, value] of Object.entries(doc)) collect(value, visit, [...segments, key]);
}

/** Rows for one committed JSON file: hashed class (b) values and kept class (a) values. */
export function literalRows(file: string, doc: unknown): Row[] {
  const rows = new Map<string, Row>(), root = isRecord(doc) ? doc : {};
  const networkOf = (segments: Segment[]): string[] => {
    if (file.startsWith('networks/')) {
      const member = segments[0] === 'members' && typeof segments[1] === 'number' && Array.isArray(root.members) ? (root.members[segments[1]] as Record<string, unknown> | undefined) : undefined;
      if (member && typeof member.source_id === 'string') return [member.source_id];
      return networkSources(root);
    }
    if (file.startsWith('gaps/')) { const ids = root.source_ids as Record<string, unknown> | undefined; return typeof ids?.network === 'string' ? [ids.network] : []; }
    if (file === 'real-data-summary.json' && segments[0] === 'networks' && typeof segments[1] === 'number' && Array.isArray(root.networks)) return networkSources(root.networks[segments[1]] as Record<string, unknown>);
    return [];
  };
  const bump = (path: string, sourceId: string, cls: 'a' | 'b', by: number): void => {
    const key = `${path}\u0000${sourceId}`, row = rows.get(key) ?? { file, path, source_id: sourceId, class: cls, count: 0 };
    row.count += by; rows.set(key, row);
  };
  collect(doc, (segments, node) => {
    if (typeof node.value_sha256 === 'string' && typeof node.value_type === 'string') {
      for (const id of sourceFor(file, segments, networkOf)) bump(normalized(segments), id, 'b', 1);
    }
  });
  // Class (a) wording kept in network-shaped reports: MLIT specification labels (decoded) and, for class (a) networks, the source's own values.
  const classA = (id: string): boolean => LITERAL_CLASSES.some(entry => entry.source_id === id && entry.class === 'a');
  const ID_LISTS = new Set(['duplicate_ids', 'duplicate_node_ids', 'duplicate_link_ids', 'unreferenced_node_ids', 'inconsistent_link_ids', 'not_checkable_link_ids']);
  const wordingIn = (values: unknown[]): number => values.filter(value => typeof value === 'string' && isWording(value)).length;
  collect(doc, (segments, node) => {
    const here = normalized(segments), sources = networkOf(segments).filter(classA);
    const version = here.match(/versions\.(\d{4}-\d{2})/u)?.[1];
    if (isRecord(node.decoded_label_counts) && version) { const n = wordingIn(Object.keys(node.decoded_label_counts)); if (n) bump(`${here ? `${here}.` : ''}decoded_label_counts`, `mlit-walk-network-spec-${version}`, 'a', n); }
    if (sources.length === 0) return;
    const at = (name: string): string => `${here ? `${here}.` : ''}${name}`;
    const count = (name: string, n: number): void => { if (n) for (const id of sources) bump(at(name), id, 'a', n); };
    if (Array.isArray(node.floor_labels_present_literally)) count('floor_labels_present_literally[]', wordingIn(node.floor_labels_present_literally));
    if (isRecord(node.categorical_values)) for (const [field, map] of Object.entries(node.categorical_values)) if (isRecord(map)) count(`categorical_values.${field}`, wordingIn(Object.keys(map)));
    if (isRecord(node.literal_value_distribution)) count('literal_value_distribution', wordingIn(Object.keys(node.literal_value_distribution)));
    for (const name of ID_LISTS) if (Array.isArray(node[name])) count(`${name}[]`, wordingIn(node[name] as unknown[]));
    if (typeof node.missing_node_id === 'string' && here.endsWith('dangling_links[]')) count('missing_node_id', wordingIn([node.missing_node_id]));
    if (typeof node.node_id === 'string' && here.endsWith('self_loops[]')) count('node_id', wordingIn([node.node_id]));
  });
  const keep = (path: string, count: number, sourceId?: string): void => { if (count) bump(path, sourceId ?? file.match(/plateau-\d{5}-ubld-\d+/u)?.[0] ?? ((doc as { source_id?: string }).source_id ?? 'plateau-ubld'), 'a', count); };
  if (file.startsWith('inventory/') && isRecord(doc)) {
    keep('floor_label_observations[].value', Array.isArray(doc.floor_label_observations) ? doc.floor_label_observations.length : 0);
    keep('compact_features[].names[]', Array.isArray(doc.compact_features) ? doc.compact_features.reduce((n: number, row: unknown) => n + (isRecord(row) && Array.isArray(row.names) ? row.names.length : 0), 0) : 0);
  }
  if (file.startsWith('gaps/') && isRecord(doc)) {
    const ids = doc.source_ids as Record<string, unknown> | undefined;
    if (typeof ids?.citygml === 'string') keep('literal_floor_label_evidence[].value', Array.isArray(doc.literal_floor_label_evidence) ? doc.literal_floor_label_evidence.length : 0, ids.citygml);
  }
  return [...rows.values()].sort((a, b) => cmp(a.file, b.file) || cmp(a.path, b.path) || cmp(a.source_id, b.source_id));
}

async function committedJson(gisDir: string): Promise<Array<{ file: string; doc: unknown }>> {
  const out: Array<{ file: string; doc: unknown }> = [];
  for (const [directory, suffix] of [['inventory', '.inventory.json'], ['networks', '.json'], ['gaps', '.json']] as const) {
    for (const name of (await readdir(join(gisDir, directory)).catch(() => [] as string[])).filter(entry => entry.endsWith(suffix)).sort()) out.push({ file: `${directory}/${name}`, doc: await readJson<unknown>(join(gisDir, directory, name)) });
  }
  out.push({ file: 'real-data-summary.json', doc: await readJson<unknown>(join(gisDir, 'real-data-summary.json')).catch(() => ({})) });
  return out;
}

const cell = (text: string): string => text.replaceAll('|', '\\|').replaceAll('\n', ' ');
const quote = (text: string | null | undefined): string => `\`${String(text ?? 'null').replaceAll('`', "'")}\``;

/** The generated classification file. Terms are copied from the source manifest verbatim; none is paraphrased. */
export async function literalClassificationMarkdown(gisDir: string, manifest: ReadonlyArray<Record<string, any>>): Promise<string> {
  const lines = [
    '# Non-POI source literals in committed GIS reports', '',
    'Generated by `pnpm --dir tools/gis gis literals-report` (issue #129, follow-up to #124). Classification uses recorded evidence only; unknown stays unknown and no licence is inferred.', '',
    '- **(a) Publishable with credit:** the record shows a licence that covers that specific resource, or a decision recorded in the basis column says to publish it with attribution. The values stay in committed reports with the credit below, as a `credit` field (JSON) or `Credit:` line (Markdown).',
    '- **(b) Unclear or no-release:** the committed reports carry `{ value_sha256, value_type, count }` (identifier lists: `{ value_sha256, value_type }`; SHA-256 of the UTF-8 value) instead of the literal. The literals stay in the git-ignored store detail reports (`out/networks/`, `out/plateau-*.inventory-detail.json`) and in the hash-verified store copies of the sources. Class (b) is now only the PLATEAU codelists (rights `unknown`) and Hokonavi E27 (Q11, the #16 override).',
    '- Source codes are not free text: values that are numeric, `(blank)`, `(unavailable)`, `(unknown)` or a short ASCII token of at most three characters (for example rank `SBS`, floor `-0.5`, route structure `5`) stay as the code, because hashing them would make the distributions unreadable. Any other class (b) value, however short (for example a station-map floor name), is wording and is hashed.',
    '- Guard (needs the private store, so it runs on the developer host and cannot run in CI): `pnpm --dir tools/gis gis check-literals` (alias `check-poi-literals`) fails if a class (b) literal appears under `docs/gis/**`, if a store copy or report detail is missing or altered, if a class (b) source yields no literals, if a network or inventory source is not listed below, or if a file keeps class (a) values without its credit or a pointer to this file.', '',
    '## Source classification', '',
    '| Source id | Class | Values quoted in reports | Recorded terms (verbatim from `tools/gis/sources/sources.yaml`) | Basis | Evidence |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const entry of LITERAL_CLASSES) {
    const source = manifest.find(item => item.source_id === entry.source_id);
    const terms = source ? `license_name: ${quote(source.license_name)}; license_url: ${quote(source.license_url)}; publish_gate: ${quote(source.publish_gate)}; attribution_text: ${quote(source.attribution_text)}; notes: ${quote(source.notes)}` : 'source not in manifest';
    lines.push(`| ${entry.source_id} | ${entry.class} | ${cell(entry.values)} | ${cell(terms)} | ${cell(entry.basis)} | ${cell(entry.evidence.map(quote).join(', '))} |`);
  }
  lines.push('', '## Credit for class (a) values', '', 'These sentences must stay with the class (a) values. For the Hokonavi and PLATEAU sources the sentence is the `attribution_text` recorded in `tools/gis/sources/sources.yaml`, verbatim. For the MLIT specifications the recorded sentence (出典：国土交通省／加工して作成) was widened, composed from the records, with the specification title (`sources.yaml`) and the version, URL and snapshot SHA-256 of `docs/gis/acquisitions/mlit-walk-network-spec-*.json`; the codebook source notes use the same text.', '');
  for (const entry of LITERAL_CLASSES.filter(item => item.class === 'a')) {
    const credit = await classACredit(entry.source_id, { manifest, acquisitionsDir: join(gisDir, 'acquisitions') });
    lines.push(`- ${entry.source_id}: ${credit?.attribution_text ?? 'unknown'} (${credit?.license_name ?? 'unknown'}, ${credit?.license_url ?? 'null'})`);
  }
  lines.push('', '## Fields in committed reports', '', 'Counts are read from the committed JSON of `inventory/`, `networks/`, `gaps/` and `real-data-summary.json` (the Markdown companions are rendered from it). Class (b) rows count hashed values; class (a) rows count the literals kept. Not tabulated: `history/**` (frozen snapshots of earlier runs, migrated with `gis scrub-literals` to `value_sha256:<hex>` tokens and kept under `history/README.md`, which carries the class (a) credit pointer), and `conversions/**` and `context/**` (they hold geometry statistics, no source labels; the leak scan covers them).', '', '| File | Field path | Source id | Class | Count | Evidence |', '| --- | --- | --- | --- | ---: | --- |');
  const evidenceOf = (id: string): string => (LITERAL_CLASSES.find(entry => entry.source_id === id)?.evidence ?? []).map(quote).join(', ');
  for (const { file, doc } of await committedJson(gisDir)) for (const row of literalRows(file, doc)) lines.push(`| ${file} | ${cell(row.path)} | ${row.source_id} | ${row.class} | ${row.count} | ${cell(evidenceOf(row.source_id))} |`);
  lines.push('', '## Why E27 values stay hashed inside `docs/gis`', '',
    'The shipped Shinjuku slice carries E27 values in clear under the Owner decisions below (see the next section), but the Lane D reports under `docs/gis` are not that shipped slice. The resource licence of the two E27 resources is still unconfirmed (Owner question 11 answered No for PDL 1.0), so class (b) here is the conservative default: the reports hash what the shipped slice does not need to repeat.',
    '', '## Exempt paths outside `docs/gis` (listed, not scanned)', '',
    'The guard scans `docs/gis/**` only and does not widen its roots. These paths hold E27 ids and labels in clear by decision. `gis check-literals` prints this list as `exempt_paths` in its output so the exemption is visible.', '',
    '| Path | Basis | Evidence |', '| --- | --- | --- |',
    ...EXEMPT_PATHS.map(entry => `| ${quote(entry.path)} | ${cell(entry.basis)} | ${cell(entry.evidence.join(', '))} |`));
  lines.push('', '## Hash meaning', '',
    'Class (b) and POI hashes are a matching fingerprint for not redistributing the original text in this repository. They are not secrecy: they are deliberately unsalted SHA-256 so that anyone can verify a match, and dictionary guessing of public or enumerable vocabularies (floor names, codelist descriptions) is an accepted trade-off. No HMAC is used (director gteki-80 decision, #147; the Owner is not asked).', '', '## Not covered', '',
    `- \`tools/gis/codebooks/mlit-walk-network-*.json\` transcribe the MLIT specification labels. They are public per the Owner's decision (ii) at ${COMMENT} (2026-10-22), and each carries a \`source_note\` naming the specification, its version, URL and snapshot SHA-256. The labels in the \`docs/gis\` reports moved to class (a) as well, as director gteki-80's direct extension of that decision (not a separate Owner statement).`,
    '- Text in `docs/gis/**` that GTEki wrote and that happens to use a generic word is exempt through `tools/gis/codebooks/poi-literal-allowlist.json`; each term there carries a justification.',
    '- `tools/gis/test/attributes.test.ts` (lines 41-42) holds two MLIT slope-range labels. By the decision above they are class (a), so they stay in that test.',
    '- Redaction in `literal-public.ts` is a deny-list (named fields, `ID_LISTS`, `COUNT_MAP_KEYS`): a new report field that carries source text would pass through unhashed and is caught only by the store-side `check-literals` scan, which cannot run in CI. This is a known limit (P3), not changed here.',
    '- Earlier Git commits still contain the old literals; rewriting history is not attempted (Owner decision on #124).', '');
  return lines.join('\n');
}

export async function writeLiteralClassification(): Promise<{ file: string; sources: number }> {
  const { loadSources } = await import('./acquire.js');
  const gisDir = join(docsRoot, 'gis'), file = join(gisDir, 'rights', 'non-poi-literals.md');
  await writeFile(file, await literalClassificationMarkdown(gisDir, loadSources() as unknown as Array<Record<string, any>>));
  return { file: 'docs/gis/rights/non-poi-literals.md', sources: LITERAL_CLASSES.length };
}
