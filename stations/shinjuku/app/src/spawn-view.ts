import type { Layout, WallSeg, XYZ } from "../../scene/layout.ts";
import { WalkWorld } from "../../scene/layout.ts";
import { chooseFollowCamera } from "./player.ts";

export const LANE_CAMERA = { fov: 62, near: 0.05, headHeight: 1.1, pitch: -0.18, pitchBias: -0.1, distance: 3.6, lookAhead: 1.15, lookRise: 0.15 } as const;

/** Same architecture-only collision environment used by the running follow camera. */
export function followCameraEnvironment(layout: Layout, propWalls: WallSeg[]) {
  const world = new WalkWorld({ ...layout, runWalls: [], levels: layout.levels.map((level) => ({
    ...level, railings: [], walls: level.walls.filter((wall) => wall.zMax - wall.zMin > 1.9),
  })) });
  world.addWalls(propWalls.filter((wall) => wall.zMax - wall.zMin > 1.9));
  const surfaces = [...layout.levels.flatMap((l) => [...l.slabs, ...l.ceilings]), ...layout.pads, ...layout.streetPads, ...layout.soffits];
  return { world, surfaces };
}

/** Ordinary idle third-person view: no input, bob, stair pitch or transition focus. */
export function spawnView(position: XYZ, heading: number, environment: ReturnType<typeof followCameraEnvironment>) {
  const head = { ...position, z: position.z + LANE_CAMERA.headHeight };
  const eye = chooseFollowCamera(head, heading, LANE_CAMERA.pitch + LANE_CAMERA.pitchBias, LANE_CAMERA.distance, environment.world, environment.surfaces);
  const look = { x: head.x + Math.sin(heading) * LANE_CAMERA.lookAhead, y: head.y + Math.cos(heading) * LANE_CAMERA.lookAhead, z: head.z + LANE_CAMERA.lookRise };
  return { eye, look };
}
