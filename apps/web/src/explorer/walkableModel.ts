import polygonClipping, { type Polygon } from "polygon-clipping";

/** A point in plan space: renderer x/z. */
export type PlanPoint = { x: number; z: number };

/** A walkable region, at one level, with the floor height (renderer y) it sits at. */
export type Region =
  | { kind: "strip"; level: string; points: { x: number; y: number; z: number }[]; halfWidth: number }
  | { kind: "disc"; level: string; x: number; y: number; z: number; radius: number }
  | { kind: "rect"; level: string; center: { x: number; y: number; z: number }; along: PlanPoint; halfLength: number; halfWidth: number }
  | { kind: "connector"; level: string; quad: PlanPoint[]; y: number };

/** One wall piece on a level's union boundary, with the floor height at each end. */
export type BoundaryWall = { ax: number; az: number; bx: number; bz: number; ay: number; by: number; level: string };

/** A union polygon in plan: `[0]` is the outer ring, the rest are holes. Rings are open (no repeated closing point). */
export type PlanPolygon = PlanPoint[][];

const WALL_TOLERANCE_M = 1e-3;
const MIN_WALL_M = 1e-3;
const OUTSIDE_TEST_M = 1e-4;
const ATTACHMENT_PROBE_M = 0.3;
const DISC_SEGMENTS = 24;

/** Polygons of one region in plan. A strip contributes one quad per segment, with no cap beyond its ends. */
export function regionPolygon(region: Region): PlanPolygon[] {
  switch (region.kind) {
    case "strip": {
      const out: PlanPolygon[] = [];
      if (region.halfWidth <= 0) return out;
      for (let i = 1; i < region.points.length; i++) {
        const a = region.points[i - 1]!, b = region.points[i]!;
        const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
        if (length < 1e-9) continue;
        const nx = (-dz / length) * region.halfWidth, nz = (dx / length) * region.halfWidth;
        out.push([[
          { x: a.x + nx, z: a.z + nz },
          { x: b.x + nx, z: b.z + nz },
          { x: b.x - nx, z: b.z - nz },
          { x: a.x - nx, z: a.z - nz },
        ]]);
      }
      return out;
    }
    case "disc": {
      if (region.radius <= 0) return [];
      const ring: PlanPoint[] = [];
      for (let i = 0; i < DISC_SEGMENTS; i++) {
        const angle = (i * Math.PI * 2) / DISC_SEGMENTS;
        ring.push({ x: region.x + Math.cos(angle) * region.radius, z: region.z + Math.sin(angle) * region.radius });
      }
      return [[ring]];
    }
    case "rect": {
      if (region.halfLength <= 0 || region.halfWidth <= 0) return [];
      const length = Math.hypot(region.along.x, region.along.z);
      const ax = length > 1e-9 ? region.along.x / length : 1;
      const az = length > 1e-9 ? region.along.z / length : 0;
      const nx = -az, nz = ax, { x, z } = region.center;
      const at = (along: number, across: number) => ({ x: x + ax * along + nx * across, z: z + az * along + nz * across });
      return [[[
        at(region.halfLength, region.halfWidth),
        at(region.halfLength, -region.halfWidth),
        at(-region.halfLength, -region.halfWidth),
        at(-region.halfLength, region.halfWidth),
      ]]];
    }
    case "connector":
      return region.quad.length >= 3 ? [[region.quad.map((p) => ({ x: p.x, z: p.z }))]] : [];
  }
}

/** Per-region floor height at the closest point of its polygon boundary; `box` is its plan bounds. */
type HeightSource = { box: Box; nearest(p: PlanPoint): { distance: number; height: number } };
type Box = { minX: number; minZ: number; maxX: number; maxZ: number };

function boxOf(polygons: readonly PlanPolygon[]): Box {
  const box = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const polygon of polygons) for (const ring of polygon) for (const p of ring) {
    box.minX = Math.min(box.minX, p.x); box.maxX = Math.max(box.maxX, p.x); box.minZ = Math.min(box.minZ, p.z); box.maxZ = Math.max(box.maxZ, p.z);
  }
  return box;
}

