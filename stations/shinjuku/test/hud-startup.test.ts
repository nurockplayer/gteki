import { describe, expect, it } from "vitest";
import { createStartupTimings, paintStartupFrame } from "../app/src/hud-startup.ts";

function controlledClock() {
  let now = 400;
  const entries: { name: string; entryType: string; startTime: number; duration: number }[] = [];
  const at = (name: string) => entries.find((entry) => entry.name === name)!.startTime;
  const clock = {
    timeOrigin: 1234,
    mark(name: string) { entries.push({ name, entryType: "mark", startTime: now, duration: 0 }); },
    measure(name: string, start: string | { start: number; end: string }, end?: string) {
      const begin = typeof start === "string" ? at(start) : start.start;
      const finish = at(typeof start === "string" ? end! : start.end);
      entries.push({ name, entryType: "measure", startTime: begin, duration: finish - begin });
    },
    getEntriesByName: (name: string, type?: string) => entries.filter((entry) => entry.name === name && (!type || entry.entryType === type)),
    getEntriesByType: (type: string) => entries.filter((entry) => entry.entryType === type),
  } as unknown as Performance;
  return { clock, advance: (ms: number) => { now += ms; } };
}

describe("startup progress and performance evidence", () => {
  it("reports navigation-relative first frame and interactive milestones independently", () => {
    const time = controlledClock(), startup = createStartupTimings(time.clock);
    startup.phase("bundle", () => time.advance(20));
    startup.begin("station"); time.advance(400); startup.complete("station");
    startup.milestone("first-frame");
    time.advance(70);
    startup.milestone("interactive");
    const timings = startup.snapshot();
    expect(timings.timeToFirstFrameMs).toBe(820);
    expect(timings.timeToInteractiveMs).toBe(890);
    expect(timings.measures.find((entry) => entry.name === "gteki:station")?.durationMs).toBe(400);
    expect(timings.measures.find((entry) => entry.name === "gteki:time-to-first-frame")?.durationMs).toBe(820);
    expect(timings.loadingPaintMs).toBeNull();
    expect(timings.timeOrigin).toBe(1234);
  });
  it("records the first station frame only once across subsequent renders", () => {
    const time = controlledClock(), startup = createStartupTimings(time.clock);
    startup.milestone("first-frame"); time.advance(50); startup.milestone("first-frame");
    expect(startup.snapshot().timeToFirstFrameMs).toBe(400);
    expect(startup.snapshot().measures.filter((entry) => entry.name === "gteki:time-to-first-frame")).toHaveLength(1);
  });
  it("lets the veil paint before continuing and works when only the recorder advances rAF", async () => {
    let queue: FrameRequestCallback[] = [], ready = false, frame = 0;
    const schedule = (callback: FrameRequestCallback) => (queue.push(callback), queue.length);
    const tick = () => { const pending = queue; queue = []; for (const callback of pending) callback(++frame * 16); };
    const finish = paintStartupFrame(schedule).then(() => { ready = true; });
    tick(); await Promise.resolve();
    expect(ready).toBe(false);
    tick(); await finish;
    expect(ready).toBe(true);
    expect(queue).toHaveLength(0);
  });
});
