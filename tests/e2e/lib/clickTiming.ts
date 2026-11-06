import type { Page } from "@playwright/test";

/** Log browser and Playwright timing around a click that starts the guide. */
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

  const started = Date.now();
  let clickMs = 0;
  try {
    await click();
  } finally {
    clickMs = Date.now() - started;
    const browser = await page.evaluate(() => {
      const state = (window as any).__clickTiming;
      return state ? { handlerMs: state.handlerMs, longTasks: state.longTasks, maxFrameGapMs: state.maxFrameGapMs, frames: state.frames } : null;
    }).catch(() => null);
    console.log(`[click-timing] ${JSON.stringify({ clickMs, handlerMs: browser?.handlerMs ?? null, longTasks: browser?.longTasks?.sort((a: number, b: number) => b - a).slice(0, 5) ?? [], maxFrameGapMs: browser?.maxFrameGapMs ?? null, frames: browser?.frames ?? 0 })}`);
  }
}
