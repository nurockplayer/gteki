import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { byEvent, stancePhases, steadyPhases, summarize, type FootFrame, type StancePhase } from "../lib/footSlide.ts";
import { hooks, openStation, perfWindow, save, shotPath, type StationKey } from "../lib/gteki.ts";

/**
 * #339 F0 (and F1 rerun): baseline of the player avatar inside the running explorer, at the game's own
 * follow camera. Three parts:
 *  - captures: idle (back, side, front), a walk and a run cycle seen from the side and from behind,
 *    a 90° turn and a stop, as frame sequences at the default camera distance;
 *  - frame time: real rAF intervals idle with the avatar shown and hidden (its render cost), and while
 *    walking; avatar triangles and meshes;
 *  - foot slide cross-check: the same stance/slide analysis as tools/qa/avatar-baseline/slide.ts, but on
 *    feet read from the live scene while __gteki.simulate steps the real explorer at 60 fps (collisions,
 *    ground and camera included). Frames where the walker is blocked are dropped with their stances.
 *
 *   GTEKI_AVATAR_BASELINE=1 pnpm exec playwright test specs/19-avatar-baseline.spec.ts --project=desktop-chromium
 *
 * The feet are found through three.js's devtools hook (`__THREE_DEVTOOLS__` "observe" events), so no
 * product hook is needed. GTEKI_AVATAR_PROBES names the foot objects as JSON {"L":[..],"R":[..]}; a mesh
 * gives a heel and a toe probe on its sole (bounding box, avatar faces -Z), any other object its origin.
 * The default fits the procedural avatar; F1 passes the rigged character's foot/toe bones.
 * GTEKI_AVATAR_STATIONS picks stations (default ikebukuro). Needs a GPU slot: run single-worker.
 */
const enabled = process.env.GTEKI_AVATAR_BASELINE === "1";
const STATIONS_UNDER_TEST = (process.env.GTEKI_AVATAR_STATIONS ?? "ikebukuro").split(",").map((s) => s.trim()).filter(Boolean) as StationKey[];
const PROBES: { L: string[]; R: string[] } = JSON.parse(process.env.GTEKI_AVATAR_PROBES ?? '{"L":["soleL"],"R":["soleR"]}');
const WALK = 1.45, RUN = 3.4;
const WINDOW_S = 1.0;
const LOOK_RAD_PER_PX = 0.0042;

/** Collects every three.js Scene the page creates, before any page script runs. */
const DEVTOOLS_SCRIPT = `(() => {
  const hub = new EventTarget();
  window.__qaThree = [];
  hub.addEventListener("observe", (e) => { if (e.detail && e.detail.isScene) window.__qaThree.push(e.detail); });
  window.__THREE_DEVTOOLS__ = hub;
})();`;

/**
 * In-page helpers, installed once per page: find the foot objects and the avatar group, step the
 * explorer one fixed frame at a time and read the probes in world space.
 */
