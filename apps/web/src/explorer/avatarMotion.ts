import { angleDelta } from "./walker.ts";

/** A jump longer than this between frames is a teleport (spawn, station switch), not walking. */
const TELEPORT_M = 2;
/** How fast the body turns toward where it is going (1/s). */
const TURN_RATE = 10;

/**
 * Body heading and ground speed from the walker's motion: the character faces where it actually goes
 * (strafing turns the body, the camera keeps its own yaw), turns smoothly, and stands still facing the
 * camera after a teleport instead of sprinting for one frame.
 */
export function avatarMotion(prev: { x: number; z: number }, cur: { x: number; z: number }, dt: number, bodyYaw: number, cameraYaw: number): { yaw: number; speed: number } {
  const dx = cur.x - prev.x, dz = cur.z - prev.z;
  const d = Math.hypot(dx, dz);
  if (d > TELEPORT_M) return { yaw: cameraYaw, speed: 0 };
  if (dt <= 0 || d < 1e-4) return { yaw: bodyYaw, speed: 0 };
  const heading = Math.atan2(-dx, -dz);
  return { yaw: bodyYaw + angleDelta(bodyYaw, heading) * Math.min(1, dt * TURN_RATE), speed: d / dt };
}
