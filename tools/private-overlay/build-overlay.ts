import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Edge, Floor, GraphFile, Node, Poi, PoiFile, Source, StationManifestFile } from "../../packages/schema/src/index.ts";
import { parseStationFiles } from "../../packages/schema/src/index.ts";

export interface StationFiles { manifest: StationManifestFile; graph: GraphFile; pois: PoiFile; tenants?: unknown }
export interface Additions {
  sources?: Source[];
  floors?: Floor[];
  pois?: Poi[];
  graphParts: { file: string; nodes: Node[]; edges: Edge[]; floors?: Floor[] }[];
}

function mergeList<T extends { id: string }>(publicItems: T[], additions: { file: string; items: T[] }[], label: string, problems: string[]): T[] {
  const seen = new Map<string, string>();
  for (const { file, items } of additions) for (const item of items) {
    const previous = seen.get(item.id);
    if (previous) problems.push(previous === file ? `${label} id ${item.id} appears twice in ${file}` : `${label} id ${item.id} appears in both ${previous} and ${file}`);
    else seen.set(item.id, file);
  }
  const merged = publicItems.slice();
  const positions = new Map(merged.map((item, index) => [item.id, index]));
  for (const { items } of additions) for (const item of items) {
    const position = positions.get(item.id);
    if (position === undefined) {
      positions.set(item.id, merged.length);
      merged.push(item);
    } else merged[position] = item;
  }
  return merged;
}

