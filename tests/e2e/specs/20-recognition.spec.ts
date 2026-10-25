import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { hooks, openStation, routeWaypoints, save, shotPath, stationData, STATIONS, type StationKey, type Vec3, type Waypoint } from "../lib/gteki.ts";

/**
 * #342 Q5 "recognition proxy" captures: is the station recognisable at a glance in silent, ordinary play?
 * Per station, three fixed 5 s views, 2 frames per second of game time (__gteki.simulate, fixed 60 fps):
 *  - spawn:    walker placed at the station's first spawn node (where the rail ride arrives), camera as spawned, idle;
 *  - junction: walking toward the first real turn of the station's spec-03 guide route, facing it, from up to 7 m out;
 *  - exit:     at that route's destination exit node, facing back down the last step (the stairwell), idle.
 * Each frame records the DOM rects of POI chips and app UI (to tell in-world text from overlay text), and
 * `__gteki.identity()` when the build has it (#342 Q2). Frames are also written under anonymised names
 * (anon/<hash>.png, key in recognition-key.json) for a future viewer panel.
 * tools/qa/recognition/proxy.mjs then OCRs the frames (Apple Vision, ja+en) and writes the proxy table.
 *
 *   GTEKI_RECOGNITION=1 pnpm exec playwright test specs/20-recognition.spec.ts --project=desktop-chromium
 *
 * Run desktop-chromium (high tier) and phone-chromium (coarse pointer, low tier). Needs a GPU slot.
 */
const enabled = process.env.GTEKI_RECOGNITION === "1";
const LOOK_RAD_PER_PX = 0.0042;
const FRAMES = 10, FRAME_S = 0.5;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The spec-03 guide routes (first one per station): stable, already reviewed, and they end at an exit. */
const ROUTES: Record<StationKey, { from: string; to: string }> = {
  ikebukuro: { from: "jr-central-gate-2", to: "exit-35" },
  shinjuku: { from: "poi:platform:oedo", to: "poi:exit:2" },
};

async function drag(page: Page, dx: number) {
  const c = (await page.locator("canvas.gteki-canvas").boundingBox())!;
  const x = c.x + c.width * 0.5, y = c.y + c.height * 0.45;
  for (let sent = 0; Math.abs(dx - sent) >= 1; ) {
    const chunk = Math.max(-500, Math.min(500, Math.round(dx - sent)));
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + chunk, y, { steps: 2 });
    await page.mouse.up();
    sent += chunk;
  }
}

/** walkFromNode resets the camera yaw to 0; turn it to look from `from` toward `to` (station ENU). */
async function face(page: Page, from: Vec3, to: Vec3) {
  const want = Math.atan2(-(to.x - from.x), to.y - from.y);
  const dx = Math.round(-wrap(want) / LOOK_RAD_PER_PX);
  if (Math.abs(dx) >= 2) await drag(page, dx);
}

/** First waypoint where the route turns by more than 30° after at least 6 m of straight-ish walking. */
function firstJunction(wps: Waypoint[]): { at: Vec3; from: Vec3 } | null {
  let run = 0;
  // Drop repeated points at step boundaries: a zero-length segment has no heading and would fake a turn.
  wps = wps.filter((w, i) => i === 0 || Math.hypot(w.p.x - wps[i - 1]!.p.x, w.p.y - wps[i - 1]!.p.y) > 0.05);
  for (let i = 1; i < wps.length - 1; i++) {
    const a = wps[i - 1]!.p, b = wps[i]!.p, c = wps[i + 1]!.p;
    const h1 = Math.atan2(b.y - a.y, b.x - a.x), h2 = Math.atan2(c.y - b.y, c.x - b.x);
    run += Math.hypot(b.x - a.x, b.y - a.y);
    if (Math.abs(b.z - a.z) > 0.5) { run = 0; continue; }
    if (run >= 6 && Math.abs(wrap(h2 - h1)) > Math.PI / 6) {
      const back = Math.min(7, run);
      const k = back / Math.hypot(b.x - a.x, b.y - a.y);
      return { at: b, from: { x: b.x - (b.x - a.x) * Math.min(1, k), y: b.y - (b.y - a.y) * Math.min(1, k), z: b.z } };
    }
  }
  return null;
}

