// pnpm --filter @gteki/station-ikebukuro audit:assets [--dist <dir>]
//
// G0 asset audit for Lane F: lists every file the deploy ships for Ikebukuro with its sha256, size and the manifest
// entry that declares it, and fails when a shipped file is undeclared or a declared file is missing.
//
// "What the deploy ships" is decided by the same code the production build uses: deploy/cloudflare-pages/build.sh runs
// `pnpm build` (apps/web) and copies apps/web/dist; apps/web/stations-plugin.ts `discoverStations` finds the station's
// files under gteki/ (the contract JSON, the scene entry, and every data file with a shipped extension) and
// `publishableAssets` refuses the build unless every one of the data files is declared in station.json
// `assets[].uri` / `assets[].files`. This audit re-derives that list, hashes it, adds the cross-checks below, and
// calls `publishableAssets` itself so the build gate and the audit cannot disagree.
//
// Failures (exit 1):
//  - a file the build would ship under gteki/ that station.json does not declare;
//  - a declared file that is not there;
//  - the build gate (`publishableAssets`) throws for Ikebukuro;
//  - a derivation sidecar contradicts the bytes or the manifest: ikebukuro_b1.meta.json's source sha256 vs station.json
//    `sources[].sha256`; the sizes recorded in ikebukuro_b1_lit.meta.json vs the files on disk;
//  - with --dist <dir>: a declared file at least 4 KiB (Vite inlines smaller ones as data URIs) whose bytes are not
//    in that directory tree (Vite copies assets byte-for-byte under hashed names).
// Warnings (printed, not fatal): derivation links that no longer match, e.g. the lit GLB's recorded source GLB hash.
//
// Not covered: the scene's own code and the JSON data it imports (scene/*.json) are bundled into JavaScript, not
// served as files; the plugin leaves them to station PR review.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStationFiles } from "@gteki/schema";
import { discoverStations, publishableAssets } from "../../../apps/web/stations-plugin.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STATION_DIR = path.resolve(HERE, "..");
const STATIONS_ROOT = path.resolve(STATION_DIR, "..");
/** Vite's default `assetsInlineLimit`: smaller files become data URIs in the JS, not separate files. */
export const INLINE_LIMIT_BYTES = 4096;

export interface ShippedFile {
  /** Path relative to the station's gteki/ folder. */
  file: string;
  bytes: number;
  sha256: string;
  /** What declares it: a station.json asset entry, or the contract/scene role the build gives it. */
  declaredBy: string;
  /** The derivation sidecar (`*.meta.json`) that describes it, when there is one. */
  describedBy: string | null;
}

export interface Audit {
  files: ShippedFile[];
  /** Fatal. Empty means the audit passes. */
  problems: string[];
  /** Printed, not fatal. */
  warnings: string[];
  /** Derivation links that were compared, with their outcome. */
  derivation: { claim: string; recorded: string; actual: string; ok: boolean; fatal: boolean }[];
}

const sha256 = (buf: Buffer) => crypto.createHash("sha256").update(buf).digest("hex");

function walkFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    return d.isDirectory() ? walkFiles(full, base) : [path.relative(base, full).split(path.sep).join("/")];
  });
}

