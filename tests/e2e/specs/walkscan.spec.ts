import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { hooks, openStation, routeWaypoints, stationData, type Waypoint } from "../lib/gteki.ts";

/**
 * Player-view floor walk scan (read-only diagnosis, 2026-11-07 JST).
 * Starts the guide on a routed path, pauses it, seeks it in 2.5 m steps and, at every step, measures the
 * rendered floor in the screen area below the horizon outside the HUD with a ray grid over the visible meshes.
 * Guide camera + default cat avatar, 1280x800 desktop.
 *   WALKSCAN=1 WALKSCAN_OUT=<dir> WALKSCAN_ROUTES=<id,...> GTEKI_ROOT=<checkout> GTEKI_PORT=5305
 *   pnpm exec playwright test specs/walkscan.spec.ts --project=desktop-chromium --workers=1
 */
test.use({ viewport: { width: 1280, height: 800 }, trace: "off" });
test.skip(process.env.WALKSCAN !== "1", "set WALKSCAN=1 to run the player-view walk scan");

const OUT = process.env.WALKSCAN_OUT!;
const STEP_M = 2.5;
const GRID_X = 64;
const GRID_Y = 40;

interface RouteDef { id: string; station: "ikebukuro" | "shinjuku"; from: string; to: string }

const ROUTES: RouteDef[] = [
  { id: "ikebukuro-jrc2-exit35", station: "ikebukuro", from: "jr-central-gate-2", to: "exit-35" },
  { id: "ikebukuro-exit18-jrc2", station: "ikebukuro", from: "exit-18", to: "jr-central-gate-2" },
  { id: "shinjuku-exit1-platform", station: "shinjuku", from: "poi:exit:1", to: "poi:platform:oedo" },
  { id: "shinjuku-platform-exit2", station: "shinjuku", from: "poi:platform:oedo", to: "poi:exit:2" },
];
const selected = (process.env.WALKSCAN_ROUTES ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** Routed step an arc distance along the route polyline (horizontal), for the sample's level. */
function stepAt(wps: Waypoint[], d: number): number {
  let acc = 0;
  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1]!.p, b = wps[i]!.p;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + len >= d || i === wps.length - 1) return wps[i]!.stepIndex;
    acc += len;
  }
  return wps[0]!.stepIndex;
}

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);

