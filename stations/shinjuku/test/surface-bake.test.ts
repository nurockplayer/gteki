import { beforeAll, describe, expect, it } from "vitest";
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
const freshLayout = () => {
  const layout = buildLayout(bundle, plan);
  protectFareAndAccess(layout, plan, bundle);
  return layout;
};

let fixture: ReturnType<typeof buildLayout>;
let shiftedFixture: ReturnType<typeof buildLayout>;
let shiftedValues: ReturnType<typeof deriveSurface>;
beforeAll(() => {
  fixture = freshLayout();
  shiftedFixture = structuredClone(fixture);
  const pad = fixture.streetPads[0] ?? fixture.pads.find((p) => Math.abs(p.z) < 0.1)!;
  const target = [...shiftedFixture.streetPads, ...shiftedFixture.pads].find((p) => p.spaceId === pad.spaceId)!;
  target.rings = target.rings.map((r) => r.map((p) => ({ x: p.x + 0.4, y: p.y })));
  shiftedValues = deriveSurface(surface, shiftedFixture, bundle);
}, 60_000);
// Each test gets an independent copy; expensive geometry is built once per file.
const builtLayout = () => structuredClone(fixture);

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

  it("accepts equivalent layouts and rendered wall additions", () => {
    const layout = builtLayout();
    expect(surfaceSeed(baked, surface, layout, bundle, plan)).not.toBeNull();
    expect(surfaceSeed(baked, structuredClone(surface), structuredClone(layout), structuredClone(bundle), structuredClone(plan))).not.toBeNull();
    const walled = structuredClone(layout);
    walled.levels[0]!.walls.push({ a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, zMin: 0, zMax: 1, side: 1, kind: "wall" });
    expect(surfaceSeed(baked, surface, walled, bundle, plan)).not.toBeNull();
  });

  it.each([
    { name: "changed roads", seed: (layout: ReturnType<typeof buildLayout>) => surfaceSeed(baked, { ...surface, roads: surface.roads.slice(1) }, layout, bundle, plan) },
    { name: "moved graph node", seed: (layout: ReturnType<typeof buildLayout>) => surfaceSeed(baked, surface, layout,
      { ...bundle, nodes: bundle.nodes.map((n, i) => i ? n : { ...n, position: { ...n.position, y: n.position.y + 0.001 } }) }, plan) },
    { name: "changed plan elevation", seed: (layout: ReturnType<typeof buildLayout>) => surfaceSeed(baked, surface, layout, bundle,
      { ...plan, levels: [{ ...plan.levels[0]!, renderElevationM: plan.levels[0]!.renderElevationM + 0.001 }, ...plan.levels.slice(1)] }) },
    { name: "changed version", seed: (layout: ReturnType<typeof buildLayout>) => surfaceSeed({ ...baked, version: baked.version + 1 }, surface, layout, bundle, plan) },
    { name: "empty values", seed: (layout: ReturnType<typeof buildLayout>) => surfaceSeed({ ...baked, valuesJson: "" }, surface, layout, bundle, plan) },
    { name: "missing table", seed: (layout: ReturnType<typeof buildLayout>) => surfaceSeed(null, surface, layout, bundle, plan) },
  ])("rejects $name", ({ seed }) => {
    expect(seed(builtLayout())).toBeNull();
  });

  it("falls back when a street pad, run, elevator room or node height changed (the stale-pad case)", () => {
    const layout = builtLayout();
    const bakedWalls = unpackValues(baked.valuesJson).surfacePadWalls.length;
    // Move one street-level pad: the pad walls (colliders) derived from it change, so a stale seed would be wrong.
    const shifted = structuredClone(shiftedFixture);
    expect(surfaceSeed(baked, surface, shifted, bundle, plan)).toBeNull();
    // The table is genuinely different from what the changed layout derives, so using it would be a bug.
    const fresh = shiftedValues;
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
