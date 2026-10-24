import { describe, expect, it } from "vitest";
import { createRouter, routeBetween } from "./index.ts";
import type { RouteProfile } from "./index.ts";
import { createSyntheticBundle } from "./fixtures.ts";

const unpaid: RouteProfile = { fare: "unpaid_only", stepFree: false };

describe("routeBetween applies the fare policy to the POIs themselves", () => {
  const setup = (paid: boolean | null) => {
    const b = createSyntheticBundle();
    const exit = b.pois.find((p) => p.id === "exit-a1")!;
    const dest = { ...b.pois.find((p) => p.id === "toilet")!, paid };
    return { router: createRouter(b), exit, dest };
  };

  it("routes an unpaid-only query between POIs known to be outside the paid area", () => {
    const { router, exit, dest } = setup(false);
    const r = routeBetween(router, { kind: "poi", poi: exit }, dest, unpaid);
    expect(r.ok).toBe(true);
  });

  it("fails closed for a paid or unknown-paid destination even when every edge is unpaid", () => {
    for (const paid of [true, null]) {
      const { router, exit, dest } = setup(paid);
      // The edges alone allow it; only the POI's own fare state rules it out.
      expect(router.route(exit.connectorNodeIds, dest.connectorNodeIds, unpaid).ok).toBe(true);
      const r = routeBetween(router, { kind: "poi", poi: exit }, dest, unpaid);
      expect(r).toMatchObject({ ok: false, reason: "no_path" });
      expect(routeBetween(router, { kind: "poi", poi: exit }, dest, { fare: "ticketed", stepFree: false }).ok).toBe(true);
    }
  });

  it("fails closed for a paid or unknown-paid origin POI, but not for a bare node origin", () => {
    for (const paid of [true, null]) {
      const { router, exit, dest } = setup(false);
      const r = routeBetween(router, { kind: "poi", poi: { ...exit, paid } }, dest, unpaid);
      expect(r).toMatchObject({ ok: false, reason: "no_path" });
    }
    const { router, dest } = setup(false);
    expect(routeBetween(router, { kind: "node", nodeId: "start" }, dest, unpaid).ok).toBe(true);
  });

  it("applies the same origin fare rule to node goals without adding destination evidence", () => {
    for (const paid of [true, null]) {
      const { router, exit, dest } = setup(false);
      const origin = { ...exit, paid };
      const poiFailure = routeBetween(router, { kind: "poi", poi: origin }, dest, unpaid);
      const nodeFailure = routeBetween(router, { kind: "poi", poi: origin }, { kind: "nodes", nodeIds: ["goal"] }, unpaid);
      expect(nodeFailure).toEqual(poiFailure);
    }

    const b = createSyntheticBundle();
    const router = createRouter(b);
    const origin = { ...b.pois.find((poi) => poi.id === "exit-a1")!, paid: false };
    const nodeGoals = ["goal"];
    const nodeResult = routeBetween(router, { kind: "poi", poi: origin }, { kind: "nodes", nodeIds: nodeGoals }, unpaid);
    expect(nodeResult.ok).toBe(true);
    if (nodeResult.ok) expect(nodeResult.sourceIds).toEqual(expect.arrayContaining(origin.evidence.sourceIds));
    expect(routeBetween(router, { kind: "poi", poi: origin }, { kind: "nodes", nodeIds: [] }, { fare: "ticketed", stepFree: false }))
      .toMatchObject({ ok: false, reason: "unknown_goal" });
  });

  it("routes to node goals exactly like the router for a ticketed profile", () => {
    const b = createSyntheticBundle();
    const router = createRouter(b);
    const origin = b.pois.find((poi) => poi.id === "exit-a1")!;
    const nodeIds = ["goal", "isolated"];
    const profile: RouteProfile = { fare: "ticketed", stepFree: false };
    expect(routeBetween(router, { kind: "poi", poi: origin }, { kind: "nodes", nodeIds }, profile))
      .toEqual(router.route(origin.connectorNodeIds, nodeIds, profile, [origin.evidence]));
  });

  it("keeps unknown_start / unknown_goal for POIs without connectors and joins both POIs' evidence", () => {
    const b = createSyntheticBundle();
    // Sources cited only by the POIs, so the result can carry them only through routeBetween.
    for (const id of ["origin-poi-source", "destination-poi-source"]) b.sources.push({ ...b.sources[0]!, id });
    const router = createRouter(b);
    const shop = b.pois.find((p) => p.id === "shop")!;
    const exit = { ...b.pois.find((p) => p.id === "exit-a1")!, evidence: { sourceIds: ["origin-poi-source"], method: "synthetic-fixture", checkedDate: "2026-10-20" } };
    const toilet = { ...b.pois.find((p) => p.id === "toilet")!, evidence: { sourceIds: ["destination-poi-source"], method: "synthetic-fixture", checkedDate: "2026-10-20" } };
    expect(routeBetween(router, { kind: "poi", poi: shop }, toilet, unpaid)).toMatchObject({ reason: "unknown_start" });
    expect(routeBetween(router, { kind: "poi", poi: exit }, shop, unpaid)).toMatchObject({ reason: "unknown_goal" });
    const r = routeBetween(router, { kind: "poi", poi: exit }, toilet, { fare: "ticketed", stepFree: false });
    if (!r.ok) throw new Error(r.message);
    expect(r.sourceIds).toEqual(expect.arrayContaining(["origin-poi-source", "destination-poi-source"]));
    const node = routeBetween(router, { kind: "node", nodeId: "start" }, toilet, { fare: "ticketed", stepFree: false });
    if (!node.ok) throw new Error(node.message);
    expect(node.sourceIds).toContain("destination-poi-source");
    expect(node.sourceIds).not.toContain("origin-poi-source");
  });
});
