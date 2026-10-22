// Replay of the explorer's real walker against the colliders the Ikebukuro scene itself produces.
//
// What is shared with the app, not copied:
//  - the collision world: scene/scene.ts `assembleCollision` + `tileCollision` (the same function buildScene
//    calls), with the GLB loaded as the explorer loads it (GLTFLoader + glbPrimitivePlugin), the access-fence
//    collider from scene/fences.ts `buildFenceCollider`, and per-role material sides from `roleSide`;
//  - the ray-test sets and hit order: apps/web/src/explorer/raycast.ts `explorerTargets` / `castAll`, with
//    the trees from meshBvh.ts `prepareRayTrees`, built as Explorer.loadStation builds them;
//  - the pure walker rules: apps/web/src/explorer/walker.ts `resolveWalls`, `acceptGround`, `DEFAULT_GROUND`,
//    and WALKER_BODY from @gteki/scene-api.
//
// What is mirrored by hand, and where (apps/web/src/explorer/explorer.ts):
//  - `groundAt`              = Explorer.groundAt,           lines 556-562
//  - `blockedByColliders`    = Explorer.blockedByColliders, lines 564-576 (rays at 0.5 and 1.2 m, far = len + RADIUS)
//  - `ReplayWalker.stepWalk` = Explorer.stepWalk,           lines 967-987 (forward move only: the camera-relative
//    strafe term is a rotation of the heading, and headings are swept continuously here)
//  - RADIUS = WALKER_BODY.radiusM (line 46); WALK / RUN come from WALKER_SPEED in @gteki/scene-api (the same
//    constant explorer.ts uses for its walk and run speeds), so there is no source-text parsing here.
// Explorer.walkFrom (lines 538-547) is mirrored by `ReplayWalker.spawn`.
//
// Not replayed: the follow camera (it never moves the walker), per-frame dt jitter (a fixed step is used, with
// dt = step / speed so the damped height lags exactly as at that speed), and the avatar. The Ikebukuro scene
// returns no `walls`, so the wall list is empty, as in the app.
import fs from "node:fs";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { WALKER_BODY, WALKER_SPEED, glbPrimitivePlugin } from "@gteki/scene-api";
import { enuToRenderer } from "../../../packages/geo/src/index.ts";
import { DEFAULT_GROUND, acceptGround, resolveWalls, type Segment2 } from "../../../apps/web/src/explorer/walker.ts";
import { castAll, explorerTargets } from "../../../apps/web/src/explorer/raycast.ts";
import { prepareRayTrees } from "../../../apps/web/src/explorer/meshBvh.ts";
import { buildFenceCollider } from "../scene/fences.ts";
import { roleSide } from "../scene/materials.ts";
import { assembleCollision, tileCollision } from "../scene/scene.ts";
import { type Fence, committed, inPoly, routable } from "./access_seal.ts";

const ROOT = new URL("..", import.meta.url).pathname;

export const RADIUS = WALKER_BODY.radiusM;
/** WALK and RUN in m/s: the walk and run speeds of the explorer, from WALKER_SPEED in @gteki/scene-api. */
export const SPEED = { walk: WALKER_SPEED.walkMps, run: WALKER_SPEED.runMps };

const toRenderer = (x: number, y: number, z: number) => new THREE.Vector3(...enuToRenderer({ x, y, z }));

let gltfPromise: Promise<GLTF> | undefined;
/** The lit GLB, loaded the way the explorer's `loadGlb` does (assets are local, so no resource fence). */
function loadGltf(): Promise<GLTF> {
  return (gltfPromise ??= (async () => {
    const buf = fs.readFileSync(ROOT + "gteki/assets/ikebukuro_b1_lit.glb");
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(glbPrimitivePlugin);
    const gltf = await new Promise<GLTF>((res, rej) => loader.parse(ab, "", res, rej));
    gltf.scene.updateMatrixWorld(true);
    return gltf;
  })());
}

export interface World {
  /** `Explorer.groundTargets`. */
  ground: THREE.Object3D[];
  /** `Explorer.colliderTargets`. */
  collider: THREE.Object3D[];
}

/** The ray-test world the scene produces, with `fences` as the access-fence panels (default: the committed ones). */
export async function buildWorld(fences: Fence[] = committed()): Promise<World> {
  const gltf = await loadGltf();
  const parts = assembleCollision(THREE, gltf.scene, {
    // Stub materials: only `side` matters to the ray tests, and it comes from the scene's own `roleSide`.
    materialFor: (role) => new THREE.MeshBasicMaterial({ side: roleSide(THREE, role) }),
    toRenderer,
    enuToRenderer,
    fenceCollider: buildFenceCollider(THREE, fences, toRenderer),
  });
  const tiles = tileCollision(THREE, parts);
  const targets = explorerTargets(tiles.walkable, tiles.colliders, []);
  prepareRayTrees(targets.camera);
  return { ground: targets.ground, collider: targets.collider };
}

/** The part of Explorer's state the walk step reads and writes. Renderer frame (X east, Y up, Z south). */
export class ReplayWalker {
  pos = new THREE.Vector3();
  private ray = new THREE.Raycaster();
  private walls: Segment2[] = [];
  constructor(private world: World) {}

