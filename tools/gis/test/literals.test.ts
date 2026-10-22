import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { packageRoot, repoRoot } from '../src/common.js';
import { classAWording, codebookLabels, codelistLabels, checkLiterals, hokonaviLiterals, literalsInFile, scrubLiterals, scrubText, verifyClassACredits, verifyCredits, verifyRegistered, verifyReportDetails, withoutClassA, type ClassBResult } from '../src/literals.js';
import { buildMatcher, isCodeValue, isWording } from '../src/literal-match.js';
import { LITERAL_CLASSES, classACredit, literalClassificationMarkdown, literalRows, mlitSpecCreditText, reportCredit, reportKeepsSourceValues, reportSourceIds } from '../src/literal-classes.js';
import { hashedDistribution, hashedValue, isEnumeratedCode, publicInventorySummary, publicNetworkReport } from '../src/literal-public.js';
import { literalsInText, loadLiteralAllowlistFile } from '../src/poi-literals.js';

// SYNTHETIC values only. Every label, id and floor name below is invented and unique, so any occurrence in a public report is a leak.
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const LABEL_A = 'SYNTH-LABEL-ALPHA 地下ラベル', LABEL_B = 'SYNTH-LABEL-BETA', FLOOR = 'SYNTH-FLOOR-名称', LINK_ID = 'synth-link-0000-aaaa', NODE_ID = 'synth-node-0000-bbbb', FLOOR_ID = 'synth-floor-id-cccc';

const literalReport = () => ({
  source_id: 'synthetic-network', source_sha256: 'a'.repeat(64),
  floor_labels_present_literally: [FLOOR, '-0.5'], floor_label_counts: { [FLOOR]: 3, '-0.5': 2 },
  categorical_values: { floor: { '-0.5': 2, '0.0': 5, '(blank)': 1, [FLOOR]: 3 }, floor_id: { [FLOOR_ID]: 4 }, route_type: { '1': 2, '99': 1 } },
  topology: { duplicate_node_ids: [NODE_ID, '42'], dangling_links: [{ feature_index: 1, missing_node_id: NODE_ID }], self_loops: [{ feature_index: 2, node_id: NODE_ID }], unreferenced_node_ids: [], weak_component_count: 1 },
  attribute_decoding: {
    status: 'LITERAL_LABEL_LOOKUP_ONLY',
    fields: { link: {
      rt_struct: { literal_value_distribution: { '5': 2, [LABEL_B]: 1 }, versions: { '2024-07': { decoded_label_counts: { [LABEL_A]: 2, [LABEL_B]: 1 }, undefined_codes: [], evidence: { spec_source_id: 'mlit-walk-network-spec-2024-07', table: '3.2' } } } },
      rank: { literal_value_distribution: { SBS: 1, AAA: 2 }, versions: { '2024-07': { decoded_label_counts: { 'S / B / S': 1, 'A / A / A': 2 }, undefined_codes: ['SBS'] } } },
    } },
    rank_cross_check_2024: { inconsistent_link_ids: [LINK_ID], inconsistent_link_ids_truncated: 0, component_counts: { width: { inconsistent_link_ids: [LINK_ID, '7'], not_checkable_link_ids: [] } } },
    literal_cooccurrences: { nonzero_floor_nodes: 3, rt_struct_5_7_by_endpoint_floors: [{ rt_struct: '5', start_floor: '-0.5', end_floor: FLOOR, count: 1 }, { rt_struct: '5', start_floor: '(unknown)', end_floor: '1.0', count: 2 }] },
  },
  members: [{ file: 'Synth_B1_Floor.geojson', floor_labels_present_literally: [FLOOR], floor_label_counts: { [FLOOR]: 3 } }],
});

describe('public form of class (b) network literals (#129)', () => {
  it('hashes labels, floor labels, free-text code keys and identifiers; keeps counts, numeric codes and short codes', () => {
    const literals = new Set([FLOOR, LINK_ID, NODE_ID, FLOOR_ID]);
    const raw = literalReport(), pub = publicNetworkReport(raw) as any;
    expect(literalsInText(JSON.stringify(raw), literals).length).toBe(literals.size); // the fixture really holds them
    expect(literalsInText(JSON.stringify(pub), literals)).toEqual([]);
    const decoded = pub.attribute_decoding.fields.link.rt_struct.versions['2024-07'];
    // MLIT specification labels are class (a): decoded labels stay readable in every network report (with the report credit).
    expect(decoded.decoded_label_counts).toEqual({ [LABEL_A]: 2, [LABEL_B]: 1 });
    expect(decoded.undefined_codes).toEqual([]); expect(decoded.evidence).toEqual({ spec_source_id: 'mlit-walk-network-spec-2024-07', table: '3.2' });
    // Floor labels: hashed with their feature counts (the sibling count map is folded in).
    expect(pub).not.toHaveProperty('floor_labels_present_literally'); expect(pub).not.toHaveProperty('floor_label_counts');
    expect(pub.floor_label_value_hash_distribution).toContainEqual({ value_sha256: sha(FLOOR), value_type: 'string', count: 3 });
    expect(pub.floor_label_value_hash_distribution).toContainEqual({ value_sha256: sha('-0.5'), value_type: 'string', count: 2 });
    expect(pub.members[0].floor_label_value_hash_distribution).toEqual([{ value_sha256: sha(FLOOR), value_type: 'string', count: 3 }]);
    // Code maps: numeric, marker and short codes stay; a free-text key moves to value_hash_distribution.
    expect(pub.categorical_values.floor).toEqual({ '-0.5': 2, '0.0': 5, '(blank)': 1, value_hash_distribution: [{ value_sha256: sha(FLOOR), value_type: 'string', count: 3 }] });
    expect(pub.categorical_values.floor_id).toEqual({ value_hash_distribution: [{ value_sha256: sha(FLOOR_ID), value_type: 'string', count: 4 }] });
    expect(pub.categorical_values.route_type).toEqual({ '1': 2, '99': 1 });
    expect(pub.attribute_decoding.fields.link.rt_struct.literal_value_distribution).toEqual({ '5': 2, value_hash_distribution: [{ value_sha256: sha(LABEL_B), value_type: 'string', count: 1 }] });
    expect(pub.attribute_decoding.fields.link.rank.literal_value_distribution).toEqual({ SBS: 1, AAA: 2 });
    // Identifier lists and graph defects.
    expect(pub.attribute_decoding.rank_cross_check_2024.inconsistent_link_ids).toEqual([hashedValue(LINK_ID)]);
    expect(pub.attribute_decoding.rank_cross_check_2024.component_counts.width.inconsistent_link_ids).toEqual([hashedValue(LINK_ID), '7']);
    expect(pub.topology).toMatchObject({ duplicate_node_ids: [hashedValue(NODE_ID), '42'], dangling_links: [{ feature_index: 1, missing_node_id: hashedValue(NODE_ID) }], self_loops: [{ feature_index: 2, node_id: hashedValue(NODE_ID) }], weak_component_count: 1 });
    expect(pub.attribute_decoding.literal_cooccurrences.rt_struct_5_7_by_endpoint_floors).toEqual([{ rt_struct: '5', start_floor: '-0.5', end_floor: hashedValue(FLOOR), count: 1 }, { rt_struct: '5', start_floor: '(unknown)', end_floor: '1.0', count: 2 }]);
  });
  it('is deterministic and idempotent, and does not mutate its input', () => {
    const raw = literalReport(), before = JSON.stringify(raw);
    const once = publicNetworkReport(raw);
    expect(JSON.stringify(raw)).toBe(before);
    expect(JSON.stringify(publicNetworkReport(once))).toBe(JSON.stringify(once));
    expect(JSON.stringify(publicNetworkReport(literalReport()))).toBe(JSON.stringify(once));
  });
  it('orders distributions by count then hash and tolerates a __proto__ key', () => {
    const rows = hashedDistribution(JSON.parse('{"__proto__": 2, "SYNTH-ONE": 2, "SYNTH-TWO": 1}'));
    expect(rows.map(row => row.count)).toEqual([2, 2, 1]);
    expect(rows[0]!.value_sha256 < rows[1]!.value_sha256).toBe(true);
    const pub = publicNetworkReport({ categorical_values: { f: JSON.parse('{"__proto__": 2}') } }) as any;
    expect(pub.categorical_values.f.value_hash_distribution).toEqual([{ value_sha256: sha('__proto__'), value_type: 'string', count: 2 }]);
  });
  it('classifies codes: numbers, markers and short ASCII tokens stay; every other value, however short, is wording', () => {
    for (const code of ['5', '-0.5', '99', '(blank)', '(unavailable)', '(unknown)', 'SBS', 'B1F', '0%', '１', '0.5']) expect(isEnumeratedCode(code), code).toBe(true);
    for (const wording of ['あり', 'なし', '1階', '階段', '歩道橋', '地下2階', 'SYNTH-LABEL', '横断歩道', 'synth-link-0000-aaaa', 'ABCD']) expect(isEnumeratedCode(wording), wording).toBe(false);
    expect(isWording('あり')).toBe(true); expect(isWording('SBS')).toBe(false); expect(isWording('  ')).toBe(false);
  });
  it('hashes short Japanese wording but keeps short ASCII codes in code maps and floor fields', () => {
    const pub = publicNetworkReport({ categorical_values: { floor: { '1階': 2, B1F: 1, '0.0': 4 } }, topology: { dangling_links: [{ feature_index: 1, missing_node_id: '1階' }, { feature_index: 2, missing_node_id: 'n12' }] } }) as any;
    expect(pub.categorical_values.floor).toEqual({ B1F: 1, '0.0': 4, value_hash_distribution: [{ value_sha256: sha('1階'), value_type: 'string', count: 2 }] });
    expect(pub.topology.dangling_links.map((row: any) => row.missing_node_id)).toEqual([hashedValue('1階'), 'n12']);
  });
});

