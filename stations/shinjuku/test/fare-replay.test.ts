import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { writeFileSync } from "node:fs";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildStation, type BuiltStation } from "../scene/build.ts";
import { buildScene } from "../gteki/scene.ts";
import { pointInRings, type Plan } from "../scene/layout.ts";
import type { StationScene } from "@gteki/scene-api";
import { derivedRestrictedAccess, restrictionAt } from "../scene/fare-fence.ts";
import { Player } from "../app/src/player.ts";
import { accelerateRaycasts, nearbyTargets } from "./fare-replay-rays.ts";
import { castAll, castTargets } from "../../../apps/web/src/explorer/raycast.ts";
import { endpointClosure, barrierEnds, replayEnds, closest, replayEnvironment, APPROACHES, laneReplayWorld, fencesOf, mutateFence, distance } from "./fare-replay-audit.ts";
const { bundle } = loadShinjukuBundle(), plan = planJson as Plan;
describe("actual walker fence replay", () => {
  let built: BuiltStation, scene: StationScene, restore: () => void;
  let rayProof: { before: number[][]; after: number[][] };
  beforeAll(async () => {
    const context = new Proxy({}, { get: (_t, k) => k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => undefined });
    vi.stubGlobal("document", { createElement: () => ({ width: 1, height: 1, getContext: () => context }) });
    built = buildStation(bundle, plan, { quality: "low" });
    scene = await buildScene({ THREE, bundle, quality: "low" } as never);
    scene.root.updateMatrixWorld(true);
    const targets = castTargets([...scene.walkable, ...(scene.colliders ?? [])]);
    const rays = barrierEnds(built).filter((_, i, all) => i % Math.ceil(all.length / 80) === 0).flatMap(e => [
      new THREE.Raycaster(new THREE.Vector3(e.p.x + .37, e.p.z + 2, -e.p.y + .23), new THREE.Vector3(0, -1, 0), 0, 4),
      new THREE.Raycaster(new THREE.Vector3(e.p.x - 1, e.p.z + .5, -e.p.y), new THREE.Vector3(1, 0, 0), 0, 2),
      new THREE.Raycaster(new THREE.Vector3(e.p.x, e.p.z + 1.2, -e.p.y - 1), new THREE.Vector3(0, 0, 1), 0, 2),
    ]);
    const hits = (r: THREE.Raycaster, ts: THREE.Object3D[]) => castAll(r, ts).flatMap(h => [h.distance, h.point.x, h.point.y, h.point.z].map(v => Math.round(v * 1e7) / 1e7));
    const before = rays.map(r => hits(r, targets));
    restore = accelerateRaycasts(targets);
    const nearby = nearbyTargets(targets);
    rayProof = { before, after: rays.map(r => hits(r, nearby(r))) };
  }, 60_000);
  afterAll(() => { restore?.(); built?.dispose(); scene?.dispose(); vi.unstubAllGlobals(); });
  it("endpoints overlap blocking neighbours in both walkers", () => {
    const ends = endpointClosure(built, scene);
    if (process.env.FARE_END_REPORT) writeFileSync(process.env.FARE_END_REPORT, JSON.stringify(ends, null, 2));
    expect(ends.map(e => ({ id: e.id, x: e.p.x, y: e.p.y, z: e.p.z, gap: e.nearestLane?.distance }))).toEqual([]);
  }, 30_000);
  it("accelerated native hook raycasts match the unmodified hook raycasts", () => {
    expect(rayProof.after).toEqual(rayProof.before);
  });
  it("real resolveWalls agrees with the proven empty-list fast path", () => {
    const env = replayEnvironment(built, scene, plan);
    for (const e of barrierEnds(built)) for (const x of [-.4, 0, .4]) for (const y of [-.4, 0, .4]) {
      const p = { x: e.p.x + x, y: e.p.y + y, z: e.p.z };
      expect(env.explorer.push(p)).toEqual(env.explorer.push(p, false));
    }
  }, 30_000);
  it("active-band WalkWorld preserves full-world positional collision", () => {
    const world = laneReplayWorld(built);
    for (const e of barrierEnds(built)) for (const x of [-.4, 0, .4]) for (const y of [-.4, 0, .4]) for (const dz of [-.1, 0, .1]) {
      const p = { x: e.p.x + x, y: e.p.y + y }, z = e.p.z + dz;
      expect(world.resolveWalls(p, z, .3)).toEqual(built.world.resolveWalls(p, z, .3));
    }
  });
  it("labels a damped floor transition by its accepted hook support", () => {
    const env = replayEnvironment(built, scene, plan);
    const from = { x: -37.54659055195308, y: 168.40250463953495, z: -8.169363706842326 };
    const target = { x: -37.53396544301613, y: 168.44915994722274 };
    const length = distance(from, target), dir = { x: (target.x - from.x) / length, y: (target.y - from.y) / length };
    const pos = env.explorer.step(from, dir, 1.45, 1 / 30);
    expect(env.explorer.support).toBeCloseTo(-7.8, 4);
    expect(pos.z).toBeLessThan(-8.0); // the explorer intentionally damps feet toward the landing
    expect(env.labels({ ...pos, z: env.explorer.support! }).mapped).toBe(true);
  }, 30_000);
  it("negative controls expose removed fare/access pieces and a shortened end", () => {
    const controls: unknown[] = [], baseline = replayEnvironment(built, scene, plan);
    for (const kind of ["fare", "access", "shorten"] as const) for (const walker of ["explorer", "lane"] as const) {
      let witness: unknown;
      const candidates = fencesOf(built).filter(f => kind === "access" ? !!f.closedSide : f.reason === "fare" && !f.id.startsWith("join:") && distance(f.a, f.b) > .7)
        .sort((a, b) => distance(b.a, b.b) - distance(a.a, a.b));
      outer: for (const fence of candidates) {
        const mutated = mutateFence(built, scene, fence, kind === "shorten" ? "shorten" : "remove");
        try {
          const env = replayEnvironment(mutated.built, mutated.scene, plan), len = distance(fence.a, fence.b), t = kind === "shorten" ? .35 / len : .5;
          const center = { x: fence.a.x + (fence.b.x - fence.a.x) * t, y: fence.a.y + (fence.b.y - fence.a.y) * t, z: fence.zMin + .05 };
          const end = { id: `negative:${fence.id}`, p: center, other: fence.a };
          const normal = { x: -(fence.b.y - fence.a.y) / len, y: (fence.b.x - fence.a.x) / len };
          for (const side of [-1, 1]) for (const offset of [.4, .65]) {
            let seed = { x: center.x + normal.x * side * offset, y: center.y + normal.y * side * offset, z: center.z };
            const ground = walker === "lane" ? mutated.built.world.groundAt(seed, seed.z) : env.explorer.ground(seed);
            if (ground === null) continue; seed = { ...seed, z: ground };
            if (!env.labels(seed).mapped) continue;
            const pushed = walker === "lane" ? mutated.built.world.resolveWalls(seed, seed.z, .3) : env.explorer.push(seed);
            if (distance(pushed, seed) > 1e-7) continue;
            for (const approach of ["toward", "oblique-30", "oblique+30", "oblique-60", "oblique+60"] as const) {
              const leak = env.replay(end, seed, approach, walker, 30, true);
              if (leak && (kind === "access" || leak.kind === "paid → free" || leak.kind === "free → paid") && !baseline.replay(end, seed, approach, walker, 30, true)) { witness = { kind, walker, fence: fence.id, leak }; break outer; }
            }
          }
        } finally { mutated.dispose(); }
      }
      controls.push(witness ?? { kind, walker, missing: true });
    }
    if (process.env.FARE_NEGATIVE_REPORT) writeFileSync(process.env.FARE_NEGATIVE_REPORT, JSON.stringify(controls, null, 2));
    expect(controls.every(c => !(c as { missing?: boolean }).missing), JSON.stringify(controls)).toBe(true);
  }, 300_000);
  const restrictedResults: Record<string, unknown>[] = [];
  it.each([
    ["B1 boundary return", "n:17e7f081779d4c65940d6f490486a8ba", "707c895c3715483f98fc746ecbb761a2"],
    ["B2 elevator boundary", "n:0919a5249d6e4dc8b4899750baafa2b3", "d4523859711343eb8d35ee32580fb7ed"],
  ])("keeps the actual body out of restricted space at the %s", (_name, nodeId, spaceId) => {
    const node = bundle.nodes.find(n => n.id === nodeId)!;
    const level = plan.levels.find(l => l.floorId === node.floorId)!;
    const space = level.spaces.find(s => s.id === spaceId)!;
    const edges = space.rings.flatMap(r => r.map((a, i) => ({ a, b: r[(i + 1) % r.length]! })));
    const near = edges.map(e => closest(node.position, e.a, e.b)).sort((a, b) => distance(a, node.position) - distance(b, node.position))[0]!;
    const depth = distance(node.position, near), dir = { x: (node.position.x - near.x) / depth, y: (node.position.y - near.y) / depth };
    const seed = { x: node.position.x - dir.x * .8, y: node.position.y - dir.y * .8, z: level.renderElevationM };
    const env = replayEnvironment(built, scene, plan), violations = [];
    // These are public, grounded, circle-clear starting positions, not invalid teleports.
    expect(env.labels(seed).mapped).toBe(true);
    expect(built.world.groundAt(seed, seed.z)).toBeCloseTo(seed.z, 4);
    expect(env.explorer.ground(seed)).toBeCloseTo(seed.z, 4);
    expect(distance(built.world.resolveWalls(seed, seed.z, .3), seed)).toBeLessThan(1e-7);
    expect(distance(env.explorer.push(seed), seed)).toBeLessThan(1e-7);
    for (const walker of ["lane", "explorer"] as const) for (const fps of [30, 60]) for (const run of [false, true]) {
      let pos = { ...seed }, maxDepth = 0, unsafe = false;
      const region = derivedRestrictedAccess(built.layout)!.regions.find(r => r.spaceId === spaceId)!;
      const player = new Player(built.world, seed), yaw = Math.atan2(dir.x, dir.y);
      const speed = run ? walker === "lane" ? 3.6 : 3.4 : 1.45;
      player.vx = dir.x * speed; player.vy = dir.y * speed; env.explorer.support = seed.z;
      for (let i = 0; i < fps * 4; i++) {
        if (walker === "explorer") pos = env.explorer.step(pos, dir, speed, 1 / fps);
        else { player.update(1 / fps, { forward: 1, strafe: 0, run }, yaw); pos = { x: player.x, y: player.y, z: player.z }; }
        const floor = walker === "explorer" ? env.explorer.support! : pos.z;
        if (Math.abs(floor - seed.z) < .2 && pointInRings(pos, space.rings))
          { maxDepth = Math.max(maxDepth, Math.min(...edges.map(e => distance(pos, closest(pos, e.a, e.b))))); unsafe ||= !restrictionAt(pos, region).permitted; }
      }
      const result = { node: nodeId, space: spaceId, walker, fps, run, maxDepth };
      restrictedResults.push(result); if (unsafe) violations.push(result);
    }
    if (process.env.FARE_RESTRICTED_REPORT) writeFileSync(process.env.FARE_RESTRICTED_REPORT, JSON.stringify(restrictedResults, null, 2));
    // Only the local verified centreline depth plus 1.5 cm is tolerated.
    expect(violations).toEqual([]);
  });


});
