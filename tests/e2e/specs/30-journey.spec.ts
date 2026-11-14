import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { ARTIFACTS, hooks, imageStats, routeWaypoints, stationData, PROBE_SCRIPT } from "../lib/gteki.ts";
import { screenshotFlatRatio } from "../lib/screenshot-flat.ts";

const reelMode = process.env.JOURNEY_MODE === "next" ? "next" : "default";

test.use({ trace: "off", video: "off", screenshot: "off" });
const config = JSON.parse(fs.readFileSync(new URL("../journey.json", import.meta.url), "utf8")) as {
  thresholds: Record<string, number>;
  known: { mode?: "default" | "next"; project: string; metric: string; from: number; to: number; row: string; note: string; maxValues?: number[] }[];
};
const outDir = (project: string) => path.join(ARTIFACTS, "journey", project);

type Overlay = { overlayPct: number; overlayText: string[]; legend: boolean };
async function overlay(page: Page): Promise<Overlay> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const root = document.querySelector("#app");
    const strings = new Set<string>(); let covered = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) {
      const el = document.elementFromPoint((x + 0.5) * innerWidth / 24, (y + 0.5) * innerHeight / 16);
      if (!el || el === canvas) continue;
      let paints = false;
      for (let n: Element | null = el; n && n !== root; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) continue;
        const own = [...n.childNodes].filter(c => c.nodeType === Node.TEXT_NODE).map(c => c.textContent?.trim()).filter(Boolean).join(" ");
        const bg = s.backgroundColor !== "transparent" && !/^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(s.backgroundColor);
        const border = [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].some(v => parseFloat(v) > 0) && s.borderStyle !== "none";
        if (bg || border || own) paints = true;
        if (own && strings.size < 40) strings.add(own.slice(0, 60));
      }
      if (paints) covered++;
    }
    // J13: the badge has pointer-events: none, so elementFromPoint above never sees it.
    const badge = document.querySelector<HTMLElement>(".greybox-legend"), r = badge?.getBoundingClientRect(), bs = badge && getComputedStyle(badge);
    const legend = !!(badge && r && bs && !badge.hidden && bs.display !== "none" && bs.visibility !== "hidden" && Number(bs.opacity) > 0 && r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight);
    return { overlayPct: covered * 100 / 384, overlayText: [...strings], legend };
  });
}

