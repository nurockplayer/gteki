import { describe, expect, it } from "vitest";
import { createRouter, describeRoute, routePolyline } from "@gteki/navigation";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";
import { advanceGuide, guideStops } from "./guideStops.ts";
import { cumulativeLengths } from "./walker.ts";

const hours = (open: string, close: string) => ({ kind: "window" as const, open, close, evidence: { sourceIds: ["fixture-access"], method: "synthetic-fixture", checkedDate: "2026-10-20" } });

describe("guide stops for waits", () => {
  it("stops before a zero-length gate between coincident nodes, not after it", () => {
    // 10 m approach, then a zero-length gate (a and gate-side node coincide) that opens at 12:01, then 10 m on.
    const b = createSyntheticBundle([
      syntheticEdge("approach", "start", "a", { lengthM: 10 }),
      syntheticEdge("gate", "a", "a2", { mode: "gate", lengthM: 0, hours: hours("12:01", "23:00") }),
      syntheticEdge("on", "a2", "goal", { lengthM: 10 }),
    ]);
    b.nodes.push({ ...b.nodes.find((n) => n.id === "a")!, id: "a2" });
    const r = createRouter(b).route("start", "goal", { fare: "ticketed", stepFree: false, at: { weekday: "mon", minutes: 12 * 60 } });
    if (!r.ok) throw new Error(r.message);
    const polyline = routePolyline(b, r);
    const instructions = describeRoute(b, r, "en");
    const stops = guideStops(polyline, instructions);
    expect(stops.map((x) => instructions[x.instruction]!.text)).toEqual(["Wait until 12:01"]);
    const cum = cumulativeLengths(polyline);
    expect(cum[stops[0]!.point]).toBeCloseTo(10, 9);

    // A large step never jumps over the stop; resuming goes on to the end.
    const g = { s: 0, stops: [{ s: cum[stops[0]!.point]!, index: 0 }] };
    expect(advanceGuide(g, 1000, cum.at(-1)!)).toBe(0);
    expect(g.s).toBeCloseTo(10, 9);
    expect(advanceGuide(g, 1000, cum.at(-1)!)).toBeNull();
    expect(g.s).toBeCloseTo(cum.at(-1)!, 9);
  });

  it("reaches several stops at one spot, a stop at the start and one at the end, each in turn", () => {
    const g = { s: 0, stops: [{ s: 0, index: 0 }, { s: 5, index: 1 }, { s: 5, index: 2 }, { s: 9, index: 3 }] };
    expect([0, 1, 2, 3, 4].map(() => advanceGuide(g, 100, 9))).toEqual([0, 1, 2, 3, null]);
    expect(g.s).toBe(9);
  });
});
