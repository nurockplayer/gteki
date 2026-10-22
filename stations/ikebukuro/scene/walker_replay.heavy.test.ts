// Dense version of walker_replay.test.ts (same harness, same rules), run by `pnpm test:heavy` or
// `pnpm test:heavy:box` rather than `pnpm test`: an estimated 10 to 15 minutes on one worker (about 40M steps at ~15-25 us each; not yet timed end to end). The sampled version in the
// default suite keeps CI covering the same replay and negative controls.
//
// Starts: along every fence panel every 0.3 m at five distances from its plane (2 cm to 60 cm, public side),
// and on four rings (5 to 60 cm) of 16 points around every panel endpoint, at every floor level under the point.
// From each: 48 straight headings 7.5 degrees apart plus 6 wandering walks (a turn of up to +-90 degrees at every
// refused step), alternately walking and running, 0.05 m per step, up to 3 m.
import { describe, expect, it } from "vitest";
import { type Fence, committed } from "../pipeline/access_seal.ts";
import { buildWorld, fenceStarts, replay } from "../pipeline/walker_replay.ts";

const SAMPLE = { spacing: 0.3, offsets: [0.02, 0.05, 0.12, 0.3, 0.6], ringRadii: [0.05, 0.15, 0.3, 0.6], ringPoints: 16 };
const REPLAY = { stepM: 0.05, maxSteps: 60, headings: 48, wanders: 6, seed: 20261022 };
const COARSE = { spacing: 0.5, offsets: [0.05, 0.3, 0.8], ringRadii: [0.1, 0.5], ringPoints: 8 };
const length = (f: Fence) => Math.hypot(f.b[0]! - f.a[0]!, f.b[1]! - f.a[1]!);

describe("ikebukuro walker replay, dense", () => {
  const fences = committed();

  it("never reaches floor outside the routable areas", async () => {
    const world = await buildWorld();
    const starts = fenceStarts(world, fences, SAMPLE);
    const t = performance.now();
    const r = replay(world, starts, REPLAY);
    console.info(`dense walker replay: ${r.starts} starts, ${r.attempts} attempts, ${r.steps} steps (${r.moved} moved) in ${Math.round((performance.now() - t) / 1000)} s`);
    expect(r.escapes).toEqual([]);
    expect(r.starts).toBeGreaterThan(10_000);
  }, 3_600_000);

  it("escapes when any one panel is removed, except where another piece or a wall already covers it (leave-one-out)", async () => {
    const sealed = await buildWorld();
    const opens: number[] = [], covered: number[] = [];
    for (const [i, piece] of fences.entries()) {
      const starts = fenceStarts(sealed, [piece], COARSE);
      const r = replay(await buildWorld(fences.filter((_, j) => j !== i)), starts, { ...REPLAY, headings: 36, wanders: 0 }, 1);
      (r.escapes.length ? opens : covered).push(i);
    }
    console.info(`leave-one-out: ${opens.length} of ${fences.length} pieces open an escape when removed; no escape for pieces ${covered.join(", ")} (${covered.map((i) => length(fences[i]!).toFixed(1)).join(", ")} m)`);
    expect(opens.length).toBeGreaterThan(fences.length / 2);
    // The longest panels are never redundant.
    for (const i of fences.map((f, k) => [length(f), k] as const).sort((a, b) => b[0] - a[0]).slice(0, 10).map(([, k]) => k)) expect(opens, `piece ${i}`).toContain(i);
  }, 3_600_000);
});
