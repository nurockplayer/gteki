/** Fare/access containment from source polygons; never supplies or alters routing edges. */
import polygonClipping, {
  type MultiPolygon,
  type Polygon,
} from "polygon-clipping";
import generatedRestrictions from "./fare-restricted.generated.json" with { type: "json" };
import type { StationBundle } from "@gteki/schema";
import {
  pointInRings,
  centroid,
  railingWalls,
  type GateLine,
  type Layout,
  type Plan,
  type WallSeg,
  type XY,
} from "./layout.ts";

export interface Fence extends WallSeg {
  id: string;
  reason: "fare" | "access";
  level: string;
  signSpan?: { a: XY; b: XY };
  restrictedSpaceId?: string;
  restrictedNodeId?: string;
  closedSide?: XY;
}
export interface FareProtection {
  fences: Fence[];
  gates: GateLine[];
  removedAccess: { level: string; z: number; rings: XY[][] }[];
  restrictedConflicts: RestrictedConflict[];
  restrictionCacheHit: boolean;
}
const poly = (rings: XY[][]): Polygon =>
  rings.map((r) => r.map((p) => [p.x, p.y]));
const rings = (p: Polygon): XY[][] =>
  p.map((r) => r.map(([x, y]) => ({ x, y })));
const union = (ps: Polygon[]): MultiPolygon =>
  ps.length ? polygonClipping.union(ps[0]!, ...ps.slice(1)) : [];
/** Convert and bound each polygon once, rather than allocating rings for every 8 cm probe. */
export function containsPolygons(ps: XY[][][]) {
  const prepareRing = (ring: XY[]) => {
    const rows = new Map<number, { a: XY; b: XY }[]>();
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + ring.length - 1) % ring.length]!;
      if (a.y === b.y) continue;
      for (let y = Math.floor(Math.min(a.y, b.y) / 4); y <= Math.floor(Math.max(a.y, b.y) / 4); y++) {
        const list = rows.get(y) ?? []; list.push({ a, b }); rows.set(y, list);
      }
    }
    // The same ray-crossing formula as layout.pointInRing; only impossible edges are skipped.
    return (p: XY) => {
      let inside = false;
      for (const { a, b } of rows.get(Math.floor(p.y / 4)) ?? [])
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      return inside;
    };
  };
  const bounded = ps.map(rings => {
    const r = rings[0]!, [outer, ...holes] = rings.map(prepareRing);
    const contains = (p: XY) => !!outer?.(p) && !holes.some(test => test(p));
    return { contains, x0: Math.min(...r.map(p => p.x)), x1: Math.max(...r.map(p => p.x)),
      y0: Math.min(...r.map(p => p.y)), y1: Math.max(...r.map(p => p.y)) };
  });
  const cells = new Map<string, typeof bounded>();
  for (const b of bounded) for (let x = Math.floor(b.x0 / 8); x <= Math.floor(b.x1 / 8); x++)
    for (let y = Math.floor(b.y0 / 8); y <= Math.floor(b.y1 / 8); y++) {
      const key = `${x},${y}`, list = cells.get(key) ?? [];
      list.push(b); cells.set(key, list);
    }
  let last = "", candidates: typeof bounded = [];
  return (p: XY) => {
    const key = `${Math.floor(p.x / 8)},${Math.floor(p.y / 8)}`;
    if (key !== last) { last = key; candidates = cells.get(key) ?? []; }
    return candidates.some(b => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1 && b.contains(p));
  };
}
function distance(p: XY, a: XY, b: XY) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

export const VERIFIED_CORRIDOR_M = .32;
export const RESTRICTED_ALIGNMENT_M = .015;
export interface VerifiedFloorSegment { edgeId: string; floor: string; z: number; a: XY; b: XY }
export interface RestrictedConflict { spaceId: string; edgeId: string; floor: string; overlapLengthM: number; maxEdgeDepthM: number }
export interface RestrictedRegion {
  spaceId: string; floor: string; z: number; source: XY[][];
  /** R minus the 0.32 m verified corridor; physical panels inset 10 mm within their width. */
  remainder: XY[][][]; barrier: XY[][][]; paths: VerifiedFloorSegment[];
}
function nearPoint(p: XY, a: XY, b: XY): XY {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return { x: a.x + dx * t, y: a.y + dy * t };
}
export function restrictedDepth(p: XY, rs: XY[][]) {
  if (!pointInRings(p, rs)) return 0;
  return Math.min(...rs.flatMap(r => r.map((a, i) => distance(p, a, r[(i + 1) % r.length]!))));
}
export function verifiedFloorSegments(layout: Layout, plan: Plan, bundle: StationBundle): VerifiedFloorSegment[] {
  const nodes = new Map(bundle.nodes.map(n => [n.id, n])), out: VerifiedFloorSegment[] = [];
  for (const edge of bundle.edges) {
    if (edge.verification !== "verified") continue;
    const from = nodes.get(edge.from)!, to = nodes.get(edge.to)!;
    const points = edge.geometry?.length ? edge.geometry : [from.position, to.position], lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
    const za = layout.nodeZ.get(from.id)!, zb = layout.nodeZ.get(to.id)!;
    for (const level of plan.levels) {
      if (from.floorId !== level.floorId && to.floorId !== level.floorId) continue;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!, b = points[i]!, dz = zb - za, total = lengths.at(-1) || 1;
        const z0 = za + dz * lengths[i - 1]! / total, z1 = za + dz * lengths[i]! / total;
        // A floor return spans [floor-.05, floor+1.15]. Retain the verified
        // polyline wherever either walker's body overlaps it, including stair/lift
        // approaches. This is collision clearance, not a network-strip exception.
        const bottom = level.renderElevationM - 1.75, top = level.renderElevationM + .95;
        let lo = 0, hi = 1;
        if (Math.abs(z1 - z0) < 1e-9) { if (z0 < bottom || z0 > top) continue; }
        else {
          const t0 = (bottom - z0) / (z1 - z0), t1 = (top - z0) / (z1 - z0);
          lo = Math.max(0, Math.min(t0, t1)); hi = Math.min(1, Math.max(t0, t1)); if (lo > hi) continue;
        }
        out.push({ edgeId: edge.id, floor: level.label, z: level.renderElevationM,
          a: { x: a.x + (b.x - a.x) * lo, y: a.y + (b.y - a.y) * lo }, b: { x: a.x + (b.x - a.x) * hi, y: a.y + (b.y - a.y) * hi } });
      }
    }
  }
  return out;
}
function capsule(a: XY, b: XY, radius: number, steps = 32): Polygon {
  const angle = Math.atan2(b.y - a.y, b.x - a.x), pts: [number, number][] = [];
  for (const [p, start] of [[b, angle - Math.PI / 2], [a, angle + Math.PI / 2]] as const)
    for (let i = 0; i <= steps; i++) { const t = start + Math.PI * i / steps; pts.push([Math.round((p.x + radius * Math.cos(t)) * 1e8) / 1e8, Math.round((p.y + radius * Math.sin(t)) * 1e8) / 1e8]); }
  pts.push(pts[0]!); return [pts];
}
function cuts(a: XY, b: XY, rs: XY[][]) {
  const dx = b.x - a.x, dy = b.y - a.y, out = [0, 1];
  for (const r of rs) for (let i = 0; i < r.length; i++) {
    const p = r[i]!, q = r[(i + 1) % r.length]!, ex = q.x - p.x, ey = q.y - p.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / den, u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) out.push(t);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}
