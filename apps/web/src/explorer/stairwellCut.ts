import type { Edge, StationBundle } from "@gteki/schema";
import * as THREE from "three";
import { edgePoints } from "./geometry.ts";
import { widthOf } from "./greybox.ts";
import { cutRegions, disposePortalCuts, type CutRegion, type Plane, type PortalCutResources } from "./portalCut.ts";
import type { Segment2 } from "./walker.ts";

/** A plan piece flatter than this is a landing. */
const MIN_PIECE_RISE_M = 0.05;
/** Clearance above the walking surface and past the upper landing. */
const WALK_CLEAR_M = 0.3, UPPER_CLEAR_M = 0.05;
/** Vertical connectors whose footprint is cut through horizontal slabs. Elevators come with their own follow-up. */
const VERTICAL_MODES = new Set(["stairs", "escalator"]);
/** A stored mesh larger than this is reported as skipped instead of CPU-cut (load time). */
export const STAIRWELL_VERTEX_LIMIT = 1_000_000;
const BAND_DEPTH_M = 0.3;
const RAIL_HEIGHT_M = 1.1;
const RAIL_RADIUS_M = 0.026;
const POST_RADIUS_M = 0.02;
const POST_SPACING_M = 1.5;
/** Upper-slab faces this far below the upper landing, and up to just above it, are cut where the mesh is a slab. */
const SLAB_BAND_M = 1.2;
/** Mesh roles (`userData.gteki_role`) whose horizontal faces are slabs: always cut in the band. `stairs_ramps` never is. */
const SLAB_ROLES = new Set(["floor", "ceiling"]);
/** Side faces of a slab are near-vertical: |normal.y| below this. */
const VERTICAL_NORMAL_M = 0.1;
/** Headroom above the walking surface that the primary cut clears: higher faces obstruct nothing and stay. */
const HEADROOM_M = 2.1;

/** The plan rectangle of one straight piece of a connector, in renderer coordinates. */
export interface StairwellRect {
  center: THREE.Vector3;
  along: THREE.Vector3;
  across: THREE.Vector3;
  halfLength: number;
  halfWidth: number;
  /** Height change along the piece, from its start to its end. */
  rise: number;
}

export interface StairwellWell {
  edgeId: string;
  mode: Edge["mode"];
  /** Renderer heights of the two landings. */
  lowerY: number;
  upperY: number;
  rects: StairwellRect[];
  /** Plan point where the top flight piece's centreline ends: its rectangle's end side is the arrival side, never railed. */
  arrival: THREE.Vector3;
  /** Set when the connector cannot be cut cleanly: it has no rects, nothing is cut or railed, and it counts as skipped. */
  skipped?: string;
}

export interface StairwellStats {
  wells: number;
  cutTriangles: number;
  skippedMeshes: number;
  railM: number;
  cutMeshes: number;
  cutMs: number;
  /** Connectors left uncut because their arrival side could not be determined. */
  skippedWells: number;
}

export interface StairwellCut {
  stats: StairwellStats;
  /** Rail collision, renderer-frame wall segments. */
  walls: Segment2[];
  /** Rail and glass meshes, to add to the collider and camera targets. */
  colliders: THREE.Object3D[];
  /** Rail, glass and (when no greybox shell takes it) the edge band. */
  finish: THREE.Group | null;
  bandTriangles: number;
  /** Triangles added by the band, rail and glass. */
  finishTriangles: number;
  /** Meshes the cut could not process, as `name: reason`. */
  skipped: string[];
  resources: PortalCutResources;
  /** Restore the scene geometry the cut replaced. */
  dispose(): void;
}

export interface StairwellOptions {
  walkable?: ReadonlySet<THREE.Object3D>;
  tier: "high" | "low";
  /** The greybox shell that receives the edge band; null puts it in the finish group. */
  greyboxRoot?: THREE.Object3D | null;
  vertexLimit?: number;
  /** Collision meshes that may sit outside `root` (walkable, collider and camera-blocker proxies); cut with the same regions. */
  collision?: readonly THREE.Object3D[];
}

