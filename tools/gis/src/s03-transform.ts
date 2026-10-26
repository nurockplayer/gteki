import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { getStoredSource, getStoreRoot, repoRoot, writeJson } from './common.js';
import { assertNoSourceValues } from './context-overlay.js';
import { stationEnuProjector, stationOriginSha256 } from './station-enu.js';
import { toolFingerprint } from './provenance.js';
import { readZip } from './zip.js';

// v2 excludes polygon features with an unclosed ring from Check A instead of rejecting the whole ZIP.
// v3 adds the INCOMPLETE status, hashes the floor mapping into the receipt identity, keeps absolute outside-node
// positions private, ignores same-level dz = 0 links, compares full ring positions on closure and fails closed on
// hole/shell and self-intersection topology. v4 replaces v3's hole/shell fail-closed rule with the director ruling of
// 2026-10-24: that feature is excluded whole and recorded, like an unclosed ring, and every other malformation still
// fails closed. No v3 receipt was ever written, so nothing was reissued under an old policy.
export const S03_TRANSFORM_POLICY = 's03-transform-check-v4';
export const OUTSIDE_SUPPRESSION_MIN_NODES = 3;
export const SELF_INTERSECTION_MAX_VERTICES = 2000;
export const UNCLOSED_RING_DEFECT = 'SOURCE_DEFECT_UNCLOSED_RING';
export const HOLE_OUTSIDE_SHELL_DEFECT = 'SOURCE_DEFECT_HOLE_OUTSIDE_SHELL';
export const S03_DATUM = {
  declared: null,
  spec_statement: 'absent crs means WGS84 (S03 spec p8)',
  status: 'UNKNOWN',
  assumed_for_projection: 'WGS84 lon/lat used as JGD2011 geographic; no realization/epoch correction',
  asserted: false,
} as const;
const DATUM_NOTE = 'The combined residual includes datum/epoch, cartography and node-placement error; this check is not a survey certificate.';
const S03_CREDIT = '出典：東京都都市整備局「新宿駅周辺の施設情報等」';
const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
export type Point2 = readonly [number, number];
export type Affine = readonly [number, number, number, number, number, number];
export type Polygon2 = readonly (readonly Point2[])[];
export type Project = (lat: number, lon: number) => Point2;
/**
 * A source feature excluded from Check A because one of its rings does not repeat its first position. `first` and
 * `last` are the source's complete original tuples, an optional third value included, so a ring that returns to the
 * same x/y at a different height is still recorded as the distinct endpoints it is.
 */
export interface S03UnclosedRingDefect {
  kind: typeof UNCLOSED_RING_DEFECT;
  levelId: number;
  /** The excluded feature's own source id when it has one; private provenance only, never the public receipt. */
  featureId: number | null;
  featureIndex: number;
  polygonIndex: number;
  ringIndex: number;
  first: number[];
  last: number[];
}
/**
 * A source feature excluded from Check A because a hole ring lies strictly outside its shell: at least one hole vertex
 * is outside and no hole edge crosses the shell. The ring is never clipped, moved or repaired: the source tuples and
 * the shell they were tested against are kept here for the ENU offset only, and the private provenance records them
 * untruncated; the public receipt carries the numeric offset.
 */
export interface S03HoleOutsideShellDefect {
  kind: typeof HOLE_OUTSIDE_SHELL_DEFECT;
  levelId: number;
  /** The excluded feature's own source id when it has one; private provenance only, never the public receipt. */
  featureId: number | null;
  featureIndex: number;
  polygonIndex: number;
  ringIndex: number;
  /** Hole source tuples that the inclusive shell test rejects, third value included when the source has one. */
  vertices: number[][];
  /** The shell ring those positions were tested against, as source tuples. */
  shell: number[][];
}
export type S03SourceDefect = S03UnclosedRingDefect | S03HoleOutsideShellDefect;
type JsonObject = Record<string, unknown>;
const record = (v: unknown): v is JsonObject => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const id = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const lonLat = (p: Point2): boolean => p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/** Coefficient order [a,b,c,d,e,f]: (a*x+c*y+e, b*x+d*y+f). No fitting or correction. */
export function applyAffine(point: Point2, t: Affine): [number, number] {
  return [t[0] * point[0] + t[2] * point[1] + t[4], t[1] * point[0] + t[3] * point[1] + t[5]];
}
export function transformS03(point: Point2, nav: Affine, drawing: Affine, swapped = false): [number, number] {
  return swapped ? applyAffine(applyAffine(point, drawing), nav) : applyAffine(applyAffine(point, nav), drawing);
}

export function distanceToSegment(point: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2));
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}
function distanceToRing(point: Point2, ring: readonly Point2[]): number {
  let nearest = Infinity;
  for (let i = 0; i + 1 < ring.length; i++) nearest = Math.min(nearest, distanceToSegment(point, ring[i]!, ring[i + 1]!));
  return nearest;
}
export function distanceToPolygonEdge(point: Point2, polygon: Polygon2): number {
  let nearest = Infinity;
  for (const ring of polygon) nearest = Math.min(nearest, distanceToRing(point, ring));
  return nearest;
}
function inRing(point: Point2, ring: readonly Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
/** Inside a single ring or on one of its edges; hole semantics are the caller's business. */
export function ringContainsInclusive(point: Point2, ring: readonly Point2[]): boolean {
  return distanceToRing(point, ring) <= 1e-9 || inRing(point, ring);
}
/** Closed polygon surface: the shell decides first, then hole boundaries count as inside and hole interiors do not. */
export function pointInPolygon(point: Point2, polygon: Polygon2): boolean {
  if (!polygon.length) return false;
  const shell = polygon[0]!, holes = polygon.slice(1);
  // A hole boundary can never contain a point the shell does not: require shell membership first.
  if (!ringContainsInclusive(point, shell)) return false;
  if (holes.some(hole => distanceToRing(point, hole) <= 1e-9)) return true;
  return !holes.some(hole => inRing(point, hole));
}
/** Positions closer than this, in degrees, are treated as coincident: about a tenth of a micrometre on the ground. */
export const GEOMETRY_EPS = 1e-12;
const signedDistance = (point: Point2, a: Point2, b: Point2): number => {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
  return length === 0 ? Math.hypot(point[0] - a[0], point[1] - a[1]) : ((point[0] - a[0]) * dy - (point[1] - a[1]) * dx) / length;
};
const sideOf = (point: Point2, a: Point2, b: Point2): -1 | 0 | 1 => {
  const distance = signedDistance(point, a, b);
  return Math.abs(distance) <= GEOMETRY_EPS ? 0 : distance > 0 ? 1 : -1;
};
export type SegmentRelation = 'none' | 'touch' | 'cross' | 'overlap';
/**
 * How two closed segments meet: `touch` is a single shared position, `overlap` a collinear shared interval of positive
 * length, `cross` a proper crossing through both interiors. Collinear and touching contact are decided on true
 * distances, so neither a T-junction nor a fold-back hides inside a zero cross product.
 */
export function segmentRelation(a: Point2, b: Point2, c: Point2, d: Point2): SegmentRelation {
  if (Math.max(a[0], b[0]) + GEOMETRY_EPS < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) + GEOMETRY_EPS < Math.min(a[0], b[0])
    || Math.max(a[1], b[1]) + GEOMETRY_EPS < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) + GEOMETRY_EPS < Math.min(a[1], b[1])) return 'none';
  const lengthAB = Math.hypot(b[0] - a[0], b[1] - a[1]), lengthCD = Math.hypot(d[0] - c[0], d[1] - c[1]);
  // A zero-length edge is a position; it can only touch or miss.
  if (lengthAB <= GEOMETRY_EPS || lengthCD <= GEOMETRY_EPS) {
    const [point, from, to] = lengthAB <= GEOMETRY_EPS ? [a, c, d] : [c, a, b];
    return sideOf(point, from, to) === 0 && distanceToSegment(point, from, to) <= GEOMETRY_EPS ? 'touch' : 'none';
  }
  const sides = [sideOf(a, c, d), sideOf(b, c, d), sideOf(c, a, b), sideOf(d, a, b)] as const;
  if (sides.every(side => side === 0)) {
    // Collinear: the shared interval decides between a single touch and an overlap.
    const axis = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 0 : 1;
    const overlap = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) - Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
    return overlap > GEOMETRY_EPS ? 'overlap' : overlap >= -GEOMETRY_EPS ? 'touch' : 'none';
  }
  if (sides[0] * sides[1] < 0 && sides[2] * sides[3] < 0) return 'cross';
  const endpoints: Array<[Point2, Point2, Point2, number]> = [[a, c, d, sides[0]], [b, c, d, sides[1]], [c, a, b, sides[2]], [d, a, b, sides[3]]];
  return endpoints.some(([point, from, to, side]) => side === 0 && distanceToSegment(point, from, to) <= GEOMETRY_EPS) ? 'touch' : 'none';
}
/** Position of a point along a segment, clamped to [0, 1]; a zero-length segment has no interior. */
const segmentParameter = (point: Point2, a: Point2, b: Point2): number => {
  const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
  return length2 === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2));
};
const onSegment = (point: Point2, a: Point2, b: Point2): boolean => distanceToSegment(point, a, b) <= GEOMETRY_EPS;
export interface HoleShellRelation { cross: boolean; overlap: boolean; leaves: boolean; touch: boolean }
/**
 * What one hole ring does to its shell, edge by edge. A crossing and a collinear run along the shell are visible in the
 * edge relation, and a single shared position is a legitimate boundary touch. An excursion a concave shell allows is
 * not: a hole edge can leave the shell through one shell position and come back through another, and both contacts read
 * as single points. Every hole edge is therefore split at each contact position and the middle of each piece is tested
 * against the shell, so a hole with pieces on both sides of the boundary is reported as `leaves`. A hole with no piece
 * inside is not an excursion: that is the wholly-outside case the director ruling excludes, and failing it closed would
 * turn an exclusion into a stopped run.
 */