/** Exact upper envelope of the nearest-boundary squared-distance quadratics along a line. */
function segmentConflict(a: XY, b: XY, rs: XY[][]) {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), at = (t: number) => ({ x: a.x + dx * t, y: a.y + dy * t });
  const edges = rs.flatMap(r => r.map((p, i) => ({ p, q: r[(i + 1) % r.length]! }))).filter(e => Math.hypot(e.q.x - e.p.x, e.q.y - e.p.y) > 1e-10);
  let insideLength = 0, maximum = 0;
  const boundary = cuts(a, b, rs);
  for (let k = 1; k < boundary.length; k++) {
    const lo = boundary[k - 1]!, hi = boundary[k]!;
    if (!pointInRings(at((lo + hi) / 2), rs)) continue;
    insideLength += length * (hi - lo);
    const breaks = [lo, hi];
    for (const { p, q } of edges) {
      const ex = q.x - p.x, ey = q.y - p.y, n = ex * ex + ey * ey, v = dx * ex + dy * ey;
      if (Math.abs(v) < 1e-15) continue;
      const d = (a.x - p.x) * ex + (a.y - p.y) * ey;
      for (const t of [-d / v, (n - d) / v]) if (t > lo && t < hi) breaks.push(t);
    }
    breaks.sort((a, b) => a - b);
    for (let j = 1; j < breaks.length; j++) {
      const l = breaks[j - 1]!, h = breaks[j]!, mid = at((l + h) / 2);
      const quadratics = edges.map(({ p, q }) => {
        const ex = q.x - p.x, ey = q.y - p.y, n = ex * ex + ey * ey;
        const projection = ((mid.x - p.x) * ex + (mid.y - p.y) * ey) / n;
        if (projection <= 0 || projection >= 1) {
          const v = projection <= 0 ? p : q, x = a.x - v.x, y = a.y - v.y;
          return [dx * dx + dy * dy, 2 * (x * dx + y * dy), x * x + y * y];
        }
        const c = (a.x - p.x) * ey - (a.y - p.y) * ex, d = dx * ey - dy * ex;
        return [d * d / n, 2 * c * d / n, c * c / n];
      });
      const candidates = [l, h];
      for (let u = 0; u < quadratics.length; u++) for (let v = u + 1; v < quadratics.length; v++) {
        const qa = quadratics[u]!, qb = quadratics[v]!, A = qa[0]! - qb[0]!, B = qa[1]! - qb[1]!, C = qa[2]! - qb[2]!;
        if (Math.abs(A) < 1e-12) { if (Math.abs(B) > 1e-12) candidates.push(-C / B); }
        else { const disc = B * B - 4 * A * C; if (disc >= 0) candidates.push((-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)); }
      }
      for (const t of candidates) if (t >= l - 1e-12 && t <= h + 1e-12) maximum = Math.max(maximum, restrictedDepth(at(Math.max(l, Math.min(h, t))), rs));
    }
  }
  return { insideLength, maximum };
}
type RestrictedAccess = { regions: RestrictedRegion[]; conflicts: RestrictedConflict[]; segments: VerifiedFloorSegment[] };
const accessByLayout = new WeakMap<Layout, RestrictedAccess | (() => RestrictedAccess)>();
/** A structural copy of an already-protected layout (see build-cache.ts) re-derives its restricted
 * access lazily, exactly as a generated-table hit does. */
