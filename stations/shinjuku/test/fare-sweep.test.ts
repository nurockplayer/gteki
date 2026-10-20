import type { StationBundle } from "@gteki/schema";
import type { Layout, Plan, XY } from "../scene/layout.ts";
import { describe, expect, it } from "vitest";
import {
  audit,
  continuousBoundaries,
  BodySweep,
  explorerBands,
  laneBands,
  proxyGround,
  segmentDistance2,
} from "./fare-boundary-audit.ts";

describe("fare audit swept-body collision", () => {
  it("detects radius grazing, diagonal corner cutting, and exact segment intersections", () => {
    const sweep = new BodySweep([
      { a: { x: 0, y: 0 }, b: { x: 0, y: 2 }, min: -0.1, max: 0.1 },
    ]);
    expect(
      sweep.blocked({ x: -0.29, y: -1, z: 0 }, { x: -0.29, y: 3, z: 0 }),
    ).toBe(true);
    expect(
      sweep.blocked({ x: -0.31, y: -1, z: 0 }, { x: -0.31, y: 3, z: 0 }),
    ).toBe(false);
    expect(
      sweep.blocked({ x: -0.25, y: -0.25, z: 0 }, { x: 0.25, y: 0.25, z: 0 }),
    ).toBe(true);
    expect(
      segmentDistance2(
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: -1 },
        { x: 0, y: 1 },
      ),
    ).toBe(0);
  });
  it("clips sloping movements to the active body band", () => {
    const sweep = new BodySweep([
      { a: { x: 0, y: -1 }, b: { x: 0, y: 1 }, min: 0, max: 0.3 },
    ]);
    expect(sweep.blocked({ x: -1, y: 0, z: -1 }, { x: 1, y: 0, z: 1 })).toBe(
      true,
    );
    expect(sweep.blocked({ x: -1, y: 0, z: 1 }, { x: 1, y: 0, z: 2 })).toBe(
      false,
    );
  });
  it("respects lane body limits and the explorer's already folded wall bands", () => {
    const wall = {
      a: { x: 0, y: -1 },
      b: { x: 0, y: 1 },
      zMin: -1,
      zMax: 3,
      bodyMin: 0,
      bodyMax: 0.4,
      kind: "wall" as const,
      side: 1 as const,
    };
    const a = new BodySweep(laneBands([wall])),
      b = new BodySweep(explorerBands([{ ...wall, zMin: 1.7, zMax: 0.6 }]));
    for (const sweep of [a, b]) {
      expect(
        sweep.blocked({ x: -1, y: 0, z: 0.2 }, { x: 1, y: 0, z: 0.2 }),
      ).toBe(true);
      expect(
        sweep.blocked({ x: -1, y: 0, z: 0.5 }, { x: 1, y: 0, z: 0.5 }),
      ).toBe(false);
      expect(
        sweep.blocked({ x: -1, y: 0, z: -0.2 }, { x: 1, y: 0, z: -0.2 }),
      ).toBe(false);
    }
  });
  it("uses highest ground within the explorer step limits, without jumping to another floor", () => {
    const rings = [
      [
        { x: -1, y: -1 },
        { x: 1, y: -1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 },
      ],
    ];
    const ground = proxyGround(
      [0, 0.4, 3].map((z) => ({ rings, height: () => z })),
    );
    expect(ground({ x: 0, y: 0 }, 0)).toBe(0.4);
    expect(ground({ x: 0, y: 0 }, 2)).toBe(null);
    expect(ground({ x: 0, y: 0 }, 3.8)).toBe(3);
  });
});