/** The graph node nearest a station-ENU point on its level (walkFromNode only takes nodes). */
function nearestNode(key: StationKey, p: Vec3): string {
  const { graph } = stationData(key);
  let best = { id: "", d: Infinity };
  for (const n of graph.nodes) {
    const z = n.position.z ?? n.renderZ ?? p.z;
    const d = Math.hypot(n.position.x - p.x, n.position.y - p.y) + (Math.abs(z - p.z) > 2 ? 1e6 : 0);
    if (d < best.d) best = { id: n.id, d };
  }
  return best.id;
}

const frameDom = () => {
  const rect = (e: Element) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  // Not offsetParent: it is null for position:fixed overlays, which would drop real UI from the exclusion rects.
  const visible = (e: HTMLElement) => {
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    // Effective opacity counts ancestors: walk mode keeps .sheet.open (and its .mascot) in the DOM at opacity 0.
    let alpha = 1;
    for (let n: HTMLElement | null = e; n; n = n.parentElement) alpha *= Number(getComputedStyle(n).opacity);
    const shown = alpha >= 0.05 && (typeof (e as any).checkVisibility === "function" ? (e as any).checkVisibility({ checkVisibilityCSS: true }) : cs.display !== "none" && cs.visibility !== "hidden");
    return shown && r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
  };
  const chips = [...document.querySelectorAll<HTMLElement>(".gteki-labels > *")].filter((e) => e.style.display !== "none" && visible(e)).map((e) => ({ ...rect(e), opacity: Number(getComputedStyle(e).opacity), text: (e.textContent ?? "").trim().slice(0, 60) }));
  const ui = [".topbar", ".panel", ".sheet.open", ".hud", ".credit-line", ".mascot", ".toast.show"].flatMap((s) => [...document.querySelectorAll<HTMLElement>(s)]).filter(visible).map(rect);
  const g = (window as any).__gteki;
  let identity: unknown = null;
  try { identity = typeof g.identity === "function" ? g.identity() : null; } catch (e) { identity = { error: String(e) }; }
  // #342 Q4's loading card / overview name (a separate hook; product orientation, judged apart from the scene).
  let stationIdentity: unknown = null;
  try { stationIdentity = typeof g.stationIdentity === "function" ? g.stationIdentity() : null; } catch (e) { stationIdentity = { error: String(e) }; }
  return { chips, ui, identity, stationIdentity };
};

test.use({ trace: "off" });

if (!enabled) test.skip("recognition proxy captures (set GTEKI_RECOGNITION=1; needs a GPU slot)", () => {});

