// Kit batch 2 (#94): Lane E column pieces as sleeves on the PLATEAU column footprints (scene/columns.json).
// Pins the manifest entries, the copied files, the placement maths (position, yaw, scale), tier selection, the
// load-failure fallback and that the walker's world (walkable, colliders, graph) does not depend on the sleeves.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it, vi } from "vitest";
import columnsJson from "./columns.json";
import kitManifest from "./kit/kit.json";
import { type KitManifest, KIT_TILE_M, pieceUri } from "./kit.ts";
import {
  type Column, type ColumnsFile, SLEEVE_MARGIN_M, SLEEVE_TOP_GAP_M, columnPieces, columnPlacements, loadColumnKit,
} from "./kit_columns.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATION = path.resolve(HERE, "..");
const REPO = path.resolve(STATION, "../..");
const GTEKI = path.join(STATION, "gteki");
const kit = kitManifest as KitManifest;
const file = columnsJson as unknown as ColumnsFile;
const SQUARE = "gteki_column_square_600";
const ROUND = "gteki_column_round_d600";
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const toRenderer = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y); // the shared ENU -> renderer frame
const pieces = columnPieces(kit);

describe("manifest entries and the copied files", () => {
  it("names both column pieces with the plan footprint and height their sleeves scale from (library bounds +-0.305 x 2.8 m)", () => {
    expect(Object.keys(pieces).sort()).toEqual([ROUND, SQUARE]);
    expect(pieces[SQUARE]).toEqual({ footprint_m: 0.61, height_m: 2.8 });
    expect(pieces[ROUND]).toEqual({ footprint_m: 0.61, height_m: 2.8 });
    for (const tier of ["assets/library/manifest.json", "assets/library/mobile/manifest.json"]) {
      const lib = JSON.parse(fs.readFileSync(path.join(REPO, tier), "utf8")).assets as { id: string; bounds_m: { min: number[]; max: number[] } }[];
      for (const id of [SQUARE, ROUND]) {
        const b = lib.find((a) => a.id === id)!.bounds_m;
        expect(b.max[0]! - b.min[0]!, `${tier} ${id}`).toBeCloseTo(0.61, 6);
        expect(b.max[2]! - b.min[2]!, `${tier} ${id}`).toBeCloseTo(0.61, 6);
        expect(b.max[1]! - b.min[1]!, `${tier} ${id}`).toBeCloseTo(2.8, 6);
      }
    }
  });

  it("copies each tier byte for byte from its library, whose manifest records the same sha256, and declares the copies", () => {
    const tiers = [
      { dir: "kit/high", lib: "assets/library/glb", manifest: "assets/library/manifest.json" },
      { dir: "kit/low", lib: "assets/library/mobile/glb", manifest: "assets/library/mobile/manifest.json" },
    ];
    for (const id of [SQUARE, ROUND]) {
      for (const t of tiers) {
        const entry = (JSON.parse(fs.readFileSync(path.join(REPO, t.manifest), "utf8")).assets as { id: string; sha256: string; bytes: number }[]).find((a) => a.id === id)!;
        const copy = path.join(GTEKI, t.dir, `${id}.glb`);
        expect(sha(copy), copy).toBe(sha(path.join(REPO, t.lib, `${id}.glb`)));
        expect(sha(copy), copy).toBe(entry.sha256);
        expect(fs.statSync(copy).size).toBe(entry.bytes);
      }
    }
    for (const f of [path.join(GTEKI, "station.json"), path.join(STATION, "data/graph.src.json")]) {
      const d = JSON.parse(fs.readFileSync(f, "utf8"));
      const b1 = d.assets.find((a: { id: string }) => a.id === "b1");
      const src = d.sources.find((s: { id: string }) => s.id === "gteki-kit-0-1-0");
      for (const id of [SQUARE, ROUND]) {
        for (const dir of ["kit/high", "kit/low"]) {
          expect(b1.files, f).toContain(`${dir}/${id}.glb`);
          expect(src.sha256[`${dir}/${id}.glb`], f).toBe(sha(path.join(GTEKI, dir, `${id}.glb`)));
        }
      }
    }
  });

  it("selects the mobile library for the low tier", () => {
    expect(pieceUri(kit, SQUARE, true)).toBe(`kit/low/${SQUARE}.glb`);
    expect(pieceUri(kit, ROUND, false)).toBe(`kit/high/${ROUND}.glb`);
    expect(fs.statSync(path.join(GTEKI, `kit/low/${SQUARE}.glb`)).size).toBeLessThan(fs.statSync(path.join(GTEKI, `kit/high/${SQUARE}.glb`)).size / 3);
  });
});

