import { describe, expect, it } from "vitest";
import { restrictedCorridorFixture } from "./fare-replay-fixture.ts";
import { APPROACHES, replayEnvironment } from "./fare-replay-audit.ts";

describe("exact static-world replay shortcuts", () => {
  it("matches every unshortened phase and final pose, including the next slide maneuver", () => {
    for (const returns of [true, false]) {
      const fixture = restrictedCorridorFixture(.32, 3, { oblique: true, returns });
      try {
        const fast = replayEnvironment(fixture.built, fixture.scene, fixture.plan, fixture.canonical);
        const full = replayEnvironment(fixture.built, fixture.scene, fixture.plan, fixture.canonical, { shortcuts: false });
        for (const walker of ["lane", "explorer"] as const) for (const fps of [30, 60]) for (const run of [false, true])
          for (const approach of APPROACHES) for (const y of [-.1, .1]) {
            const end = { id: "exact-phases", p: { x: .1, y: 0, z: 0 }, other: { x: .1, y: -2 } }, seed = { x: -1, y, z: 0 };
            const beforeFast = fast.frames(), beforeFull = full.frames();
            const expected = full.replay(end, seed, approach, walker, fps, run);
            expect(fast.replay(end, seed, approach, walker, fps, run)).toEqual(expected);
            expect(fast.position()).toEqual(full.position());
            expect(fast.frames() - beforeFast).toBe(full.frames() - beforeFull);
            const beforeMemo = fast.frames(), updates = fast.integratedFrames();
            expect(fast.replay(end, seed, approach, walker, fps, run)).toEqual(expected);
            expect(fast.position()).toEqual(full.position());
            expect(fast.frames() - beforeMemo).toBe(full.frames() - beforeFull);
            expect(fast.integratedFrames()).toBe(updates);
          }
        expect(fast.integratedFrames()).toBeLessThan(full.integratedFrames());
      } finally { fixture.dispose(); }
    }
  });
});
