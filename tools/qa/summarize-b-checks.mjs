#!/usr/bin/env node
// Lane F: summarize the Shinjuku B-checks (B1-B8, C3, phone speed) from a harness evidence directory.
//
// usage: node tools/qa/summarize-b-checks.mjs <evidence-dir> [--candidate <dir>] [--json <file>|-]
//   <evidence-dir>  tests/e2e/artifacts/evidence (holds <project>/*.json); manifest.json is read from its parent.
//                   Step-probe JSON (08) is also read from <evidence-dir>/../probes/** when that exists.
//   --candidate     the candidate checkout (run-candidate.sh: <workdir>/candidate); enables the B5 check
//                   against stations/shinjuku/gteki/pois.json.
//   --json          where to write the table as JSON (default <evidence-dir>/../b-checks.json; "-" = none).
//
// Plain Node ESM, no dependencies, reads only small JSON. Prints a markdown table to stdout.
// A verdict is printed only when the evidence for it exists: PASS / GAP / FAIL, "needs eyes" for what
// a script cannot judge, and "n/a (...)" when the evidence is missing. Rules come from
// docs/qa/reports/2026-10-21-lane-f-first-pass.md (section 0 and 4.3) and the asserts in tests/e2e/specs.
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv.splice(i, 2)[1]; };
const candidate = flag("--candidate");
const jsonOpt = flag("--json");
const evDir = argv[0];
if (!evDir || argv.length !== 1) { console.error("usage: summarize-b-checks.mjs <evidence-dir> [--candidate <dir>] [--json <file>|-]"); process.exit(2); }
const evidence = path.resolve(evDir);
const parent = path.dirname(evidence);

// ---- Rules (one place) ---------------------------------------------------------------------------
const PROJECTS = ["desktop-chromium", "phone-webkit", "phone-chromium"];
const NEAR_BLACK_MAX = 0.10;            // B2: per frame, explorer walks (PR #61 gate, report 0)
const DRAW_CALLS_B511263 = { "desktop-chromium": 279, "phone-webkit": 127, "phone-chromium": 127 }; // B4: no regression past these
const DRAW_CALLS_MAIN = { "desktop-chromium": 913, "phone-webkit": 314, "phone-chromium": 314 };     // main c2b5a9b
const PROBE_MISS_MAX_M = 1;             // 08 asserts: steps ending > 1 m short
const PROBE_DZ_MAX_M = 0.6;             // 08 asserts: |dz| > 0.6 m off the display height
const MAX_OFF_NETWORK_M = 15;           // 04 wall probe: within 15 m of a walkable edge ...
const WALL_RUN_MAX_M = 95;              // ... and < 95 m run, inside scene bounds, or inside a mapped unrestricted space
const FPS_FLAG = 55;                    // phone speed: flag below this
const S1 = { from: "poi:exit:1", to: "poi:platform:oedo" };   // Exit 1 -> Oedo platform (B3 switchback)
const S2 = { from: "poi:platform:oedo", to: "poi:exit:2" };   // platform -> Exit 2 (B7 second surface)

// ---- Loading -------------------------------------------------------------------------------------
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return undefined; } };
const ev = (project, name) => readJson(path.join(evidence, project, name));
const round = (x, d = 3) => (typeof x === "number" ? Math.round(x * 10 ** d) / 10 ** d : x);
const fmt = (x, d = 3) => (x === undefined || x === null ? "n/a" : String(round(x, d)));
const NOT_RUN = "n/a (not run)";
const manifest = readJson(path.join(parent, "manifest.json"));

function walkRecursive(dir, test, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkRecursive(p, test, out); else if (test(e.name)) out.push(p);
  }
  return out;
}

const WALKS = [
  { label: "exit1-platform", file: "shinjuku-walk-exit1-platform.json" },
  { label: "platform-exit2", file: "shinjuku-walk-platform-exit2.json" },
];

