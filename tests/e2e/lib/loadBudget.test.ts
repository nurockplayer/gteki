import { describe, expect, it, vi } from "vitest";
import { measureLoadBudget } from "./loadBudget.ts";

describe("measureLoadBudget", () => {
  it("does not remeasure under budget", async () => {
    const remeasure = vi.fn(async () => 1700);
    await expect(measureLoadBudget(1500, 1400, remeasure)).resolves.toEqual({ best: 1400, samples: [1400] });
    expect(remeasure).not.toHaveBeenCalled();
  });

  it("uses an under-budget second sample and reports both", async () => {
    const remeasure = vi.fn(async () => 1400);
    await expect(measureLoadBudget(1500, 1700, remeasure)).resolves.toEqual({ best: 1400, samples: [1700, 1400] });
    expect(remeasure).toHaveBeenCalledOnce();
  });

  it("keeps the smaller sample when both are over budget", async () => {
    await expect(measureLoadBudget(1500, 1700, async () => 1600)).resolves.toEqual({ best: 1600, samples: [1700, 1600] });
  });

  it("does not remeasure a NaN first sample", async () => {
    const remeasure = vi.fn(async () => 1200);
    const result = await measureLoadBudget(1500, NaN, remeasure);
    expect(result.samples).toHaveLength(1);
    expect(Number.isNaN(result.best)).toBe(true);
    expect(remeasure).not.toHaveBeenCalled();
  });
});
