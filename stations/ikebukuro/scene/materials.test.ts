import { describe, expect, it } from "vitest";
import { normalFromHeight } from "./materials.ts";

describe("normalFromHeight", () => {
  const N = 8;
  const px = (out: Uint8ClampedArray, x: number, y: number) => [...out.slice((y * N + x) * 4, (y * N + x) * 4 + 3)];

  it("is straight up on a flat field", () => {
    const out = normalFromHeight(new Float32Array(N * N).fill(0.4), N, 0.01, 0.01);
    expect(px(out, 3, 3).map((v) => Math.round(v))).toEqual([128, 128, 255]);
  });

  it("tilts against the slope: rising toward +x leans the normal toward -x (R < 128)", () => {
    const h = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] = (x / N) * 0.5;
    const [r, g, b] = px(normalFromHeight(h, N, 0.01, 0.04), 3, 3) as [number, number, number];
    expect(r).toBeLessThan(120);
    expect(Math.abs(g - 128)).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThan(200);
  });

  it("uses physical slopes: a 45 degree ramp gives R of about 0.5 - 0.354", () => {
    // 1 m of rise per 1 m of run: height 1.0 = 0.125 m over 8 px of 15.625 mm
    const h = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] = x / N;
    const [r] = px(normalFromHeight(h, N, 0.125 / N, 0.125), 3, 3) as [number];
    expect(r / 255).toBeCloseTo(0.5 - 0.5 * Math.SQRT1_2, 1);
  });

  it("rising toward the image bottom leans the normal up the texture (G > 128, OpenGL convention)", () => {
    const h = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] = (y / N) * 0.5;
    expect(px(normalFromHeight(h, N, 0.01, 0.04), 3, 3)[1]!).toBeGreaterThan(136);
  });
});
