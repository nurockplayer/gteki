import { WALKER_BODY } from "@gteki/scene-api";
/**
 * Engine-free walker math (renderer frame: X east, Y up, Z south). Kept pure for unit tests;
 * mesh raycasts live in the explorer and feed `groundY` in.
 */

export interface Segment2 {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  yMin: number;
  yMax: number;
}

/** Station-ENU wall → renderer-frame segment. */
export function wallToRenderer(w: { a: { x: number; y: number }; b: { x: number; y: number }; zMin: number; zMax: number }): Segment2 {
  return { ax: w.a.x, az: -w.a.y, bx: w.b.x, bz: -w.b.y, yMin: w.zMin, yMax: w.zMax };
}

/** Push a circle (x, z, radius) out of every wall segment whose height span overlaps the body. */
export function resolveWalls(x: number, z: number, radius: number, feetY: number, bodyHeight: number, walls: readonly Segment2[]): { x: number; z: number } {
  let px = x;
  let pz = z;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const w of walls) {
      if (w.yMax < feetY + WALKER_BODY.bodyBottomM || w.yMin > feetY + bodyHeight) continue;
      const dx = w.bx - w.ax;
      const dz = w.bz - w.az;
      const len2 = dx * dx + dz * dz;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - w.ax) * dx + (pz - w.az) * dz) / len2));
      const cx = w.ax + dx * t;
      const cz = w.az + dz * t;
      const ox = px - cx;
      const oz = pz - cz;
      const d = Math.hypot(ox, oz);
      if (d >= radius) continue;
      if (d < 1e-9) {
        // Exactly on the wall: push along the wall normal.
        const n = Math.hypot(dx, dz) || 1;
        px += (-dz / n) * radius;
        pz += (dx / n) * radius;
      } else {
        px = cx + (ox / d) * radius;
        pz = cz + (oz / d) * radius;
      }
      moved = true;
    }
    if (!moved) break;
  }
  return { x: px, z: pz };
}

export interface GroundRule {
  /** Highest step the walker climbs without a ramp/stairs mesh. */
  stepUp: number;
  /** Largest drop accepted in one move (stairs going down). */
  stepDown: number;
}

export const DEFAULT_GROUND: GroundRule = { stepUp: WALKER_BODY.stepUpM, stepDown: WALKER_BODY.stepDownM };

/** Accept a move only onto known walkable ground: no walking into the void or up walls. */
export function acceptGround(currentY: number, groundY: number | null, rule: GroundRule = DEFAULT_GROUND): boolean {
  if (groundY === null) return false;
  const dy = groundY - currentY;
  return dy <= rule.stepUp && dy >= -rule.stepDown;
}

/** Point and tangent at arc length `s` along a polyline. */
export function samplePolyline(points: readonly { x: number; y: number; z: number }[], cumulative: readonly number[], s: number): { x: number; y: number; z: number; tx: number; tz: number; segment: number } {
  const total = cumulative[cumulative.length - 1] ?? 0;
  const clamped = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i]! < clamped) i++;
  const a = points[i - 1]!;
  const b = points[i] ?? a;
  const segLen = (cumulative[i] ?? 0) - (cumulative[i - 1] ?? 0);
  const t = segLen > 0 ? (clamped - cumulative[i - 1]!) / segLen : 0;
  let tx = b.x - a.x;
  let tz = b.z - a.z;
  const h = Math.hypot(tx, tz);
  if (h > 1e-6) { tx /= h; tz /= h; } else { tx = 0; tz = 0; }
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, tx, tz, segment: i - 1 };
}

export function cumulativeLengths(points: readonly { x: number; y: number; z: number }[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    out.push(out[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  return out;
}

/** Shortest signed angle from a to b (radians). */
export function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/** Guide speed multipliers the HUD cycles through. */
export const GUIDE_SPEEDS = [1, 2, 4] as const;

export function nextGuideSpeed(current: number): number {
  const i = GUIDE_SPEEDS.indexOf(current as (typeof GUIDE_SPEEDS)[number]);
  return GUIDE_SPEEDS[(i + 1) % GUIDE_SPEEDS.length]!;
}
