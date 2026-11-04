// gteki.scene/0.1 hook discovered by the shared explorer; implementation lives in ../scene/.
export { buildScene, generatedSignageFromGraph } from "../scene/scene.ts";
import type { NavmeshPaths } from "@gteki/scene-api";

/** Baked stairwell cut recipe for a tier (#658), bundled as a data URL only when the explorer loads it. */
export const stairwellRecipeUrl = async (tier: "high" | "low"): Promise<string | null> =>
  (tier === "high" ? await import("../scene/stairwell-recipe-high.ts") : await import("../scene/stairwell-recipe-low.ts")).default;

/** Baked navmesh walk paths for the guide (packages/godot/src/navmesh-fallback.ts --write-paths), loaded on demand. */
export const navmeshPaths = async (): Promise<NavmeshPaths | null> =>
  (await import("../navmesh-paths.json", { with: { type: "json" } })).default as unknown as NavmeshPaths;
