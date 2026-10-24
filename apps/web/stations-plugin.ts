import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
// Relative (not @gteki/schema) so Vite's config loader bundles the TypeScript source.
import { dataFileFactsOnlySources, parseStationFiles, validateBundle } from "../../packages/schema/src/index.ts";
import { isProjectArtModule, loadReuseAnnotations } from "./reuseResolve.ts";

/**
 * Discovers station folders without any station-specific code in the explorer:
 *   <root>/<dir>/gteki/station.json (+ graph.json, pois.json, optional scene.ts, assets/**)
 * Default root: <repo>/stations. Extra read-only roots for local cross-worktree integration
 * can be given with GTEKI_STATION_ROOTS (path-delimited); the first root wins per folder name.
 */

export interface DiscoveredStation {
  dir: string;
  /** Real path of stations/<dir>/, kept separate from gtekiDir because gteki/ may itself be a symlink. */
  folder: string;
  gtekiDir: string;
  scene: string | null;
  /** The optional gteki/tenants.json (a store brand directory, #419). */
  tenants: string | null;
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
const CONTRACT_FILES = new Set(["station.json", "graph.json", "pois.json", "tenants.json"]);

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
      const folder = fs.realpathSync(path.join(root, dir));
      seen.add(dir);
      const scene = ["scene.ts", "scene.js"].map((f) => path.join(gtekiDir, f)).find((f) => fs.existsSync(f)) ?? null;
      const tenants = path.join(gtekiDir, "tenants.json");
      found.push({ dir, folder, gtekiDir, scene, tenants: fs.existsSync(tenants) ? tenants : null, assets: walk(gtekiDir, folder) });
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
 * The optional `gteki/tenants.json` (#419) as parsed JSON. `undefined` only means the file does not exist.
 * A file that exists but cannot be parsed is returned as `{}` (and a `null` file as `null`), so the shape check
 * refuses it: an unreadable or invalid directory must never be read as "this station has none".
 */
export function readOptionalTenants(gtekiDir: string): unknown {
  const file = path.join(gtekiDir, "tenants.json");
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return {};
  }
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
    // Only a missing file is "no directory"; null or any other non-object content fails the shape check.
    const tenants = readOptionalTenants(s.gtekiDir);
    const parsed = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"), tenants);
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
    const odd = [...declared].filter((f) => found.has(f) && /[?#]/.test(path.relative(s.folder, fs.realpathSync(path.join(s.gtekiDir, f)))));
    if (odd.length) failures.push(`${s.dir}: declared asset files resolve to paths containing ? or #: ${odd.join(", ")}`);
    const folder = s.folder;
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
  /** Real paths: assets[].uri, assets[].uriMobile, assets[].files (relative to gteki/) and dataFiles[].path (relative to the folder). */
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
    const folder = s.folder;
    let manifest: { assets?: { uri?: unknown; uriMobile?: unknown; files?: unknown }[]; dataFiles?: { path?: unknown }[] } = {};
    try { manifest = JSON.parse(fs.readFileSync(path.join(s.gtekiDir, "station.json"), "utf8")); } catch { /* invalid: publishableAssets refuses it */ }
    const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const real = (p: string) => { try { return fs.realpathSync(p); } catch { return null; } };
    const declared = new Set<string>();
    for (const a of Array.isArray(manifest.assets) ? manifest.assets : [])
      for (const f of [...strings([a?.uri]), ...strings([a?.uriMobile]), ...strings(a?.files)]) { const r = real(path.join(s.gtekiDir, f)); if (r) declared.add(r); }
    for (const d of Array.isArray(manifest.dataFiles) ? manifest.dataFiles : [])
      for (const f of strings([d?.path])) { const r = real(path.join(folder, f)); if (r) declared.add(r); }
    const fence = real(folder) ?? folder;
    return { dir: s.dir, folder: fence, declared, escapes: symlinkEscapes(folder, fence) };
  });
}

/** Contract files the loader reads as data (station.json, graph.json, pois.json, tenants.json), inside a station's gteki/. */
const CONTRACT_PATH = /^gteki\/(station|graph|pois|tenants)\.json$/;

/** A trailing Vite query such as `?raw`, `?url`, `?v=1&inline`; a real path with a `?` or `#` of its own is left whole. */
const VITE_QUERY = /\?[\w-]+(?:=[^&#?]*)?(?:&[\w-]+(?:=[^&#?]*)?)*$/;

/**
 * Module ids of a production build that inline a non-code data file from a station folder without the
 * station's manifest declaring it (`assets[].uri`/`uriMobile`/`files` or `dataFiles[]`, each with a source id that
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

const modulePath = (id: string) => id.startsWith("\0") ? id : id.replace(VITE_QUERY, "");
const hasNodeModulesSegment = (id: string) => id.split(/[\\/]/).includes("node_modules");
const JS_CODE_EXT = /\.[cm]?[jt]sx?$/i;

/**
 * Finds non-code modules reachable from each station scene that live outside every station folder.
 * The graph contains both static and dynamic imports. App modules that no station scene reaches are
 * intentionally out of scope; virtual ids and dependencies are ignored.
 * `isProjectArt` is the build's exemption (see `isProjectArtFile`): it is the only way a module outside
 * every station folder is not reported, and it defaults to exempting nothing so the check stays pure.
 */
export function outsideStationData(
  graph: ReadonlyMap<string, readonly string[]>,
  stationEntries: ReadonlyMap<string, string>,
  stations: readonly DiscoveredStation[],
  isProjectArt: (filePath: string) => boolean = () => false,
): string[] {
  const byId = new Map<string, readonly string[]>(graph);
  const folders = stations.map((s) => ({ dir: s.dir, folder: s.folder }));
  const findings = new Set<string>();
  for (const [stationName, entry] of stationEntries) {
    const visited = new Set<string>();
    const pending = [entry];
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id) || id.startsWith("\0")) continue;
      visited.add(id);
      const fileId = modulePath(id);
      if (!hasNodeModulesSegment(fileId) && !CODE_EXT.test(fileId) && path.isAbsolute(fileId)) {
        const insideStation = folders.some(({ folder }) => id === folder || id.startsWith(folder + path.sep));
        if (!insideStation && !isProjectArt(fileId)) findings.add(`${stationName}: ${fileId}`);
      }
      pending.push(...(byId.get(id) ?? []));
    }
  }
  return [...findings].sort();
}

