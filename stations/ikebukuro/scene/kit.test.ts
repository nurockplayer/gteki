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
import { type AccessFences, buildAccessFences, buildFenceCollider } from "./fences.ts";
import {
  FENCE_RAIL_USE, KIT_TILE_M, MAX_STRETCH, MIN_RAIL_M, RAIL_FACE_OFFSET, type KitManifest, loadKit, pieceUri, railPlacements, tierDir, tileGroups, tileSize,
} from "./kit.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATION = path.resolve(HERE, "..");
const REPO = path.resolve(STATION, "../..");
const GTEKI = path.join(STATION, "gteki");
const kit = kitManifest as KitManifest;
const fences = accessFences as AccessFences;
const RAIL = "gteki_barrier_rail_2400_solid";
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const toRenderer = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y); // the shared ENU -> renderer frame

describe("kit manifest and the copied files", () => {
  it("names the solid 2.4 m barrier rail for the fence stretches (batch 1) and the two column pieces (batch 2, kit_columns.test.ts)", () => {
    expect(Object.keys(kit.pieces)).toEqual([RAIL, "gteki_column_square_600", "gteki_column_round_d600"]);
    expect(kit.pieces[RAIL]).toMatchObject({ use: FENCE_RAIL_USE, pitch_m: 2.4 });
    expect(kit.credit).toContain("GTEki contributors, CC BY 4.0");
  });

  it("selects the mobile library for the low tier and the full library for the high tier", () => {
    expect(tierDir(kit, true)).toBe("kit/low");
    expect(tierDir(kit, false)).toBe("kit/high");
    expect(pieceUri(kit, RAIL, true)).toBe(`kit/low/${RAIL}.glb`);
    expect(pieceUri(kit, RAIL, false)).toBe(`kit/high/${RAIL}.glb`);
  });

  it("copies each tier byte for byte from its library, whose manifest records the same sha256", () => {
    const tiers = [
      { gteki: `kit/high/${RAIL}.glb`, lib: `assets/library/glb/${RAIL}.glb`, manifest: "assets/library/manifest.json" },
      { gteki: `kit/low/${RAIL}.glb`, lib: `assets/library/mobile/glb/${RAIL}.glb`, manifest: "assets/library/mobile/manifest.json" },
    ];
    for (const t of tiers) {
      const entry = (JSON.parse(fs.readFileSync(path.join(REPO, t.manifest), "utf8")).assets as { id: string; sha256: string; bytes: number }[]).find((a) => a.id === RAIL)!;
      expect(sha(path.join(GTEKI, t.gteki)), t.gteki).toBe(sha(path.join(REPO, t.lib)));
      expect(sha(path.join(GTEKI, t.gteki)), t.gteki).toBe(entry.sha256);
      expect(fs.statSync(path.join(GTEKI, t.gteki)).size).toBe(entry.bytes);
    }
    // The phone copy is the cheaper one (the point of the tier).
    expect(fs.statSync(path.join(GTEKI, `kit/low/${RAIL}.glb`)).size).toBeLessThan(fs.statSync(path.join(GTEKI, `kit/high/${RAIL}.glb`)).size / 3);
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
      expect(b1.files, f).toEqual(expect.arrayContaining([`kit/high/${RAIL}.glb`, `kit/low/${RAIL}.glb`]));
      expect(b1.sourceIds, f).toContain("gteki-kit-0-1-0");
      const src = d.sources.find((s: { id: string }) => s.id === "gteki-kit-0-1-0");
      expect(src.license.name).toBe("CC BY 4.0");
      expect(src.attribution).toContain("GTEki contributors");
      expect(src.rights).toBe("REUSABLE_WITH_CONDITIONS");
      expect(src.sha256[`kit/high/${RAIL}.glb`]).toBe(sha(path.join(GTEKI, `kit/high/${RAIL}.glb`)));
      expect(src.sha256[`kit/low/${RAIL}.glb`]).toBe(sha(path.join(GTEKI, `kit/low/${RAIL}.glb`)));
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
    for (const tier of ["high", "low"]) expect(resolve(`stations/ikebukuro/gteki/kit/${tier}/${RAIL}.glb`)).toBe("CC-BY-4.0");
    // Control: the PLATEAU glob still wins for the station's own assets, so the resolver is really reading precedence.
    expect(resolve("stations/ikebukuro/gteki/assets/ikebukuro_b1.glb")).toBe("LicenseRef-PLATEAU-site-policy");
  });
});

describe("rail placements are derived from the existing fence label stretches", () => {
  const pitch = kit.pieces[RAIL]!.pitch_m;
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

  it("loads the high-tier file on desktop and the low-tier file on phones, once", async () => {
    for (const low of [false, true]) {
      const h = host([`kit/high/${RAIL}.glb`, `kit/low/${RAIL}.glb`]);
      const loaded = await loadKit(THREE, h, kit, fences.marks, low);
      expect(h.loadGlb.mock.calls.map((c) => c[0])).toEqual([`kit/${low ? "low" : "high"}/${RAIL}.glb`]);
      expect(loaded.placements.length).toBe(259);
      expect(loaded.railed.size).toBe(62);
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
    expect(group.userData.gteki_role).toBe("kit_fence_rail");
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
    // The edges themselves are pinned by routing.test.ts (golden routes) and walker_replay.test.ts (fence collision).
    expect(graph.edges.filter((e: { verification: string }) => e.verification === "verified").length).toBe(63);
  });
});
