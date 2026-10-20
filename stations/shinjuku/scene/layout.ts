/**
 * Renderer-neutral scene layout for Toei Oedo Shinjuku (E27).
 *
 * Turns GSI CAD space polygons (plan.json) + the verified graph (gteki/graph.json)
 * into floors, ceilings, walls, stair/escalator runs, railings, tactile paving
 * and gate lines, all in station ENU metres. Three.js meshes are built from
 * this in build.ts; a Godot importer can consume the same output.
 *
 * Visual-only: nothing here feeds routing. Heights are symbolic (see plan.heightModel).
 */
import type { Edge, StationBundle } from "@gteki/schema";
import polygonClipping, { type Polygon as ClipPolygon } from "polygon-clipping";

export interface XY {
  x: number;
  y: number;
}
export interface XYZ extends XY {
  z: number;
}

export interface PlanSpace {
  id: string;
  category: string;
  restricted: boolean;
  toll: "paid" | "free" | null;
  rings: XY[][];
}
export interface PlanLevel {
  label: string;
  ordinal: number;
  floorId: string;
  renderElevationM: number;
  outline: XY[][][];
  spaces: PlanSpace[];
  facilities: { id: string; category: string; x: number; y: number }[];
}
export interface Plan {
  levels: PlanLevel[];
  nodeRenderZ: Record<string, number>;
  attribution: string[];
}

export type SpaceRole = "floor" | "connector" | "elevator" | "room" | "toilet" | "office";
const CONNECTOR = new Set(["B021", "B023"]);
const TOILET = new Set(["B007", "B008", "B009"]);

export function spaceRole(s: PlanSpace): SpaceRole {
  if (s.restricted) return "room";
  if (CONNECTOR.has(s.category)) return "connector";
  if (s.category === "B022") return "elevator";
  if (TOILET.has(s.category)) return "toilet";
  if (s.category === "B018" || s.category === "B026") return "office";
  return "floor";
}

export interface SlabPoly {
  spaceId: string;
  rings: XY[][];
  z: number;
  fare: "paid" | "free" | null;
  /** walkway / slope / platform */
  category: string;
}

export interface WallSeg {
  a: XY;
  b: XY;
  zMin: number;
  zMax: number;
  /** Which side the walkable space is on: +1 = left of a→b. */
  side: 1 | -1;
  kind: "wall" | "room" | "toilet" | "office" | "elevator" | "trackside";
  /** Bodies whose feet are above this height pass (level walls don't block people on landings/runs above). */
  bodyMax?: number;
  /** Bodies whose feet are below this height pass (a stair running under the floor a prop stands on). */
  bodyMin?: number;
  /** Original enclosure finish; collision still uses this segment's conservative height band. */
  finish?: "shaft" | "fascia";
  /** Sloping end heights, used by the renderer for pitched shaft walls. */
  profile?: { bottomA: number; bottomB: number; topA: number; topB: number };
  runEdgeId?: string;
  /** UV datum follows the nosing line, independent of local doorway cut-outs. */
  surfaceBase?: { a: number; b: number };
}

/** A finished underside, horizontal or affine in ENU. Thickness is above this surface. */
export interface Soffit extends SlabPoly {
  floorId: string;
  kind: "shaft" | "landing" | "slab";
  origin?: XY;
  slope?: XY;
}

export function soffitHeight(s: SlabPoly & { origin?: XY; slope?: XY }, p: XY): number {
  return s.z + (s.slope?.x ?? 0) * (p.x - (s.origin?.x ?? 0)) + (s.slope?.y ?? 0) * (p.y - (s.origin?.y ?? 0));
}

export interface Railing {
  a: XY;
  b: XY;
  z: number;
}

export interface Run {
  edgeId: string;
  mode: "stairs" | "escalator";
  a: XYZ;
  b: XYZ;
  width: number;
  /** escalator travel direction: +1 = a→b, -1 = b→a; stairs: 0 */
  travel: 1 | -1 | 0;
}

export interface TactileLine {
  pts: XYZ[];
}

export interface GateLine {
  edgeId: string;
  center: XYZ;
  /** unit vector along the passenger flow */
  dir: XY;
  width: number;
}

export interface LevelLayout {
  label: string;
  floorId: string;
  z: number;
  ceilingZ: number;
  slabs: SlabPoly[];
  ceilings: SlabPoly[];
  walls: WallSeg[];
  railings: Railing[];
  rooms: { space: PlanSpace; role: SpaceRole }[];
}

export interface Layout {
  levels: LevelLayout[];
  runs: Run[];
  tactile: TactileLine[];
  gates: GateLine[];
  /** Flat landing pads at both ends of runs, so floors and ramps meet. */
  pads: SlabPoly[];
  /** Minimal street-level pavement squares around outdoor exit nodes (non-authoritative, 8 m). */
  streetPads: SlabPoly[];
  /** Walk-only ground strips along flat verified links (not rendered): the graph guarantees passage. */
  linkStrips: SlabPoly[];
  /** Stair/escalator balustrades as ~1 m wall pieces with local height bands (open where a link crosses). */
  runWalls: WallSeg[];
  /** Underground shaft roofs, intermediate landing ceilings and finished slab undersides. */
  soffits: Soffit[];
  nodeZ: Map<string, number>;
  bounds: { min: XY; max: XY };
}

