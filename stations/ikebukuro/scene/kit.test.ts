// Kit batch 1 (#94): Lane E barrier rails instanced on the access-fence label stretches.
// Pins the ids, counts, tier selection, the sync --check, the credits and that the walker's world is untouched.
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import accessFences from "./access_fences.json";
import kitManifest from "./kit/kit.json";
import graphJson from "../gteki/graph.json";
import { type AccessFences, buildAccessFences, buildFenceCollider } from "./fences.ts";
import {
  FENCE_RAIL_USE, GATE_ARRAY_LABEL, GATE_ARRAY_USE, KIT_TILE_M, MAX_STRETCH, MIN_RAIL_M, RAIL_FACE_OFFSET, type KitGraph, type KitManifest, type KitPiece,
  gatePlacements, gateSites, loadKit, mergeByMaterial, pieceUri, railPlacements, tierDir, tileGroups, tileSize, visibleParts,
} from "./kit.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATION = path.resolve(HERE, "..");
const REPO = path.resolve(STATION, "../..");
const GTEKI = path.join(STATION, "gteki");
const kit = kitManifest as KitManifest;
const fences = accessFences as AccessFences;
const RAIL = "gteki_barrier_rail_2400_solid";
const GATE = "gteki_gate_array_2";
const GATE_NODES = ["g_jr_c1", "g_jr_c2", "g_jr_s"];
// The director's wording (issue #3, 2026-10-22), spelled out here on purpose: the label may not drift in the data.
const LABEL_JA = "代表性擺設，通道數與方向未驗證";
const LABEL_EN = "representative placement; aisle count and orientation unverified";
const graph = graphJson as unknown as KitGraph;
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const toRenderer = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y); // the shared ENU -> renderer frame

