// gteki.scene/0.1 hook discovered by the shared explorer; implementation lives in ../scene/.
import { buildScene as baseScene } from "../scene/scene.ts";
import type { BuildScene } from "@gteki/scene-api";
export { generatedSignageFromGraph } from "../scene/scene.ts";
export const previewBundle = async (bundle: import("@gteki/schema").StationBundle) => {
  const pilot = await import("../scene/depato/pilot.ts");
  const sunshine = await import("../scene/sunshine.ts");
  return sunshine.sunshineBundle(pilot.previewBundle(bundle));
};
export const buildScene: BuildScene = async ctx => {
  if (!ctx.previewNext) return baseScene(ctx);
  const pilot = await import("../scene/depato/pilot.ts");
  const sunshine = await import("../scene/sunshine.ts");
  return sunshine.buildSunshineScene(ctx, context => pilot.buildPilotScene(context, baseScene));
};
import type { NavmeshPaths } from "@gteki/scene-api";

/** Baked stairwell cut recipe for a tier (#658), bundled as a data URL only when the explorer loads it. */
export const stairwellRecipeUrl = async (tier: "high" | "low"): Promise<string | null> =>
  (tier === "high" ? await import("../scene/stairwell-recipe-high.ts") : await import("../scene/stairwell-recipe-low.ts")).default;

/** Baked navmesh walk paths for the guide (packages/godot/src/navmesh-fallback.ts --write-paths), loaded on demand. */
export const navmeshPaths = async (): Promise<NavmeshPaths | null> =>
  (await import("../navmesh-paths.json", { with: { type: "json" } })).default as unknown as NavmeshPaths;
