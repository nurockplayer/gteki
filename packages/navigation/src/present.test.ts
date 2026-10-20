import { describe, expect, it } from "vitest";
import { createRouter, describeRoute, routePolyline } from "./index.ts";
import type { RouteResult } from "./index.ts";
import { createSyntheticBundle, syntheticEdge as edge } from "./fixtures.ts";

function route(bundle: ReturnType<typeof createSyntheticBundle>, from: string, to: string): RouteResult {
  const r = createRouter(bundle).route(from, to);
  if (!r.ok) throw new Error(r.message);
  return r;
}

describe("routePolyline", () => {
  it("follows reversed edge geometry and ends exactly on route nodes", () => {
    const b = createSyntheticBundle([
      edge("bent", "a", "start", { lengthM: null, geometry: [{ x: 10, y: 0, z: 0 }, { x: 5, y: 5, z: 0 }, { x: 0, y: 0, z: 0 }] }),
      edge("a-goal", "a", "goal"),
    ]);
    const pts = routePolyline(b, route(b, "start", "goal"));
    expect(pts.map((p) => [p.x, p.y])).toEqual([[0, 0], [5, 5], [10, 0], [20, 0]]);
    expect(pts.map((p) => p.stepIndex)).toEqual([-1, 0, 0, 1]);
  });

  it("marks interpolated heights as not known and never invents a measured z", () => {
    const b = createSyntheticBundle([edge("ramp", "a", "upper", { mode: "ramp" }), edge("s", "start", "a")]);
    b.nodes.find((n) => n.id === "upper")!.position.z = null;
    b.nodes.find((n) => n.id === "upper")!.renderZ = 3.5;
    const pts = routePolyline(b, route(b, "start", "upper"));
    expect(pts[pts.length - 1]).toMatchObject({ z: 3.5, zKnown: false, floorId: "upper" });
    expect(pts[1]).toMatchObject({ z: 0, zKnown: true });
  });

  it("treats symbolic polyline z as display-only", () => {
    const b = createSyntheticBundle([edge("s", "start", "goal", { geometryZ: "symbolic", geometry: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 1 }, { x: 20, y: 0, z: 0 }] })]);
    const pts = routePolyline(b, route(b, "start", "goal"));
    expect(pts[1]).toMatchObject({ z: 1, zKnown: false });
  });
});

describe("describeRoute", () => {
  it("groups straight walking and detects left/right turns from heading", () => {
    // start(0,0) → a(10,0) heading east, then a → b'(10,10) heading north = left turn.
    const b = createSyntheticBundle([edge("s-a", "start", "a"), edge("a-x", "a", "goal"), edge("a-n", "a", "isolated", { lengthM: 10 })]);
    b.nodes.find((n) => n.id === "isolated")!.position = { x: 10, y: 10, z: 0 };
    const left = describeRoute(b, route(b, "start", "isolated"), "en");
    expect(left.map((i) => i.kind)).toEqual(["start", "walk", "turn_left", "arrive"]);
    b.nodes.find((n) => n.id === "isolated")!.position = { x: 10, y: -10, z: 0 };
    expect(describeRoute(b, route(b, "start", "isolated"), "en").map((i) => i.kind)).toEqual(["start", "walk", "turn_right", "arrive"]);
    const straight = describeRoute(b, route(b, "start", "goal"), "ja");
    expect(straight.map((i) => i.kind)).toEqual(["start", "walk", "arrive"]);
    expect(straight[1]!.distanceM).toBe(20);
    expect(straight[1]!.text).toBe("約20m 直進");
  });

  it("says up/down only when evidenced and names the source floor label", () => {
    const b = createSyntheticBundle([edge("s-a", "start", "a"), edge("st", "a", "upper", { mode: "stairs" })]);
    const up = describeRoute(b, route(b, "start", "upper"), "en");
    expect(up[2]).toMatchObject({ kind: "stairs", vertical: "up", text: "Take the stairs up to 1F" });
    for (const n of b.nodes) n.position.z = null;
    for (const f of b.floors) f.elevationM = null;
    const unknown = describeRoute(b, route(b, "start", "upper"), "ja");
    expect(unknown[2]).toMatchObject({ kind: "stairs", vertical: null, text: "階段で1Fへ" });
  });

  it("merges a chain of escalator segments and keeps gates explicit", () => {
    const b = createSyntheticBundle([
      edge("gate", "start", "a", { mode: "gate", crossesFareBoundary: true, paid: null }),
      edge("e1", "a", "upper", { mode: "escalator", direction: "forward" }),
      edge("e2", "upper", "upper-2", { mode: "escalator", direction: "forward" }),
    ]);
    const kinds = describeRoute(b, route(b, "start", "upper-2"), "en");
    expect(kinds.map((i) => i.kind)).toEqual(["start", "gate", "escalator", "arrive"]);
    expect(kinds[2]!.stepIndexes).toEqual([1, 2]);
  });
});
