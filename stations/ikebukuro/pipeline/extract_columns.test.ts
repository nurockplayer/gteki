// pipeline/extract_columns.py: column footprints from the PLATEAU EF_25 triangle soup.
// The rule is checked on a synthetic extract (every shape the script must accept, fit or refuse), for determinism, and,
// where the git-ignored build/ubld_enu.json exists, that regenerating gives the committed scene/columns.json byte for
// byte. The committed file is also checked against the committed GLB (no git-ignored inputs): each column's footprint
// corners are barriers vertices at its base and top.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { Column, ColumnsFile } from "../scene/kit_columns.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATION = path.resolve(HERE, "..");
const SCRIPT = path.join(HERE, "extract_columns.py");
const COMMITTED = path.join(STATION, "scene/columns.json");
const REAL_EXTRACT = path.join(STATION, "build/ubld_enu.json");
const python = spawnSync("python3", ["-I", "--version"]).status === 0;

type V3 = [number, number, number];
const scratch: string[] = [];
afterAll(() => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-columns-")); scratch.push(d); return d; };

let nextPoly = 0;
const poly = (outer: V3[]) => ({ id: `poly-${String(nextPoly++).padStart(5, "0")}`, outer: outer.map((v) => v.map((c) => Math.round(c * 1000) / 1000) as V3), holes: [] });

/** Vertical prism over a convex footprint (counter-clockwise), as triangles. `cap`: "fan" from vertex 0, "centre" fan, or none. */
function prism(foot: [number, number][], z0: number, z1: number, cap: "fan" | "centre" | "none" = "fan") {
  const out: ReturnType<typeof poly>[] = [];
  const n = foot.length;
  for (let i = 0; i < n; i++) {
    const [a, b] = [foot[i]!, foot[(i + 1) % n]!];
    out.push(poly([[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1]]), poly([[a[0], a[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]]));
  }
  if (cap === "none") return out;
  for (const z of [z0, z1]) {
    if (cap === "centre") {
      const c: [number, number] = [foot.reduce((s, p) => s + p[0], 0) / n, foot.reduce((s, p) => s + p[1], 0) / n];
      for (let i = 0; i < n; i++) out.push(poly([[c[0], c[1], z], [foot[i]![0], foot[i]![1], z], [foot[(i + 1) % n]![0], foot[(i + 1) % n]![1], z]]));
    } else {
      for (let i = 1; i < n - 1; i++) out.push(poly([[foot[0]![0], foot[0]![1], z], [foot[i]![0], foot[i]![1], z], [foot[i + 1]![0], foot[i + 1]![1], z]]));
    }
  }
  return out;
}
const rotRect = (cx: number, cy: number, w: number, d: number, deg: number): [number, number][] => {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as [number, number][]).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
};
const circle = (cx: number, cy: number, r: number, n: number): [number, number][] =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);