describe("fare audit refuses physical bypasses", () => {
  const rectangle = (x0: number, x1: number): XY[][] => [
    [
      { x: x0, y: -2 },
      { x: x1, y: -2 },
      { x: x1, y: 2 },
      { x: x0, y: 2 },
    ],
  ];
  const plan = {
    levels: [
      {
        label: "test",
        floorId: "test",
        ordinal: 0,
        renderElevationM: 0,
        outline: [],
        facilities: [],
        spaces: [
          {
            id: "paid-space",
            category: "B029",
            restricted: false,
            toll: "paid",
            rings: rectangle(-2, 0),
          },
          {
            id: "free-space",
            category: "B029",
            restricted: false,
            toll: "free",
            rings: rectangle(0, 2),
          },
        ],
      },
    ],
    nodeRenderZ: {},
    attribution: [],
  } as Plan;
  const layout = {
    levels: [{ label: "test", z: 0 }],
    pads: [],
    linkStrips: [],
    streetPads: [],
    runs: [],
    gates: [
      {
        edgeId: "gate",
        center: { x: 0, y: 0, z: 0 },
        dir: { x: 1, y: 0 },
        width: 1.8,
      },
    ],
    nodeZ: new Map(),
  } as unknown as Layout;
  const bundle = { nodes: [], edges: [] } as unknown as StationBundle;
  const machines = [-0.62, 0.62].map((y) => ({
    a: { x: -0.75, y },
    b: { x: 0.75, y },
    min: -1.7,
    max: 1,
  }));
  const fence = (a: number, b: number) => ({
    a: { x: 0, y: a },
    b: { x: 0, y: b },
    min: -1.7,
    max: 1,
  });
  const run = (bands: typeof machines, props = machines) =>
    audit(
      {
        name: "fixture",
        patches: [{ rings: rectangle(-2, 2), height: () => 0 }],
        bands,
        propBands: props,
        up: 0.45,
        down: 0.7,
        ground: () => 0,
      },
      layout,
      plan,
      bundle,
    );
  it("accepts the verified aisle, with sealed borders on either side", () => {
    expect(run([...machines, fence(-2, -0.62), fence(0.62, 2)]).leaks).toEqual(
      [],
    );
  });
  it("reports every bypass outside the machines even inside the gate's 1 m line corridor", () => {
    const result = run([...machines, fence(-2, -0.62)]);
    expect(result.leaks.length).toBeGreaterThan(0);
    expect(
      result.leaks.every(
        (l) =>
          l.paidSpace === "paid-space" &&
          l.freeSpace === "free-space" &&
          l.level === "test",
      ),
    ).toBe(true);
  });
  it.each([.63, .6001])("detects a %.4f m off-lattice opening continuously", width => {
    // Reviewer fixture: no .25 m lattice centre fits, but y=.25 crosses freely.
    // Also exercise a nearly tangent gap that no practical uniform refinement can resolve.
    const low = .25 - width / 2, high = .25 + width / 2;
    const bands = [fence(-2, low), fence(high, 2)];
    const sweep = new BodySweep(bands);
    expect(sweep.blocked({ x: -1, y: .25, z: 0 }, { x: 1, y: .25, z: 0 })).toBe(false);
    const result = run(bands, []);
    expect(result.paidSeeds).toBe(112);
    expect(result.leaks).toEqual(expect.arrayContaining([expect.objectContaining({ level: "test", paidSpace: "paid-space", freeSpace: "free-space" })]));
  });
  it("detects off-lattice unmapped floor without relying on a paid seed", () => {
    const result = continuousBoundaries({
      name: "access fixture", patches: [{ rings: [[{ x: .01, y: .01 }, { x: .04, y: .01 }, { x: .04, y: .04 }, { x: .01, y: .04 }]], height: () => 0 }],
      bands: [], up: .45, down: .7, ground: () => 0,
    }, { ...layout, gates: [] }, { ...plan, levels: [{ ...plan.levels[0]!, spaces: [] }] });
    expect(result.unmapped.length).toBeGreaterThan(0);
  });
  it("does not authorize a passage with no physical gate machines", () => {
    expect(run([], []).leaks.length).toBeGreaterThan(0);
  });
});
