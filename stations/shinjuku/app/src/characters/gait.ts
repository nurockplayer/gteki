/** Distance-driven gait in model metres. A full cycle contains two steps. */
export interface FootPose { z: number; lift: number; pitch: number; planted: boolean }
export function sampleFoot(cycle: number, stride: number, stance: number, running: number,
  stairs: number, climbing: number, out: FootPose): void {
  const travel = stride * stance;
  out.planted = cycle < stance;
  out.pitch = 0;
  out.lift = 0;
  if (out.planted) {
    // d(z)/dt = stride * d(cycle)/dt = speed: exactly cancels forward motion.
    out.z = stride * cycle - travel / 2;
    const heel = Math.max(0, 1 - cycle / 0.09);
    const toe = Math.max(0, (cycle - stance + 0.1) / 0.1);
    out.pitch = heel * 0.12 - toe * 0.23;
  } else {
    const t = (cycle - stance) / (1 - stance);
    // Hermite endpoints match the stance velocity, avoiding a snap at toe-off.
    const ease = t * t * (3 - 2 * t);
    const tangent = stride * (1 - stance) * (t * (1 - t) * (1 - 2 * t));
    out.z = travel * (0.5 - ease) + tangent;
    out.lift = Math.sin(Math.PI * t) ** 2
      * (0.095 + running * 0.11 + stairs * (0.045 + Math.max(0, climbing) * 0.12));
    out.pitch = -0.23 * (1 - t) + 0.12 * t;
  }
  // Pitch about the ankle, with the sole remaining above the contact plane.
  out.lift += Math.max(0, (out.pitch > 0 ? 0.085 : 0.17) * Math.abs(Math.sin(out.pitch))
    + 0.09 * (Math.cos(out.pitch) - 1));
}
export function runningBlend(speed: number): number {
  const t = Math.max(0, Math.min(1, (speed - 1.8) / 1.8));
  return t * t * (3 - 2 * t);
}
export function strideLength(running: number): number { return 1.2 + running * 1.15; }