const ROOM = "ubld_x_room1";
function fixture() {
  nextPoly = 0;
  const room1: ReturnType<typeof poly>[] = [];
  const building: ReturnType<typeof poly>[] = [];
  const other: ReturnType<typeof poly>[] = [];
  const Z0 = -4.5;
  room1.push(...prism(rotRect(10, 20, 0.6, 0.6, 30), Z0, Z0 + 3));            // A: square 0.6, rotated 30 deg
  room1.push(...prism(circle(15, 20, 0.35, 16), Z0, Z0 + 3, "centre"));      // B: round, 16 sides, d 0.7
  room1.push(...prism(rotRect(20, 20, 1.2, 0.4, 0), Z0, Z0 + 3));            // C: rect 1.2 x 0.4, aspect 3
  room1.push(...prism(rotRect(25, 20, 0.7, 0.5, 100), Z0, Z0 + 3));          // D: rect 0.7 x 0.5, long axis at 100 deg
  room1.push(...prism(rotRect(40, 20, 6, 0.2, 0), Z0, Z0 + 3));              // E: parapet-like wall prism, 6 m
  room1.push(...[                                                              // F: sloped stair side wall (top edge climbs)
    poly([[50, 20, Z0], [52, 20, Z0], [52, 20, Z0 + 2.5]]), poly([[50, 20, Z0], [52, 20, Z0 + 2.5], [50, 20, Z0 + 1.2]]),
  ]);
  room1.push(...prism([[60, 20], [61.2, 20], [61.2, 20.4], [60.4, 20.4], [60.4, 21.2], [60, 21.2]].map(([x, y]) => [x!, y!] as [number, number]), Z0, Z0 + 3, "none")); // G: L-shape (non-convex), sides only
  room1.push(...prism(rotRect(70, 20, 0.6, 0.6, 0), Z0, Z0 + 0.8));          // H: 0.8 m high stub
  room1.push(...prism(rotRect(80, 20, 0.6, 0.6, 0), Z0, Z0 + 3, "none"));    // I: open square (no caps)
  room1.push(...prism(rotRect(90, 20, 0.3, 0.3, 0), Z0, Z0 + 3));            // K: 0.3 m square, outside the kit range
  room1.push(...prism(rotRect(100, 20, 0.6, 0.6, 0), Z0, Z0 + 1.8));         // M: 1.8 m high, listed but too low for a sleeve
  room1.push(...prism(rotRect(110, 20, 0.1, 0.1, 0), Z0, Z0 + 3));           // thin stub (0.1 m): not a column
  building.push(...prism(rotRect(30, 20, 0.8, 0.8, 0), 3, 6.4));             // L: higher level, in the building-scope installation
  other.push(...prism(rotRect(120, 20, 0.6, 0.6, 0), Z0, Z0 + 3));           // EF_30: not barriers, ignored
  // an A-like square that shares a vertex with a wall: welded into the wall's component, so not found
  room1.push(...prism(rotRect(130, 20, 0.6, 0.6, 0), Z0, Z0 + 3));
  room1.push(poly([[130.3, 20.3, Z0], [134, 20.3, Z0], [134, 20.3, Z0 + 3]]));
  const inst = (id: string, scope: string, fn: string, polygons: ReturnType<typeof poly>[]) => ({ id, scope, function: fn, polygons });
  return {
    schema: "gteki.plateau-ubld-extract/0",
    source: { file: "fixture.gml", sha256: "f".repeat(64), bytes: 1 },
    frame: { origin: { lat: 35.7297, lon: 139.7114, h_m: 0 } },
    installations: [
      inst(`${ROOM}_IntInstallation_EF_25`, ROOM, "EF_25", room1),
      inst("ubld_x_IntInstallation_EF_25", "building", "EF_25", building),
      inst(`${ROOM}_IntInstallation_EF_30`, ROOM, "EF_30", other),
    ],
  };
}

function run(extract: unknown, extra: { station?: boolean } = {}) {
  const dir = tmp();
  const src = path.join(dir, "ubld_enu.json"), dst = path.join(dir, "columns.json"), station = path.join(dir, "station.json");
  fs.writeFileSync(src, JSON.stringify(extract));
  fs.writeFileSync(station, JSON.stringify({ sources: [{ sha256: { "fixture.gml": extra.station === false ? "0".repeat(64) : "f".repeat(64) } }] }));
  const r = spawnSync("python3", ["-I", SCRIPT, src, dst, "--station", station], { encoding: "utf8" });
  return { r, dst, text: r.status === 0 ? fs.readFileSync(dst, "utf8") : "" };
}