// ---------------------------------------------------------------- geometry helpers
export function pointInRing(p: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/** Collision for void-edge railings: block people on that level only. */
export function railingWalls(layout: Layout): WallSeg[] {
  return layout.levels.flatMap((lv) => lv.railings.map((r): WallSeg => ({ a: r.a, b: r.b, zMin: r.z - 0.1, zMax: r.z + 1.1, side: 1, kind: "wall", bodyMin: r.z - 0.5, bodyMax: r.z + 1.0 })));
}

/**
 * Stairwells: a run descending from a slab's level is open where it is 0.25–2.4 m below the slab
 * (otherwise the floor overhangs the stair as a cliff); deeper runs pass under the floor. The cut is
 * real geometry, shared by rendering, the explorer's walk proxies and WalkWorld.
 */
export function cutStairwells(slabs: SlabPoly[], runs: Run[]): SlabPoly[] {
  const out: SlabPoly[] = [];
  for (const s of slabs) {
    const holes: ClipPolygon[] = [];
    for (const r of runs) {
      if (Math.abs(r.a.z - s.z) >= 0.3 && Math.abs(r.b.z - s.z) >= 0.3) continue;
      const dz = r.b.z - r.a.z;
      if (Math.abs(dz) < 1e-6) continue;
      // t where run height = s.z − 0.25 and s.z − 2.4
      const t1 = (s.z - 0.25 - r.a.z) / dz;
      const t2 = (s.z - 2.4 - r.a.z) / dz;
      const lo = Math.max(0, Math.min(t1, t2));
      const hi = Math.min(1, Math.max(t1, t2));
      if (hi <= lo) continue;
      const d = sub(r.b, r.a);
      const L = len(d) || 1;
      const n = { x: (-d.y / L) * (r.width / 2), y: (d.x / L) * (r.width / 2) };
      const p0 = lerp(r.a, r.b, lo);
      const p1 = lerp(r.a, r.b, hi);
      holes.push([[[p0.x + n.x, p0.y + n.y], [p1.x + n.x, p1.y + n.y], [p1.x - n.x, p1.y - n.y], [p0.x - n.x, p0.y - n.y], [p0.x + n.x, p0.y + n.y]]]);
    }
    const ring0 = s.rings[0]!;
    const bbox = { minX: Math.min(...ring0.map((p) => p.x)), maxX: Math.max(...ring0.map((p) => p.x)), minY: Math.min(...ring0.map((p) => p.y)), maxY: Math.max(...ring0.map((p) => p.y)) };
    // bounding-box overlap (a long cut can cross the slab with every corner outside it)
    const hit = holes.filter((h) => {
      const xs = h[0]!.map(([x]) => x!);
      const ys = h[0]!.map(([, y]) => y!);
      return Math.max(...xs) >= bbox.minX && Math.min(...xs) <= bbox.maxX && Math.max(...ys) >= bbox.minY && Math.min(...ys) <= bbox.maxY;
    });
    if (!hit.length) {
      out.push(s);
      continue;
    }
    const subject: ClipPolygon = s.rings.map((ring) => ring.map((p) => [p.x, p.y] as [number, number]));
    const parts = polygonClipping.difference(subject, ...hit);
    parts.forEach((poly, i) => out.push({ ...s, spaceId: parts.length > 1 ? `${s.spaceId}~${i}` : s.spaceId, rings: poly.map((ring) => ring.map(([x, y]) => ({ x: x!, y: y! }))) }));
  }
  return out;
}

export function pointInRings(p: XY, rings: XY[][]): boolean {
  if (!rings[0] || !pointInRing(p, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(p, rings[i]!)) return false;
  return true;
}
function ringArea(r: XY[]): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j]!.x - r[i]!.x) * (r[j]!.y + r[i]!.y);
  return s / 2;
}
const sub = (a: XY, b: XY) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: XY) => Math.hypot(v.x, v.y);
const lerp = (a: XY, b: XY, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Width-class → metres (MLIT width code: 1 <1 m, 2 1–2 m, 3 2–3 m, 4 ≥3 m). Visual estimate. */
export function widthFromClass(code: unknown, mode: string): number {
  if (mode === "escalator") return 1.25;
  switch (code) {
    case 1:
      return 0.9;
    case 2:
      return 1.8;
    case 3:
      return 2.6;
    case 4:
      return 3.4;
    default:
      return 2;
  }
}

// ---------------------------------------------------------------- main
const SUBSEG = 0.5;
export const STREET_PAD = 8;
const PROBE = 0.18;

export function buildLayout(bundle: StationBundle, plan: Plan): Layout {
  const nodeZ = new Map<string, number>(Object.entries(plan.nodeRenderZ));
  const nodeById = new Map(bundle.nodes.map((n) => [n.id, n]));
  const zOf = (id: string) => nodeZ.get(id) ?? 0;

  // Runs: one per stair/escalator edge.
  const runs: Run[] = [];
  for (const e of bundle.edges) {
    if (e.mode !== "stairs" && e.mode !== "escalator") continue;
    // Stairs whose two ends sit on the same (symbolic) level can't be drawn as a slope; they become
    // flat walk strips below (documented simplification).
    if (Math.abs(zOf(e.to) - zOf(e.from)) < 0.2) continue;
    const A = nodeById.get(e.from)!;
    const B = nodeById.get(e.to)!;
    runs.push({
      edgeId: e.id,
      mode: e.mode,
      a: { x: A.position.x, y: A.position.y, z: zOf(e.from) },
      b: { x: B.position.x, y: B.position.y, z: zOf(e.to) },
      width: widthFromClass(e.attributes?.width, e.mode),
      travel: e.mode === "escalator" ? (e.direction === "forward" ? 1 : 0) : 0,
    });
  }
  /** Height of the run surface at its closest point to p (and distance to the run axis). */
  const runAt = (r: Run, p: XY) => {
    const ab = sub(r.b, r.a);
    const L2 = ab.x * ab.x + ab.y * ab.y || 1;
    const t = Math.max(0, Math.min(1, ((p.x - r.a.x) * ab.x + (p.y - r.a.y) * ab.y) / L2));
    const q = lerp(r.a, r.b, t);
    return { z: r.a.z + (r.b.z - r.a.z) * t, d: len(sub(p, q)), t };
  };

  const levels: LevelLayout[] = plan.levels.map((lv, li) => {
    const z = lv.renderElevationM;
    const isPlatform = lv.ordinal === -6;
    const ceilingH = isPlatform ? 3.6 : lv.ordinal >= 0 ? 3.4 : 3.1;
    const above = plan.levels[li - 1];
    const ceilingZ = above ? Math.min(z + ceilingH, above.renderElevationM - 0.6) : z + ceilingH;
    const roles = lv.spaces.map((s) => ({ s, role: spaceRole(s) }));
    const slabs: SlabPoly[] = [];
    const ceilings: SlabPoly[] = [];
    const rooms: LevelLayout["rooms"] = [];
    /** connector spaces whose runs go DOWN from this level are voids in the slab. */
    const voidIds = new Set<string>();
    for (const { s, role } of roles) {
      if (role === "floor") {
        const poly = { spaceId: s.id, rings: s.rings, z, fare: s.toll, category: s.category };
        slabs.push(poly);
        ceilings.push({ ...poly, z: ceilingZ });
      } else if (role === "connector") {
        // classify by the runs crossing this polygon
        const c = centroid(s.rings[0]!);
        let below = 0;
        let aboveN = 0;
        for (const r of runs) {
          const h = runAt(r, c);
          if (h.d > r.width) continue;
          if (h.z < z - 0.5) below++;
          else if (h.z > z + 0.5) aboveN++;
        }
        if (below > 0) voidIds.add(s.id);
        else slabs.push({ spaceId: s.id, rings: s.rings, z, fare: s.toll, category: s.category });
        if (aboveN === 0) ceilings.push({ spaceId: s.id, rings: s.rings, z: ceilingZ, fare: s.toll, category: s.category });
      } else rooms.push({ space: s, role });
    }

    // Walls & railings: subdivide each walkable polygon edge; probe outward.
    const walkable = roles.filter(({ role }) => role === "floor" || role === "connector");
    const isOpenAt = (p: XY, self: PlanSpace) => walkable.some(({ s }) => s !== self && pointInRings(p, s.rings));
    const roomAt = (p: XY) => roles.find(({ s, role }) => role !== "floor" && role !== "connector" && pointInRings(p, s.rings));
    const walls: WallSeg[] = [];
    const railings: Railing[] = [];
    // Corridors where a stair/escalator run leaves this level: a plan outline crossing the run
    // there is the step-on mouth, not a wall (the run's own balustrades bound it laterally).
    const mouths = runs.flatMap((r) =>
      ([[r.a, r.b], [r.b, r.a]] as const)
        .filter(([m]) => Math.abs(m.z - z) < 0.3)
        .map(([m, o]) => {
          const d = sub(o, m);
          const L = len(d) || 1;
          return { m, u: { x: d.x / L, y: d.y / L }, half: r.width / 2 + 0.1, reach: Math.min(4, L) };
        }),
    );
    const inMouth = (p: XY) =>
      mouths.some(({ m, u, half, reach }) => {
        const v = sub(p, m);
        const t = v.x * u.x + v.y * u.y;
        return t > -0.6 && t < reach && Math.abs(v.x * u.y - v.y * u.x) < half;
      });
    for (const { s } of walkable) {
      const isVoid = voidIds.has(s.id);
      for (const ring of s.rings) {
        const ccw = ringArea(ring) > 0; // positive = CCW with this formula
        for (let i = 0; i < ring.length - 1; i++) {
          const a = ring[i]!;
          const b = ring[i + 1]!;
          const L = len(sub(b, a));
          if (L < 1e-3) continue;
          const n = Math.max(1, Math.ceil(L / SUBSEG));
          const dir = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
          // outward normal: right of travel for CCW rings
          const out = ccw ? { x: dir.y, y: -dir.x } : { x: -dir.y, y: dir.x };
          let runStart: XY | null = null;
          let runKind: WallSeg["kind"] | "rail" | null = null;
          const flush = (end: XY) => {
            if (runStart && runKind) {
              if (runKind === "rail") railings.push({ a: runStart, b: end, z });
              else walls.push({ a: runStart, b: end, zMin: z, zMax: ceilingZ, side: ccw ? 1 : -1, kind: runKind });
            }
            runStart = null;
            runKind = null;
          };
          for (let k = 0; k < n; k++) {
            const p0 = lerp(a, b, k / n);
            const p1 = lerp(a, b, (k + 1) / n);
            const mid = lerp(p0, p1, 0.5);
            const probe = { x: mid.x + out.x * PROBE, y: mid.y + out.y * PROBE };
            let kind: WallSeg["kind"] | "rail" | null;
            if (isOpenAt(probe, s)) {
              // boundary between a void stairwell and floor → railing on the floor side
              const other = walkable.find(({ s: o }) => o !== s && pointInRings(probe, o.rings));
              kind = isVoid !== (other ? voidIds.has(other.s.id) : false) && isVoid ? "rail" : null;
            } else {
              const room = roomAt(probe);
              kind = room ? (room.role === "room" ? (room.s.category === "B029" && isPlatform ? "trackside" : "room") : (room.role as WallSeg["kind"])) : "wall";
              if (isVoid) kind = "rail";
              else if (kind === "wall" && inMouth(mid)) kind = null;
            }
            if (kind !== runKind) {
              flush(p0);
              if (kind) {
                runStart = p0;
                runKind = kind;
              }
            }
          }
          flush(b);
        }
      }
    }
    // Do not put railings across the mouth of a run (where people step on).
    const runMouths = runs.flatMap((r) => [r.a, r.b].filter((p) => Math.abs(p.z - z) < 0.3).map((p) => ({ p, w: r.width })));
    const keptRails = railings.filter((rl) => {
      const m = lerp(rl.a, rl.b, 0.5);
      return !runMouths.some(({ p, w }) => len(sub(m, p)) < w * 0.9 + len(sub(rl.b, rl.a)) / 2);
    });
    return { label: lv.label, floorId: lv.floorId, z, ceilingZ, slabs, ceilings, walls: mergeCollinear(walls), railings: keptRails, rooms };
  });

  // Landing pads at run ends.
  const pads: SlabPoly[] = [];
  for (const r of runs) {
    const d = sub(r.b, r.a);
    const L = len(d) || 1;
    const u = { x: d.x / L, y: d.y / L };
    const nrm = { x: -u.y, y: u.x };
    const hw = r.width / 2;
    for (const [p, s] of [
      [r.a, -1],
      [r.b, 1],
    ] as const) {
      const far = { x: p.x + u.x * s * 1.4, y: p.y + u.y * s * 1.4 };
      pads.push({
        spaceId: `pad:${r.edgeId}:${s}`,
        rings: [[
          { x: p.x + nrm.x * hw, y: p.y + nrm.y * hw },
          { x: far.x + nrm.x * hw, y: far.y + nrm.y * hw },
          { x: far.x - nrm.x * hw, y: far.y - nrm.y * hw },
          { x: p.x - nrm.x * hw, y: p.y - nrm.y * hw },
        ]],
        z: p.z,
        fare: null,
        category: "pad",
      });
    }
  }

  // Tactile paving along links flagged brail_tile=2 (walk/ramp/gate only).
  const tactile: TactileLine[] = [];
  for (const e of bundle.edges) {
    if (e.attributes?.brail_tile !== 2) continue;
    if (e.mode === "stairs" || e.mode === "escalator" || e.mode === "elevator") continue;
    const pts = (e.geometry ?? []).map((g, i, arr) => ({ x: g.x, y: g.y, z: i === 0 ? zOf(e.from) : i === arr.length - 1 ? zOf(e.to) : zOf(e.from) }));
    if (pts.length >= 2) tactile.push({ pts });
  }

  // Gate lines.
  const gates: GateLine[] = bundle.edges
    .filter((e: Edge) => e.mode === "gate")
    .map((e) => {
      const A = nodeById.get(e.from)!.position;
      const B = nodeById.get(e.to)!.position;
      const d = sub(B, A);
      const L = len(d) || 1;
      return {
        edgeId: e.id,
        center: { ...lerp(A, B, 0.5), z: zOf(e.from) },
        dir: { x: d.x / L, y: d.y / L },
        width: widthFromClass(e.attributes?.width, "walk"),
      };
    });

  let min = { x: Infinity, y: Infinity };
  let max = { x: -Infinity, y: -Infinity };
  for (const lv of plan.levels)
    for (const o of lv.outline)
      for (const r of o)
        for (const p of r) {
          min = { x: Math.min(min.x, p.x), y: Math.min(min.y, p.y) };
          max = { x: Math.max(max.x, p.x), y: Math.max(max.y, p.y) };
        }

  // The verified graph is the truth for connectivity; the CAD plan is approximate. Wherever a
  // routable link passes through (or hugs) a plan wall at walking height, open that wall locally.
  const segs: { a: XY & { z: number }; b: XY & { z: number }; edgeId: string; halfWidth: number }[] = [];
  for (const e of bundle.edges) {
    if (e.mode === "elevator") continue;
    const pts = (e.geometry?.length ? e.geometry : [nodeById.get(e.from)!.position, nodeById.get(e.to)!.position]).map((p) => ({ x: p.x, y: p.y }));
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += len(sub(pts[i]!, pts[i - 1]!));
    const za = zOf(e.from);
    const zb = zOf(e.to);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = len(sub(pts[i]!, pts[i - 1]!));
      const z0 = za + (zb - za) * (total ? acc / total : 0);
      acc += l;
      const z1 = za + (zb - za) * (total ? acc / total : 1);
      const halfWidth = e.mode === "stairs" || e.mode === "escalator" ? widthFromClass(e.attributes?.width, e.mode) / 2 + 0.35 : 0.6;
      segs.push({ a: { ...pts[i - 1]!, z: z0 }, b: { ...pts[i]!, z: z1 }, edgeId: e.id, halfWidth });
    }
  }
  const CLEAR = 0.5;
  /** A verified link passes within CLEAR of p with walking height in [zLo, zHi]. */
  const clearAt = (p: XY, zLo: number, zHi: number, exceptEdge?: string) =>
    segs.some(({ a, b, edgeId }) => {
      if (edgeId === exceptEdge) return false;
      const ab = sub(b, a);
      const L2 = ab.x * ab.x + ab.y * ab.y;
      const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / L2)) : 0;
      const q = lerp(a, b, t);
      if (len(sub(p, q)) >= CLEAR) return false;
      const zq = a.z + (b.z - a.z) * t;
      return zq > zLo && zq < zHi;
    });
  for (const lv of levels) {
    const out: WallSeg[] = [];
    for (const w of lv.walls) {
      if (w.kind === "trackside") {
        out.push(w);
        continue;
      }
      const L = len(sub(w.b, w.a));
      const n = Math.max(1, Math.ceil(L / 0.1));
      let start: number | null = null;
      for (let k = 0; k <= n; k++) {
        // open locally wherever a verified link's walker would touch this wall: the band in which
        // resolveWalls blocks (feet ∈ [zMin − 1.7, zMax − 0.3]) plus 0.3 m for the body radius on a steep
        // flight. Rendering uses the same cut walls, so what you see is what blocks you.
        const closed = k < n && !clearAt(lerp(w.a, w.b, (k + 0.5) / n), lv.z - 2.0, w.zMax);
        if (closed && start === null) start = k;
        if (!closed && start !== null) {
          out.push({ ...w, a: lerp(w.a, w.b, start / n), b: lerp(w.a, w.b, k / n) });
          start = null;
        }
      }
    }
    lv.walls = mergeCollinear(out);
  }

  const runWalls: WallSeg[] = [];
  for (const r of runs) {
    const d = sub(r.b, r.a);
    const L = len(d) || 1;
    const nrm = { x: -d.y / L, y: d.x / L };
    // ~1 m pieces so each only blocks near the run's local height
    const pieces = Math.max(1, Math.ceil(L));
    for (const sgn of [1, -1]) {
      const off = (r.width / 2 + 0.08) * sgn;
      for (let i = 0; i < pieces; i++) {
        const t0 = i / pieces;
        const t1 = (i + 1) / pieces;
        const za = r.a.z + (r.b.z - r.a.z) * t0;
        const zb = r.a.z + (r.b.z - r.a.z) * t1;
        const a = { x: r.a.x + d.x * t0 + nrm.x * off, y: r.a.y + d.y * t0 + nrm.y * off };
        const b = { x: r.a.x + d.x * t1 + nrm.x * off, y: r.a.y + d.y * t1 + nrm.y * off };
        const zMin = Math.min(za, zb) - 0.3;
        const zMax = Math.max(za, zb) + 1.1;
        // open where another verified link's walker body (feet .. +1.7 m) would intersect this piece
        if ([0.1, 0.5, 0.9].some((f) => clearAt(lerp(a, b, f), zMin - 1.7, zMax, r.edgeId))) continue;
        runWalls.push({ a, b, zMin, zMax, side: 1, kind: "wall", runEdgeId: r.edgeId });
      }
    }
  }

  // Strips extend 0.5 m past their ends to fill corners, except into a run mouth (the extension
  // would float over a steep stair and leave a cliff at its tip).
  const runEnds = new Set(bundle.edges.filter((e) => (e.mode === "stairs" || e.mode === "escalator") && Math.abs(zOf(e.to) - zOf(e.from)) >= 0.2).flatMap((e) => [e.from, e.to]));
  const linkStrips: SlabPoly[] = [];
  for (const e of bundle.edges) {
    if (e.mode === "elevator") continue;
    const za = zOf(e.from);
    if (Math.abs(zOf(e.to) - za) > 0.05) continue;
    const pts = (e.geometry?.length ? e.geometry : [nodeById.get(e.from)!.position, nodeById.get(e.to)!.position]).map((p) => ({ x: p.x, y: p.y }));
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const dd = sub(b, a);
      const l = len(dd);
      if (l < 0.05) continue;
      const u = { x: dd.x / l, y: dd.y / l };
      // A generic 2.8 m passage sleeve where CAD and the graph do not quite meet. These
      // strips are shared by the renderer, WalkWorld and the shared explorer's ground proxies.
      const h = za < -0.5 ? 1.4 : 0.5;
      const n = { x: -u.y * h, y: u.x * h };
      const ha = i === 1 && runEnds.has(e.from) ? 0 : h;
      const hb = i === pts.length - 1 && runEnds.has(e.to) ? 0 : h;
      const a2 = { x: a.x - u.x * ha, y: a.y - u.y * ha };
      const b2 = { x: b.x + u.x * hb, y: b.y + u.y * hb };
      linkStrips.push({ spaceId: `link:${e.id}:${i}`, rings: [[{ x: a2.x + n.x, y: a2.y + n.y }, { x: b2.x + n.x, y: b2.y + n.y }, { x: b2.x - n.x, y: b2.y - n.y }, { x: a2.x - n.x, y: a2.y - n.y }, { x: a2.x + n.x, y: a2.y + n.y }]], z: za, fare: null, category: "link" });
    }
  }

  const streetPads: SlabPoly[] = bundle.nodes
    .filter((n) => n.inOut === "outside" && zOf(n.id) > -0.5)
    .map((n) => {
      const { x, y } = n.position;
      const h = STREET_PAD / 2;
      return { spaceId: `street:${n.id}`, rings: [[{ x: x - h, y: y - h }, { x: x + h, y: y - h }, { x: x + h, y: y + h }, { x: x - h, y: y + h }, { x: x - h, y: y - h }]], z: zOf(n.id), fare: null, category: "street" };
    });

  for (const lv of levels) lv.slabs = cutStairwells(lv.slabs, runs);
  const cutPads = cutStairwells(pads, runs);
  const cutStreet = cutStairwells(streetPads, runs);
  const layout: Layout = { levels, runs, tactile, gates, pads: cutPads, streetPads: cutStreet, linkStrips, runWalls, soffits: [], nodeZ, bounds: { min, max } };
  const elevatorPassages = bundle.edges.filter((e) => e.mode === "elevator").map((e) => ({ a: { ...nodeById.get(e.from)!.position, z: zOf(e.from) }, b: { ...nodeById.get(e.to)!.position, z: zOf(e.to) } }));
  const elevatorLandings = bundle.nodes.filter((n) => n.kind === "elevator" && zOf(n.id) < -0.5).map((n) => ({ ...n.position, z: zOf(n.id) }));
  finishUnderground(layout, plan, [...segs, ...elevatorPassages], elevatorLandings);
  return layout;
}

