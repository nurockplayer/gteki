import { describe, expect, it } from "vitest";
import type { Instruction, PolylinePoint } from "@gteki/navigation";
import { DEFAULT_GUIDE_TIER, GUIDE_TIERS, MIN_GUIDE_MPS, effectivePace, guidePaceSpans, guideSpeedAt, guideTierSpeed, isGuideTier, MIN_INSTRUCTION_S, nextGuideTier, paceReadout, pacedDistance, pacedDuration, polylineLengthM, type GuideTierId, type PaceSpan } from "./guidePace.ts";
import { strings } from "../i18n.ts";

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

describe("effective pace", () => {
  const tiers = GUIDE_TIERS.map((t) => t.id);
  /** Seconds the guide's own stepping (pacedDistance at a fixed dt) takes to cover `total`, interpolated within the last frame. */
  const simulate = (total: number, tier: GuideTierId, spans: readonly PaceSpan[], dt = 1 / 600): number => {
    let s = 0;
    let frames = 0;
    for (; s < total; frames++) {
      const d = pacedDistance(s, dt, tier, spans);
      if (s + d >= total) return frames * dt + ((total - s) / d) * dt;
      s += d;
    }
    return frames * dt;
  };

  /** 40 m corridor, 12 m escalator, 6 m stairs, 3 m gate, then a 2 m walk that a dwell cap holds to MIN_INSTRUCTION_S. */
  const mixed = (() => {
    const polyline = [pt(0, -1), pt(40, 0), pt(52, 1), pt(58, 2), pt(61, 3), pt(63, 4)];
    const steps = (["walk", "escalator", "stairs", "gate", "walk"] as const).map((mode) => ({ mode }));
    const instructions = [ins("walk", [0]), ins("escalator", [1]), ins("stairs", [2]), ins("gate", [3]), ins("arrive", [4])];
    return { polyline, spans: guidePaceSpans(polyline, steps, instructions), total: polylineLengthM(polyline) };
  })();

  it("measures the polyline", () => {
    expect(mixed.total).toBe(63);
    expect(polylineLengthM([])).toBe(0);
    expect(polylineLengthM([pt(0, -1)])).toBe(0);
  });

  it("agrees with how the guide steps, at every tier", () => {
    for (const tier of tiers) {
      const stepped = simulate(mixed.total, tier, mixed.spans);
      expect(pacedDuration(mixed.total, tier, mixed.spans)).toBeCloseTo(stepped, 2);
      expect(effectivePace(mixed.total, tier, mixed.spans)).toBeCloseTo(mixed.total / stepped, 2);
    }
  });

  it("agrees with the guide's stepping at the real frame rate, within a frame", () => {
    for (const tier of tiers) {
      expect(Math.abs(simulate(mixed.total, tier, mixed.spans, 1 / 30) - pacedDuration(mixed.total, tier, mixed.spans))).toBeLessThan(1 / 30 + 1e-9);
    }
  });

  it("is exactly the tier speed on an open corridor, with no approximation", () => {
    for (const tier of tiers) {
      expect(effectivePace(120, tier, [])).toBeCloseTo(guideTierSpeed(tier), 12);
      expect(pacedDuration(120, tier, [])).toBeCloseTo(120 / guideTierSpeed(tier), 12);
      expect(paceReadout(120, tier, []).approx).toBe(false);
    }
    // A long corridor whose only cap is a dwell that never binds.
    const loose: PaceSpan[] = [{ fromS: 0, toS: 100, maxMps: 100 / MIN_INSTRUCTION_S, scales: false }];
    expect(paceReadout(100, "run", loose)).toEqual({ pace: "3.4", top: "3.4", approx: false });
  });

  it("is well below the tier speed on an escalator-heavy route", () => {
    // 10 m corridor, 100 m escalator, 10 m corridor.
    const spans: PaceSpan[] = [{ fromS: 10, toS: 110, maxMps: 0.75, scales: true }];
    // fast: connector 1.5 m/s
    expect(pacedDuration(120, "fast", spans)).toBeCloseTo(20 / 6.8 + 100 / 1.5, 9);
    expect(effectivePace(120, "fast", spans)).toBeCloseTo(120 / (20 / 6.8 + 100 / 1.5), 9);
    expect(effectivePace(120, "fast", spans)).toBeLessThan(2);
    // run: 0.75 m/s unscaled
    expect(effectivePace(120, "run", spans)).toBeCloseTo(120 / (20 / 3.4 + 100 / 0.75), 9);
    expect(paceReadout(120, "fast", spans).approx).toBe(true);
  });

  it("is dominated by MIN_INSTRUCTION_S on very short routes", () => {
    const spans: PaceSpan[] = [{ fromS: 0, toS: 3, maxMps: 3 / MIN_INSTRUCTION_S, scales: false }];
    for (const tier of tiers) {
      expect(pacedDuration(3, tier, spans)).toBeCloseTo(Math.max(MIN_INSTRUCTION_S, 3 / guideTierSpeed(tier)), 9);
    }
    expect(effectivePace(3, "fast", spans)).toBeCloseTo(3 / MIN_INSTRUCTION_S, 9);
    expect(paceReadout(3, "fast", spans)).toEqual({ pace: "1.7", top: "6.8", approx: true });
    // Floored instruction speed: a vanishing span cannot stall the route.
    const tiny: PaceSpan[] = [{ fromS: 0, toS: 0.1, maxMps: 0.01, scales: false }];
    expect(pacedDuration(1, "run", tiny)).toBeCloseTo(0.1 / MIN_GUIDE_MPS + 0.9 / 3.4, 9);
  });

  it("gives each tier its own value, never faster than the tier", () => {
    const paces = tiers.map((tier) => effectivePace(mixed.total, tier, mixed.spans));
    expect(new Set(paces.map((p) => p.toFixed(3))).size).toBe(3);
    expect(paces[0]!).toBeLessThan(paces[1]!);
    expect(paces[1]!).toBeLessThan(paces[2]!);
    tiers.forEach((tier, i) => expect(paces[i]!).toBeLessThanOrEqual(guideTierSpeed(tier)));
  });

  it("ignores spans outside the route and falls back to the tier speed for an empty route", () => {
    expect(pacedDuration(10, "run", [{ fromS: 20, toS: 30, maxMps: 0.1, scales: false }])).toBeCloseTo(10 / 3.4, 12);
    expect(effectivePace(0, "fast", mixed.spans)).toBe(6.8);
  });
});

