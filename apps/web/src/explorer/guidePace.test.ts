import { describe, expect, it } from "vitest";
import type { Instruction, PolylinePoint } from "@gteki/navigation";
import { DEFAULT_GUIDE_TIER, GUIDE_TIERS, MIN_GUIDE_MPS, guidePaceSpans, guideSpeedAt, isGuideTier, MIN_INSTRUCTION_S, nextGuideTier, pacedDistance, type PaceSpan } from "./guidePace.ts";

const pt = (x: number, stepIndex: number): PolylinePoint => ({ x, y: 0, z: 0, zKnown: true, stepIndex, floorId: "f" });
const ins = (kind: Instruction["kind"], stepIndexes: number[], extra: Partial<Instruction> = {}): Instruction =>
  ({ kind, stepIndexes, distanceM: 0, vertical: null, toFloorId: "f", text: "", ...extra }) as Instruction;

describe("guide tiers", () => {
  it("defaults to run and cycles walk -> run -> fast -> walk", () => {
    expect(DEFAULT_GUIDE_TIER).toBe("run");
    expect(GUIDE_TIERS.map((t) => t.mps)).toEqual([1.6, 3.4, 6.8]);
    expect(GUIDE_TIERS.map((t) => nextGuideTier(t.id))).toEqual(["run", "fast", "walk"]);
  });

  it("recognises only known tier ids", () => {
    expect(isGuideTier("fast")).toBe(true);
    expect(isGuideTier("2")).toBe(false);
    expect(isGuideTier(null)).toBe(false);
  });
});

describe("connector pace caps", () => {
  // One 20 m segment per mode, back to back, each far longer than its dwell cap needs.
  const modes = ["walk", "stairs", "escalator", "elevator", "gate", "ramp", "moving_walkway"] as const;
  const polyline = [pt(0, -1), ...modes.map((_, i) => pt((i + 1) * 20, i))];
  const spans = guidePaceSpans(polyline, modes.map((mode) => ({ mode })), []);
  const at = (mode: (typeof modes)[number], tier: "walk" | "run" | "fast") => guideSpeedAt(modes.indexOf(mode) * 20 + 10, tier, spans);

  it("caps stairs, escalator, elevator and gate; leaves walk, ramp and moving walkway at the tier speed", () => {
    expect(at("stairs", "run")).toBe(0.9);
    expect(at("escalator", "run")).toBe(0.75);
    expect(at("elevator", "run")).toBe(1.5);
    expect(at("gate", "run")).toBe(1.6);
    expect(at("walk", "run")).toBe(3.4);
    expect(at("ramp", "run")).toBe(3.4);
    expect(at("moving_walkway", "run")).toBe(3.4);
  });

  it("never exceeds the tier speed (gate on the walk tier)", () => {
    expect(at("gate", "walk")).toBe(1.6);
    expect(at("stairs", "walk")).toBe(0.9);
    expect(at("ramp", "walk")).toBe(1.6);
  });

  it("doubles the connector caps on the fast tier", () => {
    expect(at("stairs", "fast")).toBe(1.8);
    expect(at("escalator", "fast")).toBe(1.5);
    expect(at("elevator", "fast")).toBe(3);
    expect(at("gate", "fast")).toBe(3.2);
    expect(at("walk", "fast")).toBe(6.8);
  });
});

