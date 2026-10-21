// The explorer's real walker (apps/web/src/explorer: stepWalk, groundAt, blockedByColliders, resolveWalls,
// acceptGround), replayed against the colliders this scene produces (scene.ts assembleCollision + tileCollision,
// fences.ts buildFenceCollider), never leaves the routable areas. See pipeline/walker_replay.ts for what is shared
// and what is mirrored. This is the sampled version that runs in `pnpm test`; the dense one is
// walker_replay.heavy.test.ts (`pnpm test:heavy`).
import { describe, expect, it } from "vitest";
import { type Fence, committed, read } from "../pipeline/access_seal.ts";
import { RADIUS, ReplayWalker, SPEED, type Start, buildWorld, fenceStarts, replay, thin, yawToward } from "../pipeline/walker_replay.ts";
import { WALKER_BODY } from "@gteki/scene-api";

const SAMPLE = { spacing: 0.5, offsets: [0.05, 0.3, 0.8], ringRadii: [0.1, 0.4], ringPoints: 12 };
const REPLAY = { stepM: 0.05, maxSteps: 40, headings: 24, wanders: 2, seed: 20261022 };
const length = (f: Fence) => Math.hypot(f.b[0]! - f.a[0]!, f.b[1]! - f.a[1]!);

describe("ikebukuro walker replay (scene colliders, explorer rules)", () => {
  const fences = committed();

  it("steps like the explorer: radius from WALKER_BODY, WALK and RUN read from explorer.ts, and it really walks", async () => {
    expect(RADIUS).toBe(WALKER_BODY.radiusM);
    expect(SPEED.walk).toBeGreaterThan(0);
    expect(SPEED.run).toBeGreaterThan(SPEED.walk);
    // Vacuity guard: from the central passage's node along the scene's own spawn heading (compass 100 degrees),
    // the walker covers the 2 m it is asked to, 0.05 m at a time.
    const world = await buildWorld();
    const c = (read("gteki/graph.json").nodes as { id: string; position: { x: number; y: number; z: number } }[]).find((n) => n.id === "c_mid")!.position;
    const w = new ReplayWalker(world);
    expect(w.spawn(c)).toBe(true);
    const [x0, y0] = w.enu();
    const yaw = yawToward(Math.sin((100 * Math.PI) / 180), Math.cos((100 * Math.PI) / 180));
    for (let i = 0; i < 40; i++) expect(w.stepWalk(yaw, SPEED.walk, 0.05 / SPEED.walk), `step ${i}`).toBe(true);
    const [x1, y1] = w.enu();
    expect(Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(2, 3);
  }, 120_000);

  it("never reaches floor outside the routable areas from public floor near the fences, on continuous headings", async () => {
    const world = await buildWorld();
    const starts = thin(fenceStarts(world, fences, SAMPLE), 4);
    const t = performance.now();
    const r = replay(world, starts, REPLAY);
    console.info(`walker replay: ${r.starts} starts, ${r.attempts} attempts, ${r.steps} steps (${r.moved} moved) in ${Math.round(performance.now() - t)} ms`);
    expect(r.starts).toBeGreaterThan(1000);
    expect(r.attempts).toBeGreaterThan(10_000);
    expect(r.moved / r.steps).toBeGreaterThan(0.5); // most steps are free walking, so the fences are what stops it
    expect(r.escapes).toEqual([]);
  }, 300_000);

  it("is what the fences hold: remove the longest piece and the replay walks out (negative control)", async () => {
    const piece = fences.reduce((a, b) => (length(b) > length(a) ? b : a));
    const world = await buildWorld(fences.filter((f) => f !== piece));
    // Starts come from the sealed scene (the piece present), so they are the same public floor the sealed test uses.
    const starts: Start[] = fenceStarts(await buildWorld(), [piece], SAMPLE);
    const r = replay(world, starts, REPLAY, 1);
    console.info(`removed piece (${piece.a} -> ${piece.b}, ${length(piece).toFixed(1)} m): ${JSON.stringify(r.escapes[0])}`);
    expect(starts.length).toBeGreaterThan(100);
    expect(r.escapes.length).toBeGreaterThan(0);
  }, 300_000);

  it("finds the open station with no fences at all (negative control)", async () => {
    const starts = thin(fenceStarts(await buildWorld(), fences, SAMPLE), 40);
    const r = replay(await buildWorld([]), starts, REPLAY, 1);
    expect(r.escapes.length).toBeGreaterThan(0);
  }, 300_000);
});
