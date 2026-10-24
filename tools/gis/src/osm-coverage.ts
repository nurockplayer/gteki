import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { docsRoot, getStoreRoot, getStoredSource, readJson, repoRoot, writeJson, TOOL_VERSION } from './common.js';
import { assertNoSourceValues } from './context-overlay.js';
import { stationEnuProjector } from './station-enu.js';

/**
 * Offline OpenStreetMap coverage evidence for #437 (GIS Lane D).
 *
 * The extracts are Overpass responses acquired through the ordinary manifest (`osm-overpass-<station>`, gate HOLD,
 * rights unknown) and parsed here without ever touching the network. Two rules shape everything in this module:
 *
 *  1. No OSM value reaches a committed file. The committed receipt carries counts, shares, histograms keyed by
 *     normalised numbers, OSM tag *keys* and categories this tool derives; the extract itself, every name and every
 *     tag value stay in the private store. `assertNoSourceValues` (the context-overlay leak guard) is run over the
 *     receipt against every tag value in the extract before anything is written.
 *  2. Contributor identity is personal data: `user`, `uid` and `changeset` are never copied into any structure.
 *     The parser builds new objects from an allow-list of fields, so a raw element cannot leak them by accident.
 *
 * The coverage numbers describe what OSM *holds*, not what is true on the ground, and nothing here is routing input.
 */
export const OSM_COVERAGE_POLICY_VERSION = 'osm-coverage-v1';
export const OSM_SOURCE_IDS: Readonly<Record<string, string>> = { shinjuku: 'osm-overpass-shinjuku', ikebukuro: 'osm-overpass-ikebukuro' };
/** The GET radius recorded verbatim in each manifest entry. */
export const OSM_RADIUS_M = 900;
/** A strict match needs the OSM point this close to a point we hold for the same name. */
export const STRICT_MATCH_RADIUS_M = 150;

// ---------------------------------------------------------------------------------------------------------------------
// Parsing

export interface OsmPoint { lat: number; lon: number }
export interface OsmMember { type: string; ref: number; role: string; geometry: OsmPoint[] }
export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags: Record<string, string>;
  /** Last edit timestamp as served by `out meta`; the only edit metadata kept. */
  timestamp: string | null;
  version: number | null;
  lat: number | null;
  lon: number | null;
  geometry: OsmPoint[];
  members: OsmMember[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function readPoints(value: unknown): OsmPoint[] {
  if (!Array.isArray(value)) return [];
  const points: OsmPoint[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !finite(entry.lat) || !finite(entry.lon)) return [];
    points.push({ lat: entry.lat, lon: entry.lon });
  }
  return points;
}

/**
 * Parse an Overpass JSON payload into elements that carry only the allow-listed fields. `user`, `uid`, `changeset` and
 * every other raw key are dropped here, so no downstream writer can copy them even by mistake.
 */
export function parseOverpassJson(payload: unknown): { elements: OsmElement[]; rejected: number } {
  if (!isRecord(payload) || !Array.isArray(payload.elements)) throw new Error('Overpass payload has no elements array');
  const elements: OsmElement[] = [];
  let rejected = 0;
  for (const raw of payload.elements) {
    if (!isRecord(raw) || (raw.type !== 'node' && raw.type !== 'way' && raw.type !== 'relation') || !Number.isSafeInteger(raw.id)) { rejected++; continue; }
    const tags: Record<string, string> = {};
    if (isRecord(raw.tags)) for (const [key, value] of Object.entries(raw.tags)) if (typeof value === 'string' && value.length) tags[key] = value;
    const members: OsmMember[] = [];
    if (Array.isArray(raw.members)) {
      for (const member of raw.members) {
        if (!isRecord(member) || !Number.isSafeInteger(member.ref)) continue;
        members.push({ type: typeof member.type === 'string' ? member.type : 'unknown', ref: member.ref as number, role: typeof member.role === 'string' ? member.role : '', geometry: readPoints(member.geometry) });
      }
    }
    elements.push({
      type: raw.type,
      id: raw.id as number,
      tags,
      timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : null,
      version: Number.isSafeInteger(raw.version) ? (raw.version as number) : null,
      lat: finite(raw.lat) ? raw.lat : null,
      lon: finite(raw.lon) ? raw.lon : null,
      geometry: readPoints(raw.geometry),
      members,
    });
  }
  return { elements, rejected };
}

/** Every tag value in the extract: the leak guard's input. Tag keys are not included (they are allowed in the receipt). */
export function tagValueSet(elements: readonly OsmElement[]): Set<string> {
  const values = new Set<string>();
  for (const element of elements) for (const value of Object.values(element.tags)) if (value.length) values.add(value);
  return values;
}

/** Every distinct tag key in the extract (keys only; used for coverage histograms and the private report). */
export function tagKeySet(elements: readonly OsmElement[]): Set<string> {
  const keys = new Set<string>();
  for (const element of elements) for (const key of Object.keys(element.tags)) keys.add(key);
  return keys;
}

// ---------------------------------------------------------------------------------------------------------------------
// Normalisers and classifiers

/**
 * Name key: NFKC, case-folded, then whitespace, punctuation and a trailing 店/店舗 removed. Nothing else is folded:
 * a name that is merely a substring of another does not match.
 */
export function normaliseName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]+/gu, '')
    // Every Unicode punctuation and symbol character: ASCII `&`/`.`/`-`, CJK `・`/`、`, fullwidth forms after NFKC.
    // The long vowel mark `ー` is a modifier letter, so it survives.
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/(店舗|店)$/u, '');
}

/**
 * One OSM or GSI level label as an ordinal. `B3` and `B3F` are -3, `3`/`3F` are 3, `-1` and `-0.5` are themselves.
 * A mezzanine label (`M`, `M2`) is not guessed: it stays unknown, and the caller counts it as unparsed.
 */