// Per-project rows: each check returns { values: {project: string}, verdict, reasons[], data }.
const rows = [];
const add = (r) => { rows.push(r); return r; };
const perProject = (projects, f) => Object.fromEntries(projects.map((p) => [p, f(p)]));
const dash = (projects) => Object.fromEntries(PROJECTS.map((p) => [p, projects.includes(p) ? undefined : "-"]));
function row({ item, metric, projects = PROJECTS, rule, values, verdict, note }) {
  return add({ item, metric, rule, values: { ...dash(projects), ...values }, verdict, note });
}
const missing = (projects, have) => projects.filter((p) => !have(p));

// ---- Collect -------------------------------------------------------------------------------------
const walks = perProject(PROJECTS, (p) => WALKS.map((w) => ({ ...w, json: ev(p, w.file) })));
const perf = perProject(PROJECTS, (p) => ev(p, "shinjuku-perf.json"));
const smoke = perProject(PROJECTS, (p) => ev(p, "shinjuku-smoke.json"));
const nav = ev("desktop-chromium", "shinjuku-navigation.json");
const wall = ev("desktop-chromium", "shinjuku-wall-probe.json");
const labelFade = ev("desktop-chromium", "shinjuku-label-fade.json");

// Probes (08): old name shinjuku-step-probe.json or per-probe shinjuku-step-probe-<slug>.json; also ../probes/**.
const probeFiles = [
  ...walkRecursive(path.join(evidence, "desktop-chromium"), (n) => /^shinjuku-step-probe.*\.json$/.test(n)),
  ...walkRecursive(path.join(parent, "probes"), (n) => /^shinjuku-step-probe.*\.json$/.test(n)),
];
const probes = probeFiles.map(readJson).filter((j) => j && Array.isArray(j.results));
const probeFor = (x) => probes.find((j) => j.from === x.from && j.to === x.to);

// ---- B1 / C3: camera (needs eyes) ----------------------------------------------------------------
const frameList = (p, w, last) => {
  const n = w.json?.frames?.length ?? 0;
  const idx = last ? [...Array(Math.min(last, n)).keys()].map((i) => n - Math.min(last, n) + i) : [...Array(n).keys()];
  return idx.map((i) => `${p}/shinjuku-walk-${w.label}-${String(i).padStart(2, "0")}.png`).filter((f) => fs.existsSync(path.join(evidence, f)));
};
function cameraRow(item, metric, walkLabel, last, rule) {
  const values = perProject(PROJECTS, (p) => {
    const w = walks[p].find((x) => x.label === walkLabel);
    if (!w.json) return NOT_RUN;
    const blockers = smoke[p]?.info?.cameraBlockers;
    const frames = w.json.frames.length;
    return `${last ? `last ${Math.min(last, frames)} of ` : ""}${frames} frames, arrived ${w.json.arrived}, cameraBlockers ${blockers ?? "n/a"}`;
  });
  const have = PROJECTS.filter((p) => values[p] !== NOT_RUN);
  const human = have.flatMap((p) => frameList(p, walks[p].find((x) => x.label === walkLabel), last));
  row({ item, metric, rule, values, verdict: have.length ? "needs eyes" : NOT_RUN, note: have.length ? { frames: human } : undefined });
}
cameraRow("B1 camera above slabs", "exit1-platform walk: frames; sceneInfo cameraBlockers (01)", "exit1-platform", 0,
  "Not automatable. Every frame must be an interior view under a lit ceiling, not above the slab");
cameraRow("C3 camera crowds avatar (#70)", "platform-exit2 walk, last 4 frames; sceneInfo cameraBlockers (01)", "platform-exit2", 4,
  "Not automatable. Avatar at most ~1/6 of the frame on the exit:2 street stair; roof reads as one surface");

