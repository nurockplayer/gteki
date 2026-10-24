import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assembleRings, auditSourceValues, buildLeadList, classifySourceTag, compareList, computeCoverage, computeQuality,
  deriveCategory, footprintOverlap, namedOsmObjects, normaliseLevel, normaliseName, parseLevels, parseOurList,
  parseOverpassJson, pointInPolygon, publicCoverageReceipt, querySha256, readPolygon, stationProjector, tagValueSet,
  writeCoverageOutputs, type CoverageFacts, type OurList, type QualityFacts,
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

  it('strips 店 only as a branch suffix, never from a word that ends in it', () => {
    // A space makes it a branch name.
    expect(normaliseName('合成ストア 池袋店')).toBe('合成ストア池袋');
    expect(normaliseName('合成ストア 池袋店舗')).toBe('合成ストア池袋');
    // A branch ending (〜駅前店, 〜西口店) is stripped even without the space.
    expect(normaliseName('合成ストア 西口店')).toBe(normaliseName('合成ストア 西口'));
    expect(normaliseName('合成ストア西口店')).toBe(normaliseName('合成ストア西口'));
    // A compound noun that merely ends in 店 is not a branch suffix.
    for (const kept of ['百貨店', '書店', '商店', '売店', '本店', '支店', '喫茶店', '専門店', '商店街']) expect(normaliseName(kept)).toBe(kept);
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

  it('expands Simple Indoor Tagging ranges, both ends inclusive and either direction', () => {
    expect(parseLevels('0-2')).toEqual([0, 1, 2]);
    expect(parseLevels('-4--2')).toEqual([-4, -3, -2]);
    expect(parseLevels('B3-B1')).toEqual([-3, -2, -1]);
    expect(parseLevels('2-0')).toEqual([0, 1, 2]);
    expect(parseLevels('1–3')).toEqual([1, 2, 3]);
    // A range and a plain level in one list, de-duplicated.
    expect(parseLevels('1;3-4')).toEqual([1, 3, 4]);
    expect(parseLevels('-0.5-0.5')).toEqual([-0.5, 0, 0.5]);
    // Too long to be a floor stack is a malformed value, not a 500-storey building.
    expect(parseLevels('0-500')).toEqual([]);
  });
});

