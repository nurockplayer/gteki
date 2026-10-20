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

// Real GPU where the host has one; the probe records which renderer was actually used.
const gpuArgs = ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=metal", "--enable-unsafe-webgpu"];

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
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, video: { mode: "on", size: { width: 1280, height: 800 } } },
    },
    {
      name: "phone-webkit",
      grep: /@phone/,
      use: { ...devices["iPhone 15"], video: { mode: "on", size: { width: 393, height: 852 } } },
    },
    {
      name: "phone-chromium",
      grep: /@phone/,
      use: { ...devices["Pixel 7"], video: { mode: "on", size: { width: 412, height: 915 } } },
    },
  ],
});
