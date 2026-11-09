import { describe, expect, it } from "vitest";
import { minimapYield, type YieldRect } from "./minimapYield.ts";

describe("minimapYield", () => {
  it("holds an overlap for 0.6 seconds and ignores signs behind or beyond 15 m", () => {
    const map = { left: 0, right: 100, top: 0, bottom: 100 };
    const sign: YieldRect = { left: 50, right: 150, top: 50, bottom: 150, behind: false, distance: 15 };
    const state = { lastOverlap: -Infinity };
    expect(minimapYield([sign], map, 1, state)).toBe(true);
    expect(minimapYield([], map, 1.59, state)).toBe(true);
    expect(minimapYield([], map, 1.6, state)).toBe(false);
    sign.behind = true;
    expect(minimapYield([sign], map, 2, state)).toBe(false);
    sign.behind = false;
    sign.distance = 15.01;
    expect(minimapYield([sign], map, 2, state)).toBe(false);
  });
});
