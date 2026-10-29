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

/** Remove the part of a landing side inside a flight's approach corridor. */
function clipLandingSide(a: THREE.Vector3, b: THREE.Vector3, origin: THREE.Vector3, direction: THREE.Vector3, clearance: number): [THREE.Vector3, THREE.Vector3][] {
  const distance = (t: number) => {
    const p = a.clone().lerp(b, t).sub(origin), along = Math.max(0, p.dot(direction));
    return p.addScaledVector(direction, -along).length();
  };
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) { const x = (2 * lo + hi) / 3, y = (lo + 2 * hi) / 3; if (distance(x) < distance(y)) hi = y; else lo = x; }
  const middle = (lo + hi) / 2;
  if (distance(middle) >= clearance - 1e-9) return [[a, b]];
  let left = 0, right = middle;
  if (distance(0) >= clearance) for (let i = 0; i < 50; i++) { const m = (left + right) / 2; if (distance(m) >= clearance) left = m; else right = m; }
  else left = 0;
  let start = middle, end = 1;
  if (distance(1) >= clearance) for (let i = 0; i < 50; i++) { const m = (start + end) / 2; if (distance(m) < clearance) start = m; else end = m; }
  else end = 1;
  const segments: [THREE.Vector3, THREE.Vector3][] = [];
  if (left > 1e-8) segments.push([a.clone(), a.clone().lerp(b, left)]);
  if (end < 1 - 1e-8) segments.push([a.clone().lerp(b, end), b.clone()]);
  return segments;
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
      if (horizontal > 1e-6) {
        const half = (edge.mode === "stairs" ? width : 1.2) / 2 + 0.03;
        const isTurn = (index: number) => {
          if (edge.mode !== "stairs" || index <= 0 || index >= points.length - 1) return false;
          const a = points[index]!.clone().sub(points[index - 1]!), b = points[index + 1]!.clone().sub(points[index]!); a.y = 0; b.y = 0;
          return a.lengthSq() > 1e-12 && b.lengthSq() > 1e-12 && a.angleTo(b) > 1e-6;
        };
        let begin = 0;
        if (isTurn(i - 1)) {
          const prior = points[i - 1]!.clone().sub(points[i - 2]!); prior.y = 0; prior.normalize();
          const next = new THREE.Vector3(dx / horizontal, 0, dz / horizontal), normal = new THREE.Vector3(-prior.z, 0, prior.x);
          begin = Math.min((width / 2) / Math.max(Math.abs(next.dot(prior)), Math.abs(next.dot(normal))), horizontal / 2);
        }
        const end = horizontal - (isTurn(i) ? Math.min(width / 2, horizontal / 2) : 0);
        const n = Math.max(1, Math.ceil((end - begin) / 0.5));
        for (const side of [-1, 1]) for (let k = 0; k < n && end > begin; k++) {
          const t = (begin + (end - begin) * k / n) / horizontal, u = (begin + (end - begin) * (k + 1) / n) / horizontal;
          const ox = -dz / horizontal * half * side, oz = dx / horizontal * half * side;
          const ya = THREE.MathUtils.lerp(from.y, to.y, t), yb = THREE.MathUtils.lerp(from.y, to.y, u);
          const a = new THREE.Vector3(THREE.MathUtils.lerp(from.x, to.x, t) + ox, 0, THREE.MathUtils.lerp(from.z, to.z, t) + oz);
          const b = new THREE.Vector3(THREE.MathUtils.lerp(from.x, to.x, u) + ox, 0, THREE.MathUtils.lerp(from.z, to.z, u) + oz);
          let pieces: [THREE.Vector3, THREE.Vector3][] = [[a, b]];
          for (const index of [i - 1, i]) if (isTurn(index)) {
            const corner = points[index]!, other = index === i ? points[index + 1]!.clone().sub(corner) : points[index - 1]!.clone().sub(corner);
            other.y = 0; other.normalize();
            const origin = new THREE.Vector3(corner.x, 0, corner.z);
            pieces = pieces.flatMap(([start, end]) => clipLandingSide(start, end, origin, other, width / 2 + 0.1));
          }
          for (const [start, finish] of pieces) {
            const wall = { ax: start.x, az: start.z, bx: finish.x, bz: finish.z, yMin: Math.min(ya, yb) - 0.12, yMax: Math.max(ya, yb) + 0.96 };
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
        if (edge.mode === "stairs") {
          const d = incoming.normalize(), n = new THREE.Vector3(-d.z, 0, d.x), out = outgoing.normalize(), half = width / 2 + 0.03;
          const corners = [at.clone().addScaledVector(d, -half).addScaledVector(n, -half), at.clone().addScaledVector(d, half).addScaledVector(n, -half), at.clone().addScaledVector(d, half).addScaledVector(n, half), at.clone().addScaledVector(d, -half).addScaledVector(n, half)];
          const sides = [[corners[3]!, corners[0]!], [corners[1]!, corners[2]!], [corners[0]!, corners[1]!], [corners[2]!, corners[3]!]] as const;
          const entry = at;
          const exit = at;
          const clearance = width / 2 + 0.1;
          for (const [a, b] of sides) {
            const afterEntry = clipLandingSide(a, b, entry, d.clone().negate(), clearance);
            const pieces = afterEntry.flatMap(([start, end]) => clipLandingSide(start, end, exit, out, clearance));
            for (const [start, end] of pieces) {
              const length = start.distanceTo(end); if (length < 1e-6) continue;
              const wall = { ax: start.x, az: start.z, bx: end.x, bz: end.z, yMin: at.y - 0.12, yMax: at.y + 0.96 }; wallSegments.push(wall);
              const transform = new THREE.Matrix4().makeRotationY(Math.atan2(-(end.z - start.z), end.x - start.x)).setPosition((start.x + end.x) / 2, at.y, (start.z + end.z) / 2);
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
