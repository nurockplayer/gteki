import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { installBootFrameProbe, overlayGrid, PROBE_SCRIPT, save, settleFrames, waitBootLift, watch, type Diagnostics } from "../lib/gteki";

type PhaseTimeline = { timeline: { t: number; phase: string }[]; maxRafGapMs: number };
const records = new WeakMap<Page, { diagnostics: Diagnostics; pages: PhaseTimeline[] }>();

async function collectTimeline(page: Page): Promise<PhaseTimeline | null> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      page.evaluate(() => (window as any).__coldOpenPhase ?? null),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 2_000); }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer!);
  }
}

test.beforeEach(async ({ page }) => {
  records.set(page, { diagnostics: watch(page), pages: [] });
  await installBootFrameProbe(page);
  await page.addInitScript(() => {
    const w = window as any;
    const record = w.__coldOpenPhase = { timeline: [], maxRafGapMs: 0 };
    let lastPhase: string | undefined;
    setInterval(() => {
      const phase = w.__gteki?.phase();
      if (phase !== undefined && phase !== lastPhase) {
        record.timeline.push({ t: Math.round(performance.now()), phase });
        lastPhase = phase;
      }
    }, 250);
    let lastFrame: number | undefined;
    const frame = (t: number) => {
      if (lastFrame !== undefined) record.maxRafGapMs = Math.max(record.maxRafGapMs, Math.round(t - lastFrame));
      lastFrame = t;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
});

test.afterEach(async ({ page }, info) => {
  const record = records.get(page)!;
  const current = await collectTimeline(page);
  if (current) record.pages.push(current);
  const timeline = record.pages.flatMap((entry) => entry.timeline);
  const maxRafGapMs = Math.max(0, ...record.pages.map((entry) => entry.maxRafGapMs));
  console.log(`[cold-open-phase] ${info.project.name} ${info.title}: ${timeline.map(({ t, phase }) => `${t}:${phase}`).join(",")} maxRafGapMs=${maxRafGapMs}`);
  if (info.status !== info.expectedStatus) {
    const file = save(info, "diagnostics", { timeline, maxRafGapMs, ...record.diagnostics });
    await info.attach("diagnostics", { path: file, contentType: "application/json" });
  }
});

async function ready(page: Page, url: string, info: TestInfo) {
  const previous = await collectTimeline(page);
  if (previous) records.get(page)!.pages.push(previous);
  await page.addInitScript(PROBE_SCRIPT);
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__gteki?.phase() === "ready", null, { timeout: 120_000, polling: 250 });
  await waitBootLift(page, info);
}

test("cold open starts a route and guide @phone", async ({ page }, info) => {
  await page.setViewportSize(info.project.name === "phone-chromium" ? { width: 390, height: 844 } : { width: 1280, height: 800 });
  await page.addInitScript(() => {
    (window as any).__panelSeen = false;
    new MutationObserver(() => {
      const panel = document.querySelector<HTMLElement>(".panel");
      if (panel && getComputedStyle(panel).display !== "none" && (window as any).__gteki?.phase() !== "ready") (window as any).__panelSeen = true;
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  await ready(page, "/?open=world", info);
  await settleFrames(page, "cold open");
  await expect(page.locator(".cold-open")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__panelSeen)).toBe(false);
  expect(await page.locator(".station-select").inputValue()).toBe("shinjuku");
  const state = await page.evaluate(() => {
    const g = (window as any).__gteki;
    return { mode: g.mode(), route: g.route(), endpoints: g.routeEndpoints(), avatar: g.avatar() };
  });
  expect(state.mode).toBe("walk");
  expect(state.route.ok).toBe(true);
  expect(state.endpoints).toMatchObject({ from: "poi:exit:1", to: "poi:platform:oedo" });
  expect(Math.hypot(state.avatar.x - state.endpoints.first.x, state.avatar.y - state.endpoints.first.y, state.avatar.z - state.endpoints.first.z)).toBeLessThan(3);
  await expect(page.locator(".panel")).toBeHidden();
  await expect(page.locator(".minimap")).toBeHidden();
  expect(new URL(page.url()).searchParams.has("from")).toBe(false);
  expect(new URL(page.url()).searchParams.has("to")).toBe(false);
  const overlay = await overlayGrid(page);
  expect(overlay.share, `Top overlays: ${JSON.stringify(overlay.top)}`).toBeLessThanOrEqual(info.project.name === "phone-chromium" ? .30 : .20);
  expect(overlay.cat).toBe(true);
  await page.locator(".cold-open .primary").click({ timeout: 60_000 });
  await expect(page.locator(".minimap")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__gteki.mode())).toBe("guide");
  await expect.poll(() => page.evaluate(() => (window as any).__gteki.audio().state)).toBe("running");
  await expect(page.locator(".cold-open")).toBeHidden();
});

test("search opens the destination field @phone", async ({ page }, info) => {
  await ready(page, "/?next=1", info);
  await settleFrames(page, "cold open");
  await page.locator(".cold-open-search").click({ timeout: 60_000 });
  await expect(page.locator(".panel")).toBeVisible();
  await expect(page.locator("#gteki-to")).toBeFocused();
  await expect(page.locator(".cold-open")).toBeHidden();
  expect(await page.evaluate(() => (window as any).__gteki.mode())).toBe("walk");
});

test("other stations and deep links retain their state @phone", async ({ page }, info) => {
  for (const url of ["/?open=world&station=ikebukuro"]) {
    await ready(page, url, info);
    expect(await page.evaluate(() => (window as any).__gteki.mode())).toBe("overview");
    await expect(page.locator(".panel")).toBeVisible();
    await expect(page.locator(".cold-open")).toBeHidden();
  }
  for (const flag of ["&open=world"]) {
    await ready(page, `/?station=shinjuku&from=poi:gate:1&to=poi:platform:oedo${flag}`, info);
    expect(await page.evaluate(() => (window as any).__gteki.route()?.ok)).toBe(true);
    expect(await page.evaluate(() => (window as any).__gteki.mode())).toBe("overview");
    await expect(page.locator(".cold-open")).toBeHidden();
  }
});
