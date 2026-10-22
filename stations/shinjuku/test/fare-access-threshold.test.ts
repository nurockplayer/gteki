import { describe, expect, it } from "vitest";
import { accessFixture } from "./fare-replay-fixture.ts";
import { mutateFence, replayEnvironment } from "./fare-replay-audit.ts";

describe("access transitions have no shortcut or dead-end threshold", () => {
  it.each([
    ["one-centimetre unknown shortcut", .01, true, false],
    ["unknown dead end", 3, false, false],
    ["restricted dead end", 3, false, true],
  ] as const)("rejects a %s in both actual walkers", (_name, width, beyond, restricted) => {
    const fixture = accessFixture(width, beyond, restricted);
    const end = { id: "synthetic-access-middle", p: { x: 0, y: 0, z: 0 }, other: { x: 0, y: -3 } };
    try {
      for (const walker of ["lane", "explorer"] as const) for (const fps of [30, 60]) for (const run of [false, true]) {
        const speed = run ? walker === "lane" ? 3.6 : 3.4 : 1.45;
        // Cruise speed makes the third/fourth frame land inside even a 1 cm strip.
        const frames = Math.ceil(.31 / (speed / fps)), seed = { x: -frames * speed / fps + .005, y: 0, z: 0 };
        const closed = replayEnvironment(fixture.built, fixture.scene, fixture.plan);
        expect(closed.replay(end, seed, "toward", walker, fps, run)).toBeNull();
        const mutation = mutateFence(fixture.built, fixture.scene, fixture.fence, "remove");
        try {
          const open = replayEnvironment(mutation.built, mutation.scene, fixture.plan);
          expect(open.replay(end, seed, "toward", walker, fps, run)?.kind).toBe("verified → unmapped/restricted");
        } finally { mutation.dispose(); }
      }
    } finally { fixture.dispose(); }
  });
});
