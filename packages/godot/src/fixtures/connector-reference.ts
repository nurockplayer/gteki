/** Frozen pre-#768 builder from #714 at 485e6952282a7717901202cc04df17d37b04cfaa.
 * Deliberately includes #714's lift shafts, doors, continuous colliders and collision-matched low-tier wall panels.
 * Non-lift algorithms remain byte-for-byte those of frozen main 556e6fab after removing the lift additions.
 * Test-only: preserve this unoptimized reference; do not regenerate it from the optimized builder. */
import type { Edge, StationBundle } from "@gteki/schema";
import * as THREE from "three";
import { edgePoints, type V3 } from "../../../../apps/web/src/explorer/geometry.ts";
import type { Segment2 } from "../../../../apps/web/src/explorer/walker.ts";
import { buildConnectors as buildLegacyConnectors } from "../../../../apps/web/src/explorer/greyboxConnectorsLegacy.ts";
import { WALKER_BODY } from "@gteki/scene-api";
import type { MultiPolygon } from "polygon-clipping";
import { buildWalkableModel, regionPolygon, unionRings, type BoundaryWall, type PlanPoint, type Region } from "../../../../apps/web/src/explorer/walkableModel.ts";

/** Find vertical edges for which the original scene lacks a complete connector. */
export function unmodelledVerticalEdges(
  bundle: StationBundle,
  traversable: (edge: Edge) => boolean,
  hasFloor: (point: V3) => boolean,
  nearMesh: (point: THREE.Vector3, radius: number) => boolean,
): Edge[] {
  const nodes = new Map(bundle.nodes.map((node) => [node.id, node]));
  const floors = new Map(bundle.floors.map((floor) => [floor.id, floor]));
  return bundle.edges.filter((edge) => {
    if (!traversable(edge) || !["stairs", "escalator"].includes(edge.mode)) return false;
    const points = edgePoints(bundle, edge, nodes, floors);
    if (points.length < 2) return false;
    if (edge.attributes?.sceneGap === true) return true;
    const lengths = points.slice(1).map((p, i) => p.distanceTo(points[i]!));
    let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
    let midpoint = points[0]!.clone();
    for (let i = 0; i < lengths.length; i++) {
      const length = lengths[i]!;
      if (remaining <= length) { midpoint.lerpVectors(points[i]!, points[i + 1]!, length ? remaining / length : 0); break; }
      remaining -= length;
    }
    if (!nearMesh(midpoint, 1.5)) return true;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      const count = Math.max(1, Math.ceil(a.distanceTo(b) / 0.5));
      for (let k = 0; k <= count; k++) {
        const p = a.clone().lerp(b, k / count);
        if (!hasFloor({ x: p.x, y: -p.z, z: p.y })) return true;
      }
    }
    return false;
  });
}

/**
 * Lift edges the scene lacks a shaft for: a rise of more than 0.5 m (a same-floor car-to-hall stub is a walk run, not a
 * connector), and a scene gap, a missing landing floor or no mesh near the middle. A lift's middle is the shaft, which
 * never has floor, so only its two landings are sampled.
 */
export function unmodelledLiftEdges(
  bundle: StationBundle,
  traversable: (edge: Edge) => boolean,
  hasFloor: (point: V3) => boolean,
  nearMesh: (point: THREE.Vector3, radius: number) => boolean,
): Edge[] {
  const nodes = new Map(bundle.nodes.map((node) => [node.id, node]));
  const floors = new Map(bundle.floors.map((floor) => [floor.id, floor]));
  return bundle.edges.filter((edge) => {
    if (!traversable(edge) || edge.mode !== "elevator") return false;
    const points = edgePoints(bundle, edge, nodes, floors);
    if (points.length < 2 || Math.abs(points[0]!.y - points.at(-1)!.y) <= 0.5) return false;
    if (edge.attributes?.sceneGap === true) return true;
    if (!nearMesh(points[0]!.clone().lerp(points.at(-1)!, 0.5), 1.5)) return true;
    return [points[0]!, points.at(-1)!].some((p) => !hasFloor({ x: p.x, y: -p.z, z: p.y }));
  });
}

export type ConnectorMaterial = "tread" | "riser" | "nosing" | "escStep" | "escTruss" | "steel" | "rubber" | "glass" | "light" | "lampOk" | "lampNo";
export interface ConnectorPart { material: ConnectorMaterial; position: number[]; normal: number[]; colour: number[]; edgeId?: string; edgeIds?: readonly string[]; role?: "walkable" | "collider"; walkableOnly?: boolean; soffit?: boolean; userData?: { fit: "exact" | "approximate"; omittedLandings?: number } }
export interface ConnectorOptions { tier: "high" | "low" }

const connectorColours: Record<ConnectorMaterial, string> = {
  tread: "#c7c2b8", riser: "#dbdbd6", nosing: "#2a2b2c", escStep: "#3b3f44",
  escTruss: "#ccccc7", steel: "#aab2b5", rubber: "#121314", glass: "#b4ccd1", light: "#fff6e8", lampOk: "#00ff00", lampNo: "#ff0000",
};

/** Emit non-indexed triangles in renderer coordinates, with colour and contact shade baked in. */
function part(geometry: THREE.BufferGeometry, material: ConnectorMaterial, transform: THREE.Matrix4, role?: ConnectorPart["role"], shade = 1): ConnectorPart {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  source.applyMatrix4(transform);
  const p = source.getAttribute("position"), n = source.getAttribute("normal"), color = new THREE.Color(connectorColours[material]).multiplyScalar(shade);
  const position: number[] = [], normal: number[] = [], colour: number[] = [];
  for (let i = 0; i < p.count; i++) {
    position.push(p.getX(i), p.getY(i), p.getZ(i));
    normal.push(n.getX(i), n.getY(i), n.getZ(i));
    colour.push(color.r, color.g, color.b);
  }
  source.dispose(); if (source !== geometry) geometry.dispose();
  return { material, position, normal, colour, role };
}

function frame(from: THREE.Vector3, to: THREE.Vector3) {
  const low = from.y <= to.y ? from : to, high = low === from ? to : from;
  const dx = high.x - low.x, dz = high.z - low.z, length = Math.hypot(dx, dz);
  const yaw = length ? Math.atan2(-dz, dx) : 0;
  const matrix = new THREE.Matrix4().makeRotationY(yaw).setPosition(low);
  return { low, high, length, rise: high.y - low.y, matrix };
}

function box(parts: ConnectorPart[], material: ConnectorMaterial, f: THREE.Matrix4, x: number, y: number, z: number, sx: number, sy: number, sz: number, role?: ConnectorPart["role"], shade = 1) {
  const matrix = f.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z));
  parts.push(part(new THREE.BoxGeometry(sx, sy, sz), material, matrix, role, shade));
}

/** Build stairs from the lower landing to the upper landing in renderer space. */
export function buildStairs(from: THREE.Vector3, to: THREE.Vector3, widthM: number, tier: "high" | "low"): ConnectorPart[] {
  const f = frame(from, to), parts: ConnectorPart[] = [];
  const count = Math.max(1, Math.round(f.rise / 0.18)), rise = f.rise / count;
  const flightSteps = Math.max(1, Math.floor(3 / (rise || 0.18))), landing = 1.2;
  const needed = Math.floor((count - 1) / flightSteps);
  const nominalOmitted = f.length < count * 0.25 + needed * landing;
  const nominalTread = (f.length - (nominalOmitted ? 0 : needed * landing)) / count;
  const fit = rise < 0.15 || rise > 0.21 || nominalTread < 0.25 || nominalTread > 0.35 || f.length < f.rise / Math.tan(35 * Math.PI / 180) ? "approximate" : "exact";
  const omitted = nominalOmitted || fit === "approximate" ? needed : 0;
  const placed = needed - omitted;
  const tread = (f.length - placed * landing) / count;
  const xAt = (i: number) => i * tread + (omitted ? 0 : Math.floor(i / flightSteps) * landing);
  for (let i = 0; i < count; i++) {
    const x = xAt(i), y = i * rise;
    box(parts, "tread", f.matrix, x + tread / 2, y - 0.04, 0, tread, 0.08, widthM, "walkable");
    if (tier === "high") box(parts, "riser", f.matrix, x + tread + 0.0075, y + rise / 2, 0, 0.015, rise, widthM, undefined, 0.55);
    if (tier === "high") box(parts, "nosing", f.matrix, x + 0.0275, y + 0.004, 0, 0.055, 0.008, widthM);
    if (!omitted && (i + 1) % flightSteps === 0 && i + 1 < count) box(parts, "tread", f.matrix, x + tread + landing / 2, y + rise - 0.04, 0, landing, 0.08, widthM, "walkable");
  }
  for (const side of [-1, 1]) {
    for (let start = 0; start < count; start += flightSteps) {
      const n = Math.min(flightSteps, count - start), x = xAt(start), length = n * tread;
      const angle = Math.atan2(n * rise, length), incline = Math.hypot(length, n * rise);
      const flight = f.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(x + length / 2, start * rise + n * rise / 2, side * (widthM / 2 + 0.03))).multiply(new THREE.Matrix4().makeRotationZ(angle));
      box(parts, "nosing", flight, 0, 0.015 * Math.cos(angle), 0, incline, 0.27 * Math.cos(angle), 0.06);
      const railGeo = new THREE.CylinderGeometry(0.026, 0.026, incline, 8);
      const railTransform = flight.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.96 * Math.cos(angle), 0)).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2));
      parts.push(part(railGeo, "steel", railTransform));
      if (tier === "high") for (let d = 0; d <= incline; d += 1.5) box(parts, "steel", flight, d - incline / 2, 0.85, 0, 0.03, 0.2, 0.03);
      box(parts, "light", flight, 0, 2.5, 0, incline, 0.02, 0.08);
    }
  }
  for (const p of parts) p.userData = { fit, omittedLandings: omitted };
  return parts;
}

