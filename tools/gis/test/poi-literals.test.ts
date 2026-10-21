import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inventoryCsv, inventoryJson, valueSha256 } from '../src/poi.js';
import { detailLiterals, literalsInText, scanTreeForLiterals, storeDetailLiterals } from '../src/poi-literals.js';
import { projectPoiContent } from '../src/gaps.js';
import { openingHourLines } from '../src/poi-research.js';

// SYNTHETIC values only. Every free-text value below is invented and unique so any occurrence in a committed report is a leak.
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const csvBytes = Buffer.from('配置,施設名,設置場所,営業時間・利用時間\nQ1,SYNTH-SHOP-ALPHA,SYNTH-PLACE-ONE 地下9階,SYNTH-HOURS 05:00〜24:00\nQ2,SYNTH-SHOP-BETA,SYNTH-PLACE-TWO,\nQ3,SYNTH-SHOP-ALPHA,SYNTH-PLACE-TWO,SYNTH-HOURS 05:00〜24:00\n', 'utf8');
const geoJson = () => ({ type: 'FeatureCollection', properties: { name: 'SYNTH-ROOT-NAME', city: 'SYNTH-ROOT-CITY' }, features: [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [139.7, 35.6] }, properties: { name: 'SYNTH-FEATURE-ONE', openinghour: 'SYNTH-OPEN 10:00〜20:00', source: 'SYNTH-ORIGIN-TEXT', description: 'SYNTH-DESCRIPTION prose', floor: ['SYNTH-FLOOR-ARRAY'] } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [139.8, 35.7] }, properties: { name: 'SYNTH-FEATURE-TWO', openinghour: 'SYNTH-OPEN 10:00〜20:00', source: 'SYNTH-ORIGIN-TEXT' } },
] });
const nav = () => ({ n: [{ id: 'SYNTH-NODE-ID', mx: 1 }], l: [{ n1: 'SYNTH-NODE-ID', n2: 'SYNTH-NODE-OTHER' }] });

describe('POI reports committed to Git carry no source values', () => {
  it('hashes CSV values, keeps the literals only in the detail, and keeps counts', () => {
    const { summary, detail } = inventoryCsv(csvBytes);
    const literals = detailLiterals(detail);
    expect(literals.has('SYNTH-SHOP-ALPHA')).toBe(true); // the detail report still has the literals
    expect(detail[0]['施設名']).toBe('SYNTH-SHOP-ALPHA');
    expect(literalsInText(JSON.stringify(summary), literals)).toEqual([]);
    expect(summary.fields['施設名']).toMatchObject({ distinct_count: 2, blank_count: 0, omitted_distinct: 0,
      value_hash_distribution: [{ value_sha256: sha('SYNTH-SHOP-ALPHA'), value_type: 'string', count: 2 }, { value_sha256: sha('SYNTH-SHOP-BETA'), value_type: 'string', count: 1 }].sort((a, b) => b.count - a.count) });
    expect(summary.fields['営業時間・利用時間']).toMatchObject({ blank_count: 1, distinct_count: 1 });
    expect(summary.headers).toEqual(['配置', '施設名', '設置場所', '営業時間・利用時間']); // field names (schema) stay
  });
  it('hashes GeoJSON properties, root properties, origin fields and navigation fields', () => {
    const feature = inventoryJson(geoJson(), 'synthetic.geojson') as any, navigation = inventoryJson(nav(), 'v5_nav.json') as any;
    const literals = new Set([...detailLiterals({ 'synthetic.geojson': geoJson(), 'v5_nav.json': nav() })]);
    for (const expected of ['SYNTH-ROOT-NAME', 'SYNTH-OPEN 10:00〜20:00', 'SYNTH-ORIGIN-TEXT', 'SYNTH-DESCRIPTION prose', 'SYNTH-NODE-ID']) expect(literals.has(expected)).toBe(true);
    for (const report of [feature, navigation]) expect(literalsInText(JSON.stringify(report), literals)).toEqual([]);
    expect(feature.root_properties).toEqual({ name: { value_sha256: sha('SYNTH-ROOT-NAME'), value_type: 'string' }, city: { value_sha256: sha('SYNTH-ROOT-CITY'), value_type: 'string' } });
    expect(feature.origin_attribution_fields.source.value_hash_distribution).toEqual([{ value_sha256: sha('SYNTH-ORIGIN-TEXT'), value_type: 'string', count: 2 }]);
    expect(feature.location_time_fields.openinghour.value_hash_distribution[0]).toEqual({ value_sha256: sha('SYNTH-OPEN 10:00〜20:00'), value_type: 'string', count: 2 });
    expect(feature.fields.floor.value_hash_distribution[0].value_sha256).toBe(valueSha256(['SYNTH-FLOOR-ARRAY']));
    expect(navigation.route_structure).toMatchObject({ source_link_count: 1, source_node_count: 1, start_end_fields: ['n1', 'n2'] });
    expect(feature).toMatchObject({ feature_count: 2, bbox: [139.7, 35.6, 139.8, 35.7] });
  });
  it('hashes the UTF-8 bytes of the value', () => {
    expect(valueSha256('施設')).toBe(createHash('sha256').update(Buffer.from([0xe6, 0x96, 0xbd, 0xe8, 0xa8, 0xad])).digest('hex'));
  });
  it('keeps downstream consumers working on the hashed report', () => {
    const member = inventoryJson({ entities: [{ properties: { hours: 'SYNTH-OPEN 09:00', name: 'SYNTH-ENTITY' } }] }, 'com-entity.geojson') as any;
    const nav2 = inventoryJson(nav(), 'v5_nav.json') as any;
    const report = { source_id: 'tokyo-s03-zip', source_sha256: 'a', coordinates: 'SEE_MEMBERS', station_ids: ['shinjuku'], members: [member, nav2], detail: { store_path: 'out/poi/x.json', sha256: 'b', bytes: 1 }, station_relevance: [] };
    const projected = projectPoiContent(report, 'shinjuku');
    expect(Object.keys(projected.members[0].location_time_fields)).toEqual(['hours']);
    expect(literalsInText(JSON.stringify(projected), ['SYNTH-OPEN 09:00', 'SYNTH-ENTITY'])).toEqual([]);
    const lines = openingHourLines([report]);
    expect(lines).toHaveLength(2);
    expect(lines.join('\n')).toContain(sha('SYNTH-OPEN 09:00'));
    expect(lines.join('\n')).not.toContain('SYNTH-OPEN');
    expect(lines[1]).toContain('source links 1');
  });
});

