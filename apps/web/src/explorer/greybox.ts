import type { Edge, StationBundle } from "@gteki/schema";
import { WALKER_BODY } from "@gteki/scene-api";
import * as THREE from "three";
import { edgePoints, R, type V3 } from "./geometry.ts";
import { MODE_WIDTH } from "./graphView.ts";
import type { Segment2 } from "./walker.ts";
import { buildWalkableModel, outsideIntervals, subtractPlan, type PlanPoint, type Region } from "./walkableModel.ts";

/** An edge's floorless samples, extended into the adjacent modelled floor. */
export interface UnmodelledEdgeRun {
  edge: Edge;
  points: V3[];
}

/** Share node, floor and floor-probe caches across independently processed edges. */
function createRunDetector(bundle: StationBundle, traversable: (edge: Edge) => boolean, hasFloor: (p: V3) => boolean, forced: ReadonlySet<string> = new Set()): (edge: Edge) => UnmodelledEdgeRun[] {
  const nodes = new Map(bundle.nodes.map((node) => [node.id, node]));
  const floors = new Map(bundle.floors.map((floor) => [floor.id, floor]));
  const cache = new Map<string, boolean>();
  const floor = (p: V3) => {
    const key = `${Math.round(p.x * 100)},${Math.round(p.y * 100)},${Math.round(p.z * 100)}`;
    let value = cache.get(key);
    if (value === undefined) { value = hasFloor(p); cache.set(key, value); }
    return value;
  };
  return (edge) => {
    const out: UnmodelledEdgeRun[] = [];
    // Forced edges (skipped connectors) are detected whatever their mode, as they are unmodelled whole.
    if (!traversable(edge) || (!forced.has(edge.id) && !["walk", "gate", "moving_walkway", "ramp"].includes(edge.mode))) return out;
    const points = edgePoints(bundle, edge, nodes, floors).map((p) => ({ x: p.x, y: -p.z, z: p.y }));
    if (points.length < 2) return out;
    const samples: V3[] = [points[0]!];
    const distances = [0];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      const count = Math.max(1, Math.ceil(length / 0.5));
      const start = distances.at(-1)!;
      for (let k = 1; k <= count; k++) {
        samples.push({ x: a.x + (b.x - a.x) * k / count, y: a.y + (b.y - a.y) * k / count, z: a.z + (b.z - a.z) * k / count });
        distances.push(start + length * k / count);
      }
    }
    const pointAt = (distance: number): V3 => {
      let k = 1;
      while (k < distances.length - 1 && distances[k]! < distance) k++;
      const a = samples[k - 1]!, b = samples[k]!;
      const span = distances[k]! - distances[k - 1]!;
      const t = span ? (distance - distances[k - 1]!) / span : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    };
    // Forced edges (skipped connectors) are unmodelled whole, as sceneGap edges are.
    const flagged = edge.attributes?.sceneGap === true || forced.has(edge.id);
    const bare = samples.map((p) => flagged || !floor(p));
    for (let i = 0; i < samples.length; i++) {
      if (!bare[i]) continue;
      let end = i;
      while (end + 1 < samples.length && bare[end + 1]) end++;
      // The gap can reach the neighbouring floored samples, so measure up to them: a 1.2 m gap may hold only two bare samples.
      const length = distances[Math.min(end + 1, samples.length - 1)]! - distances[Math.max(i - 1, 0)]!;
      if (length >= 1 || flagged) {
        const start = Math.max(0, distances[i]! - 0.5);
        const finish = Math.min(distances.at(-1)!, distances[end]! + 0.5);
        const inside = samples.filter((_p, k) => distances[k]! > start && distances[k]! < finish);
        out.push({ edge, points: [pointAt(start), ...inside, pointAt(finish)] });
      }
      i = end;
    }
    return out;
  };
}

/** Find passage candidates without changing the station or retaining its geometry on disk. */
export function unmodelledRunsByEdge(bundle: StationBundle, traversable: (edge: Edge) => boolean, hasFloor: (p: V3) => boolean, forced: ReadonlySet<string> = new Set()): UnmodelledEdgeRun[] {
  const detect = createRunDetector(bundle, traversable, hasFloor, forced);
  return bundle.edges.flatMap(detect);
}

/** An oriented opening in renderer coordinates; center is at floor level, and axes are horizontal unit vectors. */
export interface Box {
  center: THREE.Vector3;
  along: THREE.Vector3;
  across: THREE.Vector3;
  wallNormal?: THREE.Vector3;
  width: number;
  depth: number;
  height: number;
}

/** Unit normal to the portal wall; passage direction is the fallback when no face was hit. */
export function portalDepthAxis(box: Box): THREE.Vector3 { return box.wallNormal ?? box.along; }
export function portalWidthAxis(box: Box): THREE.Vector3 {
  if (!box.wallNormal) return box.across;
  const n = box.wallNormal;
  return new THREE.Vector3(-n.z, 0, n.x);
}

export interface GreyboxStats { runs: number; landingPads: number; lengthM: number; portals: number; meshes: number; triangles: number; buildMs: number; overBudget: string | null }
export const greyboxTriangleLimit = (tier: "high" | "low"): number => tier === "high" ? 150000 : 100000;
export interface GreyboxScene {
  colliderNear(p: V3, r: number): boolean;
  /** `wallsOnly`: only the station's wall segments count, never a collider such as a column or a ticket machine. */
  wallHit(a: V3, b: V3, wallsOnly?: boolean): (V3 & { wallNormal?: THREE.Vector3 }) | null;
}

/** Clip a wall against oriented openings, preserving the wall above and below an opening. */
export function splitWallsAtOpenings(walls: readonly Segment2[], openings: readonly Box[]): Segment2[] {
  let result = [...walls];
  for (const box of openings) {
    const next: Segment2[] = [];
    for (const w of result) {
      const bottom = box.center.y, top = bottom + box.height;
      if (w.yMax <= bottom || w.yMin >= top) { next.push(w); continue; }
      let lo = 0, hi = 1;
      const x = w.ax - box.center.x, z = w.az - box.center.z;
      const dx = w.bx - w.ax, dz = w.bz - w.az;
      for (const [axis, extent] of [[portalWidthAxis(box), box.width / 2], [portalDepthAxis(box), box.depth / 2]] as const) {
        const origin = x * axis.x + z * axis.z, delta = dx * axis.x + dz * axis.z;
        if (Math.abs(delta) < 1e-9) { if (Math.abs(origin) > extent) { lo = 1; hi = 0; break; } continue; }
        const a = (-extent - origin) / delta, b = (extent - origin) / delta;
        lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
      }
      if (lo >= hi) { next.push(w); continue; }
      const piece = (a: number, b: number, yMin: number, yMax: number) => {
        if (b - a > 1e-9 && yMax > yMin) next.push({ source: w.source, role: w.role, ax: w.ax + dx * a, az: w.az + dz * a, bx: w.ax + dx * b, bz: w.az + dz * b, yMin, yMax });
      };
      piece(0, lo, w.yMin, w.yMax); piece(hi, 1, w.yMin, w.yMax);
      piece(lo, hi, w.yMin, Math.min(w.yMax, bottom));
      piece(lo, hi, Math.max(w.yMin, top), w.yMax);
    }
    result = next;
  }
  return result;
}

