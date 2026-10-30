import type { Edge, StationBundle } from "@gteki/schema";
import * as THREE from "three";
import { edgePoints, type V3 } from "./geometry.ts";
import type { Segment2 } from "./walker.ts";

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

/** Where the line `centre + t * dir + lateral` enters (`entry`) or leaves (`exit`) a square of half-size `half` aligned with `axis`. */
function squareCrossing(centre: THREE.Vector3, axis: THREE.Vector3, dir: THREE.Vector3, lateral: THREE.Vector3, half: number, pick: "entry" | "exit"): THREE.Vector3 | null {
  const a = centre.clone().addScaledVector(dir, -10).add(lateral), b = centre.clone().addScaledVector(dir, 10).add(lateral);
  const clipped = clipToSquare(a, b, centre, axis, half);
  if (!clipped) return null;
  return pick === "entry" ? clipped[0] : clipped[1];
}

/** Parameter spans of segment a-b inside a flight's footprint: ahead of the landing centre along `u` and within `half` of its centreline. */
function footprintOn(a: THREE.Vector3, b: THREE.Vector3, centre: THREE.Vector3, u: THREE.Vector3, half: number, reach = Infinity): [number, number][] {
  const v = new THREE.Vector3(-u.z, 0, u.x), p = a.clone().sub(centre), q = b.clone().sub(a);
  const constraints: [number, number][] = [[p.dot(u), q.dot(u)], [half + p.dot(v), q.dot(v)], [half - p.dot(v), -q.dot(v)]];
  if (Number.isFinite(reach)) constraints.push([reach - p.dot(u), -q.dot(u)]); // the opening ends where the flight's leg ends
  let lo = 0, hi = 1;
  for (const [c0, c1] of constraints) { // require c0 + c1 * t > 0
    if (Math.abs(c1) < 1e-12) { if (c0 <= 1e-9) return []; continue; }
    if (c1 > 0) lo = Math.max(lo, -c0 / c1); else hi = Math.min(hi, -c0 / c1);
  }
  return hi - lo > 1e-6 ? [[lo, hi]] : [];
}

/** The spans of [0, 1] that `cover` leaves uncovered. */
function gapsOutside(cover: [number, number][]): [number, number][] {
  const gaps: [number, number][] = [];
  let at = 0;
  for (const [lo, hi] of [...cover].sort((x, y) => x[0] - y[0])) {
    if (lo > at + 1e-9) gaps.push([at, lo]);
    at = Math.max(at, hi);
  }
  if (at < 1 - 1e-9) gaps.push([at, 1]);
  return gaps;
}

