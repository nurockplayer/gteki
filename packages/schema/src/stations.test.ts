import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseStationFiles } from "./index.ts";

/**
 * Guard for every station that lands on main: its gteki/ files must pass the fail-closed
 * contract. Extra roots (other worktrees) can be checked locally with GTEKI_STATION_ROOTS.
 */
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const roots = [path.join(repo, "stations"), ...(process.env.GTEKI_STATION_ROOTS ?? "").split(path.delimiter).filter(Boolean)];
const stations = roots.flatMap((root) =>
  fs.existsSync(root)
    ? fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, "gteki", "station.json"))).map((d) => path.join(root, d, "gteki"))
    : [],
);
const read = (dir: string, f: string): unknown => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));

describe.skipIf(stations.length === 0)("station folders satisfy gteki.station/0.1", () => {
  it.each(stations)("%s", (dir) => {
    const parsed = parseStationFiles(read(dir, "station.json"), read(dir, "graph.json"), read(dir, "pois.json"));
    expect(parsed.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(parsed.ok).toBe(true);
  });
});
