/** Replay fixtures use the shipped scene, walker math and actual Three ray targets. */
import * as THREE from "three";
import { WALKER_BODY, type StationScene } from "@gteki/scene-api";
import type { BuiltStation } from "../scene/build.ts";
import { pointInRings, railingWalls, WalkWorld, type XY, type XYZ, type Plan, type WallSeg } from "../scene/layout.ts";
import { gateMachines, containsPolygons, type Fence } from "../scene/fare-fence.ts";
import { laneBands, explorerBands, segmentDistance2, surfaceGrid, lanePatches, proxyPatches, gateCrossing, type WalkerAudit } from "./fare-boundary-audit.ts";
import { resolveWalls, acceptGround, wallToRenderer, DEFAULT_GROUND } from "../../../apps/web/src/explorer/walker.ts";
import { castAll, castTargets } from "../../../apps/web/src/explorer/raycast.ts";
import { accelerateRaycasts, nearbyTargets } from "./fare-replay-rays.ts";
import { Player } from "../app/src/player.ts";

export function closest(p: XY, a: XY, b: XY): XY {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return { x: a.x + dx * t, y: a.y + dy * t };
}
export const distance = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
export const fencesOf = (built: BuiltStation) => built.propWalls.filter(w => "reason" in w) as Fence[];
export interface End { id: string; p: XYZ; other: XY; fence?: Fence; gate?: string }
export function barrierEnds(built: BuiltStation): End[] {
  const fences = fencesOf(built);
  const ends: End[] = fences.flatMap(f => [
    { id: `${f.id}:a`, p: { ...f.a, z: f.zMin + .05 }, other: f.b, fence: f },
    { id: `${f.id}:b`, p: { ...f.b, z: f.zMin + .05 }, other: f.a, fence: f },
  ]);
  for (const g of built.layout.gates.filter((g, i, all) => all.findIndex(h => distance(g.center, h.center) < .02 && Math.abs(g.center.z - h.center.z) < .02) === i))
    for (const [i, c] of gateMachines(g).entries()) ends.push({ id: `gate:${g.edgeId}:${i}`, p: { ...c, z: g.center.z }, other: g.center, gate: g.edgeId });
  return ends;
}
/** Target the exact throat of any tolerated (<2 cm) non-intersecting join as well. */
export function replayEnds(built: BuiltStation): End[] {
  const ends = barrierEnds(built), walls = laneBands([...built.layout.levels.flatMap(l => l.walls), ...built.layout.runWalls, ...railingWalls(built.layout), ...built.propWalls]);
  const extra: End[] = [];
  for (const end of ends) {
    if (!end.fence) continue;
    const options = walls.filter(w => end.p.z >= w.min && end.p.z <= w.max &&
      !(distance(w.a, end.fence!.a) < 1e-8 && distance(w.b, end.fence!.b) < 1e-8))
      .map(w => ({ w, q: closest(end.p, w.a, w.b) })).map(v => ({ ...v, d: distance(end.p, v.q) })).sort((a, b) => a.d - b.d);
    const near = options[0];
    if (!near || near.d < 1e-8 || near.d > .020000001 || segmentDistance2(end.fence.a, end.fence.b, near.w.a, near.w.b) < 1e-16) continue;
    extra.push({ ...end, id: `join-throat:${end.id}`, p: { x: (end.p.x + near.q.x) / 2, y: (end.p.y + near.q.y) / 2, z: end.p.z } });
  }
  return [...ends, ...extra];
}
export function endpointClosure(built: BuiltStation, scene: StationScene) {
  const lane = laneBands([...built.layout.levels.flatMap(l => l.walls), ...built.layout.runWalls, ...railingWalls(built.layout), ...built.propWalls]), shared = explorerBands(scene.walls ?? []);
  const segmentKey = (w: { a: XY; b: XY }) => `${w.a.x},${w.a.y},${w.b.x},${w.b.y}`;
  const sharedBySegment = new Map<string, typeof shared>();
  for (const w of shared) { const key = segmentKey(w), list = sharedBySegment.get(key) ?? []; list.push(w); sharedBySegment.set(key, list); }
  return barrierEnds(built).flatMap(end => {
    // The SAME joining segment must block both bodies, not two unrelated nearest walls.
    const common = lane.filter(w => { const other = sharedBySegment.get(segmentKey(w));
      return other?.some(w => end.p.z >= w.min && end.p.z <= w.max); });
    const candidates = (bands: typeof lane) => bands.filter(w => end.p.z >= w.min && end.p.z <= w.max &&
      !(end.fence && distance(w.a, end.fence.a) < 1e-7 && distance(w.b, end.fence.b) < 1e-7) &&
      // A gate's own machine does not close its outer row port.
      !(end.gate && distance(closest(end.p, w.a, w.b), end.p) < 1e-7 && Math.abs(distance(w.a, w.b) - 1.5) < .001))
      .map(w => ({ distance: distance(end.p, closest(end.p, w.a, w.b)), a: w.a, b: w.b }))
      .sort((a, b) => a.distance - b.distance);
    const a = candidates(common), b = candidates(shared);
    return (a[0]?.distance ?? Infinity) <= .020000001 && (b[0]?.distance ?? Infinity) <= .020000001 ? [] : [{ ...end, nearestLane: a[0], nearestExplorer: b[0] }];
  });
}

