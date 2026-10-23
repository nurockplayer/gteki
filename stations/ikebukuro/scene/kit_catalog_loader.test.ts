// Lane E station catalog (#94): batch A (the 5 escalators) and batch B (the 21 stair handrails) placed on the surveyed
// anchors of scene/kit_placements.json. Pins the batches (desktop tier only), the placement maths, the tier and batch
// filters, disposal, and that the copies, declarations and credits agree with each other and with Lane E's manifest.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it, vi } from "vitest";
import kitPlacements from "./kit_placements.json";
import kitCatalog from "./kit_catalog.json";
import { type CatalogPlacement, catalogUri, loadKitCatalog, piecePose, tierName, tierParts } from "./kit_catalog_loader.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATION = path.resolve(HERE, "..");
const GTEKI = path.join(STATION, "gteki");
const placements = (kitPlacements as unknown as { placements: CatalogPlacement[] }).placements;
/** What the loader sees on the desktop tier: the escalator anchors (the batch is filtered by which GLBs are served). */
const escalators = placements.filter((p) => p.kind === "escalator");
const stairs = placements.filter((p) => p.kind === "stair");
const catalog = kitCatalog as { assets: { id: string; generator: string }[] };
const ESCALATOR_IDS = catalog.assets.filter((a) => a.generator === "escalator_dressing").map((a) => a.id).sort();
/** The 21 rail ids a `main_route` flight actually draws (the catalog has 57; the rest have empty tiers). */
const RAILS_IDS = [...new Set(tierParts(stairs, false).map((w) => w.id).filter((id) => id.includes("_rails_")))].sort();
/** Ids the station ships (batch A + B); every other catalog id is "not in this batch". */
const SHIPPED = new Set([...ESCALATOR_IDS, ...RAILS_IDS]);
/** The catalog copies the placements need, per tier: the batch plan sync_kit_catalog.py copies. */
function plannedUris(low: boolean): string[] {
  const tier = tierName(low);
  const out = new Set<string>();
  for (const p of placements)
    for (const [part, id] of Object.entries(p.ids)) if (SHIPPED.has(id) && (p.tiers[part] ?? []).includes(tier)) out.add(catalogUri(id, low));
  return [...out].sort();
}
const SOURCE_ID = "gteki-ikb-catalog-0-1-0";
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const toRenderer = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y); // the shared ENU -> renderer frame
const readManifest = (name: string) => JSON.parse(fs.readFileSync(path.join(GTEKI, name), "utf8"));