export function adoptRestrictedAccess(layout: Layout, plan: Plan, bundle: StationBundle) {
  accessByLayout.set(layout, () => deriveRestrictedAccess(layout, plan, bundle));
}
export const derivedRestrictedAccess = (layout: Layout) => {
  const value = accessByLayout.get(layout);
  if (typeof value !== "function") return value;
  const result = value(); accessByLayout.set(layout, result); return result;
};
export interface RestrictedGeometry { inputKey: string; fences: Fence[]; conflicts: RestrictedConflict[] }
const HASH_INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const HASH_ROUND = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0xfc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x6ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
/** Synchronous SHA-256 of the complete cache input; checked against Node crypto. */
export function restrictionDigest(input: string) {
  const bytes = new TextEncoder().encode(input), length = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(length); padded.set(bytes); padded[bytes.length] = 128;
  const view = new DataView(padded.buffer); view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000)); view.setUint32(length - 4, bytes.length << 3);
  const state = new Uint32Array(HASH_INITIAL), words = new Uint32Array(64);
  const rotate = (n: number, bits: number) => (n >>> bits) | (n << (32 - bits));
  for (let block = 0; block < length; block += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15]!, b = words[i - 2]!;
      words[i] = words[i - 16]! + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + words[i - 7]! + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10));
    }
    let a = state[0]!, b = state[1]!, c = state[2]!, d = state[3]!, e = state[4]!, f = state[5]!, g = state[6]!, h = state[7]!;
    for (let i = 0; i < 64; i++) {
      const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + HASH_ROUND[i]! + words[i]!) >>> 0;
      const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + first) >>> 0; d = c; c = b; b = a; a = (first + second) >>> 0;
    }
    for (const [i, v] of [a, b, c, d, e, f, g, h].entries()) state[i] = state[i]! + v;
  }
  return Array.from(state, n => n.toString(16).padStart(8, "0")).join("");
}
export function restrictedInputKey(layout: Layout, plan: Plan, bundle: StationBundle, base: Fence[]) {
  // Digest the complete source/graph/layout input; CI compares the fresh derivation
  // and separately requires review of every change to the conflict table.
  return restrictionDigest(JSON.stringify(["restricted-boundary-v16", VERIFIED_CORRIDOR_M, RESTRICTED_ALIGNMENT_M,
    plan.levels.map(l => [l.label, l.renderElevationM, l.spaces.filter(s => s.restricted)]),
    bundle.edges.filter(e => e.verification === "verified"),
    bundle.nodes.map(n => [n.id, n.position]), [...layout.nodeZ], layout.gates,
    verifiedFloorSegments(layout, plan, bundle),
    layout.levels.map(l => [l.label, l.z, l.slabs.map(s => [s.z, s.rings]), l.walls]),
    [layout.pads, layout.linkStrips, layout.streetPads].map(ss => ss.map(s => [s.z, s.rings])),
    layout.runWalls, railingWalls(layout), base]));
}
export function deriveRestrictedAccess(layout: Layout, plan: Plan, bundle: StationBundle, radius = VERIFIED_CORRIDOR_M) {
  const segments = verifiedFloorSegments(layout, plan, bundle), conflicts: RestrictedConflict[] = [], regions: RestrictedRegion[] = [];
  for (const level of plan.levels) for (const space of level.spaces.filter(s => s.restricted)) {
    const outer = space.rings[0]!, x0 = Math.min(...outer.map(p => p.x)), x1 = Math.max(...outer.map(p => p.x));
    const y0 = Math.min(...outer.map(p => p.y)), y1 = Math.max(...outer.map(p => p.y));
    const nearby = segments.filter(e => e.floor === level.label && Math.max(e.a.x, e.b.x) + radius >= x0 && Math.min(e.a.x, e.b.x) - radius <= x1 && Math.max(e.a.y, e.b.y) + radius >= y0 && Math.min(e.a.y, e.b.y) - radius <= y1)
      .filter(e => {
        if (pointInRings(e.a, space.rings) || pointInRings(e.b, space.rings) || cuts(e.a, e.b, space.rings).length > 2) return true;
        return space.rings.some(r => r.some((p, i) => Math.min(distance(e.a, p, r[(i + 1) % r.length]!), distance(e.b, p, r[(i + 1) % r.length]!), distance(p, e.a, e.b)) < radius));
      });
    for (const edgeId of [...new Set(nearby.map(e => e.edgeId))]) {
      const values = nearby.filter(e => e.edgeId === edgeId).map(e => segmentConflict(e.a, e.b, space.rings));
      conflicts.push({ spaceId: space.id, edgeId, floor: level.label,
        overlapLengthM: Math.round(values.reduce((n, v) => n + v.insideLength, 0) * 1e6) / 1e6,
        maxEdgeDepthM: Math.max(0, Math.ceil(Math.max(...values.map(v => v.maximum)) * 1e6 - 1e-8) / 1e6) });
    }
    const subtract = (r: number) => nearby.length ? polygonClipping.difference(poly(space.rings), union(nearby.map(e => capsule(e.a, e.b, r, r === radius ? 32 : 16)))).map(rings) : [space.rings];
    regions.push({ spaceId: space.id, floor: level.label, z: level.renderElevationM, source: space.rings, paths: nearby, remainder: subtract(radius), barrier: subtract(radius - .01) });
  }
  conflicts.sort((a, b) => a.floor.localeCompare(b.floor) || a.spaceId.localeCompare(b.spaceId) || a.edgeId.localeCompare(b.edgeId));
  const result = { regions, conflicts, segments };
  accessByLayout.set(layout, result);
  return result;
}
/** Local centreline depth, not a whole-room or whole-edge blanket exception. */
export function restrictionAt(p: XY, region: RestrictedRegion, radius = VERIFIED_CORRIDOR_M) {
  const depth = restrictedDepth(p, region.source);
  if (depth === 0) return { inside: false, depth: 0, permitted: true, corridor: false, edgeDepth: 0 };
  const paths = region.paths.filter(e => distance(p, e.a, e.b) <= radius + 1e-9);
  const edgeDepth = Math.max(0, ...paths.map(e => restrictedDepth(nearPoint(p, e.a, e.b), region.source)));
  return { inside: true, depth, corridor: paths.length > 0, edgeDepth,
    permitted: depth <= RESTRICTED_ALIGNMENT_M + (paths.length ? edgeDepth : 0) + 1e-7 };
}

/** Trim ONLY procedural elevator-envelope fill to the independently mapped footprint.
 * The surrounding render-only enclosure may remain; its floor must not imply public access.
 * Both WalkWorld and explorer proxies are built later from these same clipped pads.
 */
