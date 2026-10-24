import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { GraphFile, PoiFile, StationManifestFile } from "@gteki/schema";
import { createSyntheticBundle } from "../../navigation/src/fixtures.ts";

export async function exportFixture(outDir: string): Promise<void> {
  const bundle = createSyntheticBundle();
  const directory = resolve(outDir, "gteki");
  await mkdir(directory, { recursive: true });

  const station: StationManifestFile = {
    schema: bundle.schema,
    station: bundle.station,
    sources: bundle.sources,
    floors: bundle.floors,
    coverage: bundle.coverage,
    ...(bundle.spawnNodeIds ? { spawnNodeIds: bundle.spawnNodeIds } : {}),
    ...(bundle.spawnHeadings ? { spawnHeadings: bundle.spawnHeadings } : {}),
    ...(bundle.assets ? { assets: bundle.assets } : {}),
  };
  const graph: GraphFile = {
    schema: bundle.schema,
    stationId: bundle.station.id,
    nodes: bundle.nodes,
    edges: bundle.edges,
  };
  const pois: PoiFile = {
    schema: bundle.schema,
    stationId: bundle.station.id,
    pois: bundle.pois,
  };

  for (const [name, value] of [["station.json", station], ["graph.json", graph], ["pois.json", pois]] as const) {
    await writeFile(resolve(directory, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
}

async function main(): Promise<void> {
  const outDir = process.argv[2];
  if (!outDir || process.argv.length !== 3) {
    process.stderr.write("Usage: export-fixture.ts <outDir>\n");
    process.exitCode = 2;
    return;
  }
  await exportFixture(outDir);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
