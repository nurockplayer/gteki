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
  /** Walk-only ground strips along flat verified links (not rendered): the graph guarantees passage. */
  linkStrips: SlabPoly[];
  /** Stair/escalator balustrades as ~1 m wall pieces with local height bands (open where a link crosses). */
  runWalls: WallSeg[];
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
              else walls.push({ a: runStart, b: end, zMin: z, zMax: ceilingZ, side: ccw ? 1 : -1, kind: runKind, bodyMax: z + 1.0 });
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
  const segs: { a: XY & { z: number }; b: XY & { z: number }; edgeId: string }[] = [];
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
      segs.push({ a: { ...pts[i - 1]!, z: z0 }, b: { ...pts[i]!, z: z1 }, edgeId: e.id });
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
        const closed = k < n && !clearAt(lerp(w.a, w.b, (k + 0.5) / n), lv.z - 0.3, lv.z + 1.2);
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
        if (clearAt(lerp(a, b, 0.5), zMin - 1.7, zMax, r.edgeId)) continue;
        runWalls.push({ a, b, zMin, zMax, side: 1, kind: "wall" });
      }
    }
  }

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
      const h = 0.5;
      const n = { x: -u.y * h, y: u.x * h };
      const a2 = { x: a.x - u.x * h, y: a.y - u.y * h };
      const b2 = { x: b.x + u.x * h, y: b.y + u.y * h };
      linkStrips.push({ spaceId: `link:${e.id}:${i}`, rings: [[{ x: a2.x + n.x, y: a2.y + n.y }, { x: b2.x + n.x, y: b2.y + n.y }, { x: b2.x - n.x, y: b2.y - n.y }, { x: a2.x - n.x, y: a2.y - n.y }, { x: a2.x + n.x, y: a2.y + n.y }]], z: za, fare: null, category: "link" });
    }
  }

  return { levels, runs, tactile, gates, pads, linkStrips, runWalls, nodeZ, bounds: { min, max } };
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
    for (const st of layout.linkStrips) this.addSlab(st);
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
    const runs: { z: number; ends: [number, number] }[] = [];
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
        if (len(sub(p, q)) <= r.width / 2) runs.push({ z: r.a.z + (r.b.z - r.a.z) * t, ends: [r.a.z, r.b.z] });
      }
    }
    // A run descending from a slab's level cuts a stairwell in that slab: where the run is already
    // below the slab (within head clearance), the slab is a hole — otherwise the floor overhangs the
    // stair and makes a cliff. Deeper runs pass under the floor, which stays.
    const kept = slabs.filter((z) => !runs.some((r) => r.z < z - 0.25 && r.z > z - 2.4 && (Math.abs(r.ends[0] - z) < 0.3 || Math.abs(r.ends[1] - z) < 0.3)));
    return [...kept, ...runs.map((r) => r.z)];
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
            if (z + 1.7 < w.zMin || z + 0.3 > w.zMax || (w.bodyMax !== undefined && z > w.bodyMax)) continue;
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
