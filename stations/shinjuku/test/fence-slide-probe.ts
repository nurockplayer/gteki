/**
 * Wall-slide probe (#81). The explorer's step now slides along a surface that blocks it instead of stopping, so a
 * walker can run along every fare fence, gate machine and gate line at any angle. For every such segment this
 * walks the shipped step (ExplorerReplay.step, which mirrors explorer.ts stepWalk) at the segment from both
 * sides, every 5 degrees between 5 and 85 either way along it, at walk and run speed and 30/60 fps, then sweeps
 * every direction every 15 degrees from points around each segment end. A frame fails with the replay's own
 * leak rule (replayEnvironment's judge: unmapped/restricted floor, or a fare label change without a verified gate
 * crossing), so nothing here defines "leak" separately. Shared by fence-slide.test.ts (a sample of the segments)
 * and fence-slide.heavy.test.ts (all of them).
 */
import { vi } from "vitest";
import * as THREE from "three";
import type { StationScene } from "@gteki/scene-api";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildStation, type BuiltStation } from "../scene/build.ts";
import { buildScene } from "../gteki/scene.ts";
import type { Plan, WallSeg, XY, XYZ } from "../scene/layout.ts";
import { gateMachines } from "../scene/fare-fence.ts";
import { acceptGround } from "../../../apps/web/src/explorer/walker.ts";
import { castTargets } from "../../../apps/web/src/explorer/raycast.ts";
import { accelerateRaycasts } from "./fare-replay-rays.ts";
import { distance, fencesOf, replayEnvironment } from "./fare-replay-audit.ts";

export const { bundle } = loadShinjukuBundle(), plan = planJson as Plan;

/** apps/web/src/explorer/explorer.ts:49-50 (`const WALK = 1.45; const RUN = 3.4`), not exported. */
const WALK = 1.45, RUN = 3.4;
const START_M = .6;
/** A slide must be able to cover this much of the segment's line before the run counts as done. */
const SLIDE_M = 3;
const ANGLES = Array.from({ length: 17 }, (_, i) => (i + 1) * 5);
const SWEEP = Array.from({ length: 24 }, (_, i) => i * 15);
const MAIN_COMBOS = [WALK, RUN].flatMap(speed => [60, 30].map(fps => ({ speed, fps })));
/** The corner sweep (24 directions from 8 points around each end) uses the two extreme step lengths only. */
const CORNER_COMBOS = [{ speed: WALK, fps: 60 }, { speed: RUN, fps: 30 }];

export interface Seg { id: string; kind: "fence:fare" | "fence:access" | "machine" | "gate-line"; a: XY; b: XY; z: number }
export type Env = ReturnType<typeof replayEnvironment>;
export interface Tally { starts: number; fallback: number; skipped: Record<string, number>; runs: number; steps: number; slid: number; leaks: { seg: string; start: XYZ; dir: XY; speed: number; fps: number; kind: string; at: XYZ }[] }
export const tally = (): Tally => ({ starts: 0, fallback: 0, skipped: {}, runs: 0, steps: 0, slid: 0, leaks: [] });

export function segments(built: BuiltStation): Seg[] {
  const out: Seg[] = fencesOf(built).map(f => ({ id: f.id, kind: f.reason === "fare" ? "fence:fare" : "fence:access", a: f.a, b: f.b, z: f.zMin + .05 }));
  const gates = built.layout.gates.filter((g, i, all) => all.findIndex(h => distance(g.center, h.center) < .02 && Math.abs(g.center.z - h.center.z) < .02) === i);
  for (const g of gates) {
    const machines = gateMachines(g);
    // The machine props of build.ts: 1.5 m along the flow, centred on each end machine.
    for (const [i, c] of machines.entries()) {
      const a = { x: c.x - g.dir.x * .75, y: c.y - g.dir.y * .75 }, b = { x: c.x + g.dir.x * .75, y: c.y + g.dir.y * .75 };
      const prop = built.propWalls.find((w: WallSeg) => distance(w.a, a) < 1e-6 && distance(w.b, b) < 1e-6 && Math.abs(w.zMin - (g.center.z - .1)) < 1e-6);
      if (prop) out.push({ id: `machine:${g.edgeId}:${i}`, kind: "machine", a, b, z: g.center.z });
    }
    out.push({ id: `gate-line:${g.edgeId}`, kind: "gate-line", a: machines[0]!, b: machines[1]!, z: g.center.z });
  }
  return out;
}

/** A start must be circle-clear (as every replay seed is), on accepted walkable ground, mapped, and carry a fare label. */
function checkStart(env: Env, p: XY, z: number): { start: XYZ } | { why: string } {
  const ground = env.explorer.ground({ ...p, z });
  if (!acceptGround(z, ground)) return { why: "no walkable ground" };
  const q = { ...p, z: ground! };
  const label = env.labels(q, true);
  if (!label.mapped) return { why: "unmapped or restricted" };
  if (!label.fare) return { why: "no fare label" };
  if (distance(env.explorer.push(q), p) >= 1e-7) return { why: "overlaps a wall" };
  return { start: q };
}
/** The first valid start among `candidates`, else count one skipped start (with the first candidate's reason). */
function firstStart(env: Env, candidates: XY[], z: number, t: Tally): XYZ | null {
  let first = "";
  for (const [i, p] of candidates.entries()) {
    const r = checkStart(env, p, z);
    if ("start" in r) { if (i) t.fallback++; return r.start; }
    first ||= r.why;
  }
  t.skipped[first] = (t.skipped[first] ?? 0) + 1;
  return null;
}