type Passage = { a: XYZ; b: XYZ; halfWidth?: number };
// Micrometre snapping prevents nearly coincident generated boundaries from defeating the
// polygon sweep, while retaining far more precision than either source data or walker needs.
const clipPoly = (rings: XY[][]): ClipPolygon => rings.map((ring) => ring.map((p) => [Math.round(p.x * 1e6) / 1e6, Math.round(p.y * 1e6) / 1e6]));
const xyRings = (p: ClipPolygon): XY[][] => p.map((ring) => ring.map(([x, y]) => ({ x: x!, y: y! })));

function passageRing(a: XY, b: XY, half: number, extend = 0): XY[] {
  const d = sub(b, a);
  if (len(d) < 1e-8) return [{ x: a.x - half, y: a.y - half }, { x: a.x + half, y: a.y - half }, { x: a.x + half, y: a.y + half }, { x: a.x - half, y: a.y + half }, { x: a.x - half, y: a.y - half }];
  const L = len(d);
  const u = { x: d.x / L, y: d.y / L }, n = { x: -u.y * half, y: u.x * half };
  const p = { x: a.x - u.x * extend, y: a.y - u.y * extend };
  const q = { x: b.x + u.x * extend, y: b.y + u.y * extend };
  return [{ x: p.x + n.x, y: p.y + n.y }, { x: q.x + n.x, y: q.y + n.y }, { x: q.x - n.x, y: q.y - n.y }, { x: p.x - n.x, y: p.y - n.y }, { x: p.x + n.x, y: p.y + n.y }];
}

