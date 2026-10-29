import type { Edge, StationBundle } from "@gteki/schema";
import * as THREE from "three";
import { edgePoints } from "./geometry.ts";
import { widthOf } from "./greybox.ts";
import { cutRegions, disposePortalCuts, type CutRegion, type Plane, type PortalCutResources } from "./portalCut.ts";
import type { Segment2 } from "./walker.ts";

/** Floor-to-floor rise below which no slab fits the headroom band: nothing to cut. */
export const MIN_WELL_RISE_M = 2.15;
/** A plan piece flatter than this is a landing: it stays closed, so it gets no cut rectangle. */
const MIN_PIECE_RISE_M = 0.05;
/** Headroom kept above the lower landing and past the upper landing: the band takes the whole slab, both faces. */
const HEADROOM_M = 2.1, UPPER_CLEAR_M = 0.05;
/** Vertical connectors whose footprint is cut through horizontal slabs. Elevators come with their own follow-up. */
const VERTICAL_MODES = new Set(["stairs", "escalator"]);
/** A stored mesh larger than this is reported as skipped instead of CPU-cut (load time). */
export const STAIRWELL_VERTEX_LIMIT = 1_000_000;
const BAND_DEPTH_M = 0.3;
const RAIL_HEIGHT_M = 1.1;
const RAIL_RADIUS_M = 0.026;
const POST_RADIUS_M = 0.02;
const POST_SPACING_M = 1.5;

/** The plan rectangle of one straight piece of a connector, in renderer coordinates. */
export interface StairwellRect {
  center: THREE.Vector3;
  along: THREE.Vector3;
  across: THREE.Vector3;
  halfLength: number;
  halfWidth: number;
}

export interface StairwellWell {
  edgeId: string;
  mode: Edge["mode"];
  /** Renderer heights of the two landings. */
  lowerY: number;
  upperY: number;
  rects: StairwellRect[];
  /** Plan point of the upper end: the arrival side of the well. */
  arrival: THREE.Vector3;
}

export interface StairwellStats {
  wells: number;
  cutTriangles: number;
  skippedMeshes: number;
  railM: number;
  cutMeshes: number;
  cutMs: number;
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
    if (upperY - lowerY < MIN_WELL_RISE_M) continue;
    // Order bottom to top, so the last rectangle is the arrival piece.
    const ordered = points[0]!.y <= points.at(-1)!.y ? points : [...points].reverse();
    const rects: StairwellRect[] = [];
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1]!, b = ordered[i]!;
      const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      // Landing and vertical pieces leave no plan rectangle of their own: landings stay closed.
      if (length < 0.5 || Math.abs(b.y - a.y) < MIN_PIECE_RISE_M) continue;
      const along = new THREE.Vector3(dx / length, 0, dz / length);
      const across = new THREE.Vector3(-along.z, 0, along.x);
      rects.push({ center: new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), along, across, halfLength: length / 2, halfWidth: (widthOf(edge) + 0.2) / 2 });
    }
    if (!rects.length) continue;
    const arrival = ordered.at(-1)!;
    wells.push({ edgeId: edge.id, mode: edge.mode, lowerY, upperY, rects, arrival: new THREE.Vector3(arrival.x, 0, arrival.z) });
  }
  return wells;
}

function rectPlanes(rect: StairwellRect, lowerY: number, upperY: number): Plane[] {
  const along = rect.along, across = rect.across, c = rect.center;
  const dot = (p: THREE.Vector3, axis: THREE.Vector3) => (p.x - c.x) * axis.x + (p.z - c.z) * axis.z;
  return [
    p => rect.halfLength + dot(p, along),
    p => rect.halfLength - dot(p, along),
    p => rect.halfWidth + dot(p, across),
    p => rect.halfWidth - dot(p, across),
    p => p.y - lowerY - HEADROOM_M,
    p => upperY + UPPER_CLEAR_M - p.y,
  ];
}

const horizontal = (normal: THREE.Vector3): boolean => Math.abs(normal.y) > 0.9;

