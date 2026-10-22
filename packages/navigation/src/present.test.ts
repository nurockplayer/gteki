import { describe, expect, it } from "vitest";
import { createRouter, describeRoute, floorDisplayName, instructionPoints, routePolyline } from "./index.ts";
import type { RouteProfile, RouteResult } from "./index.ts";
import { createSyntheticBundle, syntheticEdge as edge } from "./fixtures.ts";

function route(bundle: ReturnType<typeof createSyntheticBundle>, from: string, to: string, profile?: RouteProfile): RouteResult {
  const r = createRouter(bundle).route(from, to, profile);
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
    // `a` is a real choice point (the northern branch) and reaches the Restroom POI.
    expect(straight[1]!.text).toBe("約20m 進む。約10m先、トイレの分岐はそのまま直進");
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

describe("describeRoute arrival at a stair/escalator/ramp connector", () => {
  /** Exit A1 reached only via the foot of its unsurveyed stairs at "goal" (a stair_end). */
  function stairFootExit(kind: "stair_end" | "escalator_end" | "ramp_end" = "stair_end") {
    const b = createSyntheticBundle([edge("s-a", "start", "a"), edge("a-goal", "a", "goal")]);
    b.nodes.find((n) => n.id === "goal")!.kind = kind;
    const exit = b.pois.find((p) => p.id === "exit-a1")!;
    exit.connectorNodeIds = ["goal"];
    return { b, exit };
  }

  it("says the stairs to the destination start at the connector instead of claiming arrival", () => {
    const { b, exit } = stairFootExit();
    const r = route(b, "start", "goal");
    const en = describeRoute(b, r, "en", exit);
    expect(en[en.length - 1]).toMatchObject({ kind: "arrive", connector: "stair_end", vertical: null, toFloorId: "concourse", text: "Stairs to Exit A1 start here" });
    const ja = describeRoute(b, r, "ja", exit);
    expect(ja[ja.length - 1]!.text).toBe("Ａ１出口への階段はここから");
    // No direction or floor is claimed: the flight beyond the connector is not in the graph.
    expect(en[en.length - 1]!.text).not.toMatch(/\b(up|down)\b|1F|B1/);
    expect(ja[ja.length - 1]!.text).not.toMatch(/上|下|1F|B1/);
  });

  it("covers escalator and ramp ends", () => {
    for (const [kind, en, ja] of [
      ["escalator_end", "Escalator to Exit A1 starts here", "Ａ１出口へのエスカレーターはここから"],
      ["ramp_end", "Ramp to Exit A1 starts here", "Ａ１出口へのスロープはここから"],
    ] as const) {
      const { b, exit } = stairFootExit(kind);
      const r = route(b, "start", "goal");
      expect(describeRoute(b, r, "en", exit).at(-1)).toMatchObject({ connector: kind, text: en });
      expect(describeRoute(b, r, "ja", exit).at(-1)!.text).toBe(ja);
    }
  });

  it("names the POI in the requested language, then ja, and never by id", () => {
    const { b, exit } = stairFootExit();
    const r = route(b, "start", "goal");
    exit.names = [{ lang: "ja", text: "Ａ１出口" }];
    expect(describeRoute(b, r, "en", exit).at(-1)!.text).toBe("Stairs to Ａ１出口 start here");
    // A blank or whitespace-only name never hides another language's name, nor becomes the label.
    exit.names = [{ lang: "en", text: "" }, { lang: "ja", text: "Ａ１出口" }];
    expect(describeRoute(b, r, "en", exit).at(-1)!.text).toBe("Stairs to Ａ１出口 start here");
    exit.names = [{ lang: "en", text: "   " }, { lang: "ja", text: " " }, { lang: "zh-Hant", text: "A1出口" }];
    expect(describeRoute(b, r, "en", exit).at(-1)!.text).toBe("Stairs to A1出口 start here");
    exit.names = [{ lang: "en", text: "  " }];
    expect(describeRoute(b, r, "en", exit).at(-1)!.text).toBe("Stairs to your destination start here");
    exit.names = [];
    expect(describeRoute(b, r, "en", exit).at(-1)!.text).toBe("Stairs to your destination start here");
    expect(describeRoute(b, r, "ja", exit).at(-1)!.text).toBe("目的地への階段はここから");
  });

  it("keeps plain arrival when the destination is the stairs/escalator itself, or no POI is given", () => {
    const { b, exit } = stairFootExit();
    const r = route(b, "start", "goal");
    expect(describeRoute(b, r, "en").at(-1)).toEqual(expect.not.objectContaining({ connector: expect.anything() }));
    expect(describeRoute(b, r, "en").at(-1)!.text).toBe("Arrive at destination");
    exit.category = "stairs";
    expect(describeRoute(b, r, "en", exit).at(-1)!.text).toBe("Arrive at destination");
    const esc = stairFootExit("escalator_end");
    esc.exit.category = "escalator";
    expect(describeRoute(esc.b, route(esc.b, "start", "goal"), "en", esc.exit).at(-1)!.text).toBe("Arrive at destination");
    // A ramp has no POI category of its own, so a ramp_end connector never counts as the POI itself.
    const ramp = stairFootExit("ramp_end");
    ramp.exit.category = "stairs";
    expect(describeRoute(ramp.b, route(ramp.b, "start", "goal"), "en", ramp.exit).at(-1)!.connector).toBe("ramp_end");
  });

  it("keeps plain arrival when the route ends on a node that is not this POI's connector or not a *_end", () => {
    const { b, exit } = stairFootExit();
    // goal is a stair_end but not this POI's connector.
    exit.connectorNodeIds = ["start"];
    expect(describeRoute(b, route(b, "start", "goal"), "en", exit).at(-1)!.text).toBe("Arrive at destination");
    // An exit/junction connector is the destination itself.
    b.nodes.find((n) => n.id === "goal")!.kind = "exit";
    exit.connectorNodeIds = ["goal"];
    expect(describeRoute(b, route(b, "start", "goal"), "en", exit).at(-1)!.text).toBe("Arrive at destination");
  });

  it("does not invent a further flight when the route arrives by those very stairs", () => {
    const b = createSyntheticBundle([edge("s-a", "start", "a"), edge("st", "a", "upper", { mode: "stairs" })]);
    b.nodes.find((n) => n.id === "upper")!.kind = "stair_end";
    const exit = b.pois.find((p) => p.id === "exit-a1")!;
    exit.connectorNodeIds = ["upper"];
    const r = route(b, "start", "upper");
    const en = describeRoute(b, r, "en", exit);
    expect(en.at(-1)).toMatchObject({ kind: "arrive", connector: "stair_end", toFloorId: "upper", text: "Route ends at the stairs for Exit A1" });
    expect(describeRoute(b, r, "ja", exit).at(-1)!.text).toBe("Ａ１出口への階段で経路終了");
  });
});

describe("describeRoute start at a stair/escalator/ramp connector", () => {
  /** Exit A1 left from the foot of its unsurveyed stairs at "goal" (a stair_end): the route walks away from it. */
  function stairFootOrigin(kind: "stair_end" | "escalator_end" | "ramp_end" = "stair_end") {
    const b = createSyntheticBundle([edge("s-a", "start", "a"), edge("a-goal", "a", "goal")]);
    b.nodes.find((n) => n.id === "goal")!.kind = kind;
    const exit = b.pois.find((p) => p.id === "exit-a1")!;
    exit.connectorNodeIds = ["goal"];
    return { b, exit, r: route(b, "goal", "start") };
  }

  it("says the route starts at the foot of the stairs, which are not part of it", () => {
    const { b, exit, r } = stairFootOrigin();
    const en = describeRoute(b, r, "en", undefined, exit);
    expect(en[0]).toMatchObject({ kind: "start", connector: "stair_end", stepIndexes: [], text: "Start at the foot of the Exit A1 stairs (the stairs are not part of this route)" });
    expect(describeRoute(b, r, "ja", undefined, exit)[0]!.text).toBe("Ａ１出口の階段の下から出発（階段は経路に含まれません）");
    // Only the opening line changes: the steps are those of the same route.
    expect(en.slice(1).map((i) => i.stepIndexes)).toEqual(describeRoute(b, r, "en").slice(1).map((i) => i.stepIndexes));
  });

  it("covers escalator and ramp ends without claiming a foot", () => {
    for (const [kind, en, ja] of [
      ["escalator_end", "Start at the end of the Exit A1 escalator (the escalator is not part of this route)", "Ａ１出口のエスカレーターの端から出発（エスカレーターは経路に含まれません）"],
      ["ramp_end", "Start at the end of the Exit A1 ramp (the ramp is not part of this route)", "Ａ１出口のスロープの端から出発（スロープは経路に含まれません）"],
    ] as const) {
      const { b, exit, r } = stairFootOrigin(kind);
      expect(describeRoute(b, r, "en", undefined, exit)[0]).toMatchObject({ connector: kind, text: en });
      expect(describeRoute(b, r, "ja", undefined, exit)[0]!.text).toBe(ja);
    }
  });

  it("names the POI like the arrival side does, and never by id", () => {
    const { b, exit, r } = stairFootOrigin();
    exit.names = [{ lang: "ja", text: "４番出口" }];
    expect(describeRoute(b, r, "en", undefined, exit)[0]!.text).toBe("Start at the foot of the ４番出口 stairs (the stairs are not part of this route)");
    exit.names = [];
    expect(describeRoute(b, r, "en", undefined, exit)[0]!.text).toBe("Start at the foot of the stairs (the stairs are not part of this route)");
    expect(describeRoute(b, r, "ja", undefined, exit)[0]!.text).toBe("階段の下から出発（階段は経路に含まれません）");
  });

  it("keeps the plain start without an origin POI, for a bare node, or when the origin is not that connector", () => {
    const { b, exit, r } = stairFootOrigin();
    expect(describeRoute(b, r, "en")[0]).toEqual(expect.objectContaining({ kind: "start", text: "Start" }));
    expect(describeRoute(b, r, "en")[0]).toEqual(expect.not.objectContaining({ connector: expect.anything() }));
    expect(describeRoute(b, r, "ja", undefined, exit)[0]!.connector).toBe("stair_end");
    // An exit/junction connector is the origin itself.
    b.nodes.find((n) => n.id === "goal")!.kind = "exit";
    expect(describeRoute(b, r, "en", undefined, exit)[0]!.text).toBe("Start");
    // A stair_end that is not this POI's connector.
    b.nodes.find((n) => n.id === "goal")!.kind = "stair_end";
    exit.connectorNodeIds = ["start"];
    expect(describeRoute(b, r, "en", undefined, exit)[0]!.text).toBe("Start");
  });

  it("keeps the plain start when the origin is the stairs/escalator itself", () => {
    const { b, exit, r } = stairFootOrigin();
    exit.category = "stairs";
    expect(describeRoute(b, r, "en", undefined, exit)[0]!.text).toBe("Start");
    const ramp = stairFootOrigin("ramp_end");
    ramp.exit.category = "stairs";
    // A ramp has no POI category of its own, so a ramp_end connector never counts as the POI itself.
    expect(describeRoute(ramp.b, ramp.r, "en", undefined, ramp.exit)[0]!.connector).toBe("ramp_end");
  });

  it("does not say the stairs are left out when the route starts by climbing them", () => {
    const b = createSyntheticBundle([edge("st", "upper", "a", { mode: "stairs" }), edge("s-a", "a", "start")]);
    b.nodes.find((n) => n.id === "upper")!.kind = "stair_end";
    const exit = b.pois.find((p) => p.id === "exit-a1")!;
    exit.connectorNodeIds = ["upper"];
    const r = route(b, "upper", "start");
    expect(r.steps[0]!.mode).toBe("stairs");
    expect(describeRoute(b, r, "en", undefined, exit)[0]).toEqual(expect.objectContaining({ kind: "start", text: "Start" }));
    expect(describeRoute(b, r, "en", undefined, exit)[0]).toEqual(expect.not.objectContaining({ connector: expect.anything() }));
  });
});

describe("describeRoute opening leg", () => {
  it("only says how far: no heading comes before it, so it is never 'straight', bent or not", () => {
    const b = createSyntheticBundle([edge("s-a", "start", "a"), edge("a-x", "a", "goal")]);
    const r = route(b, "start", "goal");
    expect(describeRoute(b, r, "en")[1]!.text).toMatch(/^Go ~20 m/);
    expect(describeRoute(b, r, "ja")[1]!.text).toMatch(/^約20m 進む/);
    const bent = createSyntheticBundle([edge("u", "start", "goal", { lengthM: null, geometry: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 30, z: 0 }, { x: 20, y: 30, z: 0 }, { x: 20, y: 0, z: 0 }] })]);
    bent.nodes.find((n) => n.id === "goal")!.position = { x: 20, y: 0, z: 0 };
    expect(describeRoute(bent, route(bent, "start", "goal"), "en")[1]!.text).toBe("Go ~80 m");
  });

  it("a later straight walk still says straight", () => {
    const b = createSyntheticBundle([edge("g", "start", "a", { mode: "gate" }), edge("a-goal", "a", "goal")]);
    b.nodes.find((n) => n.id === "a")!.position = { x: 0, y: 0, z: 0 };
    b.nodes.find((n) => n.id === "goal")!.position = { x: 20, y: 0, z: 0 };
    expect(describeRoute(b, route(b, "start", "goal"), "en").map((i) => i.text)).toEqual(["Start", "Pass the ticket gate", "Go straight ~20 m", "Arrive at destination"]);
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
  /** The walk is not the route's opening leg (a zero-length gate comes first): that leg only says "Go", never "straight". */
  const say = (geometry: { x: number; y: number; z: number }[] | undefined) => {
    const b = createSyntheticBundle([edge("g", "pre", "start", { mode: "gate" }), edge("w", "start", "goal", geometry ? { lengthM: null, geometry } : { lengthM: 20 })]);
    b.nodes.push({ ...b.nodes.find((n) => n.id === "start")!, id: "pre" });
    // The goal node sits on the polyline's end, so endpoint snapping keeps the drawn shape.
    if (geometry) b.nodes.find((n) => n.id === "goal")!.position = { ...geometry.at(-1)! };
    const r = createRouter(b).route("pre", "goal");
    if (!r.ok) throw new Error(r.message);
    return [describeRoute(b, r, "ja")[2]!.text, describeRoute(b, r, "en")[2]!.text];
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
    // 10 m at 0°, 30 m at +30°, 30 m at −30°: each heading is within 35° of the first, but the walk turns 60°.
    const r = Math.PI / 180;
    const zig = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 10, z: 0 }];
    zig.push({ x: zig[1]!.x + 30 * Math.sin(30 * r), y: zig[1]!.y + 30 * Math.cos(30 * r), z: 0 });
    zig.push({ x: zig[2]!.x + 30 * Math.sin(-30 * r), y: zig[2]!.y + 30 * Math.cos(-30 * r), z: 0 });
    expect(say(zig)[1]).toMatch(/^Continue/);
  });

  it("says continue, not straight, over a sidestep jog (Shinjuku poi:toilet:3)", () => {
    // Segments of the given lengths (m) at the given headings (deg, atan2(dx, dy)) from the origin.
    const walk = (legs: [number, number][]) => legs.reduce((pts, [m, deg]) => {
      const p = pts.at(-1)!;
      return [...pts, { x: p.x + m * Math.sin((deg * Math.PI) / 180), y: p.y + m * Math.cos((deg * Math.PI) / 180), z: 0 }];
    }, [{ x: 0, y: 0, z: 0 }]);
    // 3 m / 0.9 m / 2.7 m at -106 / -19 / -107 deg: the 0.9 m piece is an ~87 deg sidestep, so the walker is offset 0.9 m.
    expect(say(walk([[3, -106], [0.9, -19], [2.7, -107]]))).toEqual(["約7m 進む", "Continue ~7 m"]);
    // The same walk with a 0.3 m sidestep stays under JOG_M and is still straight.
    expect(say(walk([[3, -106], [0.3, -19], [2.7, -107]]))).toEqual(["約6m 直進", "Go straight ~6 m"]);
    // A gentle curve drifting 10 deg per segment stays within the 35 deg range: no jog.
    expect(say(walk([[5, 0], [5, 10], [5, 20], [5, 30], [5, 20], [5, 10]]))).toEqual(["約30m 直進", "Go straight ~30 m"]);
  });

  it("still says straight for a straight edge, and ignores sub-metre jitter", () => {
    expect(say(undefined)).toEqual(["約20m 直進", "Go straight ~20 m"]);
    expect(say([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0.3, z: 0 }, { x: 10.2, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }])[0]).toBe("約20m 直進");
  });
});