/** One well per traversable stairs / escalator edge that has a vertical run worth cutting. */
export function stairwellWells(bundle: StationBundle, traversable: (edge: Edge) => boolean): StairwellWell[] {
  const nodes = new Map(bundle.nodes.map((node) => [node.id, node]));
  const floors = new Map(bundle.floors.map((floor) => [floor.id, floor]));
  const wells: StairwellWell[] = [];
  for (const edge of bundle.edges) {
    if (!VERTICAL_MODES.has(edge.mode) || !traversable(edge)) continue;
    const points = edgePoints(bundle, edge, nodes, floors);
    if (points.length < 2) continue;
    const lowerY = Math.min(points[0]!.y, points.at(-1)!.y), upperY = Math.max(points[0]!.y, points.at(-1)!.y);
    // Order bottom to top, so the last rectangle is the arrival piece.
    const ordered = points[0]!.y <= points.at(-1)!.y ? points : [...points].reverse();
    const rects: StairwellRect[] = [];
    const rising = ordered.slice(1).map((point, i) => Math.abs(point.y - ordered[i]!.y) >= MIN_PIECE_RISE_M);
    const firstFlight = rising.indexOf(true), lastFlight = rising.lastIndexOf(true);
    if (lastFlight < 0) continue;
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1]!, b = ordered[i]!;
      const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      // Exclude the terminal landings and pieces without a usable plan footprint.
      if (length < 0.5 || (!rising[i - 1] && (i - 1 < firstFlight || i - 1 > lastFlight))) continue;
      const along = new THREE.Vector3(dx / length, 0, dz / length);
      const across = new THREE.Vector3(-along.z, 0, along.x);
      rects.push({ center: new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), along, across, halfLength: length / 2, halfWidth: (widthOf(edge) + 0.2) / 2, rise: b.y - a.y });
    }
    // The arrival is where the top flight piece's centreline ends (not the end of any landing after it).
    // Its rectangle is cut only when that piece is long enough to have one; otherwise the connector is skipped.
    const exit = ordered[lastFlight]!, end = ordered[lastFlight + 1]!;
    const arrival = new THREE.Vector3(end.x, 0, end.z);
    if (Math.hypot(end.x - exit.x, end.z - exit.z) < 0.5) {
      wells.push({ edgeId: edge.id, mode: edge.mode, lowerY, upperY, rects: [], arrival, skipped: "top flight piece too short for an arrival side" });
      continue;
    }
    wells.push({ edgeId: edge.id, mode: edge.mode, lowerY, upperY, rects, arrival });
  }
  return wells;
}

function rectPlanes(rect: StairwellRect, upperY: number): Plane[] {
  const along = rect.along, across = rect.across, c = rect.center;
  const dot = (p: THREE.Vector3, axis: THREE.Vector3) => (p.x - c.x) * axis.x + (p.z - c.z) * axis.z;
  return [
    p => rect.halfLength + dot(p, along),
    p => rect.halfLength - dot(p, along),
    p => rect.halfWidth + dot(p, across),
    p => rect.halfWidth - dot(p, across),
    p => p.y - c.y - dot(p, along) * rect.rise / (2 * rect.halfLength) - WALK_CLEAR_M - 1e-6,
    p => upperY + UPPER_CLEAR_M - p.y,
    // Only faces inside the headroom above the flight are cut.
    p => HEADROOM_M - (p.y - c.y - dot(p, along) * rect.rise / (2 * rect.halfLength)),
  ];
}

const horizontal = (normal: THREE.Vector3): boolean => Math.abs(normal.y) > 0.9;

function rectCorners(rect: StairwellRect, height: number): THREE.Vector3[] {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([l, w]) => rect.center.clone()
    .addScaledVector(rect.along, l! * rect.halfLength).addScaledVector(rect.across, w! * rect.halfWidth)
    .setY(height));
}

/**
 * Convex regions for the cut. The first is from above the walking surface to just above the upper landing.
 * The second is the upper slab's band inside the footprint: every horizontal face of a `floor` or `ceiling`
 * mesh is cut there, wherever it lies, so both faces of a slab over the top of the flight go. Any other
 * mesh (stairs, kit, or no role) is left to the first region alone.
 */
