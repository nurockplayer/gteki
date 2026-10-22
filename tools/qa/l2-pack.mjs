#!/usr/bin/env node
// Lane F: build the L2 review pack for one station from a harness evidence directory.
//
// usage: node tools/qa/l2-pack.mjs <evidence-dir> --station <ikebukuro|shinjuku> [--candidate <dir>] [--out <dir>] [--no-sheets]
//   <evidence-dir>  tests/e2e/artifacts/evidence (holds <project>/*.json) or its parent; manifest.json is read from the
//                   parent, test-results/**.webm (recordings) from the parent too.
//   --candidate     the candidate checkout (run-candidate.sh: <workdir>/candidate): station counts, reference stills.
//   --out           default <evidence-parent>/l2-pack-<station>. Files are referenced by path relative to --out.
//   --no-sheets     skip contact sheets (they need ffmpeg and tools/qa/contact-sheet.sh; without ffmpeg frames are listed).
//
// Writes <out>/l2-review.md (the station's rubric from docs/qa/l2-acceptance.md: automated rows pre-filled with
// values and the rule verdict, human rows "needs eyes" with the files to look at, an empty reviewer column) and
// <out>/l2-pack.json. Plain Node ESM, no dependencies. Missing evidence is "n/a (not run)", never PASS.
// Exit 0 even when evidence is missing (it is a report); non-zero only on bad usage.
// The pack never says PASS for a human row. Rules are those of the specs in tests/e2e/specs and of protocol.md;
// no FPS threshold is invented (acceptance.md forbids ungrounded ones), so fps is recorded only.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv.splice(i, 2)[1]; };
const bool = (name) => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; };
const station = flag("--station");
const candidate = flag("--candidate");
const outOpt = flag("--out");
const noSheets = bool("--no-sheets");
const usage = "usage: l2-pack.mjs <evidence-dir> --station <ikebukuro|shinjuku> [--candidate <dir>] [--out <dir>] [--no-sheets]";

// ---- Station facts (walks come from 03/12/13; sources are the files a reviewer reads) -------------
const STATIONS = {
  ikebukuro: {
    name: "Ikebukuro", cues: true,
    walks: [{ label: "jrc2-exit35", text: "JR Central Gate 2 -> Exit 35" }, { label: "westb1-exit4", text: "West Exit (B1) -> Exit 4" }],
    pois: "stations/ikebukuro/gteki/pois.json", signage: "stations/ikebukuro/scene/signage.json",
    simplifications: "stations/ikebukuro/README.md (Deliberate simplifications) and stations/ikebukuro/docs/coverage-gaps.md",
    references: "stations/ikebukuro/docs/evidence/*.jpg",
  },
  shinjuku: {
    name: "Shinjuku", cues: false,
    walks: [{ label: "exit1-platform", text: "Exit 1 (street, north side) -> Oedo Line platform" }, { label: "platform-exit2", text: "Oedo Line platform -> Exit 2 (street, northwest side)" }],
    pois: "stations/shinjuku/gteki/pois.json", signage: null,
    simplifications: "docs/stations/shinjuku/README.md (Deliberate simplifications, Coverage gaps) and coverage.gaps in stations/shinjuku/gteki/station.json",
    references: null,
  },
};
const st = STATIONS[station];
const evDir = argv[0];
if (!st || !evDir || argv.length !== 1) { console.error(usage); process.exit(2); }

const here = path.dirname(fileURLToPath(import.meta.url));
let evidence = path.resolve(evDir);
if (fs.existsSync(path.join(evidence, "evidence"))) evidence = path.join(evidence, "evidence");
const parent = path.dirname(evidence);
const out = path.resolve(outOpt ?? path.join(parent, `l2-pack-${station}`));
fs.mkdirSync(out, { recursive: true });

// ---- Rules (one place; each is a number the specs or protocol.md already use) ---------------------
const PROJECTS = ["desktop-chromium", "phone-webkit", "phone-chromium"];
const SHORT = { "desktop-chromium": "desktop", "phone-webkit": "webkit", "phone-chromium": "pixel" };
const ARRIVE_M = 2;            // 03/13: guide ends within 2 m of the destination
const SEEN_MIN = 2;            // 03/12/13: the HUD showed several instructions (> 1)
const NEAR_BLACK_WALK = 0.10;  // 13 (#49) and B2 (protocol.md): worst near-black frame per walk
const NEAR_BLACK_OVERVIEW = 0.30; // 11 (#109)
const LUMA = { min: 40, max: 200 }; // 11
const FRAMING = { min: 0.5, max: 0.8 }; // 11
const CUE_GAP_M = 30;          // 12 (#108)
const CLAMP_RUN_MS = 1250;     // 13
const FOV_JUMP_DEG = 5, FOV_TOL_DEG = 0.5; // 13 lens ease
const WALL_RUN_M = 95, OFF_NET_M = 15;     // 04 wall probe
const NOT_RUN = "n/a (not run)";

// ---- Loading ---------------------------------------------------------------------------------------
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return undefined; } };
const ev = (p, name) => readJson(path.join(evidence, p, name));
const listDir = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const ran = PROJECTS.filter((p) => fs.existsSync(path.join(evidence, p)));
const manifest = readJson(path.join(parent, "manifest.json"));
const round = (x, d = 2) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);
const num = (x, d = 2) => (typeof x === "number" ? String(round(x, d)) : "n/a");
const rel = (f) => path.relative(out, f).split(path.sep).join("/");
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const maxOf = (a) => { const n = a.filter((x) => typeof x === "number"); return n.length ? Math.max(...n) : undefined; };

