import { describe, expect, it } from "vitest";
import { createRouter, describeRoute, routePolyline } from "@gteki/navigation";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";
import { advanceGuide, guideStops, seekGuideState } from "./guideStops.ts";
import { IME_ENTER_GRACE_MS } from "../ui/combobox.ts";
import { firstStopFor, guideKeyAction, guideKeyActionGuarded, instructionIndexAt, instructionStartsM, jumpTarget, RESTART_AFTER_M, RESTART_AFTER_S, StepClock } from "./guideSteps.ts";
import { cumulativeLengths } from "./walker.ts";

const hours = (open: string, close: string) => ({ kind: "window" as const, open, close, evidence: { sourceIds: ["fixture-access"], method: "synthetic-fixture", checkedDate: "2026-10-20" } });

/** 10 m approach, a wait for a zero-length gate that opens at 12:01, then 10 m on to the goal. */
function waitRoute() {
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
  return { polyline, instructions, cum: cumulativeLengths(polyline) };
}

describe("instruction starts", () => {
  it("maps each instruction to its start along the polyline: start 0, arrive at the end, a wait where its stop is", () => {
    const { polyline, instructions, cum } = waitRoute();
    const starts = instructionStartsM(polyline, instructions);
    expect(starts).toHaveLength(instructions.length);
    expect(instructions[0]!.kind).toBe("start");
    expect(instructions.at(-1)!.kind).toBe("arrive");
    expect(starts[0]).toBe(0);
    expect(starts.at(-1)).toBeCloseTo(cum.at(-1)!, 9);
    expect(starts.every((s, i) => i === 0 || s >= starts[i - 1]!)).toBe(true);
    const wait = instructions.findIndex((i) => i.kind === "wait");
    expect(wait).toBeGreaterThan(0);
    const stop = guideStops(polyline, instructions)[0]!;
    expect(stop.instruction).toBe(wait);
    expect(starts[wait]).toBeCloseTo(cum[stop.point]!, 9);
    expect(starts[wait]).toBeCloseTo(10, 9);
  });

  it("finds the instruction a distance is in; later wins at a shared start", () => {
    expect(instructionIndexAt(0, [0, 0, 10, 10, 25])).toBe(1);
    expect(instructionIndexAt(9.99, [0, 0, 10, 10, 25])).toBe(1);
    expect(instructionIndexAt(10, [0, 0, 10, 10, 25])).toBe(3);
    expect(instructionIndexAt(99, [0, 0, 10, 10, 25])).toBe(4);
  });
});