export function normaliseLevel(raw: string): number | null {
  const text = raw.normalize('NFKC').trim().replace(/\s+/gu, '');
  if (!text) return null;
  const clean = text.replace(/階$/u, '').replace(/[Ff]$/u, '');
  const basement = /^[Bb](\d+)$/u.exec(clean);
  if (basement) return -Number(basement[1]);
  if (/^-?\d+(\.\d+)?$/u.test(clean)) return Number(clean);
  return null;
}

/** All levels of a tag value (`1;2`, `-1, 2`); duplicates removed, unparsable parts dropped. */
export function parseLevels(raw: string | undefined): number[] {
  if (raw === undefined) return [];
  const levels = new Set<number>();
  for (const part of raw.split(/[;,]/u)) {
    const level = normaliseLevel(part);
    if (level !== null) levels.add(level);
  }
  return [...levels].sort((a, b) => a - b);
}

/**
 * Source classes we derive from `source*` tag values. The ids are prefixed so that a class name can never be mistaken
 * for (or collide with) an OSM tag value in the committed receipt; the mapping from OSM value to class stays private.
 */
export const SOURCE_CLASSES = ['srcclass:survey', 'srcclass:gsi', 'srcclass:aerial_imagery', 'srcclass:possibly_non_free', 'srcclass:other'] as const;
export type SourceClass = typeof SOURCE_CLASSES[number];

const NON_FREE = [
  /google/iu, /zenrin/iu, /ゼンリン/u, /yahoo/iu, /mapfan/iu, /bing/iu, /apple\s*maps/iu,
  // shop directories and any website reference: none of them publishes an ODbL-compatible licence here
  /tabelog|食べログ|ぐるなび|gnavi|hotpepper|ホットペッパー|retty|rerepo/iu,
  /https?:\/\//iu, /\bwww\./iu,
];
const GSI = /\bgsi\b|国土地理院|地理院/iu;
const SURVEY = /survey|現地|実地|実測|実地調査/iu;
const AERIAL = /aerial|orthophoto|航空写真|空中写真|imagery|衛星/iu;

/**
 * Classify one `source*` value. Order matters: a value that names Google, Zenrin, Yahoo, MapFan, an aerial-image
 * vendor, a shop directory or any website is `possibly_non_free` before anything else is considered.
 */
export function classifySourceTag(value: string): SourceClass {
  const text = value.normalize('NFKC');
  if (NON_FREE.some((pattern) => pattern.test(text))) return 'srcclass:possibly_non_free';
  if (GSI.test(text)) return 'srcclass:gsi';
  if (SURVEY.test(text)) return 'srcclass:survey';
  if (AERIAL.test(text)) return 'srcclass:aerial_imagery';
  return 'srcclass:other';
}

/**
 * Our own category for a shop/amenity value. The OSM value is never committed; it is folded here into a vocabulary
 * this tool owns, and the value-to-category table stays in the private outputs.
 */
