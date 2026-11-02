import { describe, expect, it } from "vitest";
import { boundaryEdges, buildWalkableModel, regionPolygon, type BoundaryWall, type PlanPoint, type Region } from "./walkableModel.ts";

const at = (x: number, z: number): PlanPoint => ({ x, z });
const strip = (level: string, points: { x: number; y: number; z: number }[], halfWidth: number): Region => ({ kind: "strip", level, points, halfWidth });
const wallStart = (wall: BoundaryWall): PlanPoint => at(wall.ax, wall.az);
const wallEnd = (wall: BoundaryWall): PlanPoint => at(wall.bx, wall.bz);

function cross(a: PlanPoint, b: PlanPoint, c: PlanPoint): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

/** A proper crossing only: touching at an endpoint (a strip's own end cap) is not one. */
function properlyCrosses(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint): boolean {
  const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

const length = (wall: BoundaryWall): number => Math.hypot(wall.bx - wall.ax, wall.bz - wall.az);

describe("walkable model", () => {
  it("keeps only the union outline where two strips cross", () => {
    const { walls } = buildWalkableModel([
      strip("L1", [{ x: -10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], 2),
      strip("L1", [{ x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 10 }], 2),
    ]);
    const centrelines: [PlanPoint, PlanPoint][] = [
      [at(-10, 0), at(10, 0)],
      [at(0, -10), at(0, 10)],
    ];
    for (const wall of walls) for (const [a, b] of centrelines) {
      expect(properlyCrosses(wallStart(wall), wallEnd(wall), a, b)).toBe(false);
    }
    // A plus has twelve outline edges, and no wall in its middle.
    expect(walls).toHaveLength(12);
  });

  it("leaves the T mouth open where a strip ends at a disc on another strip", () => {
    const { walls } = buildWalkableModel([
      strip("L1", [{ x: -10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], 2),
      strip("L1", [{ x: 0, y: 0, z: 6 }, { x: 0, y: 0, z: 0 }], 1.5),
      { kind: "disc", level: "L1", x: 0, y: 0, z: 0, radius: 3 },
    ]);
    for (const wall of walls) {
      expect(properlyCrosses(wallStart(wall), wallEnd(wall), at(0, 0), at(0, 6))).toBe(false);
    }
  });

  it("drops the shared side where a connector meets a strip, keeping the rest of it", () => {
    const { walls } = buildWalkableModel([
      strip("L1", [{ x: -5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }], 2),
      { kind: "connector", level: "L1", quad: [at(-1, 2), at(1, 2), at(1, 5), at(-1, 5)], y: 0 },
    ]);
    const onSide = walls.filter((wall) => Math.abs((wall.az + wall.bz) / 2 - 2) <= 1e-3);
    for (const wall of onSide) {
      const middle = (wall.ax + wall.bx) / 2;
      expect(middle <= -1 - 1e-3 || middle >= 1 + 1e-3).toBe(true);
    }
    expect(onSide.some((wall) => (wall.ax + wall.bx) / 2 < -1)).toBe(true);
    expect(onSide.some((wall) => (wall.ax + wall.bx) / 2 > 1)).toBe(true);
  });

  it("removes an end cap only when isAttachment accepts it, probing 0.3 m outside", () => {
    const regions = [strip("L1", [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }], 2)];
    const cap = (wall: BoundaryWall): boolean => Math.abs(wall.ax - 5) < 1e-6 && Math.abs(wall.bx - 5) < 1e-6;

    const { walls: closed } = buildWalkableModel(regions);
    expect(closed.some(cap)).toBe(true);

    let outside: { x: number; y: number; z: number } | undefined;
    const { walls: open } = buildWalkableModel(regions, (wall, point) => {
      if (!cap(wall)) return false;
      outside = point;
      return true;
    });
    expect(open.some(cap)).toBe(false);
    expect(outside!.x).toBeCloseTo(5.3);
    expect(outside!.y).toBeCloseTo(0);
    // The 4 m cap is probed in pieces of at most 2 m, each at its own midpoint.
    expect(Math.abs(outside!.z)).toBeLessThan(2);
  });

  it("keeps each level's own full outline when levels overlap in plan", () => {
    const { levels, walls } = buildWalkableModel([
      strip("L1", [{ x: -5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }], 2),
      strip("L2", [{ x: -5, y: 4, z: 0 }, { x: 5, y: 4, z: 0 }], 2),
    ]);
    expect(levels.size).toBe(2);
    for (const [level, y] of [["L1", 0], ["L2", 4]] as const) {
      const polygons = levels.get(level)!;
      expect(polygons).toHaveLength(1);
      expect(polygons[0]![0]).toHaveLength(4);
      const own = walls.filter((wall) => wall.level === level);
      expect(own).toHaveLength(4);
      for (const wall of own) {
        expect(wall.ay).toBeCloseTo(y);
        expect(wall.by).toBeCloseTo(y);
      }
    }
  });

  it("never emits a wall shorter than 1e-3 m", () => {
    const { walls } = buildWalkableModel([
      // The tiny second segment leaves a 0.5 mm tongue; its cap must not become a wall.
      strip("L1", [{ x: -5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, { x: 5, y: 0, z: 0.0005 }], 2),
    ]);
    expect(walls.length).toBeGreaterThan(0);
    for (const wall of walls) expect(length(wall)).toBeGreaterThanOrEqual(1e-3 - 1e-9);
  });

  it("polygonises a strip as one quad per segment", () => {
    expect(regionPolygon(strip("L1", [{ x: 0, y: 0, z: 0 }, { x: 4, y: 1, z: 0 }], 1))).toEqual([[
      [{ x: 0, z: 1 }, { x: 4, z: 1 }, { x: 4, z: -1 }, { x: 0, z: -1 }],
    ]]);
  });
});

describe("boundaryEdges", () => {
  it("drops an edge that an open segment runs past at both ends", () => {
    const ring: PlanPoint[] = [{ x: 1, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 1 }, { x: 1, z: 1 }];
    const edges = boundaryEdges([[ring]], [[{ x: 0, z: 0 }, { x: 3, z: 0 }]]);
    expect(edges).toHaveLength(3);
    expect(edges.some(([a, b]) => Math.abs(a.z) < 1e-9 && Math.abs(b.z) < 1e-9)).toBe(false);
  });
});