// ---- B2: near-black per walk frame ---------------------------------------------------------------
{
  // Both Shinjuku walks must contribute frame statistics: a missing walk (or one without stats) leaves the
  // project undecided rather than letting the other walk alone pass it (#318).
  const walkStats = (w, key) => (w.json?.frames ?? []).map((f) => f.stats?.[key]).filter((x) => typeof x === "number");
  const missingWalks = perProject(PROJECTS, (p) => walks[p].filter((w) => !walkStats(w, "nearBlack").length).map((w) => w.label));
  const stat = (p, key) => {
    if (missingWalks[p].length) return undefined;
    return Math.max(...walks[p].flatMap((w) => walkStats(w, key)));
  };
  const nb = perProject(PROJECTS, (p) => stat(p, "nearBlack"));
  const cw = perProject(PROJECTS, (p) => stat(p, "clippedWhite"));
  const lacking = PROJECTS.filter((p) => nb[p] === undefined).map((p) => `${p}: ${missingWalks[p].join(" + ")}`);
  const over = PROJECTS.filter((p) => nb[p] > NEAR_BLACK_MAX);
  row({
    item: "B2 black voids on descents", metric: "max near-black fraction over Shinjuku walk frames (03)",
    rule: `<= ${NEAR_BLACK_MAX.toFixed(2)} per frame (main: 0.686)`,
    values: perProject(PROJECTS, (p) => (nb[p] === undefined ? NOT_RUN : fmt(nb[p]))),
    verdict: lacking.length ? `n/a (walk evidence missing: ${lacking.join("; ")})` : over.length ? `FAIL (${over.map((p) => `${p} ${fmt(nb[p])}`).join(", ")})` : "PASS",
  });
  row({
    item: "B2 clipped white", metric: "max clipped-white fraction over Shinjuku walk frames (03)", rule: "noted only",
    values: perProject(PROJECTS, (p) => (cw[p] === undefined ? NOT_RUN : fmt(cw[p]))), verdict: "info",
  });
}

// ---- B3 / B7: step probes ------------------------------------------------------------------------
function probeRow(item, metric, target, rule, judge) {
  const j = probeFor(target);
  if (!j) return row({ item, metric, projects: ["desktop-chromium"], rule, values: { "desktop-chromium": NOT_RUN }, verdict: NOT_RUN });
  const walked = j.results.filter((r) => typeof r.missM === "number");
  const lifts = j.results.length - walked.length;
  if (!walked.length) return row({ item, metric, projects: ["desktop-chromium"], rule, values: { "desktop-chromium": "no walked steps" }, verdict: "n/a (probe walked no steps)" });
  const miss = Math.max(...walked.map((r) => r.missM));
  const dz = Math.max(...walked.map((r) => Math.abs(r.dz)));
  const short = walked.filter((r) => r.missM > PROBE_MISS_MAX_M).map((r) => r.s);
  const off = walked.filter((r) => Math.abs(r.dz) > PROBE_DZ_MAX_M).map((r) => r.s);
  const v = judge({ miss, dz, short, off });
  row({
    item, metric, projects: ["desktop-chromium"], rule,
    values: { "desktop-chromium": `miss ${fmt(miss, 2)} m, |dz| ${fmt(dz, 2)} m (${walked.length} steps${lifts ? `, ${lifts} lift skipped` : ""})` },
    verdict: v,
  });
}
probeRow("B3 north switchback", "S1 exit1->platform step probe (08): worst end miss / worst |dz|", S1,
  `every step ends <= ${PROBE_MISS_MAX_M} m from its end and |dz| <= ${PROBE_DZ_MAX_M} m`,
  ({ short, off }) => (short.length || off.length ? `FAIL (steps ${[...new Set([...short, ...off])].join(", ")})` : "PASS"));
probeRow("B7 second walkable surface", "S2 platform->exit2 step probe (08): worst |dz| / worst end miss", S2,
  `every step ends |dz| <= ${PROBE_DZ_MAX_M} m of its display height and <= ${PROBE_MISS_MAX_M} m short`,
  ({ short, off }) => (short.length || off.length ? `FAIL (steps ${[...new Set([...short, ...off])].join(", ")})` : "PASS"));