const PAGE_HELPERS = (probeNames: { L: string[]; R: string[] }) => {
  const w = window as any;
  const scenes: any[] = w.__qaThree ?? [];
  const byName = (name: string) => { for (const s of scenes) { const o = s.getObjectByName(name); if (o) return o; } return null; };
  const feet = [probeNames.L, probeNames.R].map((names) => names.map((n) => {
    const o = byName(n);
    if (!o) return null;
    const pos = o.geometry?.attributes?.position;
    if (!pos) return { o, local: [[0, 0, 0]] };
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      x0 = Math.min(x0, pos.getX(i)); x1 = Math.max(x1, pos.getX(i)); y0 = Math.min(y0, pos.getY(i));
      z0 = Math.min(z0, pos.getZ(i)); z1 = Math.max(z1, pos.getZ(i));
    }
    return { o, local: [[(x0 + x1) / 2, y0, z1], [(x0 + x1) / 2, y0, z0]] };
  }));
  const missing = [probeNames.L, probeNames.R].flatMap((names, f) => names.filter((_, k) => !feet[f]![k]));
  // The avatar group is the foot's ancestor that sits directly under the scene.
  let group = feet[0]?.[0]?.o ?? null;
  while (group?.parent && !group.parent.isScene) group = group.parent;
  const world = (o: any, p: number[]) => {
    const m = o.matrixWorld.elements;
    return { x: m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y: m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], z: m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14] };
  };
  w.__qaAvatar = {
    missing,
    stats() {
      if (!group) return null;
      let meshes = 0, triangles = 0; const materials = new Set();
      group.traverse((o: any) => {
        if (!o.isMesh) return;
        meshes++;
        const g = o.geometry; triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
        for (const m of [].concat(o.material)) materials.add(m);
      });
      return { meshes, triangles, materials: materials.size };
    },
    setVisible(v: boolean) { if (group) group.visible = v; },
    /** Step the explorer `n` fixed frames with `keys` held; per frame: time, ground height, probes and walker position. */
    run(n: number, keys: string[], t0: number) {
      const out = [];
      for (let i = 0; i < n; i++) {
        const a = w.__gteki.simulate(1 / 60, keys);
        out.push({
          t: t0 + (i + 1) / 60, groundY: a.z, pos: { x: a.x, y: a.y },
          feet: feet.map((ps) => ps.flatMap((p: any) => (p ? p.local.map((l: number[]) => world(p.o, l)) : []))),
        });
      }
      return out;
    },
  };
  return { missing, hasGroup: Boolean(group) };
};

interface Leg { s: number; keys: string[]; event?: string; speed: number }
type Frame = FootFrame & { pos: { x: number; y: number } };

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

/** Walk each direction from a node for `s` seconds; the spot's clearance is the shortest of the four walks. */
async function clearance(page: Page, node: string, s: number): Promise<number> {
  let worst = Infinity;
  for (const k of ["KeyW", "KeyS", "KeyA", "KeyD"]) {
    if (!(await hooks.walkFromNode(page, node))) return 0;
    const a = await hooks.avatar(page);
    const b = await hooks.simulate(page, s, [k]);
    worst = Math.min(worst, Math.hypot(b.x - a.x, b.y - a.y));
  }
  return worst;
}

async function runLegs(page: Page, node: string, legs: Leg[]) {
  expect(await hooks.walkFromNode(page, node)).toBe(true);
  await hooks.simulate(page, 1.0, []);
  const frames: Frame[] = [];
  const windows: { event: string; t: number }[] = [];
  const blocked: number[] = [];
  let t = 0;
  for (const leg of legs) {
    if (leg.event) windows.push({ event: leg.event, t });
    const n = Math.round(leg.s * 60);
    const got: Frame[] = await page.evaluate(([n, k, t0]) => (window as any).__qaAvatar.run(n, k, t0), [n, leg.keys, t] as const);
    for (const f of got) {
      const prev = frames.at(-1);
      // A walker that moved under 60% of its commanded step was stopped by the scene, not by the gait.
      if (prev && leg.speed > 0 && Math.hypot(f.pos.x - prev.pos.x, f.pos.y - prev.pos.y) < 0.6 * leg.speed / 60) blocked.push(f.t);
      frames.push(f);
    }
    t += n / 60;
  }
  const all = stancePhases(frames);
  const clean = all.filter((p) => !blocked.some((bt) => bt >= p.t0 - 1 / 60 && bt <= p.t1 + 1 / 60));
  return { frames, windows, blockedFrames: blocked.length, droppedStances: all.length - clean.length, phases: clean };
}

const report = (phases: StancePhase[], windows: { event: string; t: number }[], warm = 1.5) => ({
  steady: summarize(steadyPhases(phases, windows, WINDOW_S, warm)),
  ...(windows.length ? byEvent(phases, windows, WINDOW_S) : {}),
});

test.use({ trace: "off" });