/**
 * Conservative station-code data detector: any `?raw` import qualifies. Otherwise source must
 * exceed 64 KiB and at least 80% of its bytes must be quoted-string/number tokens or array/object
 * literal punctuation (`[]{}:,`). This intentionally avoids small generated helpers and ordinary code.
 */
export function isInlineDataCode(id: string, code: string): boolean {
  const normalized = modulePath(id);
  if (!JS_CODE_EXT.test(normalized)) return false;
  const queryAt = id.indexOf("?");
  if (queryAt >= 0 && /(?:^|&)raw(?:&|$)/.test(id.slice(queryAt + 1))) return true;
  const bytes = Buffer.byteLength(code, "utf8");
  if (bytes <= 64 * 1024) return false;
  const dataLike = /(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|[\[\]{}:,])/g;
  let covered = 0;
  for (const match of code.matchAll(dataLike)) covered += Buffer.byteLength(match[0], "utf8");
  return covered / bytes >= 0.8;
}

/** Read original station-owned JavaScript/TypeScript source for the data-shape heuristic. */
export function stationCodeSources(moduleIds: Iterable<string>, stations: readonly DiscoveredStation[]): Map<string, string> {
  const folders = stations.map((s) => ({ folder: s.folder }));
  const sources = new Map<string, string>();
  for (const id of moduleIds) {
    const file = modulePath(id);
    if (id.startsWith("\0") || !path.isAbsolute(file) || !JS_CODE_EXT.test(file) || hasNodeModulesSegment(file)) continue;
    if (!folders.some(({ folder }) => file.startsWith(folder + path.sep))) continue;
    try { sources.set(id, fs.readFileSync(file, "utf8")); } catch { /* module may be virtualized or removed during the build */ }
  }
  return sources;
}

/** Station-owned source modules for which the data-shape heuristic raised a warning. */
export function wrappedStationData(
  modules: ReadonlyMap<string, string>,
  stations: readonly DiscoveredStation[],
): string[] {
  const findings = new Set<string>();
  const folders = stations.map((s) => ({ dir: s.dir, folder: s.folder }));
  for (const [rawId, code] of modules) {
    const id = modulePath(rawId);
    if (id.startsWith("\0") || !path.isAbsolute(id) || hasNodeModulesSegment(id) || !isInlineDataCode(rawId, code)) continue;
    for (const { dir, folder } of folders) {
      if (id.startsWith(folder + path.sep)) {
        const reason = rawId.includes("?") && /(?:^|&)raw(?:&|$)/.test(rawId.slice(rawId.indexOf("?") + 1)) ? "?raw import" : "large literal-heavy module";
        findings.add(`${dir}: ${path.relative(folder, id).split(path.sep).join("/")} (${reason})`);
        break;
      }
    }
  }
  return [...findings].sort();
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
    const tenants = readOptionalTenants(s.gtekiDir);
    const parsed = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"), tenants);
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
    tenants: ${s.tenants ? `() => import(${f("tenants.json")}).then((m) => m.default)` : "null"},
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
      const stations = discoverStations(roots);
      const ids = [...this.getModuleIds()];
      const graph = new Map<string, readonly string[]>();
      for (const id of ids) {
        const module = this.getModuleInfo(id);
        graph.set(id, module ? [...module.importedIds, ...module.dynamicallyImportedIds] : []);
      }
      const entries = new Map(stations.flatMap((s) => s.scene ? [[s.dir, fs.realpathSync(s.scene)] as const] : []));
      // Lane E project art under assets/library/ is reached from a station scene but is not station data.
      // The director's ruling (#359 follow-up): a bare path is never allowlisted — REUSE must record the
      // file, by its last matching annotation, as project-authored art ("GTEki contributors", CC-BY-4.0),
      // for both the reported path and its real path. Read once; an unreadable or unparseable REUSE.toml
      // exempts nothing, so the gate fails closed.
      const repoRoot = path.resolve(appRoot, "../..");
      const reuse = loadReuseAnnotations(repoRoot);
      const isProjectArt = (file: string): boolean => isProjectArtModule(reuse, repoRoot, file);
      for (const finding of outsideStationData(graph, entries, stations, isProjectArt)) {
        this.warn(`gteki-stations: station scene reaches data outside every station folder (${finding}); move the data into that station folder and declare it in dataFiles[].`);
      }
      for (const finding of wrappedStationData(stationCodeSources(ids, stations), stations)) {
        this.warn(`gteki-stations: station code may wrap inline data (${finding}); declare it as JSON in dataFiles[] instead of wrapping it in code.`);
      }
      const undeclared = undeclaredInlinedData(ids, declaredStationFiles(stations));
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
