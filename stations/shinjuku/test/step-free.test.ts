import { expect, it } from "vitest";
import { createRouter, DEFAULT_PROFILE, routeBetween, routePolyline } from "@gteki/navigation";
import { loadShinjukuBundle } from "../data/bundle.ts";
import navPaths from "../navmesh-paths.json" with { type: "json" };

it.each([
  ["S2", "poi:platform:oedo", "poi:exit:2", false],
  ["S4", "poi:exit:3", "poi:exit:6", false],
  ["S6", "poi:exit:3", "poi:platform:oedo", true],
])("%s retains a guide for the shipped route", (_id, fromId, toId, stepFree) => {
  const { bundle } = loadShinjukuBundle();
  const from = bundle.pois.find(p => p.id === fromId)!;
  const to = bundle.pois.find(p => p.id === toId)!;
  const route = routeBetween(createRouter(bundle), { kind: "poi", poi: from }, to, { ...DEFAULT_PROFILE, stepFree });
  if (!route.ok) throw new Error(route.message);
  expect(routePolyline(bundle, route, undefined, navPaths.edges, navPaths.joins).length).toBeGreaterThan(1);
  if (stepFree) expect(route.steps.some(step => step.mode === "elevator")).toBe(true);
});

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
