/**
 * GPU texture-memory report for the Shinjuku scene in phone ("low") and desktop ("high") quality
 * (#72 follow-up). Builds the same scenes the explorer does (test/helpers/scene-digest.ts path), estimates
 * every texture once, and prints MiB per category. There is deliberately no budget assertion here: the lead
 * sets the threshold after reading the numbers.
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
