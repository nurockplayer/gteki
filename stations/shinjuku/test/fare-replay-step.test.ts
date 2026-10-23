/** ExplorerReplay.step must be the shipped free-walk step: a reference written straight from explorer.ts
 * stepWalk / blockedByColliders / groundAt (real castAll over explorerTargets, the full wall list, no broad
 * phase) is compared with the replay's step, with and without the replay's ray acceleration. */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { StationScene } from "@gteki/scene-api";
import { WALKER_BODY } from "@gteki/scene-api";
import { acceptGround, resolveWalls, wallToRenderer, DEFAULT_GROUND } from "../../../apps/web/src/explorer/walker.ts";
import { castAll, explorerTargets } from "../../../apps/web/src/explorer/raycast.ts";
import { bodyBlock, hitNormal, slideAlong } from "../../../apps/web/src/explorer/bodyCollision.ts";
import type { XY, XYZ } from "../scene/layout.ts";
import { accessFixture, restrictedCorridorFixture } from "./fare-replay-fixture.ts";
import { ExplorerReplay } from "./fare-replay-audit.ts";
import { accelerateRaycasts } from "./fare-replay-rays.ts";

const RADIUS = WALKER_BODY.radiusM;

/** The explorer's state is a three.js position (x, feet y, z = -plan y); this takes and returns plan coordinates. */
function referenceExplorerStep(scene: StationScene, plan: XYZ, dir: XY, speed: number, dt: number): XYZ {
  const walls = (scene.walls ?? []).map(wallToRenderer);
  const targets = explorerTargets(scene.walkable, scene.colliders ?? [], scene.cameraBlockers ?? []);
  const ray = new THREE.Raycaster();
  const pos = new THREE.Vector3(plan.x, plan.z, -plan.y);
  const groundAt = (x: number, fromY: number, z: number, maxDrop: number): number | null => {
    ray.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
    ray.far = maxDrop;
    const hit = castAll(ray, targets.ground)[0];
    return hit ? hit.point.y : null;
  };
  // explorer.ts blockedByColliders
  const blockedByColliders = (from: THREE.Vector3, to: THREE.Vector3) => {
    if ((scene.colliders ?? []).length === 0) return null;
    return bodyBlock(from, to, (origin, d, far) => {
      ray.set(origin, d);
      ray.far = far;
      const hit = castAll(ray, targets.collider)[0];
      return hit ? { distance: hit.distance, normal: hitNormal(hit, d) } : null;
    }, RADIUS);
  };
  // explorer.ts stepWalk, from `const step = speed * dt` on (the camera-relative input is the plan direction here).
  const nx = pos.x + dir.x * speed * dt, nz = pos.z - dir.y * speed * dt;
  const pushed = resolveWalls(nx, nz, RADIUS, pos.y, WALKER_BODY.bodyTopM, walls);
  let target = new THREE.Vector3(pushed.x, pos.y, pushed.z);
  const block = blockedByColliders(pos, target);
  if (block) {
    const slid = slideAlong(pos, target, block.normal);
    if (!slid) return plan;
    const along = resolveWalls(slid.x, slid.z, RADIUS, pos.y, WALKER_BODY.bodyTopM, walls);
    target = new THREE.Vector3(along.x, pos.y, along.z);
    if (blockedByColliders(pos, target)) return plan;
  }
  const ground = groundAt(target.x, pos.y + DEFAULT_GROUND.stepUp + 0.05, target.z, DEFAULT_GROUND.stepUp + DEFAULT_GROUND.stepDown + 0.1);
  if (!acceptGround(pos.y, ground)) return plan;
  return { x: target.x, y: -target.z, z: THREE.MathUtils.damp(pos.y, ground!, 18, dt) };
}