const AMENITY_CATEGORIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream|biergarten)$/u, 'food_and_drink'],
  [/^(bank|atm|bureau_de_change|money_transfer)$/u, 'money'],
  [/^(hospital|clinic|pharmacy|doctors|dentist|veterinary)$/u, 'health'],
  [/^(school|university|college|kindergarten|language_school|library)$/u, 'education'],
  [/^(bus_station|taxi|parking|parking_entrance|bicycle_parking|car_sharing|fuel|charging_station)$/u, 'transport'],
  [/^(toilets|drinking_water|shelter|bench|waste_basket|telephone|post_box|vending_machine|fountain)$/u, 'street_furniture'],
  [/^(police|fire_station|post_office|townhall|embassy|courthouse|public_building|community_centre|social_facility)$/u, 'public_service'],
  [/^(theatre|cinema|arts_centre|nightclub|casino|place_of_worship|museum|events_venue)$/u, 'culture'],
  [/^(convenience|supermarket|department_store|mall|clothes|shoes|jewelry|books|electronics|sports|toys|furniture|hardware|bakery|butcher|florist|gift|cosmetics|hairdresser|beauty|optician|mobile_phone|stationery|variety_store|drugstore|greengrocer|deli|travel_agency|laundry|dry_cleaning|photo|musical_instrument|bicycle|car|car_repair|doityourself|pet|alcohol|beverages|tobacco|general|kiosk|chemist|fabric|art|antiques|bag|bed|carpet|charity|coffee|computer|confectionery|copy_shop|cosmetics|dairy|electrical|farm|fashion|fishmonger|frame|garden_centre|gas|hearing_aids|houseware|interior_decoration|leather|lighting|locksmith|lottery|market|medical_supply|money_lender|motorcycle|music|nutrition_supplements|paint|party|pastry|perfumery|pet_grooming|pyrotechnics|religion|seafood|second_hand|shoe_repair|spices|storage_rental|tailor|tea|tiles|trade|trophy|tyres|vacant|video|video_games|watches|weapons|wholesale|wine|wool)$/u, 'retail'],
  [/^(hotel|hostel|guest_house|apartment|motel)$/u, 'lodging'],
  [/^(office|company|estate_agent|insurance|employment_agency|travel|advertising_agency|architect|lawyer|accountant|it|consulting|engineer|financial|notary|tax_advisor)$/u, 'office'],
  [/^(room|corridor|area|wall|level|yes|no)$/u, 'indoor_space'],
];
export function deriveCategory(value: string | undefined): string {
  if (value === undefined) return 'unknown';
  const text = value.normalize('NFKC').toLowerCase();
  for (const [pattern, category] of AMENITY_CATEGORIES) if (pattern.test(text)) return category;
  return 'other';
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry in the station frame

export type StationProjector = (lat: number, lon: number) => [number, number];

export function stationProjector(origin: { lat: number; lon: number }): StationProjector {
  // The horizontal part never depends on the point's own height, so height 0 is exact for x/y.
  const project = stationEnuProjector({ lat: origin.lat, lon: origin.lon, hM: 0 });
  return (lat, lon) => { const [x, y] = project(lat, lon, 0); return [x, y]; };
}

/** The point of an element: a node's own position, else the mean of its geometry vertices (ways and relations). */
export function pointOf(element: OsmElement): OsmPoint | null {
  if (element.lat !== null && element.lon !== null) return { lat: element.lat, lon: element.lon };
  const points = element.type === 'way' ? element.geometry : element.members.flatMap((member) => member.geometry);
  if (!points.length) return null;
  return { lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length, lon: points.reduce((sum, p) => sum + p.lon, 0) / points.length };
}

export type Ring = Array<[number, number]>;
export interface Polygon { outers: Ring[]; inners: Ring[] }

/** Closed rings of an element in station metres: a way's own outline, or a relation's outer and inner member ways. */
export function ringsOf(element: OsmElement, project: StationProjector): Polygon | null {
  const toRing = (points: readonly OsmPoint[]): Ring | null => points.length >= 3 ? points.map((p) => project(p.lat, p.lon)) : null;
  if (element.type === 'way') { const ring = toRing(element.geometry); return ring ? { outers: [ring], inners: [] } : null; }
  if (element.type !== 'relation') return null;
  const outers: Ring[] = [], inners: Ring[] = [];
  for (const member of element.members) {
    const ring = toRing(member.geometry);
    if (!ring) continue;
    if (member.role === 'inner') inners.push(ring); else outers.push(ring);
  }
  return outers.length ? { outers, inners } : null;
}

/** Even-odd ray casting on a closed ring; the ring is treated as closed whether or not the last vertex repeats the first. */
export function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside any outer ring and not inside any inner (hole) ring. */
export function pointInPolygon(x: number, y: number, polygon: Polygon): boolean {
  if (!polygon.outers.some((ring) => pointInRing(x, y, ring))) return false;
  return !polygon.inners.some((ring) => pointInRing(x, y, ring));
}

/** A station building: `building=train_station`, or any station object that also carries a building tag. */
export function isStationBuilding(tags: Record<string, string>): boolean {
  if (tags.building === 'train_station') return true;
  return typeof tags.building === 'string' && (tags.railway === 'station' || tags.public_transport === 'station');
}

// ---------------------------------------------------------------------------------------------------------------------
// Coverage

const SHOP_AMENITY = (tags: Record<string, string>): boolean => typeof tags.shop === 'string' || typeof tags.amenity === 'string';
const hasAnyLevelKey = (tags: Record<string, string>): boolean => ['level', 'level:ref', 'repeat_on'].some((key) => typeof tags[key] === 'string');

export interface Share { total: number; count: number; share: number | null }
const share = (total: number, count: number): Share => ({ total, count, share: total === 0 ? null : Math.round((count / total) * 10000) / 10000 });

export interface CoverageFacts {
  /** Keys are prefixed (`kind:shop`): a bare `shop` is itself an OSM tag value and must not appear as a JSON token. */
  kinds: Record<string, number>;
  categories_top15: Array<{ category: string; count: number }>;
  /** Emitted as number-valued pairs, never as `"2022"`-style string keys. */
  level_histogram: Array<{ ordinal: number; count: number }>;
  level_objects: number;
  level_unparsed: number;
  shop_amenity_with_level: Share;
  inside_station_building: Share & { station_building_polygons: number };
  name: Share;
  brand: Share;
  opening_hours: Share;
  /** `has_indoor`, not `indoor`: an allowlisted generic term is a leak when it is a whole JSON key, so no key is an OSM tag key. */
  has_indoor: Share;
}

export function computeCoverage(elements: readonly OsmElement[]): CoverageFacts {
  const kindCounts: Record<string, number> = { 'kind:shop': 0, 'kind:amenity': 0, 'kind:indoor': 0, 'kind:has_level': 0, 'kind:station_building': 0, 'kind:entrance': 0 };
  const categoryCounts = new Map<string, number>();
  const levelHistogram = new Map<number, number>();
  let levelObjects = 0, levelUnparsed = 0;
  let shopAmenity = 0, shopAmenityWithLevel = 0;
  let named = 0, branded = 0, opening = 0;
  for (const element of elements) {
    const tags = element.tags;
    if (typeof tags.shop === 'string') kindCounts['kind:shop']!++;
    if (typeof tags.amenity === 'string') kindCounts['kind:amenity']!++;
    if (typeof tags.indoor === 'string') kindCounts['kind:indoor']!++;
    if (hasAnyLevelKey(tags)) kindCounts['kind:has_level']!++;
    if (isStationBuilding(tags)) kindCounts['kind:station_building']!++;
    if (tags.railway === 'subway_entrance') kindCounts['kind:entrance']!++;
    else if (typeof tags.entrance === 'string') kindCounts['kind:entrance']!++;
    if (typeof tags.name === 'string') named++;
    if (typeof tags.brand === 'string') branded++;
    if (typeof tags.opening_hours === 'string') opening++;
    if (SHOP_AMENITY(tags)) {
      shopAmenity++;
      const category = deriveCategory(tags.amenity ?? tags.shop);
      if (!['indoor_space', 'unknown'].includes(category)) categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      if (typeof tags.level === 'string') shopAmenityWithLevel++;
    }
    if (typeof tags.level === 'string') {
      levelObjects++;
      const levels = parseLevels(tags.level);
      if (!levels.length) levelUnparsed++;
      for (const level of levels) levelHistogram.set(level, (levelHistogram.get(level) ?? 0) + 1);
    }
  }
  const histogram = [...levelHistogram.entries()].sort(([a], [b]) => a - b).map(([ordinal, count]) => ({ ordinal, count }));
  const categories = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 15).map(([category, count]) => ({ category: `cat:${category}`, count }));
  return {
    kinds: kindCounts,
    categories_top15: categories,
    level_histogram: histogram,
    level_objects: levelObjects,
    level_unparsed: levelUnparsed,
    shop_amenity_with_level: share(shopAmenity, shopAmenityWithLevel),
    // Filled in by containmentShare once the station-building polygons are projected.
    inside_station_building: { ...share(0, 0), station_building_polygons: 0 },
    name: share(elements.length, named),
    brand: share(elements.length, branded),
    opening_hours: share(elements.length, opening),
    has_indoor: share(elements.length, kindCounts['kind:indoor']!),
  };
}