/** Clip a segment to the square of half-size `half` centred on `centre`, with axes `u` and `v`. */
function clipToSquare(a: THREE.Vector3, b: THREE.Vector3, centre: THREE.Vector3, u: THREE.Vector3, half: number): [THREE.Vector3, THREE.Vector3] | null {
  const v = new THREE.Vector3(-u.z, 0, u.x), limit = half + 1e-6;
  let t0 = 0, t1 = 1;
  for (const axis of [u, v]) {
    const p0 = a.clone().sub(centre).dot(axis), dp = b.clone().sub(a).dot(axis);
    if (Math.abs(dp) < 1e-12) { if (Math.abs(p0) > limit) return null; continue; }
    let ta = (-limit - p0) / dp, tb = (limit - p0) / dp;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return [a.clone().lerp(b, t0), a.clone().lerp(b, t1)];
}

/** Plan deflection between a stair's two legs at interior vertex `index`, in radians (0 at an end or on a straight run). */
function bendAngle(points: readonly THREE.Vector3[], index: number): number {
  if (index <= 0 || index >= points.length - 1) return 0;
  const a = points[index]!.clone().sub(points[index - 1]!); a.y = 0;
  const b = points[index + 1]!.clone().sub(points[index]!); b.y = 0;
  return a.lengthSq() > 1e-12 && b.lengthSq() > 1e-12 ? a.angleTo(b) : 0;
}

/** Plan bends shallower than this are walked as one continuous flight: mitred side walls, no landing square or guard. */
const SHALLOW_BEND = (20 * Math.PI) / 180;

/** Plan point where `vertex + latA + s * dirA` meets `vertex + latB + t * dirB`, for two offset wall lines. */
function mitre(vertex: THREE.Vector3, dirA: THREE.Vector3, latA: THREE.Vector3, dirB: THREE.Vector3, latB: THREE.Vector3): THREE.Vector3 {
  const r = latB.clone().sub(latA);
  // Solve s * dirA - t * dirB = r for s in plan.
  const det = -dirA.x * dirB.z + dirB.x * dirA.z;
  const s = Math.abs(det) < 1e-9 ? 0 : (-r.x * dirB.z + dirB.x * r.z) / det;
  return vertex.clone().add(latA).addScaledVector(dirA, s);
}

/** A turning landing's outline square in plan: centre, unit axis along its incoming flight, and height. */
interface LandingSquare { index: number; centre: THREE.Vector3; axis: THREE.Vector3; height: number; flights: { dir: THREE.Vector3; reach: number }[] }

/** The turning landings (plan bends of at least SHALLOW_BEND) of one stair, as outline squares. */
function turningSquares(points: readonly THREE.Vector3[]): LandingSquare[] {
  const squares: LandingSquare[] = [];
  for (let j = 1; j + 1 < points.length; j++) {
    if (bendAngle(points, j) < SHALLOW_BEND) continue;
    const incoming = points[j]!.clone().sub(points[j - 1]!); incoming.y = 0;
    const outgoing = points[j + 1]!.clone().sub(points[j]!); outgoing.y = 0;
    const centre = points[j]!.clone(); centre.y = 0;
    const inLength = incoming.length(), outLength = outgoing.length();
    const axis = incoming.normalize();
    // Each flight reaches only as far as its own leg: beyond that its strip is not a flight.
    squares.push({ index: j, centre, axis, height: points[j]!.y, flights: [{ dir: axis.clone().negate(), reach: inLength }, { dir: outgoing.normalize(), reach: outLength }] });
  }
  return squares;
}

const acrossAxis = (axis: THREE.Vector3) => new THREE.Vector3(-axis.z, 0, axis.x);

/** Whether two landing squares overlap in plan (gaps under `tolerance` count as overlap) while sitting under `heightGap` apart vertically. */
function squaresOverlap(a: LandingSquare, b: LandingSquare, half: number, tolerance = 0.02, heightGap = 2.1): boolean {
  if (Math.abs(a.height - b.height) >= heightGap) return false;
  const delta = b.centre.clone().sub(a.centre);
  const reach = (square: LandingSquare, axis: THREE.Vector3) => half * (Math.abs(axis.dot(square.axis)) + Math.abs(axis.dot(acrossAxis(square.axis))));
  const axes = [a.axis, acrossAxis(a.axis), b.axis, acrossAxis(b.axis)];
  return !axes.some((axis) => Math.abs(delta.dot(axis)) > reach(a, axis) + reach(b, axis) + tolerance);
}

/** Whether plan point p lies in the closed landing square. */
function insideSquare(p: THREE.Vector3, square: LandingSquare, half: number): boolean {
  const rel = p.clone().sub(square.centre); rel.y = 0;
  return Math.abs(rel.dot(square.axis)) <= half + 1e-6 && Math.abs(rel.dot(acrossAxis(square.axis))) <= half + 1e-6;
}

/** Whether plan point p lies on a side of the closed landing square (within 1e-6). */
function onSquareBoundary(p: THREE.Vector3, square: LandingSquare, half: number): boolean {
  const rel = p.clone().sub(square.centre); rel.y = 0;
  return Math.abs(Math.abs(rel.dot(square.axis)) - half) < 1e-6 || Math.abs(Math.abs(rel.dot(acrossAxis(square.axis))) - half) < 1e-6;
}

/**
 * Spans of side a-b of square `mine` that its guard must not build. A part strictly inside another overlapping square is
 * open. A part on another square's side is kept only where the union's outside lies (a point 0.05 m outward is inside no
 * square of the group), and a part shared by two squares is kept once, from the lower-index square.
 */
function sideCover(a: THREE.Vector3, b: THREE.Vector3, mine: LandingSquare, others: readonly LandingSquare[], half: number): [number, number][] {
  const along = b.clone().sub(a); along.y = 0;
  const length2 = along.lengthSq();
  if (length2 < 1e-12) return [];
  const across = acrossAxis(along.clone().normalize());
  const parameter = (p: THREE.Vector3) => THREE.MathUtils.clamp(p.clone().sub(a).dot(along) / length2, 0, 1);
  const outward = (centre: THREE.Vector3, p: THREE.Vector3) => { const rel = p.clone().sub(centre); rel.y = 0; return rel.dot(across) >= 0 ? across.clone() : across.clone().negate(); };
  const group = [mine, ...others];
  const cover: [number, number][] = [];
  for (const q of others) {
    const clipped = clipToSquare(a, b, q.centre, q.axis, half);
    if (!clipped) continue;
    const t0 = parameter(clipped[0]), t1 = parameter(clipped[1]);
    if (t1 - t0 <= 1e-6) continue;
    const mid = clipped[0].clone().lerp(clipped[1], 0.5);
    if (!onSquareBoundary(mid, q, half)) { cover.push([t0, t1]); continue; }
    // Collinear with a side of q: keep it only on the union's outline, and only once when q and mine both face outward.
    const mineOut = outward(mine.centre, mid), qOut = outward(q.centre, mid);
    const probe = mid.clone().addScaledVector(mineOut, 0.05);
    const onOutline = !group.some((square) => insideSquare(probe, square, half));
    const sharedFromLower = q.index < mine.index && mineOut.dot(qOut) > 0;
    if (!onOutline || sharedFromLower) cover.push([t0, t1]);
  }
  return cover;
}

/**
 * Whether two flights that do not share a landing overlap in plan with under 2.1 m between them vertically
 * (a stacked layout a walker cannot pass under). Flights that meet at one landing are guarded by that landing instead.
 */
function flightsStacked(points: readonly THREE.Vector3[], half: number, squares: readonly LandingSquare[], heightGap = 2.1): boolean {
  const legs: { a: THREE.Vector3; b: THREE.Vector3; length: number; dir: THREE.Vector3 }[] = [];
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1]!, b = points[k]!;
    const run = b.clone().sub(a); run.y = 0;
    const length = run.length();
    legs.push({ a, b, length, dir: length > 1e-9 ? run.normalize() : run });
  }
  const margin = half - 0.02;
  for (let k = 0; k < legs.length; k++) {
    const leg = legs[k]!;
    if (leg.length < 1e-6) continue;
    const normal = acrossAxis(leg.dir);
    for (let s = 0; s <= leg.length; s += 0.1) {
      const hk = leg.a.y + (leg.b.y - leg.a.y) * (s / leg.length);
      for (let lateral = -margin; lateral <= margin; lateral += 0.05) {
        const p = leg.a.clone().addScaledVector(leg.dir, s).addScaledVector(normal, lateral);
        if (squares.some((square) => insideSquare(p, square, half))) continue;
        for (let m = 0; m < legs.length; m++) {
          if (Math.abs(m - k) < 2) continue;
          const other = legs[m]!;
          if (other.length < 1e-6) continue;
          const rel = p.clone().sub(other.a); rel.y = 0;
          const along = rel.dot(other.dir), across = rel.dot(acrossAxis(other.dir));
          if (along < 0.05 || along > other.length - 0.05 || Math.abs(across) >= margin) continue;
          const hm = other.a.y + (other.b.y - other.a.y) * (along / other.length);
          if (Math.abs(hk - hm) < heightGap) return true;
        }
      }
    }
  }
  return false;
}

