import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { ARTIFACTS, installBootFrameProbe, overlayGrid, PROBE_SCRIPT, save, settleFrames, waitBootLift, watch, type Diagnostics } from "../lib/gteki";

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

test.beforeEach(async ({ page }, info) => {
  // Startup errors are expected with WebGL disabled; keep them out of diagnostics.
  const diagnostics = info.title === "no WebGL (J14) @phone"
    ? { console: [], pageErrors: [], failedRequests: [] }
    : watch(page);
  records.set(page, { diagnostics, pages: [] });
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

function recordJ14(info: TestInfo, record: Record<string, unknown>) {
  const out = path.join(ARTIFACTS, "journey", info.project.name);
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, "j14.json");
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { j14: {} };
  const j14 = { ...previous.j14, ...record };
  fs.writeFileSync(file, JSON.stringify({ j14 }, null, 2));
  console.log(`J14 (report): ${info.project.name} ${JSON.stringify(j14)}`);
}

test("release hygiene (J14) @phone", async ({ page }, info) => {
  await ready(page, "/", info);
  const primary = page.locator(".cold-open .primary");
  await expect(primary).toBeVisible();
  await page.locator(".credit-btn").click({ timeout: 60_000 });
  const coverage = page.locator("dialog.coverage");
  await expect(coverage).toBeVisible();
  const links = await coverage.locator("a[href]:visible").evaluateAll((anchors) => anchors.map((anchor) => ({
    text: anchor.textContent?.trim(),
    host: new URL((anchor as HTMLAnchorElement).href).host,
  })));
  await coverage.locator(".close").click({ timeout: 60_000 });
  await expect(coverage).toBeHidden();
  const before = { lang: await page.locator("html").getAttribute("lang"), primary: await primary.innerText() };
  await page.locator("button.lang").click({ timeout: 60_000 });
  const after = { lang: await page.locator("html").getAttribute("lang"), primary: await primary.innerText() };
  await page.locator("button.lang").click({ timeout: 60_000 });
  recordJ14(info, { credits: { visibleLinks: links.length, links }, language: { before, after } });
  expect.soft(links.length).toBeGreaterThanOrEqual(1);
  expect([before.lang, after.lang].sort()).toEqual(["en", "ja"]);
  expect(after.primary).not.toBe(before.primary);
  await expect(page.locator("html")).toHaveAttribute("lang", before.lang!);
  await expect(primary).toHaveText(before.primary);
});

test("no WebGL (J14) @phone", async ({ page }, info) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: unknown[]) {
      if (["webgl", "webgl2", "experimental-webgl"].includes(kind)) return null;
      return Reflect.apply(getContext, this, [kind, ...args]);
    };
  });
  await page.goto("/");
  const message = page.locator("#app");
  await expect(message).toBeVisible({ timeout: 30_000 });
  await expect(message).toHaveText(/^GTEki failed to start:\s*\S[\s\S]*$/, { timeout: 30_000 });
  recordJ14(info, { noWebGL: { message: (await message.innerText()).trim() } });
});

for (const url of ["/", "/?next=1", "/?open=world"])
test(`${url}: cold open starts a route and guide @phone`, async ({ page }, info) => {
  await page.setViewportSize(info.project.name === "phone-chromium" ? { width: 390, height: 844 } : { width: 1280, height: 800 });
  await page.addInitScript(() => {
    (window as any).__panelSeen = false;
    new MutationObserver(() => {
      const panel = document.querySelector<HTMLElement>(".panel");
      if (panel && getComputedStyle(panel).display !== "none" && (window as any).__gteki?.phase() !== "ready") (window as any).__panelSeen = true;
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  await ready(page, url, info);
  expect(await page.locator("html").getAttribute("data-cold-open")).toBe("1");
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


for (const url of ["/", "/?next=1"])
test(`${url}: search opens the destination field @phone`, async ({ page }, info) => {
  await page.addInitScript(() => {
    const attach = setInterval(() => {
      const g = (window as any).__gteki;
      const card = document.querySelector<HTMLElement>(".boot-card");
      if (!g || !card) return;
      clearInterval(attach);
      const hold = () => {
        if (!card.hidden) return;
        g.holdFrames(true);
        observer.disconnect();
      };
      const observer = new MutationObserver(hold);
      observer.observe(card, { attributes: true, attributeFilter: ["hidden"] });
      hold();
    }, 50);
  });
  await ready(page, url, info);
  try {
    await page.locator(".cold-open-search").click({ timeout: 60_000 });
    await expect(page.locator(".panel")).toBeVisible();
    await expect(page.locator("#gteki-to")).toBeFocused();
    await expect(page.locator(".cold-open")).toBeHidden();
    expect(await page.evaluate(() => (window as any).__gteki.mode())).toBe("walk");
  } finally {
    await page.evaluate(() => (window as any).__gteki.holdFrames(false));
  }
});


test("other stations and deep links retain their state @phone", async ({ page }, info) => {
  for (const url of ["/?open=search", "/?station=ikebukuro", "/?open=world&station=ikebukuro"]) {
    await ready(page, url, info);
    expect(await page.evaluate(() => (window as any).__gteki.mode())).toBe("overview");
    await expect(page.locator(".panel")).toBeVisible();
    await expect(page.locator(".cold-open")).toBeHidden();
    await expect(page.locator("#cold-open-poster")).toBeHidden();
    expect(await page.evaluate(() => performance.getEntriesByType("resource").some(r => r.name.includes("cold-open/poster-")))).toBe(false);
  }
  for (const flag of ["", "&open=world"]) {
    await ready(page, `/?station=shinjuku&from=poi:gate:1&to=poi:platform:oedo${flag}`, info);
    expect(await page.evaluate(() => (window as any).__gteki.route()?.ok)).toBe(true);
    expect(await page.evaluate(() => (window as any).__gteki.mode())).toBe("overview");
    await expect(page.locator(".cold-open")).toBeHidden();
    await expect(page.locator("#cold-open-poster")).toBeHidden();
    expect(await page.evaluate(() => performance.getEntriesByType("resource").some(r => r.name.includes("cold-open/poster-")))).toBe(false);
  }
});
