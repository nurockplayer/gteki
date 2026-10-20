/**
 * Third-person walker over the analytic WalkWorld (station ENU frame).
 * Free roam (keyboard / touch joystick) and guided autopilot along a route polyline.
 */
import { pointInRings, type WalkWorld, type XY } from "../../scene/layout.ts";

export interface CameraPoint extends XY { z: number }
export interface CameraSurface { z: number; rings: XY[][] }

/** A small camera volume, swept in ENU. Uses the same walls (including props and
 * railings) as the walker, plus the actual cut floor/ceiling polygons. Sampling
 * at half-radius prevents the boom from skipping thin walls at stair heads.
 * Re-sweep AFTER smoothing too: interpolation can otherwise cut a corner. */
export function sweepCamera(
  anchor: CameraPoint,
  desired: CameraPoint,
  world: Pick<WalkWorld, "firstWallHit">,
  surfaces: readonly CameraSurface[],
  radius = 0.24,
): CameraPoint {
  const length = Math.hypot(desired.x - anchor.x, desired.y - anchor.y, desired.z - anchor.z);
  if (length < 1e-6) return { ...anchor };
  const n = Math.max(1, Math.ceil(length / (radius * 0.5)));
  const nearby = surfaces.filter((s) => s.z >= Math.min(anchor.z, desired.z) - radius && s.z <= Math.max(anchor.z, desired.z) + radius);
  const blocked = (p: CameraPoint) => {
    for (const s of nearby) {
      if (Math.abs(s.z - p.z) >= radius) continue;
      const r = Math.sqrt(radius * radius - (s.z - p.z) ** 2);
      if ([{ x: 0, y: 0 }, { x: r, y: 0 }, { x: -r, y: 0 }, { x: 0, y: r }, { x: 0, y: -r }].some((o) => pointInRings({ x: p.x + o.x, y: p.y + o.y }, s.rings))) return true;
    }
    for (const dz of [0, -radius * 0.75, radius * 0.75]) {
      const r = Math.sqrt(radius * radius - dz * dz);
      for (const a of [0, Math.PI / 4, Math.PI / 2, Math.PI * 3 / 4]) {
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (world.firstWallHit({ x: p.x - x, y: p.y - y }, { x: p.x + x, y: p.y + y }, p.z + dz) < 1) return true;
      }
    }
    return false;
  };
  let safe = { ...anchor };
  for (let i = 1; i <= n; i++) {
    const p = { x: anchor.x + (desired.x - anchor.x) * i / n, y: anchor.y + (desired.y - anchor.y) * i / n, z: anchor.z + (desired.z - anchor.z) * i / n };
    if (blocked(p)) return safe;
    safe = p;
  }
  return safe;
}

export interface MoveInput {
  /** -1..1 forward/back, relative to camera yaw */
  forward: number;
  /** -1..1 right/left */
  strafe: number;
  run: boolean;
}

export interface GuidePoint {
  x: number;
  y: number;
  z: number;
  /** true when the segment ending at this point is an elevator ride (teleport). */
  elevator?: boolean;
  nodeId: string;
}

export const WALK_SPEED = 1.45;
export const RUN_SPEED = 3.6;
export const PLAYER_RADIUS = 0.3;
const RADIUS = PLAYER_RADIUS;

export class Player {
  x: number;
  y: number;
  z: number;
  /** compass heading of the body, radians (0 = north, +clockwise) */
  heading = 0;
  speed = 0;
  vx = 0;
  vy = 0;
  climbing = 0;
  onRun = false;
  /** Half-turn per footstep, using the existing synthesized audio cadence. */
  stridePhase = 0;
  guide: GuidePoint[] | null = null;
  guideIndex = 0;
  onGuideEvent: ((e: { type: "elevator" | "arrived"; point: GuidePoint }) => void) | null = null;
  /** seconds of input-free time (camera auto-follow) */
  idle = 0;

  constructor(
    private readonly world: WalkWorld,
    start: { x: number; y: number; z: number },
  ) {
    this.x = start.x;
    this.y = start.y;
    this.z = start.z;
  }

  teleport(p: { x: number; y: number; z: number }, heading?: number) {
    this.x = p.x;
    this.y = p.y;
    this.z = p.z;
    this.vx = this.vy = 0;
    this.speed = this.climbing = 0;
    this.stridePhase = 0;
    if (heading !== undefined) this.heading = heading;
  }