describe("describeRoute junction hints", () => {
  const at = (id: string, x: number, y: number) => ({ id, floorId: "concourse", position: { x, y, z: 0 }, kind: "junction" as const, inOut: null, sourceRefs: [] });

  /**
   * Synthetic reproduction of the Ikebukuro column-hall report: after turning right at `a`, one ~90 m
   * walk bends under the turn threshold at p and q, both choice points. p: a branch peels off 31° to
   * the left of arrival, so the route (bending 6° right) must keep right. q: a branch leaves east at
   * ~96°, so the route is clearly the straightest and goes on past Exit B.
   */
  function columnHall(extra: Parameters<typeof createSyntheticBundle>[0] = []) {
    const b = createSyntheticBundle([
      edge("s-a", "start", "a"),
      edge("a-east", "a", "goal"),
      edge("a-p", "a", "p", { lengthM: 30 }),
      edge("p-q", "p", "q", { lengthM: 30 }),
      edge("q-g", "q", "g", { lengthM: 30 }),
      edge("p-fork", "p", "r", { lengthM: 30 }),
      edge("q-east", "q", "s", { lengthM: 30 }),
      ...extra!,
    ]);
    b.nodes.push(at("p", 10, -30), at("q", 7, -60), at("g", 7, -90), at("r", 25, -55), at("s", 37, -60), at("lift-top", 7, -60));
    b.pois.push({
      id: "exit-b", category: "exit", names: [{ lang: "ja", text: "Ｂ出口" }, { lang: "en", text: "Exit B" }], aliases: [],
      floorId: "concourse", displayPosition: { x: 7, y: -60, z: 0 }, connectorNodeIds: ["q"], paid: false, evidence: b.pois[0]!.evidence,
    });
    return b;
  }

  it("names keep-right and straight-past choices inside one merged walk", () => {
    const b = columnHall();
    const r = route(b, "start", "g");
    const en = describeRoute(b, r, "en");
    expect(en.map((i) => i.kind)).toEqual(["start", "walk", "turn_right", "arrive"]);
    expect(en[2]).toMatchObject({
      distanceM: 90,
      junctions: [
        { nodeId: "p", stepIndex: 2, atM: 30, action: "keep_right", name: null },
        { nodeId: "q", stepIndex: 3, atM: 60, action: "straight", name: "Exit B" },
      ],
      text: "Turn right, ~90 m. After ~30 m, keep right at the junction. After ~60 m, continue straight past Exit B.",
    });
    // The turn at `a` is a choice point too, but the turn instruction already marks it.
    expect(en[1]!.junctions).toBeUndefined();
    expect(describeRoute(b, r, "ja")[2]!.text).toBe("右へ曲がり約90m。約30m先の分岐は右寄りに進む。約60m先、Ｂ出口の分岐はそのまま直進");
  });

  it("mirrors to keep-left and falls back to the ja POI name, never an id", () => {
    const b = columnHall();
    for (const n of b.nodes) n.position.x = -n.position.x;
    b.pois.find((p) => p.id === "exit-b")!.names = [{ lang: "ja", text: "Ｂ出口" }];
    const en = describeRoute(b, route(b, "start", "g"), "en");
    expect(en.map((i) => i.kind)).toEqual(["start", "walk", "turn_left", "arrive"]);
    expect(en[2]!.text).toBe("Turn left, ~90 m. After ~30 m, keep left at the junction. After ~60 m, continue straight past Ｂ出口.");
    b.pois.find((p) => p.id === "exit-b")!.names = [];
    expect(describeRoute(b, route(b, "start", "g"), "en")[2]!.junctions![1]).toMatchObject({ action: "straight", name: null });
  });

  it("counts only branches that can be walked away from the node", () => {
    const strip = (b: ReturnType<typeof columnHall>) => b.edges.filter((e) => e.id !== "p-fork" && e.id !== "q-east");
    const kept = (b: ReturnType<typeof columnHall>) => describeRoute(b, route(b, "start", "g"), "en")[2]!;
    // Degree 2 (the route's own in/out edges only): no hint, and the text is unchanged.
    const plain = columnHall();
    plain.edges = strip(plain);
    expect(kept(plain).junctions).toBeUndefined();
    expect(kept(plain).text).toBe("Turn right, ~90 m");
    for (const blocked of [{ closed: true }, { verification: "unverified" as const }, { verification: "geometry_only" as const }]) {
      const b = columnHall();
      b.edges = [...strip(b), edge("q-east", "q", "s", { lengthM: 30, ...blocked })];
      expect(kept(b).junctions).toBeUndefined();
    }
    // A one-way branch that only arrives at q offers no choice there; one that leaves q does.
    const into = columnHall();
    into.edges = [...strip(into), edge("q-east", "s", "q", { lengthM: 30, direction: "forward" })];
    expect(kept(into).junctions).toBeUndefined();
    const out = columnHall();
    out.edges = [...strip(out), edge("q-east", "q", "s", { lengthM: 30, direction: "forward" })];
    expect(kept(out).junctions).toEqual([{ nodeId: "q", stepIndex: 3, atM: 60, action: "straight", name: "Exit B" }]);
  });

  it("reads the station graph, not the traveller profile: a stair branch is still a visible choice", () => {
    const b = columnHall();
    b.edges = b.edges.filter((e) => e.id !== "p-fork" && e.id !== "q-east");
    b.edges.push(edge("p-stairs", "p", "r", { mode: "stairs", lengthM: 30, wheelchair: false, steps: true }));
    const stepFree: RouteProfile = { fare: "ticketed", stepFree: true, avoidModes: ["stairs"] };
    const r = route(b, "start", "g", stepFree);
    expect(describeRoute(b, r, "en")[2]!.junctions).toEqual([{ nodeId: "p", stepIndex: 2, atM: 30, action: "keep_right", name: null }]);
  });

  it("drops branches the query closes (closures, known hours at departure, strict UNKNOWN hours)", () => {
    // A second corridor on the route's own line at p would make the side ambiguous — unless it is shut.
    const b = columnHall();
    b.edges = b.edges.filter((e) => e.id !== "q-east");
    b.edges.push(edge("p-twin", "p", "lift-top", { lengthM: 31, hours: { kind: "window", open: "07:00", close: "09:00", evidence: b.edges[0]!.hours!.evidence } }));
    const kept = (profile?: RouteProfile) => describeRoute(b, route(b, "start", "g", profile), "en")[2]!.junctions;
    expect(kept()).toBeUndefined();
    const keepRight = [{ nodeId: "p", stepIndex: 2, atM: 30, action: "keep_right", name: null }];
    expect(kept({ fare: "ticketed", stepFree: false, extraClosedEdgeIds: ["p-twin"] })).toEqual(keepRight);
    expect(kept({ fare: "ticketed", stepFree: false, at: { weekday: "mon", minutes: 12 * 60 } })).toEqual(keepRight);
    expect(kept({ fare: "ticketed", stepFree: false, at: { weekday: "mon", minutes: 8 * 60 } })).toBeUndefined();
    // Shut at a 06:59 departure but open from 07:00, before the ~83 s walk reaches p: it still counts.
    expect(kept({ fare: "ticketed", stepFree: false, at: { weekday: "mon", minutes: 6 * 60 + 59 } })).toBeUndefined();
    // Open during the route's first minute (08:59) though shut from 09:00: it counts.
    expect(kept({ fare: "ticketed", stepFree: false, at: { weekday: "mon", minutes: 8 * 60 + 59.5 } })).toBeUndefined();
    // Shut for the whole walk, across midnight into Monday: dropped.
    expect(kept({ fare: "ticketed", stepFree: false, at: { weekday: "sun", minutes: 23 * 60 + 59.5 } })).toEqual(keepRight);
    // A malformed departure (minute 1440) is an UNKNOWN time, never Monday 00:00: the branch counts.
    const malformed: RouteProfile = { fare: "ticketed", stepFree: false, at: { weekday: "sun", minutes: 23 * 60 + 59.5 } };
    const r = route(b, "start", "g", malformed);
    r.profile.at = { weekday: "sun", minutes: 1440 };
    expect(describeRoute(b, r, "en")[2]!.junctions).toBeUndefined();
    b.edges.find((e) => e.id === "p-twin")!.hours = null;
    expect(kept({ fare: "ticketed", stepFree: false, hours: "require_known" })).toEqual(keepRight);
    expect(kept({ fare: "ticketed", stepFree: false })).toBeUndefined();
  });

  it("does not count a reciprocal or duplicated edge as a branch, but does count a parallel corridor drawn elsewhere", () => {
    const b = columnHall();
    b.edges = b.edges.filter((e) => e.id !== "p-fork" && e.id !== "q-east");
    b.edges.push(edge("p-a-back", "p", "a", { direction: "forward" }), edge("p-q-dup", "p", "q", { lengthM: 31 }));
    expect(describeRoute(b, route(b, "start", "g"), "en")[2]!.junctions).toBeUndefined();
    // A second corridor to q that leaves p ~8° left of arrival (the route bends 6° right): keep right at p.
    // It rejoins at q from behind, so q is a junction too, where the route clearly goes straight on.
    b.edges = b.edges.filter((e) => e.id !== "p-q-dup");
    b.edges.push(edge("p-q-west", "p", "q", { lengthM: 40, geometry: [{ x: 10, y: -30, z: 0 }, { x: 12, y: -45, z: 0 }, { x: 7, y: -60, z: 0 }] }));
    expect(describeRoute(b, route(b, "start", "g"), "en")[2]!.junctions).toEqual([
      { nodeId: "p", stepIndex: 2, atM: 30, action: "keep_right", name: null },
      { nodeId: "q", stepIndex: 3, atM: 60, action: "straight", name: "Exit B" },
    ]);
  });

  it("treats a branch at exactly 90° as ahead when deciding whether a side is unambiguous", () => {
    const b = columnHall();
    b.edges = b.edges.filter((e) => e.id !== "q-east" && e.id !== "p-fork");
    b.nodes.push(at("ahead", 10, -55), at("west", -10, -30));
    b.edges.push(edge("p-ahead", "p", "ahead", { lengthM: 25 }), edge("p-west", "p", "west", { lengthM: 20 }));
    // Branches dead ahead (straighter than the route's 6° right) and at exactly 90° right flank it: "keep right" could take either.
    expect(describeRoute(b, route(b, "start", "g"), "en")[2]!.junctions).toBeUndefined();
    b.edges = b.edges.filter((e) => e.id !== "p-west");
    expect(describeRoute(b, route(b, "start", "g"), "en")[2]!.junctions).toEqual([{ nodeId: "p", stepIndex: 2, atM: 30, action: "keep_right", name: null }]);
  });

  it("never attaches a hint to a wait or moves it: a wait splits the walk at its junction", () => {
    const b = columnHall();
    const evidence = b.edges[0]!.hours!.evidence;
    b.edges = b.edges.map((e) => e.id === "p-q" ? { ...e, hours: { kind: "window" as const, open: "08:00", close: "20:00", evidence } } : e);
    const r = route(b, "start", "g", { fare: "ticketed", stepFree: false, at: { weekday: "mon", minutes: 7 * 60 + 59 } });
    expect(r.steps[2]!.waitSeconds).toBeGreaterThan(0);
    const en = describeRoute(b, r, "en");
    expect(en.map((i) => i.kind)).toEqual(["start", "walk", "turn_right", "wait", "walk", "arrive"]);
    const wait = en[3]!;
    expect(wait).toMatchObject({ beforeStepIndex: 2, stepIndexes: [] });
    expect(wait.junctions).toBeUndefined();
    // The walk before the wait ends at p, so p gets no hint; the walk after it still hints at q.
    expect(en[2]!.junctions).toBeUndefined();
    expect(en[4]!.junctions).toEqual([{ nodeId: "q", stepIndex: 3, atM: 30, action: "straight", name: "Exit B" }]);
  });

  it("records the routing profile on the result, so callers need not pass it again", () => {
    const b = columnHall();
    const profile: RouteProfile = { fare: "unpaid_only", stepFree: true, extraClosedEdgeIds: ["q-east"] };
    expect(route(b, "start", "g", profile).profile).toEqual(profile);
  });

  it("keeps the departure conditions the route was computed under when the caller's profile changes later", () => {
    const b = columnHall();
    b.edges = b.edges.filter((e) => e.id !== "q-east");
    b.edges.push(edge("p-twin", "p", "lift-top", { lengthM: 31, hours: { kind: "window", open: "07:00", close: "09:00", evidence: b.edges[0]!.hours!.evidence } }));
    const profile: RouteProfile = { fare: "ticketed", stepFree: false, at: { weekday: "mon", minutes: 8 * 60 }, extraClosedEdgeIds: [] };
    const r = route(b, "start", "g", profile);
    profile.at!.minutes = 12 * 60;
    profile.extraClosedEdgeIds!.push("p-twin");
    // At 08:00 the twin corridor on the route's line is open, so no side can be named.
    expect(describeRoute(b, r, "en")[2]!.junctions).toBeUndefined();
  });

  it("says straight past a lift whose doors give no heading, and stays silent when branches cannot be told apart", () => {
    const lift = columnHall();
    lift.edges = lift.edges.filter((e) => e.id !== "p-fork" && e.id !== "q-east");
    lift.edges.push(edge("q-lift", "q", "upper", { mode: "elevator", lengthM: 2 }));
    expect(describeRoute(lift, route(lift, "start", "g"), "en")[2]!.junctions).toEqual([{ nodeId: "q", stepIndex: 3, atM: 60, action: "straight", name: "Exit B" }]);
    // A second corridor leaving p along exactly the route's line: "keep left/right/straight" would be a guess.
    const twin = columnHall();
    twin.edges = twin.edges.filter((e) => e.id !== "p-fork" && e.id !== "q-east");
    twin.edges.push(edge("p-twin", "p", "lift-top", { lengthM: 31 }));
    expect(describeRoute(twin, route(twin, "start", "g"), "en")[2]!.junctions).toBeUndefined();
    // A sub-metre walk connector has no heading and may lead into a straighter corridor: no hint, not "straight".
    const stub = columnHall();
    stub.edges = stub.edges.filter((e) => e.id !== "p-fork" && e.id !== "q-east");
    stub.nodes.push(at("stub", 10, -30.5));
    stub.edges.push(edge("p-stub", "p", "stub", { lengthM: 0.5 }));
    expect(describeRoute(stub, route(stub, "start", "g"), "en")[2]!.junctions).toBeUndefined();
  });

  it("calls the middle of a three-way fork straight only when it is the straightest", () => {
    const fork = (leftX: number, rightX: number) => {
      const b = columnHall();
      b.edges = b.edges.filter((e) => e.id !== "p-fork" && e.id !== "q-east");
      b.nodes.push(at("fork-l", leftX, -55), at("fork-r", rightX, -55));
      b.edges.push(edge("p-l", "p", "fork-l", { lengthM: 30 }), edge("p-r", "p", "fork-r", { lengthM: 30 }));
      return describeRoute(b, route(b, "start", "g"), "en")[2]!;
    };
    // Branches at about 31° either side of arrival; the route bends 6°: it is the straightest.
    expect(fork(25, -5).junctions).toEqual([{ nodeId: "p", stepIndex: 2, atM: 30, action: "straight", name: null }]);
    // Both branches lie left of the route (31° and 2° right of arrival vs the route's 6°): keep right.
    expect(fork(25, 9).junctions).toEqual([{ nodeId: "p", stepIndex: 2, atM: 30, action: "keep_right", name: null }]);
    // A branch dead ahead is straighter than the route, with another on its far side: no side or "straight" is safe.
    expect(fork(10, -5).junctions).toBeUndefined();
    // Same when the far-side branch bends too sharply to compete on straightness (45°): "keep right" could take it.
    expect(fork(10, -15).junctions).toBeUndefined();
    // A branch behind the traveller (here ~117° right of arrival) does not make "keep right" ambiguous.
    const behind = columnHall();
    behind.edges = behind.edges.filter((e) => e.id !== "q-east");
    behind.nodes.push(at("back", -10, -20));
    behind.edges.push(edge("p-back", "p", "back", { lengthM: 20 }));
    expect(describeRoute(behind, route(behind, "start", "g"), "en")[2]!.junctions).toEqual([{ nodeId: "p", stepIndex: 2, atM: 30, action: "keep_right", name: null }]);
  });

  it("measures headings over the first ~5 m, so a snapping hook on a branch does not move it", () => {
    const b = columnHall();
    b.edges = b.edges.filter((e) => e.id !== "q-east");
    // The fork's first 0.3 m hooks hard right before running 31° left of arrival.
    b.edges = b.edges.map((e) => e.id === "p-fork" ? { ...e, geometry: [{ x: 10, y: -30, z: 0 }, { x: 9.7, y: -30.1, z: 0 }, { x: 25, y: -55, z: 0 }] } : e);
    expect(describeRoute(b, route(b, "start", "g"), "en")[2]!.junctions).toEqual([{ nodeId: "p", stepIndex: 2, atM: 30, action: "keep_right", name: null }]);
  });
});