for (const key of enabled ? STATIONS : []) test(`${key}: recognition proxy captures (#342 Q5) @phone`, async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  await openStation(page, key);
  // Signs are drawn into canvas atlases at load, so font readiness is recorded as the app saw it.
  const fonts = await page.evaluate(async () => {
    const faces = [...(document.fonts as any)].map((f: FontFace) => ({ family: f.family, weight: f.weight, status: f.status }));
    return { status: document.fonts.status, faces, notoJp: document.fonts.check("16px 'Noto Sans JP'", "新宿池袋"), dpr: devicePixelRatio };
  });
  const root = process.env.GTEKI_ROOT;
  const sha = root ? execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() : null;
  const tier = await hooks.quality(page);
  const hasIdentity = await page.evaluate(() => typeof (window as any).__gteki.identity === "function");
  const atReady = await page.evaluate(frameDom);

  const { station } = stationData(key);
  const spawnNode: string = station.spawnNodeIds?.[0];
  expect(spawnNode, "station.json spawnNodeIds[0]").toBeTruthy();
  await hooks.setOrigin(page, ROUTES[key].from);
  await hooks.setDestination(page, ROUTES[key].to);
  const route = await hooks.route(page);
  expect(route?.ok, "route exists").toBe(true);
  const wps = routeWaypoints(key, route.steps);
  const junction = firstJunction(wps);
  const last = route.steps.at(-1) as { fromNodeId: string; toNodeId: string };
  // The last two distinct route points: a final step with only two geometry points emits just its endpoint under
  // its own step index (its start was emitted with the step before), so filtering by step would leave one point.
  // Each point is compared with the last one kept, so a run of closely spaced points still yields a direction.
  const distinct: typeof wps = [];
  for (const w of wps) {
    const k = distinct.at(-1);
    if (!k || Math.hypot(w.p.x - k.p.x, w.p.y - k.p.y) > 0.05) distinct.push(w);
  }
  const exitWps = distinct.slice(-2);

  type View = { id: string; node: string; facing?: { from: Vec3; to: Vec3 }; keys: string[]; note: string };
  const views: View[] = [
    { id: "spawn", node: spawnNode, keys: [], note: "spawn node 0, camera as spawned, idle" },
    junction
      ? { id: "junction", node: nearestNode(key, junction.from), facing: { from: junction.from, to: junction.at }, keys: ["KeyW"], note: "walking toward the route's first turn" }
      : { id: "junction", node: route.steps[0].toNodeId, keys: [], note: "no turn found on the route: first step's end, idle" },
    {
      id: "exit", node: last.toNodeId, keys: [], note: "at the destination exit, facing back down the last step",
      facing: exitWps.length >= 2 ? { from: exitWps.at(-1)!.p, to: exitWps.at(-2)!.p } : undefined,
    },
  ];

  const frames: Record<string, unknown>[] = [];
  const key4anon = createHash("sha256").update(`${sha}:${testInfo.project.name}:${key}`).digest("hex").slice(0, 8);
  for (const v of views) {
    expect(await hooks.walkFromNode(page, v.node), `walkFromNode ${v.node}`).toBe(true);
    await hooks.simulate(page, 0.5, []);
    if (v.facing) await face(page, v.facing.from, v.facing.to);
    await hooks.simulate(page, 1.0, []);
    const camera = await hooks.sceneInfo(page).then((s: any) => ({ position: s.camera, fov: s.fov, aspect: s.aspect, mode: s.mode }));
    for (let i = 0; i < FRAMES; i++) {
      if (i) await hooks.simulate(page, FRAME_S, v.keys);
      const file = shotPath(testInfo, `rec-${key}-${v.id}-${String(i).padStart(2, "0")}.png`);
      const png = await page.screenshot({ path: file });
      const anon = createHash("sha256").update(`${key4anon}:${v.id}:${i}`).digest("hex").slice(0, 12);
      const anonFile = shotPath(testInfo, `anon/${anon}.png`);
      fs.mkdirSync(path.dirname(anonFile), { recursive: true });
      fs.writeFileSync(anonFile, png);
      frames.push({ station: key, view: v.id, i, t: i * FRAME_S, file: file.split("/").pop(), anon: `${anon}.png`, avatar: await hooks.avatar(page), camera, ...(await page.evaluate(frameDom)) });
    }
  }
  save(testInfo, `${key}-recognition.json`, {
    label: "recognition proxy", station: key, project: testInfo.project.name, sha, tier, viewport: page.viewportSize(), fonts, hasIdentityHook: hasIdentity, stationIdentityAtReady: atReady.stationIdentity,
    route: ROUTES[key], views: views.map(({ id, node, note, facing }) => ({ id, node, note, facing })), frameS: FRAME_S, frames,
  });
  save(testInfo, `${key}-recognition-key.json`, frames.map((f) => ({ anon: f.anon, station: key, view: f.view, i: f.i, project: testInfo.project.name })));
});