export function stairwellRegions(wells: readonly StairwellWell[]): CutRegion[] {
  const regions: CutRegion[] = [];
  for (const well of wells) {
    for (const rect of well.rects) {
      const corners = [...rectCorners(rect, rect.center.y - Math.abs(rect.rise) / 2 + WALK_CLEAR_M), ...rectCorners(rect, well.upperY + UPPER_CLEAR_M)];
      regions.push({
        key: rect, bounds: new THREE.Box3().setFromPoints(corners), planes: rectPlanes(rect, well.upperY), clip: null, accepts: horizontal,
        // A stair model is never cut, even where another flight passes above the footprint.
        admits: (piece, mesh, triangle) => mesh.userData.gteki_role !== "stairs_ramps" && !onWalkingSurface(piece, triangle, well),
      });
      const floorY = well.upperY - SLAB_BAND_M;
      const band = [...rectCorners(rect, floorY), ...rectCorners(rect, well.upperY + UPPER_CLEAR_M)];
      const planes = rectPlanes(rect, well.upperY).slice(0, 4);
      planes.push(p => p.y - floorY - 1e-6, p => well.upperY + UPPER_CLEAR_M - p.y);
      const levelCache = new WeakMap<THREE.Object3D, BandLevels>();
      const levelsOf = (mesh: THREE.Object3D): BandLevels => {
        let found = levelCache.get(mesh);
        if (!found) { found = bandLevels(mesh, rect, floorY, well.upperY + UPPER_CLEAR_M); levelCache.set(mesh, found); }
        return found;
      };
      regions.push({
        key: rect, bounds: new THREE.Box3().setFromPoints(band), planes, clip: null,
        // Horizontal faces, and near-vertical side faces that the slab levels below decide.
        accepts: (normal) => horizontal(normal) || Math.abs(normal.y) < VERTICAL_NORMAL_M,
        admits: (piece, mesh, triangle) => {
          const role = mesh.userData.gteki_role;
          if (role !== undefined && !SLAB_ROLES.has(role)) return false;
          if (onWalkingSurface(piece, triangle, well)) return false;
          // The triangle, not its clipped piece, decides the orientation and the height span.
          const [a, b, c] = triangle as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
          const normal = b.clone().sub(a).cross(c.clone().sub(a));
          if (normal.lengthSq() === 0) return false;
          normal.normalize();
          const levels = levelsOf(mesh);
          if (horizontal(normal)) {
            if (SLAB_ROLES.has(role)) return true;
            return levels.outside.has(levelOf((a.y + b.y + c.y) / 3));
          }
          // A side face is cut only when its height span lies within the mesh's admitted slab levels (+/- 5 cm).
          const slab = SLAB_ROLES.has(role) ? levels.all : levels.outside;
          if (!slab.size) return false;
          const lo = Math.min(...slab) - 0.05 - 1e-6, hi = Math.max(...slab) + 0.05 + 1e-6;
          return Math.min(a.y, b.y, c.y) >= lo && Math.max(a.y, b.y, c.y) <= hi;
        },
      });
    }
  }
  return regions;
}