/** Pure: returns merged files, or throws Error with all problems listed. */
export function mergeStation(pub: StationFiles, add: Additions): StationFiles {
  const problems: string[] = [];
  for (const source of add.sources ?? []) if (!source.notes?.startsWith("[tier P]")) problems.push(`source ${source.id} notes must start with [tier P]`);
  const sourceFiles = (add.sources ?? []).length ? [{ file: "sources.json", items: add.sources! }] : [];
  const floorFiles = (add.floors ?? []).length ? [{ file: "floors.json", items: add.floors! }] : [];
  const poiFiles = (add.pois ?? []).length ? [{ file: "pois.json", items: add.pois! }] : [];
  const graphParts = [...add.graphParts].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  floorFiles.push(...graphParts.filter(part => part.floors?.length).map(({ file, floors }) => ({ file, items: floors! })));
  const manifest: StationManifestFile = {
    ...pub.manifest,
    sources: mergeList(pub.manifest.sources, sourceFiles, "source", problems),
    floors: mergeList(pub.manifest.floors, floorFiles, "floor", problems),
  };
  const graph: GraphFile = {
    ...pub.graph,
    nodes: mergeList(pub.graph.nodes, graphParts.map(({ file, nodes }) => ({ file, items: nodes })), "node", problems),
    edges: mergeList(pub.graph.edges, graphParts.map(({ file, edges }) => ({ file, items: edges })), "edge", problems),
  };
  const pois: PoiFile = { ...pub.pois, pois: mergeList(pub.pois.pois, poiFiles, "poi", problems) };
  if (problems.length) throw new Error(problems.join("\n"));
  const merged: StationFiles = { manifest, graph, pois, ...(pub.tenants === undefined ? {} : { tenants: pub.tenants }) };
  const parsed = parseStationFiles(manifest, graph, pois, merged.tenants, { privateTier: true });
  if (!parsed.ok) {
    const errors = parsed.issues.filter((issue) => issue.level === "error");
    if (errors.length) throw new Error(errors.slice(0, 10).map((issue) => `${issue.code}${issue.ref ? ` (${issue.ref})` : ""}: ${issue.message}`).join("\n"));
  }
  return merged;
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

function readArray<T>(file: string, key: string): T[] {
  const value = readJson(file) as Record<string, unknown>;
  if (!Array.isArray(value?.[key])) throw new Error(`${file}: expected ${key} array`);
  return value[key] as T[];
}

function readAdditions(dir: string): Additions {
  const add: Additions = { graphParts: [] };
  const optional = (name: string, key: string) => {
    const file = path.join(dir, name);
    return fs.existsSync(file) ? readArray(file, key) : undefined;
  };
  add.sources = optional("sources.json", "sources");
  add.floors = optional("floors.json", "floors");
  add.pois = optional("pois.json", "pois");
  const readGraphPart = (name: string) => {
    const file = path.join(dir, name);
    const part = readJson(file) as { floors?: Floor[] };
    return { file: name, nodes: readArray<Node>(file, "nodes"), edges: readArray<Edge>(file, "edges"),
      ...(part.floors === undefined ? {} : { floors: readArray<Floor>(file, "floors") }) };
  };
  const graphFile = path.join(dir, "graph.json");
  if (fs.existsSync(graphFile)) add.graphParts.push(readGraphPart("graph.json"));
  for (const name of fs.readdirSync(dir).filter((entry) => /^graph\..+\.json$/.test(entry)).sort()) {
    add.graphParts.push(readGraphPart(name));
  }
  return add;
}

function readPublicStation(repoRoot: string, station: string): StationFiles {
  const dir = path.join(repoRoot, "stations", station, "gteki");
  const manifest = readJson(path.join(dir, "station.json")) as StationManifestFile;
  const graph = readJson(path.join(dir, "graph.json")) as GraphFile;
  const pois = readJson(path.join(dir, "pois.json")) as PoiFile;
  const tenantsPath = path.join(dir, "tenants.json");
  return { manifest, graph, pois, ...(fs.existsSync(tenantsPath) ? { tenants: readJson(tenantsPath) } : {}) };
}

/** IO: reads additions/<s>, public files, writes overlay/<s>/gteki/*. Returns the station keys written. */
export function buildOverlay(opts: { repoRoot: string; privateDir: string; stations?: string[] }): string[] {
  const additionsRoot = path.join(opts.privateDir, "additions");
  const stationNames = opts.stations ?? (fs.existsSync(additionsRoot) ? fs.readdirSync(additionsRoot).filter((name) => fs.statSync(path.join(additionsRoot, name)).isDirectory()).sort() : []);
  const written: string[] = [];
  // A full run also drops overlay stations whose additions were removed, so a stale overlay never loads.
  const overlayRoot = path.join(opts.privateDir, "overlay");
  if (!opts.stations && fs.existsSync(overlayRoot))
    for (const name of fs.readdirSync(overlayRoot)) if (!stationNames.includes(name)) fs.rmSync(path.join(overlayRoot, name), { recursive: true, force: true });
  for (const station of stationNames) {
    const publicDir = path.join(opts.repoRoot, "stations", station, "gteki");
    if (!fs.existsSync(path.join(publicDir, "station.json"))) throw new Error(`additions/${station} has no public station folder`);
    const pub = readPublicStation(opts.repoRoot, station);
    const addDir = path.join(additionsRoot, station);
    const merged = mergeStation(pub, fs.existsSync(addDir) ? readAdditions(addDir) : { graphParts: [] });
    const outputDir = path.join(opts.privateDir, "overlay", station, "gteki");
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.mkdirSync(outputDir, { recursive: true });
    const write = (name: string, value: unknown) => fs.writeFileSync(path.join(outputDir, name), `${JSON.stringify(value, null, 2)}\n`);
    write("station.json", merged.manifest);
    write("graph.json", merged.graph);
    write("pois.json", merged.pois);
    if (merged.tenants !== undefined) write("tenants.json", merged.tenants);
    written.push(station);
  }
  return written;
}

function main(): void {
  let privateDir = process.env.GTEKI_PRIVATE_DIR;
  const stations: string[] = [];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--private" && args[i + 1]) privateDir = args[++i];
    else if (args[i] === "--station" && args[i + 1]) stations.push(args[++i]);
    else throw new Error(`unknown or incomplete argument: ${args[i]}`);
  }
  if (!privateDir) throw new Error("set GTEKI_PRIVATE_DIR or pass --private <dir>");
  const repoRoot = process.cwd();
  for (const station of buildOverlay({ repoRoot, privateDir, ...(stations.length ? { stations } : {}) })) {
    const graph = readJson(path.join(privateDir, "overlay", station, "gteki", "graph.json")) as GraphFile;
    const pois = readJson(path.join(privateDir, "overlay", station, "gteki", "pois.json")) as PoiFile;
    console.log(`overlay: ${station} (${graph.nodes.length} nodes, ${graph.edges.length} edges, ${pois.pois.length} pois)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
