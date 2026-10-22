/**
 * Ground-truth search for one station: the TS `@gteki/search` index, exactly as the web explorer queries it.
 * Usage: search-query.ts <stationDir> <query> [--limit N]   (exit 0 even with no hits; 2 on bad input)
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createSearchIndex, normalizeJa } from "../../search/src/index.ts";
import type { StationBundle } from "../../schema/src/index.ts";
import { loadBundle } from "./load-bundle.ts";

export function runSearch(bundle: StationBundle, query: string, limit = 10) {
  const hits = createSearchIndex(bundle).search(query, { limit });
  return {
    contract: "gteki.search.result/0.1",
    stationId: bundle.station.id,
    query,
    normalized: normalizeJa(query),
    hits: hits.map((h) => ({ poiId: h.poi.id, score: h.score, matched: h.matched, routable: h.routable, nodeIds: h.poi.connectorNodeIds })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const [stationDir, query] = args;
  const limitAt = args.indexOf("--limit");
  const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : 10;
  if (!stationDir || query === undefined || !Number.isInteger(limit) || limit < 0) {
    process.stderr.write("Usage: search-query.ts <stationDir> <query> [--limit N]\n");
    process.exitCode = 2;
  } else {
    process.stdout.write(`${JSON.stringify(runSearch(await loadBundle(stationDir), query, limit), null, 2)}\n`);
  }
}
