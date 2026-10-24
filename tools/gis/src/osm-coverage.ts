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
 * Words that end in 店 but are not a branch suffix: `百貨店` is a department store, `書店` a bookshop, `商店` a shop.
 */
export const STORE_SUFFIX_COMPOUNDS = ['百貨店', '書店', '商店', '売店', '本店', '支店', '酒店', '質店', '茶店', '喫茶店', '薬店', '代理店', '特約店', '専門店', '量販店', '小売店', 'チェーン店', '商店街'] as const;

/**
 * Name key: NFKC, case-folded, whitespace and punctuation removed, and a trailing branch suffix dropped. The suffix
 * rule is deliberately narrow: a trailing 店 is a branch marker (`〜池袋店`, `〜 西口店`) unless it completes one of
 * the compound words above, and a trailing 店舗 is always the word "premises". A name that is merely a substring of
 * another does not match.
 */
export function normaliseName(name: string): string {
  const folded = name.normalize('NFKC').toLowerCase();
  const core = folded
    .replace(/[\s　]+/gu, '')
    // Every Unicode punctuation and symbol character: ASCII `&`/`.`/`-`, CJK `・`/`、`, fullwidth forms after NFKC.
    // The long vowel mark `ー` is a modifier letter, so it survives.
    .replace(/[\p{P}\p{S}]/gu, '');
  if (/店舗$/u.test(core)) return core.replace(/店舗$/u, '');
  if (/店$/u.test(core) && !STORE_SUFFIX_COMPOUNDS.some((compound) => core.endsWith(compound))) return core.replace(/店$/u, '');
  return core;
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

/** A range expands to at most this many ordinals; a longer one is a malformed value, not a building with 10,000 floors. */
const MAX_RANGE_LEVELS = 100;

/** `0-2`, `-4--2`, `1–3`, `B3-B1`: both ends are kept, inclusive, and the direction is normalised. */
function expandLevelRange(part: string): number[] | null {
  const text = part.normalize('NFKC').trim();
  const numeric = /^(-?\d+(?:\.\d+)?)\s*(?:-|–|—|~|〜|～)\s*(-?\d+(?:\.\d+)?)$/u.exec(text);
  const basement = /^[Bb](\d+)\s*(?:-|–|—|~|〜|～)\s*[Bb](\d+)$/u.exec(text);
  const ends = numeric ? [Number(numeric[1]), Number(numeric[2])] : basement ? [-Number(basement[1]), -Number(basement[2])] : null;
  if (!ends) return null;
  const low = Math.min(ends[0]!, ends[1]!), high = Math.max(ends[0]!, ends[1]!);
  const step = Number.isInteger(low) && Number.isInteger(high) ? 1 : 0.5;
  const count = Math.floor((high - low) / step) + 1;
  if (count < 2 || count > MAX_RANGE_LEVELS) return null;
  return Array.from({ length: count }, (_, index) => Math.round((low + index * step) * 100) / 100);
}

/**
 * All levels of a tag value. Simple Indoor Tagging allows a list (`1;2`, `-1, 2`) and a range (`0-2`, `-4--2`);
 * duplicates are removed, unparsable parts dropped and a range too long to be a real floor stack is dropped too.
 */
export function parseLevels(raw: string | undefined): number[] {
  if (raw === undefined) return [];
  const levels = new Set<number>();
  for (const part of raw.split(/[;,]/u)) {
    if (!part.trim()) continue;
    const range = expandLevelRange(part);
    if (range) { for (const level of range) levels.add(level); continue; }
    const level = normaliseLevel(part);
    if (level !== null) levels.add(level);
  }
  return [...levels].sort((a, b) => a - b);
}

/**
 * Source classes we derive from `source*` tag values. The ids are prefixed so that a class name can never be mistaken
 * for (or collide with) an OSM tag value in the committed receipt; the mapping from OSM value to class stays private.
 */
export const SOURCE_CLASSES = ['srcclass:permitted_tracing', 'srcclass:known_restricted', 'srcclass:unresolved'] as const;
export type SourceClass = typeof SOURCE_CLASSES[number];

/** Vendors whose terms do not permit deriving OSM data from their imagery or listings. */
const KNOWN_RESTRICTED = [
  /google/iu, /zenrin/iu, /ゼンリン/u, /yahoo/iu, /mapfan/iu, /apple\s*maps/iu,
  // shop directories: no ODbL-compatible licence for the facts they publish
  /tabelog|食べログ|ぐるなび|gnavi|hotpepper|ホットペッパー|retty|rerepo/iu,
];
const GSI = /\bgsi\b|国土地理院|地理院/iu;
const SURVEY = /survey|現地|実地|実測|実地調査/iu;
const AERIAL = /aerial|orthophoto|航空写真|空中写真|imagery|衛星/iu;
/** A vendor name counts as tracing permission only when the value also says the imagery use. */
const BING = /bing/iu;
const URL_REFERENCE = /https?:\/\//iu;

/**
 * Classify one `source*` value.
 *
 * - `permitted_tracing`: survey, GSI, or aerial imagery — including Bing, but only when the value itself says aerial,
 *   imagery or the Japanese equivalents. Any other mention of a vendor is not a tracing permission.
 * - `known_restricted`: Google, Zenrin, Yahoo, MapFan, Apple Maps, shop directories.
 * - `unresolved`: a bare URL, a vendor mention without the imagery wording, or anything this tool cannot place.
 */
export function classifySourceTag(value: string): SourceClass {
  const text = value.normalize('NFKC');
  if (KNOWN_RESTRICTED.some((pattern) => pattern.test(text))) return 'srcclass:known_restricted';
  if (URL_REFERENCE.test(text) || /\bwww\./iu.test(text)) return 'srcclass:unresolved';
  if (BING.test(text)) return AERIAL.test(text) ? 'srcclass:permitted_tracing' : 'srcclass:unresolved';
  if (GSI.test(text) || SURVEY.test(text) || AERIAL.test(text)) return 'srcclass:permitted_tracing';
  return 'srcclass:unresolved';
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

const pointKey = (point: OsmPoint): string => `${point.lat.toFixed(9)},${point.lon.toFixed(9)}`;
const samePoint = (a: OsmPoint, b: OsmPoint): boolean => pointKey(a) === pointKey(b);

/**
 * Join member ways into closed rings by their shared endpoints. A chain that runs out of ends without closing, or a
 * leftover way whose ends match nothing, is not a ring: the caller counts it as `unassembled` and leaves it out. The
 * assembly never invents a connecting segment.
 */
export function assembleRings(segments: readonly (readonly OsmPoint[])[]): { rings: OsmPoint[][]; unassembled: number } {
  const open = segments.filter((segment) => segment.length >= 2).map((segment) => [...segment]);
  const rings: OsmPoint[][] = [];
  let unassembled = 0;
  while (open.length) {
    const chain = open.shift()!;
    let closed = samePoint(chain[0]!, chain[chain.length - 1]!);
    while (!closed) {
      const end = chain[chain.length - 1]!;
      const index = open.findIndex((segment) => samePoint(segment[0]!, end) || samePoint(segment[segment.length - 1]!, end));
      if (index < 0) break;
      const next = open.splice(index, 1)[0]!;
      const added = samePoint(next[0]!, end) ? next.slice(1) : [...next].reverse().slice(1);
      chain.push(...added);
      closed = samePoint(chain[0]!, chain[chain.length - 1]!);
      if (chain.length > 100_000) break; // a malformed loop cannot run away
    }
    if (closed && chain.length >= 4) rings.push(chain); else unassembled++;
  }
  return { rings, unassembled };
}

export interface PolygonRead { polygon: Polygon | null; unassembled: number }

/**
 * Closed rings of an element in station metres: a closed way's own outline, or a relation's member ways joined into
 * rings. An open way, or a relation whose members do not close, is reported as unassembled rather than guessed into a
 * polygon.
 */
export function readPolygon(element: OsmElement, project: StationProjector): PolygonRead {
  const toRing = (points: readonly OsmPoint[]): Ring | null => points.length >= 3 ? points.map((p) => project(p.lat, p.lon)) : null;
  if (element.type === 'node') return { polygon: null, unassembled: 0 };
  if (element.type === 'way') {
    // An area way closes by repeating its first node; an open way is a line, and is not guessed into a polygon.
    const closed = element.geometry.length >= 4 && samePoint(element.geometry[0]!, element.geometry[element.geometry.length - 1]!);
    const ring = closed ? toRing(element.geometry) : null;
    return { polygon: ring ? { outers: [ring], inners: [] } : null, unassembled: ring ? 0 : 1 };
  }
  const outerSegments = element.members.filter((member) => member.role !== 'inner' && member.geometry.length >= 2).map((member) => member.geometry);
  const innerSegments = element.members.filter((member) => member.role === 'inner' && member.geometry.length >= 2).map((member) => member.geometry);
  const outer = assembleRings(outerSegments), inner = assembleRings(innerSegments);
  // A relation with no outer member at all is unassembled too, but a failed chain is counted once, not twice.
  const unassembled = outer.unassembled + inner.unassembled + (outerSegments.length ? 0 : 1);
  const outers = outer.rings.map((ring) => toRing(ring)).filter((ring): ring is Ring => ring !== null);
  const inners = inner.rings.map((ring) => toRing(ring)).filter((ring): ring is Ring => ring !== null);
  return { polygon: outers.length ? { outers, inners } : null, unassembled };
}

/** A polygon of an element, for callers that do not need the unassembled count (the lead list). */
export function ringsOf(element: OsmElement, project: StationProjector): Polygon | null {
  return readPolygon(element, project).polygon;
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

/** Metres of slack when deciding that a point sits on an edge; projected vertices that are shared are identical. */
const BOUNDARY_TOLERANCE_M = 0.01;

/** True when the point lies on any edge of the ring (an endpoint included). */
export function pointOnRing(x: number, y: number, ring: Ring): boolean {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    const dx = xj - xi, dy = yj - yi;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / lengthSquared));
    if (Math.hypot(x - (xi + t * dx), y - (yi + t * dy)) <= BOUNDARY_TOLERANCE_M) return true;
  }
  return false;
}

