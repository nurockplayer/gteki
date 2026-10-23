import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { hooks, openStation, stationData } from "../lib/gteki.ts";

/**
 * Draw-call and triangle budget probe for the Ikebukuro street-context layer (PR #110). Measurement, not a
 * gate. Counts include every pass, so absolute budgets taken with other counters do not apply: with
 * GTEKI_BUDGET_BASELINE=<the same probe's .json from a run on the base branch>, it soft-checks that underground
 * views are unchanged and that street views cost no more than the context's own meshes.
 *
 * Not part of CI (e2e-smoke.yml names its specs) and skipped unless GTEKI_BUDGET=1. Needs a real GPU: run it
 * on the dev Mac in Brave, one project per tier, each against a built candidate (see README, "Context budget").
 *
 *   GTEKI_BUDGET=1 GTEKI_ROOT=<checkout> pnpm exec playwright test specs/10-ikebukuro-context-budget.spec.ts --project=desktop-chromium   # high
 *   GTEKI_BUDGET=1 GTEKI_ROOT=<checkout> pnpm exec playwright test specs/10-ikebukuro-context-budget.spec.ts --project=phone-chromium     # low
 *
 * Tier comes from the explorer (hooks.quality: coarse pointer or screen under 700 px => low), so the phone
 * project is the low run. Per (spot, heading) it records, over ~60 rendered frames, draw calls (p50/max) and
 * triangles (p50/max) counted at the WebGL boundary (every pass of the frame, shadow and post included), the
 * world bounding box (context attached: it differs by > 2 m from the underground baseline, since the explorer adds the
 * `street-context` group to the world only while the street gate is open) and sceneInfo().street.active.
 *
 * Env: GTEKI_BUDGET_OUT (output dir, default <GTEKI_ROOT>/.qa/ikebukuro-context-budget),
 *      GTEKI_BUDGET_STREET (comma list of street exit node ids), GTEKI_BUDGET_FRAMES (default 60),
 *      GTEKI_BUDGET_TIER (optional: assert the explorer picked this tier, "low" or "high"),
 *      GTEKI_BUDGET_BASELINE (optional: base-branch run of this probe, same tier, to compare against).
 */
test.skip(!process.env.GTEKI_BUDGET, "set GTEKI_BUDGET=1 to run the Ikebukuro context budget probe");
test.use({ trace: "off", video: "off", screenshot: "off" });

const UNDERGROUND = ["c_mid", "w_c", "sw_h", "n_h"];
// x35 and x39 (the farthest exit, ~249 m from the context origin) are required; x11 and x38 are the next
// farthest-point picks from them (west end, and the near-centre south side).
const STREET = (process.env.GTEKI_BUDGET_STREET ?? "x35,x39,x11,x38").split(",").map((s) => s.trim()).filter(Boolean);
const HEADINGS = [0, 90, 180, 270];
const FRAMES = Number(process.env.GTEKI_BUDGET_FRAMES ?? 60);
// What the context may add at street level (its mesh count and triangles per variant, see scene/context.test.ts).
const CONTEXT_COST = { low: { draws: 8, tris: 31_000 }, high: { draws: 8, tris: 140_000 } };
const LOOK_RAD_PER_PX = 0.0042;

/** Counts draw calls and triangles per rendered frame at the WebGL boundary (independent of lib PROBE_SCRIPT). */
const TRI_PROBE = `(() => {
  const st = { draws: [], tris: [], zero: 0, curD: 0, curT: 0 };
  window.__bud = st;
  const T = (mode, n) => (mode === 4 ? Math.floor(n / 3) : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0);
  const wrap = (C) => {
    if (!C) return;
    const w = (fn, f) => { const o = C.prototype[fn]; if (o) C.prototype[fn] = function (...a) { st.curD++; st.curT += f(...a); return o.apply(this, a); }; };
    w("drawElements", (m, c) => T(m, c));
    w("drawArrays", (m, f, c) => T(m, c));
    w("drawElementsInstanced", (m, c, t, o, i) => T(m, c) * i);
    w("drawArraysInstanced", (m, f, c, i) => T(m, c) * i);
    w("drawRangeElements", (m, s, e, c) => T(m, c));
  };
  wrap(self.WebGL2RenderingContext);
  wrap(self.WebGLRenderingContext);
  const loop = () => {
    if (st.curD > 0) { st.draws.push(st.curD); st.tris.push(st.curT); } else st.zero++;
    st.curD = 0; st.curT = 0;
    if (st.draws.length > 6000) { st.draws.splice(0, 3000); st.tris.splice(0, 3000); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();`;

const pct = (a: number[], p: number): number | null => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
};