/** Build the escalator from lower to higher landing; indicators retain the supplied direction. */
export function buildEscalator(from: THREE.Vector3, to: THREE.Vector3, tier: "high" | "low"): ConnectorPart[] {
  const f = frame(from, to), parts: ConnectorPart[] = [];
  const nominalLanding = Math.min(0.8, f.length / 4);
  const nominalAngle = Math.atan2(f.rise, f.length - 2 * nominalLanding);
  const fit = nominalLanding < 0.8 || nominalAngle < 27 * Math.PI / 180 || nominalAngle > 33 * Math.PI / 180 ? "approximate" : "exact";
  const landing = fit === "approximate" ? 0 : nominalLanding, run = f.length - 2 * landing;
  const angle = Math.atan2(f.rise, run), incline = Math.hypot(run, f.rise);
  const count = Math.ceil(incline / 0.4 - 1e-9), group = tier === "low" ? 3 : 1;
  const retained = Array.from({ length: count }, (_, i) => i).filter((i) => (i + 0.5) * 0.4 > 0.2 + 1e-9 && (i + 0.5) * 0.4 < incline - 0.2 - 1e-9);
  const firstX = retained.length ? landing + retained[0]! * 0.4 * Math.cos(angle) : f.length / 2;
  const lastIndex = retained.at(-1);
  const lastEnd = lastIndex === undefined ? f.length / 2 : landing + Math.min(incline, (lastIndex + 1) * 0.4) * Math.cos(angle);
  box(parts, "escStep", f.matrix, landing / 2, -0.04, 0, landing, 0.08, 1);
  box(parts, "escStep", f.matrix, f.length - landing / 2, f.rise - 0.04, 0, landing, 0.08, 1);
  const comb = (a: number, b: number) => {
    if (b <= a || !run) return;
    const length = (b - a) / Math.cos(angle);
    const geo = new THREE.PlaneGeometry(length, 1); geo.rotateX(-Math.PI / 2);
    const x = (a + b) / 2, y = (x - landing) * f.rise / run;
    parts.push(part(geo, "escStep", f.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, 0)).multiply(new THREE.Matrix4().makeRotationZ(angle))));
  };
  comb(landing, firstX); comb(lastEnd, f.length - landing);
  // Physical landings meet the continuous incline at its true endpoints, independently of the extended visual combs.
  for (const end of [0, 1]) {
    box(parts, "escStep", f.matrix, end ? f.length - landing / 2 : landing / 2, end * f.rise - 0.04, 0, landing + 0.002, 0.08, 1, "walkable");
    parts.at(-1)!.walkableOnly = true;
  }
  const surface = new THREE.PlaneGeometry(incline, 1); surface.rotateX(-Math.PI / 2);
  const surfaceFrame = f.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(landing + run / 2, f.rise / 2, 0)).multiply(new THREE.Matrix4().makeRotationZ(angle));
  const surfacePart = part(surface, "escStep", surfaceFrame, "walkable"); surfacePart.walkableOnly = true; parts.push(surfacePart);
  for (let i = 0; i < retained.length; i += group) {
    const steps = Math.min(group, retained.length - i), first = retained[i]! * 0.4;
    const last = retained[i + steps - 1]!, finish = last === count - 1 ? incline : (last + 1) * 0.4;
    const start = (first + finish) / 2;
    const depth = (finish - first) * Math.cos(angle), x = landing + start * Math.cos(angle), y = start * Math.sin(angle);
    const geo = new THREE.PlaneGeometry((finish - first), 1); geo.rotateX(-Math.PI / 2);
    parts.push(part(geo, "escStep", f.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, 0)).multiply(new THREE.Matrix4().makeRotationZ(angle))));
    if (tier === "high") box(parts, "escStep", f.matrix, x - depth / 2, y - Math.min(0.4, incline - first) * Math.sin(angle), 0, 0.015, Math.min(0.4, incline - first) * Math.sin(angle), 1);
  }
  const inclined = f.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(landing + run / 2, f.rise / 2, 0)).multiply(new THREE.Matrix4().makeRotationZ(angle));
  box(parts, "escTruss", inclined, 0, -0.7 * Math.cos(angle), 0, incline, 0.9 * Math.cos(angle), 1.5, "collider", 0.6);
  for (const side of [-1, 1]) {
    box(parts, "steel", inclined, 0, 0.05 * Math.cos(angle), side * 0.6, incline, 0.34 * Math.cos(angle), 0.04);
    box(parts, "glass", inclined, 0, 0.59 * Math.cos(angle), side * 0.6, incline, 0.74 * Math.cos(angle), 0.015);
    box(parts, "rubber", inclined, 0, 0.96 * Math.cos(angle), side * 0.6, incline, 0.07, 0.09);
    if (tier === "high") box(parts, "steel", inclined, 0, 0.88 * Math.cos(angle), side * 0.6, incline, 0.025, 0.025);
  }
  for (let x = 0; x <= incline; x += tier === "low" ? 4 : 2) { box(parts, "light", inclined, x - incline / 2, -1.16, 0, 0.35, 0.02, 0.08); parts.at(-1)!.soffit = true; }
  for (const end of [0, 1]) {
    const indicator: ConnectorPart[] = [];
    box(indicator, (end === 0) === (from.y <= to.y) ? "lampOk" : "lampNo", f.matrix, (end ? f.length - landing : landing), end * f.rise + 0.12, 0.64, 0.02, 0.1, 0.16);
    const color = new THREE.Color((end === 0) === (from.y <= to.y) ? "#00ff00" : "#ff0000");
    for (const p of indicator) { for (let i = 0; i < p.colour.length; i += 3) { p.colour[i] = color.r; p.colour[i + 1] = color.g; p.colour[i + 2] = color.b; } parts.push(p); }
  }
  for (const p of parts) p.userData = { fit };
  return parts;
}

/** Walkable centreline and invisible support for a fitted stair flight. */
function stairWalk(from: THREE.Vector3, to: THREE.Vector3, width: number, parts: ConnectorPart[]): THREE.Vector3[] {
  const f = frame(from, to), count = Math.max(1, Math.round(f.rise / 0.18)), rise = f.rise / count;
  const block = Math.max(1, Math.floor(3 / (rise || 0.18))), needed = Math.floor((count - 1) / block);
  const nominalOmitted = f.length < count * 0.25 + needed * 1.2;
  const nominalTread = (f.length - (nominalOmitted ? 0 : needed * 1.2)) / count;
  const omitted = nominalOmitted || rise < 0.15 || rise > 0.21 || nominalTread < 0.25 || nominalTread > 0.35 || f.length < f.rise / Math.tan(35 * Math.PI / 180);
  const tread = (f.length - (omitted ? 0 : needed * 1.2)) / count;
  const at = (x: number, y: number) => new THREE.Vector3(x, y, 0).applyMatrix4(f.matrix);
  const path = [at(0, 0)];
  for (let start = 0; start < count; start += block) {
    const n = Math.min(block, count - start), x = start * tread + (omitted ? 0 : Math.floor(start / block) * 1.2);
    const run = n * tread, height = n * rise, length = Math.hypot(run, height), angle = Math.atan2(height, run);
    const geometry = new THREE.PlaneGeometry(length + 0.002, width, n, 1); geometry.rotateX(-Math.PI / 2);
    const transform = f.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(x + run / 2, start * rise + height / 2, 0)).multiply(new THREE.Matrix4().makeRotationZ(angle));
    const support = part(geometry, "tread", transform, "walkable"); support.walkableOnly = true; parts.push(support);
    for (let k = 1; k <= n; k++) path.push(at(x + k * tread, (start + k) * rise));
    if (!omitted && start + n < count) {
      box(parts, "tread", f.matrix, x + run + 0.6, (start + n) * rise - 0.04, 0, 1.2, 0.08, width, "walkable"); parts.at(-1)!.walkableOnly = true;
      path.push(at(x + run + 1.2, (start + n) * rise));
    }
  }
  return from.y <= to.y ? path : path.reverse();
}

function escalatorWalk(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
  const f = frame(from, to), nominalLanding = Math.min(0.8, f.length / 4);
  const angle = Math.atan2(f.rise, f.length - 2 * nominalLanding);
  const landing = nominalLanding < 0.8 || angle < 27 * Math.PI / 180 || angle > 33 * Math.PI / 180 ? 0 : nominalLanding;
  const at = (x: number, y: number) => new THREE.Vector3(x, y, 0).applyMatrix4(f.matrix);
  const path = [at(0, 0), at(landing, 0), at(f.length - landing, f.rise), at(f.length, f.rise)];
  return from.y <= to.y ? path : path.reverse();
}

export interface ConnectorScope { hasFloor: (p: V3) => boolean; nearMesh: (p: THREE.Vector3, radius: number) => boolean }

