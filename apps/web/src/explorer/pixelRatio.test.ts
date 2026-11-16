import { describe, expect, it } from "vitest";
import { pixelRatioCap } from "./pixelRatio.ts";

describe("pixelRatioCap", () => {
  it.each([
    ["", 1.5],
    ["dpr=1", 1],
    ["dpr=0.2", 0.5],
    ["dpr=3", 1.5],
    ["dpr=abc", 1.5],
    ["dpr=", 1.5],
    ["dpr=-1", 1.5],
  ])("caps %s at %s", (query, expected) => {
    expect(pixelRatioCap(new URLSearchParams(query))).toBe(expected);
  });
});
