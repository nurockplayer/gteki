/**
 * Third-person walker over the analytic WalkWorld (station ENU frame).
 * Free roam (keyboard / touch joystick) and guided autopilot along a route polyline.
 */
import type { WalkWorld, XY } from "../../scene/layout.ts";

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
const RADIUS = 0.3;

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

    this.tryMove(this.vx * dt, this.vy * dt);
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