/** Active sets change only at wall body-band endpoints. Guard floating-point boundaries. */
function bandKeys(bounds: number[]) {
  bounds = [...new Set(bounds)].sort((a, b) => a - b);
  return (z: number) => {
    let lo = 0, hi = bounds.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (bounds[mid]! <= z) lo = mid + 1; else hi = mid; }
    return [bounds[lo], bounds[lo - 1]].some(b => b !== undefined && Math.abs(b - z) < 1e-9) ? `at:${z}` : `band:${lo}`;
  };
}
export class ExplorerReplay {
  /** Floor selected by the actual accepted down-ray, before visual vertical damping. */
  support: number | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly walls;
  private readonly wallCells = new Map<string, typeof this.walls>();
  private readonly active = new Map<string, typeof this.walls>();
  private readonly bandKey;
  private readonly cellActive = new Map<string, typeof this.walls>();
  private readonly grounds;
  private readonly colliders;
  constructor(readonly scene: StationScene) {
    this.walls = (scene.walls ?? []).map(wallToRenderer);
    this.bandKey = bandKeys(this.walls.flatMap(w => [w.yMin - WALKER_BODY.bodyTopM, w.yMax - WALKER_BODY.bodyBottomM]));
    this.grounds = nearbyTargets(castTargets(scene.walkable, scene.colliders));
    this.colliders = nearbyTargets(castTargets(scene.colliders ?? [], scene.walkable));
    for (const w of this.walls)
      for (let x = Math.floor((Math.min(w.ax, w.bx) - .3) / 2); x <= Math.floor((Math.max(w.ax, w.bx) + .3) / 2); x++)
        for (let z = Math.floor((Math.min(w.az, w.bz) - .3) / 2); z <= Math.floor((Math.max(w.az, w.bz) + .3) / 2); z++) {
          const key = `${x},${z}`, list = this.wallCells.get(key) ?? []; list.push(w); this.wallCells.set(key, list);
        }
  }
  ground(p: XYZ) {
    this.ray.set(new THREE.Vector3(p.x, p.z + DEFAULT_GROUND.stepUp + .05, -p.y), new THREE.Vector3(0, -1, 0));
    this.ray.far = DEFAULT_GROUND.stepUp + DEFAULT_GROUND.stepDown + .1;
    return castAll(this.ray, this.grounds(this.ray))[0]?.point.y ?? null;
  }
  push(p: XYZ, fast = true) {
    // Empty-list fast path is exact: no initial circle overlap means resolveWalls exits
    // its first pass unchanged. Any possible overlap uses the FULL original ordered list.
    const band = this.bandKey(p.z);
    let active = this.active.get(band);
    if (!active) {
      active = this.walls.filter(w => w.yMax >= p.z + WALKER_BODY.bodyBottomM && w.yMin <= p.z + WALKER_BODY.bodyTopM);
      if (this.active.size >= 32) this.active.delete(this.active.keys().next().value!);
      this.active.set(band, active);
    }
    const key = `${Math.floor(p.x / 2)},${Math.floor(-p.y / 2)}`;
    const cacheKey = `${key},${band}`;
    let candidates = this.cellActive.get(cacheKey);
    if (!candidates) {
      candidates = (this.wallCells.get(key) ?? []).filter(w => w.yMax >= p.z + WALKER_BODY.bodyBottomM && w.yMin <= p.z + WALKER_BODY.bodyTopM);
      if (this.cellActive.size >= 4096) this.cellActive.delete(this.cellActive.keys().next().value!);
      this.cellActive.set(cacheKey, candidates);
    }
    const overlap = !fast || candidates.some(w =>
      distance({ x: p.x, y: -p.y }, closest({ x: p.x, y: -p.y }, { x: w.ax, y: w.az }, { x: w.bx, y: w.bz })) < .3);
    // Filtering inactive bands preserves order and only removes iterations that the
    // imported function immediately skips. `fast=false` remains the full-list oracle.
    const pushed = resolveWalls(p.x, -p.y, .3, p.z, WALKER_BODY.bodyTopM, !fast ? this.walls : overlap ? active : []);
    return { x: pushed.x, y: -pushed.z, z: p.z };
  }
  step(pos: XYZ, dir: XY, speed: number, dt: number): XYZ {
    const target = this.push({ x: pos.x + dir.x * speed * dt, y: pos.y + dir.y * speed * dt, z: pos.z });
    const from = new THREE.Vector3(pos.x, pos.z, -pos.y), to = new THREE.Vector3(target.x, pos.z, -target.y);
    const vector = to.clone().sub(from), len = vector.length();
    if (len >= 1e-6) {
      vector.divideScalar(len);
      for (const h of [.5, 1.2]) {
        this.ray.set(from.clone().add(new THREE.Vector3(0, h, 0)), vector);
        this.ray.far = len + .3;
        if (castAll(this.ray, this.colliders(this.ray)).length) return pos;
      }
    }
    const ground = this.ground(target);
    if (!acceptGround(pos.z, ground, DEFAULT_GROUND)) return pos;
    this.support = ground;
    return { ...target, z: THREE.MathUtils.damp(pos.z, ground!, 18, dt) };
  }
}

