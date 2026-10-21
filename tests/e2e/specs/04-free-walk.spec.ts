import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { distanceToNetwork, hooks, openStation, routeWaypoints, save, shotPath, stationData, STATIONS, type StationKey, type Vec3 } from "../lib/gteki.ts";

/**
 * Collision-honest free walk. Unlike the guide (which plays the route polyline on rails), this
 * steers the avatar with real mouse-look drags and the W key under the explorer's own walls,
 * colliders and ground rules. It answers: can a player physically walk each verified route?
 *
 * Steering mirrors explorer.ts: yaw -= dx·0.0042 per dragged pixel; forward in station ENU is
 * (−sin yaw, cos yaw); walkFromNode() resets yaw to 0. simulate() runs synchronously, so real
 * animation frames cannot interleave inside one call (they can between calls; harmless for walking).
 *
 * A "blocked" result means the autopilot could not get past a point after re-aiming and four
 * human-like nudges. It is reported with a screenshot and must be confirmed by eye before it is
 * filed as a product defect.
 */
const LOOK_RAD_PER_PX = 0.0042;
const TICK_S = 0.25;
const HEIGHT_TOL_M = 0.6;
const MAX_OFF_NETWORK_M = 15;

// A failed walk's trace snapshots every drag (1.4 GB for one route); video, frames and the JSON log
// already carry the evidence.
test.use({ trace: "off" });

interface Scenario { id: string; from: string; to: string; expect: string; walk?: boolean; profile?: Record<string, boolean> }
const scenarios = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../fixtures/scenarios.json"), "utf8")) as Record<StationKey, Scenario[]>;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

async function canvasPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const c = document.querySelector("canvas.gteki-canvas")!.getBoundingClientRect();
    for (const [fx, fy] of [[0.5, 0.45], [0.7, 0.35], [0.3, 0.35], [0.6, 0.6], [0.85, 0.5]]) {
      const x = c.left + c.width * fx!, y = c.top + c.height * fy!;
      const el = document.elementFromPoint(x, y);
      if (el?.classList.contains("gteki-canvas") || el?.classList.contains("gteki-labels")) return { x, y };
    }
    return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
  });
}

async function turn(page: Page, at: { x: number; y: number }, dx: number): Promise<number> {
  let sent = 0;
  while (Math.abs(dx - sent) >= 1) {
    const chunk = Math.max(-500, Math.min(500, Math.round(dx - sent)));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + chunk, at.y, { steps: 2 });
    await page.mouse.up();
    sent += chunk;
  }
  return sent;
}

