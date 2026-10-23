import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
// Relative (not @gteki/schema) so Vite's config loader bundles the TypeScript source.
import { dataFileFactsOnlySources, parseStationFiles, validateBundle } from "../../packages/schema/src/index.ts";

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
/**
 * Validation rules that decide what may be published. Validation exempts synthetic fixtures from them;
 * a production build never does, so nothing derived from a non-reusable source ships.
 */
const PUBLICATION_RULES = new Set([
  "node.source.rights", "edge.geometry.rights", "floor.elevation.rights", "poi.position.rights",
  "coverage.polygon.rights", "asset.rights", "asset.source", "data.rights", "data.source", "data.path", "data.dup", "data.derivation",
  "source.attribution", "source.license", "source.url", "source.override", "source.decision",
]);
/** The contract files are loaded as data, not served as assets. */
const CONTRACT_FILES = new Set(["station.json", "graph.json", "pois.json"]);

const isInside = (real: string, fence: string) => real === fence || real.startsWith(fence + path.sep);

/**
 * Asset files under `dir`, following symlinks only when they resolve inside `fence`
 * (the station's own folder), so a station can't pull in files from elsewhere.
 */
function walk(dir: string, fence: string, base = dir, depth = 0): string[] {
  if (depth > 8 || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().flatMap((name) => {
    const full = path.join(dir, name);
    const real = fs.realpathSync(full);
    if (!isInside(real, fence)) return [];
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
 * (`assets[].uri`, `assets[].uriMobile` and `assets[].files`), keyed by station folder. Throws, refusing the build, when a
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
    // Publication applies the rights rules to every station, synthetic or not.
    const asPublished = { ...parsed.bundle, station: { ...parsed.bundle.station, synthetic: false } };
    for (const i of validateBundle(asPublished))
      if (i.level === "error" && PUBLICATION_RULES.has(i.code)) failures.push(`${s.dir}: ${i.code}${i.ref ? ` (${i.ref})` : ""}: ${i.message}`);
    const declared = new Set((parsed.bundle.assets ?? []).flatMap((a) => [a.uri, ...(a.uriMobile ? [a.uriMobile] : []), ...(a.files ?? [])]));
    const found = new Set(s.assets);
    const missing = [...declared].filter((f) => !found.has(f));
    // A canonical name may still link to a target whose real path Vite would read as a query or fragment.
    const odd = [...declared].filter((f) => found.has(f) && /[?#]/.test(path.relative(path.dirname(s.gtekiDir), fs.realpathSync(path.join(s.gtekiDir, f)))));
    if (odd.length) failures.push(`${s.dir}: declared asset files resolve to paths containing ? or #: ${odd.join(", ")}`);
    const folder = path.dirname(s.gtekiDir);
    const dataPaths = (parsed.bundle.dataFiles ?? []).map((d) => d.path);
    const noData = dataPaths.filter((p) => !fs.existsSync(path.join(folder, p)));
    if (noData.length) failures.push(`${s.dir}: declared data files not found: ${noData.join(", ")}`);
    // Like walk() for assets: a declared data file that is a symlink out of the station folder is refused.
    const fence = fs.realpathSync(folder);
    const escaping = dataPaths.filter((p) => !noData.includes(p) && !isInside(fs.realpathSync(path.join(folder, p)), fence));
    if (escaping.length) failures.push(`${s.dir}: declared data files resolve outside the station folder: ${escaping.join(", ")}`);
    const undeclared = s.assets.filter((f) => !declared.has(f));
    if (missing.length) failures.push(`${s.dir}: declared asset files not found: ${missing.join(", ")}`);
    if (undeclared.length) failures.push(`${s.dir}: undeclared asset files (declare them in assets[].files or remove them): ${undeclared.join(", ")}`);
    allowed.set(s.dir, declared);
  }
  if (failures.length) throw new Error(`gteki-stations: refusing a production build with invalid stations: ${failures.join("; ")}`);
  return allowed;
}

/** A station's folder and the real paths of every data file its manifest declares. */
export interface DeclaredStationFiles {
  dir: string;
  /** Real path of stations/<dir>/. */
  folder: string;
  /** Real paths: assets[].uri, assets[].files (relative to gteki/) and dataFiles[].path (relative to the folder). */
  declared: ReadonlySet<string>;
  /**
   * Symlinks inside the station folder that resolve outside it: real target (file or directory) -> the link's
   * path relative to the folder. Vite reports the target, which would otherwise look like a file elsewhere.
   */
  escapes: ReadonlyMap<string, string>;
}

/** Symlinks under `dir` (not `node_modules`) whose real target lies outside `fence`, as real target -> link path relative to `fence`. */
function symlinkEscapes(dir: string, fence: string, depth = 0, out = new Map<string, string>()): Map<string, string> {
  if (depth > 8 || !fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    if (name === "node_modules") continue;
    const full = path.join(dir, name);
    let real: string;
    try { real = fs.realpathSync(full); } catch { continue; }
    if (!isInside(real, fence)) out.set(real, path.relative(fence, full).split(path.sep).join("/"));
    else if (fs.statSync(full).isDirectory()) symlinkEscapes(full, fence, depth + 1, out);
  }
  return out;
}

/**
 * Real paths of the files each station's manifest declares (lenient read; `publishableAssets` is what
 * refuses an invalid manifest). A declared file that doesn't exist is simply absent.
 */
export function declaredStationFiles(stations: DiscoveredStation[]): DeclaredStationFiles[] {
  return stations.map((s) => {
    const folder = path.dirname(s.gtekiDir);
    let manifest: { assets?: { uri?: unknown; files?: unknown }[]; dataFiles?: { path?: unknown }[] } = {};
    try { manifest = JSON.parse(fs.readFileSync(path.join(s.gtekiDir, "station.json"), "utf8")); } catch { /* invalid: publishableAssets refuses it */ }
    const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const real = (p: string) => { try { return fs.realpathSync(p); } catch { return null; } };
    const declared = new Set<string>();
    for (const a of Array.isArray(manifest.assets) ? manifest.assets : [])
      for (const f of [...strings([a?.uri]), ...strings(a?.files)]) { const r = real(path.join(s.gtekiDir, f)); if (r) declared.add(r); }
    for (const d of Array.isArray(manifest.dataFiles) ? manifest.dataFiles : [])
      for (const f of strings([d?.path])) { const r = real(path.join(folder, f)); if (r) declared.add(r); }
    const fence = real(folder) ?? folder;
    return { dir: s.dir, folder: fence, declared, escapes: symlinkEscapes(folder, fence) };
  });
}

/** Contract files the loader reads as data (station.json, graph.json, pois.json), inside a station's gteki/. */
const CONTRACT_PATH = /^gteki\/(station|graph|pois)\.json$/;

/** A trailing Vite query such as `?raw`, `?url`, `?v=1&inline`; a real path with a `?` or `#` of its own is left whole. */
const VITE_QUERY = /\?[\w-]+(?:=[^&#?]*)?(?:&[\w-]+(?:=[^&#?]*)?)*$/;

/**
 * Module ids of a production build that inline a non-code data file from a station folder without the
 * station's manifest declaring it (`assets[].uri`/`files` or `dataFiles[]`, each with a source id that
 * `PUBLICATION_RULES` checks), or that reach one through a symlink resolving outside the station folder
 * (refused even when declared, as `walk()` refuses such assets). Pure: ids are real file paths as Vite
 * reports them (only a trailing Vite `?query` is ignored; virtual `\0` ids and anything outside every station
 * folder, or under a `node_modules`, are not station data). Code and stylesheets pass, as do the contract files.
 */
export function undeclaredInlinedData(moduleIds: Iterable<string>, stations: readonly DeclaredStationFiles[]): string[] {
  const failures = new Set<string>();
  for (const raw of moduleIds) {
    if (raw.startsWith("\0")) continue;
    const id = raw.replace(VITE_QUERY, "");
    if (CODE_EXT.test(id)) continue;
    for (const s of stations) {
      const link = [...s.escapes].find(([target]) => id === target || id.startsWith(target + path.sep));
      if (link) { failures.add(`${s.dir}: ${link[1]} (symlink resolving outside the station folder)`); break; }
      if (!id.startsWith(s.folder + path.sep)) continue;
      const rel = path.relative(s.folder, id).split(path.sep).join("/");
      if (rel.split("/").includes("node_modules") || CONTRACT_PATH.test(rel) || s.declared.has(id)) break;
      failures.add(`${s.dir}: ${rel}`);
      break;
    }
  }
  return [...failures].sort();
}

/**
 * One audit line per declared data file that cites facts-only sources (the #186/#26 allowance), for the build log.
 * Stations that fail to parse are skipped here; `publishableAssets` is what refuses them.
 */
export function factsOnlyDataLines(stations: DiscoveredStation[]): string[] {
  return stations.flatMap((s) => {
    const read = (name: string): unknown => {
      try { return JSON.parse(fs.readFileSync(path.join(s.gtekiDir, name), "utf8")); } catch { return undefined; }
    };
    const parsed = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"));
    if (!parsed.ok) return [];
    return dataFileFactsOnlySources(parsed.bundle).map((d) => `[gteki] ${s.dir} ${d.path} cites facts-only: ${d.factsOnlySourceIds.join(", ")}`);
  });
}

/**
 * Undeclared inlined data fails the build by default. Only an explicit `GTEKI_INLINE_DATA_GATE=warn` logs it
 * and still builds (a local debugging aid); any other value — including a typo — fails.
 */
export function inlineDataGateMode(env: Record<string, string | undefined> = process.env): "warn" | "error" {
  return env.GTEKI_INLINE_DATA_GATE === "warn" ? "warn" : "error";
}

const VIRTUAL = "virtual:gteki-stations";
const RESOLVED = "\0" + VIRTUAL;

export function gtekiStations(roots: string[]): Plugin {
  const fsPath = (p: string) => JSON.stringify(p.split(path.sep).join("/"));
  let serve = false;
  let appRoot = "";
  let info: (message: string) => void = () => {};
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
      info = (message) => config.logger.info(message);
    },
    /** Audit trail: which declared data files cite facts-only sources, once per build. */
    buildStart() {
      if (serve) return;
      for (const line of factsOnlyDataLines(discoverStations(roots))) info(line);
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
     * Bytes a scene module inlines into code (a JSON import, `?raw`) are never emitted as files, so
     * `generateBundle` can't see them: check every module id of the build instead. Data under a station
     * folder must be declared in its manifest with sources (see `undeclaredInlinedData`). Mode is
     * `GTEKI_INLINE_DATA_GATE`: undeclared data fails the build unless the mode is explicitly `warn`.
     */
    buildEnd(error) {
      if (serve || error) return;
      const undeclared = undeclaredInlinedData(this.getModuleIds(), declaredStationFiles(discoverStations(roots)));
      if (undeclared.length === 0) return;
      const message = `gteki-stations: station data inlined into the bundle without a manifest declaration (add it to assets[].files or dataFiles[] with source ids; a symlink leaving the station folder is refused even if declared): ${undeclared.join(", ")}`;
      if (inlineDataGateMode() === "error") this.error(message);
      else this.warn(`${message} [GTEKI_INLINE_DATA_GATE=warn: not failing the build]`);
    },
    /**
     * Defence in depth for files scene code imports directly (`?url`, `new URL(…, import.meta.url)`,
     * symlinks): every emitted file that isn't code or a stylesheet must be a declared station file
     * or belong to the web app, and one whose origin Vite doesn't record is refused. Bytes a scene
     * module inlines into code are covered by the `buildEnd` data gate above.
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