/**
 * Inside any outer ring and not strictly inside any inner (hole) ring. A point on a boundary counts as inside — a wall
 * is shared between a room and the building — so a vertex that merely touches the outline is not lost to rounding.
 */
export function pointInPolygon(x: number, y: number, polygon: Polygon): boolean {
  if (polygon.outers.some((ring) => pointOnRing(x, y, ring)) || polygon.inners.some((ring) => pointOnRing(x, y, ring))) return true;
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
  /** Objects carrying a `level` tag (presence only). */
  level_key_objects: number;
  /** Objects whose `level` value parsed into at least one ordinal. */
  level_objects: number;
  /** Objects with the key whose value parsed into nothing (one range or list entry does not have to parse for the object to count). */
  level_unparsed: number;
  shop_amenity_with_level_key: Share;
  shop_amenity_with_level_parsed: Share;
  /**
   * 2D footprint overlap with a station building, in plan view. Not evidence of being indoors on a floor.
   * `unassembled_polygons` counts the chains of member ways that did not close, plus a relation with no outer part;
   * those are left out of the measurement entirely.
   */
  footprint_overlap_2d: Share & { station_building_polygons: number; unassembled_polygons: number };
  /** Overlap in plan view where both sides name floors. Comparable 0 means UNKNOWN, never zero agreement. */
  floor_aware_overlap: Share & { comparable: number; status: 'KNOWN' | 'UNKNOWN' };
  name: Share;
  brand: Share;
  opening_hours: Share;
  /** `has_indoor`, not `indoor`: an allowlisted generic term is a leak when it is a whole JSON key, so no key is an OSM tag key. */
  has_indoor: Share;
}