describe.skipIf(!python)("extract_columns.py on a synthetic extract", () => {
  const { r, text } = run(fixture());
  const file = r.status === 0 ? (JSON.parse(text) as ColumnsFile & { counts: Record<string, unknown>; levels: { id: string; columns: number }[]; provenance: Record<string, unknown>; source: Record<string, string> }) : null;
  const at = (x: number) => file!.columns.find((c) => Math.abs(c.centre[0] - x) < 0.01 && (c.centre[1] - 20) ** 2 < 1)!;

  it("runs and writes the schema, provenance and counts", () => {
    expect(r.status, r.stderr).toBe(0);
    expect(file!.schema).toBe("gteki.ikebukuro.columns/0");
    expect(file!.source).toMatchObject({ gml: "fixture.gml", gml_sha256: "f".repeat(64) });
    expect(file!.source.extract_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(String(file!.provenance.rule)).toContain("geometry");
    expect(String(file!.provenance.finish)).toContain("generic");
  });

  it("lists the prisms that are columns and refuses the walls, slopes, L-shapes, stubs, other functions and welded cases", () => {
    // listed: A B C D I K M (level L0, by x) then L (L1)
    expect(file!.columns.map((c) => Math.round(c.centre[0]))).toEqual([10, 15, 20, 25, 80, 90, 100, 30]);
    expect(file!.counts.columns).toBe(8);
    expect(file!.counts.rejected).toEqual({ large: 1, not_prism: 3, short: 1, thin: 1 });
    expect(file!.counts.triangles_read).toBeGreaterThan(100);
  });

  it("fits a rotated square: centre, side, rotation in [0, 90), kit square, closed", () => {
    const c = at(10);
    expect(c).toMatchObject({ shape: "square", base_z: -4.5, top_z: -1.5, height: 3, closed: true, kit: "gteki_column_square_600" });
    expect(c.width).toBeCloseTo(0.6, 2);
    expect(c.depth).toBeCloseTo(0.6, 2);
    expect(c.rotation_deg).toBeCloseTo(30, 1);
    expect(c.centre[0]).toBeCloseTo(10, 3);
    expect(c.centre[1]).toBeCloseTo(20, 3);
    expect(c.reason).toBeUndefined();
  });

  it("fits a round column from a 16-gon with a centre point in its caps, and gives its diameter", () => {
    const c = at(15);
    expect(c.shape).toBe("round");
    expect(c.diameter).toBeCloseTo(0.7, 2);
    expect(c.kit).toBe("gteki_column_round_d600");
    expect(c.sides).toBeUndefined();
  });

  it("keeps rectangles: the long side is the width, the angle is mod 180, aspect beyond 1:1.6 gets no piece (but stays listed)", () => {
    const c = at(20);
    expect(c).toMatchObject({ shape: "rect", kit: null });
    expect(c.width).toBeCloseTo(1.2, 2);
    expect(c.depth).toBeCloseTo(0.4, 2);
    expect(c.reason).toMatch(/outside the scalable|beyond 1:/);
    const d = at(25);
    expect(d).toMatchObject({ shape: "rect", kit: "gteki_column_square_600" });
    expect(d.width).toBeCloseTo(0.7, 2);
    expect(d.depth).toBeCloseTo(0.5, 2);
    expect(d.rotation_deg).toBeCloseTo(100, 1);
  });

  it("marks open prisms (no caps) closed:false, small and low columns kit:null with a reason", () => {
    expect(at(80)).toMatchObject({ shape: "square", closed: false, kit: "gteki_column_square_600" });
    const small = at(90);
    expect(small.kit).toBeNull();
    expect(small.reason).toContain("outside the scalable");
    const low = at(100);
    expect(low.kit).toBeNull();
    expect(low.reason).toContain("height 1.80 m");
  });

  it("assigns levels by base height and records the source installations and polygon ids", () => {
    expect(at(30)).toMatchObject({ level: "L1", base_z: 3, top_z: 6.4 });
    expect(at(10).level).toBe("L0");
    expect(file!.levels.map((l) => [l.id, l.columns])).toEqual([["L0", 7], ["L1", 1]]);
    expect(at(10).source.installations).toEqual([`${ROOM}_IntInstallation_EF_25`]);
    expect(at(30).source.installations).toEqual(["ubld_x_IntInstallation_EF_25"]);
    expect(at(10).source.polygons.length).toBe(12); // 4 sides x 2 triangles + 2 fan caps x 2 triangles
    expect(new Set(file!.columns.flatMap((c) => c.source.polygons)).size).toBe(file!.columns.reduce((n, c) => n + c.source.polygons.length, 0)); // no polygon in two columns
  });

  it("numbers columns col_001.. in level, x, y order", () => {
    expect(file!.columns.map((c: Column) => c.id)).toEqual(file!.columns.map((_c, i) => `col_${String(i + 1).padStart(3, "0")}`));
  });

  it("is deterministic: same input, same bytes", () => {
    expect(run(fixture()).text).toBe(text);
  });

  it("refuses an extract whose GML hash is not the one station.json pins", () => {
    const bad = run(fixture(), { station: false });
    expect(bad.r.status).not.toBe(0);
    expect(bad.r.stderr).toContain("does not match station.json");
  });
});

describe("the committed scene/columns.json", () => {
  const file = JSON.parse(fs.readFileSync(COMMITTED, "utf8")) as ColumnsFile & { source: Record<string, string>; counts: Record<string, number> };

  it("cites the extract and its GML, and its counts add up", () => {
    expect(file.counts).toMatchObject({ triangles_read: 10992, columns: 281, kit_square: 42, kit_round: 103, kit_null: 136, open_prisms: 0, by_shape: { polygon: 7, rect: 89, round: 110, square: 75 } });
    expect(file.schema).toBe("gteki.ikebukuro.columns/0");
    expect(file.source.gml).toMatch(/_ubld_.*\.gml$/);
    expect(file.source.gml_sha256).toMatch(/^[0-9a-f]{64}$/);
    const n = file.columns.length;
    expect(file.counts.columns).toBe(n);
    expect(file.counts.kit_square + file.counts.kit_round + file.counts.kit_null).toBe(n);
    expect(file.columns.filter((c) => c.kit === "gteki_column_square_600").length).toBe(file.counts.kit_square);
    expect(file.columns.filter((c) => c.kit === "gteki_column_round_d600").length).toBe(file.counts.kit_round);
  });

  it("gives every column an id, a source, geometry and, when no piece fits, a reason", () => {
    const ids = new Set<string>();
    for (const c of file.columns) {
      expect(ids.has(c.id), c.id).toBe(false);
      ids.add(c.id);
      expect(c.source.installations.length, c.id).toBeGreaterThan(0);
      expect(c.source.polygons.length, c.id).toBeGreaterThanOrEqual(8);
      expect(c.top_z - c.base_z, c.id).toBeCloseTo(c.height, 3);
      expect(c.height, c.id).toBeGreaterThanOrEqual(1.5);
      expect(c.kit === null, c.id).toBe(typeof c.reason === "string");
      if (c.kit) {
        expect(c.shape === "round" ? "gteki_column_round_d600" : "gteki_column_square_600", c.id).toBe(c.kit);
        expect(c.shape, c.id).not.toBe("polygon");
        expect(c.height, c.id).toBeGreaterThanOrEqual(1.96);
      }
    }
  });

  it("matches the committed GLB: every column's base and top corners are barriers vertices", () => {
    const verts = barrierVertices(path.join(STATION, "gteki/assets/ikebukuro_b1.glb"));
    for (const c of file.columns) {
      const r = Math.hypot(c.width, c.depth) / 2 + 0.02;
      const near = verts.filter((v) => Math.hypot(v[0] - c.centre[0], v[1] - c.centre[1]) <= r);
      expect(near.filter((v) => Math.abs(v[2] - c.base_z) < 0.005).length, `${c.id} base`).toBeGreaterThanOrEqual(3);
      expect(near.filter((v) => Math.abs(v[2] - c.top_z) < 0.005).length, `${c.id} top`).toBeGreaterThanOrEqual(3);
    }
  });

  it.skipIf(!python || !fs.existsSync(REAL_EXTRACT))("regenerates byte for byte from build/ubld_enu.json", () => {
    const dir = tmp();
    const dst = path.join(dir, "columns.json");
    const r = spawnSync("python3", ["-I", SCRIPT, REAL_EXTRACT, dst], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(dst, "utf8")).toBe(fs.readFileSync(COMMITTED, "utf8"));
  });
});

/** Vertices (ENU metres) of the meshes tagged `barriers` in a plain GLB; glTF (x, y, z) is ENU (x, -z, y). */
function barrierVertices(file: string): V3[] {
  const b = fs.readFileSync(file);
  const jsonLen = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jsonLen).toString("utf8"));
  const bin = b.subarray(20 + jsonLen + 8);
  const out: V3[] = [];
  for (const node of j.nodes) {
    if (node.extras?.gteki_role !== "barriers" || node.mesh === undefined) continue;
    for (const prim of j.meshes[node.mesh].primitives) {
      const acc = j.accessors[prim.attributes.POSITION];
      const bv = j.bufferViews[acc.bufferView];
      const o0 = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      for (let i = 0; i < acc.count; i++) out.push([bin.readFloatLE(o0 + i * 12), -bin.readFloatLE(o0 + i * 12 + 8), bin.readFloatLE(o0 + i * 12 + 4)]);
    }
  }
  return out;
}
