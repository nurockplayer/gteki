import type { SceneContext, StationScene } from "./index.ts";

export interface LazyGeometryScene extends StationScene {
  /** Graph edges whose physical surfaces are supplied by this scene on approach. */
  lazyEdgeIds?: ReadonlySet<string>;
}

export interface LazyGeometryContext extends SceneContext {
  /** Register newly attached geometry with the live walker's ray targets. Call after initial scene load. */
  addCollision?(geometry: Pick<StationScene, "walkable" | "colliders" | "cameraBlockers">): void;
}
