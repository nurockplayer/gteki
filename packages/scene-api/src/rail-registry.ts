import type { Vector3 } from "three";
import type { SceneContext, StationScene } from "./index.ts";

type XY = [number, number];
type XYZ = [number, number, number];

export interface RailLane {
  line: { ja: string; en: string };
  operator: string;
  lineCode: string;
  status: "evidence" | "representative" | "sourced";
  levels: { id: string; label: string; z_m: number; source: string }[];
  gates: { id: string; poiId?: string | null; side: "public" | "paid"; level?: string; position: XYZ | null; source: string }[];
  platforms: { id: string; poiId?: string; number: number | string | null; track: number | string | null; services: string[]; level: string; centerline: [XY, XY] | null; width_m: number | null; length_m: number | null; source: string }[];
  waypoints?: { id: string; level: string; position: XYZ; source: string }[];
  connectors: { from: string; to: string; kind: "walk" | "stairs" | "escalator" | "lift" | "gate"; via?: XYZ[]; source: string }[];
  openings?: { position: XYZ; along: XY; width_m: number; depth_m: number; height_m: number }[];
  sources: { id: string; url?: string; path?: string; read_date: string; terms_ref: string }[];
  gaps: string[];
}

type RailChunk = Pick<StationScene, "root" | "walkable" | "colliders" | "cameraBlockers" | "dispose">;
export type RailBuilder = (ctx: SceneContext, lane: RailLane, scene: StationScene) => RailChunk | Promise<RailChunk>;

/** A station's glob paths are relative to its scene module. Match lane JSON to builders by stem. */
export function discoverRailLanes(lanes: Record<string, RailLane>, builders: Record<string, () => Promise<RailBuilder>>) {
  return Object.entries(lanes).map(([path, lane]) => {
    const prefix = path.slice(path.lastIndexOf("/") + 1, -".json".length);
    return { prefix, lane, load: builders[`./rail/${prefix}.ts`] };
  });
}

export function mountRailChunks(
  ctx: SceneContext,
  scene: StationScene,
  queued: { anchors: Vector3[]; lane: RailLane; load: () => Promise<RailBuilder> }[],
  distanceM: number,
): StationScene {
  const chunks: RailChunk[] = [];
  let disposed = false;
  return {
    ...scene,
    approach(position) {
      scene.approach?.(position);
      const index = queued.findIndex(entry => entry.anchors.some(anchor => anchor.distanceToSquared(position) <= distanceM ** 2));
      if (index < 0) return;
      const { lane, load } = queued.splice(index, 1)[0]!;
      void load().then(async build => {
        if (disposed) return;
        const chunk = await build(ctx, lane, scene);
        if (disposed) { chunk.dispose(); return; }
        chunks.push(chunk);
        scene.root.add(chunk.root);
        chunk.root.updateWorldMatrix(true, true);
        ctx.mountChunk?.(chunk);
      });
    },
    dispose() {
      disposed = true;
      for (const chunk of chunks) chunk.dispose();
      scene.dispose();
    },
  };
}
