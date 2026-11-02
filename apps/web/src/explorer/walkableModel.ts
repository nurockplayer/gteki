import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";

/** A point in plan space: renderer x/z. */
export type PlanPoint = { x: number; z: number };

/**
 * A walkable region, at one level, with the floor height (renderer y) it sits at. Regions of one `group` (one graph
 * edge's runs and bend patches) are one walk: their overlaps never split a level or cut a floor, unless one passes over
 * the other at walking clearance or more (an edge looping back over itself), which is judged like any two pieces.
 */
export type Region = { group?: string } & (
  | { kind: "strip"; level: string; points: { x: number; y: number; z: number }[]; halfWidth: number }
  | { kind: "disc"; level: string; x: number; y: number; z: number; radius: number }
  | { kind: "rect"; level: string; center: { x: number; y: number; z: number }; along: PlanPoint; halfLength: number; halfWidth: number }
  | { kind: "connector"; level: string; quad: PlanPoint[]; y: number });

/** One wall piece on a level's union boundary, with the floor height at each end. */
/** `topY`: the wall stops there (renderer y), under a floor that climbed over the one it guards (see BODY_TOP_M). */
export type BoundaryWall = { ax: number; az: number; bx: number; bz: number; ay: number; by: number; level: string; topY?: number };

/** A union polygon in plan: `[0]` is the outer ring, the rest are holes. Rings are open (no repeated closing point). */
export type PlanPolygon = PlanPoint[][];

const WALL_TOLERANCE_M = 1e-3;
const MIN_WALL_M = 1e-3;
const OUTSIDE_TEST_M = 1e-4;
const ATTACHMENT_PROBE_M = 0.3;
const ATTACHMENT_PIECE_M = 2;
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

