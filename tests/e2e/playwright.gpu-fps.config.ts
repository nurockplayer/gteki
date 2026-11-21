import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../..");
const brave = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";

export default defineConfig({
  testDir: "./specs",
  testMatch: "32-gpu-fps.spec.ts",
  timeout: 600_000,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "./artifacts/gpu-fps/playwright",
  use: {
    baseURL: "http://127.0.0.1:5272",
    headless: false,
    deviceScaleFactor: 2,
    trace: "off",
    video: "off",
    screenshot: "off",
    launchOptions: {
      executablePath: process.env.GTEKI_BROWSER || (fs.existsSync(brave) ? brave : undefined),
      args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=metal"],
    },
  },
  webServer: {
    command: `pnpm --dir ${JSON.stringify(path.join(root, "apps/web"))} exec vite preview --host 127.0.0.1 --port 5272 --strictPort`,
    url: "http://127.0.0.1:5272",
    reuseExistingServer: false,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 960, height: 600 }, screen: { width: 960, height: 600 } } },
    { name: "phone", use: { viewport: { width: 412, height: 839 }, screen: { width: 412, height: 839 }, isMobile: true, hasTouch: true } },
  ],
});
