import { describe, expect, it } from "vitest";
import { fallbackDiff } from "./navmesh-fallback-diff.ts";

describe("fallback list comparison", () => {
  it("permits removal but identifies replacement even when the count does not grow", () => {
    const allowed = [{ edgeId: "a" }, { edgeId: "b" }];
    expect(fallbackDiff(allowed, [{ edgeId: "a" }])).toEqual({ added: [], removed: ["b"], duplicateAllowed: false, duplicateActual: false, grew: false });
    expect(fallbackDiff(allowed, [{ edgeId: "a" }, { edgeId: "c" }])).toEqual({ added: ["c"], removed: ["b"], duplicateAllowed: false, duplicateActual: false, grew: false });
  });
  it("reports duplicates and growth separately", () => {
    expect(fallbackDiff([{ edgeId: "a" }, { edgeId: "a" }], [{ edgeId: "a" }, { edgeId: "a" }, { edgeId: "b" }])).toEqual({ added: ["b"], removed: [], duplicateAllowed: true, duplicateActual: true, grew: true });
  });
});
