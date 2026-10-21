import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { packageRoot, repoRoot } from '../src/common.js';
import { codebookLabels, codelistLabels, checkLiterals, hokonaviLiterals, scrubLiterals, scrubText, verifyCredits, verifyReportDetails, type ClassBResult } from '../src/literals.js';
import { LITERAL_CLASSES, literalClassificationMarkdown, literalRows } from '../src/literal-classes.js';
import { hashedDistribution, hashedValue, isEnumeratedCode, publicInventorySummary, publicNetworkReport } from '../src/literal-public.js';
import { literalsInText } from '../src/poi-literals.js';

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
    const literals = new Set([LABEL_A, LABEL_B, FLOOR, LINK_ID, NODE_ID, FLOOR_ID]);
    const raw = literalReport(), pub = publicNetworkReport(raw) as any;
    expect(literalsInText(JSON.stringify(raw), literals).length).toBe(literals.size); // the fixture really holds them
    expect(literalsInText(JSON.stringify(pub), literals)).toEqual([]);
    const decoded = pub.attribute_decoding.fields.link.rt_struct.versions['2024-07'];
    expect(decoded).not.toHaveProperty('decoded_label_counts');
    expect(decoded.decoded_label_value_hash_distribution).toEqual([{ value_sha256: sha(LABEL_A), value_type: 'string', count: 2 }, { value_sha256: sha(LABEL_B), value_type: 'string', count: 1 }].sort((a, b) => b.count - a.count));
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
    // Our own rank-letter rendering is not specification wording.
    expect(pub.attribute_decoding.fields.link.rank.versions['2024-07'].decoded_label_counts).toEqual({ 'S / B / S': 1, 'A / A / A': 2 });
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
    const pub = publicNetworkReport({ attribute_decoding: { fields: { link: { x: { versions: { v: { decoded_label_counts: JSON.parse('{"__proto__": 1}') } } } } } } }) as any;
    expect(pub.attribute_decoding.fields.link.x.versions.v.decoded_label_value_hash_distribution).toEqual([{ value_sha256: sha('__proto__'), value_type: 'string', count: 1 }]);
  });
  it('classifies codes: numeric, markers and values under four characters stay, longer text is free', () => {
    for (const code of ['5', '-0.5', '99', '(blank)', '(unavailable)', '(unknown)', 'SBS', 'あり']) expect(isEnumeratedCode(code)).toBe(true);
    for (const free of ['SYNTH-LABEL', '横断歩道', 'synth-link-0000-aaaa']) expect(isEnumeratedCode(free)).toBe(false);
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
    const csv = hokonaviLiterals('node.csv', Buffer.from('node_id,floor,name\nsynth-node-0001,-0.5,SYNTH-NODE-NAME\nsynth-node-0002,1.0,\n', 'utf8'));
    expect([...csv].sort()).toEqual(['SYNTH-NODE-NAME', 'synth-node-0001', 'synth-node-0002']);
    const geo = hokonaviLiterals('floor.geojson', Buffer.from(JSON.stringify({ type: 'FeatureCollection', properties: { title: 'SYNTH-ROOT-TITLE' }, features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [139.7, 35.6] }, properties: { name: FLOOR, floor_id: FLOOR_ID, rank: 'SBS' } }] }), 'utf8'));
    expect([...geo].sort()).toEqual([FLOOR, FLOOR_ID, 'SYNTH-ROOT-TITLE'].sort());
  });
  it('reads codebook labels and codelist descriptions', () => {
    expect([...codebookLabels({ version: 'x', link: { rt_struct: { codes: { '1': { label: LABEL_A, transcription_check: 'TEXT' }, '2': { label: 'あり' }, '3': { label: '123456' } } } } })]).toEqual([LABEL_A]);
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
  const run = (docs: string, store: string, provider: () => Promise<ClassBResult>, allowlist: ReadonlySet<string> = new Set(), extra = {}) => checkLiterals(docs, store, allowlist, { skipPoi: true, credits: credit, classB: provider, ...extra });

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
      expect((await run(docs, store, classB(['synth-road', LABEL_A]), new Set(['synth-road']))).non_poi).toMatchObject({ status: 'PASS', scanned_literals: 1 });
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
  it('replaces literals longest first, verbatim and JSON-escaped, and is idempotent', () => {
    const text = `{"k":"${LABEL_A}","SYNTH-"QUOTED"":1,"s":"${LABEL_B} / ${LABEL_B}","long":"${LABEL_B}-LONGER"}`.replace('"SYNTH-"QUOTED""', '"SYNTH-\\"QUOTED\\""');
    const out = scrubText(text, [LABEL_B, `${LABEL_B}-LONGER`, LABEL_A, 'SYNTH-"QUOTED"']);
    expect(out.replaced).toBe(5);
    expect(out.text).toContain(`"long":"value_sha256:${sha(`${LABEL_B}-LONGER`)}"`);
    expect(out.text).not.toContain('SYNTH');
    expect(() => JSON.parse(out.text)).not.toThrow();
    expect(scrubText(out.text, [LABEL_B, LABEL_A]).replaced).toBe(0);
  });
  it('rewrites only files that hold a literal, keeps JSON valid, and refuses unavailable literals or escaping targets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'literals-scrub-')), docs = join(root, 'docs-gis');
    try {
      await mkdir(join(docs, 'history'), { recursive: true });
      await writeFile(join(docs, 'history', 'a.json'), JSON.stringify({ [FLOOR_ID]: 1, list: [LABEL_A] }));
      await writeFile(join(docs, 'history', 'b.md'), 'clean text');
      const provider = await (async () => (await (async (): Promise<ClassBResult> => ({ literals: new Map([[FLOOR_ID, ['s']], [LABEL_A, ['s']], ['synth-generic', ['s']]]), problems: [], per_source: [] }))()))();
      const changed = await scrubLiterals(docs, ['history'], new Set(['synth-generic']), provider);
      expect(changed).toEqual([{ file: 'history/a.json', replaced: 2 }]);
      const after = JSON.parse(await readFile(join(docs, 'history', 'a.json'), 'utf8'));
      expect(after).toEqual({ [`value_sha256:${sha(FLOOR_ID)}`]: 1, list: [`value_sha256:${sha(LABEL_A)}`] });
      expect(await scrubLiterals(docs, ['history'], new Set(), provider)).toEqual([]);
      await expect(scrubLiterals(docs, ['..'], new Set(), provider)).rejects.toThrow(/escapes/);
      await expect(scrubLiterals(docs, ['history'], new Set(), { ...provider, problems: [{ source_id: 's', reason: 'missing', detail: 'x' }] })).rejects.toThrow(/unavailable/);
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
      await writeFile(join(gis, 'networks', 'synthetic.json'), JSON.stringify({ source_id: 'hokonavi-ikebukuro-walk-node-geojson+hokonavi-ikebukuro-walk-link-geojson', floor_label_value_hash_distribution: [{ ...hashedValue('f'), count: 2 }], attribute_decoding: { fields: { link: { rt_struct: { versions: { '2024-07': { decoded_label_value_hash_distribution: [{ ...hashedValue('l'), count: 1 }] } } } } } } }));
      const markdown = await literalClassificationMarkdown(gis, manifest);
      expect(markdown).toContain('license_name: `SYNTH-LICENCE`; license_url: `https://example.invalid/licence`; publish_gate: `SYNTH-GATE`; attribution_text: `SYNTH-CREDIT-TEXT`; notes: `SYNTH note with \\| pipe`');
      expect(markdown).toContain('license_name: `unknown`; license_url: `null`; publish_gate: `HOLD`');
      expect(markdown).toContain('- plateau-13116-ubld-53394576: SYNTH-CREDIT-TEXT (SYNTH-LICENCE, https://example.invalid/licence)');
      const rows = markdown.split('\n').filter(line => line.startsWith('| inventory/') || line.startsWith('| networks/'));
      expect(rows).toContain(`| inventory/plateau-13116-ubld-53394576.inventory.json | floor_label_observations[].value | plateau-13116-ubld-53394576 | a | 1 | ${evidence('plateau-13116-ubld-53394576')} |`);
      expect(rows.some(row => row.includes('| compact_features[].names[] | plateau-13116-ubld-53394576 | a | 2 |'))).toBe(true);
      expect(rows.some(row => row.includes('| compact_features[].function_label_hash | plateau-13116-codelists | b | 1 |'))).toBe(true);
      expect(rows.some(row => row.includes('| codelist_resolution[].label_hash | plateau-13116-codelists | b | 1 |'))).toBe(true);
      expect(rows.some(row => row.includes('| networks/synthetic.json | floor_label_value_hash_distribution[] | hokonavi-ikebukuro-walk-node-geojson | b | 1 |'))).toBe(true);
      expect(rows.some(row => row.includes('| attribute_decoding.fields.link.rt_struct.versions.2024-07.decoded_label_value_hash_distribution[] | mlit-walk-network-spec-2024-07 | b | 1 |'))).toBe(true);
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
        const file = path.split('#')[0]!;
        expect(existsSync(join(repoRoot, file)), `${entry.source_id} evidence ${file}`).toBe(true);
      }
    }
    // The cases fixed by the task: codelists are (b), E27 labels are (b), MLIT specification labels are (b).
    const classOf = (id: string) => LITERAL_CLASSES.find(entry => entry.source_id === id)?.class;
    expect(classOf('plateau-13116-codelists')).toBe('b'); expect(classOf('plateau-13104-codelists')).toBe('b');
    expect(classOf('hokonavi-oedo-shinjuku-stationmap-geojson')).toBe('b'); expect(classOf('hokonavi-oedo-shinjuku-network-geojson')).toBe('b');
    expect(classOf('mlit-walk-network-spec-2018-03')).toBe('b'); expect(classOf('mlit-walk-network-spec-2024-07')).toBe('b');
    expect(classOf('plateau-13116-ubld-53394576')).toBe('a');
  });
});

