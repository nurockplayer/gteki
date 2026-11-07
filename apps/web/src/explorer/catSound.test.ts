import { describe, expect, it } from "vitest";
import { PAW_STEP_M, advancePaws, pawSurface } from "./catSound.ts";

describe("pawSurface", () => {
  it("is stairs whenever the cat is on a stair span", () => {
    expect(pawSurface("concourse", true)).toBe("stairs");
    expect(pawSurface("outdoor", true)).toBe("stairs");
  });

  it("is pavement outdoors and tile everywhere else", () => {
    expect(pawSurface("outdoor", false)).toBe("pavement");
    expect(pawSurface("passage", false)).toBe("tile");
    expect(pawSurface("concourse", false)).toBe("tile");
    expect(pawSurface("platform", false)).toBe("tile");
  });
});

describe("advancePaws", () => {
  it("carries short moves until a whole step is due", () => {
    expect(advancePaws(0, PAW_STEP_M / 2)).toEqual({ carriedM: PAW_STEP_M / 2, steps: 0 });
    expect(advancePaws(PAW_STEP_M / 2, PAW_STEP_M / 2)).toEqual({ carriedM: 0, steps: 1 });
  });

  it("drops the whole steps out of a fast move and keeps the remainder", () => {
    const r = advancePaws(0, PAW_STEP_M * 2.4);
    expect(r.steps).toBe(2);
    expect(r.carriedM).toBeCloseTo(PAW_STEP_M * 0.4);
  });

  it("counts a carried step and a new one together", () => {
    const r = advancePaws(PAW_STEP_M * 0.9, PAW_STEP_M * 0.9);
    expect(r.steps).toBe(1);
    expect(r.carriedM).toBeCloseTo(PAW_STEP_M * 0.8);
  });
});
