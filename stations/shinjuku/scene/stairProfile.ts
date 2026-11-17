import type { XYZ } from "./layout.ts";
import { stableHypot } from "./stable-hypot.ts";

/** Shared visible tread dimensions and the landing-continuous nosing walk surface. */
export function stairProfile(lo: XYZ, hi: XYZ) {
  const dz = hi.z - lo.z;
  const L = stableHypot(hi.x - lo.x, hi.y - lo.y) || 1;
  const steps = Math.max(2, Math.round(dz / 0.165));
  const rise = dz / steps;
  const tread = L / steps;
  const treadTop = (i: number) => lo.z + rise * (i + 1);
  const walkZ = (s: number) => {
    if (s <= -tread) return lo.z;
    if (s >= L) return hi.z;
    const top = s >= L - tread ? hi.z : lo.z + dz * (s + tread) / L;
    const lift = s < 0 ? (s + tread) / tread : s > L - tread ? (L - s) / tread : 1;
    return top + 0.015 * lift;
  };
  return { steps, rise, tread, L, treadTop, walkZ };
}
