import type * as THREE from "three";
import type { StationBundle } from "@gteki/schema";
import type { Router } from "@gteki/navigation";
import { createAvatar, type Avatar } from "./avatar.ts";
import { createCharacterBatch } from "./characters/batch.ts";

/** Upper bound on ambient agents (each is a full avatar). */
export const CROWD_LIMIT = 80;
export interface CrowdOptions {
  max: number;
  seed?: number;
  /** Optional borrowed player rig, combined into the same draw; never disposed here. */
  playerAvatar?: Avatar;
}
export interface Crowd {
  group: THREE.Group;
  update(dt: number, focus: { x: number; y: number; z: number }): void; // player position (ENU)
  setMax(n: number): void;
  prepareRender(camera: THREE.Camera): void;
  /** current agents, for QA */
  readonly count: number;
  dispose(): void;
}

interface Point { x: number; y: number; z: number }
interface Segment {
  a: Point;
  b: Point;
  dx: number;
  dy: number;
  dz: number;
  length: number;
  horizontal: number;
  nx: number;
  ny: number;
  mode: StationBundle["edges"][number]["mode"];
  width: number;
}
interface Origin { point: Point; routes: Segment[][] }
interface SpawnPoint { route: Segment[]; edge: number; progress: number }
interface RoutedSegment { route: Segment[]; edge: number; segment: Segment }
interface Agent {
  avatar: Avatar;
  pose: { climbing: number; onStairs: boolean };
  route: Segment[];
  active: boolean;
  edge: number;
  progress: number;
  lift: number;
  speed: number;
  lane: number;
  offset: number;
  steer: number;
  pace: number;
  localSpawn: boolean;
  localWait: number;
  localMoveUntilWait: number;
  localWaitsRemaining: number;
  x: number;
  y: number;
  z: number;
}