const overlaps = (a: Box, b: Box): boolean => a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;

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
  // Regions whose bounds hold the point first: a boundary vertex lies on one of them, and then the rest are skipped.
  for (const pass of [0, 1]) {
    for (const source of sources) {
      const away = boxDistance(source.box, p);
      if ((pass === 0) !== (away === 0) || away >= distance) continue;
      const nearest = source.nearest(p);
      if (nearest.distance < distance) { distance = nearest.distance; height = nearest.height; }
      if (distance <= 1e-9) return height;
    }
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

/** Plan bounds of a level and of each of its polygons, built once per level: most probes miss every polygon. */
type LevelIndex = { box: Box; boxes: Box[] };
const levelIndexes = new WeakMap<readonly PlanPolygon[], LevelIndex>();
const inBox = (box: Box, p: PlanPoint): boolean => p.x >= box.minX && p.x <= box.maxX && p.z >= box.minZ && p.z <= box.maxZ;

function pointInLevel(p: PlanPoint, polygons: readonly PlanPolygon[]): boolean {
  let index = levelIndexes.get(polygons);
  if (!index) levelIndexes.set(polygons, index = { box: boxOf(polygons), boxes: polygons.map((polygon) => boxOf([polygon])) });
  if (!inBox(index.box, p)) return false;
  for (let k = 0; k < polygons.length; k++) {
    const polygon = polygons[k]!, outer = polygon[0];
    if (!outer || !inBox(index.boxes[k]!, p) || !pointInRing(p, outer)) continue;
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

/** Which side of a boundary piece (+1 left of travel, -1 right) faces away from the union interior. */
function outwardSide(wall: BoundaryWall, polygons: readonly PlanPolygon[]): number {
  const dx = wall.bx - wall.ax, dz = wall.bz - wall.az, length = Math.hypot(dx, dz);
  if (length < 1e-12) return -1;
  const mx = (wall.ax + wall.bx) / 2, mz = (wall.az + wall.bz) / 2, nx = -dz / length, nz = dx / length;
  const inside = (side: number, distance: number) => pointInLevel({ x: mx + nx * side * distance, z: mz + nz * side * distance }, polygons);
  let outward = -1;
  // A wide probe can land back inside another region, so try close first. With neither decisive (a very
  // narrow region), polygon-clipping's normalised winding still puts the union interior left of travel.
  for (const distance of [OUTSIDE_TEST_M, ATTACHMENT_PROBE_M]) {
    const left = inside(1, distance), right = inside(-1, distance);
    if (left !== right) { outward = left ? -1 : 1; break; }
  }
  return outward;
}

/** The midpoint moved `ATTACHMENT_PROBE_M` to the outward side, at the wall's height. */
function outsidePoint(wall: BoundaryWall, outward: number): { x: number; y: number; z: number } {
  const dx = wall.bx - wall.ax, dz = wall.bz - wall.az, length = Math.hypot(dx, dz);
  const mx = (wall.ax + wall.bx) / 2, mz = (wall.az + wall.bz) / 2, y = (wall.ay + wall.by) / 2;
  if (length < 1e-12) return { x: mx, y, z: mz };
  return { x: mx - dz / length * outward * ATTACHMENT_PROBE_M, y, z: mz + dx / length * outward * ATTACHMENT_PROBE_M };
}

function collinear(a: BoundaryWall, b: BoundaryWall): boolean {
  if (Math.abs(a.bx - b.ax) > 1e-9 || Math.abs(a.bz - b.az) > 1e-9 || Math.abs(a.by - b.ay) > 1e-6) return false;
  const ax = a.bx - a.ax, az = a.bz - a.az, bx = b.bx - b.ax, bz = b.bz - b.az;
  const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
  if (la < 1e-12 || lb < 1e-12) return false;
  // Same plan direction and the same rise per metre: a level passage and the ramp after it stay two walls.
  return Math.abs(ax * bz - az * bx) <= 1e-9 * la * lb && ax * bx + az * bz > 0 && Math.abs((a.by - a.ay) / la - (b.by - b.ay) / lb) <= 1e-6;
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
  attachmentNear: (box: Box) => ((wall: BoundaryWall, outside: { x: number; y: number; z: number }) => boolean),
  breakpoints: readonly PlanPoint[],
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
      // A region vertex on this edge is a height breakpoint the union dropped (a level passage turning into a ramp).
      const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
      if (length2 > 1e-12) {
        for (const v of breakpoints) {
          if (v.x < edgeBox.minX || v.x > edgeBox.maxX || v.z < edgeBox.minZ || v.z > edgeBox.maxZ) continue;
          const t = ((v.x - a.x) * dx + (v.z - a.z) * dz) / length2;
          if (t > 1e-9 && t < 1 - 1e-9 && pointSegmentDistance(v, a, b) <= WALL_TOLERANCE_M) splits.push(t);
        }
        splits.sort((x, y) => x - y);
      }
      const probe = ATTACHMENT_PROBE_M + WALL_TOLERANCE_M;
      const isAttachment = attachmentNear({ minX: edgeBox.minX - probe, minZ: edgeBox.minZ - probe, maxX: edgeBox.maxX + probe, maxZ: edgeBox.maxZ + probe });
      // The whole edge has the union interior on one side, so its pieces share one outward side.
      const outward = outwardSide({ ax: a.x, az: a.z, bx: b.x, bz: b.z, ay: 0, by: 0, level }, polygons);
      for (let k = 1; k < splits.length; k++) {
        const t0 = splits[k - 1]!, t1 = splits[k]!;
        if (t1 - t0 <= 1e-12) continue;
        if (near.length && onConnectorBoundary(lerp(a, b, (t0 + t1) / 2), near)) continue;
        // Attachments are decided in pieces of at most 2 m: scene floor can reach along only part of a long side.
        // Between splits (region vertices included) the floor height is linear, so only the split ends are looked up.
        const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * (t1 - t0) / ATTACHMENT_PIECE_M));
        const y0 = heightAtVertex(lerp(a, b, t0), sources), y1 = heightAtVertex(lerp(a, b, t1), sources);
        const piece = (from: number, to: number): BoundaryWall => {
          const p = lerp(a, b, t0 + (t1 - t0) * from / count), q = lerp(a, b, t0 + (t1 - t0) * to / count);
          return { ax: p.x, az: p.z, bx: q.x, bz: q.z, ay: y0 + (y1 - y0) * from / count, by: y0 + (y1 - y0) * to / count, level };
        };
        // Consecutive kept pieces are one straight wall already.
        let start = 0;
        for (let n = 0; n < count; n++) {
          const wall = piece(n, n + 1);
          if (!isAttachment(wall, outsidePoint(wall, outward))) continue;
          if (n > start) pieces.push(piece(start, n));
          start = n + 1;
        }
        if (count > start) pieces.push(piece(start, count));
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

/**
 * The union of plan rings. Rings are grouped by overlapping bounds first: a ring alone in its group is its own
 * polygon, and only groups of two or more go through polygon-clipping (most corridors on a level never touch).
 */
export function unionRings(rings: readonly PlanPoint[][]): PlanPolygon[] {
  const boxes = rings.map((ring) => boxOf([[ring]]));
  const parent = rings.map((_ring, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!; return i; };
  const order = rings.map((_ring, i) => i).sort((i, j) => boxes[i]!.minX - boxes[j]!.minX);
  for (let k = 0; k < order.length; k++) {
    const i = order[k]!;
    for (let m = k + 1; m < order.length && boxes[order[m]!]!.minX <= boxes[i]!.maxX; m++) {
      if (overlaps(boxes[i]!, boxes[order[m]!]!)) parent[find(i)] = find(order[m]!);
    }
  }
  const groups = new Map<number, PlanPoint[][]>();
  for (let i = 0; i < rings.length; i++) {
    const root = find(i), group = groups.get(root);
    if (group) group.push(rings[i]!); else groups.set(root, [rings[i]!]);
  }
  const union: PlanPolygon[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) { union.push([group[0]!.map((p) => ({ x: p.x, z: p.z }))]); continue; }
    const polygons = (snap: number) => group.map((ring): Polygon => [ring.map((p): [number, number] => snap ? [Math.round(p.x / snap) * snap, Math.round(p.z / snap) * snap] : [p.x, p.z])]);
    let merged: MultiPolygon | null = null;
    // polygon-clipping's sweep line can throw on edges that nearly coincide; such a group is retried snapped to 0.1 mm,
    // then 1 mm, and last in halves.
    for (const snap of [0, 1e-4, 1e-3]) {
      try { const all = polygons(snap); merged = polygonClipping.union(all[0]!, ...all.slice(1)); break; } catch { /* next snap */ }
    }
    if (!merged) {
      // Halves first, then their union: a pair that still throws stays apart, at a cost of log(n) passes.
      const halves = (rings: Polygon[]): MultiPolygon => {
        if (rings.length === 1) return [rings[0]!];
        try { return polygonClipping.union(rings[0]!, ...rings.slice(1)); } catch { /* split */ }
        const mid = rings.length >> 1, left = halves(rings.slice(0, mid)), right = halves(rings.slice(mid));
        try { return polygonClipping.union(left, right); } catch { return [...left, ...right]; }
      };
      merged = halves(polygons(1e-3));
    }
    union.push(...merged.map(fromClipping));
  }
  return union;
}

/**
 * Every edge of the polygons' rings, less the parts lying along an `open` segment (within WALL_TOLERANCE_M): the
 * boundary a guard follows, with the sides a walker crosses left out.
 */
export function boundaryEdges(polygons: readonly PlanPolygon[], open: readonly [PlanPoint, PlanPoint][]): [PlanPoint, PlanPoint][] {
  const out: [PlanPoint, PlanPoint][] = [];
  for (const polygon of polygons) for (const ring of polygon) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!, dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
      if (length2 < MIN_WALL_M * MIN_WALL_M) continue;
      let keep: [number, number][] = [[0, 1]];
      for (const [c, d] of open) {
        // Only a collinear open segment removes anything: both its ends lie on this edge's line (it may run past the edge).
        const off = (p: PlanPoint) => Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / Math.sqrt(length2);
        if (off(c) > WALL_TOLERANCE_M || off(d) > WALL_TOLERANCE_M) continue;
        const tc = ((c.x - a.x) * dx + (c.z - a.z) * dz) / length2, td = ((d.x - a.x) * dx + (d.z - a.z) * dz) / length2;
        const lo = Math.min(tc, td), hi = Math.max(tc, td);
        keep = keep.flatMap(([s, e]): [number, number][] => hi <= s || lo >= e ? [[s, e]] : [...(lo > s ? [[s, lo] as [number, number]] : []), ...(hi < e ? [[hi, e] as [number, number]] : [])]);
      }
      for (const [s, e] of keep) {
        if ((e - s) * Math.sqrt(length2) < MIN_WALL_M) continue;
        out.push([{ x: a.x + dx * s, z: a.z + dz * s }, { x: a.x + dx * e, z: a.z + dz * e }]);
      }
    }
  }
  return out;
}

/** Headroom a floor keeps under the floor above it: 2.3 m clear under that floor's 0.12 m slab. */
const CLEARANCE_M = 2.42;
/** A floor less than this above another stands in the lower one's ceiling (2.6 m) or that ceiling's slab. */
const CEILING_M = 2.72;
/**
 * Where a joined floor climbs at least this far over the floor it rose out of (WALKER_BODY.bodyTopM), the lower floor
 * gives way under it: the wall along that cut stays below a walker on the rising floor (greybox walls keep at most up
 * to 0.4 m under a flight crossing them), and nobody below fits under it.
 */
const BODY_TOP_M = 1.7;
/** How far under a joined floor the wall along its lower-floor cut stops (as greybox walls under a flight). */
const UNDER_GAP_M = 0.4;
/** Within 1 mm of a ring's outline: a cut's boundary after the union's clipping. */
const onRing = (p: PlanPoint, ring: readonly PlanPoint[]): boolean =>
  ring.some((a, i) => { const c = closestOnSegment(p, a, ring[(i + 1) % ring.length]!); return Math.hypot(c.x - p.x, c.z - p.z) <= WALL_TOLERANCE_M; });
const MIN_CUT_AREA_M2 = 1e-6;

/** One convex piece of a region (a strip segment, or a whole disc, rect or connector) and its floor height. */
/**
 * Pieces of one walk less than the clearance apart in height where they overlap in plan (a bend, whose patch can stand
 * a metre off a steep leg's next segment): exempt from height conflicts and stack cuts. Only a pass of the walk over
 * itself at walking clearance or more is judged like any two pieces.
 */
function sameWalk(a: Piece, b: Piece): boolean {
  if (a.group === undefined || a.group !== b.group) return false;
  const overlap = convexIntersection(a.ring, b.ring);
  if (Math.abs(ringArea(overlap)) <= MIN_CUT_AREA_M2) return true;
  // Linear over the convex overlap: the gap nearest zero is at a vertex, or zero where it changes sign.
  const gaps = overlap.map((p) => a.height(p) - b.height(p));
  return Math.min(...gaps) <= 0 && Math.max(...gaps) >= 0 ? true : Math.min(...gaps.map(Math.abs)) < CLEARANCE_M;
}

type Piece = { region: number; segment: number; level: string; group: string | undefined; kind: Region["kind"]; ring: PlanPoint[]; box: Box; low: number; high: number; height: (p: PlanPoint) => number; source: HeightSource };

function regionPieces(region: Region, index: number): Piece[] {
  const polygons = regionPolygon(region);
  if (region.kind !== "strip") {
    const ring = polygons[0]?.[0];
    if (!ring) return [];
    const y = region.kind === "rect" ? region.center.y : region.y;
    return [{ region: index, segment: 0, level: region.level, group: region.group, kind: region.kind, ring, box: boxOf(polygons), low: y, high: y, height: () => y, source: heightSource(region) }];
  }
  const pieces: Piece[] = [];
  if (region.halfWidth <= 0) return pieces;
  for (let i = 1; i < region.points.length; i++) {
    const a = region.points[i - 1]!, b = region.points[i]!, dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
    if (length2 < 1e-18) continue;
    const segment: Region = { ...region, points: [a, b] };
    const own = regionPolygon(segment);
    pieces.push({
      region: index, segment: i, level: region.level, group: region.group, kind: "strip", ring: own[0]![0]!, box: boxOf(own), low: Math.min(a.y, b.y), high: Math.max(a.y, b.y),
      height: (p) => a.y + (b.y - a.y) * ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2, source: heightSource(segment),
    });
  }
  return pieces;
}

const ringArea = (ring: readonly PlanPoint[]): number => {
  let area = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; area += a.x * b.z - b.x * a.z; }
  return area / 2;
};

