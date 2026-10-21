import { describe, expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import surfaceJson from "../data/surface.json" with { type: "json" };
import baked from "../data/surface-baked.ts";
import { buildLayout, type Plan } from "../scene/layout.ts";
import { protectFareAndAccess } from "../scene/fare-fence.ts";
import { deriveSurface, surfaceInputKey, surfaceSeed, unpackValues } from "../scene/surface-bake.ts";
import type { SurfaceData } from "../scene/surface-data.ts";
import { bakedText } from "../tools/bake-surface.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { bundle } = loadShinjukuBundle();
const plan = planJson as unknown as Plan;
const surface = surfaceJson as unknown as SurfaceData;

describe("baked street-layer table (#72)", () => {
  it("was made from exactly the shipped surface, bundle and plan", () => {
    expect(baked.inputKey).toBe(surfaceInputKey(surface, bundle, plan));
  });

  it("equals a fresh derivation exactly (-0, key order and all) and the file is what bake:surface writes", () => {
    const layout = buildLayout(bundle, plan);
    protectFareAndAccess(layout, plan, bundle);
    const fresh = deriveSurface(surface, layout, bundle);
    expect(unpackValues(baked.valuesJson)).toStrictEqual(fresh);
    expect(bakedText()).toBe(readFileSync(fileURLToPath(new URL("../data/surface-baked.ts", import.meta.url)), "utf8"));
  }, 60_000);

  it("is ignored unless every input matches", () => {
    const layout = buildLayout(bundle, plan);
    expect(surfaceSeed(baked, surface, layout, bundle, plan)).not.toBeNull();
    // An equal copy is the same content.
    expect(surfaceSeed(baked, structuredClone(surface), layout, structuredClone(bundle), structuredClone(plan))).not.toBeNull();
    const roads = { ...surface, roads: surface.roads.slice(1) };
    expect(surfaceSeed(baked, roads, layout, bundle, plan)).toBeNull();
    const moved = { ...bundle, nodes: bundle.nodes.map((n, i) => (i ? n : { ...n, position: { ...n.position, y: n.position.y + 0.001 } })) };
    expect(surfaceSeed(baked, surface, layout, moved, plan)).toBeNull();
    const level = plan.levels[0]!;
    const replanned = { ...plan, levels: [{ ...level, renderElevationM: level.renderElevationM + 0.001 }, ...plan.levels.slice(1)] };
    expect(surfaceSeed(baked, surface, layout, bundle, replanned)).toBeNull();
    expect(surfaceSeed({ ...baked, version: baked.version + 1 }, surface, layout, bundle, plan)).toBeNull();
    expect(surfaceSeed(null, surface, layout, bundle, plan)).toBeNull();
  });
});
