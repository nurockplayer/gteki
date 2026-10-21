import { expect, test } from "@playwright/test";
import { imageStats, PROBE_SCRIPT, save, shotPath } from "../lib/gteki.ts";

/**
 * Secondary evidence: each station lane's own client, served separately by tools/qa/run-candidate.sh.
 * The product entry point is the shared explorer (specs 01–05); these apps are what the lanes
 * iterate their look on, so their visuals are compared with the shared explorer's.
 */
const SHINJUKU_APP = process.env.GTEKI_SHINJUKU_APP_URL;
const IKEBUKURO_PREVIEW = process.env.GTEKI_IKEBUKURO_PREVIEW_URL;

test("shinjuku lane app: guided platform → exit 1, sampled frames", async ({ page }, testInfo) => {
  test.skip(!SHINJUKU_APP, "GTEKI_SHINJUKU_APP_URL not set");
  test.setTimeout(300_000);
  await page.addInitScript(PROBE_SCRIPT);
  await page.goto(`${SHINJUKU_APP}/?lang=en`);
  await page.waitForFunction(() => Boolean((window as any).__gteki?.routeTo), null, { timeout: 120_000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: shotPath(testInfo, "shinjuku-app-00-spawn.png") });
  const r = await page.evaluate(() => (window as any).__gteki.routeTo("poi:exit:1", "poi:platform:oedo"));
  expect(typeof r).toBe("object");
  await page.evaluate(() => (window as any).__gteki.teleportNode((window as any).__gteki.bundle.pois.find((p: any) => p.id === "poi:platform:oedo").connectorNodeIds[0]));
  await page.evaluate(() => (window as any).__gteki.guide());
  const frames: unknown[] = [];
  for (let i = 1; i <= 16; i++) {
    await page.evaluate(() => (window as any).__gteki.advance(0, 150));
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => (window as any).__gteki.state());
    const png = await page.screenshot({ path: shotPath(testInfo, `shinjuku-app-${String(i).padStart(2, "0")}.png`) });
    frames.push({ state, stats: await imageStats(page, png) });
    if (!state.guiding) break;
  }
  save(testInfo, "shinjuku-app-walk.json", { route: r, frames });
});

const ikebukuroViews = [
  { name: "central-passage", spawn: "c_mid" },
  { name: "east-hall", spawn: "c_e2" },
  { name: "north-passage", spawn: "n_h" },
  { name: "south-passage", spawn: "sp_e" },
  { name: "west-exit", spawn: "w_c" },
  { name: "west-exit-south", spawn: "sw_h" },
];

test("ikebukuro lane preview: named vantages", async ({ page }, testInfo) => {
  test.skip(!IKEBUKURO_PREVIEW, "GTEKI_IKEBUKURO_PREVIEW_URL not set");
  test.setTimeout(240_000);
  const out: unknown[] = [];
  for (const v of ikebukuroViews) {
    await page.goto(`${IKEBUKURO_PREVIEW}/?spawn=${v.spawn}&mute=1`);
    await page.waitForTimeout(6000);
    const png = await page.screenshot({ path: shotPath(testInfo, `ikebukuro-preview-${v.name}.png`) });
    out.push({ ...v, stats: await imageStats(page, png) });
  }
  save(testInfo, "ikebukuro-preview.json", out);
});