function meshFor(parts: readonly ConnectorPart[], material: THREE.Material | THREE.Material[]): THREE.Mesh {
  const materialIndex = (p: ConnectorPart) => p.material === "lampOk" ? 1 : p.material === "lampNo" ? 2 : 0;
  const ordered = Array.isArray(material) ? [...parts].sort((a, b) => materialIndex(a) - materialIndex(b)) : parts;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(ordered.flatMap((p) => p.position), 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(ordered.flatMap((p) => p.normal), 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(ordered.flatMap((p) => p.colour), 3));
  if (Array.isArray(material)) {
    let offset = 0;
    for (const p of ordered) {
      const count = p.position.length / 3, index = materialIndex(p), previous = geometry.groups.at(-1);
      if (previous?.materialIndex === index) previous.count += count;
      else geometry.addGroup(offset, count, index);
      offset += count;
    }
  }
  const mesh = new THREE.Mesh(geometry, material);
  const ids = [...new Set(parts.map((p) => p.edgeId).filter((id): id is string => id !== undefined))];
  let start = 0;
  const edgeRanges = ordered.map((p) => { const range = { start, end: start + p.position.length / 3, edgeId: p.edgeId, ...(p.edgeIds ? { edgeIds: p.edgeIds } : {}) }; start = range.end; return range; });
  mesh.userData = { greybox: true, connector: true, approximate: true, fit: parts.some((p) => p.userData?.fit === "approximate") ? "approximate" : "exact", edgeId: ids.length === 1 ? ids[0] : ids, edgeRanges };
  return mesh;
}

/** Plan deflection between a stair's two legs at interior vertex `index`, in radians (0 at an end or on a straight run). */
function bendAngle(points: readonly THREE.Vector3[], index: number): number {
  if (index <= 0 || index >= points.length - 1) return 0;
  const a = points[index]!.clone().sub(points[index - 1]!); a.y = 0;
  const b = points[index + 1]!.clone().sub(points[index]!); b.y = 0;
  return a.lengthSq() > 1e-12 && b.lengthSq() > 1e-12 ? a.angleTo(b) : 0;
}

/** Plan bends shallower than this are walked as one continuous flight: one strip level with a disc at the bend, no landing. */
const SHALLOW_BEND = (20 * Math.PI) / 180;

/** Drop repeated plan points and points on the straight line between their neighbours, so a flat corner never hides a turn. */
function simplifyPlan(points: readonly THREE.Vector3[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const p of points) {
    const last = out.at(-1);
    // A repeated point (under 0.01 m apart in plan and height) adds nothing: keep the first.
    if (last && Math.hypot(p.x - last.x, p.z - last.z) < 0.01 && Math.abs(p.y - last.y) < 0.01) continue;
    // The previous point is dropped when it lies on the straight line between its neighbours (within the segment a–p), so a
    // flat corner never hides a turn. A collinear reversal (b beyond p) is kept: it is a sharp return.
    while (out.length >= 2) {
      const a = out.at(-2)!, b = out.at(-1)!;
      const ap = p.clone().sub(a), ab = b.clone().sub(a), t = ap.lengthSq() ? ab.dot(ap) / ap.lengthSq() : -1;
      if (t < 0 || t > 1 || b.distanceTo(a.clone().addScaledVector(ap, t)) >= 0.01) break;
      out.pop();
    }
    out.push(p);
  }
  return out;
}

/**
 * A skipped connector's route path in station ENU: the edge's own points, with endpoint heights from their nodes and floors
 * and unknown heights interpolated by arc length (never defaulted to zero), the same frame as the built connector paths.
 */
export function skippedConnectorPath(bundle: StationBundle, edge: Edge): { x: number; y: number; z: number }[] {
  const nodes = new Map(bundle.nodes.map((node) => [node.id, node]));
  const floors = new Map(bundle.floors.map((floor) => [floor.id, floor]));
  return edgePoints(bundle, edge, nodes, floors).map((p) => ({ x: p.x, y: -p.z, z: p.y }));
}

/** How far a mouth footprint reaches past each end of a stair or escalator, onto the floor it meets. */
const MOUTH_M = 0.6;

/** A plan rectangle from `at` along unit `u` for `length`, `half` to each side. */
/** A disc as a 24-sided plan ring, the polygon the walkable model makes of a disc region. */
function discRing(centre: THREE.Vector3, radius: number): PlanPoint[] {
  return Array.from({ length: 24 }, (_v, i) => ({ x: centre.x + radius * Math.cos(i * Math.PI / 12), z: centre.z + radius * Math.sin(i * Math.PI / 12) }));
}
function planQuad(at: THREE.Vector3, u: THREE.Vector3, length: number, half: number): PlanPoint[] {
  const nx = -u.z * half, nz = u.x * half, bx = at.x + u.x * length, bz = at.z + u.z * length;
  return [{ x: at.x + nx, z: at.z + nz }, { x: bx + nx, z: bz + nz }, { x: bx - nx, z: bz - nz }, { x: at.x - nx, z: at.z - nz }];
}

// Inset each convex source quad/disc by 1 cm before union: imported sides must not erase exposed guards.
function insetJunctionRing(ring: readonly PlanPoint[]): PlanPoint[] {
  const origin = ring[0]!;
  const winding = Math.sign(ring.reduce((area, a, i) => {
    const b = ring[(i + 1) % ring.length]!;
    return area + (a.x - origin.x) * (b.z - origin.z) - (b.x - origin.x) * (a.z - origin.z);
  }, 0));
  let clipped = [...ring];
  for (let i = 0; i < ring.length && clipped.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!, dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const distance = (p: PlanPoint) => winding * (dx * (p.z - a.z) - dz * (p.x - a.x)) - 0.01 * length;
    const next: PlanPoint[] = [];
    for (let k = 0; k < clipped.length; k++) {
      const p = clipped[k]!, q = clipped[(k + 1) % clipped.length]!, dp = distance(p), dq = distance(q);
      if (dp >= 0) next.push(p);
      if ((dp >= 0) !== (dq >= 0)) {
        const t = dp / (dp - dq);
        next.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
      }
    }
    clipped = next;
  }
  return clipped;
}

// The first level's whole centreline, including a level approach trimmed from its strip.
function junctionPath(points: readonly V3[], regions: readonly Region[]): readonly V3[] {
  const stripPoints = regions.flatMap((r) => r.kind === "strip" ? r.points : []);
  let last = 0;
  points.forEach((p, i) => { if (stripPoints.some((q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 1e-7)) last = i; });
  return last ? points.slice(0, last + 1) : points;
}

function junctionHeight(points: readonly V3[], p: PlanPoint): number {
  let distance = Infinity, height = points[0]!.y;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
    if (length2 < 1e-12) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2));
    const d = (p.x - a.x - t * dx) ** 2 + (p.z - a.z - t * dz) ** 2;
    if (d < distance - 1e-12) { distance = d; height = a.y + (b.y - a.y) * t; }
  }
  return height;
}

// Height is affine where the nearest leg and its endpoint clamp stay fixed; ambiguous 1 cm cells keep their guard.
function junctionOpenings(sourcePolygons: MultiPolygon, outline: readonly PlanPoint[], aPoints: readonly V3[], bPoints: readonly V3[]): MultiPolygon {
  const ox = aPoints[0]!.x, oz = aPoints[0]!.z;
  const local = (p: V3) => ({ x: p.x - ox, y: p.y, z: p.z - oz });
  const a = aPoints.map(local), b = bPoints.map(local), disc = outline.map((p) => ({ x: p.x - ox, z: p.z - oz }));
  const sources = sourcePolygons.map((polygon) => polygon[0]!.map(([x, z]) => ({ x: x - ox, z: z - oz })));
  const boxOf = (ring: readonly PlanPoint[]) => ({ x0: Math.min(...ring.map((p) => p.x)), z0: Math.min(...ring.map((p) => p.z)), x1: Math.max(...ring.map((p) => p.x)), z1: Math.max(...ring.map((p) => p.z)) });
  const overlaps = (u: ReturnType<typeof boxOf>, v: ReturnType<typeof boxOf>) => u.x0 <= v.x1 && u.x1 >= v.x0 && u.z0 <= v.z1 && u.z1 >= v.z0;
  const clip = (ring: PlanPoint[], distance: (p: PlanPoint) => number) => {
    const out: PlanPoint[] = [];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!, q = ring[(i + 1) % ring.length]!, dp = distance(p), dq = distance(q);
      if (dp >= 0) out.push(p);
      if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t }); }
    }
    return out;
  };
  const within = (ring: PlanPoint[], boundary: readonly PlanPoint[]) => {
    const area = boundary.reduce((sum, p, i) => { const q = boundary[(i + 1) % boundary.length]!; return sum + p.x * q.z - q.x * p.z; }, 0);
    if (Math.abs(area) < 1e-12) return [];
    const winding = Math.sign(area);
    for (let i = 0; i < boundary.length && ring.length; i++) {
      const p = boundary[i]!, q = boundary[(i + 1) % boundary.length]!;
      ring = clip(ring, (r) => winding * ((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x)));
    }
    return ring;
  };
  const near = sources.map((ring) => within([...disc], ring)).filter((ring) => ring.length >= 3);
  if (!near.length) return [];
  const boxes = near.map(boxOf), sourceBoxes = sources.map(boxOf);
  const legsOf = (points: readonly V3[]) => points.slice(1).flatMap((q, i) => {
    const p = points[i]!, dx = q.x - p.x, dz = q.z - p.z, length2 = dx * dx + dz * dz;
    return length2 > 1e-12 ? [{ p, q, dx, dz, length2, box: { x0: Math.min(p.x, q.x), z0: Math.min(p.z, q.z), x1: Math.max(p.x, q.x), z1: Math.max(p.z, q.z) } }] : [];
  });
  const aLegs = legsOf(a), bLegs = legsOf(b);
  const range = (legs: ReturnType<typeof legsOf>, box: ReturnType<typeof boxOf>, corners: PlanPoint[]) => {
    const choices = legs.map((leg) => {
      const ts = corners.map((p) => ((p.x - leg.p.x) * leg.dx + (p.z - leg.p.z) * leg.dz) / leg.length2);
      const at = (p: PlanPoint) => leg.p.y + (leg.q.y - leg.p.y) * Math.max(0, Math.min(1, ((p.x - leg.p.x) * leg.dx + (p.z - leg.p.z) * leg.dz) / leg.length2));
      const heights = corners.map(at);
      const upper = Math.max(...corners.map((p, i) => {
        const t = Math.max(0, Math.min(1, ts[i]!));
        return (p.x - leg.p.x - t * leg.dx) ** 2 + (p.z - leg.p.z - t * leg.dz) ** 2;
      }));
      const lower = Math.max(leg.box.x0 - box.x1, box.x0 - leg.box.x1, 0) ** 2 + Math.max(leg.box.z0 - box.z1, box.z0 - leg.box.z1, 0) ** 2;
      const affine = leg.p.y === leg.q.y || ts.every((t) => t <= 0) || ts.every((t) => t >= 1) || ts.every((t) => t >= 0 && t <= 1);
      return { at, heights, upper, lower, affine };
    });
    // A box-distance lower bound cannot omit a leg that is nearest anywhere in the cell.
    const upper = Math.min(...choices.map((c) => c.upper));
    const possible = choices.filter((c) => c.lower <= upper + 1e-12), first = possible[0]!;
    const samePlane = possible.every((c) => c.affine && c.heights.every((h, i) => Math.abs(h - first.heights[i]!) < 1e-9));
    return { low: Math.min(...possible.flatMap((c) => c.heights)), high: Math.max(...possible.flatMap((c) => c.heights)), at: samePlane ? first.at : undefined };
  };
  const kept: PlanPoint[][] = [];
  const visit = (box: ReturnType<typeof boxOf>) => {
    if (!boxes.some((other) => overlaps(box, other))) return;
    let ring = [{ x: box.x0, z: box.z0 }, { x: box.x1, z: box.z0 }, { x: box.x1, z: box.z1 }, { x: box.x0, z: box.z1 }];
    const ar = range(aLegs, box, ring), br = range(bLegs, box, ring), step = WALKER_BODY.stepUpM;
    if (ar.low - br.high > step || br.low - ar.high > step) return;
    if (!(ar.high - br.low <= step && br.high - ar.low <= step)) {
      if (ar.at && br.at) {
        for (const side of [-1, 1]) ring = clip(ring, (p) => step - side * (ar.at!(p) - br.at!(p)));
      } else {
        const width = box.x1 - box.x0, depth = box.z1 - box.z0, x = (box.x0 + box.x1) / 2, z = (box.z0 + box.z1) / 2;
        if (Math.max(width, depth) <= 0.01) return;
        if (width >= depth) { visit({ ...box, x1: x }); visit({ ...box, x0: x }); }
        else { visit({ ...box, z1: z }); visit({ ...box, z0: z }); }
        return;
      }
    }
    if (ring.length < 3) return;
    ring = within(ring, disc);
    for (let i = 0; i < sources.length; i++) if (overlaps(box, sourceBoxes[i]!)) {
      const piece = within([...ring], sources[i]!);
      if (piece.length >= 3) kept.push(piece);
    }
  };
  visit({ x0: Math.min(...boxes.map((b) => b.x0)), z0: Math.min(...boxes.map((b) => b.z0)), x1: Math.max(...boxes.map((b) => b.x1)), z1: Math.max(...boxes.map((b) => b.z1)) });
  // A height-incompatible island is a hole, not an opening: split only polygons with holes before making connector rings.
  return unionRings(kept).flatMap((polygon) => {
    if (polygon.length === 1) return [polygon.map((ring) => [...ring, ring[0]!].map((p): [number, number] => [p.x + ox, p.z + oz]))];
    const rings = polygon.map((ring) => ring.map((p) => new THREE.Vector2(p.x, p.z))), vertices = rings.flat();
    return THREE.ShapeUtils.triangulateShape(rings[0]!, rings.slice(1)).map((triangle) => [[...triangle, triangle[0]!].map((i): [number, number] => [vertices[i]!.x + ox, vertices[i]!.y + oz])]);
  });
}