function rectCorners(rect: StairwellRect, height: number): THREE.Vector3[] {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([l, w]) => rect.center.clone()
    .addScaledVector(rect.along, l! * rect.halfLength).addScaledVector(rect.across, w! * rect.halfWidth)
    .setY(height));
}

/** Convex region: the plan rectangle from the lower landing + 2.1 m to the upper landing + 0.05 m. */
export function stairwellRegions(wells: readonly StairwellWell[]): CutRegion[] {
  const regions: CutRegion[] = [];
  for (const well of wells) {
    for (const rect of well.rects) {
      const corners = [...rectCorners(rect, well.lowerY + HEADROOM_M), ...rectCorners(rect, well.upperY + UPPER_CLEAR_M)];
      regions.push({ key: rect, bounds: new THREE.Box3().setFromPoints(corners), planes: rectPlanes(rect, well.lowerY, well.upperY), clip: null, accepts: horizontal });
    }
  }
  return regions;
}

/** Cut the scene's horizontal slabs open along every traversable vertical connector; finish the well edges and rails. */
export function cutStairwells(root: THREE.Object3D, wells: readonly StairwellWell[], options: StairwellOptions): StairwellCut {
  const resources: PortalCutResources = { geometries: [], materials: [], portalMeshes: new Map(), originals: new Map(), clippedMeshes: [], instances: [] };
  const regions = stairwellRegions(wells);
  const cut = cutRegions(root, regions, resources, options.walkable ?? new Set(), false, options.vertexLimit ?? STAIRWELL_VERTEX_LIMIT);
  const cutWells = wells.filter((well) => well.rects.some((rect) => (cut.perRegion.get(rect) ?? 0) > 0));
  const heights = new Map<StairwellRect, number[]>();
  for (const well of wells) for (const rect of well.rects) heights.set(rect, cut.heights.get(rect) ?? []);

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
    const rect = well.rects.filter((candidate) => (cut.perRegion.get(candidate) ?? 0) > 0).at(-1)!;
    for (const [from, to] of railSides(rect, well.arrival)) {
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
    stats: { wells: cutWells.length, cutTriangles: cut.cutTriangles, skippedMeshes: cut.skipped.length, railM, cutMeshes: cut.cutMeshes, cutMs: cut.cutMs },
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

/** The three sides of the arrival piece left open to the floor: the arrival side itself has no rail. */
function railSides(rect: StairwellRect, arrival: THREE.Vector3): [[THREE.Vector3, THREE.Vector3], [THREE.Vector3, THREE.Vector3], [THREE.Vector3, THREE.Vector3]] {
  const sign = (arrival.x - rect.center.x) * rect.along.x + (arrival.z - rect.center.z) * rect.along.z >= 0 ? 1 : -1;
  const at = (l: number, w: number) => rect.center.clone().addScaledVector(rect.along, l * rect.halfLength).addScaledVector(rect.across, w * rect.halfWidth);
  const far = -sign;
  return [
    [at(-1, -1), at(1, -1)],
    [at(-1, 1), at(1, 1)],
    [at(far, -1), at(far, 1)],
  ];
}

/** Band around one rectangle's cut boundary; sides shared with another piece of the same well stay open. */
function addBand(out: number[], rect: StairwellRect, level: number, pieces: readonly StairwellRect[]): void {
  const top = rectCorners(rect, level), bottom = rectCorners(rect, level - BAND_DEPTH_M);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const middle = top[i]!.clone().add(top[j]!).multiplyScalar(0.5);
    if (pieces.some((piece) => piece !== rect && coversPlan(piece, middle))) continue;
    quad(out, top[i]!, top[j]!, bottom[j]!, bottom[i]!);
  }
}

/** True when the plan point lies on or inside the rectangle, within a millimetre. */
function coversPlan(rect: StairwellRect, point: THREE.Vector3): boolean {
  const dot = (axis: THREE.Vector3) => (point.x - rect.center.x) * axis.x + (point.z - rect.center.z) * axis.z;
  return Math.abs(dot(rect.along)) <= rect.halfLength + 1e-3 && Math.abs(dot(rect.across)) <= rect.halfWidth + 1e-3;
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
