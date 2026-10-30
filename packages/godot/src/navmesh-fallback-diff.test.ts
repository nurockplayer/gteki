import { describe, expect, it } from "vitest";
import { fallbackDiff } from "./navmesh-fallback-diff.ts";
import { navPathsDiff } from "./navmesh-fallback.ts";

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

describe("navmesh walk path comparison", () => {
  const line = (x: number, y: number, z = 0) => [[x, y, z], [x + 1, y + 1, z], [x + 2, y + 2, z]];
  it("reports directions missing from or extra in the committed file", () => {
    const committed = { a: { forward: line(0, 0) }, b: { forward: line(0, 0), reverse: line(0, 0) } };
    const computed = { a: { forward: line(0, 0), reverse: line(5, 5) }, b: { forward: line(0, 0) } };
    expect(navPathsDiff(committed, computed)).toEqual({ missing: ["a:reverse"], extra: ["b:reverse"], moved: [] });
  });
  it("reports a direction as moved when its points change beyond the tolerance or change count", () => {
    const committed = { a: { forward: line(0, 0) }, b: { forward: line(0, 0) } };
    expect(navPathsDiff(committed, { a: { forward: line(0, 0.04) }, b: { forward: line(0, 0) } }).moved).toEqual([]);
    expect(navPathsDiff(committed, { a: { forward: line(0, 0.06) }, b: { forward: line(0, 0) } }).moved).toEqual(["a:forward"]);
    expect(navPathsDiff(committed, { a: { forward: line(0, 0).slice(0, 2) }, b: { forward: line(0, 0) } }).moved).toEqual(["a:forward"]);
  });
  it("treats a deleted edge as an extra", () => {
    expect(navPathsDiff({ a: { forward: line(0, 0) } }, {}).extra).toEqual(["a:forward"]);
  });
});
