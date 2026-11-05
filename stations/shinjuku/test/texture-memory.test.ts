/**
 * GPU texture-memory report for the Shinjuku scene in phone ("low") and desktop ("high") quality
 * (#72 follow-up). Builds the same scenes the explorer does (test/helpers/scene-digest.ts path), estimates
 * every texture once, and prints MiB per category. Pins #276's phone limits and the desktop measurement.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { buildScene } from "../gteki/scene.ts";
import { withCanvasStub } from "./helpers/scene-digest.ts";
import { TEXTURE_CATEGORIES, textureBudget } from "./helpers/texture-memory.ts";

const { bundle } = loadShinjukuBundle();

async function measure(quality: "low" | "high") {
  const scene = (await withCanvasStub(() => buildScene({ THREE, bundle, quality } as never))) as {
    root: THREE.Object3D;
    dispose(): void;
  };
  try {
    return textureBudget(scene.root);
  } finally {
    scene.dispose();
  }
}

describe("shinjuku texture memory", () => {
  for (const quality of ["low", "high"] as const) {
    it(`reports ${quality} quality by category`, async () => {
      const budget = await measure(quality);
      console.table(
        budget.byCategory
          .filter((c) => c.textures > 0)
          .map((c) => ({ quality, category: c.category, textures: c.textures, MiB: Number(c.mib.toFixed(3)) })),
      );
      console.log(`${quality}: ${budget.textureCount} textures, ${budget.totalMib.toFixed(3)} MiB total`);
      if (budget.other.length) console.log(`${quality}: unclassified`, budget.other.map((e) => e.label));

      expect(budget.totalBytes).toBeGreaterThan(0);
      if (quality === "low") {
        // Keep the surface-sign and identity density shipped on low before #276; do not halve signs to meet 40 MiB.
        expect(Number(budget.byCategory.find((c) => c.category === "signage")!.mib.toFixed(3))).toBeLessThanOrEqual(41.963);
        expect(budget.byCategory.find((c) => c.category === "finish")!.mib).toBeLessThanOrEqual(40);
        expect(budget.totalMib).toBeLessThanOrEqual(112);
      } else {
        // #789 (2026-11-04 JST): remeasured after the display-height repair; desktop texture density is unchanged.
        expect(budget.byCategory.map((c) => Number(c.mib.toFixed(3)))).toEqual([107.503, 13.333, 0.667, 0, 8, 0, 57, 0]);
        expect(Number(budget.totalMib.toFixed(3))).toBe(186.503);
      }
      expect(budget.textureCount).toBe(budget.entries.length);
      // Every texture gets exactly one category, and the category counts add up to the total.
      expect(budget.byCategory.reduce((sum, c) => sum + c.textures, 0)).toBe(budget.textureCount);
      for (const entry of budget.entries) expect(TEXTURE_CATEGORIES).toContain(entry.category);
      for (const entry of budget.entries) {
        expect(entry.width).toBeGreaterThan(0);
        expect(entry.height).toBeGreaterThan(0);
        expect(entry.bytes).toBeGreaterThan(0);
      }
    }, 120_000);
  }
});
