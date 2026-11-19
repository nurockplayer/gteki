import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import plan from "../data/plan.json" with { type: "json" };
import { prepareLayout } from "../scene/build-cache.ts";
import type { Plan } from "../scene/layout.ts";
import { stairProfile } from "../scene/stairProfile.ts";

it("keeps every baked stair run above its nosings and joins both landings", () => {
  const { bundle } = loadShinjukuBundle();
  const layoutBakeText = gunzipSync(readFileSync(new URL("../data/layout-baked.bin", import.meta.url))).toString("utf8");
  const baked = prepareLayout(bundle, plan as unknown as Plan, { reuse: true, layoutBakeText });
  expect(baked.cached).toBe(true);
  const runs = baked.layout.runs.filter((r) => r.mode === "stairs" && Math.abs(r.b.z - r.a.z) >= 0.05);
  expect(runs).toHaveLength(29);
  for (const r of runs) {
    const lo = r.a.z <= r.b.z ? r.a : r.b, hi = r.a.z <= r.b.z ? r.b : r.a;
    const { steps, rise, tread, L, treadTop, walkZ } = stairProfile(lo, hi);
    const samples = Array.from({ length: Math.floor(L / 0.05) + 1 }, (_, i) => i * 0.05).concat(L);
    for (const s of samples) {
      const i = Math.min(steps - 1, Math.floor(s / tread));
      const clearance = walkZ(s) - treadTop(i);
      expect(clearance, `${r.edgeId} s=${s}`).toBeGreaterThanOrEqual(-0.015);
      expect(clearance, `${r.edgeId} s=${s}`).toBeLessThanOrEqual(rise + 0.015 + 1e-12);
    }
    for (let i = 0; i < steps; i++) {
      expect(walkZ(i * tread) - treadTop(i), `${r.edgeId} nosing ${i}`).toBeGreaterThanOrEqual(0);
    }
    expect(walkZ(-tread)).toBe(lo.z);
    expect(walkZ(L)).toBe(hi.z);
  }
});
