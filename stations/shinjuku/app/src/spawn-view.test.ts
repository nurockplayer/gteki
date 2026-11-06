import { describe, expect, it } from "vitest";
import { CAT_ARRIVAL, catArrivalRise } from "./spawn-view.ts";

// Cat arrival pose: eye 2.4 m behind and 0.8 m above the feet, looking slightly past the head.
const fovDeg = 62;
const aspect = 2;
const eye = { x: 0, y: -2.4, z: 0.8 };
const feet = { x: 0, y: 0, z: 0 };
const look = { x: 0, y: 1.15, z: 0.64 };
const heading = 0;
const tanV = Math.tan((fovDeg * Math.PI) / 360);
const L = Math.hypot(look.x - eye.x, look.y - eye.y);
const base = Math.atan2(look.z - eye.z, L);
const feetElevation = Math.atan2(feet.z - eye.z, Math.hypot(feet.x - eye.x, feet.y - eye.y));

function rise(boards: readonly { x: number; y: number; z: number }[]) {
  return catArrivalRise({ eye, look, feet, heading, boards, fovDeg, aspect });
}

/** Screen height of a point under the arrived camera, in NDC (positive is up). */
function ndcY(board: { x: number; y: number; z: number }, extraRise: number) {
  const elevation = Math.atan2(look.z + extraRise - eye.z, L);
  const pointElevation = Math.atan2(board.z - eye.z, Math.hypot(board.x - eye.x, board.y - eye.y));
  return Math.tan(pointElevation - elevation) / tanV;
}

describe("catArrivalRise", () => {
  it("rises until the nearest board ahead sits about boardNdc, with the feet still in frame", () => {
    const board = { x: 0, y: 0.6, z: 2.2 };
    const extra = rise([board]);
    expect(extra).toBeGreaterThan(0.1);
    expect(ndcY(board, extra)).toBeCloseTo(CAT_ARRIVAL.boardNdc, 6);
    expect(ndcY(feet, extra)).toBeGreaterThan(-CAT_ARRIVAL.feetNdc);
  });

  it("stops at the feetNdc cap when the board is too high", () => {
    const board = { x: 0, y: 0.6, z: 5 };
    const extra = rise([board]);
    const allowed = feetElevation + Math.atan(CAT_ARRIVAL.feetNdc * tanV);
    expect(extra).toBeCloseTo(eye.z + Math.tan(allowed) * L - look.z, 6);
    expect(ndcY(feet, extra)).toBeCloseTo(-CAT_ARRIVAL.feetNdc, 6);
    expect(ndcY(board, extra)).toBeGreaterThan(CAT_ARRIVAL.boardNdc);
  });

  it("keeps the view level with no board", () => {
    expect(rise([])).toBe(0);
  });

  it("ignores a board behind the cat", () => {
    expect(rise([{ x: 0, y: -5, z: 2 }])).toBe(0);
  });

  it("ignores a board beyond maxRangeM", () => {
    expect(rise([{ x: 0, y: CAT_ARRIVAL.maxRangeM + 1, z: 2 }])).toBe(0);
  });

  it("ignores a board on another floor", () => {
    expect(rise([{ x: 0, y: 0.6, z: CAT_ARRIVAL.maxFloorDiffM + 4 }])).toBe(0);
  });

  it("keeps the view level with a board already in frame", () => {
    expect(rise([{ x: 0, y: 0.6, z: 0 }])).toBe(0);
    expect(base).toBeLessThan(0);
  });
});