export function computeCoverage(elements: readonly OsmElement[]): CoverageFacts {
  // `kind:has_level_tag` counts any of the three level keys: `level`, `level:ref` and `repeat_on`.
  const kindCounts: Record<string, number> = { 'kind:shop': 0, 'kind:amenity': 0, 'kind:indoor': 0, 'kind:has_level_tag': 0, 'kind:station_building': 0, 'kind:entrance': 0 };
  const categoryCounts = new Map<string, number>();
  const levelHistogram = new Map<number, number>();
  let levelKeyObjects = 0, levelObjects = 0, levelUnparsed = 0;
  let shopAmenity = 0, shopAmenityWithLevelKey = 0, shopAmenityWithLevelParsed = 0;
  let named = 0, branded = 0, opening = 0;
  for (const element of elements) {
    const tags = element.tags;
    if (typeof tags.shop === 'string') kindCounts['kind:shop']!++;
    if (typeof tags.amenity === 'string') kindCounts['kind:amenity']!++;
    if (typeof tags.indoor === 'string') kindCounts['kind:indoor']!++;
    if (hasAnyLevelKey(tags)) kindCounts['kind:has_level_tag']!++;
    if (isStationBuilding(tags)) kindCounts['kind:station_building']!++;
    if (tags.railway === 'subway_entrance') kindCounts['kind:entrance']!++;
    else if (typeof tags.entrance === 'string') kindCounts['kind:entrance']!++;
    if (typeof tags.name === 'string') named++;
    if (typeof tags.brand === 'string') branded++;
    if (typeof tags.opening_hours === 'string') opening++;
    const levels = parseLevels(tags.level);
    if (SHOP_AMENITY(tags)) {
      shopAmenity++;
      const category = deriveCategory(tags.amenity ?? tags.shop);
      if (!['indoor_space', 'unknown'].includes(category)) categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      if (typeof tags.level === 'string') shopAmenityWithLevelKey++;
      if (levels.length) shopAmenityWithLevelParsed++;
    }
    if (typeof tags.level === 'string') {
      levelKeyObjects++;
      if (levels.length) levelObjects++; else levelUnparsed++;
      for (const level of levels) levelHistogram.set(level, (levelHistogram.get(level) ?? 0) + 1);
    }
  }
  const histogram = [...levelHistogram.entries()].sort(([a], [b]) => a - b).map(([ordinal, count]) => ({ ordinal, count }));
  const categories = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 15).map(([category, count]) => ({ category: `cat:${category}`, count }));
  return {
    kinds: kindCounts,
    categories_top15: categories,
    level_histogram: histogram,
    level_key_objects: levelKeyObjects,
    level_objects: levelObjects,
    level_unparsed: levelUnparsed,
    shop_amenity_with_level_key: share(shopAmenity, shopAmenityWithLevelKey),
    shop_amenity_with_level_parsed: share(shopAmenity, shopAmenityWithLevelParsed),
    // Filled in by footprintOverlap once the station-building polygons are projected.
    footprint_overlap_2d: { ...share(0, 0), station_building_polygons: 0, unassembled_polygons: 0 },
    floor_aware_overlap: { ...share(0, 0), comparable: 0, status: 'UNKNOWN' },
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

/**
 * Plan-view overlap of shop/amenity objects with the station buildings of the same extract. This is a footprint
 * question only: two outlines can overlap and still be different floors, so the number says nothing about indoor
 * coverage. A relation whose member ways do not close is counted in `unassembled_polygons` and left out.
 *
 * `floor_aware_overlap` asks the narrower question, and only where both sides name floors: of the overlapping
 * objects that have a parseable level, how many share an ordinal with the building they overlap. With no comparable
 * pair the answer is UNKNOWN, never "zero agree".
 */
export function footprintOverlap(elements: readonly OsmElement[], project: StationProjector): {
  footprint: CoverageFacts['footprint_overlap_2d'];
  floorAware: CoverageFacts['floor_aware_overlap'];
  /** Private detail for the lead list and the match tables: which objects overlapped, and never committed. */
  overlapping: OsmElement[];
} {
  const buildings: Array<{ element: OsmElement; polygon: Polygon; levels: number[] }> = [];
  let unassembled = 0;
  for (const element of elements) {
    if (!isStationBuilding(element.tags)) continue;
    const read = readPolygon(element, project);
    unassembled += read.unassembled;
    if (read.polygon) buildings.push({ element, polygon: read.polygon, levels: parseLevels(element.tags.level) });
  }
  const shopAmenity = elements.filter((element) => SHOP_AMENITY(element.tags));
  const overlapping: OsmElement[] = [];
  let comparable = 0, agree = 0;
  for (const element of shopAmenity) {
    const hits = buildings.filter((building) => containmentRatio(element, building.polygon, project) >= CONTAINMENT_MIN_RATIO);
    if (!hits.length) continue;
    overlapping.push(element);
    const levels = parseLevels(element.tags.level);
    if (!levels.length) continue;
    const withLevels = hits.filter((building) => building.levels.length > 0);
    if (!withLevels.length) continue;
    comparable++;
    if (withLevels.some((building) => building.levels.some((level) => levels.includes(level)))) agree++;
  }
  return {
    footprint: { ...share(shopAmenity.length, overlapping.length), station_building_polygons: buildings.length, unassembled_polygons: unassembled },
    floorAware: { ...share(overlapping.length, agree), comparable, status: comparable === 0 ? 'UNKNOWN' : 'KNOWN' },
    overlapping,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Quality

export interface QualityFacts {
  objects_with_last_edit: number;
  last_edit_year_histogram: Array<{ year: number; count: number }>;
  edited_before_2021: Share;
  objects_with_source_tag: number;
  /** Overlapping: one object appears in every class its `source*` values name, so the counts do not sum to the total. */
  source_class_objects: Record<string, number>;
  /** Exclusive: how many objects name at least one restricted source, and how many only a permitted-tracing one. */
  source_class_exclusive: { objects_with_known_restricted: number; objects_with_permitted_tracing_only: number };
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
  let withSource = 0, withRestricted = 0, permittedOnly = 0;
  for (const element of elements) {
    const sourceValues = Object.entries(element.tags).filter(([key]) => key === 'source' || key.startsWith('source:')).map(([, value]) => value);
    if (sourceValues.length) withSource++;
    // One object contributes at most once per class, even when it has several source tags in the same class.
    const named = new Set(sourceValues.map(classifySourceTag));
    for (const cls of named) classes[cls] = (classes[cls] ?? 0) + 1;
    if (named.has('srcclass:known_restricted')) withRestricted++;
    else if (named.has('srcclass:permitted_tracing')) permittedOnly++;
  }
  const ordered: Record<string, number> = {};
  for (const cls of SOURCE_CLASSES) if (classes[cls] !== undefined) ordered[cls] = classes[cls]!;
  return {
    objects_with_last_edit: dated,
    last_edit_year_histogram: [...years.entries()].sort(([a], [b]) => a - b).map(([year, count]) => ({ year, count })),
    edited_before_2021: share(dated, before),
    objects_with_source_tag: withSource,
    source_class_objects: ordered,
    source_class_exclusive: { objects_with_known_restricted: withRestricted, objects_with_permitted_tracing_only: permittedOnly },
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
  name_match_only: number;
  name_match_distant: number;
  ours_only: number;
  osm_only: number;
  floor_agreement: { comparable: number; agree: number; rate: number | null; ambiguous_excluded: number };
  /** Private detail: our ids against OSM ids. Never committed. */
  pairs: Array<{ our_id: string; osm_type: string; osm_id: number; strict: boolean; match: 'strict' | 'name_only' | 'distant'; distance_m: number | null; floor_agree: boolean | null }>;
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
 * Match one of our lists against the named OSM objects. Every entry lands in exactly one bucket, so
 * `matched = strict_matched + name_match_only + name_match_distant`:
 * - `strict_matched`: we hold coordinates for the entry and an OSM object with the same normalised name is within
 *   STRICT_MATCH_RADIUS_M of them.
 * - `name_match_only`: we hold no coordinates for the entry, so the name is the only evidence.
 * - `name_match_distant`: we hold coordinates and every OSM object of that name is further away than the radius.
 * - `osm_only`: named OSM objects no entry matches; `ours_only`: entries no OSM object matches.
 *
 * Candidate objects are ordered deterministically (nearest first, then OSM type and id), so a pair list is stable.
 * Floor agreement is reported only for unambiguous entries — exactly one OSM object carries that name — and the
 * excluded ambiguous pairs are counted, never voted.
 */
export function compareList(list: OurList, osm: readonly NamedOsm[]): ListComparison {
  const byKey = new Map<string, NamedOsm[]>();
  for (const object of osm) byKey.set(object.key, [...(byKey.get(object.key) ?? []), object]);
  const matchedOsm = new Set<string>();
  const pairs: ListComparison['pairs'] = [];
  const unmatchedOurs: string[] = [];
  const names = new Set<string>();
  let matched = 0, strict = 0, nameOnly = 0, distant = 0;
  let floorComparable = 0, floorAgree = 0, floorAmbiguous = 0;
  const byId = (a: NamedOsm, b: NamedOsm): number => a.element.type.localeCompare(b.element.type) || a.element.id - b.element.id;
  for (const entry of list.entries) {
    const keys = [...new Set(entry.names.map(normaliseName).filter((key) => key.length > 0))];
    if (!keys.length) { unmatchedOurs.push(entry.id); continue; }
    for (const key of keys) names.add(key);
    const seen = new Set<string>();
    const unique = keys.flatMap((key) => byKey.get(key) ?? []).filter((hit) => {
      const osmId = `${hit.element.type}/${hit.element.id}`;
      if (seen.has(osmId)) return false;
      seen.add(osmId);
      return true;
    });
    if (!unique.length) { unmatchedOurs.push(entry.id); continue; }
    matched++;
    const ranked = unique.map((hit) => {
      const distance = entry.x !== null && entry.y !== null && hit.x !== null && hit.y !== null ? Math.hypot(hit.x - entry.x, hit.y - entry.y) : null;
      return { hit, distance };
    }).sort((a, b) => (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY) || byId(a.hit, b.hit));
    const nearest = ranked[0]!;
    if (nearest.distance === null) nameOnly++;
    else if (nearest.distance <= STRICT_MATCH_RADIUS_M) strict++;
    else distant++;
    for (const { hit, distance } of ranked) {
      matchedOsm.add(`${hit.element.type}/${hit.element.id}`);
      pairs.push({
        our_id: entry.id, osm_type: hit.element.type, osm_id: hit.element.id,
        strict: distance !== null && distance <= STRICT_MATCH_RADIUS_M,
        match: distance === null ? 'name_only' : distance <= STRICT_MATCH_RADIUS_M ? 'strict' : 'distant',
        distance_m: distance === null ? null : Math.round(distance * 10) / 10,
        floor_agree: entry.floor_ordinal !== null && hit.levels.length ? hit.levels.includes(entry.floor_ordinal) : null,
      });
    }
    if (entry.floor_ordinal === null) continue;
    const withLevels = unique.filter((hit) => hit.levels.length > 0);
    if (!withLevels.length) continue;
    if (unique.length !== 1) { floorAmbiguous++; continue; }
    floorComparable++;
    if (withLevels[0]!.levels.includes(entry.floor_ordinal)) floorAgree++;
  }
  const unmatchedOsm = osm.filter((object) => !matchedOsm.has(`${object.element.type}/${object.element.id}`)).map((object) => ({ osm_type: object.element.type, osm_id: object.element.id }));
  return {
    list_id: list.list_id, source: list.source, entries: list.entries.length, distinct_names: names.size,
    matched, strict_matched: strict, name_match_only: nameOnly, name_match_distant: distant, ours_only: unmatchedOurs.length, osm_only: unmatchedOsm.length,
    floor_agreement: { comparable: floorComparable, agree: floorAgree, rate: floorComparable === 0 ? null : Math.round((floorAgree / floorComparable) * 10000) / 10000, ambiguous_excluded: floorAmbiguous },
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
// Committed-text audit (the `check-literals` shape, run against the extract's own values)

/**
 * Committed text this issue adds, audited as a whole against every tag value of the extract. The receipt itself is
 * audited in memory (and is additionally held to the stricter `assertNoSourceValues` token rule). `sources.yaml` is
 * scanned as text, but a value already present in the manifest at `origin/main` is pre-existing text, not an OSM
 * leak introduced here.
 */
export const AUDITED_PATHS = [
  'docs/gis/research/2026-10-24-osm-coverage-odbl.md',
  'tools/gis/test/osm-coverage.test.ts',
  'tools/gis/sources/sources.yaml',
] as const;

/**
 * Words that are both an OSM tag value in this extract and a word of our own text. A word that could describe any
 * shop cannot identify a place, so an exact collision on it is not evidence of a copy. Three groups, and nothing else:
 *
 * 1. The vocabulary of the tagging schemes the note names — tag keys used as values elsewhere (`shop`, `amenity`,
 *    `highway`, `public_transport`), the documented values of Simple Indoor Tagging and of the access vocabulary
 *    (`corridor`, `stairs`, `elevator`, `mall`, `private`, `outside`, …). These are the scheme's words, not the
 *    extract's places.
 * 2. Ordinary English that happens to be a tag value somewhere (`receipt`, `scheme`, `service`, `many`, …).
 * 3. Words of our own that are not from the extract at all: the two fixture strings in the test file (`local
 *    knowledge`, `photo`), the two vendor names the classifier test names (`Apple`, `Bing`), and the two mall names.
 *    The mall names are here because 小田急エース and 京王モール are the complexes the Owner asked about (OD-34) and
 *    reached this work through the brief, not through the extract; the note says so, and they identify two named
 *    buildings rather than any OSM record.
 *
 * Adding a term is a deliberate act: it must be one of these three kinds, never a shop, brand, operator or place
 * name read out of the extract.
 */
export const AUDIT_ALLOWLIST: ReadonlySet<string> = new Set([
  'amenity', 'books', 'convenience', 'corridor', 'crossing', 'elevator', 'escalator', 'footway', 'forward', 'highway',
  'mall', 'multipolygon', 'outdoor', 'outside', 'platform', 'private', 'public_transport', 'restaurant', 'retail',
  'roof', 'room', 'shop', 'stairs', 'steps', 'subway_entrance', 'toilet', 'train_station', 'wall',
  'across', 'closed', 'fixed', 'good', 'internal', 'many', 'marked', 'mixed', 'receipt', 'scheme', 'service',
  'Apple', 'Bing', 'local knowledge', 'photo', '京王モール', '小田急エース',
]);

/** A derived category or kind is ours, but it is spelled like the OSM value: allowed only in its namespaced form. */
const NAMESPACES = ['cat:', 'kind:', 'key:', 'srcclass:'] as const;

/** Values shorter than this are too common to be evidence of a copy; pure numbers carry no free-text value. */
export const AUDIT_MIN_LENGTH = 4;
const NUMERIC_VALUE = /^[-+]?\d+(?:\.\d+)?$/u;

export interface AuditFile { path: string; text: string }
export interface AuditResult {
  files: string[];
  values_scanned: number;
  namespaced_hits: number;
  allowlisted_hits: number;
  pre_existing_hits: number;
  leaks: Array<{ path: string; count: number }>;
}

/** Every occurrence of `value` in `text` is part of a namespaced identifier such as `cat:<value>`. */
function onlyNamespaced(text: string, value: string): boolean {
  let at = text.indexOf(value);
  if (at < 0) return false;
  while (at >= 0) {
    const prefix = text.slice(Math.max(0, at - 8), at);
    if (!NAMESPACES.some((namespace) => prefix.endsWith(namespace))) return false;
    at = text.indexOf(value, at + value.length);
  }
  return true;
}

/** `arts` inside `charts` is not a copy of the tag value; a word-shaped value has to stand as a token of its own. */
const ASCII_VALUE = /^[\x20-\x7e]+$/u;
function occursAsToken(text: string, value: string): boolean {
  if (!ASCII_VALUE.test(value)) return text.includes(value);
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_:])${escaped}(?![A-Za-z0-9_:])`, 'u').test(text);
}

/**
 * Scan committed text for extract values. A hit is a leak unless the value is only ever used inside one of our
 * namespaced identifiers, is on the allowlist, or already occurs in `priorText` (text that predates this work). The
 * audit writes nothing: a non-empty leak list is the caller's signal to stop before writing.
 */
export function auditSourceValues(files: readonly AuditFile[], sourceValues: ReadonlySet<string>, options: { allowlist?: ReadonlySet<string>; priorText?: string } = {}): AuditResult {
  const allowlist = options.allowlist ?? AUDIT_ALLOWLIST;
  const prior = options.priorText ?? '';
  const values = [...sourceValues].filter((value) => value.length >= AUDIT_MIN_LENGTH && !NUMERIC_VALUE.test(value));
  let namespaced = 0, allowlisted = 0, preExisting = 0;
  const leaks: Array<{ path: string; count: number }> = [];
  for (const file of files) {
    let count = 0;
    for (const value of values) {
      if (!file.text.includes(value)) continue;
      if (onlyNamespaced(file.text, value)) { namespaced++; continue; }
      if (!occursAsToken(file.text, value)) continue;
      if (allowlist.has(value)) { allowlisted++; continue; }
      if (prior && prior.includes(value)) { preExisting++; continue; }
      count++;
    }
    if (count) leaks.push({ path: file.path, count });
  }
  return { files: files.map((file) => file.path), values_scanned: values.length, namespaced_hits: namespaced, allowlisted_hits: allowlisted, pre_existing_hits: preExisting, leaks };
}

/** The manifest as it stands on `origin/main`: its text is not an OSM leak introduced by this issue. */
async function priorManifestText(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['show', 'origin/main:tools/gis/sources/sources.yaml'], { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch {
    return '';
  }
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
  comparisons: Array<{ list_id: string; source: string; entries: number; distinct_names: number; matched: number; strict_matched: number; name_match_only: number; name_match_distant: number; ours_only: number; osm_only: number; floor_agreement: { comparable: number; agree: number; rate: number | null; ambiguous_excluded: number }; status: 'compared' | 'unavailable' }>;
  run_id: string;
  /** The committed-text audit: how much text and how many extract values it covered, and what it exempted. */
  leak_guard: { files_checked: number; values_scanned: number; namespaced_hits: number; allowlisted_hits: number; pre_existing_hits: number; leaks: number };
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
    note: 'Coverage evidence for #437 only: counts, shares, histograms, OSM tag keys and our derived categories. No OSM name, free-text tag value or contributor identity is copied; the committed-text audit scanned this receipt, the research note, the test file and the manifest against every tag value of the extract (see leak_guard). The extract stays in the private store. Nothing here is a source for the graph, a route or a shipping POI list, and it may itself raise ODbL Produced Work or attribution questions, open for gteki-1b (docs/gis/research/2026-10-24-osm-coverage-odbl.md).',
    leak_guard: { ...input.leak_guard, note: 'This receipt, the research note, the test file and the manifest were scanned against every tag value of the extract. Values are exempt only as namespaced identifiers, allowlisted vocabulary or text already on origin/main; a leak stops the run before anything is written.' },
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
  const footprint = footprintOverlap(elements, project);
  coverage.footprint_overlap_2d = footprint.footprint;
  coverage.floor_aware_overlap = footprint.floorAware;
  const quality = computeQuality(elements);
  const osm = namedOsmObjects(elements, project);

  const floors = floorOrdinals(stationJson);
  const comparisons: CoverageInput['comparisons'] = [];
  const details: Array<Record<string, unknown>> = [];
  for (const spec of LIST_SPECS[station] ?? []) {
    try {
      const list = await readList(spec, floors);
      const comparison = compareList(list, osm);
      comparisons.push({ list_id: comparison.list_id, source: comparison.source, entries: comparison.entries, distinct_names: comparison.distinct_names, matched: comparison.matched, strict_matched: comparison.strict_matched, name_match_only: comparison.name_match_only, name_match_distant: comparison.name_match_distant, ours_only: comparison.ours_only, osm_only: comparison.osm_only, floor_agreement: comparison.floor_agreement, status: 'compared' });
      details.push({ list_id: comparison.list_id, source: comparison.source, pairs: comparison.pairs, unmatched_osm: comparison.unmatched_osm, unmatched_ours: comparison.unmatched_ours });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      comparisons.push({ list_id: spec.list_id, source: `${spec.ref}:${spec.path}`, entries: 0, distinct_names: 0, matched: 0, strict_matched: 0, name_match_only: 0, name_match_distant: 0, ours_only: 0, osm_only: 0, floor_agreement: { comparable: 0, agree: 0, rate: null, ambiguous_excluded: 0 }, status: 'unavailable' });
      details.push({ list_id: spec.list_id, source: `${spec.ref}:${spec.path}`, status: 'unavailable', reason });
    }
  }

  const query = { sha256: querySha256(stored.source.expected_url), radius_m: OSM_RADIUS_M, origin };
  const digest = sha256(JSON.stringify({ policy: OSM_COVERAGE_POLICY_VERSION, station, source: stored.record.sha256, query: query.sha256 })).slice(0, 20);
  const runId = `osm-coverage-${station}-${digest}`;
  const sourceValues = tagValueSet(elements);
  const keyCount = tagKeySet(elements).size;

  // Committed-text audit before anything is written: the note, the test file and the manifest, then the receipt itself.
  const auditedFiles = await Promise.all(AUDITED_PATHS.map(async (path) => ({ path, text: await readFile(join(repoRoot, path), 'utf8') })));
  const priorText = await priorManifestText();
  const fileAudit = auditSourceValues(auditedFiles, sourceValues, { priorText });
  if (fileAudit.leaks.length) throw new Error(`Committed-text audit failed (${fileAudit.leaks.map((leak) => `${leak.path}: ${leak.count}`).join(', ')}); nothing written`);
  const audit = { files_checked: fileAudit.files.length + 1, values_scanned: fileAudit.values_scanned, namespaced_hits: fileAudit.namespaced_hits, allowlisted_hits: fileAudit.allowlisted_hits, pre_existing_hits: fileAudit.pre_existing_hits, leaks: 0 };

  const receipt = publicCoverageReceipt({
    station,
    source: { source_id: sourceId, sha256: stored.record.sha256, bytes: stored.record.bytes, acquired_at: stored.record.completed_at },
    query,
    extract: { elements: elements.length, rejected, tag_keys: keyCount },
    coverage,
    quality,
    comparisons,
    run_id: runId,
    leak_guard: audit,
  }, sourceValues);
  const receiptAudit = auditSourceValues([{ path: 'receipt', text: JSON.stringify(receipt) }], sourceValues, { priorText });
  if (receiptAudit.leaks.length) throw new Error(`Receipt audit failed (${receiptAudit.leaks.map((leak) => `${leak.path}: ${leak.count}`).join(', ')}); nothing written`);

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
    coverage: { kinds: coverage.kinds, level_histogram: coverage.level_histogram, level_key_objects: coverage.level_key_objects, level_objects: coverage.level_objects, level_unparsed: coverage.level_unparsed, shop_amenity_with_level_key: coverage.shop_amenity_with_level_key, shop_amenity_with_level_parsed: coverage.shop_amenity_with_level_parsed, footprint_overlap_2d: coverage.footprint_overlap_2d, floor_aware_overlap: coverage.floor_aware_overlap },
    quality: { last_edit_year_histogram: quality.last_edit_year_histogram, edited_before_2021: quality.edited_before_2021, source_class_objects: quality.source_class_objects, source_class_exclusive: quality.source_class_exclusive },
    leak_guard: audit,
    comparison: comparisons.map((entry) => ({ list_id: entry.list_id, status: entry.status, entries: entry.entries, matched: entry.matched, strict_matched: entry.strict_matched, name_match_only: entry.name_match_only, name_match_distant: entry.name_match_distant, ours_only: entry.ours_only, osm_only: entry.osm_only, floor_agreement: entry.floor_agreement })),
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