describe("kit manifest and the copied files", () => {
  it("names two pieces: the solid 2.4 m barrier rail for the fence stretches and the 2-aisle gate array for the JR gate nodes", () => {
    expect(Object.keys(kit.pieces)).toEqual([RAIL, GATE]);
    expect(kit.pieces[RAIL]).toMatchObject({ use: FENCE_RAIL_USE, pitch_m: 2.4 });
    expect(kit.pieces[GATE]).toMatchObject({ use: GATE_ARRAY_USE, nodes: GATE_NODES });
    expect(kit.credit).toContain("GTEki contributors, CC BY 4.0");
  });

  it("selects the mobile library for the low tier and the full library for the high tier", () => {
    expect(tierDir(kit, true)).toBe("kit/low");
    expect(tierDir(kit, false)).toBe("kit/high");
    expect(pieceUri(kit, RAIL, true)).toBe(`kit/low/${RAIL}.glb`);
    expect(pieceUri(kit, RAIL, false)).toBe(`kit/high/${RAIL}.glb`);
  });

  it("copies each tier byte for byte from its library, whose manifest records the same sha256", () => {
    for (const id of [RAIL, GATE]) {
      const tiers = [
        { gteki: `kit/high/${id}.glb`, lib: `assets/library/glb/${id}.glb`, manifest: "assets/library/manifest.json" },
        { gteki: `kit/low/${id}.glb`, lib: `assets/library/mobile/glb/${id}.glb`, manifest: "assets/library/mobile/manifest.json" },
      ];
      for (const t of tiers) {
        const entry = (JSON.parse(fs.readFileSync(path.join(REPO, t.manifest), "utf8")).assets as { id: string; sha256: string; bytes: number }[]).find((a) => a.id === id)!;
        expect(sha(path.join(GTEKI, t.gteki)), t.gteki).toBe(sha(path.join(REPO, t.lib)));
        expect(sha(path.join(GTEKI, t.gteki)), t.gteki).toBe(entry.sha256);
        expect(fs.statSync(path.join(GTEKI, t.gteki)).size).toBe(entry.bytes);
      }
      // The phone copy is the cheaper one (the point of the tier).
      expect(fs.statSync(path.join(GTEKI, `kit/low/${id}.glb`)).size).toBeLessThan(fs.statSync(path.join(GTEKI, `kit/high/${id}.glb`)).size / 2);
    }
  });

  const python = spawnSync("python3", ["-I", "--version"]).status === 0;
  it.skipIf(!python)("pipeline/sync_kit.py --check passes, and fails when a copy is stale or stray", () => {
    const script = path.join(STATION, "pipeline/sync_kit.py");
    expect(spawnSync("python3", ["-I", script, "--check"], { encoding: "utf8" }).status).toBe(0);
    const stray = path.join(GTEKI, "kit/low/stray.glb");
    fs.writeFileSync(stray, "x");
    try {
      const r = spawnSync("python3", ["-I", script, "--check"], { encoding: "utf8" });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("kit/low/stray.glb is not listed");
    } finally {
      fs.rmSync(stray);
    }
  });

  it("declares both copies under the b1 asset in station.json and graph.src.json, with the kit as a CC BY 4.0 source", () => {
    for (const f of [path.join(GTEKI, "station.json"), path.join(STATION, "data/graph.src.json")]) {
      const d = JSON.parse(fs.readFileSync(f, "utf8"));
      const b1 = d.assets.find((a: { id: string }) => a.id === "b1");
      expect(b1.files, f).toEqual(expect.arrayContaining([`kit/high/${RAIL}.glb`, `kit/low/${RAIL}.glb`, `kit/high/${GATE}.glb`, `kit/low/${GATE}.glb`]));
      expect(b1.sourceIds, f).toContain("gteki-kit-0-1-0");
      const src = d.sources.find((s: { id: string }) => s.id === "gteki-kit-0-1-0");
      expect(src.license.name).toBe("CC BY 4.0");
      expect(src.attribution).toContain("GTEki contributors");
      expect(src.rights).toBe("REUSABLE_WITH_CONDITIONS");
      expect(src.sha256[`kit/high/${RAIL}.glb`]).toBe(sha(path.join(GTEKI, `kit/high/${RAIL}.glb`)));
      expect(src.sha256[`kit/low/${RAIL}.glb`]).toBe(sha(path.join(GTEKI, `kit/low/${RAIL}.glb`)));
      expect(src.sha256[`kit/high/${GATE}.glb`]).toBe(sha(path.join(GTEKI, `kit/high/${GATE}.glb`)));
      expect(src.sha256[`kit/low/${GATE}.glb`]).toBe(sha(path.join(GTEKI, `kit/low/${GATE}.glb`)));
    }
  });

  it("REUSE.toml resolves the copied kit files to CC-BY-4.0, not to the PLATEAU annotation that precedes or follows", () => {
    const toml = fs.readFileSync(path.join(REPO, "REUSE.toml"), "utf8");
    const blocks = toml.split("[[annotations]]").slice(1).map((b) => {
      const body = b.replace(/^\s*#.*$/gm, "");
      const paths = [...(/path\s*=\s*(\[[^\]]*\]|"[^"]*")/s.exec(body)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
      return { paths, license: /SPDX-License-Identifier\s*=\s*"([^"]+)"/.exec(body)?.[1] ?? "" };
    });
    const glob = (g: string) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*") + "$");
    const resolve = (file: string) => blocks.filter((b) => b.paths.some((g) => glob(g).test(file))).at(-1)?.license; // the last matching annotation wins
    for (const tier of ["high", "low"]) for (const id of [RAIL, GATE]) expect(resolve(`stations/ikebukuro/gteki/kit/${tier}/${id}.glb`)).toBe("CC-BY-4.0");
    // Control: the PLATEAU glob still wins for the station's own assets, so the resolver is really reading precedence.
    expect(resolve("stations/ikebukuro/gteki/assets/ikebukuro_b1.glb")).toBe("LicenseRef-PLATEAU-site-policy");
  });
});

describe("rail placements are derived from the existing fence label stretches", () => {
  const pitch = kit.pieces[RAIL]!.pitch_m!;
  const marks = fences.marks;
  const placed = railPlacements(marks, pitch);
  const railedMarks = new Set(placed.map((p) => p.mark));

  it("pins the counts: 80 stretches, 62 get rails (259 modules), 18 shorter than 1.8 m keep the board", () => {
    expect(marks.length).toBe(80);
    expect(railedMarks.size).toBe(62);
    expect(placed.length).toBe(259);
    const len = (m: (typeof marks)[number]) => Math.hypot(m.b[0]! - m.a[0]!, m.b[1]! - m.a[1]!);
    marks.forEach((m, i) => expect(railedMarks.has(i), `mark ${i}`).toBe(len(m) >= MIN_RAIL_M));
  });

  it("puts every module on its stretch, at the stretch's floor height, along its direction, inside the stretch", () => {
    for (const p of placed) {
      const m = marks[p.mark]!;
      const len = Math.hypot(m.b[0]! - m.a[0]!, m.b[1]! - m.a[1]!);
      const u = [(m.b[0]! - m.a[0]!) / len, (m.b[1]! - m.a[1]!) / len];
      expect(p.dir[0]).toBeCloseTo(u[0]!, 12);
      expect(p.dir[1]).toBeCloseTo(u[1]!, 12);
      expect(p.z).toBe(m.z);
      const t = (p.x - m.a[0]!) * u[0]! + (p.y - m.a[1]!) * u[1]!;
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(len);
      expect(Math.abs((p.x - m.a[0]!) * u[1]! - (p.y - m.a[1]!) * u[0]!)).toBeLessThan(1e-9); // on the line
      expect(p.sx).toBeGreaterThanOrEqual(0.55);
      expect(p.sx).toBeLessThanOrEqual(MAX_STRETCH);
    }
  });

  it("covers each stretch end to end with equal modules", () => {
    const byMark = new Map<number, typeof placed>();
    for (const p of placed) byMark.set(p.mark, [...(byMark.get(p.mark) ?? []), p]);
    for (const [i, ps] of byMark) {
      const m = marks[i]!;
      const len = Math.hypot(m.b[0]! - m.a[0]!, m.b[1]! - m.a[1]!);
      expect(ps.reduce((s, p) => s + p.sx * pitch, 0)).toBeCloseTo(len, 9);
    }
  });

  it("is deterministic and does not touch the marks", () => {
    const before = JSON.stringify(marks);
    expect(JSON.stringify(railPlacements(marks, pitch))).toBe(JSON.stringify(placed));
    expect(JSON.stringify(marks)).toBe(before);
  });

  it("groups modules into 16 m tiles on desktop and 32 m tiles on phones (fewer tiles, fewer draws)", () => {
    expect(tileSize(false)).toBe(KIT_TILE_M.high);
    expect(tileSize(true)).toBe(KIT_TILE_M.low);
    const centres = placed.map((p) => toRenderer(p.x, p.y, p.z));
    const high = tileGroups(centres, tileSize(false));
    const low = tileGroups(centres, tileSize(true));
    expect(high.size).toBe(60);
    expect(low.size).toBeLessThan(high.size);
    for (const g of [high, low]) expect([...g.values()].reduce((n, v) => n + v.length, 0)).toBe(placed.length);
  });
});

/** A stand-in for what GLTFLoader returns for a kit GLB: root node named by id, VIS_ meshes, COL_ and SOCKET_ nodes. */
function fakeKit(parts = 1) {
  const scene = new THREE.Group();
  const root = new THREE.Group();
  root.name = RAIL;
  scene.add(root);
  const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
  for (let i = 0; i < parts; i++) {
    const g = new THREE.BoxGeometry(2.4, 1.1, 0.14); // 12 triangles
    const m = new THREE.Mesh(g, mat);
    m.name = `VIS_part${i}`;
    m.position.set(0, 0.55, 0);
    root.add(m);
  }
  const col = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 0.14), new THREE.MeshBasicMaterial());
  col.name = "COL_rail-colonly";
  root.add(col, new THREE.Object3D());
  root.children[root.children.length - 1]!.name = "SOCKET_start";
  return { scene, scenes: [scene] } as unknown as GLTF;
}