/** Screenshot + ray grid against the whole rendered scene; returns one sample row. */
async function measure(page: Page, shot: string): Promise<Record<string, unknown>> {
  const b64 = (await page.screenshot({ path: shot })).toString("base64");
  const m = await page.evaluate(async ({ b64, NX, NY }) => {
    const g = globalThis as unknown as Record<string, any>;
    const { explorer: e, castAll } = g.__gteki.scanProbe();
    // Every mesh in the scene, once per page (the rendered geometry, not only the ray-test target lists).
    const scene: any[] = (g.__probeScene ??= { meshes: (() => { const out: any[] = []; e.scene.traverse((o: any) => { if (o.isMesh) out.push(o); }); return out; })() }).meshes;
    e.camera.updateMatrixWorld(true);
    const cam = e.camera;
    const W = innerWidth, H = innerHeight;
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext("2d")!; ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const uiSel = ".topbar,.panel,.hud,.chips,.credit-line,.minimap,.sheet.open,.toast.show,.gteki-labels > *";
    const rects = [...document.querySelectorAll(uiSel)]
      .filter((n) => (n as HTMLElement).offsetParent !== null && n.getBoundingClientRect().width > 0)
      .map((n) => n.getBoundingClientRect());
    const vis = (o: any): boolean => { for (let x = o; x; x = x.parent) if (x.visible === false) return false; return true; };
    const under = (o: any, root: any): boolean => { for (let x = o; x; x = x.parent) if (x === root) return true; return false; };
    const materialVisible = (h: any): boolean => {
      const mat = Array.isArray(h.object.material) ? h.object.material[h.face?.materialIndex ?? 0] : h.object.material;
      return mat?.visible !== false;
    };
    const blocked = (o: any) => under(o, e.avatar) || under(o, e.routeGroup);
    const chain = (o: any): string => { const n: string[] = []; for (let x = o; x && n.length < 4; x = x.parent) if (x.name) n.push(x.name); return n.join("<") || "(unnamed)"; };
    const detail = (h: any) => {
      const mat = Array.isArray(h.object.material) ? h.object.material[h.face?.materialIndex ?? 0] : h.object.material;
      return { mesh: chain(h.object), material: mat?.name || "", type: mat?.type || "", color: mat?.color ? `#${mat.color.getHexString()}` : "" };
    };
    const keyOf = (h: any) => { const d = detail(h); return `${d.mesh}|${d.material}`; };
    const targets = (e.cameraTargets as any[]).filter(vis);
    const pick = () => castAll(e.ray, scene).filter((h: any) => h.object?.isMesh && vis(h.object) && materialVisible(h) && !blocked(h.object));
    const pos = e.pos as any; const footY = pos.y;
    const groups: Record<string, any> = {}, pairs: Record<string, number> = {};
    let total = 0, above = 0, hud = 0, noHit = 0, dark = 0, white = 0, off = 0, offFloor = 0, cop = 0, hitRays = 0;
    let firstMiss: any = null;
    const ensure = (h: any) => { const k = keyOf(h); return (groups[k] ??= { ...detail(h), hit: 0, dark: 0, white: 0, off: 0, offFloor: 0, cop: 0 }); };
    const qa = (window as any).__qa;
    const t0 = performance.now();
    for (let iy = 0; iy < NY; iy++) for (let ix = 0; ix < NX; ix++) {
      const fx = (ix + 0.5) / NX, fy = (iy + 0.5) / NY, sx = fx * W, sy = fy * H;
      if (rects.some((r) => sx >= r.left - 2 && sx <= r.right + 2 && sy >= r.top - 2 && sy <= r.bottom + 2)) { hud++; continue; }
      const el = document.elementFromPoint(sx, sy);
      if (el && el.tagName !== "CANVAS") { hud++; continue; }
      e.ray.setFromCamera({ x: fx * 2 - 1, y: 1 - fy * 2 }, cam);
      e.ray.near = 0; e.ray.far = 200;
      // The player's view of the floor: only rays pointing below the horizon.
      if (e.ray.ray.direction.y >= -0.02) { above++; continue; }
      total++;
      const hits = pick();
      const h0 = hits[0];
      const i = (Math.floor(sy) * cv.width + Math.floor(sx)) * 4;
      const sum = px[i] + px[i + 1] + px[i + 2];
      if (sum <= 36) {
        dark++;
        if (h0) { const gr = ensure(h0); gr.dark++; }
      } else if (sum >= 720) {
        white++;
        if (h0) { const gr = ensure(h0); gr.white++; }
      }
      if (!h0) {
        noHit++;
        if (!firstMiss) firstMiss = { fx, fy, dir: e.ray.ray.direction.toArray().map((v: number) => +v.toFixed(3)), cameraTargetHits: castAll(e.ray, targets).length };
        continue;
      }
      hitRays++;
      const gr = ensure(h0); gr.hit++;
      const d3 = Math.hypot(h0.point.x - pos.x, h0.point.y - pos.y, h0.point.z - pos.z);
      if (d3 <= 4 && Math.abs(h0.point.y - footY) > 0.10) {
        off++; gr.off++;
        const n = h0.face ? h0.face.normal.clone().transformDirection(h0.object.matrixWorld) : null;
        if (n && n.y > 0.5) { offFloor++; gr.offFloor++; }
      }
      const h1 = hits.find((h: any) => h.object !== h0.object);
      if (h1 && h1.distance - h0.distance <= 0.02) {
        cop++; gr.cop++;
        const pk = [keyOf(h0), keyOf(h1)].sort().join(" <> ");
        pairs[pk] = (pairs[pk] ?? 0) + 1;
      }
    }
    // Rendered floor under the avatar's feet: straight down from just above the feet, scene vs ray targets.
    const origin = pos.clone(); origin.y += 0.1;
    const down = (hits: any[]) => hits.find((h: any) => h.object?.isMesh && vis(h.object) && materialVisible(h) && !blocked(h.object)) ?? null;
    e.ray.ray.set(origin, pos.clone().set(0, -1, 0));
    e.ray.near = 0; e.ray.far = 5;
    const fh = down(castAll(e.ray, scene));
    e.ray.ray.set(origin, pos.clone().set(0, -1, 0));
    e.ray.near = 0; e.ray.far = 5;
    const ft = down(castAll(e.ray, targets));
    const camDir = cam.getWorldDirection(e.ray.ray.direction.clone());
    return {
      total, above, hud, noHit, dark, white, off, offFloor, cop, hitRays, firstMiss,
      footFloorM: fh ? Math.round((fh.point.y - footY) * 1000) / 1000 : null,
      footScene: fh ? detail(fh) : null,
      footTarget: ft ? { ...detail(ft), m: Math.round((ft.point.y - footY) * 1000) / 1000 } : null,
      cam: { p: cam.position.toArray().map((v: number) => +v.toFixed(2)), dir: camDir.toArray().map((v: number) => +v.toFixed(3)), fov: +cam.fov.toFixed(1), aspect: +cam.aspect.toFixed(3), pitchDeg: +(Math.asin(camDir.y) * 180 / Math.PI).toFixed(1) },
      avatar: e.avatarEnu, renderer: [pos.x, pos.y, pos.z].map((v) => Math.round(v * 1000) / 1000),
      ms: Math.round(performance.now() - t0),
      errors: qa?.errors?.slice(-3) ?? [],
      groups, pairs,
    };
  }, { b64, NX: GRID_X, NY: GRID_Y });
  return { ...m, pct: { noHit: pct(m.noHit as number, m.total as number), dark: pct(m.dark as number, m.total as number), white: pct(m.white as number, m.total as number), off: pct(m.off as number, m.total as number), offFloor: pct(m.offFloor as number, m.total as number), cop: pct(m.cop as number, m.total as number) }, shot };
}

