// pipeline/extract_shop_openings.py: door and window panels from the PLATEAU room openings.
// The rule is checked on a synthetic extract and graph (welding per type, width, centre, wall normal and the nearest
// edge along its geometry polyline), for determinism, and, where the git-ignored build/ubld_enu.json exists, that
// regenerating gives the committed scene/shop_openings.json byte for byte.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATION = path.resolve(HERE, "..");
const SCRIPT = path.join(HERE, "extract_shop_openings.py");
const COMMITTED = path.join(STATION, "scene/shop_openings.json");
const REAL_EXTRACT = path.join(STATION, "build/ubld_enu.json");
const python = spawnSync("python3", ["-I", "--version"]).status === 0;

type V3 = [number, number, number];
interface Opening {
  type: "Door" | "Window";
  opening_id: string | string[];
  polygon_ids: string[];
  base_z: number;
  height: number;
  width: number;
  centre: V3;
  normal_deg: number | null;
  nearest_edge: string | null;
  edge_distance_m: number | null;
}
interface ShopFile {
  schema: string;
  source: Record<string, string>;
  frame: Record<string, unknown>;
  counts: { triangles: number; skipped_polygons: number; components: Record<string, number>; total: number };
  openings: Opening[];
}

const scratch: string[] = [];
afterAll(() => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-openings-")); scratch.push(d); return d; };

let nextPoly = 0;
const poly = (outer: V3[]) => ({ id: `poly-${String(nextPoly++).padStart(5, "0")}`, outer: outer.map((v) => v.map((c) => Math.round(c * 1000) / 1000) as V3), holes: [] });

/** A flat panel in the wall plane y = `y`, x from x0 to x1, z from z0 to z1: two triangles. */
const panel = (x0: number, x1: number, z0: number, z1: number, y = 20) =>
  [poly([[x0, y, z0], [x1, y, z0], [x1, y, z1]]), poly([[x0, y, z0], [x1, y, z1], [x0, y, z1]])];

const op = (type: "Door" | "Window", id: string, polygons: ReturnType<typeof poly>[]) =>
  ({ type, id, host: "wall", polygons });

function fixture() {
  nextPoly = 0;
  const room1 = [
    op("Window", "op_w1", [...panel(10, 11, 0, 2), ...panel(11, 12, 0, 2)]), // W1: a 4-triangle band, 2 m wide
    op("Door", "op_d1", panel(40, 41, 0, 2.1)),                              // D1: door panel, 1 m wide
    op("Window", "op_w2", panel(41, 42, 0, 1.5)),                            // W2: shares its corner vertex with D1
    op("Window", "op_w3", [poly([[50, 20, 0], [51, 20, 0], [51, 20, 1]])]),  // W3 + W4: one component, two openings
    op("Window", "op_w4", [poly([[50, 20, 0], [50, 20, 1], [51, 20, 1]])]),
    op("Door", "op_d2", panel(55, 56, 10, 12)),                              // D2: 10 m above the walk graph
  ];
  return {
    schema: "gteki.plateau-ubld-extract/0",
    source: { file: "fixture.gml", sha256: "f".repeat(64), bytes: 1 },
    frame: { origin: { lat: 35.7297, lon: 139.7114, h_m: 0 } },
    rooms: [{ id: "ubld_x_room1", surfaces: [], openings: room1 }],
    installations: [],
  };
}

/** Walk graph: a bent edge that dips to 2.57 m from W1 (its from→to chord would be 5 m away), a straight edge
 *  3 m north of both W1 and D1-W2-W3, and one 5 m up (out of reach in z for every opening's base). */
function graph() {
  const node = (id: string, x: number, y: number, z: number) => ({ id, floorId: "b1", position: { x, y, z } });
  const edge = (id: string, from: string, to: string, geometry: { x: number; y: number; z: number }[]) => ({ id, from, to, geometry });
  return {
    schema: "gteki.graph/0",
    stationId: "fibre",
    nodes: [node("a", 5, 25, 0), node("b", 13, 22, 0), node("c", 20, 25, 0), node("d", 0, 23, 0), node("e", 60, 23, 0), node("f", 0, 30, 5)],
    edges: [
      edge("e_bent", "a", "c", [{ x: 5, y: 25, z: 0 }, { x: 13, y: 22, z: 0 }, { x: 20, y: 25, z: 0 }]),
      edge("e_straight", "d", "e", [{ x: 0, y: 23, z: 0 }, { x: 60, y: 23, z: 0 }]),
      edge("e_high", "f", "e", [{ x: 0, y: 30, z: 5 }, { x: 60, y: 30, z: 5 }]),
    ],
  };
}

function run(extract: unknown, extra: { station?: boolean } = {}) {
  const dir = tmp();
  const src = path.join(dir, "ubld_enu.json"), dst = path.join(dir, "shop_openings.json");
  const station = path.join(dir, "station.json"), g = path.join(dir, "graph.json");
  fs.writeFileSync(src, JSON.stringify(extract));
  fs.writeFileSync(g, JSON.stringify(graph()));
  fs.writeFileSync(station, JSON.stringify({ sources: [{ sha256: { "fixture.gml": extra.station === false ? "0".repeat(64) : "f".repeat(64) } }] }));
  const r = spawnSync("python3", ["-I", SCRIPT, src, dst, "--station", station, "--graph", g], { encoding: "utf8" });
  return { r, dst, text: r.status === 0 ? fs.readFileSync(dst, "utf8") : "" };
}

describe.skipIf(!python)("extract_shop_openings.py on a synthetic extract", () => {
  const { r, text } = run(fixture());
  const file = r.status === 0 ? (JSON.parse(text) as ShopFile) : null;
  const at = (x: number) => file!.openings.find((o) => Math.abs(o.centre[0] - x) < 0.01 && Math.abs(o.centre[2] - 0) < 0.01)!;

  it("runs and writes the schema, source, frame and counts", () => {
    expect(r.status, r.stderr).toBe(0);
    expect(file!.schema).toBe("gteki.ikebukuro.shop-openings/0");
    expect(file!.source).toMatchObject({ gml: "fixture.gml", gml_sha256: "f".repeat(64) });
    expect(file!.source.extract_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(file!.frame.rounding_m).toBe(0.001);
    expect(file!.counts).toMatchObject({ triangles: 12, skipped_polygons: 0, components: { Door: 2, Window: 3 }, total: 5 });
  });

  it("welds per type: a door panel and a window panel sharing a jamb vertex stay two components", () => {
    const d1 = at(40.5);
    expect(d1.type).toBe("Door");
    expect(d1.opening_id).toBe("op_d1");
    expect(d1.polygon_ids.length).toBe(2);
    const w2 = at(41.5);
    expect(w2.type).toBe("Window");
    expect(w2.opening_id).toBe("op_w2");
    expect(w2.polygon_ids.length).toBe(2);
  });

  it("gives a welded band its width, extent-midpoint centre, base and height", () => {
    const w1 = at(11);
    expect(w1).toMatchObject({ type: "Window", base_z: 0, height: 2, width: 2 });
    expect(w1.polygon_ids.length).toBe(4);
    expect(w1.centre).toEqual([11, 20, 0]);
  });

  it("lists every opening id of a component that welds triangles of several openings", () => {
    expect(at(50.5)).toMatchObject({ type: "Window", opening_id: ["op_w3", "op_w4"], width: 1, height: 1 });
  });

  it("measures the nearest edge along its geometry polyline and points the normal at that side", () => {
    // e_bent's from→to chord runs at y = 25, 5 m from W1; only its polyline comes closer (2.57 m), so a chord
    // distance would pick e_straight (3 m) instead.
    const w1 = at(11);
    expect(w1).toMatchObject({ nearest_edge: "e_bent", normal_deg: 90 });
    expect(w1.edge_distance_m).toBeCloseTo(2.575, 2);
    expect(at(40.5)).toMatchObject({ nearest_edge: "e_straight", edge_distance_m: 3, normal_deg: 90 });
  });

  it("gives nulls where no edge is within 1 m in z of the base", () => {
    const d2 = file!.openings.find((o) => Math.abs(o.centre[2] - 10) < 0.01)!;
    expect(d2).toMatchObject({ type: "Door", base_z: 10, height: 2, width: 1, normal_deg: null, nearest_edge: null, edge_distance_m: null });
  });

  it("sorts the rows by type, then centre x and y", () => {
    expect(file!.openings.map((o) => [o.type, o.centre[0]])).toEqual([["Door", 40.5], ["Door", 55.5], ["Window", 11], ["Window", 41.5], ["Window", 50.5]]);
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

describe("the committed scene/shop_openings.json", () => {
  const file = JSON.parse(fs.readFileSync(COMMITTED, "utf8")) as ShopFile;

  it("cites the extract and its GML, and its counts add up", () => {
    expect(file.schema).toBe("gteki.ikebukuro.shop-openings/0");
    expect(file.source.gml).toMatch(/_ubld_.*\.gml$/);
    expect(file.source.gml_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(file.counts.total).toBe(file.openings.length);
    expect(file.counts.components).toMatchObject({ Door: file.openings.filter((o) => o.type === "Door").length, Window: file.openings.filter((o) => o.type === "Window").length });
  });

  it("gives every opening an id, its polygons and a consistent frame", () => {
    for (const o of file.openings) {
      expect((Array.isArray(o.opening_id) ? o.opening_id : [o.opening_id]).length, o.type).toBeGreaterThan(0);
      expect(o.polygon_ids.length).toBeGreaterThan(0);
      expect(o.height).toBeGreaterThan(0);
      expect(o.width).toBeGreaterThan(0);
      expect(o.normal_deg === null).toBe(o.nearest_edge === null);
      expect(o.normal_deg === null).toBe(o.edge_distance_m === null);
      if (o.normal_deg !== null) expect(o.normal_deg).toBeGreaterThanOrEqual(0);
      if (o.normal_deg !== null) expect(o.normal_deg).toBeLessThan(360);
    }
  });

  it("is sorted by type, centre x and centre y", () => {
    const key = file.openings.map((o) => [o.type, o.centre[0], o.centre[1]] as const);
    expect([...key].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1] || a[2] - b[2]))).toEqual(key);
  });

  it.skipIf(!python || !fs.existsSync(REAL_EXTRACT))("regenerates byte for byte from build/ubld_enu.json", () => {
    const dir = tmp();
    const dst = path.join(dir, "shop_openings.json");
    const r = spawnSync("python3", ["-I", SCRIPT, REAL_EXTRACT, dst], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(dst, "utf8")).toBe(fs.readFileSync(COMMITTED, "utf8"));
  });
});