/** Walk `dir` until the walker has slid SLIDE_M past its start, is stuck for good, or runs out of frames. */
function run(env: Env, seg: string, start: XYZ, dir: XY, speed: number, fps: number, t: Tally): void {
  const dt = 1 / fps, cap = Math.ceil((2 * SLIDE_M + START_M) / (speed * dt));
  let pos = start, last = env.labels(start).fare, lastKnown = start;
  env.explorer.support = start.z;
  t.runs++;
  for (let i = 0; i < cap; i++) {
    const from = pos;
    pos = env.explorer.step(pos, dir, speed, dt);
    t.steps++;
    const supported = { ...pos, z: env.explorer.support ?? pos.z };
    const next = env.labels(supported);
    const kind = env.judge(last, lastKnown, supported, next);
    if (kind) { t.leaks.push({ seg, start, dir, speed, fps, kind, at: pos }); return; }
    if (next.fare) { last = next.fare; lastKnown = supported; }
    // The step is a pure function of the pose: the same pose back is stuck for good.
    if (Object.is(from.x, pos.x) && Object.is(from.y, pos.y) && Object.is(from.z, pos.z)) break;
    if (distance(start, pos) >= SLIDE_M) { t.slid++; break; }
  }
}

export function probeSegment(env: Env, s: Seg, t: Tally): void {
  const len = distance(s.a, s.b) || 1, tan = { x: (s.b.x - s.a.x) / len, y: (s.b.y - s.a.y) / len }, nor = { x: -tan.y, y: tan.x };
  const mid = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
  for (const side of [1, -1]) {
    // 0.6 m from the middle of the segment; where a wall or edge is in the way, a nearby point on the same side.
    const at = (u: number, d: number) => ({ x: s.a.x + tan.x * len * u + nor.x * side * d, y: s.a.y + tan.y * len * u + nor.y * side * d });
    const start = firstStart(env, [at(.5, START_M), at(.25, START_M), at(.75, START_M), at(.5, START_M - .1), at(.5, START_M + .15), at(.5, START_M + .3)], s.z, t);
    if (!start) continue;
    t.starts++;
    for (const deg of ANGLES) for (const along of [1, -1]) {
      const r = deg * Math.PI / 180, c = Math.cos(r), n = Math.sin(r);
      const dir = { x: -side * nor.x * c + along * tan.x * n, y: -side * nor.y * c + along * tan.y * n };
      for (const { speed, fps } of MAIN_COMBOS) run(env, s.id, start, dir, speed, fps, t);
    }
  }
}

export function probeEnds(env: Env, segs: Seg[], t: Tally): number {
  const seen = new Set<string>();
  let ends = 0;
  for (const s of segs) for (const e of [s.a, s.b]) {
    const key = `${Math.round(e.x * 1000)},${Math.round(e.y * 1000)},${Math.round(s.z * 100)}`;
    if (seen.has(key)) continue;
    seen.add(key); ends++;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, start = firstStart(env, [{ x: e.x + Math.cos(a) * START_M, y: e.y + Math.sin(a) * START_M }], s.z, t);
      if (!start) continue;
      t.starts++;
      for (const deg of SWEEP) {
        const dir = { x: Math.cos(deg * Math.PI / 180), y: Math.sin(deg * Math.PI / 180) };
        for (const { speed, fps } of CORNER_COMBOS) run(env, `${s.id} end`, start, dir, speed, fps, t);
      }
    }
  }
  return ends;
}


/** Build the real station and scene (as fare-replay.test.ts does) with the replay's ray broad phase; `close` undoes it all. */
export async function openStation() {
  const context = new Proxy({}, { get: (_t, k) => k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => undefined });
  vi.stubGlobal("document", { createElement: () => ({ width: 1, height: 1, getContext: () => context }) });
  const built = buildStation(bundle, plan, { quality: "low" });
  const scene: StationScene = await buildScene({ THREE, bundle, quality: "low" } as never);
  scene.root.updateMatrixWorld(true);
  const restore = accelerateRaycasts(castTargets([...scene.walkable, ...(scene.colliders ?? [])]));
  const env = replayEnvironment(built, scene, plan);
  return { built, scene, env, plan, close() { restore(); built.dispose(); scene.dispose(); vi.unstubAllGlobals(); } };
}

/** Every fare fence, machine and gate line, plus every `stride`-th access fence (there are ~15x as many) from `offset`. */
export function sample(segs: Seg[], stride: number, offset = 0): Seg[] {
  let n = -1;
  return segs.filter(s => s.kind !== "fence:access" || ++n % stride === offset % stride);
}

/** Probe `segs` and return the tallies, with one summary line. */
export function probeAll(env: Env, all: Seg[], segs: Seg[], label: string) {
  const total = tally(), started = performance.now(), kinds: Record<string, number> = {}, allKinds: Record<string, number> = {};
  for (const s of all) allKinds[s.kind] = (allKinds[s.kind] ?? 0) + 1;
  for (const s of segs) { kinds[s.kind] = (kinds[s.kind] ?? 0) + 1; probeSegment(env, s, total); }
  const approachStarts = total.starts;
  const ends = probeEnds(env, segs, total);
  const ms = Math.round(performance.now() - started);
  console.log(`${label} ${JSON.stringify({ allSegments: all.length, allKinds, segments: segs.length, kinds, ends, starts: total.starts, approachStarts, fallbackStarts: total.fallback, skippedStarts: total.skipped, runs: total.runs, steps: total.steps, slid3m: total.slid, leaks: total.leaks.length, ms })}`);
  return total;
}
