// Trip table and destination choice for the ambient crowd (#627): shortest ways from every dead-end,
// never a destination that would make the walker turn back, and the gate / non-gate draw.
import { describe, expect, it } from "vitest";
import { buildTripTable, pickDestination, queueLimit } from "./crowd-trips.ts";

// A small hand-made graph: dead-ends A, B, C and the gate G; junctions H, K and M, with the loop H-K-M
// so the shortest way from a junction is not always the direct path.
const paths = [
  { from: "A", to: "H", length: 10 }, // 0
  { from: "H", to: "K", length: 5 }, // 1
  { from: "H", to: "M", length: 2 }, // 2
  { from: "M", to: "K", length: 20 }, // 3
  { from: "K", to: "B", length: 5 }, // 4
  { from: "K", to: "C", length: 8 }, // 5
  { from: "K", to: "G", length: 3 }, // 6
];
const table = buildTripTable(paths);
const seeded = () => {
  let s = 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
};

describe("crowd trips", () => {
  it("finds the dead-ends and the shortest way to each", () => {
    expect([...table.deadEnds].sort()).toEqual(["A", "B", "C", "G"]);
    expect(table.row("A")!.next.get("H")).toBe(0); // A-H
    expect(table.row("A")!.next.get("K")).toBe(1); // H-K, not the long M-K path
    expect(table.row("A")!.next.get("M")).toBe(2);
    expect(table.row("A")!.next.get("B")).toBe(4); // K-B
    expect(table.row("G")!.next.get("K")).toBe(6); // K-G
    expect(table.row("G")!.dist.get("A")).toBeCloseTo(18, 9); // K-G 3 + H-K 5 + A-H 10
    expect(table.row("A")!.next.get("A")).toBeUndefined(); // already there
  });

  it("never picks a dead-end behind the walker", () => {
    const rand = seeded();
    const seen = new Set<string>();
    for (let k = 0; k < 200; k++) {
      const dest = pickDestination(table, "K", "H", ["G"], 0.5, rand);
      expect(dest).not.toBe("A"); // A is behind: the only way there is to turn back
      if (dest !== null) seen.add(dest);
    }
    expect([...seen].sort()).toEqual(["B", "C", "G"]);
    expect(pickDestination(table, "A", "H", ["G"], 0.5, rand)).toBe("A"); // the dead-end ahead is fine
  });

  it("draws a gate with probability toGate, and a non-gate otherwise", () => {
    const rand = seeded();
    for (let k = 0; k < 100; k++) expect(pickDestination(table, "K", "H", ["G"], 1, rand)).toBe("G");
    const nonGates = new Set<string>();
    for (let k = 0; k < 100; k++) {
      const dest = pickDestination(table, "K", "H", ["G"], 0, rand);
      expect(dest).not.toBe("G");
      if (dest !== null) nonGates.add(dest);
    }
    expect([...nonGates].sort()).toEqual(["B", "C"]);
  });

  it("spaces a queue by the gap", () => {
    expect(queueLimit(1, 0.8)).toBeCloseTo(1.8, 9);
    expect(queueLimit(3.4, 0.8)).toBeCloseTo(4.2, 9);
  });
});
