import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildLeadList, classifySourceTag, compareList, computeCoverage, computeQuality, containmentShare, deriveCategory,
  namedOsmObjects, normaliseLevel, normaliseName, parseLevels, parseOurList, parseOverpassJson, pointInPolygon,
  publicCoverageReceipt, querySha256, stationProjector, tagValueSet, writeCoverageOutputs,
  type CoverageFacts, type OurList, type QualityFacts,
} from '../src/osm-coverage.js';

const tempDirs: string[] = [];
const tempDir = async (): Promise<string> => { const path = await mkdtemp(join(tmpdir(), 'gteki-osm-coverage-')); tempDirs.push(path); return path; };
afterEach(async () => { await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

/** Station origin of shinjuku from stations/shinjuku/gteki/station.json; a metre of latitude is ~1/110574 degree. */
const ORIGIN = { lat: 35.687, lon: 139.6994 };

/** A synthetic Overpass payload: the fields `out meta geom` returns, including the personal ones this tool must drop. */
function fixturePayload() {
  return {
    version: 0.6,
    generator: 'Overpass API synthetic fixture',
    elements: [
      { type: 'node', id: 101, lat: ORIGIN.lat + 0.0004, lon: ORIGIN.lon + 0.0002, timestamp: '2024-05-06T10:00:00Z', version: 3, user: 'fixture-mapper', uid: 999001, changeset: 4242,
        tags: { shop: 'convenience', name: '合成コンビニ', 'name:en': 'Synthetic Mart', level: 'B1', source: 'survey', 'source:name': 'https://example.invalid/directory' } },
      { type: 'node', id: 102, lat: ORIGIN.lat - 0.0004, lon: ORIGIN.lon - 0.0002, timestamp: '2019-01-02T03:04:05Z', version: 1, user: 'fixture-mapper', uid: 999001, changeset: 4243,
        tags: { amenity: 'restaurant', name: '合成食堂 店舗', level: '1;2', source: 'Google Maps', fixme: 'check opening hours' } },
      { type: 'node', id: 103, lat: ORIGIN.lat + 0.0004, lon: ORIGIN.lon + 0.0002, timestamp: '2023-01-01T00:00:00Z', version: 2, user: 'fixture-mapper', uid: 999001, changeset: 4244,
        tags: { railway: 'subway_entrance', name: '合成改札口', note: 'photo from street', source: 'GSI' } },
      { type: 'way', id: 201, timestamp: '2022-02-02T00:00:00Z', version: 5, user: 'fixture-mapper', uid: 999001, changeset: 4245,
        tags: { building: 'train_station', name: '合成駅ビル' },
        geometry: [
          { lat: ORIGIN.lat + 0.0006, lon: ORIGIN.lon + 0.0001 },
          { lat: ORIGIN.lat + 0.0006, lon: ORIGIN.lon + 0.0009 },
          { lat: ORIGIN.lat + 0.0001, lon: ORIGIN.lon + 0.0009 },
          { lat: ORIGIN.lat + 0.0001, lon: ORIGIN.lon + 0.0001 },
          { lat: ORIGIN.lat + 0.0006, lon: ORIGIN.lon + 0.0001 },
        ] },
      { type: 'relation', id: 301, timestamp: '2020-06-07T00:00:00Z', version: 1, user: 'fixture-mapper', uid: 999001, changeset: 4246,
        tags: { type: 'multipolygon', building: 'commercial', name: '合成モール' },
        members: [
          { type: 'way', ref: 901, role: 'outer', geometry: [
            { lat: ORIGIN.lat - 0.0010, lon: ORIGIN.lon - 0.0010 },
            { lat: ORIGIN.lat - 0.0010, lon: ORIGIN.lon - 0.0002 },
            { lat: ORIGIN.lat - 0.0004, lon: ORIGIN.lon - 0.0002 },
            { lat: ORIGIN.lat - 0.0004, lon: ORIGIN.lon - 0.0010 },
            { lat: ORIGIN.lat - 0.0010, lon: ORIGIN.lon - 0.0010 },
          ] },
        ] },
    ],
  };
}

describe('OSM name matching', () => {
  it('NFKC-folds, lower-cases, strips whitespace, punctuation and the shop suffix', () => {
    expect(normaliseName('ＡＴＥＬＩＥＲ　Spick ＆ Span')).toBe('atelierspickspan');
    expect(normaliseName('ATELIER Spick & Span')).toBe('atelierspickspan');
    expect(normaliseName('合成食堂 店舗')).toBe(normaliseName('合成食堂'));
    expect(normaliseName('株式会社テスト')).toBe('株式会社テスト');
    // The long vowel mark is a letter, not punctuation: it survives.
    expect(normaliseName('コーヒー')).toBe('コーヒー');
    // Only the trailing 店/店舗 is a suffix; an inner one is part of the name.
    expect(normaliseName('店舗併設カフェ')).toBe('店舗併設カフェ');
    expect(normaliseName('   ')).toBe('');
  });
});

describe('OSM level normalisation', () => {
  it('maps basement, floor and decimal labels onto ordinals and leaves mezzanines unknown', () => {
    expect(normaliseLevel('B3')).toBe(-3);
    expect(normaliseLevel('b1f')).toBe(-1);
    expect(normaliseLevel('B2F')).toBe(-2);
    expect(normaliseLevel('3')).toBe(3);
    expect(normaliseLevel('3F')).toBe(3);
    expect(normaliseLevel('2階')).toBe(2);
    expect(normaliseLevel('-0.5')).toBe(-0.5);
    expect(normaliseLevel('M2')).toBeNull();
    expect(normaliseLevel('ground')).toBeNull();
    expect(parseLevels('1;2')).toEqual([1, 2]);
    expect(parseLevels('B1, -2')).toEqual([-2, -1]);
    expect(parseLevels(undefined)).toEqual([]);
  });
});

describe('OSM source-tag classification', () => {
  it('puts a website or a vendor before every other class', () => {
    expect(classifySourceTag('survey')).toBe('srcclass:survey');
    expect(classifySourceTag('現地調査')).toBe('srcclass:survey');
    expect(classifySourceTag('GSI')).toBe('srcclass:gsi');
    expect(classifySourceTag('国土地理院')).toBe('srcclass:gsi');
    expect(classifySourceTag('aerial imagery')).toBe('srcclass:aerial_imagery');
    expect(classifySourceTag('Google')).toBe('srcclass:possibly_non_free');
    expect(classifySourceTag('zenrin')).toBe('srcclass:possibly_non_free');
    expect(classifySourceTag('https://example.invalid/directory')).toBe('srcclass:possibly_non_free');
    expect(classifySourceTag('Bing aerial')).toBe('srcclass:possibly_non_free');
    expect(classifySourceTag('local knowledge')).toBe('srcclass:other');
  });
  it('derives our own category rather than keeping the OSM value', () => {
    expect(deriveCategory('convenience')).toBe('retail');
    expect(deriveCategory('restaurant')).toBe('food_and_drink');
    expect(deriveCategory('subway_entrance')).toBe('other');
    expect(deriveCategory(undefined)).toBe('unknown');
  });
});

describe('OSM parsing', () => {
  it('drops contributor identity (user, uid, changeset) and every non-allow-listed field', () => {
    const { elements, rejected } = parseOverpassJson(fixturePayload());
    expect(rejected).toBe(0);
    expect(elements).toHaveLength(5);
    const text = JSON.stringify(elements);
    for (const personal of ['fixture-mapper', '999001', '4242', 'changeset', 'uid', '"user"']) expect(text).not.toContain(personal);
    // Tag values and last-edit timestamps survive: they are what the coverage and quality numbers are computed from.
    expect(elements[0]!.tags.name).toBe('合成コンビニ');
    expect(elements[0]!.timestamp).toBe('2024-05-06T10:00:00Z');
    // Contributor identity is not a tag value, so it must not enter the leak guard's value set either.
    expect(tagValueSet(elements).has('fixture-mapper')).toBe(false);
  });

  it('rejects a payload with no elements array and counts malformed elements', () => {
    expect(() => parseOverpassJson({})).toThrow(/no elements array/u);
    expect(parseOverpassJson({ elements: [{ type: 'node' }, { type: 'node', id: 1, tags: { shop: 3 } }] })).toMatchObject({ rejected: 1 });
  });
});

describe('coverage facts', () => {
  it('counts kinds, levels, categories and the level share without keeping any OSM value', () => {
    const { elements } = parseOverpassJson(fixturePayload());
    const facts = computeCoverage(elements);
    expect(facts.kinds).toEqual({ 'kind:shop': 1, 'kind:amenity': 1, 'kind:indoor': 0, 'kind:has_level': 2, 'kind:station_building': 1, 'kind:entrance': 1 });
    expect(facts.shop_amenity_with_level).toEqual({ total: 2, count: 2, share: 1 });
    expect(facts.level_histogram).toEqual([{ ordinal: -1, count: 1 }, { ordinal: 1, count: 1 }, { ordinal: 2, count: 1 }]);
    expect(facts.level_objects).toBe(2);
    expect(facts.level_unparsed).toBe(0);
    expect(facts.categories_top15).toEqual([{ category: 'cat:food_and_drink', count: 1 }, { category: 'cat:retail', count: 1 }]);
    expect(facts.has_indoor).toEqual({ total: 5, count: 0, share: 0 });
    expect(JSON.stringify(facts)).not.toContain('合成');
    expect(JSON.stringify(facts)).not.toContain('convenience');
  });

  it('computes the last-edit histogram, the pre-2021 share and the source classes', () => {
    const { elements } = parseOverpassJson(fixturePayload());
    const quality = computeQuality(elements);
    expect(quality.objects_with_last_edit).toBe(5);
    expect(quality.last_edit_year_histogram).toEqual([{ year: 2019, count: 1 }, { year: 2020, count: 1 }, { year: 2022, count: 1 }, { year: 2023, count: 1 }, { year: 2024, count: 1 }]);
    expect(quality.edited_before_2021).toEqual({ total: 5, count: 2, share: 0.4 });
    expect(quality.objects_with_source_tag).toBe(3);
    expect(quality.source_class_objects).toEqual({ 'srcclass:gsi': 1, 'srcclass:survey': 1, 'srcclass:possibly_non_free': 2 });
    expect(quality.fixme_objects).toBe(1);
    expect(quality.note_objects).toBe(1);
  });

  it('counts shop and amenity objects inside a station-building polygon of the same extract', () => {
    const { elements } = parseOverpassJson(fixturePayload());
    const project = stationProjector(ORIGIN);
    // Node 101 sits inside way 201 (the train station); node 102 sits in relation 301, which is not a station building.
    expect(containmentShare(elements, project)).toEqual({ total: 2, count: 1, share: 0.5, station_building_polygons: 1 });
  });

  it('tests containment with holes, not just the outer ring', () => {
    const outer: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const inner: Array<[number, number]> = [[3, 3], [7, 3], [7, 7], [3, 7]];
    expect(pointInPolygon(1, 1, { outers: [outer], inners: [] })).toBe(true);
    expect(pointInPolygon(5, 5, { outers: [outer], inners: [inner] })).toBe(false);
    expect(pointInPolygon(11, 5, { outers: [outer], inners: [] })).toBe(false);
  });
});

describe('comparison with our own lists', () => {
  const elementsOf = () => parseOverpassJson(fixturePayload()).elements;

  it('applies the 150 m stricter radius and reports name-only matches separately', () => {
    const elements = elementsOf();
    const project = stationProjector(ORIGIN);
    const osm = namedOsmObjects(elements, project);
    // The OSM point of node 101 (normalised '合成コンビニ') in station metres.
    const hit = osm.find((object) => object.key === normaliseName('合成コンビニ'))!;
    expect(hit.x).not.toBeNull();
    const list: OurList = { list_id: 'fixture', source: 'fixture', entries: [
      { id: 'ours-near', names: ['合成コンビニ'], floor_ordinal: -1, x: hit.x! + 100, y: hit.y! },
      { id: 'ours-far', names: ['合成コンビニ'], floor_ordinal: 2, x: hit.x! + 200, y: hit.y! },
      { id: 'ours-no-position', names: ['合成コンビニ'], floor_ordinal: null, x: null, y: null },
      { id: 'ours-missing', names: ['存在しない店'], floor_ordinal: null, x: null, y: null },
    ] };
    const result = compareList(list, osm);
    expect(result.matched).toBe(3);
    expect(result.strict_matched).toBe(1);
    expect(result.strict_name_only).toBe(1);
    expect(result.ours_only).toBe(1);
    // The three entries all hit the same OSM object, which is therefore not OSM-only.
    expect(result.pairs.filter((pair) => pair.osm_id === 101).map((pair) => pair.strict)).toEqual([true, false, false]);
    expect(result.unmatched_ours).toEqual(['ours-missing']);
    // Floor agreement is only counted where both sides have a floor: -1 agrees, 2 does not.
    expect(result.floor_agreement).toEqual({ comparable: 2, agree: 1, rate: 0.5 });
    // OSM-only counts the named objects no entry matched: the restaurant node, the entrance node and the two
    // building polygons (only the shop node is matched).
    expect(result.osm_only).toBe(4);
    expect(result.unmatched_osm.map((object) => object.osm_id)).toEqual([102, 103, 201, 301]);
  });

  it('reads our POI and tenant shapes, keeping an unknown floor or position as null', () => {
    const floors = new Map([['toei-nwd-m1', -1]]);
    const pois = parseOurList({ pois: [{ id: 'p1', category: 'shop', names: [{ lang: 'ja', text: '合成店' }], floorId: 'toei-nwd-m1', displayPosition: { x: 1, y: 2, z: null } }, { id: 'p2', names: [], floorId: null, displayPosition: null }] }, 'pois', floors);
    expect(pois).toEqual([
      { id: 'p1', names: ['合成店'], floor_ordinal: -1, x: 1, y: 2 },
      { id: 'p2', names: [], floor_ordinal: null, x: null, y: null },
    ]);
    const tenants = parseOurList({ tenants: [{ id: 't1', name: '合成テナント', floorLabel: 'B2F', category: '食品' }] }, 'tenants', floors);
    expect(tenants).toEqual([{ id: 't1', names: ['合成テナント'], floor_ordinal: -2, x: null, y: null }]);
  });

  it('hashes the query carried in the manifest URL', () => {
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent('[out:json];node(1);out;')}`;
    expect(querySha256(url)).toMatch(/^[a-f0-9]{64}$/);
    expect(querySha256(url)).toBe(querySha256(url.replace('node(1)', 'node(1)')));
    expect(() => querySha256('https://overpass-api.de/api/interpreter')).toThrow(/no Overpass query/u);
  });
});

describe('private lead list', () => {
  it('finds a named complex polygon, lists the shops inside it and reports a missing group', () => {
    const elements = parseOverpassJson({
      elements: [
        // Closed ring (OSM repeats the first node), as an area way is drawn; an open indoor corridor is not a polygon.
        { type: 'way', id: 501, tags: { building: 'commercial', name: '京王モール アネックス' }, geometry: [
          { lat: ORIGIN.lat, lon: ORIGIN.lon }, { lat: ORIGIN.lat, lon: ORIGIN.lon + 0.002 },
          { lat: ORIGIN.lat + 0.002, lon: ORIGIN.lon + 0.002 }, { lat: ORIGIN.lat + 0.002, lon: ORIGIN.lon },
          { lat: ORIGIN.lat, lon: ORIGIN.lon },
        ] },
        { type: 'way', id: 502, tags: { indoor: 'highway', name: '京王モール アネックス' }, geometry: [
          { lat: ORIGIN.lat + 0.001, lon: ORIGIN.lon + 0.001 }, { lat: ORIGIN.lat + 0.0015, lon: ORIGIN.lon + 0.0015 },
        ] },
        { type: 'node', id: 601, lat: ORIGIN.lat + 0.001, lon: ORIGIN.lon + 0.001, tags: { shop: 'books', name: '合成書店', level: '2' }, timestamp: '2024-01-01T00:00:00Z' },
        { type: 'node', id: 602, lat: ORIGIN.lat + 0.100, lon: ORIGIN.lon + 0.100, tags: { shop: 'books', name: '圏外書店' } },
      ],
    }).elements;
    const leads = buildLeadList(elements, stationProjector(ORIGIN));
    expect(leads.polygons).toEqual([{ osm_type: 'way', osm_id: 501, name: '京王モール アネックス', matched_group: 'keio-mall' }]);
    expect(leads.rows.map((row) => row.osm_id)).toEqual([601]);
    expect(leads.rows[0]).toMatchObject({ kind: 'shop', value: 'books', level: '2', last_edit: '2024-01-01T00:00:00Z' });
    expect(leads.missing_groups).toEqual(['odakyu-ace']);
  });
});

describe('receipt guard and write order', () => {
  const facts = (): { coverage: CoverageFacts; quality: QualityFacts } => {
    const { elements } = parseOverpassJson(fixturePayload());
    const coverage = computeCoverage(elements);
    coverage.inside_station_building = containmentShare(elements, stationProjector(ORIGIN));
    return { coverage, quality: computeQuality(elements) };
  };
  const input = () => ({
    station: 'shinjuku',
    source: { source_id: 'osm-overpass-shinjuku', sha256: 'a'.repeat(64), bytes: 10, acquired_at: '2026-10-24T00:00:00Z' },
    query: { sha256: 'b'.repeat(64), radius_m: 900, origin: ORIGIN },
    extract: { elements: 5, rejected: 0, tag_keys: 12 },
    comparisons: [],
    run_id: 'osm-coverage-shinjuku-fixture',
    ...facts(),
  });

  it('trips on an injected OSM tag value in the receipt', () => {
    const { elements } = parseOverpassJson(fixturePayload());
    // 'evidence' is one of our own receipt strings; an OSM object that happens to carry it as a value must still fail closed.
    const injected = { ...fixturePayload(), elements: [...fixturePayload().elements, { type: 'node', id: 900, tags: { name: 'evidence' } }] };
    const values = tagValueSet(parseOverpassJson(injected).elements);
    expect(values.has('evidence')).toBe(true);
    expect(() => publicCoverageReceipt(input(), values)).toThrow(/would carry a source property value/u);
    // Without the collision the same receipt passes and carries no OSM value.
    expect(() => publicCoverageReceipt(input(), tagValueSet(elements))).not.toThrow();
    const receipt = publicCoverageReceipt(input(), tagValueSet(elements));
    const text = JSON.stringify(receipt);
    // The guard's contract: no OSM tag value appears as a JSON string. A value may still occur inside a longer
    // label of ours (the class id `srcclass:survey` contains the letters of `survey`), which is why the check is
    // the exact quoted token, not a plain substring.
    for (const value of tagValueSet(parseOverpassJson(fixturePayload()).elements)) expect(text).not.toContain(JSON.stringify(value));
    expect(receipt).toMatchObject({ gteki_role: 'evidence', navigation_use: 'NOT_FOR_ROUTING' });
  });

  it('writes nothing when the guard trips, and writes all three files after it passes', async () => {
    const privateDir = join(await tempDir(), 'private');
    const receiptDir = join(await tempDir(), 'receipt');
    const artifacts = { digest: 'fixture-digest', station: 'shinjuku', receipt: { gteki_role: 'evidence' }, objects: {}, matches: {} };
    const poisoned = new Set(['evidence']);
    await expect(writeCoverageOutputs(artifacts, poisoned, { privateDir, receiptDir })).rejects.toThrow(/would carry a source property value/u);
    expect(await readdir(join(privateDir, '..'))).not.toContain('private');
    await expect(readdir(receiptDir)).rejects.toThrow();
    const clean = new Set(['合成コンビニ']);
    const written = await writeCoverageOutputs(artifacts, clean, { privateDir, receiptDir });
    expect(await readFile(written.receipt_path, 'utf8')).toContain('"gteki_role": "evidence"');
    expect(await readdir(privateDir)).toEqual(['coverage-fixture-digest.matches.json', 'coverage-fixture-digest.objects.json']);
    expect(await readdir(receiptDir)).toEqual(['coverage-shinjuku-fixture-digest.json']);
  });
});