describe("loadKit", () => {
  const host = (files: string[], gltf: (uri: string) => Promise<GLTF> = async () => fakeKit()) => ({
    assetUrl: vi.fn((uri: string) => (files.includes(uri) ? `/blob/${uri}` : null)),
    loadGlb: vi.fn(gltf),
  });
  const env = new THREE.Texture();

  it("loads the rail once on desktop and not at all on phones, which keep every procedural board", async () => {
    for (const low of [false, true]) {
      const h = host([`kit/high/${RAIL}.glb`, `kit/low/${RAIL}.glb`]);
      const loaded = await loadKit(THREE, h, kit, fences.marks, low);
      expect(h.loadGlb.mock.calls.map((c) => c[0])).toEqual(low ? [] : [`kit/high/${RAIL}.glb`]);
      expect(loaded.placements.length).toBe(low ? 0 : 259);
      expect(loaded.railed.size).toBe(low ? 0 : 62);
    }
  });

  it("skips the kit (and keeps every procedural board) when the file is missing, fails to load or has no visible mesh", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cases = [
      host([]),
      host([`kit/high/${RAIL}.glb`], async () => { throw new Error("404"); }),
      host([`kit/high/${RAIL}.glb`], async () => ({ scene: new THREE.Group() }) as unknown as GLTF),
    ];
    for (const h of cases) {
      const loaded = await loadKit(THREE, h, kit, fences.marks, false);
      expect(loaded.railed.size).toBe(0);
      expect(loaded.placements).toEqual([]);
      expect(loaded.build(THREE, env, toRenderer).group.children).toEqual([]);
    }
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("builds InstancedMeshes: one per visible mesh per tile, counts equal the placements, no collision nodes", async () => {
    const loaded = await loadKit(THREE, host([`kit/high/${RAIL}.glb`], async () => fakeKit(2)), kit, fences.marks, false);
    const { group, stats } = loaded.build(THREE, env, toRenderer);
    const meshes = group.children as THREE.InstancedMesh[];
    expect(meshes.every((m) => m.isInstancedMesh && m.userData.gteki_role === "kit_fence_rail")).toBe(true);
    expect(meshes.length).toBe(60 * 2); // 60 tiles x 2 visible meshes; COL_ and SOCKET_ are not drawn
    expect(meshes.reduce((n, m) => n + m.count, 0)).toBe(259 * 2);
    expect(stats).toMatchObject({ modules: 259, tiles: 60, drawCallsAllTiles: 120, trianglesAllTiles: 259 * 2 * 12 });
    expect(stats.trianglesWorstTile).toBeLessThanOrEqual(stats.trianglesAllTiles);
    // Visual only: nothing here is a walker collider or a floor.
    expect(group.userData.gteki_role).toBe("kit");
    const sphere = meshes[0]!.boundingSphere;
    expect(sphere && sphere.radius).toBeGreaterThan(0);
  });

  it("lights kit materials from the scene environment and does not alter the source material", async () => {
    const gltf = fakeKit();
    const loaded = await loadKit(THREE, host([`kit/high/${RAIL}.glb`], async () => gltf), kit, fences.marks, false);
    const { group } = loaded.build(THREE, env, toRenderer);
    const used = (group.children[0] as THREE.InstancedMesh).material as THREE.MeshStandardMaterial;
    expect(used.envMap).toBe(env);
    const src = (gltf.scene.children[0]!.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(src.envMap).toBeNull();
  });

  it("places an instance's +X along its stretch, at its position, stretched by sx", async () => {
    const loaded = await loadKit(THREE, host([`kit/high/${RAIL}.glb`]), kit, fences.marks, false);
    const { group } = loaded.build(THREE, env, toRenderer);
    const im = group.children[0] as THREE.InstancedMesh;
    const m = readMatrix(im, 0);
    const centreAtOrigin = new THREE.Vector3(0, 0, 0).applyMatrix4(m); // the box's own centre, 0.55 m above the module origin
    const first = [...loaded.placements].sort((p, q) => toRenderer(p.x, p.y, p.z).add(new THREE.Vector3(0, 0.55, 0)).distanceTo(centreAtOrigin) - toRenderer(q.x, q.y, q.z).add(new THREE.Vector3(0, 0.55, 0)).distanceTo(centreAtOrigin))[0]!;
    const want = toRenderer(first.x, first.y, first.z).add(new THREE.Vector3(0, 0.55, 0));
    expect(centreAtOrigin.distanceTo(want)).toBeLessThan(1e-3); // float32 instance matrices
    const x = new THREE.Vector3(1, 0, 0).transformDirection(m);
    const dir = toRenderer(first.dir[0], first.dir[1], 0).sub(toRenderer(0, 0, 0));
    expect(x.distanceTo(dir)).toBeLessThan(1e-4);
    expect(new THREE.Vector3(1, 0, 0).applyMatrix4(new THREE.Matrix4().extractRotation(m)).length()).toBeCloseTo(1, 6);
    expect(new THREE.Vector3().setFromMatrixScale(m).x).toBeCloseTo(first.sx, 6);
  });
});

function readMatrix(im: THREE.InstancedMesh, i: number) {
  return new THREE.Matrix4().fromArray(im.instanceMatrix.array as Float32Array, i * 16);
}

describe("the access fences: labels move onto the rails, the collider does not change", () => {
  const realDocument = (globalThis as { document?: unknown }).document;
  beforeAll(() => {
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, key: string) => (key in t ? t[key] : () => undefined),
      set: (t, key: string, v) => ((t[key] = v), true),
    });
    (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  });
  afterAll(() => {
    (globalThis as { document?: unknown }).document = realDocument;
  });

  const positions = (mesh: THREE.Mesh) => Array.from(mesh.geometry.getAttribute("position").array as Float32Array);
  const railed = new Set(railPlacements(fences.marks, 2.4).map((p) => p.mark));

  it("leaves the collider identical whether or not any stretch is railed", () => {
    const a = buildAccessFences(THREE, fences, toRenderer);
    const b = buildAccessFences(THREE, fences, toRenderer, railed);
    expect(positions(b.collider)).toEqual(positions(a.collider));
    expect(positions(a.collider)).toEqual(positions(buildFenceCollider(THREE, fences.fences, toRenderer)));
    expect(a.collider.geometry.getAttribute("position").count).toBe(fences.fences.length * 6);
    a.dispose();
    b.dispose();
  });

  it("with no rails builds today's boards; with rails, only railed stretches move, by 7.5 cm along their face normal, and get shorter", () => {
    const a = buildAccessFences(THREE, fences, toRenderer);
    const b = buildAccessFences(THREE, fences, toRenderer, railed);
    const pa = positions(a.visual), pb = positions(b.visual);
    expect(pb.length).toBe(pa.length);
    // each mark owns 2 faces x 6 vertices
    let moved = 0, kept = 0;
    fences.marks.forEach((_m, i) => {
      const lo = i * 36, hi = lo + 36;
      const same = pa.slice(lo, hi).every((v, k) => v === pb[lo + k]);
      if (!railed.has(i)) {
        expect(same, `unrailed mark ${i}`).toBe(true);
        kept++;
        return;
      }
      expect(same).toBe(false);
      moved++;
      // vertex 0 of the first face: the bottom end, shifted by exactly RAIL_FACE_OFFSET, same height
      const d = Math.hypot(pb[lo]! - pa[lo]!, pb[lo + 2]! - pa[lo + 2]!);
      expect(d).toBeCloseTo(RAIL_FACE_OFFSET, 4);
      expect(pb[lo + 1]).toBeCloseTo(pa[lo + 1]!, 6);
      // vertex 2 is the top end: the panel is 1.0 m tall instead of the free-standing 1.2 m board
      expect(pa[lo + 7]! - pb[lo + 7]!).toBeCloseTo(0.2, 4);
    });
    expect(moved).toBe(62);
    expect(kept).toBe(18);
    // the two faces of a railed stretch are pushed to opposite sides
    const i = [...railed][0]!;
    const off = (face: number) => [pb[i * 36 + face * 18]! - pa[i * 36 + face * 18]!, pb[i * 36 + face * 18 + 2]! - pa[i * 36 + face * 18 + 2]!];
    const f0 = off(0), f1 = off(1);
    expect(f0[0]! * f1[0]! + f0[1]! * f1[1]!).toBeLessThan(0);
    a.dispose();
    b.dispose();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Representative gate arrays (director decision, issue #3, 2026-10-22): one generic array per JR gate node, labelled.
// ---------------------------------------------------------------------------------------------------------------------

/** A stand-in for the gate GLB: a marker box (own material) at the first aisle's centre, mid-depth, plus body and 4 flaps. */
function fakeGate(opts: { materials?: number; marker?: boolean; mirrored?: boolean } = {}) {
  const { materials = 1, marker = false, mirrored = false } = opts;
  const scene = new THREE.Group();
  const root = new THREE.Group();
  root.name = GATE;
  scene.add(root);
  const mats = Array.from({ length: materials }, (_, i) => new THREE.MeshStandardMaterial({ color: 0x333333 + i }));
  if (marker) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), new THREE.MeshStandardMaterial({ color: 0xff00ff }));
    m.name = "VIS_marker";
    m.position.set(-0.41, 0, -0.95);
    root.add(m);
  }
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.9, 1.3), mats[0]);
  body.name = "VIS_body";
  body.position.set(0, 0.45, -0.95);
  root.add(body);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.02), mats[i % materials]);
    f.name = `VIS_flap_${i}`;
    f.position.set(-0.7 + i * 0.47, 0.3, -0.95);
    if (mirrored && i === 0) f.scale.set(-1, 1, 1);
    root.add(f);
  }
  const col = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.92, 1.3), new THREE.MeshBasicMaterial());
  col.name = "COL_cabinet_0-colonly";
  root.add(col);
  return { scene, scenes: [scene] } as unknown as GLTF;
}

