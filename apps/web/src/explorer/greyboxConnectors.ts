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
  hasElevator: (a: THREE.Vector3, b: THREE.Vector3) => boolean = () => false,
): Edge[] {
  const nodes = new Map(bundle.nodes.map((node) => [node.id, node]));
  const floors = new Map(bundle.floors.map((floor) => [floor.id, floor]));
  return bundle.edges.filter((edge) => {
    if (!traversable(edge) || !["stairs", "escalator", "elevator"].includes(edge.mode)) return false;
    const points = edgePoints(bundle, edge, nodes, floors);
    if (points.length < 2) return false;
    if (edge.attributes?.sceneGap === true) return true;
    if (edge.mode === "elevator") {
      const a = points[0]!, b = points.at(-1)!;
      const floor = (p: THREE.Vector3) => hasFloor({ x: p.x, y: -p.z, z: p.y });
      return !floor(a) || !floor(b) || !hasElevator(a, b);
    }
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

export type ConnectorMaterial = "tread" | "riser" | "nosing" | "escStep" | "escTruss" | "steel" | "rubber" | "glass" | "light";
export interface ConnectorPart { material: ConnectorMaterial; position: number[]; normal: number[]; colour: number[]; edgeId?: string; role?: "walkable" | "collider" | "car" | "door"; landingY?: number; walkableOnly?: boolean; soffit?: boolean; userData?: { fit: "exact" | "approximate"; omittedLandings?: number } }
export interface ConnectorOptions { tier: "high" | "low" }

const connectorColours: Record<ConnectorMaterial, string> = {
  tread: "#c7c2b8", riser: "#dbdbd6", nosing: "#2a2b2c", escStep: "#3b3f44",
  escTruss: "#ccccc7", steel: "#aab2b5", rubber: "#121314", glass: "#b4ccd1", light: "#fff6e8",
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
  const fit = rise < 0.15 || rise > 0.21 || tread < 0.25 || tread > 0.35 ? "approximate" : "exact";
  const xAt = (i: number) => i * tread + (omitted ? 0 : Math.floor(i / flightSteps) * landing);
  for (let i = 0; i < count; i++) {
    const x = xAt(i), y = (i + 1) * rise;
    box(parts, "tread", f.matrix, x + tread / 2, y - 0.04, 0, tread, 0.08, widthM, "walkable");
    if (tier === "high") box(parts, "riser", f.matrix, x, y - rise / 2, 0, 0.015, rise, widthM, undefined, 0.55);
    if (tier === "high") box(parts, "nosing", f.matrix, x + 0.0275, y + 0.004, 0, 0.055, 0.008, widthM);
    if (!omitted && (i + 1) % flightSteps === 0 && i + 1 < count) box(parts, "tread", f.matrix, x + tread + landing / 2, y - 0.04, 0, landing, 0.08, widthM, "walkable");
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
  const landing = Math.min(0.8, f.length / 2), run = Math.max(0, f.length - 2 * landing);
  const angle = Math.atan2(f.rise, run), incline = Math.hypot(run, f.rise);
  const fit = landing < 0.8 || angle < 27 * Math.PI / 180 || angle > 33 * Math.PI / 180 ? "approximate" : "exact";
  const count = Math.ceil(incline / 0.4 - 1e-9), group = tier === "low" ? 3 : 1;
  const retained = Array.from({ length: count }, (_, i) => i).filter((i) => (i + 0.5) * 0.4 > 0.2 + 1e-9 && (i + 0.5) * 0.4 < incline - 0.2 - 1e-9);
  const firstX = retained.length ? landing + retained[0]! * 0.4 * Math.cos(angle) : f.length / 2;
  const lastIndex = retained.at(-1);
  const lastEnd = lastIndex === undefined ? f.length / 2 : landing + Math.min(incline, (lastIndex + 1) * 0.4) * Math.cos(angle);
  box(parts, "escStep", f.matrix, firstX / 2, -0.04, 0, firstX, 0.08, 1);
  box(parts, "escStep", f.matrix, (lastEnd + f.length) / 2, f.rise - 0.04, 0, f.length - lastEnd, 0.08, 1);
  // Physical landings meet the continuous incline at its true endpoints, independently of the extended visual combs.
  for (const end of [0, 1]) {
    box(parts, "escStep", f.matrix, end ? f.length - landing / 2 : landing / 2, end * f.rise - 0.04, 0, landing, 0.08, 1, "walkable");
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
    if (tier === "low") {
      const geo = new THREE.PlaneGeometry(depth, 1); geo.rotateX(-Math.PI / 2);
      parts.push(part(geo, "escStep", f.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, 0))));
    } else {
      box(parts, "escStep", f.matrix, x, y - 0.025, 0, depth, 0.05, 1);
      box(parts, "escStep", f.matrix, x - depth / 2, y - 0.1, 0, 0.015, Math.min(0.4, incline - first) * Math.sin(angle), 1);
    }
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
    box(indicator, "light", f.matrix, (end ? f.length - landing : landing), end * f.rise + 0.12, 0.64, 0.02, 0.1, 0.16);
    const color = new THREE.Color((end === 0) === (from.y <= to.y) ? "#00ff00" : "#ff0000");
    for (const p of indicator) { for (let i = 0; i < p.colour.length; i += 3) { p.colour[i] = color.r; p.colour[i + 1] = color.g; p.colour[i + 2] = color.b; } parts.push(p); }
  }
  for (const p of parts) p.userData = { fit };
  return parts;
}

/** Build a shaft and an independently movable car in local floor coordinates. */
export function buildElevator(from: THREE.Vector3, to: THREE.Vector3, facing: THREE.Vector3, _tier: "high" | "low"): ConnectorPart[] {
  const f = frame(from, to), parts: ConnectorPart[] = [], height = f.rise + 2.6;
  const yaw = Math.hypot(facing.x, facing.z) > 1e-9 ? Math.atan2(facing.z, -facing.x) : 0;
  f.matrix.makeRotationY(yaw).setPosition(f.low);
  for (const x of [-1.06, 1.06]) for (const z of [-1.06, 1.06]) box(parts, "steel", f.matrix, x, height / 2, z, 0.08, height, 0.08);
  for (const y of [0, f.rise]) {
    for (const z of [-1.06, 1.06]) box(parts, "steel", f.matrix, 0, y + 0.04, z, 2.2, 0.08, 0.08);
    for (const x of [-1.06, 1.06]) box(parts, "steel", f.matrix, x, y + 0.04, 0, 0.08, 0.08, 2.2);
    for (const z of [-0.225, 0.225]) { box(parts, "steel", f.matrix, -1.1, y + 1.05, z, 0.04, 2.1, 0.45, "door"); parts.at(-1)!.landingY = f.low.y + y; }
    box(parts, "light", f.matrix, -1.11, y + 2.2, 0, 0.02, 0.06, 0.3);
  }
  box(parts, "escTruss", f.matrix, 1.08, height / 2, 0, 0.04, height, 2.2, "collider");
  for (const z of [-1.08, 1.08]) box(parts, "escTruss", f.matrix, 0, height / 2, z, 2.2, height, 0.04, "collider");
  // The front has landing openings cut out of both its visible and collision geometry.
  for (const z of [-0.775, 0.775]) box(parts, "glass", f.matrix, -1.08, height / 2, z, 0.04, height, 0.65, "collider");
  for (const [y, h] of [[2.1, Math.max(0, f.rise - 2.1)], [f.rise + 2.1, 0.5]] as const) if (h > 0) box(parts, "glass", f.matrix, -1.08, y + h / 2, 0, 0.04, h, 0.9, "collider");
  const local = new THREE.Matrix4();
  box(parts, "tread", local, 0, -0.04, 0, 1.6, 0.08, 1.5, "car");
  box(parts, "steel", local, 0.78, 1.15, 0, 0.04, 2.3, 1.5, "car");
  for (const z of [-0.73, 0.73]) box(parts, "steel", local, 0, 1.15, z, 1.6, 2.3, 0.04, "car");
  box(parts, "light", local, 0, 2.29, 0, 1.3, 0.02, 1.2, "car");
  return parts;
}

export interface ConnectorScope { hasFloor: (p: V3) => boolean; nearMesh: (p: THREE.Vector3, radius: number) => boolean; hasElevator?: (a: THREE.Vector3, b: THREE.Vector3) => boolean; elevatorOverlap?: (a: THREE.Vector3, b: THREE.Vector3) => boolean }

function meshFor(parts: readonly ConnectorPart[], material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(parts.flatMap((p) => p.position), 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(parts.flatMap((p) => p.normal), 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(parts.flatMap((p) => p.colour), 3));
  const mesh = new THREE.Mesh(geometry, material);
  const ids = [...new Set(parts.map((p) => p.edgeId).filter((id): id is string => id !== undefined))];
  let start = 0;
  const edgeRanges = parts.map((p) => { const range = { start, end: start + p.position.length / 3, edgeId: p.edgeId }; start = range.end; return range; });
  mesh.userData = { greybox: true, connector: true, approximate: true, fit: parts.some((p) => p.userData?.fit === "approximate") ? "approximate" : "exact", edgeId: ids.length === 1 ? ids[0] : ids, edgeRanges };
  return mesh;
}

/** Build runtime-only batches for missing vertical transport. */
export function buildConnectors(bundle: StationBundle, traversable: (edge: Edge) => boolean, scope: ConnectorScope, tier: "high" | "low") {
  const root = new THREE.Group(), walkable: THREE.Object3D[] = [], colliders: THREE.Object3D[] = [];
  const wallSegments: Segment2[] = [];
  const cars: { edgeId: string; edgeIds: string[]; mesh: THREE.Mesh; zLow: number; zHigh: number; landings: number[]; doors: { landing: number; mesh: THREE.Mesh }[] }[] = [];
  const nodes = new Map(bundle.nodes.map((node) => [node.id, node]));
  const floors = new Map(bundle.floors.map((floor) => [floor.id, floor]));
  const batches = new Map<string, ConnectorPart[]>();
  const counts = { escalator: 0, stairs: 0, elevator: 0 };
  let approximateFits = 0, omittedLandings = 0, elevatorOverlaps = 0;
  const shellMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, side: THREE.DoubleSide });
  const lightMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: "#fff6e8", emissiveIntensity: 3.2, side: THREE.DoubleSide });
  const glassMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false, roughness: 0.32, metalness: 0.08, side: THREE.DoubleSide });
  const physicalMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  for (const edge of unmodelledVerticalEdges(bundle, traversable, scope.hasFloor, scope.nearMesh, scope.hasElevator)) {
    const points = edgePoints(bundle, edge, nodes, floors), a = points[0]!, b = points.at(-1)!;
    const facing = a.clone().sub(b); facing.y = 0;
    const rawWidth = (edge.attributes as unknown as { width?: { m?: number } } | undefined)?.width?.m;
    const width = rawWidth && rawWidth > 0 ? rawWidth : 1.5;
    let bentEscalator = false;
    for (let i = 1; i + 1 < points.length; i++) {
      const before = points[i]!.clone().sub(points[i - 1]!); before.y = 0;
      const after = points[i + 1]!.clone().sub(points[i]!); after.y = 0;
      if (before.lengthSq() && after.lengthSq() && before.angleTo(after) > Math.PI / 18) bentEscalator = true;
    }
    const parts: ConnectorPart[] = [];
    let edgeOmitted = 0;
    if (edge.mode === "elevator") parts.push(...buildElevator(a, b, facing, tier));
    else for (let i = 1; i < points.length; i++) {
      const from = points[i - 1]!, to = points[i]!;
      const dx = to.x - from.x, dz = to.z - from.z, horizontal = Math.hypot(dx, dz);
      if (horizontal > 1e-6) {
        const half = (edge.mode === "stairs" ? width : 1.2) / 2 + 0.03, n = Math.max(1, Math.ceil(horizontal / 0.5));
        for (const side of [-1, 1]) for (let k = 0; k < n; k++) {
          const t = k / n, u = (k + 1) / n, ox = -dz / horizontal * half * side, oz = dx / horizontal * half * side;
          const ya = THREE.MathUtils.lerp(from.y, to.y, t), yb = THREE.MathUtils.lerp(from.y, to.y, u);
          wallSegments.push({ ax: THREE.MathUtils.lerp(from.x, to.x, t) + ox, az: THREE.MathUtils.lerp(from.z, to.z, t) + oz, bx: THREE.MathUtils.lerp(from.x, to.x, u) + ox, bz: THREE.MathUtils.lerp(from.z, to.z, u) + oz, yMin: Math.min(ya, yb) - 0.12, yMax: Math.max(ya, yb) + 0.96 });
        }
      }
      if (Math.abs(to.y - from.y) > 1e-6) {
        const flight = edge.mode === "stairs" ? buildStairs(from, to, width, tier) : buildEscalator(from, to, tier);
        edgeOmitted += flight[0]?.userData?.omittedLandings ?? 0;
        parts.push(...flight);
      }
      else {
        const f = frame(from, to);
        box(parts, edge.mode === "stairs" ? "tread" : "escStep", f.matrix, f.length / 2, -0.04, 0, f.length, 0.08, edge.mode === "stairs" ? width : 1.2, "walkable");
      }
      const incoming = to.clone().sub(from); incoming.y = 0;
      const outgoing = i < points.length - 1 ? points[i + 1]!.clone().sub(to) : new THREE.Vector3(); outgoing.y = 0;
      if (incoming.lengthSq() && outgoing.lengthSq() && incoming.angleTo(outgoing) > 1e-6) {
        const at = to.clone();
        const rotation = new THREE.Matrix4().makeRotationY(Math.atan2(-(to.z - from.z), to.x - from.x)).setPosition(at);
        box(parts, edge.mode === "stairs" ? "tread" : "escStep", rotation, 0, -0.04, 0, edge.mode === "stairs" ? width : 1.2, 0.08, edge.mode === "stairs" ? width : 1.2, "walkable");
      }
    }
    if (edge.mode === "elevator" && scope.elevatorOverlap?.(a, b)) { elevatorOverlaps++; for (const p of parts) p.userData = { ...p.userData, fit: "approximate" }; }
    if (edge.mode === "escalator" && bentEscalator) for (const p of parts) p.userData = { ...p.userData, fit: "approximate" };
    for (const part of parts) part.edgeId = edge.id;
    if (edge.mode === "stairs" || edge.mode === "escalator" || edge.mode === "elevator") counts[edge.mode]++;
    if (parts.some((p) => p.userData?.fit === "approximate")) approximateFits++;
    omittedLandings += edgeOmitted;
    const key = tier === "low" ? "all" : nodes.get(edge.from)?.floorId ?? "";
    const batch = batches.get(key) ?? []; batch.push(...parts.filter((p) => p.role !== "car" && p.role !== "door" && !p.walkableOnly)); batches.set(key, batch);
    const support = parts.filter((p) => p.role === "walkable"), walls = parts.filter((p) => p.role === "collider");
    if (support.length) walkable.push(meshFor(support, physicalMaterial));
    if (walls.length) colliders.push(meshFor(walls, physicalMaterial));
    const car = parts.filter((p) => p.role === "car");
    if (car.length) {
      const low = a.y <= b.y ? a : b;
      const existing = cars.find((c) => Math.hypot(c.mesh.position.x - low.x, c.mesh.position.z - low.z) < 0.1);
      const addDoors = (target: typeof cars[number]) => {
        for (const landing of [a.y, b.y]) {
          if (target.doors.some((door) => Math.abs(door.landing - landing) < 1e-6)) continue;
          const leaves = parts.filter((p) => p.role === "door" && Math.abs(p.landingY! - landing) < 1e-6);
          if (!leaves.length) continue;
          const door = meshFor(leaves, shellMaterial); door.visible = Math.abs(target.mesh.position.y - landing) >= 1e-6;
          root.add(door); target.doors.push({ landing, mesh: door });
        }
      };
      if (existing) {
        existing.edgeIds.push(edge.id); existing.landings = [...new Set([...existing.landings, a.y, b.y])].sort((x, y) => x - y);
        existing.zLow = existing.landings[0]!; existing.zHigh = existing.landings.at(-1)!; existing.mesh.position.y = existing.zLow;
        addDoors(existing);
        continue;
      }
      const mesh = meshFor(car, shellMaterial), f = frame(a, b);
      mesh.geometry.clearGroups();
      let start = 0;
      for (const item of car) { const size = item.position.length / 3; mesh.geometry.addGroup(start, size, item.material === "light" ? 1 : 0); start += size; }
      mesh.material = [shellMaterial, lightMaterial];
      mesh.position.copy(f.low); mesh.rotation.y = Math.hypot(facing.x, facing.z) > 1e-9 ? Math.atan2(facing.z, -facing.x) : 0;
      root.add(mesh); const record = { edgeId: edge.id, edgeIds: [edge.id], mesh, zLow: f.low.y, zHigh: f.high.y, landings: [f.low.y, f.high.y], doors: [] as { landing: number; mesh: THREE.Mesh }[] }; cars.push(record); addDoors(record);
      const floor = meshFor(car.filter((p) => p.material === "tread"), physicalMaterial);
      floor.visible = false; mesh.add(floor); walkable.push(floor);
    }
  }
  let triangles = 0;
  const lightBatches: { mesh: THREE.Mesh; parts: ConnectorPart[] }[] = [];
  for (const batch of batches.values()) {
    for (const [parts, material] of [[batch.filter((p) => p.material !== "light" && p.material !== "glass"), shellMaterial], [batch.filter((p) => p.material === "light"), lightMaterial], [batch.filter((p) => p.material === "glass"), glassMaterial]] as const) {
      if (!parts.length) continue;
      const mesh = meshFor(parts, material); root.add(mesh); triangles += mesh.geometry.getAttribute("position").count / 3;
      if (material === lightMaterial) lightBatches.push({ mesh, parts });
    }
  }
  for (const car of cars) { triangles += car.mesh.geometry.getAttribute("position").count / 3; for (const door of car.doors) triangles += door.mesh.geometry.getAttribute("position").count / 3; for (const door of car.doors) door.mesh.visible = Math.abs(car.mesh.position.y - door.landing) >= 1e-6; }
  const stats = { connectors: counts, meshes: root.children.length, triangles, approximateFits, omittedLandings, elevatorOverlaps, overBudget: null as string | null,
    dropSoffits() {
      for (const batch of lightBatches) {
        const kept = batch.parts.filter((p) => !p.soffit);
        if (kept.length === batch.parts.length) continue;
        stats.triangles -= batch.parts.filter((p) => p.soffit).reduce((n, p) => n + p.position.length / 9, 0);
        const replacement = meshFor(kept, lightMaterial);
        batch.mesh.geometry.dispose(); batch.mesh.geometry = replacement.geometry; batch.mesh.userData.edgeId = replacement.userData.edgeId; batch.mesh.userData.edgeRanges = replacement.userData.edgeRanges; batch.parts = kept;
        if (!kept.length) { root.remove(batch.mesh); stats.meshes--; }
      }
    } };
  return { root, walkable, colliders, cars, wallSegments, stats };
}

/** Apply the shared triangle cap, retaining essential connector and passage geometry. */
export function withinGreyboxBudget(aStats: { triangles: number }, bStats: { triangles: number; overBudget: string | null; dropSoffits: () => void }, tier: "high" | "low"): boolean {
  const limit = tier === "high" ? 150000 : 100000;
  if (aStats.triangles + bStats.triangles > limit) bStats.dropSoffits();
  const over = aStats.triangles + bStats.triangles > limit;
  bStats.overBudget = over ? `Combined greybox exceeds ${limit} triangles after dropping connector soffits` : null;
  return !over;
}