// ---- Checks: a check runs per project; fn returns {ok, text} or undefined when its evidence is missing ----
// A row collects checks; verdict: any fail -> FAIL, nothing found -> n/a (not run), partly found -> GAP, else PASS.
function check(name, projects, fn) {
  const per = projects.filter((p) => ran.includes(p)).map((p) => ({ p, r: (() => { try { return fn(p); } catch (e) { return { ok: false, text: `unreadable evidence (${e.message})` }; } })() }));
  return { name, per };
}
function verdictOf(checks) {
  const cells = checks.flatMap((c) => c.per.map((x) => ({ name: c.name, p: x.p, r: x.r })));
  const fails = cells.filter((x) => x.r && x.r.ok === false);
  const missing = cells.filter((x) => !x.r);
  const gaps = cells.filter((x) => x.r && x.r.ok === "gap");
  const present = cells.length - missing.length;
  if (fails.length) return `FAIL (${fails.map((x) => `${x.name} ${SHORT[x.p]}`).join(", ")})`;
  if (!present) return NOT_RUN;
  if (gaps.length) return `GAP (${gaps.map((x) => `${x.name} ${SHORT[x.p]}: ${x.r.text}`).join("; ")})`;
  if (missing.length) {
    const label = (x) => (checks.find((c) => c.name === x.name).per.every((y) => !y.r) ? x.name : `${x.name} ${SHORT[x.p]}`);
    return `GAP (not run: ${[...new Set(missing.map(label))].join(", ")})`;
  }
  return "PASS";
}
const lineOf = (c) => `${c.name}: ${c.per.length ? c.per.map((x) => `${SHORT[x.p]} ${x.r ? `${x.r.ok === false ? "FAIL " : ""}${x.r.text}` : "n/a"}`).join("; ") : NOT_RUN}`;

// ---- Per-spec evidence ----------------------------------------------------------------------------
const walkFile = (w) => `${station}-walk-${w.label}.json`;
const spec03 = (w) => check(`03 ${w.label}`, PROJECTS, (p) => {
  const j = ev(p, walkFile(w)); if (!j) return;
  const seen = j.instructionsSeenInHud?.length ?? 0;
  const bad = [];
  if (j.arrived !== true) bad.push("no arrival toast");
  if (!(j.distToGoal < ARRIVE_M)) bad.push(`${num(j.distToGoal, 1)} m from goal`);
  if (!(seen >= SEEN_MIN)) bad.push(`${seen} instruction(s)`);
  return { ok: !bad.length, text: bad.length ? bad.join(", ") : `arrived, ${num(j.distToGoal, 1)} m, ${seen} instr` };
});
const nearBlack03 = (w, project) => maxOf((ev(project, walkFile(w))?.frames ?? []).map((f) => f.stats?.nearBlack));
const cam = (p, w) => ev(p, `${station}-camera-${w.label}.json`);
const cues = (p, w) => ev(p, `ikebukuro-cues-${w.label}.json`);