describe("representative gate arrays: the piece, the sites and the label", () => {
  const piece = kit.pieces[GATE]!;

  it("uses the smallest neutral array: fewest triangles of the bidirectional gate arrays in both tiers, never the one-way piece", () => {
    expect(GATE).not.toMatch(/oneway/);
    for (const m of ["assets/library/manifest.json", "assets/library/mobile/manifest.json"]) {
      const assets = JSON.parse(fs.readFileSync(path.join(REPO, m), "utf8")).assets as {
        id: string; family: string; triangles: number;
        params: { bidirectional: boolean; aisles: number; aisle_centers_x_m: number[] };
        bounds_m: { min: number[]; max: number[] };
      }[];
      const arrays = assets.filter((a) => a.family === "gate" && a.id.startsWith("gteki_gate_array_"));
      expect(arrays.length).toBeGreaterThanOrEqual(4);
      // An array has two or more aisles: the single wide-aisle piece (gteki_gate_array_1w) is not a stand-in for a gate line.
      const neutral = arrays.filter((a) => a.params.bidirectional && a.params.aisles >= 2);
      expect([...neutral].sort((a, b) => a.triangles - b.triangles)[0]!.id, m).toBe(GATE);
      expect(arrays.find((a) => a.id.includes("oneway"))!.params.bidirectional).toBe(false);
      // The anchor numbers in kit.json are the piece's own: its first aisle's centre and its depth.
      const g = assets.find((a) => a.id === GATE)!;
      expect(piece.aisle_centre_x_m).toBe(g.params.aisle_centers_x_m[0]);
      expect(piece.depth_m).toBeCloseTo(-g.bounds_m.min[2]!, 6);
    }
  });

  it("derives the sites from the three nodes' single verified edge, oriented along its last segment as it arrives", () => {
    const sites = gateSites(graph, GATE_NODES);
    expect(sites.map((s) => s.node)).toEqual(GATE_NODES);
    const want: Record<string, { edge: string; dir: [number, number] }> = {
      g_jr_c1: { edge: "c_mid__g_jr_c1", dir: [1, -10.5] }, // (-25, 70) -> (-24, 59.5)
      g_jr_c2: { edge: "g_jr_c2__c_g2", dir: [0, 7] }, // starts at the node, so read backwards: (-14, 71.5) -> (-14, 78.5)
      g_jr_s: { edge: "sp_m__g_jr_s", dir: [-1.5, 6.5] }, // last segment (-68, -37) -> (-69.5, -30.5)
    };
    for (const s of sites) {
      const w = want[s.node]!;
      const n = Math.hypot(w.dir[0], w.dir[1]);
      expect(s.edge).toBe(w.edge);
      expect(s.dir[0]).toBeCloseTo(w.dir[0] / n, 12);
      expect(s.dir[1]).toBeCloseTo(w.dir[1] / n, 12);
      const node = graph.nodes.find((x) => x.id === s.node)!;
      expect([s.x, s.y, s.z]).toEqual([node.position.x, node.position.y, node.position.z]);
      // each of the three nodes has exactly one verified edge, so the rule never has to pick
      expect(graph.edges.filter((e) => e.verification === "verified" && (e.from === s.node || e.to === s.node)).length).toBe(1);
    }
    expect(JSON.stringify(gateSites(graph, GATE_NODES))).toBe(JSON.stringify(sites));
  });

  it("ignores unverified edges, skips a node with no verified edge or no graph entry, and picks the lowest edge id", () => {
    const node = (id: string, x: number, y: number) => ({ id, position: { x, y, z: 3 } });
    const edge = (id: string, from: string, to: string, verification: string, a: [number, number], b: [number, number]) => ({
      id, from, to, verification, geometry: [{ x: a[0], y: a[1], z: 3 }, { x: b[0], y: b[1], z: 3 }],
    });
    const g: KitGraph = {
      nodes: [node("n", 0, 0), node("lonely", 5, 5)],
      edges: [edge("b_edge", "n", "p", "verified", [0, 0], [0, 4]), edge("a_edge", "q", "n", "verified", [-4, 0], [0, 0]), edge("0_unv", "r", "n", "unverified", [0, -4], [0, 0])],
    };
    const s = gateSites(g, ["n", "lonely", "missing"]);
    expect(s.length).toBe(1);
    expect(s[0]).toMatchObject({ node: "n", edge: "a_edge", dir: [1, 0] });
  });

  it("every gate-array placement carries 「代表性擺設，通道數與方向未驗證」 / the English label, and the constant is the director's wording", () => {
    expect(GATE_ARRAY_LABEL).toEqual({ ja: LABEL_JA, en: LABEL_EN });
    expect(piece.representative).toEqual({ ja: LABEL_JA, en: LABEL_EN });
    const placements = gatePlacements(GATE, piece, graph);
    expect(placements.map((p) => p.node)).toEqual(GATE_NODES);
    expect(placements.length).toBe(3);
    for (const p of placements) {
      expect(p.label.ja, p.node).toBe(LABEL_JA);
      expect(p.label.en, p.node).toBe(LABEL_EN);
      expect(p.piece).toBe(GATE);
    }
  });

  it("refuses to place a gate array whose manifest entry lacks the label, or carries a different one", () => {
    const bad: KitPiece[] = [
      { ...piece, representative: undefined },
      { ...piece, representative: { ja: LABEL_JA, en: "verified layout" } },
      { ...piece, representative: { ja: "已驗證", en: LABEL_EN } },
      { ...piece, representative: { ja: LABEL_JA, en: LABEL_EN + "." } },
      { ...piece, use: "something_else" },
      { ...piece, aisle_centre_x_m: undefined },
      { ...piece, nodes: [] },
    ];
    for (const p of bad) expect(gatePlacements(GATE, p, graph), JSON.stringify(p.representative ?? p.use)).toEqual([]);
  });

  it("mergeByMaterial bakes the parts' transforms, merges by material and keeps mirrored parts facing outwards", () => {
    const gltf = fakeGate({ materials: 2, mirrored: true });
    const parts = visibleParts(THREE, gltf);
    expect(parts.length).toBe(5); // body + 4 flaps; COL_ is not drawn
    const merged = mergeByMaterial(THREE, parts);
    expect(merged.length).toBe(2);
    const tris = merged.reduce((n, m) => n + m.geometry.index!.count / 3, 0);
    expect(tris).toBe(5 * 12);
    const box = new THREE.Box3();
    for (const m of merged) box.expandByObject(new THREE.Mesh(m.geometry));
    expect(box.min.z).toBeCloseTo(-0.95 - 0.65, 5); // the body, 1.3 deep, centred at z = -0.95
    expect(box.max.y).toBeCloseTo(0.9, 5);
    // every triangle's geometric normal agrees with its stored vertex normal (a mirrored flap would fail without the winding flip)
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    for (const m of merged) {
      const P = m.geometry.getAttribute("position"), N = m.geometry.getAttribute("normal"), I = m.geometry.index!;
      for (let t = 0; t < I.count; t += 3) {
        a.fromBufferAttribute(P, I.getX(t));
        b.fromBufferAttribute(P, I.getX(t + 1));
        c.fromBufferAttribute(P, I.getX(t + 2));
        n.crossVectors(b.sub(a), c.sub(a));
        expect(n.dot(new THREE.Vector3().fromBufferAttribute(N, I.getX(t)))).toBeGreaterThan(0);
      }
    }
  });
});

