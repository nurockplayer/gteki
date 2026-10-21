import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { writeFileSync } from "node:fs";
import { createRouter } from "@gteki/navigation";
import { Player, type GuidePoint } from "../app/src/player.ts";
import { WALKER_BODY, type StationScene } from "@gteki/scene-api";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildStation, type BuiltStation } from "../scene/build.ts";
import { buildScene } from "../gteki/scene.ts";
import { railingWalls, type Plan } from "../scene/layout.ts";
import {
  audit,
  lanePatches,
  laneBands,
  proxyPatches,
  proxyGround,
  explorerBands,
  type AuditResult,
} from "./fare-boundary-audit.ts";

const { bundle } = loadShinjukuBundle(),
  plan = planJson as unknown as Plan;
describe("fare and access integrity at 0.25 m with a swept 0.3 m body", () => {
  let built: BuiltStation, scene: StationScene, results: AuditResult[];
  beforeAll(async () => {
    const context = new Proxy(
      {},
      {
        get: (_t, k) =>
          k === "createLinearGradient" || k === "createRadialGradient"
            ? () => ({ addColorStop() {} })
            : () => undefined,
      },
    );
    vi.stubGlobal("document", {
      createElement: () => ({ width: 1, height: 1, getContext: () => context }),
    });
    built = buildStation(bundle, plan, { quality: "low" });
    scene = await buildScene({ THREE, bundle, quality: "low" } as never);
    scene.root.updateMatrixWorld(true);
    expect(bundle.edges).toHaveLength(263);
    expect(scene.walkable.length).toBeGreaterThan(0);
    expect(scene.walls!.length).toBeGreaterThan(0);
    const layout = built.layout,
      patches = proxyPatches(scene.walkable);
    results = [
      audit(
        {
          name: "lane",
          patches: lanePatches(layout),
          propBands: laneBands(built.propWalls),
          bands: laneBands([
            ...layout.levels.flatMap((l) => l.walls),
            ...layout.runWalls,
            ...railingWalls(layout),
            ...built.propWalls,
          ]),
          up: 0.45,
          down: 0.7,
          ground: (p, z) => built.world.groundAt(p, z),
        },
        layout,
        plan,
        bundle,
      ),
      audit(
        {
          name: "explorer",
          patches,
          propBands: explorerBands(
            (scene.walls ?? []).slice(
              layout.levels.flatMap((l) => l.walls).length +
                layout.runWalls.length +
                railingWalls(layout).length,
            ),
          ),
          bands: explorerBands(scene.walls ?? []),
          up: WALKER_BODY.stepUpM,
          down: WALKER_BODY.stepDownM,
          ground: proxyGround(patches),
        },
        layout,
        plan,
        bundle,
      ),
    ];
    if (process.env.FARE_AUDIT_REPORT)
      writeFileSync(
        process.env.FARE_AUDIT_REPORT,
        JSON.stringify(results, null, 2),
      );
    console.info(
      results
        .map(
          (r) =>
            `${r.walker}: ${r.samples} samples, ${r.paidSeeds} paid seeds, ${r.leaks.length} leak samples, ${r.unmapped.length} unmapped, ${r.reachableUnmapped.length} paid-reachable unmapped, ${r.blockedEdges.length} obstructed edges`,
        )
        .join("\n"),
    );
  }, 180_000);
  afterAll(() => {
    built?.dispose();
    scene?.dispose();
    vi.unstubAllGlobals();
  });
  for (const walker of ["lane", "explorer"]) {
    it(`${walker}: fare crossings stay inside verified gate aisles`, () => {
      const r = results.find((r) => r.walker === walker)!;
      expect(r.samples).toBeGreaterThan(100_000);
      expect(r.paidSeeds).toBeGreaterThan(40_000);
      expect(r.leaks).toEqual([]);
    });
    it(`${walker}: walkable samples stay in mapped verified space`, () => {
      const r = results.find((r) => r.walker === walker)!;
      expect(r.unmapped).toEqual([]);
    });
    it(`${walker}: walking polylines keep ground/body clearance; every polyline clears props`, () => {
      const r = results.find((r) => r.walker === walker)!;
      expect(r.blockedEdges).toEqual([]);
    });
  }
  it("the proxy-ground audit agrees with actual explorer downward rays", () => {
    const patches = proxyPatches(scene.walkable),
      ground = proxyGround(patches),
      ray = new THREE.Raycaster();
    const points = built.layout.runs.flatMap((r) =>
      [0.2, 0.5, 0.8].map((t) => ({
        x: r.a.x + (r.b.x - r.a.x) * t,
        y: r.a.y + (r.b.y - r.a.y) * t,
        z: r.a.z + (r.b.z - r.a.z) * t,
      })),
    );
    for (const p of points) {
      ray.set(
        new THREE.Vector3(p.x, p.z + WALKER_BODY.stepUpM + 0.05, -p.y),
        new THREE.Vector3(0, -1, 0),
      );
      ray.far = WALKER_BODY.stepUpM + WALKER_BODY.stepDownM + 0.1;
      const hit = ray.intersectObjects(scene.walkable, false)[0];
      const expected =
        hit &&
        hit.point.y <= p.z + WALKER_BODY.stepUpM + 1e-5 &&
        hit.point.y >= p.z - WALKER_BODY.stepDownM - 1e-5
          ? hit.point.y
          : null;
      const sampled = ground(p, p.z);
      if (expected === null) expect(sampled).toBe(null);
      else expect(sampled).toBeCloseTo(expected, 4);
    }
  });
  it("platform screen doors block both walkers, including during the decorative door cycle", () => {
    const doors = built.propWalls.filter(
      (w) =>
        Math.abs(w.zMax - w.zMin - 1.45) < 0.001 &&
        Math.abs(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) - 5.6) < 0.05,
    );
    expect(doors.length).toBeGreaterThan(20);
    for (const w of doors) {
      const dx = w.b.x - w.a.x,
        dy = w.b.y - w.a.y,
        len = Math.hypot(dx, dy),
        mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
      const a = { x: mid.x - (dy / len) * 0.6, y: mid.y + (dx / len) * 0.6 },
        b = { x: mid.x + (dy / len) * 0.6, y: mid.y - (dx / len) * 0.6 };
      expect(built.world.firstWallHit(a, b, w.zMin + 0.8)).toBeLessThan(1);
      expect(
        scene.walls!.some(
          (q) =>
            Math.hypot(q.a.x - w.a.x, q.a.y - w.a.y) < 0.001 &&
            Math.hypot(q.b.x - w.b.x, q.b.y - w.b.y) < 0.001 &&
            q.zMin <= w.zMin + 0.1 + 1.7 &&
            q.zMax >= w.zMin + 0.1 + 0.2,
        ),
      ).toBe(true);
    }
    const count = built.propWalls.length;
    for (const time of [0, 25, 55, 90]) built.update(1 / 30, time);
    expect(built.propWalls.length).toBe(count);
  });
  it.each([20, 30])("guides every routable POI pair at ×4+RUN/%s fps with the actual prop/fence world", (fps) => {
    const router = createRouter(bundle),
      nodes = new Map(bundle.nodes.map((n) => [n.id, n])),
      stuck: string[] = [];
    let walked = 0;
    for (const from of bundle.pois)
      for (const to of bundle.pois)
        for (const stepFree of [false, true]) {
          if (
            from === to ||
            !from.connectorNodeIds.length ||
            !to.connectorNodeIds.length
          )
            continue;
          const route = router.route(
            from.connectorNodeIds[0]!,
            to.connectorNodeIds,
            { fare: "ticketed", stepFree },
          );
          if (!route.ok) continue;
          const points: GuidePoint[] = route.nodeIds.map((id, i) => ({
            ...nodes.get(id)!.position,
            z: built.layout.nodeZ.get(id)!,
            nodeId: id,
            elevator: i > 0 && route.steps[i - 1]!.mode === "elevator",
            escalator: i > 0 && route.steps[i - 1]!.mode === "escalator",
          }));
          const player = new Player(built.world, points[0]!);
          let arrived = false;
          player.onGuideEvent = (e) => {
            if (e.type === "arrived") arrived = true;
          };
          player.startGuide(points);
          player.setGuideSpeed(4);
          for (
            let t = 0;
            t < route.totalLengthM / 0.5 / 4 + 60 && !arrived;
            t += 1 / fps
          )
            player.update(
              1 / fps,
              { forward: 0, strafe: 0, run: true },
              player.heading,
            );
          walked++;
          if (!arrived || Math.abs(player.z - points.at(-1)!.z) > 0.35)
            stuck.push(
              `${from.id} → ${to.id} stepFree=${stepFree} at ${player.x.toFixed(2)},${player.y.toFixed(2)},${player.z.toFixed(2)}`,
            );
        }
    expect(walked).toBeGreaterThan(100);
    expect(stuck, JSON.stringify(stuck)).toEqual([]);
  }, 60_000);
});