  /** Explorer.groundAt */
  groundAt(x: number, fromY: number, z: number, maxDrop: number): number | null {
    if (this.world.ground.length === 0) return null;
    this.ray.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
    this.ray.far = maxDrop;
    const hit = castAll(this.ray, this.world.ground)[0];
    return hit ? hit.point.y : null;
  }

  /** Explorer.blockedByColliders */
  blockedByColliders(from: THREE.Vector3, to: THREE.Vector3): boolean {
    if (this.world.collider.length === 0) return false;
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 1e-6) return false;
    dir.divideScalar(len);
    for (const h of [0.5, 1.2]) {
      this.ray.set(from.clone().add(new THREE.Vector3(0, h, 0)), dir);
      this.ray.far = len + RADIUS;
      if (castAll(this.ray, this.world.collider).length > 0) return true;
    }
    return false;
  }

  /** Explorer.walkFrom: stand on the nearest walkable ground within 1.5 m above / 2.5 m below the ENU point. */
  spawn(enu: { x: number; y: number; z: number }): boolean {
    const p = new THREE.Vector3(...enuToRenderer(enu));
    const ground = this.groundAt(p.x, p.y + 1.5, p.z, 4);
    if (ground === null) return false;
    this.pos.set(p.x, ground, p.z);
    return true;
  }

  /** Explorer.stepWalk with the forward key held (mv = (0, 1)): returns whether the walker moved. */
  stepWalk(yaw: number, speed: number, dt: number): boolean {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const step = speed * dt;
    const nx = this.pos.x + fx * step;
    const nz = this.pos.z + fz * step;
    const pushed = resolveWalls(nx, nz, RADIUS, this.pos.y, WALKER_BODY.bodyTopM, this.walls);
    const target = new THREE.Vector3(pushed.x, this.pos.y, pushed.z);
    if (this.blockedByColliders(this.pos, target)) return false;
    const ground = this.groundAt(target.x, this.pos.y + DEFAULT_GROUND.stepUp + 0.05, target.z, DEFAULT_GROUND.stepUp + DEFAULT_GROUND.stepDown + 0.1);
    if (!acceptGround(this.pos.y, ground)) return false;
    this.pos.set(target.x, THREE.MathUtils.damp(this.pos.y, ground!, 18, dt), target.z);
    return true;
  }

  /** Station ENU position (x east, y north, z up). */
  enu(): [number, number, number] {
    return [this.pos.x, -this.pos.z, this.pos.y];
  }
}

/**
 * The targets that can matter to a walker starting at `center` (renderer frame) and moving at most `reach` m: any
 * target whose bounding sphere lies farther than that is out of every ray's reach, so dropping it changes no hit.
 * (castAll tests all ~1400 whole-station tiles per ray; this only skips the ones its own sphere test would skip.)
 */
export function nearby(world: World, center: THREE.Vector3, reach: number): World {
  const sphere = new THREE.Sphere();
  const keep = (list: THREE.Object3D[]) =>
    list.filter((o) => {
      const g = (o as THREE.Mesh).geometry;
      if (g.boundingSphere === null) g.computeBoundingSphere();
      sphere.copy(g.boundingSphere!).applyMatrix4(o.matrixWorld);
      return sphere.center.distanceTo(center) <= sphere.radius + reach;
    });
  return { ground: keep(world.ground), collider: keep(world.collider) };
}

/** Explorer yaw that walks toward ENU direction (dx, dy): forward is (-sin yaw, -cos yaw) in (x, z) = (dx, -dy). */
export const yawToward = (dx: number, dy: number) => Math.atan2(-dx, dy);