export function holeShellRelation(hole: readonly Point2[], shell: readonly Point2[]): HoleShellRelation {
  let cross = false, overlap = false, touch = false, insidePiece = false, outsidePiece = false;
  for (let i = 0; i + 1 < hole.length; i++) {
    const a = hole[i]!, b = hole[i + 1]!, parameters = [0, 1];
    for (let j = 0; j + 1 < shell.length; j++) {
      const c = shell[j]!, d = shell[j + 1]!, relation = segmentRelation(a, b, c, d);
      if (relation === 'none') continue;
      if (relation === 'cross') cross = true;
      else if (relation === 'overlap') overlap = true;
      else touch = true;
      // Every shared position on either side splits this hole edge, so no piece straddles the shell boundary.
      for (const point of [a, b]) if (onSegment(point, c, d)) parameters.push(segmentParameter(point, a, b));
      for (const point of [c, d]) if (onSegment(point, a, b)) parameters.push(segmentParameter(point, a, b));
    }
    parameters.sort((first, second) => first - second);
    for (let k = 0; k + 1 < parameters.length; k++) {
      const from = parameters[k]!, to = parameters[k + 1]!;
      if (to - from <= GEOMETRY_EPS) continue;
      const middle = (from + to) / 2;
      if (ringContainsInclusive([a[0] + (b[0] - a[0]) * middle, a[1] + (b[1] - a[1]) * middle], shell)) insidePiece = true;
      else outsidePiece = true;
    }
  }
  return { cross, overlap, leaves: insidePiece && outsidePiece, touch };
}
export type SelfIntersectionVerdict = 'CLEAN' | 'SELF_INTERSECTING' | 'DEGENERATE_RING' | 'NOT_CHECKED_TOO_MANY_VERTICES';
const coincident = (a: Point2, b: Point2): boolean => Math.abs(a[0] - b[0]) <= GEOMETRY_EPS && Math.abs(a[1] - b[1]) <= GEOMETRY_EPS;
/**
 * O(n^2) check on a ring. A simple ring has no proper crossing, no collinear overlap anywhere and no contact between
 * non-adjacent edges at all, so a T-junction or a boundary touch between two non-adjacent edges is not simple either;
 * adjacent edges may only meet at their shared position. Repeated consecutive positions are zero-length edges rather
 * than edges, so they are collapsed before the test (the stored ring is untouched), which keeps a duplicated vertex from
 * reading as the ring touching itself. Rings above the vertex cap are reported as unchecked, never as clean, and a ring
 * left with fewer than three distinct positions has no interior at all, so it fails closed instead of passing as clean.
 */
export function selfIntersectionCheck(points: readonly Point2[]): SelfIntersectionVerdict {
  if (points.length - 1 > SELF_INTERSECTION_MAX_VERTICES) return 'NOT_CHECKED_TOO_MANY_VERTICES';
  const ring: Point2[] = [];
  for (const point of points) { const previous = ring.at(-1); if (!previous || !coincident(previous, point)) ring.push(point); }
  // The closing position repeats the first one; anything else stays an open polyline whose ends are not joined.
  const closedRing = ring.length > 1 && coincident(ring[0]!, ring.at(-1)!);
  if (closedRing) ring.pop();
  if (ring.length < 3) return 'DEGENERATE_RING';
  const segments = closedRing ? ring.length : ring.length - 1;
  const end = (index: number): Point2 => ring[closedRing ? (index + 1) % ring.length : index + 1]!;
  for (let i = 0; i < segments; i++) for (let j = i + 1; j < segments; j++) {
    const adjacent = j === i + 1 || (closedRing && i === 0 && j === segments - 1);
    const relation = segmentRelation(ring[i]!, end(i), ring[j]!, end(j));
    // Neighbours legitimately share their position, so for them only a shared stretch of positive length is a defect.
    if (adjacent ? relation === 'overlap' : relation !== 'none') return 'SELF_INTERSECTING';
  }
  return 'CLEAN';
}
/** Linear interpolation at (n-1)*p, matching the research note. Empty samples remain null. */
export function residualStats(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number): number | null => {
    if (!sorted.length) return null;
    const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
  };
  return { count: values.length, min_m: sorted[0] ?? null, median_m: percentile(0.5), p90_m: percentile(0.9), max_m: sorted.at(-1) ?? null };
}

/**
 * `geometryId` is the source's `l[].gid`, the id of the level-geometry feature the node sits in, or null when the
 * source omits it (43 node-level entries in this archive). It is an identity, never a position.
 */
export interface S03Node { index: number; sourceId: number; levelId: number; native: Point2; geometryId: number | null }
/** Nav link: `direction` is the source's `d` (1 forward, 2 reverse, 3 both); `dz` is the source's vertical step when present. */
export interface S03Link { sourceId: number; n1: number; n2: number; direction: number; dz: number | null }
/**
 * One used polygon feature, kept with the source feature id so a caller can locate it again. `featureId` is the
 * numeric id of the feature in its `geojson-level-geom-*.geojson` member, never a com-entity id; features excluded by a
 * source-defect ruling never appear here, because their geometry is not used.
 */
export interface S03FeatureGeometry { featureIndex: number; featureId: number | null; polygons: Polygon2[] }
export interface S03Level {
  /** `label` is the source level label that the asserted ordinal map was applied to; it never enters a public receipt. */
  id: number; label: string; ordinal: number; polygons: Polygon2[]; nonPolygonFeatures: number; memberSha256: string;
  featuresTotal: number; featuresUsed: number; featuresExcludedUnclosedRing: number; featuresExcludedHoleOutsideShell: number;
  features: S03FeatureGeometry[];
}
export interface S03Inputs {
  navTransform: Affine; drawingTransform: Affine; drawingId: number;
  nodes: S03Node[]; levels: S03Level[]; links: S03Link[]; sourceValues: Set<string>; sourceDefects: S03SourceDefect[];
  topology: { rings_checked: number; rings_skipped_large: number; hole_shell_touches: number };
  navSha256: string; mapSha256: string;
}
/** Asserted comparison ordinals from WP7: source level label to our floor ordinal. Never a physical elevation; source zlevel is deliberately unused. */
export const S03_FLOOR_ORDINALS: Readonly<Record<string, number>> = { B5F: -5, B4F: -4, B3F: -3, MB2F: -2.5, B2F: -2, B1F: -1, M1F: -0.5, '1F': 1, '2F': 2, '3F': 3, '4F': 4 };

/** Guard all string leaves, including nested/localized properties and nav tuple properties, without a length exemption. */
export function collectS03Strings(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === 'string') into.add(value);
  else if (Array.isArray(value)) for (const entry of value) collectS03Strings(entry, into);
  else if (record(value)) for (const entry of Object.values(value)) collectS03Strings(entry, into);
  return into;
}

/** Check the buffer that will actually be parsed, in addition to getStoredSource's on-disk check. */
export function assertS03Bytes(bytes: Buffer, expected: { sha256: string; bytes: number }): void {
  if (sha256(bytes) !== expected.sha256 || bytes.length !== expected.bytes) throw new Error('tokyo-s03-zip: SHA-256/byte-count mismatch against acquisition record');
}

/**
 * Basename lookup is deliberate: the source ZIP uses a legacy Japanese parent directory. Ambiguity fails closed.
 * The one tolerated malformation is an unclosed polygon ring: that feature is excluded from Check A and recorded as
 * a source defect. The ring is never closed, repaired or edited, and every other malformation still throws.
 */