/** Unit plan direction from `a` to `b`. */
function planDir(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
  const d = b.clone().sub(a); d.y = 0;
  return d.lengthSq() > 1e-12 ? d.normalize() : new THREE.Vector3(1, 0, 0);
}

/** Half the plan side of a lift shaft (2.2 m square, connector spec) and of its landing doors (0.9 m). */
const SHAFT_HALF = 1.1, DOOR_HALF = 0.45;
/** Plan outward normals of the shaft's four faces, in a fixed order so ties resolve the same way every run. */
const SHAFT_NORMALS = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, -1)];

/** Index of the shaft face a stop's door opens onto: the one facing `toward`, else face 0. */
function shaftFace(toward: THREE.Vector3 | null): number {
  if (!toward || Math.hypot(toward.x, toward.z) < 1e-6) return 0;
  let best = 0, score = -Infinity;
  SHAFT_NORMALS.forEach((normal, index) => { const dot = toward.x * normal.x + toward.z * normal.z; if (dot > score) { score = dot; best = index; } });
  return best;
}

/** Plan rectangles `[u0, u1, v0, v1]` covering a face minus its door holes. */
function freePanels(uMin: number, uMax: number, vMin: number, vMax: number, holes: readonly { u0: number; u1: number; v0: number; v1: number }[]): [number, number, number, number][] {
  const clamp = (v: number) => THREE.MathUtils.clamp(v, vMin, vMax);
  const cuts = [...new Set([vMin, vMax, ...holes.flatMap((hole) => [clamp(hole.v0), clamp(hole.v1)])])].sort((a, b) => a - b);
  const panels: [number, number, number, number][] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const v0 = cuts[i]!, v1 = cuts[i + 1]!;
    if (v1 - v0 < 1e-6) continue;
    const middle = (v0 + v1) / 2;
    let spans: [number, number][] = [[uMin, uMax]];
    for (const hole of holes) {
      if (middle <= hole.v0 + 1e-9 || middle >= hole.v1 - 1e-9) continue;
      const next: [number, number][] = [];
      for (const [a, b] of spans) {
        if (hole.u1 <= a || hole.u0 >= b) { next.push([a, b]); continue; }
        if (hole.u0 > a) next.push([a, hole.u0]);
        if (hole.u1 < b) next.push([hole.u1, b]);
      }
      spans = next;
    }
    for (const [a, b] of spans) if (b - a > 1e-6) panels.push([a, b, v0, v1]);
  }
  return panels;
}

/**
 * Decoration of a greybox lift shaft centred on `centre` (renderer space): glass faces with a 0.9 x 2.1 m door hole at
 * each stop, corner posts, a steel ring at each stop, door frames, and the car parked at the lowest stop. Nothing here
 * collides: the walls come from the shaft's walkable model.
 */
export function buildElevator(centre: THREE.Vector3, stops: readonly { y: number; face: number; offset?: number }[], tier: "high" | "low"): ConnectorPart[] {
  const parts: ConnectorPart[] = [], half = SHAFT_HALF, yMin = stops[0]!.y - (tier === "low" ? 0.12 : 0.1), yMax = stops.at(-1)!.y + 2.6;
  const holes = new Map<number, { u0: number; u1: number; v0: number; v1: number }[]>();
  // Face frames look along the normal, so their u axis is the plan tangent (-n.z, n.x) negated: a door offset flips sign.
  const u = (stop: { offset?: number }) => -(stop.offset ?? 0);
  for (const stop of stops) holes.set(stop.face, [...(holes.get(stop.face) ?? []), { u0: u(stop) - DOOR_HALF, u1: u(stop) + DOOR_HALF, v0: stop.y - (tier === "low" ? 0.12 : 0), v1: stop.y + (tier === "low" ? 2.6 : 2.1) }]);
  const faceFrame = (normal: THREE.Vector3) => new THREE.Matrix4().makeRotationY(Math.atan2(normal.x, normal.z)).setPosition(centre.x, 0, centre.z);
  SHAFT_NORMALS.forEach((normal, index) => {
    const faceHoles = holes.get(index) ?? [];
    for (const [u0, u1, v0, v1] of freePanels(-half, half, yMin, yMax, faceHoles)) {
      box(parts, tier === "high" ? "glass" : "escTruss", faceFrame(normal), (u0 + u1) / 2, (v0 + v1) / 2, half, u1 - u0, v1 - v0, tier === "high" ? 0.02 : 0.04);
    }
  });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(parts, "steel", new THREE.Matrix4(), centre.x + sx * (half - 0.04), (yMin + yMax) / 2, centre.z + sz * (half - 0.04), 0.08, yMax - yMin, 0.08);
  for (const stop of stops) {
    const { y, face } = stop;
    for (const sz of [-1, 1]) box(parts, "steel", new THREE.Matrix4(), centre.x, y + 0.04, centre.z + sz * (half + 0.01), 2 * half, 0.08, 0.08);
    for (const sx of [-1, 1]) box(parts, "steel", new THREE.Matrix4(), centre.x + sx * (half + 0.01), y + 0.04, centre.z, 0.08, 0.08, 2 * half);
    const frame = faceFrame(SHAFT_NORMALS[face]!);
    for (const side of [-1, 1]) box(parts, "steel", frame, u(stop) + side * 0.49, y + 1.05, half, 0.08, 2.1, 0.12);
    box(parts, "steel", frame, u(stop), y + 2.14, half, 1.06, 0.08, 0.12);
    box(parts, "light", frame, u(stop), y + 2.33, half + 0.08, 0.3, 0.06, 0.04);
  }
  // The car: three steel walls and a lit ceiling, open toward the lowest stop's door; the stop square is its floor.
  const bottom = stops[0]!, door = SHAFT_NORMALS[bottom.face]!, car = new THREE.Matrix4().makeRotationY(Math.atan2(door.x, door.z)).setPosition(centre.x, bottom.y + 1.15, centre.z);
  box(parts, "steel", car.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.75)), 0, 0, 0, 1.6, 2.3, 0.04);
  for (const side of [-1, 1]) box(parts, "steel", car.clone().multiply(new THREE.Matrix4().makeTranslation(side * 0.78, 0, 0)), 0, 0, 0, 0.04, 2.3, 1.5);
  box(parts, "light", new THREE.Matrix4(), centre.x, bottom.y + 2.28, centre.z, 1.4, 0.02, 1.3);
  return parts;
}

/**
 * Lift edges whose car nodes lie within one shaft footprint form one shaft (#645 plan: n:cbae's three edges share one).
 * The shaft is centred on the plan centroid of its car nodes; its stops are the distinct car heights, lowest first.
 */
function liftShafts(edges: readonly Edge[], ends: (edge: Edge) => [{ id: string; at: THREE.Vector3 }, { id: string; at: THREE.Vector3 }]) {
  const parent = edges.map((_e, i) => i);
  const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]!));
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const near = ends(edges[i]!).some((a) => ends(edges[j]!).some((b) => Math.max(Math.abs(a.at.x - b.at.x), Math.abs(a.at.z - b.at.z)) <= SHAFT_HALF));
    if (near) parent[root(i)] = root(j);
  }
  const groups = new Map<number, Edge[]>();
  edges.forEach((edge, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), edge]));
  return [...groups.values()].map((group) => {
    const cars = new Map<string, THREE.Vector3>();
    for (const edge of group) for (const end of ends(edge)) cars.set(end.id, end.at);
    const centre = new THREE.Vector3();
    for (const at of cars.values()) centre.add(at);
    centre.divideScalar(cars.size); centre.y = 0;
    const stops: { y: number; nodeIds: string[] }[] = [];
    for (const [id, at] of [...cars].sort((a, b) => a[1].y - b[1].y)) {
      const stop = stops.at(-1);
      if (stop && at.y - stop.y <= 0.5) stop.nodeIds.push(id); else stops.push({ y: at.y, nodeIds: [id] });
    }
    return { id: group.map((edge) => edge.id).sort()[0]!, edges: group, centre, stops };
  });
}

/**
 * The walkable regions of one connector: a strip level per flight (the legs between turning landings, discs at shallow
 * bends), a rect level per turning landing, and the connector footprints that join them (see buildConnectors).
 */