describe("representative gate arrays: what loadKit builds", () => {
  const env = new THREE.Texture();
  const files = [`kit/high/${RAIL}.glb`, `kit/low/${RAIL}.glb`, `kit/high/${GATE}.glb`, `kit/low/${GATE}.glb`];
  const host = (gate: () => GLTF = () => fakeGate()) => ({
    assetUrl: vi.fn((uri: string) => (files.includes(uri) ? `/blob/${uri}` : null)),
    loadGlb: vi.fn(async (uri: string) => (uri.includes(GATE) ? gate() : fakeKit())),
  });
  const gateGroup = (g: THREE.Group) => g.children.find((c) => c.name === "ikebukuro_kit_gate_arrays") as THREE.Group | undefined;
  const meshesOf = (g: THREE.Group) => gateGroup(g)!.children as THREE.InstancedMesh[];

  it("loads the gate GLB of the right tier once, and only when a graph is given", async () => {
    for (const low of [false, true]) {
      const h = host();
      const loaded = await loadKit(THREE, h, kit, fences.marks, low, graph);
      // phones load the gate array only (rails are desktop only)
      expect(h.loadGlb.mock.calls.map((c) => c[0]).sort()).toEqual(low ? [`kit/low/${GATE}.glb`] : [`kit/high/${GATE}.glb`, `kit/high/${RAIL}.glb`].sort());
      expect(loaded.gates.map((g) => g.node)).toEqual(GATE_NODES);
      expect(loaded.placements.length).toBe(low ? 0 : 259); // the rails are unchanged on desktop
    }
    const h = host();
    const noGraph = await loadKit(THREE, h, kit, fences.marks, false);
    expect(h.loadGlb.mock.calls.map((c) => c[0])).toEqual([`kit/high/${RAIL}.glb`]);
    expect(noGraph.gates).toEqual([]);
    expect(gateGroup(noGraph.build(THREE, env, toRenderer).group)).toBeUndefined();
  });

  it("puts the label on the gate group and on every gate mesh, in both tiers", async () => {
    for (const low of [false, true]) {
      const loaded = await loadKit(THREE, host(() => fakeGate({ materials: 2 })), kit, fences.marks, low, graph);
      const { group, stats } = loaded.build(THREE, env, toRenderer);
      const gg = gateGroup(group)!;
      expect(gg.userData.gteki_label).toEqual({ ja: LABEL_JA, en: LABEL_EN });
      expect(gg.userData.gteki_note).toContain(LABEL_JA);
      expect(gg.userData.gteki_note).toContain(LABEL_EN);
      const meshes = meshesOf(group);
      expect(meshes.length).toBeGreaterThan(0);
      for (const m of meshes) {
        expect(m.isInstancedMesh).toBe(true);
        expect(m.userData.gteki_role).toBe("kit_gate_array");
        expect(m.userData.gteki_label).toEqual({ ja: LABEL_JA, en: LABEL_EN });
        expect(m.userData.gteki_note).toContain(LABEL_JA);
        expect(m.userData.gteki_note).toContain(LABEL_EN);
      }
      // every placed array is on some labelled mesh
      expect([...new Set(meshes.flatMap((m) => m.userData.gteki_nodes as string[]))].sort()).toEqual([...GATE_NODES].sort());
      expect(stats.gateArrays).toBe(3);
    }
  });

  it("costs one draw on the phone tier however many arrays stand (one palette material), and one draw per material per tile on desktop", async () => {
    const low = await loadKit(THREE, host(() => fakeGate({ materials: 1 })), kit, fences.marks, true, graph);
    const lowBuilt = low.build(THREE, env, toRenderer);
    const lowMeshes = meshesOf(lowBuilt.group);
    expect(lowMeshes.length).toBe(1);
    expect(lowMeshes[0]!.count).toBe(3);
    expect(lowBuilt.stats.gateDrawCallsAll).toBe(1);
    expect(lowBuilt.stats.gateTriangles).toBe(3 * 5 * 12);

    const high = await loadKit(THREE, host(() => fakeGate({ materials: 3 })), kit, fences.marks, false, graph);
    const highBuilt = high.build(THREE, env, toRenderer);
    const hm = meshesOf(highBuilt.group);
    expect(hm.reduce((n, m) => n + m.count, 0)).toBe(3 * 3); // 3 arrays x 3 materials
    expect(highBuilt.stats.gateDrawCallsAll).toBe(hm.length);
    expect(hm.length % 3).toBe(0); // the same materials in every tile that has an array
    expect(highBuilt.stats.gateTriangles).toBe(3 * 5 * 12);
  });

  it("stands the first aisle's centre, at mid-depth, on the node and runs the aisles along the verified edge (its last metres cross no cabinet)", async () => {
    for (const low of [false, true]) {
      const loaded = await loadKit(THREE, host(() => fakeGate({ materials: 1, marker: true })), kit, fences.marks, low, graph);
      const { group } = loaded.build(THREE, env, toRenderer);
      const markers = meshesOf(group).filter((m) => (m.material as THREE.MeshStandardMaterial).color.getHex() === 0xff00ff);
      expect(markers.length).toBeGreaterThan(0);
      let seen = 0;
      for (const im of markers) {
        im.geometry.computeBoundingBox();
        const centre = im.geometry.boundingBox!.getCenter(new THREE.Vector3());
        [-0.41, 0, -0.95].forEach((v, k) => expect(centre.toArray()[k]).toBeCloseTo(v, 5));
        (im.userData.gteki_nodes as string[]).forEach((node, i) => {
          const g = loaded.gates.find((p) => p.node === node)!;
          const m = readMatrix(im, i);
          seen++;
          // the marker lands on the node (plus the 1 cm lift against z-fighting with the floor plate)
          const at = centre.clone().applyMatrix4(m);
          expect(at.distanceTo(toRenderer(g.x, g.y, g.z + (kit.pieces[GATE]!.lift_m ?? 0)))).toBeLessThan(1e-3);
          // the aisles (local -Z) run along the edge's direction of arrival
          const axis = new THREE.Vector3(0, 0, -1).transformDirection(m);
          const dir = toRenderer(g.dir[0], g.dir[1], 0).sub(toRenderer(0, 0, 0));
          expect(axis.distanceTo(dir)).toBeLessThan(1e-4);
          // the edge's points up to 0.9 m before the node sit on the first aisle's centre line, inside the piece's depth
          const inv = m.clone().invert();
          for (const s of [0, 0.3, 0.6, 0.9]) {
            const lift = kit.pieces[GATE]!.lift_m ?? 0;
            const p = toRenderer(g.x - g.dir[0] * s, g.y - g.dir[1] * s, g.z + lift).applyMatrix4(inv);
            expect(p.x, `${node} s=${s}`).toBeCloseTo(-0.41, 3);
            expect(p.y).toBeCloseTo(0, 3);
            expect(p.z).toBeCloseTo(-0.95 + s, 3);
          }
        });
      }
      expect(seen).toBe(3);
    }
  });

  it("builds only visual instances: nothing a walker can collide with, no change to the graph, and the label survives a rebuild", async () => {
    const before = JSON.stringify(graph);
    const loaded = await loadKit(THREE, host(), kit, fences.marks, false, graph);
    const first = loaded.build(THREE, env, toRenderer).group;
    const second = loaded.build(THREE, env, toRenderer).group;
    expect(JSON.stringify(graph)).toBe(before);
    for (const g of [first, second]) {
      const roles = new Set<string>();
      g.traverse((o) => { if (o.userData.gteki_role) roles.add(o.userData.gteki_role as string); });
      expect([...roles].sort()).toEqual(["kit", "kit_fence_rail", "kit_gate_array", "kit_gate_array_group"]);
      for (const m of meshesOf(g)) expect(m.userData.gteki_note).toContain(LABEL_EN);
    }
  });

  it("shows no array when the gate GLB is missing, fails to load or has no visible mesh (and keeps the rails)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cases = [
      { ...host(), assetUrl: vi.fn((uri: string) => (uri.includes(GATE) ? null : `/blob/${uri}`)) },
      { ...host(), loadGlb: vi.fn(async (uri: string) => { if (uri.includes(GATE)) throw new Error("404"); return fakeKit(); }) },
      host(() => ({ scene: new THREE.Group() }) as unknown as GLTF),
    ];
    for (const h of cases) {
      const loaded = await loadKit(THREE, h, kit, fences.marks, false, graph);
      expect(loaded.gates).toEqual([]);
      expect(loaded.placements.length).toBe(259);
      expect(gateGroup(loaded.build(THREE, env, toRenderer).group)).toBeUndefined();
    }
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("does not even fetch the gate GLB when the manifest lacks the label", async () => {
    const stripped: KitManifest = { ...kit, pieces: { ...kit.pieces, [GATE]: { ...kit.pieces[GATE]!, representative: undefined } } };
    const h = host();
    const loaded = await loadKit(THREE, h, stripped, fences.marks, false, graph);
    expect(h.loadGlb.mock.calls.map((c) => c[0])).toEqual([`kit/high/${RAIL}.glb`]);
    expect(loaded.gates).toEqual([]);
  });
});