describe("placements follow the extracted footprints", () => {
  const placed = columnPlacements(file.columns, pieces);
  const matched = file.columns.filter((c) => c.kit);

  it("places one sleeve per kit-matched column and none for the rest, in file order", () => {
    expect(placed.length).toBe(matched.length);
    expect(placed.map((p) => p.column)).toEqual(matched.map((c) => c.id));
    expect(placed.length).toBe((file.counts.kit_square as number) + (file.counts.kit_round as number));
    for (const c of file.columns.filter((c) => !c.kit)) expect(placed.some((p) => p.column === c.id), c.id).toBe(false);
  });

  it("puts each sleeve on its column's centre and base, rotated by the footprint angle", () => {
    for (const [i, c] of matched.entries()) {
      const p = placed[i]!;
      expect([p.x, p.y, p.z], c.id).toEqual([c.centre[0], c.centre[1], c.base_z]);
      expect(p.yawDeg, c.id).toBe(c.rotation_deg);
      expect(p.piece, c.id).toBe(c.kit);
    }
  });

  it("scales each sleeve to stand 2 cm clear of the PLATEAU faces, never stretched taller, and stopping 1 cm under the top", () => {
    for (const [i, c] of matched.entries()) {
      const p = placed[i]!;
      const w = c.shape === "round" ? c.diameter! : c.width;
      const d = c.shape === "round" ? c.diameter! : c.depth;
      expect(p.sx * 0.61, c.id).toBeCloseTo(w + 2 * SLEEVE_MARGIN_M, 9);
      expect(p.sz * 0.61, c.id).toBeCloseTo(d + 2 * SLEEVE_MARGIN_M, 9);
      expect(p.sy, c.id).toBeLessThanOrEqual(1);
      expect(p.sy * 2.8, c.id).toBeLessThanOrEqual(c.height - SLEEVE_TOP_GAP_M + 1e-9);
      expect(p.sy, c.id).toBeGreaterThan(0.69); // the 1.96 m minimum height: no squashed trims
      expect(p.sx, c.id).toBeGreaterThan(0.6);
      expect(p.sx, c.id).toBeLessThan(1.8);
    }
  });

  it("pure maths on hand-made columns: a rotated rect, a round column, a low column, an unknown piece", () => {
    const base = { source: { installations: ["i"], polygons: ["p"] }, level: "L0", closed: true, base_z: -4.5, depth: 0.5 };
    const cols: Column[] = [
      { ...base, id: "a", centre: [10, 20], shape: "rect", width: 0.7, depth: 0.5, rotation_deg: 100, top_z: -1.5, height: 3, kit: SQUARE },
      { ...base, id: "b", centre: [15, 20], shape: "round", width: 0.7, depth: 0.7, diameter: 0.7, rotation_deg: 0, top_z: -1.7, height: 2.8, kit: ROUND },
      { ...base, id: "c", centre: [20, 20], shape: "square", width: 0.6, depth: 0.6, rotation_deg: 0, top_z: -2.4, height: 2.1, kit: SQUARE },
      { ...base, id: "d", centre: [25, 20], shape: "square", width: 0.6, depth: 0.6, rotation_deg: 0, top_z: -1.5, height: 3, kit: "gteki_not_a_piece" },
      { ...base, id: "e", centre: [30, 20], shape: "polygon", width: 2, depth: 2, rotation_deg: 0, top_z: -1.5, height: 3, kit: null, reason: "irregular" },
    ];
    const out = columnPlacements(cols, pieces);
    expect(out.map((p) => p.column)).toEqual(["a", "b", "c"]);
    expect(out[0]).toMatchObject({ x: 10, y: 20, z: -4.5, yawDeg: 100, piece: SQUARE });
    expect(out[0]!.sx).toBeCloseTo(0.74 / 0.61, 12);
    expect(out[0]!.sz).toBeCloseTo(0.54 / 0.61, 12);
    expect(out[0]!.sy).toBe(1); // 3 m column, 2.8 m piece: not stretched
    expect(out[1]!.sx).toBeCloseTo(0.74 / 0.61, 12);
    expect(out[1]!.sz).toBe(out[1]!.sx);
    expect(out[1]!.sy).toBeCloseTo(2.79 / 2.8, 12); // a 2.8 m column: 1 cm short of the cap
    expect(out[2]!.sy).toBeCloseTo(2.09 / 2.8, 12); // a 2.1 m column: squashed to fit
  });
});

