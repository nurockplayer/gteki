/** Navigation-relative startup timings, also readable by the screenshot harness. */
export function createStartupTimings(clock: Performance = performance) {
  const prefix = "gteki:";
  const round = (value: number) => Math.round(value * 10) / 10;
  const mark = (name: string) => {
    if (!clock.getEntriesByName(prefix + name, "mark").length) clock.mark(prefix + name);
  };
  const begin = (name: string) => mark(`${name}:start`);
  const complete = (name: string) => {
    mark(`${name}:end`);
    clock.measure(prefix + name, prefix + name + ":start", prefix + name + ":end");
  };
  const phase = <T>(name: string, work: () => T): T => {
    begin(name);
    const result = work();
    complete(name);
    return result;
  };
  const milestone = (name: string) => {
    mark(name);
    if (!clock.getEntriesByName(prefix + `time-to-${name}`, "measure").length) {
      clock.measure(prefix + `time-to-${name}`, { start: 0, end: prefix + name });
    }
  };
  const snapshot = () => {
    const at = (name: string) => {
      const entry = clock.getEntriesByName(prefix + name, "mark")[0];
      return entry ? round(entry.startTime) : null;
    };
    return {
      timeOrigin: clock.timeOrigin,
      loadingPaintMs: at("loading-paint"),
      timeToFirstFrameMs: at("first-frame"),
      timeToInteractiveMs: at("interactive"),
      firstContentfulPaintMs: clock.getEntriesByName("first-contentful-paint", "paint")[0]?.startTime ?? null,
      marks: clock.getEntriesByType("mark").filter((entry) => entry.name.startsWith(prefix)).map((entry) => ({ name: entry.name, startMs: round(entry.startTime) })),
      measures: clock.getEntriesByType("measure").filter((entry) => entry.name.startsWith(prefix)).map((entry) => ({ name: entry.name, startMs: round(entry.startTime), durationMs: round(entry.duration) })),
    };
  };
  mark("module-start");
  return { mark, begin, complete, phase, milestone, snapshot };
}

/** Two rAFs let a progress change paint before the next synchronous startup phase.
 * The recorder drives these callbacks with __tick; no wall-clock timer is needed. */
export function paintStartupFrame(schedule: typeof requestAnimationFrame = requestAnimationFrame): Promise<void> {
  return new Promise((resolve) => schedule(() => schedule(() => resolve())));
}
