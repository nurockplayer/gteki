// G1 evidence: CRS (EPSG:6697) -> station-local ENU -> renderer, for Ikebukuro.
//
// What this proves, in code:
//  1. the shared packages/geo ENU <-> renderer mapping, (x, z, -y), round-trips every station node and edge vertex
//     bit-exactly, and the scene places its geometry through whatever `ctx.enuToRenderer` it is handed (checked on
//     the walk-bridge quads, with the real mapping and with a different one);
//  2. the committed GLB is in the renderer frame that mapping produces: every mesh's POSITION bounds are the
//     build-time ENU bounds (meta.json bbox_enu) mapped by enuToRenderer, and the graph sits inside the GLB;
//  3. the three implementations of the station frame agree on the station origin from station.json to 1 cm
//     across the whole footprint: the Python the GLB is built with (pipeline/extract_plateau_ubld.py),
//     packages/geo StationFrame and tools/gis stationEnuProjector;
//  4. when the extracted PLATEAU JSON (git-ignored build output) is present, its vertices are in the GLB.
//
// What it cannot prove: the PLATEAU source GML (35 MB, not committed; fetch_sources.sh) is not read here, so
// "GML lat/lon/h -> GLB vertex" is shown as Python-vs-TS agreement on synthetic points plus extract-JSON ->
// GLB, never from the GML's own coordinates. Run with GTEKI_UBLD_ENU=<path to ubld_enu.json> for check 4.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { assembleCollision } from "./scene.ts";
import { ENU_TO_RENDERER_MATRIX, StationFrame, enuToRenderer, rendererToEnu } from "../../../packages/geo/src/index.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const REPO = new URL("../../..", import.meta.url).pathname;
const readJson = (rel: string) => JSON.parse(fs.readFileSync(ROOT + rel, "utf8"));

interface P3 { x: number; y: number; z: number }
const station = readJson("gteki/station.json") as { sources: { id: string; sha256?: Record<string, string> }[]; station: { origin: { lat: number; lon: number; hM: number } } };
const graph = readJson("gteki/graph.json") as { nodes: { id: string; position: P3 }[]; edges: { id: string; geometry?: P3[] }[] };
const origin = station.station.origin;
// tools/gis is a standalone package (its own dependencies, e.g. yaml, are not this package's), so it is loaded at
// run time by path instead of through the type checker.
const GIS_STATION_ENU = REPO + "tools/gis/src/station-enu.ts";
const { stationEnuProjector } = (await import(/* @vite-ignore */ GIS_STATION_ENU)) as {
  stationEnuProjector: (o: { lat: number; lon: number; hM: number }) => (lat: number, lon: number, h: number) => [number, number, number];
};

/** Minimal GLB reader: node name -> POSITION accessor (declared bounds and the actual float data). */
function readGlb(rel: string) {
  const buf = fs.readFileSync(ROOT + rel);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const binStart = 20 + jsonLen + 8;
  const meshes = new Map<string, { min: number[]; max: number[]; positions: Float32Array }>();
  for (const node of json.nodes as { name: string; mesh?: number; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[]) {
    if (node.mesh === undefined) continue;
    expect(node.matrix ?? node.translation ?? node.rotation ?? node.scale, `${node.name} has no node transform (identity)`).toBeUndefined();
    const acc = json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION];
    const view = json.bufferViews[acc.bufferView];
    expect(acc.componentType).toBe(5126);
    expect(view.byteStride).toBeUndefined();
    const start = binStart + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const copy = new Uint8Array(buf.subarray(start, start + acc.count * 12)).buffer;
    meshes.set(node.name, { min: acc.min, max: acc.max, positions: new Float32Array(copy) });
  }
  return meshes;
}

