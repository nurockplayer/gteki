/** Body yaw (radians, renderer frame) to clockwise-from-north heading in [0, 360). */
export function headingFromYaw(yaw: number): number {
  return ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
}