function edgeRegions(edge: Edge, points: readonly THREE.Vector3[], half: number, isTurn: (index: number) => boolean, floored: (index: number) => boolean, junction: (index: number, level: string, side: "from" | "to") => void, regions: Region[], levels: Map<string, { edge: Edge; landing: boolean }>) {
  // Level legs at either end that lie on station floor are that floor, not part of the stair: they carry no wall, so a
  // walk edge that meets the same node from the side is not cut off. Off the floor they keep their walls, or a walker
  // could step off the generated tread. The model starts at the first and ends at the last such climb.
  const climbs = (i: number) => Math.abs(points[i + 1]!.y - points[i]!.y) > 1e-6 || !floored(i);
  let first = 0, last = points.length - 1;
  while (first < last - 1 && !climbs(first)) first++;
  while (last > first + 1 && !climbs(last - 1)) last--;
  const turns = points.map((_p, i) => i).filter((i) => i > first && i < last && isTurn(i));
  const square = (j: number) => planQuad(points[j]!.clone().addScaledVector(planDir(points[j - 1]!, points[j]!), -half), planDir(points[j - 1]!, points[j]!), 2 * half, half);
  // A flight also starts a new level once its shallow bends add up past 90 degrees, so a spiral of shallow bends never
  // stacks over itself inside one plan union (its walls would keep only one height).
  const soft = new Set<number>();
  for (let t = 0, hard = [first, ...turns, last]; t + 1 < hard.length; t++) {
    let turned = 0;
    for (let i = hard[t]! + 1; i < hard[t + 1]!; i++) {
      const bend = bendAngle(points, i);
      if (turned + bend > Math.PI / 2) { soft.add(i); turned = 0; } else turned += bend;
    }
  }
  const bounds = [first, ...turns, ...soft, last].sort((a, b) => a - b);
  for (let k = 1; k < bounds.length; k++) {
    const lo = bounds[k - 1]!, hi = bounds[k]!, level = `connector:${edge.id}:flight:${k - 1}`;
    levels.set(level, { edge, landing: false });
    regions.push({ kind: "strip", level, points: points.slice(lo, hi + 1).map((p) => ({ x: p.x, y: p.y, z: p.z })), halfWidth: half });
    for (let i = soft.has(lo) ? lo : lo + 1; i <= (soft.has(hi) ? hi : hi - 1); i++) {
      // Radius half: out at the mitre distance, a disc vertex lands exactly on a strip corner and trips polygon-clipping.
      if (bendAngle(points, i) > 1e-6) regions.push({ kind: "disc", level, x: points[i]!.x, y: points[i]!.y, z: points[i]!.z, radius: half });
    }
    for (const [end, next] of [[lo, lo + 1], [hi, hi - 1]] as const) {
      if (soft.has(end)) {
        // At a soft split the neighbouring level's flight, through its bends, for 2 * half + 0.1 m of plan length: every point of
        // the split's disc (within `half` of the split) lies within `half` of that stretch of centreline, so the opening covers
        // it and the two levels meet without a wall. At each joint a full-size disc-shaped connector footprint closes the wedge
        // between turning pieces; as a connector it carries no wall where its rim passes the neighbouring flight's edge.
        const step = end - next;
        let left = 2 * half + 0.1;
        for (let a = end, b = end + step; b >= 0 && b < points.length && left > 1e-6; a = b, b += step) {
          const leg = Math.hypot(points[b]!.x - points[a]!.x, points[b]!.z - points[a]!.z);
          regions.push({ kind: "connector", level, y: points[a]!.y, quad: planQuad(points[a]!, planDir(points[a]!, points[b]!), Math.min(left, leg), half) });
          left -= leg;
          if (left > 1e-6) regions.push({ kind: "connector", level, y: points[b]!.y, quad: discRing(points[b]!, half) });
        }
        continue;
      }
      const quad = end === first || end === last ? planQuad(points[end]!, planDir(points[next]!, points[end]!), MOUTH_M, half) : square(end);
      regions.push({ kind: "connector", level, y: points[end]!.y, quad });
      // Where two generated connectors meet at a node, their flights overlap in plan there: buildConnectors makes the other's
      // footprint near the node a connector footprint of this level too.
      if (end === first || end === last) junction(end, level, end === first ? "from" : "to");
    }
    // The level legs before the first climb and after the last, as open footprints of the end flights.
    if (k === 1) for (let i = 0; i < first; i++) regions.push({ kind: "connector", level, y: points[i]!.y, quad: planQuad(points[i]!, planDir(points[i]!, points[i + 1]!), Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.z - points[i]!.z), half) });
    if (k === bounds.length - 1) for (let i = last; i < points.length - 1; i++) regions.push({ kind: "connector", level, y: points[i]!.y, quad: planQuad(points[i]!, planDir(points[i]!, points[i + 1]!), Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.z - points[i]!.z), half) });
  }
  // Turning landings joined by level legs, through any shallow bends between them, are one landing: one level, so where
  // their squares overlap no guard stands across the other's flight.
  const landingOf = new Map<number, number>();
  for (const j of turns) {
    let i = j - 1;
    while (i >= 0 && !turns.includes(i) && Math.abs(points[i]!.y - points[j]!.y) <= 1e-6) i--;
    landingOf.set(j, i >= 0 && turns.includes(i) && Math.abs(points[i]!.y - points[j]!.y) <= 1e-6 ? landingOf.get(i)! : j);
  }
  for (const j of turns) {
    const level = `connector:${edge.id}:landing:${landingOf.get(j)}`, centre = points[j]!, axis = planDir(points[j - 1]!, centre);
    levels.set(level, { edge, landing: true });
    regions.push({ kind: "rect", level, center: { x: centre.x, y: centre.y, z: centre.z }, along: { x: axis.x, z: axis.z }, halfLength: half, halfWidth: half });
    // Stubs follow each of the landing's own flights for up to 2 * half of plan length, through shallow bends, so the
    // outline opens wherever its own flight passes under or over it.
    for (const step of [-1, 1]) {
      let left = 2 * half;
      for (let a = j, b = j + step; b >= 0 && b < points.length && left > 1e-6; a = b, b += step) {
        const leg = Math.hypot(points[b]!.x - points[a]!.x, points[b]!.z - points[a]!.z);
        // A flight that ends the stair inside the outline opens it out to the square's corners: the floor continues past
        // its end node. No further, or the stub would attach other levels' walls it does not reach.
        const end = b <= first || b >= last;
        const reach = end ? Math.max(Math.min(left, leg), half * Math.SQRT2 + 0.01 - (2 * half - left)) : Math.min(left, leg);
        // 1 cm narrower than the landing: a stub side collinear with the outline would drop that stretch of the guard.
        regions.push({ kind: "connector", level, y: centre.y, quad: planQuad(points[a]!, planDir(points[a]!, points[b]!), reach, half - 0.01) });
        left -= leg;
        if (end || isTurn(b)) break;
        // Through a shallow bend the next stub turns: a disc-shaped connector footprint at the joint closes the wedge between the
        // two and, like the stubs, carries no wall. No wider than the reach still left, so it never sticks out past the last
        // stub's end.
        if (left > 1e-6) regions.push({ kind: "connector", level, y: centre.y, quad: discRing(points[b]!, Math.min(half - 0.01, left)) });
      }
    }
  }
}

/** A connector footprint reaches this far past its tread, so its guard stands just outside the walking surface. */
const FOOTPRINT_PAD_M = 0.03;

/**
 * Build runtime-only batches for missing vertical transport. Side walls and landing guards are the boundary of the
 * connector's walkable model, so any plan shape builds, stacked returns included; a run shorter than 0.3 m is skipped
 * under `short_run`. The legacy builder (unsupported_shape) is unused and goes in #645 step 6.
 */