const boxDistance = (box: Box, p: PlanPoint): number => Math.hypot(Math.max(box.minX - p.x, 0, p.x - box.maxX), Math.max(box.minZ - p.z, 0, p.z - box.maxZ));

function closestOnSegment(p: PlanPoint, a: PlanPoint, b: PlanPoint): PlanPoint {
  const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
  const t = length2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2)) : 0;
  return { x: a.x + dx * t, z: a.z + dz * t };
}

const pointSegmentDistance = (p: PlanPoint, a: PlanPoint, b: PlanPoint): number => {
  const q = closestOnSegment(p, a, b);
  return Math.hypot(p.x - q.x, p.z - q.z);
};

/** Distance to the boundary of a polygon's rings, at a constant floor height. */
function polygonNearest(polygons: readonly PlanPolygon[], y: number, p: PlanPoint): { distance: number; height: number } {
  let distance = Infinity;
  for (const polygon of polygons) for (const ring of polygon) {
    if (ring.length < 2) continue;
    for (let i = 0; i < ring.length; i++) {
      const d = pointSegmentDistance(p, ring[i]!, ring[(i + 1) % ring.length]!);
      if (d < distance) distance = d;
    }
  }
  return { distance, height: y };
}

/** A strip's floor height is linear along each segment; the closest point on the quad gives its projection. */
function stripNearest(region: Extract<Region, { kind: "strip" }>, p: PlanPoint): { distance: number; height: number } {
  if (region.halfWidth <= 0 || region.points.length < 2) return { distance: Infinity, height: region.points[0]?.y ?? 0 };
  let distance = Infinity, height = region.points[0]!.y;
  for (let i = 1; i < region.points.length; i++) {
    const a = region.points[i - 1]!, b = region.points[i]!;
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    if (length < 1e-9) continue;
    const nx = (-dz / length) * region.halfWidth, nz = (dx / length) * region.halfWidth;
    const quad = [
      { x: a.x + nx, z: a.z + nz },
      { x: b.x + nx, z: b.z + nz },
      { x: b.x - nx, z: b.z - nz },
      { x: a.x - nx, z: a.z - nz },
    ];
    for (let k = 0; k < 4; k++) {
      const q = closestOnSegment(p, quad[k]!, quad[(k + 1) % 4]!);
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (d < distance) {
        const t = Math.min(1, Math.max(0, ((q.x - a.x) * dx + (q.z - a.z) * dz) / (length * length)));
        distance = d;
        height = a.y + (b.y - a.y) * t;
      }
    }
  }
  return { distance, height };
}

function heightSource(region: Region): HeightSource {
  const polygons = regionPolygon(region), box = boxOf(polygons);
  switch (region.kind) {
    case "strip": return { box, nearest: (p) => stripNearest(region, p) };
    case "disc": return { box, nearest: (p) => polygonNearest(polygons, region.y, p) };
    case "rect": return { box, nearest: (p) => polygonNearest(polygons, region.center.y, p) };
    case "connector": return { box, nearest: (p) => polygonNearest(polygons, region.y, p) };
  }
}

/** The floor height at a boundary vertex: the region whose polygon boundary it lies on, nearest first. */
function heightAtVertex(p: PlanPoint, sources: readonly HeightSource[]): number {
  let distance = Infinity, height = 0;
  for (const source of sources) {
    if (boxDistance(source.box, p) >= distance) continue;
    const nearest = source.nearest(p);
    if (nearest.distance < distance) { distance = nearest.distance; height = nearest.height; }
  }
  return height;
}

