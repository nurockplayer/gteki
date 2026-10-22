// pipeline/build_station.py `floor_edges` (#227): a wall piece whose top is level with a walking surface beside it
// (a stairwell wall ending flush with the floor above) leaves the body band; one standing 0.1 m above that floor
// stays a collider. A floor-edge piece only drops out for feet within gridnav FLOOR_EDGE_BAND (0.5 m) below its top:
// lower down the same wall still blocks. Run on a small extract fixture with the pipeline's own Python.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PIPELINE = join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline");
const python = spawnSync("python3", ["-I", "--version"]).status === 0;

/** Writes the fixture (a floor at z = 0 for x 0..2, a vertical wall along x = 2.2 from z = -3 up to `top`) and runs
 * `code` on it with the pipeline on sys.path; returns stdout parsed as JSON. */
function run(top: number, code: string[]): unknown {
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
    const head = [
      "import json, sys",
      `sys.path.insert(0, ${JSON.stringify(PIPELINE)})`,
      "from build_station import collider_segments",
      "from floorquery import Surfaces",
      "from gridnav import Grid",
      "surf = Surfaces(sys.argv[1])",
      "segs, sgrid, fe = collider_segments(sys.argv[1], surf)",
      "assert segs, 'fixture wall produced no pieces'",
    ];
    const r = spawnSync("python3", ["-I", "-c", [...head, ...code].join("\n"), path], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const excluded = (top: number) => run(top, ["print(json.dumps(sorted(fe)))"]) as number[];

/** Grid.clearance from a short piece 0.25 m off the wall's floor side (x = 1.95), feet at z, and whether a move
 * across the wall line (x 1.95 -> 2.45) is blocked; the floor-edge set as floor_edges found it. */
const seen = (z: number) =>
  run(0, [
    "g = Grid(surf, segs, sgrid, (0, 1, 0, 1), fe)",
    `print(json.dumps({"clearance": g.clearance(1.95, 1.9, 1.95, 2.1, ${z}), "blocked": g._blocked(1.95, 2, 2.45, 2, ${z})}))`,
  ]) as { clearance: number; blocked: boolean };

describe.skipIf(!python)("build_station.py floor_edges", () => {
  it("drops a wall whose top is level with the floor 0.2 m away", () => {
    expect(excluded(0).length).toBeGreaterThan(0);
  });

  it("keeps a wall whose top stands 0.1 m above that floor", () => {
    expect(excluded(0.1)).toEqual([]);
  });

  it("still blocks with the feet at the wall's foot, and only lets the top pass within 0.5 m below it", () => {
    const low = seen(-3);
    expect(low.clearance).toBeCloseTo(0.25, 6);
    expect(low.blocked).toBe(true);
    const nearTop = seen(-0.45);
    expect(nearTop.clearance).toBe(4); // nothing in the band: the index reach cap
    expect(nearTop.blocked).toBe(false);
  });
});
