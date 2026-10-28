import { describe, expect, it } from "vitest";
import { createRouter, DEFAULT_PROFILE } from "@gteki/navigation";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";
import { unverifiedSources } from "./unverifiedSteps.ts";

describe("unverifiedSources", () => {
  it("returns deduped source titles for only the selected non-verified steps", () => {
    const bundle = createSyntheticBundle([
      syntheticEdge("verified", "start", "a", { verification: "verified" }),
      syntheticEdge("unverified", "a", "goal", { verification: "unverified" }),
    ]);
    const route = createRouter(bundle, { allowUnverified: true }).route("start", "goal");
    expect(route.ok).toBe(true);
    if (!route.ok) throw new Error(route.message);

    expect(unverifiedSources(bundle, route.steps)).toEqual(["Invented synthetic fixture"]);
    expect(unverifiedSources(bundle, route.steps, [0])).toBeNull();
    expect(unverifiedSources(bundle, route.steps, [1])).toEqual(["Invented synthetic fixture"]);

    bundle.edges[1]!.geometryEvidence.sourceIds = [];
    expect(unverifiedSources(bundle, route.steps, [1])).toEqual([]);
  });

  it("uses an unknown source id as its displayed title", () => {
    const bundle = createSyntheticBundle([
      syntheticEdge("unverified", "start", "goal", {
        verification: "geometry_only",
        geometryEvidence: { sourceIds: ["unknown-source"], method: "synthetic-fixture", checkedDate: "2026-10-18" },
      }),
    ]);
    const route = createRouter(bundle, { allowUnverified: true }).route("start", "goal", DEFAULT_PROFILE);
    expect(route.ok).toBe(true);
    if (!route.ok) throw new Error(route.message);
    expect(unverifiedSources(bundle, route.steps)).toEqual(["unknown-source"]);
  });

  it("does not label a synthetic demo edge as unverified", () => {
    const bundle = createSyntheticBundle([syntheticEdge("demo", "start", "goal", { verification: "synthetic" })]);
    const route = createRouter(bundle).route("start", "goal", DEFAULT_PROFILE);
    if (!route.ok) throw new Error(route.message);
    expect(unverifiedSources(bundle, route.steps)).toBeNull();
  });
});
