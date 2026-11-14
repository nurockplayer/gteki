import { describe, expect, it } from "vitest";
import { escalatorEtaSuffix } from "./escalatorEta.ts";

describe("escalatorEtaSuffix", () => {
  it.each([
    [0, ""],
    [2.9, ""],
    [3, " · ~5 s"],
    [7, " · ~5 s"],
    [12.4, " · ~10 s"],
    [60, " · ~60 s"],
  ])("formats %s seconds", (remainingSeconds, expected) => {
    expect(escalatorEtaSuffix(remainingSeconds)).toBe(expected);
  });
});