/** Yaw the walker by dragging the canvas, in chunks that stay inside the canvas (phone width included). */
async function turn(page: Page, headingDeg: number): Promise<void> {
  // Heading 0 is the spawn yaw (walkFrom resets it); yaw -= dx * 0.0042 and yaw = -heading, so dx = heading.
  const h = headingDeg > 180 ? headingDeg - 360 : headingDeg;
  const total = Math.round(((h * Math.PI) / 180) / LOOK_RAD_PER_PX);
  if (total === 0) return;
  const c = (await page.locator("canvas.gteki-canvas").boundingBox())!;
  const maxChunk = Math.floor(c.width * 0.35);
  const x = c.x + c.width * 0.5, y = c.y + c.height * 0.45;
  for (let sent = 0; Math.abs(total - sent) >= 1; ) {
    const chunk = Math.max(-maxChunk, Math.min(maxChunk, Math.round(total - sent)));
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + chunk, y, { steps: 3 });
    await page.mouse.up();
    sent += chunk;
  }
}

async function measure(page: Page, frames: number) {
  await page.evaluate(() => { const b = (window as any).__bud; b.draws.length = 0; b.tris.length = 0; b.zero = 0; });
  await page.waitForFunction((n) => (window as any).__bud.draws.length >= n, frames, { timeout: 60_000 });
  return page.evaluate((n) => {
    const b = (window as any).__bud;
    return { draws: (b.draws as number[]).slice(0, n), tris: (b.tris as number[]).slice(0, n), zeroFrames: b.zero as number };
  }, frames);
}

// Crowd and signs can nudge the world box by decimetres; the context adds tens to hundreds of metres of buildings.
const differs = (a: number[], b: number[]) => a.length !== b.length || a.some((v, i) => Math.abs(v - b[i]!) > 2);