export function buildConnectors(bundle: StationBundle, traversable: (edge: Edge) => boolean, scope: ConnectorScope, tier: "high" | "low") {
  const root = new THREE.Group(), walkable: THREE.Object3D[] = [], colliders: THREE.Object3D[] = [];
  const wallSegments: Segment2[] = [];
  const pathByEdge = new Map<string, V3[]>();
  const segments: { line: THREE.Line3; halfWidth: number }[] = [];
  const nodes = new Map(bundle.nodes.map((node) => [node.id, node]));
  const floors = new Map(bundle.floors.map((floor) => [floor.id, floor]));
  const batches = new Map<string, ConnectorPart[]>();
  const counts = { escalator: 0, stairs: 0, elevator: 0 };
  let approximateFits = 0, omittedLandings = 0, connectorsSkipped = 0;
  const connectorsSkippedByReason: Record<"unsupported_shape" | "short_run", number> = { unsupported_shape: 0, short_run: 0 };
  const skippedEdgeIds: string[] = [];
  // An unsupported shape is not left out: main's builder builds it as before (#640 r18 ruling), so it is not a skipped edge.
  const legacyEdgeIds = new Set<string>();
  const skip = (reason: keyof typeof connectorsSkippedByReason, edgeId: string) => {
    connectorsSkipped++; connectorsSkippedByReason[reason]++;
    if (reason === "unsupported_shape") legacyEdgeIds.add(edgeId); else skippedEdgeIds.push(edgeId);
  };
  const shellMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, side: THREE.DoubleSide });
  const lightMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: "#fff6e8", emissiveIntensity: 3.2, side: THREE.DoubleSide });
  const lampMaterials = [lightMaterial, new THREE.MeshStandardMaterial({ color: "#00ff00", emissive: "#00ff00", emissiveIntensity: 3.2 }), new THREE.MeshStandardMaterial({ color: "#ff0000", emissive: "#ff0000", emissiveIntensity: 3.2 })];
  const glassMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false, roughness: 0.32, metalness: 0.08, side: THREE.DoubleSide });
  const physicalMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  // Walls come from one walkable model (#645 step 2): every flight and every turning landing is its own level, so stacked
  // flights keep their own outlines. A flight's level also holds the landing squares at its ends, and a landing's level
  // stubs of the flights it meets, as connector footprints: their outlines split the boundary exactly and never carry a
  // wall. Where a flight meets a landing at the same height the boundary is an attachment; everything else is a side
  // wall or a landing guard. A mouth footprint at each end of the stair leaves the way onto the floor open.
  const levels = new Map<string, { edge: Edge; landing: boolean }>();
  const built: { edge: Edge; parts: ConnectorPart[]; pads: { part: ConnectorPart; floorId: string }[]; path: THREE.Vector3[]; halfWidth: number }[] = [];
  const regionsByEdge = new Map<string, Region[]>();
  const unmodelled = unmodelledVerticalEdges(bundle, traversable, scope.hasFloor, scope.nearMesh);
  const halfOf = (edge: Edge) => {
    const rawWidth = (edge.attributes as unknown as { width?: { m?: number } } | undefined)?.width?.m;
    return ((edge.mode === "stairs" ? (rawWidth && rawWidth > 0 ? rawWidth : 1.5) : 1.2) / 2) + FOOTPRINT_PAD_M;
  };
  // Rise per plan metre from `at` toward `toward`: a first leg's pitch leaving its node.
  const gradeAway = (at: THREE.Vector3, toward: THREE.Vector3) => (toward.y - at.y) / (Math.hypot(toward.x - at.x, toward.z - at.z) || 1);
  // A run too short in plan to build a flight on is skipped.
  const shortRun = (points: readonly THREE.Vector3[]) => {
    const planRuns = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.z - points[i]!.z));
    return planRuns.reduce((a, b) => a + b, 0) < 0.3 || planRuns.some((run, i) => run < 0.3 && Math.abs(points[i + 1]!.y - points[i]!.y) > 1e-6);
  };
  // Every connector that will be built: where it leaves each of its nodes, its plan direction and half-width there.
  const mouths = new Map<string, { edgeId: string; at: THREE.Vector3; dir: THREE.Vector3; half: number; leg: number; grade: number; points: THREE.Vector3[] }[]>();
  for (const edge of unmodelled) {
    const pts = simplifyPlan(edgePoints(bundle, edge, nodes, floors));
    if (pts.length < 2 || shortRun(pts)) continue;
    for (const [node, at, toward] of [[edge.from, pts[0]!, pts[1]!], [edge.to, pts.at(-1)!, pts.at(-2)!]] as const) {
      const list = mouths.get(node) ?? [];
      list.push({ edgeId: edge.id, at, dir: planDir(at, toward), half: halfOf(edge), leg: Math.hypot(toward.x - at.x, toward.z - at.z), grade: gradeAway(at, toward), points: at === pts[0] ? pts : [...pts].reverse() });
      mouths.set(node, list);
    }
  }
  const junctions: { edgeId: string; node: string; level: string; at: THREE.Vector3; dir: THREE.Vector3; half: number; grade: number }[] = [];
  for (const edge of unmodelled) {
    const points = simplifyPlan(edgePoints(bundle, edge, nodes, floors));
    if (shortRun(points)) { skip("short_run", edge.id); continue; }
    const rawWidth = (edge.attributes as unknown as { width?: { m?: number } } | undefined)?.width?.m;
    const width = rawWidth && rawWidth > 0 ? rawWidth : 1.5;
    const halfWidth = (edge.mode === "stairs" ? width : 1.2) / 2;
    const half = halfWidth + FOOTPRINT_PAD_M;
    const bendAt = (index: number) => (edge.mode === "stairs" ? bendAngle(points, index) : 0);
    const isTurn = (index: number) => bendAt(index) >= SHALLOW_BEND;
    let bentEscalator = false;
    for (let i = 1; i + 1 < points.length; i++) {
      const before = points[i]!.clone().sub(points[i - 1]!); before.y = 0;
      const after = points[i + 1]!.clone().sub(points[i]!); after.y = 0;
      if (before.lengthSq() && after.lengthSq() && before.angleTo(after) > Math.PI / 18) bentEscalator = true;
    }
    const ownRegions: Region[] = [];
    // A leg is on the floor when floor lies under its centreline every 0.25 m, twice as dense as the scope's own gap test
    // (in bundle axes): a gap anywhere along it keeps its walls. Its edges are not sampled: a station floor outline is often
    // narrower than the stair, and walls there would cut the walk edges that join the stair from the side.
    const onFloor = (p: THREE.Vector3) => scope.hasFloor({ x: p.x, y: -p.z, z: p.y });
    const floored = (i: number) => {
      const a = points[i]!, b = points[i + 1]!, count = Math.max(1, Math.ceil(a.distanceTo(b) / 0.25));
      for (let k = 0; k <= count; k++) if (!onFloor(a.clone().lerp(b, k / count))) return false;
      return true;
    };
    // An end at a node another generated connector also meets is a junction (on station floor, or on the endpoint pad built
    // where floor is missing); it is opened once every connector's regions exist.
    // An end is its node's even where a floor-backed level leg before it was trimmed off.
    const junction = (i: number, level: string, side: "from" | "to") => {
      const toward = points[side === "from" ? i + 1 : i - 1]!;
      junctions.push({ edgeId: edge.id, node: side === "from" ? edge.from : edge.to, level, at: points[i]!, dir: planDir(points[i]!, toward), half, grade: gradeAway(points[i]!, toward) });
    };
    edgeRegions(edge, points, half, isTurn, floored, junction, ownRegions, levels);
    regionsByEdge.set(edge.id, ownRegions);
    const parts: ConnectorPart[] = [];
    const edgePath: THREE.Vector3[] = [];
    let edgeOmitted = 0;
    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1]!, to = points[i]!;
      let flightPath: THREE.Vector3[];
      if (Math.abs(to.y - from.y) > 1e-6) {
        const flight = edge.mode === "stairs" ? buildStairs(from, to, width, tier) : buildEscalator(from, to, tier);
        edgeOmitted += flight[0]?.userData?.omittedLandings ?? 0;
        if (edge.mode === "stairs") {
          for (const p of flight) if (p.role === "walkable" && p.material === "tread") p.role = undefined;
          flightPath = stairWalk(from, to, width, parts);
        } else flightPath = escalatorWalk(from, to);
        parts.push(...flight);
      }
      else {
        flightPath = [from.clone(), to.clone()];
        const f = frame(from, to);
        box(parts, edge.mode === "stairs" ? "tread" : "escStep", f.matrix, f.length / 2, -0.04, 0, f.length, 0.08, edge.mode === "stairs" ? width : 1.2, "walkable");
      }
      if (edgePath.length && edgePath.at(-1)!.distanceTo(flightPath[0]!) < 1e-6) flightPath.shift();
      edgePath.push(...flightPath);
      const incoming = to.clone().sub(from); incoming.y = 0;
      const outgoing = i < points.length - 1 ? points[i + 1]!.clone().sub(to) : new THREE.Vector3(); outgoing.y = 0;
      if (incoming.lengthSq() && outgoing.lengthSq() && incoming.angleTo(outgoing) > 1e-6) {
        const rotation = new THREE.Matrix4().makeRotationY(Math.atan2(-(to.z - from.z), to.x - from.x)).setPosition(to);
        box(parts, edge.mode === "stairs" ? "tread" : "escStep", rotation, 0, -0.04, 0, edge.mode === "stairs" ? width : 1.2, 0.08, edge.mode === "stairs" ? width : 1.2, "walkable");
      }
    }
    const lowerFirst = points[0]!.y <= points.at(-1)!.y ? edgePath : edgePath.reverse();
    pathByEdge.set(edge.id, lowerFirst.map((p) => ({ x: p.x, y: p.y, z: p.z })));
    // Extend unsupported endpoints into the approaching passage at the landing height.
    const pads: { part: ConnectorPart; floorId: string }[] = [];
    for (const [index, floorNode] of [[0, edge.from], [points.length - 1, edge.to]] as const) {
      const endpoint = points[index]!;
      if (scope.hasFloor({ x: endpoint.x, y: -endpoint.z, z: endpoint.y })) continue;
      const next = points[index === 0 ? 1 : index - 1]!;
      const dx = endpoint.x - next.x, dz = endpoint.z - next.z;
      const transform = new THREE.Matrix4().makeRotationY(Math.hypot(dx, dz) > 1e-9 ? Math.atan2(-dz, dx) : 0).setPosition(endpoint);
      const pad: ConnectorPart[] = [];
      box(pad, "tread", transform, 0.75, -0.04, 0, 1.5, 0.08, width, "walkable");
      pad[0]!.edgeId = edge.id;
      const floorId = nodes.get(floorNode)?.floorId ?? "";
      pads.push({ part: pad[0]!, floorId });
    }
    if (edge.mode === "escalator" && bentEscalator) for (const p of parts) p.userData = { ...p.userData, fit: "approximate" };
    if (edge.mode === "stairs" || edge.mode === "escalator") counts[edge.mode]++;
    omittedLandings += edgeOmitted;
    built.push({ edge, parts, pads, path: lowerFirst, halfWidth });
  }
  // Each connector, with the connectors it shares a node with, is its own model: another connector's floor at the same
  // height is not this one's walkway, so two flights side by side keep the walls between them, while two stairs meeting at
  // a node attach to each other there (every flight is its own level either way). A group that polygon-clipping cannot
  // union (it can throw on exactly coincident input) is left to the legacy builder.
  // At a junction the other connectors' own walkable footprint near the node is a connector footprint of this end's level
  // too: neither's walls stand across the other's exit, and only where the other really has floor (its own level keeps
  // its walls). Near means within 2 * half of the wider of the two, or where they leave the node at an acute angle, as far
  // as the other takes to clear this one (2 * half / sin of the angle). Clip that opening wherever the actual polyline
  // surfaces differ by more than a step, including after level approaches and later pitch changes.
  const builtRegions = new Map([...regionsByEdge].map(([id, list]) => [id, [...list]]));
  const junctionFloors = new Map<string, { at: PlanPoint; radius: number; level: string; otherEdge: string; otherLevel: string; points: readonly V3[]; ownPoints: readonly V3[]; polygons: MultiPolygon }[]>();
  for (const j of junctions) for (const m of mouths.get(j.node) ?? []) {
    // Only the other connector's level that meets this node: a flight of it passing overhead is no opening.
    const meets = junctions.find((k) => k.edgeId === m.edgeId && k.node === j.node);
    const other = meets && builtRegions.get(m.edgeId)?.filter((r) => r.level === meets.level);
    if (m.edgeId === j.edgeId || !other) continue;
    const reach = 2 * Math.max(m.half, j.half), sin = Math.abs(j.dir.x * m.dir.z - j.dir.z * m.dir.x);
    const along = j.dir.x * m.dir.x + j.dir.z * m.dir.z > 0 ? Math.max(reach, reach / Math.max(sin, 0.1)) : reach;
    const own = mouths.get(j.node)!.find((mouth) => mouth.edgeId === j.edgeId)!;
    const ownPath = junctionPath(own.points, builtRegions.get(j.edgeId)!.filter((r) => r.level === j.level));
    const otherPath = junctionPath(m.points, other);
    const asClipping = (ring: readonly PlanPoint[]) => ring.map((p): [number, number] => [p.x, p.z]);
    try {
      const polygons = other.flatMap((r) => regionPolygon(r)).map((polygon) => insetJunctionRing(polygon[0]!)).filter((ring) => ring.length >= 3).map((ring) => [asClipping(ring)]);
      if (!polygons.length) continue;
      const floors = junctionFloors.get(j.edgeId) ?? [];
      floors.push({ at: j.at, radius: along, level: j.level, otherEdge: m.edgeId, otherLevel: meets!.level, points: otherPath, ownPoints: ownPath, polygons }); junctionFloors.set(j.edgeId, floors);
      const near = junctionOpenings(polygons, discRing(j.at, along), ownPath, otherPath);
      for (const polygon of near) regionsByEdge.get(j.edgeId)!.push({ kind: "connector", level: j.level, y: j.at.y, quad: polygon[0]!.slice(0, -1).map(([x, z]) => ({ x, z })) });
    } catch { legacyEdgeIds.add(j.edgeId); legacyEdgeIds.add(m.edgeId); }
  }
  // A plain walk edge can also approach a connector from its side. Open only its actual footprint
  // near the shared node, and only where its walking height meets the flight.
  for (const j of junctions) for (const edge of bundle.edges) {
    if (edge.mode !== "walk" || !traversable(edge) || (edge.from !== j.node && edge.to !== j.node)) continue;
    const points = edgePoints(bundle, edge, nodes, floors);
    if (edge.to === j.node) points.reverse();
    if (points.length < 2) continue;
    const rawWidth = (edge.attributes as unknown as { width?: { m?: number } } | undefined)?.width?.m;
    const half = (rawWidth && rawWidth > 0 ? rawWidth : 2) / 2;
    const own = mouths.get(j.node)?.find((mouth) => mouth.edgeId === j.edgeId);
    if (!own) continue;
    const ownPath = junctionPath(own.points, builtRegions.get(j.edgeId)!.filter((r) => r.level === j.level));
    const walk: Region = { kind: "strip", level: j.level, points, halfWidth: half };
    const polygons = regionPolygon(walk).map((polygon) => polygon.map((ring) => ring.map((p): [number, number] => [p.x, p.z])));
    const near = junctionOpenings(polygons, discRing(j.at, 2 * Math.max(j.half, half)), ownPath, points);
    for (const polygon of near) regionsByEdge.get(j.edgeId)!.push({ kind: "connector", level: j.level, y: j.at.y, quad: polygon[0]!.slice(0, -1).map(([x, z]) => ({ x, z })) });
  }
  const edgeById = new Map(bundle.edges.map((edge) => [edge.id, edge]));
  // Guard caps follow the drawn walking surface too, including generated treads and mid-flight landings.
  const drawnPath = (edgeId: string, points: readonly V3[], level: string) => {
    const path = pathByEdge.get(edgeId)!, at = points[0]!;
    const distance = (p: V3) => Math.hypot(p.x - at.x, p.y - at.y, p.z - at.z);
    return junctionPath(distance(path[0]!) <= distance(path.at(-1)!) ? path : [...path].reverse(), builtRegions.get(edgeId)!.filter((r) => r.level === level));
  };
  for (const [edgeId, floors] of junctionFloors) for (const floor of floors) {
    floor.points = drawnPath(floor.otherEdge, floor.points, floor.otherLevel);
    floor.ownPoints = drawnPath(edgeId, floor.ownPoints, floor.level);
  }
  const groupOf = new Map<string, string>(), byNode = new Map<string, string>();
  const findGroup = (id: string): string => { const up = groupOf.get(id) ?? id; if (up === id) return id; const top = findGroup(up); groupOf.set(id, top); return top; };
  for (const edgeId of regionsByEdge.keys()) {
    groupOf.set(edgeId, edgeId);
    const edge = edgeById.get(edgeId)!;
    for (const node of [edge.from, edge.to]) {
      const other = byNode.get(node);
      if (other) groupOf.set(findGroup(edgeId), findGroup(other)); else byNode.set(node, edgeId);
    }
  }
  const groups = new Map<string, string[]>();
  for (const edgeId of regionsByEdge.keys()) { const g = findGroup(edgeId); groups.set(g, [...(groups.get(g) ?? []), edgeId]); }
  const modelWalls: BoundaryWall[] = [];
  for (const edgeIds of groups.values()) {
    // A connected generated walk keeps its rendered floors; this caller consumes walls, not slab cuts.
    try { modelWalls.push(...buildWalkableModel(edgeIds.flatMap((id) => regionsByEdge.get(id)!.map((r) => ({ ...r, group: edgeIds[0]! }))), undefined, WALKER_BODY.stepUpM, 2 * FOOTPRINT_PAD_M - 0.001).walls); }
    catch { for (const id of edgeIds) legacyEdgeIds.add(id); }
  }
  const failed = (edgeId: string) => legacyEdgeIds.has(edgeId);
  for (let k = built.length - 1; k >= 0; k--) {
    if (!failed(built[k]!.edge.id)) continue;
    const { edge } = built.splice(k, 1)[0]!;
    pathByEdge.delete(edge.id);
    if (edge.mode === "stairs" || edge.mode === "escalator") counts[edge.mode]--;
  }
  const partsByEdge = new Map(built.map((b) => [b.edge.id, b.parts]));
  for (const wall of modelWalls) {
    const owner = levels.get(wall.level);
    const parts = owner && partsByEdge.get(owner.edge.id);
    if (!owner || !parts) continue;
    const length = Math.hypot(wall.bx - wall.ax, wall.bz - wall.az);
    if (length < 1e-6) continue;
    const joined = junctionFloors.has(owner.edge.id), below = joined ? 0 : 0.12;
    // A higher floor caps a lower guard: it still holds the lower body but cannot block a body already on that floor.
    const capGuard = (segment: Segment2, high: number) => {
      const samples = [{ x: segment.ax, z: segment.az }, { x: (segment.ax + segment.bx) / 2, z: (segment.az + segment.bz) / 2 }, { x: segment.bx, z: segment.bz }];
      for (const floor of junctionFloors.get(owner.edge.id) ?? []) {
        if (floor.level !== wall.level) continue;
        const inside = (p: PlanPoint) => floor.polygons.some((polygon) => {
          const ring = polygon[0]!;
          let hit = false;
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const a = ring[i]!, b = ring[j]!;
            if ((a[1] > p.z) !== (b[1] > p.z) && p.x < (b[0] - a[0]) * (p.z - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
          }
          return hit;
        });
        if (!samples.every((p) => Math.hypot(p.x - floor.at.x, p.z - floor.at.z) <= floor.radius && inside(p))) continue;
        const top = Math.min(...samples.map((p) => junctionHeight(floor.points, p)));
        const bodyBottom = Math.max(...samples.map((p) => junctionHeight(floor.ownPoints, p))) + WALKER_BODY.bodyBottomM;
        if (top >= high + WALKER_BODY.stepUpM - 1e-6 && top > bodyBottom + FOOTPRINT_PAD_M) segment.yMax = Math.min(segment.yMax, top);
      }
    };
    if (owner.landing) {
      if (length < 0.02) continue;
      // A landing guard: handrail and a walk-only collider, as a turning landing has always had.
      const y = Math.min(wall.ay, wall.by);
      const segment = { ax: wall.ax, az: wall.az, bx: wall.bx, bz: wall.bz, yMin: y - below, yMax: y + 0.96 };
      capGuard(segment, y); wallSegments.push(segment);
      const transform = new THREE.Matrix4().makeRotationY(Math.atan2(-(wall.bz - wall.az), wall.bx - wall.ax)).setPosition((wall.ax + wall.bx) / 2, y, (wall.az + wall.bz) / 2);
      box(parts, "steel", transform, 0, segment.yMax - y, 0, length, 0.052, 0.052);
      box(parts, "steel", transform, 0, (segment.yMax + segment.yMin) / 2 - y, 0, length, segment.yMax - segment.yMin, 0.04, "collider"); parts.at(-1)!.walkableOnly = true;
      continue;
    }
    // A flight's side wall, in pieces of at most 0.5 m so each follows the slope; stairs also get a walk-only collider.
    // An overhead guard must not borrow a lower endpoint's height across half a metre of slope.
    const n = Math.max(1, Math.ceil(length / (joined ? 0.05 : 0.5)));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const ax = wall.ax + (wall.bx - wall.ax) * t0, az = wall.az + (wall.bz - wall.az) * t0, ya = wall.ay + (wall.by - wall.ay) * t0;
      const bx = wall.ax + (wall.bx - wall.ax) * t1, bz = wall.az + (wall.bz - wall.az) * t1, yb = wall.ay + (wall.by - wall.ay) * t1;
      const segment = { ax, az, bx, bz, yMin: Math.min(ya, yb) - below, yMax: Math.max(ya, yb) + 0.96 };
      capGuard(segment, Math.max(ya, yb)); wallSegments.push(segment);
      if (owner.edge.mode === "stairs") {
        const transform = new THREE.Matrix4().makeRotationY(Math.atan2(-(bz - az), bx - ax)).setPosition((ax + bx) / 2, (segment.yMin + segment.yMax) / 2, (az + bz) / 2);
        box(parts, "steel", transform, 0, 0, 0, Math.hypot(bx - ax, bz - az), segment.yMax - segment.yMin, 0.04, "collider"); parts.at(-1)!.walkableOnly = true;
      }
    }
  }
  for (const { edge, parts, pads, path, halfWidth } of built) {
    for (let i = 1; i < path.length; i++) segments.push({ line: new THREE.Line3(path[i - 1]!.clone(), path[i]!.clone()), halfWidth });
    for (const part of parts) part.edgeId = edge.id;
    if (parts.some((p) => p.userData?.fit === "approximate")) approximateFits++;
    const key = tier === "low" ? "all" : nodes.get(edge.from)?.floorId ?? "";
    const batch = batches.get(key) ?? []; batch.push(...parts.filter((p) => !p.walkableOnly)); batches.set(key, batch);
    for (const pad of pads) {
      const floorKey = tier === "low" ? "all" : pad.floorId;
      const floorBatch = batches.get(floorKey) ?? []; floorBatch.push(pad.part); batches.set(floorKey, floorBatch);
    }
    const support = [...parts.filter((p) => p.role === "walkable"), ...pads.map((pad) => pad.part)], walls = parts.filter((p) => p.role === "collider");
    if (support.length) walkable.push(meshFor(support, physicalMaterial));
    if (walls.length) colliders.push(meshFor(walls, physicalMaterial));
  }
  // Lift shafts (#645 step 2b, #648): each shaft is its own model with a stop square per stop and a 0.9 m door footprint
  // on the face toward that stop's hall, so the shaft is walled everywhere but its doors. The ride goes from the car node
  // to the shaft centre, straight up, and out to the other car node.
  const liftEdges = unmodelledLiftEdges(bundle, traversable, scope.hasFloor, scope.nearMesh);
  const liftEnds = (edge: Edge): [{ id: string; at: THREE.Vector3 }, { id: string; at: THREE.Vector3 }] => {
    const points = edgePoints(bundle, edge, nodes, floors);
    return [{ id: edge.from, at: points[0]! }, { id: edge.to, at: points.at(-1)! }];
  };
  const hallEdges = bundle.edges.filter((edge) => edge.mode === "walk").sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const landingStubs = bundle.edges.filter((edge) => edge.mode === "elevator").sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const shaft of liftShafts(liftEdges, liftEnds)) {
    // Choose the lowest hall node id, then walk edge id, independently of bundle order; rides are never halls.
    // Follow the hall away from the car: its first segment leaving the shaft chooses the door face and offset.
    const doorOf = (nodeIds: readonly string[], stopY: number): { face: number; offset: number } => {
      // A same-level car-to-hall stub joins the stop to its walking hall; it cannot itself choose a door.
      const starts = [...nodeIds].sort().flatMap((nodeId) => {
        const starts = [{ nodeId, approach: [] as THREE.Vector3[] }];
        for (const stub of landingStubs) {
          if (!traversable(stub) || (stub.from !== nodeId && stub.to !== nodeId)) continue;
          const approach = edgePoints(bundle, stub, nodes, floors);
          if (approach.length < 2 || Math.max(...approach.map((p) => p.y)) - Math.min(...approach.map((p) => p.y)) > 0.5) continue;
          if (stub.to === nodeId) approach.reverse();
          starts.push({ nodeId: stub.from === nodeId ? stub.to : stub.from, approach });
        }
        return starts;
      }).sort((a, b) => a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0);
      for (const { nodeId, approach } of starts) for (const other of hallEdges) {
        if (!traversable(other) || (other.from !== nodeId && other.to !== nodeId)) continue;
        const hall = edgePoints(bundle, other, nodes, floors);
        if (hall.length < 2) continue;
        if (other.to === nodeId) hall.reverse();
        const points = [...approach.slice(0, -1), ...hall];
        const firstOutside = points.findIndex((p, i) => i > 0 && Math.max(Math.abs(p.x - shaft.centre.x), Math.abs(p.z - shaft.centre.z)) > SHAFT_HALF + 1e-9);
        const car = points[firstOutside > 0 ? firstOutside - 1 : 0]!, far = firstOutside > 0 ? points[firstOutside]! : points.at(-1)!;
        const dir = far.clone().sub(shaft.centre); dir.y = 0;
        if (dir.lengthSq() < 1e-8) continue;
        const run = far.clone().sub(car);
        let face = shaftFace(dir), firstCrossing = Infinity;
        if (firstOutside > 0) SHAFT_NORMALS.forEach((normal, index) => {
          const into = run.dot(normal);
          if (into <= 1e-9) return;
          const at = (SHAFT_HALF - car.clone().sub(shaft.centre).dot(normal)) / into;
          if (at >= -1e-9 && at <= 1 + 1e-9 && at < firstCrossing) { face = index; firstCrossing = at; }
        });
        const n = SHAFT_NORMALS[face]!, t = new THREE.Vector3(-n.z, 0, n.x);
        const into = run.dot(n), s = Math.abs(into) > 1e-9 ? (SHAFT_HALF - car.clone().sub(shaft.centre).dot(n)) / into : 0;
        const crossing = car.clone().addScaledVector(run, THREE.MathUtils.clamp(s, 0, 1));
        if (Math.abs(crossing.y - stopY) > 0.5) continue;
        const cross = crossing.sub(shaft.centre).dot(t);
        return { face, offset: THREE.MathUtils.clamp(cross, -(SHAFT_HALF - DOOR_HALF), SHAFT_HALF - DOOR_HALF) };
      }
      return { face: 0, offset: 0 };
    };
    const stops = shaft.stops.map((stop) => ({ ...stop, ...doorOf(stop.nodeIds, stop.y) }));
    const parts = buildElevator(shaft.centre, stops, tier);
    // A shaft is solid over its full height, except for each stop's door band on that face.
    const yMin = stops[0]!.y - 0.12, yMax = stops.at(-1)!.y + 2.6;
    SHAFT_NORMALS.forEach((normal, face) => {
      const holes = stops.filter((stop) => stop.face === face).map((stop) => ({ u0: -stop.offset - DOOR_HALF, u1: -stop.offset + DOOR_HALF, v0: stop.y - 0.12, v1: stop.y + 2.6 }));
      const origin = shaft.centre.clone().addScaledVector(normal, SHAFT_HALF), tangent = new THREE.Vector3(normal.z, 0, -normal.x);
      for (const [u0, u1, v0, v1] of freePanels(-SHAFT_HALF, SHAFT_HALF, yMin, yMax, holes)) {
        const a = origin.clone().addScaledVector(tangent, u0), b = origin.clone().addScaledVector(tangent, u1), length = u1 - u0;
        if (length < 0.02) continue;
        wallSegments.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, yMin: v0, yMax: v1 });
        const transform = new THREE.Matrix4().makeRotationY(Math.atan2(-(b.z - a.z), b.x - a.x)).setPosition((a.x + b.x) / 2, (v0 + v1) / 2, (a.z + b.z) / 2);
        box(parts, "steel", transform, 0, 0, 0, length, v1 - v0, 0.04, "collider"); parts.at(-1)!.walkableOnly = true;
      }
    });
    for (const stop of stops) { box(parts, "tread", new THREE.Matrix4(), shaft.centre.x, stop.y - 0.04, shaft.centre.z, 2 * SHAFT_HALF, 0.08, 2 * SHAFT_HALF, "walkable"); parts.at(-1)!.walkableOnly = true; }
    for (const edge of shaft.edges) {
      const [from, to] = liftEnds(edge), path = [from.at.clone(), new THREE.Vector3(shaft.centre.x, from.at.y, shaft.centre.z), new THREE.Vector3(shaft.centre.x, to.at.y, shaft.centre.z), to.at.clone()];
      const ride = path.filter((p, i) => i === 0 || p.distanceTo(path[i - 1]!) > 1e-6);
      pathByEdge.set(edge.id, ride);
      for (let i = 1; i < ride.length; i++) segments.push({ line: new THREE.Line3(ride[i - 1]!.clone(), ride[i]!.clone()), halfWidth: DOOR_HALF });
      counts.elevator++;
    }
    const edgeIds = shaft.edges.map((edge) => edge.id).sort();
    for (const part of parts) { part.edgeId = shaft.id; part.edgeIds = edgeIds; }
    const key = tier === "low" ? "all" : nodes.get(shaft.edges[0]!.from)?.floorId ?? "";
    const batch = batches.get(key) ?? []; batch.push(...parts.filter((p) => !p.walkableOnly)); batches.set(key, batch);
    const support = parts.filter((p) => p.role === "walkable"), shaftWalls = parts.filter((p) => p.role === "collider");
    if (support.length) walkable.push(meshFor(support, physicalMaterial));
    if (shaftWalls.length) colliders.push(meshFor(shaftWalls, physicalMaterial));
  }
  let triangles = 0;
  const lightBatches: { mesh: THREE.Mesh; parts: ConnectorPart[] }[] = [];
  for (const batch of batches.values()) {
    for (const [parts, material] of [[batch.filter((p) => !(["light", "lampOk", "lampNo", "glass"] as string[]).includes(p.material)), shellMaterial], [batch.filter((p) => ["light", "lampOk", "lampNo"].includes(p.material)), lampMaterials], [batch.filter((p) => p.material === "glass"), glassMaterial]] as const) {
      if (!parts.length) continue;
      const mesh = meshFor(parts, material); root.add(mesh); triangles += mesh.geometry.getAttribute("position").count / 3;
      if (material === lampMaterials) lightBatches.push({ mesh, parts });
    }
  }
  const stats = { connectors: counts, meshes: root.children.length, triangles, approximateFits, omittedLandings, connectorsSkipped, connectorsSkippedByReason, legacyConnectors: legacyEdgeIds.size, overBudget: null as string | null,
    dropSoffits() {
      for (const batch of lightBatches) {
        const kept = batch.parts.filter((p) => !p.soffit);
        if (kept.length === batch.parts.length) continue;
        stats.triangles -= batch.parts.filter((p) => p.soffit).reduce((n, p) => n + p.position.length / 9, 0);
        const replacement = meshFor(kept, lampMaterials);
        batch.mesh.geometry.dispose(); batch.mesh.geometry = replacement.geometry; batch.mesh.userData.edgeId = replacement.userData.edgeId; batch.mesh.userData.edgeRanges = replacement.userData.edgeRanges; batch.parts = kept;
        if (!kept.length) { root.remove(batch.mesh); stats.meshes--; }
      }
      if (legacy) { const before = legacy.stats.triangles; legacy.stats.dropSoffits(); stats.triangles -= before - legacy.stats.triangles; }
    } };
  // Unsupported shapes: exactly what main builds today, railing clipping included (#668).
  const legacy = legacyEdgeIds.size ? buildLegacyConnectors(bundle, (edge) => legacyEdgeIds.has(edge.id) && traversable(edge), scope, tier) : null;
  if (legacy) {
    for (const child of [...legacy.root.children]) root.add(child);
    walkable.push(...legacy.walkable); colliders.push(...legacy.colliders); wallSegments.push(...legacy.wallSegments); segments.push(...legacy.segments);
    for (const [edgeId, path] of legacy.pathByEdge) pathByEdge.set(edgeId, path);
    counts.stairs += legacy.stats.connectors.stairs; counts.escalator += legacy.stats.connectors.escalator;
    stats.meshes = root.children.length; stats.triangles += legacy.stats.triangles;
  }
  return { root, walkable, colliders, wallSegments, segments, pathByEdge, stats, skippedEdgeIds };
}

/** Apply the shared triangle cap, retaining essential connector and passage geometry. */
export function withinGreyboxBudget(aStats: { triangles: number }, bStats: { triangles: number; overBudget: string | null; dropSoffits: () => void }, tier: "high" | "low"): boolean {
  const limit = tier === "high" ? 150000 : 100000;
  if (aStats.triangles + bStats.triangles > limit) bStats.dropSoffits();
  const over = aStats.triangles + bStats.triangles > limit;
  bStats.overBudget = over ? `Combined greybox exceeds ${limit} triangles after dropping connector soffits` : null;
  return !over;
}
