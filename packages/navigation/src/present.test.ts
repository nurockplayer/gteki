import { describe, expect, it } from "vitest";
import { createRouter, describeRoute, floorDisplayName, instructionPoints, routePolyline } from "./index.ts";
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

  it("prefers station-authored floor display names per language, falling back to ja then the source label", () => {
    const b = createSyntheticBundle([edge("s-a", "start", "a"), edge("st", "a", "upper", { mode: "stairs" })]);
    const upper = b.floors.find((f) => f.id === "upper")!;
    upper.displayNames = [{ lang: "ja", text: "地上1階" }, { lang: "en", text: "Ground floor" }];
    expect(describeRoute(b, route(b, "start", "upper"), "en")[2]!.text).toBe("Take the stairs up to Ground floor");
    expect(describeRoute(b, route(b, "start", "upper"), "ja")[2]!.text).toBe("階段で上へ・地上1階へ");
    upper.displayNames = [{ lang: "ja", text: "地上1階" }];
    expect(floorDisplayName(upper, "en")).toBe("地上1階");
    upper.displayNames = [];
    expect(floorDisplayName(upper, "en")).toBe("1F");
    expect(upper.sourceLabels[0]!.label).toBe("1F");
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

describe("instructionPoints", () => {
  it("includes the junction an instruction starts from, so one long step frames its whole segment", () => {
    const b = createSyntheticBundle([edge("only", "start", "goal", { lengthM: 20 })]);
    const r = route(b, "start", "goal");
    const points = routePolyline(b, r);
    const walk = describeRoute(b, r, "en").find((i) => i.stepIndexes.includes(0))!;
    const pts = instructionPoints(points, walk);
    expect(pts.map((p) => [p.x, p.y])).toEqual([[0, 0], [20, 0]]);
    expect(instructionPoints(points, { stepIndexes: [] })).toEqual([]);
  });

  it("starts a later instruction at the previous step's end, not before it", () => {
    const b = createSyntheticBundle([edge("s-a", "start", "a"), edge("a-up", "a", "upper", { mode: "stairs", lengthM: 6 })]);
    const r = route(b, "start", "upper");
    const points = routePolyline(b, r);
    expect(instructionPoints(points, { stepIndexes: [1] }).map((p) => [p.x, p.y])).toEqual([[10, 0], [10, 0]]);
  });
});

describe("routePolyline with a malformed one-point geometry", () => {
  it("draws the node-to-node fallback in travel direction even when the edge is traversed backwards", () => {
    const b = createSyntheticBundle([edge("back", "goal", "start", { geometry: [{ x: 5, y: 5, z: 0 }] })]);
    // An unknown start height tells the directions apart: endpoint snapping alone would hide a flip.
    b.nodes.find((n) => n.id === "start")!.position.z = null;
    const r = route(b, "start", "goal");
    expect(r.steps[0]!.reversed).toBe(true);
    const pts = routePolyline(b, r);
    expect(pts.map((p) => [p.x, p.y])).toEqual([[0, 0], [20, 0]]);
    expect(pts.map((p) => p.zKnown)).toEqual([false, true]);
  });
});

describe("walk wording follows the walked geometry", () => {
  const say = (geometry: { x: number; y: number; z: number }[] | undefined) => {
    const b = createSyntheticBundle([edge("w", "start", "goal", geometry ? { lengthM: null, geometry } : { lengthM: 20 })]);
    // The goal node sits on the polyline's end, so endpoint snapping keeps the drawn shape.
    if (geometry) b.nodes.find((n) => n.id === "goal")!.position = { ...geometry.at(-1)! };
    const r = createRouter(b).route("start", "goal");
    if (!r.ok) throw new Error(r.message);
    return [describeRoute(b, r, "ja")[1]!.text, describeRoute(b, r, "en")[1]!.text];
  };

  it("never says straight for one edge whose own polyline bends", () => {
    // 30 m north, 20 m east, 30 m south: two interior right angles inside a single walk edge.
    const [ja, en] = say([{ x: 0, y: 0, z: 0 }, { x: 0, y: 30, z: 0 }, { x: 20, y: 30, z: 0 }, { x: 20, y: 0, z: 0 }]);
    expect(ja).toBe("約80m 進む");
    expect(en).toBe("Continue ~80 m");
    // A short first leg must not merge into the next and hide the ~70° turn onto the long final run.
    expect(say([{ x: 0, y: 0, z: 0 }, { x: 0.9, y: 0, z: 0 }, { x: 0.9, y: 1.1, z: 0 }, { x: 19.69, y: 7.94, z: 0 }])[1]).toMatch(/^Continue/);
    // A gradual curve of ~0.5 m segments (a half circle from start to goal) still counts.
    const arc = Array.from({ length: 61 }, (_, i) => ({ x: 10 - 10 * Math.cos((i / 60) * Math.PI), y: 10 * Math.sin((i / 60) * Math.PI), z: 0 }));
    expect(say(arc)[1]).toMatch(/^Continue/);
  });

  it("still says straight for a straight edge, and ignores sub-metre jitter", () => {
    expect(say(undefined)).toEqual(["約20m 直進", "Go straight ~20 m"]);
    expect(say([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0.3, z: 0 }, { x: 10.2, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }])[0]).toBe("約20m 直進");
  });
});