/** Cut the scene's horizontal slabs open along every traversable vertical connector; finish the well edges and rails. */
export function cutStairwells(root: THREE.Object3D, wells: readonly StairwellWell[], options: StairwellOptions): StairwellCut {
  const resources: PortalCutResources = { geometries: [], materials: [], portalMeshes: new Map(), originals: new Map(), clippedMeshes: [], instances: [] };
  const live = wells.filter((well) => !well.skipped);
  const regions = stairwellRegions(live);
  const cut = cutRegions([root, ...(options.collision ?? [])], regions, resources, options.walkable ?? new Set(), false, options.vertexLimit ?? STAIRWELL_VERTEX_LIMIT);
  const cutWells = live.filter((well) => well.rects.some((rect) => (cut.perRegion.get(rect) ?? 0) > 0));
  const heights = new Map<StairwellRect, number[]>();
  for (const well of live) for (const rect of well.rects) heights.set(rect, cut.heights.get(rect) ?? []);

  const bands: number[] = [];
  for (const well of cutWells) {
    for (const rect of well.rects) {
      const levels = new Set((heights.get(rect) ?? []).map((y) => Math.round(y * 20) / 20));
      for (const level of levels) addBand(bands, rect, level, well.rects);
    }
  }

  const railPositions: number[] = [], railColors: number[] = [], glassPositions: number[] = [], walls: Segment2[] = [];
  const steel = new THREE.Color(0xaab2b5).toArray();
  for (const well of cutWells) {
    const opened = well.rects.filter((rect) => (cut.maxHeights.get(rect) ?? []).some((y) => y >= well.upperY - 0.3 - 1e-6));
    for (const rect of opened) for (const [from, to] of railSides(rect, well.arrival, opened)) {
      addRail(railPositions, railColors, from, to, well.upperY, steel);
      walls.push({ ax: from.x, az: from.z, bx: to.x, bz: to.z, yMin: well.upperY, yMax: well.upperY + RAIL_HEIGHT_M });
      if (options.tier === "high") addGlass(glassPositions, from, to, well.upperY);
    }
  }

  const finish = new THREE.Group();
  finish.name = "greybox-stairwell";
  const colliders: THREE.Object3D[] = [];
  const bandTarget = options.greyboxRoot ? (options.greyboxRoot.getObjectByName("greybox-shell") as THREE.Mesh | undefined) : undefined;
  let bandTriangles = 0;
  if (bands.length) {
    if (bandTarget) bandTriangles = appendShellQuads(bandTarget, bands, shellShade(new THREE.Color(0x8a8c88)));
    else {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(bands, 3));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: 0x8a8c88, side: THREE.DoubleSide }));
      mesh.name = "greybox-stairwell-band";
      mesh.userData = { greybox: true, approximate: true };
      finish.add(mesh);
      bandTriangles = bands.length / 9;
    }
  }
  if (railPositions.length) {
    const rail = colorMesh("greybox-stairwell-rail", railPositions, railColors);
    finish.add(rail); colliders.push(rail);
  }
  if (glassPositions.length) {
    const material = new THREE.MeshBasicMaterial({ color: 0xbfd4d8, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(glassPositions, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "greybox-stairwell-glass";
    mesh.userData = { greybox: true, approximate: true };
    finish.add(mesh); colliders.push(mesh);
  }
  const railM = walls.reduce((sum, w) => sum + Math.hypot(w.bx - w.ax, w.bz - w.az), 0);
  let finishTriangles = 0;
  finish.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) finishTriangles += mesh.geometry.getAttribute("position").count / 3; });
  finishTriangles = Math.round(finishTriangles);
  return {
    stats: { wells: cutWells.length, cutTriangles: cut.cutTriangles, skippedMeshes: cut.skipped.length, railM, cutMeshes: cut.cutMeshes, cutMs: cut.cutMs, skippedWells: wells.length - live.length },
    walls, colliders, finish: finish.children.length ? finish : null, bandTriangles, finishTriangles, skipped: cut.skipped,
    resources, dispose: () => {
      // The finish meshes are ours; the cut meshes' originals are restored by disposePortalCuts.
      finish.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
      });
      disposePortalCuts(resources);
    },
  };
}

/** Outer portions of each opened rectangle, except the arrival side (the end side of the top flight piece's rectangle, through `arrival`). */
function railSides(rect: StairwellRect, arrival: THREE.Vector3, opened: readonly StairwellRect[]): [THREE.Vector3, THREE.Vector3][] {
  const corners = rectCorners(rect, 0), sides: [THREE.Vector3, THREE.Vector3][] = [];
  for (let i = 0; i < 4; i++) {
    const from = corners[i]!, to = corners[(i + 1) % 4]!, delta = to.clone().sub(from);
    const tArrival = arrival.clone().sub(from).dot(delta) / delta.lengthSq();
    if (tArrival >= -1e-6 && tArrival <= 1 + 1e-6 && from.clone().addScaledVector(delta, tArrival).distanceTo(arrival) < 1e-3) continue;
    sides.push(...sideRemainder(from, to, rect, opened));
  }
  return sides;
}

/**
 * The parts of the plan side `from`→`to` of `self` that are neither inside nor on another rectangle of
 * `others`: a 1-D interval subtraction along the side, so an L-shaped opening keeps only its outer parts.
 */
function sideRemainder(from: THREE.Vector3, to: THREE.Vector3, self: StairwellRect, others: readonly StairwellRect[]): [THREE.Vector3, THREE.Vector3][] {
  const delta = to.clone().sub(from);
  let intervals: [number, number][] = [[0, 1]];
  for (const other of others) {
    if (other === self) continue;
    let lo = 0, hi = 1;
    for (const [axis, half] of [[other.along, other.halfLength], [other.across, other.halfWidth]] as const) {
      const start = from.clone().sub(other.center).dot(axis), step = delta.dot(axis);
      if (Math.abs(step) < 1e-9) { if (Math.abs(start) > half + 1e-6) { lo = 1; hi = 0; break; } }
      else {
        const a = (-half - start) / step, b = (half - start) / step;
        lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
      }
    }
    if (hi - lo < 1e-6) continue;
    intervals = intervals.flatMap(([a, b]) => hi <= a || lo >= b ? [[a, b]] : [ ...(lo > a ? [[a, lo] as [number, number]] : []), ...(hi < b ? [[hi, b] as [number, number]] : []) ]);
  }
  return intervals.filter(([a, b]) => b - a > 1e-6).map(([a, b]) => [from.clone().addScaledVector(delta, a), from.clone().addScaledVector(delta, b)]);
}