export function parseS03Members(entries: readonly { name: string; data: Buffer }[]): S03Inputs {
  const members = new Map<string, { name: string; data: Buffer }>();
  const parsed = new Map<string, unknown>(), sourceValues = new Set<string>();
  const fail = (member: string, reason: string): never => { throw new Error(`Malformed S03 ZIP member ${member}: ${reason}`); };
  for (const entry of entries) {
    const base = posix.basename(entry.name);
    if (members.has(base)) fail(base, 'duplicate basename');
    members.set(base, entry);
    // Read every JSON member, including entities/path files, so the receipt guard covers all S03 strings.
    if (/\.(?:geo)?json$/i.test(base)) {
      let value: unknown;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(entry.data)); }
      catch { fail(base, 'invalid UTF-8 or JSON'); }
      parsed.set(base, value);
      collectS03Strings(value, sourceValues);
    }
  }
  const required = (base: string): JsonObject => {
    if (!members.has(base)) throw new Error(`Missing S03 ZIP member ${base}`);
    const value = parsed.get(base);
    if (!record(value)) fail(base, 'expected JSON object');
    return value as JsonObject;
  };
  const noCrsOverride = (value: unknown, member: string): void => {
    if (Array.isArray(value)) for (const entry of value) noCrsOverride(entry, member);
    else if (record(value)) {
      if (Object.hasOwn(value, 'crs')) fail(member, 'explicit crs needs a separate interpretation; absent-CRS assumption cannot be used');
      for (const entry of Object.values(value)) if (entry !== value.coordinates) noCrsOverride(entry, member);
    }
  };
  const affine = (v: unknown, member: string): Affine => {
    if (!Array.isArray(v) || v.length !== 6 || !v.every(finite)) fail(member, 'expected six finite affine coefficients');
    return v as unknown as Affine;
  };
  const navName = 'v5_nav.json', mapName = 'com-map.geojson';
  const nav = required(navName), map = required(mapName);
  noCrsOverride(nav, navName); noCrsOverride(map, mapName);
  if (!Array.isArray(nav.d) || nav.d.length !== 1 || !record(nav.d[0])) fail(navName, 'expected exactly one drawing');
  if (!Array.isArray(map.drawings) || map.drawings.length !== 1 || !record(map.drawings[0])) fail(mapName, 'expected exactly one drawing');
  const nd = (nav.d as JsonObject[])[0]!, md = (map.drawings as JsonObject[])[0]!;
  if (!id(md.id) || nd.id !== md.id) fail(mapName, 'drawing id must match v5_nav.json');
  const drawingId = md.id as number;
  const navTransform = affine(nd.t, navName);
  if (!record(md.ref_frame)) fail(mapName, 'missing ref_frame');
  const drawingTransform = affine((md.ref_frame as JsonObject).transform, mapName);
  if (!Array.isArray(md.levels) || !md.levels.length) fail(mapName, 'missing levels');
  const levelIds = new Set<number>();
  // Positions keep the tuple the source wrote, including an optional third value; horizontal maths drops z afterwards.
  const position = (v: unknown, member: string): number[] => {
    if (!Array.isArray(v) || (v.length !== 2 && v.length !== 3) || !v.every(finite) || !lonLat(v as unknown as Point2)) fail(member, 'invalid geographic coordinate');
    return v as number[];
  };
  const ring = (v: unknown, member: string): number[][] => {
    if (!Array.isArray(v) || v.length < 4) fail(member, 'polygon ring must have at least four positions');
    return (v as unknown[]).map(p => position(p, member));
  };
  const samePosition = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((value, index) => value === b[index]);
  // Closure compares the complete original tuples, so a ring that returns to the first x/y at a different height is unclosed.
  const closed = (points: readonly (readonly number[])[]): boolean => samePosition(points[0]!, points.at(-1)!);
  const polygon = (v: unknown, member: string): number[][][] => {
    if (!Array.isArray(v) || !v.length) fail(member, 'polygon has no rings');
    return (v as unknown[]).map(r => ring(r, member));
  };
  const horizontal = (positions: readonly (readonly number[])[]): Point2[] => positions.map(([lon, lat]) => [lon!, lat!] as Point2);
  const topology = { rings_checked: 0, rings_skipped_large: 0, hole_shell_touches: 0 };
  const sourceDefects: S03SourceDefect[] = [];
  const levels: S03Level[] = (md.levels as unknown[]).map(raw => {
    if (!record(raw) || !id(raw.id) || !record(raw.properties) || typeof raw.properties.name !== 'string') fail(mapName, 'invalid level id/properties');
    const level = raw as { id: number; properties: { name: string } }, label = level.properties.name;
    if (levelIds.has(level.id)) fail(mapName, 'duplicate level id');
    levelIds.add(level.id);
    if (!Object.hasOwn(S03_FLOOR_ORDINALS, label)) fail(mapName, 'level has no comparison ordinal in the research rule');
    const member = `geojson-level-geom-${label}.geojson`, doc = required(member);
    noCrsOverride(doc, member);
    if (doc.type !== 'FeatureCollection' || doc.id !== level.id || doc.drawing_id !== drawingId || !Array.isArray(doc.features)) fail(member, 'invalid collection, level id or drawing id');
    const polygons: Polygon2[] = [], usedFeatures: S03FeatureGeometry[] = [];
    let nonPolygonFeatures = 0, featuresUsed = 0, featuresExcludedUnclosedRing = 0, featuresExcludedHoleOutsideShell = 0;
    const features = doc.features as unknown[];
    features.forEach((rawFeature, featureIndex) => {
      if (!record(rawFeature) || rawFeature.type !== 'Feature' || !record(rawFeature.geometry)) fail(member, 'invalid feature/geometry');
      // A feature id is optional in the source format, but a present one that is not a positive safe integer is malformed.
      const rawFeatureId = (rawFeature as JsonObject).id;
      if (rawFeatureId !== undefined && !id(rawFeatureId)) fail(member, `feature ${featureIndex} has an invalid id`);
      const featureId = rawFeatureId === undefined ? null : rawFeatureId as number;
      const geometry = (rawFeature as JsonObject).geometry as JsonObject;
      const parts: unknown[] = [];
      if (geometry.type === 'Polygon') parts.push(geometry.coordinates);
      else if (geometry.type === 'MultiPolygon') {
        if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.length) fail(member, 'invalid multipolygon');
        parts.push(...(geometry.coordinates as unknown[]));
      } else if (geometry.type === 'Point') { position(geometry.coordinates, member); nonPolygonFeatures++; return; }
      else if (geometry.type === 'LineString') {
        if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) fail(member, 'invalid line');
        for (const p of geometry.coordinates as unknown[]) position(p, member);
        nonPolygonFeatures++; return;
      } else fail(member, 'unsupported geometry type');
      // Parse every ring of every part first, so an unrelated malformation still fails closed on an excluded feature.
      const parsed = parts.map((part, polygonIndex) => ({ polygonIndex, rings: polygon(part, member) }));
      // Topology comes first and covers every ring of the feature, so a feature carrying both an exclusion defect and a
      // topology defect still fails closed instead of being quietly excluded.
      const verdicts = parsed.flatMap(({ polygonIndex, rings }) => rings.map((points, ringIndex) => ({ polygonIndex, ringIndex, verdict: selfIntersectionCheck(horizontal(points)) })));
      const crossing = verdicts.find(({ verdict }) => verdict === 'SELF_INTERSECTING');
      if (crossing) fail(member, `ring ${crossing.ringIndex} self-intersects (level ${level.id}, feature ${featureIndex}, polygon ${crossing.polygonIndex})`);
      const degenerate = verdicts.find(({ verdict }) => verdict === 'DEGENERATE_RING');
      if (degenerate) fail(member, `ring ${degenerate.ringIndex} has fewer than three distinct positions (level ${level.id}, feature ${featureIndex}, polygon ${degenerate.polygonIndex})`);
      // A hole edge that crosses its shell, runs along it, or leaves it and comes back through two shared positions fails
      // closed: vertex containment alone misses a concave shell where every hole vertex is inside while an edge between
      // two of them leaves it. A single shared position is a legitimate boundary touch, counted, not a defect: the
      // director's exclusion covers only a hole wholly outside its shell, which by definition never crosses or leaves it.
      // The same vertex bound as the ring test applies; a larger hole or shell is skipped here and already counted in
      // rings_skipped_large by its own ring verdict.
      let holeShellTouches = 0;
      for (const { polygonIndex, rings } of parsed) {
        const shell = horizontal(rings[0]!);
        for (let ringIndex = 1; ringIndex < rings.length; ringIndex++) {
          if (rings[0]!.length - 1 > SELF_INTERSECTION_MAX_VERTICES || rings[ringIndex]!.length - 1 > SELF_INTERSECTION_MAX_VERTICES) continue;
          const relation = holeShellRelation(horizontal(rings[ringIndex]!), shell);
          if (relation.cross) fail(member, `ring ${ringIndex} cuts through its shell (level ${level.id}, feature ${featureIndex}, polygon ${polygonIndex})`);
          if (relation.overlap) fail(member, `ring ${ringIndex} runs along its shell (level ${level.id}, feature ${featureIndex}, polygon ${polygonIndex})`);
          if (relation.leaves) fail(member, `ring ${ringIndex} leaves its shell (level ${level.id}, feature ${featureIndex}, polygon ${polygonIndex})`);
          if (relation.touch) holeShellTouches++;
        }
      }
      // Two director rulings exclude a whole feature: an unclosed ring, and a hole wholly outside its shell. Neither
      // ring is clipped, moved or otherwise repaired, and every other malformation still fails closed above.
      const unclosed = parsed.flatMap(({ polygonIndex, rings }) => rings.map((positions, ringIndex) => ({ positions, polygonIndex, ringIndex })))
        .find(({ positions }) => !closed(positions));
      if (unclosed) {
        // Whole-feature exclusion, first offending ring only; reported by numeric level id and zero-based indexes. The
        // endpoints are the source's complete tuples, so a ring unclosed only in its third value keeps both endpoints.
        featuresExcludedUnclosedRing++;
        sourceDefects.push({ kind: UNCLOSED_RING_DEFECT, levelId: level.id, featureId, featureIndex, polygonIndex: unclosed.polygonIndex, ringIndex: unclosed.ringIndex,
          first: [...unclosed.positions[0]!], last: [...unclosed.positions.at(-1)!] });
        return;
      }
      for (const { polygonIndex, rings } of parsed) {
        const shell = horizontal(rings[0]!);
        const holeIndex = rings.slice(1).findIndex(hole => horizontal(hole).some(vertex => !ringContainsInclusive(vertex, shell)));
        if (holeIndex < 0) continue;
        const hole = rings[holeIndex + 1]!, flat = horizontal(hole);
        featuresExcludedHoleOutsideShell++;
        sourceDefects.push({ kind: HOLE_OUTSIDE_SHELL_DEFECT, levelId: level.id, featureId, featureIndex, polygonIndex, ringIndex: holeIndex + 1,
          vertices: hole.filter((_, index) => !ringContainsInclusive(flat[index]!, shell)), shell: rings[0]! });
        return;
      }
      // The counters describe the rings Check A actually used, so an excluded feature's rings are not counted as checked.
      for (const { verdict } of verdicts) {
        if (verdict === 'CLEAN') topology.rings_checked++;
        else topology.rings_skipped_large++;
      }
      topology.hole_shell_touches += holeShellTouches;
      featuresUsed++;
      const featurePolygons = parsed.map(({ rings }) => rings.map(horizontal));
      for (const featurePolygon of featurePolygons) polygons.push(featurePolygon);
      usedFeatures.push({ featureIndex, featureId, polygons: featurePolygons });
    });
    // A level whose polygon features were all excluded stays in the output with null inside metrics; a level with no polygon feature at all still fails.
    if (!polygons.length && !featuresExcludedUnclosedRing && !featuresExcludedHoleOutsideShell) fail(member, 'no polygons to test');
    return { id: level.id, label, ordinal: S03_FLOOR_ORDINALS[label]!, polygons, nonPolygonFeatures, memberSha256: sha256(members.get(member)!.data),
      featuresTotal: features.length, featuresUsed, featuresExcludedUnclosedRing, featuresExcludedHoleOutsideShell, features: usedFeatures };
  });
  if (!Array.isArray(nd.l) || nd.l.length !== levels.length || new Set(nd.l.map(l => record(l) ? l.id : null)).size !== levels.length || nd.l.some(l => !record(l) || !levelIds.has(l.id as number))) fail(navName, 'drawing levels do not match com-map.geojson');
  if (!Array.isArray(nav.n) || !nav.n.length) fail(navName, 'missing nodes');
  const nodeIds = new Set<number>();
  const nodes: S03Node[] = (nav.n as unknown[]).map((n, index) => {
    if (!record(n) || !id(n.id) || !finite(n.mx) || !finite(n.my) || !Array.isArray(n.l) || n.l.length !== 1 || !record(n.l[0]) || !levelIds.has(n.l[0].lid as number)) fail(navName, `invalid node or ambiguous level at index ${index}`);
    const node = n as { id: number; mx: number; my: number; l: Array<{ lid: number; gid?: number }> };
    if (nodeIds.has(node.id)) fail(navName, `duplicate node id at index ${index}`);
    // The geometry id is optional but, when written, must be a positive integer: a malformed one fails closed.
    const gid = node.l[0]!.gid;
    if (gid !== undefined && !id(gid)) fail(navName, `node ${node.id} has a malformed level geometry id`);
    nodeIds.add(node.id);
    return { index, sourceId: node.id, levelId: node.l[0]!.lid, native: [node.mx, node.my], geometryId: gid ?? null };
  });
  // Links carry the source's direction code (1 forward, 2 reverse, 3 both) and dz only when they change level.
  if (!Array.isArray(nav.l)) fail(navName, 'missing links');
  const linkIds = new Set<number>();
  const links: S03Link[] = (nav.l as unknown[]).map((raw, index) => {
    if (!record(raw) || !id(raw.id) || !finite(raw.n1) || !finite(raw.n2) || ![1, 2, 3].includes(raw.d as number) || raw.dz !== undefined && !finite(raw.dz)) fail(navName, `invalid link at index ${index}`);
    const link = raw as { id: number; n1: number; n2: number; d: number; dz?: number };
    if (linkIds.has(link.id)) fail(navName, `duplicate link id at index ${index}`);
    linkIds.add(link.id);
    if (!Number.isSafeInteger(link.n1) || !Number.isSafeInteger(link.n2) || !nodeIds.has(link.n1) || !nodeIds.has(link.n2)) fail(navName, `link endpoints at index ${index} are not nodes`);
    return { sourceId: link.id, n1: link.n1, n2: link.n2, direction: link.d, dz: typeof link.dz === 'number' ? link.dz : null };
  });
  return { navTransform, drawingTransform, drawingId, nodes, levels, links, sourceValues, sourceDefects, topology, navSha256: sha256(members.get(navName)!.data), mapSha256: sha256(members.get(mapName)!.data) };
}

