// Lane F #342 Q5: "recognition proxy" table from specs/20-recognition captures.
// usage: node tools/qa/recognition/proxy.mjs <out-dir> <project-artifacts-dir>...
//   each <project-artifacts-dir> is a moved tests/e2e/artifacts (evidence/<project>/<station>-recognition.json + rec-*.png)
// OCRs every frame with Apple Vision (ocr.swift, ja + en, on device), keeps only in-world text (lines whose centre
// is outside app UI and POI chips), and per station × project × view reports the #342 proxy:
//   name readable and unobscured ≥3 of 5 s (JA name found in-world, no visible chip over it, per second of game time);
//   phone JA name ≥18 CSS px and EN ≥12 CSS px (OCR line-box height / devicePixelRatio, an approximation of the
//   rendered size); kana present in-world; chip-over-name frames; equipment cues are left to the reviewer.
// When the build has __gteki.identity() (#342 Q2) its per-frame answer is summarised next to the OCR columns.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [out, ...dirs] = process.argv.slice(2);
if (!out || dirs.length === 0) { console.error("usage: proxy.mjs <out-dir> <artifacts-dir>..."); process.exit(2); }
const here = path.dirname(new URL(import.meta.url).pathname);
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
        const lines = (page?.lines ?? []).map((l) => ({ ...l, x: l.x / dpr, y: l.y / dpr, w: l.w / dpr, h: l.h / dpr }))
          .filter((l) => { const cx = l.x + l.w / 2, cy = l.y + l.h / 2; return !f.ui.some((r) => inside(r, cx, cy)) && !chips.some((r) => inside(r, cx, cy)); });
        const ja = lines.filter((l) => names.ja.test(l.text));
        const en = lines.filter((l) => names.en.test(l.text));
        const kanaName = lines.filter((l) => names.kana.test(l.text));
        const covered = ja.some((l) => chips.some((c) => overlaps(l, c)));
        const id = f.identity && !f.identity.error ? f.identity : null;
        return {
          t: f.t, second: Math.floor(f.t + 1e-6),
          jaPx: ja.length ? Math.max(...ja.map((l) => l.h)) : null, enPx: en.length ? Math.max(...en.map((l) => l.h)) : null,
          readable: ja.length > 0 && !covered, covered, kanaName: kanaName.length > 0, kanaAny: lines.some((l) => KANA.test(l.text)),
          hook: id ? { ok: Boolean(id.inFrame && id.frontFacing && !id.coveredByChip && !id.occluded), px: id.nameHeightPx ?? null, covered: Boolean(id.coveredByChip) } : null,
        };
      });
      const seconds = (pred) => new Set(per.filter(pred).map((p) => p.second)).size;
      const maxOf = (k) => { const v = per.map((p) => p[k]).filter((x) => x != null); return v.length ? Math.max(...v) : null; };
      const hookFrames = per.filter((p) => p.hook);
      const row = {
        station: run.station, project: run.project, tier: run.tier, sha: run.sha, view, hasIdentityHook: run.hasIdentityHook,
        fontsReady: run.fonts?.status, notoJp: run.fonts?.notoJp,
        readableS: seconds((p) => p.readable), jaMaxPx: r1(maxOf("jaPx")), enMaxPx: r1(maxOf("enPx")),
        kanaName: per.some((p) => p.kanaName), kanaAny: per.some((p) => p.kanaAny), chipOverNameFrames: per.filter((p) => p.covered).length,
        hookReadableS: hookFrames.length ? seconds((p) => p.hook?.ok) : null,
        hookMaxPx: hookFrames.length ? r1(Math.max(...hookFrames.map((p) => p.hook.px ?? 0))) : null,
        hookCoveredFrames: hookFrames.length ? hookFrames.filter((p) => p.hook.covered).length : null,
        frames: per,
      };
      const readable = (row.hookReadableS ?? row.readableS) >= 3;
      const size = !isPhone || ((row.hookMaxPx ?? row.jaMaxPx ?? 0) >= PHONE.ja && (row.enMaxPx ?? 0) >= PHONE.en);
      row.auto = readable && size && row.kanaAny && row.chipOverNameFrames === 0 && !row.hookCoveredFrames ? "pass" : "fail";
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
  for (const r of rs) md.push(`| ${r.view} | ${r.project} | ${r.tier} | ${r.readableS}/5 | ${r.hookReadableS == null ? "no hook" : `${r.hookReadableS}/5`} | ${b(r.hookMaxPx ?? r.jaMaxPx)} | ${b(r.enMaxPx)} | ${b(r.kanaName)} | ${b(r.kanaAny)} | ${r.chipOverNameFrames + (r.hookCoveredFrames ?? 0)} | ${b(r.fontsReady)}${r.notoJp ? ", Noto JP" : ""} | review | ${r.auto} |`);
  md.push("");
}
md.push(`Thresholds: readable and unobscured ≥3/5 s; phone JA ≥${PHONE.ja} CSS px, EN ≥${PHONE.en} CSS px; kana plus ≥2 equipment cues (cues judged by the reviewer from the contact sheet); no POI chip over the name.`,
  "OCR px = Apple Vision line-box height ÷ devicePixelRatio, an approximation of rendered size; the identity hook's height is used when the build has it. A view without the station name in-world reads 0/5 by construction.");
fs.writeFileSync(path.join(out, "recognition-proxy.md"), md.join("\n") + "\n");
console.log(md.join("\n"));