/** The part of a convex ring where `f` (linear in plan) is at least 0. */
function clipHalf(ring: readonly PlanPoint[], f: (p: PlanPoint) => number): PlanPoint[] {
  const out: PlanPoint[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!, q = ring[(i + 1) % ring.length]!, fp = f(p), fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t }); }
  }
  return out;
}

function convexIntersection(a: readonly PlanPoint[], b: readonly PlanPoint[]): PlanPoint[] {
  const sign = Math.sign(ringArea(b)) || 1;
  let out: PlanPoint[] = [...a];
  for (let i = 0; i < b.length && out.length >= 3; i++) {
    const c = b[i]!, d = b[(i + 1) % b.length]!;
    out = clipHalf(out, (p) => sign * ((d.x - c.x) * (p.z - c.z) - (d.z - c.z) * (p.x - c.x)));
  }
  return out.length >= 3 ? out : [];
}

/** Every pair of indices whose boxes overlap, by a sweep along x. */
function boxPairs(boxes: readonly Box[], visit: (i: number, j: number) => void): void {
  const order = boxes.map((_box, i) => i).sort((i, j) => boxes[i]!.minX - boxes[j]!.minX);
  for (let k = 0; k < order.length; k++) {
    const i = order[k]!;
    for (let m = k + 1; m < order.length && boxes[order[m]!]!.minX <= boxes[i]!.maxX; m++) if (overlaps(boxes[i]!, boxes[order[m]!]!)) visit(i, order[m]!);
  }
}

