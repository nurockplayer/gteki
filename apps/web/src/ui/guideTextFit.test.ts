import { expect, it } from "vitest";
import { needsCompact } from "./guideTextFit.ts";

it("compacts only text that exceeds two measured lines", () => {
  expect(needsCompact(18, 18, 2)).toBe(false);
  expect(needsCompact(18, 36, 2)).toBe(false);
  expect(needsCompact(18, 37, 2)).toBe(false);
  expect(needsCompact(18, 54, 2)).toBe(true);
});
