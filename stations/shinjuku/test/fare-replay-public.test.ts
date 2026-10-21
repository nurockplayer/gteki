import { describe, expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { deriveRestrictedAccess } from "../scene/fare-fence.ts";
import { accessFixture } from "./fare-replay-fixture.ts";
import { publicLabels, replayEnvironment, mutateFence } from "./fare-replay-audit.ts";
import { renderedFootprint } from "./fare-replay-footprint.ts";
import { pointInRings } from "../scene/layout.ts";

describe("public replay seeds and certified proxy rounding", () => {
  it("does not seed tolerated internal borders between restricted source polygons", () => {
    const f = accessFixture(3, false, true);
    try {
      const level = f.plan.levels[0]!, source = level.spaces[1]!;
      const rect = (a: number, b: number) => [[{ x: a, y: -3 }, { x: b, y: -3 }, { x: b, y: 3 }, { x: a, y: 3 }]];
      source.rings = rect(0, 1); level.spaces.push({ ...source, id: "restricted-neighbour", rings: rect(1, 3) });
      f.built.layout.linkStrips.push({ ...f.built.layout.levels[0]!.slabs[0]!, spaceId: "link:wide-fill" });
      const template = loadShinjukuBundle().bundle;
      const regions = deriveRestrictedAccess(f.built.layout, f.plan, { ...template, nodes: [], edges: [] }).regions;
      const labels = publicLabels(f.built, f.plan, regions), p = { x: 1.006, y: 0, z: 0 };
      expect(labels(p).mapped).toBe(true); // within the unchanged 15 mm drift bound
      expect(labels(p, true).mapped).toBe(false); // restricted fill is not public
      expect(labels({ x: -.5, y: 0, z: 0 }, true).mapped).toBe(true);
    } finally { f.dispose(); }
  });
  it("certifies only the exact Float32 fringe with an exhibited public point", () => {
    const rings = [[{ x: -47.29, y: 205.13 }, { x: -45.8, y: 205.32 }, { x: -45.8, y: 200 }, { x: -47.29, y: 200 }]];
    const fringe = renderedFootprint([rings]);
    const p = { x: -46.73906288694196, y: 205.2002590080444 };
    const result = fringe(p, () => true);
    expect(result).toBeDefined(); expect(result!.distanceM).toBeGreaterThan(5e-6);
    expect(result!.distanceM).toBeLessThan(result!.roundingBoundM);
    expect(pointInRings(result!.point, rings)).toBe(true);
    expect(result!.roundingBoundM).toBeLessThan(.00002);
    expect(fringe(p, () => false)).toBeUndefined(); // restricted points cannot certify it
    expect(fringe({ ...p, y: p.y + .001 }, () => true)).toBeUndefined();
    expect(() => renderedFootprint([[[{ x: 1e9 + 1, y: 0 }, { x: 1e9 + 100, y: 0 }, { x: 1e9 + 100, y: 3 }]]])).toThrow(/sub-2 cm/);
  });
  it("still detects entry into ordinary unknown floor without a small-distance exemption", () => {
    const f = accessFixture(.001, false), changed = mutateFence(f.built, f.scene, f.fence, "remove");
    try {
      const env = replayEnvironment(changed.built, changed.scene, f.plan);
      expect(env.labels({ x: .001, y: 0, z: 0 }).mapped).toBe(false);
      const end = { id: "ordinary-unknown", p: { x: 1, y: 0, z: 0 }, other: { x: 1, y: -3 } };
      for (const walker of ["lane", "explorer"] as const) for (const fps of [30, 60]) for (const run of [false, true])
        expect(env.replay(end, { x: -1, y: 0, z: 0 }, "toward", walker, fps, run)?.kind).toBe("verified → unmapped/restricted");
    } finally { changed.dispose(); f.dispose(); }
  });
});