const levelOf = (y: number): number => Math.round(y * 20) / 20;

/**
 * True for a piece of an upward-facing triangle (orientation from the whole triangle, as its winding stores it)
 * whose every corner lies within 5 cm of a walking surface of the well (a flight or an intermediate landing) at
 * that corner's plan point. Faces at the upper floor's own level are not walking surfaces, so the upper slab is
 * still cut. No region cuts these.
 */
function onWalkingSurface(piece: readonly THREE.Vector3[], triangle: readonly THREE.Vector3[], well: StairwellWell): boolean {
  const [a, b, c] = triangle as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  // Only an upward-facing face (as its winding stores it) can be a walking surface; an underside never is.
  const normal = b.clone().sub(a).cross(c.clone().sub(a));
  if (normal.lengthSq() === 0 || normal.normalize().y <= 0.7) return false;
  // Every corner must sit on a walking surface at its own plan point: a large triangle that crosses the headroom is cut.
  return piece.every((v) => {
    if (v.y >= well.upperY - 0.1) return false;
    return well.rects.some((rect) => {
      const dx = v.x - rect.center.x, dz = v.z - rect.center.z;
      const along = dx * rect.along.x + dz * rect.along.z, across = dx * rect.across.x + dz * rect.across.z;
      if (Math.abs(along) > rect.halfLength + 1e-3 || Math.abs(across) > rect.halfWidth + 1e-3) return false;
      const surface = rect.center.y + along * rect.rise / (2 * rect.halfLength);
      return Math.abs(v.y - surface) <= 0.05 + 1e-6;
    });
  });
}

/**
 * For an unroled mesh: the height levels (5 cm) of its horizontal triangles inside the band that have a vertex
 * outside the rectangle in plan. A slab's faces run past the footprint, so their levels are admitted; a tread
 * level whose triangles all lie inside the footprint is not.
 */
interface BandLevels {
  /** Levels of every horizontal triangle inside the band. */
  all: Set<number>;
  /** The levels that have a horizontal triangle with a vertex outside the rectangle in plan. */
  outside: Set<number>;
}