test("ikebukuro street-context draw/tri budget @phone", async ({ page }, testInfo) => {
  test.setTimeout(1_800_000);
  const root = process.env.GTEKI_ROOT;
  if (!root) throw new Error("GTEKI_ROOT must point at the candidate checkout");
  const { graph } = stationData("ikebukuro");
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const id of UNDERGROUND) expect(byId.has(id), `underground node ${id}`).toBe(true);
  for (const id of STREET) {
    const n = byId.get(id) as (typeof graph.nodes[number] & { kind?: string }) | undefined;
    expect(n, `street node ${id}`).toBeDefined();
    expect(n!.floorId, `${id} floor`).toBe("street");
    expect(n!.kind, `${id} kind`).toBe("exit");
  }

  await page.addInitScript(TRI_PROBE);
  const { loadMs } = await openStation(page, "ikebukuro");
  const tier = await hooks.quality(page);
  if (process.env.GTEKI_BUDGET_TIER) expect(tier, "explorer quality tier").toBe(process.env.GTEKI_BUDGET_TIER);
  const gl = await page.evaluate(() => (window as any).__qa?.gl ?? null);
  const gpuValid = Boolean(gl?.renderer) && !/SwiftShader|llvmpipe|Software/i.test(String(gl?.renderer));

  const rows: Record<string, unknown>[] = [];
  let baseline: number[] | null = null; // world bbox with the context detached (first underground spot)

  const spots = [...UNDERGROUND.map((id) => ({ id, group: "underground" as const })), ...STREET.map((id) => ({ id, group: "street" as const }))];
  for (const spot of spots) {
    for (const heading of HEADINGS) {
      // Re-spawning resets yaw to 0 and snaps the camera, so every heading is measured from a clean placement.
      expect(await hooks.walkFromNode(page, spot.id), `walkFromNode ${spot.id}`).toBe(true);
      if (spot.group === "street") {
        // The street gate lags the camera by a frame and the backdrop fades in: give it time, but never fail on it.
        await page.waitForFunction(() => (window as any).__gteki.sceneInfo().street.active, null, { timeout: 8_000 }).catch(() => undefined);
      }
      await turn(page, heading);
      await page.waitForTimeout(spot.group === "street" ? 2_000 : 1_200);

      const before = await hooks.sceneInfo(page);
      const m = await measure(page, FRAMES);
      const after = await hooks.sceneInfo(page);
      const av = await hooks.avatar(page);
      if (baseline === null && spot.group === "underground") baseline = before.world;
      const attached = (info: typeof before) => baseline !== null && differs(info.world, baseline);
      // Where the camera looks: avatar minus camera, renderer frame is (x, up, -north). 0 = north, 90 = east.
      const cam = after.camera;
      const facingDeg = Math.round((Math.atan2(av.x - cam[0]!, -(-av.y - cam[2]!)) * 180 / Math.PI + 360) % 360);
      const diff = Math.abs(((facingDeg - heading + 540) % 360) - 180);

      rows.push({
        tier, group: spot.group, spot: spot.id, heading, headingMeasuredDeg: facingDeg, headingOk: diff <= 25,
        frames: m.draws.length, zeroFrames: m.zeroFrames,
        drawsP50: pct(m.draws, 0.5), drawsMax: Math.max(...m.draws), drawsMin: Math.min(...m.draws),
        trisP50: pct(m.tris, 0.5), trisMax: Math.max(...m.tris),
        contextAttached: attached(before) && attached(after),
        contextAttachedStart: attached(before), contextAttachedEnd: attached(after),
        streetActive: before.street.active && after.street.active,
        streetActiveStart: before.street.active, streetActiveEnd: after.street.active, streetOpacity: after.street.opacity,
        avatar: { x: Math.round(av.x * 10) / 10, y: Math.round(av.y * 10) / 10, z: Math.round(av.z * 10) / 10 },
        cameraY: cam[1],
      });
    }
  }

  const under = rows.filter((r) => r.group === "underground") as any[];
  const street = rows.filter((r) => r.group === "street") as any[];
  const underMax = { draws: Math.max(...under.map((r) => r.drawsMax)), tris: Math.max(...under.map((r) => r.trisMax)) };
  const result = {
    probe: "ikebukuro-context-budget", tier, project: testInfo.project.name, viewport: page.viewportSize(), loadMs, gl, gpuValid,
    frames: FRAMES, baselineWorldBox: baseline,
    underground: {
      ...underMax, contextAttachedAnywhere: under.some((r) => r.contextAttached), streetActiveAnywhere: under.some((r) => r.streetActive),
    },
    street: {
      spotsWithContext: new Set(street.filter((r) => r.contextAttached).map((r) => r.spot)).size,
      spotsActive: new Set(street.filter((r) => r.streetActive).map((r) => r.spot)).size,
      spotsMeasured: new Set(street.map((r) => r.spot)).size,
      drawsMax: Math.max(...street.map((r) => r.drawsMax)), trisMax: Math.max(...street.map((r) => r.trisMax)),
    },
    rows,
  };

  const outDir = process.env.GTEKI_BUDGET_OUT ?? path.join(root, ".qa", "ikebukuro-context-budget");
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, `ikebukuro-context-budget-${tier}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(result, null, 2));
  const yn = (b: unknown) => (b ? "yes" : "no");
  const md = [
    `# Ikebukuro street-context budget: ${tier} tier (${testInfo.project.name})`,
    "",
    `Renderer: ${gl?.renderer ?? "unknown"} (gpuValid=${gpuValid}); viewport ${JSON.stringify(page.viewportSize())}; ${FRAMES} frames per row; draws/tris counted at the WebGL boundary, all passes.`,
    "",
    `Underground max: ${underMax.draws} draws, ${underMax.tris} tris` + (process.env.GTEKI_BUDGET_BASELINE ? ` (compared with ${path.basename(process.env.GTEKI_BUDGET_BASELINE)})` : "") +
      `; context attached underground: ${yn(result.underground.contextAttachedAnywhere)}; street.active underground: ${yn(result.underground.streetActiveAnywhere)}.`,
    "",
    "| group | spot | heading | facing | draws p50 | draws max | tris p50 | tris max | context attached | street.active |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...(rows as any[]).map((r) => `| ${r.group} | ${r.spot} | ${r.heading} | ${r.headingMeasuredDeg}${r.headingOk ? "" : " (!)"} | ${r.drawsP50} | ${r.drawsMax} | ${r.trisP50} | ${r.trisMax} | ${yn(r.contextAttached)} | ${yn(r.streetActive)} |`),
    "",
  ].join("\n");
  fs.writeFileSync(`${base}.md`, md);
  testInfo.annotations.push({ type: "output", description: `${base}.json` });
  console.log(`context budget (${tier}) written to ${base}.json / .md`);

  expect(gpuValid, `renderer ${gl?.renderer}: software rendering invalidates the measurement`).toBe(true);
  expect.soft(result.underground.contextAttachedAnywhere, "the context must never be in the scene underground").toBe(false);
  expect.soft(result.street.spotsWithContext, "the context never attached at any street spot").toBeGreaterThan(0);
  const baselineFile = process.env.GTEKI_BUDGET_BASELINE;
  if (baselineFile) {
    const baseRun = JSON.parse(fs.readFileSync(baselineFile, "utf8")) as { tier: string; rows: any[] };
    expect(baseRun.tier, "baseline must be the same tier").toBe(tier);
    const cost = CONTEXT_COST[tier as "low" | "high"];
    // p50 per view; the crowd moves, so allow one draw and 3 % triangles of noise. Views whose heading missed are skipped.
    for (const r of rows as any[]) {
      const b = baseRun.rows.find((x) => x.spot === r.spot && x.heading === r.heading);
      if (!b || !r.headingOk || !b.headingOk) continue;
      const extra = r.group === "street" ? cost : { draws: 0, tris: 0 };
      const view = `${r.group} ${r.spot} @${r.heading}`;
      expect.soft(r.drawsP50, `${view}: draws vs baseline ${b.drawsP50}`).toBeLessThanOrEqual(b.drawsP50 + extra.draws + 1);
      expect.soft(r.trisP50, `${view}: triangles vs baseline ${b.trisP50}`).toBeLessThanOrEqual(b.trisP50 * 1.03 + extra.tris);
    }
  }
});