/** A stand-in for what GLTFLoader returns for a kit GLB: root node, VIS_ meshes, COL_ and SOCKET_ nodes. */
function fakeColumn(id: string, parts = 1) {
  const scene = new THREE.Group();
  const root = new THREE.Group();
  root.name = id;
  scene.add(root);
  const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
  for (let i = 0; i < parts; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.61, 2.8, 0.61), mat); // 12 triangles
    m.name = `VIS_part${i}`;
    m.position.set(0, 1.4, 0);
    root.add(m);
  }
  const col = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.8, 0.6), new THREE.MeshBasicMaterial());
  col.name = "COL_column-colonly";
  root.add(col);
  return { scene, scenes: [scene] } as unknown as GLTF;
}

describe("loadColumnKit", () => {
  const host = (files: string[], gltf: (uri: string) => Promise<GLTF> = async (uri) => fakeColumn(uri.includes(ROUND) ? ROUND : SQUARE)) => ({
    assetUrl: vi.fn((uri: string) => (files.includes(uri) ? `/blob/${uri}` : null)),
    loadGlb: vi.fn(gltf),
  });
  const all = (tier: string) => [`kit/${tier}/${SQUARE}.glb`, `kit/${tier}/${ROUND}.glb`];
  const env = new THREE.Texture();
  const wanted = (cols: readonly Column[]) => [...new Set(cols.filter((c) => c.kit).map((c) => c.kit!))].sort();

  it("loads each needed piece once from the tier's folder: high on desktop, low on phones", async () => {
    for (const low of [false, true]) {
      const h = host([...all("high"), ...all("low")]);
      const loaded = await loadColumnKit(THREE, h, kit, file.columns, low);
      expect(h.loadGlb.mock.calls.map((c) => c[0] as string).sort()).toEqual(wanted(file.columns).map((id) => `kit/${low ? "low" : "high"}/${id}.glb`));
      expect(loaded.placements.length).toBe(columnPlacements(file.columns, pieces).length);
    }
  });

  it("dispose() frees every InstancedMesh it built", async () => {
    const loaded = await loadColumnKit(THREE, host(all("high")), kit, file.columns, false);
    const instanced: THREE.InstancedMesh[] = [];
    loaded.build(THREE, env, toRenderer).group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) instanced.push(o as THREE.InstancedMesh); });
    expect(instanced.length).toBeGreaterThan(0);
    const spies = instanced.map((im) => vi.spyOn(im, "dispose"));
    loaded.dispose();
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
  });

  it("drops only the columns of a piece that cannot be loaded, and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onlySquare = await loadColumnKit(THREE, host([`kit/high/${SQUARE}.glb`]), kit, file.columns, false);
    expect(onlySquare.placements.every((p) => p.piece === SQUARE)).toBe(true);
    expect(onlySquare.placements.length).toBe(file.columns.filter((c) => c.kit === SQUARE).length);
    const none = [
      host([]),
      host(all("high"), async () => { throw new Error("404"); }),
      host(all("high"), async () => ({ scene: new THREE.Group() }) as unknown as GLTF),
    ];
    for (const h of none) {
      const loaded = await loadColumnKit(THREE, h, kit, file.columns, false);
      expect(loaded.placements).toEqual([]);
      expect(loaded.build(THREE, env, toRenderer).group.children).toEqual([]);
    }
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("builds InstancedMeshes per piece and tile, counts equal the placements, no collision nodes, bounded by the tile size", async () => {
    const loaded = await loadColumnKit(THREE, host(all("high"), async (u) => fakeColumn(u.includes(ROUND) ? ROUND : SQUARE, 2)), kit, file.columns, false);
    const { group, stats } = loaded.build(THREE, env, toRenderer);
    const meshes = group.children as THREE.InstancedMesh[];
    expect(group.userData.gteki_role).toBe("kit_column");
    expect(meshes.every((m) => m.isInstancedMesh && m.userData.gteki_role === "kit_column")).toBe(true);
    expect(meshes.reduce((n, m) => n + m.count, 0)).toBe(loaded.placements.length * 2); // 2 visible meshes per piece
    expect(stats.modules).toBe(loaded.placements.length);
    expect(stats.trianglesAllTiles).toBe(loaded.placements.length * 2 * 12);
    expect(stats.drawCallsAllTiles).toBe(meshes.length);
    expect(stats.trianglesWorstTile).toBeLessThanOrEqual(stats.trianglesAllTiles);
    // Larger phone tiles never give more draws than desktop tiles for the same one-mesh piece.
    expect(KIT_TILE_M.low).toBeGreaterThan(KIT_TILE_M.high);
    const lowKit = await loadColumnKit(THREE, host(all("low")), kit, file.columns, true);
    const highKit = await loadColumnKit(THREE, host(all("high")), kit, file.columns, false);
    expect(lowKit.build(THREE, env, toRenderer).stats.drawCallsAllTiles).toBeLessThanOrEqual(highKit.build(THREE, env, toRenderer).stats.drawCallsAllTiles);
  });

  it("puts an instance on its column: origin at the footprint centre on the floor, +X along the yaw, scaled as placed", async () => {
    const loaded = await loadColumnKit(THREE, host(all("high")), kit, file.columns, false);
    const { group } = loaded.build(THREE, env, toRenderer);
    const im = group.children[0] as THREE.InstancedMesh; // the fake piece is a box centred 1.4 m above its origin
    const origins = loaded.placements.map((p) => ({ p, w: toRenderer(p.x, p.y, p.z) }));
    for (let i = 0; i < im.count; i++) {
      const m = new THREE.Matrix4().fromArray(im.instanceMatrix.array as Float32Array, i * 16);
      const centre = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
      const hit = origins.find(({ p, w }) => p.piece === im.name.split(":")[1] && centre.distanceTo(new THREE.Vector3(w.x, w.y + 1.4 * p.sy, w.z)) < 1e-3);
      expect(hit, `instance ${i}`).toBeTruthy();
      const { p } = hit!;
      const x = new THREE.Vector3(1, 0, 0).transformDirection(m);
      const want = new THREE.Vector3(Math.cos((p.yawDeg * Math.PI) / 180), 0, -Math.sin((p.yawDeg * Math.PI) / 180)); // ENU (cos, sin) in the renderer frame
      expect(x.distanceTo(want), `instance ${i}`).toBeLessThan(1e-4);
      const s = new THREE.Vector3().setFromMatrixScale(m);
      expect([s.x, s.y, s.z]).toEqual([expect.closeTo(p.sx, 5), expect.closeTo(p.sy, 5), expect.closeTo(p.sz, 5)]);
    }
  });

  it("lights kit materials from the scene environment and leaves the source material alone", async () => {
    const gltf = fakeColumn(SQUARE);
    const loaded = await loadColumnKit(THREE, host(all("high"), async () => gltf), kit, file.columns, false);
    const { group } = loaded.build(THREE, env, toRenderer);
    expect(((group.children[0] as THREE.InstancedMesh).material as THREE.MeshStandardMaterial).envMap).toBe(env);
    expect(((gltf.scene.children[0]!.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).envMap).toBeNull();
  });
});

