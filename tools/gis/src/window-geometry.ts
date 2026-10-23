import type { Disc } from './context-window.js';

/**
 * Station-frame geometry tests for the evidence profile's window counts (`gis csv-profile`).
 * A feature counts when its geometry meets a window disc, not only when one of its vertices does:
 *  - a polyline or ring whose segment passes through a disc counts, even with both endpoints outside;
 *  - a polygon that encloses a whole disc counts (no edge is near the centre).
 * Coordinates are already projected to the station ENU frame (x east, y north, metres).
 */

export type Point = [number, number];

/** Odd-even point-in-ring test in the station frame. */
export function pointInRing(px: number, py: number, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a closed segment. */
export function distanceToSegment(px: number, py: number, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

/** False when the disc is empty; a zero-length path is a point test. */
function segmentMeetsDisc(a: Point, b: Point, d: Disc): boolean {
  return distanceToSegment(d.x, d.y, a, b) <= d.r;
}

/** Edge tests only, so polygon containment can account for every ring together. */
function pathEdgesMeetDiscs(path: readonly Point[], discs: readonly Disc[], closed: boolean): boolean {
  if (path.length === 0) return false;
  if (path.length === 1) return discs.some((d) => Math.hypot(path[0]![0] - d.x, path[0]![1] - d.y) <= d.r);
  const last = closed ? path.length : path.length - 1;
  for (let i = 0; i < last; i++) {
    const a = path[i]!, b = path[(i + 1) % path.length]!;
    for (const d of discs) if (segmentMeetsDisc(a, b, d)) return true;
  }
  return false;
}

/**
 * A polyline (open) or ring (closed) meets any disc: a vertex, or a segment crossing the disc.
 * A ring also counts when it encloses a disc centre.
 */
export function pathMeetsDiscs(path: readonly Point[], discs: readonly Disc[], closed = false): boolean {
  if (pathEdgesMeetDiscs(path, discs, closed)) return true;
  if (!closed) return false;
  // A polygon enclosing a whole disc has no edge within reach of its centre.
  return discs.some((d) => pointInRing(d.x, d.y, path));
}

/** A polygon is its outer ring plus holes; a disc is inside when it sits in an odd number of rings. */
export function polygonMeetsDiscs(rings: readonly (readonly Point[])[], discs: readonly Disc[]): boolean {
  if (rings.length === 0) return false;
  if (rings.some((ring) => pathEdgesMeetDiscs(ring, discs, true))) return true;
  return discs.some((d) => rings.filter((ring) => pointInRing(d.x, d.y, ring)).length % 2 === 1);
}

/** GeoJSON coordinate nesting, kept only when every position is a finite lon/lat pair. */
function positions(value: unknown): Point[] {
  if (!Array.isArray(value)) return [];
  const out: Point[] = [];
  for (const item of value) {
    if (Array.isArray(item) && typeof item[0] === 'number' && typeof item[1] === 'number' && Number.isFinite(item[0]) && Number.isFinite(item[1])) out.push([item[0], item[1]]);
  }
  return out;
}

export interface GeometryPaths {
  /** Point geometries and polylines; a point is a one-position path. */
  lines: Point[][];
  /** Polygon and multipolygon rings (outer first, then holes / further parts). */
  polygons: Point[][][];
}

/** Split a GeoJSON geometry into lines and polygon rings (geographic lon/lat, as declared by the file). */
export function geometryPaths(geometry: { type?: string; coordinates?: unknown } | null | undefined): GeometryPaths {
  const out: GeometryPaths = { lines: [], polygons: [] };
  const coords = geometry?.coordinates;
  switch (geometry?.type) {
    case 'Point': out.lines.push(positions([coords])); break;
    case 'MultiPoint': for (const point of positions(coords)) out.lines.push([point]); break;
    case 'LineString': out.lines.push(positions(coords)); break;
    case 'MultiLineString': for (const part of Array.isArray(coords) ? coords : []) out.lines.push(positions(part)); break;
    case 'Polygon': out.polygons.push((Array.isArray(coords) ? coords : []).map(positions)); break;
    case 'MultiPolygon': for (const poly of Array.isArray(coords) ? coords : []) out.polygons.push((Array.isArray(poly) ? poly : []).map(positions)); break;
    default: break;
  }
  return out;
}

export function pathsMeetDiscs(paths: GeometryPaths, discs: readonly Disc[], project: (lon: number, lat: number) => Point): boolean {
  const toFrame = (path: Point[]): Point[] => path.map(([lon, lat]) => project(lon, lat));
  if (paths.lines.some((line) => pathMeetsDiscs(toFrame(line), discs))) return true;
  return paths.polygons.some((rings) => polygonMeetsDiscs(rings.map(toFrame), discs));
}
