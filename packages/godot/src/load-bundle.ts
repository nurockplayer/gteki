/** Loads `<stationDir>/gteki/{station,graph,pois}.json` through the shared fail-closed parser. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseStationFiles, type StationBundle } from "../../schema/src/index.ts";

export async function loadBundle(stationDir: string): Promise<StationBundle> {
  const files = await Promise.all(["station", "graph", "pois"].map(async (name) =>
    JSON.parse(await readFile(resolve(stationDir, "gteki", `${name}.json`), "utf8")) as unknown));
  const parsed = parseStationFiles(files[0], files[1], files[2]);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.bundle;
}