export function protectFareAndAccess(
  layout: Layout,
  plan: Plan,
  bundle: StationBundle,
  options: {
    recomputeRestricted?: boolean;
    onRestricted?: (geometry: RestrictedGeometry) => void;
    /** Default true: confirm the generated table was derived from exactly this input before using it.
     * `false` skips only that fingerprint (a pure check: its value never reaches the geometry, see
     * scene-digest.test.ts). Shipped code keeps it true: the root test suite is not run in CI yet (pending
     * root CI), so nothing else would catch a stale table. */
    verifyGeneratedInput?: boolean;
  } = {},
): FareProtection {
  const fences: Fence[] = [],
    removedAccess: FareProtection["removedAccess"] = [];
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const paths = bundle.edges
    .filter((e) => e.verification === "verified")
    .flatMap((e) => {
      const pts = e.geometry?.length
        ? e.geometry
        : [nodes.get(e.from)!.position, nodes.get(e.to)!.position];
      const za = layout.nodeZ.get(e.from)!,
        zb = layout.nodeZ.get(e.to)!,
        lengths = [0];
      for (let i = 1; i < pts.length; i++)
        lengths.push(
          lengths[i - 1]! +
            Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y),
        );
      return pts.slice(1).map((b, i) => ({
        mode: e.mode,
        a: pts[i]!,
        b,
        x0: Math.min(pts[i]!.x, b.x) - .44, x1: Math.max(pts[i]!.x, b.x) + .44,
        y0: Math.min(pts[i]!.y, b.y) - .44, y1: Math.max(pts[i]!.y, b.y) + .44,
        za: za + ((zb - za) * lengths[i]!) / (lengths.at(-1) || 1),
        zb: za + ((zb - za) * lengths[i + 1]!) / (lengths.at(-1) || 1),
      }));
    });
  const routeClear = (p: XY, z: number, radius = .44) =>
    paths.some((e) => {
      if (p.x < e.x0 || p.x > e.x1 || p.y < e.y0 || p.y > e.y1 ||
          z < Math.min(e.za, e.zb) - 0.95 || z > Math.max(e.za, e.zb) + 1.75)
        return false;
      const dx = e.b.x - e.a.x,
        dy = e.b.y - e.a.y,
        t = Math.max(
          0,
          Math.min(
            1,
            ((p.x - e.a.x) * dx + (p.y - e.a.y) * dy) /
              (dx * dx + dy * dy || 1),
          ),
        );
      const feet = e.za + (e.zb - e.za) * t;
      return (
        (feet >= z - 1.75 && feet <= z + 0.95) &&
        distance(p, e.a, e.b) < radius
      );
    });
  for (const lv of layout.levels) {
    const source = plan.levels.find((s) => s.floorId === lv.floorId);
    const envelopes = layout.pads.filter(
      p => p.spaceId.startsWith("elevator-envelope:") && Math.abs(p.z - lv.z) < .02,
    );
    // Access containment only needs the footprint near procedural elevator fill.
    // Unioning the whole station (including floors with no envelope) dominated start-up.
    const overlapsEnvelope = (rs: XY[][]) => {
      const r = rs[0]!, x0 = Math.min(...r.map(p => p.x)), x1 = Math.max(...r.map(p => p.x));
      const y0 = Math.min(...r.map(p => p.y)), y1 = Math.max(...r.map(p => p.y));
      return envelopes.some(e => {
        const a = e.rings[0]!;
        return Math.max(...a.map(p => p.x)) >= x0 && Math.min(...a.map(p => p.x)) <= x1 &&
          Math.max(...a.map(p => p.y)) >= y0 && Math.min(...a.map(p => p.y)) <= y1;
      });
    };
    const candidates = [
      ...(source?.spaces.filter(s => !s.restricted).map(s => s.rings) ?? []),
      ...[...layout.linkStrips, ...layout.pads.filter(p => p.spaceId.startsWith("pad:")), ...layout.streetPads]
        .filter(p => Math.abs(p.z - lv.z) < .02).map(p => p.rings),
    ].filter(overlapsEnvelope);
    const footprint = union(candidates.map(poly));
    const removed = union(
      envelopes.flatMap((p) =>
        polygonClipping.difference(poly(p.rings), footprint),
      ),
    );
    for (const r of removed)
      removedAccess.push({ level: lv.label, z: lv.z, rings: rings(r) });
    layout.pads = layout.pads.flatMap((p) =>
      envelopes.includes(p)
        ? polygonClipping
            .intersection(poly(p.rings), footprint)
            .map((r, i) => ({
              ...p,
              spaceId: `${p.spaceId}:mapped${i}`,
              rings: rings(r),
            }))
        : [p],
    );

    const floor = [
      ...lv.slabs,
      ...layout.pads.filter((p) => Math.abs(p.z - lv.z) < 0.02),
      ...layout.linkStrips.filter((p) => Math.abs(p.z - lv.z) < 0.02),
    ];
    const onFloor = containsPolygons(floor.map(s => s.rings));
    // Point membership needs no union. A paid perimeter matters only on mixed-fare floors.
    const free = source?.spaces.filter(s => !s.restricted && s.toll === "free").map(s => s.rings) ?? [];
    const paid = free.length ? union(source?.spaces.filter(s => !s.restricted && s.toll === "paid").map(s => poly(s.rings)) ?? []) : [];
    const inFree = containsPolygons(free);
    const inRemoved = containsPolygons(removed.map(rings));
    const walls = lv.walls.filter(w => lv.z + 1.7 >= w.zMin && lv.z + .3 <= w.zMax &&
      (w.bodyMin === undefined || lv.z >= w.bodyMin) && (w.bodyMax === undefined || lv.z <= w.bodyMax))
      .map(w => ({ w, x0: Math.min(w.a.x, w.b.x) - .07, x1: Math.max(w.a.x, w.b.x) + .07,
        y0: Math.min(w.a.y, w.b.y) - .07, y1: Math.max(w.a.y, w.b.y) + .07 }));
    const wallRows = new Map<number, typeof walls>();
    for (const b of walls) for (let y = Math.floor(b.y0 / 4); y <= Math.floor(b.y1 / 4); y++) {
      const row = wallRows.get(y) ?? []; row.push(b); wallRows.set(y, row);
    }
    const existingWall = (p: XY) => (wallRows.get(Math.floor(p.y / 4)) ?? []).some(b =>
      p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1 && distance(p, b.w.a, b.w.b) < .07);
    const addBoundary = (
      ps: MultiPolygon,
      reason: Fence["reason"],
      keep: (p: XY, n: XY) => boolean,
    ) => {
      const margin = reason === "fare" ? .5 : .05;
      const relevant = (reason === "fare" ? free : removed.map(rings)).map(rs => {
        const r = rs[0]!;
        return { x0: Math.min(...r.map(p => p.x)) - margin, x1: Math.max(...r.map(p => p.x)) + margin,
          y0: Math.min(...r.map(p => p.y)) - margin, y1: Math.max(...r.map(p => p.y)) + margin };
      });
      for (const polygon of ps)
        for (const ring of polygon)
          for (let j = 1; j < ring.length; j++) {
            const a = { x: ring[j - 1]![0], y: ring[j - 1]![1] },
              b = { x: ring[j]![0], y: ring[j]![1] },
              dx = b.x - a.x,
              dy = b.y - a.y,
              len = Math.hypot(dx, dy);
            if (len < 1e-5) continue;
            const normal = { x: (-dy / len) * 0.04, y: (dx / len) * 0.04 },
              steps = Math.max(1, Math.ceil(len / 0.08));
            let start: XY | null = null;
            const at = (t: number) => ({ x: a.x + dx * t, y: a.y + dy * t });
            const flush = (end: XY) => {
              if (start && Math.hypot(end.x - start.x, end.y - start.y) > 0.02) {
                fences.push({
                  id: `${reason}:${lv.label}:${fences.length}`,
                  reason,
                  level: lv.label,
                  a: start,
                  b: end,
                  zMin: lv.z - 0.05,
                  zMax: lv.z + 1.15,
                  kind: "wall",
                  side: 1,
                });
              }
              start = null;
            };
            // Preserve the original 8 cm probe positions, but visit only edge
            // intervals that could touch an opposite fare polygon / removed fill.
            const windows = relevant.flatMap(box => {
              let lo = 0, hi = 1;
              for (const [v, d, min, max] of [[a.x, dx, box.x0, box.x1], [a.y, dy, box.y0, box.y1]]) {
                if (Math.abs(d!) < 1e-12) { if (v! < min! || v! > max!) return []; }
                else { const u = (min! - v!) / d!, w = (max! - v!) / d!; lo = Math.max(lo, Math.min(u, w)); hi = Math.min(hi, Math.max(u, w)); }
              }
              return lo <= hi ? [[Math.max(0, Math.floor(lo * steps) - 1), Math.min(steps, Math.ceil(hi * steps) + 1)]] : [];
            }).sort((a, b) => a[0]! - b[0]!);
            const merged: number[][] = [];
            for (const w of windows) {
              const last = merged.at(-1);
              if (last && last[1]! >= w[0]!) last[1] = Math.max(last[1]!, w[1]!);
              else merged.push(w);
            }
            for (const [lo, hi] of merged) {
              for (let i = lo!; i < hi!; i++) {
                const p = at((i + 0.5) / steps);
                const yes = keep(p, normal) && !existingWall(p) && !routeClear(p, lv.z);
                if (yes && !start) start = at(i / steps);
                if (!yes && start) flush(at(i / steps));
              }
              flush(at(hi! / steps));
            }
          }
    };
    // CAD fare polygons can leave sub-step gaps (including gate-machine teeth).
    // Close those too: the walker can step between target samples across a narrow floor gap.
    addBoundary(
      paid,
      "fare",
      (p, n) =>
        [1, 4, 8, 12].some(
          (k) =>
            inFree({ x: p.x + n.x * k, y: p.y + n.y * k }) ||
            inFree({ x: p.x - n.x * k, y: p.y - n.y * k }),
        ) &&
        [1, 4, 8, 12].some((k) =>
          onFloor({ x: p.x + n.x * k, y: p.y + n.y * k }),
        ) &&
        [1, 4, 8, 12].some((k) =>
          onFloor({ x: p.x - n.x * k, y: p.y - n.y * k }),
        ),
    );
    // Only the shared border of mapped space and removed fill receives an access fence.
    addBoundary(
      footprint,
      "access",
      (p, n) =>
        (inRemoved({ x: p.x + n.x, y: p.y + n.y }) ||
          inRemoved({ x: p.x - n.x, y: p.y - n.y })) &&
        (onFloor({ x: p.x + n.x, y: p.y + n.y }) ||
          onFloor({ x: p.x - n.x, y: p.y - n.y })),
    );
  }
  // Two source links can describe the same physical gate. Draw one aisle per distinct line.
  const gates = layout.gates.filter(
    (g, i, all) =>
      all.findIndex(
        (h) =>
          Math.hypot(g.center.x - h.center.x, g.center.y - h.center.y) < 0.02 &&
          Math.abs(g.center.z - h.center.z) < 0.02,
      ) === i,
  );
  const saved = generatedRestrictions as RestrictedGeometry;
  const trusted = options.verifyGeneratedInput === false && !options.recomputeRestricted && !options.onRestricted;
  const inputKey = trusted ? saved.inputKey : restrictedInputKey(layout, plan, bundle, fences);
  if (!options.recomputeRestricted && saved.inputKey === inputKey) {
    fences.splice(0, fences.length, ...structuredClone(saved.fences));
    accessByLayout.set(layout, () => deriveRestrictedAccess(layout, plan, bundle));
    options.onRestricted?.(structuredClone(saved));
    return { fences, gates, removedAccess, restrictedConflicts: saved.conflicts, restrictionCacheHit: true };
  }
  const restricted = deriveRestrictedAccess(layout, plan, bundle);
  fences.push(...deriveRestrictedFences(layout, restricted, fences));
  closeBarrierEnds(layout, fences, gates, (a, b, z) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / .03));
    for (let i = 0; i <= steps; i++) if (routeClear({ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }, z, .3001)) return false;
    return true;
  });
  options.onRestricted?.(structuredClone({ inputKey, fences, conflicts: restricted.conflicts }));
  return { fences, gates, removedAccess, restrictedConflicts: restricted.conflicts, restrictionCacheHit: false };
}

