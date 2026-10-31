import type { Edge, StationBundle } from "@gteki/schema";
import * as THREE from "three";
import { edgePoints, R, type V3 } from "./geometry.ts";
import { MODE_WIDTH } from "./graphView.ts";
import type { Segment2 } from "./walker.ts";

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
  wallHit(a: V3, b: V3): (V3 & { wallNormal?: THREE.Vector3 }) | null;
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
      return emitGreybox(bundle, [...runs, ...[...pads.values()].flatMap((p) => p.strip ? [p.strip] : [])], hasFloor, scene, tier, captureNav, [...pads.values()]);
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

/** Plan (XZ) distance between two segments; 0 when they cross. */
function planSegmentDistance(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): number {
  const cross = (ox: number, oz: number, px: number, pz: number, qx: number, qz: number) => (px - ox) * (qz - oz) - (pz - oz) * (qx - ox);
  const d1 = cross(c.x, c.z, d.x, d.z, a.x, a.z), d2 = cross(c.x, c.z, d.x, d.z, b.x, b.z);
  const d3 = cross(a.x, a.z, b.x, b.z, c.x, c.z), d4 = cross(a.x, a.z, b.x, b.z, d.x, d.z);
  if (((d1 > 0) !== (d2 > 0)) && d1 !== 0 && d2 !== 0 && ((d3 > 0) !== (d4 > 0)) && d3 !== 0 && d4 !== 0) return 0;
  const pointSegment = (p: THREE.Vector3, s: THREE.Vector3, e: THREE.Vector3) => {
    const dx = e.x - s.x, dz = e.z - s.z, length2 = dx * dx + dz * dz;
    const t = length2 ? Math.min(1, Math.max(0, ((p.x - s.x) * dx + (p.z - s.z) * dz) / length2)) : 0;
    return Math.hypot(p.x - (s.x + dx * t), p.z - (s.z + dz * t));
  };
  return Math.min(pointSegment(a, c, d), pointSegment(b, c, d), pointSegment(c, a, b), pointSegment(d, a, b));
}

/** Split segments longer than `step` into equal collinear pieces. */
function densify(pts: readonly V3[], step: number): readonly V3[] {
  if (!Number.isFinite(step) || pts.length < 2) return pts;
  const out: V3[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n, z: a.z + (b.z - a.z) * k / n });
  }
  return out;
}