/**
 * Public defect records: the ENU endpoint gap for an unclosed ring, the ENU offset of the worst offending hole vertex
 * from its shell for a hole outside its shell. Both use the same station projector Check A uses; nothing is closed,
 * clipped or moved, and the source positions themselves stay in the private provenance.
 */
export function sourceDefectRecords(inputs: S03Inputs, project: Project) {
  return inputs.sourceDefects.map(defect => {
    const base = { kind: defect.kind, level_id: defect.levelId, feature_index: defect.featureIndex, polygon_index: defect.polygonIndex, ring_index: defect.ringIndex };
    // The records carry complete source tuples; only the horizontal position enters the ENU maths.
    if (defect.kind === UNCLOSED_RING_DEFECT) {
      const first = project(defect.first[1]!, defect.first[0]!), last = project(defect.last[1]!, defect.last[0]!);
      return { ...base, endpoint_gap_m: Math.hypot(last[0] - first[0], last[1] - first[1]) };
    }
    const shell = defect.shell.map(([lon, lat]) => project(lat!, lon!));
    const offset = (position: readonly number[]): number => {
      const xy = project(position[1]!, position[0]!);
      return Math.min(...shell.slice(0, -1).map((from, index) => {
        const nearest = nearestPointOnSegment(xy, from, shell[index + 1]!);
        return Math.hypot(nearest[0] - xy[0], nearest[1] - xy[1]);
      }));
    };
    return { ...base, max_offset_m: Math.max(...defect.vertices.map(offset)) };
  });
}
/** Policy fixed before looking at results: >=95% inside, both overall and on every assessed level with nodes. */
export const OVERWHELMING_INSIDE_SHARE = 0.95;
export function checkInternal(inputs: S03Inputs, project: Project, swapped = false) {
  const perLevel = inputs.levels.map(level => {
    const nodes = inputs.nodes.filter(n => n.levelId === level.id);
    const coverage = { features_total: level.featuresTotal, features_used: level.featuresUsed, features_excluded_unclosed_ring: level.featuresExcludedUnclosedRing,
      features_excluded_hole_outside_shell: level.featuresExcludedHoleOutsideShell, non_polygon_features_excluded: level.nonPolygonFeatures };
    const polygons = level.polygons.map(poly => poly.map(ring => ring.map(([lon, lat]) => project(lat, lon))));
    if (!polygons.length) {
      // Every polygon feature on this level was excluded as a source defect. Nothing is invented and the level stays visible.
      return [level.id, { ...coverage, node_count: nodes.length, polygon_count: 0, inside_count: null, inside_share: null,
        outside_count: null, outside_unprojectable_count: null, outside_edge_distance_m: residualStats([]),
        reason: 'No usable polygon: every polygon feature on this level was excluded for a source defect (SOURCE_DEFECT_UNCLOSED_RING or SOURCE_DEFECT_HOLE_OUTSIDE_SHELL); inside metrics are null.' }] as const;
    }
    // Precomputed bboxes reduce the ground-level polygon checks without changing the closed-surface rule.
    const bounds = polygons.map(poly => {
      const outer = poly[0]!;
      return [Math.min(...outer.map(p => p[0])), Math.min(...outer.map(p => p[1])), Math.max(...outer.map(p => p[0])), Math.max(...outer.map(p => p[1]))];
    });
    let inside = 0, invalid = 0;
    const distances: number[] = [];
    for (const node of nodes) {
      const ll = transformS03(node.native, inputs.navTransform, inputs.drawingTransform, swapped);
      // The reversed transform can leave geographic space. No metric distance is asserted for such a point.
      if (!lonLat(ll)) { invalid++; continue; }
      const xy = project(ll[1], ll[0]);
      const contained = polygons.some((poly, i) => {
        const b = bounds[i]!;
        return xy[0] >= b[0]! - 1e-9 && xy[0] <= b[2]! + 1e-9 && xy[1] >= b[1]! - 1e-9 && xy[1] <= b[3]! + 1e-9 && pointInPolygon(xy, poly);
      });
      if (contained) inside++;
      else {
        let nearest = Infinity;
        for (const poly of polygons) nearest = Math.min(nearest, distanceToPolygonEdge(xy, poly));
        distances.push(nearest);
      }
    }
    return [level.id, { ...coverage, node_count: nodes.length, polygon_count: polygons.length, inside_count: inside, inside_share: nodes.length ? inside / nodes.length : null,
      outside_count: nodes.length - inside, outside_unprojectable_count: invalid, outside_edge_distance_m: residualStats(distances), reason: null }] as const;
  });
  const assessed = perLevel.flatMap(([, v]) => v.inside_share === null ? [] : [{ ...v, inside_count: v.inside_count ?? 0, outside_unprojectable_count: v.outside_unprojectable_count ?? 0 }]);
  // Only a level with no usable polygon is unassessed; a level with polygons but no nodes has nothing to test and is not listed here.
  const unassessed = perLevel.filter(([, v]) => v.polygon_count === 0).map(([levelId]) => levelId);
  // Nodes on an unassessed level are neither inside nor outside; PASS must never hide them.
  const unassessedWithNodes = perLevel.filter(([, v]) => v.polygon_count === 0 && v.node_count > 0).map(([levelId]) => levelId);
  const nodesUnassessed = perLevel.reduce((sum, [, v]) => sum + (v.polygon_count === 0 ? v.node_count : 0), 0);
  const nodeCount = assessed.reduce((sum, v) => sum + v.node_count, 0), inside = assessed.reduce((sum, v) => sum + v.inside_count, 0);
  const assessedPasses = nodeCount > 0 && inside / nodeCount >= OVERWHELMING_INSIDE_SHARE && assessed.every(v => !v.node_count || v.inside_share! >= OVERWHELMING_INSIDE_SHARE);
  const failed = 'Not overwhelmingly inside at the fixed threshold on every assessed level and overall; no transform adjustment applied.';
  const status = !assessedPasses ? 'FAIL' : unassessedWithNodes.length ? 'INCOMPLETE' : 'PASS';
  const reason = status === 'PASS' ? 'Overwhelmingly inside at the fixed threshold on every assessed level and overall.'
    : status === 'INCOMPLETE' ? `The assessed levels are overwhelmingly inside at the fixed threshold, but ${nodesUnassessed} nodes on levels ${unassessedWithNodes.join(', ')} have no usable polygon and were not assessed; the status is INCOMPLETE, not PASS.`
    : unassessed.length ? `${failed} Levels in levels_without_usable_polygons were not assessed.` : failed;
  return { status, inside_threshold: OVERWHELMING_INSIDE_SHARE, node_count: nodeCount, node_count_total: inputs.nodes.length, inside_count: inside,
    inside_share: nodeCount ? inside / nodeCount : null, outside_unprojectable_count: assessed.reduce((sum, v) => sum + v.outside_unprojectable_count, 0),
    levels_without_usable_polygons: unassessed, levels_with_nodes_unassessed: unassessedWithNodes, nodes_unassessed: nodesUnassessed, reason,
    levels: Object.fromEntries(perLevel) };
}