const restrictedBoundaries = new WeakMap<Layout, { level: string; z: number; points: XY[] }[]>();
/** Pure general derivation. The generated cache is checked against this in Vitest. */
export function deriveRestrictedFences(layout: Layout, restricted: RestrictedAccess, base: Fence[]) {
  const fences: Fence[] = [], boundaries: { level: string; z: number; points: XY[] }[] = [];
  restrictedBoundaries.set(layout, boundaries);
  // Union adjacent restricted fill: internal source-space borders need no duplicate fence.
  for (const level of layout.levels) {
    const regions = restricted.regions.filter(r => r.floor === level.label);
    if (!regions.length) continue;
    const floor = [...level.slabs, ...layout.pads, ...layout.linkStrips, ...layout.streetPads].filter(s => Math.abs(s.z - level.z) < .02);
    const blocked = union(regions.flatMap(r => r.barrier.map(poly)));
    if (!blocked.length || !floor.length) continue;
    const blockers = [...level.walls, ...layout.runWalls, ...railingWalls(layout), ...base.filter(f => f.level === level.label)].filter(w => level.z + 1.7 >= w.zMin && level.z + .3 <= w.zMax &&
      (w.bodyMin === undefined || level.z >= w.bodyMin) && (w.bodyMax === undefined || level.z <= w.bodyMax));
    const wallCaps = union(blockers.map(w => capsule(w.a, w.b, .01, 8))).map(rings);
    const floorRings = floor.map(s => s.rings), onFloor = containsPolygons(floorRings), inWall = containsPolygons(wallCaps);
    const floorEdges = floorRings.flat();
    const closeToFloor = (a: XY, b: XY) => onFloor(a) || onFloor(b) || floorEdges.some(r => r.some((p, i) => {
      const q = r[(i + 1) % r.length]!;
      // A body centre can stand at a floor edge while its radius extends beyond it.
      // Retain the WHOLE boundary interval if any part is within one body radius;
      // this conservative selection never opens a short/sliver access exception.
      return Math.min(distance(a, p, q), distance(b, p, q), distance(p, a, b), distance(q, a, b)) <= VERIFIED_CORRIDOR_M || cuts(a, b, [[p, q]]).length > 2;
    }));
    const simplify = (ring: XY[]) => {
      const points = ring.slice(0, -1);
      if (points.length < 4) return ring;
      const reduce = (pts: XY[]): XY[] => {
        if (pts.length < 3) return pts;
        let max = .004, split = -1;
        for (let i = 1; i < pts.length - 1; i++) { const d = distance(pts[i]!, pts[0]!, pts.at(-1)!); if (d > max) { max = d; split = i; } }
        return split < 0 ? [pts[0]!, pts.at(-1)!] : [...reduce(pts.slice(0, split + 1)).slice(0, -1), ...reduce(pts.slice(split))];
      };
      const anchor = points.reduce((best, p, i) => Math.hypot(p.x - points[0]!.x, p.y - points[0]!.y) > Math.hypot(points[best]!.x - points[0]!.x, points[best]!.y - points[0]!.y) ? i : best, 1);
      return [...reduce(points.slice(0, anchor + 1)).slice(0, -1), ...reduce([...points.slice(anchor), points[0]!])];
    };
    const cutEdges = wallCaps.flat();
    for (const rs of blocked.map(rings)) for (const raw of rs) {
      const ring = simplify(raw);
      boundaries.push({ level: level.label, z: level.z, points: ring });
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]!, b = ring[i]!, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
        if (length < 1e-8) continue;
        const divisions = cuts(a, b, cutEdges);
        for (let j = 1; j < divisions.length; j++) {
          const lo = divisions[j - 1]!, hi = divisions[j]!, middle = (lo + hi) / 2;
          const mid = { x: a.x + dx * middle, y: a.y + dy * middle };
          const from = { x: a.x + dx * lo, y: a.y + dy * lo }, to = { x: a.x + dx * hi, y: a.y + dy * hi };
          if (inWall(mid) || !closeToFloor(from, to)) continue;
          if (Math.hypot(to.x - from.x, to.y - from.y) < 1e-8) continue;
          const candidates = [-.01, .01, -.001, .001, -.00001, .00001].map(d => ({ x: mid.x - dy / length * d, y: mid.y + dx / length * d }));
          const source = regions.map(r => ({ r, p: candidates.find(p => pointInRings(p, r.source)) })).find(v => v.p);
          fences.push({ id: `restricted:${source?.r.spaceId ?? level.label}:${base.length + fences.length}`, restrictedSpaceId: source?.r.spaceId,
            reason: "access", level: level.label, a: from, b: to, closedSide: source?.p, zMin: level.z - .05, zMax: level.z + 1.15, side: 1, kind: "wall" });
        }
      }
    }
    // Continue corridor sides one body radius beyond the source wall. Without
    // these returns a circle can enter the thin wall opening diagonally before
    // touching a panel, despite every endpoint being closed.
    const touched = regions.filter(r => r.paths.length);
    if (!touched.length) continue;
    const sourceRings = touched.map(r => r.source), inSource = containsPolygons(sourceRings);
    const reach = VERIFIED_CORRIDOR_M / Math.cos(Math.PI / 16);
    const expanded = union(touched.flatMap(r => [poly(r.source), ...r.source.flatMap(rs => rs.flatMap((p, i) => {
      const q = rs[(i + 1) % rs.length]!;
      return Math.hypot(p.x - q.x, p.y - q.y) > 1e-8 ? [capsule(p, q, reach, 8)] : [];
    }))])).map(rings);
    const inExpanded = containsPolygons(expanded);
    const corridors = union(restricted.segments.filter(p => p.floor === level.label).map(p => capsule(p.a, p.b, VERIFIED_CORRIDOR_M - .01, 16))).map(rings);
    const guardCuts = [...sourceRings.flat(), ...expanded.flat(), ...wallCaps.flat()];
    const guards: Fence[] = [];
    for (const rs of corridors) for (const raw of rs) {
      const ring = simplify(raw);
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]!, b = ring[i]!, dx = b.x - a.x, dy = b.y - a.y;
        const divisions = cuts(a, b, guardCuts);
        for (let j = 1; j < divisions.length; j++) {
          const lo = divisions[j - 1]!, hi = divisions[j]!, t = (lo + hi) / 2, mid = { x: a.x + dx * t, y: a.y + dy * t };
          const from = { x: a.x + dx * lo, y: a.y + dy * lo }, to = { x: a.x + dx * hi, y: a.y + dy * hi };
          if (inSource(mid) || !inExpanded(mid) || inWall(mid) || !closeToFloor(from, to) || Math.hypot(to.x - from.x, to.y - from.y) < 1e-8) continue;
          const source = touched.find(r => r.source.some(rs => rs.some((p, k) => distance(mid, p, rs[(k + 1) % rs.length]!) <= reach)));
          guards.push({ id: `return:${level.label}:${base.length + fences.length + guards.length}`, restrictedSpaceId: source?.spaceId,
            reason: "access", level: level.label, a: from, b: to, zMin: level.z - .05, zMax: level.z + 1.15, side: 1, kind: "wall" });
        }
      }
    }
    // A return extends an existing restricted boundary, not the unrelated far
    // side of a nearby corridor. Keep complete connected chains, never a free wing.
    const anchors = fences.filter(f => f.level === level.label && f.restrictedSpaceId);
    const touches = (g: Fence, other: Fence) => Math.min(distance(g.a, other.a, other.b), distance(g.b, other.a, other.b)) <= .020000001;
    const connected = new Set(guards.filter(g => anchors.some(f => touches(g, f))));
    let changed = true;
    while (changed) { changed = false; for (const g of guards) if (!connected.has(g) && [...connected].some(f => touches(g, f))) { connected.add(g); changed = true; } }
    fences.push(...guards.filter(g => connected.has(g)));
  }
  return fences;
}

