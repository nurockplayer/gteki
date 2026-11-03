import { describe, expect, it } from "vitest";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";
import { privateFloorRoutingEdges } from "./privateFloorRouting.ts";
import type { PolygonRegion } from "./privateLevels.ts";

const rect = (x: number, north: number, width: number, height: number) => [{ x, z: -north }, { x: x + width, z: -north }, { x: x + width, z: -north - height }, { x, z: -north - height }];
const regions: PolygonRegion[] = [{ kind: "polygon", level: "concourse", y: 0, rings: [rect(0, 0, 10, 10), rect(3, 3, 4, 4)], exclusions: [[rect(3, 3, 4, 4)]] }];
const point = (x: number, y: number, z = 0) => ({ x, y, z });

describe("private floor routing exclusions", () => {
  it.each([
    { name: "slightly sloping same-floor path", path: [point(1, 5), point(9, 5, 0.02)], blocked: true },
    { name: "offset same-floor path", path: [point(1, 5, 0.02), point(9, 5, 0.02)], blocked: true },
    { name: "unknown floor near the hole", path: [point(1, 5, 0.02), point(9, 5, 0.02)], levels: ["", ""], blocked: true },
    { name: "cross-level passage through the height band", path: [point(1, 5, -2), point(9, 5, 2)], levels: ["concourse", "upper"], blocked: false },
    { name: "different floors at the same elevation", path: [point(1, 5), point(9, 5, 0.02)], levels: ["concourse", "upper"], blocked: false },
    { name: "unknown floor with only one endpoint near the hole", path: [point(1, 5, 0.2), point(9, 5, 0.4)], levels: ["", ""], blocked: false },
    { name: "unknown floor endpoints more than a step apart", path: [point(1, 5, -0.2), point(9, 5, 0.2)], levels: ["", ""], blocked: false },
    { name: "hole crossing", path: [point(1, 5), point(9, 5)], blocked: true },
    { name: "outside selected floor", path: [point(1, 1), point(11, 1)], blocked: false },
    { name: "outer boundary", path: [point(0, 0), point(10, 0)], blocked: false },
    { name: "detour geometry", path: [point(1, 5), point(1, 1), point(9, 1), point(9, 5)], blocked: false },
    { name: "another level above", path: [point(1, 5, 4), point(9, 5, 4)], levels: ["upper", "upper"], blocked: false },
    { name: "sloping path above the hole", path: [point(1, 5), point(9, 5, 4)], levels: ["concourse", "upper"], blocked: false },
    { name: "flat segment of an edge rising over the height tolerance", path: [point(1, 5), point(9, 5), point(9, 6, 4)], blocked: false },
  ])("checks the complete $name", ({ path, blocked, levels }) => {
    const bundle = createSyntheticBundle([syntheticEdge("edge", "start", "a", { geometry: path })]);
    bundle.nodes.find(n => n.id === "start")!.position = path[0]!;
    bundle.nodes.find(n => n.id === "a")!.position = path.at(-1)!;
    if (levels) { bundle.nodes.find(n => n.id === "start")!.floorId = levels[0]!; bundle.nodes.find(n => n.id === "a")!.floorId = levels[1]!; }
    const result = privateFloorRoutingEdges(bundle, regions);
    expect(result[0]!.closed).toBe(blocked);
    expect(bundle.edges[0]!.closed).toBe(false);
    expect(privateFloorRoutingEdges(bundle, [])).toBe(bundle.edges);
  });

  it("detects a hole narrower than a sampling step and retains existing closure metadata", () => {
    const bundle = createSyntheticBundle([syntheticEdge("edge", "start", "a", { closed: true, attributes: { existing: "retained" } })]);
    bundle.nodes.find(n => n.id === "start")!.position = point(1, 5);
    bundle.nodes.find(n => n.id === "a")!.position = point(9, 5);
    const thin = [{ ...regions[0]!, rings: [rect(0, 0, 10, 10)], exclusions: [[rect(5, 3, 0.0002, 4)]] }];
    expect(privateFloorRoutingEdges(bundle, thin)[0]).toMatchObject({ closed: true, attributes: { existing: "retained", privateFloorBlockedReason: "explicit-private-hole" } });
    bundle.nodes.forEach(n => { n.floorId = "other-concourse"; });
    expect(privateFloorRoutingEdges(bundle, thin)[0]).toBe(bundle.edges[0]);
  });
});

it("does not infer a routing exclusion from an intrinsic gap in a selected polygon", () => {
  const bundle = createSyntheticBundle([syntheticEdge("edge", "start", "a")]);
  bundle.nodes.find(n => n.id === "start")!.position = point(1, 5);
  bundle.nodes.find(n => n.id === "a")!.position = point(9, 5);
  const { exclusions: _unused, ...floor } = regions[0]!;
  expect(privateFloorRoutingEdges(bundle, [floor])[0]!.closed).toBe(false);
});

it("keeps an accessible island inside an exclusion polygon walkable", () => {
  const bundle = createSyntheticBundle([syntheticEdge("edge", "start", "a")]);
  bundle.nodes.find(n => n.id === "start")!.position = point(4.25, 5);
  bundle.nodes.find(n => n.id === "a")!.position = point(5.75, 5);
  const island = [{ ...regions[0]!, exclusions: [[rect(3, 3, 4, 4), rect(4, 4, 2, 2)]] }];
  expect(privateFloorRoutingEdges(bundle, island)[0]!.closed).toBe(false);
});