describe('leak scan', () => {
  it('extracts free-text values but not keys, geometry or pure numbers', () => {
    const literals = detailLiterals({ 'a.geojson': { features: [{ properties: { 'SYNTH-KEY-NAME': 'SYNTH-VALUE', n: '123456', s: 'ab' }, geometry: { coordinates: ['SYNTH-NOT-A-VALUE'] } }] } });
    expect([...literals]).toEqual(['SYNTH-VALUE']);
    expect([...detailLiterals([{ 施設: 'SYNTH-CELL', 空: '' }])]).toEqual(['SYNTH-CELL']);
  });
  it('finds literals verbatim and JSON-escaped in committed text, and passes a clean tree', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'poi-literals-')), store = await mkdtemp(join(tmpdir(), 'poi-store-'));
    try {
      await mkdir(join(store, 'out', 'poi'), { recursive: true }); await mkdir(join(dir, 'poi'), { recursive: true });
      await writeFile(join(store, 'out', 'poi', 'synthetic-aaaa-bbbb.json'), JSON.stringify([{ 施設名: 'SYNTH-"QUOTED"-SHOP', 備考: 'SYNTH-NOTE' }]));
      const literals = await storeDetailLiterals(store);
      expect([...literals.keys()].sort()).toEqual(['SYNTH-"QUOTED"-SHOP', 'SYNTH-NOTE']);
      await writeFile(join(dir, 'poi', 'clean.json'), JSON.stringify({ value_sha256: sha('SYNTH-NOTE'), count: 1 }));
      expect(await scanTreeForLiterals(dir, literals.keys())).toEqual([]);
      await writeFile(join(dir, 'poi', 'leak.json'), JSON.stringify({ value: 'SYNTH-"QUOTED"-SHOP' }));
      await writeFile(join(dir, 'leak.md'), 'prose with SYNTH-NOTE inside');
      expect(await scanTreeForLiterals(dir, literals.keys())).toEqual([{ file: 'leak.md', count: 1 }, { file: 'poi/leak.json', count: 1 }]);
    } finally { await rm(dir, { recursive: true, force: true }); await rm(store, { recursive: true, force: true }); }
  });
});

describe('generic-vocabulary allowlist', () => {
  it('loads as a string set of generic terms', async () => {
    const { loadLiteralAllowlist } = await import('../src/poi-literals.js');
    const terms = await loadLiteralAllowlist();
    expect(terms.size).toBeGreaterThan(0); expect(terms.has('building')).toBe(true);
    // Distinctive source values (facility names, addresses, opening-hour strings) must never be exempted.
    for (const term of terms) { expect(term).not.toMatch(/\s|[〜:：（）()]/u); expect(term.length).toBeLessThanOrEqual(12); }
  });
});