/** Same WalkWorld, with only provably inactive bands removed; ground remains the real world. */
export function laneReplayWorld(built: BuiltStation) {
  const walls = [...built.layout.levels.flatMap(l => l.walls), ...built.layout.runWalls, ...railingWalls(built.layout), ...built.propWalls];
  const bands = laneBands(walls), key = bandKeys(bands.flatMap(w => [w.min, w.max]));
  const active = new Map<string, WalkWorld>();
  const empty = { ...built.layout, levels: [], pads: [], linkStrips: [], streetPads: [], runs: [], runWalls: [] };
  const resolve = (p: XY, z: number, radius: number) => {
    const id = key(z); let world = active.get(id);
    if (!world) {
      world = new WalkWorld(empty);
      world.addWalls(walls.filter(w => z + 1.7 >= w.zMin && z + .3 <= w.zMax && (w.bodyMin === undefined || z >= w.bodyMin) && (w.bodyMax === undefined || z <= w.bodyMax)));
      if (active.size >= 32) active.delete(active.keys().next().value!); active.set(id, world);
    }
    return world.resolveWalls(p, z, radius);
  };
  return { groundAt: built.world.groundAt.bind(built.world), resolveWalls: resolve } as WalkWorld;
}

/** Independent public-footprint and fare labels; no length/dead-end exemption. */
export function publicLabels(built: BuiltStation, plan: Plan) {
  const source = plan.levels.map(l => ({ z: l.renderElevationM, spaces: l.spaces }));
  const network = [...built.layout.linkStrips, ...built.layout.pads.filter(p => p.spaceId.startsWith("pad:")), ...built.layout.streetPads];
  const guardedSources = new Set(fencesOf(built).filter(f => f.restrictedNodeId).map(f => f.restrictedSpaceId).filter(Boolean));
  const prepared = source.map(l => ({ ...l, public: containsPolygons(l.spaces.filter(s => !s.restricted).map(s => s.rings)),
    restricted: l.spaces.filter(s => s.restricted), restrictedHas: containsPolygons(l.spaces.filter(s => s.restricted).map(s => s.rings)),
    paid: containsPolygons(l.spaces.filter(s => !s.restricted && s.toll === "paid").map(s => s.rings)),
    free: containsPolygons(l.spaces.filter(s => !s.restricted && s.toll === "free").map(s => s.rings)) }));
  const net = [...new Set(network.map(n => n.z))].map(z => ({ z, has: containsPolygons(network.filter(n => n.z === z).map(n => n.rings)) }));
  return (p: XYZ) => {
    const levels = prepared.filter(l => Math.abs(l.z - p.z) < .2);
    // A source restriction wins over the procedural width of a network strip. Only
    // the <2 cm boundary-alignment sliver behind an installed return is tolerated;
    // the actual-walker replay must independently prove that it cannot admit a body.
    const restricted = levels.some(l => l.restrictedHas(p) && l.restricted.some(s => {
      if (!pointInRings(p, s.rings)) return false;
      const guarded = guardedSources.has(s.id);
      const depth = Math.min(...s.rings.flatMap(r => r.map((a, i) => distance(p, closest(p, a, r[(i + 1) % r.length]!)))));
      return !guarded || depth >= .02;
    }));
    const mapped = !restricted && (levels.some(l => l.public(p)) || net.some(n => Math.abs(n.z - p.z) < .2 && n.has(p)) || built.layout.runs.some(r => {
      const q = closest(p, r.a, r.b), len = distance(r.a, r.b), t = len ? distance(r.a, q) / len : 0;
      return distance(p, q) <= r.width / 2 && Math.abs(r.a.z + (r.b.z - r.a.z) * t - p.z) < .2;
    }));
    return { mapped, fare: levels.some(l => l.paid(p)) ? "paid" : levels.some(l => l.free(p)) ? "free" : null };
  };
}

