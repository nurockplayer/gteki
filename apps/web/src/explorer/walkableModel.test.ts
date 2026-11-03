import { describe, expect, it, vi } from "vitest";
import polygonClipping from "polygon-clipping";
import { boundaryEdges, buildWalkableModel, regionPolygon, snapRing, unionRings, type BoundaryWall, type PlanPoint, type Region } from "./walkableModel.ts";

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
  describe("level stack", () => {
    const area = (polygons: PlanPoint[][][]) => polygons.reduce((sum, polygon) => sum + polygon.reduce((n, ring, k) => {
      let a = 0;
      for (let i = 0; i < ring.length; i++) { const p = ring[i]!, q = ring[(i + 1) % ring.length]!; a += p.x * q.z - q.x * p.z; }
      return n + (k === 0 ? 1 : -1) * Math.abs(a / 2);
    }, 0), 0);

    it("keeps two passages of one level apart where one passes 4 m over the other", () => {
      const regions = [
        strip("L", [{ x: -10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], 1),
        strip("L", [{ x: 0, y: 4, z: -10 }, { x: 0, y: 4, z: 10 }], 1),
      ];
      // Without a step height the level is one union: a plus outline, its crossing open.
      expect(buildWalkableModel(regions).walls).toHaveLength(12);
      const { levels, walls } = buildWalkableModel(regions, undefined, 0.45);
      expect([...levels.keys()].sort()).toEqual(["L", "L#1"]);
      expect(walls).toHaveLength(8);
      expect(walls.every((wall) => wall.level === "L")).toBe(true);
    });

    it("splits one edge where it loops back over itself 4 m up, and keeps its bends whole", () => {
      // One walk (one group): along the corridor at 0 m, up to 4 m, and back across its own start.
      const loop = { ...strip("L", [{ x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, { x: 20, y: 4, z: 10 }, { x: 10, y: 4, z: 10 }, { x: 10, y: 4, z: -10 }], 1), group: "e" };
      const { levels, walls } = buildWalkableModel([loop], undefined, 0.45);
      expect([...levels.keys()].sort()).toEqual(["L", "L#1"]);
      // The corridor at 0 m keeps both side walls straight through, under its own upper pass.
      for (const z of [-1, 1]) expect(walls.some((wall) => wall.level === "L" && Math.abs(wall.az - z) < 1e-9 && Math.abs(wall.bz - z) < 1e-9 && Math.abs(wall.ax - wall.bx) > 17)).toBe(true);
    });

    it("splits one edge whose long return ramp crosses its start near the top of the climb", () => {
      // The last segment climbs 0 → 4 m over 50 m and crosses the first segment about 3.8 m up: its whole range (0–4 m)
      // meets the first segment's, but not where they overlap.
      const loop = { ...strip("L", [{ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }, { x: 30, y: 0, z: 40 }, { x: 0, y: 4, z: 0 }], 1), group: "e" };
      expect([...buildWalkableModel([loop], undefined, 0.45).levels.keys()].sort()).toEqual(["L", "L#1"]);
    });

    it("keeps two passages of one level apart where they only touch side by side 4 m apart in height", () => {
      const { levels, walls } = buildWalkableModel([
        strip("L", [{ x: -5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }], 1),
        strip("L", [{ x: -5, y: 4, z: 2 }, { x: 5, y: 4, z: 2 }], 1),
      ], undefined, 0.45);
      expect(levels.size).toBe(2);
      // Each keeps its side along the shared line z = 1.
      expect(walls.filter((wall) => Math.abs(wall.az - 1) < 1e-9 && Math.abs(wall.bz - 1) < 1e-9 && Math.abs(wall.ax - wall.bx) > 9.9)).toHaveLength(2);
    });

    it("splits a ramp of the corridor's own level where it climbs over that corridor", () => {
      const { levels, walls } = buildWalkableModel([
        strip("L", [{ x: -10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], 1),
        strip("L", [{ x: -10, y: 0, z: -10 }, { x: 10, y: 0, z: -10 }], 1),
        strip("L", [{ x: 0, y: 0, z: -10 }, { x: 0, y: 8, z: 10 }], 1),
      ], undefined, 0.45);
      expect(levels.size).toBe(2);
      // The corridor at z = 0 keeps both side walls straight through, under the ramp at 4 m.
      for (const z of [-1, 1]) expect(walls.some((wall) => Math.abs(wall.az - z) < 1e-9 && Math.abs(wall.bz - z) < 1e-9 && Math.abs(wall.ax - wall.bx) > 19.9)).toBe(true);
    });

    it("cuts the floor standing less than the clearance over another level, and the lower ceiling under it", () => {
      const { levels, walls, slabCuts, ceilingCuts } = buildWalkableModel([
        strip("B", [{ x: -10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], 1),
        strip("A", [{ x: 0, y: 1.6, z: -10 }, { x: 0, y: 1.6, z: 10 }], 1),
      ], undefined, 0.45);
      expect(area(slabCuts.get("1:1")!.map((ring) => [ring]))).toBeCloseTo(4);
      expect(area(ceilingCuts.get("0:1")!.map((ring) => [ring]))).toBeCloseTo(4);
      expect(slabCuts.has("0:1")).toBe(false);
      // A loses the crossing (two pieces left) and closes each with a wall along B's sides; B is whole.
      expect(levels.get("A")).toHaveLength(2);
      expect(area(levels.get("A")!)).toBeCloseTo(36);
      expect(area(levels.get("B")!)).toBeCloseTo(40);
      expect(walls.filter((wall) => wall.level === "A" && Math.abs(Math.abs(wall.az) - 1) < 1e-9 && Math.abs(wall.bz - wall.az) < 1e-9)).toHaveLength(2);
    });

    it("keeps a floor with the clearance over another level, cutting only the lower ceiling it stands in", () => {
      for (const [y, ceiling] of [[2.5, true], [3, false]] as const) {
        const { slabCuts, ceilingCuts } = buildWalkableModel([
          strip("B", [{ x: -10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], 1),
          strip("A", [{ x: 0, y, z: -10 }, { x: 0, y, z: 10 }], 1),
        ], undefined, 0.45);
        expect(slabCuts.size).toBe(0);
        expect(ceilingCuts.has("0:1")).toBe(ceiling);
      }
    });

    it("cuts a sloped floor passing over another level where it is between a step and the clearance over it", () => {
      // A ramp from 0 m to 4 m over 20 m along z crosses B's 2 m width at 2 m: the whole overlap is under 2.42 m.
      const ramp = buildWalkableModel([
        strip("B", [{ x: -10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], 1),
        strip("R", [{ x: 0, y: 0, z: -10 }, { x: 0, y: 4, z: 10 }], 1),
      ], undefined, 0.45);
      expect(area(ramp.slabCuts.get("1:1")!.map((ring) => [ring]))).toBeCloseTo(4);
      // Rising out of B's floor, the ramp meets B over the overlap: both floors stay whole, as at a ramp's top landing;
      // only B's ceiling gives way where the ramp is more than a step up (z 0.125..1, x -1..1).
      const foot = buildWalkableModel([
        strip("B", [{ x: -10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], 1),
        strip("R", [{ x: 0, y: 0, z: -1 }, { x: 0, y: 4, z: 9 }], 1),
      ], undefined, 0.45);
      expect(foot.slabCuts.size).toBe(0);
      expect(area(foot.ceilingCuts.get("0:1")!.map((ring) => [ring]))).toBeCloseTo(1.75);
    });

    it("cuts the ceiling a ramp joining a corridor climbs under, and the corridor floor where no one fits under it", () => {
      // R runs along B's centreline from 0.3 m to 2.3 m over 30 m: one step-height meet at its foot joins them. B's
      // ceiling over the rest (x 2.25..30) would stand in the way of a walker on R; B's floor goes from 1.7 m under R
      // (x 21..30), R's stays whole.
      const { slabCuts, ceilingCuts, walls } = buildWalkableModel([
        strip("B", [{ x: -10, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }], 1),
        strip("R", [{ x: 0, y: 0.3, z: 0 }, { x: 30, y: 2.3, z: 0 }], 1),
      ], undefined, 0.45);
      expect([...slabCuts.keys()]).toEqual(["0:1"]);
      expect(area(slabCuts.get("0:1")!.map((ring) => [ring]))).toBeCloseTo(18);
      expect(area(ceilingCuts.get("0:1")!.map((ring) => [ring]))).toBeCloseTo(55.5);
      // B now ends across its width at x = 21 under R, with a wall there that stops 0.4 m under R (1.7 m there), so a
      // walker on R passes over it; B's own side walls keep their full height.
      const across = walls.filter((wall) => wall.level === "B" && Math.abs(wall.ax - 21) < 1e-6 && Math.abs(wall.bx - 21) < 1e-6);
      expect(across.reduce((sum, wall) => sum + Math.abs(wall.az - wall.bz), 0)).toBeCloseTo(2);
      for (const wall of across) for (const top of wall.topY!) expect(top).toBeCloseTo(1.3);
      const sides = walls.filter((wall) => wall.level === "B" && Math.abs(wall.az - wall.bz) < 1e-9);
      expect(sides.reduce((sum, wall) => sum + Math.abs(wall.ax - wall.bx), 0)).toBeGreaterThan(80);
      expect(sides.every((wall) => wall.topY === undefined)).toBe(true);
    });

    it("stops the merged wall across a corridor two side-by-side ramps climb over under both", () => {
      // Two ramps 3.2 m wide either side of B's centreline, 0.3 m → 2.3 m over x 0..30: their cuts meet at z = 0, and B's
      // end at x = 21 is one wall across both.
      const { walls } = buildWalkableModel([
        strip("B", [{ x: -10, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }], 1.3),
        strip("R", [{ x: 0, y: 0.3, z: -1.6 }, { x: 30, y: 2.3, z: -1.6 }], 1.6),
        strip("S", [{ x: 0, y: 0.3, z: 1.6 }, { x: 30, y: 2.3, z: 1.6 }], 1.6),
      ], undefined, 0.45);
      const across = walls.filter((wall) => wall.level === "B" && Math.abs(wall.ax - 21) < 1e-6 && Math.abs(wall.bx - 21) < 1e-6);
      expect(across.reduce((sum, wall) => sum + Math.abs(wall.az - wall.bz), 0)).toBeCloseTo(2.6);
      for (const wall of across) for (const top of wall.topY!) expect(top).toBeCloseTo(1.3);
    });

    it("keeps a long cut's wall stop rising with the floor over it", () => {
      // B rises 4%, R beside it 5% over B's edge (z 0.3..1.3): B's edge goes from x 140 (1.7 m under R) to x 212 (2.42 m).
      const { walls } = buildWalkableModel([
        strip("B", [{ x: 0, y: 0, z: 0 }, { x: 240, y: 9.6, z: 0 }], 1.3),
        strip("R", [{ x: 0, y: 0.3, z: 1.6 }, { x: 240, y: 12.3, z: 1.6 }], 1.3),
      ], undefined, 0.45);
      const along = walls.filter((wall) => wall.level === "B" && wall.topY && Math.abs(wall.az - wall.bz) < 1e-9 && Math.abs(wall.ax - wall.bx) > 60);
      expect(along.length).toBeGreaterThan(0);
      for (const wall of along) {
        // 0.4 m under R at each end and the middle, never under B's own floor there.
        const at = (x: number) => 0.3 + 12 * x / 240 - 0.4, mid = (wall.ax + wall.bx) / 2;
        expect(wall.topY!).toEqual([expect.closeTo(at(wall.ax), 5), expect.closeTo(at(mid), 5), expect.closeTo(at(wall.bx), 5)]);
        for (const [x, top] of [[wall.ax, wall.topY![0]], [wall.bx, wall.topY![2]]] as const) expect(top - 9.6 * x / 240).toBeGreaterThan(1.2);
      }
    });

    it("keeps a multi-segment ramp joining a corridor whole past its first segment", () => {
      // R rises out of B's floor (0.3 m) and climbs on over it in a second segment that starts 1 m up.
      const { slabCuts, walls } = buildWalkableModel([
        strip("B", [{ x: -10, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }], 1),
        strip("R", [{ x: 0, y: 0.3, z: 0 }, { x: 10, y: 1, z: 0 }, { x: 30, y: 2.3, z: 0 }], 1),
      ], undefined, 0.45);
      // Only B's floor gives way, from 1.7 m under R (x ≈ 20.8) to R's end; R is not cut anywhere.
      expect([...slabCuts.keys()]).toEqual(["0:1"]);
      expect(area(slabCuts.get("0:1")!.map((ring) => [ring]))).toBeCloseTo(2 * (30 - (10 + 0.7 / 1.3 * 20)), 4);
      expect(walls.some((wall) => wall.level === "B" && wall.topY !== undefined)).toBe(true);
    });

    it("joins a ramp that enters a corridor on a flat landing and crosses it again further up", () => {
      // R (one walk): a flat landing 0.3 m over B's floor that leaves B's footprint flat, then climbs outside it and
      // comes back across B 1.75 m up. Only the flat landing meets B within a step.
      const ramp = { ...strip("R", [{ x: -4, y: 0.3, z: 0 }, { x: 0, y: 0.3, z: 0 }, { x: 0, y: 0.3, z: 3 }, { x: 0, y: 1, z: 6 }, { x: 10, y: 1.5, z: 6 }, { x: 10, y: 2, z: -6 }], 1), group: "r" };
      const { slabCuts } = buildWalkableModel([strip("B", [{ x: -10, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }], 1), ramp], undefined, 0.45);
      // Joined: R keeps its floor where it crosses B; B gives way there instead (rise over 1.7 m).
      expect([...slabCuts.keys()]).toEqual(["0:1"]);
    });

    it("leaves the model unchanged without a step height", () => {
      const { slabCuts, ceilingCuts, levels } = buildWalkableModel([
        strip("B", [{ x: -10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], 1),
        strip("A", [{ x: 0, y: 1.6, z: -10 }, { x: 0, y: 1.6, z: 10 }], 1),
      ]);
      expect(slabCuts.size + ceilingCuts.size).toBe(0);
      expect(area(levels.get("A")!)).toBeCloseTo(40);
    });
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

describe("snapRing", () => {
  it("snaps two points a float hair apart to one double and drops the repeat, so no zero-length edge reaches the sweep", () => {
    // Rounding by multiplying with 1e-4 left these as -20.80120000000021 and -20.80119999999979: a 4e-13 m edge that
    // polygon-clipping's sweep line cannot find again.
    const ring = [{ x: -20.80120000000021, z: -436.1322 }, { x: -20.80119999999979, z: -436.1322 }, { x: -19, z: -436 }, { x: -19, z: -437 }];
    const snapped = snapRing(ring, 1e4);
    expect(snapped).toEqual([[-20.8012, -436.1322], [-19, -436], [-19, -437]]);
    expect(snapRing(ring, 0)).toHaveLength(4);
  });
});

describe("unionRings retry", () => {
  it("still unions a group when polygon-clipping throws on the first attempt, without moving its boundary", () => {
    const square = (x0: number, z0: number) => [{ x: x0, z: z0 }, { x: x0 + 2, z: z0 }, { x: x0 + 2, z: z0 + 2 }, { x: x0, z: z0 + 2 }];
    const spy = vi.spyOn(polygonClipping, "union").mockImplementationOnce(() => { throw new Error("Unable to find segment in SweepLine tree"); });
    try {
      const union = unionRings([square(100, -400), square(101, -400)]);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(union).toHaveLength(1);
      const xs = union[0]![0]!.map((p) => p.x), zs = union[0]![0]!.map((p) => p.z);
      expect([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]).toEqual([100, 103, -400, -398]);
    } finally { spy.mockRestore(); }
  });
});