/** Invented ambient activity, never a measurement or prediction of station crowds. */
export function createCrowd(
  THREE_: typeof THREE,
  bundle: StationBundle,
  router: Router,
  nodeZ: (id: string) => number,
  opts: CrowdOptions,
): Crowd {
  const group = new THREE_.Group();
  group.name = "Decorative commuters (simulated, not real crowd data)";
  group.userData.decorative = true;
  group.userData.disclaimer = "Invented ambient commuters; not real crowd data.";
  const agents: Agent[] = [];
  const avatars: Avatar[] = opts.playerAvatar ? [opts.playerAvatar] : [];
  const batch = createCharacterBatch(THREE_);
  group.add(batch.object);
  let count = 0;
  let disposed = false;
  let seed = (opts.seed ?? 0x4754454b) >>> 0;
  function random(): number {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const points = new Map<string, Point>();
  for (const n of bundle.nodes) {
    const z = nodeZ(n.id);
    if (Number.isFinite(n.position.x) && Number.isFinite(n.position.y) && Number.isFinite(z)) {
      points.set(n.id, { x: n.position.x, y: n.position.y, z });
    }
  }
  const connectors = new Set<string>();
  for (const poi of bundle.pois) {
    if (poi.category !== "exit" && poi.category !== "ticket_gate" && poi.category !== "platform" && poi.category !== "toilet") continue;
    for (const id of poi.connectorNodeIds) if (points.has(id)) connectors.add(id);
  }
  const origins: Origin[] = [];
  const profile = { fare: "ticketed", stepFree: false } as const;
  // Cache every directed POI pair once. Routing, avatar creation and scratch
  // allocation stay out of update(), including on arrival and recycling.
  for (const from of connectors) {
    const origin: Origin = { point: points.get(from)!, routes: [] };
    for (const to of connectors) {
      if (from === to) continue;
      const result = router.route(from, to, profile);
      if (!result.ok || result.nodeIds.length !== result.steps.length + 1) continue;
      const segments: Segment[] = [];
      let valid = true;
      for (let i = 0; i < result.steps.length; i++) {
        const a = points.get(result.nodeIds[i]!);
        const b = points.get(result.nodeIds[i + 1]!);
        if (!a || !b) { valid = false; break; }
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const length = Math.hypot(dx, dy, dz);
        const horizontal = Math.hypot(dx, dy);
        const mode = result.steps[i]!.mode;
        if (length < 1e-6 && mode !== "elevator") continue;
        segments.push({ a, b, dx, dy, dz, length, horizontal,
          nx: horizontal > 0 ? -dy / horizontal : 0,
          ny: horizontal > 0 ? dx / horizontal : 0,
          mode, width: mode === "stairs" || mode === "escalator" ? 0.25 : 0.6 });
      }
      if (valid && segments.length) origin.routes.push(segments);
    }
    if (origin.routes.length) origins.push(origin);
  }
  const routedSegments: RoutedSegment[] = [];
  const seenSegments = new Set<string>();
  for (const origin of origins) for (const route of origin.routes) for (let edge = 0; edge < route.length; edge++) {
    const s = route[edge]!;
    const key = `${s.a.x},${s.a.y},${s.a.z}>${s.b.x},${s.b.y},${s.b.z}:${s.mode}`;
    if (seenSegments.has(key)) continue;
    seenSegments.add(key);
    routedSegments.push({ route, edge, segment: s });
  }

  function distance(x: number, y: number, z: number, focus: Point): number {
    return Math.hypot(x - focus.x, y - focus.y) + Math.abs(z - focus.z) * 3;
  }
  function deactivate(a: Agent): void {
    if (a.active) count--;
    a.active = false;
    a.localSpawn = false;
    a.avatar.object.visible = false;
  }
  function segment(a: Agent): Segment {
    return a.route[Math.min(a.edge, a.route.length - 1)]!;
  }
  function place(a: Agent): void {
    const s = segment(a);
    const t = s.length > 0 ? a.progress / s.length : 0;
    // Taper to the graph node at corners/landings; no lateral teleport between
    // edges, and separation can never change the interpolated surface height.
    const taper = Math.min(1, a.progress, s.length - a.progress);
    const offset = Math.max(-s.width, Math.min(s.width, a.offset)) * taper;
    a.x = s.a.x + s.dx * t + s.nx * offset;
    a.y = s.a.y + s.dy * t + s.ny * offset;
    a.z = s.a.z + s.dz * t;
    a.avatar.object.position.set(a.x, a.z, -a.y);
    if (s.horizontal > 0) a.avatar.object.rotation.y = -Math.atan2(s.dx, s.dy);
  }
  function enter(a: Agent): void {
    a.progress = 0;
    const s = segment(a);
    a.lift = s.mode === "elevator" ? 20 : 0;
    a.offset = Math.max(-s.width, Math.min(s.width, a.offset));
  }
  function spawn(a: Agent, focus: Point): void {
    // Prefer an interior point on an already routed segment near the player.
    // These are positions on cached directed POI routes, never new graph links.
    let local: SpawnPoint | undefined;
    let localCandidates = 0;
    const localAgents = agents.reduce((total, other) => total + (other.active && other.localSpawn ? 1 : 0), 0);
    if (agents.length >= 6 && localAgents < 6) for (const candidate of routedSegments) {
      const { route, edge, segment: s } = candidate;
      if (s.mode === "elevator" || s.length < 1e-6) continue;
      const horizontal2 = s.horizontal * s.horizontal;
      const projected = horizontal2 > 1e-8
        ? ((focus.x - s.a.x) * s.dx + (focus.y - s.a.y) * s.dy) / horizontal2
        : 0.5;
      // Clamp away from nodes so lateral offsets taper on the segment and
      // do not place two people on a landing/turn.
      const endMargin = Math.min(2, s.length * 0.2);
      const projectedProgress = projected * s.length;
      // Offer a few metre-spaced points along the nearby portion of a long
      // corridor, which supports a small local group without stacking poses.
      for (let offset = -25; offset <= 25; offset += 3.5) {
        const candidateProgress = projectedProgress + offset;
        const progress = Math.max(endMargin, Math.min(s.length - endMargin, candidateProgress));
        const t = progress / s.length;
        const p = { x: s.a.x + s.dx * t, y: s.a.y + s.dy * t, z: s.a.z + s.dz * t };
        const levelDelta = Math.abs(p.z - focus.z);
        const d = Math.hypot(p.x - focus.x, p.y - focus.y, p.z - focus.z);
        // Keep the full walkable lateral strip outside the player's personal
        // space, and only use segments at the player's rendered level.
        if (levelDelta > 1.25 || d < 7.2 || d > 25) continue;
        let occupied = false;
        for (const other of agents) {
          if (other.active && other.lift === 0 && Math.hypot(other.x - p.x, other.y - p.y, other.z - p.z) < 1.2) {
            occupied = true; break;
          }
        }
        if (occupied) continue;
        if (random() < 1 / ++localCandidates) local = { route, edge, progress };
      }
    }
    if (local) {
      a.route = local.route;
      a.edge = local.edge;
      a.progress = local.progress;
      a.speed = 1.15 + random() * 0.4;
      a.lane = random() * 1.2 - 0.6;
      a.offset = Math.max(-segment(a).width, Math.min(segment(a).width, a.lane));
      a.lift = 0;
      a.active = true;
      a.localSpawn = true;
      a.localWait = 0;
      a.localMoveUntilWait = 3.5 + random() * 1.5;
      a.localWaitsRemaining = 2;
      count++;
      place(a);
      return;
    }
    let chosen: Origin | undefined;
    let tier = 2;
    let candidates = 0;
    for (let i = 0; i < origins.length; i++) {
      const o = origins[i]!;
      const p = o.point;
      const d = distance(p.x, p.y, p.z, focus);
      // There is no camera direction in this API, so avoid nearby spawning in
      // every direction. Leave room for the largest subsequent lateral offset.
      if (d > 110 || Math.hypot(p.x - focus.x, p.y - focus.y, p.z - focus.z) < 6.6) continue;
      let occupied = false;
      for (let j = 0; j < agents.length; j++) {
        const other = agents[j]!;
        if (other.active && other.lift === 0 && Math.hypot(other.x - p.x, other.y - p.y, other.z - p.z) < 0.8) {
          occupied = true; break;
        }
      }
      if (occupied) continue;
      const nextTier = d <= 70 ? 0 : 1;
      if (nextTier > tier) continue;
      if (nextTier < tier) { tier = nextTier; candidates = 0; }
      if (random() < 1 / ++candidates) chosen = o;
    }
    // Sparse/disconnected graphs may have no safe origin; retry next frame.
    if (!chosen) return;
    a.route = chosen.routes[Math.floor(random() * chosen.routes.length)]!;
    a.edge = 0;
    a.speed = 1.15 + random() * 0.4;
    a.lane = random() * 1.2 - 0.6;
    a.offset = a.lane;
    a.active = true;
    a.localSpawn = false;
    a.localWait = 0;
    a.localMoveUntilWait = 0;
    a.localWaitsRemaining = 0;
    count++;
    enter(a);
    place(a);
  }

  function update(dt: number, focus: Point): void {
    if (disposed || !Number.isFinite(dt) || dt < 0 || !Number.isFinite(focus.x) || !Number.isFinite(focus.y) || !Number.isFinite(focus.z)) return;
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]!;
      if (a.active && (a.edge >= a.route.length || distance(a.x, a.y, a.z, focus) > 110)) deactivate(a);
      if (!a.active) spawn(a, focus);
      a.steer = 0;
      a.pace = 1;
    }
    // Pairwise steering uses last frame's positions, independent of update order.
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]!;
      if (!a.active || a.lift > 0) continue;
      const sa = segment(a);
      for (let j = i + 1; j < agents.length; j++) {
        const b = agents[j]!;
        if (!b.active || b.lift > 0 || Math.abs(a.z - b.z) > 0.5) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d >= 0.9) continue;
        const sb = segment(b);
        // Break exact/collinear ties deterministically to give passing a side.
        const side = dx * sa.nx + dy * sa.ny;
        const ux = Math.abs(side) < 0.05 ? sa.nx : dx / Math.max(d, 1e-6);
        const uy = Math.abs(side) < 0.05 ? sa.ny : dy / Math.max(d, 1e-6);
        const push = (0.9 - d) * 2;
        a.steer += (ux * sa.nx + uy * sa.ny) * push;
        b.steer -= (ux * sb.nx + uy * sb.ny) * push;
        if (d < 0.7) {
          const pace = Math.max(0, (d - 0.5) / 0.2);
          if (dx * sa.dx + dy * sa.dy < 0) a.pace = Math.min(a.pace, pace);
          if (dx * sb.dx + dy * sb.dy > 0) b.pace = Math.min(b.pace, pace);
        }
      }
    }
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]!;
      if (!a.active) continue;
      const oldEdge = a.edge;
      const oldProgress = a.progress;
      const oldLift = a.lift;
      const oldOffset = a.offset;
      let time = dt;
      let animationSpeed = 0;
      while (a.edge < a.route.length && time > 0) {
        const s = segment(a);
        if (a.localSpawn && s.mode === "walk") {
          if (a.localWait > 0) {
            const elapsed = Math.min(time, a.localWait);
            a.localWait -= elapsed;
            time -= elapsed;
            if (a.localWait > 1e-8) break;
            a.localMoveUntilWait = 3.5 + random() * 1.5;
            continue;
          }
          if (a.localMoveUntilWait <= 1e-8 && a.localWaitsRemaining > 0) {
            a.localWait = 9 + random() * 2;
            a.localWaitsRemaining--;
            continue;
          }
        }
        if (a.lift > 0) {
          const elapsed = Math.min(time, a.lift);
          a.lift -= elapsed;
          time -= elapsed;
          if (a.lift > 1e-8) break;
          // Despawn in the car, reappear exactly at its destination after 20 s.
          a.lift = 0;
          a.progress = s.length;
          place(a);
          a.edge++;
          if (a.edge < a.route.length) enter(a);
          break;
        }
        const target = Math.max(-s.width, Math.min(s.width, a.lane + a.steer));
        a.offset += Math.max(-time, Math.min(time, target - a.offset));
        const speed = (s.mode === "escalator" ? 0.5 : s.mode === "stairs" ? 0.7 : a.speed) * a.pace;
        animationSpeed = s.mode === "escalator" ? 0 : speed;
        if (speed <= 0) { place(a); break; }
        let elapsed = Math.min(time, (s.length - a.progress) / speed);
        if (a.localSpawn && s.mode === "walk" && a.localWaitsRemaining > 0 && a.localMoveUntilWait > 0) {
          elapsed = Math.min(elapsed, a.localMoveUntilWait);
        }
        a.progress = Math.min(s.length, a.progress + speed * elapsed);
        time -= elapsed;
        if (a.localSpawn && s.mode === "walk" && a.localWaitsRemaining > 0) a.localMoveUntilWait -= elapsed;
        place(a);
        if (a.progress < s.length - 1e-8) break;
        a.edge++;
        if (a.edge < a.route.length) enter(a);
      }
      // Steering can converge at a tapered landing or while overtaking. Yield
      // a blocked step rather than let two bodies overlap; reuse the same pose
      // and route state so this guard allocates nothing and preserves heights.
      if (oldLift === 0 && a.lift === 0) {
        for (let j = 0; j < agents.length; j++) {
          const b = agents[j]!;
          if (i === j || !b.active || b.lift > 0) continue;
          if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) >= 0.5) continue;
          a.edge = oldEdge;
          a.progress = oldProgress;
          a.lift = oldLift;
          a.offset = oldOffset;
          animationSpeed = 0;
          place(a);
          break;
        }
      }
      if (distance(a.x, a.y, a.z, focus) > 110) { deactivate(a); continue; }
      // Recycle local walkers at the edge of the neighborhood. Their next
      // spawn remains on a cached routed segment and away from the player.
      if (a.localSpawn && distance(a.x, a.y, a.z, focus) > 40) { deactivate(a); continue; }
      const object = a.avatar.object;
      object.visible = a.lift === 0 && Math.abs(a.z - focus.z) <= 8;
      const viewerDistance = Math.hypot(a.x - focus.x, a.y - focus.y, a.z - focus.z);
      a.avatar.setDistance(viewerDistance);
      if (object.visible && viewerDistance <= 60 && dt > 0) {
        const s = segment(a);
        a.pose.onStairs = s.mode === "stairs";
        a.pose.climbing = s.mode === "escalator" || a.edge >= a.route.length ? 0
          : Math.max(-1, Math.min(1, s.dz / Math.max(1e-6, s.horizontal) / 0.6));
        a.avatar.update(dt, animationSpeed, a.pose);
      }
    }
    batch.sync(avatars);
  }
  function setMax(n: number): void {
    if (disposed) return;
    const max = Number.isFinite(n) ? Math.max(0, Math.min(CROWD_LIMIT, Math.floor(n))) : 0;
    while (agents.length > max) {
      const a = agents.pop()!;
      avatars.pop();
      deactivate(a);
      group.remove(a.avatar.object);
      a.avatar.dispose();
    }
    while (agents.length < max) {
      const avatar = createAvatar(THREE_, 1 + (agents.length % 7));
      avatar.object.visible = false;
      avatar.object.userData.decorative = true;
      group.add(avatar.object);
      avatars.push(avatar);
      agents.push({ avatar, pose: { climbing: 0, onStairs: false }, route: [],
        active: false, edge: 0, progress: 0, lift: 0, speed: 0, lane: 0,
        offset: 0, steer: 0, pace: 1, localSpawn: false, localWait: 0,
        localMoveUntilWait: 0, localWaitsRemaining: 0, x: 0, y: 0, z: 0 });
    }
    batch.sync(avatars);
  }
  function dispose(): void {
    if (disposed) return;
    setMax(0);
    disposed = true;
    batch.dispose();
    origins.length = 0;
    routedSegments.length = 0;
    seenSegments.clear();
    group.clear();
    group.removeFromParent();
  }
  setMax(opts.max);
  return { group, update, setMax, prepareRender: batch.prepare, get count() { return count; }, dispose };
}