export const APPROACHES = ["toward", "oblique-30", "oblique+30", "oblique-60", "oblique+60", "tangent-", "tangent+", "slide-", "slide+"] as const;
export type Approach = typeof APPROACHES[number];
export type Walker = "lane" | "explorer";
export interface ReplayLeak { end: string; approach: Approach; walker: Walker; fps: number; run: boolean; from: XYZ; to: XYZ; kind: string }
export function replayEnvironment(built: BuiltStation, scene: StationScene, plan: Plan) {
  const explorer = new ExplorerReplay(scene), labels = publicLabels(built, plan), laneWorld = laneReplayWorld(built);
  const grid = surfaceGrid([...lanePatches(built.layout), ...proxyPatches(scene.walkable)]);
  const seedCache = new Map<string, { lane?: XYZ; explorer?: XYZ }>();
  const seeds = (end: End, resolution = .25) => {
    const result: { lane?: XYZ; explorer?: XYZ }[] = [];
    const stride = Math.max(1, Math.round(resolution / .25));
    for (let ix = Math.floor((end.p.x - 3) / .25); ix <= Math.ceil((end.p.x + 3) / .25); ix++)
      for (let iy = Math.floor((end.p.y - 3) / .25); iy <= Math.ceil((end.p.y + 3) / .25); iy++) {
        if (ix % stride || iy % stride) continue;
        const p = { x: (ix + .5) * .25, y: (iy + .5) * .25 };
        if (distance(p, end.p) > 3) continue;
        for (const z of grid.get(`${ix},${iy}`) ?? []) {
          if (z < end.p.z - 1.75 || z > end.p.z + .85) continue;
          const key = `${ix},${iy},${z}`;
          let row = seedCache.get(key);
          if (!row) {
            row = {};
            const a = built.world.groundAt(p, z), b = explorer.ground({ ...p, z });
            if (a !== null && labels({ ...p, z: a }).mapped && distance(built.world.resolveWalls(p, a, .3), p) < 1e-7) row.lane = { ...p, z: a };
            if (acceptGround(z, b) && labels({ ...p, z: b! }).mapped && distance(explorer.push({ ...p, z: b! }), p) < 1e-7) row.explorer = { ...p, z: b! };
            seedCache.set(key, row);
          }
          if (row.lane || row.explorer) result.push(row);
        }
      }
    for (const radius of [.31, .36, .6]) for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4, p = { x: end.p.x + Math.cos(angle) * radius, y: end.p.y + Math.sin(angle) * radius };
      const row: { lane?: XYZ; explorer?: XYZ } = {};
      const a = built.world.groundAt(p, end.p.z), b = explorer.ground({ ...p, z: end.p.z });
      if (a !== null && labels({ ...p, z: a }).mapped && distance(built.world.resolveWalls(p, a, .3), p) < 1e-7) row.lane = { ...p, z: a };
      if (acceptGround(end.p.z, b) && labels({ ...p, z: b! }).mapped && distance(explorer.push({ ...p, z: b! }), p) < 1e-7) row.explorer = { ...p, z: b! };
      if (row.lane || row.explorer) result.push(row);
    }
    return result;
  };
  const gateWorld = { propBands: laneBands(built.propWalls) } as WalkerAudit;
  let frames = 0;
  const replay = (end: End, start: XYZ, approach: Approach, walker: Walker, fps: number, run: boolean): ReplayLeak | null => {
    const tangent = { x: end.p.x - end.other.x, y: end.p.y - end.other.y }, len = Math.hypot(tangent.x, tangent.y) || 1;
    tangent.x /= len; tangent.y /= len;
    const normal = { x: -tangent.y, y: tangent.x };
    const toward = { x: end.p.x - start.x, y: end.p.y - start.y }, d = Math.hypot(toward.x, toward.y) || 1;
    toward.x /= d; toward.y /= d;
    let pos = { ...start }, last = labels(pos).fare, lastKnown = pos;
    explorer.support = start.z;
    const player = walker === "lane" ? new Player(laneWorld, start) : null;
    const speed = run ? (walker === "lane" ? 3.6 : 3.4) : 1.45;
    const phases: { dir: XY; length: number }[] = [];
    if (approach.startsWith("slide")) {
      const side = Math.sign((start.x - end.p.x) * normal.x + (start.y - end.p.y) * normal.y) || 1;
      const sign = approach === "slide+" ? 1 : -1;
      phases.push({ dir: { x: -normal.x * side, y: -normal.y * side }, length: 3.5 },
        { dir: { x: tangent.x * sign, y: tangent.y * sign }, length: d + .6 },
        { dir: { x: -normal.x * side, y: -normal.y * side }, length: 1.2 });
    } else if (approach.startsWith("tangent")) {
      const sign = approach === "tangent+" ? 1 : -1;
      phases.push({ dir: { x: tangent.x * sign, y: tangent.y * sign }, length: d + 1 });
    } else {
      const angle = (approach === "toward" ? 0 : Number(approach.replace("oblique", ""))) * Math.PI / 180;
      phases.push({ dir: { x: toward.x * Math.cos(angle) - toward.y * Math.sin(angle), y: toward.x * Math.sin(angle) + toward.y * Math.cos(angle) }, length: d + 1 });
    }
    // Cruise-speed starts are physically attainable and expose the longest per-frame step.
    if (player) { const yaw = Math.atan2(phases[0]!.dir.x, phases[0]!.dir.y); player.vx = Math.sin(yaw) * speed; player.vy = Math.cos(yaw) * speed; }
    for (const phase of phases) {
      const yaw = Math.atan2(phase.dir.x, phase.dir.y);
      for (let i = 0; i < Math.ceil(phase.length / speed * fps); i++) {
        const from = pos;
        if (player) { player.update(1 / fps, { forward: 1, strafe: 0, run }, yaw); pos = { x: player.x, y: player.y, z: player.z }; }
        else pos = explorer.step(pos, phase.dir, speed, 1 / fps);
        frames++;
        const supported = walker === "explorer" ? { ...pos, z: explorer.support ?? pos.z } : pos;
        const next = labels(supported);
        if (!next.mapped) return { end: end.id, approach, walker, fps, run, from, to: pos, kind: "verified → unmapped/restricted" };
        if (next.fare && last && next.fare !== last && !gateCrossing(lastKnown, supported, built.layout, plan, gateWorld))
          return { end: end.id, approach, walker, fps, run, from, to: pos, kind: `${last} → ${next.fare}` };
        if (next.fare) { last = next.fare; lastKnown = supported; }
        // For fixed input, an unchanged explorer position is a fixed point. A lane
        // fixed point also needs settled velocity (otherwise acceleration could escape).
        if (distance(from, pos) < 1e-10 && Math.abs(from.z - pos.z) < 1e-10 &&
          (!player || Math.hypot(player.vx - Math.sin(yaw) * speed, player.vy - Math.cos(yaw) * speed) < 1e-8)) break;
      }
    }
    return null;
  };
  return { explorer, seeds, replay, labels, frames: () => frames };
}