describe("narration dwell", () => {
  // 5 m walk (step 0), 100 m walk (step 1), a wait before step 1, then a 2 m walk (step 2).
  const polyline = [pt(0, -1), pt(5, 0), pt(105, 1), pt(107, 2)];
  const steps = [{ mode: "walk" as const }, { mode: "walk" as const }, { mode: "walk" as const }];
  const instructions = [ins("walk", [0]), ins("wait", [], { beforeStepIndex: 1 }), ins("walk", [1]), ins("arrive", [2])];
  const spans = guidePaceSpans(polyline, steps, instructions);

  it("holds a short instruction for MIN_INSTRUCTION_S, at every tier", () => {
    for (const tier of ["walk", "run", "fast"] as const) {
      expect(guideSpeedAt(2, tier, spans)).toBeCloseTo(Math.min(GUIDE_TIERS.find((t) => t.id === tier)!.mps, 5 / 1.8), 9);
    }
    expect(guideSpeedAt(2, "fast", spans)).toBeCloseTo(5 / 1.8, 9);
  });

  it("does not cap a long instruction and ignores wait instructions", () => {
    expect(guideSpeedAt(50, "run", spans)).toBe(3.4);
    expect(guideSpeedAt(50, "fast", spans)).toBe(6.8);
    expect(spans.every((s) => s.maxMps !== 0)).toBe(true);
  });

  it("does not scale a dwell cap on the fast tier", () => {
    const s: PaceSpan[] = [{ fromS: 0, toS: 10, maxMps: 2, scales: false }];
    expect(guideSpeedAt(5, "fast", s)).toBe(2);
    expect(guideSpeedAt(5, "fast", [{ ...s[0]!, scales: true }])).toBe(4);
  });

  it("spans are half-open and the lowest cap wins where they overlap", () => {
    const s: PaceSpan[] = [{ fromS: 0, toS: 10, maxMps: 1, scales: false }, { fromS: 5, toS: 20, maxMps: 0.5, scales: false }];
    expect(guideSpeedAt(10, "run", s)).toBe(0.5);
    expect(guideSpeedAt(20, "run", s)).toBe(3.4);
    expect(guideSpeedAt(7, "run", s)).toBe(0.5);
  });

  it("gives a zero-length instruction no cap and never drops below the floor", () => {
    const flat = guidePaceSpans([pt(0, -1), pt(0, 0)], [{ mode: "walk" }], [ins("walk", [0])]);
    expect(flat).toEqual([]);
    expect(guideSpeedAt(0, "run", flat)).toBe(3.4);
    expect(guideSpeedAt(0.05, "run", [{ fromS: 0, toS: 1, maxMps: 0.01, scales: false }])).toBe(MIN_GUIDE_MPS);
  });

  it("with no spans, the speed is the tier's", () => {
    expect(guideSpeedAt(0, "walk", [])).toBe(1.6);
  });
});

describe("pacedDistance", () => {
  const dwell: PaceSpan[] = [{ fromS: 10, toS: 10.4, maxMps: 0.4 / MIN_INSTRUCTION_S, scales: false }];

  it("applies a span's cap to the part of the frame inside it, not the speed from before the boundary", () => {
    const d = pacedDistance(9.99, 0.05, "fast", dwell);
    expect(d).toBeCloseTo(0.01 + (0.05 - 0.01 / 6.8) * (0.4 / MIN_INSTRUCTION_S), 9);
    expect(d).toBeLessThan(0.05);
  });

  it("returns to full speed within one frame when leaving a slow span", () => {
    const slow: PaceSpan[] = [{ fromS: 0, toS: 0.1, maxMps: 0.5, scales: false }];
    // 0.1 m at 0.5 m/s takes 0.2 s; the remaining 0.3 s run at 3.4 m/s.
    expect(pacedDistance(0, 0.5, "run", slow)).toBeCloseTo(0.1 + 0.3 * 3.4, 9);
  });

  it("integrates exactly across several boundaries in one large frame", () => {
    const spans: PaceSpan[] = [
      { fromS: 1, toS: 2, maxMps: 1, scales: false },
      { fromS: 3, toS: 4, maxMps: 2, scales: false },
    ];
    // run 3.4: 0->1 (1/3.4 s), 1->2 (1 s), 2->3 (1/3.4 s), 3->4 (0.5 s), then 3.4 for the rest.
    const used = 2 / 3.4 + 1 + 0.5;
    expect(pacedDistance(0, 5, "run", spans)).toBeCloseTo(4 + (5 - used) * 3.4, 9);
  });

  it("with no spans, is the tier speed times dt", () => {
    expect(pacedDistance(3, 0.05, "fast", [])).toBeCloseTo(6.8 * 0.05, 12);
    expect(pacedDistance(3, 0.1, "walk", [])).toBeCloseTo(0.16, 12);
  });

  it("keeps a short instruction on screen about MIN_INSTRUCTION_S frame by frame on the fast tier", () => {
    const dt = 0.05;
    let s = 9.99;
    let frames = 0;
    let inside = 0;
    while (s < 10.4 + 1) {
      if (s >= 10 && s < 10.4) inside += dt;
      s += pacedDistance(s, dt, "fast", dwell);
      frames++;
      if (frames > 1000) throw new Error("did not terminate");
    }
    expect(inside).toBeGreaterThanOrEqual(MIN_INSTRUCTION_S - dt);
  });
});
