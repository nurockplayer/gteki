import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

type Frame = { endMs: number; deltaMs: number; distanceM: number; step: number };
const out = path.resolve(import.meta.dirname, "../artifacts/gpu-fps");

test("whole default guide walk on the host GPU", async ({ page, browser }, info) => {
  const phone = info.project.name === "phone";
  const threshold = phone ? 30 : 50;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: phone ? 4 : 1 });
  await page.goto("/?qaTimeBand=morning");
  await page.waitForFunction(() => {
    const g = (window as any).__gteki;
    return g?.phase() === "ready" && g.route()?.ok;
  }, null, { timeout: 120_000 });
  const button = page.locator(".cold-open .primary");
  await expect(button).toBeVisible({ timeout: 120_000 });
  expect(await page.evaluate(() => (window as any).__gteki.routeEndpoints())).toMatchObject({
    from: "poi:exit:1", to: "poi:platform:oedo",
  });
  const environment = await page.evaluate(() => {
    const g = (window as any).__gteki;
    const e = g.scanProbe().explorer, gl = e.renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) throw new Error("GPU measurement requires an unmasked renderer string");
    return {
      renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string,
      vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string,
      tier: g.quality(), viewport: [innerWidth, innerHeight], deviceScaleFactor: devicePixelRatio,
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      touch: matchMedia("(pointer: coarse)").matches,
      route: g.route().steps,
    };
  });
  expect(environment.renderer, "software rendering is invalid for J12").not.toMatch(/swiftshader|llvmpipe|softpipe|software/i);

  // Arm before the real click; observe natural frames until arrival. No seek, simulate or render calls.
  await page.evaluate(() => {
    const w = window as any, g = w.__gteki;
    w.__gpuWalk = new Promise((resolve, reject) => {
      document.querySelector(".cold-open .primary")!.addEventListener("click", () => {
        const e = g.scanProbe().explorer;
        const frames: Frame[] = [];
        let start = 0, previous = 0;
        const frame = (t: number) => {
          if (document.hidden) { reject(new Error("GPU walk became hidden")); return; }
          if (g.mode() !== "guide") { reject(new Error("GPU walk left guide mode")); return; }
          if (!start) start = previous = t;
          else {
            const guide = e.guide;
            const point = guide.cum.findIndex((s: number) => s >= guide.s);
            frames.push({ endMs: t - start, deltaMs: t - previous, distanceM: guide.s,
              step: guide.steps[Math.min(guide.steps.length - 1, point)] });
            previous = t;
          }
          if (g.guideControls().arrived) resolve(frames);
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }, { once: true });
    });
  });
  await button.click();
  const frames = await page.evaluate(() => (window as any).__gpuWalk) as Frame[];
  expect(frames.length).toBeGreaterThan(0);
  const durationMs = frames.at(-1)!.endMs;
  const fps = frames.map(f => 1000 / f.deltaMs).sort((a, b) => a - b);
  const mid = Math.floor(fps.length / 2);
  const medianFps = fps.length % 2 ? fps[mid]! : (fps[mid - 1]! + fps[mid]!) / 2;
  const p5Fps = fps[Math.ceil(fps.length * 0.05) - 1]!;
  const stretch = (fromMs: number, toMs: number) => {
    const first = frames.find(f => f.endMs >= fromMs)!;
    const last = frames.find(f => f.endMs >= toMs)!;
    const describe = (f: Frame) => ({ distanceM: f.distanceM, ...environment.route[f.step] });
    return { fromMs, toMs, from: describe(first), to: describe(last) };
  };
  // Exact sliding 1 s windows starting at frame boundaries, counting completed frames in (start, end].
  let right = 0, worst = { fps: Infinity, fromMs: 0, toMs: 1000 };
  const boundaries = [0, ...frames.map(f => f.endMs)];
  for (let left = 0; left < boundaries.length && boundaries[left]! + 1000 <= durationMs; left++) {
    const fromMs = boundaries[left]!, toMs = fromMs + 1000;
    while (right < frames.length && frames[right]!.endMs <= toMs) right++;
    const count = right - left;
    if (count < worst.fps) worst = { fps: count, fromMs, toMs };
  }
  // Locate dips using consecutive, non-overlapping full 1 s windows; omit the final partial second.
  const dips: { fromMs: number; toMs: number; minFps: number }[] = [];
  let index = 0;
  for (let fromMs = 0; fromMs + 1000 <= durationMs; fromMs += 1000) {
    const before = index;
    while (index < frames.length && frames[index]!.endMs <= fromMs + 1000) index++;
    const count = index - before;
    if (count >= threshold) continue;
    const previous = dips.at(-1);
    if (previous?.toMs === fromMs) { previous.toMs += 1000; previous.minFps = Math.min(previous.minFps, count); }
    else dips.push({ fromMs, toMs: fromMs + 1000, minFps: count });
  }
  const result = {
    measuredAt: new Date().toISOString(), // UTC
    sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    profile: info.project.name, browser: browser.version(), cpuThrottle: phone ? 4 : 1,
    ...environment, durationMs, medianFps, p5Fps,
    worst1s: { fps: worst.fps, ...stretch(worst.fromMs, worst.toMs) },
    belowTargetStretches: dips.map(d => ({ ...stretch(d.fromMs, d.toMs), minFps: d.minFps })),
    frames,
  };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `${info.project.name}.json`), JSON.stringify(result, null, 2));
  const summary = `| ${info.project.name} | ${medianFps.toFixed(2)} | ${p5Fps.toFixed(2)} | ${worst.fps} (${(worst.fromMs / 1000).toFixed(2)}–${(worst.toMs / 1000).toFixed(2)} s) | ${environment.renderer} |`;
  const report = [
    `Measured ${result.measuredAt} (UTC), SHA ${result.sha}.`,
    "| Profile | Median fps | p5 fps | Worst 1 s fps (playhead) | GPU renderer |",
    "|---|---:|---:|---|---|", summary, "",
    `Below ${threshold} fps in full 1 s buckets (route steps and distance in JSON):`,
    ...dips.map(d => `- ${(d.fromMs / 1000).toFixed(0)}–${(d.toMs / 1000).toFixed(0)} s, minimum ${d.minFps} fps`),
  ].join("\n") + "\n";
  fs.writeFileSync(path.join(out, `${info.project.name}.md`), report);
  console.log(report);
});

