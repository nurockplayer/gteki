import { describe, expect, it } from "vitest";
import { createRouter, routeBetween, type RouteResult } from "@gteki/navigation";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { explainStepFreeFailure, floorLabel, narrate } from "../app/src/narrate.ts";

const { bundle } = loadShinjukuBundle();
const router = createRouter(bundle);
const poi = (id: string) => bundle.pois.find((p) => p.id === id)!;
function route(fromPoi: string, toPoi: string): RouteResult {
  const result = router.route(poi(fromPoi).connectorNodeIds, poi(toPoi).connectorNodeIds, { fare: "ticketed", stepFree: false, today: "2026-10-21" });
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe("round-two route narration", () => {
  it.each([
    ["platform to exit 1", "poi:platform:oedo", "poi:exit:1", 16],
    ["platform to exit 2", "poi:platform:oedo", "poi:exit:2", 17],
    ["exit 1 to exit 3", "poi:exit:1", "poi:exit:3", 29],
  ] as const)("keeps the consolidated instruction count stable for %s", (_label, from, to, count) => {
    const maneuvers = narrate(bundle, route(from, to));
    expect(maneuvers).toHaveLength(count);
    expect(maneuvers.filter((m) => m.kind === "walk").every((m) => m.lengthM >= 5)).toBe(true);
  });

  it("represents every graph floor change in the grouped narration", () => {
    for (const [from, to] of [["poi:platform:oedo", "poi:exit:1"], ["poi:platform:oedo", "poi:exit:2"], ["poi:exit:1", "poi:exit:3"]] as const) {
      const result = route(from, to);
      const narrated = narrate(bundle, result).flatMap((m) => m.floorChanges ?? []);
      const expected = result.steps.filter((s) => s.fromFloorId !== s.toFloorId).map((s) => ({ from: s.fromFloorId, to: s.toFloorId }));
      expect(narrated).toEqual(expected.map((f) => ({ from: floorLabel(bundle.floors.find((x) => x.id === f.from)).short, to: floorLabel(bundle.floors.find((x) => x.id === f.to)).short })));
    }
  });

  it("explains the stair-only step-free refusal and suggests a reachable same-category exit", () => {
    const origin = { kind: "poi" as const, poi: poi("poi:platform:oedo") };
    const profile = { fare: "ticketed" as const, stepFree: true, today: "2026-10-21" };
    const result = explainStepFreeFailure(bundle, router, origin, poi("poi:exit:1"), profile);
    expect(result.reason.en).toMatch(/uses stairs/);
    expect(result.alternative?.poi.category).toBe("exit");
    expect(result.alternative?.poi.id).toBe("poi:exit:3");
    const alternativeRoute = routeBetween(router, origin, result.alternative!.poi, profile);
    expect(alternativeRoute.ok).toBe(true);
    if (alternativeRoute.ok) expect(alternativeRoute.steps.every((step) => bundle.edges.find((edge) => edge.id === step.edgeId)?.wheelchair === true)).toBe(true);
    const unpaid = explainStepFreeFailure(bundle, router, origin, poi("poi:exit:1"), { fare: "unpaid_only", stepFree: true, today: "2026-10-21" });
    expect(unpaid.alternative).toBeNull();
  });

  it("collapses a contiguous multi-floor elevator ride to its final floor", () => {
    const base = route("poi:platform:oedo", "poi:exit:1");
    const floorIds = [-6, -3, -1].map((ordinal) => bundle.floors.find((floor) => floor.ordinal === ordinal)!.id);
    const steps = [0, 1].map((index) => ({ ...base.steps[0]!, mode: "elevator" as const, fromNodeId: `lift-${index}`, toNodeId: `lift-${index + 1}`, fromFloorId: floorIds[index]!, toFloorId: floorIds[index + 1]! }));
    const result: RouteResult = { ...base, steps, floorChanges: 2 };
    const instructions = narrate(bundle, result).filter((m) => m.kind === "elevator");
    expect(instructions).toHaveLength(1);
    expect(instructions[0]!.toFloorLabel).toBe("B1");
    expect(instructions[0]!.floorChanges).toEqual([{ from: "B6", to: "B3" }, { from: "B3", to: "B1" }]);
  });

  it("keeps spoken floor cues when a short floor-changing walk merges into the next maneuver", () => {
    const base = route("poi:platform:oedo", "poi:exit:1");
    const walk = bundle.edges.find((edge) => edge.mode === "walk")!;
    const elevator = bundle.edges.find((edge) => edge.mode === "elevator")!;
    const start = { ...bundle.nodes[0]!, id: "cue-start" };
    const landing = { ...bundle.nodes[0]!, id: "cue-landing" };
    const testBundle = { ...bundle, nodes: [...bundle.nodes, start, landing], edges: [...bundle.edges,
      { ...walk, id: "cue-walk", from: start.id, to: landing.id },
      { ...elevator, id: "cue-lift", from: landing.id, to: start.id },
    ] };
    const b1 = bundle.floors.find((floor) => floor.ordinal === -1)!.id;
    const gl = bundle.floors.find((floor) => floor.ordinal === 0)!.id;
    const result: RouteResult = { ...base, steps: [
      { ...base.steps[0]!, edgeId: "cue-walk", mode: "walk", fromNodeId: start.id, toNodeId: landing.id, lengthM: 1, fromFloorId: b1, toFloorId: gl },
      { ...base.steps[0]!, edgeId: "cue-lift", mode: "elevator", fromNodeId: landing.id, toNodeId: start.id, lengthM: 0, fromFloorId: gl, toFloorId: b1 },
    ] };
    const lift = narrate(testBundle, result).find((m) => m.kind === "elevator")!;
    expect(lift.ja).toContain("地下1階から地上へ移動");
    expect(lift.en).toContain("B1 to GL");
    expect(lift.floorChanges).toEqual([{ from: "B1", to: "GL" }, { from: "GL", to: "B1" }]);
  });

  it("keeps a real right turn at a junction after a short approach, but merges small non-junction bends", () => {
    const walk = bundle.edges.find((edge) => edge.mode === "walk")!;
    const nodeTemplate = bundle.nodes[0]!;
    const coords = [
      ["turn-start", 0, 0], ["turn-crossing", 0, 2], ["turn-right", 2, 2], ["turn-goal", 2, 7], ["turn-branch", -2, 2],
      ["bend-start", 0, 0], ["bend-middle", 0.5, 2], ["bend-goal", 1, 4],
    ] as const;
    const syntheticNodes = coords.map(([id, x, y]) => ({ ...nodeTemplate, id, position: { ...nodeTemplate.position, x, y } }));
    const testEdges = (pairs: readonly (readonly [string, string])[]) => pairs.map(([from, to], i) => ({ ...walk, id: `test-${from}-${to}-${i}`, from, to }));
    const turnEdges = testEdges([["turn-start", "turn-crossing"], ["turn-crossing", "turn-right"], ["turn-right", "turn-goal"], ["turn-crossing", "turn-branch"]]);
    const bendEdges = testEdges([["bend-start", "bend-middle"], ["bend-middle", "bend-goal"]]);
    const syntheticBundle = { ...bundle, nodes: [...bundle.nodes, ...syntheticNodes], edges: [...bundle.edges, ...turnEdges, ...bendEdges] };
    const floorId = route("poi:platform:oedo", "poi:exit:1").steps.find((step) => step.mode === "walk")!.fromFloorId;
    const customResult = (ids: readonly string[], lengths: readonly number[]): RouteResult => ({
      ...route("poi:platform:oedo", "poi:exit:1"),
      nodeIds: [...ids],
      steps: ids.slice(0, -1).map((fromNodeId, i) => ({ edgeId: `synthetic-${i}`, fromNodeId, toNodeId: ids[i + 1]!, reversed: false, mode: "walk" as const, lengthM: lengths[i]!, fromFloorId: floorId, toFloorId: floorId })),
    });
    const turned = narrate(syntheticBundle, customResult(["turn-start", "turn-crossing", "turn-right", "turn-goal"], [2, 2, 5]));
    expect(turned.some((m) => m.kind === "turn" && m.ja.startsWith("右へ曲がり"))).toBe(true);
    const bent = narrate(syntheticBundle, customResult(["bend-start", "bend-middle", "bend-goal"], [2, 2]));
    expect(bent.filter((m) => m.kind === "turn")).toHaveLength(0);
    expect(bent.filter((m) => m.kind === "walk")).toHaveLength(1);
  });
});