/**
 * Splits a level by height: pieces that overlap in plan more than a step apart in height all over the overlap (one
 * floorId passing over itself) never share a union. Pieces join their neighbours' level unless that level already holds a piece they
 * overlap at another height; a level without such a crossing stays whole, under its own name.
 */
function splitByHeight(pieces: readonly Piece[], stepM: number): string[] {
  const keys = pieces.map((piece) => piece.level);
  const byLevel = new Map<string, number[]>();
  pieces.forEach((piece, i) => { const list = byLevel.get(piece.level); if (list) list.push(i); else byLevel.set(piece.level, [i]); });
  for (const [level, list] of byLevel) {
    const neighbours = new Map<number, number[]>(), conflicts = new Map<number, number[]>();
    const add = (map: Map<number, number[]>, i: number, j: number) => { const l = map.get(i); if (l) l.push(j); else map.set(i, [j]); };
    boxPairs(list.map((i) => pieces[i]!.box), (u, v) => {
      const i = list[u]!, j = list[v]!, a = pieces[i]!, b = pieces[j]!;
      if (sameWalk(a, b)) { add(neighbours, i, j); add(neighbours, j, i); return; }
      // Heights are linear on each piece, so over their (convex) overlap the gap is extreme at its vertices; pieces
      // that only touch (a strip's next segment) are judged by their height ranges.
      const rangesApart = a.low > b.high + stepM || b.low > a.high + stepM;
      // Two level pieces within a step of each other are neighbours wherever they overlap.
      if (!rangesApart && a.low === a.high && b.low === b.high) { add(neighbours, i, j); add(neighbours, j, i); return; }
      const overlap = convexIntersection(a.ring, b.ring);
      const gaps = Math.abs(ringArea(overlap)) > MIN_CUT_AREA_M2 ? overlap.map((p) => a.height(p) - b.height(p)) : null;
      const apart = gaps ? Math.min(...gaps) > stepM || Math.max(...gaps) < -stepM : rangesApart;
      // Pieces only touching more than a step apart (a passage alongside another one floor up) conflict too: their
      // shared side is a drop, not a way across.
      if (!apart) { add(neighbours, i, j); add(neighbours, j, i); }
      else { add(conflicts, i, j); add(conflicts, j, i); }
    });
    if (!conflicts.size) continue;
    const cluster = new Map<number, number>();
    let next = 0;
    for (const start of list) {
      if (cluster.has(start)) continue;
      const c = next++, queue = [start];
      cluster.set(start, c);
      while (queue.length) {
        for (const q of neighbours.get(queue.pop()!) ?? []) {
          if (cluster.has(q) || (conflicts.get(q) ?? []).some((r) => cluster.get(r) === c)) continue;
          cluster.set(q, c);
          queue.push(q);
        }
      }
    }
    for (const i of list) { const c = cluster.get(i)!; if (c > 0) keys[i] = `${level}#${c}`; }
  }
  return keys;
}

