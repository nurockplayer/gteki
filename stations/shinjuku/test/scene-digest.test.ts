import { describe, expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import type { Plan } from "../scene/layout.ts";
import expected from "./fixtures/scene-digest.json" with { type: "json" };
import { buildStation } from "../scene/build.ts";
import { clearLayoutCache, prepareLayout } from "../scene/build-cache.ts";
import generated from "../scene/fare-restricted.generated.json" with { type: "json" };
import { protectFareAndAccess } from "../scene/fare-fence.ts";
import { buildLayout } from "../scene/layout.ts";
import { exactHash, fullDigest, protectOnly, stationDigest, withCanvasStub, type FullDigest } from "./helpers/scene-digest.ts";

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
  it("a cold build (layout cache miss, then hit) matches the fe8d3b6 digest", async () => {
    clearLayoutCache();
    expectIdentical(await fullDigest(bundle, plan));
  }, 120_000);

  it("a reopen (every layout from the cache) matches the fe8d3b6 digest", async () => {
    expect(prepareLayout(bundle, plan, { reuse: true }).cached).toBe(true);
    expectIdentical(await fullDigest(bundle, plan));
  }, 120_000);

  it("buildStation mutates its own copy: repeated cached builds never see each other's walls", () => {
    clearLayoutCache();
    const digests = [0, 1, 2].map(() => withCanvasStub(() => {
      const built = buildStation(bundle, plan, { quality: "low", reuseLayout: true, verifyRestrictedInput: false });
      const d = stationDigest(built);
      built.dispose();
      return d;
    }));
    for (const d of digests) expect(d).toEqual(base.station);
    // The snapshot itself is still the pristine post-protect layout.
    expect(exactHash(prepareLayout(bundle, plan, { reuse: true }).layout)).toBe(base.protect.layoutAfterProtect);
  }, 120_000);

  it("keys the cache by content: a changed bundle or plan never reuses the snapshot", () => {
    clearLayoutCache();
    expect(prepareLayout(bundle, plan, { reuse: true }).cached).toBe(false);
    expect(prepareLayout(bundle, plan, { reuse: true }).cached).toBe(true);
    // An equal copy is the same content (a re-parsed bundle after reopen).
    expect(prepareLayout(structuredClone(bundle), structuredClone(plan), { reuse: true }).cached).toBe(true);
    const moved = { ...bundle, nodes: bundle.nodes.map((n, i) => (i ? n : { ...n, position: { ...n.position, x: n.position.x + 0.001 } })) };
    expect(prepareLayout(moved, plan, { reuse: true }).cached).toBe(false);
    const level = plan.levels[0]!;
    const replanned = { ...plan, levels: [{ ...level, renderElevationM: level.renderElevationM + 0.001 }, ...plan.levels.slice(1)] };
    expect(prepareLayout(bundle, replanned, { reuse: true }).cached).toBe(false);
    // Without reuse nothing is read or written.
    clearLayoutCache();
    expect(prepareLayout(bundle, plan).cached).toBe(false);
    expect(prepareLayout(bundle, plan, { reuse: true }).cached).toBe(false);
  }, 60_000);

  it("restricted input hashing is a pure check: skipping it yields the same fences as verifying it", () => {
    const verified = protectOnly(bundle, plan);
    expect(verified.cacheHit).toBe(true); // the key matched, so the table was used
    expect(protectOnly(bundle, plan, { verifyGeneratedInput: false })).toEqual(verified);
    expect(verified).toEqual(base.protect);
    // CI replaces the per-load check: a fresh derivation reproduces the table and its key exactly, so a
    // stale table (changed bundle, plan or layout code) fails here instead of being trusted at load.
    let fresh: { inputKey: string } | undefined;
    protectFareAndAccess(buildLayout(bundle, plan), plan, bundle, { recomputeRestricted: true, onRestricted: (r) => { fresh = r; } });
    expect(fresh?.inputKey).toBe(generated.inputKey);
    expect(fresh).toEqual(generated);
  }, 60_000);
});
