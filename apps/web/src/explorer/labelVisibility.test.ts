import { describe, expect, it } from "vitest";
import { FLOOR_BAND_M, OCCLUDED_FADE_MAX_M, OcclusionSweep, labelState, onFocusFloor, type LabelOcclusion } from "./labelVisibility.ts";

describe("label visibility", () => {
  it("keeps every floor in focus in overview and only the walker's floor otherwise", () => {
    expect(onFocusFloor(-12, null)).toBe(true);
    expect(onFocusFloor(-6.2, -6)).toBe(true);
    expect(onFocusFloor(-6 + FLOOR_BAND_M, -6)).toBe(true);
    expect(onFocusFloor(-12, -6)).toBe(false);
    expect(onFocusFloor(0, -6)).toBe(false);
  });

  const at = (occluded: LabelOcclusion, distance: number, rest: { onFocusFloor?: boolean; selected?: boolean } = {}) =>
    labelState({ occluded, distance, onFocusFloor: true, selected: false, ...rest });

  it("shows unoccluded labels at any distance and fades geometry-occluded ones near the camera", () => {
    expect(at("none", 5)).toBe("shown");
    expect(at("none", OCCLUDED_FADE_MAX_M * 3)).toBe("shown");
    expect(at("geometry", 5)).toBe("faded");
    expect(at("geometry", OCCLUDED_FADE_MAX_M)).toBe("faded");
  });

  it("hides labels behind a sign, near or far: the sign carries its own text", () => {
    expect(at("sign", 1)).toBe("hidden");
    expect(at("sign", 6)).toBe("hidden");
    expect(at("sign", OCCLUDED_FADE_MAX_M * 3)).toBe("hidden");
  });

  it("hides geometry-occluded labels farther than OCCLUDED_FADE_MAX_M", () => {
    expect(at("geometry", OCCLUDED_FADE_MAX_M + 0.1)).toBe("hidden");
    expect(at("geometry", 95)).toBe("hidden");
  });

  it("hides unselected labels on other floors whatever blocks them", () => {
    for (const o of ["none", "geometry", "sign"] as const) expect(at(o, 5, { onFocusFloor: false })).toBe("hidden");
  });

  it("keeps the selected origin and destination readable through geometry and signs, faded on other floors", () => {
    for (const o of ["none", "geometry", "sign"] as const) {
      for (const distance of [5, OCCLUDED_FADE_MAX_M * 3]) {
        expect(at(o, distance, { selected: true })).toBe("shown");
        expect(at(o, distance, { selected: true, onFocusFloor: false })).toBe("faded");
      }
    }
  });
});

describe("occlusion sweep", () => {
  const drain = (sweep: OcclusionSweep, count: number, max = Infinity) => {
    const out: number[] = [];
    while (sweep.pending && out.length < max) out.push(sweep.take(count));
    return out;
  };

  it("has nothing to do until invalidated and stops after one full sweep", () => {
    const sweep = new OcclusionSweep();
    expect(sweep.pending).toBe(false);
    sweep.invalidate(10);
    expect(drain(sweep, 10, 4)).toEqual([0, 1, 2, 3]); // a frame's budget
    expect(drain(sweep, 10, 4)).toEqual([4, 5, 6, 7]);
    expect(drain(sweep, 10, 4)).toEqual([8, 9]);
    expect(sweep.pending).toBe(false);
  });

  it("continues round-robin from where it stopped when the view changes again", () => {
    const sweep = new OcclusionSweep();
    sweep.invalidate(5);
    drain(sweep, 5, 3);
    sweep.invalidate(5);
    expect(drain(sweep, 5)).toEqual([3, 4, 0, 1, 2]);
  });

  it("wraps a cursor left beyond a smaller, rebuilt label set", () => {
    const sweep = new OcclusionSweep();
    sweep.invalidate(10);
    drain(sweep, 10, 7);
    sweep.invalidate(3);
    expect(drain(sweep, 3)).toEqual([1, 2, 0]);
    sweep.invalidate(0);
    expect(drain(sweep, 0)).toEqual([]);
  });
});
