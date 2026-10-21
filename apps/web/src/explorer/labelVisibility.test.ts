import { describe, expect, it } from "vitest";
import { FLOOR_BAND_M, OcclusionSweep, labelState, onFocusFloor } from "./labelVisibility.ts";

describe("label visibility", () => {
  it("keeps every floor in focus in overview and only the walker's floor otherwise", () => {
    expect(onFocusFloor(-12, null)).toBe(true);
    expect(onFocusFloor(-6.2, -6)).toBe(true);
    expect(onFocusFloor(-6 + FLOOR_BAND_M, -6)).toBe(true);
    expect(onFocusFloor(-12, -6)).toBe(false);
    expect(onFocusFloor(0, -6)).toBe(false);
  });

  it("fades occluded labels and hides unselected labels on other floors", () => {
    expect(labelState({ occluded: false, onFocusFloor: true, selected: false })).toBe("shown");
    expect(labelState({ occluded: true, onFocusFloor: true, selected: false })).toBe("faded");
    expect(labelState({ occluded: false, onFocusFloor: false, selected: false })).toBe("hidden");
    expect(labelState({ occluded: true, onFocusFloor: false, selected: false })).toBe("hidden");
  });

  it("keeps the selected origin and destination readable through geometry and faded on other floors", () => {
    expect(labelState({ occluded: true, onFocusFloor: true, selected: true })).toBe("shown");
    expect(labelState({ occluded: false, onFocusFloor: false, selected: true })).toBe("faded");
    expect(labelState({ occluded: true, onFocusFloor: false, selected: true })).toBe("faded");
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