describe("the representative label is in every place that describes the gate arrays", () => {
  const read = (...p: string[]) => fs.readFileSync(path.join(...p), "utf8");
  const both = (text: string, where: string) => {
    expect(text, where).toContain(LABEL_JA);
    expect(text, where).toContain(LABEL_EN);
  };

  it("station.json and graph.src.json: the kit source (shown in the credits), its notes, and the b1 asset derivation", () => {
    for (const f of [path.join(GTEKI, "station.json"), path.join(STATION, "data/graph.src.json")]) {
      const d = JSON.parse(read(f));
      const src = d.sources.find((s: { id: string }) => s.id === "gteki-kit-0-1-0");
      both(src.attribution, `${f} source.attribution`);
      both(src.notes, `${f} source.notes`);
      expect(src.title, f).toContain("representative gate array");
      const b1 = d.assets.find((a: { id: string }) => a.id === "b1");
      both(b1.derivation, `${f} b1.derivation`);
      expect(b1.derivation, f).toContain(GATE);
    }
  });

  it("kit.json, kit.ts, the gap list and the README", () => {
    both(JSON.stringify(kit.pieces[GATE]!.representative), "kit.json representative");
    expect(kit.pieces[GATE]!.note).toMatch(/REPRESENTATIVE, NOT A SURVEY/);
    both(read(HERE, "kit.ts"), "kit.ts");
    both(read(STATION, "docs/kit-gap-list.md"), "docs/kit-gap-list.md");
    both(read(STATION, "README.md"), "README.md");
  });

  it("the gap list says the arrays are placed and representative, not verified", () => {
    const row = read(STATION, "docs/kit-gap-list.md").split("\n").find((l) => l.startsWith("| 9 |"))!;
    expect(row).toMatch(/placed, representative/);
    expect(row).not.toMatch(/blocked on a decision/);
    expect(row).not.toMatch(/\bverified (layout|array|gate)/i);
  });
});

