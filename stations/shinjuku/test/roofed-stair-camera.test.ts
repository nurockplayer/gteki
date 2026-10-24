import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { WALKER_BODY, type StationScene } from "@gteki/scene-api";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { buildScene } from "../gteki/scene.ts";
import { buildLayout, type Plan } from "../scene/layout.ts";
import planJson from "../data/plan.json";
import { FOLLOW, approachBoom, followDistance, followPose, solveRaisedBoom } from "../../../apps/web/src/explorer/followCamera.ts";
import { bodyBlock, hitNormal } from "../../../apps/web/src/explorer/bodyCollision.ts";
import { DEFAULT_GROUND, resolveWalls, wallToRenderer } from "../../../apps/web/src/explorer/walker.ts";
import { castAll, castCamera, explorerTargets } from "../../../apps/web/src/explorer/raycast.ts";

/**
 * #70: follow camera and roof on the street-level flights of every roofed (E27 屋根の有無 = 2) sloped run.
 *
 * It replays the explorer's follow rig at steady state (the same followPose / castCamera / followBoom /
 * raised boom / keepBelowBlockers sequence as Explorer.placeCamera, imported read-only from apps/web) against the real Shinjuku
 * scene, with the walker standing on the drawn treads facing uphill and downhill, and measures:
 *  - the clearance between each tread and the roof cap straight above it;
 *  - the number of glazing faces a vertical ray crosses above each tread (the "double exposure");
 *  - whether a roof cap is what limits the camera, and the avatar's share of the frame height.
 * Set GTEKI_ROOF_CAM_REPORT=1 to print the per-sample table.
 */
const { bundle } = loadShinjukuBundle();
const layout = buildLayout(bundle, planJson as Plan);
const NEAR = 0.05; // the PerspectiveCamera near plane below
const FOV_DEG = 60; // Explorer's PerspectiveCamera
const DEFAULT_PITCH = -0.12; // Explorer's initial pitch
const CEILING = "ceiling collider (invisible)";

interface Row { edge: string; dir: "up" | "down"; pitch: number; z: number; clearance: number; glassFaces: number; dist: number; capLimits: boolean; limiter: string; share: number; headShare: number }