/** Plan rings a region piece loses, keyed `${region}:${segment}` (strip segments by their end point's index). */
export type PieceCuts = Map<string, PlanPoint[][]>;

const SNAP_M = 1e-4;

/**
 * polygon-clipping's difference, retried once with every coordinate snapped to 0.1 mm when it throws on nearly shared
 * edges; null when that fails too.
 */
function difference(subject: readonly PlanPolygon[], cuts: readonly PlanPoint[][]): PlanPolygon[] | null {
  for (const snap of [(v: number) => v, (v: number) => Math.round(v / SNAP_M) * SNAP_M]) {
    const toClipping = (polygon: PlanPolygon): Polygon => polygon.map((ring) => ring.map((p): [number, number] => [snap(p.x), snap(p.z)]));
    try {
      return polygonClipping.difference(subject.map(toClipping), ...cuts.map((ring) => toClipping([ring]))).map(fromClipping);
    } catch { /* retried snapped, then given up */ }
  }
  return null;
}

/** What is left of a plan ring outside every cut ring, as union polygons (the whole ring if clipping fails). */
export function subtractPlan(ring: readonly PlanPoint[], cuts: readonly PlanPoint[][]): PlanPolygon[] {
  const whole: PlanPolygon[] = [[ring.map((p) => ({ x: p.x, z: p.z }))]];
  return cuts.length ? difference(whole, cuts) ?? whole : whole;
}