test("cold open @phone", async ({ page }, info) => {
  test.setTimeout(180_000);
  const out = outDir(info.project.name); fs.mkdirSync(out, { recursive: true });
  await page.addInitScript(PROBE_SCRIPT);
  const start = Date.now();
  await page.goto(reelMode === "next" ? "/?next=1" : "/", { waitUntil: "commit" });
  const committed = Date.now();
  await page.waitForTimeout(Math.max(0, 1000 - (Date.now() - committed)));
  const cdp = reelMode === "next" ? await page.context().newCDPSession(page) : undefined;
  let open1sShot: "ok" | "timeout" | undefined;
  if (cdp) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const png = await Promise.race([
      cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 20_000); }),
    ]).finally(() => clearTimeout(timer));
    open1sShot = png ? "ok" : "timeout";
    if (png) fs.writeFileSync(path.join(out, "open-1s.png"), Buffer.from(png.data, "base64"));
  } else await page.screenshot({ path: path.join(out, "open-1s.png"), timeout: 60_000 });
  await page.waitForFunction(() => (window as any).__gteki?.phase() === "ready", null, { timeout: 120_000, polling: 250 });
  const readyMs = Date.now() - start;
  let actionMs: number | undefined;
  if (reelMode === "next") {
    await expect(page.locator(".cold-open .primary")).toBeVisible({ timeout: 60_000 });
    await page.waitForFunction(() => (window as any).__gteki.route()?.ok, null, { timeout: 60_000 });
    actionMs = Date.now() - start;
  }
  const state = await page.evaluate(() => {
    const e = (window as any).__gteki.scanProbe().explorer;
    return { station: e.station?.key ?? null, mode: (window as any).__gteki.mode(), bytes: performance.getEntriesByType("resource").reduce((n, r) => n + (r as PerformanceResourceTiming).transferSize, 0) };
  });
  const nextState = reelMode === "next" ? await page.evaluate(async () => {
    const g = (window as any).__gteki;
    const labelsShown = [...document.querySelectorAll(".poi-label")].filter((el) => {
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
    }).length;
    return { endpoints: g.routeEndpoints(), avatar: g.avatar(), camera: g.camera(), opening: await g.openingFrame(), labelsShown };

  }) : null;
  const coverage = await overlay(page);
  if (reelMode === "next") {
    await page.evaluate(() => (window as any).__gteki.holdFrames(true));
    try {
      await page.evaluate(() => (window as any).__gteki.goldenFrame());
      const png = await cdp!.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(path.join(out, "open-ready.png"), Buffer.from(png.data, "base64"));
    } finally { await page.evaluate(() => (window as any).__gteki.holdFrames(false)); }
  } else await page.screenshot({ path: path.join(out, "open-ready.png"), timeout: 60_000 });
  fs.writeFileSync(path.join(out, "cold-open.json"), JSON.stringify({ readyMs, ...(reelMode === "next" ? { actionMs, open1sShot, ...nextState } : {}), ...state, ...coverage }, null, 2));
  if (nextState) {
    expect(state.mode).toBe("walk");
    expect(nextState.endpoints).toMatchObject({ from: "poi:exit:1", to: "poi:platform:oedo" });
    const { opening, labelsShown } = nextState;
    const phone = info.project.name.startsWith("phone");
    const authored = phone ? { heading: 174, pitch: -12, height: 1.22, distance: 3, fov: 65 } : { heading: 174, pitch: -3, height: 1.1, distance: 2.75, fov: 55 };
    expect(opening.shot).toBe(true);
    expect(Math.abs(opening.camera.heading - authored.heading)).toBeLessThanOrEqual(1);
    expect(Math.abs(opening.camera.pitch - authored.pitch)).toBeLessThanOrEqual(1);
    expect(Math.abs(opening.camera.height - authored.height)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(opening.camera.distance - authored.distance)).toBeLessThanOrEqual(0.1);
    expect(opening.camera.fov).toBe(authored.fov);
    expect(labelsShown).toBe(0);
    expect(opening.markers).toBe(0);
    expect(opening.cat.x0).toBeGreaterThanOrEqual(0);
    expect(opening.cat.x1).toBeLessThanOrEqual(1);
    expect(opening.cat.y0).toBeGreaterThanOrEqual(0);
    expect(opening.cat.y1).toBeLessThanOrEqual(phone ? 0.68 : 0.90);
    if (phone) {
      expect(opening.horizonY).toBeGreaterThanOrEqual(0.30);
      expect(opening.horizonY).toBeLessThanOrEqual(0.40);
    } else {
      expect(opening.cat.x).toBeGreaterThanOrEqual(0.45);
      expect(opening.cat.x).toBeLessThanOrEqual(0.50);
      expect(opening.cat.y1 - opening.cat.y0).toBeGreaterThanOrEqual(0.14);
      expect(opening.cat.y1 - opening.cat.y0).toBeLessThanOrEqual(0.22);
    }
  }
});