// ---- B4: overview draw calls ---------------------------------------------------------------------
{
  const dc = perProject(PROJECTS, (p) => perf[p]?.overview?.drawCallsMax);
  const lacking = PROJECTS.filter((p) => dc[p] === undefined);
  const regress = PROJECTS.filter((p) => dc[p] > DRAW_CALLS_B511263[p]);
  const worse = PROJECTS.filter((p) => dc[p] > DRAW_CALLS_MAIN[p]);
  row({
    item: "B4 overview draw calls", metric: "overview max draw calls (05)",
    rule: `no regression past b511263: ${DRAW_CALLS_B511263["desktop-chromium"]} desktop / ${DRAW_CALLS_B511263["phone-webkit"]} phone (main ${DRAW_CALLS_MAIN["desktop-chromium"]} / ${DRAW_CALLS_MAIN["phone-webkit"]})`,
    values: perProject(PROJECTS, (p) => (dc[p] === undefined ? NOT_RUN : String(dc[p]))),
    verdict: lacking.length ? `n/a (walk evidence missing: ${lacking.join("; ")})`
      : worse.length ? `FAIL (above main: ${worse.join(", ")})`
      : regress.length ? `GAP (regressed past b511263: ${regress.map((p) => `${p} ${dc[p]}`).join(", ")})`
      : "PASS",
  });
}

// ---- B5: exit display names ----------------------------------------------------------------------
{
  const rule = "no two exit POIs share an English (or Japanese) display name";
  const poisFile = candidate && path.join(candidate, "stations", "shinjuku", "gteki", "pois.json");
  const pois = poisFile && readJson(poisFile);
  const list = pois && (Array.isArray(pois) ? pois : pois.pois);
  if (list) {
    const dups = [];
    for (const lang of ["en", "ja"]) {
      const byName = new Map();
      for (const p of list.filter((x) => x.category === "exit")) {
        const t = p.names?.find((n) => n.lang === lang)?.text;
        if (t) byName.set(t, [...(byName.get(t) ?? []), p.id]);
      }
      for (const [t, ids] of byName) if (ids.length > 1) dups.push(`${lang} "${t}": ${ids.join(", ")}`);
    }
    const n = list.filter((x) => x.category === "exit").length;
    row({ item: "B5 exit display names", metric: "exit POIs in candidate pois.json: duplicate names", projects: ["desktop-chromium"], rule,
      values: { "desktop-chromium": `${n} exits, ${dups.length} duplicate name(s)` }, verdict: dups.length ? `FAIL (${dups.join("; ")})` : "PASS" });
  } else if (labelFade?.poses) {
    // Fallback: label text from 09. Only a same-text pair inside one pose is visible; never PASS from this.
    const exitTexts = new Set();
    const dupPoses = [];
    for (const pose of labelFade.poses) {
      const seen = new Map();
      for (const l of pose.labels ?? []) if (/^exit/i.test(l.text)) { exitTexts.add(l.text); seen.set(l.text, (seen.get(l.text) ?? 0) + 1); }
      for (const [t, c] of seen) if (c > 1) dupPoses.push(`${pose.route}#${pose.n} "${t}"`);
    }
    row({ item: "B5 exit display names", metric: "exit labels seen in 09 poses (candidate pois.json not given)", projects: ["desktop-chromium"], rule,
      values: { "desktop-chromium": `${exitTexts.size} distinct exit labels, ${dupPoses.length} same-text pair(s) in one pose` },
      verdict: dupPoses.length ? `FAIL (${dupPoses.join("; ")})` : "GAP (labels only; rerun with --candidate <dir> for the pois.json check)" });
  } else {
    row({ item: "B5 exit display names", metric: "candidate pois.json / 09 labels", projects: ["desktop-chromium"], rule, values: { "desktop-chromium": NOT_RUN }, verdict: NOT_RUN });
  }
}

