import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { save, shotPath } from "../lib/gteki.ts";

/**
 * Look-gap tracker (Issue #94): how far the game's look is from the Lane E Blender reference renders at
 * the same camera, recorded on every QA run so the gap can be followed over time. It measures today's game
 * only: no look lever (env, tm, exp, shadows, sun, hemi, bg, bloom, ...) is passed to the harness, so the
 * numbers describe the baseline in-game look, never a proposal.
 *
 * The harness is the dev-only page apps/web/qa/look.html. It builds the game's real Explorer, loads Lane E's
 * showcase layout through the explorer pipeline and pins the camera to the Blender camera. `vite build` does
 * not emit it, so it is served by the dev server that tools/qa/run-candidate.sh starts on port+1
 * (GTEKI_LOOK_URL). Without GTEKI_LOOK_URL this spec skips. It is ready when `window.__look.ready` resolves;
 * `__look.info()` gives the draw calls of a whole frame and `__look.timeFrames(n)` the median frame time.
 *
 * Tiers (the report docs/qa/reports/2026-10-22-art-94-look-gap.md uses the same ones):
 *   desktop    quality=high&tier=full    desktop quality: post-FX chain, shadows; full-detail kit. Desktop project only.
 *   phone      quality=low&tier=full     the explorer's low-quality path phones get (no post-FX, no shadows); full kit.
 *   phone-kit  quality=low&tier=mobile   the same low path with Lane E's mobile kit (assets/library/mobile).
 * The phone and phone-kit tiers (tagged @phone) also run in the phone-webkit and phone-chromium projects to
 * compare engines. Every case forces a 1600x900, DPR 1 context (a fresh one, so the phone device emulation's
 * DPR and touch do not apply) so the framing matches the 1600x900 reference JPGs pixel for pixel; the quality
 * tier comes from the URL, not from the device.
 *
 * Evidence per case: a screenshot (look-<scene>-<tier>.png), a side-by-side with the reference on the left and the
 * game on the right (look-<scene>-<tier>-sbs.jpg), RMSE from `magick compare -metric RMSE` (0..1, lower is
 * closer; null when ImageMagick is missing), draw calls and median frame ms from the harness, all in
 * look-compare.json. RMSE is a crude distance and the numbers are relative: they come from a desktop GPU on a
 * shared host, so compare runs with each other, never with a device budget. Assertions are soft and only say
 * that the harness became ready and a screenshot exists for each case. RMSE is evidence, not a gate, and this
 * step never replaces human visual review.
 */
test.use({ trace: "off" });

const lookUrl = (process.env.GTEKI_LOOK_URL ?? "").replace(/\/+$/, "");
const VIEWPORT = { width: 1600, height: 900 };
const READY_TIMEOUT_MS = 120_000;
const FRAME_SAMPLES = 40;

const scenes = [
  { id: "vertical_hero", layout: "vertical_demo", camera: "hero", reference: "vertical_hero.jpg" },
  { id: "concourse_gates_closed", layout: "concourse_demo", camera: "gates_closed", reference: "concourse_gates_closed.jpg" },
];
const tiers = [
  { id: "desktop", params: "quality=high&tier=full", phone: false },
  { id: "phone", params: "quality=low&tier=full", phone: true },
  { id: "phone-kit", params: "quality=low&tier=mobile", phone: true },
];
// Extra look.html switches to A/B on top of every tier, comma-separated (e.g. GTEKI_LOOK_VARIANTS="aoMap=0,aoMapI=1"
// for the baked-AO scale); each adds a case "<tier>+<switch>". Empty: the baseline cases only.
const variants = ["", ...(process.env.GTEKI_LOOK_VARIANTS ?? "").split(",").map((v) => v.trim()).filter(Boolean)];