/** Delete/shorten exactly one shipped piece in BOTH physical representations. */
export function mutateFence(built: BuiltStation, scene: StationScene, fence: Fence, mode: "remove" | "shorten") {
  const length = distance(fence.a, fence.b);
  if (mode === "shorten" && length <= .7) throw new Error("Shortening control needs a >0.7 m piece");
  const changed: Fence = { ...fence, a: { x: fence.a.x + (fence.b.x - fence.a.x) * .7 / length, y: fence.a.y + (fence.b.y - fence.a.y) * .7 / length } };
  const matches = (w: { a: XY; b: XY; zMin: number; zMax: number }) => distance(w.a, fence.a) < 1e-8 && distance(w.b, fence.b) < 1e-8 && Math.abs(w.zMin - fence.zMin) < 1e-7 && Math.abs(w.zMax - fence.zMax) < 1e-7;
  const props = built.propWalls.flatMap(w => matches(w) ? mode === "remove" ? [] : [changed] : [w]);
  const world = new WalkWorld(built.layout); world.addWalls(props);
  const wallMesh = scene.colliders!.find(o => o.name === "wall collider (invisible)") as THREE.Mesh;
  const geometry = wallMesh.geometry.clone(), positions = geometry.getAttribute("position");
  let vertex = 0, removed = 0;
  for (const w of scene.walls ?? []) {
    if (w.zMax <= w.zMin) continue;
    if (matches(w)) {
      removed++;
      const a = mode === "remove" ? w.a : changed.a, b = mode === "remove" ? w.a : w.b;
      for (let i = 0; i < 4; i++) { const p = i === 0 || i === 3 ? a : b; positions.setX(vertex + i, p.x); positions.setZ(vertex + i, -p.y); }
    }
    vertex += 4;
  }
  if (removed !== 1) throw new Error(`Mutation must affect exactly one collider quad, got ${removed}`);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, wallMesh.material); mesh.matrixWorld.copy(wallMesh.matrixWorld);
  const restore = accelerateRaycasts([mesh]);
  const walls = scene.walls!.flatMap(w => matches(w) ? mode === "remove" ? [] : [{ ...w, a: changed.a }] : [w]);
  return {
    built: { ...built, world, propWalls: props },
    scene: { ...scene, walls, colliders: scene.colliders!.map(o => o === wallMesh ? mesh : o) },
    dispose: () => { restore(); geometry.dispose(); },
  };
}