describe("speed button labels", () => {
  const spans: PaceSpan[] = [{ fromS: 10, toS: 110, maxMps: 0.75, scales: true }];
  const label = (lang: "ja" | "en", tier: GuideTierId, total = 120, sp: readonly PaceSpan[] = spans) => {
    const t = strings(lang);
    const r = paceReadout(total, tier, sp);
    return { text: t.guideSpeedLabel(t.guideTier[tier], r), aria: t.guideSpeedAria(t.guideTier[tier], r) };
  };

  it("shows the effective pace with one decimal and a tilde, short enough for the HUD band", () => {
    expect(label("en", "fast").text).toBe("Fast ≈1.7 m/s");
    expect(label("ja", "fast").text).toBe("早送り ≈1.7 m/s");
    expect(label("en", "run").text).toBe("Run ≈0.9 m/s");
    expect(label("en", "fast").text.length).toBeLessThanOrEqual(16);
  });

  it("shows the plain tier speed, without the tilde, on an open corridor", () => {
    expect(label("en", "fast", 120, []).text).toBe("Fast 6.8 m/s");
    expect(label("ja", "walk", 120, []).text).toBe("歩く 1.6 m/s");
    expect(label("en", "run", 120, []).text).toBe("Run 3.4 m/s");
  });

  it("explains the cap and the route average in the tooltip and aria label, in both languages", () => {
    expect(label("en", "fast").aria).toBe("Guide speed, Fast: up to 6.8 m/s in open corridors; this route averages about 1.7 m/s (escalators, stairs and gates keep realistic speeds)");
    expect(label("ja", "fast").aria).toBe("ガイド速度: 早送り。通路では最大6.8 m/s、このルートの平均は約1.7 m/s（エスカレーター・階段・改札は現実的な速度）");
    expect(label("en", "fast", 120, []).aria).toBe("Guide speed, Fast: 6.8 m/s");
    expect(label("ja", "fast", 120, []).aria).toBe("ガイド速度: 早送り。最大6.8 m/s");
  });

  it("updates when the tier changes", () => {
    const texts = (["walk", "run", "fast"] as const).map((tier) => label("en", tier).text);
    expect(texts).toEqual(["Walk ≈0.8 m/s", "Run ≈0.9 m/s", "Fast ≈1.7 m/s"]);
    expect(new Set((["walk", "run", "fast"] as const).map((tier) => label("en", tier).aria)).size).toBe(3);
  });
});