describe("ENU <-> renderer mapping the scene uses", () => {
  it("is (x, z, -y), as the scene API documents", () => {
    expect(enuToRenderer({ x: 3, y: 5, z: 7 })).toEqual([3, 7, -5]);
    // glTF column-major matrix of the same mapping (what Godot/engines take as a node transform).
    const m = ENU_TO_RENDERER_MATRIX;
    const apply = (p: P3) => [m[0]! * p.x + m[4]! * p.y + m[8]! * p.z, m[1]! * p.x + m[5]! * p.y + m[9]! * p.z, m[2]! * p.x + m[6]! * p.y + m[10]! * p.z];
    expect(apply({ x: 3, y: 5, z: 7 }).map((v) => v + 0)).toEqual([3, 7, -5]);
  });

  it("the scene places its geometry through the ctx.enuToRenderer it is given, not a mapping of its own (walk-bridge quads)", () => {
    const quads = (readJson("scene/walk_bridges.json") as { quads: number[][][] }).quads;
    expect(quads.length).toBeGreaterThan(100);
    const build = (mapping: (p: P3) => [number, number, number]) => {
      const parts = assembleCollision(THREE, new THREE.Group(), {
        materialFor: () => undefined,
        toRenderer: (x, y, z) => new THREE.Vector3(...mapping({ x, y, z })),
        enuToRenderer: mapping,
        fenceCollider: new THREE.Group(),
      });
      return Array.from(parts.bridges!.geometry.getAttribute("position").array as Float32Array);
    };
    // (a) with the shared packages/geo mapping, each vertex lands at the (x, z, -y) the scene API documents.
    const byHand = quads.flatMap((q) => q.flatMap(([x, y, z]) => [x!, z!, -y!].map(Math.fround)));
    expect(build((p) => enuToRenderer(p))).toEqual(byHand);
    // (b) with a deliberately different mapping the geometry follows it, so the scene has no mapping of its own.
    const shifted = (p: P3): [number, number, number] => [p.x + 1000, p.z + 2000, -p.y + 3000];
    expect(build(shifted)).toEqual(quads.flatMap((q) => q.flatMap(([x, y, z]) => shifted({ x: x!, y: y!, z: z! }).map(Math.fround))));
    expect(build(shifted)).not.toEqual(byHand);
  });

  it("scene.ts derives its own toRenderer from ctx.enuToRenderer (station-local guard; buildScene itself needs a WebGL renderer)", () => {
    // buildScene cannot run under node (environment map, sign canvases), so this stays a check on the station's own file.
    // That the explorer hands the scene packages/geo's enuToRenderer is core's contract and core's test.
    const sceneSrc = fs.readFileSync(ROOT + "scene/scene.ts", "utf8");
    expect(sceneSrc).toMatch(/toRenderer = \(x: number, y: number, z: number\) => new THREE\.Vector3\(\.\.\.ctx\.enuToRenderer\(\{ x, y, z \}\)\)/);
  });

  it("round-trips every station node and edge vertex exactly (renderer -> ENU gives the stored value back)", () => {
    const points: P3[] = [...graph.nodes.map((n) => n.position), ...graph.edges.flatMap((e) => e.geometry ?? [])];
    expect(points.length).toBeGreaterThan(300);
    for (const p of points) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
      const back = rendererToEnu(enuToRenderer(p));
      // `+ 0` folds -0 into 0 (north 0 maps to renderer z -0).
      expect([back.x + 0, back.y + 0, back.z + 0]).toEqual([p.x + 0, p.y + 0, p.z + 0]);
    }
  });
});