describe('OSM source-tag classification', () => {
  it('separates permitted tracing, known-restricted vendors and the unresolved rest', () => {
    expect(classifySourceTag('survey')).toBe('srcclass:permitted_tracing');
    expect(classifySourceTag('現地調査')).toBe('srcclass:permitted_tracing');
    expect(classifySourceTag('GSI')).toBe('srcclass:permitted_tracing');
    expect(classifySourceTag('国土地理院')).toBe('srcclass:permitted_tracing');
    expect(classifySourceTag('aerial imagery')).toBe('srcclass:permitted_tracing');
    // Bing counts only for its aerial imagery wording, never as a bare vendor mention.
    expect(classifySourceTag('Bing aerial')).toBe('srcclass:permitted_tracing');
    expect(classifySourceTag('Bing')).toBe('srcclass:unresolved');
    for (const restricted of ['Google', 'zenrin', 'ゼンリン', 'Yahoo', 'MapFan', 'Apple Maps', 'Tabelog', '食べログ', 'ホットペッパー']) {
      expect(classifySourceTag(restricted)).toBe('srcclass:known_restricted');
    }
    // A URL is a reference we cannot place; a bare vendor name we do not know is not a permission either.
    expect(classifySourceTag('https://example.invalid/directory')).toBe('srcclass:unresolved');
    expect(classifySourceTag('local knowledge')).toBe('srcclass:unresolved');
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
    expect(facts.kinds).toEqual({ 'kind:shop': 1, 'kind:amenity': 1, 'kind:indoor': 0, 'kind:has_level_tag': 2, 'kind:station_building': 1, 'kind:entrance': 1 });
    expect(facts.shop_amenity_with_level_key).toEqual({ total: 2, count: 2, share: 1 });
    expect(facts.shop_amenity_with_level_parsed).toEqual({ total: 2, count: 2, share: 1 });
    expect(facts.level_histogram).toEqual([{ ordinal: -1, count: 1 }, { ordinal: 1, count: 1 }, { ordinal: 2, count: 1 }]);
    expect(facts.level_key_objects).toBe(2);
    expect(facts.level_objects).toBe(2);
    expect(facts.level_unparsed).toBe(0);
    expect(facts.categories_top15).toEqual([{ category: 'cat:food_and_drink', count: 1 }, { category: 'cat:retail', count: 1 }]);
    expect(facts.has_indoor).toEqual({ total: 5, count: 0, share: 0 });
    expect(JSON.stringify(facts)).not.toContain('合成');
    expect(JSON.stringify(facts)).not.toContain('convenience');
  });

  it('counts key presence and successful parses apart, for all three level keys', () => {
    const { elements } = parseOverpassJson({ elements: [
      { type: 'node', id: 1, lat: ORIGIN.lat, lon: ORIGIN.lon, tags: { shop: 'books', level: 'M2' } },
      { type: 'node', id: 2, lat: ORIGIN.lat, lon: ORIGIN.lon, tags: { shop: 'books', repeat_on: 'B1' } },
      { type: 'node', id: 3, lat: ORIGIN.lat, lon: ORIGIN.lon, tags: { shop: 'books', 'level:ref': '2' } },
      { type: 'node', id: 4, lat: ORIGIN.lat, lon: ORIGIN.lon, tags: { shop: 'books', level: '1-2' } },
    ] });
    const facts = computeCoverage(elements);
    // `level`, `level:ref` and `repeat_on` all carry a level statement.
    expect(facts.kinds['kind:has_level_tag']).toBe(4);
    // Only the `level` key feeds the histogram, and a mezzanine label does not parse.
    expect(facts.level_key_objects).toBe(2);
    expect(facts.level_objects).toBe(1);
    expect(facts.level_unparsed).toBe(1);
    expect(facts.level_histogram).toEqual([{ ordinal: 1, count: 1 }, { ordinal: 2, count: 1 }]);
    expect(facts.shop_amenity_with_level_key).toEqual({ total: 4, count: 2, share: 0.5 });
    expect(facts.shop_amenity_with_level_parsed).toEqual({ total: 4, count: 1, share: 0.25 });
  });

  it('computes the last-edit histogram, the pre-2021 share and the source classes', () => {
    const { elements } = parseOverpassJson(fixturePayload());
    const quality = computeQuality(elements);
    expect(quality.objects_with_last_edit).toBe(5);
    expect(quality.last_edit_year_histogram).toEqual([{ year: 2019, count: 1 }, { year: 2020, count: 1 }, { year: 2022, count: 1 }, { year: 2023, count: 1 }, { year: 2024, count: 1 }]);
    expect(quality.edited_before_2021).toEqual({ total: 5, count: 2, share: 0.4 });
    expect(quality.objects_with_source_tag).toBe(3);
    // Overlapping: node 101 names both a survey and a URL, so the counts do not sum to objects_with_source_tag.
    expect(quality.source_class_objects).toEqual({ 'srcclass:permitted_tracing': 2, 'srcclass:known_restricted': 1, 'srcclass:unresolved': 1 });
    // Exclusive: one object names a restricted source; two only a permitted-tracing one.
    expect(quality.source_class_exclusive).toEqual({ objects_with_known_restricted: 1, objects_with_permitted_tracing_only: 2 });
    expect(quality.fixme_objects).toBe(1);
    expect(quality.note_objects).toBe(1);
  });

  it('measures 2D footprint overlap and leaves floor-aware containment UNKNOWN without levels', () => {
    const { elements } = parseOverpassJson(fixturePayload());
    const project = stationProjector(ORIGIN);
    // Node 101 sits inside way 201 (the train station); node 102 sits in relation 301, which is not a station building.
    const result = footprintOverlap(elements, project);
    expect(result.footprint).toEqual({ total: 2, count: 1, share: 0.5, station_building_polygons: 1, unassembled_polygons: 0 });
    // The building carries no level, so the overlap says nothing about floors: UNKNOWN, not zero agreement.
    expect(result.floorAware).toEqual({ total: 1, count: 0, share: 0, comparable: 0, status: 'UNKNOWN' });
    expect(result.overlapping.map((element) => element.id)).toEqual([101]);
  });

  it('compares floors only where both the object and the building have one', () => {
    const building = (id: number, level: string | undefined) => ({ type: 'way', id, tags: { building: 'train_station', ...(level ? { level } : {}) }, geometry: [
      { lat: ORIGIN.lat, lon: ORIGIN.lon }, { lat: ORIGIN.lat, lon: ORIGIN.lon + 0.002 },
      { lat: ORIGIN.lat + 0.002, lon: ORIGIN.lon + 0.002 }, { lat: ORIGIN.lat + 0.002, lon: ORIGIN.lon },
      { lat: ORIGIN.lat, lon: ORIGIN.lon },
    ] });
    const shop = (id: number, level: string) => ({ type: 'node', id, lat: ORIGIN.lat + 0.001, lon: ORIGIN.lon + 0.001, tags: { shop: 'books', level } });
    const { elements } = parseOverpassJson({ elements: [building(701, '0'), shop(801, '0'), shop(802, '2'), shop(803, 'M2')] });
    const result = footprintOverlap(elements, stationProjector(ORIGIN));
    expect(result.footprint).toMatchObject({ total: 3, count: 3, share: 1, station_building_polygons: 1 });
    // 801 agrees, 802 does not, 803 has no parseable level and is not comparable.
    expect(result.floorAware).toEqual({ total: 3, count: 1, share: 0.3333, comparable: 2, status: 'KNOWN' });
  });

  it('tests containment with holes, and counts a point on a boundary as inside', () => {
    const outer: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const inner: Array<[number, number]> = [[3, 3], [7, 3], [7, 7], [3, 7]];
    expect(pointInPolygon(1, 1, { outers: [outer], inners: [] })).toBe(true);
    expect(pointInPolygon(5, 5, { outers: [outer], inners: [inner] })).toBe(false);
    expect(pointInPolygon(11, 5, { outers: [outer], inners: [] })).toBe(false);
    // A shared wall or a vertex on the outline is inside, not outside: tenants touch the boundary.
    expect(pointInPolygon(10, 5, { outers: [outer], inners: [] })).toBe(true);
    expect(pointInPolygon(0, 0, { outers: [outer], inners: [] })).toBe(true);
    expect(pointInPolygon(3, 5, { outers: [outer], inners: [inner] })).toBe(true);
  });
});