/** Portion of [0,1] where a linearly varying value lies in [lo,hi]. */
function parameterBand(a: number, b: number, lo: number, hi: number): [number, number] | null {
  if (Math.abs(b - a) < 1e-9) return a >= lo && a <= hi ? [0, 1] : null;
  const x = (lo - a) / (b - a), y = (hi - a) / (b - a);
  const start = Math.max(0, Math.min(x, y)), end = Math.min(1, Math.max(x, y));
  return end > start ? [start, end] : null;
}

/**
 * Carve the entire walker envelope, not just the centreline, out of a new underside.
 * The affine height difference gives exact cut extents even on very long/steep shafts.
 * 2.4 m reserves room for the 2.1 m head band plus recessed light housings.
 */
export function clearSoffit<T extends SlabPoly & { origin?: XY; slope?: XY }>(s: T, passages: Passage[]): T[] {
  const cuts: ClipPolygon[] = [];
  const points = s.rings.flat();
  const minX = Math.min(...points.map((p) => p.x)), maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)), maxY = Math.max(...points.map((p) => p.y));
  for (const { a, b, halfWidth = 0.6 } of passages) {
    const reach = halfWidth + 0.6;
    if (Math.max(a.x, b.x) + reach < minX || Math.min(a.x, b.x) - reach > maxX || Math.max(a.y, b.y) + reach < minY || Math.min(a.y, b.y) - reach > maxY) continue;
    // Account for transverse roof pitch across the walker's radius as well.
    const pitch = Math.hypot(s.slope?.x ?? 0, s.slope?.y ?? 0);
    const safeBand = parameterBand(soffitHeight(s, a) - a.z, soffitHeight(s, b) - b.z, 0.025 - pitch * 0.35, 2.4 + pitch * 0.35);
    if (!safeBand) continue;
    cuts.push(clipPoly([passageRing(lerp(a, b, safeBand[0]), lerp(a, b, safeBand[1]), halfWidth, 0.6)]));
  }
  if (!cuts.length) return [s];
  return polygonClipping.difference(clipPoly(s.rings), ...cuts).map((poly, i) => ({ ...s, spaceId: `${s.spaceId}:clear${i}`, rings: xyRings(poly) }));
}

