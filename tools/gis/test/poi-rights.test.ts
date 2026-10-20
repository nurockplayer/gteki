import { describe, expect, it } from 'vitest';
import { decodeText, fieldStatistics, inventoryCsv, inventoryJson, bboxRelation } from '../src/poi.js';
import { compareFeatureCollections, attachVerifiedOrigin } from '../src/related.js';
import { evaluateRights, evaluateRightsRecords, snapshotText } from '../src/rights.js';
import { projectRights, rightsScopeMarkdown } from '../src/rights-view.js';

// SYNTHETIC rights and content fixtures; no real station data or legal text.
const fixture = () => ({
  claim_level: 'RESOURCE', licence_claimed: { name: 'Synthetic Licence', version: '1.0', url: 'https://example.invalid/licence' },
  evidence: [{ id: 'synthetic#clause', source_id: 'synthetic', sha256: 'a'.repeat(64), url: 'https://example.invalid/licence', section: 'synthetic §1', quote: 'Synthetic permission' }],
  evidence_verified: true, exact_resource_covered: true, scope: 'Synthetic public product data', attribution_required: 'Synthetic credit', modification_notice_required: true,
  commercial_use: 'conditional', redistribution: 'conditional', modification_allowed: 'yes', third_party_exclusions: { items: ['Synthetic excluded logo'], applies_to_scope: false }, missing_evidence: [],
});
describe('resource rights verdicts', () => {
  it.each(['UNKNOWN', 'RESTRICTED'])('never clears a whole resource with a %s scoped subset', verdict => {
    const source = { ...fixture(), layer: null };
    const subset = { ...fixture(), layer: 'Synthetic excluded subset', ...(verdict === 'UNKNOWN' ? { commercial_use: 'unknown' } : { redistribution: 'no' }) };
    // Even a forged stored verdict must be recomputed from the scoped evidence.
    const rows = evaluateRightsRecords([source, { ...subset, verdict: 'CLEARED_WITH_CONDITIONS' }]);
    expect(rows[0].verdict).toBe('UNKNOWN'); expect(rows[1].verdict).toBe(verdict);
    expect(rows[0].reason).toContain('split required');
    expect(evaluateRights(rows[0]).verdict).toBe('UNKNOWN');
    expect(evaluateRightsRecords(rows)).toEqual(rows);
  });
  it('retains whole-resource clearance when every scoped subset is cleared', () => {
    expect(evaluateRightsRecords([{ ...fixture(), layer: null }, { ...fixture(), layer: 'Synthetic factual fields' }]).map(row => row.verdict))
      .toEqual(['CLEARED_WITH_CONDITIONS', 'CLEARED_WITH_CONDITIONS']);
  });
  it('preserves scope, exclusions and not-covered notes in every shared projection', () => {
    const row = { ...fixture(), ...evaluateRights(fixture()), layer: 'Synthetic fields', not_covered: ['Synthetic prose | external targets'], field_scope: { excluded_fields: ['description'] }, publish_gate: 'HOLD', routable: false };
    const projected = projectRights({ source_id: 'synthetic', source_sha256: 'b'.repeat(64) }, row);
    for (const key of ['scope', 'third_party_exclusions', 'not_covered', 'field_scope', 'publish_gate', 'routable'] as const) expect(projected[key]).toEqual(row[key]);
    const markdown = rightsScopeMarkdown(projected);
    expect(markdown).toContain(row.scope); expect(markdown).toContain(JSON.stringify(row.third_party_exclusions));
    expect(markdown).toContain('Synthetic prose \\| external targets'); expect(markdown).toContain(JSON.stringify(row.field_scope));
  });
  it.each(['RESOURCE', 'DATASET'])('accepts explicit %s coverage with complete conditions', claim_level => {
    expect(evaluateRights({ ...fixture(), claim_level }).verdict).toBe('CLEARED_WITH_CONDITIONS');
  });
  it.each(['SITE_POLICY', 'ORIGIN_DATASET', 'NONE', '__proto__', 'constructor', 'toString'])('keeps %s claims UNKNOWN', claim_level => {
    expect(evaluateRights({ ...fixture(), claim_level }).verdict).toBe('UNKNOWN');
  });
  it.each(['commercial_use', 'redistribution', 'modification_allowed'])('restricts a verified denial of %s', key => {
    expect(evaluateRights({ ...fixture(), [key]: 'no' }).verdict).toBe('RESTRICTED');
  });
  const linkedOrigin = () => ({ ...fixture(), claim_level: 'ORIGIN_DATASET', origin_linkage_verified: true, identity_check: 'features-equal', derivative_licence_verified: true, origin_licence_class: 'CC_BY_4_0' });
  it('restricts verified non-commercial origin data for commercial redistribution', () => {
    expect(evaluateRights({ ...linkedOrigin(), origin_licence_class: 'KSJ_NON_COMMERCIAL', commercial_use: 'no', redistribution: 'no' }).verdict).toBe('RESTRICTED');
  });
  it('clears linked CC BY origin plus the derivative grant with conditions', () => {
    expect(evaluateRights(linkedOrigin()).verdict).toBe('CLEARED_WITH_CONDITIONS');
    expect(evaluateRights({ ...linkedOrigin(), derivative_licence_verified: false }).verdict).toBe('UNKNOWN');
  });
  it('keeps unpublished survey approval scope UNKNOWN even with a general grant', () => {
    expect(evaluateRights({ ...linkedOrigin(), approval_scope: 'unknown' }).verdict).toBe('UNKNOWN');
  });
  it('does not attach origins or clear/restrict unverified or differing feature arrays', () => {
    const a = { type: 'FeatureCollection', name: 'Synthetic A', features: [{ type: 'Feature', properties: { name: 'Synthetic' }, geometry: null }] };
    const b = { ...a, name: 'Synthetic B' }, c = { ...a, features: [] };
    expect(compareFeatureCollections(a, a)).toBe('JSON-equal');
    expect(compareFeatureCollections(a, b)).toBe('features-equal');
    expect(compareFeatureCollections(a, c)).toBe('different');
    expect(compareFeatureCollections({}, {})).toBe('different');
    expect(attachVerifiedOrigin(compareFeatureCollections(a, c), { url: 'https://example.invalid/origin' })).toBeNull();
    expect(attachVerifiedOrigin(compareFeatureCollections(a, b), { date: 'Synthetic date' })).toEqual({ date: 'Synthetic date' });
    for (const change of [{ identity_check: 'different' }, { origin_linkage_verified: false }]) {
      expect(evaluateRights({ ...linkedOrigin(), ...change }).verdict).toBe('UNKNOWN');
      expect(evaluateRights({ ...linkedOrigin(), ...change, commercial_use: 'no' }).verdict).toBe('UNKNOWN');
    }
  });
  it('does not match hidden HTML comments or script/style text as licence clauses', () => {
    expect(snapshotText(Buffer.from('<!-- Synthetic hidden --><script>Synthetic script</script><style>Synthetic style</style><p>Synthetic visible</p>'))).toBe('Syntheticvisible');
  });
  it.each([true, 'UNKNOWN'])('does not clear an applicable/unresolved exclusion (%s)', applies_to_scope => {
    expect(evaluateRights({ ...fixture(), third_party_exclusions: { items: ['Synthetic logo'], applies_to_scope } }).verdict).toBe('UNKNOWN');
  });
  it.each(['evidence', 'licence_claimed', 'exact_resource_covered', 'evidence_verified', 'scope', 'third_party_exclusions', 'attribution_required', 'modification_notice_required', 'missing_evidence'])('does not clear missing %s', key => {
    const input: any = fixture(); delete input[key]; expect(evaluateRights(input).verdict).toBe('UNKNOWN');
  });
  it.each([null, false, 7, [], {}, 'yes'])('handles malformed top-level input %j', input => {
    expect(evaluateRights(input).verdict).toBe('UNKNOWN');
  });
  it.each(['claim_level', 'licence_claimed', 'commercial_use', 'redistribution', 'attribution_required'])('rejects non-string/container values in %s', key => {
    for (const value of [null, 4, true, {}, []]) expect(evaluateRights({ ...fixture(), [key]: value }).verdict).toBe('UNKNOWN');
  });
  it('requires own properties and does not accept inherited permission or mutate prototypes', () => {
    expect(evaluateRights(Object.create(fixture())).verdict).toBe('UNKNOWN');
    const odd = JSON.parse('{"__proto__":{"commercial_use":"yes"},"constructor":"yes"}');
    expect(evaluateRights(odd).verdict).toBe('UNKNOWN'); expect(({} as any).commercial_use).toBeUndefined();
  });
  it('rejects long, non-string and unhashed clauses and unverified denial', () => {
    for (const change of [{ quote: 'あ'.repeat(41) }, { quote: 12 }, { sha256: 'not-a-hash' }]) {
      expect(evaluateRights({ ...fixture(), evidence: [{ ...fixture().evidence[0], ...change }] }).verdict).toBe('UNKNOWN');
    }
    expect(evaluateRights({ ...fixture(), commercial_use: 'no', evidence_verified: false }).verdict).toBe('UNKNOWN');
    expect(evaluateRights({ ...fixture(), missing_evidence: ['Missing origin identity'] }).verdict).toBe('UNKNOWN');
  });
});
describe('bounded content inventories', () => {
  it('detects UTF-8 BOM, strict Shift_JIS, and rejects invalid byte sequences', () => {
    expect(decodeText(Buffer.from('\ufeff場所\n改札内')).encoding).toBe('UTF-8');
    expect(decodeText(Buffer.from([0x89, 0x77])).text).toBe('駅');
    expect(decodeText(Buffer.from([0x89, 0x77])).encoding).toBe('Shift_JIS');
    expect(() => decodeText(Buffer.from([0x81]))).toThrow('neither');
  });
  it('preserves literal location/time, headers and blank records without coordinates', () => {
    const result = inventoryCsv(Buffer.from('施設名,設置場所,営業時間\nSYNTHETIC,改札内 B9階,05:00-24:00\n,,\n'));
    expect(result.summary).toMatchObject({ row_count: 2, populated_row_count: 1, blank_row_count: 1, coordinates: 'UNKNOWN', coordinate_fields: [], routable: false });
    expect(result.detail[0]['設置場所']).toBe('改札内 B9階'); expect(result.summary.fields['営業時間'].blank_count).toBe(1);
    expect(() => inventoryCsv(Buffer.from('a,a\n1,2'))).toThrow('Duplicate');
  });
  it('handles odd field names, non-string literals and missing values safely', () => {
    const row = JSON.parse('{"__proto__":"literal","constructor":null,"a":[1],"b":false}');
    const fields = fieldStatistics([row, {}]);
    expect(fields['__proto__'].literal_distribution).toEqual([{ value: 'literal', count: 1 }]);
    expect(fields['constructor'].blank_count).toBe(2); expect(fields['b'].types).toContain('boolean');
    expect(({} as any).literal).toBeUndefined();
  });
  it('inventories GeoJSON types/bbox/literal opening hours with UNKNOWN CRS', () => {
    const result = inventoryJson({ type: 'FeatureCollection', properties: { name: 'B9F' }, features: [
      { geometry: { type: 'Point', coordinates: [139, 35] }, properties: { openinghour: 'SYNTHETIC 05:00', source: 'Synthetic origin', floor: '地下通路' } },
      { geometry: { type: 'LineString', coordinates: [[138, 34], [140, 36]] }, properties: {} },
    ] }, 'synthetic.geojson');
    expect(result).toMatchObject({ feature_count: 2, bbox: [138, 34, 140, 36], crs: 'UNKNOWN', routable: false });
    expect(result.literal_location_time_fields['floor'].literal_distribution[0].value).toBe('地下通路');
    expect(Object.keys(result.origin_attribution_fields)).toEqual(['source']);
  });
  it('keeps Path commands out of geographic bboxes and navigation references out of edges', () => {
    const path = inventoryJson({ type: 'FeatureCollection', crs: null, features: [{ geometry: { type: 'Path', coordinates: [[0, 900, 1000], [4]] }, properties: {} }] }, 'path.geojson');
    expect(path).toMatchObject({ crs: 'UNKNOWN', crs_declared: true, bbox: null, unsupported_geometry_count: 1, routable: false });
    const nav = inventoryJson({ n: [{ id: 1, mx: 100, my: 200 }], l: [{ n1: 1, n2: 2 }] }, 'v5_nav.json');
    expect(nav.route_structure).toMatchObject({ source_link_count: 1, source_node_count: 1, start_end_fields: ['n1', 'n2'], exported_edges: 0 });
  });
  it('keeps promotional description samples out of Git inventories', () => {
    const stats = fieldStatistics([{ description: 'SYNTHETIC promotional prose', name: 'SYNTHETIC factual label' }]);
    expect(stats.description.literal_distribution).toEqual([]);expect(stats.description.distinct_count).toBe(1);expect(stats.description.omitted_distinct).toBe(1);
    expect(stats.name.literal_distribution).toHaveLength(1);
  });
  it('compares only valid bboxes including boundary contact', () => {
    expect(bboxRelation([0, 0, 1, 1], [1, 1, 2, 2])).toBe('INTERSECTS');
    expect(bboxRelation([0, 0, 1, 1], [2, 2, 3, 3])).toBe('DISJOINT');
    expect(bboxRelation([NaN, 0, 1, 1], [0, 0, 1, 1])).toBe('UNKNOWN'); expect(bboxRelation(null, [0, 0, 1, 1])).toBe('UNKNOWN');
  });
});