  startGuide(points: GuidePoint[]) {
    this.guide = points;
    this.guideIndex = 1;
  }

  stopGuide() {
    this.guide = null;
  }

  update(dt: number, input: MoveInput, cameraYaw: number) {
    dt = Math.min(dt, 0.05);
    let wish: XY = { x: 0, y: 0 };
    let target = input.run ? RUN_SPEED : WALK_SPEED;
    const manual = Math.abs(input.forward) > 0.05 || Math.abs(input.strafe) > 0.05;
    if (manual) {
      // camera yaw is compass heading of the camera's view direction
      const fx = Math.sin(cameraYaw);
      const fy = Math.cos(cameraYaw);
      const rx = Math.cos(cameraYaw);
      const ry = -Math.sin(cameraYaw);
      wish = { x: fx * input.forward + rx * input.strafe, y: fy * input.forward + ry * input.strafe };
      const m = Math.hypot(wish.x, wish.y);
      if (m > 1) wish = { x: wish.x / m, y: wish.y / m };
      target *= Math.min(1, m);
      this.idle = 0;
      if (this.guide) this.stopGuide();
    } else if (this.guide) {
      wish = this.guideStep(dt);
      target = input.run ? RUN_SPEED : WALK_SPEED;
      this.idle += dt;
    } else {
      this.idle += dt;
      target = 0;
    }

    // acceleration with snappy, game-like response
    const accel = manual || this.guide ? 9 : 12;
    const tvx = wish.x * target;
    const tvy = wish.y * target;
    const k = 1 - Math.exp(-accel * dt);
    this.vx += (tvx - this.vx) * k;
    this.vy += (tvy - this.vy) * k;
    this.speed = Math.hypot(this.vx, this.vy);
    this.onRun = this.speed > 2.2;

    if (this.speed > 0.02) {
      const want = Math.atan2(this.vx, this.vy);
      let d = want - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * (1 - Math.exp(-12 * dt));
    }

    this.climbing = 0;
    this.tryMove(this.vx * dt, this.vy * dt);
    // Match audio.ts's footstep cadence, including acceleration and running.
    const cadence = this.speed <= 1.4 ? 1.8 * this.speed / 1.4 : Math.min(3.4, 1.8 + (this.speed - 1.4) / 2.1);
    this.stridePhase = this.speed < 0.12 ? 0 : (this.stridePhase + dt * cadence * Math.PI) % (Math.PI * 2);
  }

  private tryMove(dx: number, dy: number) {
    const attempt = (nx: number, ny: number) => {
      const p = this.world.resolveWalls({ x: nx, y: ny }, this.z, RADIUS);
      const g = this.world.groundAt(p, this.z);
      if (g === null) return false;
      this.climbing = Math.max(-1, Math.min(1, (g - this.z) / Math.max(1e-3, Math.hypot(p.x - this.x, p.y - this.y)) / 0.6));
      this.x = p.x;
      this.y = p.y;
      this.z = g;
      return true;
    };
    if (attempt(this.x + dx, this.y + dy)) return;
    if (Math.abs(dx) > 1e-5 && attempt(this.x + dx, this.y)) return;
    if (Math.abs(dy) > 1e-5 && attempt(this.x, this.y + dy)) return;
    this.vx *= 0.5;
    this.vy *= 0.5;
  }

  private guideStep(dt: number): XY {
    const g = this.guide!;
    if (this.guideIndex >= g.length) {
      const last = g[g.length - 1]!;
      this.guide = null;
      this.onGuideEvent?.({ type: "arrived", point: last });
      return { x: 0, y: 0 };
    }
    const p = g[this.guideIndex]!;
    if (p.elevator) {
      this.teleport(p);
      this.guideIndex++;
      this.onGuideEvent?.({ type: "elevator", point: p });
      return { x: 0, y: 0 };
    }
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const d = Math.hypot(dx, dy);
    const reach = 0.45 + this.speed * dt;
    if (d < reach || (d < 1.2 && Math.abs(p.z - this.z) > 0.8)) {
      this.guideIndex++;
      return this.guideStep(dt);
    }
    // stuck safety: if we cannot make progress (blocked by a prop), nudge directly to the point
    if (Math.abs(p.z - this.z) > 1.2 && d < 0.8) this.teleport(p);
    return { x: dx / d, y: dy / d };
  }
}
