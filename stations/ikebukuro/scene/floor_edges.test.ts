// pipeline/build_station.py `floor_edges` (#227): a wall piece whose top is level with a walking surface beside it
// (a stairwell wall ending flush with the floor above) leaves the body band; one standing 0.1 m above that floor
// stays a collider. Run on a small extract fixture with the pipeline's own Python.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PIPELINE = join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline");
const python = spawnSync("python3", ["-I", "--version"]).status === 0;

/** Pieces of a vertical wall along x = 2.2 (y 0..4) from z = -3 up to `top`, kept out of the band by floor_edges. */
function excluded(top: number): number[] {
  const dir = mkdtempSync(join(tmpdir(), "gt-floor-edges-"));
  try {
    const floor = { outer: [[0, 0, 0], [2, 0, 0], [2, 4, 0], [0, 4, 0]], holes: [] };
    const wall = { outer: [[2.2, 0, -3], [2.2, 4, -3], [2.2, 4, top], [2.2, 0, top]], holes: [] };
    const extract = {
      rooms: [{ surfaces: [{ type: "FloorSurface", polygons: [floor] }, { type: "InteriorWallSurface", polygons: [wall] }] }],
      installations: [],
    };
    const path = join(dir, "extract.json");
    writeFileSync(path, JSON.stringify(extract));
    const code = [
      "import json, sys",
      `sys.path.insert(0, ${JSON.stringify(PIPELINE)})`,
      "from build_station import collider_segments",
      "from floorquery import Surfaces",
      "segs, _, fe = collider_segments(sys.argv[1], Surfaces(sys.argv[1]))",
      "assert segs, 'fixture wall produced no pieces'",
      "print(json.dumps(sorted(fe)))",
    ].join("\n");
    const r = spawnSync("python3", ["-I", "-c", code, path], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout) as number[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!python)("build_station.py floor_edges", () => {
  it("drops a wall whose top is level with the floor 0.2 m away", () => {
    expect(excluded(0).length).toBeGreaterThan(0);
  });

  it("keeps a wall whose top stands 0.1 m above that floor", () => {
    expect(excluded(0.1)).toEqual([]);
  });
});
