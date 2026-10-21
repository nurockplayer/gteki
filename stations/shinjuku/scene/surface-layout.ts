/** Surface geometry/collision contracts. Procedural context never adds a walk surface. */
import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import type { StationBundle } from "@gteki/schema";
import { pointInRings, type Layout, type XY, type WallSeg } from "./layout.ts";
import type { SurfaceData } from "./surface-data.ts";

/** Within `withSurfaceMemo`, the pure derivations below are computed once per (layout, bundle[, surface]).
 * buildStation asks for the same street footprint, openings, graph segments, entrances, pad walls and
 * building footprints from several places (render, WalkWorld, the explorer hook); each is a polygon-clipping
 * union/difference. Outside the scope nothing is cached, so tests that edit a layout or bundle between calls
 * see fresh results. Results are shared between callers and must be treated as read-only (as they are). */
let activeMemo: Map<string, WeakMap<object, unknown>> | null = null;
export function withSurfaceMemo<T>(fn: () => T): T {
  const outer = activeMemo;
  activeMemo = outer ?? new Map();
  try { return fn(); } finally { activeMemo = outer; }
}
/** keys: the objects the result depends on, outermost first (layout, bundle, ...). */
function memoized<T>(name: string, keys: object[], compute: () => T): T {
  if (!activeMemo) return compute();
  let level = activeMemo.get(name);
  if (!level) activeMemo.set(name, (level = new WeakMap()));
  for (const key of keys) {
    let next = level.get(key) as WeakMap<object, unknown> | undefined;
    if (!next) level.set(key, (next = new WeakMap()));
    level = next;
  }
  // The leaf holds the value under a fixed sentinel key.
  if (level.has(LEAF)) return level.get(LEAF) as T;
  const value = compute();
  level.set(LEAF, value);
  return value;
}
const LEAF = {};

export const GROUND_EXTENT = { minX: -710, minY: -610, maxX: 650, maxY: 810 };
const ringPoly = (rings: XY[][]): Polygon => rings.map((r) => r.map((p) => [p.x, p.y]));
const rect = (x: number, y: number, hx: number, hy: number): Polygon => [[[x - hx, y - hy], [x + hx, y - hy], [x + hx, y + hy], [x - hx, y + hy], [x - hx, y - hy]]];

/** All existing evidence-limited level-0 surfaces, including boundary-node landings
 * (exit 1 is a boundary node, so has no STREET_PAD of its own). No area is added. */
export function streetFootprint(layout: Layout): MultiPolygon {
  return memoized("streetFootprint", [layout], () => {
    const slabs = [...layout.streetPads, ...layout.pads, ...layout.linkStrips, ...layout.levels.filter((l) => Math.abs(l.z) < 0.1).flatMap((l) => l.slabs)].filter((s) => Math.abs(s.z) < 0.1);
    return slabs.length ? polygonClipping.union(ringPoly(slabs[0]!.rings), ...slabs.slice(1).map((s) => ringPoly(s.rings))) : [];
  });
}

/** Cut exactly the run width, plus a 0.08 m construction clearance. Unlike the
 * underground slab helper, start at the run mouth (no 0.25 m opaque lip).
 * The opening extends down to 2.6 m head clearance. Flat top slabs stay solid. */
export function surfaceOpenings(layout: Layout, bundle: StationBundle): MultiPolygon {
  return memoized("surfaceOpenings", [layout, bundle], () => {
    const holes: Polygon[] = [];
    for (const r of layout.runs) {
      const dz = r.b.z - r.a.z;
      if (Math.abs(dz) < 0.01 || Math.max(r.a.z, r.b.z) < -2.6 || Math.min(r.a.z, r.b.z) > 0.1) continue;
      const ts = [-2.6, 0.02].map((z) => (z - r.a.z) / dz).sort((a, b) => a - b);
      const lo = Math.max(0, ts[0]!), hi = Math.min(1, ts[1]!);
      if (hi <= lo) continue;
      const dx = r.b.x - r.a.x, dy = r.b.y - r.a.y, L = Math.hypot(dx, dy);
      const nx = -dy / L * (r.width / 2 + 0.08), ny = dx / L * (r.width / 2 + 0.08);
      const a = { x: r.a.x + dx * lo, y: r.a.y + dy * lo }, b = { x: r.a.x + dx * hi, y: r.a.y + dy * hi };
      holes.push([[[a.x + nx, a.y + ny], [b.x + nx, b.y + ny], [b.x - nx, b.y - ny], [a.x - nx, a.y - ny], [a.x + nx, a.y + ny]]]);
    }
    // CAD elevator shaft polygons where available; otherwise the graph-end shaft
    // uses an explicitly generic 2.2 m opening, never a claim about equipment size.
    for (const lv of layout.levels.filter((l) => Math.abs(l.z) < 0.1)) for (const room of lv.rooms.filter((r) => r.role === "elevator")) holes.push(ringPoly(room.space.rings));
    for (const e of bundle.edges.filter((e) => e.mode === "elevator")) for (const id of [e.from, e.to]) {
      if (Math.abs(layout.nodeZ.get(id) ?? -100) > 0.1) continue;
      const p = bundle.nodes.find((n) => n.id === id)!.position;
      holes.push(rect(p.x, p.y, 1.1, 1.1));
    }
    return holes.length ? polygonClipping.union(holes[0]!, ...holes.slice(1)) : [];
  });
}

