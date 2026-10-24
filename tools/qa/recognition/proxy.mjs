// Lane F #342 Q5: "recognition proxy" table from specs/20-recognition captures.
// usage: node tools/qa/recognition/proxy.mjs <out-dir> <project-artifacts-dir>...
//   each <project-artifacts-dir> is a moved tests/e2e/artifacts (evidence/<project>/<station>-recognition.json + rec-*.png)
// OCRs every frame with Apple Vision (ocr.swift, ja + en, on device), keeps only in-world text (lines whose centre
// is outside app UI and POI chips), and per station × project × view reports the #342 proxy:
//   name readable and unobscured ≥3 of 5 s (JA name found in-world, no visible chip over it; readable frames × frame interval);
//   phone JA name ≥18 CSS px and EN ≥12 CSS px (OCR line-box height / devicePixelRatio, an approximation of the
//   rendered size); kana present in-world; chip-over-name frames; equipment cues are left to the reviewer.
// When the build has __gteki.identity() (#342 Q2) its per-frame answer is summarised next to the OCR columns.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [out, ...dirs] = process.argv.slice(2);
if (!out || dirs.length === 0) { console.error("usage: proxy.mjs <out-dir> <artifacts-dir>..."); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(out, { recursive: true });

const NAMES = {
  ikebukuro: { ja: /池袋/, kana: /いけぶくろ|イケブクロ/, en: /ikebukuro/i },
  shinjuku: { ja: /新宿/, kana: /しんじゅく|シンジュク/, en: /shinjuku/i },
};
const KANA = /[ぁ-ゖァ-ヺ]/;
const PHONE = { ja: 18, en: 12 };
const inside = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

const rows = [];
for (const dir of dirs) {
  for (const json of execFileSync("find", [dir, "-name", "*-recognition.json"], { encoding: "utf8" }).split("\n").filter(Boolean)) {
    const run = JSON.parse(fs.readFileSync(json, "utf8"));
    const evDir = path.dirname(json);
    const files = run.frames.map((f) => path.join(evDir, f.file));
    const ocr = JSON.parse(execFileSync("swift", [path.join(here, "ocr.swift"), ...files], { encoding: "utf8", maxBuffer: 64 << 20 }));
    fs.writeFileSync(path.join(out, `ocr-${run.station}-${run.project}.json`), JSON.stringify(ocr, null, 1));
    const dpr = run.fonts?.dpr ?? 1;
    const names = NAMES[run.station];
    const isPhone = run.project.startsWith("phone");
    for (const view of [...new Set(run.frames.map((f) => f.view))]) {
      const fr = run.frames.filter((f) => f.view === view);
      const per = fr.map((f) => {
        const page = ocr[run.frames.indexOf(f)];
        const chips = (f.chips ?? []).filter((c) => !(c.opacity < 0.3));
        const centre = (l) => [l.x + l.w / 2, l.y + l.h / 2];
        const notUi = (page?.lines ?? []).map((l) => ({ ...l, x: l.x / dpr, y: l.y / dpr, w: l.w / dpr, h: l.h / dpr }))
          .filter((l) => !f.ui.some((r) => inside(r, ...centre(l))));
        // A chip's own text (DOM) that happens to contain the name is overlay text, not the in-world name.
        const chipText = (l) => chips.some((c) => inside(c, ...centre(l)) && names.ja.test(c.text ?? "") === names.ja.test(l.text) && (c.text ?? "").includes(l.text.slice(0, 2)));
        const lines = notUi.filter((l) => !chips.some((c) => inside(c, ...centre(l))));
        const ja = lines.filter((l) => names.ja.test(l.text));
        const en = lines.filter((l) => names.en.test(l.text));
        const kanaName = lines.filter((l) => names.kana.test(l.text));
        // Covered: an in-world JA name line that a visible chip overlaps, or one read through a (translucent) chip.
        const covered = ja.some((l) => chips.some((c) => overlaps(l, c))) || notUi.some((l) => names.ja.test(l.text) && chips.some((c) => inside(c, ...centre(l))) && !chipText(l));
        // __gteki.identity() lists every tagged board (#347); `occluded` is "none" | "sign" | "geometry".
        const boards = f.identity && !f.identity.error ? [f.identity].flat() : null;
        const shown = (boards ?? []).filter((b) => b.inFrame && b.frontFacing);
        const id = boards ? {
          ok: shown.some((b) => !b.coveredByChip && (b.occluded === "none" || !b.occluded)),
          px: shown.length ? Math.max(...shown.map((b) => b.nameHeightPx ?? 0)) : 0,
          covered: shown.some((b) => b.coveredByChip),
        } : null;
        return {
          t: f.t, ocrError: !page || Boolean(page.error),
          jaPx: ja.length ? Math.max(...ja.map((l) => l.h)) : null, enPx: en.length ? Math.max(...en.map((l) => l.h)) : null,
          readable: ja.length > 0 && !covered, covered, kanaName: kanaName.length > 0, kanaAny: lines.some((l) => KANA.test(l.text)),
          hook: id,
        };
      });
      // Readable time = readable frames × frame interval (each frame stands for its own interval only).
      const frameS = run.frameS ?? 0.5;
      const seconds = (pred) => Math.round(per.filter(pred).length * frameS * 10) / 10;
      const maxOf = (k) => { const v = per.map((p) => p[k]).filter((x) => x != null); return v.length ? Math.max(...v) : null; };
      const hookFrames = per.filter((p) => p.hook);
      const row = {
        station: run.station, project: run.project, tier: run.tier, sha: run.sha, view, hasIdentityHook: run.hasIdentityHook,
        fontsReady: run.fonts?.status, notoJp: run.fonts?.notoJp, stationIdentityAtReady: run.stationIdentityAtReady ?? null,
        readableS: seconds((p) => p.readable), jaMaxPx: r1(maxOf("jaPx")), enMaxPx: r1(maxOf("enPx")),
        kanaName: per.some((p) => p.kanaName), kanaAny: per.some((p) => p.kanaAny), chipOverNameFrames: per.filter((p) => p.covered).length,
        hookReadableS: hookFrames.length ? seconds((p) => p.hook?.ok) : null,
        hookMaxPx: hookFrames.length ? r1(Math.max(...hookFrames.map((p) => p.hook.px ?? 0))) : null,
        hookCoveredFrames: hookFrames.length ? hookFrames.filter((p) => p.hook.covered).length : null,
        frames: per,
      };
      const readable = (row.hookReadableS ?? row.readableS) >= 3;
      const size = !isPhone || ((row.hookMaxPx ?? row.jaMaxPx ?? 0) >= PHONE.ja && (row.enMaxPx ?? 0) >= PHONE.en);
      // The hook (geometry) leads when present, since OCR misses oblique or partly covered signs; where the two
      // disagree by 2 s or more the row is flagged for the reviewer rather than silently trusting either.
      row.disagree = row.hookReadableS != null && Math.abs(row.hookReadableS - row.readableS) >= 2;
      // An OCR failure (or a missing OCR page) is a missing measurement, not a missing name: invalid, never fail.
      row.auto = per.some((p) => p.ocrError) ? "invalid (OCR error)" : readable && size && row.kanaAny && row.chipOverNameFrames === 0 && !row.hookCoveredFrames ? "pass" : "fail";
      rows.push(row);
    }
  }
}

fs.writeFileSync(path.join(out, "recognition-proxy.json"), JSON.stringify({ label: "recognition proxy", rows }, null, 2));
const b = (x) => (x == null ? "–" : x === true ? "yes" : x === false ? "no" : String(x));
const md = [];
for (const st of [...new Set(rows.map((r) => r.station))]) {
  const rs = rows.filter((r) => r.station === st);
  md.push(`### ${st}: recognition proxy (${rs[0].sha?.slice(0, 8) ?? "unknown SHA"})`, "",
    "| view | project | tier | readable s (OCR) | readable s (hook) | JA px | EN px | kana name | kana any | chip over name | fonts | equipment cues ≥2 | automated |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const p of [...new Set(rs.map((r) => r.project))]) {
    // Q4's loading card / overview name: product orientation, judged apart from the scene (not part of "automated").
    const si = rs.find((r) => r.project === p)?.stationIdentityAtReady;
    md.splice(md.length - 2, 0, `Q4 station identity at ready (${p}): ${si ? JSON.stringify(si) : "no hook"}`, "");
  }
  for (const r of rs) md.push(`| ${r.view} | ${r.project} | ${r.tier} | ${r.readableS}/5 | ${r.hookReadableS == null ? "no hook" : `${r.hookReadableS}/5`} | ${b(r.hookMaxPx ?? r.jaMaxPx)} | ${b(r.enMaxPx)} | ${b(r.kanaName)} | ${b(r.kanaAny)} | ${r.chipOverNameFrames + (r.hookCoveredFrames ?? 0)} | ${b(r.fontsReady)}${r.notoJp ? ", Noto JP" : ""} | review | ${r.auto}${r.disagree ? " (hook/OCR disagree: review)" : ""} |`);
  md.push("");
}
md.push("Report only, not a gate: \"automated\" is the proxy's reading; Q5 acceptance is the reviewer's, with the equipment cues.",
  `Thresholds: readable and unobscured ≥3/5 s (readable frames × frame interval); phone JA ≥${PHONE.ja} CSS px, EN ≥${PHONE.en} CSS px; kana plus ≥2 equipment cues (cues judged by the reviewer from the contact sheet); no POI chip over the name.`,
  "OCR px = Apple Vision line-box height ÷ devicePixelRatio, an approximation of rendered size; the identity hook's height is used when the build has it. A view without the station name in-world reads 0/5 by construction.");
fs.writeFileSync(path.join(out, "recognition-proxy.md"), md.join("\n") + "\n");
console.log(md.join("\n"));