/**
 * How much of an object lies inside a polygon: a node is one point; an area is every vertex of its own rings. A tenant
 * room inside a mall scores 1 (a shared wall may put a vertex on the boundary), while a large street-level platform that
 * merely overlaps an underground outline scores well below it.
 */
export function containmentRatio(element: OsmElement, polygon: Polygon, project: StationProjector): number {
  const points: OsmPoint[] = element.lat !== null && element.lon !== null
    ? [{ lat: element.lat, lon: element.lon }]
    : [...element.geometry, ...element.members.flatMap((member) => member.geometry)];
  if (!points.length) return 0;
  let inside = 0;
  for (const point of points) { const [x, y] = project(point.lat, point.lon); if (pointInPolygon(x, y, polygon)) inside++; }
  return inside / points.length;
}
/** An object counts as inside only when almost all of it is: its point inside is not enough for an area. */
export const CONTAINMENT_MIN_RATIO = 0.9;

/** Share of shop/amenity objects whose point falls inside a station-building polygon of the same extract. */
export function containmentShare(elements: readonly OsmElement[], project: StationProjector): CoverageFacts['inside_station_building'] {
  const polygons = elements.filter((element) => isStationBuilding(element.tags)).map((element) => ringsOf(element, project)).filter((polygon): polygon is Polygon => polygon !== null);
  const shopAmenity = elements.filter((element) => SHOP_AMENITY(element.tags));
  let inside = 0;
  for (const element of shopAmenity) {
    if (polygons.some((polygon) => containmentRatio(element, polygon, project) >= CONTAINMENT_MIN_RATIO)) inside++;
  }
  return { ...share(shopAmenity.length, inside), station_building_polygons: polygons.length };
}

// ---------------------------------------------------------------------------------------------------------------------
// Quality

export interface QualityFacts {
  objects_with_last_edit: number;
  last_edit_year_histogram: Array<{ year: number; count: number }>;
  edited_before_2021: Share;
  objects_with_source_tag: number;
  source_class_objects: Record<string, number>;
  fixme_objects: number;
  note_objects: number;
}

