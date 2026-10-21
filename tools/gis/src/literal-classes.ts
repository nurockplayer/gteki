import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { docsRoot, readJson } from './common.js';

/**
 * Classification of the non-POI sources whose values appear in committed GIS reports (issue #129), from recorded evidence
 * only. (a) the record shows a licence that covers that specific resource; (b) terms unclear or no-release. Unknown stays
 * unknown: nothing here invents a licence. The generated table is docs/gis/rights/non-poi-literals.md.
 */
export type LiteralKind = 'citygml' | 'codelists' | 'hokonavi' | 'mlit-spec';
export type LiteralClassEntry = { source_id: string; class: 'a' | 'b'; kind: LiteralKind; values: string; basis: string; evidence: string[] };

const SOURCES = 'tools/gis/sources/sources.yaml';
const RESEARCH = 'docs/research/GTEki_Public_Data_Research_2026-10-20.md';
const OWNER_Q = 'docs/gis/decisions/owner-rights-questions.md';
const CODES = 'docs/gis/research/network-codes-and-coverage.md';
const ubld = (id: string): LiteralClassEntry => ({
  source_id: id, class: 'a', kind: 'citygml', values: 'gml:id and gml:name text',
  basis: 'The record names a licence and credit for this resource; the credit stays with the values. Publish gate CONDITIONAL; Owner question 8 (identity of the catalog-API file) is open.',
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
const ikebukuro = (id: string): LiteralClassEntry => ({
  source_id: id, class: 'b', kind: 'hokonavi', values: 'link and node ids, source field values',
  basis: 'The acquired CKAN snapshot (supporting document ckan-metadata of hokonavi-ikebukuro-walk-node-geojson) carries a licence member on the package and none on the four resources, the same shape as E27; the GeoJSON records give the MLIT site-terms page as licence URL and publish gate HOLD.',
  evidence: [SOURCES, `${RESEARCH}#R1`, CODES, 'docs/gis/acquisitions/hokonavi-ikebukuro-walk-node-geojson.json'],
});
const spec = (id: string): LiteralClassEntry => ({
  source_id: id, class: 'b', kind: 'mlit-spec', values: 'code labels transcribed from the specification tables',
  basis: 'The record names the MLIT site-terms page as licence URL, publish gate HOLD, and a note that no separate rights notice was found in the PDF text; nothing records that the site terms cover this resource.',
  evidence: [SOURCES, CODES, `docs/gis/acquisitions/${id}.json`],
});

export const LITERAL_CLASSES: LiteralClassEntry[] = [
  ubld('plateau-13116-ubld-53394576'), ubld('plateau-13104-ubld-53394536'),
  codelist('plateau-13116-codelists'), codelist('plateau-13104-codelists'),
  e27('hokonavi-oedo-shinjuku-network-geojson'), e27('hokonavi-oedo-shinjuku-stationmap-geojson'),
  ikebukuro('hokonavi-ikebukuro-walk-node-csv'), ikebukuro('hokonavi-ikebukuro-walk-link-csv'),
  ikebukuro('hokonavi-ikebukuro-walk-node-geojson'), ikebukuro('hokonavi-ikebukuro-walk-link-geojson'),
  spec('mlit-walk-network-spec-2018-03'), spec('mlit-walk-network-spec-2024-07'),
];

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
  const version = path.match(/versions\.(\d{4}-\d{2})/u)?.[1];
  if (/decoded_label_value_hash_distribution/u.test(path) && version) return [`mlit-walk-network-spec-${version}`];
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
  const keep = (path: string, count: number): void => { if (count) bump(path, file.match(/plateau-\d{5}-ubld-\d+/u)?.[0] ?? ((doc as { source_id?: string }).source_id ?? 'plateau-ubld'), 'a', count); };
  if (file.startsWith('inventory/') && isRecord(doc)) {
    keep('floor_label_observations[].value', Array.isArray(doc.floor_label_observations) ? doc.floor_label_observations.length : 0);
    keep('compact_features[].names[]', Array.isArray(doc.compact_features) ? doc.compact_features.reduce((n: number, row: unknown) => n + (isRecord(row) && Array.isArray(row.names) ? row.names.length : 0), 0) : 0);
  }
  if (file.startsWith('gaps/') && isRecord(doc)) {
    const ids = doc.source_ids as Record<string, unknown> | undefined;
    if (typeof ids?.citygml === 'string') keep('literal_floor_label_evidence[].value', Array.isArray(doc.literal_floor_label_evidence) ? doc.literal_floor_label_evidence.length : 0);
    for (const row of rows.values()) if (row.class === 'a') row.source_id = String(ids?.citygml ?? row.source_id);
  }
  return [...rows.values()].sort((a, b) => a.file.localeCompare(b.file) || a.path.localeCompare(b.path) || a.source_id.localeCompare(b.source_id));
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
    '- **(a) Publishable with credit:** the record shows a licence that covers that specific resource. The values stay in committed reports with the credit below.',
    '- **(b) Unclear or no-release:** the committed reports carry `{ value_sha256, value_type, count }` (identifier lists: `{ value_sha256, value_type }`; SHA-256 of the UTF-8 value) instead of the literal. The literals stay in the git-ignored store detail reports (`out/networks/`, `out/plateau-*.inventory-detail.json`) and in the hash-verified store copies of the sources.',
    '- Source codes are not free text: values that are numeric, `(blank)`, `(unavailable)`, `(unknown)` or shorter than four characters (for example rank `SBS`, floor `-0.5`, route structure `5`) stay as the code, because the leak scan cannot test them and hashing them would make the distributions unreadable.',
    '- Guard: `pnpm --dir tools/gis gis check-literals` (alias `check-poi-literals`) fails if a class (b) literal appears under `docs/gis/**`, if a store copy or report detail is missing or altered, if a class (b) source yields no literals, or if a class (a) credit text is absent from this file.', '',
    '## Source classification', '',
    '| Source id | Class | Values quoted in reports | Recorded terms (verbatim from `tools/gis/sources/sources.yaml`) | Basis | Evidence |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const entry of LITERAL_CLASSES) {
    const source = manifest.find(item => item.source_id === entry.source_id);
    const terms = source ? `license_name: ${quote(source.license_name)}; license_url: ${quote(source.license_url)}; publish_gate: ${quote(source.publish_gate)}; attribution_text: ${quote(source.attribution_text)}; notes: ${quote(source.notes)}` : 'source not in manifest';
    lines.push(`| ${entry.source_id} | ${entry.class} | ${cell(entry.values)} | ${cell(terms)} | ${cell(entry.basis)} | ${cell(entry.evidence.map(quote).join(', '))} |`);
  }
  lines.push('', '## Credit for class (a) values', '', 'These sentences are the `attribution_text` recorded for the class (a) sources and must stay with their values.', '');
  for (const entry of LITERAL_CLASSES.filter(item => item.class === 'a')) {
    const source = manifest.find(item => item.source_id === entry.source_id);
    lines.push(`- ${entry.source_id}: ${source?.attribution_text ?? 'unknown'} (${source?.license_name ?? 'unknown'}, ${source?.license_url ?? 'null'})`);
  }
  lines.push('', '## Fields in committed reports', '', 'Counts are read from the committed JSON (the Markdown companions are rendered from it). Class (b) rows count hashed values; class (a) rows count the literals kept.', '', '| File | Field path | Source id | Class | Count | Evidence |', '| --- | --- | --- | --- | ---: | --- |');
  const evidenceOf = (id: string): string => (LITERAL_CLASSES.find(entry => entry.source_id === id)?.evidence ?? []).map(quote).join(', ');
  for (const { file, doc } of await committedJson(gisDir)) for (const row of literalRows(file, doc)) lines.push(`| ${file} | ${cell(row.path)} | ${row.source_id} | ${row.class} | ${row.count} | ${cell(evidenceOf(row.source_id))} |`);
  lines.push('', '## Not covered', '',
    '- `tools/gis/codebooks/mlit-walk-network-*.json` transcribe the class (b) MLIT specification labels and are committed under `tools/gis`, outside `docs/gis`, because decoding needs them. Whether they may stay public is an Owner decision.',
    '- Text in `docs/gis/**` that GTEki wrote and that happens to use a generic word is exempt through `tools/gis/codebooks/poi-literal-allowlist.json`; each term there carries a justification.',
    '- Earlier Git commits still contain the old literals; rewriting history is not attempted (Owner decision on #124).', '');
  return lines.join('\n');
}

export async function writeLiteralClassification(): Promise<{ file: string; sources: number }> {
  const { loadSources } = await import('./acquire.js');
  const gisDir = join(docsRoot, 'gis'), file = join(gisDir, 'rights', 'non-poi-literals.md');
  await writeFile(file, await literalClassificationMarkdown(gisDir, loadSources() as unknown as Array<Record<string, any>>));
  return { file: 'docs/gis/rights/non-poi-literals.md', sources: LITERAL_CLASSES.length };
}