export function nearestPointOnSegment(point: Point2, a: Point2, b: Point2): Point2 {
  const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2));
  return [a[0] + t * dx, a[1] + t * dy];
}

/** Node classes for the outside-node diagnostic. 0 is a plain corridor node; 1/2/3 are the single direction code of a cross-level link; 4 mixes codes. */
export const NODE_CLASS = { CORRIDOR: 0, FLOOR_TRANSITION_FORWARD_ONLY: 1, FLOOR_TRANSITION_REVERSE_ONLY: 2, FLOOR_TRANSITION_BIDIRECTIONAL: 3, FLOOR_TRANSITION_MIXED: 4 } as const;

/**
 * Classify nodes by edge structure only: a node is a floor-transition end when it is incident to a link whose endpoints sit
 * on different levels, or to a link on one level that carries a non-zero dz. A same-level dz of exactly 0 is a corridor
 * link, not a transition. The source's `d` is a direction (1 forward, 2 reverse, 3 both), not a device type;
 * v5_nav.json carries no stair/lift/escalator field, so the device stays UNKNOWN.
 */
export function classifyNodes(nodes: readonly { sourceId: number; levelId: number }[], links: readonly S03Link[]): Map<number, number> {
  const levelOf = new Map(nodes.map(node => [node.sourceId, node.levelId])), directions = new Map<number, Set<number>>();
  for (const link of links) {
    const from = levelOf.get(link.n1), to = levelOf.get(link.n2);
    if (from === undefined || to === undefined) continue;
    const transition = from !== to || link.dz !== null && link.dz !== 0;
    if (!transition) continue;
    for (const id of [link.n1, link.n2]) directions.set(id, (directions.get(id) ?? new Set<number>()).add(link.direction));
  }
  const classes = new Map<number, number>();
  for (const node of nodes) {
    const codes = directions.get(node.sourceId);
    classes.set(node.sourceId, !codes || codes.size === 0 ? NODE_CLASS.CORRIDOR : codes.size > 1 ? NODE_CLASS.FLOOR_TRANSITION_MIXED : [...codes][0]!);
  }
  return classes;
}

/**
 * Unit directions from each node to its nearest edge point: mean vector, resultant length in [0,1], circular spread and an
 * 8-sector histogram (0 E, 1 NE, 2 N, 3 NW, 4 W, 5 SW, 6 S, 7 SE). Bearings are angles, not positions: both are given,
 * `ccw_from_east` is what `Math.atan2(north, east)` returns and the compass bearing is clockwise from north.
 */
export function directionSummary(from: readonly Point2[], to: readonly Point2[]) {
  let east = 0, north = 0, count = 0;
  const sectors = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < from.length; i++) {
    const dx = to[i]![0] - from[i]![0], dy = to[i]![1] - from[i]![1], length = Math.hypot(dx, dy);
    if (length === 0) continue;
    east += dx / length; north += dy / length; count++;
    sectors[Math.round((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360 / 45) % 8]!++;
  }
  const meanEast = count ? east / count : null, meanNorth = count ? north / count : null;
  // R is 1 when every direction agrees; then the spread is 0 and the bearing is that single direction.
  const resultant = meanEast === null || meanNorth === null ? null : Math.min(1, Math.hypot(meanEast, meanNorth));
  const hasDirection = resultant !== null && resultant > 0;
  const ccw = hasDirection ? (Math.atan2(meanNorth!, meanEast!) * 180 / Math.PI + 360) % 360 : null;
  return { count, mean_vector_east: meanEast, mean_vector_north: meanNorth, mean_resultant_length: resultant,
    circular_spread_deg: resultant === null || resultant === 0 ? null : Math.sqrt(-2 * Math.log(resultant)) * 180 / Math.PI,
    mean_bearing_deg_ccw_from_east: ccw, mean_bearing_deg_compass: ccw === null ? null : (90 - ccw + 360) % 360, sectors };
}

/** Mean, population SD and RMS radius of ENU points. Empty input yields nulls, never a fabricated value. */
function positionStats(points: readonly Point2[]) {
  if (!points.length) return { count: 0, mean_east_m: null, mean_north_m: null, sd_east_m: null, sd_north_m: null, rms_radius_m: null };
  const meanEast = points.reduce((sum, p) => sum + p[0], 0) / points.length, meanNorth = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const sdEast = Math.sqrt(points.reduce((sum, p) => sum + (p[0] - meanEast) ** 2, 0) / points.length);
  const sdNorth = Math.sqrt(points.reduce((sum, p) => sum + (p[1] - meanNorth) ** 2, 0) / points.length);
  return { count: points.length, mean_east_m: meanEast, mean_north_m: meanNorth, sd_east_m: sdEast, sd_north_m: sdNorth, rms_radius_m: Math.hypot(sdEast, sdNorth) };
}

