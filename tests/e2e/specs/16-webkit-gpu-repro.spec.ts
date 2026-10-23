import { test } from "@playwright/test";
import { openStation, save } from "../lib/gteki.ts";
import { LENS_PROBE } from "../lib/camera.ts";
test.use({ trace: "off" });

/**
 * Minimal repro for the WebKit GPU-process spike (07:54 host panic; spec 13 on phone-webkit): open Ikebukuro and
 * idle, with or without spec 13's LENS_PROBE (WebGL getUniformLocation/uniformMatrix4fv wrappers). Run one arm per
 * invocation with GTEKI_REPRO=probe|none; the GPU footprint is read outside the browser by the Lane F watchdog.
 * Skipped unless GTEKI_REPRO is set: it asserts nothing and, on phone-webkit, is the workload that grew the GPU process.
 */
const arm = process.env.GTEKI_REPRO ?? "none";
test.skip(!process.env.GTEKI_REPRO, "set GTEKI_REPRO=none|probe to run the WebKit GPU repro");

test(`webkit gpu repro: ikebukuro idle 20 s, arm=${arm} @phone`, async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  if (arm === "probe") await page.addInitScript(LENS_PROBE);
  const t0 = Date.now();
  const { loadMs } = await openStation(page, "ikebukuro");
  await page.waitForTimeout(20_000);
  save(testInfo, `gpu-repro-${arm}.json`, { arm, loadMs, idleMs: Date.now() - t0 - loadMs });
});
