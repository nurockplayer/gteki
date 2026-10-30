// gteki.scene/0.1 hook discovered by the shared explorer; implementation lives in ../scene/.
export { buildScene, generatedSignageFromGraph } from "../scene/scene.ts";
import type { NavmeshPaths } from "@gteki/scene-api";

/** Baked navmesh walk paths for the guide (packages/godot/src/navmesh-fallback.ts --write-paths), loaded on demand. */
export const navmeshPaths = async (): Promise<NavmeshPaths | null> =>
  (await import("../navmesh-paths.json", { with: { type: "json" } })).default as unknown as NavmeshPaths;
