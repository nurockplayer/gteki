import { describe, expect, it } from "vitest";
import { NO_FLOOR, NO_NOSE, buildFloorIndex, floorYAttribute, floorYFor, noseDistances } from "./geomattrs.ts";

/** Axis-aligned horizontal quad at height y as two triangles (counter-clockwise seen from above). */
function quad(x0: number, z0: number, x1: number, z1: number, y: number): number[] {
  return [x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0];
}

describe("floorYFor", () => {
  // Two levels side by side: x < 5 at 27.9 m, x >= 5 at 26.0 m, plus an overlying street floor at 32.5.
  const tris = [...quad(0, 0, 5, 10, 27.9), ...quad(5, 0, 10, 10, 26.0), ...quad(0, 0, 10, 10, 32.5)];
  const idx = buildFloorIndex(tris);

  it("finds the floor under a point, not the one above it", () => {
    expect(floorYFor(idx, 2, 30.5, 5)).toBeCloseTo(27.9);
    expect(floorYFor(idx, 7, 29, 5)).toBeCloseTo(26.0);
    expect(floorYFor(idx, 2, 33.5, 5)).toBeCloseTo(32.5);
  });

  it("measures from the local floor for a wall vertex standing on the boundary", () => {
    // bottom vertex of a wall exactly on the step between the levels, standing on the high side
    expect(floorYFor(idx, 5, 27.9, 5)).toBeCloseTo(27.9);
    // top of the same wall (3 m up) still resolves to the floor beneath it
    expect(floorYFor(idx, 5, 30.9, 5)).toBeCloseTo(27.9);
  });

  it("returns NO_FLOOR off the floor so the shader can fall back", () => {
    expect(floorYFor(idx, 50, 28, 50)).toBe(NO_FLOOR);
    expect(floorYFor(idx, 2, 20, 5)).toBe(NO_FLOOR);
  });

  it("ignores vertical triangles", () => {
    const wall = [0, 0, 0, 0, 3, 0, 4, 3, 0];
    expect(buildFloorIndex(wall).below(1, 0, 10)).toBeNaN();
  });

  it("fills an attribute per vertex", () => {
    const a = floorYAttribute([2, 28.5, 5, 7, 26.5, 5, 99, 28, 99], idx);
    expect([...a].map((v) => Math.round(v * 10) / 10)).toEqual([27.9, 26, NO_FLOOR]);
  });
});

describe("noseDistances", () => {
  // Flight of 3 treads (0.3 m deep, 1 m wide) descending toward +x, risers 0.16 m, hung from each tread's front edge.
  function flight() {
    const pos: number[] = [];
    const index: number[] = [];
    const add = (verts: number[][], tris: number[][]) => {
      const base = pos.length / 3;
      for (const v of verts) pos.push(...v);
      for (const t of tris) index.push(...t.map((i) => base + i));
    };
    for (let k = 0; k < 3; k++) {
      const y = 30 - k * 0.16, x0 = k * 0.3, x1 = x0 + 0.3;
      // tread: nose at x1 (the riser hangs from it), back edge at x0. Verts: back0, back1, nose1, nose0
      add([[x0, y, 0], [x0, y, 1], [x1, y, 1], [x1, y, 0]], [[0, 1, 2], [0, 2, 3]]);
      // riser under the nose
      add([[x1, y, 0], [x1, y, 1], [x1, y - 0.16, 1], [x1, y - 0.16, 0]], [[0, 1, 2], [0, 2, 3]]);
    }
    return { pos: new Float32Array(pos), index };
  }

  it("is 0 on the nose edge and the tread depth at the back edge", () => {
    const { pos, index } = flight();
    const d = noseDistances(pos, index);
    for (let k = 0; k < 3; k++) {
      const t = k * 8; // first vertex of the tread
      expect(d[t]).toBeCloseTo(0.3, 3);
      expect(d[t + 1]).toBeCloseTo(0.3, 3);
      expect(d[t + 2]).toBeCloseTo(0, 3);
      expect(d[t + 3]).toBeCloseTo(0, 3);
    }
  });

  it("leaves risers and landings without a nose", () => {
    const { pos, index } = flight();
    const d = noseDistances(pos, index);
    for (let k = 0; k < 3; k++) for (let i = 4; i < 8; i++) expect(d[k * 8 + i]).toBe(NO_NOSE);
    const landing = new Float32Array(quad(0, 0, 2, 2, 30));
    expect([...noseDistances(landing, null)].every((v) => v === NO_NOSE)).toBe(true);
  });
});