describe("describeRoute short legs, lift rides and continued flights (Shinjuku E27 shapes)", () => {
  type Bundle = ReturnType<typeof createSyntheticBundle>;
  const node = (id: string, floorId: string, x: number, y: number) => ({ id, floorId, position: { x, y, z: null }, kind: "junction" as const, inOut: null, sourceRefs: [] });
  /** MLIT-style floors: symbolic heights, so up/down rests on same-operator ordinals alone. */
  const floor = (id: string, label: string, ordinal: number | null) => ({
    id, operatorId: "operator-a", sourceLabels: [{ operatorId: "operator-a", label, sourceId: "fixture-geometry" }],
    ordinal, intermediate: ordinal !== null && !Number.isInteger(ordinal), elevationM: null, elevationSource: "symbolic" as const, renderElevationM: (ordinal ?? 0) * 4,
  });
  const texts = (b: Bundle, r: RouteResult, lang: "ja" | "en") => describeRoute(b, r, lang).map((i) => i.text);
  /** Every step still belongs to exactly one instruction, in walking order. */
  const covered = (b: Bundle, r: RouteResult) => expect(describeRoute(b, r, "en").flatMap((i) => i.stepIndexes)).toEqual(r.steps.map((_, k) => k));

  /**
   * The tail of the real E27 platform → exit 2 route: a corridor on B1, two short jogs onto a flight up
   * to a landing, a switchback flight that stays on the landing, another up to the street and a 1.4 m
   * step to the exit. Before: 11 lines, five of them legs under 5 m ("Turn left, ~2 m").
   */
  function switchback(): Bundle {
    const b = createSyntheticBundle([
      edge("corridor", "s0", "p1", { lengthM: 20 }),
      edge("jog-1", "p1", "p2", { lengthM: 1.6 }),
      edge("jog-2", "p2", "p3", { lengthM: 2.8 }),
      edge("flight-1", "p3", "l1", { mode: "stairs", lengthM: 7.8 }),
      edge("landing-1", "l1", "l2", { lengthM: 3.6 }),
      edge("flight-2", "l2", "l3", { mode: "stairs", lengthM: 10.6 }),
      edge("landing-2", "l3", "l4", { lengthM: 3 }),
      edge("flight-3", "l4", "st", { mode: "stairs", lengthM: 11 }),
      edge("to-exit", "st", "exit", { lengthM: 1.4 }),
    ]);
    b.floors.push(floor("b1", "B1", -1), floor("landing", "Landing", -0.5), floor("street", "Street", 0));
    b.nodes.push(
      node("s0", "b1", 0, 0), node("p1", "b1", 20, 0), node("p2", "b1", 20, 1.6), node("p3", "b1", 17.2, 1.6),
      node("l1", "landing", 9.4, 1.6), node("l2", "landing", 9.4, -2), node("l3", "landing", 20, -2), node("l4", "landing", 20, 1),
      node("st", "street", 9, 1), node("exit", "street", 9, 2.4),
    );
    return b;
  }

  it("folds legs under 5 m into the next instruction, naming each turn once and in order", () => {
    const b = switchback();
    const r = route(b, "s0", "exit");
    expect(texts(b, r, "en")).toEqual([
      "Start",
      "Go ~20 m",
      "Turn left, then left again, then take the stairs up to Landing",
      "Turn left, then left again, then continue on the stairs",
      // Known "up" after a flight of unknown direction: "continue up" would claim the last one rose too.
      "Turn left, then left again, then take the stairs up to Street, then turn right",
      "Arrive at destination",
    ]);
    expect(texts(b, r, "ja")).toEqual([
      "出発",
      "約20m 進む",
      "左へ曲がり、さらに左へ曲がり、階段で上へ・Landingへ",
      "左へ曲がり、さらに左へ曲がり、引き続き階段を進む",
      "左へ曲がり、さらに左へ曲がり、階段で上へ・Streetへ、その先で右へ",
      "目的地に到着",
    ]);
    const en = describeRoute(b, r, "en");
    // The flight's own turn stays on `turn`; folded turns are listed apart, so nothing is double-counted.
    expect(en[2]).toMatchObject({ kind: "stairs", stepIndexes: [1, 2, 3], leadTurns: ["left", "left"], turn: null, vertical: "up" });
    expect(en[3]).toMatchObject({ kind: "stairs", stepIndexes: [4, 5], leadTurns: ["left"], turn: "left", vertical: null });
    expect(en[4]).toMatchObject({ stepIndexes: [6, 7, 8], leadTurns: ["left"], turn: "left", trailTurns: ["right"], toFloorId: "street" });
    expect(en[4]!.distanceM).toBeCloseTo(15.4);
    covered(b, r);
  });

  it("names a flight that follows another a continuation only when it does not reverse it", () => {
    const b = switchback();
    // Without ordinals no flight has an evidenced direction: never "up", still a continuation.
    for (const f of b.floors) if (["b1", "landing", "street"].includes(f.id)) f.ordinal = null;
    const r = route(b, "s0", "exit");
    expect(texts(b, r, "en").slice(2, 5)).toEqual([
      "Turn left, then left again, then take the stairs to Landing",
      "Turn left, then left again, then continue on the stairs",
      "Turn left, then left again, then continue on the stairs to Street, then turn right",
    ]);
    // A long walk between two flights makes the second a new one.
    b.edges = b.edges.map((e) => e.id === "landing-1" ? { ...e, lengthM: 12 } : e);
    expect(texts(b, route(b, "s0", "exit"), "en")[4]).toBe("Turn left, then take the stairs");
  });

  it("keeps an opening leg it cannot fold without moving a turn, and folds one leading straight onto a flight", () => {
    const b = createSyntheticBundle([edge("s-a", "start", "a", { lengthM: 3.4 }), edge("a-up", "a", "upper", { mode: "escalator" }), edge("a-n", "a", "isolated")]);
    const onto = describeRoute(b, route(b, "start", "upper"), "en");
    expect(onto.map((i) => i.kind)).toEqual(["start", "escalator", "arrive"]);
    expect(onto[1]).toMatchObject({ stepIndexes: [0, 1], text: "Take the escalator up to 1F" });
    b.nodes.find((n) => n.id === "isolated")!.position = { x: 10, y: 10, z: 0 };
    // The first leg is what the left turn is measured from: it stays a line of its own.
    expect(texts(b, route(b, "start", "isolated"), "en")).toEqual(["Start", "Go ~3 m", "Turn left, ~10 m", "Arrive at destination"]);
  });

  it("adds a straight step off a flight or lift to it, so the turn after it still starts its own line", () => {
    const b = createSyntheticBundle([edge("s-a", "start", "a"), edge("st", "a", "upper", { mode: "stairs" }), edge("off", "upper", "upper-2", { lengthM: 2 })]);
    b.nodes.find((n) => n.id === "upper")!.position = { x: 15, y: 0, z: 4 };
    b.nodes.find((n) => n.id === "upper-2")!.position = { x: 17, y: 0, z: 4 };
    b.nodes.push({ ...node("north", "upper", 17, 20), position: { x: 17, y: 20, z: 4 } });
    b.edges.push(edge("turn", "upper-2", "north", { lengthM: 20 }));
    const ins = describeRoute(b, route(b, "start", "north"), "en");
    expect(ins.map((i) => i.text)).toEqual(["Start", "Go ~10 m", "Take the stairs up to 1F", "Turn left, ~20 m", "Arrive at destination"]);
    expect(ins[2]).toMatchObject({ stepIndexes: [1, 2], distanceM: 12 });
    expect(ins[2]!.trailTurns).toBeUndefined();
  });

  it("speaks distances and junction hints from the last turn, never moving a turn by a folded leg", () => {
    const b = createSyntheticBundle([
      edge("s0-x", "s0", "x"), edge("x-a", "x", "a", { lengthM: 4 }), edge("s-a", "start", "a"), edge("a-east", "a", "goal"),
      edge("a-p", "a", "p", { lengthM: 30 }), edge("p-q", "p", "q", { lengthM: 30 }), edge("q-g", "q", "g", { lengthM: 30 }),
      edge("p-fork", "p", "r", { lengthM: 30 }), edge("q-east", "q", "s", { lengthM: 30 }),
    ]);
    const at = (id: string, x: number, y: number) => ({ ...node(id, "concourse", x, y), position: { x, y, z: 0 } });
    b.nodes.push(at("s0", 6, 10), at("x", 6, 0), at("p", 10, -30), at("q", 7, -60), at("g", 7, -90), at("r", 25, -55), at("s", 37, -60));
    b.nodes.find((n) => n.id === "start")!.position = { x: 0, y: 5, z: 0 };
    const ins = describeRoute(b, route(b, "s0", "g"), "en");
    // The 4 m leg after the left turn is folded in front: ~90 m and the hints count from the right turn at `a`.
    expect(ins.map((i) => i.text)).toEqual([
      "Start",
      "Go ~10 m",
      "Turn left, then right, ~90 m. After ~30 m, keep right at the junction. After ~60 m, continue straight through the junction.",
      "Arrive at destination",
    ]);
    expect(ins[2]).toMatchObject({ stepIndexes: [1, 2, 3, 4], distanceM: 94, leadTurns: ["left"] });
    expect(ins[2]!.junctions!.map((j) => j.atM)).toEqual([30, 60]);
    expect(describeRoute(b, route(b, "s0", "g"), "ja")[2]!.text).toBe("左へ曲がり、すぐ右へ曲がり約90m。約30m先の分岐は右寄りに進む。約60m先の分岐はそのまま直進");
  });

  it("turns back where the walk ends, not after the folded leg", () => {
    const b = createSyntheticBundle([edge("s-goal", "start", "goal", { lengthM: 20 }), edge("back", "goal", "a", { lengthM: 4 })]);
    b.nodes.find((n) => n.id === "a")!.position = { x: 16, y: 0, z: 0 };
    const r = route(b, "start", "a");
    expect(describeRoute(b, r, "en")[1]).toMatchObject({ stepIndexes: [0, 1], distanceM: 24, trailTurns: ["back"], text: "Go ~20 m, then turn back" });
    expect(texts(b, r, "ja")[1]).toBe("約20m 進む、その先で引き返す");
  });

  it("anchors trailing turns to the end of the walk when junction hints come before them", () => {
    // The Restroom junction at `a` is passed after 10 m; the 2 m left turn comes after the whole 20 m.
    const b = createSyntheticBundle([edge("s-a", "start", "a"), edge("a-goal", "a", "goal"), edge("a-n", "a", "b"), edge("goal-up", "goal", "isolated", { lengthM: 2 })]);
    b.nodes.find((n) => n.id === "b")!.position = { x: 10, y: 10, z: 0 };
    b.nodes.find((n) => n.id === "isolated")!.position = { x: 20, y: 2, z: 0 };
    const r = route(b, "start", "isolated");
    expect(describeRoute(b, r, "en")[1]).toMatchObject({
      stepIndexes: [0, 1, 2], trailTurns: ["left"],
      text: "Go ~20 m. After ~10 m, continue straight past Restroom. After ~20 m, turn left.",
    });
    expect(texts(b, r, "ja")[1]).toBe("約20m 進む。約10m先、トイレの分岐はそのまま直進。約20m先で左へ");
  });

  it("folds a route of short walks only into its opening leg", () => {
    const b = createSyntheticBundle([edge("e1", "start", "a", { lengthM: 3 }), edge("n1", "a", "b", { lengthM: 2 }), edge("e2", "b", "goal", { lengthM: 3 })]);
    b.nodes.find((n) => n.id === "a")!.position = { x: 3, y: 0, z: 0 };
    b.nodes.find((n) => n.id === "b")!.position = { x: 3, y: 2, z: 0 };
    b.nodes.find((n) => n.id === "goal")!.position = { x: 6, y: 2, z: 0 };
    const r = route(b, "start", "goal");
    expect(describeRoute(b, r, "en")[1]).toMatchObject({ kind: "walk", stepIndexes: [0, 1, 2], trailTurns: ["left", "right"], text: "Go ~3 m, then turn left, then right" });
    expect(texts(b, r, "ja")).toEqual(["出発", "約3m 進む、その先で左へ、すぐ右へ", "目的地に到着"]);
  });

  it("judges straight wording on the instruction's own walk, not on the legs folded into it", () => {
    // Own walk: 30 m north, 20 m east, 30 m south (bent inside one edge), then a 3 m step east.
    const b = createSyntheticBundle([
      edge("u", "start", "goal", { lengthM: null, geometry: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 30, z: 0 }, { x: 20, y: 30, z: 0 }, { x: 20, y: 0, z: 0 }] }),
      edge("step", "goal", "a", { lengthM: 3 }),
    ]);
    b.nodes.find((n) => n.id === "goal")!.position = { x: 20, y: 0, z: 0 };
    b.nodes.find((n) => n.id === "a")!.position = { x: 23, y: 0, z: 0 };
    const r = route(b, "start", "a");
    expect(describeRoute(b, r, "en")[1]).toMatchObject({ stepIndexes: [0, 1], trailTurns: ["left"], text: "Go ~80 m, then turn left" });
    expect(texts(b, r, "ja")[1]).toBe("約80m 進む、その先で左へ");
  });

  it("gives a moving walkway its own length, not the steps folded onto it", () => {
    const b = createSyntheticBundle([edge("s-a", "start", "a", { lengthM: 3 }), edge("walkway", "a", "goal", { mode: "moving_walkway", lengthM: 10 }), edge("off", "goal", "isolated", { lengthM: 2 })]);
    b.nodes.find((n) => n.id === "a")!.position = { x: 3, y: 0, z: 0 };
    b.nodes.find((n) => n.id === "goal")!.position = { x: 13, y: 0, z: 0 };
    b.nodes.find((n) => n.id === "isolated")!.position = { x: 15, y: 0, z: 0 };
    const r = route(b, "start", "isolated");
    expect(describeRoute(b, r, "en")[1]).toMatchObject({ stepIndexes: [0, 1, 2], distanceM: 15, text: "Moving walkway ~10 m" });
    expect(texts(b, r, "ja")[1]).toBe("動く歩道で約10m");
  });

  it("gives a moving walkway reached after a turn a verb of its own", () => {
    // 20 m east, a 2 m step north (left), then a walkway straight on north.
    const b = createSyntheticBundle([edge("s-a", "start", "a", { lengthM: 20 }), edge("step", "a", "b", { lengthM: 2 }), edge("walkway", "b", "goal", { mode: "moving_walkway", lengthM: 10 })]);
    b.nodes.find((n) => n.id === "a")!.position = { x: 20, y: 0, z: 0 };
    b.nodes.find((n) => n.id === "b")!.position = { x: 20, y: 2, z: 0 };
    b.nodes.find((n) => n.id === "goal")!.position = { x: 20, y: 12, z: 0 };
    const r = route(b, "start", "goal");
    expect(describeRoute(b, r, "en")[2]).toMatchObject({ kind: "moving_walkway", stepIndexes: [1, 2], leadTurns: ["left"], text: "Turn left, then take the moving walkway ~10 m" });
    expect(texts(b, r, "ja")[2]).toBe("左へ曲がり、動く歩道で約10m");
    // Without a turn before it, the walkway line reads as before.
    b.nodes.find((n) => n.id === "b")!.position = { x: 22, y: 0, z: 0 };
    b.nodes.find((n) => n.id === "goal")!.position = { x: 32, y: 0, z: 0 };
    expect(texts(b, route(b, "start", "goal"), "en")).toEqual(["Start", "Go ~22 m", "Moving walkway ~10 m", "Arrive at destination"]);
  });

  it("keeps an opening leg that ends in a turn onto a flight or gate", () => {
    for (const mode of ["stairs", "gate"] as const) {
      const b = createSyntheticBundle([edge("s-a", "start", "a", { lengthM: 3 }), edge("onto", "a", "upper", { mode, ...(mode === "gate" ? { crossesFareBoundary: true, paid: null } : {}) })]);
      b.nodes.find((n) => n.id === "a")!.position = { x: 3, y: 0, z: 0 };
      b.nodes.find((n) => n.id === "upper")!.position = { x: 3, y: 10, z: mode === "gate" ? 0 : 4 };
      if (mode === "gate") b.nodes.find((n) => n.id === "upper")!.floorId = "concourse";
      const r = route(b, "start", "upper");
      const en = describeRoute(b, r, "en");
      expect(en.map((i) => i.stepIndexes)).toEqual([[], [0], [1], []]);
      expect(en[1]!.text).toBe("Go ~3 m");
      expect(en[2]!.text).toBe(mode === "gate" ? "Turn left, then pass the ticket gate" : "Turn left, then take the stairs up to 1F");
      expect(texts(b, r, "ja").slice(1, 3)).toEqual(["約3m 進む", mode === "gate" ? "左へ曲がり、改札を通過" : "左へ曲がり、階段で上へ・1Fへ"]);
    }
  });

  /** The E27 lift (1F・B1・B2): door ↔ cab links on one floor, then one cab link per floor passed. */
  function liftRide(ordinals: [number | null, number | null, number | null]): Bundle {
    const b = createSyntheticBundle([
      edge("door-1f", "door-1f", "cab-1f", { mode: "elevator", lengthM: 1.3 }),
      edge("cab-1f-b1", "cab-1f", "cab-b1", { mode: "elevator", lengthM: 0.5 }),
      edge("cab-b1-b2", "cab-b1", "cab-b2", { mode: "elevator", lengthM: 0.4 }),
      edge("door-b2", "cab-b2", "door-b2", { mode: "elevator", lengthM: 1.2 }),
      edge("out", "door-b2", "hall", { lengthM: 20 }),
    ]);
    b.floors.push(floor("f1", "1F", ordinals[0]), floor("fb1", "B1", ordinals[1]), floor("fb2", "B2", ordinals[2]));
    b.nodes.push(
      node("door-1f", "f1", -2.6, 3.6), node("cab-1f", "f1", -3.8, 3.2), node("cab-b1", "fb1", -4, 3.7),
      node("cab-b2", "fb2", -4, 4.1), node("door-b2", "fb2", -2.8, 4.5), node("hall", "fb2", 17.2, 4.5),
    );
    return b;
  }

  it("collapses one lift ride into one instruction to the floor where it is left", () => {
    const b = liftRide([1, -1, -2]);
    const r = route(b, "door-1f", "hall");
    const en = describeRoute(b, r, "en");
    expect(en.map((i) => i.text)).toEqual(["Start", "Take the elevator down to B2", "Go straight ~20 m", "Arrive at destination"]);
    expect(en[1]).toMatchObject({ kind: "elevator", stepIndexes: [0, 1, 2, 3], vertical: "down", toFloorId: "fb2" });
    expect(texts(b, r, "ja")[1]).toBe("エレベーターで下へ・B2へ");
    covered(b, r);
  });

  it("says up/down for a lift ride only when the ride's ends evidence it and no link of it contradicts", () => {
    const unknown = liftRide([null, null, null]);
    const r = route(unknown, "door-1f", "hall");
    expect(describeRoute(unknown, r, "en")[1]).toMatchObject({ vertical: null, text: "Take the elevator to B2" });
    expect(texts(unknown, r, "ja")[1]).toBe("エレベーターでB2へ");
    // Ends say "up" (1 → 2) but the first floor link goes down (1 → -1): fail closed.
    const odd = liftRide([1, -1, 2]);
    expect(describeRoute(odd, route(odd, "door-1f", "hall"), "en")[1]).toMatchObject({ vertical: null, text: "Take the elevator to B2" });
    // Boarded and left on one floor: no floor to name.
    const loop = liftRide([1, -1, -2]);
    loop.nodes.find((n) => n.id === "door-b2")!.floorId = "f1";
    loop.nodes.find((n) => n.id === "hall")!.floorId = "f1";
    expect(describeRoute(loop, route(loop, "door-1f", "hall"), "en")[1]).toMatchObject({ vertical: null, text: "Take the elevator" });
  });
});