// ---- Files for the human rows (groups, listed in the appendix) -------------------------------------
const groups = [];
const ffmpeg = !noSheets && spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
function group(id, title, files, { sheet } = {}) {
  const existing = files.filter((f) => fs.existsSync(f));
  if (!existing.length) return null;
  const g = { id, title, files: existing.map(rel), sheet: null };
  if (sheet && ffmpeg) {
    const pick = existing.length <= 12 ? existing : [...new Set(Array.from({ length: 12 }, (_, k) => Math.round((k * (existing.length - 1)) / 11)))].map((i) => existing[i]);
    const target = path.join(out, "sheets", `${id.replace(/[^\w.-]+/g, "_")}.jpg`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const r = spawnSync("sh", [path.join(here, "contact-sheet.sh"), target, "3", ...pick], { encoding: "utf8" });
    if (r.status === 0 && fs.existsSync(target)) g.sheet = rel(target); else g.sheetError = (r.stderr || "contact-sheet.sh failed").trim().slice(0, 200);
  }
  groups.push(g);
  return g;
}
const frames = (p, re) => listDir(path.join(evidence, p)).filter((n) => re.test(n)).sort().map((n) => path.join(evidence, p, n));
const mk = (role, p, id, title, files, o) => { const g = group(`${role}:${SHORT[p]}${id ? `:${id}` : ""}`, `${title} (${p})`, files, o); return g ? g.id : null; };
const G = {};
const add = (key, id) => { if (id) (G[key] ??= []).push(id); };
for (const p of ran) {
  for (const w of st.walks) {
    add("walk", mk("walk", p, w.label, `Guided walk ${w.label}, one frame every 3-4 s (03)`, frames(p, new RegExp(`^${station}-walk-${w.label}-\\d+\\.png$`)), { sheet: true }));
    add("camera", mk("camera", p, w.label, `Follow-camera frames ${w.label} (13; flagged ones included)`, frames(p, new RegExp(`^${station}-camera-${w.label}-\\d+\\.png$`)), { sheet: true }));
    if (st.cues) add("cues", mk("cues", p, w.label, `Cue frames ${w.label} (12)`, frames(p, new RegExp(`^ikebukuro-cues-${w.label}-\\d+\\.png$`)), { sheet: true }));
  }
  add("overview", mk("overview", p, "", "Opening overview (01, 11)", [path.join(evidence, p, `${station}-01-overview.png`), path.join(evidence, p, `${station}-11-overview.png`)]));
  add("ui", mk("ui", p, "", "Coverage dialog, route card, instruction preview (01, 02)", [`${station}-02-coverage.png`, `${station}-03-route-card.png`, `${station}-04-instruction-preview.png`].map((n) => path.join(evidence, p, n))));
  add("fade", mk("fade", p, "", "Label-fade frames C: labels annotated over geometry (09)", frames(p, new RegExp(`^${station}-labelfade-.*-c\\.png$`))));
  add("wall", mk("wall", p, "", "Wall probe end frames (04)", frames(p, new RegExp(`^${station}-wall-probe.*\\.png$`))));
  add("look", mk("look", p, "", "Look-compare side-by-sides vs Lane E renders (10; not a station reference)", frames(p, /^look-.*-sbs\.jpg$/)));
}
// Recordings: Playwright names the folder <spec>-<title>-<hash>-<project>; titles are truncated, so match by station and spec.
const videos = (p) => {
  const root = path.join(parent, "test-results");
  const hit = listDir(root).filter((d) => d.endsWith(`-${p}`) && d.includes(station) && /^(03-guided|12-wayfinding|13-follow)/.test(d));
  return hit.flatMap((d) => listDir(path.join(root, d)).filter((n) => n.endsWith(".webm")).map((n) => path.join(root, d, n)));
};
for (const p of ran) add("video", mk("video", p, "", "Recordings of the guided walks (03, 12, 13; silent, Playwright records no audio)", videos(p)));
const ref = candidate && st.references ? path.join(candidate, path.dirname(st.references)) : null;
const refFiles = ref ? listDir(ref).filter((n) => n.endsWith(".jpg")).sort().map((n) => path.join(ref, n)) : [];
add("ref", group("ref", `Reference stills committed with the station (${st.references ?? "none committed"})`, refFiles)?.id);
const eyes = (...keys) => keys.flatMap((k) => G[k] ?? []);

// ---- Rows ------------------------------------------------------------------------------------------
const rows = [];
const row = (r) => rows.push({ checks: [], rule: "", humanText: "", groups: [], ...r });
const smoke = (p) => ev(p, `${station}-smoke.json`);

row({
  id: "C1", criterion: "Coherent architecture and scale",
  rule: "01: world bbox 6 numbers, walkable meshes > 0, no L0-fallback toast, no page errors or failed requests. 04 (desktop): every run < 95 m, inside scene bounds, < 15 m from a walkable edge or inside a mapped unrestricted space, walker moves > 2 m.",
  checks: [
    check("01 scene", PROJECTS, (p) => {
      const j = smoke(p); if (!j) return;
      const bad = [];
      if (j.info?.world?.length !== 6) bad.push("no world bbox");
      if (!(j.info?.walkable > 0)) bad.push("no walkable meshes");
      if ((j.toasts ?? []).some((t) => /L0|network view|経路網表示/.test(t))) bad.push("L0 fallback");
      if ((j.diag?.pageErrors ?? []).length) bad.push("page errors");
      if ((j.diag?.failedRequests ?? []).length) bad.push("failed requests");
      return { ok: !bad.length, text: bad.length ? bad.join(", ") : `walkable ${j.info?.walkable}, ok` };
    }),
    check("04 wall probe", ["desktop-chromium"], (p) => {
      const w = ev(p, `${station}-wall-probe.json`); if (!Array.isArray(w) || !w.length) return;
      const bad = w.filter((r) => !(r.moved < WALL_RUN_M && r.inBounds && (r.networkM < OFF_NET_M || r.space)));
      const stuck = [...new Set(w.map((r) => r.spawn))].filter((s) => maxOf(w.filter((r) => r.spawn === s).map((r) => r.moved)) <= 2);
      return { ok: bad.length ? false : stuck.length ? "gap" : true, text: bad.length ? `${bad.length}/${w.length} runs escape` : stuck.length ? "control failed: walker did not move" : `${w.length} runs contained, max ${num(maxOf(w.map((r) => r.networkM)), 1)} m off network` };
    }),
  ],
  humanText: "Reviewer judgement: do ceilings, passage widths, stair and escalator proportions and the overall layout read as believable and to scale? Judge the shared explorer, not the lane client.",
  groups: eyes("walk", "wall", "overview"),
});

row({
  id: "C2", criterion: "Useful landmarks",
  rule: "11: opens in overview mode, routable label spread 50-80 % of the shorter side (a proxy), at least one exit label on screen, a hidden exit reachable through search. 09: at least half the poses show a visible label. Whether the landmarks are the right ones is human.",
  checks: [
    check("11 exits", PROJECTS, (p) => {
      const j = ev(p, `${station}-overview.json`); if (!j) return;
      const vis = j.exits?.visible?.length ?? 0;
      const bad = [];
      if (!(vis > 0)) bad.push("no exit label on screen");
      if (j.exits?.reach && j.exits.reach.shownAfterSelect !== true) bad.push("hidden exit not shown once chosen");
      return { ok: !bad.length, text: bad.length ? bad.join(", ") : `${vis} exit label(s) on screen${j.exits?.reach ? ", hidden exit reachable" : ""}` };
    }),
    check("11 framing", PROJECTS, (p) => {
      const j = ev(p, `${station}-overview.json`); if (!j) return;
      // #114's overviewFrame().extentShare when the build has it, else 11's label-anchor proxy.
      const direct = j.framing?.framingDirect?.source === "overviewFrame" ? j.framing.framingDirect.value?.extentShare : undefined;
      const sp = typeof direct === "number" ? direct : j.framing?.routable?.spread;
      const what = typeof direct === "number" ? "routable extent (overviewFrame)" : "routable label spread (proxy)";
      const bad = [];
      if (j.mode !== "overview") bad.push(`opens in ${j.mode}`);
      if (typeof sp === "number" && (sp < FRAMING.min || sp > FRAMING.max)) bad.push(`${what} ${num(sp, 2)} outside ${FRAMING.min}-${FRAMING.max}`);
      return { ok: !bad.length, text: bad.length ? bad.join(", ") : `overview mode, ${what} ${num(sp, 2)} of the shorter side` };
    }),
    check("09 labels", PROJECTS, (p) => {
      const j = ev(p, `${station}-label-fade.json`); if (!j) return;
      const ok = j.posesWithVisibleLabels >= Math.ceil(j.totalPoses / 2);
      return { ok, text: `${j.posesWithVisibleLabels}/${j.totalPoses} poses with labels, shown ${j.totalShown}, faded ${j.totalFaded}${j.totalOffFloor !== undefined ? `, off-floor ${j.totalOffFloor}` : ""}` };
    }),
  ],
  humanText: `Reviewer judgement: tick each landmark of the station's landmark list (${st.pois}${st.signage ? `, ${st.signage}` : ""}) as seen, recognisable and distinct in the overview or on a walk. A red label in the fade frames with no geometry in its sight line is a defect.`,
  groups: eyes("overview", "walk", "fade"),
});

row({
  id: "C3", criterion: "Distinct wayfinding",
  rule: st.cues
    ? "12: largest gap between sign or junction cues along the guided leg <= 30 m, several HUD instructions, leg covered >= 90 % (not in flow-only runs). Stagnant runs and front-facing gaps are recorded, not judged."
    : "No cue-spacing spec for this station (12 is Ikebukuro only), so there is no automated verdict. HUD instruction counts from 03 are listed. Sign and cue quality is human.",
  checks: [
    ...(st.cues ? st.walks.map((w) => check(`12 ${w.label}`, PROJECTS, (p) => {
      const j = cues(p, w); if (!j) return;
      const gap = j.gaps?.signsAndJunctions?.maxGapM;
      const lim = j.thresholds?.maxGapM ?? CUE_GAP_M;
      const bad = [];
      if (!(gap <= lim)) bad.push(`max gap ${num(gap, 1)} m > ${lim}`);
      if (!((j.instructionsSeenInHud?.length ?? 0) >= SEEN_MIN)) bad.push("fewer than 2 instructions");
      if (!j.flowOnly && !(j.progress?.reachedM >= 0.9 * (j.route?.horizontalLengthM ?? Infinity))) bad.push("leg not covered");
      const runs = j.stagnantRuns ?? [];
      return { ok: !bad.length, text: bad.length ? bad.join(", ") : `max gap ${num(gap, 1)} m (${j.gaps?.signsAndJunctions?.from} -> ${j.gaps?.signsAndJunctions?.to}), front-facing ${num(j.gaps?.frontFacingOnly?.maxGapM, 1)} m, ${runs.length} stagnant run(s)${runs.length ? ` (longest ${num(maxOf(runs.map((r) => r.spanM)), 0)} m)` : ""}, ${j.sources?.signsOnRoute ?? "?"} signs/${j.sources?.junctionsOnRoute ?? "?"} junctions/${j.sources?.fencesOnRoute ?? "?"} fences${j.flowOnly ? " [flow-only]" : ""}` };
    })) : []),
    ...(st.cues ? st.walks.map(spec03) : []),
  ],
  info: () => (st.cues ? [] : st.walks.map((w) => `03 ${w.label} HUD instructions seen: ${ran.map((p) => `${SHORT[p]} ${ev(p, walkFile(w))?.instructionsSeenInHud?.length ?? "n/a"}`).join("; ")}`)),
  verdict: st.cues ? undefined : () => "needs eyes (no automated rule for this station)",
  humanText: "Reviewer judgement: are consecutive frames distinguishable (no two interchangeable)? Do signs, junctions and the HUD tell the walker where to turn, and do cues come from documented references only (facts-only, no copied operator graphics)?",
  groups: eyes("cues", "walk", "video"),
});

row({
  id: "C4", criterion: "Materials and light",
  rule: "13: worst near-black frame per walk <= 0.10 (#49). 11: overview near-black <= 0.30 and mean luminance 40-200 of 255. 03 near-black max is listed" + (station === "shinjuku" ? " and judged <= 0.10 (B2)." : ", not judged for this station.") + " 10 RMSE is relative evidence, never a gate.",
  checks: [
    ...st.walks.map((w) => check(`13 ${w.label}`, PROJECTS, (p) => {
      const j = cam(p, w); if (!j) return;
      const nb = j.result?.worstNearBlack?.nearBlack;
      if (typeof nb !== "number") return { ok: "gap", text: "no screenshots (flow-only?)" };
      const lim = j.thresholds?.nearBlackMax ?? NEAR_BLACK_WALK;
      return { ok: nb <= lim, text: `worst near-black ${num(nb, 3)}` };
    })),
    check("11 overview", PROJECTS, (p) => {
      const j = ev(p, `${station}-overview.json`); if (!j?.stats) return;
      const bad = [];
      if (j.stats.nearBlack > NEAR_BLACK_OVERVIEW) bad.push("near-black high");
      if (j.stats.mean < LUMA.min || j.stats.mean > LUMA.max) bad.push("luminance out of range");
      return { ok: !bad.length, text: bad.length ? bad.join(", ") : `near-black ${num(j.stats.nearBlack, 3)}, mean ${num(j.stats.mean, 0)}/255` };
    }),
    ...(station === "shinjuku" ? st.walks.map((w) => check(`03 near-black ${w.label}`, PROJECTS, (p) => {
      const nb = nearBlack03(w, p); if (nb === undefined) return;
      return { ok: nb <= NEAR_BLACK_WALK, text: num(nb, 3) };
    })) : []),
  ],
  info: () => [
    ...(station === "ikebukuro" ? st.walks.map((w) => `03 near-black max ${w.label}: ${ran.map((p) => `${SHORT[p]} ${num(nearBlack03(w, p), 3)}`).join("; ")}`) : []),
    `10 look-compare RMSE: ${ran.map((p) => { const j = ev(p, "look-compare.json"); return `${SHORT[p]} ${j?.cases?.length ? j.cases.map((c) => `${c.scene}/${c.tier} ${c.rmse === null ? "n/a" : num(c.rmse, 3)}`).join(", ") : "n/a (not run)"}`; }).join("; ")}`,
  ],
  humanText: "Reviewer judgement: are materials and lighting believable and station-specific? Look for black voids, blown highlights, flat or repeated surfaces, light that matches the space. The 10 side-by-sides compare against Lane E renders, not against the station.",
  groups: eyes("walk", "camera", "overview", "look"),
});

row({
  id: "C5", criterion: "Movement and interaction feedback",
  rule: "03/13: guide ends within 2 m of the destination with the arrival toast. 13: camera held at the minimum-distance clamp <= 1.25 s continuously; lens ease: no FOV change > 5 deg between consecutive frames, final FOV within 0.5 deg of the source's declared value (Overview snaps by design, recorded). Crowded frames (camera-to-head < 1.0 m, #70) are recorded only.",
  checks: [
    ...st.walks.map((w) => check(`13 ${w.label}`, PROJECTS, (p) => {
      const j = cam(p, w); if (!j) return;
      const r = j.result ?? {};
      const bad = [];
      if (!j.flowOnly && j.arrived !== true) bad.push("no arrival");
      const lim = j.thresholds?.clampRunMaxMs ?? CLAMP_RUN_MS;
      if (!(r.longestAtClampRunMs <= lim)) bad.push(`clamp run ${num(r.longestAtClampRunMs, 0)} ms`);
      return { ok: !bad.length, text: bad.length ? bad.join(", ") : `clamp run ${num(r.longestAtClampRunMs, 0)} ms, at clamp ${num(r.fractionAtClamp, 3)}, crowded ${r.crowdedSamples ?? "?"} (${num(r.fractionCrowded, 3)}), min head ${num(r.minHeadDistance, 2)} m, avatar ${num(r.avatarHeightShareMedian, 2)} of height` };
    })),
    check("13 lens ease", PROJECTS, (p) => {
      const j = ev(p, `${station}-camera-fov-ease.json`); if (!j?.events) return;
      const jump = j.thresholds?.fovJumpMaxDeg ?? FOV_JUMP_DEG, tol = j.thresholds?.fovToleranceDeg ?? FOV_TOL_DEG;
      const bad = j.events.filter((e) => e.startFov !== null && e.endFov !== null && ((e.kind === "ease" && (e.maxStepDeg ?? 0) > jump) || (e.expectedFov !== null && e.expectedFov !== undefined && Math.abs(e.endFov - e.expectedFov) > tol)));
      return { ok: !bad.length, text: bad.length ? bad.map((e) => e.event).join(", ") : `${j.events.length} events, max step ${num(maxOf(j.events.filter((e) => e.kind === "ease").map((e) => e.maxStepDeg)), 2)} deg` };
    }),
    ...st.walks.map(spec03),
  ],
  humanText: "Reviewer judgement from the recordings: does the follow camera behave on stairs, escalators and corners (no crowding, snapping or clipping)? Is walking, arrival and mode switching satisfying? Check the frames flagged crowded or at-clamp.",
  groups: eyes("video", "camera", "walk"),
});

row({
  id: "C6", criterion: "Readable interface",
  rule: "01 and 11: no POI label painted over UI controls. 11: zero overlaps among visible, non-faded labels.",
  checks: [
    check("01 labels over UI", PROJECTS, (p) => {
      const j = smoke(p); if (!j?.overlaps) return;
      const n = (j.overlaps.uiOverlaps ?? []).filter((o) => o.labelOnTop).length;
      return { ok: n === 0, text: n ? `${n} label(s) on top of UI` : `none (${j.overlaps.visibleLabels ?? "?"} labels visible)` };
    }),
    check("11 label overlaps", PROJECTS, (p) => {
      const j = ev(p, `${station}-overview.json`); if (!j?.labels) return;
      const n = (j.labels.overlapsReadable ?? []).length, ui = (j.labels.uiOverlaps ?? []).filter((o) => o.labelOnTop).length;
      return { ok: n === 0 && ui === 0, text: `${n} label overlap(s), ${ui} over UI, ${j.labels.visibleCount ?? "?"} visible` };
    }),
  ],
  humanText: "Reviewer judgement, phone frames especially: is the HUD, route card and search text legible at 393x852 and 412x915, touch targets reachable, labels not cluttering the view? Is the coverage and freshness statement honest and visible?",
  groups: eyes("ui", "overview", "walk"),
});

row({
  id: "U1", criterion: "Freshness notice on the route card (stale source)",
  rule: "The core marks a route stale when a source is older than staleAfterDays (730 by default); Ikebukuro's 2022 guide is past it today. 02's search-UI test saves `<station>-search-ui.json` { stale, staleBadge }: when stale is true the card must show the 'Possibly outdated' badge. Older evidence without that file falls back to 02's per-scenario route.stale, with the card half n/a.",
  checks: [],
  info: () => {
    const lines = ran.map((p) => {
      const ui = ev(p, `${station}-search-ui.json`);
      if (ui) return `${SHORT[p]} stale ${ui.stale}, badge ${ui.staleBadge ? "shown" : "not shown"}`;
      const j = ev(p, `${station}-navigation.json`);
      if (!j) return `${SHORT[p]} ${NOT_RUN}`;
      const ok = Object.values(j).filter((s) => s?.result?.ok);
      return `${SHORT[p]} route.stale true on ${ok.filter((s) => s.result.stale === true).length}/${ok.length} routed scenarios (card not captured)`;
    });
    return [`02: ${lines.join("; ")}`];
  },
  verdict: () => {
    const ui = ran.map((p) => ev(p, `${station}-search-ui.json`)).filter(Boolean);
    if (ui.length) {
      if (ui.some((u) => u.stale === true && !u.staleBadge)) return "FAIL (stale route without the card notice)";
      return ui.some((u) => u.stale === true) ? "PASS (stale route shows the notice)" : "info (route not stale; no notice expected)";
    }
    const any = ran.map((p) => ev(p, `${station}-navigation.json`)).filter(Boolean);
    if (!any.length) return NOT_RUN;
    const stale = any.some((j) => Object.values(j).some((s) => s?.result?.ok && s.result.stale === true));
    return stale ? "GAP (route.stale is true; card notice not captured in this evidence)" : "info (route.stale not true in this evidence; no notice expected)";
  },
  humanText: "Open the route-card frame: with a stale route the card must show the 'Possibly outdated' (ja: 情報が古い可能性) badge near the freshness line, and the coverage dialog must state the source date. Reviewer judgement.",
  groups: eyes("ui"),
});

row({
  id: "C7", criterion: "Sound",
  rule: "No spec records audio and Playwright recordings are silent. No automated verdict. Needs a live session with sound on, and only counts where the audio is appropriately licensed.",
  checks: [],
  verdict: () => "needs ears (not captured by the harness)",
  humanText: "Reviewer judgement in a live desktop and phone session with sound on: is there credible environmental sound, a working mute, no clipping or looping artefacts? State if no audio asset was present.",
  groups: [],
});

row({
  id: "C8", criterion: "Desktop and phone checks (judgement)",
  rule: "Automated coverage is row E3. This row is the reviewer's call on how the phone captures compare with desktop.",
  checks: [], verdict: () => "needs eyes (see E3)",
  humanText: "Reviewer judgement: compare the desktop and phone sheets of the same walk. Does the phone tier keep the look, the labels and the HUD readable? Phones here are emulated, not physical devices.",
  groups: eyes("walk", "overview", "ui"),
});

row({
  id: "C9", criterion: "Rendering and performance issues (judgement)",
  rule: "The measurements are row E4. This row is the reviewer's list of visible rendering defects.",
  checks: [], verdict: () => "needs eyes (see E4)",
  humanText: "Reviewer judgement: list visible defects (z-fighting, popping, black voids, flicker, missing geometry) with the frame they appear in, separately from deliberate simplifications.",
  groups: eyes("walk", "camera", "video"),
});

// ---- Required observed L2 evidence -----------------------------------------------------------------
row({
  id: "E1", criterion: "Evidence 1: walkthrough from an in-scene landmark to the destination, with turning and wayfinding",
  rule: "03: arrived, within 2 m of the destination, several HUD instructions. 13: arrival on the follow-camera walks." + (st.cues ? " 12: the sampled walk covers >= 90 % of the leg." : ""),
  checks: [
    ...st.walks.map(spec03),
    ...st.walks.map((w) => check(`13 arrival ${w.label}`, PROJECTS, (p) => {
      const j = cam(p, w); if (!j) return;
      if (j.flowOnly) return { ok: "gap", text: "flow-only run" };
      return { ok: j.arrived === true && j.distToGoal < ARRIVE_M, text: `${j.arrived ? "arrived" : "no arrival"}, ${num(j.distToGoal, 1)} m` };
    })),
  ],
  humanText: `Watch both recordings end to end (${st.walks.map((w) => `${w.label}: ${w.text}`).join("; ")}): does the walker start at a recognisable landmark, turn where the instructions say, and finish at the destination?`,
  groups: eyes("video", "walk"),
});

row({
  id: "E2", criterion: "Evidence 2: independent side-by-side review of reference-grounded features, and the list of deliberate simplifications",
  rule: "Human only. References are facts-only (operator graphics are reference-only and never shipped).",
  checks: [], verdict: () => "needs eyes",
  humanText: `Reviewer, who did not write the code: place the frames next to the station's references and list each distinctive feature as matched, simplified or defective. Simplification list: ${st.simplifications}. Landmark list: ${st.pois}${st.signage ? `, ${st.signage}` : ""}.`,
  groups: eyes("walk", "overview", "ref"),
});

row({
  id: "E3", criterion: "Evidence 3: desktop and phone interaction and visual checks",
  rule: "Coverage: which projects produced which suites. Phones are Playwright emulation (iPhone 15 WebKit, Pixel 7 Chromium). Physical-device checks stay a GAP (protocol.md).",
  checks: [],
  info: () => {
    const suites = [["01", (p) => smoke(p)], ["03", (p) => ev(p, walkFile(st.walks[0]))], ["05", (p) => ev(p, `${station}-perf.json`)], ["09", (p) => ev(p, `${station}-label-fade.json`)], ["11", (p) => ev(p, `${station}-overview.json`)], ["12", (p) => (st.cues ? cues(p, st.walks[0]) : null)], ["13", (p) => cam(p, st.walks[0])]];
    return PROJECTS.map((p) => `${SHORT[p]}: ${ran.includes(p) ? suites.filter(([, f]) => f(p)).map(([n]) => n).join(" ") || "no suite output" : "not run"}`);
  },
  verdict: () => {
    const miss = PROJECTS.filter((p) => !ran.includes(p));
    if (!ran.length) return NOT_RUN;
    if (!ran.includes("desktop-chromium") || !ran.some((p) => p.startsWith("phone"))) return `GAP (missing: ${miss.join(", ")})`;
    return "GAP (emulated phones only; no physical device)";
  },
  humanText: "Reviewer judgement: both desktop and phone captures were looked at, and any physical-device check is recorded separately.",
  groups: eyes("walk", "ui", "overview"),
});

row({
  id: "E4", criterion: "Evidence 4: rendering and performance issues, and actual device and browser measurements",
  rule: "05: the WebGL renderer is a GPU (a SwiftShader, llvmpipe or Software renderer invalidates every number), frames > 0, zero-draw frames < half. fps, frame ms and draw calls are recorded without a threshold (acceptance forbids ungrounded ones). Compare runs with each other; the Shinjuku B-checks (b-checks.md) carry #61's own limits.",
  checks: [
    check("05 perf", PROJECTS, (p) => {
      const j = ev(p, `${station}-perf.json`); if (!j?.overview) return;
      const o = j.overview, renderer = String(o.gl?.renderer ?? "?").replace(/^ANGLE \(|\)$/g, "");
      const soft = o.gpuValid === false || /SwiftShader|llvmpipe|Software/i.test(renderer);
      const bad = [];
      if (soft) bad.push("software WebGL: invalid");
      if (!(o.frames > 0)) bad.push("no frames");
      if (!(o.zeroDrawFrames < o.frames / 2)) bad.push("product drew nothing");
      const w = j.walk ?? {}, g = j.guide ?? {};
      return { ok: soft ? "gap" : !bad.length, text: soft ? `INVALID (${renderer})` : `${renderer}; overview ${num(o.fps, 1)} fps ${o.drawCallsMax} dc, guide ${num(g.fps, 1)} fps ${g.drawCallsMax ?? "?"} dc, walk ${num(w.fps, 1)} fps (p95 ${num(w.frameMsP95, 1)} ms) ${w.drawCallsMax ?? "?"} dc${bad.length && !soft ? `; ${bad.join(", ")}` : ""}` };
    }),
  ],
  info: () => [
    `Browser: ${manifest?.chromiumProjectsBrowser?.trim() ?? "n/a (no manifest)"}; host ${manifest?.host ?? "n/a"}`,
    ...(station === "shinjuku" ? [`B-checks (B4 overview draw calls, phone speed): ${fs.existsSync(path.join(parent, "b-checks.md")) ? rel(path.join(parent, "b-checks.md")) : "n/a (b-checks.md not found)"}`] : []),
  ],
  humanText: "Reviewer: list rendering and performance issues seen in the recordings, tied to the measurements; note which device and browser the numbers come from.",
  groups: eyes("video"),
});

// ---- Evaluate rows ---------------------------------------------------------------------------------
for (const r of rows) {
  r.auto = [...r.checks.map(lineOf), ...(r.info ? r.info() : [])];
  r.verdict = r.verdict ? r.verdict() : verdictOf(r.checks);
  r.groups = [...new Set(r.groups)];
}

// ---- Output ----------------------------------------------------------------------------------------
const byId = new Map(groups.map((g) => [g.id, g]));
const groupRef = (id) => { const g = byId.get(id); return `[${id}](#${id.replace(/[^\w-]/g, "").toLowerCase()}) (${g.files.length})${g.sheet ? ` [sheet](${g.sheet})` : ""}`; };
const md = [];
md.push(`# L2 review pack: ${st.name}`);
md.push("");
md.push("Automated rows carry values and the rule verdict from the specs. Human rows are **needs eyes**: the pack never says PASS for them and does not accept anything; the Owner's judgement is the L2 call. Rules and the review procedure: docs/qa/l2-acceptance.md.");
md.push("");
if (manifest) md.push(`Candidate \`${String(manifest.candidateSha).slice(0, 7)}\` (${manifest.candidateDirtyFiles} dirty), harness \`${String(manifest.harnessSha).slice(0, 7)}\` (${manifest.harnessDirtyFiles} dirty), ${manifest.chromiumProjectsBrowser?.trim()}, ${manifest.playwright}, ${manifest.host}, ${manifest.date}. Typecheck ${manifest.typecheck}, unit ${manifest.unitTests}, lockfile ${manifest.lockfile}.`);
else md.push("**No manifest.json next to the evidence directory: this evidence is not tied to an exact candidate.**");
md.push("");
md.push(`Projects with evidence: ${ran.length ? ran.join(", ") : "none"}. Walks: ${st.walks.map((w) => `\`${w.label}\` (${w.text})`).join(", ")}.`);
const warn = [];
const soft = ran.filter((p) => { const o = ev(p, `${station}-perf.json`)?.overview; return o && (o.gpuValid === false || /SwiftShader|llvmpipe|Software/i.test(String(o.gl?.renderer ?? ""))); });
if (soft.length) warn.push(`Software WebGL (SwiftShader/llvmpipe) on ${soft.join(", ")}: performance and visual numbers from those projects are invalid.`);
const flow = ran.filter((p) => st.walks.some((w) => { const j = ev(p, walkFile(w)); return j && (j.frames ?? []).every((f) => !f.stats); }));
if (flow.length) warn.push(`Flow-only walk (no frames) on ${flow.join(", ")}: not visual evidence.`);
const shaOf = ran.flatMap((p) => st.walks.map((w) => cam(p, w)?.candidate?.sha).filter(Boolean));
if (manifest && shaOf.some((s) => s !== manifest.candidateSha)) warn.push("A 13 file records a different candidate SHA than manifest.json: the evidence is mixed.");
for (const w of warn) md.push(`\n> **Warning:** ${w}`);
md.push("");
md.push("| ID | Criterion | Automated evidence (rule) | Rule verdict | Human: needs eyes | Reviewer verdict / notes |");
md.push("|---|---|---|---|---|---|");
for (const r of rows) {
  const auto = [`*${r.rule}*`, ...r.auto].map(cell).join("<br>");
  const human = [r.humanText, r.groups.length ? `Files: ${r.groups.map(groupRef).join(", ")}` : "Files: n/a (no frames in this evidence)"].map(cell).join("<br>");
  md.push(`| ${r.id} | ${cell(r.criterion)} | ${auto} | ${cell(r.verdict)} | ${human} | |`);
}
md.push("");
md.push("Verdict vocabulary: PASS / GAP / FAIL come from the automated rule only; `n/a (not run)` means the evidence is missing; `needs eyes` / `needs ears` mean a human must judge. The reviewer column stays empty until a reviewer fills it.");
md.push("");
md.push("## Station sources");
md.push("");
md.push(`- Landmark list: \`${st.pois}\`${st.signage ? `, signs in \`${st.signage}\`` : ""}.`);
md.push(`- Deliberate simplifications and coverage gaps: ${st.simplifications}.`);
md.push(`- References: ${st.references ? `\`${st.references}\` (facts-only stills committed with the station)` : "none committed; the reviewer brings their own facts-only sources"}. Operator graphics are reference-only and never shipped.`);
const poiFile = candidate && path.join(candidate, st.pois);
const poiJson = poiFile && readJson(poiFile);
const poiList = poiJson && (Array.isArray(poiJson) ? poiJson : poiJson.pois);
let poiCounts = null;
if (poiList) {
  poiCounts = {};
  for (const p of poiList) poiCounts[p.category ?? "?"] = (poiCounts[p.category ?? "?"] ?? 0) + 1;
  md.push(`- Candidate POIs by category (${poiList.length}): ${Object.entries(poiCounts).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
}
md.push("");