async function sceneMetrics(page: Page) {
  return page.evaluate(() => {
    const { explorer: e, castAll, prepareRayTrees } = (window as any).__gteki.scanProbe();
    const scene: any[] = ((window as any).__journeyMeshes ??= (() => {
      const meshes: any[] = []; e.scene.traverse((o: any) => { if (o.isMesh) meshes.push(o); });
      prepareRayTrees(meshes.filter((m: any) => (m.geometry?.index?.count ?? m.geometry?.attributes?.position?.count ?? 0) > 3000));
      return meshes;
    })());
    const under = (o: any, root: any) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; };
    const visible = (o: any) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    const meshes = scene.filter((o: any) => visible(o) && !under(o, e.avatar));
    // Mesh name with up to two named ancestors, e.g. "surface-steel<shinjuku-surface".
    const label = (o: any) => { const names: string[] = []; for (let p = o; p && names.length < 3; p = p.parent) if (p.name) names.push(p.name); return names.join("<") || `(unnamed ${o.type})`; };
    const tally = (into: Record<string, number>, o: any) => { const k = label(o); into[k] = (into[k] ?? 0) + 1; };
    // Overlays (route ribbon, route lines) are transparent and write no depth: they tint the cat, never hide it.
    const hits = (targets = meshes) => castAll(e.ray, targets).filter((h: any) => {
      const m = Array.isArray(h.object.material) ? h.object.material[h.face?.materialIndex ?? 0] : h.object.material;
      return m?.visible !== false && !(m?.transparent && m?.depthWrite === false);
    });
    e.scene.updateMatrixWorld(true); e.camera.updateMatrixWorld(true);
    const camera = e.camera, canvas = e.renderer.domElement;
    let box: any = null;
    e.avatar.traverse((o: any) => {
      if (!o.isMesh || !visible(o)) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      if (box) box.union(b); else box = b;
    });
    let good = 0; const hidden: Record<string, number> = { geometry: 0, npc: 0, ui: 0, offscreen: 0 }; const catMeshes: Record<string, number> = {}, nearMeshNames: Record<string, number> = {};
    if (box) {
      const center = box.getCenter(e.pos.clone());
      const points = [center];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(center.clone().set(x, y, z).lerp(center, 0.2));
      for (const p of points) {
        const projected = p.clone().project(camera), sx = (projected.x + 1) * innerWidth / 2, sy = (1 - projected.y) * innerHeight / 2;
        if (projected.z < -1 || projected.z > 1 || sx < 0 || sy < 0 || sx >= innerWidth || sy >= innerHeight) { hidden.offscreen++; continue; }
        if (document.elementFromPoint(sx, sy) !== canvas) { hidden.ui++; continue; }
        const direction = p.clone().sub(camera.position); const distance = direction.length();
        e.ray.ray.set(camera.position, direction.normalize()); e.ray.near = 0; e.ray.far = distance;
        const hit = hits()[0];
        if (!hit || hit.distance >= distance) good++;
        else { let npc = false; for (let o = hit.object; o; o = o.parent) if (o.userData?.gteki_role === "ambient_crowd" || /crowd/i.test(o.name)) npc = true; hidden[npc ? "npc" : "geometry"]++; if (!npc) tally(catMeshes, hit.object); }
      }
    } else hidden.offscreen = 9;
    // A mesh whose world bounding sphere is farther than 0.3 m cannot contribute to nearClip.
    // Keep dynamic meshes in the ray set: their geometry bounds need not contain their posed instances.
    const nearMeshes = meshes.filter((o: any) => {
      if (o.isInstancedMesh || o.isSkinnedMesh || !o.geometry) return true;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const sphere = o.geometry.boundingSphere?.clone().applyMatrix4(o.matrixWorld);
      return !sphere || sphere.distanceToPoint(camera.position) <= 0.3;
    });
    let near = 0;
    for (let y = 0; y < 10; y++) for (let x = 0; x < 16; x++) {
      e.ray.setFromCamera({ x: (x + 0.5) / 8 - 1, y: 1 - (y + 0.5) / 5 }, camera);
      e.ray.near = 0; e.ray.far = 0.3;
      const nearHit = hits(nearMeshes)[0];
      if (nearHit) { near++; tally(nearMeshNames, nearHit.object); }
    }
    const occluder = Object.entries(hidden).sort((a, b) => b[1] - a[1])[0];
    return { catVisible: good / 9, catOccluder: good === 9 ? null : occluder[0], catOccluderMeshes: catMeshes, nearClip: near / 160, nearClipMeshes: nearMeshNames, cameraDirection: camera.getWorldDirection(e.pos.clone()).toArray() };
  });
}