describe("jumpTarget", () => {
  // start, walk, turn, stairs, arrive; the guide shows from instruction 1.
  const starts = [0, 0, 12, 30, 41];

  it("Next goes to the start of the next instruction, and is unavailable on the last", () => {
    expect(jumpTarget(5, starts, 1, 1, 1, 1)).toEqual({ index: 2, s: 12 });
    expect(jumpTarget(13, starts, 1, 9, 2, 1)).toEqual({ index: 3, s: 30 });
    expect(jumpTarget(35, starts, 1, 1, 3, 1)).toEqual({ index: 4, s: 41 });
    expect(jumpTarget(41, starts, 1, 1, 4, 1)).toBeNull();
  });

  it("Previous restarts the current instruction when more than 2 s or 3 m into it", () => {
    expect(jumpTarget(13, starts, -1, RESTART_AFTER_S + 0.1, 2, 1)).toEqual({ index: 2, s: 12 });
    expect(jumpTarget(12 + RESTART_AFTER_M + 0.1, starts, -1, 0.5, 2, 1)).toEqual({ index: 2, s: 12 });
    // Paused for a long time: the guide time, not the wall clock, decides; here it is short and the spot is near the start.
    expect(jumpTarget(12.5, starts, -1, RESTART_AFTER_S, 2, 1)).toEqual({ index: 1, s: 0 });
  });

  it("Previous goes to the previous instruction when just into the current one", () => {
    expect(jumpTarget(12.5, starts, -1, 0.4, 2, 1)).toEqual({ index: 1, s: 0 });
    expect(jumpTarget(31, starts, -1, 1, 3, 1)).toEqual({ index: 2, s: 12 });
    // From arrival (parked at the end): back to the last move, whatever guide time has run at the end.
    expect(jumpTarget(41, starts, -1, 0, 4, 1)).toEqual({ index: 3, s: 30 });
    expect(jumpTarget(41, starts, -1, RESTART_AFTER_S + 30, 4, 1)).toEqual({ index: 3, s: 30 });
  });

  it("Previous on the first instruction restarts it, even right at its start; the skipped Start line is never a target", () => {
    expect(jumpTarget(0.2, starts, -1, 0.1, 1, 1)).toEqual({ index: 1, s: 0 });
    expect(jumpTarget(8, starts, -1, 5, 1, 1)).toEqual({ index: 1, s: 0 });
    // Without a skipped Start line the first instruction is 0.
    expect(jumpTarget(0, [0, 12, 20], -1, 0, 0, 0)).toEqual({ index: 0, s: 0 });
  });

  it("derives the active instruction from the distance when none is given", () => {
    expect(jumpTarget(13, starts, 1, 0)).toEqual({ index: 3, s: 30 });
    expect(jumpTarget(31, starts, -1, 0)).toEqual({ index: 2, s: 12 });
    expect(jumpTarget(35, starts, -1, 0)).toEqual({ index: 3, s: 30 });
  });

  it("handles routes with a single instruction (or only the first and arrival)", () => {
    expect(jumpTarget(0, [0], 1, 0, 0, 0)).toBeNull();
    expect(jumpTarget(0, [0], -1, 5, 0, 0)).toEqual({ index: 0, s: 0 });
    // start, arrive: the guide shows only arrival (index 1, the last).
    expect(jumpTarget(7, [0, 7], 1, 0, 1, 1)).toBeNull();
    expect(jumpTarget(7, [0, 7], -1, 0, 1, 1)).toEqual({ index: 1, s: 7 });
    expect(jumpTarget(0, [], 1, 0)).toBeNull();
  });
});

describe("wait stops across jumps", () => {
  // seekGuideState is what Explorer.seekGuide runs on the guide's state; advanceGuide consumes the stops it leaves ahead.
  const play = (g: { s: number; stops: { s: number; index: number }[] }, total: number) => {
    const reached: number[] = [];
    for (let i = 0; i < 10; i++) {
      const stop = advanceGuide(g, 1000, total);
      if (stop === null) break;
      reached.push(stop);
    }
    return reached;
  };

  it("jumping past a wait does not replay it; jumping back before it applies it again", () => {
    const { polyline, instructions, cum } = waitRoute();
    const total = cum.at(-1)!;
    const starts = instructionStartsM(polyline, instructions);
    const stops = guideStops(polyline, instructions);
    const waits = stops.map((x) => x.instruction);
    const all = stops.map((x, index) => ({ s: cum[x.point]!, index }));
    const seek = (index: number) => {
      const g = { s: -1, stops: [] as typeof all, holding: true };
      seekGuideState(g, all, total, starts[index]!, firstStopFor(waits, index));
      return g;
    };
    const wait = waits[0]!;

    // Landing before the wait (the first move): the wait is ahead and stops the guide at its spot.
    const early = seek(1);
    expect(advanceGuide(early, 1000, total)).toBe(0);
    expect(early.s).toBeCloseTo(10, 9);
    expect(play(early, total)).toEqual([]);
    expect(early.s).toBeCloseTo(total, 9);

    // Landing on the wait itself applies it (the guide stops at once), and landing after it does not.
    expect(play(seek(wait), total)).toEqual([0]);
    const after = seek(wait + 1);
    expect(play(after, total)).toEqual([]);
    expect(after.s).toBeCloseTo(total, 9);

    // Next from a held wait (its stop consumed, standing at its spot) leaves no stop ahead even at the same distance; Previous back to it re-arms it.
    expect(seek(wait + 1).stops).toEqual([]);
    expect(seek(wait).stops).toEqual(all);
    expect(seek(1).stops).toEqual(all);
    expect(seek(instructions.length - 1).stops).toEqual([]);
  });

  it("counts stops by instruction order", () => {
    expect(firstStopFor([3, 6], 0)).toBe(0);
    expect(firstStopFor([3, 6], 3)).toBe(0);
    expect(firstStopFor([3, 6], 4)).toBe(1);
    expect(firstStopFor([3, 6], 6)).toBe(1);
    expect(firstStopFor([3, 6], 7)).toBe(2);
    expect(firstStopFor([], 7)).toBe(0);
  });
});