type Batch = { shell: number[]; colors: number[]; ceiling: number[]; ceilingColors: number[]; lights: number[]; lightColors: number[]; kerb: number[]; portal: number[]; portalColors: number[] };
const batch = (): Batch => ({ shell: [], colors: [], ceiling: [], ceilingColors: [], lights: [], lightColors: [], kerb: [], portal: [], portalColors: [] });
const enu = (v: THREE.Vector3): V3 => ({ x: v.x, y: -v.z, z: v.y });

/** Append a two-sided quad; vertex shade is baked into the shell's vertex colours. */
function quad(out: number[], colors: number[] | null, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, shades: readonly [number, number, number, number] = [1, 1, 1, 1]): void {
  const points = [a, b, c, a, c, d];
  const indices = [0, 1, 2, 0, 2, 3];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!; out.push(p.x, p.y, p.z);
    if (colors) { const shade = shades[indices[i]!]!; colors.push(shade, shade, shade); }
  }
}

/**
 * A planar floor or ceiling quad (corners in winding order) with the plan rings it loses taken out: a quad no cut
 * touches is emitted as before; a cut face is triangulated from what is left, on the face's own plane and facing.
 */
function cutFace(out: number[], colors: number[] | null, corners: readonly THREE.Vector3[], cuts: readonly PlanPoint[][] | undefined, shade: number): void {
  if (!cuts?.length && corners.length === 4) { quad(out, colors, corners[0]!, corners[1]!, corners[2]!, corners[3]!, [shade, shade, shade, shade]); return; }
  const [a, b, c] = corners as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  const u = b.clone().sub(a), v = c.clone().sub(a), normal = u.clone().cross(v);
  if (Math.abs(normal.y) < 1e-12) return;
  const yAt = (x: number, z: number) => a.y - (normal.x * (x - a.x) + normal.z * (z - a.z)) / normal.y;
  for (const polygon of subtractPlan(corners.map((p) => ({ x: p.x, z: p.z })), cuts ?? [])) {
    const rings = polygon.map((ring) => ring.map((p) => new THREE.Vector2(p.x, p.z)));
    // triangulateShape drops a repeated closing point from the rings in place, so they are flattened after it.
    const triangles = THREE.ShapeUtils.triangulateShape(rings[0]!, rings.slice(1)), flat = rings.flat();
    for (const triangle of triangles) {
      const p = flat[triangle[0]!]!, q = flat[triangle[1]!]!, r = flat[triangle[2]!]!;
      // Plan winding against the face's own: keep the face's facing (its normal's sign in y).
      const turn = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      const [m, n] = (turn < 0) === (normal.y > 0) ? [q, r] : [r, q];
      for (const w of [p, m, n]) { out.push(w.x, yAt(w.x, w.y), w.y); if (colors) colors.push(shade, shade, shade); }
    }
  }
}

export function widthOf(edge: Edge): number {
  // The public schema currently permits only scalar attributes; accept a structured runtime width when supplied.
  const width = (edge.attributes as unknown as { width?: { m?: unknown } } | undefined)?.width?.m;
  return typeof width === "number" && Number.isFinite(width) && width > 0 ? width : MODE_WIDTH[edge.mode] ?? 2;
}

// A shifted pad reaches this far past its node, so the node and the walk edges leaving it stand on floor, not on the pad's rim.
const PAD_OVERLAP_M = 0.3;
type LandingPad = { nodeId:string; floorId:string; center:THREE.Vector3; along:THREE.Vector3; width:number; openSides:Set<number>; shifted:boolean; strip?:UnmodelledEdgeRun };

/** A pad uses the node's render elevation; its optional strip follows an adjacent graph edge. */
function landingPadsForEdge(bundle:StationBundle, edge:Edge, traversable:(edge:Edge)=>boolean, hasFloor:(p:V3)=>boolean, nodes:Map<string,StationBundle["nodes"][number]>, floors:Map<string,StationBundle["floors"][number]>): LandingPad[] {
  if (!traversable(edge) || !["stairs","escalator","elevator"].includes(edge.mode)) return [];
  const vertical=edgePoints(bundle,edge,nodes,floors); if (vertical.length<2) return [];
  const result:LandingPad[]=[];
  for (const [id,center,other] of [[edge.from,vertical[0]!,vertical.at(-1)!],[edge.to,vertical.at(-1)!,vertical[0]!]] as const) {
    const node=nodes.get(id); if (!node || hasFloor(enu(center))) continue;
    const adjacent=bundle.edges.filter(e=>!["stairs","escalator","elevator"].includes(e.mode) && (e.from===id || e.to===id) && traversable(e));
    let along=other.clone().sub(center); along.y=0;
    // A rising flight's pad lies beside it, on the landing side, so the flight never passes through its floor or ceiling.
    // A level edge keeps its pad centred: it has nothing to pass through, and its far end needs the floor.
    // A lift keeps its pad centred on the car node (#645 follow-up).
    let away=edge.mode==="elevator" || Math.abs(other.y-center.y)<0.2 ? 0 : -1;
    if (along.lengthSq()<1e-10) {
      if (away) away=1;
      const e=adjacent[0], points=e ? edgePoints(bundle,e,nodes,floors) : [];
      if (e?.to===id) points.reverse();
      along=points.length>1 ? points[1]!.clone().sub(center) : new THREE.Vector3(1,0,0); along.y=0;
    }
    if (along.lengthSq()<1e-10) along.set(1,0,0); else along.normalize();
    const across=new THREE.Vector3(-along.z,0,along.x), openSides=new Set<number>();
    for (const incident of bundle.edges) {
      if (incident.id===edge.id || (incident.from!==id && incident.to!==id) || !traversable(incident)) continue;
      const points=edgePoints(bundle,incident,nodes,floors); if (incident.to===id) points.reverse();
      if (points.length<2) continue;
      const direction=points[1]!.clone().sub(center); direction.y=0;
      if (Math.abs(direction.dot(across))>Math.abs(direction.dot(along))) openSides.add(Math.sign(direction.dot(across)));
    }
    let best:{distance:number;strip:UnmodelledEdgeRun}|undefined;
    for (const e of adjacent) {
      const otherId=e.from===id ? e.to:e.from; if (nodes.get(otherId)?.floorId!==node.floorId) continue;
      const points=edgePoints(bundle,e,nodes,floors); if (e.to===id) points.reverse();
      if (points.length<2) continue;
      const direction=points[1]!.clone().sub(center); direction.y=0;
      if (Math.abs(direction.dot(across))>Math.abs(direction.dot(along))) openSides.add(Math.sign(direction.dot(across)));
      let distance=0; const strip:V3[]=[enu(center)];
      for (let i=1;i<points.length && distance<3;i++) {
        const a=points[i-1]!, b=points[i]!, len=a.distanceTo(b); if (len<1e-8) continue;
        const count=Math.max(1,Math.ceil(len/0.5));
        let hit=false;
        for (let k=1;k<=count;k++) {
          const d=distance+len*k/count; if (d>3+1e-9) break;
          const p=enu(a.clone().lerp(b,k/count)); strip.push(p);
          if (hasFloor(p)) { if (!best || d<best.distance) best={distance:d,strip:{edge:e,points:[...strip]}}; hit=true; break; }
        }
        distance+=len; if (hit) break;
      }
    }
    const width=Math.max(1.5,widthOf(edge));
    result.push({nodeId:id,floorId:node.floorId,center:center.clone().addScaledVector(along,away*(width/2-PAD_OVERLAP_M)),along,width,openSides,shifted:away!==0,...(best ? {strip:best.strip} : {})});
  }
  return result;
}