// Measurements (appendix): one compact table per spec.
const meas = {};
const table = (title, head, rowsIn) => {
  if (!rowsIn.length) return;
  md.push(`### ${title}`); md.push("");
  md.push(`| ${head.join(" | ")} |`); md.push(`|${head.map(() => "---").join("|")}|`);
  for (const r of rowsIn) md.push(`| ${r.map(cell).join(" | ")} |`);
  md.push("");
};
md.push("## Measurements");
md.push("");
const m03 = [], m05 = [], m09 = [], m11 = [], m12 = [], m13 = [], m10 = [];
for (const p of ran) {
  for (const w of st.walks) {
    const j = ev(p, walkFile(w));
    if (j) m03.push([SHORT[p], w.label, String(j.arrived), num(j.distToGoal, 1), String(j.instructionsSeenInHud?.length ?? "n/a"), j.guideTier ?? "n/a", num(nearBlack03(w, p), 3), num(maxOf((j.frames ?? []).map((f) => f.stats?.clippedWhite)), 3), `${num(j.perf?.fps, 1)} fps / ${j.perf?.drawCallsMax ?? "n/a"} dc`]);
    const c = cam(p, w);
    if (c) m13.push([SHORT[p], w.label, num(c.result?.worstNearBlack?.nearBlack, 3), num(c.result?.fractionAtClamp, 3), num(c.result?.longestAtClampRunMs, 0), String(c.result?.crowdedSamples ?? "n/a"), num(c.result?.minHeadDistance, 2), num(c.result?.fovVMedian, 1), String(c.arrived)]);
    const k = st.cues && cues(p, w);
    if (k) m12.push([SHORT[p], w.label, num(k.gaps?.signsAndJunctions?.maxGapM, 1), num(k.gaps?.withFences?.maxGapM, 1), num(k.gaps?.frontFacingOnly?.maxGapM, 1), String((k.stagnantRuns ?? []).length), String(k.consecutiveSamplesWithIdenticalKey ?? "n/a"), `${num(k.progress?.reachedM, 0)}/${num(k.route?.horizontalLengthM, 0)} m`, String(k.flowOnly ?? false)]);
  }
  const f = ev(p, `${station}-perf.json`);
  if (f) for (const ph of ["overview", "guide", "walk"]) if (f[ph]) m05.push([SHORT[p], ph, num(f[ph].fps, 1), num(f[ph].frameMsP95, 1), num(f[ph].frameMsMax, 1), String(f[ph].drawCallsMax ?? "n/a"), String(f[ph].jsHeapMB ?? "n/a"), String(f[ph].gl?.renderer ?? "?").replace(/^ANGLE \(|\)$/g, ""), f[ph].gpuValid === false ? "INVALID" : "ok"]);
  const l = ev(p, `${station}-label-fade.json`);
  if (l) m09.push([SHORT[p], String(l.totalPoses), String(l.posesWithVisibleLabels), String(l.totalShown), String(l.totalFaded), String(l.totalOffFloor ?? "n/a")]);
  const o = ev(p, `${station}-overview.json`);
  if (o) m11.push([SHORT[p], String(o.mode), num(o.stats?.nearBlack, 3), num(o.stats?.mean, 0), num(o.framing?.routable?.spread, 2), `${o.labels?.visibleCount ?? "n/a"}/${o.labels?.domCount ?? "n/a"}`, String((o.labels?.overlapsReadable ?? []).length), `${o.exits?.visible?.length ?? "n/a"}/${o.exits?.inDom ?? "n/a"}`, o.exits?.reach ? String(o.exits.reach.shownAfterSelect) : "n/a"]);
  const lc = ev(p, "look-compare.json");
  for (const c of lc?.cases ?? []) m10.push([SHORT[p], c.scene, c.tier, c.rmse === null ? "n/a" : num(c.rmse, 3), String(c.drawCalls ?? "n/a"), num(c.frameMs, 1)]);
}
table("03 guided walk", ["project", "walk", "arrived", "m to goal", "HUD instr.", "tier", "near-black max", "clipped-white max", "walk perf"], m03);
table("05 performance (recorded, no threshold)", ["project", "phase", "fps", "frame ms p95", "frame ms max", "draw calls max", "heap MB", "renderer", "validity"], m05);
table("09 label fade", ["project", "poses", "poses with labels", "shown", "faded", "off-floor"], m09);
table("11 overview", ["project", "mode", "near-black", "mean /255", "routable spread", "labels visible/DOM", "overlaps", "exits on screen/DOM", "hidden exit reachable"], m11);
table("12 wayfinding cues (Ikebukuro)", ["project", "walk", "max gap m (signs+junctions)", "with fences", "front-facing only", "stagnant runs", "identical consecutive samples", "reached/leg", "flow-only"], m12);
table("13 follow camera", ["project", "walk", "worst near-black", "fraction at clamp", "longest clamp run ms", "crowded samples", "min head dist m", "FOV v median", "arrived"], m13);
table("10 look compare (relative evidence, not a gate)", ["project", "scene", "tier", "RMSE", "draw calls", "frame ms"], m10);
Object.assign(meas, { "03": m03, "05": m05, "09": m09, "11": m11, "12": m12, "13": m13, "10": m10 });

