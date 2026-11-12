import type { Layout, WallSeg, XYZ } from "../../scene/layout.ts";
import { WalkWorld } from "../../scene/layout.ts";
import { chooseFollowCamera } from "./player.ts";

export const LANE_CAMERA = { fov: 62, near: 0.05, headHeight: 1.1, pitch: -0.18, pitchBias: -0.1, distance: 3.6, lookAhead: 1.15, lookRise: 0.15 } as const;

/** Low follow camera for the default cat protagonist, the same pose as the explorer's cat camera (#854). */
export const LANE_CAMERA_CAT = { ...LANE_CAMERA, headHeight: 0.54, pitch: 0, pitchBias: 0, distance: 2.4, lookRise: 0.1 } as const;

/** Same architecture-only collision environment used by the running follow camera. */
export function followCameraEnvironment(layout: Layout, propWalls: WallSeg[]) {
  const world = new WalkWorld({ ...layout, runWalls: [], levels: layout.levels.map((level) => ({
    ...level, railings: [], walls: level.walls.filter((wall) => wall.zMax - wall.zMin > 1.9),
  })) });
  world.addWalls(propWalls.filter((wall) => wall.zMax - wall.zMin > 1.9));
  const surfaces = [...layout.levels.flatMap((l) => [...l.slabs, ...l.ceilings]), ...layout.pads, ...layout.streetPads, ...layout.soffits];
  return { world, surfaces };
}

/** Arrival look for the cat: where the board's centre and the cat's feet should sit, in NDC, and how far a board counts. */
export const CAT_ARRIVAL = { boardNdc: 0.55, feetNdc: 0.85, maxRangeM: 30, maxFloorDiffM: 6 } as const;

/** Extra look height (m) that brings the nearest board ahead into frame, capped so the cat's feet stay in frame; 0 if none or in portrait. */
export function catArrivalRise(opts: { eye: XYZ; look: XYZ; feet: XYZ; heading: number; boards: readonly XYZ[]; fovDeg: number; aspect: number }): number {
  const { eye, look, feet, heading, boards, fovDeg, aspect } = opts;
  // Portrait has no room: the board would clip under the top HUD and push the cat behind the bottom panel.
  if (aspect < 1) return 0;
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const halfH = Math.atan(tanV * aspect);
  let nearest: XYZ | null = null;
  let nearestRange = Infinity;
  for (const board of boards) {
    const range = Math.hypot(board.x - feet.x, board.y - feet.y);
    if (range > CAT_ARRIVAL.maxRangeM) continue;
    if (Math.abs(board.z - feet.z) > CAT_ARRIVAL.maxFloorDiffM + 3) continue;
    const bearing = Math.atan2(board.x - eye.x, board.y - eye.y);
    const off = Math.atan2(Math.sin(bearing - heading), Math.cos(bearing - heading));
    if (Math.abs(off) > halfH) continue;
    if (range < nearestRange) {
      nearestRange = range;
      nearest = board;
    }
  }
  if (!nearest) return 0;
  const L = Math.hypot(look.x - eye.x, look.y - eye.y);
  const base = Math.atan2(look.z - eye.z, L);
  // Screen height depends on depth along the view direction, not the straight-line distance (#1019).
  const depth = (p: XYZ) => ((p.x - eye.x) * (look.x - eye.x) + (p.y - eye.y) * (look.y - eye.y)) / L;
  const wanted = Math.atan2(nearest.z - eye.z, depth(nearest)) - Math.atan(CAT_ARRIVAL.boardNdc * tanV);
  const allowed = Math.atan2(feet.z - eye.z, depth(feet)) + Math.atan(CAT_ARRIVAL.feetNdc * tanV);
  const elevation = Math.min(wanted, allowed);
  if (!(elevation > base)) return 0;
  return eye.z + Math.tan(elevation) * L - look.z;
}

/** Ordinary idle third-person view: no input, bob, stair pitch or transition focus. */
export function spawnView(position: XYZ, heading: number, environment: ReturnType<typeof followCameraEnvironment>) {
  const head = { ...position, z: position.z + LANE_CAMERA.headHeight };
  const eye = chooseFollowCamera(head, heading, LANE_CAMERA.pitch + LANE_CAMERA.pitchBias, LANE_CAMERA.distance, environment.world, environment.surfaces);
  const look = { x: head.x + Math.sin(heading) * LANE_CAMERA.lookAhead, y: head.y + Math.cos(heading) * LANE_CAMERA.lookAhead, z: head.z + LANE_CAMERA.lookRise };
  return { eye, look };
}