if (!enabled) test.skip("avatar baseline (set GTEKI_AVATAR_BASELINE=1; needs a GPU slot)", () => {});

for (const key of enabled ? STATIONS_UNDER_TEST : []) test(`${key}: avatar baseline (#339 F0/F1) @phone`, async ({ page }, testInfo) => {
  test.setTimeout(900_000);
  await page.addInitScript(DEVTOOLS_SCRIPT);
  await openStation(page, key);
  const found = await page.evaluate(PAGE_HELPERS, PROBES);
  expect(found.missing, "foot probe objects not found in the scene (set GTEKI_AVATAR_PROBES)").toEqual([]);
  expect(found.hasGroup).toBe(true);

  // An open spot: of the first route's nodes, the one with the most room in all four directions.
  const first = key === "ikebukuro" ? ["jr-central-gate-2", "exit-35"] : ["poi:exit:1", "poi:platform:oedo"];
  await hooks.setOrigin(page, first[0]!);
  await hooks.setDestination(page, first[1]!);
  const nodeIds: string[] = (await hooks.route(page))?.nodeIds ?? [];
  let spot = { node: "", room: 0 };
  for (const n of nodeIds.slice(0, 40)) {
    const room = await clearance(page, n, 4);
    if (room > spot.room) spot = { node: n, room };
    if (room > 5.5) break;
  }
  expect(spot.node, "no walkable spot on the route").not.toBe("");
  const shots: string[] = [];
  const shot = async (name: string) => { const p = shotPath(testInfo, `${key}-avatar-${name}.png`); await page.screenshot({ path: p }); shots.push(p); };

  // ---- captures at the default follow camera ----
  expect(await hooks.walkFromNode(page, spot.node)).toBe(true);
  await hooks.simulate(page, 2, []);
  await shot("idle-back");
  await drag(page, Math.round(Math.PI / 2 / LOOK_RAD_PER_PX));
  await hooks.simulate(page, 0.5, []);
  await shot("idle-side");
  await drag(page, Math.round(Math.PI / 2 / LOOK_RAD_PER_PX));
  await hooks.simulate(page, 0.5, []);
  await shot("idle-front");
  const cycle = async (name: string, keys: string[], speed: number, back: string[]) => {
    // Back off first so the warm-up and the captured cycle fit in the spot's room.
    expect(await hooks.walkFromNode(page, spot.node)).toBe(true);
    await hooks.simulate(page, 3, back);
    await hooks.simulate(page, 1.2, keys);
    const stride = speed <= 1.45 ? 0.75 + 0.31 * speed : 1.2 + 0.5 * (speed - 1.45); // procedural avatar's stride (avatar.ts), only to space the frames
    const periodS = Math.max(0.3, Math.min(stride, speed > 2.7 ? 2.13 : 1.33)) / speed;
    for (let i = 0; i < 8; i++) { await hooks.simulate(page, periodS / 8, keys); await shot(`${name}-${i}`); }
  };
  await cycle("walk-side", ["KeyD"], WALK, ["KeyA"]);
  await cycle("walk-back", ["KeyW"], WALK, ["KeyS"]);
  await cycle("run-side", ["KeyD", "ShiftLeft"], RUN, ["KeyA"]);
  await cycle("run-back", ["KeyW", "ShiftLeft"], RUN, ["KeyS"]);
  expect(await hooks.walkFromNode(page, spot.node)).toBe(true);
  await hooks.simulate(page, 2.5, ["KeyS"]);
  await hooks.simulate(page, 1.5, ["KeyW"]);
  for (const dt of [0, 0.1, 0.1, 0.1, 0.15, 0.15, 0.2]) { if (dt) await hooks.simulate(page, dt, ["KeyA"]); await shot(`turn90-${shots.length}`); }
  expect(await hooks.walkFromNode(page, spot.node)).toBe(true);
  await hooks.simulate(page, 2.5, ["KeyS"]);
  await hooks.simulate(page, 1.5, ["KeyW"]);
  for (const dt of [0, 0.15, 0.15, 0.2, 0.3, 0.4]) { if (dt) await hooks.simulate(page, dt, []); await shot(`stop-${shots.length}`); }

  // ---- frame time (real render loop) ----
  expect(await hooks.walkFromNode(page, spot.node)).toBe(true);
  await page.waitForTimeout(1500);
  const avatar = await page.evaluate(() => (window as any).__qaAvatar.stats());
  const idleShown = await perfWindow(page, 8);
  await page.evaluate(() => (window as any).__qaAvatar.setVisible(false));
  const idleHidden = await perfWindow(page, 8);
  await page.evaluate(() => (window as any).__qaAvatar.setVisible(true));
  const shuttle = (async () => {
    for (let i = 0; i < 4; i++) {
      const k = i % 2 ? "KeyS" : "KeyW";
      await page.keyboard.down(k); await page.waitForTimeout(2900); await page.keyboard.up(k); await page.waitForTimeout(100);
    }
  })();
  const walking = await perfWindow(page, 11.5);
  await shuttle;

  // ---- foot slide cross-check in the live explorer (fixed 60 fps via simulate) ----
  const legW = 4, legR = Math.min(2.5, spot.room / RUN);
  const scen: Record<string, Leg[]> = {
    shuttle_walk: Array.from({ length: 12 }, (_, i) => ({ s: legW, keys: [i % 2 ? "KeyS" : "KeyW"], speed: WALK, event: i ? "turn180" : undefined })),
    shuttle_run: Array.from({ length: 16 }, (_, i) => ({ s: legR, keys: [i % 2 ? "KeyS" : "KeyW", "ShiftLeft"], speed: RUN, event: i ? "turn180" : undefined })),
    square_left_walk: Array.from({ length: 12 }, (_, i) => ({ s: 3, keys: [["KeyW", "KeyA", "KeyS", "KeyD"][i % 4]!], speed: WALK, event: i ? "turn90" : undefined })),
    square_right_walk: Array.from({ length: 12 }, (_, i) => ({ s: 3, keys: [["KeyW", "KeyD", "KeyS", "KeyA"][i % 4]!], speed: WALK, event: i ? "turn90" : undefined })),
    startstop_walk: Array.from({ length: 12 }, (_, i) => [
      { s: 2.5, keys: [] as string[], speed: 0, event: i ? "stop" : undefined },
      { s: 3, keys: [i % 2 ? "KeyS" : "KeyW"], speed: WALK, event: "start" },
    ]).flat(),
    startstop_run: Array.from({ length: 12 }, (_, i) => [
      { s: 2.5, keys: [] as string[], speed: 0, event: i ? "stop" : undefined },
      { s: legR, keys: [i % 2 ? "KeyS" : "KeyW", "ShiftLeft"], speed: RUN, event: "start" },
    ]).flat(),
  };
  const slide: Record<string, unknown> = {};
  for (const [name, legs] of Object.entries(scen)) {
    const r = await runLegs(page, spot.node, legs);
    slide[name] = { blockedFrames: r.blockedFrames, droppedStances: r.droppedStances, ...report(r.phases, r.windows), phases: r.phases };
  }

  const result = {
    project: testInfo.project.name, station: key, quality: await hooks.quality(page), viewport: page.viewportSize(), probes: PROBES,
    spot, avatar, frameTime: { idleShown, idleHidden, walking, avatarCostP50Ms: idleShown.frameMsP50 !== null && idleHidden.frameMsP50 !== null ? idleShown.frameMsP50 - idleHidden.frameMsP50 : null },
    slide, shots: shots.map((p) => p.split("/").pop()),
  };
  save(testInfo, `${key}-avatar-baseline.json`, result);
  expect(fs.existsSync(shots[0]!)).toBe(true);
  expect(idleShown.gpuValid, `renderer ${idleShown.gl?.renderer}: software rendering invalidates frame times`).toBe(true);
});