// The reference JPGs live in the repo's docs; prefer the candidate under test, else the harness checkout.
const roots = [process.env.GTEKI_ROOT, path.resolve(import.meta.dirname, "../../..")].filter((r): r is string => !!r);
function referencePath(file: string): string | null {
  for (const r of roots) {
    const p = path.join(r, "docs/assets/img", file);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const magickAvailable = (() => {
  try { return spawnSync("magick", ["-version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

/** Normalised RMSE (0..1). `magick compare` prints "<raw> (<normalised>)" on stderr and exits 1 when images differ. */
function rmse(shot: string, ref: string): { value: number | null; note?: string } {
  if (!magickAvailable) return { value: null, note: "magick not installed" };
  const r = spawnSync("magick", ["compare", "-metric", "RMSE", shot, ref, "null:"], { encoding: "utf8" });
  const m = /\(([0-9.eE+-]+)\)/.exec(r.stderr ?? "");
  if (r.status !== null && r.status <= 1 && m) return { value: Number(m[1]) };
  return { value: null, note: `magick compare exit ${r.status}: ${(r.stderr ?? "").trim().slice(0, 200)}` };
}

function sideBySide(ref: string, shot: string, out: string): boolean {
  if (!magickAvailable) return false;
  return spawnSync("magick", [ref, shot, "+append", "-resize", "50%", out]).status === 0 && fs.existsSync(out);
}

interface CaseRecord {
  scene: string; camera: string; tier: string; url: string;
  ready: boolean; error: string | null;
  rmse: number | null; rmseNote: string | null;
  drawCalls: number | null; frameMs: number | null; frameMsP90: number | null;
  harness: Record<string, unknown> | null;
  shot: string | null; sbs: string | null; reference: string | null;
}

/** Cases recorded so far, per project: look-compare.json is rewritten after each case. */
const recorded = new Map<string, CaseRecord[]>();

/** Open the harness and wait for its ready promise. A cold Vite dev server may re-optimise deps and reload once, so retry once. */
async function openLook(page: Page, url: string): Promise<string | null> {
  let last = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!(window as any).__look || !(document.getElementById("err")?.hidden ?? true), null, { timeout: 60_000 });
      const ready = await page.evaluate((ms) => {
        const err = document.getElementById("err");
        if (err && !err.hidden) return `harness error: ${err.textContent}`;
        const look = (window as any).__look;
        return Promise.race([
          look.ready.then(() => null),
          new Promise<string>((res) => setTimeout(() => res(`not ready after ${ms} ms`), ms)),
        ]);
      }, READY_TIMEOUT_MS);
      if (ready === null) return null;
      last = ready;
    } catch (e) {
      last = String((e as Error).message ?? e).split("\n")[0]!;
    }
  }
  return last;
}

async function newPage(browser: Browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  return { context, page };
}

for (const scene of scenes) {
  for (const t of tiers) for (const v of variants) {
    const tier = v ? { ...t, id: `${t.id}+${v}`, params: `${t.params}&${v}` } : t;
    test(`look compare: ${scene.id} / ${tier.id}${tier.phone ? " @phone" : ""}`, async ({ browser }, testInfo) => {
      test.skip(!lookUrl, "GTEKI_LOOK_URL not set (tools/qa/run-candidate.sh serves the look harness when the candidate has apps/web/qa/look.html)");
      test.skip(!tier.phone && testInfo.project.name !== "desktop-chromium", "desktop tier runs in the desktop project only");
      test.setTimeout(READY_TIMEOUT_MS * 2 + 90_000);

      const project = testInfo.project.name;
      const url = `${lookUrl}/qa/look.html?layout=${scene.layout}&camera=${scene.camera}&${tier.params}`;
      const base = `look-${scene.id}-${tier.id.replace(/[^\w.-]+/g, "_")}`;
      const rec: CaseRecord = {
        scene: scene.id, camera: scene.camera, tier: tier.id, url,
        ready: false, error: null, rmse: null, rmseNote: null,
        drawCalls: null, frameMs: null, frameMsP90: null, harness: null,
        shot: null, sbs: null, reference: referencePath(scene.reference),
      };

      const { context, page } = await newPage(browser);
      try {
        rec.error = await openLook(page, url);
        rec.ready = rec.error === null;
        await page.waitForTimeout(1000);

        // The canvas fills the page (the harness has no UI; labels are hidden), so the viewport is the frame.
        const shot = shotPath(testInfo, `${base}.png`);
        await page.screenshot({ path: shot });
        rec.shot = fs.existsSync(shot) ? shot : null;

        // Metrics after the screenshot, so the extra synchronous frames cannot disturb the captured one.
        if (rec.ready) {
          const m = await page.evaluate(async (n) => {
            const look = (window as any).__look;
            const info = look.info();
            const t = await look.timeFrames(n);
            const gl = look.explorer?.renderer?.getContext?.();
            const ext = gl?.getExtension?.("WEBGL_debug_renderer_info");
            return { info, t, gpu: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null };
          }, FRAME_SAMPLES);
          rec.drawCalls = m.info.drawCalls;
          rec.frameMs = m.t.msMedian;
          rec.frameMsP90 = m.t.msP90;
          rec.harness = { quality: m.info.quality, composer: m.info.composer, passes: m.info.passes, toneMapping: m.info.toneMapping, exposure: m.info.exposure, fov: m.info.fov, size: m.info.size, pixelRatio: m.info.pixelRatio, triangles: m.info.triangles, kitMeshes: m.info.kitMeshes, kitTriangles: m.info.kitTriangles, gpu: m.gpu };
        }

        if (rec.shot && rec.reference) {
          const r = rmse(rec.shot, rec.reference);
          rec.rmse = r.value;
          rec.rmseNote = r.note ?? null;
          const sbs = shotPath(testInfo, `${base}-sbs.jpg`);
          if (sideBySide(rec.reference, rec.shot, sbs)) rec.sbs = sbs;
        } else if (!rec.reference) {
          rec.rmseNote = `reference docs/assets/img/${scene.reference} not found`;
        }
      } finally {
        await context.close();
      }

      const cases = recorded.get(project) ?? [];
      cases.push(rec);
      recorded.set(project, cases);
      save(testInfo, "look-compare.json", {
        project,
        note: "Baseline game look vs Lane E Blender render at the same camera. RMSE 0..1, lower is closer; relative evidence from a desktop GPU, not a gate.",
        cases: cases.map(({ scene, camera, tier, url, rmse, drawCalls, frameMs, shot, sbs, ...rest }) => ({ scene, camera, tier, url, rmse, drawCalls, frameMs, shot, sbs, ...rest })),
      });
      console.log(`[look-compare] ${project} ${scene.id}/${tier.id}: ready=${rec.ready} rmse=${rec.rmse === null ? "n/a" : rec.rmse.toFixed(3)} drawCalls=${rec.drawCalls ?? "n/a"} frameMs=${rec.frameMs === null ? "n/a" : rec.frameMs.toFixed(1)}${rec.error ? ` error=${rec.error}` : ""}`);

      // Soft only: RMSE is evidence for the look-gap trend, not a pass/fail gate.
      expect.soft(rec.ready, `look harness ready (${rec.error ?? "ok"})`).toBe(true);
      expect.soft(rec.shot, "screenshot written").not.toBeNull();
      expect.soft(rec.reference, `reference image ${scene.reference} found`).not.toBeNull();
    });
  }
}
