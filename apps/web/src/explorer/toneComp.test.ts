import { describe, expect, it } from "vitest";
import { AGX_EXPOSURE_GAIN } from "./lighting.ts";
import { POSTFX_HIGH } from "./postfx.ts";
import { OVERLAY_INPUT_MIN, agxToneMap, compensate, displayError, forwardDisplay, hexToSrgb, linearToSrgb, srgbToLinear, uncompensatedError, type Vec3 } from "./toneComp.ts";

const EXPOSURES = [1, AGX_EXPOSURE_GAIN, 1.4];
const GRADE = POSTFX_HIGH.grade;
/** The overlay colours the explorer compensates (route, x-ray ribbon, guide start/end beacons). */
const OVERLAYS = { cyan: 0x5ef0ff, xray: 0xb8f8ff, start: 0x7dffa0, end: 0xffc857 };
/** Slightly negative linear channels reach AgX's saturated corner; the explorer allows them (see applyOverlayTone in explorer.ts). */
const NEG = { min: OVERLAY_INPUT_MIN };

describe("AgX forward port", () => {
  // Reference values computed independently from three r186's GLSL (python transcription).
  it("matches reference linear outputs", () => {
    const near = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 5));
    near(agxToneMap([0.18, 0.18, 0.18], 1), [0.214549, 0.214502, 0.214499]);
    near(agxToneMap([1, 1, 1], 1), [0.590229, 0.590136, 0.590102]);
    near(agxToneMap([0.05, 0.05, 0.05], 1.15), [0.072064, 0.072045, 0.072047]);
    near(agxToneMap([0, 0.55, 2], 1), [0.21613, 0.510653, 0.813135]);
    near(agxToneMap([1, 0.2, 0.05], 1.15), [0.692827, 0.293735, 0.157559]);
  });

  it("applies exposure before the curve and sRGB after it", () => {
    expect(agxToneMap([0.09, 0.09, 0.09], 2)).toEqual(agxToneMap([0.18, 0.18, 0.18], 1));
    const d = forwardDisplay([0.18, 0.18, 0.18], 1);
    expect(d[0] * 255).toBeCloseTo(127.64, 1);
    expect(linearToSrgb(srgbToLinear(0.37))).toBeCloseTo(0.37, 6);
  });

  it("is monotonic in each grey and keeps greys neutral", () => {
    let prev = -1;
    for (let v = 0.001; v < 20; v *= 1.15) {
      const [r, g, b] = forwardDisplay([v, v, v], 1.15);
      expect(r).toBeGreaterThanOrEqual(prev);
      expect(Math.abs(r - g) * 255).toBeLessThan(0.5);
      expect(Math.abs(g - b) * 255).toBeLessThan(0.5);
      prev = r;
    }
  });

  it("never leaves 0..1", () => {
    for (const c of [[0, 0, 0], [64, 0, 0], [-2, 3, 9], [64, 64, 64]] as Vec3[]) for (const v of agxToneMap(c, 1.4)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
});

describe("compensate", () => {
  it("round-trips in-gamut colours within 2/255", () => {
    const targets: Vec3[] = [[0.5, 0.5, 0.5], [0.25, 0.25, 0.25], [0.7, 0.7, 0.7], [0.4, 0.5, 0.6], [0.6, 0.5, 0.4], [0.45, 0.6, 0.5]];
    for (const ex of EXPOSURES) for (const grade of [undefined, GRADE]) for (const t of targets) {
      const c = compensate(t, ex, { grade });
      expect(displayError(forwardDisplay(c.linear, ex, grade), t)).toBeLessThan(2);
      expect(c.residual).toBeLessThan(2);
    }
  });

  it("beats the uncompensated colour on every overlay colour, with the physical (non-negative) clamp", () => {
    for (const ex of EXPOSURES) for (const hex of Object.values(OVERLAYS)) {
      const t = hexToSrgb(hex);
      const before = uncompensatedError(t, ex);
      const after = compensate(t, ex).residual;
      expect(after).toBeLessThan(before * 0.85);
      for (const v of compensate(t, ex).linear) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("with slightly negative channels allowed, the overlay colours land within 2/255 (grade modelled or not)", () => {
    for (const ex of EXPOSURES) for (const grade of [undefined, GRADE]) for (const hex of Object.values(OVERLAYS)) {
      const t = hexToSrgb(hex);
      const c = compensate(t, ex, { ...NEG, grade });
      expect(c.residual).toBeLessThan(2);
      expect(uncompensatedError(t, ex, grade)).toBeGreaterThan(25);
      for (const v of c.linear) expect(v).toBeGreaterThanOrEqual(OVERLAY_INPUT_MIN);
    }
  });

  it("reports the residual it actually leaves", () => {
    const t = hexToSrgb(OVERLAYS.cyan);
    const c = compensate(t, AGX_EXPOSURE_GAIN);
    expect(c.residual).toBeCloseTo(displayError(forwardDisplay(c.linear, AGX_EXPOSURE_GAIN), t), 9);
  });

  it("solves each colour in well under 1 ms", () => {
    const t = hexToSrgb(OVERLAYS.cyan);
    compensate(t, 1.15, NEG); // warm up
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) compensate(t, 1.15, { ...NEG, grade: GRADE });
    expect((performance.now() - t0) / 20).toBeLessThan(1);
  });
});