/** Parameter intervals of the segment a→b that lie outside every convex cut ring. */
export function outsideIntervals(a: PlanPoint, b: PlanPoint, cuts: readonly PlanPoint[][]): [number, number][] {
  const inside: [number, number][] = [];
  for (const ring of cuts) {
    const sign = Math.sign(ringArea(ring)) || 1;
    let t0 = 0, t1 = 1;
    for (let i = 0; i < ring.length && t0 < t1; i++) {
      const c = ring[i]!, d = ring[(i + 1) % ring.length]!;
      const f = (p: PlanPoint) => sign * ((d.x - c.x) * (p.z - c.z) - (d.z - c.z) * (p.x - c.x));
      const fa = f(a), fb = f(b);
      if (fa < 0 && fb < 0) { t1 = t0; break; }
      if (fa < 0) t0 = Math.max(t0, fa / (fa - fb)); else if (fb < 0) t1 = Math.min(t1, fa / (fa - fb));
    }
    if (t1 - t0 > 1e-9) inside.push([t0, t1]);
  }
  inside.sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  let from = 0;
  for (const [t0, t1] of inside) { if (t0 > from + 1e-9) out.push([from, t0]); from = Math.max(from, t1); }
  if (from < 1 - 1e-9) out.push([from, 1]);
  return out;
}