describe('generic-vocabulary allowlist justifications (#129)', () => {
  const BASELINE = ['MB2F', 'Stream', 'above', 'ange', 'below', 'building', 'door', 'elevator', 'entrance', 'escalator', 'gate', 'general', 'indoor', 'information', 'locker', 'ramp', 'section', 'stairs', 'step', 'true', 'unit', 'wall', 'エスカレーター', 'エレベーター', 'コインロッカー', 'スロープ'];
  it('gives every term added after #128 a written reason', async () => {
    const file = JSON.parse(await readFile(join(packageRoot, 'codebooks', 'poi-literal-allowlist.json'), 'utf8')) as { terms: string[]; justifications?: Record<string, string> };
    const added = file.terms.filter(term => !BASELINE.includes(term));
    expect(added.length).toBeGreaterThan(0);
    for (const term of added) expect(file.justifications?.[term]?.length ?? 0, term).toBeGreaterThanOrEqual(20);
    for (const term of Object.keys(file.justifications ?? {})) expect(file.terms).toContain(term);
  });
});

describe('committed reports carry no class (b) wording keys (#129)', () => {
  const gis = join(repoRoot, 'docs', 'gis');
  const json = (directory: string) => readdirSync(join(gis, directory)).filter(name => name.endsWith('.json')).map(name => ({ name: `${directory}/${name}`, text: readFileSync(join(gis, directory, name), 'utf8') }));
  it('uses the hashed field names in inventory, network and gap reports', () => {
    for (const { name, text } of [...json('inventory'), ...json('networks'), ...json('gaps')]) {
      for (const forbidden of ['"floor_labels_present_literally"', '"floor_label_counts"', '"function_label"']) expect(text, `${name} ${forbidden}`).not.toContain(forbidden);
      // Decoded specification labels are hashed; only our own rank-letter rendering (S / A / B) may remain as `decoded_label_counts`.
      for (const match of text.matchAll(/"decoded_label_counts": \{([^}]*)\}/gu)) for (const label of match[1]!.matchAll(/"([^"]+)":/gu)) expect(label[1], `${name} decoded_label_counts`).toMatch(/^[SABCZX](?: \/ [SABCZX])*$/u);
      if (name.startsWith('networks/')) expect(text, name).toContain('"detail"');
    }
  });
});