export function audit(opts: { stationsRoot?: string; dist?: string } = {}): Audit {
  const stationsRoot = opts.stationsRoot ?? STATIONS_ROOT;
  const result: Audit = { files: [], problems: [], warnings: [], derivation: [] };
  const station = discoverStations([stationsRoot]).find((s) => s.dir === "ikebukuro");
  if (!station) {
    result.problems.push(`no station folder "ikebukuro" with gteki/station.json under ${stationsRoot}`);
    return result;
  }
  const gtekiDir = station.gtekiDir;
  const readJson = (rel: string): unknown => JSON.parse(fs.readFileSync(path.join(gtekiDir, rel), "utf8"));
  const parsed = parseStationFiles(readJson("station.json"), readJson("graph.json"), readJson("pois.json"));
  if (!parsed.ok || !parsed.bundle) {
    result.problems.push(`station files fail parseStationFiles: ${parsed.issues.filter((i) => i.level === "error").map((i) => i.code).join(", ")}`);
    return result;
  }
  const bundle = parsed.bundle;

  // declared file -> the manifest entry that declares it
  const declaredBy = new Map<string, string>();
  for (const a of bundle.assets ?? []) {
    declaredBy.set(a.uri, `station.json assets[id=${a.id}].uri`);
    for (const f of a.files ?? []) if (!declaredBy.has(f)) declaredBy.set(f, `station.json assets[id=${a.id}].files`);
  }

  // What the build ships from gteki/: the discovery result, plus the contract files and the scene entry the plugin imports.
  const contract = ["station.json", "graph.json", "pois.json"].map((f) => [f, "contract file (loaded as data by apps/web/stations-plugin.ts)"] as const);
  const sceneEntry = station.scene ? [[path.relative(gtekiDir, station.scene).split(path.sep).join("/"), "scene entry (hook discovered by apps/web/stations-plugin.ts)"] as const] : [];
  const shipped = new Map<string, string | null>([...contract, ...sceneEntry, ...station.assets.map((f) => [f, declaredBy.get(f) ?? null] as const)]);

  for (const f of station.assets) if (!declaredBy.has(f)) result.problems.push(`shipped but undeclared: ${f} (declare it in station.json assets[].files or remove it)`);
  for (const f of declaredBy.keys()) if (!fs.existsSync(path.join(gtekiDir, f))) result.problems.push(`declared but missing: ${f} (${declaredBy.get(f)})`);
  // The same gate the production build applies (rights rules, undeclared, missing); a throw is a failed build.
  try {
    publishableAssets([station]);
  } catch (e) {
    result.problems.push(`build gate refuses Ikebukuro: ${(e as Error).message}`);
  }

  const sidecarOf = (file: string): string | null => {
    const stem = file.replace(/\.[^./]+$/, "");
    const same = `${stem}.meta.json`;
    if (same !== file && declaredBy.has(same) && fs.existsSync(path.join(gtekiDir, same))) return same;
    // lightmaps are recorded by the lit GLB's sidecar
    if (/_lightmap(_2k)?\.webp$/.test(file) && fs.existsSync(path.join(gtekiDir, "assets/ikebukuro_b1_lit.meta.json"))) return "assets/ikebukuro_b1_lit.meta.json";
    return null;
  };

  const hashes = new Map<string, string>();
  for (const [file, by] of [...shipped].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const full = path.join(gtekiDir, file);
    if (!fs.existsSync(full)) continue;
    const buf = fs.readFileSync(full);
    hashes.set(file, sha256(buf));
    result.files.push({ file, bytes: buf.length, sha256: hashes.get(file)!, declaredBy: by ?? "NOT DECLARED", describedBy: sidecarOf(file) });
  }
  const sizeOf = (file: string) => result.files.find((f) => f.file === file)?.bytes;

  // Derivation: the generic GLB's sidecar must name the source PLATEAU file station.json pins.
  const compare = (claim: string, recorded: string | number | undefined, actual: string | number | undefined, fatal: boolean) => {
    const ok = recorded !== undefined && actual !== undefined && String(recorded) === String(actual);
    result.derivation.push({ claim, recorded: String(recorded), actual: String(actual), ok, fatal });
    if (!ok) (fatal ? result.problems : result.warnings).push(`derivation: ${claim}: recorded ${recorded}, actual ${actual}`);
  };
  const metaPath = "assets/ikebukuro_b1.meta.json";
  if (fs.existsSync(path.join(gtekiDir, metaPath))) {
    const meta = readJson(metaPath) as { source?: { sha256?: string; file?: string } };
    const pinned = bundle.sources.flatMap((s) => Object.entries(s.sha256 ?? {})).find(([name]) => name === meta.source?.file);
    compare(`${metaPath} source.sha256 equals station.json sources[].sha256 for ${meta.source?.file}`, meta.source?.sha256, pinned?.[1], true);
  }
  const litMetaPath = "assets/ikebukuro_b1_lit.meta.json";
  if (fs.existsSync(path.join(gtekiDir, litMetaPath))) {
    const lit = readJson(litMetaPath) as { source_glb_sha256?: string; file_sizes_bytes?: Record<string, number>; shipped_lightmaps?: Record<string, { bytes: number }> };
    for (const [name, bytes] of Object.entries(lit.file_sizes_bytes ?? {})) {
      const shippedSize = sizeOf(`assets/${name}`);
      if (shippedSize !== undefined) compare(`${litMetaPath} file_sizes_bytes[${name}] equals the shipped file`, bytes, shippedSize, true);
    }
    for (const [name, { bytes }] of Object.entries(lit.shipped_lightmaps ?? {})) compare(`${litMetaPath} shipped_lightmaps[${name}].bytes equals the shipped file`, bytes, sizeOf(`assets/${name}`), true);
    // Warning only: a rebuild of the generic GLB after a bake (e.g. a later fix to it) leaves the lit GLB derived from an older one.
    compare(`${litMetaPath} source_glb_sha256 equals the shipped assets/ikebukuro_b1.glb`, lit.source_glb_sha256, hashes.get("assets/ikebukuro_b1.glb"), false);
  }

  // Optional: the deploy output carries every declared file that is not inlined, byte for byte.
  if (opts.dist) {
    if (!fs.existsSync(opts.dist)) {
      result.problems.push(`--dist ${opts.dist} does not exist`);
    } else {
      const inDist = new Set(walkFiles(opts.dist).map((f) => sha256(fs.readFileSync(path.join(opts.dist!, f)))));
      for (const f of result.files) {
        if (!declaredBy.has(f.file) || f.bytes < INLINE_LIMIT_BYTES) continue;
        if (!inDist.has(f.sha256)) result.problems.push(`not in the deploy output ${opts.dist}: ${f.file} (sha256 ${f.sha256})`);
      }
    }
  }
  return result;
}

export function format(a: Audit): string {
  const rows = a.files.map((f) => `${f.sha256}  ${String(f.bytes).padStart(9)}  ${f.file}\n    declared by: ${f.declaredBy}${f.describedBy ? `\n    described by: ${f.describedBy}` : ""}`);
  const out = [`Ikebukuro shipped files (${a.files.length}):`, ...rows];
  if (a.derivation.length) out.push("", "Derivation checks:", ...a.derivation.map((d) => `  ${d.ok ? "ok  " : d.fatal ? "FAIL" : "WARN"} ${d.claim}${d.ok ? "" : ` (recorded ${d.recorded}, actual ${d.actual})`}`));
  if (a.warnings.length) out.push("", `${a.warnings.length} warning(s):`, ...a.warnings.map((w) => `  WARN ${w}`));
  out.push("", a.problems.length ? `FAIL: ${a.problems.length} problem(s):` : "ok: every shipped file is declared, every declared file is present", ...a.problems.map((p) => `  ${p}`));
  return out.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--dist");
  const result = audit({ dist: i >= 0 ? path.resolve(process.argv[i + 1] ?? "") : undefined });
  console.log(format(result));
  process.exit(result.problems.length ? 1 : 0);
}
