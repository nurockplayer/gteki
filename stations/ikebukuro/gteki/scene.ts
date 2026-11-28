// gteki.scene/0.1 hook discovered by the shared explorer; implementation lives in ../scene/.
import { buildScene as baseScene } from "../scene/scene.ts";
import type { BuildScene } from "@gteki/scene-api";
import type { buildDepatoInterior } from "../scene/depato/interior.ts";
export { generatedSignageFromGraph } from "../scene/scene.ts";
export const previewBundle = async (bundle: import("@gteki/schema").StationBundle) => {
  const pilot = await import("../scene/depato/pilot.ts");
  const sunshine = await import("../scene/sunshine.ts");
  const rail = await import("../scene/rail.ts");
  return rail.railBundle(sunshine.sunshineBundle(pilot.previewBundle(bundle)));
};
export const buildScene: BuildScene = async ctx => {
  if (!ctx.previewNext) return baseScene(ctx);
  const pilot = await import("../scene/depato/pilot.ts");
  const sunshine = await import("../scene/sunshine.ts");
  const rail = await import("../scene/rail.ts");
  type Store = ReturnType<typeof buildDepatoInterior>;
  const stores: Store[] = [];
  const scene = await rail.buildRailScene(ctx, context => sunshine.buildSunshineScene(context,
    context => pilot.buildPilotScene(context, baseScene, stores), stores));
  let avatar: { x: number; y: number; z: number } | null = null;
  let active: Store | undefined;
  const cameraPoint = new ctx.THREE.Vector3();
  return {
    ...scene,
    setCameraFocus(...args) {
      scene.setCameraFocus?.(...args);
      avatar = args[3] ?? null;
    },
    update(dt, elapsed, camera) {
      scene.update?.(dt, elapsed, camera);
      if (!camera) return;
      camera.getWorldPosition(cameraPoint);
      const point = avatar ?? { x: cameraPoint.x, y: cameraPoint.y - 2, z: cameraPoint.z };
      let next: Store | undefined;
      let occupied = false;
      let distance = Infinity;
      for (const store of stores) {
        const inside = store.occupies(point);
        const entranceDistance = store.entranceDistance(point);
        if ((inside && !occupied) || (inside === occupied && entranceDistance < distance)) {
          next = store;
          occupied = inside;
          distance = entranceDistance;
        }
      }
      if (active !== next) active?.update(camera, dt, elapsed, false);
      active = next;
      active?.setAvatar(point);
      active?.update(camera, dt, elapsed);
    },
  };
};
import type { NavmeshPaths } from "@gteki/scene-api";

/** Baked stairwell cut recipe for a tier (#658), bundled as a data URL only when the explorer loads it. */
export const stairwellRecipeUrl = async (tier: "high" | "low"): Promise<string | null> =>
  (tier === "high" ? await import("../scene/stairwell-recipe-high.ts") : await import("../scene/stairwell-recipe-low.ts")).default;

/** Baked navmesh walk paths for the guide (packages/godot/src/navmesh-fallback.ts --write-paths), loaded on demand. */
export const navmeshPaths = async (): Promise<NavmeshPaths | null> =>
  (await import("../navmesh-paths.json", { with: { type: "json" } })).default as unknown as NavmeshPaths;