describe("the shipped batches on the surveyed anchors", () => {
  it("draws every escalator part on the desktop tier and none on phones", () => {
    const high = tierParts(escalators, false);
    const low = tierParts(escalators, true);
    expect(ESCALATOR_IDS.length).toBe(5);
    expect(high.length).toBe(5); // one `dressing` part per anchor
    expect(high.map((w) => w.placement.anchor).sort()).toEqual(["esc01_l1", "esc01_l2", "esc02_l1", "esc03_l1", "esc03_l2"]);
    expect(new Set(high.map((w) => w.id))).toEqual(new Set(ESCALATOR_IDS));
    expect(low).toEqual([]); // every escalator placement lists `high` alone
    expect(tierName(true)).toBe("low");
    expect(tierName(false)).toBe("high");
    expect(catalogUri(ESCALATOR_IDS[0]!, false)).toBe(`kit/catalog/high/${ESCALATOR_IDS[0]}.glb`);
  });

  it("draws the handrails on the desktop tier only, one part per main_route flight", () => {
    const high = tierParts(stairs, false).filter((w) => SHIPPED.has(w.id) && w.id.includes("_rails_"));
    expect(RAILS_IDS.length).toBe(21);
    expect(high.length).toBe(21); // 21 main_route flights, one rail part each
    expect(new Set(high.map((w) => w.id))).toEqual(new Set(RAILS_IDS));
    expect(tierParts(stairs, true).filter((w) => w.id.includes("_rails_"))).toEqual([]); // rails are high only
  });

  it("ships each shipped id on disk, and no phone copy", () => {
    for (const id of SHIPPED) expect(fs.existsSync(path.join(GTEKI, catalogUri(id, false))), id).toBe(true);
    expect(fs.existsSync(path.join(GTEKI, "kit/catalog/low"))).toBe(false); // both batches draw nothing on phones
  });

  it("copies each id byte for byte, pinned by the source record in both manifests", () => {
    const station = readManifest("station.json");
    const src = JSON.parse(fs.readFileSync(path.join(STATION, "data/graph.src.json"), "utf8"));
    const a = station.sources.find((s: { id: string }) => s.id === SOURCE_ID);
    const b = src.sources.find((s: { id: string }) => s.id === SOURCE_ID);
    expect(a).toEqual(b); // the two manifests carry the same record
    expect(a.rights).toBe("REUSABLE_WITH_CONDITIONS");
    expect(a.license).toEqual({ name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" });
    expect(a.attribution).toContain("GTEki contributors");
    expect(a.attribution).toContain("PLATEAU");
    expect(a.url).toMatch(/^https?:\/\//);
    expect(Object.keys(a.sha256).sort()).toEqual([...SHIPPED].map((id) => `kit/catalog/high/${id}.glb`).sort());
    for (const rel of Object.keys(a.sha256) as string[]) expect(a.sha256[rel], rel).toBe(sha(path.join(GTEKI, rel)));
  });

  it("declares the copies on the b1 asset in both manifests, with the catalog as a source", () => {
    for (const doc of [readManifest("station.json"), JSON.parse(fs.readFileSync(path.join(STATION, "data/graph.src.json"), "utf8"))]) {
      const b1 = doc.assets.find((x: { id: string }) => x.id === "b1");
      expect(b1.sourceIds).toContain(SOURCE_ID);
      expect(b1.files).toEqual(expect.arrayContaining([...SHIPPED].map((id) => `kit/catalog/high/${id}.glb`)));
    }
  });

  it("copies exactly the plan, and the record pins exactly those copies", () => {
    const copies = (...tiers: string[]) =>
      tiers
        .flatMap((t) => {
          const dir = path.join(GTEKI, "kit/catalog", t);
          return fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".glb")).map((n) => `kit/catalog/${t}/${n}`) : [];
        })
        .sort();
    expect(copies("high", "low")).toEqual([...plannedUris(false), ...plannedUris(true)].sort());
    const station = readManifest("station.json");
    const a = station.sources.find((s: { id: string }) => s.id === SOURCE_ID);
    expect(Object.keys(a.sha256).sort()).toEqual(copies("high", "low"));
  });
});

describe("placement maths", () => {
  it("puts each piece's origin in the renderer frame and turns its local -Z (travel) onto dir", () => {
    for (const p of placements.filter((x) => x.kind === "escalator")) {
      const pose = piecePose(THREE, p, toRenderer);
      expect(pose.centre.toArray()).toEqual(toRenderer(p.origin[0], p.origin[1], p.origin[2]).toArray());
      const travel = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), pose.yaw);
      const dir = toRenderer(p.dir[0], p.dir[1], 0).sub(toRenderer(0, 0, 0));
      expect(travel.distanceTo(dir)).toBeLessThan(2e-3); // yaw_deg is rounded to 3 decimals
      // ... and the catalog's own yaw_deg agrees within its rounding: ENU +Z is renderer +Y, ENU +Y is renderer -Z.
      expect(pose.yaw).toBeCloseTo((p.yaw_deg * Math.PI) / 180, 9);
    }
  });

  it("hand-made input: a 90 degree yaw turns -Z onto -X, and mirror flips local X only", () => {
    const p: CatalogPlacement = {
      anchor: "hand", kind: "escalator", scope: "building", ids: { dressing: "gteki_ik_escalator_test" },
      origin: [1, 2, 3], dir: [-1, 0], yaw_deg: 90, mirror: false, tiers: { dressing: ["high"] },
    };
    const pose = piecePose(THREE, p, toRenderer);
    expect(pose.centre.toArray()).toEqual([1, 3, -2]);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.yaw);
    const travel = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    expect(travel.x).toBeCloseTo(-1, 9);
    expect(travel.y).toBeCloseTo(0, 9);
    expect(travel.z).toBeCloseTo(0, 9);
    const width = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    expect(width.toArray().map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0, 0, -1]); // width stays square to travel
    // mirror is a reflection of the width axis, so the composed transform has a negative determinant
    const m = new THREE.Matrix4().compose(pose.centre, q, new THREE.Vector3(-1, 1, 1));
    expect(m.determinant()).toBeLessThan(0);
    expect(new THREE.Vector3().setFromMatrixScale(m).toArray()).toEqual([1, 1, 1]);
    expect(p.mirror).toBe(false);
  });
});