/** Build runtime-only batches for missing vertical transport. */
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
  const shellMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, side: THREE.DoubleSide });
  const lightMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: "#fff6e8", emissiveIntensity: 3.2, side: THREE.DoubleSide });
  const lampMaterials = [lightMaterial, new THREE.MeshStandardMaterial({ color: "#00ff00", emissive: "#00ff00", emissiveIntensity: 3.2 }), new THREE.MeshStandardMaterial({ color: "#ff0000", emissive: "#ff0000", emissiveIntensity: 3.2 })];
  const glassMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false, roughness: 0.32, metalness: 0.08, side: THREE.DoubleSide });
  const physicalMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  for (const edge of unmodelledVerticalEdges(bundle, traversable, scope.hasFloor, scope.nearMesh)) {
    const points = edgePoints(bundle, edge, nodes, floors);
    const planRuns = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.z - points[i]!.z));
    if (planRuns.reduce((a, b) => a + b, 0) < 0.3 || planRuns.some((run, i) => run < 0.3 && Math.abs(points[i + 1]!.y - points[i]!.y) > 1e-6)) { connectorsSkipped++; continue; }
    const rawWidth = (edge.attributes as unknown as { width?: { m?: number } } | undefined)?.width?.m;
    const width = rawWidth && rawWidth > 0 ? rawWidth : 1.5;
    const halfWidth = (edge.mode === "stairs" ? width : 1.2) / 2;
    const landingSquares = turningSquares(points);
    if (edge.mode === "stairs" && flightsStacked(points, width / 2 + 0.03, landingSquares)) { connectorsSkipped++; continue; }
    // Two turning landings whose squares overlap would let one guard cut the other's flight, so such a stair gets no connector.
    let bentEscalator = false;
    for (let i = 1; i + 1 < points.length; i++) {
      const before = points[i]!.clone().sub(points[i - 1]!); before.y = 0;
      const after = points[i + 1]!.clone().sub(points[i]!); after.y = 0;
      if (before.lengthSq() && after.lengthSq() && before.angleTo(after) > Math.PI / 18) bentEscalator = true;
    }
    const parts: ConnectorPart[] = [];
    const edgePath: THREE.Vector3[] = [];
    let edgeOmitted = 0;
    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1]!, to = points[i]!;
      const dx = to.x - from.x, dz = to.z - from.z, horizontal = Math.hypot(dx, dz);
      const half = (edge.mode === "stairs" ? width : 1.2) / 2 + 0.03;
      const bendAt = (index: number) => (edge.mode === "stairs" ? bendAngle(points, index) : 0);
      const isTurn = (index: number) => bendAt(index) >= SHALLOW_BEND;
      const isShallow = (index: number) => bendAt(index) > 1e-6 && bendAt(index) < SHALLOW_BEND;
      if (horizontal > 1e-6) {
        const leg = new THREE.Vector3(dx / horizontal, 0, dz / horizontal), normal = new THREE.Vector3(-leg.z, 0, leg.x);
        for (const side of [-1, 1]) {
          const lateral = normal.clone().multiplyScalar(half * side);
          // A side wall runs from its far end to the outline of a turning landing it meets, mitres at a shallow bend, and otherwise spans the whole leg.
          let begin = 0, end = horizontal;
          if (isTurn(i - 1)) {
            const axis = points[i - 1]!.clone().sub(points[i - 2]!); axis.y = 0; axis.normalize();
            const exit = squareCrossing(from, axis, leg, lateral, half, "exit");
            begin = exit ? exit.clone().sub(from).dot(leg) : 0;
          } else if (isShallow(i - 1)) {
            const prev = points[i - 1]!.clone().sub(points[i - 2]!); prev.y = 0; prev.normalize();
            const prevLateral = new THREE.Vector3(-prev.z, 0, prev.x).multiplyScalar(half * side);
            begin = mitre(from, prev, prevLateral, leg, lateral).clone().sub(from).dot(leg);
          }
          if (isTurn(i)) {
            const entry = squareCrossing(to, leg, leg, lateral, half, "entry");
            end = entry ? entry.clone().sub(from).dot(leg) : horizontal;
          } else if (isShallow(i)) {
            const next = points[i + 1]!.clone().sub(to); next.y = 0; next.normalize();
            const nextLateral = new THREE.Vector3(-next.z, 0, next.x).multiplyScalar(half * side);
            end = mitre(to, leg, lateral, next, nextLateral).clone().sub(from).dot(leg);
          }
          const n = Math.max(1, Math.ceil((end - begin) / 0.5));
          for (let k = 0; k < n && end > begin; k++) {
            const s0 = begin + (end - begin) * k / n, s1 = begin + (end - begin) * (k + 1) / n;
            const a = from.clone().addScaledVector(leg, s0).add(lateral), b = from.clone().addScaledVector(leg, s1).add(lateral);
            a.y = 0; b.y = 0;
            const ya = THREE.MathUtils.lerp(from.y, to.y, THREE.MathUtils.clamp(s0 / horizontal, 0, 1)), yb = THREE.MathUtils.lerp(from.y, to.y, THREE.MathUtils.clamp(s1 / horizontal, 0, 1));
            const wall = { ax: a.x, az: a.z, bx: b.x, bz: b.z, yMin: Math.min(ya, yb) - 0.12, yMax: Math.max(ya, yb) + 0.96 };
            wallSegments.push(wall);
            if (edge.mode === "stairs") {
              const transform = new THREE.Matrix4().makeRotationY(Math.atan2(-(wall.bz - wall.az), wall.bx - wall.ax)).setPosition((wall.ax + wall.bx) / 2, (wall.yMin + wall.yMax) / 2, (wall.az + wall.bz) / 2);
              box(parts, "steel", transform, 0, 0, 0, Math.hypot(wall.bx - wall.ax, wall.bz - wall.az), wall.yMax - wall.yMin, 0.04, "collider"); parts.at(-1)!.walkableOnly = true;
            }
          }
        }
      }
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
        const at = to.clone();
        const rotation = new THREE.Matrix4().makeRotationY(Math.atan2(-(to.z - from.z), to.x - from.x)).setPosition(at);
        box(parts, edge.mode === "stairs" ? "tread" : "escStep", rotation, 0, -0.04, 0, edge.mode === "stairs" ? width : 1.2, 0.08, edge.mode === "stairs" ? width : 1.2, "walkable");
        if (edge.mode === "stairs" && isTurn(i)) {
          // The square's outline is guarded except where each attached flight's footprint meets it; each guard piece ends where that flight's side wall ends.
          const d = incoming.clone().normalize(), out = outgoing.clone().normalize(), n = new THREE.Vector3(-d.z, 0, d.x);
          const corners = [at.clone().addScaledVector(d, -half).addScaledVector(n, -half), at.clone().addScaledVector(d, half).addScaledVector(n, -half), at.clone().addScaledVector(d, half).addScaledVector(n, half), at.clone().addScaledVector(d, -half).addScaledVector(n, half)];
          const sides = [[corners[3]!, corners[0]!], [corners[1]!, corners[2]!], [corners[0]!, corners[1]!], [corners[2]!, corners[3]!]] as const;
          // Turning landings whose squares overlap this one: their interiors are open, so this outline stops at their edges.
          const mine = landingSquares.find((square) => square.index === i)!;
          const others = landingSquares.filter((square) => square !== mine && squaresOverlap(mine, square, half));
          for (const [a, b] of sides) {
            const cover = [d.clone().negate(), out].flatMap((u) => footprintOn(a, b, at, u, half))
              .concat(others.flatMap((square) => square.flights.flatMap((f) => footprintOn(a, b, square.centre, f.dir, half, f.reach))), sideCover(a, b, mine, others, half));
            for (const [t0, t1] of gapsOutside(cover)) {
              const start = a.clone().lerp(b, t0), finish = a.clone().lerp(b, t1);
              const length = start.distanceTo(finish); if (length < 1e-6) continue;
              const wall = { ax: start.x, az: start.z, bx: finish.x, bz: finish.z, yMin: at.y - 0.12, yMax: at.y + 0.96 }; wallSegments.push(wall);
              const transform = new THREE.Matrix4().makeRotationY(Math.atan2(-(finish.z - start.z), finish.x - start.x)).setPosition((start.x + finish.x) / 2, at.y, (start.z + finish.z) / 2);
              box(parts, "steel", transform, 0, 0.96, 0, length, 0.052, 0.052);
              box(parts, "steel", transform, 0, 0.42, 0, length, 1.08, 0.04, "collider"); parts.at(-1)!.walkableOnly = true;
            }
          }
        }
      }
    }
    const lowerFirst = points[0]!.y <= points.at(-1)!.y ? edgePath : edgePath.reverse();
    pathByEdge.set(edge.id, lowerFirst.map((p) => ({ x: p.x, y: p.y, z: p.z })));
    for (let i = 1; i < lowerFirst.length; i++) segments.push({ line: new THREE.Line3(lowerFirst[i - 1]!.clone(), lowerFirst[i]!.clone()), halfWidth });
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
    for (const part of parts) part.edgeId = edge.id;
    if (edge.mode === "stairs" || edge.mode === "escalator") counts[edge.mode]++;
    if (parts.some((p) => p.userData?.fit === "approximate")) approximateFits++;
    omittedLandings += edgeOmitted;
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
  const stats = { connectors: counts, meshes: root.children.length, triangles, approximateFits, omittedLandings, connectorsSkipped, overBudget: null as string | null,
    dropSoffits() {
      for (const batch of lightBatches) {
        const kept = batch.parts.filter((p) => !p.soffit);
        if (kept.length === batch.parts.length) continue;
        stats.triangles -= batch.parts.filter((p) => p.soffit).reduce((n, p) => n + p.position.length / 9, 0);
        const replacement = meshFor(kept, lampMaterials);
        batch.mesh.geometry.dispose(); batch.mesh.geometry = replacement.geometry; batch.mesh.userData.edgeId = replacement.userData.edgeId; batch.mesh.userData.edgeRanges = replacement.userData.edgeRanges; batch.parts = kept;
        if (!kept.length) { root.remove(batch.mesh); stats.meshes--; }
      }
    } };
  return { root, walkable, colliders, wallSegments, segments, pathByEdge, stats };
}

/** Apply the shared triangle cap, retaining essential connector and passage geometry. */
export function withinGreyboxBudget(aStats: { triangles: number }, bStats: { triangles: number; overBudget: string | null; dropSoffits: () => void }, tier: "high" | "low"): boolean {
  const limit = tier === "high" ? 150000 : 100000;
  if (aStats.triangles + bStats.triangles > limit) bStats.dropSoffits();
  const over = aStats.triangles + bStats.triangles > limit;
  bStats.overBudget = over ? `Combined greybox exceeds ${limit} triangles after dropping connector soffits` : null;
  return !over;
}
