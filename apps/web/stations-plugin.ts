import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
// Relative (not @gteki/schema) so Vite's config loader bundles the TypeScript source.
import { parseStationFiles } from "../../packages/schema/src/index.ts";

/**
 * Discovers station folders without any station-specific code in the explorer:
 *   <root>/<dir>/gteki/station.json (+ graph.json, pois.json, optional scene.ts, assets/**)
 * Default root: <repo>/stations. Extra read-only roots for local cross-worktree integration
 * can be given with GTEKI_STATION_ROOTS (path-delimited); the first root wins per folder name.
 */

export interface DiscoveredStation {
  dir: string;
  gtekiDir: string;
  scene: string | null;
  assets: string[];
}

/** Emitted code and stylesheets (and their maps); every other emitted file is data that needs a declared origin. */
const CODE_EXT = /\.([cm]?[jt]sx?|css|scss|sass|less|html?|map)$/i;
const ASSET_EXT = /\.(glb|gltf|bin|png|jpe?g|webp|ktx2|hdr|ogg|mp3|m4a|json)$/i;
/** The contract files are loaded as data, not served as assets. */
const CONTRACT_FILES = new Set(["station.json", "graph.json", "pois.json"]);

/**
 * Asset files under `dir`, following symlinks only when they resolve inside `fence`
 * (the station's own folder), so a station can't pull in files from elsewhere.
 */
function walk(dir: string, fence: string, base = dir, depth = 0): string[] {
  if (depth > 8 || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().flatMap((name) => {
    const full = path.join(dir, name);
    const real = fs.realpathSync(full);
    if (real !== fence && !real.startsWith(fence + path.sep)) return [];
    const stat = fs.statSync(full);
    if (stat.isDirectory()) return walk(full, fence, base, depth + 1);
    const rel = path.relative(base, full).split(path.sep).join("/");
    return ASSET_EXT.test(name) && !CONTRACT_FILES.has(rel) ? [rel] : [];
  });
}

export function discoverStations(roots: string[]): DiscoveredStation[] {
  const seen = new Set<string>();
  const found: DiscoveredStation[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root).sort()) {
      const gtekiDir = path.join(root, dir, "gteki");
      if (seen.has(dir) || !fs.existsSync(path.join(gtekiDir, "station.json"))) continue;
      seen.add(dir);
      const scene = ["scene.ts", "scene.js"].map((f) => path.join(gtekiDir, f)).find((f) => fs.existsSync(f)) ?? null;
      found.push({ dir, gtekiDir, scene, assets: walk(gtekiDir, fs.realpathSync(path.join(root, dir))) });
    }
  }
  return found;
}

/**
 * Dev URL for an absolute file path. Each segment is percent-encoded so a literal `%2e%2e` (or `?`, `#`)
 * in a real directory name can never be re-interpreted by URL normalisation as `..` or a query.
 */
export function fsUrl(realPath: string): string {
  return "/@fs" + realPath.split(path.sep).map((seg) => encodeURIComponent(seg)).join("/");
}

/**
 * What a production build may publish for each station: the manifest's declared asset files
 * (`assets[].uri` and `assets[].files`), keyed by station folder. Throws, refusing the build, when a
 * station fails `parseStationFiles`, declares a file that isn't there, or holds an asset file it
 * doesn't declare (rights are only checked for declared assets).
 */
