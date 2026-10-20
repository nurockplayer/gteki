import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

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

const ASSET_EXT = /\.(glb|gltf|bin|png|jpe?g|webp|ktx2|hdr|ogg|mp3|m4a)$/i;

function walk(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, base);
    return ASSET_EXT.test(entry.name) ? [path.relative(base, full).split(path.sep).join("/")] : [];
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
      found.push({ dir, gtekiDir, scene, assets: walk(gtekiDir).filter((a) => !a.endsWith(".json")) });
    }
  }
  return found;
}

const VIRTUAL = "virtual:gteki-stations";
const RESOLVED = "\0" + VIRTUAL;

export function gtekiStations(roots: string[]): Plugin {
  const fsPath = (p: string) => JSON.stringify(p.split(path.sep).join("/"));
  return {
    name: "gteki-stations",
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      const stations = discoverStations(roots);
      const lines = ["export const stations = ["];
      for (const s of stations) {
        const f = (name: string) => fsPath(path.join(s.gtekiDir, name));
        const assets = s.assets.map((a) => `${JSON.stringify(a)}: () => import(${fsPath(path.join(s.gtekiDir, a))} + "?url").then((m) => m.default)`);
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
