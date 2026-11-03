import { describe, expect, it } from "vitest";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";
import { privateFloorRoutingEdges } from "./privateFloorRouting.ts";
import type { PolygonRegion } from "./privateLevels.ts";

const rect = (x: number, north: number, width: number, height: number) => [{ x, z: -north }, { x: x + width, z: -north }, { x: x + width, z: -north - height }, { x, z: -north - height }];
const regions: PolygonRegion[] = [{ kind: "polygon", level: "concourse", y: 0, rings: [rect(0, 0, 10, 10), rect(3, 3, 4, 4)] }];
const point = (x: number, y: number, z = 0) => ({ x, y, z });

describe("private floor routing exclusions", () => {
  it.each([
    { name: "hole crossing", path: [point(1, 5), point(9, 5)], blocked: true },
    { name: "outside selected floor", path: [point(1, 1), point(11, 1)], blocked: true },
    { name: "outer boundary", path: [point(0, 0), point(10, 0)], blocked: false },
    { name: "detour geometry", path: [point(1, 5), point(1, 1), point(9, 1), point(9, 5)], blocked: false },
    { name: "another elevation", path: [point(1, 5, 4), point(9, 5, 4)], blocked: false },
    { name: "sloping path", path: [point(1, 5), point(9, 5, 4)], blocked: false },
    { name: "flat excluded segment then slope", path: [point(1, 5), point(9, 5), point(9, 6, 4)], blocked: true },
  ])("checks the complete $name", ({ path, blocked }) => {
    const bundle = createSyntheticBundle([syntheticEdge("edge", "start", "a", { geometry: path })]);
    bundle.nodes.find(n => n.id === "start")!.position = path[0]!;
    bundle.nodes.find(n => n.id === "a")!.position = path.at(-1)!;
    const result = privateFloorRoutingEdges(bundle, regions);
    expect(result[0]!.closed).toBe(blocked);
    expect(bundle.edges[0]!.closed).toBe(false);
    expect(privateFloorRoutingEdges(bundle, [])).toBe(bundle.edges);
  });

  it("detects a hole narrower than a sampling step and retains existing closure metadata", () => {
    const bundle = createSyntheticBundle([syntheticEdge("edge", "start", "a", { closed: true, attributes: { existing: "retained" } })]);
    bundle.nodes.find(n => n.id === "start")!.position = point(1, 5);
    bundle.nodes.find(n => n.id === "a")!.position = point(9, 5);
    const thin = [{ ...regions[0]!, rings: [rect(0, 0, 10, 10), rect(5, 3, 0.0002, 4)] }];
    expect(privateFloorRoutingEdges(bundle, thin)[0]).toMatchObject({ closed: true, attributes: { existing: "retained", privateFloorBlockedReason: "outside-selected-floor" } });
    bundle.nodes.forEach(n => { n.floorId = "other-concourse"; });
    expect(privateFloorRoutingEdges(bundle, thin)[0]).toBe(bundle.edges[0]);
  });
});