// ---- B6: step-free Exit 1 -> platform ------------------------------------------------------------
{
  const rule = "step-free Exit 1 -> Oedo platform returns ok:false, reason no_path (Exit 1 is stairs-only)";
  const s = nav && Object.values(nav).find((x) => x.profile?.stepFree && x.from === S1.from && x.to === S1.to);
  if (!s) row({ item: "B6 step-free Exit 1 -> platform", metric: "02 navigation summary", projects: ["desktop-chromium"], rule, values: { "desktop-chromium": NOT_RUN }, verdict: NOT_RUN });
  else {
    const r = s.result;
    const value = r.ok ? `ok:true (${fmt(r.lengthM, 1)} m, modes ${(r.modes ?? []).join("/")})` : `ok:false, ${r.reason ?? "no reason"}`;
    row({ item: "B6 step-free Exit 1 -> platform", metric: `02 navigation summary (${s.id})`, projects: ["desktop-chromium"], rule, values: { "desktop-chromium": value },
      verdict: !r.ok && r.reason === "no_path" ? "PASS" : r.ok ? "FAIL (a step-free route was returned)" : `FAIL (refused with ${r.reason ?? "no reason"}, expected no_path)` });
  }
}

// ---- B8: B3 containment (04 wall probe) ----------------------------------------------------------
{
  const rule = `every wall-probe run: moved < ${WALL_RUN_MAX_M} m, inside scene bounds, and < ${MAX_OFF_NETWORK_M} m from a walkable edge or inside a mapped unrestricted space (04's own rule)`;
  if (!Array.isArray(wall) || !wall.length) row({ item: "B8 B3 containment", metric: "04 wall probe", projects: ["desktop-chromium"], rule, values: { "desktop-chromium": NOT_RUN }, verdict: NOT_RUN });
  else {
    // 04 writes an unreachable network distance (Infinity) as null; null < x is true in JS, so check it is finite (#318).
    const nearNet = (r) => typeof r.networkM === "number" && Number.isFinite(r.networkM) && r.networkM < MAX_OFF_NETWORK_M;
    const bad = wall.filter((r) => !(r.moved < WALL_RUN_MAX_M && r.inBounds && (nearNet(r) || r.space)));
    const viaSpace = wall.filter((r) => !nearNet(r) && r.space);
    const stuck = [...new Set(wall.map((r) => r.spawn))].filter((sp) => Math.max(...wall.filter((r) => r.spawn === sp).map((r) => r.moved)) <= 2);
    const far = Math.max(...wall.map((r) => (typeof r.networkM === "number" ? r.networkM : Infinity)));
    row({
      item: "B8 B3 containment", metric: "04 wall probe: runs / contained via mapped space / max distance from network", projects: ["desktop-chromium"], rule,
      values: { "desktop-chromium": `${wall.length} runs, ${viaSpace.length} via mapped space${viaSpace.length ? ` (${viaSpace.map((r) => `${r.space.category}@${r.space.level}`).join(", ")})` : ""}, max ${fmt(far, 1)} m off network` },
      verdict: bad.length ? `FAIL (${bad.map((r) => `${r.spawn.slice(0, 10)} ${r.dir}`).join(", ")})` : stuck.length ? `GAP (control failed: walker did not move from ${stuck.join(", ")})` : "PASS",
    });
  }
}

