/** Test oracle for nodes outside the computed route; this does not compute routes. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { enuToRenderer, ENU_TO_RENDERER_MATRIX } from "../../geo/src/index.ts";
import { parseStationFiles } from "../../schema/src/index.ts";

const [stationDir, output] = process.argv.slice(2);
if (!stationDir || !output) throw new Error("Usage: export-reference.ts <stationDir> <output.json>");
const files = await Promise.all(["station", "graph", "pois"].map(async (name) =>
  JSON.parse(await readFile(resolve(stationDir, "gteki", `${name}.json`), "utf8")) as unknown));
const parsed = parseStationFiles(files[0], files[1], files[2]);
if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
const bundle = parsed.bundle;
const floors = new Map(bundle.floors.map((floor) => [floor.id, floor]));
const nodes = bundle.nodes.map((node) => ({
  nodeId: node.id,
  renderer: enuToRenderer({ ...node.position, z: node.position.z ?? node.renderZ ?? floors.get(node.floorId)!.renderElevationM }),
  heightSymbolic: node.position.z === null,
}));
// Nonzero north/up values catch axis/sign errors that the flat start→goal route cannot.
const heightCases = [
  { x: 2, y: 3, z: 0, renderZ: 99, floorId: "upper" },
  { x: 2, y: 3, z: null, renderZ: 7, floorId: "upper" },
  { x: 2, y: 3, z: null, floorId: "upper" },
].map((enu) => ({
  enu,
  renderer: enuToRenderer({ ...enu, z: enu.z ?? enu.renderZ ?? floors.get(enu.floorId)!.renderElevationM }),
  heightSymbolic: enu.z === null,
}));
await writeFile(output, `${JSON.stringify({
  stationId: bundle.station.id, nodeCount: nodes.length, floorCount: bundle.floors.length,
  poiCount: bundle.pois.length, nodes, heightCases, enuToRendererMatrix: ENU_TO_RENDERER_MATRIX,
}, null, 2)}\n`);
