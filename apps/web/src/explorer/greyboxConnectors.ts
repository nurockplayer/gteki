import type { Edge, StationBundle } from "@gteki/schema";
import * as THREE from "three";
import { edgePoints, type V3 } from "./geometry.ts";
import type { Segment2 } from "./walker.ts";
import { buildConnectors as buildLegacyConnectors } from "./greyboxConnectorsLegacy.ts";
import { WALKER_BODY } from "@gteki/scene-api";
import polygonClipping, { type MultiPolygon } from "polygon-clipping";
import { buildWalkableModel, regionPolygon, type BoundaryWall, type PlanPoint, type Region } from "./walkableModel.ts";

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

export type ConnectorMaterial = "tread" | "riser" | "nosing" | "escStep" | "escTruss" | "steel" | "rubber" | "glass" | "light" | "lampOk" | "lampNo";
export interface ConnectorPart { material: ConnectorMaterial; position: number[]; normal: number[]; colour: number[]; edgeId?: string; role?: "walkable" | "collider"; walkableOnly?: boolean; soffit?: boolean; userData?: { fit: "exact" | "approximate"; omittedLandings?: number } }
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
  const omitted = f.length < count * 0.25 + needed * landing ? needed : 0;
  const placed = needed - omitted;
  const tread = (f.length - placed * landing) / count;
  const fit = rise < 0.15 || rise > 0.21 || tread < 0.25 || tread > 0.35 || f.length < f.rise / Math.tan(35 * Math.PI / 180) ? "approximate" : "exact";
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
  const landing = Math.min(0.8, f.length / 4), run = Math.max(0, f.length - 2 * landing);
  const angle = Math.atan2(f.rise, run), incline = Math.hypot(run, f.rise);
  const fit = landing < 0.8 || angle < 27 * Math.PI / 180 || angle > 33 * Math.PI / 180 ? "approximate" : "exact";
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
  const omitted = f.length < count * 0.25 + needed * 1.2, tread = (f.length - (omitted ? 0 : needed * 1.2)) / count;
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
  const f = frame(from, to), landing = Math.min(0.8, f.length / 4);
  const at = (x: number, y: number) => new THREE.Vector3(x, y, 0).applyMatrix4(f.matrix);
  const path = [at(0, 0), at(landing, 0), at(f.length - landing, f.rise), at(f.length, f.rise)];
  return from.y <= to.y ? path : path.reverse();
}

export interface ConnectorScope { hasFloor: (p: V3) => boolean; nearMesh: (p: THREE.Vector3, radius: number) => boolean }