for (const key of STATIONS) {
  for (const s of scenarios[key].filter((x) => x.walk)) {
    test(`${key}: free walk ${s.id} ${s.from} → ${s.to} under collision`, async ({ page }, testInfo) => {
      test.setTimeout(480_000);
      await openStation(page, key);
      await hooks.setProfile(page, { stepFree: false, unpaidOnly: false, strictHours: false, ...s.profile });
      await hooks.setOrigin(page, s.from);
      await hooks.setDestination(page, s.to);
      const route = await hooks.route(page);
      expect(route?.ok).toBe(true);
      const steps = route.steps as { edgeId: string; fromNodeId: string; toNodeId: string; reversed: boolean; mode: string }[];
      const wps = routeWaypoints(key, steps);

      expect(await hooks.walkFromNode(page, steps[0]!.fromNodeId)).toBe(true);
      await expect.poll(() => hooks.mode(page)).toBe("walk");
      let yaw = 0;
      const at = await canvasPoint(page);
      const log: { kind: string; i: number; edgeId?: string; pos: Vec3; detail?: string }[] = [];
      let pos = await hooks.avatar(page);
      let simulated = 0;
      let i = 1;
      let shots = 0;

      const aim = async () => {
        const wp = wps[i]!;
        const desired = Math.atan2(-(wp.p.x - pos.x), wp.p.y - pos.y);
        const dx = Math.round(-wrap(desired - yaw) / LOOK_RAD_PER_PX);
        if (Math.abs(dx) >= 2) yaw = wrap(yaw - (await turn(page, at, dx)) * LOOK_RAD_PER_PX);
      };
      const distTo = (p: Vec3) => Math.hypot(wps[i]!.p.x - p.x, wps[i]!.p.y - p.y);

      // Per-waypoint budget: a walker that keeps making partial progress but never arrives (e.g. a
      // bend point pressed against a railing) is accepted when close, otherwise reported as blocked.
      let budgetFor = -1;
      let budgetStart = 0;
      let budget = 0;
      while (i < wps.length && simulated < 1500) {
        const wp = wps[i]!;
        if (budgetFor !== i) { budgetFor = i; budgetStart = simulated; budget = 15 + (3 * distTo(pos)) / 1.45; }
        if (simulated - budgetStart > budget) {
          if (distTo(pos) < 1.2) {
            log.push({ kind: "approx-reached", i, edgeId: wp.edgeId, pos, detail: `${distTo(pos).toFixed(2)} m` });
            if (Math.abs(pos.z - wp.p.z) > HEIGHT_TOL_M) log.push({ kind: "height-mismatch", i, edgeId: wp.edgeId, pos, detail: `avatar z ${pos.z.toFixed(2)} vs route display z ${wp.p.z.toFixed(2)} (${wp.zKnown ? "surveyed" : "symbolic"}, approx-reached)` });
            i++;
            continue;
          }
          if (shots < 6) await page.screenshot({ path: shotPath(testInfo, `${key}-freewalk-${s.id}-blocked-${shots++}.png`) });
          log.push({ kind: "blocked", i, edgeId: wp.edgeId, pos, detail: `budget spent ${distTo(pos).toFixed(2)} m from waypoint (${wp.p.x.toFixed(1)}, ${wp.p.y.toFixed(1)})` });
          const step = steps[wp.stepIndex]!;
          await hooks.walkFromNode(page, step.toNodeId);
          yaw = 0;
          pos = await hooks.avatar(page);
          while (i < wps.length && wps[i]!.stepIndex === wp.stepIndex) i++;
          continue;
        }
        // Lifts cannot be walked in the explorer: ride = jump to the step's far node, logged.
        if (wp.mode === "elevator") {
          const step = steps[wp.stepIndex]!;
          await hooks.walkFromNode(page, step.toNodeId);
          yaw = 0;
          pos = await hooks.avatar(page);
          log.push({ kind: "lift-ride-simulated", i, edgeId: wp.edgeId, pos });
          while (i < wps.length && wps[i]!.stepIndex === wp.stepIndex) i++;
          continue;
        }
        // Tighter approach at bends (> 30° turn) so the walker does not cut the inside corner.
        const next = wps[i + 1];
        const bend = next ? Math.abs(wrap(Math.atan2(next.p.y - wp.p.y, next.p.x - wp.p.x) - Math.atan2(wp.p.y - pos.y, wp.p.x - pos.x))) : 0;
        const reach = bend > Math.PI / 6 ? 0.35 : 0.7;
        const dist = distTo(pos);
        if (dist < reach) {
          if (Math.abs(pos.z - wp.p.z) > HEIGHT_TOL_M) log.push({ kind: "height-mismatch", i, edgeId: wp.edgeId, pos, detail: `avatar z ${pos.z.toFixed(2)} vs route display z ${wp.p.z.toFixed(2)} (${wp.zKnown ? "surveyed" : "symbolic"})` });
          i++;
          continue;
        }
        await aim();
        // Progress = getting closer to the waypoint, not just moving.
        let progressed = false;
        for (let k = 0; k < 6 && !progressed; k++) {
          const before = distTo(pos);
          pos = await hooks.simulate(page, Math.min(TICK_S, Math.max(0.05, dist / 1.45)), ["KeyW"]);
          simulated += TICK_S;
          progressed = before - distTo(pos) > 0.04;
        }
        // A player pressed into a corner sidesteps or backs off, re-aims and tries again.
        for (const nudge of [["KeyA"], ["KeyD"], ["KeyS", "KeyA"], ["KeyS", "KeyD"]]) {
          if (progressed) break;
          const start = distTo(pos);
          pos = await hooks.simulate(page, 0.35, nudge);
          await aim();
          for (let k = 0; k < 6 && !progressed; k++) {
            pos = await hooks.simulate(page, TICK_S, ["KeyW"]);
            simulated += TICK_S;
            progressed = start - distTo(pos) > 0.3;
          }
          if (progressed) log.push({ kind: "nudged", i, edgeId: wp.edgeId, pos, detail: nudge.join("+") });
        }
        if (!progressed) {
          if (shots < 6) await page.screenshot({ path: shotPath(testInfo, `${key}-freewalk-${s.id}-blocked-${shots++}.png`) });
          log.push({ kind: "blocked", i, edgeId: wp.edgeId, pos, detail: `${distTo(pos).toFixed(2)} m from waypoint (${wp.p.x.toFixed(1)}, ${wp.p.y.toFixed(1)})` });
          // Recover at the end node of the blocked step; the block stays a finding.
          const step = steps[wp.stepIndex]!;
          await hooks.walkFromNode(page, step.toNodeId);
          yaw = 0;
          pos = await hooks.avatar(page);
          while (i < wps.length && wps[i]!.stepIndex === wp.stepIndex) i++;
        }
      }
      const goal = wps.at(-1)!.p;
      const end = await hooks.avatar(page);
      await page.screenshot({ path: shotPath(testInfo, `${key}-freewalk-${s.id}-end.png`) });
      const blocked = log.filter((l) => l.kind === "blocked");
      // Many nudges on one route mean the verified line hugs walls closer than the walker radius.
      const nudges = log.filter((l) => l.kind === "nudged").length;
      const result = { scenario: s, routeLengthM: route.totalLengthM, waypoints: wps.length, reachedIndex: i, completed: i >= wps.length, simulatedSeconds: simulated, end, goal, distToGoalM: Math.hypot(end.x - goal.x, end.y - goal.y), goalDzM: end.z - goal.z, blockedCount: blocked.length, nudges, log };
      save(testInfo, `${key}-freewalk-${s.id}.json`, result);
      expect.soft(result.completed, `${s.id}: traversed every waypoint`).toBe(true);
      expect.soft(blocked, `${s.id}: player blocked on a verified route`).toEqual([]);
      expect.soft(log.filter((l) => l.kind === "height-mismatch"), `${s.id}: avatar off the route's display height`).toEqual([]);
      expect.soft(result.distToGoalM, `${s.id}: reached destination`).toBeLessThan(1);
      expect.soft(Math.abs(result.goalDzM), `${s.id}: on the destination's level`).toBeLessThan(HEIGHT_TOL_M);
    });
  }

  test(`${key}: walls stop the player (no walking out of the station)`, async ({ page }, testInfo) => {
    await openStation(page, key);
    const spawns = (stationData(key).station.spawnNodeIds as string[]).slice(0, 3);
    expect(spawns.length, "station declares spawn points").toBeGreaterThan(0);
    // World bounds come back in the renderer frame (x, z, −y); convert to station ENU.
    const w = (await hooks.sceneInfo(page)).world as number[];
    const bounds = { x0: w[0]!, x1: w[3]!, y0: -w[5]!, y1: -w[2]!, z0: w[1]!, z1: w[4]! };
    const results: { spawn: string; dir: string; moved: number; z0: number; z1: number; end: Vec3; inBounds: boolean; networkM: number }[] = [];
    for (const spawn of spawns) {
      for (const [dir, keys] of [["forward", ["KeyW", "ShiftLeft"]], ["back", ["KeyS", "ShiftLeft"]], ["left", ["KeyA", "ShiftLeft"]], ["right", ["KeyD", "ShiftLeft"]]] as const) {
        expect(await hooks.walkFromNode(page, spawn), `spawn ${spawn} has ground`).toBe(true);
        const a = await hooks.avatar(page);
        const b = await hooks.simulate(page, 30, [...keys]);
        const inBounds = b.x > bounds.x0 + 1 && b.x < bounds.x1 - 1 && b.y > bounds.y0 + 1 && b.y < bounds.y1 - 1 && b.z > bounds.z0 - 0.5 && b.z < bounds.z1 + 0.5;
        const networkM = Math.round(distanceToNetwork(key, b) * 10) / 10;
        results.push({ spawn, dir, moved: Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 10) / 10, z0: a.z, z1: b.z, end: b, inBounds, networkM });
      }
    }
    await page.screenshot({ path: shotPath(testInfo, `${key}-wall-probe-end.png`) });
    save(testInfo, `${key}-wall-probe.json`, results);
    // Control: the walker must actually move from each spawn, or "stopped by a wall" means nothing.
    for (const spawn of spawns) expect.soft(Math.max(...results.filter((r) => r.spawn === spawn).map((r) => r.moved)), `${spawn}: walker moves at all`).toBeGreaterThan(2);
    // 30 s of running is ~100 m in open space; inside a passage a wall must stop it well before.
    // Distance alone cannot prove containment (a wall gap lets the walker out within 95 m), so the
    // endpoint must also stay inside the scene bounds and near the walkable network on its own level:
    // MAX_OFF_NETWORK_M is wider than the widest hall either station models around its centre lines.
    // Height change is recorded, not asserted: running straight may legitimately take a stair.
    for (const r of results) {
      expect.soft(r.moved, `${r.spawn} ${r.dir}: ran ${r.moved} m without hitting a wall`).toBeLessThan(95);
      expect.soft(r.inBounds, `${r.spawn} ${r.dir}: ended outside the station scene at (${r.end.x.toFixed(1)}, ${r.end.y.toFixed(1)}, ${r.end.z.toFixed(1)})`).toBe(true);
      expect.soft(r.networkM, `${r.spawn} ${r.dir}: ended ${r.networkM} m from any walkable edge on its level`).toBeLessThan(MAX_OFF_NETWORK_M);
    }
  });
}