function bandLevels(mesh: THREE.Object3D, rect: StairwellRect, floorY: number, topY: number): BandLevels {
  const all = new Set<number>(), outside = new Set<number>();
  const geometry = (mesh as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
  const position = geometry?.getAttribute("position");
  if (!geometry || !position) return { all, outside };
  mesh.updateWorldMatrix(true, false);
  const index = geometry.index, count = index ? index.count : position.count;
  const vs = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const outsidePlan = (p: THREE.Vector3) => {
    const d = (p.x - rect.center.x) * rect.along.x + (p.z - rect.center.z) * rect.along.z;
    const a = (p.x - rect.center.x) * rect.across.x + (p.z - rect.center.z) * rect.across.z;
    return Math.abs(d) > rect.halfLength + 1e-3 || Math.abs(a) > rect.halfWidth + 1e-3;
  };
  for (let i = 0; i + 2 < count; i += 3) {
    for (let j = 0; j < 3; j++) vs[j]!.fromBufferAttribute(position, index ? index.getX(i + j) : i + j).applyMatrix4(mesh.matrixWorld);
    const normal = vs[1]!.clone().sub(vs[0]!).cross(vs[2]!.clone().sub(vs[0]!));
    if (normal.lengthSq() === 0 || !horizontal(normal.normalize())) continue;
    const y = (vs[0]!.y + vs[1]!.y + vs[2]!.y) / 3;
    if (y < floorY - 1e-6 || y > topY + 1e-6) continue;
    all.add(levelOf(y));
    if (vs.some(outsidePlan)) outside.add(levelOf(y));
  }
  return { all, outside };
}

/** Band around one rectangle's cut boundary, on the sides no other piece of the same well covers. */
function addBand(out: number[], rect: StairwellRect, level: number, pieces: readonly StairwellRect[]): void {
  const corners = rectCorners(rect, 0);
  for (let i = 0; i < 4; i++) {
    for (const [from, to] of sideRemainder(corners[i]!, corners[(i + 1) % 4]!, rect, pieces)) {
      quad(out, from.clone().setY(level), to.clone().setY(level), to.clone().setY(level - BAND_DEPTH_M), from.clone().setY(level - BAND_DEPTH_M));
    }
  }
}

function addRail(out: number[], colors: number[], from: THREE.Vector3, to: THREE.Vector3, baseY: number, color: number[]): void {
  const a = from.clone().setY(baseY + RAIL_HEIGHT_M), b = to.clone().setY(baseY + RAIL_HEIGHT_M);
  tube(out, colors, a, b, RAIL_RADIUS_M, color);
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const posts = Math.max(1, Math.round(length / POST_SPACING_M));
  for (let i = 0; i <= posts; i++) {
    const t = i / posts, p = from.clone().lerp(to, t).setY(baseY);
    tube(out, colors, p, p.clone().setY(baseY + RAIL_HEIGHT_M), POST_RADIUS_M, color);
  }
}

function addGlass(out: number[], from: THREE.Vector3, to: THREE.Vector3, baseY: number): void {
  const a = from.clone().setY(baseY + 0.1), b = to.clone().setY(baseY + 0.1);
  const c = to.clone().setY(baseY + RAIL_HEIGHT_M - 0.1), d = from.clone().setY(baseY + RAIL_HEIGHT_M - 0.1);
  quad(out, a, b, c, d);
}

function quad(out: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): void {
  for (const p of [a, b, c, a, c, d]) out.push(p.x, p.y, p.z);
}

/** A capped tube with `segments` sides, from `a` to `b`; open ends sit under a post or inside the floor. */
function tube(out: number[], colors: number[], a: THREE.Vector3, b: THREE.Vector3, radius: number, color: number[], segments = 6): void {
  const axis = b.clone().sub(a), length = axis.length();
  if (length < 1e-6) return;
  axis.divideScalar(length);
  const helper = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(axis, helper).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  const ring = (center: THREE.Vector3, angle: number) => center.clone().addScaledVector(u, Math.cos(angle) * radius).addScaledVector(v, Math.sin(angle) * radius);
  for (let i = 0; i < segments; i++) {
    const a0 = i * Math.PI * 2 / segments, a1 = (i + 1) * Math.PI * 2 / segments;
    const tri = [ring(a, a0), ring(b, a0), ring(b, a1), ring(a, a0), ring(b, a1), ring(a, a1)];
    for (const p of tri) { out.push(p.x, p.y, p.z); colors.push(color[0]!, color[1]!, color[2]!); }
  }
}

function colorMesh(name: string, positions: number[], colors: number[]): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.userData = { greybox: true, approximate: true };
  return mesh;
}

/** Per-channel factor that turns the greybox shell material's tone into `target`. */
function shellShade(target: THREE.Color): [number, number, number] {
  const shell = new THREE.Color(0x9a9690);
  return [target.r / shell.r, target.g / shell.g, target.b / shell.b];
}

/** Append quads to the greybox shell mesh (position, packed colour and packed normal), so the band adds no draw. */
function appendShellQuads(mesh: THREE.Mesh, positions: number[], shade: [number, number, number]): number {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position"), color = geometry.getAttribute("color"), normal = geometry.getAttribute("normal");
  if (!position || !color || !normal) return 0;
  const oldPositions = position.array as Float32Array, oldColors = color.array as Uint8Array, oldNormals = normal.array as Int8Array;
  const nextPositions = new Float32Array(oldPositions.length + positions.length);
  nextPositions.set(oldPositions); nextPositions.set(positions, oldPositions.length);
  const nextColors = new Uint8Array(oldColors.length + positions.length);
  nextColors.set(oldColors);
  const packed = shade.map((value) => Math.round(Math.min(1, Math.max(0, value)) * 255));
  for (let i = oldColors.length, vertex = 0; i < nextColors.length; i += 3, vertex++) for (let c = 0; c < 3; c++) nextColors[i + c] = packed[c]!;
  const nextNormals = new Int8Array(oldNormals.length + positions.length);
  nextNormals.set(oldNormals);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = oldNormals.length, source = 0; i < nextNormals.length; i += 9, source += 9) {
    a.fromArray(positions, source); b.fromArray(positions, source + 3); c.fromArray(positions, source + 6);
    const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    for (let k = 0; k < 9; k += 3) {
      nextNormals[i + k] = Math.round(n.x * 127); nextNormals[i + k + 1] = Math.round(n.y * 127); nextNormals[i + k + 2] = Math.round(n.z * 127);
    }
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(nextPositions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(nextColors, 3, true));
  geometry.setAttribute("normal", new THREE.Int8BufferAttribute(nextNormals, 3, true));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return positions.length / 9;
}