export interface Start { enu: [number, number, number]; why: string }
export interface Escape { start: Start; at: number[]; step: number; headingDeg: number; run: boolean }
export interface ReplayOptions {
  /** Metres moved per step. */
  stepM: number;
  /** Steps per attempt (steps taken, a refused step ends a straight attempt). */
  maxSteps: number;
  /** Straight-line headings per start (evenly spread, with a per-start phase so starts do not share them). */
  headings: number;
  /** Extra attempts per start that turn by up to +-90 degrees at every refusal, as a player scraping a wall does. */
  wanders: number;
  seed: number;
}
export interface ReplayStats { starts: number; attempts: number; steps: number; moved: number; escapes: Escape[] }

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Walk from every start along continuous headings; an escape is any accepted step onto floor outside the routable union. */
export function replay(world: World, starts: Start[], opts: ReplayOptions, maxEscapes = 5): ReplayStats {
  const polys = routable();
  const inside = (x: number, y: number) => polys.some((p) => inPoly(x, y, p));
  const rnd = mulberry32(opts.seed);
  const stats: ReplayStats = { starts: 0, attempts: 0, steps: 0, moved: 0, escapes: [] };
  // Ground rays start 0.5 m above the feet and drop 1.45 m; collider rays run 1.2 m up and len + RADIUS ahead.
  const reach = opts.maxSteps * opts.stepM + RADIUS + 4;
  for (const start of starts) {
    if (stats.escapes.length >= maxEscapes) break;
    stats.starts++;
    const walker = new ReplayWalker(nearby(world, new THREE.Vector3(...enuToRenderer({ x: start.enu[0], y: start.enu[1], z: start.enu[2] })), reach));
    const phase = rnd() * Math.PI * 2;
    const attempts = opts.headings + opts.wanders;
    for (let k = 0; k < attempts && stats.escapes.length < maxEscapes; k++) {
      // Alternate walking and running: the speed sets dt for a fixed step, hence how far the damped height lags.
      const run = k % 2 === 1;
      const speed = run ? SPEED.run : SPEED.walk, dt = opts.stepM / speed;
      let yaw = phase + (k < opts.headings ? (k / opts.headings) * Math.PI * 2 : rnd() * Math.PI * 2);
      const wander = k >= opts.headings;
      if (!walker.spawn({ x: start.enu[0], y: start.enu[1], z: start.enu[2] })) continue;
      // The walker stands on the ground the ray finds, which can differ from the sample's height: keep the sample's level.
      if (Math.abs(walker.pos.y - start.enu[2]) > 0.05) continue;
      stats.attempts++;
      let refusals = 0;
      for (let s = 0; s < opts.maxSteps; s++) {
        stats.steps++;
        if (walker.stepWalk(yaw, speed, dt)) {
          stats.moved++;
          const [x, y, z] = walker.enu();
          if (!inside(x, y)) {
            stats.escapes.push({ start, at: [x, y, z].map((v) => +v.toFixed(3)), step: s, headingDeg: +(((yaw * 180) / Math.PI) % 360).toFixed(1), run });
            break;
          }
        } else if (!wander || ++refusals > 6) {
          break; // a held key against a wall repeats the same refused step
        } else {
          yaw += (rnd() - 0.5) * Math.PI;
        }
      }
    }
  }
  return stats;
}

/** Every `stride`-th start along the panels, and all endpoint starts (they are the likely gaps). */
export function thin(starts: Start[], stride: number): Start[] {
  let n = 0;
  return starts.filter((s) => s.why.endsWith("endpoint") || n++ % stride === 0);
}

export interface SampleOptions {
  /** Spacing along each fence panel (m). */
  spacing: number;
  /** Distances from the panel plane on the routable side (m). */
  offsets: number[];
  /** Ring radii (m) and count of points around each fence endpoint. */
  ringRadii: number[];
  ringPoints: number;
}

/**
 * Starts on floor inside the routable union, near the fence panels: along each panel (on both sides of its plane,
 * kept where they lie in the union), and on rings around every panel endpoint, one per floor level under the point
 * whose height is within the panel's band. Floor is found with the walker's own ground targets, from above.
 */
export function fenceStarts(world: World, fences: Fence[], opts: SampleOptions): Start[] {
  const polys = routable();
  // Strictly inside: a point on a panel's plane (or within 1 cm of it) is not a place the walker can be sampled at.
  const ring = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [Math.cos((k * Math.PI) / 4) * 0.01, Math.sin((k * Math.PI) / 4) * 0.01] as const);
  const inside = (x: number, y: number) => [[0, 0] as const, ...ring].every(([dx, dy]) => polys.some((p) => inPoly(x + dx, y + dy, p)));
  const ray = new THREE.Raycaster();
  const levels = (x: number, y: number, z0: number, z1: number): number[] => {
    ray.set(new THREE.Vector3(x, 320, -y), new THREE.Vector3(0, -1, 0));
    ray.far = 640;
    const hs = castAll(ray, world.ground).map((h) => Math.round(h.point.y * 100) / 100);
    return [...new Set(hs)].filter((h) => h >= z0 - 0.5 && h <= z1);
  };
  const out: Start[] = [];
  const seen = new Set<string>();
  const add = (x: number, y: number, f: Fence, why: string) => {
    if (!inside(x, y)) return;
    for (const h of levels(x, y, f.z0, f.z1)) {
      const key = `${x.toFixed(3)},${y.toFixed(3)},${h}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ enu: [x, y, h], why });
    }
  };
  fences.forEach((f, i) => {
    const L = Math.hypot(f.b[0]! - f.a[0]!, f.b[1]! - f.a[1]!);
    if (L < 1e-6) return;
    const ux = (f.b[0]! - f.a[0]!) / L, uy = (f.b[1]! - f.a[1]!) / L, nx = -uy, ny = ux;
    const n = Math.max(1, Math.ceil(L / opts.spacing));
    for (let k = 0; k <= n; k++) {
      const t = (L * k) / n;
      for (const d of opts.offsets) for (const side of [-1, 1]) add(f.a[0]! + ux * t + nx * d * side, f.a[1]! + uy * t + ny * d * side, f, `fence ${i} along`);
    }
    for (const p of [f.a, f.b]) {
      for (const r of opts.ringRadii) {
        for (let k = 0; k < opts.ringPoints; k++) {
          const th = (k / opts.ringPoints) * Math.PI * 2;
          add(p[0]! + Math.cos(th) * r, p[1]! + Math.sin(th) * r, f, `fence ${i} endpoint`);
        }
      }
    }
  });
  return out;
}