/**
 * Diagnostic only: explains the nodes that fall outside their level's polygons. Mirrors Check A's containment rule but never
 * feeds back into it. The offset variant subtracts Check B's mean S03-minus-E27 vector from every projected node and is
 * labelled as not adopted.
 *
 * Absolute ENU means locate nodes, so they stay in the private provenance (`private_levels`), never in the public receipt.
 * The public per-level summary is suppressed below OUTSIDE_SUPPRESSION_MIN_NODES outside nodes, where a spread or a
 * direction histogram would describe one or two identifiable positions.
 */
export interface OutsideNodeLevelDetail {
  classes_baseline: number[]; classes_outside: number[];
  position_enu: { count: number; mean_east_m: number | null; mean_north_m: number | null; sd_east_m: number | null; sd_north_m: number | null; rms_radius_m: number | null };
  directions: ReturnType<typeof directionSummary>;
}
export interface OutsideNodeLevelPublic {
  node_count: number; outside_node_count: number; suppressed?: string;
  classes_baseline?: number[]; classes_outside?: number[];
  position_enu?: { count: number; sd_east_m: number | null; sd_north_m: number | null; rms_radius_m: number | null };
  directions?: ReturnType<typeof directionSummary>;
}
export function outsideNodeDiagnostic(inputs: S03Inputs, project: Project, offset: { east: number; north: number } | null = null) {
  const classes = classifyNodes(inputs.nodes, inputs.links);
  const levels: Record<string, OutsideNodeLevelPublic> = {}, privateLevels: Record<string, OutsideNodeLevelDetail> = {},
    offsetLevels: Record<string, { node_count: number; inside_count: number; inside_share: number | null }> = {};
  let offsetNodes = 0, offsetInside = 0;
  for (const level of inputs.levels) {
    const polygons = level.polygons.map(poly => poly.map(ring => ring.map(([lon, lat]) => project(lat, lon))));
    if (!polygons.length) continue;
    const bounds = polygons.map(poly => {
      const outer = poly[0]!;
      return [Math.min(...outer.map(p => p[0])), Math.min(...outer.map(p => p[1])), Math.max(...outer.map(p => p[0])), Math.max(...outer.map(p => p[1]))];
    });
    const contained = (xy: Point2): boolean => polygons.some((poly, i) => {
      const b = bounds[i]!;
      return xy[0] >= b[0]! - 1e-9 && xy[0] <= b[2]! + 1e-9 && xy[1] >= b[1]! - 1e-9 && xy[1] <= b[3]! + 1e-9 && pointInPolygon(xy, poly);
    });
    const nodes = inputs.nodes.filter(node => node.levelId === level.id);
    const baseline = [0, 0, 0, 0, 0], outsideClasses = [0, 0, 0, 0, 0];
    const outside: Array<{ xy: Point2; nearestPoint: Point2; polygonIndex: number }> = [];
    let levelOffsetNodes = 0, levelOffsetInside = 0;
    for (const node of nodes) {
      const ll = transformS03(node.native, inputs.navTransform, inputs.drawingTransform);
      // Unprojectable nodes have no ENU position; Check A counts them outside without an edge distance, and so does this diagnostic.
      if (!lonLat(ll)) continue;
      const xy = project(ll[1], ll[0]);
      baseline[classes.get(node.sourceId) ?? NODE_CLASS.CORRIDOR]!++;
      const inside = contained(xy);
      if (offset) {
        levelOffsetNodes++;
        if (contained([xy[0] - offset.east, xy[1] - offset.north])) levelOffsetInside++;
      }
      if (inside) continue;
      outsideClasses[classes.get(node.sourceId) ?? NODE_CLASS.CORRIDOR]!++;
      let nearest = { distance: Infinity, point: [Number.NaN, Number.NaN] as Point2, polygonIndex: -1 };
      for (let i = 0; i < polygons.length; i++) for (const ring of polygons[i]!) for (let j = 0; j + 1 < ring.length; j++) {
        const point = nearestPointOnSegment(xy, ring[j]!, ring[j + 1]!);
        const distance = Math.hypot(point[0] - xy[0], point[1] - xy[1]);
        if (distance < nearest.distance) nearest = { distance, point, polygonIndex: i };
      }
      outside.push({ xy, nearestPoint: nearest.point, polygonIndex: nearest.polygonIndex });
    }
    if (offset) {
      offsetNodes += levelOffsetNodes;
      offsetInside += levelOffsetInside;
      offsetLevels[level.id] = { node_count: levelOffsetNodes, inside_count: levelOffsetInside, inside_share: levelOffsetNodes ? levelOffsetInside / levelOffsetNodes : null };
    }
    if (!outside.length) continue;
    const position = positionStats(outside.map(entry => entry.xy));
    const directions = { ...directionSummary(outside.map(entry => entry.xy), outside.map(entry => entry.nearestPoint)),
      distinct_nearest_polygons: new Set(outside.map(entry => entry.polygonIndex)).size };
    privateLevels[level.id] = { classes_baseline: baseline, classes_outside: outsideClasses, position_enu: position, directions };
    // Below the suppression minimum, counts plus one reason are all the public receipt gets.
    levels[level.id] = outside.length < OUTSIDE_SUPPRESSION_MIN_NODES
      ? { node_count: nodes.length, outside_node_count: outside.length, suppressed: `fewer than ${OUTSIDE_SUPPRESSION_MIN_NODES} nodes` }
      : { node_count: nodes.length, outside_node_count: outside.length, classes_baseline: baseline, classes_outside: outsideClasses,
        position_enu: { count: position.count, sd_east_m: position.sd_east_m, sd_north_m: position.sd_north_m, rms_radius_m: position.rms_radius_m }, directions };
  }
  return {
    diagnostic_only: true,
    main_check_a_modified: false,
    classification_field: 'v5_nav.json l[].d is the direction (1 forward, 2 reverse, 3 both); floor-transition ends come from links whose n1/n2 sit on different levels or whose dz is non-zero, while a same-level dz of 0 stays a corridor link',
    device_type: 'UNKNOWN: v5_nav.json has no stair, lift or escalator field; the source specification defines d as direction only',
    class_codes: ['corridor: no incident cross-level link', 'floor-transition end: single forward-only link', 'floor-transition end: single reverse-only link', 'floor-transition end: single bidirectional link', 'floor-transition end: mixed directions'],
    // Sector labels are indexed: bare compass letters equal short source codelist values and would trip the leak guard.
    sector_codes: ['0:east', '1:north-east', '2:north', '3:north-west', '4:west', '5:south-west', '6:south', '7:south-east'],
    bearing_rule: 'Bearings are angles in degrees, not positions: mean_bearing_deg_ccw_from_east is Math.atan2(north, east) and mean_bearing_deg_compass is the same direction clockwise from north. Circular spread is sqrt(-2 ln R) in degrees.',
    public_position_rule: `Absolute ENU means for outside nodes are recorded only in the private provenance; a level's public statistics are suppressed below ${OUTSIDE_SUPPRESSION_MIN_NODES} outside nodes.`,
    levels,
    private_levels: privateLevels,
    offset_diagnostic: {
      diagnostic_offset_applied: offset !== null, adopted: false, main_check_a_modified: false,
      basis: 'Check B mean S03 minus E27 offset over reciprocal pairs within 5 m, subtracted from every projected node (east then north)',
      offset_east_m: offset?.east ?? null, offset_north_m: offset?.north ?? null,
      levels: offsetLevels, overall: offset === null ? null : { node_count: offsetNodes, inside_count: offsetInside, inside_share: offsetNodes ? offsetInside / offsetNodes : null },
      reason: offset === null ? 'No Check B mean offset available; nothing was subtracted.' : null,
    },
  };
}