describe("seekGuideState", () => {
  const all = [{ s: 5, index: 0 }, { s: 8, index: 1 }];

  it("clamps to the path, snaps to its end, releases a hold and keeps only the stops numbered firstStop or higher", () => {
    const g = { s: 5, stops: [] as typeof all, holding: true };
    seekGuideState(g, all, 20, 12, 1);
    expect(g).toEqual({ s: 12, stops: [{ s: 8, index: 1 }], holding: false });
    seekGuideState(g, all, 20, -3);
    expect(g.s).toBe(0);
    expect(g.stops).toEqual(all);
    seekGuideState(g, all, 20, 20 - 1e-9, 2);
    expect(g.s).toBe(20);
    expect(g.stops).toEqual([]);
    expect(all).toHaveLength(2);
  });
});

describe("step clock", () => {
  it("adds only the time between running ticks, capped per tick", () => {
    const c = new StepClock();
    c.tick(1000, true);
    expect(c.elapsedS).toBe(0);
    c.tick(1100, true);
    c.tick(1200, true);
    expect(c.elapsedS).toBeCloseTo(0.2, 9);
    c.tick(9000, true);
    expect(c.elapsedS).toBeCloseTo(0.2 + StepClock.MAX_TICK_MS / 1000, 9);
  });

  it("does not count a pause, the first tick after it, or a reset", () => {
    const c = new StepClock();
    c.tick(0, true);
    c.tick(100, true);
    c.tick(200, false);
    c.tick(60_000, false);
    // The first running tick after the pause has no previous running tick, so the stale time adds nothing.
    c.tick(60_100, true);
    expect(c.elapsedS).toBeCloseTo(0.1, 9);
    c.reset();
    expect(c.elapsedS).toBe(0);
    c.tick(60_200, true);
    expect(c.elapsedS).toBe(0);
  });
});

describe("Previous / Next on the guide's real state", () => {
  // The wait route: start, the approach, the wait, the last walk, arrive. The guide shows from instruction 1, as the app does.
  const { polyline, instructions, cum } = waitRoute();
  const total = cum.at(-1)!;
  const starts = instructionStartsM(polyline, instructions);
  const stops = guideStops(polyline, instructions);
  const waits = stops.map((x) => x.instruction);
  const all = stops.map((x, index) => ({ s: cum[x.point]!, index }));
  const first = 1;
  const last = instructions.length - 1;

  /** The app's jumpGuide on the real pieces: jumpTarget picks the spot, seekGuideState applies it. */
  const jump = (g: { s: number; stops: typeof all; holding: boolean }, dir: 1 | -1, clock: StepClock) => {
    const j = jumpTarget(g.s, starts, dir, clock.elapsedS, instructionIndexAt(g.s, starts), first);
    if (!j) return null;
    seekGuideState(g, all, total, j.s, firstStopFor(waits, j.index));
    clock.reset();
    return j;
  };

  it("Previous from arrival goes to the last movement instruction, however long the guide has sat at arrival", () => {
    const g = { s: 0, stops: all.slice(), holding: false };
    const clock = new StepClock();
    let t = 0;
    while (g.s < total) {
      advanceGuide(g, 1, total);
      clock.tick((t += 16), g.s < total);
    }
    // Arrived: the app stops the clock, so ten simulated seconds of further progress ticks add nothing.
    const atArrival = clock.elapsedS;
    for (let i = 0; i < 625; i++) clock.tick((t += 16), false);
    expect(clock.elapsedS).toBe(atArrival);
    const j = jump(g, -1, clock)!;
    expect(j.index).toBe(last - 1);
    expect(g.s).toBeCloseTo(starts[last - 1]!, 9);
    expect(g.s).toBeLessThan(total);
  });

  it("Previous from arrival ignores guide time even if more than the restart threshold was counted", () => {
    const g = { s: total, stops: [] as typeof all, holding: false };
    const clock = new StepClock();
    for (let t = 0; t <= 20_000; t += 250) clock.tick(t, true);
    expect(clock.elapsedS).toBeGreaterThan(RESTART_AFTER_S);
    expect(jump(g, -1, clock)!.index).toBe(last - 1);
  });

  it("Previous on the first shown instruction restarts it; Next on the last is a no-op", () => {
    const g = { s: 4, stops: all.slice(), holding: false };
    const clock = new StepClock();
    expect(jump(g, -1, clock)).toEqual({ index: first, s: starts[first] });
    expect(g.s).toBe(starts[first]);
    const end = { s: total, stops: [] as typeof all, holding: false };
    expect(jump(end, 1, clock)).toBeNull();
    expect(end.s).toBe(total);
  });
});

