import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * Lane F browser QA for GTEki.
 *
 * The harness never builds product code itself: point it at an already-served candidate with
 * GTEKI_BASE_URL, or let it serve a built checkout from GTEKI_ROOT (see tools/qa/run-candidate.sh).
 * GTEKI_ROOT is also read directly so tests can compare the UI against the station JSON on disk.
 */
const port = Number(process.env.GTEKI_PORT ?? 5270);
const baseURL = process.env.GTEKI_BASE_URL ?? `http://127.0.0.1:${port}`;
const root = process.env.GTEKI_ROOT;

// Real GPU where the host has one; the probe records which renderer was actually used. CI runners have
// none, so CI=1 selects software WebGL (SwiftShader): fine for DOM/HUD smoke, never valid for perf or visuals.
const ci = !!process.env.CI;
const gpuArgs = ci
  ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  : ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=metal", "--enable-unsafe-webgpu"];
// At 1440×900 with video, SwiftShader on a 2-vCPU runner starves the frame loop: clicks never pass the
// stability check and screenshots time out. In CI the desktop project uses a screen under 700 px, which
// puts the explorer on its low-quality path (no composer, lower pixel ratio), and records no video.
// (Brave's fingerprint protection reports its own screen size on http pages, so CI=1 runs locally in
// Brave stay on the high-quality path; the runner's bundled Chromium honours the override.)
const desktopView = ci
  ? { viewport: { width: 960, height: 600 }, screen: { width: 960, height: 600 }, video: "off" as const }
  : { viewport: { width: 1440, height: 900 }, video: { mode: "on" as const, size: { width: 1280, height: 800 } } };
// Chromium projects drive Brave on the dev Mac (machine policy: never Chrome); GTEKI_BROWSER overrides
// the executable. Without either, Playwright's bundled Chromium is used (e.g. a Linux CI runner).
const brave = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const chromiumExecutable = process.env.GTEKI_BROWSER || (fs.existsSync(brave) ? brave : undefined);
const chromiumLaunch = { args: gpuArgs, executablePath: chromiumExecutable };

export default defineConfig({
  testDir: "./specs",
  outputDir: "./artifacts/test-results",
  snapshotPathTemplate: "{testDir}/__goldens__/{testFileName}/{arg}{ext}",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "artifacts/html", open: "never" }], ["json", { outputFile: "artifacts/results.json" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    screenshot: "only-on-failure",
    launchOptions: { args: gpuArgs },
  },
  webServer: root && !process.env.GTEKI_BASE_URL
    ? {
        command: `pnpm --dir ${JSON.stringify(`${root}/apps/web`)} exec vite preview --port ${port} --strictPort --host 127.0.0.1`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 60_000,
      }
    : undefined,
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], ...desktopView, launchOptions: chromiumLaunch },
    },
    {
      name: "phone-webkit",
      grep: /@phone/,
      // No video: Playwright WebKit's screencast grows the GPU process ~45 MB/s for as long as a page renders
      // (#40; 12 GB froze the host on 2026-10-23). retain-on-failure records the whole run too, so it leaks the
      // same way. GTEKI_WEBKIT_VIDEO=1 records it for one short, targeted spec.
      use: {
        ...devices["iPhone 15"],
        video: process.env.GTEKI_WEBKIT_VIDEO === "1" ? { mode: "on", size: { width: 393, height: 852 } } : "off",
      },
    },
    {
      name: "phone-chromium",
      grep: /@phone/,
      use: { ...devices["Pixel 7"], launchOptions: chromiumLaunch, video: { mode: "on", size: { width: 412, height: 915 } } },
    },
  ],
});