describe('public form of a CityGML inventory summary (#129)', () => {
  it('hashes codelist (class b) labels and keeps gml:id and gml:name (class a)', () => {
    const summary = {
      source_id: 'plateau-synth-ubld',
      codelist_resolution: [{ code: 'EF_25', code_space: 'Synth_function.xml', label: LABEL_A, status: 'RESOLVED' }, { code: 'EF_99', code_space: 'Synth_function.xml', label: null, status: 'UNRESOLVED' }],
      compact_features: [{ gml_id: 'ubld_synth_1', type: 'grp:CityObjectGroup', names: ['SYNTH-GROUP-NAME'], function_code: null, function_label: null }, { gml_id: 'ubld_synth_2', type: 'bldg:IntBuildingInstallation', names: null, function_code: 'EF_25', function_label: LABEL_A }],
      floor_label_observations: [{ object_key: 'k', gml_id: 'ubld_synth_1', field: 'gml:name', value: 'SYNTH-GROUP-NAME', source: 'gml:name' }],
    };
    const pub = publicInventorySummary(summary) as any;
    expect(literalsInText(JSON.stringify(pub), [LABEL_A])).toEqual([]);
    expect(pub.codelist_resolution).toEqual([{ code: 'EF_25', code_space: 'Synth_function.xml', status: 'RESOLVED', label_hash: hashedValue(LABEL_A) }, { code: 'EF_99', code_space: 'Synth_function.xml', status: 'UNRESOLVED', label_hash: null }]);
    expect(pub.compact_features[0]).toEqual({ gml_id: 'ubld_synth_1', type: 'grp:CityObjectGroup', names: ['SYNTH-GROUP-NAME'], function_code: null, function_code_space: undefined, function_label_hash: null });
    expect(pub.compact_features[1].function_label_hash).toEqual(hashedValue(LABEL_A));
    expect(pub.floor_label_observations[0].value).toBe('SYNTH-GROUP-NAME'); // class (a): kept, with its credit
    expect(summary.compact_features[1]!.function_label).toBe(LABEL_A); // input untouched
  });
});

describe('class (b) literal extraction', () => {
  it('reads CSV cells and GeoJSON properties but not keys, numbers or short codes', () => {
    const csv = hokonaviLiterals('node.csv', Buffer.from('node_id,floor,name\nsynth-node-0001,-0.5,SYNTH-NODE-NAME\nsynth-node-0002,1.0,\nsynth-node-0003,SBS,あり\n', 'utf8'));
    expect([...csv].sort()).toEqual(['SYNTH-NODE-NAME', 'synth-node-0001', 'synth-node-0002', 'synth-node-0003', 'あり'].sort());
    const geo = hokonaviLiterals('floor.geojson', Buffer.from(JSON.stringify({ type: 'FeatureCollection', properties: { title: 'SYNTH-ROOT-TITLE' }, features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [139.7, 35.6] }, properties: { name: FLOOR, floor_id: FLOOR_ID, rank: 'SBS' } }] }), 'utf8'));
    expect([...geo].sort()).toEqual([FLOOR, FLOOR_ID, 'SYNTH-ROOT-TITLE'].sort());
  });
  it('reads codebook labels and codelist descriptions', () => {
    expect([...codebookLabels({ version: 'x', link: { rt_struct: { codes: { '1': { label: LABEL_A, transcription_check: 'TEXT' }, '2': { label: 'あり' }, '3': { label: '123456' }, '4': { label: 'SBS' } } } } })].sort()).toEqual([LABEL_A, 'あり'].sort());
    expect([...codelistLabels(new Map([['Synth_function.xml|1', LABEL_B], ['Synth_function.xml|2', '12']]))]).toEqual([LABEL_B]);
  });
});