describe("guide keys", () => {
  it("maps [ ] and PageUp/PageDown", () => {
    expect(guideKeyAction({ key: "[" })).toBe("prev");
    expect(guideKeyAction({ key: "PageUp" })).toBe("prev");
    expect(guideKeyAction({ key: "]" })).toBe("next");
    expect(guideKeyAction({ key: "PageDown" })).toBe("next");
  });

  it("ignores other keys, the movement keys, held-key repeats, chords and IME composition", () => {
    for (const key of ["a", "w", "ArrowLeft", "ArrowRight", " ", "Enter", "{", "}", "Home"]) expect(guideKeyAction({ key })).toBeNull();
    expect(guideKeyAction({ key: "]", repeat: true })).toBeNull();
    expect(guideKeyAction({ key: "[", ctrlKey: true })).toBeNull();
    expect(guideKeyAction({ key: "PageDown", metaKey: true })).toBeNull();
    expect(guideKeyAction({ key: "PageUp", altKey: true })).toBeNull();
    expect(guideKeyAction({ key: "]", isComposing: true })).toBeNull();
  });
});

describe("guide keys behind the IME guard (#116 follow-up)", () => {
  const NEVER = -Infinity;

  it("takes ordinary keys: no composition ever seen", () => {
    expect(guideKeyActionGuarded({ key: "]" }, NEVER, 1000)).toBe("next");
    expect(guideKeyActionGuarded({ key: "PageUp" }, NEVER, 1000)).toBe("prev");
    expect(guideKeyActionGuarded({ key: "a" }, NEVER, 1000)).toBeNull();
  });

  it("ignores a keydown while the IME is composing", () => {
    for (const key of ["]", "[", "PageDown", "PageUp"]) expect(guideKeyActionGuarded({ key, isComposing: true }, NEVER, 1000)).toBeNull();
  });

  it("ignores the legacy keyCode 229 Safari sends when composing", () => {
    expect(guideKeyActionGuarded({ key: "]", keyCode: 229 }, NEVER, 1000)).toBeNull();
    expect(guideKeyActionGuarded({ key: "PageUp", keyCode: 229, isComposing: false }, NEVER, 1000)).toBeNull();
  });

  it("ignores any key in the few ms after compositionend, then takes it again", () => {
    const end = 1000;
    expect(guideKeyActionGuarded({ key: "]" }, end, end + 1)).toBeNull();
    expect(guideKeyActionGuarded({ key: "PageDown" }, end, end + IME_ENTER_GRACE_MS - 1)).toBeNull();
    expect(guideKeyActionGuarded({ key: "]" }, end, end + IME_ENTER_GRACE_MS)).toBe("next");
    // A compositionend after the keydown (clock skew) is not a grace.
    expect(guideKeyActionGuarded({ key: "]" }, end, end - 10)).toBe("next");
  });

  it("still honours the plain model's chords and repeats inside the guard", () => {
    expect(guideKeyActionGuarded({ key: "]", metaKey: true }, NEVER, 1000)).toBeNull();
    expect(guideKeyActionGuarded({ key: "]", repeat: true }, NEVER, 1000)).toBeNull();
  });
});