const ikebukuroLegs = [
  { name: "four-metres-before", points: [{x:15,z:66}] },
  { name: "wayfinding-context", points: [{x:8,z:62}] },
  { name: "return-to-door", points: [{x:15,z:66}] },

];

for (const next of [false, true]) test(`Ikebukuro concourse walk, next=${Number(next)}, on the host GPU`, async ({ page, browser }, info) => {
  const phone = info.project.name === "phone";
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: phone ? 4 : 1 });
  await page.goto(next ? "/?station=ikebukuro&next=1" : "/?station=ikebukuro");
  await page.waitForFunction(() => (window as any).__gteki?.phase() === "ready", null, { timeout: 120_000 });
  const environment = await page.evaluate(() => {
    const g = (window as any).__gteki, e = g.scanProbe().explorer, gl = e.renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) throw new Error("GPU measurement requires an unmasked renderer string");
    const placed = g.setView({node:"sp_e",headingDeg:180});
    if (!placed.placed) throw new Error("Could not place avatar at sp_e");
    return { renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), tier: g.quality(), viewport: [innerWidth, innerHeight], deviceScaleFactor: devicePixelRatio, drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
  });
  expect(environment.renderer).not.toMatch(/swiftshader|llvmpipe|softpipe|software/i);
  const startedAt = new Date().toISOString();
  const result = await page.evaluate((legs) => new Promise((resolve, reject) => {
    const g = (window as any).__gteki, e = g.scanProbe().explorer;
    const frames: any[] = [], outcomes: any[] = [];
    let leg = -1, point = 0, start = 0, previous = 0, legStart = 0, checkpoint = 0;
    let checkpointPos = e.pos.clone();
    const frame = (t: number) => {
      if (document.hidden || g.mode() !== "walk") { e.input.virtualKeys.clear(); reject(new Error("Walk hidden or left walk mode")); return; }
      if (!start) { start = previous = legStart = checkpoint = t; }
      else { frames.push({ endMs:t-start, deltaMs:t-previous, leg:leg < 0 ? "standing" : legs[leg].name, position:{x:e.pos.x,y:e.pos.y,z:e.pos.z} }); previous = t; }
      if (leg < 0) {
        if (t-start < 10000) { requestAnimationFrame(frame); return; }
        leg=0; legStart=checkpoint=t; checkpointPos=e.pos.clone();
      }
      const targets = legs[leg].points;
      while (point < targets.length) {
        const p = targets[point];
        if (Math.hypot(p.x-e.pos.x,p.z-e.pos.z)>0.35 || (p.y !== undefined && Math.abs(p.y-e.pos.y)>0.6)) break;
        point++; checkpoint=t; checkpointPos=e.pos.clone();
      }
      if (point === targets.length) {
        outcomes.push({name:legs[leg].name, done:true, position:{x:e.pos.x,y:e.pos.y,z:e.pos.z}});
        e.input.virtualKeys.clear(); leg++; point=0;
        if (leg === legs.length) { resolve({frames,outcomes}); return; }
        legStart=checkpoint=t; checkpointPos=e.pos.clone();
      } else if (t-legStart >= 120000 || (t-checkpoint >= 1000 && e.pos.distanceTo(checkpointPos)<0.1)) {
        outcomes.push({name:legs[leg].name, done:false, reason:t-legStart>=120000?"timed out":"stuck", waypoint:point, position:{x:e.pos.x,y:e.pos.y,z:e.pos.z}});
        e.input.virtualKeys.clear(); resolve({frames,outcomes}); return;
      } else if (t-checkpoint >= 1000) { checkpoint=t; checkpointPos=e.pos.clone(); }
      const target=legs[leg].points[point];
      e.yaw=Math.atan2(-(target.x-e.pos.x),-(target.z-e.pos.z));
      e.input.virtualKeys.add("KeyW");
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), ikebukuroLegs);
  const measured = result as { frames: { endMs: number; deltaMs: number; leg: string }[]; outcomes: { done: boolean }[] };
  const segments = ["standing", ...ikebukuroLegs.map(l => l.name)].map(name => {
    const frames = measured.frames.filter(f => f.leg === name);
    const fps = frames.map(f => 1000 / f.deltaMs).sort((a, b) => a - b);
    const mid = Math.floor(fps.length / 2);
    return { name, medianFps: fps.length % 2 ? fps[mid]! : (fps[mid - 1]! + fps[mid]!) / 2,
      p5Fps: fps[Math.ceil(fps.length * 0.05) - 1]!, longestFrameMs: Math.max(...frames.map(f => f.deltaMs)) };
  });
  const stem = `ikebukuro-${info.project.name}-${next ? "on" : "off"}`;
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `${stem}.json`), JSON.stringify({
    sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    profile: info.project.name, browser: browser.version(), cpuThrottle: phone ? 4 : 1,
    url: page.url(), startedAt, endedAt: new Date().toISOString(), environment, segments, ...measured,
  }, null, 2));
  const report = [
    `Measured ${startedAt} (UTC), ${stem}.`,
    "| Segment | Median fps | p5 fps | Longest frame ms |",
    "|---|---:|---:|---:|",
    ...segments.map(s => `| ${s.name} | ${s.medianFps.toFixed(2)} | ${s.p5Fps.toFixed(2)} | ${s.longestFrameMs.toFixed(2)} |`),
  ].join("\n") + "\n";
  fs.writeFileSync(path.join(out, `${stem}.md`), report);
  console.log(report);
  expect(measured.outcomes).toHaveLength(ikebukuroLegs.length);
  expect(measured.outcomes.every(o => o.done)).toBe(true);
});
