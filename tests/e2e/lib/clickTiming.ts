import type { Page } from "@playwright/test";

/** A page stalled by the hang can hold a CDP or evaluate call open; the log line must still print. */
const within = <T>(work: Promise<T>, ms: number): Promise<T | null> => Promise.race([work.catch(() => null), new Promise<null>((done) => setTimeout(() => done(null), ms))]);

/** Self time per function (ms, top 10) from a CDP CPU profile, so a long task can be named. */
function topSelfTime(profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number } }[]; samples?: number[]; timeDeltas?: number[] }): [string, number][] {
  const frames = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
  const self = new Map<string, number>();
  profile.samples?.forEach((id, i) => {
    const frame = frames.get(id);
    if (!frame) return;
    const key = `${frame.functionName || "(anonymous)"}${frame.url ? `@${frame.url.split("/").pop()}:${frame.lineNumber + 1}:${frame.columnNumber + 1}` : ""}`;
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas?.[i] ?? 0) / 1000);
  });
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, ms]) => [name, Math.round(ms)]);
}

/** Log browser and Playwright timing around a click that starts the guide, with what the main thread ran. */
export async function clickTiming(page: Page, click: () => Promise<unknown>): Promise<void> {
  await page.evaluate(() => {
    const state = { longTasks: [] as number[], maxFrameGapMs: 0, frames: 0, handlerStart: null as number | null, handlerMs: null as number | null };
    (window as any).__clickTiming = state;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.longTasks.push(entry.duration);
      }).observe({ type: "longtask", buffered: false });
    } catch { /* longtask is unavailable in some browsers */ }
    document.addEventListener("click", (event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".sheet .card.route button.primary")) return;
      state.handlerStart = performance.now();
      const check = () => {
        if ((window as any).__gteki?.mode?.() === "guide") state.handlerMs = performance.now() - state.handlerStart!;
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }, true);
    let previous: number | null = null;
    const frame = (now: number) => {
      state.frames++;
      if (previous !== null) state.maxFrameGapMs = Math.max(state.maxFrameGapMs, now - previous);
      previous = now;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });

  // CDP is Chromium only; other projects log the timing without a profile.
  const cdp = await within(page.context().newCDPSession(page), 5_000);
  await within(Promise.resolve(cdp?.send("Profiler.enable")), 5_000);
  await within(Promise.resolve(cdp?.send("Profiler.setSamplingInterval", { interval: 5000 })), 5_000);
  await within(Promise.resolve(cdp?.send("Profiler.start")), 5_000);
  await page.evaluate(() => {
    const programs = (window as any).__renderer?.info.programs ?? [];
    (window as any).__programsBefore = programs.map((p: any) => ({ id: p.id, name: p.name, key: p.cacheKey }));
    console.log(`[programs-before] ${JSON.stringify({ total: programs.length, notReady: programs.filter((p: any) => !p.isReady()).length })}`);
  });
  const started = Date.now();
  let clickMs = 0;
  try {
    await click();
  } finally {
    clickMs = Date.now() - started;
    // The click can resolve before the frame that reads the guide mode has run.
    await within(page.waitForFunction(() => (window as any).__clickTiming.handlerStart === null || (window as any).__clickTiming.handlerMs !== null, null, { timeout: 15_000 }), 15_000);
    const browser = await within(page.evaluate(() => {
      const state = (window as any).__clickTiming;
      return state ? { handlerMs: state.handlerMs, longTasks: state.longTasks, maxFrameGapMs: state.maxFrameGapMs, frames: state.frames } : null;
    }), 5_000);
    console.log(`[click-timing] ${JSON.stringify({ clickMs, handlerMs: browser?.handlerMs ?? null, longTasks: browser?.longTasks?.sort((a: number, b: number) => b - a).slice(0, 5) ?? [], maxFrameGapMs: browser?.maxFrameGapMs ?? null, frames: browser?.frames ?? 0 })}`);
    const programs = await within(page.evaluate(() => {
      const before: { id: number; name: string; key: string }[] = (window as any).__programsBefore ?? [];
      const seen = new Set(before.map((p) => p.id));
      const fresh = ((window as any).__renderer?.info.programs ?? []).filter((p: any) => !seen.has(p.id));
      const byName: Record<string, number> = {};
      for (const p of fresh) byName[p.name] = (byName[p.name] ?? 0) + 1;
      const diffs = fresh.slice(0, 40).map((p: any) => {
        const a = String(p.cacheKey).split(","), match = before.filter((o) => o.name === p.name).map((o) => {
          const b = o.key.split(","), differing = a.map((v, i) => i).filter((i) => a[i] !== b[i]);
          return { differing: differing.length, fields: differing.slice(0, 12).map((i) => `${i}:${String(b[i]).slice(0, 24)}>${String(a[i]).slice(0, 24)}`) };
        }).sort((x, y) => x.differing - y.differing)[0];
        return { name: p.name, ...match };
      });
      return { before: before.length, fresh: fresh.length, byName, diffs };
    }), 5_000);
    console.log(`[programs-after] ${JSON.stringify(programs)}`);
    const stopped = cdp && await within(cdp.send("Profiler.stop"), 5_000);
    console.log(`[click-profile] ${JSON.stringify(stopped ? topSelfTime(stopped.profile) : null)}`);
  }
}
