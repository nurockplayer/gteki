import { describe, expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import surfaceJson from "../data/surface.json" with { type: "json" };
import baked from "../data/surface-baked.json" with { type: "json" };
import { buildLayout, type Plan } from "../scene/layout.ts";
import { protectFareAndAccess } from "../scene/fare-fence.ts";
import { deriveSurface, surfaceInputKey, surfaceSeed, unpackValues } from "../scene/surface-bake.ts";
import type { SurfaceData } from "../scene/surface-data.ts";
import { bakedText, derivationSourceKey } from "../tools/bake-surface.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { bundle } = loadShinjukuBundle();
const plan = planJson as unknown as Plan;
const surface = surfaceJson as unknown as SurfaceData;

/** The layout buildStation hands the street layer: built, then trimmed by the fare/access pass. */
const builtLayout = () => {
  const layout = buildLayout(bundle, plan);
  protectFareAndAccess(layout, plan, bundle);
  return layout;
};

describe("baked street-layer table (#72)", () => {
  it("was made from exactly the shipped surface, bundle, plan and layout", () => {
    expect(baked.inputKey).toBe(surfaceInputKey(surface, bundle, plan, builtLayout()));
  });

  it("equals a fresh derivation exactly (-0, key order and all) and the file is what bake:surface writes", () => {
    const fresh = deriveSurface(surface, builtLayout(), bundle);
    expect(unpackValues(baked.valuesJson)).toStrictEqual(fresh);
    expect(bakedText()).toBe(readFileSync(fileURLToPath(new URL("../data/surface-baked.json", import.meta.url)), "utf8"));
  }, 60_000);

  it("fails when any derivation source changed without a rebake (the code cannot be hashed at load)", () => {
    // layout.ts, fare-fence.ts, surface-layout.ts, surface-street.ts, surface-bake.ts, content-key.ts and the
    // polygon-clipping version. If this fails: pnpm --filter ./stations/shinjuku bake:surface
    expect(baked.sourceKey).toBe(derivationSourceKey());
  });

  it("is ignored unless every input matches", () => {
    const layout = builtLayout();
    expect(surfaceSeed(baked, surface, layout, bundle, plan)).not.toBeNull();
    // An equal copy is the same content; so is the layout after buildStation appends level walls.
    expect(surfaceSeed(baked, structuredClone(surface), structuredClone(layout), structuredClone(bundle), structuredClone(plan))).not.toBeNull();
    const walled = structuredClone(layout);
    walled.levels[0]!.walls.push({ a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, zMin: 0, zMax: 1, side: 1, kind: "wall" });
    expect(surfaceSeed(baked, surface, walled, bundle, plan)).not.toBeNull();
    const roads = { ...surface, roads: surface.roads.slice(1) };
    expect(surfaceSeed(baked, roads, layout, bundle, plan)).toBeNull();
    const moved = { ...bundle, nodes: bundle.nodes.map((n, i) => (i ? n : { ...n, position: { ...n.position, y: n.position.y + 0.001 } })) };
    expect(surfaceSeed(baked, surface, layout, moved, plan)).toBeNull();
    const level = plan.levels[0]!;
    const replanned = { ...plan, levels: [{ ...level, renderElevationM: level.renderElevationM + 0.001 }, ...plan.levels.slice(1)] };
    expect(surfaceSeed(baked, surface, layout, bundle, replanned)).toBeNull();
    expect(surfaceSeed({ ...baked, version: baked.version + 1 }, surface, layout, bundle, plan)).toBeNull();
    expect(surfaceSeed({ ...baked, valuesJson: "" }, surface, layout, bundle, plan)).toBeNull();
    expect(surfaceSeed(null, surface, layout, bundle, plan)).toBeNull();
  });

  it("falls back when a street pad, run, elevator room or node height changed (the stale-pad case)", () => {
    const layout = builtLayout();
    const bakedWalls = unpackValues(baked.valuesJson).surfacePadWalls.length;
    // Move one street-level pad: the pad walls (colliders) derived from it change, so a stale seed would be wrong.
    const pad = layout.streetPads[0] ?? layout.pads.find((p) => Math.abs(p.z) < 0.1)!;
    const shifted = structuredClone(layout);
    const target = [...shifted.streetPads, ...shifted.pads].find((p) => p.spaceId === pad.spaceId)!;
    target.rings = target.rings.map((r) => r.map((p) => ({ x: p.x + 0.4, y: p.y })));
    expect(surfaceSeed(baked, surface, shifted, bundle, plan)).toBeNull();
    // The table is genuinely different from what the changed layout derives, so using it would be a bug.
    const fresh = deriveSurface(surface, shifted, bundle);
    expect(JSON.stringify(fresh.surfacePadWalls)).not.toBe(JSON.stringify(unpackValues(baked.valuesJson).surfacePadWalls));
    expect(bakedWalls).toBeGreaterThan(0);
    const run = structuredClone(layout);
    run.runs[0]!.b.x += 0.3;
    expect(surfaceSeed(baked, surface, run, bundle, plan)).toBeNull();
    const heights = structuredClone(layout);
    const [id, z] = [...heights.nodeZ][0]!;
    heights.nodeZ.set(id, z + 0.01);
    expect(surfaceSeed(baked, surface, heights, bundle, plan)).toBeNull();
    const room = structuredClone(layout);
    const lv0 = room.levels.find((l) => Math.abs(l.z) < 0.1 && l.rooms.length)!;
    lv0.rooms[0]!.space.rings[0]![0]!.x += 0.2;
    expect(surfaceSeed(baked, surface, room, bundle, plan)).toBeNull();
  });
});