/** What the replay did before #81: refuse any move whose 0.5 / 1.2 m rays meet a collider within len + 0.3. */
function previousStepRefuses(scene: StationScene, plan: XYZ, dir: XY, speed: number, dt: number): boolean {
  const walls = (scene.walls ?? []).map(wallToRenderer);
  const targets = explorerTargets(scene.walkable, scene.colliders ?? [], scene.cameraBlockers ?? []);
  const pushed = resolveWalls(plan.x + dir.x * speed * dt, -plan.y - dir.y * speed * dt, RADIUS, plan.z, WALKER_BODY.bodyTopM, walls);
  const from = new THREE.Vector3(plan.x, plan.z, -plan.y), to = new THREE.Vector3(pushed.x, plan.z, pushed.z);
  const len = from.distanceTo(to);
  if (len < 1e-6) return false;
  const v = to.clone().sub(from).divideScalar(len), ray = new THREE.Raycaster();
  return [.5, 1.2].some(h => { ray.set(from.clone().setY(from.y + h), v); ray.far = len + .3; return castAll(ray, targets.collider).length > 0; });
}

describe("ExplorerReplay.step is the shipped walk step (body collision + slide)", () => {
  // Starts 0.31-0.5 m from a fence: where the previous step's len + 0.3 m rays stop a walker. With the fence in
  // scene.walls the wall push-out already slides the body, so the old step rarely refused; a GLB-style collider
  // with no wall segment ("collider only") is what only the body test slides along.
  const offsets = [.31, .34, .38, .43, .5];
  const straight = (d: number, t: number): XY => ({ x: -d, y: t }), oblique = (d: number, t: number): XY => ({ x: t - d * Math.SQRT1_2, y: -t - d * Math.SQRT1_2 });
  const fixtures = [
    ["straight fence", () => accessFixture(3, false, true), straight, [-1.5, 0, 1.2], false],
    ["oblique fence with returns", () => restrictedCorridorFixture(.32, 3, { oblique: true, returns: true }), oblique, [-1.2, 0, 1.2], false],
    ["straight fence, collider only", () => accessFixture(3, false, true), straight, [-1.5, 0, 1.2], true],
    ["oblique fence with returns, collider only", () => restrictedCorridorFixture(.32, 3, { oblique: true, returns: true }), oblique, [-1.2, 0, 1.2], true],
  ] as const;
  for (const [name, make, place, spans, colliderOnly] of fixtures) it(`${name}: equals the explorer.ts reference, native and accelerated${colliderOnly ? ", and slides where it used to refuse" : ""}`, () => {
    const f = make();
    try {
      // Collider only: the fence meshes stay in scene.colliders, but no wall segment (a Fence has a `reason`) backs them.
      const scene: StationScene = colliderOnly ? { ...f.scene, walls: (f.scene.walls ?? []).filter(w => !("reason" in w)) } : f.scene;
      const starts = spans.flatMap(t => offsets.map(d => place(d, t))), cases: { pos: XYZ; dir: XY; speed: number; dt: number }[] = [];
      for (const s of starts) for (let deg = 0; deg < 360; deg += 15) for (const speed of [1.45, 3.4]) for (const dt of [1 / 30, 1 / 60])
        cases.push({ pos: { ...s, z: 0 }, dir: { x: Math.cos(deg * Math.PI / 180), y: Math.sin(deg * Math.PI / 180) }, speed, dt });
      const expected = cases.map(c => referenceExplorerStep(scene, c.pos, c.dir, c.speed, c.dt));
      const refused = cases.map(c => previousStepRefuses(scene, c.pos, c.dir, c.speed, c.dt));
      const check = (label: string) => {
        const replay = new ExplorerReplay(scene);
        let slid = 0, moved = 0;
        cases.forEach((c, i) => {
          const got = replay.step(c.pos, c.dir, c.speed, c.dt);
          expect(got, `${label} case ${i} ${JSON.stringify(c)}`).toEqual(expected[i]);
          if (got.x !== c.pos.x || got.y !== c.pos.y) { moved++; if (refused[i]) slid++; }
        });
        return { slid, moved };
      };
      const native = check("native");
      if (colliderOnly) expect(native.slid, "cases the previous step refused outright that now slide").toBeGreaterThan(0);
      expect(native.moved).toBeGreaterThan(0);
      const restore = accelerateRaycasts([...scene.walkable, ...(scene.colliders ?? [])]);
      try { expect(check("accelerated")).toEqual(native); } finally { restore(); }
    } finally { f.dispose(); }
  });
});