export interface E27Point { id: string; xy: Point2; ordinal: number }
export interface S03Point { index: number; xy: Point2; ordinal: number; sourceId: number }
export function compatibleFloors(e27Ordinal: number, s03Ordinal: number): boolean { return e27Ordinal === s03Ordinal || e27Ordinal === 0 && s03Ordinal === 1; }
/** Mutual nearest over all compatible candidates; thresholds are applied only after reciprocity. Ties match the note's IDs. */
export function mutualNearest(e27: readonly E27Point[], s03: readonly S03Point[]) {
  const en = new Map<string, { node: S03Point; distance: number }>(), sn = new Map<number, { node: E27Point; distance: number }>();
  for (const e of e27) for (const s of s03) {
    if (!compatibleFloors(e.ordinal, s.ordinal)) continue;
    const distance = Math.hypot(s.xy[0] - e.xy[0], s.xy[1] - e.xy[1]);
    const previousS = en.get(e.id), previousE = sn.get(s.index);
    if (!previousS || distance < previousS.distance || distance === previousS.distance && s.sourceId < previousS.node.sourceId) en.set(e.id, { node: s, distance });
    if (!previousE || distance < previousE.distance || distance === previousE.distance && e.id < previousE.node.id) sn.set(s.index, { node: e, distance });
  }
  const pairs = e27.flatMap(e => {
    const match = en.get(e.id);
    if (!match || sn.get(match.node.index)?.node.id !== e.id) return [];
    return [{ e27_node_id: e.id, s03_node_index: match.node.index, distance_m: match.distance, d_east_m: match.node.xy[0] - e.xy[0], d_north_m: match.node.xy[1] - e.xy[1] }];
  }).sort((a, b) => a.e27_node_id < b.e27_node_id ? -1 : a.e27_node_id > b.e27_node_id ? 1 : 0);
  const selected = pairs.filter(p => p.distance_m <= 5);
  const meanEast = selected.length ? selected.reduce((sum, p) => sum + p.d_east_m, 0) / selected.length : null;
  const meanNorth = selected.length ? selected.reduce((sum, p) => sum + p.d_north_m, 0) / selected.length : null;
  // Numeric thresholds stay numeric: quoted numeric keys could collide with short source name strings in the leak guard.
  return { compatible_mutual_pairs_before_threshold: pairs.length, thresholds_m: [1, 2, 3, 5].map(t => ({ threshold_m: t, pair_count: selected.filter(p => p.distance_m <= t).length })),
    residuals_within_5m: residualStats(selected.map(p => p.distance_m)),
    mean_delta_within_5m: { d_east_m: meanEast, d_north_m: meanNorth, length_m: meanEast === null || meanNorth === null ? null : Math.hypot(meanEast, meanNorth), applied: false }, pairs: selected };
}

/** Canonical SHA-256 of the floor mapping Check B actually uses: floor id to comparison ordinal, sorted by id. */
export function floorMappingSha256(floors: readonly { id: string; ordinal: number }[]): string {
  const canonical = floors.map(floor => [floor.id, floor.ordinal] as const).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return sha256(JSON.stringify(canonical));
}
export interface S03DigestFacts {
  policy_version: string; tool_input_sha256: string; zip_sha256: string; station_origin_sha256: string;
  floor_mapping_sha256: string; e27_graph_sha256: string;
}
/** Receipt identity: the facts object is hashed in this key order and truncated to 20 hex characters. */
export function receiptIdentity(facts: S03DigestFacts) {
  const digest = sha256(JSON.stringify(facts)).slice(0, 20);
  return { digest_inputs: facts, digest, run_id: `transform-check-${digest}` };
}

export function guardS03Receipt<T>(receipt: T, sourceValues: ReadonlySet<string>): T {
  assertNoSourceValues(JSON.stringify(receipt), sourceValues, 'The public S03 transform receipt');
  return receipt;
}