/** Close actual centre lines, rather than relying on overlapping radius capsules.
 * Keep every verified edge clear; these are procedural joins, not additional passages.
 */
function closeBarrierEnds(layout: Layout, fences: Fence[], gates: GateLine[], clear: (a: XY, b: XY, z: number) => boolean) {
  for (const f of fences) if (f.reason === "access") f.signSpan = { a: { ...f.a }, b: { ...f.b } };
  const machines = gates.flatMap(g => gateMachines(g).map(c => ({
    a: { x: c.x - g.dir.x * .75, y: c.y - g.dir.y * .75 },
    b: { x: c.x + g.dir.x * .75, y: c.y + g.dir.y * .75 },
    zMin: g.center.z - .1, zMax: g.center.z + 1, bodyMin: g.center.z - .5,
    kind: "wall" as const, side: 1 as const,
  })));
  const walls = [...layout.levels.flatMap(l => l.walls), ...layout.runWalls, ...railingWalls(layout), ...machines];
  const nearest = (p: XY, w: WallSeg) => {
    const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
    const t = Math.max(0, Math.min(1, ((p.x - w.a.x) * dx + (p.y - w.a.y) * dy) / (dx * dx + dy * dy || 1)));
    return { x: w.a.x + dx * t, y: w.a.y + dy * t };
  };
  const blocking = (w: WallSeg, z: number) => z + 1.7 >= w.zMin && z + .3 <= w.zMax &&
    (w.bodyMin === undefined || z >= w.bodyMin) && (w.bodyMax === undefined || z <= w.bodyMax);
  const join = (p: XY, z: number, level: string, reason: Fence["reason"], self?: Fence, end?: "a" | "b", exclude?: WallSeg) => {
    const other = self && end ? self[end === "a" ? "b" : "a"] : undefined;
    const outward = (q: XY) => !other || distance(q, p, other) > 1e-5 ||
      (q.x - p.x) * (p.x - other.x) + (q.y - p.y) * (p.y - other.y) >= -1e-8;
    const extensionHit = (w: WallSeg): XY[] => {
      if (!other) return [];
      const dx = p.x - other.x, dy = p.y - other.y, ex = w.b.x - w.a.x, ey = w.b.y - w.a.y, cross = dx * ey - dy * ex;
      if (Math.abs(cross) < 1e-12) return [];
      const t = ((w.a.x - p.x) * ey - (w.a.y - p.y) * ex) / cross, u = ((w.a.x - p.x) * dy - (w.a.y - p.y) * dx) / cross;
      return t >= 0 && u >= 0 && u <= 1 ? [{ x: p.x + dx * t, y: p.y + dy * t }] : [];
    };
    const optionsAt = (radius: number) => [...walls, ...fences].filter(w => w !== self && w !== exclude && blocking(w, z) &&
      p.x >= Math.min(w.a.x, w.b.x) - radius && p.x <= Math.max(w.a.x, w.b.x) + radius &&
      p.y >= Math.min(w.a.y, w.b.y) - radius && p.y <= Math.max(w.a.y, w.b.y) + radius)
      .flatMap(w => [nearest(p, w), w.a, w.b, ...extensionHit(w)].filter(outward).map(q => ({ w, q, d: Math.hypot(p.x - q.x, p.y - q.y) })))
      .filter(v => v.d <= radius).sort((a, b) => a.d - b.d);
    const options = optionsAt(2);
    if ((options[0]?.d ?? Infinity) <= .02) {
      // Snap a safe cap to the actual joining line instead of leaving a 1 cm
      // numerical sliver. The entire adjusted segment must keep graph clearance.
      if (self && end && other && options[0]!.d > 1e-8) {
        const exact = options.find(v => v.d <= .02 && clear(other, v.q, z));
        if (exact) self[end] = { ...exact.q };
      }
      return;
    }
    const option = options.find(v => clear(p, v.q, z));
    if (!option) {
      // Continue on R' around its corner when a straight cap would cross a verified
      // corridor. Every leg remains on the source-derived boundary until a wall joins it.
      for (const boundary of restrictedBoundaries.get(layout) ?? []) {
        if (boundary.level !== level || Math.abs(boundary.z - z) > .02) continue;
        const ring = boundary.points.slice(0, -1), count = ring.length;
        for (let i = 0; i < count; i++) {
          const a = ring[i]!, b = ring[(i + 1) % count]!;
          if (distance(p, a, b) > 1e-6) continue;
          for (const direction of [-1, 1]) {
            const path: XY[] = [p];
            for (let step = 0; step < count; step++) {
              const index = direction > 0 ? (i + 1 + step) % count : (i - step + count) % count;
              const q = ring[index]!, last = path.at(-1)!;
              if (Math.hypot(q.x - last.x, q.y - last.y) < 1e-8) continue;
              if (path.length === 1 && !outward(q)) break;
              if (!clear(last, q, z)) break;
              path.push(q);
              const destinations = [...walls, ...fences].filter(w => w !== self && w !== exclude && blocking(w, z))
                .map(w => nearest(q, w)).filter(v => Math.hypot(v.x - q.x, v.y - q.y) <= 2 && Math.hypot(v.x - p.x, v.y - p.y) > .02)
                .sort((a, b) => Math.hypot(a.x - q.x, a.y - q.y) - Math.hypot(b.x - q.x, b.y - q.y));
              const destination = destinations.find(v => clear(q, v, z));
              if (!destination) continue;
              path.push(destination);
              for (let j = 1; j < path.length; j++) if (Math.hypot(path[j]!.x - path[j - 1]!.x, path[j]!.y - path[j - 1]!.y) > 1e-8)
                fences.push({ id: `join:${level}:${fences.length}`, reason, level, a: { ...path[j - 1]! }, b: { ...path[j]! }, zMin: z - .05, zMax: z + 1.15, side: 1, kind: "wall" });
              return;
            }
          }
        }
      }
      return; // The independent endpoint test rejects an unresolved join.
    }
    const { q } = option;
    if (self && end) {
      const other = self[end === "a" ? "b" : "a"], dx = p.x - other.x, dy = p.y - other.y, len = Math.hypot(dx, dy);
      const extension = ((q.x - p.x) * dx + (q.y - p.y) * dy) / len;
      const along = { x: p.x + dx / len * (extension + .015), y: p.y + dy / len * (extension + .015) };
      if (extension >= 0 && distance(along, option.w.a, option.w.b) <= .015 && clear(p, along, z)) {
        self[end] = along; return;
      }
    }
    fences.push({ id: `join:${level}:${fences.length}`, reason, level, a: { ...p }, b: { ...q },
      zMin: z - .05, zMax: z + 1.15, side: 1, kind: "wall" });
  };
  for (const f of [...fences]) for (const end of ["a", "b"] as const)
    join(f[end], f.zMin + .05, f.level, f.reason, f, end);
  let i = 0;
  for (const g of gates) for (const c of gateMachines(g)) {
    const level = layout.levels.find(l => Math.abs(l.z - g.center.z) < .02)!.label;
    join(c, g.center.z, level, "fare", undefined, undefined, machines[i++]!);
  }
}