/** Douglas–Peucker in plan and height, retaining the vertices needed for portal transitions. */
export function simplifyGreyboxRun(points: readonly V3[], preserve: readonly number[] = []): V3[] {
  if (points.length <= 2) return [...points];
  const keep = new Set([0, points.length - 1, ...preserve]);
  const anchors = [...keep].filter((i) => i >= 0 && i < points.length).sort((a, b) => a - b);
  const stack: [number, number][] = anchors.slice(1).map((b, i) => [anchors[i]!, b]);
  while (stack.length) {
    const [first, last] = stack.pop()!, a = points[first]!, b = points[last]!;
    const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    let worst = 1, index = -1;
    for (let i = first + 1; i < last; i++) {
      const p = points[i]!;
      const t = length2 ? THREE.MathUtils.clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / length2, 0, 1) : 0;
      const plan = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) / 0.05;
      const height = Math.abs(p.z - (a.z + t * (b.z - a.z))) / 0.05;
      const error = Math.max(plan, height);
      if (error > worst) { worst = error; index = i; }
    }
    if (index >= 0) { keep.add(index); stack.push([first, index], [index, last]); }
  }
  return [...keep].filter((i) => i >= 0 && i < points.length).sort((a, b) => a - b).map((i) => points[i]!);
}

type Corridor = { a: THREE.Vector3; b: THREE.Vector3; radius: number; half: number };

/** A one-metre spatial hash of built corridors; coverage is clipped in plan and within 0.5 m in height. */
class CorridorIndex {
  // Each row stores an inclusive span of one-metre x cells, avoiding an entry per metre of a long corridor.
  private readonly cells = new Map<string, { minX: number; maxX: number; corridor: Corridor }[]>();
  private visit(a: THREE.Vector3, b: THREE.Vector3, padding: number, fn: (key: string, minX: number, maxX: number) => void): void {
    const r = padding + 1, dz = b.z - a.z, dx = b.x - a.x;
    const z0 = Math.floor(Math.min(a.z, b.z) - r), z1 = Math.floor(Math.max(a.z, b.z) + r);
    const y0 = Math.floor((Math.min(a.y, b.y) - 0.5) * 2), y1 = Math.floor((Math.max(a.y, b.y) + 0.5) * 2);
    for (let z = z0; z <= z1; z++) {
      let t0 = 0, t1 = 1;
      if (Math.abs(dz) > 1e-9) {
        const u = (z - r - a.z) / dz, v = (z + 1 + r - a.z) / dz;
        t0 = Math.max(0, Math.min(u, v)); t1 = Math.min(1, Math.max(u, v));
        if (t0 > t1) continue;
      }
      const x0 = Math.floor(Math.min(a.x + t0 * dx, a.x + t1 * dx) - r), x1 = Math.floor(Math.max(a.x + t0 * dx, a.x + t1 * dx) + r);
      for (let y = y0; y <= y1; y++) fn(`${z},${y}`, x0, x1);
    }
  }
  add(a: THREE.Vector3, b: THREE.Vector3, half: number): void {
    const corridor = { a: a.clone(), b: b.clone(), radius: Math.max(0, half - 0.2), half };
    this.visit(a, b, corridor.radius, (key, minX, maxX) => { let cell = this.cells.get(key); if (!cell) { cell = []; this.cells.set(key, cell); } cell.push({ minX, maxX, corridor }); });
  }
  /** Uncovered parameter intervals for a segment. */
  uncovered(a: THREE.Vector3, b: THREE.Vector3, requiredHalf = 0): [number, number][] {
    const candidates = new Set<Corridor>();
    this.visit(a, b, 0, (key, minX, maxX) => { const row = this.cells.get(key); if (row) for (const span of row) if (span.maxX >= minX && span.minX <= maxX) candidates.add(span.corridor); });
    let open: [number, number][] = [[0, 1]];
    for (const c of candidates) {
      if (c.half < requiredHalf - 0.2) continue;
      const dx = c.b.x - c.a.x, dz = c.b.z - c.a.z, len = Math.hypot(dx, dz);
      if (len < 1e-8 || c.radius <= 0) continue;
      const ux = dx / len, uz = dz / len, vx = b.x - a.x, vz = b.z - a.z;
      const px = a.x - c.a.x, pz = a.z - c.a.z;
      let lo = 0, hi = 1;
      const clip = (origin: number, delta: number, min: number, max: number) => {
        if (Math.abs(delta) < 1e-9) { if (origin < min || origin > max) { lo = 1; hi = 0; } return; }
        const x = (min - origin) / delta, y = (max - origin) / delta;
        lo = Math.max(lo, Math.min(x, y)); hi = Math.min(hi, Math.max(x, y));
      };
      const along0 = px * ux + pz * uz, alongD = vx * ux + vz * uz;
      clip(along0, alongD, 0, len);
      clip(px * -uz + pz * ux, vx * -uz + vz * ux, -c.radius, c.radius);
      const slope = (c.b.y - c.a.y) / len;
      clip(a.y - c.a.y - along0 * slope, b.y - a.y - alongD * slope, -0.5, 0.5);
      if (lo >= hi) continue;
      open = open.flatMap(([s, e]) => [[s, Math.min(e, lo)], [Math.max(s, hi), e]].filter(([x, y]) => y! - x! > 1e-7) as [number, number][]);
      if (!open.length) break;
    }
    return open;
  }
}