/**
 * Generic procedural enclosure of the source-backed spaces. Nothing changes the routing graph.
 * Flat roofs cover the complete source outline and graph sleeves; pitched roofs cover runs.
 * New vertical panels are in lv.walls so both consumers use the same physical enclosure.
 */
function finishUnderground(layout: Layout, plan: Plan, passages: Passage[], elevatorLandings: XYZ[]) {
  const underground = layout.levels.filter((lv) => lv.z < -0.5);
  const levelAt = (z: number) => underground.reduce((a, b) => Math.abs(a.z - z) < Math.abs(b.z - z) ? a : b);
  const union = (polys: XY[][][]) => polys.length ? polygonClipping.union(clipPoly(polys[0]!), ...polys.slice(1).map(clipPoly)).map(xyRings) : [];
  const addRoof = (s: Soffit) => layout.soffits.push(...clearSoffit(s, passages));

  // Generic landing/back-of-house envelope around the very small source elevator footprints.
  // The CAD outline stops at the lift wall; a following camera otherwise sees the entire
  // station floating outside that wall. These 6 m sleeves are deliberate visual fill, shared
  // with ground/collision, and do not introduce any graph connection or facility claim.
  for (const z of new Set(elevatorLandings.map((p) => p.z))) {
    const envelopes = union(elevatorLandings.filter((p) => p.z === z).map((p) => [passageRing(p, p, 3)]));
    for (const [i, rings] of envelopes.entries()) {
      const pad: SlabPoly = { spaceId: `elevator-envelope:${z}:${i}`, rings, z, fare: null, category: "pad" };
      layout.pads.push(...cutStairwells([pad], layout.runs));
    }
  }

  // Split only new walls; preserve all existing source wall/railing openings. Each kept piece
  // has the same conservative z band in collision and the rendered trapezoid fits inside it.
  const addWall = (lv: LevelLayout, a: XY, b: XY, bottom: (p: XY) => number, top: (p: XY) => number, finish: "shaft" | "fascia", skipExisting = false) => {
    const count = Math.max(1, Math.ceil(len(sub(b, a)) / 0.4));
    for (let i = 0; i < count; i++) {
      const p = lerp(a, b, i / count), q = lerp(a, b, (i + 1) / count), mid = lerp(p, q, 0.5);
      const minZ = Math.min(bottom(p), bottom(q)), maxZ = Math.min(-0.51, Math.max(top(p), top(q)));
      if (maxZ <= minZ + 0.015) continue;
      if (skipExisting && lv.walls.some((w) => {
        if (w.finish) return false;
        const d = sub(w.b, w.a), l2 = d.x * d.x + d.y * d.y || 1;
        const t = Math.max(0, Math.min(1, ((mid.x - w.a.x) * d.x + (mid.y - w.a.y) * d.y) / l2));
        return len(sub(mid, lerp(w.a, w.b, t))) < 0.12 && (w.kind === "trackside" || (w.zMin <= minZ + 0.25 && w.zMax >= maxZ - 0.1));
      })) continue;
      let bands: [number, number][] = [[minZ, maxZ]];
      for (const s of passages) {
        const d = sub(s.b, s.a), l2 = d.x * d.x + d.y * d.y || 1;
        const zs: number[] = [];
        for (const f of [0, 0.5, 1]) {
          const v = lerp(p, q, f);
          const t = Math.max(0, Math.min(1, ((v.x - s.a.x) * d.x + (v.y - s.a.y) * d.y) / l2));
          if (len(sub(v, lerp(s.a, s.b, t))) < 0.65) zs.push(s.a.z + (s.b.z - s.a.z) * t);
        }
        if (!zs.length) continue;
        if (len(d) < 1e-8) zs.push(s.b.z); // elevator travel is a vertical opening
        const lo = Math.min(...zs) - 0.6, hi = Math.max(...zs) + 2.45;
        bands = bands.flatMap(([a, b]): [number, number][] => b <= lo || a >= hi ? [[a, b]] : [[a, Math.min(b, lo)], [Math.max(a, hi), b]].filter(([x, y]) => y! - x! > 0.015) as [number, number][]);
      }
      for (const [lo, hi] of bands) {
        const profile = { bottomA: Math.max(lo, bottom(p)), bottomB: Math.max(lo, bottom(q)), topA: Math.min(hi, top(p)), topB: Math.min(hi, top(q)) };
        if (profile.topA <= profile.bottomA || profile.topB <= profile.bottomB) continue;
        const previous = lv.walls.at(-1);
        // Rejoin flat uninterrupted panels after carving. Keep pitched pieces' local height
        // bands intact because the shared explorer consumes those conservative bands too.
        const pp = previous?.profile;
        if (previous?.finish === finish && pp && len(sub(previous.b, p)) < 1e-6 && Math.abs(previous.zMin - lo) < 1e-6 && Math.abs(previous.zMax - hi) < 1e-6 && Math.abs(pp.bottomA - pp.bottomB) < 1e-6 && Math.abs(pp.topA - pp.topB) < 1e-6 && Math.abs(profile.bottomA - profile.bottomB) < 1e-6 && Math.abs(profile.topA - profile.topB) < 1e-6) {
          const d = sub(previous.b, previous.a), e = sub(q, p);
          if (Math.abs(d.x * e.y - d.y * e.x) < 1e-8 && d.x * e.x + d.y * e.y > 0) {
            previous.b = q;
            previous.profile = { ...pp, bottomB: profile.bottomB, topB: profile.topB };
            continue;
          }
        }
        lv.walls.push({ a: p, b: q, zMin: lo, zMax: hi, side: 1, kind: "wall", finish, profile, surfaceBase: { a: bottom(p), b: bottom(q) } });
      }
    }
  };
  const enclose = (lv: LevelLayout, rings: XY[][], bottom: (p: XY) => number, top: (p: XY) => number, finish: "shaft" | "fascia", skipExisting = false) => {
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      if (len(sub(b, a)) > 0.01) addWall(lv, a, b, bottom, top, finish, skipExisting);
    }
  };

  for (const lv of underground) {
    const source = plan.levels.find((p) => p.floorId === lv.floorId)!;
    const extras = [...layout.pads, ...layout.linkStrips].filter((p) => Math.abs(p.z - lv.z) < 0.1);
    const envelope = union([...source.outline, ...extras.map((p) => p.rings)]);
    lv.ceilings = envelope.flatMap((rings, i) => clearSoffit({ spaceId: `ceiling:${lv.floorId}:${i}`, rings, z: lv.ceilingZ, fare: null, category: "ceiling" }, passages));
    for (const rings of envelope) enclose(lv, rings, () => lv.z - 0.2, () => lv.ceilingZ, "shaft", true);
  }

  // The symbolic model spreads switchback landings across non-source elevations. They need
  // their own short ceiling/wall sleeves, otherwise the source-level ceilings miss them.
  const landingZ = [...new Set([...layout.pads, ...layout.linkStrips].map((p) => p.z))].filter((z) => z + 3.2 < -0.5 && !underground.some((lv) => Math.abs(lv.z - z) < 0.1));
  for (const z of landingZ) {
    const lv = levelAt(z);
    const envelope = union([...layout.pads, ...layout.linkStrips].filter((p) => Math.abs(p.z - z) < 0.1).map((p) => p.rings));
    for (const [i, rings] of envelope.entries()) {
      addRoof({ spaceId: `landing-roof:${z}:${i}`, floorId: lv.floorId, kind: "landing", rings, z: z + 3.2, fare: null, category: "ceiling" });
      enclose(lv, rings, () => z - 0.18, () => z + 3.2, "shaft");
    }
  }

  // Adjacent parallel escalators share a single shaft, rather than opaque dividers between lanes.
  const shafts: Run[][] = [];
  const ends = (r: Run) => r.a.z < r.b.z ? [r.a, r.b] as const : [r.b, r.a] as const;
  for (const r of layout.runs) {
    if (Math.min(r.a.z, r.b.z) >= -0.5) continue;
    const [lo, hi] = ends(r), d = sub(hi, lo), length = len(d);
    const group = shafts.find(([ref]) => {
      const [a, b] = ends(ref!), rd = sub(b, a);
      return Math.abs(a.z - lo.z) < 0.35 && Math.abs(b.z - hi.z) < 0.35 && len(sub(a, lo)) < 3.6 && len(sub(b, hi)) < 3.6 && (d.x * rd.x + d.y * rd.y) / (length * len(rd)) > 0.995;
    });
    if (group) group.push(r); else shafts.push([r]);
  }
  for (const [si, group] of shafts.entries()) {
    const [lo, hi] = ends(group[0]!);
    const d = sub(hi, lo), l2 = d.x * d.x + d.y * d.y;
    const slope = { x: d.x * (hi.z - lo.z) / l2, y: d.y * (hi.z - lo.z) / l2 };
    const base = (p: XY) => lo.z + slope.x * (p.x - lo.x) + slope.y * (p.y - lo.y);
    const rise = Math.max(...group.flatMap((r) => [r.a.z - base(r.a), r.b.z - base(r.b)])) + 3.0;
    const lv = levelAt(lo.z);
    const envelope = union(group.map((r) => [passageRing(r.a, r.b, r.width / 2 + 0.35, 0.25)]));
    for (const [i, rings] of envelope.entries()) {
      // Surface exits stay open to the street worker's scene. Crop the pitched roof at -0.51 m.
      const roof: Soffit = { spaceId: `shaft-roof:${si}:${i}`, floorId: lv.floorId, kind: "shaft", rings, origin: lo, slope, z: lo.z + rise, fare: null, category: "ceiling" };
      const cropped = cropUndergroundRoof(roof);
      for (const s of cropped) addRoof(s);
      enclose(lv, rings, (p) => base(p) - 0.3, (p) => base(p) + rise, "shaft");
    }
    // Raised short collars bridge the clearance cut at the tangent change between an
    // inclined shaft and a flat hall. Without this step, two individually safe cut roofs
    // can leave a thin open slit immediately above the first/last tread.
    for (const end of [0, 1]) {
      const mouths = group.map((r) => ends(r)[end]!);
      const z = mouths[0]!.z;
      if (z + 3.4 >= -0.5) continue;
      const L = Math.sqrt(l2), u = { x: d.x / L, y: d.y / L };
      const collars = union(group.map((r, i) => {
        const p = mouths[i]!;
        return [passageRing({ x: p.x - u.x * 0.85, y: p.y - u.y * 0.85 }, { x: p.x + u.x * 0.85, y: p.y + u.y * 0.85 }, r.width / 2 + 0.35)];
      }));
      for (const [i, rings] of collars.entries()) {
        addRoof({ spaceId: `shaft-collar:${si}:${end}:${i}`, floorId: lv.floorId, kind: "landing", rings, z: z + 3.4, fare: null, category: "ceiling" });
        enclose(lv, rings, (p) => Math.min(z + 3.4, base(p) + rise), (p) => Math.max(z + 3.4, base(p) + rise), "shaft");
      }
    }
  }

  // Use the actual cut slabs, including hole rings: all exposed edges get a 180 mm fascia,
  // and the underside has its own finish rather than showing a reversed floor material.
  for (const lv of underground) {
    const slabs = [...lv.slabs, ...layout.pads.filter((p) => p.z < -0.5 && levelAt(p.z) === lv), ...layout.linkStrips.filter((p) => p.z < -0.5 && levelAt(p.z) === lv)];
    for (const s of slabs) {
      addRoof({ ...s, spaceId: `underside:${s.spaceId}`, z: s.z - 0.18, floorId: lv.floorId, kind: "slab" });
      enclose(lv, s.rings, () => s.z - 0.18, () => s.z - 0.008, "fascia");
    }
  }
}

