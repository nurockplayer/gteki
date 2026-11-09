import { describe, expect, it } from "vitest";
import { pawShadowState } from "./contactShadow.ts";

describe("pawShadowState", () => {
  it("fades from contact to a raised paw", () => {
    expect(pawShadowState(2, 2)).toBe(0.5);
    expect(pawShadowState(2.01, 2)).toBeCloseTo(0.5);
    expect(pawShadowState(2.035, 2)).toBeCloseTo(0.25);
    expect(pawShadowState(2.06, 2)).toBeCloseTo(0);
    expect(pawShadowState(2.1, 2)).toBe(0);
  });
});