/** End machines straddle the verified aisle. Other source-to-source boundaries are fenced. */
export function gateMachines(g: GateLine): XY[] {
  const n = { x: -g.dir.y, y: g.dir.x };
  return [-0.62, 0.62].map((d) => ({
    x: g.center.x + n.x * d,
    y: g.center.y + n.y * d,
  }));
}

/** Wording describes the closed side of this particular sign, not an inferred station rule. */
export const ACCESS_WORDING = {
  restricted: { ja: "立入制限区域", en: "Restricted area" },
  closed: { ja: "立入不可", en: "No entry" },
} as const;
export function accessSigns(protection: FareProtection, plan: Plan) {
  const used = new Set<string>();
  const signFences = protection.fences.filter(f => !f.id.startsWith("join:")).map(f => ({ ...f, ...(f.signSpan ?? {}) }));
  const signs = protection.removedAccess.flatMap(area => {
    const center = centroid(area.rings[0]!), pts = area.rings[0]!;
    const x0 = Math.min(...pts.map(p => p.x)) - .15, x1 = Math.max(...pts.map(p => p.x)) + .15;
    const y0 = Math.min(...pts.map(p => p.y)) - .15, y1 = Math.max(...pts.map(p => p.y)) + .15;
    const fence = signFences.filter(f => {
      const x = (f.a.x + f.b.x) / 2, y = (f.a.y + f.b.y) / 2;
      return f.reason === "access" && !f.restrictedSpaceId && f.level === area.level && Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y) >= .7 && x >= x0 && x <= x1 && y >= y0 && y <= y1;
    }).sort((a, b) => {
      const distance = (f: Fence) => Math.hypot((f.a.x + f.b.x) / 2 - center.x, (f.a.y + f.b.y) / 2 - center.y);
      return distance(a) - distance(b);
    })[0];
    if (!fence || used.has(fence.id)) return [];
    used.add(fence.id);
    const mid = { x: (fence.a.x + fence.b.x) / 2, y: (fence.a.y + fence.b.y) / 2 };
    const length = Math.hypot(fence.b.x - fence.a.x, fence.b.y - fence.a.y);
    const removedSide = [-1, 1].map(sign => ({
      x: mid.x - sign * (fence.b.y - fence.a.y) / length * .1,
      y: mid.y + sign * (fence.b.x - fence.a.x) / length * .1,
    })).find(p => pointInRings(p, area.rings));
    if (!removedSide) throw new Error(`Access sign ${fence.id} has no closed side`);
    const source = plan.levels.find(l => Math.abs(l.renderElevationM - area.z) < .02)?.spaces
      .find(s => s.restricted && pointInRings(removedSide, s.rings));
    const classification = source ? "restricted" : "closed";
    return [{ fence, z: area.z, removedSide, classification, sourceSpaceId: source?.id ?? null,
      ...ACCESS_WORDING[classification] }];
  });
  const named = new Set<string>();
  for (const fence of signFences.filter(f => f.closedSide && Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y) >= .7).sort((a, b) => Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) - Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y))) if (fence.closedSide && fence.restrictedSpaceId && !named.has(fence.restrictedSpaceId)) {
    named.add(fence.restrictedSpaceId);
    signs.push({
    fence, z: fence.zMin + .05, removedSide: fence.closedSide, classification: "restricted",
    sourceSpaceId: fence.restrictedSpaceId, ...ACCESS_WORDING.restricted,
    });
  }
  return signs;
}