/** Clip an affine roof to z < -0.5 without changing its pitch. */
function cropUndergroundRoof(s: Soffit): Soffit[] {
  const out: XY[][] = [];
  // Shaft footprints have no interior holes before clearance carving.
  for (const ring of s.rings) {
    const result: XY[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      const za = soffitHeight(s, a), zb = soffitHeight(s, b);
      if (za <= -0.51) result.push(a);
      if ((za <= -0.51) !== (zb <= -0.51)) result.push(lerp(a, b, (-0.51 - za) / (zb - za)));
    }
    if (result.length >= 3) out.push(result);
  }
  return out.length ? [{ ...s, rings: out }] : [];
}

export function centroid(r: XY[]): XY {
  let x = 0;
  let y = 0;
  const n = r.length - (r.length > 1 && r[0]!.x === r[r.length - 1]!.x && r[0]!.y === r[r.length - 1]!.y ? 1 : 0);
  for (let i = 0; i < n; i++) (x += r[i]!.x), (y += r[i]!.y);
  return { x: x / n, y: y / n };
}

function mergeCollinear(walls: WallSeg[]): WallSeg[] {
  return walls.filter((w) => len(sub(w.b, w.a)) > 0.05);
}

// ---------------------------------------------------------------- walk surfaces (analytic collision)
export interface WalkSurface {
  kind: "slab" | "run";
  /** for slabs */
  rings?: XY[][];
  z?: number;
  /** for runs */
  run?: Run;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class WalkWorld {
  private readonly surfaces: WalkSurface[] = [];
  private readonly walls: WallSeg[] = [];
  private readonly cell = 4;
  private readonly grid = new Map<string, number[]>();
  private readonly wallGrid = new Map<string, number[]>();

  constructor(layout: Layout) {
    for (const lv of layout.levels) for (const s of lv.slabs) this.addSlab(s);
    for (const p of layout.pads) this.addSlab(p);
    for (const r of layout.runs) {
      const hw = r.width / 2 + 0.05;
      this.add({ kind: "run", run: r, minX: Math.min(r.a.x, r.b.x) - hw, minY: Math.min(r.a.y, r.b.y) - hw, maxX: Math.max(r.a.x, r.b.x) + hw, maxY: Math.max(r.a.y, r.b.y) + hw });
    }
    for (const lv of layout.levels) for (const w of lv.walls) this.addWall(w);
    for (const w of layout.runWalls) this.addWall(w);
    for (const w of railingWalls(layout)) this.addWall(w);
    for (const st of layout.linkStrips) this.addSlab(st);
    for (const st of layout.streetPads) this.addSlab(st);
  }

  addWalls(ws: WallSeg[]) {
    for (const w of ws) this.addWall(w);
  }

  addSlab(s: SlabPoly) {
    const ring = s.rings[0]!;
    this.add({ kind: "slab", rings: s.rings, z: s.z, minX: Math.min(...ring.map((p) => p.x)), minY: Math.min(...ring.map((p) => p.y)), maxX: Math.max(...ring.map((p) => p.x)), maxY: Math.max(...ring.map((p) => p.y)) });
  }
  private add(s: WalkSurface) {
    const i = this.surfaces.push(s) - 1;
    for (let gx = Math.floor(s.minX / this.cell); gx <= Math.floor(s.maxX / this.cell); gx++)
      for (let gy = Math.floor(s.minY / this.cell); gy <= Math.floor(s.maxY / this.cell); gy++) {
        const k = `${gx},${gy}`;
        const l = this.grid.get(k);
        if (l) l.push(i);
        else this.grid.set(k, [i]);
      }
  }
  private addWall(w: WallSeg) {
    const i = this.walls.push(w) - 1;
    for (let gx = Math.floor(Math.min(w.a.x, w.b.x) / this.cell); gx <= Math.floor(Math.max(w.a.x, w.b.x) / this.cell); gx++)
      for (let gy = Math.floor(Math.min(w.a.y, w.b.y) / this.cell); gy <= Math.floor(Math.max(w.a.y, w.b.y) / this.cell); gy++) {
        const k = `${gx},${gy}`;
        const l = this.wallGrid.get(k);
        if (l) l.push(i);
        else this.wallGrid.set(k, [i]);
      }
  }

  /** All ground heights under p. */
  heightsAt(p: XY): number[] {
    const slabs: number[] = [];
    const runs: number[] = [];
    for (const i of this.grid.get(`${Math.floor(p.x / this.cell)},${Math.floor(p.y / this.cell)}`) ?? []) {
      const s = this.surfaces[i]!;
      if (p.x < s.minX || p.x > s.maxX || p.y < s.minY || p.y > s.maxY) continue;
      if (s.kind === "slab") {
        if (pointInRings(p, s.rings!)) slabs.push(s.z!);
      } else {
        const r = s.run!;
        const ab = sub(r.b, r.a);
        const L2 = ab.x * ab.x + ab.y * ab.y || 1;
        const t = ((p.x - r.a.x) * ab.x + (p.y - r.a.y) * ab.y) / L2;
        if (t < 0 || t > 1) continue;
        const q = lerp(r.a, r.b, t);
        if (len(sub(p, q)) <= r.width / 2) runs.push(r.a.z + (r.b.z - r.a.z) * t);
      }
    }
    // stairwells are cut into the slab geometry itself (cutStairwells)
    return [...slabs, ...runs];
  }
  groundAt(p: XY, z: number, up = 0.45, down = 0.7): number | null {
    let best: number | null = null;
    for (const h of this.heightsAt(p)) if (h <= z + up && h >= z - down && (best === null || h > best)) best = h;
    return best;
  }

  /** Fraction t∈[0,1] along a→b of the first wall crossing at height z (camera occlusion), or 1. */
  firstWallHit(a: XY, b: XY, z: number): number {
    let best = 1;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    const seen = new Set<number>();
    for (let gx = Math.floor(minX / this.cell); gx <= Math.floor(maxX / this.cell); gx++)
      for (let gy = Math.floor(minY / this.cell); gy <= Math.floor(maxY / this.cell); gy++)
        for (const i of this.wallGrid.get(`${gx},${gy}`) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          const w = this.walls[i]!;
          if (z < w.zMin || z > w.zMax) continue;
          const rx = b.x - a.x;
          const ry = b.y - a.y;
          const sx = w.b.x - w.a.x;
          const sy = w.b.y - w.a.y;
          const den = rx * sy - ry * sx;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((w.a.x - a.x) * sy - (w.a.y - a.y) * sx) / den;
          const u = ((w.a.x - a.x) * ry - (w.a.y - a.y) * rx) / den;
          if (t >= 0 && t < best && u >= 0 && u <= 1) best = t;
        }
    return best;
  }

  /** Push circle (p, radius) out of walls overlapping height band [z, z+1.7]. */
  resolveWalls(p: XY, z: number, radius: number): XY {
    let q = { ...p };
    for (let iter = 0; iter < 3; iter++) {
      const seen = new Set<number>();
      for (let gx = Math.floor((q.x - radius) / this.cell); gx <= Math.floor((q.x + radius) / this.cell); gx++)
        for (let gy = Math.floor((q.y - radius) / this.cell); gy <= Math.floor((q.y + radius) / this.cell); gy++)
          for (const i of this.wallGrid.get(`${gx},${gy}`) ?? []) {
            if (seen.has(i)) continue;
            seen.add(i);
            const w = this.walls[i]!;
            if (z + 1.7 < w.zMin || z + 0.3 > w.zMax || (w.bodyMax !== undefined && z > w.bodyMax) || (w.bodyMin !== undefined && z < w.bodyMin)) continue;
            const ab = sub(w.b, w.a);
            const L2 = ab.x * ab.x + ab.y * ab.y || 1;
            const t = Math.max(0, Math.min(1, ((q.x - w.a.x) * ab.x + (q.y - w.a.y) * ab.y) / L2));
            const c = lerp(w.a, w.b, t);
            const dv = sub(q, c);
            const d = len(dv);
            if (d < radius && d > 1e-6) q = { x: c.x + (dv.x / d) * radius, y: c.y + (dv.y / d) * radius };
          }
    }
    return q;
  }
}