describe("roofed sloped street stairs: roof caps, glazing and the follow camera (#70)", () => {
  let scene: StationScene;
  beforeAll(async () => {
    const context = new Proxy({}, { get: (_t, key) => (key === "createLinearGradient" || key === "createRadialGradient") ? () => ({ addColorStop() {} }) : () => undefined });
    vi.stubGlobal("document", { createElement: () => ({ width: 1, height: 1, getContext: () => context }) });
    scene = (await buildScene({ THREE, bundle, quality: "low" } as never)) as StationScene;
    scene.root.updateMatrixWorld(true);
  }, 60_000);
  afterAll(() => {
    scene?.dispose();
    vi.unstubAllGlobals();
  });

  /** Every roofed (roof = 2) stair/escalator run that crosses the street-opening band z -2.6..0.1. */
  const roofedRuns = () => layout.runs.filter((r) => bundle.edges.find((e) => e.id === r.edgeId)?.attributes?.roof === 2 && Math.abs(r.b.z - r.a.z) > 0.01 && Math.max(r.a.z, r.b.z) > -2.6 && Math.min(r.a.z, r.b.z) < 0.1);

  /** The explorer's ray targets, and a copy with every roof/canopy cap triangle (all vertices above 2.5 m) removed. */
  function rayTargets() {
    const full = explorerTargets(scene.walkable, scene.colliders ?? [], scene.cameraBlockers ?? []);
    // One replacement per original, so a mesh listed as both collider and camera blocker stays both.
    const made = new Map<THREE.Object3D, THREE.Object3D>();
    const swap = (list: readonly THREE.Object3D[]) => list.map((o) => {
      if (o.name !== CEILING) return o;
      if (made.has(o)) return made.get(o)!;
      const src = (o as THREE.Mesh).geometry, pos = src.attributes.position!, idx = src.index;
      const kept: number[] = [];
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i < n; i += 3) {
        const ids = [0, 1, 2].map((k) => idx ? idx.getX(i + k) : i + k);
        if (!ids.every((id) => pos.getY(id) > 2.5)) kept.push(...ids);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", pos);
      g.setIndex(kept);
      const m = new THREE.Mesh(g, (o as THREE.Mesh).material);
      m.name = o.name; m.matrixAutoUpdate = false; m.matrix.copy(o.matrixWorld); m.matrixWorld.copy(o.matrixWorld);
      made.set(o, m);
      return m;
    });
    const capless = explorerTargets(scene.walkable, swap(scene.colliders ?? []), swap(scene.cameraBlockers ?? []));
    return { full, capless };
  }

  /**
   * Explorer.placeCamera at snap (the steady state): every camera target is two-sided (`cameraSides`), the shoulder probe,
   * followPose, solveRaisedBoom, then the actual-direction recast bounded by approachBoom, exactly as the explorer does.
   */
  function settle(t: ReturnType<typeof explorerTargets>, ray: THREE.Raycaster, head: THREE.Vector3, yaw: number, pitch: number) {
    const sides = new Set(t.camera);
    const hasTargets = t.camera.length > 0;
    let shoulder: number = FOLLOW.shoulder;
    if (hasTargets) {
      ray.set(head, new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))); ray.far = FOLLOW.shoulder + 0.25;
      const side = castCamera(ray, t.camera, sides)[0];
      if (side) shoulder = Math.max(0, side.distance - 0.25);
    }
    const pose = followPose(head, yaw, pitch, shoulder);
    const cast = (b: THREE.Vector3, length: number = FOLLOW.defaultDistance) => {
      ray.set(pose.pivot, b); ray.far = length + FOLLOW.clearance;
      return castCamera(ray, t.camera, sides).map((h) => ({ distance: h.distance, cameraOnly: t.blockers.has(h.object) }));
    };
    let back = pose.back, distance: number = FOLLOW.defaultDistance;
    if (hasTargets) ({ back, distance } = solveRaisedBoom(FOLLOW.defaultDistance, pose.back, cast, 0, 0, true));
    const length = distance;
    const hits = hasTargets ? cast(back, Math.max(length, FOLLOW.defaultDistance)) : [];
    const target = Math.min(length, distance, followDistance(FOLLOW.defaultDistance, hits));
    const actual = approachBoom(0, target, hits[0]?.distance ?? null, NEAR, 0, true);
    const position = pose.pivot.clone().addScaledVector(back, actual);
    return { pose, position, back, distance: actual, hit: cast(back)[0] };
  }

  const memo = new Map<number, Row[]>();
  const replay = (pitch: number): Row[] => memo.get(pitch) ?? (memo.set(pitch, replayAt(pitch)), memo.get(pitch)!);
  function replayAt(pitch: number): Row[] {
    const { full: targets, capless } = rayTargets();
    const walls = (scene.walls ?? []).map(wallToRenderer);
    const glass = scene.root.getObjectByName("surface-glass") as THREE.Mesh;
    const ray = new THREE.Raycaster();
    const cam = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.05, 2000);
    const up = new THREE.Vector3(0, 1, 0);
    const groundAt = (x: number, y: number, z: number) => {
      ray.set(new THREE.Vector3(x, y + DEFAULT_GROUND.stepUp + 0.05, z), new THREE.Vector3(0, -1, 0));
      ray.far = DEFAULT_GROUND.stepUp + DEFAULT_GROUND.stepDown + 0.1;
      return castAll(ray, targets.ground)[0]?.point.y ?? null;
    };
    const bodyHits = (from: THREE.Vector3, to: THREE.Vector3) => bodyBlock(from, to, (origin, dir, far) => {
      ray.set(origin, dir); ray.far = far;
      const hit = castAll(ray, targets.collider)[0];
      return hit ? { distance: hit.distance, normal: hitNormal(hit, dir) } : null;
    }, WALKER_BODY.radiusM);
    const rows: Row[] = [];
    for (const run of roofedRuns()) {
      const dz = run.b.z - run.a.z;
      const ta = Math.min(1, Math.max(0, (-2.6 - run.a.z) / dz)), tb = Math.min(1, Math.max(0, (0.02 - run.a.z) / dz));
      const lo = Math.min(ta, tb), hi = Math.max(ta, tb);
      const len = Math.hypot(run.b.x - run.a.x, run.b.y - run.a.y);
      for (const dir of ["up", "down"] as const) {
        // Facing: along the run toward its high end ("up") or its low end ("down").
        const s = (dz > 0 ? 1 : -1) * (dir === "up" ? 1 : -1);
        const fx = (run.b.x - run.a.x) * s / len, fy = (run.b.y - run.a.y) * s / len; // ENU heading
        const yaw = Math.atan2(-fx, fy);
        for (let k = 0; k <= 12; k++) {
          const t = lo + ((hi - lo) * k) / 12;
          const nominalZ = run.a.z + dz * t;
          const x = run.a.x + (run.b.x - run.a.x) * t, y = run.a.y + (run.b.y - run.a.y) * t;
          // Stand where the explorer's body step would let the walker be: pushed out of walls, on the ground its
          // step-up/step-down probe finds, and reachable by a 0.3 m body move from behind (colliders, #81).
          const pushed = resolveWalls(x, -y, WALKER_BODY.radiusM, nominalZ, WALKER_BODY.bodyTopM, walls);
          const gy = groundAt(pushed.x, nominalZ, pushed.z);
          if (gy === null) continue;
          const foot = new THREE.Vector3(pushed.x, gy, pushed.z);
          const from = foot.clone(); from.x -= fx * 0.3; from.z += fy * 0.3;
          const fromY = groundAt(from.x, nominalZ, from.z);
          if (fromY !== null && bodyHits(from.setY(fromY), foot)) continue;
          // Roof cap straight above the tread, and the glazing faces crossed on the way up.
          ray.set(foot, up); ray.far = 60;
          const cap = castCamera(ray, targets.camera, targets.blockers).find((h) => h.object.name === CEILING && h.point.y > 2.5);
          const glassFaces = ray.intersectObject(glass, false).length;
          const head = foot.clone().add(new THREE.Vector3(0, WALKER_BODY.eyeM, 0));
          const rig = settle(targets, ray, head, yaw, pitch);
          // A roof cap limits the camera when removing the cap triangles (and nothing else) moves the settled camera.
          const without = settle(capless, ray, head, yaw, pitch);
          const capLimits = rig.position.distanceTo(without.position) > 1e-3;
          cam.position.copy(rig.position);
          cam.lookAt(rig.pose.target); cam.updateMatrixWorld(true);
          const ndcY = (v: THREE.Vector3) => v.clone().project(cam).y;
          const sole = ndcY(foot), crown = ndcY(foot.clone().setY(foot.y + WALKER_BODY.bodyTopM)), chest = ndcY(foot.clone().setY(foot.y + WALKER_BODY.bodyTopM - 0.45));
          const dist = rig.position.distanceTo(rig.pose.pivot);
          const limiting = rig.distance < FOLLOW.defaultDistance ? rig.hit : undefined;
          rows.push({
            edge: run.edgeId.slice(2, 8), dir, pitch, z: foot.y, clearance: cap?.distance ?? Infinity, glassFaces, dist,
            capLimits,
            limiter: limiting ? `${limiting.cameraOnly ? "blocker" : "wall/floor"}@${limiting.distance.toFixed(2)}${rig.back.y < rig.pose.back.y - 1e-6 ? " boom-lowered" : ""}` : "-",
            share: (crown - sole) / 2, headShare: (crown - chest) / 2,
          });
        }
      }
    }
    return rows;
  }

  it("keeps every roofed tread at least 2.9 m under its cap", () => {
    const rows = replay(DEFAULT_PITCH);
    expect(new Set(rows.map((r) => r.edge)).size).toBeGreaterThanOrEqual(5);
    for (const r of rows) expect(r.clearance, `${r.edge} z${r.z.toFixed(2)}`).toBeGreaterThanOrEqual(2.9);
  }, 120_000);

  it("draws one glazing sheet over each roofed run that no canopy covers (no stacked translucent faces)", () => {
    // exit:2's lower flight (636c6f…) and exit:4's stair (c3fe63…) are the runs surfaceRoofs glazes beyond a canopy.
    const rows = replay(DEFAULT_PITCH).filter((r) => ["636c6f", "c3fe63"].includes(r.edge) && r.z > -2.6 && r.z < 0);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => r.glassFaces !== 1).map((r) => `${r.edge} z${r.z.toFixed(2)} faces${r.glassFaces}`)).toEqual([]);
  }, 120_000);

  it("has no coincident parallel glazing faces anywhere (canopies included): no horizontal sheet pair closer than 0.05 m", () => {
    const g = (scene.root.getObjectByName("surface-glass") as THREE.Mesh).geometry;
    const pos = g.attributes.position!, idx = g.index!;
    const tris: { y: number; p: [number, number][] }[] = [];
    for (let i = 0; i < idx.count; i += 3) {
      const v = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i + k)));
      if (v.every((q) => Math.abs(q.y - v[0]!.y) < 1e-4)) tris.push({ y: v[0]!.y, p: v.map((q) => [q.x, q.z] as [number, number]) });
    }
    expect(tris.length).toBeGreaterThanOrEqual(12); // 2 triangles per sheet, 4 canopies + 2 roofed runs
    const within = (pt: [number, number], t: [number, number][]) => {
      const s = (a: [number, number], b: [number, number], c: [number, number]) => (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
      const d = [s(pt, t[0]!, t[1]!), s(pt, t[1]!, t[2]!), s(pt, t[2]!, t[0]!)];
      return !(d.some((x) => x < 0) && d.some((x) => x > 0));
    };
    const pairs: string[] = [];
    for (const a of tris) for (const b of tris) {
      const dy = b.y - a.y;
      if (dy <= 1e-4 || dy >= 0.05) continue;
      const c: [number, number] = [(a.p[0]![0] + a.p[1]![0] + a.p[2]![0]) / 3, (a.p[0]![1] + a.p[1]![1] + a.p[2]![1]) / 3];
      if (within(c, b.p)) pairs.push(`y${a.y.toFixed(3)}/${b.y.toFixed(3)} at ${c[0].toFixed(1)},${(-c[1]).toFixed(1)}`);
    }
    expect(pairs).toEqual([]);
  });

  it("is not limited by a roof cap at the explorer's default pitch; reports camera distance and avatar share", () => {
    const report = !!process.env.GTEKI_ROOF_CAM_REPORT;
    for (const pitch of [DEFAULT_PITCH, -0.3, -0.5, 0.2]) {
      const rows = replay(pitch);
      for (const key of [...new Set(rows.map((r) => `${r.edge}-${r.dir}`))]) {
        const v = rows.filter((r) => `${r.edge}-${r.dir}` === key);
        if (report) console.log(`SUM pitch${pitch} ${key} n${v.length} capLimits${v.filter((r) => r.capLimits).length} minDist${Math.min(...v.map((r) => r.dist)).toFixed(2)} maxShare${Math.max(...v.map((r) => r.share)).toFixed(2)} maxHeadShare${Math.max(...v.map((r) => r.headShare)).toFixed(2)} minClear${Math.min(...v.map((r) => r.clearance)).toFixed(2)} maxGlassFaces${Math.max(...v.map((r) => r.glassFaces))}`);
      }
      // Positive control for the cap detector: a steep look-down near the stair tops does meet the caps.
      if (pitch === -0.5) expect(rows.some((r) => r.capLimits)).toBe(true);
      if (pitch !== DEFAULT_PITCH) continue;
      if (report) for (const r of rows) console.log(`ROW ${r.edge} ${r.dir.padEnd(4)} z${r.z.toFixed(2).padStart(6)} clear${r.clearance.toFixed(2)} faces${r.glassFaces} dist${r.dist.toFixed(2)} share${r.share.toFixed(3)} head${r.headShare.toFixed(3)} ${r.limiter}`);
      expect(rows.filter((r) => r.capLimits).map((r) => `${r.edge} ${r.dir} ${r.z.toFixed(2)}`)).toEqual([]);
      const tooClose = rows.filter((r) => r.dist < FOLLOW.comfortDistance);
      expect(tooClose.map((r) => `${r.edge} ${r.dir} z${r.z.toFixed(2)} dist${r.dist.toFixed(2)}`), "camera distances below comfortDistance").toEqual([]);
      const oversizedHead = rows.filter((r) => r.headShare >= 0.3);
      expect(oversizedHead.map((r) => `${r.edge} ${r.dir} z${r.z.toFixed(2)} head${r.headShare.toFixed(3)}`), "head-and-shoulders frame shares at or above 0.3").toEqual([]);
    }
  }, 240_000);
});