describe("the committed GLBs are in the renderer frame enuToRenderer produces", () => {
  const meta = readJson("gteki/assets/ikebukuro_b1.meta.json") as {
    source: { sha256: string };
    frame: { origin: { lat: number; lon: number; h_m: number } };
    categories: Record<string, { bbox_enu: { min: number[]; max: number[] } }>;
  };

  it("meta.json records the same origin and source hash as station.json", () => {
    expect(meta.frame.origin).toEqual({ lat: origin.lat, lon: origin.lon, h_m: origin.hM });
    const src = station.sources.find((s) => s.id === "plateau-ubld-13116")!;
    expect(Object.values(src.sha256 ?? {})).toEqual([meta.source.sha256]);
  });

  for (const file of ["gteki/assets/ikebukuro_b1.glb", "gteki/assets/ikebukuro_b1_lit.glb"]) {
    it(`${file.split("/").pop()}: every mesh's POSITION bounds are meta.json's ENU bounds mapped by enuToRenderer (<= 1 mm)`, () => {
      const meshes = readGlb(file);
      let compared = 0;
      for (const [name, cat] of Object.entries(meta.categories)) {
        const mesh = meshes.get(name);
        if (!mesh) continue; // the lit variant may add meshes; categories absent from it are not compared
        const [lo, hi] = [enuToRenderer({ x: cat.bbox_enu.min[0]!, y: cat.bbox_enu.min[1]!, z: cat.bbox_enu.min[2]! }), enuToRenderer({ x: cat.bbox_enu.max[0]!, y: cat.bbox_enu.max[1]!, z: cat.bbox_enu.max[2]! })];
        // north flips sign, so the renderer min/max of z come from the opposite corners.
        const expectMin = [Math.min(lo[0], hi[0]), Math.min(lo[1], hi[1]), Math.min(lo[2], hi[2])];
        const expectMax = [Math.max(lo[0], hi[0]), Math.max(lo[1], hi[1]), Math.max(lo[2], hi[2])];
        mesh.min.forEach((v, i) => expect(Math.abs(v - expectMin[i]!), `${name} min[${i}]`).toBeLessThan(1e-3));
        mesh.max.forEach((v, i) => expect(Math.abs(v - expectMax[i]!), `${name} max[${i}]`).toBeLessThan(1e-3));
        // The declared bounds are the real data, not stale metadata.
        const p = mesh.positions;
        const lo2 = [Infinity, Infinity, Infinity];
        const hi2 = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < p.length; i++) { lo2[i % 3] = Math.min(lo2[i % 3]!, p[i]!); hi2[i % 3] = Math.max(hi2[i % 3]!, p[i]!); }
        lo2.forEach((v, i) => expect(Math.abs(v - mesh.min[i]!), `${name} data min[${i}]`).toBeLessThan(1e-4));
        hi2.forEach((v, i) => expect(Math.abs(v - mesh.max[i]!), `${name} data max[${i}]`).toBeLessThan(1e-4));
        compared++;
      }
      expect(compared).toBeGreaterThanOrEqual(8);
    });
  }

  it("the graph sits inside the GLB in the same frame: every node's renderer position is within the GLB's bounds (+1 m, +street rise)", () => {
    const meshes = [...readGlb("gteki/assets/ikebukuro_b1.glb").values()];
    const lo = [0, 1, 2].map((i) => Math.min(...meshes.map((m) => m.min[i]!)));
    const hi = [0, 1, 2].map((i) => Math.max(...meshes.map((m) => m.max[i]!)));
    for (const n of graph.nodes) {
      const r = enuToRenderer(n.position);
      for (let i = 0; i < 3; i++) {
        expect(r[i]!, `${n.id} axis ${i}`).toBeGreaterThanOrEqual(lo[i]! - 1);
        expect(r[i]!, `${n.id} axis ${i}`).toBeLessThanOrEqual(hi[i]! + 1);
      }
    }
  });
});

describe("station frame: station.json origin, Python pipeline, packages/geo and tools/gis agree", () => {
  const frame = new StationFrame({ lat: origin.lat, lon: origin.lon, h: origin.hM });
  const project = stationEnuProjector(origin);
  // Synthetic footprint grid in station-local metres (the ubld footprint is about -182..178 x -183..185 m).
  const grid: P3[] = [];
  for (const x of [-190.1237, -100.5551, 0, 100.4449, 190.7311]) for (const y of [-190.3219, -60.0777, 0, 60.9213, 190.6481]) for (const z of [25.9, 30.0004, 33.2]) grid.push({ x, y, z });
  const geodetic = grid.map((p) => frame.toGeodetic(p));

  it("packages/geo and tools/gis project the same (lat, lon, h) to the same station point (<= 1 mm)", () => {
    geodetic.forEach((g, i) => {
      const a = frame.toLocal(g);
      const [x, y, z] = project(g.lat, g.lon, g.h);
      expect(Math.hypot(a.x - x, a.y - y), `grid ${i}`).toBeLessThan(1e-3);
      expect(z).toBeCloseTo(a.z, 9);
      // and both return the station point the grid started from
      expect(Math.hypot(a.x - grid[i]!.x, a.y - grid[i]!.y)).toBeLessThan(1e-3);
      expect(a.z).toBeCloseTo(grid[i]!.z, 9);
    });
  });

  it("the Python extractor the GLB is built with (extract_plateau_ubld.to_enu) agrees with them to 1 cm", () => {
    const script = [
      "import importlib.util, json, sys",
      "spec = importlib.util.spec_from_file_location('ex', sys.argv[1])",
      "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
      "pts = json.load(sys.stdin)",
      "print(json.dumps({'origin': m.ORIGIN, 'enu': [m.to_enu(*p) for p in pts]}))",
    ].join("\n");
    const run = spawnSync("python3", ["-I", "-c", script, ROOT + "pipeline/extract_plateau_ubld.py"], { input: JSON.stringify(geodetic.map((g) => [g.lat, g.lon, g.h])), encoding: "utf8" });
    if (run.error) { console.warn("python3 not available; Python-vs-TS frame check skipped"); return; }
    expect(run.status, run.stderr).toBe(0);
    const out = JSON.parse(run.stdout) as { origin: { lat: number; lon: number; h_m: number }; enu: number[][] };
    expect(out.origin).toEqual({ lat: origin.lat, lon: origin.lon, h_m: origin.hM });
    expect(out.enu).toHaveLength(grid.length);
    let worst = 0;
    out.enu.forEach((e, i) => {
      const g = grid[i]!;
      worst = Math.max(worst, Math.hypot(e[0]! - g.x, e[1]! - g.y), Math.abs(e[2]! - g.z));
    });
    console.info(`python extractor vs packages/geo over ${grid.length} footprint points: worst ${(worst * 1000).toFixed(3)} mm`);
    expect(worst).toBeLessThan(0.01);
  });

  it("the footprint of the committed GLB lies within 300 m of the station origin on the ground (CRS sanity)", () => {
    const meshes = [...readGlb("gteki/assets/ikebukuro_b1.glb").values()];
    const lo = [0, 1, 2].map((i) => Math.min(...meshes.map((m) => m.min[i]!)));
    const hi = [0, 1, 2].map((i) => Math.max(...meshes.map((m) => m.max[i]!)));
    for (const corner of [[lo[0]!, lo[2]!], [lo[0]!, hi[2]!], [hi[0]!, lo[2]!], [hi[0]!, hi[2]!]] as const) {
      const g = frame.toGeodetic({ x: corner[0], y: -corner[1], z: 30 });
      // Ikebukuro Station is at about 35.7295 N, 139.7109 E; PLATEAU tile 53394576 covers this footprint.
      expect(Math.abs(g.lat - 35.7295)).toBeLessThan(0.003);
      expect(Math.abs(g.lon - 139.7109)).toBeLessThan(0.004);
    }
  });
});