/**
 * Union every region per level and emit the boundary walls the connector footprints and attachments leave.
 * With a step height, levels are also a stack: a level is split where it passes over itself, a floor loses the part
 * standing less than the 2.42 m clearance over another level (`slabCuts`, left out of its union and its walls), and
 * a floor's ceiling loses the part another level's floor stands in (`ceilingCuts`). Pieces that come within a step of
 * each other somewhere over their overlap meet there, and cut nothing.
 */
export function buildWalkableModel(
  regions: readonly Region[],
  isAttachment?: (wall: BoundaryWall, outside: { x: number; y: number; z: number }) => boolean,
  stepM = 0,
): { levels: Map<string, PlanPolygon[]>; walls: BoundaryWall[]; slabCuts: PieceCuts; ceilingCuts: PieceCuts } {
  const pieces = regions.flatMap(regionPieces);
  const keys = stepM > 0 ? splitByHeight(pieces, stepM) : pieces.map((piece) => piece.level);
  const slabCuts: PieceCuts = new Map(), ceilingCuts: PieceCuts = new Map();
  const cutsOf = (map: PieceCuts, piece: Piece) => { const key = `${piece.region}:${piece.segment}`; let l = map.get(key); if (!l) map.set(key, l = []); return l; };
  const levelCuts = new Map<string, PlanPoint[][]>();
  // Lower-floor cuts under a joined floor, with that floor's height: the walls along them stop under it.
  const undersOf = new Map<string, { ring: PlanPoint[]; over: (p: PlanPoint) => number }[]>();
  if (stepM > 0) {
    boxPairs(pieces.map((piece) => piece.box), (i, j) => {
      const a = pieces[i]!, b = pieces[j]!;
      if (sameWalk(a, b)) return;
      // Too far apart in height to cut anything, or two level pieces within a step (they meet).
      if (a.low - b.high >= CEILING_M || b.low - a.high >= CEILING_M) return;
      if (a.low === a.high && b.low === b.high && Math.abs(a.low - b.low) <= stepM) return;
      const overlap = convexIntersection(pieces[i]!.ring, pieces[j]!.ring);
      if (Math.abs(ringArea(overlap)) <= MIN_CUT_AREA_M2) return;
      // Pieces within a step of each other anywhere over their overlap join there (a ramp rising out of the floor
      // it starts on): that is a walk, so both floors stay whole, and only the lower ceiling the rising floor passes
      // under is cut. Pieces of one height cluster always join.
      const gaps = overlap.map((p) => pieces[i]!.height(p) - pieces[j]!.height(p));
      const join = keys[i] === keys[j] || (Math.min(...gaps) <= stepM && Math.max(...gaps) >= -stepM);
      for (const [upper, lower] of [[i, j], [j, i]] as const) {
        const up = pieces[upper]!, down = pieces[lower]!, rise = (p: PlanPoint) => up.height(p) - down.height(p);
        const above = clipHalf(overlap, (p) => rise(p) - stepM);
        if (above.length < 3 || Math.abs(ringArea(above)) <= MIN_CUT_AREA_M2) continue;
        const slab = join ? [] : clipHalf(above, (p) => CLEARANCE_M - rise(p));
        if (slab.length >= 3 && Math.abs(ringArea(slab)) > MIN_CUT_AREA_M2) {
          cutsOf(slabCuts, up).push(slab);
          const l = levelCuts.get(keys[upper]!); if (l) l.push(slab); else levelCuts.set(keys[upper]!, [slab]);
        }
        // A join keeps the rising floor whole; the floor it climbs over goes where no one standing fits under it. One
        // height cluster is one union, so there only the ceiling is cut.
        const under = join && keys[upper] !== keys[lower] ? clipHalf(clipHalf(overlap, (p) => rise(p) - BODY_TOP_M), (p) => CLEARANCE_M - rise(p)) : [];
        if (under.length >= 3 && Math.abs(ringArea(under)) > MIN_CUT_AREA_M2) {
          cutsOf(slabCuts, down).push(under);
          const l = levelCuts.get(keys[lower]!); if (l) l.push(under); else levelCuts.set(keys[lower]!, [under]);
          const u = undersOf.get(keys[lower]!), entry = { ring: under, over: up.height };
          if (u) u.push(entry); else undersOf.set(keys[lower]!, [entry]);
        }
        const ceiling = clipHalf(above, (p) => CEILING_M - rise(p));
        if (ceiling.length >= 3 && Math.abs(ringArea(ceiling)) > MIN_CUT_AREA_M2) cutsOf(ceilingCuts, down).push(ceiling);
      }
    });
  }
  const byLevel = new Map<string, Piece[]>();
  pieces.forEach((piece, i) => { const list = byLevel.get(keys[i]!); if (list) list.push(piece); else byLevel.set(keys[i]!, [piece]); });
  for (const region of regions) if (!byLevel.has(region.level) && ![...byLevel.keys()].some((key) => key.startsWith(`${region.level}#`))) byLevel.set(region.level, []);
  const levels = new Map<string, PlanPolygon[]>();
  const built: { level: string; key: string; union: PlanPolygon[]; box: Box; boxes: Box[]; sources: HeightSource[]; connectors: PlanPoint[][]; breakpoints: PlanPoint[] }[] = [];
  for (const [key, list] of byLevel) {
    if (!list.length) { levels.set(key, []); continue; }
    let union = unionRings(list.map((piece) => piece.ring));
    const cuts = levelCuts.get(key);
    if (cuts) {
      // A difference polygon-clipping cannot resolve keeps the level whole, and its floors with it.
      const cut = difference(union, cuts);
      if (cut) union = cut; else for (const piece of list) slabCuts.delete(`${piece.region}:${piece.segment}`);
    }
    levels.set(key, union);
    if (!union.length) continue;
    const connectors = list.filter((piece) => piece.kind === "connector").map((piece) => piece.ring);
    const breakpoints = list.filter((piece) => piece.kind === "strip").flatMap((piece) => piece.ring);
    built.push({ level: list[0]!.level, key, union, box: boxOf(union), boxes: union.map((polygon) => boxOf([polygon])), sources: list.map((piece) => piece.source), connectors, breakpoints });
  }
  const walls: BoundaryWall[] = [];
  for (const { level, key, union, sources, connectors, breakpoints } of built) {
    // A boundary where another level's floor carries on within a step of it (a ramp meeting the floor it climbs to)
    // is an attachment too; levels themselves never union, so floors stacked in plan keep their own outlines.
    // Each boundary edge checks only the other levels' polygons whose bounds reach its probes.
    const attachmentNear = (box: Box) => {
      const near = stepM > 0 ? built.filter((other) => other.key !== key && overlaps(other.box, box)).map((other) => ({
        polygons: other.union.filter((_polygon, k) => overlaps(other.boxes[k]!, box)),
        sources: other.sources.filter((source) => overlaps(source.box, box)),
      })).filter((other) => other.polygons.length) : [];
      return (wall: BoundaryWall, outside: { x: number; y: number; z: number }) => near.some((other) => pointInLevel(outside, other.polygons)
        && Math.abs(heightAtVertex(outside, other.sources) - outside.y) <= stepM) || !!isAttachment?.(wall, outside);
    };
    const own = boundaryWalls(union, sources, connectors, level, attachmentNear, breakpoints);
    // A wall along a cut under a joined floor stops UNDER_GAP_M under that floor, so a walker on it passes over the wall.
    for (const wall of own) {
      for (const { ring, over } of undersOf.get(key) ?? []) {
        const a = { x: wall.ax, z: wall.az }, b = { x: wall.bx, z: wall.bz };
        if (!onRing(a, ring) || !onRing(b, ring) || !onRing({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, ring)) continue;
        const top = Math.min(over(a), over(b)) - UNDER_GAP_M;
        wall.topY = wall.topY === undefined ? top : Math.min(wall.topY, top);
      }
    }
    walls.push(...own);
  }
  return { levels, walls, slabCuts, ceilingCuts };
}