describe("the walk graph and the walker's world do not depend on the kit", () => {
  it("the scene hands the explorer only the PLATEAU and fence colliders: kit.ts never builds walkable or collider meshes", () => {
    const src = fs.readFileSync(path.join(HERE, "scene.ts"), "utf8");
    // kit goes onto `root` and nowhere else
    expect(src).toMatch(/root\.add\(kit\.build\(THREE, env, toRenderer\)\.group\)/);
    const lines = src.split("\n").filter((l) => /\bkit\b/.test(l));
    expect(lines.filter((l) => /walkable|colliders|assembleCollision|tileCollision/.test(l))).toEqual([]);
    const kitSrc = fs.readFileSync(path.join(HERE, "kit.ts"), "utf8");
    expect(kitSrc).not.toMatch(/graph\.json|gteki_role = "(floor|wall|barriers|stairs_ramps|transport)"/);
  });

  it("does not modify the graph source files the build reads (they carry no kit field)", () => {
    const graph = JSON.parse(fs.readFileSync(path.join(GTEKI, "graph.json"), "utf8"));
    expect(JSON.stringify(graph)).not.toMatch(/kit/i);
    // The edges themselves are pinned by routing.test.ts (golden routes) and walker_replay.test.ts (fence collision);
    // a verified-edge count here would only go stale as the route lane verifies more edges.
  });
});