// ---- Phone speed: Shinjuku walk fps (05) ---------------------------------------------------------
{
  const w = perProject(PROJECTS, (p) => perf[p]?.walk);
  const lacking = PROJECTS.filter((p) => !w[p]);
  const slow = PROJECTS.filter((p) => w[p] && w[p].fps < FPS_FLAG);
  const invalid = PROJECTS.filter((p) => w[p] && perf[p]?.overview?.gpuValid === false);
  row({
    item: "Phone speed (Shinjuku walk)", metric: "walk fps (05), held W", rule: `>= ${FPS_FLAG} fps (b511263: 40.2 on iPhone 15 emulation under load, main 59.4); host must be idle`,
    values: perProject(PROJECTS, (p) => (w[p] ? `${fmt(w[p].fps, 1)} fps` : NOT_RUN)),
    verdict: lacking.length ? `n/a (walk evidence missing: ${lacking.join("; ")})` : invalid.length ? `GAP (software WebGL: ${invalid.join(", ")})`
      : slow.length ? `GAP (below ${FPS_FLAG}: ${slow.map((p) => `${p} ${fmt(w[p].fps, 1)}`).join(", ")}; rerun on an idle host before judging)` : "PASS",
  });
  row({
    item: "Phone speed (Shinjuku walk)", metric: "walk frame ms p95 / max; renderer", rule: "noted only",
    values: perProject(PROJECTS, (p) => (w[p] ? `${fmt(w[p].frameMsP95, 1)} / ${fmt(w[p].frameMsMax, 1)} ms; ${perf[p].overview?.gl?.renderer?.replace(/^ANGLE \(|\)$/g, "") ?? "?"}` : NOT_RUN)),
    verdict: "info",
  });
}

// ---- Output --------------------------------------------------------------------------------------
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const order = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "C3", "Phone"];
const key = (r) => { const i = order.findIndex((o) => r.item.startsWith(o)); return i < 0 ? 99 : i; };
const sorted = rows.map((r, i) => ({ r, i })).sort((a, b) => key(a.r) - key(b.r) || a.i - b.i).map((x) => x.r);

const out = [];
out.push("# Shinjuku B-checks");
out.push("");
if (manifest) {
  out.push(`Candidate \`${String(manifest.candidateSha).slice(0, 7)}\` (${manifest.candidateDirtyFiles} dirty), harness \`${String(manifest.harnessSha).slice(0, 7)}\` (${manifest.harnessDirtyFiles} dirty), ${manifest.chromiumProjectsBrowser?.trim()}, ${manifest.playwright}, ${manifest.host}, ${manifest.date}. Typecheck ${manifest.typecheck}, unit ${manifest.unitTests}, lockfile ${manifest.lockfile}.`);
} else out.push("No manifest.json next to the evidence directory: this evidence is not tied to an exact candidate.");
out.push("");
out.push("| Item | Metric | desktop-chromium | phone-webkit | phone-chromium | Rule | Verdict |");
out.push("|---|---|---|---|---|---|---|");
for (const r of sorted) out.push(`| ${cell(r.item)} | ${cell(r.metric)} | ${PROJECTS.map((p) => cell(r.values[p] ?? NOT_RUN)).join(" | ")} | ${cell(r.rule)} | ${cell(r.verdict)} |`);
out.push("");
out.push("`-` = not run on that project by design (probes, navigation and the wall probe are desktop-only). `needs eyes` = a human must look; the script never guesses. `info` = recorded, not judged.");
const eyes = sorted.filter((r) => r.note?.frames?.length);
if (eyes.length) {
  out.push("");
  out.push("## Needs eyes (frames under the evidence directory)");
  for (const r of eyes) { out.push(""); out.push(`**${r.item}**`); for (const f of r.note.frames) out.push(`- ${f}`); }
}
out.push("");
out.push("Phone fps is valid only from a run on an idle host; a busy host (replay, other sessions) lowers it. This summary produces evidence; it does not accept anything.");
console.log(out.join("\n"));

const jsonPath = jsonOpt === "-" ? undefined : jsonOpt ?? path.join(parent, "b-checks.json");
if (jsonPath) {
  fs.mkdirSync(path.dirname(path.resolve(jsonPath)), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify({ manifest: manifest ?? null, evidenceDir: evidence, rows: sorted.map(({ item, metric, rule, values, verdict, note }) => ({ item, metric, values: Object.fromEntries(PROJECTS.map((p) => [p, values[p] ?? NOT_RUN])), rule, verdict, ...(note ? { note } : {}) })) }, null, 2) + "\n");
}