describe.skipIf(!process.env.GTEKI_UBLD_ENU || !fs.existsSync(process.env.GTEKI_UBLD_ENU))("extracted PLATEAU JSON (git-ignored build output) -> committed GLB", () => {
  it("records the station.json source hash, and its polygon vertices are in the GLB (renderer frame, <= 1 cm)", () => {
    const ubld = JSON.parse(fs.readFileSync(process.env.GTEKI_UBLD_ENU!, "utf8")) as {
      source: { sha256: string };
      rooms: { surfaces: { polygons: { outer: number[][] }[] }[]; openings: { polygons: { outer: number[][] }[] }[] }[];
      installations: { polygons: { outer: number[][] }[] }[];
    };
    const src = station.sources.find((s) => s.id === "plateau-ubld-13116")!;
    expect(Object.values(src.sha256 ?? {})).toEqual([ubld.source.sha256]);

    // Spatial hash of all GLB vertices, 1 m cells.
    const cell = new Map<string, number[]>();
    for (const m of readGlb("gteki/assets/ikebukuro_b1.glb").values()) {
      const p = m.positions;
      for (let i = 0; i < p.length; i += 3) {
        const k = `${Math.floor(p[i]!)},${Math.floor(p[i + 1]!)},${Math.floor(p[i + 2]!)}`;
        (cell.get(k) ?? cell.set(k, []).get(k)!).push(p[i]!, p[i + 1]!, p[i + 2]!);
      }
    }
    const near = (r: number[]) => {
      let best = Infinity;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const c = cell.get(`${Math.floor(r[0]!) + dx},${Math.floor(r[1]!) + dy},${Math.floor(r[2]!) + dz}`);
        if (c) for (let i = 0; i < c.length; i += 3) best = Math.min(best, Math.hypot(c[i]! - r[0]!, c[i + 1]! - r[1]!, c[i + 2]! - r[2]!));
      }
      return best;
    };
    // Exactly the classes blender_build_glb.py meshes: room surfaces, openings and installations. The exterior
    // `shell` is deliberately not in the GLB.
    const polys = [...ubld.rooms.flatMap((r) => [...r.surfaces, ...r.openings].flatMap((s) => s.polygons)), ...ubld.installations.flatMap((i) => i.polygons)];
    let checked = 0;
    let inGlb = 0;
    polys.forEach((poly, pi) => {
      if (pi % 7 !== 0) return;
      for (const v of poly.outer) {
        checked++;
        if (near(enuToRenderer({ x: v[0]!, y: v[1]!, z: v[2]! })) < 0.01) inGlb++;
      }
    });
    console.info(`ubld_enu.json -> GLB: ${inGlb}/${checked} sampled polygon vertices within 1 cm`);
    expect(checked).toBeGreaterThan(1000);
    expect(inGlb / checked).toBeGreaterThan(0.99);
  });
});