describe('multipolygon ring assembly', () => {
  it('joins member ways by shared endpoints and reports the ones that do not close', () => {
    const p = (lat: number, lon: number) => ({ lat, lon });
    const a = [p(0, 0), p(0, 1), p(1, 1)];
    const b = [p(1, 1), p(1, 0), p(0, 0)];
    expect(assembleRings([a, b])).toEqual({ rings: [[p(0, 0), p(0, 1), p(1, 1), p(1, 0), p(0, 0)]], unassembled: 0 });
    // Two open segments that never meet are two chains that did not close: no ring is guessed.
    expect(assembleRings([[p(0, 0), p(0, 1)], [p(5, 5), p(5, 6)]])).toEqual({ rings: [], unassembled: 2 });
    // A member is free to be drawn in the other direction: the join is by point, not by order.
    const reversed = [p(1, 1), p(0, 1), p(0, 0)];
    expect(assembleRings([a, reversed]).rings).toHaveLength(1);
  });

  it('reads a relation from its members and leaves the unassemblable ones out', () => {
    const members = [
      { type: 'way', ref: 911, role: 'outer', geometry: [{ lat: ORIGIN.lat, lon: ORIGIN.lon }, { lat: ORIGIN.lat, lon: ORIGIN.lon + 0.001 }, { lat: ORIGIN.lat + 0.001, lon: ORIGIN.lon + 0.001 }] },
      { type: 'way', ref: 912, role: 'outer', geometry: [{ lat: ORIGIN.lat + 0.001, lon: ORIGIN.lon + 0.001 }, { lat: ORIGIN.lat + 0.001, lon: ORIGIN.lon }, { lat: ORIGIN.lat, lon: ORIGIN.lon }] },
    ];
    const { elements } = parseOverpassJson({ elements: [{ type: 'relation', id: 921, tags: { type: 'multipolygon', building: 'yes', level: '0' }, members }] });
    const read = readPolygon(elements[0]!, stationProjector(ORIGIN));
    expect(read.unassembled).toBe(0);
    expect(read.polygon!.outers).toHaveLength(1);
    expect(pointInPolygon(...stationProjector(ORIGIN)(ORIGIN.lat + 0.0005, ORIGIN.lon + 0.0005), read.polygon!)).toBe(true);
    // One open member only: no ring, and the relation counts as unassembled rather than as no polygon at all.
    const broken = parseOverpassJson({ elements: [{ type: 'relation', id: 922, tags: { type: 'multipolygon', building: 'yes' }, members: [members[0]!] }] }).elements;
    expect(readPolygon(broken[0]!, stationProjector(ORIGIN))).toEqual({ polygon: null, unassembled: 1 });
  });
});