/** A stand-in for what GLTFLoader returns for a catalog GLB: a root node with VIS_ meshes, plus COL_ and SOCKET_. */
function fakePiece(trianglesParts = 2) {
  const scene = new THREE.Group();
  const root = new THREE.Group();
  root.name = "gteki_ik_escalator_test";
  scene.add(root);
  for (let i = 0; i < trianglesParts; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc, map: new THREE.Texture() }); // one per mesh, as a real GLB
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 8), mat); // 12 triangles
    m.name = `VIS_part${i}`;
    m.position.set(0, 0, -4);
    root.add(m);
  }
  const col = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 8), new THREE.MeshBasicMaterial());
  col.name = "COL_escalator-colonly";
  const socket = new THREE.Object3D();
  socket.name = "SOCKET_start";
  root.add(col, socket);
  return { scene, scenes: [scene] } as unknown as GLTF;
}

describe("loadKitCatalog", () => {
  const host = (files: string[], gltf: (uri: string) => Promise<GLTF> = async () => fakePiece()) => ({
    assetUrl: vi.fn((uri: string) => (files.includes(uri) ? `/blob/${uri}` : null)),
    loadGlb: vi.fn(gltf),
  });
  const allUris = ESCALATOR_IDS.map((id) => `kit/catalog/high/${id}.glb`);
  const env = new THREE.Texture();

  it("loads each GLB once, only on the tier that draws it, and instancing keeps the part count", async () => {
    const h = host(allUris);
    const loaded = await loadKitCatalog(THREE, h, escalators, false);
    expect(h.loadGlb.mock.calls.map((c) => c[0])).toEqual(allUris);
    expect(loaded.placements.length).toBe(5);
    expect(loaded.skippedIds).toEqual([]);
    const { group, stats } = loaded.build(THREE, env, toRenderer);
    expect(group.userData.gteki_role).toBe("kit_catalog");
    const meshes = group.children as THREE.InstancedMesh[];
    expect(meshes.length).toBe(5 * 2); // 5 ids x 2 visible meshes (COL_ and SOCKET_ are not drawn)
    expect(meshes.reduce((n, m) => n + m.count, 0)).toBe(5 * 2);
    expect(stats).toMatchObject({ parts: 5, uniqueGlbs: 5, drawCalls: 10, triangles: 5 * 2 * 12, byKind: { escalator: 5 } });

    const phone = host(allUris);
    const none = await loadKitCatalog(THREE, phone, escalators, true);
    expect(phone.loadGlb.mock.calls).toEqual([]);
    expect(none.placements).toEqual([]);
    expect(none.build(THREE, env, toRenderer).group.children).toEqual([]);
  });

  it("skips ids outside the batch silently, with one summary line", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const shipped = allUris.slice(0, 2);
    const loaded = await loadKitCatalog(THREE, host(shipped), escalators, false);
    expect(new Set(loaded.placements.map((w) => w.id))).toEqual(new Set(ESCALATOR_IDS.slice(0, 2)));
    expect(loaded.skippedIds).toEqual(ESCALATOR_IDS.slice(2));
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]![0]).toContain("2 of 5 parts drawn");
    info.mockRestore();
  });

  it("warns and drops only the id that fails to load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const bad = allUris[0]!;
    const h = host(allUris, async (uri) => {
      if (uri === bad) throw new Error("404");
      return fakePiece();
    });
    const loaded = await loadKitCatalog(THREE, h, escalators, false);
    expect(loaded.skippedIds).toEqual([ESCALATOR_IDS[0]]);
    expect(loaded.placements.length).toBe(4);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("404");
    const { group, stats } = loaded.build(THREE, env, toRenderer);
    expect(group.children.length).toBe(4 * 2);
    expect(stats.byKind).toEqual({ escalator: 4 });
    warn.mockRestore();
    info.mockRestore();
  });

  it("leaves the scene unchanged when no GLB loads", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const loaded = await loadKitCatalog(THREE, host([]), escalators, false);
    const { group, stats } = loaded.build(THREE, env, toRenderer);
    expect(group.children).toEqual([]);
    expect(stats).toEqual({ parts: 0, byKind: {}, uniqueGlbs: 0, drawCalls: 0, triangles: 0 });
    info.mockRestore();
  });

  it("places each instance at its origin, with -Z along dir and the source material untouched", async () => {
    const made: GLTF[] = [];
    const loaded = await loadKitCatalog(THREE, host(allUris, async () => {
      const g = fakePiece();
      made.push(g);
      return g;
    }), escalators, false);
    const { group } = loaded.build(THREE, env, toRenderer);
    const im = group.children[0] as THREE.InstancedMesh;
    const m = new THREE.Matrix4().fromArray(im.instanceMatrix.array as Float32Array, 0);
    const w = loaded.placements.find((x) => x.id === ESCALATOR_IDS[0])!.placement;
    const centre = toRenderer(w.origin[0], w.origin[1], w.origin[2]);
    const dir = toRenderer(w.dir[0], w.dir[1], 0).sub(toRenderer(0, 0, 0));
    // The fake mesh sits 4 m along local -Z (travel), so the instance origin is the anchor plus that offset up the flight.
    const origin = new THREE.Vector3().setFromMatrixPosition(m);
    expect(origin.distanceTo(centre.clone().addScaledVector(dir, 4))).toBeLessThan(1e-3); // float32 matrices
    const travel = new THREE.Vector3(0, 0, -1).transformDirection(m);
    expect(travel.distanceTo(dir)).toBeLessThan(2e-3);
    const used = im.material as THREE.MeshStandardMaterial;
    expect(used.envMap).toBe(env);
    const src = (made[0]!.scene.children[0]!.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(src.envMap).toBeNull();
  });

  it("frees every geometry, cloned material and texture on dispose", async () => {
    const made: GLTF[] = [];
    const loaded = await loadKitCatalog(THREE, host(allUris, async () => {
      const g = fakePiece();
      made.push(g);
      return g;
    }), escalators, false);
    const { group } = loaded.build(THREE, env, toRenderer);
    const geoms = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    const texs = new Set<THREE.Texture>();
    for (const gltf of made)
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        geoms.add(m.geometry);
        mats.add(m.material as THREE.Material);
        const map = (m.material as THREE.MeshStandardMaterial).map;
        if (map) texs.add(map);
      });
    for (const im of group.children as THREE.InstancedMesh[]) {
      geoms.add(im.geometry);
      mats.add(im.material as THREE.Material);
    }
    const spies = [
      ...[...geoms].map((g) => vi.spyOn(g, "dispose")),
      ...[...mats].map((m) => vi.spyOn(m, "dispose")),
      ...[...texs].map((t) => vi.spyOn(t, "dispose")),
    ];
    loaded.dispose();
    expect(spies.every((s) => s.mock.calls.length === 1)).toBe(true);
  });
});