/** Incremental floor-run discovery. Bounds and focus use renderer coordinates.
 * Scene collider and wall probes still occur in emit; this is not yet a fully time-sliced builder.
 */
export function createGreyboxBuilder(bundle: StationBundle, traversable: (edge: Edge) => boolean, hasFloor: (p: V3) => boolean, scene: GreyboxScene, tier: "high" | "low", focus = new THREE.Vector3(), captureNav = false) {
  const detect = createRunDetector(bundle, traversable, hasFloor);
  const nodes = new Map(bundle.nodes.map((node) => [node.id, node]));
  const floors = new Map(bundle.floors.map((floor) => [floor.id, floor]));
  const entries = bundle.edges.map((edge, index) => {
    const bounds = new THREE.Box3().setFromPoints(edgePoints(bundle, edge, nodes, floors));
    if (["stairs", "escalator", "elevator"].includes(edge.mode)) bounds.expandByScalar(Math.max(1.5, widthOf(edge)) / 2);
    return { edge, index, bounds, distance: bounds.distanceToPoint(focus), runs: null as UnmodelledEdgeRun[] | null, pads: [] as LandingPad[] };
  }).sort((a, b) => a.distance - b.distance || a.index - b.index);
  let count = 0;
  const probe = (entry: typeof entries[number]) => {
    if (entry.runs !== null) return false;
    entry.runs = detect(entry.edge); entry.pads = landingPadsForEdge(bundle, entry.edge, traversable, hasFloor, nodes, floors); count++;
    return true;
  };
  return {
    get done() { return count === entries.length; },
    get progress() { return entries.length ? count / entries.length : 1; },
    get runs() { return entries.flatMap((entry) => entry.runs ?? []); },
    probeStep(budgetMs: number) {
      const start = performance.now();
      for (const entry of entries) {
        if (entry.runs !== null) continue;
        if (performance.now() - start >= budgetMs) break;
        probe(entry);
      }
      return count === entries.length;
    },
    ensure(bounds: THREE.Box3) {
      let changed = false;
      for (const entry of entries) if (entry.bounds.intersectsBox(bounds)) changed = probe(entry) || changed;
      return changed;
    },
    emit() {
      // Preserve original edge order so global deduplication is independent of probe order.
      const runs = [...entries].sort((a, b) => a.index - b.index).flatMap((entry) => entry.runs ?? []);
      const pads = new Map<string, LandingPad>();
      for (const entry of [...entries].sort((a, b) => a.index - b.index)) for (const pad of entry.pads) {
        const previous = pads.get(pad.nodeId);
        // A pad set beside a rising flight wins over a centred one, which that flight would pass through.
        if (!previous || (pad.shifted && !previous.shifted) || (pad.shifted === previous.shifted && pad.width > previous.width)) pads.set(pad.nodeId, pad);
        else for (const side of pad.openSides) previous.openSides.add(side);
      }
      return emitGreybox(bundle, [...runs, ...[...pads.values()].flatMap((p) => p.strip ? [p.strip] : [])], hasFloor, scene, tier, captureNav, [...pads.values()], traversable);
    },
  };
}

/** Procedural passages, built entirely in memory from the already-loaded graph and scene probes. */
export function buildGreybox(bundle: StationBundle, traversable: (edge: Edge) => boolean, hasFloor: (p: V3) => boolean, scene: GreyboxScene, tier: "high" | "low", captureNav = false) {
  const started = performance.now();
  const builder = createGreyboxBuilder(bundle, traversable, hasFloor, scene, tier, undefined, captureNav);
  builder.probeStep(Infinity);
  const result = builder.emit();
  result.stats.buildMs = performance.now() - started;
  return result;
}