describe('gis check-literals fails closed (#129)', () => {
  const credit = [{ source_id: 'plateau-synth-ubld', attribution_text: 'SYNTH-CREDIT-TEXT' }];
  const classB = (literals: string[], problems: ClassBResult['problems'] = []) => async (): Promise<ClassBResult> => ({ literals: new Map(literals.map(literal => [literal, ['synthetic-source']])), problems, per_source: [{ source_id: 'synthetic-source', literal_count: literals.length }] });
  const setup = async (files: Record<string, string>) => {
    const root = await mkdtemp(join(tmpdir(), 'literals-check-')), docs = join(root, 'docs-gis'), store = join(root, 'store');
    await mkdir(join(docs, 'rights'), { recursive: true }); await mkdir(store, { recursive: true });
    await writeFile(join(docs, 'rights', 'non-poi-literals.md'), 'Credit: SYNTH-CREDIT-TEXT\n');
    for (const [name, text] of Object.entries(files)) { await mkdir(join(docs, name, '..'), { recursive: true }); await writeFile(join(docs, name), text); }
    return { root, docs, store };
  };
  const registered = new Set(['synthetic', 'plateau-synth', 'undetailed', 'plateau-synth-ubld']);
  const run = (docs: string, store: string, provider: () => Promise<ClassBResult>, allowlist: ReadonlySet<string> = new Set(), extra = {}) => checkLiterals(docs, store, allowlist, { skipPoi: true, credits: credit, classB: provider, registered, ...extra });

  it('passes a clean tree with credit', async () => {
    const { root, docs, store } = await setup({ 'gaps/a.json': JSON.stringify({ value_sha256: sha(LABEL_A), count: 1 }) });
    try { expect((await run(docs, store, classB([LABEL_A, LABEL_B]))).non_poi).toMatchObject({ status: 'PASS', scanned_literals: 2, detail_problems: [], credit_problems: [], leaking_files: [] }); }
    finally { await rm(root, { recursive: true, force: true }); }
  });
  it('fails on a verbatim or JSON-escaped literal anywhere under docs/gis', async () => {
    const { root, docs, store } = await setup({ 'gaps/leak.md': `prose ${LABEL_A} inside`, 'history/phase1/x.json': JSON.stringify({ k: 'SYNTH-"QUOTED"' }) });
    try {
      const result = await run(docs, store, classB([LABEL_A, 'SYNTH-"QUOTED"']));
      expect(result.status).toBe('FAIL');
      expect(result.non_poi.leaking_files).toEqual([{ file: 'gaps/leak.md', count: 1 }, { file: 'history/phase1/x.json', count: 1 }]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('exempts only allowlisted generic terms', async () => {
    const { root, docs, store } = await setup({ 'x.md': 'a generic synth-road word' });
    try {
      expect((await run(docs, store, classB(['synth-road']))).status).toBe('FAIL');
      expect((await run(docs, store, classB(['synth-road', LABEL_A]), new Set(['synth-road']))).non_poi).toMatchObject({ status: 'PASS', scanned_literals: 2 });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('fails when a class (b) store copy is missing or altered, naming the source', async () => {
    const { root, docs, store } = await setup({});
    try {
      for (const reason of ['missing', 'hash_mismatch'] as const) {
        const result = await run(docs, store, classB([LABEL_A], [{ source_id: 'hokonavi-synth', reason, detail: 'raw/aa/x' }]));
        expect(result.status).toBe('FAIL'); expect(result.non_poi.detail_problems).toEqual([{ source_id: 'hokonavi-synth', reason, detail: 'raw/aa/x' }]);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('fails on zero literals, even when nothing else is wrong', async () => {
    const { root, docs, store } = await setup({});
    try {
      const result = await run(docs, store, classB([]));
      expect(result.status).toBe('FAIL'); expect(result.non_poi).toMatchObject({ scanned_literals: 0 }); expect(result.non_poi).toHaveProperty('error');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('fails when a class (a) credit is absent from the classification file, or the file is missing', async () => {
    const { root, docs, store } = await setup({});
    try {
      const missing = await run(docs, store, classB([LABEL_A]), new Set(), { credits: [{ source_id: 'plateau-synth-ubld', attribution_text: 'SYNTH-OTHER-CREDIT' }] });
      expect(missing.status).toBe('FAIL'); expect(missing.non_poi.credit_problems).toEqual([{ source_id: 'plateau-synth-ubld', reason: 'credit text absent from the classification file' }]);
      await rm(join(docs, 'rights', 'non-poi-literals.md'));
      expect((await run(docs, store, classB([LABEL_A]))).non_poi.credit_problems).toEqual([{ source_id: '*', reason: 'classification file docs/gis/rights/non-poi-literals.md is missing' }]);
      expect(await verifyCredits(join(docs, 'rights', 'nope.md'), [])).toEqual([]);
      expect((await verifyCredits(join(docs, 'rights', 'nope.md'), [{ source_id: 'x', attribution_text: 'unknown' }])).length).toBe(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('fails when a committed report names a store detail that is absent or altered, and passes when it matches', async () => {
    const detail = Buffer.from(`${JSON.stringify({ synthetic: true })}\n`), storePath = 'out/networks/synthetic-aaaa.network-detail.json';
    const pointer = { store_path: storePath, sha256: createHash('sha256').update(detail).digest('hex'), bytes: detail.length };
    const { root, docs, store } = await setup({ 'networks/synthetic.json': JSON.stringify({ source_id: 'synthetic', detail: pointer }), 'inventory/plateau-synth.inventory.json': JSON.stringify({ totals: {}, feature_tree: pointer }) });
    try {
      expect(await verifyReportDetails(docs, store)).toEqual([{ source_id: 'synthetic', reason: 'missing', detail: storePath }, { source_id: 'plateau-synth', reason: 'missing', detail: storePath }]);
      await mkdir(join(store, 'out', 'networks'), { recursive: true });
      await writeFile(join(store, storePath), '{"altered":true}\n');
      expect((await verifyReportDetails(docs, store)).map(problem => problem.reason)).toEqual(['hash_mismatch', 'hash_mismatch']);
      const failed = await run(docs, store, classB([LABEL_A]));
      expect(failed.status).toBe('FAIL'); expect(failed.non_poi.detail_problems.length).toBe(2);
      await writeFile(join(store, storePath), detail);
      expect(await verifyReportDetails(docs, store)).toEqual([]);
      expect((await run(docs, store, classB([LABEL_A]))).status).toBe('PASS');
      await writeFile(join(docs, 'networks', 'undetailed.json'), JSON.stringify({ source_id: 'undetailed' }));
      expect(await verifyReportDetails(docs, store)).toEqual([{ source_id: 'undetailed', reason: 'missing', detail: 'networks/undetailed.json has no detail store_path/sha256/bytes' }]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('scrub-literals (frozen snapshots)', () => {
  const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
  const provider = (literals: string[]): ClassBResult => ({ literals: new Map(literals.map(literal => [literal, ['s']])), problems: [], per_source: [] });
  it('replaces literals longest first, never inside a longer word or an allowlisted term, and is idempotent', () => {
    const text = `${LABEL_A} | ${LABEL_B}-LONGER | ${LABEL_B} | エスカレーター | エスカレータ | 階段室 | 階段・スロープ`;
    const out = scrubText(text, [LABEL_B, `${LABEL_B}-LONGER`, LABEL_A, 'エスカレータ', 'エスカレーター', '階段'], ['エスカレーター']);
    expect(out.text).toBe(`value_sha256:${sha(LABEL_A)} | value_sha256:${sha(`${LABEL_B}-LONGER`)} | value_sha256:${sha(LABEL_B)} | エスカレーター | value_sha256:${sha('エスカレータ')} | 階段室 | value_sha256:${sha('階段')}・スロープ`);
    expect(out.replaced).toBe(5);
    expect(scrubText(out.text, [LABEL_B, LABEL_A, 'エスカレータ', '階段'], ['エスカレーター']).replaced).toBe(0);
    expect(out.text).not.toMatch(/value_sha256:[0-9a-f]{64}ー/u);
  });
  it('folds full-width forms and keeps the original characters around a match', () => {
    const out = scrubText('値 １階 と 2㎝ 以下', ['1階', '2cm']);
    expect(out.text).toBe(`値 value_sha256:${sha('1階')} と value_sha256:${sha('2cm')} 以下`);
  });
  it('rewrites JSON structurally: whole values and keys, wording inside strings, same 2-space format, nothing else', async () => {
    const root = await mkdtemp(join(tmpdir(), 'literals-scrub-')), docs = join(root, 'docs-gis');
    try {
      await mkdir(join(docs, 'history'), { recursive: true });
      const original = { [FLOOR_ID]: 1, list: [LABEL_A, 'エスカレーター', 'エスカレータ'], keep: { n: 1.5, ok: true, nothing: null }, 'エレベータ': 2, note: `see ${LABEL_B} here and エスカレーター` };
      await writeFile(join(docs, 'history', 'a.json'), json(original));
      await writeFile(join(docs, 'history', 'b.md'), 'clean text');
      const books = provider([FLOOR_ID, LABEL_A, LABEL_B, 'エスカレーター', 'エスカレータ', 'エレベータ']);
      const changed = await scrubLiterals(docs, ['history'], new Set(['エスカレーター']), books);
      expect(changed).toEqual([{ file: 'history/a.json', replaced: 6 }]);
      const raw = await readFile(join(docs, 'history', 'a.json'), 'utf8');
      expect(raw.endsWith('\n')).toBe(true);
      expect(JSON.parse(raw)).toEqual({ [`value_sha256:${sha(FLOOR_ID)}`]: 1, list: [`value_sha256:${sha(LABEL_A)}`, `value_sha256:${sha('エスカレーター')}`, `value_sha256:${sha('エスカレータ')}`], keep: { n: 1.5, ok: true, nothing: null }, [`value_sha256:${sha('エレベータ')}`]: 2, note: `see value_sha256:${sha(LABEL_B)} here and エスカレーター` });
      expect(raw).not.toMatch(/value_sha256:[0-9a-f]{64}ー/u);
      expect(await scrubLiterals(docs, ['history'], new Set(['エスカレーター']), books)).toEqual([]);
      await expect(scrubLiterals(docs, ['..'], new Set(), books)).rejects.toThrow(/escapes/);
      await expect(scrubLiterals(docs, ['history'], new Set(), { ...books, problems: [{ source_id: 's', reason: 'missing', detail: 'x' }] })).rejects.toThrow(/unavailable/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('refuses to reformat JSON that is not in the generators 2-space form', async () => {
    const root = await mkdtemp(join(tmpdir(), 'literals-scrub-')), docs = join(root, 'docs-gis');
    try {
      await mkdir(docs, { recursive: true });
      await writeFile(join(docs, 'compact.json'), JSON.stringify({ k: LABEL_A }));
      await expect(scrubLiterals(docs, ['compact.json'], new Set(), provider([LABEL_A]))).rejects.toThrow(/not 2-space JSON/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('classification file (docs/gis/rights/non-poi-literals.md)', () => {
  const manifest = [
    { source_id: 'plateau-13116-ubld-53394576', license_name: 'SYNTH-LICENCE', license_url: 'https://example.invalid/licence', publish_gate: 'SYNTH-GATE', attribution_text: 'SYNTH-CREDIT-TEXT', notes: 'SYNTH note with | pipe' },
    { source_id: 'plateau-13116-codelists', license_name: 'unknown', license_url: null, publish_gate: 'HOLD', attribution_text: 'unknown', notes: 'Resource-level rights are unverified.' },
  ];
  it('quotes the recorded terms verbatim and counts hashed (b) and kept (a) values per file and path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'literals-class-')), gis = join(root, 'gis');
    try {
      await mkdir(join(gis, 'inventory'), { recursive: true }); await mkdir(join(gis, 'networks'), { recursive: true });
      await writeFile(join(gis, 'inventory', 'plateau-13116-ubld-53394576.inventory.json'), JSON.stringify({ source_id: 'plateau-13116-ubld-53394576', totals: {}, floor_label_observations: [{ value: 'a' }], compact_features: [{ names: ['n1', 'n2'], function_label_hash: hashedValue('x') }, { names: null, function_label_hash: null }], codelist_resolution: [{ code: 'c', label_hash: hashedValue('y') }] }));
      await writeFile(join(gis, 'networks', 'e27.json'), JSON.stringify({ source_id: 'hokonavi-oedo-shinjuku-network-geojson', floor_label_value_hash_distribution: [{ ...hashedValue('f'), count: 2 }], attribute_decoding: { fields: { link: { rt_struct: { versions: { '2024-07': { decoded_label_counts: { 'SYNTH-SPEC-LABEL': 2, 'あり': 1, '5': 1 } } } } } } } }));
      await writeFile(join(gis, 'networks', 'ikebukuro.json'), JSON.stringify({ source_id: 'hokonavi-ikebukuro-walk-node-geojson+hokonavi-ikebukuro-walk-link-geojson', floor_labels_present_literally: ['SYNTH-FLOOR-NAME', '1'], topology: { duplicate_node_ids: ['synth-node-id-0001', '7'] }, categorical_values: { floor: { 'SYNTH-FLOOR-NAME': 3, '0.0': 4 } } }));
      const markdown = await literalClassificationMarkdown(gis, manifest);
      expect(markdown).toContain('license_name: `SYNTH-LICENCE`; license_url: `https://example.invalid/licence`; publish_gate: `SYNTH-GATE`; attribution_text: `SYNTH-CREDIT-TEXT`; notes: `SYNTH note with \\| pipe`');
      expect(markdown).toContain('license_name: `unknown`; license_url: `null`; publish_gate: `HOLD`');
      expect(markdown).toContain('- plateau-13116-ubld-53394576: SYNTH-CREDIT-TEXT (SYNTH-LICENCE, https://example.invalid/licence)');
      const rows = markdown.split('\n').filter(line => line.startsWith('| inventory/') || line.startsWith('| networks/'));
      expect(rows).toContain(`| inventory/plateau-13116-ubld-53394576.inventory.json | floor_label_observations[].value | plateau-13116-ubld-53394576 | a | 1 | ${evidence('plateau-13116-ubld-53394576')} |`);
      expect(rows.some(row => row.includes('| compact_features[].names[] | plateau-13116-ubld-53394576 | a | 2 |'))).toBe(true);
      expect(rows.some(row => row.includes('| compact_features[].function_label_hash | plateau-13116-codelists | b | 1 |'))).toBe(true);
      expect(rows.some(row => row.includes('| codelist_resolution[].label_hash | plateau-13116-codelists | b | 1 |'))).toBe(true);
      expect(rows.some(row => row.includes('| networks/e27.json | floor_label_value_hash_distribution[] | hokonavi-oedo-shinjuku-network-geojson | b | 1 |'))).toBe(true);
      // MLIT specification labels are class (a) in every network report; numeric codes are not counted.
      expect(rows.some(row => row.includes('| networks/e27.json | attribute_decoding.fields.link.rt_struct.versions.2024-07.decoded_label_counts | mlit-walk-network-spec-2024-07 | a | 2 |'))).toBe(true);
      // A class (a) network keeps its own wording; the E27 report lists no class (a) source values.
      for (const id of ['hokonavi-ikebukuro-walk-node-geojson', 'hokonavi-ikebukuro-walk-link-geojson']) {
        expect(rows.some(row => row.includes(`| networks/ikebukuro.json | floor_labels_present_literally[] | ${id} | a | 1 |`)), id).toBe(true);
        expect(rows.some(row => row.includes(`| networks/ikebukuro.json | topology.duplicate_node_ids[] | ${id} | a | 1 |`)), id).toBe(true);
        expect(rows.some(row => row.includes(`| networks/ikebukuro.json | categorical_values.floor | ${id} | a | 1 |`)), id).toBe(true);
      }
      expect(rows.some(row => row.startsWith('| networks/e27.json') && row.includes('hokonavi-oedo-shinjuku-network-geojson | a |'))).toBe(false);
      expect(markdown).toContain('public per the Owner');
      expect(markdown).toContain('moved to class (a) as well, as director gteki-80');
      expect(literalRows('networks/x.json', { source_id: 'y', note: 'no hashes' })).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  function evidence(id: string) { return LITERAL_CLASSES.find(entry => entry.source_id === id)!.evidence.map(path => `\`${path}\``).join(', ').replaceAll('|', '\\|'); }

  it('classifies from recorded evidence only: (a) needs a recorded licence and credit, nothing unknown is promoted', () => {
    const manifestYaml = parse(readFileSync(join(packageRoot, 'sources', 'sources.yaml'), 'utf8')) as Array<Record<string, any>>;
    const ids = LITERAL_CLASSES.map(entry => entry.source_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of LITERAL_CLASSES) {
      const source = manifestYaml.find(item => item.source_id === entry.source_id);
      expect(source, entry.source_id).toBeDefined();
      if (entry.class === 'a') {
        expect(source!.license_name, entry.source_id).not.toBe('unknown'); expect(source!.license_url, entry.source_id).toBeTruthy(); expect(source!.attribution_text, entry.source_id).not.toBe('unknown');
      } else {
        // Class (b) must say why: a non-empty basis and evidence; a class (b) entry is never promoted without a recorded licence.
        expect(entry.basis.length, entry.source_id).toBeGreaterThan(40); expect(entry.evidence.length, entry.source_id).toBeGreaterThan(1);
      }
      for (const path of entry.evidence) {
        if (/^https?:\/\//u.test(path)) continue; // a recorded decision comment, not a file
        const file = path.split('#')[0]!;
        expect(existsSync(join(repoRoot, file)), `${entry.source_id} evidence ${file}`).toBe(true);
      }
    }
    // The cases fixed by the task: codelists are (b), E27 labels are (b), MLIT specification labels are (b).
    const classOf = (id: string) => LITERAL_CLASSES.find(entry => entry.source_id === id)?.class;
    expect(classOf('plateau-13116-codelists')).toBe('b'); expect(classOf('plateau-13104-codelists')).toBe('b');
    expect(classOf('hokonavi-oedo-shinjuku-stationmap-geojson')).toBe('b'); expect(classOf('hokonavi-oedo-shinjuku-network-geojson')).toBe('b');
    // Decisions of 2026-10-22 (PR #147 comment 6330792563): Ikebukuro Hokonavi and the MLIT specification labels are class (a).
    for (const id of ['mlit-walk-network-spec-2018-03', 'mlit-walk-network-spec-2024-07', 'hokonavi-ikebukuro-walk-node-csv', 'hokonavi-ikebukuro-walk-link-csv', 'hokonavi-ikebukuro-walk-node-geojson', 'hokonavi-ikebukuro-walk-link-geojson']) {
      expect(classOf(id), id).toBe('a');
      expect(LITERAL_CLASSES.find(entry => entry.source_id === id)!.basis, id).toContain('6330792563');
    }
    expect(LITERAL_CLASSES.find(entry => entry.source_id === 'mlit-walk-network-spec-2024-07')!.basis).toContain("director gteki-80's direct extension of the Owner's decision (ii)");
    expect(LITERAL_CLASSES.find(entry => entry.source_id === 'mlit-walk-network-spec-2024-07')!.basis).toContain('not a separate Owner statement');
    expect(LITERAL_CLASSES.filter(entry => entry.class === 'b').map(entry => entry.source_id).sort()).toEqual(['hokonavi-oedo-shinjuku-network-geojson', 'hokonavi-oedo-shinjuku-stationmap-geojson', 'plateau-13104-codelists', 'plateau-13116-codelists']);
    expect(classOf('plateau-13116-ubld-53394576')).toBe('a');
  });
});

describe('generic-vocabulary allowlist justifications (#129)', () => {
  it('gives every term, old and new, a written reason, and every structural value its own', async () => {
    const file = JSON.parse(await readFile(join(packageRoot, 'codebooks', 'poi-literal-allowlist.json'), 'utf8')) as { terms: string[]; justifications: Record<string, string>; structural_values: string[]; structural_justifications: Record<string, string> };
    for (const term of file.terms) expect(file.justifications[term]?.length ?? 0, term).toBeGreaterThanOrEqual(40);
    expect(Object.keys(file.justifications).sort()).toEqual([...file.terms].sort());
    expect(file.structural_values.sort()).toEqual(Object.keys(file.structural_justifications).sort());
    for (const term of file.structural_values) expect(file.terms).toContain(term);
    // Real class (b) labels that are only generic prose words must not be whole-value exempt.
    for (const term of ['地下2階', 'エレベーター', 'エスカレーター', 'スロープ', 'zone', 'park', 'river', 'exception']) expect(file.structural_values).not.toContain(term);
    expect(file.terms).not.toContain('地下2階');
    expect((await loadLiteralAllowlistFile()).terms.size).toBe(file.terms.length);
  });
});

describe('class (b) matching rules (#129)', () => {
  const matcher = (literals: string[], allow: string[] = [], structural: string[] = []) => buildMatcher(literals, allow, structural);
  it('finds short Japanese wording as a whole JSON value or key or with word boundaries, never inside a longer word', () => {
    const m = matcher(['階段', '歩道橋', '不明', '1階', 'あり']);
    expect(literalsInFile('x.json', JSON.stringify({ '階段': 3, list: ['歩道橋', '階段室'], note: '階段室と歩道橋あり' }), m).sort()).toEqual(['歩道橋', '階段']);
    expect(literalsInFile('x.md', '| 階段 | 不明 |\n階段室 here', m).sort()).toEqual(['不明', '階段'].sort());
    expect(literalsInFile('x.md', '"1階", 地下1階, 1階建て', m)).toEqual(['1階']);
    expect(literalsInFile('x.md', '階段室、歩道橋上り', m)).toEqual([]);
  });
  it('compares the NFKC form, so full-width digits and letters do not escape', () => {
    const m = matcher(['1階', 'ABC-LABEL']);
    expect(literalsInFile('x.md', '- １階 and ＡＢＣ－ＬＡＢＥＬ', m).sort()).toEqual(['1階', 'ABC-LABEL'].sort());
    expect(literalsInFile('x.json', JSON.stringify({ '１階': 1 }), m)).toEqual(['1階']);
  });
  it('exempts allowlisted words only inside prose; a whole JSON value or key is a leak unless structural', () => {
    const m = matcher(['zone', 'unknown', 'road', 'エレベーター'], ['zone', 'unknown', 'road', 'エレベーター'], ['unknown', 'road']);
    expect(literalsInFile('x.md', 'JGD2011 zone IX, status unknown, road kind, エレベーター', m)).toEqual([]);
    expect(literalsInFile('x.json', JSON.stringify({ note: 'zone IX', status: 'unknown', kind: 'road', road: 1 }), m)).toEqual([]);
    expect(literalsInFile('x.json', JSON.stringify({ zone: 1, label: 'エレベーター' }), m).sort()).toEqual(['zone', 'エレベーター'].sort());
  });
  it('treats a longer literal as one word: the prefix literal does not match inside an allowlisted longer term', () => {
    const m = matcher(['エスカレータ', 'エスカレーター'], ['エスカレーター']);
    expect(literalsInFile('x.md', 'エスカレーター', m)).toEqual([]);
    expect(literalsInFile('x.md', 'エスカレータ', m)).toEqual(['エスカレータ']);
  });
  it('scans real-data-summary.json keys and nested values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'literals-rds-')), docs = join(root, 'docs-gis');
    try {
      await mkdir(join(docs, 'rights'), { recursive: true });
      await writeFile(join(docs, 'rights', 'non-poi-literals.md'), 'Credit: SYNTH-CREDIT-TEXT\n');
      await writeFile(join(docs, 'real-data-summary.json'), `${JSON.stringify({ networks: [{ attribute_decoding: { fields: { link: { x: { versions: { v: { decoded_label_counts: { '階段': 2, 'SBS': 1 }, list: ['歩道橋'] } } } } } } }] }, null, 2)}\n`);
      const result = await checkLiterals(docs, root, new Set(), { skipPoi: true, credits: [{ source_id: 'plateau-synth-ubld', attribution_text: 'SYNTH-CREDIT-TEXT' }], classB: async () => ({ literals: new Map([['階段', ['s']], ['歩道橋', ['s']]]), problems: [], per_source: [] }), registered: new Set() });
      expect(result.status).toBe('FAIL'); expect(result.non_poi.leaking_files).toEqual([{ file: 'real-data-summary.json', count: 2 }]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('unregistered sources and class (a) credit pointers (#129)', () => {
  const credit = { source_id: 'plateau-synth-ubld', attribution_text: 'SYNTH-CREDIT-TEXT' };
  const NAME = 'SYNTH-GROUP-NAME-ALPHA';
  const inventory = (extra: Record<string, unknown> = {}) => `${JSON.stringify({ source_id: 'plateau-synth-ubld', compact_features: [{ names: [NAME] }], floor_label_observations: [{ value: NAME }], ...extra }, null, 2)}\n`;
  const tree = async (files: Record<string, string>) => {
    const root = await mkdtemp(join(tmpdir(), 'literals-credit-')), docs = join(root, 'docs-gis');
    for (const [name, text] of Object.entries(files)) { await mkdir(join(docs, name, '..'), { recursive: true }); await writeFile(join(docs, name), text); }
    return { root, docs };
  };
  it('fails a network or inventory report whose source is not in LITERAL_CLASSES', async () => {
    const { root, docs } = await tree({ 'networks/a.json': JSON.stringify({ source_id: 'hokonavi-oedo-shinjuku-network-geojson+brand-new-source', members: [{ source_id: 'another-new-source' }] }), 'inventory/b.inventory.json': JSON.stringify({ source_id: 'plateau-new-ubld' }) });
    try {
      const problems = await verifyRegistered(docs);
      expect(problems.map(problem => problem.source_id)).toEqual(['another-new-source', 'brand-new-source', 'plateau-new-ubld']);
      expect(problems.every(problem => problem.reason === 'unregistered')).toBe(true);
      expect(await verifyRegistered(docs, new Set(['hokonavi-oedo-shinjuku-network-geojson', 'brand-new-source', 'another-new-source', 'plateau-new-ubld']))).toEqual([]);
      const checked = await checkLiterals(docs, root, new Set(), { skipPoi: true, credits: [], classB: async () => ({ literals: new Map([['SYNTH-X-LABEL', ['s']]]), problems: [], per_source: [] }) });
      expect(checked.status).toBe('FAIL'); expect(checked.non_poi.detail_problems.some(problem => problem.reason === 'unregistered')).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('extracts class (a) wording from inventory names and floor-label observations', () => {
    expect([...classAWording([JSON.parse(inventory()), null, { compact_features: [{ names: null }, { names: ['abc'] }] }])]).toEqual([[NAME, ['plateau-synth-ubld']]]);
  });
  it('requires a structured credit in generated reports and a credit or pointer in every other file', async () => {
    const { root, docs } = await tree({
      'inventory/plateau-synth-ubld.inventory.json': inventory(), 'inventory/plateau-synth-ubld.md': `# x\n${NAME}\n`,
      'gaps/station.json': JSON.stringify({ source_ids: { citygml: 'plateau-synth-ubld' }, literal_floor_label_evidence: [{ value: NAME }] }), 'gaps/station.md': `Gap ${NAME}\n`,
      'HANDOFF.md': `The group ${NAME} is quoted here.\n`, 'history/phase1/old.md': `${NAME}\n`, 'history/README.md': 'history\n',
      'rights/non-poi-literals.md': `${NAME} listed here\nSYNTH-CREDIT-TEXT\n`,
    });
    try {
      const failing = await verifyClassACredits(docs, [credit]);
      expect(failing.map(problem => problem.file)).toEqual(['HANDOFF.md', 'gaps/station.json', 'gaps/station.json', 'gaps/station.md', 'history/phase1/old.md', 'inventory/plateau-synth-ubld.inventory.json', 'inventory/plateau-synth-ubld.inventory.json', 'inventory/plateau-synth-ubld.md']);
      const creditField = { attribution_text: 'SYNTH-CREDIT-TEXT', classification: 'docs/gis/rights/non-poi-literals.md' };
      await writeFile(join(docs, 'inventory', 'plateau-synth-ubld.inventory.json'), inventory({ credit: creditField }));
      await writeFile(join(docs, 'inventory', 'plateau-synth-ubld.md'), `# x\nCredit: SYNTH-CREDIT-TEXT\n${NAME}\n`);
      await writeFile(join(docs, 'gaps', 'station.json'), JSON.stringify({ source_ids: { citygml: 'plateau-synth-ubld' }, credit: creditField, literal_floor_label_evidence: [{ value: NAME }] }));
      await writeFile(join(docs, 'gaps', 'station.md'), `Credit: SYNTH-CREDIT-TEXT\nGap ${NAME}\n`);
      await writeFile(join(docs, 'HANDOFF.md'), `The group ${NAME} is quoted here, see rights/non-poi-literals.md.\n`);
      await writeFile(join(docs, 'history', 'README.md'), 'Credit pointer: rights/non-poi-literals.md\n');
      expect(await verifyClassACredits(docs, [credit])).toEqual([]);
      await writeFile(join(docs, 'inventory', 'plateau-synth-ubld.inventory.json'), inventory({ credit: { ...creditField, attribution_text: 'WRONG' } }));
      expect((await verifyClassACredits(docs, [credit])).map(problem => problem.file)).toContain('inventory/plateau-synth-ubld.inventory.json');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('class (a) networks and MLIT labels (decisions of 2026-10-22)', () => {
  const manifest = [
    { source_id: 'hokonavi-ikebukuro-walk-node-csv', title: 'T', license_name: 'PDL 1.0', license_url: 'https://example.invalid/pdl', attribution_text: 'SYNTH-HOKONAVI-CREDIT' },
    { source_id: 'mlit-walk-network-spec-2018-03', title: 'SYNTH-SPEC-TITLE', license_name: 'PDL 1.0', license_url: 'https://example.invalid/link', attribution_text: 'SYNTH-MLIT-CREDIT' },
    { source_id: 'hokonavi-oedo-shinjuku-network-geojson', title: 'T', license_name: 'PDL 1.0', license_url: null, attribution_text: 'SYNTH-E27-TEXT' },
  ];
  it('keeps source values only when every source behind the report is class (a)', () => {
    expect(reportKeepsSourceValues({ source_id: 'hokonavi-ikebukuro-walk-node-csv+hokonavi-ikebukuro-walk-link-csv' })).toBe(true);
    expect(reportKeepsSourceValues({ source_id: 'hokonavi-ikebukuro-walk-node-geojson+hokonavi-ikebukuro-walk-link-geojson' })).toBe(true);
    for (const id of ['hokonavi-oedo-shinjuku-network-geojson', 'hokonavi-oedo-shinjuku-stationmap-geojson', 'hokonavi-ikebukuro-walk-node-csv+hokonavi-oedo-shinjuku-network-geojson', 'brand-new-source', '']) expect(reportKeepsSourceValues({ source_id: id }), id).toBe(false);
    expect(reportKeepsSourceValues(null)).toBe(false);
  });
  it('names the MLIT specifications behind decoded labels, and credits only class (a) sources', async () => {
    expect(reportSourceIds({ source_id: 'a+b', members: [{ source_id: 'c' }], attribute_decoding: { fields: {} } }).sort()).toEqual(['a', 'b', 'c', 'mlit-walk-network-spec-2018-03', 'mlit-walk-network-spec-2024-07']);
    expect(reportSourceIds({ source_id: 'a' })).toEqual(['a']);
    const credit = await reportCredit(['hokonavi-oedo-shinjuku-network-geojson', 'hokonavi-ikebukuro-walk-node-csv', 'mlit-walk-network-spec-2018-03', 'brand-new-source'], { manifest, acquisitionsDir: '/nonexistent' });
    expect(credit?.sources.map(source => source.source_id)).toEqual(['hokonavi-ikebukuro-walk-node-csv', 'mlit-walk-network-spec-2018-03']);
    expect(credit?.attribution_text).toBe('SYNTH-HOKONAVI-CREDIT ; SYNTH-MLIT-CREDIT');
    expect(credit?.classification).toBe('docs/gis/rights/non-poi-literals.md');
    expect(await reportCredit(['hokonavi-oedo-shinjuku-network-geojson', 'plateau-13116-codelists'], { manifest })).toBeNull();
  });
  it('composes the MLIT credit from the acquisition record when it exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'literals-acq-'));
    try {
      await writeFile(join(root, 'mlit-walk-network-spec-2018-03.json'), JSON.stringify({ resolved_url: 'https://example.invalid/spec.pdf', sha256: 'f'.repeat(64) }));
      const credit = await classACredit('mlit-walk-network-spec-2018-03', { manifest, acquisitionsDir: root });
      expect(credit?.attribution_text).toBe(mlitSpecCreditText('SYNTH-SPEC-TITLE', '2018-03', 'https://example.invalid/spec.pdf', 'f'.repeat(64)));
      expect(credit?.attribution_text).toContain('2018-03'); expect(credit?.attribution_text).toContain('f'.repeat(64));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('does not treat a class (b) word that class (a) makes public as a class (b) secret', () => {
    const b: ClassBResult = { literals: new Map([['階段', ['plateau-13116-codelists']], ['SYNTH-CODELIST-ONLY', ['plateau-13116-codelists']]]), problems: [], per_source: [{ source_id: 'plateau-13116-codelists', literal_count: 2 }] };
    const a: ClassBResult = { literals: new Map([['階段', ['mlit-walk-network-spec-2024-07']]]), problems: [], per_source: [] };
    const out = withoutClassA(b, a);
    expect([...out.literals.keys()]).toEqual(['SYNTH-CODELIST-ONLY']); expect(out.overlap).toEqual(['階段']); expect(out.per_source[0]!.literal_count).toBe(1);
  });
  const tree = async (files: Record<string, string>) => {
    const root = await mkdtemp(join(tmpdir(), 'literals-a-')), docs = join(root, 'docs-gis');
    for (const [name, text] of Object.entries(files)) { await mkdir(join(docs, name, '..'), { recursive: true }); await writeFile(join(docs, name), text); }
    return { root, docs };
  };
  const credits = [{ source_id: 'hokonavi-ikebukuro-walk-node-csv', attribution_text: 'SYNTH-HOKONAVI-CREDIT' }, { source_id: 'hokonavi-ikebukuro-walk-node-geojson', attribution_text: 'SYNTH-GEOJSON-CREDIT' }, { source_id: 'mlit-walk-network-spec-2024-07', attribution_text: 'SYNTH-MLIT-CREDIT' }];
  const classA = new Map([['synth-ikebukuro-node-0001', ['hokonavi-ikebukuro-walk-node-csv', 'hokonavi-ikebukuro-walk-node-geojson']], ['SYNTH-MLIT-LABEL-ALPHA', ['mlit-walk-network-spec-2024-07']]]);
  it('requires the credit of a network report that keeps Ikebukuro or MLIT wording, in JSON and Markdown', async () => {
    const body = { source_id: 'x', topology: { duplicate_node_ids: ['synth-ikebukuro-node-0001'] }, decoded_label_counts: { 'SYNTH-MLIT-LABEL-ALPHA': 1 } };
    const { root, docs } = await tree({ 'networks/n.json': `${JSON.stringify(body, null, 2)}\n`, 'networks/n.md': '# n\nsynth-ikebukuro-node-0001 SYNTH-MLIT-LABEL-ALPHA\n' });
    try {
      expect((await verifyClassACredits(docs, credits, { classA })).map(problem => problem.file)).toEqual(['networks/n.json', 'networks/n.json', 'networks/n.md']);
      const credit = { attribution_text: 'SYNTH-HOKONAVI-CREDIT ; SYNTH-MLIT-CREDIT', classification: 'docs/gis/rights/non-poi-literals.md' };
      await writeFile(join(docs, 'networks', 'n.json'), `${JSON.stringify({ credit, ...body }, null, 2)}\n`);
      await writeFile(join(docs, 'networks', 'n.md'), `# n\nCredit: ${credit.attribution_text}\nsynth-ikebukuro-node-0001 SYNTH-MLIT-LABEL-ALPHA\n`);
      expect(await verifyClassACredits(docs, credits, { classA })).toEqual([]);
      // The MLIT label alone needs the MLIT credit: the Hokonavi credit does not cover it.
      await writeFile(join(docs, 'networks', 'n.md'), '# n\nCredit: SYNTH-HOKONAVI-CREDIT\nSYNTH-MLIT-LABEL-ALPHA\n');
      expect((await verifyClassACredits(docs, credits, { classA })).map(problem => problem.file)).toEqual(['networks/n.md']);
      // A value shared by two sources is credited by either source.
      await writeFile(join(docs, 'networks', 'n.md'), '# n\nCredit: SYNTH-GEOJSON-CREDIT\nsynth-ikebukuro-node-0001\n');
      expect(await verifyClassACredits(docs, credits, { classA })).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('lets hand-written and frozen files carry a pointer instead, and ignores short or allowlisted words', async () => {
    const { root, docs } = await tree({ 'research/note.md': 'synth-ikebukuro-node-0001 quoted\n', 'real-data-summary.json': `${JSON.stringify({ k: 'SYNTH-MLIT-LABEL-ALPHA' }, null, 2)}\n`, 'other.md': 'あり 階段 plain words\n' });
    try {
      const withShort = new Map([...classA, ['階段', ['mlit-walk-network-spec-2024-07']], ['plain-term-here', ['mlit-walk-network-spec-2024-07']]]);
      expect((await verifyClassACredits(docs, credits, { classA: withShort, allowlist: new Set(['plain-term-here']) })).map(problem => problem.file)).toEqual(['real-data-summary.json', 'research/note.md']);
      await writeFile(join(docs, 'research', 'note.md'), 'synth-ikebukuro-node-0001 quoted; see rights/non-poi-literals.md\n');
      await writeFile(join(docs, 'real-data-summary.json'), `${JSON.stringify({ credit: { attribution_text: 'SYNTH-MLIT-CREDIT' }, k: 'SYNTH-MLIT-LABEL-ALPHA' }, null, 2)}\n`);
      expect(await verifyClassACredits(docs, credits, { classA: withShort, allowlist: new Set(['plain-term-here']) })).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('check-literals still fails closed for class (b): hashed values, leaks, and a class (a) overlap that is public', async () => {
    const { root, docs } = await tree({ 'rights/non-poi-literals.md': 'SYNTH-CREDIT-TEXT\n', 'context/e27.json': JSON.stringify({ floor: 'SYNTH-E27-FLOOR-NAME' }), 'gaps/g.json': JSON.stringify({ label: '階段' }) });
    try {
      const provider = (literals: string[]) => async (): Promise<ClassBResult> => ({ literals: new Map(literals.map(literal => [literal, ['hokonavi-oedo-shinjuku-network-geojson']])), problems: [], per_source: [] });
      const options = { skipPoi: true, credits: [{ source_id: 'plateau-synth-ubld', attribution_text: 'SYNTH-CREDIT-TEXT' }], registered: new Set(['x']) };
      const failing = await checkLiterals(docs, root, new Set(), { ...options, classB: provider(['SYNTH-E27-FLOOR-NAME', '階段']), classA: async () => ({ literals: new Map([['階段', ['mlit-walk-network-spec-2024-07']]]), problems: [], per_source: [] }) });
      expect(failing.status).toBe('FAIL'); expect(failing.non_poi.leaking_files).toEqual([{ file: 'context/e27.json', count: 1 }]); expect(failing.non_poi.public_through_class_a).toEqual(['階段']);
      const clean = await checkLiterals(docs, root, new Set(), { ...options, classB: provider(['SYNTH-ABSENT-E27-NAME']) });
      expect(clean.status).toBe('PASS');
      expect((await checkLiterals(docs, root, new Set(), { ...options, classB: provider([]) })).status).toBe('FAIL');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('committed reports follow the class split (#129)', () => {
  const gis = join(repoRoot, 'docs', 'gis');
  const names = (directory: string, suffix: string) => readdirSync(join(gis, directory)).filter(name => name.endsWith(suffix)).sort();
  const read = (directory: string, name: string) => readFileSync(join(gis, directory, name), 'utf8');
  it('hashes E27 (class b) values, keeps Ikebukuro (class a) values, and keeps MLIT labels in both', () => {
    for (const name of names('networks', '.json')) {
      const text = read('networks', name), report = JSON.parse(text) as { source_id: string; credit?: { attribution_text: string; sources: Array<{ source_id: string }> }; detail?: unknown; attribute_decoding?: unknown };
      for (const forbidden of ['"function_label"', '"decoded_label_value_hash_distribution"']) expect(text, `${name} ${forbidden}`).not.toContain(forbidden);
      expect(report.detail, name).toBeDefined();
      if (/oedo-shinjuku/u.test(report.source_id)) { for (const forbidden of ['"floor_labels_present_literally"', '"floor_label_counts"']) expect(text, `${name} ${forbidden}`).not.toContain(forbidden); }
      // Every network report carries the MLIT specification credit for its decoded labels; Ikebukuro adds the Hokonavi credit.
      const ids = report.credit?.sources.map(source => source.source_id) ?? [];
      if (report.attribute_decoding) expect(ids, name).toEqual(expect.arrayContaining(['mlit-walk-network-spec-2018-03', 'mlit-walk-network-spec-2024-07']));
      if (/ikebukuro/u.test(report.source_id)) expect(ids.some(id => id.startsWith('hokonavi-ikebukuro-walk-')), name).toBe(true);
      if (report.credit) expect(read('networks', name.replace(/\.json$/u, '.md')), name).toContain(report.credit.attribution_text);
      else expect(/ikebukuro/u.test(report.source_id) || report.attribute_decoding !== undefined, name).toBe(false);
    }
    const ikebukuro = read('networks', 'hokonavi-ikebukuro-walk-node-geojson.json'), shinjuku = read('networks', 'hokonavi-oedo-shinjuku-stationmap-geojson.json');
    expect(ikebukuro).toContain('"floor_labels_present_literally"'); expect(ikebukuro).toContain('横断歩道');
    expect(shinjuku).toContain('"floor_label_value_hash_distribution"'); expect(shinjuku).not.toContain('1階');
  });
  it('keeps the recorded credit with the class (a) values of the ubld inventories and gap packets', () => {
    for (const id of ['plateau-13116-ubld-53394576', 'plateau-13104-ubld-53394536']) {
      const doc = JSON.parse(read('inventory', `${id}.inventory.json`)) as { credit?: { attribution_text: string; classification: string } };
      expect(doc.credit?.attribution_text, id).toContain('PLATEAU'); expect(doc.credit?.classification).toBe('docs/gis/rights/non-poi-literals.md');
      expect(read('inventory', `${id}.md`), id).toContain(doc.credit!.attribution_text);
      expect(read('inventory', `${id}.inventory.json`), id).not.toContain('"function_label"');
    }
    for (const station of ['ikebukuro', 'shinjuku']) {
      const gap = JSON.parse(read('gaps', `${station}.json`)) as { credit?: { attribution_text: string } };
      expect(read('gaps', `${station}.md`), station).toContain(gap.credit!.attribution_text);
    }
    expect(read('gaps', 'ikebukuro.json')).toContain('ほこナビDP');
  });
  it('keeps the credit with the frozen summary and points the history snapshots at the classification file', () => {
    const summary = JSON.parse(readFileSync(join(gis, 'real-data-summary.json'), 'utf8')) as { credit?: { attribution_text: string } };
    expect(summary.credit?.attribution_text).toContain('歩行空間ネットワークデータ');
    expect(readFileSync(join(gis, 'real-data-summary.md'), 'utf8')).toContain(summary.credit!.attribution_text);
    expect(readFileSync(join(gis, 'history', 'README.md'), 'utf8')).toContain('rights/non-poi-literals.md');
  });
});

describe('MLIT codebook source notes (Owner decision ii, #147 comment 6330792563)', () => {
  it('name the specification, version, URL and snapshot sha256 from the acquisition record, and match the report credit', async () => {
    const manifest = parse(readFileSync(join(packageRoot, 'sources', 'sources.yaml'), 'utf8')) as Array<Record<string, any>>;
    for (const version of ['2018-03', '2024-07']) {
      const id = `mlit-walk-network-spec-${version}`;
      const book = JSON.parse(readFileSync(join(packageRoot, 'codebooks', `mlit-walk-network-${version}.json`), 'utf8')) as { spec_sha256: string; source_note: Record<string, string> };
      const acquisition = JSON.parse(readFileSync(join(repoRoot, 'docs', 'gis', 'acquisitions', `${id}.json`), 'utf8')) as { resolved_url: string; sha256: string };
      const title = manifest.find(source => source.source_id === id)!.title as string, note = book.source_note;
      expect(note, version).toMatchObject({ specification: title, version, url: acquisition.resolved_url, snapshot_sha256: acquisition.sha256, acquisition_record: `docs/gis/acquisitions/${id}.json` });
      expect(book.spec_sha256).toBe(acquisition.sha256);
      expect(note.public_basis).toContain('6330792563');
      expect(note.credit).toBe(mlitSpecCreditText(title, version, acquisition.resolved_url, acquisition.sha256));
      expect((await classACredit(id))?.attribution_text, version).toBe(note.credit);
    }
  });
});