export function surfaceGround(layout: Layout, bundle: StationBundle): MultiPolygon {
  const e = GROUND_EXTENT;
  return polygonClipping.difference(rect((e.minX + e.maxX) / 2, (e.minY + e.maxY) / 2, (e.maxX - e.minX) / 2, (e.maxY - e.minY) / 2), surfaceOpenings(layout, bundle));
}

export function graphSegments(layout: Layout, bundle: StationBundle) {
  return memoized("graphSegments", [layout, bundle], () => {
    return bundle.edges.flatMap((e) => {
      const a = bundle.nodes.find((n) => n.id === e.from)!, b = bundle.nodes.find((n) => n.id === e.to)!;
      const pts = e.geometry?.length ? e.geometry : [a.position, b.position];
      const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y));
      const total = lens.reduce((a, b) => a + b, 0) || 1;
      const za = layout.nodeZ.get(a.id)!, zb = layout.nodeZ.get(b.id)!;
      let d = 0;
      return lens.map((L, i) => { const z0 = za + (zb - za) * d / total; d += L; return { a: { ...pts[i]!, z: z0 }, b: { ...pts[i + 1]!, z: za + (zb - za) * d / total } }; });
    });
  });
}
const dist = (p: XY, a: XY, b: XY) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return { d: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy), t };
};

/** Continuous waist-high guard rails on the actual walkable perimeter. The same
 * segments are rendered and passed to WalkWorld. Local graph mouths are opened
 * with 0.65 m clearance (0.3 m body + rail thickness + margin), at every height. */
export function surfacePadWalls(layout: Layout, bundle: StationBundle): WallSeg[] {
  return memoized("surfacePadWalls", [layout, bundle], () => {
    const footprint = streetFootprint(layout), segs = graphSegments(layout, bundle);
    const clear = (p: XY) => segs.some(({ a, b }) => { const q = dist(p, a, b), z = a.z + (b.z - a.z) * q.t; return q.d < 0.65 && z > -2.0 && z < 1.2; });
    const walls: WallSeg[] = [];
    for (const poly of footprint) for (const ring of poly) for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1]!, [bx, by] = ring[i]!;
      const L = Math.hypot(bx - ax, by - ay), pieces = Math.ceil(L / 0.1);
      let start: XY | null = null;
      for (let k = 0; k <= pieces; k++) {
        const p = { x: ax + (bx - ax) * k / pieces, y: ay + (by - ay) * k / pieces };
        const end = { x: ax + (bx - ax) * (k + 1) / pieces, y: ay + (by - ay) * (k + 1) / pieces };
        const keep = k < pieces && ![p, end, { x: (p.x + end.x) / 2, y: (p.y + end.y) / 2 }].some(clear);
        if (keep && !start) start = p;
        if (!keep && start) { if (Math.hypot(p.x - start.x, p.y - start.y) > 0.15) walls.push({ a: start, b: p, zMin: -0.05, zMax: 1.08, side: 1, kind: "wall" }); start = null; }
      }
    }
    return walls;
  });
}

/** Context masses are trimmed clear of every existing street slab and every
 * graph corridor near street height. This is an explicit visual simplification
 * where the independent source dates/symbolic level geometry disagree. */
