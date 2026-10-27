import { describe, expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { planBundle } from "../gteki/scene.ts";

describe("planBundle: the scene ignores overlay graph additions", () => {
  const { bundle } = loadShinjukuBundle();
  const [a, b] = bundle.nodes;
  const exit = bundle.pois.find((p) => p.category === "exit")!;
  const extraNode = { ...a!, id: "p:sjk:n:extra" };
  const overlay = {
    ...bundle,
    nodes: [...bundle.nodes, extraNode],
    edges: [...bundle.edges,
      { ...bundle.edges[0]!, id: "p:sjk:e:to-extra", from: a!.id, to: extraNode.id },
      { ...bundle.edges[0]!, id: "p:sjk:e:between-public", from: a!.id, to: b!.id }],
    pois: bundle.pois.map((p) => (p.id === exit.id ? { ...p, connectorNodeIds: [...p.connectorNodeIds, extraNode.id] } : p)),
  };

  it("returns a public bundle unchanged", () => {
    expect(planBundle(bundle)).toBe(bundle);
  });
  it("drops overlay nodes and every p: edge, and keeps a POI's plan connectors", () => {
    const scene = planBundle(overlay);
    expect(scene.nodes).toHaveLength(bundle.nodes.length);
    expect(scene.edges.map((e) => e.id)).toEqual(bundle.edges.map((e) => e.id));
    expect(scene.pois.find((p) => p.id === exit.id)!.connectorNodeIds).toEqual(exit.connectorNodeIds);
  });
});
