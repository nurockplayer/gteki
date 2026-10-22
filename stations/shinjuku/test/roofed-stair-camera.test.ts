import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { WALKER_BODY, type StationScene } from "@gteki/scene-api";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { buildScene } from "../gteki/scene.ts";
import { buildLayout, type Plan } from "../scene/layout.ts";
import planJson from "../data/plan.json";
import { FOLLOW, followDistance, followPose } from "../../../apps/web/src/explorer/followCamera.ts";
import { castCamera, explorerTargets, keepBelowBlockers } from "../../../apps/web/src/explorer/raycast.ts";

/**
 * #70: follow camera and roof on the street-level flights of every roofed (E27 屋根の有無 = 2) sloped run.
 *
 * It replays the explorer's follow rig at steady state (the same followPose / castCamera / followDistance /
 * keepBelowBlockers sequence as Explorer.placeCamera, imported read-only from apps/web) against the real Shinjuku
 * scene, with the walker standing on the drawn treads facing uphill and downhill, and measures:
 *  - the clearance between each tread and the roof cap straight above it;
 *  - the number of glazing faces a vertical ray crosses above each tread (the "double exposure");
 *  - whether a roof cap is what limits the camera, and the avatar's share of the frame height.
 * Set GTEKI_ROOF_CAM_REPORT=1 to print the per-sample table.
 */
const { bundle } = loadShinjukuBundle();
const layout = buildLayout(bundle, planJson as Plan);
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

  function replay(pitch: number): Row[] {
    const targets = explorerTargets(scene.walkable, scene.colliders ?? [], scene.cameraBlockers ?? []);
    const glass = scene.root.getObjectByName("surface-glass") as THREE.Mesh;
    const ray = new THREE.Raycaster();
    const cam = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.05, 2000);
    const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
    const rows: Row[] = [];
    for (const run of roofedRuns()) {
      const dz = run.b.z - run.a.z;
      const ta = Math.min(1, Math.max(0, (-2.6 - run.a.z) / dz)), tb = Math.min(1, Math.max(0, (0.02 - run.a.z) / dz));
      const lo = Math.min(ta, tb), hi = Math.max(ta, tb);
      for (const dir of ["up", "down"] as const) {
        for (let k = 0; k <= 12; k++) {
          const t = lo + ((hi - lo) * k) / 12;
          const x = run.a.x + (run.b.x - run.a.x) * t, y = run.a.y + (run.b.y - run.a.y) * t;
          // Settle on the drawn tread, as the walker does.
          ray.set(new THREE.Vector3(x, run.a.z + dz * t + 0.6, -y), down); ray.far = 1.2;
          const tread = ray.intersectObjects(scene.walkable, false)[0];
          if (!tread) continue;
          const foot = new THREE.Vector3(x, tread.point.y, -y);
          // Facing: along the run toward its high end ("up") or its low end ("down").
          const s = (dz > 0 ? 1 : -1) * (dir === "up" ? 1 : -1);
          const yaw = Math.atan2(-(run.b.x - run.a.x) * s, (run.b.y - run.a.y) * s);
          // Roof cap straight above the tread, and the glazing faces crossed on the way up.
          ray.set(foot, up); ray.far = 60;
          const cap = castCamera(ray, targets.camera, targets.blockers).find((h) => h.object.name === CEILING && h.point.y > 2.5);
          const glassFaces = ray.intersectObject(glass, false).length;
          // Follow rig, steady state (Explorer.placeCamera).
          const head = foot.clone().add(new THREE.Vector3(0, WALKER_BODY.eyeM, 0));
          let shoulder: number = FOLLOW.shoulder;
          ray.set(head, new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))); ray.far = FOLLOW.shoulder + 0.25;
          const side = castCamera(ray, targets.camera, targets.blockers)[0];
          if (side) shoulder = Math.max(0, side.distance - 0.25);
          const pose = followPose(head, yaw, pitch, shoulder);
          ray.set(pose.pivot, pose.back); ray.far = FOLLOW.defaultDistance + FOLLOW.clearance;
          const all = castCamera(ray, targets.camera, targets.blockers);
          const dist = followDistance(FOLLOW.defaultDistance, all.map((h) => ({ distance: h.distance, cameraOnly: targets.blockers.has(h.object) })));
          cam.position.copy(pose.pivot).addScaledVector(pose.back, dist);
          keepBelowBlockers(pose.pivot, cam.position, [...targets.blockers], FOLLOW.clearance, ray);
          cam.lookAt(pose.target); cam.updateMatrixWorld(true);
          const ndcY = (v: THREE.Vector3) => v.clone().project(cam).y;
          const sole = ndcY(foot), crown = ndcY(foot.clone().setY(foot.y + WALKER_BODY.bodyTopM)), chest = ndcY(foot.clone().setY(foot.y + WALKER_BODY.bodyTopM - 0.45));
          // A roof cap limits the camera when removing the cap hits (and only those) changes the settled distance.
          const isCap = (h: THREE.Intersection) => h.object.name === CEILING && h.point.y > 2.5;
          const toHit = (h: THREE.Intersection) => ({ distance: h.distance, cameraOnly: targets.blockers.has(h.object) });
          const withoutCaps = followDistance(FOLLOW.defaultDistance, all.filter((h) => !isCap(h)).map(toHit));
          const capLimits = Math.abs(withoutCaps - dist) > 1e-6;
          const limiting = dist < FOLLOW.defaultDistance ? all[0] : undefined;
          rows.push({
            edge: run.edgeId.slice(2, 8), dir, pitch, z: foot.y, clearance: cap?.distance ?? Infinity, glassFaces, dist,
            capLimits,
            limiter: limiting ? `${limiting.object.name.replace(" (invisible)", "")}@y${limiting.point.y.toFixed(2)}` : "-",
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
    }
  }, 240_000);
});
