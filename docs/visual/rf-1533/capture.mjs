// 2026-11-24 JST. Prepend const repo = "<worktree>"; const label = "before" or "after";
// then pass this script to ego-browser nodejs at the revision being captured.
const fs = await import("node:fs/promises");
const { spawn, execFileSync } = await import("node:child_process");
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const port = 5196;
const server = spawn("nice", ["-n", "15", process.execPath, repo + "/apps/web/node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: repo + "/apps/web", env: { ...process.env, GITHUB_SHA: sha }, stdio: ["ignore", "pipe", "inherit"],
});
let task;
try {
  await new Promise((resolve, reject) => {
    server.stdout.on("data", data => { if (data.toString().includes("Local:")) resolve(); });
    server.once("error", reject);
    server.once("exit", code => reject(Error("Capture server exited: " + code)));
  });
  task = await taskSpace("Review follow-up 1533 " + label);
  const page = task.page("p1");
  await page.cdp("Emulation.setDeviceMetricsOverride", { width: 960, height: 600, deviceScaleFactor: 1, mobile: false });
  await page.goto("http://127.0.0.1:" + port + "/?open=search&station=ikebukuro&lang=en&qaCrowd=off&qaTimeBand=morning&qaEscalatorPhase=0");
  await page.waitForFunction(() => window.__gteki?.phase() === "ready", undefined, { timeout: 120000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    const style = document.createElement("style");
    style.textContent = ".minimap { visibility: hidden !important; } * { transition: none !important; animation: none !important; }";
    document.head.append(style);
    const g = window.__gteki;
    g.holdFrames(true);
    g.setCamera({ pitch: 0 });
    if (!g.setView({ node: "x35", headingDeg: 306 }).placed) throw Error("Failed to place at x35");
    g.goldenFrame();
  });
  await page.waitForFunction(() => {
    const top = document.querySelector(".topbar");
    return Math.round(top.getBoundingClientRect().bottom) + "px" === getComputedStyle(top).getPropertyValue("--topbar-bottom").trim();
  }, undefined, { timeout: 30000 });
  const bounds = await page.evaluate(() => Object.fromEntries([".topbar", ".panel"].map(selector => {
    const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
    if (width <= 0 || height <= 0) throw Error(selector + " is hidden");
    return [selector, { x, y, width, height }];
  })));
  const out = repo + "/docs/visual/rf-1533";
  await fs.mkdir(out, { recursive: true });
  await page.screenshot({ path: out + "/" + label + ".png" });
  const receipt = { sha, capturedAtUTC: new Date().toISOString(), bounds };
  await fs.writeFile(out + "/" + label + ".json", JSON.stringify(receipt, null, 2) + "\n");
  console.log(label, JSON.stringify(receipt));
} finally {
  server.kill();
  if (task) await task.finish({ keep: [] });
}