/** Contact sheet per route: 4 columns, 480 px per cell, frames in file (step) order. */
function sheet(route: string, dir: string): string | null {
  const shots = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  if (shots.length === 0) return null;
  const rows = Math.ceil(shots.length / 4);
  const out = path.join(OUT, "sheets", `${route}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-pattern_type", "glob", "-i", path.join(dir, "*.png"),
    "-vf", `scale=480:-1,tile=4x${rows}:margin=4:padding=2`, "-frames:v", "1", out], { stdio: "inherit" });
  return out;
}

for (const route of ROUTES) {
  if (selected.length && !selected.includes(route.id)) continue;
  test(`player-view floor scan: ${route.id}`, async ({ page }, info) => {
    test.setTimeout(900_000);
    const routeDir = path.join(OUT, "shots", route.id);
    fs.mkdirSync(routeDir, { recursive: true });
    await openStation(page, route.station, "&avatar=cat");
    await page.waitForTimeout(2500);
    const gl = await page.evaluate(() => (window as any).__qa?.gl ?? null);
    expect(JSON.stringify(gl), "real GPU (not SwiftShader)").not.toMatch(/SwiftShader|llvmpipe|Software/i);
    await hooks.setProfile(page, { stepFree: false, unpaidOnly: false, strictHours: false });
    expect(await hooks.setOrigin(page, route.from), `origin ${route.from}`).toBe(true);
    expect(await hooks.setDestination(page, route.to), `destination ${route.to}`).toBe(true);
    const routed = await hooks.route(page);
    expect(routed?.ok, `route ${route.from} -> ${route.to}`).toBe(true);
    const steps = routed.steps as { edgeId: string; fromNodeId: string; toNodeId: string; reversed: boolean; mode: string }[];
    const wps = routeWaypoints(route.station, steps);
    const { graph } = stationData(route.station);
    const floors = new Map((JSON.parse(fs.readFileSync(path.join(process.env.GTEKI_ROOT!, `stations/${route.station}/gteki/station.json`), "utf8")) as { floors: { id: string; renderElevationM?: number }[] }).floors.map((f) => [f.id, f]));
    const levelOf = (d: number) => {
      const n = graph.nodes.find((x) => x.id === steps[stepAt(wps, d)]!.fromNodeId);
      return n ? { floorId: n.floorId, renderElevationM: floors.get(n.floorId)?.renderElevationM ?? null } : { floorId: null, renderElevationM: null };
    };
    await page.evaluate(() => (window as any).__gteki.startGuide());
    await expect.poll(() => hooks.mode(page), { timeout: 20_000 }).toBe("guide");
    // Paused: the guide must not move between the seek and the measurement.
    await page.evaluate(() => (window as any).__gteki.scanProbe().explorer.setGuidePaused(true));
    const total = await page.evaluate(() => { const g = (window as any).__gteki.scanProbe().explorer.guide; return g ? g.cum[g.cum.length - 1] : 0; });
    expect(total, "guide path length").toBeGreaterThan(10);
    // Diagnostics: which ray sets find the floor at all (the scan's numbers depend on this).
    const diag = await page.evaluate(() => {
      const e = (window as any).__gteki.scanProbe().explorer;
      const { castAll, prepareRayTrees } = (window as any).__gteki.scanProbe();
      e.camera.updateMatrixWorld(true);
      const chain = (o: any): string => { const n: string[] = []; for (let x = o; x && n.length < 4; x = x.parent) if (x.name) n.push(x.name); return n.join("<") || "(unnamed)"; };
      const detail = (h: any) => {
        const mat = Array.isArray(h.object.material) ? h.object.material[h.face?.materialIndex ?? 0] : h.object.material;
        return `${chain(h.object)}|${mat?.name || ""}|${mat?.type || ""}|${mat?.color ? `#${mat.color.getHexString()}` : ""}|d=${+h.distance.toFixed(2)}`;
      };
      const meshes: any[] = []; e.scene.traverse((o: any) => { if (o.isMesh) meshes.push(o); });
      // Trees only where the per-triangle loop would hurt (big merged meshes); small ones test natively.
      const big = meshes.filter((m: any) => (m.geometry?.index?.count ?? m.geometry?.attributes?.position?.count ?? 0) > 3000);
      const trees = prepareRayTrees(big);
      (globalThis as any).__probeScene = { meshes };
      const pos = e.pos;
      const o = pos.clone(); o.y += 0.1;
      const down = (targets: any[]) => { e.ray.ray.set(o, pos.clone().set(0, -1, 0)); e.ray.near = 0; e.ray.far = 5; return castAll(e.ray, targets); };
      const downSceneHits = down(meshes).filter((h: any) => h.object?.isMesh);
      const downCamHits = down(e.cameraTargets);
      e.ray.setFromCamera({ x: 0, y: -0.6 }, e.camera); e.ray.near = 0; e.ray.far = 200;
      const midScene = castAll(e.ray, meshes).filter((h: any) => h.object?.isMesh).length;
      const t0 = performance.now();
      for (let i = 0; i < 200; i++) { e.ray.setFromCamera({ x: (i % 20) / 10 - 1, y: (Math.floor(i / 20) / 10) - 1 }, e.camera); castAll(e.ray, meshes); }
      const msPerRay = +((performance.now() - t0) / 200).toFixed(2);
      const rect = e.renderer.domElement.getBoundingClientRect();
      const camDir = e.camera.getWorldDirection(e.ray.ray.direction.clone());
      // What the scene's meshes are: full ancestor path + material, so an unnamed flat surface can be named.
      const pathOf = (o: any) => { const n: string[] = []; for (let x = o; x; x = x.parent) n.push(x.name || x.type); return n.join("<"); };
      const inv: Record<string, { n: number; shown: number }> = {};
      for (const m of meshes) {
        const mat = Array.isArray(m.material) ? m.material[0] : m.material;
        const k = `${pathOf(m)}|${mat?.type || ""}|${mat?.color ? `#${mat.color.getHexString()}` : ""}|${mat?.visible === false ? "hidden" : "shown"}`;
        const g = (inv[k] ??= { n: 0, shown: 0 });
        g.n++;
        let shown = mat?.visible !== false; for (let x = m; x && shown; x = x.parent) if (x.visible === false) shown = false;
        if (shown) g.shown++;
      }
      const inventory = Object.entries(inv).sort((a, b) => b[1].n - a[1].n).slice(0, 20).map(([k, v]) => `${v.n}/${v.shown} ${k}`);
      return {
        targets: e.cameraTargets.length, ground: e.groundTargets.length, sky: e.skyTargets.length, sceneMeshes: meshes.length, trees, msPerRay, midScene, inventory,
        downScene: downSceneHits.map(detail), downCam: downCamHits.map(detail),
        canvas: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, window: [innerWidth, innerHeight],
        cam: { p: e.camera.position.toArray().map((v: number) => +v.toFixed(2)), dir: camDir.toArray().map((v: number) => +v.toFixed(3)), fov: e.camera.fov, aspect: +e.camera.aspect.toFixed(3) },
        pos: pos.toArray().map((v: number) => +v.toFixed(2)),
      };
    });
    console.log(`SELFTEST ${route.id} ${JSON.stringify(diag)}`);
    const start = await hooks.avatar(page);
    const rows: Record<string, unknown>[] = [];
    for (let d = 0; d <= total + 1e-6; d += STEP_M) {
      const at = Math.min(d, total);
      await page.evaluate((s) => (window as any).__gteki.scanProbe().explorer.seekGuide(s), at);
      await hooks.simulate(page, 0.4);
      const guide = await page.evaluate(() => { const e = (window as any).__gteki.scanProbe().explorer; return { s: e.guide?.s ?? null, paused: e.guidePaused }; });
      const s = guide.s ?? at;
      const level = levelOf(s);
      const index = rows.length;
      const shot = path.join(routeDir, `${String(index).padStart(3, "0")}.png`);
      const m = await measure(page, shot);
      const row = { station: route.station, route: route.id, step: index, steps: Math.floor(total / STEP_M) + 1, requested: { d: +at.toFixed(2) }, guideS: +s.toFixed(2), paused: guide.paused, level: level.floorId, floorElevationM: level.renderElevationM, mode: steps[stepAt(wps, s)]!.mode, ...m };
      rows.push(row);
      fs.appendFileSync(path.join(OUT, "rows.jsonl"), JSON.stringify(row) + "\n");
      console.log(`WALKSCAN ${route.id} step=${index} d=${s.toFixed(2)}/${total.toFixed(1)} total=${m.total} above=${m.above} noHit%=${(row as any).pct.noHit} dark%=${(row as any).pct.dark} white%=${(row as any).pct.white} off%=${(row as any).pct.off} offFloor%=${(row as any).pct.offFloor} cop%=${(row as any).pct.cop} foot=${m.footFloorM} pitch=${(m.cam as any).pitchDeg} ms=${m.ms}`);
    }
    const routeSummary = {
      route: route.id, station: route.station, from: route.from, to: route.to, gl, start, totalM: Math.round(total), diag,
      steps: steps.map((s) => ({ edgeId: s.edgeId, mode: s.mode })), samples: rows.length, shotDir: routeDir,
    };
    fs.appendFileSync(path.join(OUT, "routes.jsonl"), JSON.stringify(routeSummary) + "\n");
    const sheetPath = sheet(route.id, routeDir);
    console.log(`WALKSCAN ${route.id} sheet=${sheetPath} samples=${rows.length}`);
    expect(rows.length).toBeGreaterThan(Math.floor(total / STEP_M) - 1);
  });
}