export function surfaceBuildingFootprints(surface: SurfaceData, layout: Layout, bundle: StationBundle) {
  return memoized("surfaceBuildingFootprints", [layout, bundle, surface], () => {
    const keep: Polygon[] = [];
    for (const poly of streetFootprint(layout)) {
      keep.push(poly);
      for (const ring of poly) for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = ring[i - 1]!, [bx, by] = ring[i]!;
        const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = -dy / L * 0.75, ny = dx / L * 0.75;
        keep.push([[[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny], [ax + nx, ay + ny]]]);
        keep.push(rect(ax, ay, 0.75, 0.75));
      }
    }
    for (const poly of surfaceOpenings(layout, bundle)) keep.push(poly);
    for (const { a, b } of graphSegments(layout, bundle).filter((s) => Math.max(s.a.z, s.b.z) > -2.0)) {
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / L * 0.8, ny = (b.x - a.x) / L * 0.8;
      if (L > 0.01) keep.push([[[a.x + nx, a.y + ny], [b.x + nx, b.y + ny], [b.x - nx, b.y - ny], [a.x - nx, a.y - ny], [a.x + nx, a.y + ny]]]);
      keep.push(rect(a.x, a.y, 0.8, 0.8), rect(b.x, b.y, 0.8, 0.8));
    }
    const exclusion = keep.length ? polygonClipping.union(keep[0]!, ...keep.slice(1)) : [];
    return surface.buildings.flatMap((b) => polygonClipping.difference(b.rings, exclusion).map((rings, i) => ({ ...b, id: `${b.id}/${i}`, rings })));
  });
}

export function surfaceColumns(layout: Layout, bundle: StationBundle): WallSeg[] {
  return memoized("surfaceColumns", [layout, bundle], () => {
    const segs = graphSegments(layout, bundle);
    return surfaceEntrances(layout, bundle).flatMap((e) => [-1, 1].flatMap((side) => [-1, 1].flatMap((end) => {
      const p = { x: e.center.x + e.u.x * e.halfLength * end - e.u.y * e.halfWidth * side, y: e.center.y + e.u.y * e.halfLength * end + e.u.x * e.halfWidth * side };
      if (segs.some(({ a, b }) => { const q = dist(p, a, b); return q.d < 0.8 && a.z + (b.z - a.z) * q.t > -2; })) return [];
      return [{ a: { x: p.x - 0.04, y: p.y }, b: { x: p.x + 0.04, y: p.y }, zMin: 0, zMax: 2.95, side: 1 as const, kind: "office" as const }];
    })));
  });
}

export interface CanopyWallSeg extends WallSeg {
  /** Renderer hint: glazed stair-side panel or the opaque end wall. */
  canopyPart: "side" | "back";
}

/** Side glazing and the closed end of each entrance canopy. Segments are cut
 * around all nearby graph paths so the decorative enclosure never narrows or
 * blocks a published edge. Panels stay at body height and enter WalkWorld. */
export function surfaceCanopyWalls(layout: Layout, bundle: StationBundle): CanopyWallSeg[] {
  return memoized("surfaceCanopyWalls", [layout, bundle], () => {
    const segs = graphSegments(layout, bundle);
    const walls: CanopyWallSeg[] = [];
    const clear = (p: XY) => segs.some(({ a, b }) => {
      const q = dist(p, a, b), z = a.z + (b.z - a.z) * q.t;
      // WalkWorld checks wall height against the full 1.7 m body, so a walker
      // descending to -1.65 m can still touch a wall whose sill is at street z=0.
      return q.d < 0.65 && z > -1.7 && z < 2.65;
    });

    const appendClipped = (a: XY, b: XY, canopyPart: CanopyWallSeg["canopyPart"]) => {
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const pieces = Math.max(1, Math.ceil(length / 0.1));
      let start: XY | null = null;
      for (let i = 0; i <= pieces; i++) {
        const p = { x: a.x + (b.x - a.x) * i / pieces, y: a.y + (b.y - a.y) * i / pieces };
        const next = { x: a.x + (b.x - a.x) * (i + 1) / pieces, y: a.y + (b.y - a.y) * (i + 1) / pieces };
        const midpoint = { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 };
        const keep = i < pieces && ![p, midpoint, next].some(clear);
        if (keep && !start) start = p;
        if (!keep && start) {
          if (Math.hypot(p.x - start.x, p.y - start.y) > 0.15) walls.push({
            a: start, b: p, zMin: 0, zMax: canopyPart === "back" ? 2.95 : 2.35,
            side: 1, kind: "wall", canopyPart,
          });
          start = null;
        }
      }
    };

    for (const e of surfaceEntrances(layout, bundle)) {
      const v = { x: -e.u.y, y: e.u.x };
      const end = (along: number, across: number): XY => ({
        x: e.center.x + e.u.x * along + v.x * across,
        y: e.center.y + e.u.y * along + v.y * across,
      });
      for (const side of [-1, 1]) appendClipped(end(-e.halfLength, side * e.halfWidth), end(e.halfLength, side * e.halfWidth), "side");
      // The low end of the stair run is the back of the canopy. The clear graph
      // corridor cuts a doorway where the actual run passes through this plane.
      appendClipped(end(-e.halfLength, -e.halfWidth), end(-e.halfLength, e.halfWidth), "back");
    }
    return walls;
  });
}