function meshFor(parts: readonly ConnectorPart[], material: THREE.Material | THREE.Material[]): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(parts.flatMap((p) => p.position), 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(parts.flatMap((p) => p.normal), 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(parts.flatMap((p) => p.colour), 3));
  if (Array.isArray(material)) {
    let offset = 0;
    for (const p of parts) { const count = p.position.length / 3; geometry.addGroup(offset, count, p.material === "lampOk" ? 1 : p.material === "lampNo" ? 2 : 0); offset += count; }
  }
  const mesh = new THREE.Mesh(geometry, material);
  const ids = [...new Set(parts.map((p) => p.edgeId).filter((id): id is string => id !== undefined))];
  let start = 0;
  const edgeRanges = parts.map((p) => { const range = { start, end: start + p.position.length / 3, edgeId: p.edgeId }; start = range.end; return range; });
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

/** Unit plan direction from `a` to `b`. */
function planDir(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
  const d = b.clone().sub(a); d.y = 0;
  return d.lengthSq() > 1e-12 ? d.normalize() : new THREE.Vector3(1, 0, 0);
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
  const counts = { escalator: 0, stairs: 0 };
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
  const mouths = new Map<string, { edgeId: string; at: THREE.Vector3; dir: THREE.Vector3; half: number; leg: number; grade: number }[]>();
  for (const edge of unmodelled) {
    const pts = simplifyPlan(edgePoints(bundle, edge, nodes, floors));
    if (pts.length < 2 || shortRun(pts)) continue;
    for (const [node, at, toward] of [[edge.from, pts[0]!, pts[1]!], [edge.to, pts.at(-1)!, pts.at(-2)!]] as const) {
      const list = mouths.get(node) ?? [];
      list.push({ edgeId: edge.id, at, dir: planDir(at, toward), half: halfOf(edge), leg: Math.hypot(toward.x - at.x, toward.z - at.z), grade: gradeAway(at, toward) });
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
  // as the other takes to clear this one (2 * half / sin of the angle). Clip that opening wherever the first-leg
  // surfaces differ by more than a step, even inside 2 * half.
  const builtRegions = new Map([...regionsByEdge].map(([id, list]) => [id, [...list]]));
  for (const j of junctions) for (const m of mouths.get(j.node) ?? []) {
    // Only the other connector's level that meets this node: a flight of it passing overhead is no opening.
    const meets = junctions.find((k) => k.edgeId === m.edgeId && k.node === j.node);
    const other = meets && builtRegions.get(m.edgeId)?.filter((r) => r.level === meets.level);
    if (m.edgeId === j.edgeId || !other) continue;
    const reach = 2 * Math.max(m.half, j.half), sin = Math.abs(j.dir.x * m.dir.z - j.dir.z * m.dir.x);
    const along = j.dir.x * m.dir.x + j.dir.z * m.dir.z > 0 ? Math.max(reach, reach / Math.max(sin, 0.1)) : reach;
    // Use the legs at the node, including a trimmed level approach. A radial grade cap also closes level entrances
    // across a wide stair; compare their projected heights instead, so width alone never consumes a step.
    const own = mouths.get(j.node)!.find((mouth) => mouth.edgeId === j.edgeId)!;
    const difference = (p: PlanPoint) => own.at.y - m.at.y
      + own.grade * ((p.x - own.at.x) * own.dir.x + (p.z - own.at.z) * own.dir.z)
      - m.grade * ((p.x - m.at.x) * m.dir.x + (p.z - m.at.z) * m.dir.z);
    let opening = discRing(j.at, along);
    for (const side of [-1, 1]) {
      const clipped: PlanPoint[] = [];
      for (let i = 0; i < opening.length; i++) {
        const p = opening[i]!, q = opening[(i + 1) % opening.length]!;
        const dp = WALKER_BODY.stepUpM - side * difference(p), dq = WALKER_BODY.stepUpM - side * difference(q);
        if (dp >= 0) clipped.push(p);
        if ((dp >= 0) !== (dq >= 0)) {
          const t = dp / (dp - dq);
          clipped.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
        }
      }
      opening = clipped;
    }
    if (opening.length < 3) continue;
    const asClipping = (ring: readonly PlanPoint[]) => ring.map((p): [number, number] => [p.x, p.z]);
    try {
      const polygons = other.flatMap((r) => regionPolygon(r)).map((polygon) => insetJunctionRing(polygon[0]!)).filter((ring) => ring.length >= 3).map((ring) => [asClipping(ring)]);
      if (!polygons.length) continue;
      const footprint = polygonClipping.union(polygons[0]!, ...polygons.slice(1));
      const near: MultiPolygon = polygonClipping.intersection([asClipping(opening)], footprint);
      for (const polygon of near) regionsByEdge.get(j.edgeId)!.push({ kind: "connector", level: j.level, y: j.at.y, quad: polygon[0]!.slice(0, -1).map(([x, z]) => ({ x, z })) });
    } catch { legacyEdgeIds.add(j.edgeId); legacyEdgeIds.add(m.edgeId); }
  }
  const edgeById = new Map(bundle.edges.map((edge) => [edge.id, edge]));
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
    try { modelWalls.push(...buildWalkableModel(edgeIds.flatMap((id) => regionsByEdge.get(id)!), undefined, WALKER_BODY.stepUpM, 2 * FOOTPRINT_PAD_M - 0.001).walls); }
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
    if (owner.landing) {
      if (length < 0.02) continue;
      // A landing guard: handrail and a walk-only collider, as a turning landing has always had.
      const y = Math.min(wall.ay, wall.by);
      wallSegments.push({ ax: wall.ax, az: wall.az, bx: wall.bx, bz: wall.bz, yMin: y - 0.12, yMax: y + 0.96 });
      const transform = new THREE.Matrix4().makeRotationY(Math.atan2(-(wall.bz - wall.az), wall.bx - wall.ax)).setPosition((wall.ax + wall.bx) / 2, y, (wall.az + wall.bz) / 2);
      box(parts, "steel", transform, 0, 0.96, 0, length, 0.052, 0.052);
      box(parts, "steel", transform, 0, 0.42, 0, length, 1.08, 0.04, "collider"); parts.at(-1)!.walkableOnly = true;
      continue;
    }
    // A flight's side wall, in pieces of at most 0.5 m so each follows the slope; stairs also get a walk-only collider.
    const n = Math.max(1, Math.ceil(length / 0.5));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const ax = wall.ax + (wall.bx - wall.ax) * t0, az = wall.az + (wall.bz - wall.az) * t0, ya = wall.ay + (wall.by - wall.ay) * t0;
      const bx = wall.ax + (wall.bx - wall.ax) * t1, bz = wall.az + (wall.bz - wall.az) * t1, yb = wall.ay + (wall.by - wall.ay) * t1;
      const segment = { ax, az, bx, bz, yMin: Math.min(ya, yb) - 0.12, yMax: Math.max(ya, yb) + 0.96 };
      wallSegments.push(segment);
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
