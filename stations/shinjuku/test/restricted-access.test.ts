import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildLayout, type Plan } from "../scene/layout.ts";
import { restrictionDigest, restrictedInputKey, protectFareAndAccess, deriveRestrictedAccess, restrictedDepth, restrictionAt, verifiedFloorSegments } from "../scene/fare-fence.ts";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import geometry from "../scene/fare-restricted.generated.json" with { type: "json" };
import expected from "./fixtures/restricted-conflicts.json" with { type: "json" };
import { restrictedCorridorFixture } from "./fare-replay-fixture.ts";
import { replayEnvironment } from "./fare-replay-audit.ts";
const { bundle } = loadShinjukuBundle(), plan = planJson as Plan;
describe("source restriction and verified centreline authority", () => {
  const layout = buildLayout(bundle, plan), derived = deriveRestrictedAccess(layout, plan, bundle);
  it("cache fingerprint matches native SHA-256 including UTF-8 and padding boundaries", () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 127, 128, 129, 1024, 1000000]) {
      const input = "新宿 E27 🚉".repeat(Math.ceil(n / 10)).slice(0, n);
      expect(restrictionDigest(input)).toBe(createHash("sha256").update(input).digest("hex"));
    }
  });
  it("pins every buffer/source overlap; additions require review of the generated table", () => {
    expect(derived.conflicts).toEqual(expected);
  });
  it("invalidates the cache for gate rows and the full cross-floor routing geometry", () => {
    const key = restrictedInputKey(layout, plan, bundle, []);
    expect(restrictedInputKey({ ...layout, gates: [] }, plan, bundle, [])).not.toBe(key);
    const changed = { ...bundle, edges: bundle.edges.map((edge, i) => i ? edge : { ...edge, crossesFareBoundary: !edge.crossesFareBoundary }) };
    expect(restrictedInputKey(layout, plan, changed, [])).not.toBe(key);
  });
  it("the generated geometry equals the fresh general derivation and cache inputs", () => {
    const fresh = protectFareAndAccess(buildLayout(bundle, plan), plan, bundle, { recomputeRestricted: true,
      onRestricted: result => expect(result).toEqual(geometry) });
    const cached = protectFareAndAccess(buildLayout(bundle, plan), plan, bundle);
    expect(cached.restrictionCacheHit).toBe(true);
    expect(cached.fences).toEqual(fresh.fences);
    expect(cached.restrictedConflicts).toEqual(expected);
  }, 30_000);
  it("never subtracts unverified edges or network-strip width", () => {
    const unverified = { ...bundle, edges: bundle.edges.map(e => ({ ...e, verification: "unverified" as const })) };
    expect(verifiedFloorSegments(layout, plan, unverified)).toEqual([]);
    expect(deriveRestrictedAccess(layout, plan, unverified).conflicts).toEqual([]);
    const gap = derived.regions.find(r => r.spaceId === "41387a7906fb47b7a351b72412ec1a2d")!;
    expect(restrictionAt({ x: -64.81639125614346, y: 180.9140861992726 }, gap).permitted).toBe(false);
  });
  it("uses local depth rather than the deepest value elsewhere on an edge", () => {
    const region = derived.regions.find(r => r.spaceId === "d4523859711343eb8d35ee32580fb7ed")!;
    for (const edge of region.paths) for (let i = 0; i <= 100; i++) {
      const p = { x: edge.a.x + (edge.b.x - edge.a.x) * i / 100, y: edge.a.y + (edge.b.y - edge.a.y) * i / 100 };
      expect(restrictionAt(p, region).permitted).toBe(true);
      expect(restrictedDepth(p, region.source)).toBeLessThanOrEqual(Math.max(...expected.filter(c => c.spaceId === region.spaceId && c.edgeId === edge.edgeId).map(c => c.maxEdgeDepthM)) + 1e-6);
    }
  });
  it("fails actual-walker replay when the C subtraction is widened by 0.5 m", () => {
    const proper = restrictedCorridorFixture(.32), widened = restrictedCorridorFixture(.82);
    const end = { id: "corridor-negative", p: { x: .5, y: 0, z: 0 }, other: { x: .5, y: -3 } }, seed = { x: -1, y: 0, z: 0 };
    try {
      const closed = replayEnvironment(proper.built, proper.scene, proper.plan, proper.canonical);
      const bad = replayEnvironment(widened.built, widened.scene, widened.plan, widened.canonical);
      for (const walker of ["lane", "explorer"] as const) for (const fps of [30, 60]) for (const run of [false, true]) {
        expect(closed.replay(end, seed, "toward", walker, fps, run)).toBeNull();
        expect(bad.replay(end, seed, "toward", walker, fps, run)?.kind).toBe("verified → unmapped/restricted");
      }
    } finally { proper.dispose(); widened.dispose(); }
  });
});