/** Call once after buildLayout. It adds only obstacles, never walkable context. */
export function surfaceWalls(layout: Layout, bundle: StationBundle, surface?: SurfaceData): WallSeg[] {
  const walls = [...surfacePadWalls(layout, bundle), ...surfaceColumns(layout, bundle), ...surfaceCanopyWalls(layout, bundle)];
  if (surface) for (const b of surfaceBuildingFootprints(surface, layout, bundle)) for (const ring of b.rings) for (let i = 1; i < ring.length; i++) walls.push({ a: { x: ring[i - 1]![0], y: ring[i - 1]![1] }, b: { x: ring[i]![0], y: ring[i]![1] }, zMin: 0, zMax: b.height + 0.55, side: 1, kind: "room" });
  return walls;
}

export interface SurfaceEntrance { id: string; labelJa: string; labelEn: string; center: XY; top: XY; firstLandingZ: number; u: XY; halfWidth: number; halfLength: number }
/** One generic canopy per actual ground-level exit POI; B1 exits stay underground. */
export function surfaceEntrances(layout: Layout, bundle: StationBundle): SurfaceEntrance[] {
  return memoized("surfaceEntrances", [layout, bundle], () => {
    return bundle.pois.filter((p) => p.category === "exit" && p.connectorNodeIds.some((id) => Math.abs(layout.nodeZ.get(id) ?? -100) < 0.1)).map((p) => {
      const node = bundle.nodes.find((n) => n.id === p.connectorNodeIds[0])!;
      const nearby = layout.runs.filter((r) => Math.max(r.a.z, r.b.z) > -0.1 && Math.min(Math.hypot(r.a.x - node.position.x, r.a.y - node.position.y), Math.hypot(r.b.x - node.position.x, r.b.y - node.position.y)) < 9);
      const run = nearby.sort((a, b) => Math.min(Math.hypot(a.a.x - node.position.x, a.a.y - node.position.y), Math.hypot(a.b.x - node.position.x, a.b.y - node.position.y)) - Math.min(Math.hypot(b.a.x - node.position.x, b.a.y - node.position.y), Math.hypot(b.b.x - node.position.x, b.b.y - node.position.y)))[0];
      const top = run ? (run.a.z > run.b.z ? run.a : run.b) : node.position;
      const low = run ? (run.a.z > run.b.z ? run.b : run.a) : { x: top.x, y: top.y - 1 };
      const L = Math.hypot(top.x - low.x, top.y - low.y) || 1;
      const u = { x: (top.x - low.x) / L, y: (top.y - low.y) / L };
      const reach = run ? Math.min(L, 2.6 / Math.abs(run.a.z - run.b.z) * L) : 2;
      return { id: p.id, labelJa: p.names.find((n) => n.lang === "ja")!.text, labelEn: p.names.find((n) => n.lang === "en")!.text, center: { x: top.x - u.x * (reach / 2 + .475), y: top.y - u.y * (reach / 2 + .475) }, top: { x: top.x, y: top.y }, firstLandingZ: run ? Math.min(run.a.z, run.b.z) : 0, u, halfWidth: (run?.width ?? 2.2) / 2 + 0.5, halfLength: reach / 2 + .625 };
    });
  });
}

/**
 * Roof over each stair/escalator run whose E27 link is roofed (屋根の有無 = 2 in the MLIT pedestrian network
 * spec) where the run is open to the street (the surfaceOpenings band) and no entrance canopy covers it.
 * The source states only that the link is roofed, so this is generic glazing at canopy height, not a claim
 * about the real structure.
 */