md.push("## Files to look at");
md.push("");
if (!ffmpeg) md.push(noSheets ? "_Contact sheets skipped (--no-sheets): frames are listed._\n" : "_ffmpeg not found: no contact sheets, frames are listed._\n");
for (const g of groups) {
  md.push(`### ${g.id}`); md.push("");
  md.push(`${g.title}${g.sheet ? ` Sheet: [${g.sheet}](${g.sheet}).` : ""}${g.sheetError ? ` Sheet failed: ${g.sheetError}` : ""}`);
  md.push("");
  for (const f of g.files) md.push(`- [${path.basename(f)}](${f})`);
  md.push("");
}
md.push("## Reviewer sign-off");
md.push("");
md.push("Reviewer (Owner, or a labelled fresh read-only Claude subagent that did not write the code): ______  Model and effort (only if a model actually ran): ______  Date: ______");
md.push("");
md.push("Simplifications (deliberate, listed in the station record) versus defects (not listed): ______");
md.push("");
md.push("Not covered by this pack: physical phones, Godot, sound (no audio is recorded), any frame not listed above. The Owner's judgement is the L2 call.");

fs.writeFileSync(path.join(out, "l2-review.md"), md.join("\n") + "\n");
if (manifest) fs.copyFileSync(path.join(parent, "manifest.json"), path.join(out, "manifest.json"));
fs.writeFileSync(path.join(out, "l2-pack.json"), JSON.stringify({
  station, evidenceDir: evidence, candidate: candidate ?? null, projects: ran, manifest: manifest ?? null, warnings: warn,
  rows: rows.map(({ id, criterion, rule, auto, verdict, humanText, groups: g }) => ({ id, criterion, rule, auto, verdict, human: { text: humanText, groups: g }, reviewer: "" })),
  groups, measurements: meas, poiCounts,
}, null, 2) + "\n");
console.log(`${path.join(out, "l2-review.md")} (${rows.length} rows, ${groups.length} file groups, ${ran.length} project(s) with evidence)`);