export function computeQuality(elements: readonly OsmElement[]): QualityFacts {
  const years = new Map<number, number>();
  let dated = 0, before = 0;
  for (const element of elements) {
    if (!element.timestamp) continue;
    const match = /^(\d{4})-/.exec(element.timestamp);
    if (!match) continue;
    dated++;
    const year = Number(match[1]);
    years.set(year, (years.get(year) ?? 0) + 1);
    if (year < 2021) before++;
  }
  const classes: Record<string, number> = {};
  let withSource = 0;
  for (const element of elements) {
    const sourceValues = Object.entries(element.tags).filter(([key]) => key === 'source' || key.startsWith('source:')).map(([, value]) => value);
    if (sourceValues.length) withSource++;
    // One object contributes at most once per class, even when it has several source tags in the same class.
    for (const cls of new Set(sourceValues.map(classifySourceTag))) classes[cls] = (classes[cls] ?? 0) + 1;
  }
  const ordered: Record<string, number> = {};
  for (const cls of SOURCE_CLASSES) if (classes[cls] !== undefined) ordered[cls] = classes[cls]!;
  return {
    objects_with_last_edit: dated,
    last_edit_year_histogram: [...years.entries()].sort(([a], [b]) => a - b).map(([year, count]) => ({ year, count })),
    edited_before_2021: share(dated, before),
    objects_with_source_tag: withSource,
    source_class_objects: ordered,
    fixme_objects: elements.filter((element) => typeof element.tags.fixme === 'string').length,
    note_objects: elements.filter((element) => typeof element.tags.note === 'string').length,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Comparison with our own lists

export interface OurEntry { id: string; names: string[]; floor_ordinal: number | null; x: number | null; y: number | null }
export interface OurList { list_id: string; source: string; entries: OurEntry[] }
export interface NamedOsm { element: OsmElement; key: string; x: number | null; y: number | null; levels: number[] }

export interface ListComparison {
  list_id: string;
  source: string;
  entries: number;
  distinct_names: number;
  matched: number;
  strict_matched: number;
  strict_name_only: number;
  ours_only: number;
  osm_only: number;
  floor_agreement: { comparable: number; agree: number; rate: number | null };
  /** Private detail: our ids against OSM ids. Never committed. */
  pairs: Array<{ our_id: string; osm_type: string; osm_id: number; strict: boolean; distance_m: number | null; floor_agree: boolean | null }>;
  unmatched_osm: Array<{ osm_type: string; osm_id: number }>;
  unmatched_ours: string[];
}

export function namedOsmObjects(elements: readonly OsmElement[], project: StationProjector): NamedOsm[] {
  const named: NamedOsm[] = [];
  for (const element of elements) {
    const name = element.tags.name;
    if (typeof name !== 'string') continue;
    const key = normaliseName(name);
    if (!key) continue;
    const point = pointOf(element);
    const xy = point ? project(point.lat, point.lon) : null;
    named.push({ element, key, x: xy ? xy[0] : null, y: xy ? xy[1] : null, levels: parseLevels(element.tags.level) });
  }
  return named;
}

/**
 * Match one of our lists against the named OSM objects.
 * - matched: an entry whose normalised name equals the name key of at least one OSM object.
 * - strict: that same equality, and the OSM point is within STRICT_MATCH_RADIUS_M of the point we hold for the entry;
 *   when we hold no coordinates the pair is counted under `strict_name_only` instead, never as strict.
 * - osm_only: named OSM objects no entry matches; ours_only: entries no OSM object matches.
 */
export function compareList(list: OurList, osm: readonly NamedOsm[]): ListComparison {
  const byKey = new Map<string, NamedOsm[]>();
  for (const object of osm) byKey.set(object.key, [...(byKey.get(object.key) ?? []), object]);
  const matchedOsm = new Set<string>();
  const pairs: ListComparison['pairs'] = [];
  const unmatchedOurs: string[] = [];
  const names = new Set<string>();
  let matched = 0, strict = 0, nameOnly = 0;
  let floorComparable = 0, floorAgree = 0;
  for (const entry of list.entries) {
    const keys = [...new Set(entry.names.map(normaliseName).filter((key) => key.length > 0))];
    if (!keys.length) { unmatchedOurs.push(entry.id); continue; }
    for (const key of keys) names.add(key);
    const hits = keys.flatMap((key) => byKey.get(key) ?? []);
    if (!hits.length) { unmatchedOurs.push(entry.id); continue; }
    matched++;
    let strictHit = false, nameOnlyHit = false, floorVote: boolean | null = null;
    const seen = new Set<string>();
    for (const hit of hits) {
      const osmId = `${hit.element.type}/${hit.element.id}`;
      let distance: number | null = null;
      if (entry.x !== null && entry.y !== null && hit.x !== null && hit.y !== null) distance = Math.hypot(hit.x - entry.x, hit.y - entry.y);
      const isStrict = distance !== null && distance <= STRICT_MATCH_RADIUS_M;
      if (isStrict) strictHit = true;
      if (distance === null) nameOnlyHit = true;
      let floorAgreeHit: boolean | null = null;
      if (entry.floor_ordinal !== null && hit.levels.length) floorAgreeHit = hit.levels.includes(entry.floor_ordinal);
      if (floorAgreeHit !== null && floorVote === null) floorVote = floorAgreeHit;
      if (seen.has(osmId)) continue;
      seen.add(osmId);
      matchedOsm.add(osmId);
      pairs.push({ our_id: entry.id, osm_type: hit.element.type, osm_id: hit.element.id, strict: isStrict, distance_m: distance === null ? null : Math.round(distance * 10) / 10, floor_agree: floorAgreeHit });
    }
    if (strictHit) strict++; else if (nameOnlyHit) nameOnly++;
    if (floorVote !== null) { floorComparable++; if (floorVote) floorAgree++; }
  }
  const unmatchedOsm = osm.filter((object) => !matchedOsm.has(`${object.element.type}/${object.element.id}`)).map((object) => ({ osm_type: object.element.type, osm_id: object.element.id }));
  return {
    list_id: list.list_id, source: list.source, entries: list.entries.length, distinct_names: names.size,
    matched, strict_matched: strict, strict_name_only: nameOnly, ours_only: unmatchedOurs.length, osm_only: unmatchedOsm.length,
    floor_agreement: { comparable: floorComparable, agree: floorAgree, rate: floorComparable === 0 ? null : Math.round((floorAgree / floorComparable) * 10000) / 10000 },
    pairs, unmatched_osm: unmatchedOsm, unmatched_ours: unmatchedOurs,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Our lists, read-only (main files, or a branch through `git show`)

export interface ListSpec { list_id: string; ref: string; path: string; kind: 'pois' | 'tenants' }

export const LIST_SPECS: Readonly<Record<string, ListSpec[]>> = {
  ikebukuro: [
    { list_id: 'main-pois', ref: 'main', path: 'stations/ikebukuro/gteki/pois.json', kind: 'pois' },
    { list_id: 'merchants-batch2', ref: 'claude/data-research-ikb-merchants-batch2', path: 'docs/research/merchants/ikebukuro-merchants-batch2.json', kind: 'pois' },
    { list_id: 'merchants-batch3', ref: 'claude/data-research-ikb-merchants-batch2', path: 'docs/research/merchants/ikebukuro-merchants-batch3.json', kind: 'pois' },
    { list_id: 'merchants-batch4', ref: 'claude/data-research-ikb-merchants-batch4', path: 'docs/research/merchants/ikebukuro-merchants-batch4.json', kind: 'pois' },
    { list_id: 'tobu-dept-tenants', ref: 'claude/data-research-ikb-merchants-batch4', path: 'docs/research/merchants/ikebukuro-tobu-dept-tenants.json', kind: 'tenants' },
  ],
  shinjuku: [
    { list_id: 'main-pois', ref: 'main', path: 'stations/shinjuku/gteki/pois.json', kind: 'pois' },
    { list_id: 'merchants-batch1', ref: 'claude/data-research-sjk-merchants-batch1', path: 'docs/research/merchants/shinjuku-merchants-batch1.json', kind: 'pois' },
    { list_id: 'merchants-batch2', ref: 'claude/data-research-sjk-merchants-batch2', path: 'docs/research/merchants/shinjuku-merchants-batch2.json', kind: 'pois' },
  ],
};

/** floorId -> ordinal from stations/<station>/gteki/station.json (read-only). */
export function floorOrdinals(station: unknown): Map<string, number> {
  const floors = isRecord(station) && isRecord(station.station) && Array.isArray(station.station.floors) ? station.station.floors : [];
  const map = new Map<string, number>();
  for (const floor of floors) if (isRecord(floor) && typeof floor.id === 'string' && finite(floor.ordinal)) map.set(floor.id, floor.ordinal);
  return map;
}

function localisedNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => (isRecord(entry) && typeof entry.text === 'string' && entry.text.trim() ? [entry.text] : []));
}

/** Entries of one list in the comparison shape. Unknown stays unknown: a missing floor or position is null. */
export function parseOurList(payload: unknown, kind: ListSpec['kind'], floors: Map<string, number>): OurEntry[] {
  if (!isRecord(payload)) throw new Error('Our list is not a JSON object');
  if (kind === 'tenants') {
    const tenants = Array.isArray(payload.tenants) ? payload.tenants : [];
    return tenants.flatMap((tenant) => {
      if (!isRecord(tenant) || typeof tenant.id !== 'string' || typeof tenant.name !== 'string') return [];
      const ordinal = typeof tenant.floorLabel === 'string' ? normaliseLevel(tenant.floorLabel) : null;
      return [{ id: tenant.id, names: [tenant.name], floor_ordinal: ordinal, x: null, y: null }];
    });
  }
  const pois = Array.isArray(payload.pois) ? payload.pois : [];
  return pois.flatMap((poi) => {
    if (!isRecord(poi) || typeof poi.id !== 'string') return [];
    const position = isRecord(poi.displayPosition) && finite(poi.displayPosition.x) && finite(poi.displayPosition.y) ? [poi.displayPosition.x, poi.displayPosition.y] as const : null;
    const ordinal = typeof poi.floorId === 'string' ? floors.get(poi.floorId) ?? null : null;
    return [{ id: poi.id, names: localisedNames(poi.names), floor_ordinal: ordinal, x: position ? position[0] : null, y: position ? position[1] : null }];
  });
}

const execFileAsync = promisify(execFile);

/** Read a list from our repository without checking anything out: the worktree file for `main`, `git show` otherwise. */
export async function readList(spec: ListSpec, floors: Map<string, number>): Promise<OurList> {
  const bytes = spec.ref === 'main'
    ? await readFile(join(repoRoot, spec.path))
    : await (async () => {
      try {
        const { stdout } = await execFileAsync('git', ['show', `origin/${spec.ref}:${spec.path}`], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
        return stdout;
      } catch (error) {
        throw new Error(`list unavailable: origin/${spec.ref}:${spec.path} (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`);
      }
    })();
  const entries = parseOurList(JSON.parse(bytes.toString('utf8')), spec.kind, floors);
  return { list_id: spec.list_id, source: `${spec.ref}:${spec.path}`, entries };
}

// ---------------------------------------------------------------------------------------------------------------------
// Receipt

export interface CoverageInput {
  station: string;
  source: { source_id: string; sha256: string; bytes: number; acquired_at: string };
  query: { sha256: string; radius_m: number; origin: { lat: number; lon: number } };
  extract: { elements: number; rejected: number; tag_keys: number };
  coverage: CoverageFacts;
  quality: QualityFacts;
  comparisons: Array<{ list_id: string; source: string; entries: number; distinct_names: number; matched: number; strict_matched: number; strict_name_only: number; ours_only: number; osm_only: number; floor_agreement: { comparable: number; agree: number; rate: number | null }; status: 'compared' | 'unavailable' }>;
  run_id: string;
}

/**
 * The committed receipt: counts, shares, histograms, OSM tag keys, derived categories and hashes. Built field by
 * field (nothing is spread out of the extract) and leak-guarded before it can be written.
 */
export function publicCoverageReceipt(input: CoverageInput, sourceValues: ReadonlySet<string>): Record<string, unknown> {
  const receipt = {
    schema: 'gteki.gis.osm-coverage/0.1',
    command: 'osm-coverage',
    policy_version: OSM_COVERAGE_POLICY_VERSION,
    run_id: input.run_id,
    station_id: input.station,
    gteki_role: 'evidence',
    navigation_use: 'NOT_FOR_ROUTING',
    verification: 'UNVERIFIED',
    note: 'Coverage evidence for #437 only. Counts, shares, histograms, OSM tag keys and derived categories; no OSM name, tag value or contributor identity is copied. The extract stays in the private store. Nothing here is a source for the graph, a route or a shipping POI list; the ODbL share-alike question is open (docs/gis/research/2026-10-24-osm-coverage-odbl.md).',
    extract: { ...input.extract },
    source: { ...input.source },
    query: { kind: 'overpass-ql-get', ...input.query },
    coverage: input.coverage,
    quality: input.quality,
    comparison: { lists: input.comparisons },
    tool_version: TOOL_VERSION,
  };
  const text = JSON.stringify(receipt);
  assertNoSourceValues(text, sourceValues, 'The public OSM coverage receipt');
  return receipt;
}

// ---------------------------------------------------------------------------------------------------------------------
// Private lead list (Shinjuku: the two building complexes the Owner asked about)

const LEAD_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['odakyu-ace', /小田急エース/u],
  ['keio-mall', /京王モール/u],
];

export interface LeadRow {
  osm_type: string; osm_id: number; name: string | null; name_en: string | null; brand: string | null;
  level: string | null; operator: string | null; kind: 'shop' | 'amenity'; value: string;
  last_edit: string | null; lat: number | null; lon: number | null;
}

export interface LeadList {
  polygons: Array<{ osm_type: string; osm_id: number; name: string | null; matched_group: string }>;
  outlines: Array<{ osm_type: string; osm_id: number; rings: Ring[][] }>;
  rows: LeadRow[];
  missing_groups: string[];
}

/**
 * Lead rows inside the polygons whose name identifies 小田急エース (北館/南館) or 京王モール (アネックス). Polygons are found
 * in the extract itself; when one is absent the group is reported missing and no area is guessed.
 */
/** A polygon is a closed ring: OSM closes area ways by repeating the first node, which an open indoor corridor does not. */
function closedRing(points: readonly OsmPoint[]): boolean {
  if (points.length < 4) return false;
  const first = points[0]!, last = points[points.length - 1]!;
  return first.lat === last.lat && first.lon === last.lon;
}
function isAreaElement(element: OsmElement): boolean {
  if (typeof element.tags.building === 'string' || typeof element.tags.indoor === 'string' || element.tags.area === 'yes') return true;
  return element.type === 'relation';
}

export function buildLeadList(elements: readonly OsmElement[], project: StationProjector): LeadList {
  const polygons: LeadList['polygons'] = [], outlines: LeadList['outlines'] = [];
  const groups = new Set<string>();
  const polygonIds = new Set<string>();
  for (const element of elements) {
    if (typeof element.tags.name !== 'string' || !isAreaElement(element)) continue;
    if (!closedRing(element.geometry) && !(element.type === 'relation' && element.members.some((member) => closedRing(member.geometry)))) continue;
    const name = element.tags.name;
    const group = LEAD_PATTERNS.find(([, pattern]) => pattern.test(name.normalize('NFKC')))?.[0];
    if (!group) continue;
    const polygon = ringsOf(element, project);
    if (!polygon) continue;
    groups.add(group);
    polygonIds.add(`${element.type}/${element.id}`);
    polygons.push({ osm_type: element.type, osm_id: element.id, name, matched_group: group });
    outlines.push({ osm_type: element.type, osm_id: element.id, rings: [polygon.outers, polygon.inners] });
  }
  const shapes = outlines.map((outline) => ({ outers: outline.rings[0] ?? [], inners: outline.rings[1] ?? [] }));
  const rows: LeadRow[] = [];
  for (const element of elements) {
    const shop = typeof element.tags.shop === 'string' ? 'shop' as const : typeof element.tags.amenity === 'string' ? 'amenity' as const : null;
    if (!shop) continue;
    if (polygonIds.has(`${element.type}/${element.id}`)) continue; // the complexes themselves, not tenants
    const point = pointOf(element);
    if (!point) continue;
    if (!shapes.some((shape) => containmentRatio(element, shape, project) >= CONTAINMENT_MIN_RATIO)) continue;
    rows.push({
      osm_type: element.type, osm_id: element.id,
      name: element.tags.name ?? null, name_en: element.tags['name:en'] ?? null, brand: element.tags.brand ?? null,
      level: element.tags.level ?? null, operator: element.tags.operator ?? null,
      kind: shop, value: element.tags[shop]!, last_edit: element.timestamp, lat: point.lat, lon: point.lon,
    });
  }
  return { polygons, outlines, rows, missing_groups: LEAD_PATTERNS.map(([group]) => group).filter((group) => !groups.has(group)) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing

export interface CoverageArtifacts {
  digest: string;
  station: string;
  receipt: Record<string, unknown>;
  objects: Record<string, unknown>;
  matches: Record<string, unknown>;
  leads?: Record<string, unknown>;
  leadsCsv?: string;
}

/**
 * Write-after-guard: the receipt is re-checked against every OSM tag value, and only then are the private files and
 * the committed receipt written (private first, the public receipt last). A tripped guard leaves the tree untouched.
 */
export async function writeCoverageOutputs(artifacts: CoverageArtifacts, sourceValues: ReadonlySet<string>, options: { receiptDir?: string; privateDir?: string } = {}): Promise<{
  receipt_path: string; objects_path: string; matches_path: string; leads_path: string | null; leads_csv_path: string | null;
}> {
  assertNoSourceValues(JSON.stringify(artifacts.receipt), sourceValues, 'The public OSM coverage receipt');
  const privateDir = options.privateDir ?? join(getStoreRoot(), 'out', 'osm');
  const objectsPath = join(privateDir, `coverage-${artifacts.digest}.objects.json`);
  const matchesPath = join(privateDir, `coverage-${artifacts.digest}.matches.json`);
  await writeJson(objectsPath, artifacts.objects);
  await writeJson(matchesPath, artifacts.matches);
  let leadsPath: string | null = null, leadsCsvPath: string | null = null;
  if (artifacts.leads) {
    leadsPath = join(privateDir, `shinjuku-leads-odakyu-keio-${artifacts.digest}.json`);
    await writeJson(leadsPath, artifacts.leads);
    leadsCsvPath = leadsPath.replace(/\.json$/u, '.csv');
    await writeFile(leadsCsvPath, artifacts.leadsCsv ?? '', { mode: 0o600 });
  }
  const receiptDir = options.receiptDir ?? join(docsRoot, 'gis', 'osm');
  const receiptPath = join(receiptDir, `coverage-${artifacts.station}-${artifacts.digest}.json`);
  await writeJson(receiptPath, artifacts.receipt);
  return { receipt_path: receiptPath, objects_path: objectsPath, matches_path: matchesPath, leads_path: leadsPath, leads_csv_path: leadsCsvPath };
}

// ---------------------------------------------------------------------------------------------------------------------
// Command

/** sha256 of the Overpass query carried in a manifest URL's `data` parameter. */
export function querySha256(expectedUrl: string): string {
  const data = new URL(expectedUrl).searchParams.get('data');
  if (!data) throw new Error('Manifest URL carries no Overpass query');
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export async function osmCoverage(station: string, options: { receiptDir?: string; privateDir?: string } = {}): Promise<Record<string, unknown>> {
  const sourceId = OSM_SOURCE_IDS[station];
  if (!sourceId) throw new Error(`osm-coverage knows only ${Object.keys(OSM_SOURCE_IDS).join(', ')}`);
  const stored = await getStoredSource(sourceId);
  const { elements, rejected } = parseOverpassJson(await readJson<unknown>(stored.path));

  const stationJson = JSON.parse(await readFile(join(repoRoot, `stations/${station}/gteki/station.json`), 'utf8')) as { station?: { origin?: { lat?: unknown; lon?: unknown } } };
  const originLat = stationJson.station?.origin?.lat, originLon = stationJson.station?.origin?.lon;
  if (!finite(originLat) || !finite(originLon)) throw new Error(`stations/${station}/gteki/station.json has no finite origin`);
  const origin = { lat: originLat, lon: originLon };
  const project = stationProjector(origin);

  const coverage = computeCoverage(elements);
  coverage.inside_station_building = containmentShare(elements, project);
  const quality = computeQuality(elements);
  const osm = namedOsmObjects(elements, project);

  const floors = floorOrdinals(stationJson);
  const comparisons: CoverageInput['comparisons'] = [];
  const details: Array<Record<string, unknown>> = [];
  for (const spec of LIST_SPECS[station] ?? []) {
    try {
      const list = await readList(spec, floors);
      const comparison = compareList(list, osm);
      comparisons.push({ list_id: comparison.list_id, source: comparison.source, entries: comparison.entries, distinct_names: comparison.distinct_names, matched: comparison.matched, strict_matched: comparison.strict_matched, strict_name_only: comparison.strict_name_only, ours_only: comparison.ours_only, osm_only: comparison.osm_only, floor_agreement: comparison.floor_agreement, status: 'compared' });
      details.push({ list_id: comparison.list_id, source: comparison.source, pairs: comparison.pairs, unmatched_osm: comparison.unmatched_osm, unmatched_ours: comparison.unmatched_ours });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      comparisons.push({ list_id: spec.list_id, source: `${spec.ref}:${spec.path}`, entries: 0, distinct_names: 0, matched: 0, strict_matched: 0, strict_name_only: 0, ours_only: 0, osm_only: 0, floor_agreement: { comparable: 0, agree: 0, rate: null }, status: 'unavailable' });
      details.push({ list_id: spec.list_id, source: `${spec.ref}:${spec.path}`, status: 'unavailable', reason });
    }
  }

  const query = { sha256: querySha256(stored.source.expected_url), radius_m: OSM_RADIUS_M, origin };
  const digest = sha256(JSON.stringify({ policy: OSM_COVERAGE_POLICY_VERSION, station, source: stored.record.sha256, query: query.sha256 })).slice(0, 20);
  const runId = `osm-coverage-${station}-${digest}`;
  const sourceValues = tagValueSet(elements);
  const keyCount = tagKeySet(elements).size;

  const receipt = publicCoverageReceipt({
    station,
    source: { source_id: sourceId, sha256: stored.record.sha256, bytes: stored.record.bytes, acquired_at: stored.record.completed_at },
    query,
    extract: { elements: elements.length, rejected, tag_keys: keyCount },
    coverage,
    quality,
    comparisons,
    run_id: runId,
  }, sourceValues);

  // Private: the parsed objects (no user/uid/changeset), then the match tables.
  const objects = {
    schema: 'gteki.gis.osm-extract/0.1', run_id: runId, station_id: station, source_id: sourceId, source_sha256: stored.record.sha256,
    note: 'Private store copy of the Overpass extract for #437. OSM © OpenStreetMap contributors, ODbL 1.0. Not a source for import. Contributor identity (user, uid, changeset) was never copied.',
    elements: elements.map((element) => ({ type: element.type, id: element.id, tags: element.tags, timestamp: element.timestamp, version: element.version, lat: element.lat, lon: element.lon, ...(element.geometry.length ? { geometry: element.geometry } : {}), ...(element.members.length ? { members: element.members } : {}) })),
  };
  const matches = { schema: 'gteki.gis.osm-match-tables/0.1', run_id: runId, station_id: station, lists: details };
  const leads = station === 'shinjuku' ? buildLeadList(elements, project) : undefined;
  const leadsRecord = leads ? {
    schema: 'gteki.gis.osm-lead-list/0.1', run_id: runId,
    header: {
      extraction_time: stored.record.completed_at, query_sha256: query.sha256, source_sha256: stored.record.sha256,
      note: 'OSM © OpenStreetMap contributors, ODbL 1.0; internal lead list only, not a source, not for import',
    },
    polygons: leads.polygons, outlines: leads.outlines, rows: leads.rows, missing_groups: leads.missing_groups,
  } : undefined;

  const written = await writeCoverageOutputs({ digest, station, receipt, objects, matches, ...(leadsRecord ? { leads: leadsRecord, leadsCsv: leadCsv(leads!) } : {}) }, sourceValues, options);
  return {
    run_id: runId,
    station_id: station,
    receipt_path: written.receipt_path.replace(`${repoRoot}/`, ''),
    private_objects: written.objects_path,
    private_matches: written.matches_path,
    ...(written.leads_path ? { private_leads: written.leads_path, private_leads_csv: written.leads_csv_path } : {}),
    objects: elements.length,
    coverage: { kinds: coverage.kinds, level_histogram: coverage.level_histogram, shop_amenity_with_level: coverage.shop_amenity_with_level, inside_station_building: coverage.inside_station_building },
    quality: { last_edit_year_histogram: quality.last_edit_year_histogram, edited_before_2021: quality.edited_before_2021, source_class_objects: quality.source_class_objects },
    comparison: comparisons.map((entry) => ({ list_id: entry.list_id, status: entry.status, entries: entry.entries, matched: entry.matched, strict_matched: entry.strict_matched, strict_name_only: entry.strict_name_only, ours_only: entry.ours_only, osm_only: entry.osm_only, floor_agreement: entry.floor_agreement })),
    ...(leads ? { leads: { polygons: leads.polygons.length, rows: leads.rows.length, missing_groups: leads.missing_groups } } : {}),
  };
}

/** CSV of the private lead rows. Quoted only where needed; no contributor field exists. */
export function leadCsv(leads: LeadList): string {
  const columns = ['osm_type', 'osm_id', 'name', 'name_en', 'brand', 'level', 'operator', 'kind', 'value', 'last_edit', 'lat', 'lon'];
  const escape = (value: string | number | null): string => {
    const text = value === null ? '' : String(value);
    return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = [columns.join(',')];
  for (const row of leads.rows) lines.push([row.osm_type, row.osm_id, row.name, row.name_en, row.brand, row.level, row.operator, row.kind, row.value, row.last_edit, row.lat, row.lon].map(escape).join(','));
  return `${lines.join('\n')}\n`;
}