/** Offline evidence only: the source's HOLD gate is recorded, never used as permission to publish positions. */
export async function s03TransformCheck() {
  const stored = await getStoredSource('tokyo-s03-zip'), zipBytes = await readFile(stored.path);
  assertS03Bytes(zipBytes, stored.record);
  const inputs = parseS03Members(await readZip(zipBytes, { legacyFileNameEncoding: 'shift_jis' }));
  const graphPath = 'stations/shinjuku/gteki/graph.json', stationPath = 'stations/shinjuku/gteki/station.json';
  const [graphBytes, stationBytes] = await Promise.all([readFile(join(repoRoot, graphPath)), readFile(join(repoRoot, stationPath))]);
  const station = JSON.parse(stationBytes.toString('utf8')) as { station: { origin: { lat: number; lon: number; hM: number | null; crs: string } }; floors: Array<{ id: string; ordinal: number }> };
  const origin = station.station?.origin;
  if (!origin || !finite(origin.lat) || !finite(origin.lon) || !lonLat([origin.lon, origin.lat]) || origin.crs !== 'EPSG:6668') throw new Error(`${stationPath}: invalid station geographic origin`);
  if (!Array.isArray(station.floors) || station.floors.some(f => typeof f.id !== 'string' || !finite(f.ordinal)) || new Set(station.floors.map(f => f.id)).size !== station.floors.length) throw new Error(`${stationPath}: invalid comparison floors`);
  const frame = stationEnuProjector({ lat: origin.lat, lon: origin.lon, hM: 0 });
  const project: Project = (lat, lon) => { const p = frame(lat, lon, 0); return [p[0], p[1]]; };
  const asIs = checkInternal(inputs, project), swapped = checkInternal(inputs, project, true);
  // Public defect records carry only numeric ids and the ENU gap or offset; source coordinates stay in the private store.
  const sourceDefects = sourceDefectRecords(inputs, project);
  const featuresTotal = inputs.levels.reduce((sum, l) => sum + l.featuresTotal, 0);
  const featuresUsed = inputs.levels.reduce((sum, l) => sum + l.featuresUsed, 0);
  const excludedByKind = { [UNCLOSED_RING_DEFECT]: inputs.sourceDefects.filter(d => d.kind === UNCLOSED_RING_DEFECT).length,
    [HOLE_OUTSIDE_SHELL_DEFECT]: inputs.sourceDefects.filter(d => d.kind === HOLE_OUTSIDE_SHELL_DEFECT).length };
  const excludedTotal = excludedByKind[UNCLOSED_RING_DEFECT] + excludedByKind[HOLE_OUTSIDE_SHELL_DEFECT];
  // The defect records and the per-level counters are computed independently; a disagreement means one of them is wrong.
  const countedByKind = { [UNCLOSED_RING_DEFECT]: inputs.levels.reduce((sum, l) => sum + l.featuresExcludedUnclosedRing, 0),
    [HOLE_OUTSIDE_SHELL_DEFECT]: inputs.levels.reduce((sum, l) => sum + l.featuresExcludedHoleOutsideShell, 0) };
  if (countedByKind[UNCLOSED_RING_DEFECT] !== excludedByKind[UNCLOSED_RING_DEFECT] || countedByKind[HOLE_OUTSIDE_SHELL_DEFECT] !== excludedByKind[HOLE_OUTSIDE_SHELL_DEFECT])
    throw new Error('S03 source-defect records disagree with the per-level exclusion counters');
  const coverage = { features_total: featuresTotal, features_used: featuresUsed, features_excluded_unclosed_ring: excludedByKind[UNCLOSED_RING_DEFECT],
    features_excluded_hole_outside_shell: excludedByKind[HOLE_OUTSIDE_SHELL_DEFECT],
    features_excluded: excludedTotal, features_excluded_by_kind: excludedByKind,
    non_polygon_features_excluded: inputs.levels.reduce((sum, l) => sum + l.nonPolygonFeatures, 0),
    statement: `Check A uses all polygon features except ${excludedTotal} excluded by director ruling: ${excludedByKind[UNCLOSED_RING_DEFECT]} for ${UNCLOSED_RING_DEFECT} and ${excludedByKind[HOLE_OUTSIDE_SHELL_DEFECT]} for ${HOLE_OUTSIDE_SHELL_DEFECT}.` };
  if (swapped.status !== 'FAIL') throw new Error('Swapped-order negative control unexpectedly passed the fixed containment threshold');
  const graph = JSON.parse(graphBytes.toString('utf8')) as { nodes: Array<{ id: string; floorId: string; position: { x: number; y: number } }> };
  const floorById = new Map(station.floors.map(f => [f.id, f.ordinal]));
  if (!Array.isArray(graph.nodes) || !graph.nodes.length) throw new Error(`${graphPath}: missing nodes`);
  const e27: E27Point[] = graph.nodes.map(n => {
    const ordinal = floorById.get(n.floorId);
    if (typeof n.id !== 'string' || !n.id || !finite(n.position?.x) || !finite(n.position?.y) || ordinal === undefined) throw new Error(`${graphPath}: invalid node or unknown floor`);
    return { id: n.id, xy: [n.position.x, n.position.y], ordinal };
  });
  if (new Set(e27.map(n => n.id)).size !== e27.length) throw new Error(`${graphPath}: duplicate node id`);
  const levels = new Map(inputs.levels.map(l => [l.id, l]));
  const nodes = inputs.nodes.map(n => {
    const ll = transformS03(n.native, inputs.navTransform, inputs.drawingTransform);
    if (!lonLat(ll)) throw new Error(`v5_nav.json: transformed node index ${n.index} is outside geographic range`);
    return { ...n, ll, xy: project(ll[1], ll[0]), ordinal: levels.get(n.levelId)!.ordinal };
  });
  const external = mutualNearest(e27, nodes), fingerprint = await toolFingerprint();
  // E27 node ids are source-derived literals: the per-pair list stays in the private provenance, never in the public receipt.
  const { pairs: externalPairs, ...externalSummary } = external;
  // Diagnostic only: it never feeds back into Check A, its status or any other receipt field.
  const meanDelta = external.mean_delta_within_5m;
  // Absolute ENU means stay in the private provenance; only the summary is eligible for the public receipt.
  const { private_levels: outsidePrivateLevels, ...outsideDiagnostic } = outsideNodeDiagnostic(inputs, project,
    meanDelta.d_east_m === null || meanDelta.d_north_m === null ? null : { east: meanDelta.d_east_m, north: meanDelta.d_north_m });
  const stationSha = stationOriginSha256(origin), graphSha = sha256(graphBytes);
  // Check B's floor ordinals are an input to the comparison, so their canonical hash belongs in the receipt identity.
  const { digest_inputs: digestInputs, run_id: runId } = receiptIdentity({ policy_version: S03_TRANSFORM_POLICY, tool_input_sha256: fingerprint,
    zip_sha256: stored.record.sha256, station_origin_sha256: stationSha, floor_mapping_sha256: floorMappingSha256(station.floors), e27_graph_sha256: graphSha });
  const geojsonRel = `out/s03-${runId}.geojson`, sidecarRel = `out/s03-${runId}.provenance.json`;
  const geojson = `${JSON.stringify({ type: 'FeatureCollection', gteki_role: 'evidence', navigation_use: 'NOT_FOR_ROUTING', verification: 'UNVERIFIED', crs_assumption: S03_DATUM,
    credit: S03_CREDIT, source_sha256: stored.record.sha256,
    features: nodes.map(n => ({ type: 'Feature', geometry: { type: 'Point', coordinates: n.ll }, properties: { s03_node_index: n.index, level_id: n.levelId, east_m: n.xy[0], north_m: n.xy[1], physical_height_m: null } })) })}\n`;
  const expected = { thresholds_m: [1, 2, 3, 5].map((t, i) => ({ threshold_m: t, pair_count: [4, 8, 12, 15][i]! })), median_m_rounded_2dp: 1.85 };
  const reproduced = JSON.stringify(external.thresholds_m) === JSON.stringify(expected.thresholds_m) && external.residuals_within_5m.median_m !== null && Number(external.residuals_within_5m.median_m.toFixed(2)) === expected.median_m_rounded_2dp;
  const receipt = guardS03Receipt({ ...digestInputs, run_id: runId, source_id: 'tokyo-s03-zip', source_bytes: zipBytes.length, publish_gate: stored.source.publish_gate,
    gteki_role: 'evidence', navigation_use: 'NOT_FOR_ROUTING', verification: 'UNVERIFIED', crs: S03_DATUM, datum_note: DATUM_NOTE,
    frame: { station_json_path: stationPath, e27_graph_path: graphPath, station_json_sha256: sha256(stationBytes), ellipsoid: 'GRS80', horizontal_calculation_height_m: 0, physical_height_m: null, floor_elevations_asserted: false,
      floor_mapping_rule: 'Check B ordinals come from station.json floors; floor_mapping_sha256 is the SHA-256 of [floor id, ordinal] pairs sorted by id as UTF-8 JSON.' },
    transform: { drawing_id: inputs.drawingId, level_ids: inputs.levels.map(l => l.id), nav_member_sha256: inputs.navSha256, map_member_sha256: inputs.mapSha256,
      nav_coefficients_sha256: sha256(JSON.stringify(inputs.navTransform)), drawing_coefficients_sha256: sha256(JSON.stringify(inputs.drawingTransform)), coefficient_hash_encoding: 'UTF-8 JSON array in source order',
      order: 'nav affine, then drawing affine, then horizontal ENU; no fitted correction', level_member_sha256: Object.fromEntries(inputs.levels.map(l => [l.id, l.memberSha256])) },
    source_defects: { count: excludedTotal, kinds: Object.entries(excludedByKind).filter(([, count]) => count > 0).map(([kind]) => kind),
      by_kind: excludedByKind,
      rule: 'A polygon feature is excluded from Check A, whole, on either of two director rulings: any of its rings has a first position different from its last, comparing the complete positions including an optional third value; or one of its hole rings lies wholly outside its shell, that is at least one hole vertex is outside while no hole edge crosses the shell, runs along it or leaves it. Rings are never closed, clipped, repaired, dropped or otherwise modified, and no vertex is moved.',
      endpoint_gap_rule: 'Horizontal ENU distance between the first and last ring positions, using the same station projector as Check A.',
      hole_offset_rule: 'Horizontal ENU distance from the worst offending hole vertex to the nearest point of its shell, using the same station projector as Check A.',
      topology: { rings_checked: inputs.topology.rings_checked, rings_skipped_large: inputs.topology.rings_skipped_large, hole_shell_touches: inputs.topology.hole_shell_touches,
        max_vertices: SELF_INTERSECTION_MAX_VERTICES,
        rule: `Every ring of every feature is checked before any exclusion decision, up to ${SELF_INTERSECTION_MAX_VERTICES} vertices: a proper segment crossing, a collinear overlap, or any contact between two non-adjacent edges makes the ring non-simple and fails the whole run closed, on an excluded feature too. Larger rings are counted in rings_skipped_large and not checked. Hole rings are tested against their shell edge by edge, within the same vertex bound: a crossing or a collinear overlap fails closed, and each hole edge is split at every shared position so that the middle of every piece is tested against the shell, because a hole edge can leave a concave shell and come back through two shared positions that both read as single points; a piece outside the shell fails closed too. A single shared position that stays inside is a valid boundary touch, counted per hole ring in hole_shell_touches. A hole or shell above the vertex bound skips this test and is counted in rings_skipped_large by its own ring verdict. rings_checked, rings_skipped_large and hole_shell_touches describe used features only.` },
      items: sourceDefects },
    internal: { as_is: asIs, swapped_order: swapped, coverage, negative_control_detected: true, invalid_coordinate_rule: 'Invalid geographic outputs count as outside and unprojectable; no edge distance is asserted for them.',
      containment_rule: 'Union of own-level polygon surfaces in horizontal ENU, including boundaries and excluding hole interiors; Point and LineString features excluded.',
      feature_exclusion_rule: 'Features with an unclosed ring, or with a hole ring wholly outside its shell, are excluded from containment entirely (no implicit closure, no clipping). A hole edge crossing its shell, running along it or leaving it is not excluded: it fails the run closed. A level left without usable polygons keeps null inside metrics and is not assessed.',
      status_rule: 'PASS needs overwhelming containment on every assessed level and overall. INCOMPLETE means the assessed part would pass but nodes remain on levels without usable polygons; FAIL means the assessed part already fails.' },
    internal_outside_diagnostic: outsideDiagnostic,
    external: { e27_node_count: e27.length, s03_node_count: nodes.length, floor_rule: 'Label-derived comparison ordinals equal, or E27 ordinal 0 with S03 ordinal 1; no source zlevel or measured elevation is used.',
      selection_rule: 'Reciprocal nearest across all compatible-floor nodes, then threshold <= 1, 2, 3, 5 m. Equal distances break by numeric S03 source id and lexicographic E27 id.', delta_direction: 'S03 minus E27', node_index_basis: 'zero-based position in v5_nav.json n array',
      pair_list_rule: 'The per-pair list, which names E27 node ids, stays in the private provenance; this receipt reports counts, residuals and the unapplied mean offset only.', ...externalSummary,
      research_comparison: { reference: 'docs/stations/shinjuku/research/2026-10-21-tokyo-terminal-join.md', expected, reproduced,
        explanation: reproduced ? 'Counts and median rounded to two decimals reproduce the note; no correction applied.' : 'Current input hashes and node populations are recorded; the note is not reproduced. No parameters or coordinates were adjusted.' } },
    outputs: { geojson: { store_path: geojsonRel, sha256: sha256(geojson), bytes: Buffer.byteLength(geojson) }, provenance: { store_path: sidecarRel } },
  }, inputs.sourceValues);
  // Validate the entire public receipt before writing any output. Geometry and source IDs stay in the private store.
  await writeJson(join(getStoreRoot(), sidecarRel), { ...receipt, credit: S03_CREDIT, source_record: stored.record, source_manifest: stored.source,
    node_table: nodes.map(n => ({ index: n.index, source_id: n.sourceId, level_id: n.levelId })), check_b_pairs: externalPairs,
    // Private provenance keeps the untouched source positions each exclusion was decided on, complete tuples and an
    // optional third value included, so an unclosed-in-z ring shows its two distinct endpoints; the public receipt keeps
    // only the ENU gap or offset.
    source_defect_positions: inputs.sourceDefects.map(d => d.kind === UNCLOSED_RING_DEFECT
      ? { ...d, first: [...d.first], last: [...d.last] }
      : { ...d, vertices: d.vertices.map(vertex => [...vertex]), shell: d.shell.map(vertex => [...vertex]) }),
    // Absolute ENU means and the full floor mapping stay private; the public receipt carries only the mapping hash.
    outside_diagnostic_private_levels: outsidePrivateLevels,
    floor_mapping: station.floors.map(f => ({ id: f.id, ordinal: f.ordinal })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) });
  await writeFile(join(getStoreRoot(), geojsonRel), geojson);
  const receiptPath = `docs/gis/s03/${runId}.json`;
  await writeJson(join(repoRoot, receiptPath), receipt);
  return { receipt_path: receiptPath, ...receipt };
}