describe("the walk graph and the walker's world do not depend on the column sleeves", () => {
  it("scene.ts hands the sleeves to `root` only, never to walkable, colliders or the collision assembly", () => {
    const src = fs.readFileSync(path.join(HERE, "scene.ts"), "utf8");
    expect(src).toMatch(/root\.add\(columnKit\.build\(THREE, env, toRenderer\)\.group\)/);
    const lines = src.split("\n").filter((l) => /\bcolumnKit\b|\bcolumnsFile\b/.test(l));
    expect(lines.filter((l) => /walkable|colliders|assembleCollision|tileCollision/.test(l))).toEqual([]);
    const ownSrc = fs.readFileSync(path.join(HERE, "kit_columns.ts"), "utf8");
    expect(ownSrc).not.toMatch(/graph\.json|assembleCollision|tileCollision|gteki_role = "(floor|wall|barriers|stairs_ramps|transport)"/);
  });

  it("the PLATEAU columns stay in the barriers mesh: columns.json is not read by the GLB build or the graph", () => {
    for (const f of ["pipeline/blender_build_glb.py", "pipeline/build_station.py", "pipeline/build_walkfix.py", "pipeline/build_signage.py"]) {
      expect(fs.readFileSync(path.join(STATION, f), "utf8"), f).not.toMatch(/columns\.json/);
    }
    expect(JSON.stringify(JSON.parse(fs.readFileSync(path.join(GTEKI, "graph.json"), "utf8")))).not.toMatch(/column_(square|round)/);
  });
});