/** Emit the globally deduplicated passage geometry for already-detected runs. */
export function emitGreybox(bundle: StationBundle, detected: readonly UnmodelledEdgeRun[], hasFloor: (p: V3) => boolean, scene: GreyboxScene, tier: "high" | "low", captureNav = false, pads: readonly LandingPad[] = []) {
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
  const junctions = new Map<string, { at: THREE.Vector3; width: number; count: number; floor: string; edges: Set<string> }>();
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
        junctions.set(`${run.edge.id}:bend:${i}`, { at: R(p.x, p.y, p.z), width: widthOf(run.edge), count: 2, floor: nodes.get(run.edge.from)?.floorId ?? "", edges: new Set([run.edge.id]) });
      }
    }
  }
  // A stair, escalator or lift leaves a run at its end node. Its mouth opens only the walls inside the connector's
  // own footprint, so the passage keeps its side walls wherever there is no stair beside them.
  const mouths: { at: THREE.Vector3; ux: number; uz: number; half: number; length: number; y0: number; y1: number }[] = [];
  for (const edge of bundle.edges) {
    if (!["stairs", "escalator", "elevator"].includes(edge.mode)) continue;
    const points = edgePoints(bundle, edge, nodes, floors);
    for (const [id, path] of [[edge.from, points], [edge.to, [...points].reverse()]] as const) {
      const junction = junctions.get(id);
      if (!junction) continue;
      // Follow the flight's whole plan, with its own height along the way: at a shallow angle or after a bend it
      // still meets the wall, and a corridor far above or below the flight keeps its walls.
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!, b = path[i]!, run = Math.hypot(b.x - a.x, b.z - a.z);
        if (run < 1e-6) continue;
        mouths.push({ at: a, ux: (b.x - a.x) / run, uz: (b.z - a.z) / run, half: widthOf(edge) / 2, length: run, y0: a.y, y1: b.y });
      }
    }
  }
  const activeJunctions = [...junctions.values()].filter((junction) => junction.count >= 2);
  // A landing's symbolic render height can sit only ~1.6 m above the floor below, so an intermediate level's slab,
  // walls and ceiling would make a low ceiling over a passage underneath. Where an intermediate run segment, landing pad
  // or junction patch lies over a run on another floor in plan, build no piece for it: the edge falls back to its
  // existing path. Conservative on slopes: the slab underside (−0.12 m) against the lower segment's highest point.
  // Greybox runs (in ≤2 m pieces, so a long slope counts its height near the crossing) and landing pads count as the
  // lower passage; scene-modelled ones are out of scope (#680).
  const runSegments: { floor: string; a: THREE.Vector3; z: THREE.Vector3; half: number; bottom: number; top: number }[] = [];
  const addLower = (floor: string, a: THREE.Vector3, z: THREE.Vector3, half: number) => runSegments.push({ floor, a, z, half, bottom: Math.min(a.y, z.y), top: Math.max(a.y, z.y) });
  for (const run of runs) {
    const pts = densify(run.points, 2).map((p) => R(p.x, p.y, p.z)), floor = nodes.get(run.edge.from)?.floorId ?? "";
    for (let i = 1; i < pts.length; i++) addLower(floor, pts[i - 1]!, pts[i]!, widthOf(run.edge) / 2);
  }
  for (const pad of pads) addLower(pad.floorId, pad.center.clone().addScaledVector(pad.along, -pad.width / 2), pad.center.clone().addScaledVector(pad.along, pad.width / 2), pad.width / 2);
  const overLowPassage = (floorId: string, a: THREE.Vector3, z: THREE.Vector3, half: number) => {
    if (floors.get(floorId)?.intermediate !== true) return false;
    const y = Math.min(a.y, z.y);
    return runSegments.some((o) => o.floor !== floorId && o.bottom < y && y - 0.12 - o.top < 2.3 && planSegmentDistance(a, z, o.a, o.z) < half + o.half);
  };
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
  for (const pad of pads) {
    if (overLowPassage(pad.floorId, pad.center.clone().addScaledVector(pad.along, -pad.width / 2), pad.center.clone().addScaledVector(pad.along, pad.width / 2), pad.width / 2)) continue;
    const b=getBatch(pad.floorId), half=pad.width/2, across=new THREE.Vector3(-pad.along.z,0,pad.along.x);
    const corner=(a:number,s:number,h:number)=>pad.center.clone().addScaledVector(pad.along,a*half).addScaledVector(across,s*half).add(new THREE.Vector3(0,h,0));
    const al=corner(-1,-1,0), ar=corner(-1,1,0), zl=corner(1,-1,0), zr=corner(1,1,0);
    quad(b.shell,b.colors,ar,zr,zl,al,[0.62,0.62,0.62,0.62]);
    if (captureNav) quad(navFloors,null,ar,zr,zl,al);
    quad(b.ceiling,b.ceilingColors,corner(1,-1,2.6),corner(1,1,2.6),corner(-1,1,2.6),corner(-1,-1,2.6),[0.62,0.62,0.62,0.62]);
    for (const side of [-1,1]) {
      if (pad.openSides.has(side)) continue;
      const a=corner(-1,side,0), z=corner(1,side,0);
      for (const [start,end] of index.uncovered(a,z)) {
        const p=a.clone().lerp(z,start), q=a.clone().lerp(z,end), mid=p.clone().lerp(q,0.5); mid.y+=1.3;
        if (scene.colliderNear(enu(mid),0.3)) continue;
        const topP=p.clone().add(new THREE.Vector3(0,2.6,0)), topQ=q.clone().add(new THREE.Vector3(0,2.6,0));
        if (side<0) quad(b.shell,b.colors,topP,topQ,q,p); else quad(b.shell,b.colors,p,q,topQ,topP);
        wallSegments.push({source:"procedural",role:"greybox_wall",ax:p.x,az:p.z,bx:q.x,bz:q.z,yMin:p.y,yMax:p.y+2.6});
      }
    }
  }
  for (const run of runs) {
    const width = widthOf(run.edge), half = width / 2;
    const b = getBatch(nodes.get(run.edge.from)?.floorId ?? "");
    // On an intermediate level, check clearance per ≤2 m piece so one crossing drops only the part over it.
    const points = densify(run.points, floors.get(nodes.get(run.edge.from)?.floorId ?? "")?.intermediate === true ? 2 : Infinity);
    const pts = points.map((p) => R(p.x, p.y, p.z));
    let travelled = 0, nextLight = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, z = pts[i]!;
      const diff = z.clone().sub(a), length = diff.length(), flat = Math.hypot(diff.x, diff.z);
      if (length < 1e-8 || flat < 1e-8) continue;
      if (overLowPassage(nodes.get(run.edge.from)?.floorId ?? "", a, z, half)) { travelled += length; continue; }
      const along = new THREE.Vector3(diff.x / flat, 0, diff.z / flat);
      const across = new THREE.Vector3(-along.z, 0, along.x);
      const offset = (p: THREE.Vector3, side: number, height: number) => p.clone().addScaledVector(across, side).add(new THREE.Vector3(0, height, 0));
      const al = offset(a, -half, 0), ar = offset(a, half, 0), zl = offset(z, -half, 0), zr = offset(z, half, 0);
      quad(b.shell, b.colors, ar, zr, zl, al, [0.62, 0.62, 0.62, 0.62]);
      if (captureNav) quad(navFloors, null, ar, zr, zl, al);
      quad(b.shell, b.colors, offset(a, -half, -0.12), offset(a, half, -0.12), offset(z, half, -0.12), offset(z, -half, -0.12));
      for (const side of [-1, 1]) {
        quad(b.shell, b.colors, offset(a, side * half, -0.12), offset(z, side * half, -0.12), offset(z, side * half, 0), offset(a, side * half, 0));
        quad(b.kerb, null, offset(a, side * (half - 0.05), 0.005), offset(z, side * (half - 0.05), 0.005), offset(z, side * half, 0.005), offset(a, side * half, 0.005));
        const wa = offset(a, side * half, 0), wz = offset(z, side * half, 0);
        // Clip the wall centreline against junction discs; the floor and ceiling remain continuous.
        let intervals: [number, number][] = index.uncovered(wa, wz);
        for (const j of activeJunctions) {
          const vx = wz.x - wa.x, vz = wz.z - wa.z, ox = wa.x - j.at.x, oz = wa.z - j.at.z;
          const A = vx * vx + vz * vz, B = 2 * (ox * vx + oz * vz), C = ox * ox + oz * oz - (j.width / 2) ** 2;
          // Compare heights where the wall passes the junction, not at the segment midpoint: a long ramp drifts.
          const nearest = A < 1e-12 ? 0 : Math.min(1, Math.max(0, -B / (2 * A)));
          if (Math.abs(j.at.y - (a.y + (z.y - a.y) * nearest)) > 1) continue;
          const disc = B * B - 4 * A * C;
          if (A < 1e-12 || disc <= 0) continue;
          const lo = (-B - Math.sqrt(disc)) / (2 * A), hi = (-B + Math.sqrt(disc)) / (2 * A);
          intervals = intervals.flatMap(([s, e]) => [[s, Math.min(e, lo)], [Math.max(s, hi), e]].filter(([x, y]) => x! < y!) as [number, number][]);
        }
        // Each cut keeps the wall below the flight's surface and above a walker on it: a corridor passing under or over
        // the flight stays closed. Heights are above the wall base.
        const cuts: { lo: number; hi: number; below: number; above: number }[] = [];
        const standing = intervals;
        for (const m of mouths) {
          // Any wall inside the connector's footprint is one the flight passes through; walls beside it stay. Footprint,
          // not run ownership: deduplication may keep a run from another edge. In the connector's frame, u runs along
          // the flight and v across it.
          const du = (wz.x - wa.x) * m.ux + (wz.z - wa.z) * m.uz, dv = -(wz.x - wa.x) * m.uz + (wz.z - wa.z) * m.ux;
          const u0 = (wa.x - m.at.x) * m.ux + (wa.z - m.at.z) * m.uz, v0 = -(wa.x - m.at.x) * m.uz + (wa.z - m.at.z) * m.ux;
          let lo = 0, hi = 1;
          // A wall running along the footprint's side line, end to end, is beside the flight, not across it.
          const v1 = v0 + dv;
          if (Math.abs(dv) < 0.05 * Math.hypot(du, dv) && Math.sign(v0) === Math.sign(v1) && Math.min(Math.abs(v0), Math.abs(v1)) > m.half - 0.05) continue;
          for (const [p0, dp, min, max] of [[u0, du, -0.05, m.length], [v0, dv, -m.half, m.half]] as const) {
            if (Math.abs(dp) < 1e-9) { if (p0 < min || p0 > max) { lo = 1; hi = 0; } continue; }
            const t1 = (min - p0) / dp, t2 = (max - p0) / dp;
            lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
          }
          if (lo >= hi) continue;
          // Open only the part where a walker on the flight (2 m tall) would meet the wall (2.6 m tall). Both heights
          // are linear in t, so their difference is too: keep the t range where it lies in [-2, 2.6].
          const gap = (t: number) => m.y0 + (m.y1 - m.y0) * Math.min(1, Math.max(0, (u0 + du * t) / m.length)) - (a.y + (z.y - a.y) * t);
          const g0 = gap(lo), g1 = gap(hi);
          if (Math.abs(g1 - g0) < 1e-9) { if (g0 < -2 || g0 > 2.6) continue; }
          else {
            const tAt = (g: number) => lo + (hi - lo) * (g - g0) / (g1 - g0);
            const [ta, tb] = [tAt(-2), tAt(2.6)].sort((x, y) => x - y) as [number, number];
            lo = Math.max(lo, ta); hi = Math.min(hi, tb);
            if (lo >= hi) continue;
          }
          // In steps of at most 0.5 m along the wall, so a flight rising along it keeps the wall it has not reached yet.
          // 0.4 m under the flight's lowest point keeps a band clear of the walker's feet and the step it climbs.
          const steps = Math.max(1, Math.ceil(wa.distanceTo(wz) * (hi - lo) / 0.5));
          for (let n = 0; n < steps; n++) {
            const cs = lo + (hi - lo) * n / steps, ce = lo + (hi - lo) * (n + 1) / steps, gs = gap(cs), ge = gap(ce);
            cuts.push({ lo: cs, hi: ce, below: Math.min(gs, ge) - 0.4, above: Math.max(gs, ge) + 2.6 });
          }
          intervals = intervals.flatMap(([s, e]) => [[s, Math.min(e, lo)], [Math.max(s, hi), e]].filter(([x, y]) => x! < y!) as [number, number][]);
        }
        const clearIntervals: [number, number][] = [];
        for (const [s, e] of intervals) {
          const pieces = Math.max(1, Math.ceil(wa.distanceTo(wz) * (e - s) / 2));
          let clearStart: number | null = null;
          for (let k = 0; k < pieces; k++) {
            const start = s + (e - s) * k / pieces, end = s + (e - s) * (k + 1) / pieces;
            const mid = wa.clone().lerp(wz, (start + end) / 2); mid.y += 1.3;
            if (scene.colliderNear(enu(mid), 0.3)) {
              if (clearStart !== null) clearIntervals.push([clearStart, start]);
              clearStart = null;
            } else {
              if (clearStart === null) clearStart = start;
              const p = wa.clone().lerp(wz, start), q = wa.clone().lerp(wz, end);
              wallSegments.push({ source: "procedural", role: "greybox_wall", ax: p.x, az: p.z, bx: q.x, bz: q.z, yMin: Math.min(p.y, q.y) - 0.12, yMax: Math.max(p.y, q.y) + 2.6 });
            }
            if (k === pieces - 1 && clearStart !== null) clearIntervals.push([clearStart, end]);
          }
        }
        const band = (s: number, e: number, y0: number, y1: number) => {
          const p = wa.clone().lerp(wz, s), q = wa.clone().lerp(wz, e);
          const lowP = p.clone().add(new THREE.Vector3(0, y0, 0)), lowQ = q.clone().add(new THREE.Vector3(0, y0, 0));
          const topP = p.clone().add(new THREE.Vector3(0, y1, 0)), topQ = q.clone().add(new THREE.Vector3(0, y1, 0));
          if (side < 0) quad(b.shell, b.colors, topP, topQ, lowQ, lowP, [0.62, 0.62, 0.62, 0.62]);
          else quad(b.shell, b.colors, lowP, lowQ, topQ, topP, [0.62, 0.62, 0.62, 0.62]);
        };
        for (const [s, e] of clearIntervals) band(s, e, 0, 2.6);
        // The kept bands of the cuts. Each cut opens the height range (below, above) of the wall; where cuts overlap,
        // the wall keeps every height outside all of their ranges, so a wall between two flights stays.
        const stops = [...new Set(cuts.flatMap((c) => [c.lo, c.hi]))].sort((x, y) => x - y);
        for (let k = 1; k < stops.length; k++) {
          // Two cuts' bounds that differ only by rounding leave a sliver between them. Skipping it here drops its band and
          // its wall piece together: a zero-length wall blocks nothing in the navmesh bake (which drops it), is an invisible
          // post to the walker, and the route audit's crossing test matched it along a whole line.
          if ((stops[k]! - stops[k - 1]!) * wa.distanceTo(wz) < 1e-3) continue;
          const over = cuts.filter((c) => c.lo <= stops[k - 1]! && c.hi >= stops[k]!);
          if (!over.length) continue;
          // A band under a flight is kept only from 1 m up (it would only snag the walker below that), so a lower
          // cut opening starts at 0.
          const open = over.map((c) => [c.below >= 1 ? c.below : 0, c.above] as [number, number]).sort((x, y) => x[0] - y[0]);
          const kept: [number, number][] = [];
          let floor = 0;
          for (const [o0, o1] of open) { if (o0 > floor) kept.push([floor, Math.min(o0, 2.6)]); floor = Math.max(floor, o1); }
          if (floor < 2.6) kept.push([floor, 2.6]);
          // Only where the wall stood before the cuts: a junction disc or another passage's floor stays open.
          for (const [s, e] of standing) {
            const lo = Math.max(s, stops[k - 1]!), hi = Math.min(e, stops[k]!);
            if (lo >= hi) continue;
            for (const [y0, y1] of kept) {
              if (y1 - y0 < 0.05) continue;
              // In pieces of at most 2 m, and like the full-height wall, none where the scene already stands.
              const pieces = Math.max(1, Math.ceil(wa.distanceTo(wz) * (hi - lo) / 2));
              for (let n = 0; n < pieces; n++) {
                const ps = lo + (hi - lo) * n / pieces, pe = lo + (hi - lo) * (n + 1) / pieces;
                const mid = wa.clone().lerp(wz, (ps + pe) / 2); mid.y += (y0 + y1) / 2;
                if (scene.colliderNear(enu(mid), 0.3)) continue;
                const p = wa.clone().lerp(wz, ps), q = wa.clone().lerp(wz, pe);
                wallSegments.push({ source: "procedural", role: "greybox_wall", ax: p.x, az: p.z, bx: q.x, bz: q.z, yMin: Math.min(p.y, q.y) + (y0 === 0 ? -0.12 : y0), yMax: Math.max(p.y, q.y) + y1 });
                band(ps, pe, y0, y1);
              }
            }
          }
        }
      }
      quad(b.ceiling, b.ceilingColors, offset(z, -half, 2.6), offset(z, half, 2.6), offset(a, half, 2.6), offset(a, -half, 2.6), [0.62, 0.62, 0.62, 0.62]);
      while (nextLight <= travelled + length) {
        const t = (nextLight - travelled) / length;
        if (t >= 0) {
          const center = a.clone().lerp(z, t).add(new THREE.Vector3(0, 2.59, 0));
          const p = center.clone().addScaledVector(along, -0.6), q = center.clone().addScaledVector(along, 0.6);
          quad(b.lights, b.lightColors, p.clone().addScaledVector(across, -0.075), q.clone().addScaledVector(across, -0.075), q.clone().addScaledVector(across, 0.075), p.clone().addScaledVector(across, 0.075));
        }
        nextLight += 6;
      }
      const pa = points[i - 1]!, pz = points[i]!;
      const transition = run.edge.attributes?.sceneGap === true
        ? (i === 1 && hasFloor(pa)) || (i === pts.length - 1 && hasFloor(pz))
        : hasFloor(pa) !== hasFloor(pz);
      if (transition) {
        const hit = scene.wallHit(pa, pz);
        if (hit) {
          const near = R(hit.x, hit.y, hit.z);
          const center = near.clone();
          const depth = 0.6;
          const cosine = hit.wallNormal ? Math.abs(along.dot(hit.wallNormal)) : 1;
          const openingWidth = width * Math.min(2, 1 / Math.max(cosine, 1e-9));
          openings.push({ center, along: along.clone(), across: across.clone(), ...(hit.wallNormal ? { wallNormal: hit.wallNormal.clone() } : {}), width: openingWidth, depth, height: 2.3 });
          const faceAt = (face: number) => {
            return near.clone().addScaledVector(along, face * 0.02);
          };
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
        }
      }
      travelled += length; lengthM += length;
    }
  }
  for (const j of activeJunctions) {
    if (overLowPassage(j.floor, j.at, j.at, j.width / 2)) continue;
    const b = getBatch(j.floor), radius = j.width / 2;
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