export interface SurfaceRoof { edgeId: string; center: XY; u: XY; halfWidth: number; halfLength: number }

export function surfaceRoofs(layout: Layout, bundle: StationBundle, entrances = surfaceEntrances(layout, bundle)): SurfaceRoof[] {
  const roofed = new Set(bundle.edges.filter((e) => e.attributes?.roof === 2).map((e) => e.id));
  const underCanopy = (p: XY) => entrances.some((e) => {
    const dx = p.x - e.center.x, dy = p.y - e.center.y;
    return Math.abs(dx * e.u.x + dy * e.u.y) <= e.halfLength && Math.abs(-dx * e.u.y + dy * e.u.x) <= e.halfWidth;
  });
  const roofs: SurfaceRoof[] = [];
  for (const r of layout.runs) {
    const dz = r.b.z - r.a.z;
    if (!roofed.has(r.edgeId) || Math.abs(dz) < 0.01 || Math.max(r.a.z, r.b.z) < -2.6 || Math.min(r.a.z, r.b.z) > 0.1) continue;
    const ts = [-2.6, 0.02].map((z) => (z - r.a.z) / dz).sort((a, b) => a - b);
    const lo = Math.max(0, ts[0]!), hi = Math.min(1, ts[1]!);
    if (hi <= lo) continue;
    const at = (t: number) => ({ x: r.a.x + (r.b.x - r.a.x) * t, y: r.a.y + (r.b.y - r.a.y) * t });
    if (Array.from({ length: 11 }, (_, k) => at(lo + ((hi - lo) * k) / 10)).every(underCanopy)) continue;
    const a = at(lo), b = at(hi), L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // Same 0.08 m construction clearance as the opening, plus a 0.3 m overhang on every side.
    roofs.push({ edgeId: r.edgeId, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, u: { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, halfWidth: r.width / 2 + 0.38, halfLength: L / 2 + 0.3 });
  }
  return roofs;
}

/** Surface rendering is only needed in the open air or close to an exit after
 * the viewer has risen above its first landing. `viewer` is station ENU. */
export function surfaceVisibleAt(layout: Layout, bundle: StationBundle, viewer: { x: number; y: number; z: number }, context = { entrances: surfaceEntrances(layout, bundle), openings: surfaceOpenings(layout, bundle) }): boolean {
  return surfaceVisibleIn(context, viewer);
}
/** The visibility rule itself. It needs only the entrances and openings, so a live scene can keep those
 * (small) and let go of the layout (#72). */
export function surfaceVisibleIn(context: { entrances: ReturnType<typeof surfaceEntrances>; openings: ReturnType<typeof surfaceOpenings> }, viewer: { x: number; y: number; z: number }): boolean {
  if (viewer.z >= 0) return true;
  const nearTop = viewer.z > -2 || context.entrances.some((e) =>
    Math.hypot(viewer.x - e.top.x, viewer.y - e.top.y) <= 30 && viewer.z > e.firstLandingZ + 1.2);
  if (!nearTop) return false;
  // A stair shaft is wider than its street opening to accommodate the following
  // camera. Its shoulder can still see sky through the adjacent open canopy even
  // when the eye is outside the opening's plan projection. Do not apply this to
  // lifts: their enclosed halls have their own hood rather than a view of street.
  if (context.entrances.some((e) => {
    if (e.firstLandingZ >= -0.5 || viewer.z <= e.firstLandingZ + 1.2) return false;
    const dx = viewer.x - e.center.x, dy = viewer.y - e.center.y;
    return Math.abs(dx * e.u.x + dy * e.u.y) <= e.halfLength + 0.8 &&
      Math.abs(-dx * e.u.y + dy * e.u.x) <= e.halfWidth + 1.8;
  })) return true;
  // The follow camera can reach -1.95 m while standing on the flat B1 floor.
  // Below grade, only an opening (plus a conservative 0.8 m approach margin)
  // gives sight of the surface; the remaining ground/ceiling is opaque.
  return context.openings.some(poly => pointInRings(viewer, poly.map(r => r.map(([x,y]) => ({x,y})))) ||
    poly.some(r => r.slice(1).some(([x,y],i) => dist(viewer,{x:r[i]![0],y:r[i]![1]},{x,y}).d < .8)));
}