describe('comparison with our own lists', () => {
  const elementsOf = () => parseOverpassJson(fixturePayload()).elements;

  it('applies the 150 m stricter radius and reports name-only and distant matches separately', () => {
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
    expect(result.name_match_only).toBe(1);
    expect(result.name_match_distant).toBe(1);
    expect(result.ours_only).toBe(1);
    // The three entries all hit the same OSM object, which is therefore not OSM-only.
    expect(result.pairs.filter((pair) => pair.osm_id === 101).map((pair) => pair.strict)).toEqual([true, false, false]);
    expect(result.pairs.map((pair) => pair.match)).toEqual(['strict', 'distant', 'name_only']);
    expect(result.unmatched_ours).toEqual(['ours-missing']);
    // Floor agreement is only counted where both sides have a floor: -1 agrees, 2 does not.
    expect(result.floor_agreement).toEqual({ comparable: 2, agree: 1, rate: 0.5, ambiguous_excluded: 0 });
    // OSM-only counts the named objects no entry matched: the restaurant node, the entrance node and the two
    // building polygons (only the shop node is matched).
    expect(result.osm_only).toBe(4);
    expect(result.unmatched_osm.map((object) => object.osm_id)).toEqual([102, 103, 201, 301]);
  });

  it('ranks candidates deterministically and excludes ambiguous pairs from floor agreement', () => {
    const named = (id: number, x: number, level: string) => ({
      element: { type: 'node' as const, id, tags: { name: '合成カフェ', level }, timestamp: '', version: 1, lat: null, lon: null, geometry: [], members: [] },
      key: normaliseName('合成カフェ'), x, y: 0, levels: parseLevels(level),
    });
    // Two OSM objects of the same name: one 20 m away, one 100 m away.
    const list: OurList = { list_id: 'fixture', source: 'fixture', entries: [{ id: 'ours', names: ['合成カフェ'], floor_ordinal: 1, x: 0, y: 0 }] };
    const result = compareList(list, [named(112, 100, '1'), named(111, 20, '2')]);
    // Nearest first, whatever order the extract held them in.
    expect(result.pairs.map((pair) => pair.osm_id)).toEqual([111, 112]);
    expect(result.strict_matched).toBe(1);
    // Two carriers of the name: the floor comparison is ambiguous, excluded, and never voted.
    expect(result.floor_agreement).toEqual({ comparable: 0, agree: 0, rate: null, ambiguous_excluded: 1 });
    // Equal distance falls back to the OSM id, so the pair list is stable.
    const tied = compareList(list, [named(112, 20, '1'), named(111, 20, '1')]);
    expect(tied.pairs.map((pair) => pair.osm_id)).toEqual([111, 112]);
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
    const footprint = footprintOverlap(elements, stationProjector(ORIGIN));
    coverage.footprint_overlap_2d = footprint.footprint;
    coverage.floor_aware_overlap = footprint.floorAware;
    return { coverage, quality: computeQuality(elements) };
  };
  const input = () => ({
    station: 'shinjuku',
    source: { source_id: 'osm-overpass-shinjuku', sha256: 'a'.repeat(64), bytes: 10, acquired_at: '2026-10-24T00:00:00Z' },
    query: { sha256: 'b'.repeat(64), radius_m: 900, origin: ORIGIN },
    extract: { elements: 5, rejected: 0, tag_keys: 12 },
    comparisons: [],
    run_id: 'osm-coverage-shinjuku-fixture',
    leak_guard: { files_checked: 4, values_scanned: 0, namespaced_hits: 0, allowlisted_hits: 0, pre_existing_hits: 0, leaks: 0 },
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

  it('audits committed text against the extract, exempting only namespaced, allowlisted or pre-existing values', () => {
    const values = new Set(['合成コンビニ', 'convenience', 'evidence', 'yes']);
    const files = [
      { path: 'note', text: 'a shop called 合成コンビニ' },
      { path: 'receipt', text: '{"categories_top15":[{"category":"cat:convenience","count":1}]}' },
      { path: 'manifest', text: 'evidence' },
      { path: 'table', text: 'a cell reading yes' },
    ];
    const result = auditSourceValues(files, values, { priorText: 'evidence' });
    // The name is a leak; `convenience` survives only inside our `cat:` identifier; `evidence` is pre-existing text;
    // `yes` is too short to be evidence either way.
    expect(result.leaks).toEqual([{ path: 'note', count: 1 }]);
    expect(result.namespaced_hits).toBe(1);
    expect(result.pre_existing_hits).toBe(1);
    expect(result.values_scanned).toBe(3);
    // A second bare use of the same value is enough to trip it.
    expect(auditSourceValues([{ path: 'mixed', text: 'cat:合成コンビニ and 合成コンビニ' }], values).leaks).toEqual([{ path: 'mixed', count: 1 }]);
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