/** Emit the globally deduplicated passage geometry for already-detected runs. */
export function emitGreybox(bundle: StationBundle, detected: readonly UnmodelledEdgeRun[], hasFloor: (p: V3) => boolean, scene: GreyboxScene, tier: "high" | "low", captureNav = false, pads: readonly LandingPad[] = [], traversable: (edge: Edge) => boolean = () => true) {
  const started = performance.now();
  const index = new CorridorIndex();
  for (const pad of pads) index.add(pad.center.clone().addScaledVector(pad.along, -pad.width / 2), pad.center.clone().addScaledVector(pad.along, pad.width / 2), pad.width / 2);
  const runs: UnmodelledEdgeRun[] = [];
  for (const run of [...detected].sort((a, b) => widthOf(b.edge) - widthOf(a.edge))) {
    const p = run.points;
    const preserve: number[] = [];
    if (p.length > 2 && (hasFloor(p[0]!) !== hasFloor(p[1]!) || (run.edge.attributes?.sceneGap === true && hasFloor(p[0]!)))) preserve.push(1);
    if (p.length > 2 && (hasFloor(p.at(-1)!) !== hasFloor(p.at(-2)!) || (run.edge.attributes?.sceneGap === true && hasFloor(p.at(-1)!)))) preserve.push(p.length - 2);
    const points = simplifyGreyboxRun(p, preserve).map((v) => R(v.x, v.y, v.z));
    let current: V3[] = [];
    const flush = () => { if (current.length > 1) runs.push({ edge: run.edge, points: current }); current = []; };
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      const uncovered = index.uncovered(a, b, widthOf(run.edge) / 2);
      if (!uncovered.length) { flush(); continue; }
      for (const [start, end] of uncovered) {
        const from = a.clone().lerp(b, start), to = a.clone().lerp(b, end);
        if (current.length && R(current.at(-1)!.x, current.at(-1)!.y, current.at(-1)!.z).distanceTo(from) > 1e-6) flush();
        if (!current.length) current.push(enu(from));
        current.push(enu(to));
        index.add(from, to, widthOf(run.edge) / 2);
        if (end < 1 - 1e-7) flush();
      }
    }
    flush();
  }
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const floors = new Map(bundle.floors.map((f) => [f.id, f]));
  const junctions = new Map<string, { at: THREE.Vector3; width: number; count: number; floor: string; edges: Set<string>; bendOf?: Edge }>();
  for (const run of detected) {
    const edgePointsR = edgePoints(bundle, run.edge, nodes, floors);
    for (const [id, point, endpoint] of [[run.edge.from, run.points[0], edgePointsR[0]], [run.edge.to, run.points.at(-1), edgePointsR.at(-1)]] as const) {
      if (!point || !endpoint || R(point.x, point.y, point.z).distanceTo(endpoint) > 1e-5) continue;
      const current = junctions.get(id);
      if (current) { current.count++; current.width = Math.max(current.width, widthOf(run.edge)); current.edges.add(run.edge.id); }
      else junctions.set(id, { at: endpoint, width: widthOf(run.edge), count: 1, floor: nodes.get(id)?.floorId ?? "", edges: new Set([run.edge.id]) });
    }
    // Bends in a single edge need the same patch as graph-node junctions.
    for (let i = 1; i + 1 < run.points.length; i++) {
      const a = run.points[i - 1]!, p = run.points[i]!, z = run.points[i + 1]!;
      const ax = p.x - a.x, ay = p.y - a.y, bx = z.x - p.x, by = z.y - p.y;
      const lengths = Math.hypot(ax, ay) * Math.hypot(bx, by);
      if (lengths > 1e-9 && (ax * bx + ay * by) / lengths < 0.9999) {
        junctions.set(`${run.edge.id}:bend:${i}`, { at: R(p.x, p.y, p.z), width: widthOf(run.edge), count: 2, floor: nodes.get(run.edge.from)?.floorId ?? "", edges: new Set([run.edge.id]), bendOf: run.edge });
      }
    }
  }
  // Flights are height-aware opening regions; the model keeps the corridor's boundary beyond step attachments.
  const flights: Region[] = [];
  for (const edge of bundle.edges) {
    if (!["stairs", "escalator", "elevator"].includes(edge.mode) || !traversable(edge)) continue;
    const points = edgePoints(bundle, edge, nodes, floors);
    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1]!, to = points[i]!;
      const dx = to.x - from.x, dz = to.z - from.z, length = Math.hypot(dx, dz);
      if (length < 1e-6) continue;
      const half = widthOf(edge) / 2, nx = -dz / length * half, nz = dx / length * half;
      flights.push({ kind: "connector", level: "", y: from.y, flight: { from, to }, quad: [
        { x: from.x + nx, z: from.z + nz }, { x: to.x + nx, z: to.z + nz },
        { x: to.x - nx, z: to.z - nz }, { x: from.x - nx, z: from.z - nz },
      ] });
    }
  }
  const activeJunctions = [...junctions.values()].filter((junction) => junction.count >= 2);
  const batches = new Map<string, Batch>();
  const floorBatches = new Map<string, string>();
  const getBatch = (floor: string) => {
    let key = tier === "low" ? "all" : floorBatches.get(floor);
    if (key === undefined) {
      key = batches.size < 4 ? floor : [...batches.keys()][3]!;
      floorBatches.set(floor, key);
    }
    let b = batches.get(key); if (!b) { b = batch(); batches.set(key, b); } return b;
  };
  const navFloors: number[] = [];
  const openings: Box[] = [];
  const wallSegments: Segment2[] = [];
  let lengthM = 0;
  const shellMat = new THREE.MeshLambertMaterial({ color: 0x9a9690, emissive: 0x9a9690, emissiveIntensity: 0.35, vertexColors: true, side: THREE.DoubleSide });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false, side: THREE.DoubleSide });
  const kerbMat = new THREE.MeshBasicMaterial({ color: 0xffb547, toneMapped: false, side: THREE.DoubleSide });
  // Every wall comes from one per-level walkable union: strips, pads, junction discs and the connector footprints the
  // mouths cut. A boundary edge inside a connector's own footprint belongs to that connector, not to the corridor.
  const levelOf = (floor: string): string => floor;
  // A run between two floors (a ramp) is its own level, its bends included: it meets each floor through a step-high
  // attachment, and never unions with a corridor it passes over or under.
  const runLevel = (edge: Edge): string => {
    const fromFloor = nodes.get(edge.from)?.floorId ?? "", toFloor = nodes.get(edge.to)?.floorId ?? "";
    return fromFloor === toFloor ? levelOf(fromFloor) : `run:${edge.id}`;
  };
  const regions: Region[] = [];
  for (const run of runs) {
    regions.push({ kind: "strip", group: run.edge.id, level: runLevel(run.edge), points: run.points.map((p) => R(p.x, p.y, p.z)), halfWidth: widthOf(run.edge) / 2 });
  }
  for (const pad of pads) {
    regions.push({ kind: "rect", level: levelOf(pad.floorId), center: { x: pad.center.x, y: pad.center.y, z: pad.center.z }, along: { x: pad.along.x, z: pad.along.z }, halfLength: pad.width / 2, halfWidth: pad.width / 2 });
  }
  for (const junction of activeJunctions) {
    regions.push({ kind: "disc", ...(junction.bendOf ? { group: junction.bendOf.id } : {}), level: junction.bendOf ? runLevel(junction.bendOf) : levelOf(junction.floor), x: junction.at.x, y: junction.at.y, z: junction.at.z, radius: junction.width / 2 });
  }
  const model = buildWalkableModel([...regions, ...flights], (_wall, outside) => hasFloor(enu(new THREE.Vector3(outside.x, outside.y, outside.z))), WALKER_BODY.stepUpM);
  // Floors and ceilings follow the level stack: a floor standing less than the clearance over another level leaves
  // that part out, and a ceiling another level's floor stands in does too. Regions are runs, then pads, then junctions.
  const uncut = (p: THREE.Vector3, q: THREE.Vector3, cuts: readonly PlanPoint[][]) => {
    const [kept] = outsideIntervals({ x: p.x, z: p.z }, { x: q.x, z: q.z }, cuts);
    return !!kept && kept[0] <= 1e-9 && kept[1] >= 1 - 1e-9;
  };
  const slabCut = (region: number, segment = 0) => model.slabCuts.get(`${region}:${segment}`);
  const ceilingCut = (region: number, segment = 0) => model.ceilingCuts.get(`${region}:${segment}`);
  pads.forEach((pad, k) => {
    const b=getBatch(pad.floorId), half=pad.width/2, across=new THREE.Vector3(-pad.along.z,0,pad.along.x);
    const corner=(a:number,s:number,h:number)=>pad.center.clone().addScaledVector(pad.along,a*half).addScaledVector(across,s*half).add(new THREE.Vector3(0,h,0));
    const al=corner(-1,-1,0), ar=corner(-1,1,0), zl=corner(1,-1,0), zr=corner(1,1,0), region = runs.length + k;
    cutFace(b.shell,b.colors,[ar,zr,zl,al],slabCut(region),0.62);
    if (captureNav) cutFace(navFloors,null,[ar,zr,zl,al],slabCut(region),1);
    cutFace(b.ceiling,b.ceilingColors,[corner(1,-1,2.6),corner(1,1,2.6),corner(-1,1,2.6),corner(-1,-1,2.6)],ceilingCut(region),0.62);
  });
  for (const wall of model.walls) {
    const wb = getBatch(wall.level);
    const length = Math.hypot(wall.bx - wall.ax, wall.bz - wall.az);
    const variation = (values: [number, number, number] | undefined) => values
      ? 2 * Math.max(Math.abs(values[1] - values[0]), Math.abs(values[2] - values[1])) : 0;
    // A collision band uses conservative endpoint heights: keep their vertical change below the body's lower margin.
    const count = wall.topY || wall.bottomY || Math.abs(wall.by - wall.ay) > 1e-6
      ? Math.max(1, Math.ceil(length / 2), Math.ceil(Math.max(Math.abs(wall.by - wall.ay), variation(wall.bottomY), variation(wall.topY)) / WALKER_BODY.bodyBottomM)) : 1;
    const pieces = wall.topY || wall.bottomY ? count + count % 2 : count;
    const heightAt = (values: [number, number, number] | undefined, t: number, fallback: number) => !values ? fallback : t <= 0.5
      ? values[0] + (values[1] - values[0]) * t * 2 : values[1] + (values[2] - values[1]) * (t * 2 - 1);
    const point = (t: number, y: number) => new THREE.Vector3(wall.ax + (wall.bx - wall.ax) * t, y, wall.az + (wall.bz - wall.az) * t);
    for (let i = 0; i < pieces; i++) {
      const t0 = i / pieces, t1 = (i + 1) / pieces;
      const floor0 = wall.ay + (wall.by - wall.ay) * t0, floor1 = wall.ay + (wall.by - wall.ay) * t1;
      const bottom0 = heightAt(wall.bottomY, t0, floor0), bottom1 = heightAt(wall.bottomY, t1, floor1);
      const top0 = Math.min(floor0 + 2.6, heightAt(wall.topY, t0, Infinity)), top1 = Math.min(floor1 + 2.6, heightAt(wall.topY, t1, Infinity));
      if (Math.max(top0 - bottom0, top1 - bottom1) < 1e-3) continue;
      const a = point(t0, bottom0), b = point(t1, bottom1);
      quad(wb.shell, wb.colors, a, b, point(t1, top1), point(t0, top0), [0.62, 0.62, 0.62, 0.62]);
      wallSegments.push({ source: "procedural", role: "greybox_wall", ax: a.x, az: a.z, bx: b.x, bz: b.z,
        yMin: wall.bottomY ? Math.max(bottom0, bottom1) : Math.min(bottom0, bottom1) - 0.12, yMax: wall.topY ? Math.min(top0, top1) : Math.max(top0, top1) });
    }
  }
  // A corridor piece ends at a run end only where the detected run itself ends; a piece cut at a bend continues
  // past it, and that wall is decided by the piece's own vertices.
  const runEnds = new Map<string, V3[]>();
  for (const run of detected) {
    const last = run.points.at(-1);
    if (!last) continue;
    const list = runEnds.get(run.edge.id);
    if (list) list.push(last); else runEnds.set(run.edge.id, [last]);
  }
  const same = (a: V3 | undefined, b: V3 | undefined) => !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6;
  for (const [runIndex, run] of runs.entries()) {
    const width = widthOf(run.edge), half = width / 2;
    const b = getBatch(nodes.get(run.edge.from)?.floorId ?? "");
    const pts = run.points.map((p) => R(p.x, p.y, p.z));
    const finishesRun = !!runEnds.get(run.edge.id)?.some((p) => same(p, run.points.at(-1)));
    // What lies beyond a run's end: the edge's own geometry before/after it, or, at the edge's node, the next point of
    // every other edge there.
    const edgePts = edgePoints(bundle, run.edge, nodes, floors);
    const beyondRun = (end: THREE.Vector3, first: boolean): THREE.Vector3[] => {
      for (let k = 0; k + 1 < edgePts.length; k++) {
        const p = edgePts[k]!, q = edgePts[k + 1]!, dx = q.x - p.x, dz = q.z - p.z, length2 = dx * dx + dz * dz;
        if (!length2) continue;
        const t = ((end.x - p.x) * dx + (end.z - p.z) * dz) / length2;
        if (t < -1e-6 || t > 1 + 1e-6 || Math.hypot(p.x + dx * t - end.x, p.z + dz * t - end.z) > 1e-3) continue;
        const index = first ? (Math.hypot(end.x - p.x, end.z - p.z) < 1e-3 ? k - 1 : k) : (Math.hypot(end.x - q.x, end.z - q.z) < 1e-3 ? k + 2 : k + 1);
        if (index >= 0 && index < edgePts.length) return [edgePts[index]!];
        const node = first ? run.edge.from : run.edge.to;
        return bundle.edges.filter((e) => e.id !== run.edge.id && (e.from === node || e.to === node) && traversable(e))
          .map((e) => { const q2 = edgePoints(bundle, e, nodes, floors); return e.from === node ? q2[1] : q2.at(-2); })
          .filter((q2): q2 is THREE.Vector3 => !!q2);
      }
      return [];
    };
    let travelled = 0, nextLight = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, z = pts[i]!;
      const diff = z.clone().sub(a), length = diff.length(), flat = Math.hypot(diff.x, diff.z);
      if (length < 1e-8 || flat < 1e-8) continue;
      const along = new THREE.Vector3(diff.x / flat, 0, diff.z / flat);
      const across = new THREE.Vector3(-along.z, 0, along.x);
      const offset = (p: THREE.Vector3, side: number, height: number) => p.clone().addScaledVector(across, side).add(new THREE.Vector3(0, height, 0));
      const al = offset(a, -half, 0), ar = offset(a, half, 0), zl = offset(z, -half, 0), zr = offset(z, half, 0);
      const slab = slabCut(runIndex, i), ceiling = ceilingCut(runIndex, i);
      cutFace(b.shell, b.colors, [ar, zr, zl, al], slab, 0.62);
      if (captureNav) cutFace(navFloors, null, [ar, zr, zl, al], slab, 1);
      cutFace(b.shell, b.colors, [offset(a, -half, -0.12), offset(a, half, -0.12), offset(z, half, -0.12), offset(z, -half, -0.12)], slab, 1);
      // The slab's side faces and kerbs keep only their stretches outside the slab cuts.
      for (const side of [-1, 1]) {
        const s0 = offset(a, side * half, 0), s1 = offset(z, side * half, 0);
        for (const [t0, t1] of slab ? outsideIntervals({ x: s0.x, z: s0.z }, { x: s1.x, z: s1.z }, slab) : [[0, 1]]) {
          const from = a.clone().lerp(z, t0!), to = a.clone().lerp(z, t1!);
          quad(b.shell, b.colors, offset(from, side * half, -0.12), offset(to, side * half, -0.12), offset(to, side * half, 0), offset(from, side * half, 0));
          quad(b.kerb, null, offset(from, side * (half - 0.05), 0.005), offset(to, side * (half - 0.05), 0.005), offset(to, side * half, 0.005), offset(from, side * half, 0.005));
        }
      }
      cutFace(b.ceiling, b.ceilingColors, [offset(z, -half, 2.6), offset(z, half, 2.6), offset(a, half, 2.6), offset(a, -half, 2.6)], ceiling, 0.62);
      while (nextLight <= travelled + length) {
        const t = (nextLight - travelled) / length;
        const center = a.clone().lerp(z, t).add(new THREE.Vector3(0, 2.59, 0));
        const p = center.clone().addScaledVector(along, -0.6), q = center.clone().addScaledVector(along, 0.6);
        // A light hangs from the ceiling: none where the ceiling is cut.
        if (t >= 0 && (!ceiling || uncut(p, q, ceiling))) {
          quad(b.lights, b.lightColors, p.clone().addScaledVector(across, -0.075), q.clone().addScaledVector(across, -0.075), q.clone().addScaledVector(across, 0.075), p.clone().addScaledVector(across, 0.075));
        }
        nextLight += 6;
      }
      const pa = run.points[i - 1]!, pz = run.points[i]!;
      // A wall portal: the opening and the frame on both faces, shared by a floor transition and any other wall.
      const openAt = (near: THREE.Vector3, openingWidth: number, wallNormal: THREE.Vector3 | undefined) => {
        openings.push({ center: near.clone(), along: along.clone(), across: across.clone(), ...(wallNormal ? { wallNormal: wallNormal.clone() } : {}), width: openingWidth, depth: 0.6, height: 2.3 });
        const faceAt = (face: number) => near.clone().addScaledVector(along, face * 0.02);
        for (const face of [-1, 1]) {
          const frame = faceAt(face);
          for (const side of [-1, 1]) {
            const outer = side * (half + 0.08), inner = side * half;
            quad(b.portal, b.portalColors, offset(frame, inner, 0), offset(frame, outer, 0), offset(frame, outer, 2.4), offset(frame, inner, 2.4));
            quad(b.kerb, null, offset(frame, inner, 0), offset(frame, inner + side * 0.03, 0), offset(frame, inner + side * 0.03, 2.3), offset(frame, inner, 2.3));
          }
          quad(b.portal, b.portalColors, offset(frame, -half - 0.08, 2.3), offset(frame, half + 0.08, 2.3), offset(frame, half + 0.08, 2.4), offset(frame, -half - 0.08, 2.4));
          quad(b.kerb, null, offset(frame, -half, 2.3), offset(frame, half, 2.3), offset(frame, half, 2.33), offset(frame, -half, 2.33));
        }
      };
      const transition = run.edge.attributes?.sceneGap === true
        ? (i === 1 && hasFloor(pa)) || (i === pts.length - 1 && hasFloor(pz))
        : hasFloor(pa) !== hasFloor(pz);
      if (transition) {
        const hit = scene.wallHit(pa, pz);
        if (hit) {
          const cosine = hit.wallNormal ? Math.abs(along.dot(hit.wallNormal)) : 1;
          openAt(R(hit.x, hit.y, hit.z), width * Math.min(2, 1 / Math.max(cosine, 1e-9)), hit.wallNormal);
        }
      }
      // A floorless run is a passage the station model lacks. It can cross a station wall where its floor never changes
      // (a 2F deck walkway through a building facade), where no transition portal opens: open every station wall the
      // segment crosses, the same way, each opening resuming 0.05 m past its wall (256 walls per segment at most).
      const span = Math.hypot(pz.x - pa.x, pz.z - pa.z);
      if (span > 1e-9) {
        let start = 0;
        for (let n = 0; n < 256; n++) {
          const t = Math.min(1, start / span);
          const from = { x: pa.x + (pz.x - pa.x) * t, y: pa.y + (pz.y - pa.y) * t, z: pa.z + (pz.z - pa.z) * t };
          const hit = scene.wallHit(from, pz, true);
          if (!hit) break;
          const near = R(hit.x, hit.y, hit.z);
          const at = (near.x - a.x) * along.x + (near.z - a.z) * along.z;
          if (at < start - 1e-9) break; // a hit behind the resumed start would repeat forever
          // A hit at a segment end is a vertex: cross it only if the path carries on beyond the wall, by the next
          // segment's end on the wall's far side, or at a run end, which meets floor or another passage beyond it.
          // A hit near a segment start counts when the segment's start and end lie on opposite sides of the wall; a wall
          // through the start vertex itself (side 0) was already decided by the previous segment.
          const side = (p: THREE.Vector3) => { const d = hit.wallNormal ? hit.wallNormal.x * (p.x - near.x) + hit.wallNormal.z * (p.z - near.z) : 0; return Math.abs(d) < 1e-3 ? 0 : Math.sign(d); };
          // A wall through a run's own end is crossed only if something beyond the run lies on the wall's far side.
          const throughRunEnd = (end: THREE.Vector3, inside: THREE.Vector3, first: boolean) => side(inside) !== 0 && beyondRun(end, first).some((p) => side(p) === -side(inside));
          const atEnd = at > flat - 0.05;
          const crossed = atEnd
            ? (i === pts.length - 1 ? (side(a) !== 0 && side(a) === -side(z)) || (finishesRun && throughRunEnd(z, a, false)) : side(a) !== 0 && side(a) === -side(pts[i + 1]!))
            : at >= 0.05 || (side(a) !== 0 && side(a) === -side(z)) || (i === 1 && side(a) === 0 && throughRunEnd(a, z, true));
          if (crossed) {
            const cosine = hit.wallNormal ? Math.abs(along.dot(hit.wallNormal)) : 1;
            const openingWidth = width * Math.min(2, 1 / Math.max(cosine, 1e-9));
            // A floor transition already opened this wall wide enough, along the same direction: don't open it twice.
            if (!openings.some((box) => box.center.distanceToSquared(near) < 0.01 && box.width + 1e-9 >= openingWidth && Math.abs(box.along.dot(along)) > 0.999 && (!box.wallNormal || !hit.wallNormal || Math.abs(box.wallNormal.dot(hit.wallNormal)) > 0.999))) openAt(near, openingWidth, hit.wallNormal);
          }
          start = at + 0.05;
          if (start >= flat) break;
        }
      }
      travelled += length; lengthM += length;
    }
  }
  for (const [k, j] of activeJunctions.entries()) {
    const b = getBatch(j.floor), radius = j.width / 2, region = runs.length + pads.length + k;
    const slab = slabCut(region), ceiling = ceilingCut(region);
    if (slab || ceiling) {
      const ring = (height: number, turn: number) => Array.from({ length: 24 }, (_v, i) => j.at.clone().add(new THREE.Vector3(Math.cos(turn * i * Math.PI * 2 / 24) * radius, height, Math.sin(turn * i * Math.PI * 2 / 24) * radius)));
      cutFace(b.shell, b.colors, ring(0, -1), slab ?? [], 0.72);
      if (captureNav) cutFace(navFloors, null, ring(0, -1), slab ?? [], 1);
      cutFace(b.ceiling, b.ceilingColors, ring(2.6, 1), ceiling ?? [], 0.72);
      continue;
    }
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI * 2 / 24, z = (i + 1) * Math.PI * 2 / 24;
      for (const height of [0, 2.6]) {
        const center = j.at.clone().add(new THREE.Vector3(0, height, 0));
        const p = center.clone().add(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
        const q = center.clone().add(new THREE.Vector3(Math.cos(z) * radius, 0, Math.sin(z) * radius));
        quad(height === 0 ? b.shell : b.ceiling, height === 0 ? b.colors : b.ceilingColors, center, height === 0 ? q : p, height === 0 ? p : q, center, [0.72, 0.72, 0.72, 0.72]);
        if (captureNav && height === 0) quad(navFloors, null, center, q, p, center);
      }
    }
  }
  const root = new THREE.Group(), walkable: THREE.Object3D[] = [], colliders: THREE.Object3D[] = [];
  const triangleCap = greyboxTriangleLimit(tier);
  const total = () => [...batches.values()].reduce((n, b) => n + (b.shell.length + b.ceiling.length + b.portal.length + b.lights.length + b.kerb.length) / 9, 0);
  const dropped: string[] = [];
  if (total() > triangleCap) { for (const b of batches.values()) { b.lights = []; b.lightColors = []; } dropped.push("lights"); }
  if (total() > triangleCap) { for (const b of batches.values()) b.kerb = []; dropped.push("kerb"); }
  if (total() > triangleCap) { for (const b of batches.values()) { b.ceiling = []; b.ceilingColors = []; } dropped.push("ceiling"); }
  const remainsOver = total() > triangleCap;
  let triangles = 0;
  for (const b of batches.values()) {
    b.shell = b.shell.concat(b.ceiling);
    b.colors = b.colors.concat(b.ceilingColors);
    const hasPortal = b.portal.length > 0;
    b.lights = b.lights.concat(b.portal);
    b.lightColors = b.lightColors.concat(b.portalColors);
    for (const [name, data, colors, material] of [["greybox-shell", b.shell, b.colors, shellMat], ["greybox-lights", b.lights, b.lightColors, lightMat], ["greybox-kerb", b.kerb, null, kerbMat]] as const) {
      if (!data.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(data), 3));
      if (colors) {
        const packedColors = new Uint8Array(colors.length);
        for (let i = 0; i < colors.length; i++) packedColors[i] = Math.round(colors[i]! * 255);
        geometry.setAttribute("color", new THREE.BufferAttribute(packedColors, 3, true));
      }
      const packed = new Int8Array(data.length);
      for (let i = 0; i < data.length; i += 9) {
        const ax = data[i + 3]! - data[i]!, ay = data[i + 4]! - data[i + 1]!, az = data[i + 5]! - data[i + 2]!;
        const bx = data[i + 6]! - data[i]!, by = data[i + 7]! - data[i + 1]!, bz = data[i + 8]! - data[i + 2]!;
        let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        const length = Math.hypot(nx, ny, nz);
        if (length) { nx = Math.round(nx / length * 127); ny = Math.round(ny / length * 127); nz = Math.round(nz / length * 127); }
        for (let k = 0; k < 9; k += 3) { packed[i + k] = nx; packed[i + k + 1] = ny; packed[i + k + 2] = nz; }
      }
      geometry.setAttribute("normal", new THREE.Int8BufferAttribute(packed, 3, true));
      const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
      mesh.userData = { greybox: true, approximate: true, gteki_source: "procedural", gteki_role: name };
      if (name === "greybox-lights" && hasPortal) {
        const portal = new THREE.Group(); portal.name = "greybox-portal"; portal.add(mesh); root.add(portal);
      } else root.add(mesh);
      triangles += data.length / 9;
      if (material === shellMat) { walkable.push(mesh); colliders.push(mesh); }
    }
  }
  return { root, walkable, colliders, wallSegments, openings, navFloors: captureNav ? navFloors : undefined, stats: { runs: runs.length, landingPads: pads.length, lengthM, portals: openings.length, meshes: root.children.length, triangles, buildMs: performance.now() - started, overBudget: dropped.length ? `Dropped ${dropped.join(", ")}${remainsOver ? `; floor and walls exceed ${triangleCap} triangles` : ` to meet ${triangleCap} triangles`}` : null } satisfies GreyboxStats };
}
