/**
 * Third-person walker over the analytic WalkWorld (station ENU frame).
 * Free roam (keyboard / touch joystick) and guided autopilot along a route polyline.
 */
import { pointInRings, type WalkWorld, type XY } from "../../scene/layout.ts";

export interface CameraPoint extends XY { z: number }
/** A horizontal or pitched (soffit) plane clipped to rings: height z + slope·(p − origin). */
export interface CameraSurface { z: number; rings: XY[][]; origin?: XY; slope?: XY }

const heightAt = (s: CameraSurface, p: XY) => s.z + (s.slope?.x ?? 0) * (p.x - (s.origin?.x ?? 0)) + (s.slope?.y ?? 0) * (p.y - (s.origin?.y ?? 0));
const surfaceSpan = new WeakMap<CameraSurface, [number, number]>();
/** Height range of a surface over its outer ring (pitched soffits span more than z). */
function span(s: CameraSurface): [number, number] {
  if (!s.slope) return [s.z, s.z];
  let r = surfaceSpan.get(s);
  if (!r) {
    const zs = s.rings[0]!.map((p) => heightAt(s, p));
    r = [Math.min(...zs), Math.max(...zs)];
    surfaceSpan.set(s, r);
  }
  return r;
}

/** A small camera volume, swept in ENU. Uses the caller's camera collision walls,
 * plus the actual cut floor/ceiling polygons. Sampling
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
  const nearby = surfaces.filter((s) => {
    const [lo, hi] = span(s);
    return hi >= Math.min(anchor.z, desired.z) - radius && lo <= Math.max(anchor.z, desired.z) + radius;
  });
  const blocked = (p: CameraPoint) => {
    for (const s of nearby) {
      const sz = heightAt(s, p);
      if (Math.abs(sz - p.z) >= radius) continue;
      const r = Math.sqrt(radius * radius - (sz - p.z) ** 2);
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

/** Try raised/tilted positions behind the player before accepting a short boom. */
export function chooseFollowCamera(
  anchor: CameraPoint,
  yaw: number,
  pitch: number,
  distance: number,
  world: Pick<WalkWorld, "firstWallHit">,
  surfaces: readonly CameraSurface[],
  radius = 0.24,
): CameraPoint {
  const yaws = [0.35, -0.35, 0.7, -0.7, 1.25, -1.25, Math.PI / 2, -Math.PI / 2, Math.PI];
  const pitches = [...new Set([pitch, -0.5, -0.75, -1.0])];
  const candidates: { point: CameraPoint; length: number; yawOffset: number; pitchOffset: number; pitchIndex: number }[] = [];
  const attempt = (yawOffset: number, pi: number) => {
    const candidatePitch = pitches[pi]!;
    const candidateYaw = yaw + yawOffset;
    const cp = Math.cos(candidatePitch);
    const forward = { x: Math.sin(candidateYaw) * cp, y: Math.cos(candidateYaw) * cp, z: Math.sin(candidatePitch) };
    const desired = {
      x: anchor.x - forward.x * distance,
      y: anchor.y - forward.y * distance,
      z: anchor.z - forward.z * distance,
    };
    const point = sweepCamera(anchor, desired, world, surfaces, radius);
    const candidate = {
      point,
      length: Math.hypot(point.x - anchor.x, point.y - anchor.y, point.z - anchor.z),
      yawOffset,
      pitchOffset: candidatePitch - pitch,
      pitchIndex: pi,
    };
    candidates.push(candidate);
    return candidate;
  };
  // Most frames are clear: only one sweep is needed. If the boom is blocked,
  // raise and tilt on the same bearing before searching around the sides.
  const fullDistance = distance * 0.95;
  for (let pi = 0; pi < pitches.length; pi++) {
    const candidate = attempt(0, pi);
    if (candidate.length >= fullDistance) return candidate.point;
  }
  for (const yawOffset of yaws) {
    for (let pi = 0; pi < pitches.length; pi++) {
      const candidate = attempt(yawOffset, pi);
      if (candidate.length >= fullDistance) return candidate.point;
    }
  }
  candidates.sort((a, b) => {
    const score = (c: typeof a) => c.length - Math.abs(c.yawOffset) * 0.28 - Math.abs(c.pitchOffset) * 0.08;
    return score(b) - score(a) || a.pitchIndex - b.pitchIndex;
  });
  return candidates[0]?.point ?? anchor;
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
  /** true when the segment ending at this point is an escalator ride. */
  escalator?: boolean;
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
  /** Guided travel multiplier. Free walking is deliberately unaffected. */
  guideSpeedMultiplier: 1 | 2 | 4 = 1;
  /** True while the guide is carrying the player on an escalator. */
  carriedByEscalator = false;
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
    this.carriedByEscalator = false;
  }

  setGuideSpeed(multiplier: number) {
    this.guideSpeedMultiplier = multiplier === 4 ? 4 : multiplier === 2 ? 2 : 1;
  }

  stopGuide() {
    this.guide = null;
    this.carriedByEscalator = false;
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
      target = this.carriedByEscalator
        ? this.escalatorHorizontalSpeed(wish)
        : (input.run ? RUN_SPEED : WALK_SPEED) * this.guideSpeedMultiplier;
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
    if (this.carriedByEscalator) {
      // Boarding changes to a ride immediately; do not carry walking momentum
      // onto the moving run or make the avatar look as though it is walking.
      this.vx = tvx;
      this.vy = tvy;
    } else {
      this.vx += (tvx - this.vx) * k;
      this.vy += (tvy - this.vy) * k;
    }
    this.speed = Math.hypot(this.vx, this.vy);
    this.onRun = !this.carriedByEscalator && this.speed > 2.2;

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
    this.stridePhase = this.carriedByEscalator || this.speed < 0.12 ? 0 : (this.stridePhase + dt * cadence * Math.PI) % (Math.PI * 2);
  }

  private escalatorHorizontalSpeed(wish: XY) {
    if (!this.guide || this.guideIndex >= this.guide.length) return 0;
    const p = this.guide[this.guideIndex]!;
    const horizontal = Math.hypot(p.x - this.x, p.y - this.y);
    const vertical = Math.abs(p.z - this.z);
    const runLength = Math.hypot(horizontal, vertical);
    if (runLength < 1e-6) return 0;
    // WalkWorld advances height along the same projected run, so scale horizontal
    // velocity to keep the 3D travel speed at 0.5 m/s.
    return 0.5 * this.guideSpeedMultiplier * Math.hypot(wish.x, wish.y) * horizontal / runLength;
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
      this.carriedByEscalator = false;
      this.onGuideEvent?.({ type: "arrived", point: last });
      return { x: 0, y: 0 };
    }
    const p = g[this.guideIndex]!;
    if (p.elevator) {
      this.carriedByEscalator = false;
      this.teleport(p);
      this.guideIndex++;
      this.onGuideEvent?.({ type: "elevator", point: p });
      return { x: 0, y: 0 };
    }
    this.carriedByEscalator = !!p.escalator;
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const d = Math.hypot(dx, dy);
    const reach = (p.escalator ? 0.05 : 0.45) + this.speed * dt;
    if (d < reach || (!p.escalator && d < 1.2 && Math.abs(p.z - this.z) > 0.8)) {
      this.guideIndex++;
      return this.guideStep(dt);
    }
    // stuck safety: if we cannot make progress (blocked by a prop), nudge directly to the point
    if (Math.abs(p.z - this.z) > 1.2 && d < 0.8) this.teleport(p);
    return { x: dx / d, y: dy / d };
  }
}