export function publishableAssets(stations: DiscoveredStation[]): Map<string, Set<string>> {
  const failures: string[] = [];
  const allowed = new Map<string, Set<string>>();
  for (const s of stations) {
    const read = (name: string): unknown => {
      try { return JSON.parse(fs.readFileSync(path.join(s.gtekiDir, name), "utf8")); } catch { return undefined; }
    };
    const parsed = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"));
    if (!parsed.ok) {
      const errors = parsed.issues.filter((i) => i.level === "error");
      failures.push(`${s.dir}: ${errors.slice(0, 5).map((i) => `${i.code}${i.ref ? ` (${i.ref})` : ""}`).join(", ")}${errors.length > 5 ? ` and ${errors.length - 5} more` : ""}`);
      continue;
    }
    // Publication applies the asset rights rules even to synthetic stations (validation exempts fixtures).
    const sources = new Map(parsed.bundle.sources.map((src) => [src.id, src]));
    for (const a of parsed.bundle.assets ?? []) {
      const bad = a.sourceIds.filter((id) => sources.get(id)?.rights !== "REUSABLE_WITH_CONDITIONS" || sources.get(id)?.usage === "facts-only");
      if (a.sourceIds.length === 0) failures.push(`${s.dir}: asset ${a.id} has no source provenance`);
      else if (bad.length) failures.push(`${s.dir}: asset ${a.id} derives from non-reusable sources: ${bad.join(", ")}`);
    }
    const declared = new Set((parsed.bundle.assets ?? []).flatMap((a) => [a.uri, ...(a.files ?? [])]));
    const found = new Set(s.assets);
    const missing = [...declared].filter((f) => !found.has(f));
    // A canonical name may still link to a target whose real path Vite would read as a query or fragment.
    const odd = [...declared].filter((f) => found.has(f) && /[?#]/.test(path.relative(path.dirname(s.gtekiDir), fs.realpathSync(path.join(s.gtekiDir, f)))));
    if (odd.length) failures.push(`${s.dir}: declared asset files resolve to paths containing ? or #: ${odd.join(", ")}`);
    const undeclared = s.assets.filter((f) => !declared.has(f));
    if (missing.length) failures.push(`${s.dir}: declared asset files not found: ${missing.join(", ")}`);
    if (undeclared.length) failures.push(`${s.dir}: undeclared asset files (declare them in assets[].files or remove them): ${undeclared.join(", ")}`);
    allowed.set(s.dir, declared);
  }
  if (failures.length) throw new Error(`gteki-stations: refusing a production build with invalid stations: ${failures.join("; ")}`);
  return allowed;
}

const VIRTUAL = "virtual:gteki-stations";
const RESOLVED = "\0" + VIRTUAL;

export function gtekiStations(roots: string[]): Plugin {
  const fsPath = (p: string) => JSON.stringify(p.split(path.sep).join("/"));
  let serve = false;
  let appRoot = "";
  /** Real paths a production build may emit from station folders (filled when the virtual module loads). */
  let declaredReal = new Set<string>();
  /**
   * Dev: a direct /@fs URL of the file's current real path, recomputed on every load, so assets that
   * move (e.g. symlink → real folder) never resolve through a stale cached `?url` module.
   * Build: `?url` so Vite fingerprints and emits the file.
   */
  const assetLoader = (file: string) =>
    serve
      ? `() => Promise.resolve(${JSON.stringify(fsUrl(fs.realpathSync(file)))})`
      : `() => import(${fsPath(file + "?url")}).then((m) => m.default)`;
  return {
    name: "gteki-stations",
    configResolved(config) {
      serve = config.command === "serve";
      appRoot = fs.realpathSync(config.root);
    },
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      const stations = discoverStations(roots);
      // A production build publishes what it emits: only valid stations, and only their declared files.
      const published = serve ? null : publishableAssets(stations);
      if (published) {
        declaredReal = new Set(stations.flatMap((s) => [...(published.get(s.dir) ?? [])].map((f) => fs.realpathSync(path.join(s.gtekiDir, f)))));
      }
      const lines = ["export const stations = ["];
      for (const s of stations) {
        const f = (name: string) => fsPath(path.join(s.gtekiDir, name));
        const files = published ? s.assets.filter((a) => published.get(s.dir)?.has(a)) : s.assets;
        const assets = files.map((a) => `${JSON.stringify(a)}: ${assetLoader(path.join(s.gtekiDir, a))}`);
        lines.push(`  {
    dir: ${JSON.stringify(s.dir)},
    manifest: () => import(${f("station.json")}).then((m) => m.default),
    graph: () => import(${f("graph.json")}).then((m) => m.default),
    pois: () => import(${f("pois.json")}).then((m) => m.default),
    scene: ${s.scene ? `() => import(${fsPath(s.scene)})` : "null"},
    assets: { ${assets.join(", ")} },
  },`);
      }
      lines.push("];");
      return lines.join("\n");
    },
    /**
     * Defence in depth for files scene code imports directly (`?url`, `new URL(…, import.meta.url)`,
     * symlinks): every emitted file that isn't code or a stylesheet must be a declared station file
     * or belong to the web app, and one whose origin Vite doesn't record is refused. Bytes a scene
     * module embeds in code (inlined imports, `?raw`) are station code, covered by station PR review.
     */
    generateBundle(_options, bundle) {
      if (serve) return;
      const refused = new Set<string>();
      for (const output of Object.values(bundle)) {
        // Everything but code and stylesheets is data (svg, gif, avif, fonts, wasm, …), whatever its extension.
        if (output.type !== "asset" || CODE_EXT.test(output.fileName)) continue;
        const originals = (output.originalFileNames ?? []).filter((o) => !CODE_EXT.test(o.split("?")[0]!));
        if (originals.length === 0) refused.add(`${output.fileName} (origin unknown)`);
        for (const original of originals) {
          const file = path.resolve(appRoot, original.split("?")[0]!);
          const real = fs.existsSync(file) ? fs.realpathSync(file) : file;
          if (!declaredReal.has(real) && !real.startsWith(appRoot + path.sep)) refused.add(real);
        }
      }
      if (refused.size) this.error(`gteki-stations: refusing to publish undeclared files (declare them in a station's assets[].files): ${[...refused].join(", ")}`);
    },
    configureServer(server) {
      for (const root of roots) if (fs.existsSync(root)) server.watcher.add(root);
      const invalidate = (file: string) => {
        if (!roots.some((r) => file.startsWith(r)) || !/station\.json$|scene\.[jt]s$|assets/.test(file)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", invalidate);
      server.watcher.on("unlink", invalidate);
    },
  };
}
