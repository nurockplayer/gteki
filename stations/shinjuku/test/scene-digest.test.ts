import { describe, expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import type { Plan } from "../scene/layout.ts";
import expected from "./fixtures/scene-digest.json" with { type: "json" };
import { fullDigest, type FullDigest } from "./helpers/scene-digest.ts";

/**
 * #72 guard. test/fixtures/scene-digest.json was captured from the unmodified code at fe8d3b6 (the #61
 * candidate head). Colliders, walls, floors, fences, camera blockers, restricted-area output and the
 * post-build layout are compared byte for byte; visual meshes are compared as per-material triangle sets,
 * so re-batching is allowed but a changed, dropped or added triangle is not.
 */
const { bundle } = loadShinjukuBundle();
const plan = planJson as unknown as Plan;
const base = expected as unknown as FullDigest;

export function expectIdentical(got: FullDigest) {
  expect(got.protect).toEqual(base.protect); // protectFareAndAccess + layout pads
  expect(got.station).toEqual(base.station); // layout and propWalls after buildStation
  for (const q of ["low", "high"] as const) {
    const g = got.scene[q], b = base.scene[q];
    // Collision-class buffers: byte-identical.
    expect(g.walkable, `${q} walkable`).toEqual(b.walkable);
    expect(g.colliders, `${q} colliders`).toEqual(b.colliders);
    expect(g.cameraBlockers, `${q} cameraBlockers`).toEqual(b.cameraBlockers);
    expect(g.cameraBlockerIsCollider, `${q} blocker identity`).toEqual(b.cameraBlockerIsCollider);
    expect(g.walls, `${q} walls`).toBe(b.walls);
    expect(g.spawnPoints, `${q} spawn`).toBe(b.spawnPoints);
    // Visual meshes: identical triangle sets per material.
    expect(g.visual, `${q} visual`).toEqual(b.visual);
  }
}

describe("#72 load-cost changes leave collision and fence geometry byte-identical", () => {
  it("a fresh (uncached) build matches the fe8d3b6 digest", async () => {
    expectIdentical(await fullDigest(bundle, plan));
  }, 120_000);
});
