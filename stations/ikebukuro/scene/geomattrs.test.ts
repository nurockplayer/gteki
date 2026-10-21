import { describe, expect, it } from "vitest";
import { NO_FLOOR, NO_NOSE, buildFloorIndex, floorYFor, noseDistances, wallFloorAttribute } from "./geomattrs.ts";

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
});

describe("wallFloorAttribute", () => {
  /** Vertical quad along +x at z, from y0 to y1, as an indexed pair of triangles. */
  const wallQuad = (x0: number, x1: number, z: number, y0: number, y1: number) => ({
    pos: [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z],
    idx: [0, 1, 2, 0, 2, 3],
  });

  it("measures a wall spanning stacked floors from its base, not from each vertex's own elevation", () => {
    // lower floor 26.24 and an upper floor 32.25 both under the wall; the wall runs 26.24..32.246
    const floors = buildFloorIndex([...quad(0, -2, 10, 2, 26.24), ...quad(0, -2, 10, 2, 32.25)]);
    const { pos, idx } = wallQuad(1, 4, 0, 26.24, 32.246);
    const f = wallFloorAttribute(pos, idx, floors);
    expect([...f].map((v) => Math.round(v * 100) / 100)).toEqual([26.24, 26.24, 26.24, 26.24]);
  });

  it("starts a separate patch on its own floor", () => {
    const floors = buildFloorIndex([...quad(0, -2, 10, 2, 26.24), ...quad(0, -2, 10, 2, 32.25)]);
    const lower = wallQuad(1, 4, 0, 26.24, 29.0), upper = wallQuad(1, 4, 0, 32.25, 35.0);
    const pos = [...lower.pos, ...upper.pos], idx = [...lower.idx, ...upper.idx.map((i) => i + 4)];
    const f = wallFloorAttribute(pos, idx, floors);
    expect(f[0]).toBeCloseTo(26.24);
    expect(f[4]).toBeCloseTo(32.25);
    expect(f[6]).toBeCloseTo(32.25);
  });

  it("never mixes resolved and unresolved vertices in one triangle", () => {
    // floor only under x < 2: the vertical edge at x = 5 finds none, the one at x = 1 does
    const floors = buildFloorIndex(quad(0, -2, 2, 2, 27.9));
    const { pos, idx } = wallQuad(1, 5, 0, 27.9, 30.9);
    const f = wallFloorAttribute(pos, idx, floors);
    expect([...f].every((v) => v === NO_FLOOR) || [...f].every((v) => v !== NO_FLOOR)).toBe(true);
    expect(f[0]).toBeCloseTo(27.9);
    expect(f[1]).toBeCloseTo(27.9); // filled from the resolved neighbour
  });

  it("stays unresolved when nothing in the patch finds a floor", () => {
    const floors = buildFloorIndex(quad(50, 50, 52, 52, 27.9));
    const { pos, idx } = wallQuad(1, 4, 0, 27.9, 30.9);
    expect([...wallFloorAttribute(pos, idx, floors)].every((v) => v === NO_FLOOR)).toBe(true);
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

  it("keeps true distances beyond 1 m so a deep landing does not widen the strip", () => {
    // one deep tread (1.511 m) with its nose riser
    const pos = new Float32Array([0, 30, 0, 0, 30, 1, 1.511, 30, 1, 1.511, 30, 0, 1.511, 30, 0, 1.511, 30, 1, 1.511, 29.84, 1, 1.511, 29.84, 0]);
    const d = noseDistances(pos, [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    // nose edge is the +x side (riser hangs there); back edge is 1.511 m away
    expect(d[2]).toBeCloseTo(0, 3);
    expect(d[0]).toBeCloseTo(1.511, 3);
    expect(d[1]).toBeCloseTo(1.511, 3);
  });

  it("leaves risers and landings without a nose", () => {
    const { pos, index } = flight();
    const d = noseDistances(pos, index);
    for (let k = 0; k < 3; k++) for (let i = 4; i < 8; i++) expect(d[k * 8 + i]).toBe(NO_NOSE);
    const landing = new Float32Array(quad(0, 0, 2, 2, 30));
    expect([...noseDistances(landing, null)].every((v) => v === NO_NOSE)).toBe(true);
  });
});