test("guided walk @phone", async ({ page }, info) => {
  test.setTimeout(1_800_000);
  const wallStart = Date.now();
  const out = outDir(info.project.name); fs.mkdirSync(out, { recursive: true });
  await page.addInitScript(PROBE_SCRIPT);
  await page.goto(reelMode === "next" ? "/?next=1" : "/?station=shinjuku&from=poi:exit:1&to=poi:platform:oedo");
  await page.waitForFunction(() => (window as any).__gteki?.phase() === "ready" && (window as any).__gteki.route()?.ok, null, { timeout: 120_000, polling: 250 });
  if (reelMode === "next") {
    await expect(page.locator(".cold-open .primary")).toBeVisible({ timeout: 120_000 });
    expect(await page.evaluate(() => (window as any).__gteki.routeEndpoints())).toMatchObject({ from: "poi:exit:1", to: "poi:platform:oedo" });
  }
  const route = await hooks.route(page);
  const steps = route.steps as { fromNodeId: string; toNodeId: string; edgeId: string; reversed: boolean; mode: string }[];
  const wps = routeWaypoints("shinjuku", steps), { graph } = stationData("shinjuku");
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  if (reelMode === "next") {
    await page.evaluate(() => (window as any).__gteki.holdFrames(true));
    await page.locator(".cold-open .primary").click();
  } else await page.evaluate(() => { const g = (window as any).__gteki; g.holdFrames(true); g.startGuide(); });
  await expect.poll(() => hooks.mode(page)).toBe("guide");
  if (reelMode === "next") await expect(page.locator(".cold-open")).toBeHidden();
  const tier = await hooks.quality(page), renderer = await page.evaluate(() => (window as any).__qa?.gl ?? null);
  const cdp = await page.context().newCDPSession(page);
  const samples: any[] = [], stepS = Number(process.env.JOURNEY_STEP_S ?? 4);
  let simT = 0, arrived = false;
  const sample = async (arrival: boolean, simMs: number) => {
    let phaseStart = Date.now();
    await page.evaluate(() => (window as any).__gteki.goldenFrame());
    const index = samples.length;
    const png = Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64");
    fs.writeFileSync(path.join(out, `${String(index).padStart(3, "0")}.png`), png);
    const shotMs = Date.now() - phaseStart;
    const guide = await page.evaluate(() => { const e = (window as any).__gteki.scanProbe().explorer; return { s: e.guide.s, step: e.guide.steps[Math.min(e.guide.steps.length - 1, e.guide.cum.findIndex((v: number) => v >= e.guide.s))] }; });
    let acc = 0, stepIndex = wps[0]!.stepIndex;
    for (let i = 1; i < wps.length; i++) { const a = wps[i - 1]!.p, b = wps[i]!.p; acc += Math.hypot(b.x - a.x, b.y - a.y); stepIndex = wps[i]!.stepIndex; if (acc >= guide.s) break; }
    const step = steps[stepIndex]!, from = nodes.get(step.fromNodeId)!, to = nodes.get(step.toNodeId)!;
    phaseStart = Date.now();
    const m = await sceneMetrics(page), cov = await overlay(page);
    const sceneMs = Date.now() - phaseStart;
    phaseStart = Date.now();
    const probe = await page.evaluate(() => (window as any).__gteki.goldenProbe(false));
    const probeMs = Date.now() - phaseStart;
    phaseStart = Date.now();
    const image = await imageStats(page, png), flat = await screenshotFlatRatio(page, png);
    const imageMs = Date.now() - phaseStart;
    const dir = m.cameraDirection, dx = to.position.x - from.position.x, dy = to.position.y - from.position.y;
    const axisDeg = step.mode === "escalator" ? Math.acos(Math.max(-1, Math.min(1, (dir[0] * dx - dir[2] * dy) / (Math.hypot(dir[0], dir[2]) * Math.hypot(dx, dy))))) * 180 / Math.PI : null;
    const boxes = arrival && reelMode === "next" ? await page.evaluate(() => {
      const g = (window as any).__gteki;
      const cat = g.scanProbe().explorer.catScreenBox();
      const rect = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      return { cat, card: rect(".hud-instruction"), badge: rect(".greybox-legend"), coverage: rect("button.coverage") };
    }) : undefined;
    if (boxes) {
      const { cat, card, badge, coverage } = boxes;
      const separated = (a: typeof badge, b: typeof badge, gap = 0) => a.right + gap <= b.left || a.left >= b.right + gap || a.bottom + gap <= b.top || a.top >= b.bottom + gap;
      expect(cat, "arrival cat box").not.toBeNull();
      expect(card.right <= cat.left || card.left >= cat.right || card.bottom <= cat.top || card.top >= cat.bottom, `arrival card/cat overlap: ${JSON.stringify(boxes)}`).toBe(true);
      expect(cov.legend, `arrival badge visible inside viewport: ${JSON.stringify(boxes)}`).toBe(true);
      expect(separated(badge, coverage, 8), `arrival badge/Coverage gap: ${JSON.stringify(boxes)}`).toBe(true);
      expect(separated(badge, card), `arrival badge/card overlap: ${JSON.stringify(boxes)}`).toBe(true);
      expect(separated(badge, cat), `arrival badge/cat overlap: ${JSON.stringify(boxes)}`).toBe(true);
    }
    const identity = arrival ? await page.evaluate(() => (window as any).__gteki.identity().find((item: any) => item.id === "identity:platform:poi:platform:oedo") ?? null) : undefined;
    const arrivalFrame = arrival && reelMode === "next" ? await page.evaluate(() => (window as any).__gteki.arrivalFrame()) : undefined;
    samples.push({ ...(arrival ? { identity, boxes, arrivalFrame } : {}), index, simT, simMs, shotMs, sceneMs, probeMs, imageMs, s: guide.s, floorId: from.floorId, mode: step.mode, avatar: await hooks.avatar(page), camera: await page.evaluate(() => (window as any).__gteki.camera()), arrival, voidRatio: probe.voidRatio, nearBlack: image.nearBlack, flatRatio: flat.value, ...cov, catVisible: m.catVisible, catOccluder: m.catOccluder, catOccluderMeshes: m.catOccluderMeshes, nearClip: m.nearClip, nearClipMeshes: m.nearClipMeshes, axisDeg });
    console.log(`[journey] ${info.project.name} sample=${index} simT=${simT} simMs=${simMs} shotMs=${shotMs} sceneMs=${sceneMs} probeMs=${probeMs} imageMs=${imageMs}`);
  };
  try {
    while (simT < 260 && !arrived) {
      const step = reelMode === "next" && simT < 20 ? 2 : stepS;
      const start = Date.now(); await hooks.simulate(page, step); const simMs = Date.now() - start; simT += step;
      await sample(false, simMs);
      arrived = (await hooks.guideControls(page) as any).arrived;
    }
    if (arrived) { const start = Date.now(); await hooks.simulate(page, 2); const simMs = Date.now() - start; simT += 2; await sample(true, simMs); }
  } finally { await page.evaluate(() => (window as any).__gteki.holdFrames(false)); }
  const overlayTolerancePct = 1;
  const threshold = info.project.name.startsWith("phone") ? config.thresholds.overlayPctPhone : config.thresholds.overlayPctDesktop;
  const rules = [ { row: "J5", metric: "voidRatio", limit: config.thresholds.voidRatio }, { row: "J5", metric: "nearBlack", limit: config.thresholds.nearBlack }, { row: "J5", metric: "nearClip", limit: config.thresholds.nearClip }, { row: "J6", metric: "catVisible", limit: config.thresholds.catVisibleMin }, { row: "J8", metric: "overlayPct", limit: threshold }, { row: "J9", metric: "overlayPct", limit: threshold } ];
  const summary: Record<string, any> = {}, unknown: string[] = [];
  for (const row of ["J5", "J6", "J8", "J9"]) {
    const checks = rules.filter(r => r.row === row).flatMap(r => samples.filter(s => row === "J9" ? s.arrival : !s.arrival).map(s => {
      const value = s[r.metric] as number, failed = r.metric === "catVisible" ? value < r.limit : value > r.limit;
      const known = config.known.some(k => (k.mode ?? "default") === reelMode && k.project === info.project.name && k.metric === r.metric && k.row === row && s.index >= k.from && s.index <= k.to && (!k.maxValues || value <= k.maxValues[s.index - k.from]! + overlayTolerancePct));
      return { index: s.index, metric: r.metric, value, failed, known, severity: r.metric === "catVisible" ? r.limit - value : value - r.limit };
    }));
    const failed = checks.filter(c => c.failed); const worst = [...checks].sort((a, b) => b.severity - a.severity).slice(0, 3);
    unknown.push(...failed.filter(c => !c.known).map(c => `${row} ${c.metric} #${c.index}=${c.value.toFixed(3)}`));
    summary[row] = { status: failed.some(c => !c.known) ? "fail" : failed.length ? "known" : "pass", worst, failingSampleIndexes: [...new Set(failed.map(c => c.index))] };
    for (const c of checks.filter(c => c.failed)) samples[c.index].failed ??= [], samples[c.index].failed.push(`${row} ${c.metric}=${c.value.toFixed(3)}`);
  }
  for (const k of config.known.filter(k => (k.mode ?? "default") === reelMode && k.project === info.project.name)) {
    const r = rules.find(r => r.row === k.row && r.metric === k.metric)!;
    if (!samples.some(s => s.index >= k.from && s.index <= k.to && (k.row === "J9" ? s.arrival : !s.arrival) && (k.metric === "catVisible" ? s[k.metric] < r.limit : s[k.metric] > r.limit))) console.log(`${k.row} ${k.metric} ${k.from}-${k.to}: now passes, remove the entry`);
  }
  const escalators = samples.filter(s => !s.arrival && s.mode === "escalator");
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
    return sorted.length ? (sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2) : null;
  };
  const locks = escalators.map(s => s.camera.lock as number), axes = escalators.map(s => s.axisDeg as number);
  const j7 = { count: escalators.length, lockMin: locks.length ? Math.min(...locks) : null, lockMedian: median(locks), axisDegMax: axes.length ? Math.max(...axes) : null, axisDegMedian: median(axes), lockBelow099: escalators.filter(s => s.camera.lock < 0.99).map(s => s.index) };
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.env.GTEKI_ROOT, encoding: "utf8" }).trim();
  const coldOpen = JSON.parse(fs.readFileSync(path.join(out, "cold-open.json"), "utf8"));
  fs.writeFileSync(path.join(out, "journey.json"), JSON.stringify({ sha, project: info.project.name, reelMode, tier, renderer, coldOpen, samples, summary, j7, unknown }, null, 2));
  const lines = [`## Journey ${info.project.name}${reelMode === "next" ? " (?next=1)" : ""}`, ...Object.entries(summary).map(([row, s]: [string, any]) => `- ${row}: ${s.status}; worst ${s.worst.map((v: any) => `#${v.index} ${v.metric}=${v.value.toFixed(3)}`).join(", ")}; failing: ${s.failingSampleIndexes.join(", ") || "none"}`)];
  lines.push(`- J7 (report): escalator samples ${j7.count}; lock min ${j7.lockMin ?? "none"} median ${j7.lockMedian ?? "none"}; axisDeg max ${j7.axisDegMax ?? "none"} median ${j7.axisDegMedian ?? "none"}; lock < 0.99 at: ${j7.lockBelow099.join(", ") || "none"}`);
  const noLegend = samples.filter(s => !s.legend).map(s => s.index);
  lines.push(`- J13 (report): badge on screen in ${samples.length - noLegend.length} / ${samples.length} samples; missing at: ${noLegend.join(", ") || "none"}`);
  const unknownReport = unknown.join(", ") || "none";
  lines.push(`- Unknown regressions: ${unknownReport}`);
  console.log(`[journey] ${info.project.name} unknown regressions: ${unknownReport}`);
  const medians = ["simMs", "shotMs", "sceneMs", "probeMs", "imageMs"].map(key => {
    const values = samples.map(s => s[key] as number).sort((a, b) => a - b), mid = Math.floor(values.length / 2);
    return `${key}=${values.length % 2 ? values[mid] : (values[mid - 1]! + values[mid]!) / 2}`;
  });
  lines.push(`- Phase medians (ms): ${medians.join(", ")}`);
  fs.writeFileSync(path.join(out, "summary.md"), lines.join("\n"));
  const sheetsStart = Date.now();
  for (let start = 0; start < samples.length; start += 12) {
    const frames = samples.slice(start, start + 12).map(s => ({ ...s, data: fs.readFileSync(path.join(out, `${String(s.index).padStart(3, "0")}.png`)).toString("base64") }));
    const jpg = await page.evaluate(async (frames) => {
      const images = await Promise.all(frames.map(async (f: any) => { const img = new Image(); img.src = `data:image/png;base64,${f.data}`; await img.decode(); return img; }));
      const w = Math.min(480, images[0]!.width), h = Math.round(images[0]!.height * w / images[0]!.width), cv = document.createElement("canvas"); cv.width = w * 4; cv.height = (h + 48) * 3;
      const ctx = cv.getContext("2d")!; ctx.fillStyle = "#111"; ctx.fillRect(0, 0, cv.width, cv.height); ctx.fillStyle = "white"; ctx.font = "14px sans-serif";
      frames.forEach((f: any, i: number) => { const x = i % 4 * w, y = Math.floor(i / 4) * (h + 48); ctx.drawImage(images[i]!, x, y, w, h); ctx.fillText(`#${f.index} ${f.simT}s ${f.floorId}`, x + 4, y + h + 16, w - 8); ctx.fillText((f.failed ?? []).join(" "), x + 4, y + h + 34, w - 8); });
      return cv.toDataURL("image/jpeg", 0.8).split(",")[1];
    }, frames);
    fs.writeFileSync(path.join(out, `sheet-${String(start / 12 + 1).padStart(2, "0")}.jpg`), Buffer.from(jpg!, "base64"));
  }
  fs.appendFileSync(path.join(out, "summary.md"), `; sheetsMs=${Date.now() - sheetsStart}; wallMs=${Date.now() - wallStart}\n`);
  if (reelMode === "next" && arrived) {
    const sample = samples.find((s) => s.arrival)!;
    const frame = sample.arrivalFrame;
    expect.soft(frame.shot, "authored arrival shot").toBe(true);
    expect.soft(frame.boardRect, "name board in frame").not.toBeNull();
    if (frame.boardRect) {
      expect.soft(frame.boardRect.x0).toBeGreaterThanOrEqual(-1);
      expect.soft(frame.boardRect.x1).toBeLessThanOrEqual(1);
      expect.soft(frame.boardRect.y0).toBeGreaterThanOrEqual(-1);
      expect.soft(frame.boardRect.y1).toBeLessThanOrEqual(1);
      if (!info.project.name.startsWith("phone")) expect.soft(frame.boardRect.y1).toBeGreaterThanOrEqual(0.33);
      if (!info.project.name.startsWith("phone")) expect.soft(frame.boardRect.x1 - frame.boardRect.x0).toBeGreaterThanOrEqual(0.16);
    }
    if (info.project.name.startsWith("phone")) {
      expect.soft(Math.abs(frame.camera.heading - 165), "phone arrival heading").toBeLessThanOrEqual(1);
      expect.soft(Math.abs(frame.camera.pitch - (-8)), "phone arrival pitch").toBeLessThanOrEqual(1);
    }
    else expect.soft(frame.edgeInFrame, "at least one metre of platform edge in frame").toBe(true);
    expect.soft(sample.catVisible).toBeGreaterThanOrEqual(config.thresholds.catVisibleMin);
    expect.soft(sample.catOccluder, "no NPC in front of the cat at arrival").not.toBe("npc");
    expect.soft(sample.voidRatio).toBeLessThanOrEqual(config.thresholds.voidRatio);
    expect.soft(sample.nearBlack).toBeLessThanOrEqual(config.thresholds.nearBlack);
    expect.soft(sample.nearClip).toBeLessThanOrEqual(config.thresholds.nearClip);
  }
  expect(arrived, "guide arrived within 260 simulated seconds").toBe(true);
  expect(samples.length, "at least 30 samples").toBeGreaterThanOrEqual(30);
});
