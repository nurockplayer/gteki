import { describe, expect, it, vi } from "vitest";

// Count opening-hours evaluations made while presenting a route (not while routing it).
const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock("@gteki/schema", async (importOriginal) => {
  const original = await importOriginal<typeof import("@gteki/schema")>();
  return { ...original, isOpenAt: (...args: Parameters<typeof original.isOpenAt>) => { calls.n++; return original.isOpenAt(...args); } };
});

const { createRouter, describeRoute } = await import("./index.ts");
const { createSyntheticBundle, syntheticEdge: edge } = await import("./fixtures.ts");

describe("junction hours are scanned only for real alternatives", () => {
  it("never scans the hours of the route's own corridor when no other branch leaves it", () => {
    const evidence = createSyntheticBundle().edges[0]!.hours!.evidence;
    const tuesday = { kind: "window" as const, open: "07:00", close: "09:00", days: ["tue" as const], evidence };
    // A straight corridor whose every edge opens only on Tuesdays; a Monday departure waits for it.
    const b = createSyntheticBundle([edge("s-a", "start", "a", { hours: tuesday }), edge("a-g", "a", "goal", { hours: tuesday })]);
    const r = createRouter(b).route("start", "goal", { fare: "ticketed", stepFree: false, at: { weekday: "mon", minutes: 12 * 60 } });
    if (!r.ok) throw new Error(r.message);
    calls.n = 0;
    describeRoute(b, r, "en");
    expect(calls.n).toBe(0);
  });
});
