import { expect, it } from "vitest";
import { createRouter, DEFAULT_PROFILE, routeBetween } from "@gteki/navigation";
import { loadShinjukuBundle } from "../data/bundle.ts";

it("routes from E27 exit 3 to the Oedo platform through lifts without stairs or escalators", () => {
  const { bundle } = loadShinjukuBundle();
  const router = createRouter(bundle);
  const from = bundle.pois.find((p) => p.id === "poi:exit:3")!;
  const to = bundle.pois.find((p) => p.id === "poi:platform:oedo")!;
  const route = routeBetween(router, { kind: "poi", poi: from }, to, { ...DEFAULT_PROFILE, stepFree: true });
  if (!route.ok) throw new Error(route.message);
  const edges = route.steps.map((s) => bundle.edges.find((e) => e.id === s.edgeId)!);
  expect(edges.some((e) => e.mode === "elevator")).toBe(true);
  expect(edges.some((e) => e.mode === "stairs" || e.mode === "escalator")).toBe(false);
  for (const edge of edges) {
    expect(edge.wheelchair, edge.id).toBe(true);
    expect(edge.steps, edge.id).not.toBe(true);
    expect(edge.accessEvidence, edge.id).not.toBeNull();
  }
});
