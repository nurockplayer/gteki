import { ownValue } from './values.js';

/**
 * Strict, bounded bbox over GeoJSON geometries. A bbox is a claim of complete knowledge, so any geometry that is
 * malformed, unsupported, carries its own CRS override or exceeds the traversal budget withholds the whole bbox
 * (`bbox: null`, status `INCOMPLETE_*`). Callers must then treat every comparison as UNKNOWN, never DISJOINT.
 * Coordinate nesting is validated by geometry type, so no recursion exceeds four levels regardless of input depth.
 */
export type GeometryBboxStatus =
  | 'COMPUTED' | 'EMPTY'
  | 'INCOMPLETE_MALFORMED_GEOMETRY' | 'INCOMPLETE_LIMIT_REACHED' | 'INCOMPLETE_UNSUPPORTED_GEOMETRY' | 'INCOMPLETE_OVERRIDING_CRS';
export type GeometryBbox = {
  bbox: [number, number, number, number] | null;
  status: GeometryBboxStatus;
  positions: number;
  visits: number;
  malformed_geometries: number;
  unsupported_geometries: number;
  geometry_level_crs: boolean;
};

export const MAX_BBOX_VISITS = 1_000_000;
export const MAX_GEOMETRY_COLLECTION_DEPTH = 16;
const COORDINATE_DEPTH: Record<string, number> = { Point: 0, MultiPoint: 1, LineString: 1, Polygon: 2, MultiLineString: 2, MultiPolygon: 3 };

class LimitReached extends Error {}

export function isIncompleteBboxStatus(status: unknown): boolean {
  return typeof status === 'string' && status.startsWith('INCOMPLETE_');
}

export function geometriesBbox(geometries: unknown[], options: { maxVisits?: number; maxDepth?: number; overridingCrs?: boolean } = {}): GeometryBbox {
  const maxVisits = options.maxVisits ?? MAX_BBOX_VISITS, maxDepth = options.maxDepth ?? MAX_GEOMETRY_COLLECTION_DEPTH;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const result = { positions: 0, visits: 0, malformed_geometries: 0, unsupported_geometries: 0, geometry_level_crs: false };
  const visit = (): void => { if (++result.visits > maxVisits) throw new LimitReached('visit limit'); };

  /** Validates one nested coordinate array of exactly `depth` levels above its positions; positions are collected only while valid. */
  const walk = (value: unknown, depth: number, found: number[][]): boolean => {
    visit();
    if (!Array.isArray(value)) return false;
    if (depth === 0) {
      if (value.length < 2 || !value.every(item => typeof item === 'number' && Number.isFinite(item))) return false;
      found.push(value as number[]);
      return true;
    }
    for (const child of value) if (!walk(child, depth - 1, found)) return false;
    return true;
  };

  const geometry = (value: unknown, level: number): void => {
    visit();
    if (value === null || value === undefined) return;
    if (level > maxDepth) throw new LimitReached('geometry nesting limit');
    if (typeof value !== 'object' || Array.isArray(value)) { result.malformed_geometries++; return; }
    const record = value as Record<string, unknown>;
    if (Object.hasOwn(record, 'crs')) result.geometry_level_crs = true;
    const type = ownValue(record, 'type');
    if (typeof type !== 'string') { result.malformed_geometries++; return; }
    if (type === 'GeometryCollection') {
      const children = ownValue(record, 'geometries');
      if (!Array.isArray(children)) { result.malformed_geometries++; return; }
      for (const child of children) geometry(child, level + 1);
      return;
    }
    const depth = Object.hasOwn(COORDINATE_DEPTH, type) ? COORDINATE_DEPTH[type]! : null;
    if (depth === null) { result.unsupported_geometries++; return; }
    const found: number[][] = [];
    if (!walk(ownValue(record, 'coordinates'), depth, found)) { result.malformed_geometries++; return; }
    for (const position of found) {
      const x = position[0]!, y = position[1]!;
      result.positions++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  };

  let limited = false;
  try { for (const item of geometries) geometry(item, 0); } catch (error) { if (error instanceof LimitReached) limited = true; else throw error; }
  const status: GeometryBboxStatus = limited ? 'INCOMPLETE_LIMIT_REACHED'
    : result.malformed_geometries ? 'INCOMPLETE_MALFORMED_GEOMETRY'
    : result.unsupported_geometries ? 'INCOMPLETE_UNSUPPORTED_GEOMETRY'
    : result.geometry_level_crs || options.overridingCrs ? 'INCOMPLETE_OVERRIDING_CRS'
    : result.positions ? 'COMPUTED' : 'EMPTY';
  return { bbox: status === 'COMPUTED' ? [minX, minY, maxX, maxY] : null, status, ...result };
}

/** A feature-level `crs` member overrides the collection's CRS, so one collection-level CRS no longer describes the data. */
export function hasOverridingCrs(features: unknown[]): boolean {
  return features.some(feature => feature !== null && typeof feature === 'object' && !Array.isArray(feature) && Object.hasOwn(feature, 'crs'));
}