function pointInRing(p: PlanPoint, ring: readonly PlanPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function pointInLevel(p: PlanPoint, polygons: readonly PlanPolygon[]): boolean {
  for (const polygon of polygons) {
    const outer = polygon[0];
    if (!outer || !pointInRing(p, outer)) continue;
    let inHole = false;
    for (let i = 1; i < polygon.length && !inHole; i++) inHole = pointInRing(p, polygon[i]!);
    if (!inHole) return true;
  }
  return false;
}

/** Parameter intervals where a boundary edge touches a connector footprint: it is split there. */
function splitParameters(a: PlanPoint, b: PlanPoint, connectors: readonly PlanPoint[][]): number[] {
  const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz, length = Math.sqrt(length2);
  if (length < 1e-12) return [0, 1];
  const ts = [0, 1];
  for (const ring of connectors) {
    for (let i = 0; i < ring.length; i++) {
      const c = ring[i]!, d = ring[(i + 1) % ring.length]!;
      const ex = d.x - c.x, ez = d.z - c.z, edgeLength = Math.hypot(ex, ez);
      const denom = dx * ez - dz * ex;
      if (Math.abs(denom) > 1e-9 * (length * edgeLength + 1e-12)) {
        const t = ((c.x - a.x) * ez - (c.z - a.z) * ex) / denom;
        const u = ((c.x - a.x) * dz - (c.z - a.z) * dx) / denom;
        if (t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
      } else if (Math.abs((c.x - a.x) * dz - (c.z - a.z) * dx) / length <= WALL_TOLERANCE_M) {
        // Collinear: the connector boundary lies along this edge, so its ends split it.
        for (const t of [((c.x - a.x) * dx + (c.z - a.z) * dz) / length2, ((d.x - a.x) * dx + (d.z - a.z) * dz) / length2]) {
          if (t > 1e-9 && t < 1 - 1e-9) ts.push(t);
        }
      }
    }
  }
  ts.sort((x, y) => x - y);
  const out = [ts[0]!];
  for (let i = 1; i < ts.length; i++) if (ts[i]! - out.at(-1)! > 1e-9) out.push(ts[i]!);
  return out;
}

function onConnectorBoundary(p: PlanPoint, connectors: readonly PlanPoint[][]): boolean {
  for (const ring of connectors) {
    for (let i = 0; i < ring.length; i++) {
      if (pointSegmentDistance(p, ring[i]!, ring[(i + 1) % ring.length]!) <= WALL_TOLERANCE_M) return true;
    }
  }
  return false;
}

/** The midpoint moved `ATTACHMENT_PROBE_M` away from the union interior, at the wall's height. */
function outsidePoint(wall: BoundaryWall, polygons: readonly PlanPolygon[]): { x: number; y: number; z: number } {
  const dx = wall.bx - wall.ax, dz = wall.bz - wall.az, length = Math.hypot(dx, dz);
  const mx = (wall.ax + wall.bx) / 2, mz = (wall.az + wall.bz) / 2, y = (wall.ay + wall.by) / 2;
  if (length < 1e-12) return { x: mx, y, z: mz };
  const nx = -dz / length, nz = dx / length;
  const inside = (side: number, distance: number) => pointInLevel({ x: mx + nx * side * distance, z: mz + nz * side * distance }, polygons);
  let outward = -1;
  // A wide probe can land back inside another region, so try close first. With neither decisive (a very
  // narrow region), polygon-clipping's normalised winding still puts the union interior left of travel.
  for (const distance of [OUTSIDE_TEST_M, ATTACHMENT_PROBE_M]) {
    const left = inside(1, distance), right = inside(-1, distance);
    if (left !== right) { outward = left ? -1 : 1; break; }
  }
  return { x: mx + nx * outward * ATTACHMENT_PROBE_M, y, z: mz + nz * outward * ATTACHMENT_PROBE_M };
}

function collinear(a: BoundaryWall, b: BoundaryWall): boolean {
  if (Math.abs(a.bx - b.ax) > 1e-9 || Math.abs(a.bz - b.az) > 1e-9 || Math.abs(a.by - b.ay) > 1e-6) return false;
  const ax = a.bx - a.ax, az = a.bz - a.az, bx = b.bx - b.ax, bz = b.bz - b.az;
  const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
  if (la < 1e-12 || lb < 1e-12) return false;
  return Math.abs(ax * bz - az * bx) <= 1e-9 * la * lb && ax * bx + az * bz > 0;
}

function mergeCollinear(pieces: readonly BoundaryWall[]): BoundaryWall[] {
  const merged: BoundaryWall[] = [];
  for (const piece of pieces) {
    const last = merged.at(-1);
    if (last && collinear(last, piece)) { last.bx = piece.bx; last.bz = piece.bz; last.by = piece.by; }
    else merged.push({ ...piece });
  }
  if (merged.length > 1) {
    const first = merged[0]!, last = merged.at(-1)!;
    if (collinear(last, first)) {
      merged[0] = { ax: last.ax, az: last.az, ay: last.ay, bx: first.bx, bz: first.bz, by: first.by, level: first.level };
      merged.pop();
    }
  }
  return merged;
}

function boundaryWalls(
  polygons: readonly PlanPolygon[],
  sources: readonly HeightSource[],
  connectors: readonly PlanPoint[][],
  level: string,
  isAttachment?: (wall: BoundaryWall, outside: { x: number; y: number; z: number }) => boolean,
): BoundaryWall[] {
  const walls: BoundaryWall[] = [];
  const connectorBoxes = connectors.map((ring) => boxOf([[ring]]));
  const lerp = (a: PlanPoint, b: PlanPoint, t: number): PlanPoint => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  for (const polygon of polygons) for (const ring of polygon) {
    if (ring.length < 3) continue;
    const pieces: BoundaryWall[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      const edgeBox = { minX: Math.min(a.x, b.x) - WALL_TOLERANCE_M, minZ: Math.min(a.z, b.z) - WALL_TOLERANCE_M, maxX: Math.max(a.x, b.x) + WALL_TOLERANCE_M, maxZ: Math.max(a.z, b.z) + WALL_TOLERANCE_M };
      const near = connectors.filter((_ring, k) => { const c = connectorBoxes[k]!; return c.minX <= edgeBox.maxX && c.maxX >= edgeBox.minX && c.minZ <= edgeBox.maxZ && c.maxZ >= edgeBox.minZ; });
      const splits = near.length ? splitParameters(a, b, near) : [0, 1];
      for (let k = 1; k < splits.length; k++) {
        const t0 = splits[k - 1]!, t1 = splits[k]!;
        if (t1 - t0 <= 1e-12) continue;
        const p = lerp(a, b, t0), q = lerp(a, b, t1);
        if (near.length && onConnectorBoundary(lerp(a, b, (t0 + t1) / 2), near)) continue;
        const wall: BoundaryWall = { ax: p.x, az: p.z, bx: q.x, bz: q.z, ay: heightAtVertex(p, sources), by: heightAtVertex(q, sources), level };
        if (isAttachment?.(wall, outsidePoint(wall, polygons))) continue;
        pieces.push(wall);
      }
    }
    for (const wall of mergeCollinear(pieces)) {
      if (Math.hypot(wall.bx - wall.ax, wall.bz - wall.az) >= MIN_WALL_M) walls.push(wall);
    }
  }
  return walls;
}

function fromClipping(polygon: Polygon): PlanPolygon {
  return polygon.map((ring) => {
    const points = ring.map(([x, z]) => ({ x, z }));
    const first = points[0], last = points.at(-1);
    if (points.length > 1 && first && last && Math.abs(first.x - last.x) < 1e-12 && Math.abs(first.z - last.z) < 1e-12) points.pop();
    return points;
  });
}

/** Union every region per level and emit the boundary walls the connector footprints and attachments leave. */
export function buildWalkableModel(
  regions: readonly Region[],
  isAttachment?: (wall: BoundaryWall, outside: { x: number; y: number; z: number }) => boolean,
): { levels: Map<string, PlanPolygon[]>; walls: BoundaryWall[] } {
  const byLevel = new Map<string, Region[]>();
  for (const region of regions) {
    const list = byLevel.get(region.level);
    if (list) list.push(region); else byLevel.set(region.level, [region]);
  }
  const levels = new Map<string, PlanPolygon[]>();
  const walls: BoundaryWall[] = [];
  for (const [level, list] of byLevel) {
    const polygons: Polygon[] = [];
    for (const region of list) for (const polygon of regionPolygon(region)) polygons.push([polygon[0]!.map((p): [number, number] => [p.x, p.z])]);
    if (!polygons.length) { levels.set(level, []); continue; }
    const union = polygonClipping.union(polygons[0]!, ...polygons.slice(1)).map(fromClipping);
    levels.set(level, union);
    const connectors = list.filter((region) => region.kind === "connector").flatMap((region) => regionPolygon(region).map((polygon) => polygon[0]!));
    walls.push(...boundaryWalls(union, list.map(heightSource), connectors, level, isAttachment));
  }
  return { levels, walls };
}
