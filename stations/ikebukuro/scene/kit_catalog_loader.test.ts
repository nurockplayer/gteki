// Lane E station catalog (#94): batch A (the 5 escalators) and batch B (the 21 stair handrails) placed on the surveyed
// anchors of scene/kit_placements.json, and batch C (the 61 stair nosing strips, merged into a few cluster meshes that
// sample one packed AO atlas per tier). Pins the batches (batch C's desktop tier in this change; its phone copies are
// the stacked follow-up), the placement maths, the tier and batch filters, the merge, disposal, and that the copies,
// declarations and credits agree with each other and with Lane E's manifest.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import kitPlacements from "./kit_placements.json";
import kitCatalog from "./kit_catalog.json";
import { type CatalogPlacement, CULL_M, NOSING_ATLAS, NOSING_CLUSTERS, atlasLimit, atlasUri, catalogUri, catalogVisibility, lazyKitCatalog, loadKitCatalog, loadNosingKit, nosingAtlasUri, piecePose, tierName, tierParts } from "./kit_catalog_loader.ts";
import { applyStationShadows } from "../../../apps/web/src/explorer/shadows.ts";

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
/** The 61 nosing ids batch C merges (69 placements draw them, on both tiers). */
const NOSING_IDS = [...new Set(tierParts(stairs, false).map((w) => w.id).filter((id) => id.endsWith("_nosing")))].sort();
/** Ids the station ships (batch A + B + C); every other catalog id is "not in this batch". */
const SHIPPED = new Set([...ESCALATOR_IDS, ...RAILS_IDS, ...NOSING_IDS]);
/** Batch C lands in two stacked changes: this one ships the desktop tier, the phone copies follow. */
const SHIPPED_TIERS: string[] = ["high"];
/** The catalog copies the placements need, per tier: the batch plan sync_kit_catalog.py copies. */
function plannedUris(low: boolean): string[] {
  const tier = tierName(low);
  if (!SHIPPED_TIERS.includes(tier)) return [];
  const out = new Set<string>();
  for (const p of placements)
    for (const [part, id] of Object.entries(p.ids)) if (SHIPPED.has(id) && (p.tiers[part] ?? []).includes(tier)) out.add(catalogUri(id, low));
  return [...out].sort();
}
/** Every catalog file the source record pins: each shipped tier's planned GLBs and the atlases that tier ships. */
function shippedRels(): string[] {
  return [false, true]
    .filter((low) => SHIPPED_TIERS.includes(tierName(low)))
    .flatMap((low) => [
      ...plannedUris(low),
      ...[atlasUri("nosing", low), atlasUri("escalator", low)].filter((uri): uri is string => uri !== null),
    ])
    .sort();
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

  it("ships each shipped id on disk with each tier's atlases, and no phone copy yet", () => {
    for (const id of SHIPPED) expect(fs.existsSync(path.join(GTEKI, catalogUri(id, false))), id).toBe(true);
    expect(fs.existsSync(path.join(GTEKI, nosingAtlasUri(false)))).toBe(true);
    // Batch A's escalators draw on the desktop tier alone, so only that tier ships their atlas.
    expect(atlasUri("escalator", false)).toBe("kit/catalog/high/atlas/escalator_ao.png");
    expect(fs.existsSync(path.join(GTEKI, atlasUri("escalator", false)!))).toBe(true);
    expect(atlasUri("escalator", true)).toBeNull();
    expect(fs.existsSync(path.join(GTEKI, "kit/catalog/low"))).toBe(false); // batch C's phone copies are the stacked follow-up
  });

  it("copies each file byte for byte, pinned by the source record in both manifests", () => {
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
    expect(Object.keys(a.sha256).sort()).toEqual(shippedRels());
    for (const rel of Object.keys(a.sha256) as string[]) expect(a.sha256[rel], rel).toBe(sha(path.join(GTEKI, rel)));
  });

  it("declares the copies on the b1 asset in both manifests, with the catalog as a source", () => {
    for (const doc of [readManifest("station.json"), JSON.parse(fs.readFileSync(path.join(STATION, "data/graph.src.json"), "utf8"))]) {
      const b1 = doc.assets.find((x: { id: string }) => x.id === "b1");
      expect(b1.sourceIds).toContain(SOURCE_ID);
      expect(b1.files).toEqual(expect.arrayContaining(shippedRels()));
    }
  });

  it("copies exactly the plan, and the record pins exactly those copies", () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
    const copies = (...tiers: string[]) =>
      tiers
        .flatMap((t) => {
          const dir = path.join(GTEKI, "kit/catalog", t);
          return fs.existsSync(dir) ? walk(dir).map((f) => path.relative(GTEKI, f).split(path.sep).join("/")) : [];
        })
        .sort();
    expect(copies("high", "low")).toEqual(shippedRels());
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
    loadTexture: vi.fn(async () => new THREE.Texture()),
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

  it("samples the tier's packed escalator atlas through TEXCOORD_1, one texture for every clone", async () => {
    const texture = new THREE.Texture();
    const atlas = atlasUri("escalator", false)!;
    const h = host([...allUris, atlas]);
    h.loadTexture.mockResolvedValue(texture);
    const loaded = await loadKitCatalog(THREE, h, escalators, false);
    expect(h.loadTexture).toHaveBeenCalledTimes(1);
    expect(h.loadTexture.mock.calls[0]).toEqual([atlas, { colorSpace: "linear", flipY: false }]);
    const { group } = loaded.build(THREE, env, toRenderer);
    const mats = (group.children as THREE.InstancedMesh[]).map((m) => m.material as THREE.MeshStandardMaterial);
    expect(mats.length).toBe(10);
    for (const m of mats) {
      expect(m.aoMap).toBe(texture);
      expect(m.aoMapIntensity).toBe(1);
    }
    expect(texture).toMatchObject({ channel: 1, flipY: false, colorSpace: THREE.NoColorSpace });
    // The mip limit is recorded, not clamped: three 0.186 has no Texture.maxLevel.
    expect(texture.userData).toMatchObject({ gteki_uri: atlas, gteki_atlas_kind: "escalator", gteki_max_isolated_mip: atlasLimit("escalator", false) });
    expect(atlasLimit("escalator", false)).toBe(2);
    loaded.dispose();
  });

  it("keeps the plain clone of a source material an atlas kind also uses", async () => {
    // One source material shared by an escalator part (atlas kind) and a rail part (no atlas).
    const shared = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const piece = () => {
      const scene = new THREE.Group();
      const root = new THREE.Group();
      root.name = "gteki_ik_shared";
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 8), shared);
      mesh.name = "VIS_part";
      root.add(mesh);
      scene.add(root);
      return { scene, scenes: [scene] } as unknown as GLTF;
    };
    const escId = escalators[0]!.ids.dressing!;
    // The first stair flight that actually draws its rail on this tier (many flights carry a rail id but no tier).
    const railId = tierParts(stairs, false).find((w) => w.part === "rails")!.id;
    expect(RAILS_IDS).toContain(railId);
    const rail: CatalogPlacement = { ...stairs.find((p) => p.ids.rails === railId)!, ids: { rails: railId } };
    const mine: CatalogPlacement[] = [escalators[0]!, rail];
    const texture = new THREE.Texture();
    const h = host([catalogUri(escId, false), catalogUri(railId, false), atlasUri("escalator", false)!], async () => piece());
    h.loadTexture.mockResolvedValue(texture);
    const loaded = await loadKitCatalog(THREE, h, mine, false);
    expect(loaded.skippedIds).toEqual([]);
    const { group } = loaded.build(THREE, env, toRenderer);
    const mats = (group.children as THREE.InstancedMesh[]).map((m) => m.material as THREE.MeshStandardMaterial);
    expect(mats).toHaveLength(2);
    expect(new Set(mats).size).toBe(2); // one clone per look, not one shared clone
    expect(mats.filter((m) => m.aoMap === texture)).toHaveLength(1); // the escalator's
    expect(mats.filter((m) => m.aoMap === null)).toHaveLength(1); // the rail's, never the atlas
    loaded.dispose();
  });

  it("warns and still draws every part when the escalator atlas fails to load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = host([...allUris, atlasUri("escalator", false)!]);
    h.loadTexture.mockRejectedValue(new Error("404 atlas"));
    const loaded = await loadKitCatalog(THREE, h, escalators, false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("escalator atlas");
    expect(warn.mock.calls[0]![0]).toContain("drawing without AO");
    const { group, stats } = loaded.build(THREE, env, toRenderer);
    expect(stats.parts).toBe(5);
    for (const im of group.children as THREE.InstancedMesh[]) expect((im.material as THREE.MeshStandardMaterial).aoMap).toBeNull();
    warn.mockRestore();
    loaded.dispose();
  });

  it("frees the escalator atlas on dispose, exactly once", async () => {
    const texture = new THREE.Texture();
    const h = host([...allUris, atlasUri("escalator", false)!]);
    h.loadTexture.mockResolvedValue(texture);
    const loaded = await loadKitCatalog(THREE, h, escalators, false);
    loaded.build(THREE, env, toRenderer);
    const dispose = vi.spyOn(texture, "dispose");
    loaded.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
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

  it("bounds every transformed vertex and keeps thin dressing cullable without shadow casting", async () => {
    const loaded = await loadKitCatalog(THREE, host(plannedUris(false), async () => {
      const gltf = fakePiece();
      const root = gltf.scene.children[0]!;
      root.position.set(2, 1, -3);
      root.rotation.set(0.1, 0.2, 0.3);
      root.scale.set(1.2, 0.8, 1.1);
      return gltf;
    }), placements, false);
    const { group } = loaded.build(THREE, env, toRenderer);
    const matrix = new THREE.Matrix4(), vertex = new THREE.Vector3();
    expect(group.children.length).toBeGreaterThan(0);
    for (const im of group.children as THREE.InstancedMesh[]) {
      expect(im.frustumCulled).toBe(true);
      expect(im.castShadow).toBe(false);
      expect(im.receiveShadow).toBe(false); // same initial defaults as the other kits
      expect(im.boundingSphere).not.toBeNull();
      expect(im.boundingBox).not.toBeNull();
      const position = im.geometry.getAttribute("position");
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, matrix);
        for (let k = 0; k < position.count; k++) {
          vertex.fromBufferAttribute(position, k).applyMatrix4(matrix);
          expect(vertex.distanceTo(im.boundingSphere!.center)).toBeLessThanOrEqual(im.boundingSphere!.radius + 1e-8);
          expect(im.boundingBox!.clone().expandByScalar(1e-8).containsPoint(vertex)).toBe(true);
        }
      }
    }
    // A camera looking away from the whole catalog rejects every mesh, using three's actual culling path.
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.copy(box.max).addScalar(100);
    camera.lookAt(camera.position.clone().addScalar(1));
    camera.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    expect(group.children.every((im) => !frustum.intersectsObject(im))).toBe(true);
    // Even the explorer's fallback sun policy must respect the thin-dressing opt-out.
    expect(applyStationShadows(group, "high", "default", Infinity).casters).toBe(0);
    expect(group.children.every((im) => !im.castShadow)).toBe(true);
    loaded.dispose();
  });

  it("culls separate placements of a reused id when the camera sees only the gap between flights", async () => {
    const spread = [-100, 100].map((x, i): CatalogPlacement => ({
      ...escalators[0]!, anchor: `spread_${i}`, origin: [x, 0, 0], yaw_deg: 0,
    }));
    const loaded = await loadKitCatalog(THREE, host(allUris), spread, false);
    const { group, stats } = loaded.build(THREE, env, toRenderer);
    expect(stats).toMatchObject({ parts: 2, uniqueGlbs: 1, drawCalls: 4 });
    const meshes = group.children as THREE.InstancedMesh[];
    expect(meshes.map((im) => im.count)).toEqual([1, 1, 1, 1]);
    expect(meshes[0]!.geometry).toBe(meshes[2]!.geometry);
    expect(meshes[0]!.material).toBe(meshes[2]!.material);
    group.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20); // default looks along -Z from the origin
    camera.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    expect(meshes.every((im) => !frustum.intersectsObject(im))).toBe(true);
    camera.position.x = -100;
    camera.updateMatrixWorld(true);
    frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    expect(meshes.map((im) => frustum.intersectsObject(im))).toEqual([true, true, false, false]);
    loaded.dispose();
  });

  it("defers catalog fetches past the first frame and attaches each GLB without waiting for the rest", async () => {
    vi.useFakeTimers();
    const root = new THREE.Group();
    const pending: ((gltf: GLTF) => void)[] = [];
    const h = host(allUris, () => new Promise<GLTF>((resolve) => pending.push(resolve)));
    const lazy = lazyKitCatalog(THREE, h, escalators, false, root, env, toRenderer);
    try {
      expect(h.loadGlb).not.toHaveBeenCalled(); // buildScene can resolve and the host can reach ready
      lazy.start(); // first attached scene update, immediately before render
      lazy.start();
      expect(h.loadGlb).not.toHaveBeenCalled();
      await vi.runOnlyPendingTimersAsync(); // the task after that render
      expect(h.loadGlb).toHaveBeenCalledTimes(1);
      expect(root.children).toHaveLength(0);
      pending[0]!(fakePiece());
      await vi.runOnlyPendingTimersAsync();
      expect(root.children).toHaveLength(1);
      expect(root.children[0]!.children).toHaveLength(2);
      expect(h.loadGlb).toHaveBeenCalledTimes(2); // serial: the second starts only after the first resolves
      for (let i = 1; i < allUris.length; i++) {
        pending[i]!(fakePiece());
        await vi.runOnlyPendingTimersAsync();
        expect(root.children).toHaveLength(i + 1);
      }
      expect(h.loadGlb.mock.calls.map((c) => c[0])).toEqual(allUris);
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(10_000, 10_000, 10_000);
      lazy.update(camera);
      expect(root.children.every((g) => g.children.every((m) => !m.visible))).toBe(true);
      lazy.dispose();
      expect(root.children).toHaveLength(0);
    } finally {
      lazy.dispose();
      vi.useRealTimers();
    }
  });

  it("settled() starts the build itself and resolves after failed loads, without a frame or after dispose", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const root = new THREE.Group();
      const failing = host(allUris, async (uri) => { throw new Error(`no ${uri}`); });
      const lazy = lazyKitCatalog(THREE, failing, escalators, false, root, env, toRenderer);
      await lazy.settled(); // no update() and no start() first: an export host calls only this
      expect(failing.loadGlb).toHaveBeenCalledTimes(allUris.length);
      expect(root.children).toHaveLength(0);
      lazy.dispose();

      const never = host(allUris, () => new Promise<GLTF>(() => {}));
      const stuck = lazyKitCatalog(THREE, never, escalators, false, new THREE.Group(), env, toRenderer);
      const waiting = stuck.settled();
      stuck.dispose();
      await waiting; // dispose releases a waiter even when a fetch never returns

      const none = lazyKitCatalog(THREE, host([]), [], false, new THREE.Group(), env, toRenderer);
      await none.settled(); // nothing to load
    } finally {
      warn.mockRestore();
    }
  });

  it("culls by sphere surface distance, restores visibility and reuses its scratch objects", async () => {
    const loaded = await loadKitCatalog(THREE, host(allUris), escalators.slice(0, 1), false);
    const { group } = loaded.build(THREE, env, toRenderer);
    const root = new THREE.Group();
    root.position.set(7, -3, 11);
    root.scale.setScalar(2);
    root.add(group);
    const camera = new THREE.PerspectiveCamera();
    const rig = new THREE.Group();
    rig.position.set(-4, 2, 6);
    rig.add(camera);
    const visibility = catalogVisibility(THREE);
    visibility.add(group);
    const mesh = group.children[0] as THREE.InstancedMesh;
    root.updateMatrixWorld(true);
    const bounds = mesh.boundingSphere!.clone().applyMatrix4(mesh.matrixWorld);
    const localBounds = mesh.boundingSphere!.clone();
    const place = (surfaceM: number) => camera.position.copy(bounds.center).sub(rig.position).addScaledVector(new THREE.Vector3(1, 0, 0), bounds.radius + surfaceM);
    place(CULL_M + 0.01);
    visibility.update(camera);
    expect(group.children.every((m) => !m.visible)).toBe(true);
    place(CULL_M);
    visibility.update(camera);
    expect(mesh.visible).toBe(true); // inclusive surface threshold, even though the centre is farther away
    place(CULL_M - 0.01);
    visibility.update(camera);
    expect(group.children.every((m) => m.visible)).toBe(true);
    camera.position.copy(bounds.center).sub(rig.position);
    visibility.update(camera);
    expect(mesh.visible).toBe(true); // inside the sphere
    expect(mesh.boundingSphere).toEqual(localBounds); // world transforms never mutate the stored bound

    const vectorCtor = vi.fn(function () { return new THREE.Vector3(); });
    const sphereCtor = vi.fn(function () { return new THREE.Sphere(); });
    const guarded = catalogVisibility({ ...THREE, Vector3: vectorCtor, Sphere: sphereCtor } as unknown as typeof THREE);
    guarded.add(group);
    expect(vectorCtor).toHaveBeenCalledTimes(1);
    expect(sphereCtor).toHaveBeenCalledTimes(1);
    vectorCtor.mockClear();
    sphereCtor.mockClear();
    for (let frame = 0; frame < 120; frame++) guarded.update(camera);
    expect(vectorCtor).not.toHaveBeenCalled();
    expect(sphereCtor).not.toHaveBeenCalled();
    loaded.dispose();
  });

  it("cancels a scheduled catalog load and frees an in-flight GLB after scene teardown", async () => {
    vi.useFakeTimers();
    const root = new THREE.Group();
    const made = fakePiece();
    const geometry = (made.scene.children[0]!.children[0] as THREE.Mesh).geometry;
    const free = vi.spyOn(geometry, "dispose");
    let finish!: (gltf: GLTF) => void;
    const h = host(allUris, () => new Promise<GLTF>((resolve) => { finish = resolve; }));
    const cancelled = lazyKitCatalog(THREE, h, escalators, false, root, env, toRenderer);
    const late = lazyKitCatalog(THREE, h, escalators, false, root, env, toRenderer);
    try {
      cancelled.start();
      cancelled.dispose();
      cancelled.start();
      await vi.runOnlyPendingTimersAsync();
      expect(h.loadGlb).not.toHaveBeenCalled();
      late.start();
      await vi.runOnlyPendingTimersAsync();
      expect(h.loadGlb).toHaveBeenCalledTimes(1);
      late.dispose();
      finish(made);
      await vi.runOnlyPendingTimersAsync();
      expect(root.children).toHaveLength(0);
      expect(free).toHaveBeenCalledTimes(1);
      expect(h.loadGlb).toHaveBeenCalledTimes(1); // no subsequent fetches after teardown
      late.dispose();
      expect(free).toHaveBeenCalledTimes(1);
    } finally {
      cancelled.dispose();
      late.dispose();
      vi.useRealTimers();
    }
  });

  it("keeps background loading tier-aware and continues after a failed asset", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = new THREE.Group();
    const h = host(allUris.slice(0, 2), async (uri) => {
      if (uri === allUris[0]) throw new Error("404");
      return fakePiece();
    });
    const phone = lazyKitCatalog(THREE, h, escalators, true, root, env, toRenderer);
    const desktop = lazyKitCatalog(THREE, h, escalators, false, root, env, toRenderer);
    try {
      phone.start();
      await vi.runOnlyPendingTimersAsync();
      expect(h.loadGlb).not.toHaveBeenCalled();
      desktop.start();
      await vi.runOnlyPendingTimersAsync();
      expect(h.loadGlb.mock.calls.map((c) => c[0])).toEqual(allUris.slice(0, 2));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(root.children).toHaveLength(1); // no empty groups for failed or unshipped assets
      expect(root.children[0]!.children).toHaveLength(2);
    } finally {
      phone.dispose();
      desktop.dispose();
      warn.mockRestore();
      vi.useRealTimers();
    }
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

/** A stand-in for a batch C nosing GLB: one indexed box carrying uv and the atlas UVs in uv1, one yellow material. */
function fakeNosing() {
  const scene = new THREE.Group();
  const root = new THREE.Group();
  root.name = "gteki_ik_stair_test_nosing";
  scene.add(root);
  const geometry = new THREE.BoxGeometry(1, 0.05, 2);
  geometry.setAttribute("uv1", geometry.getAttribute("uv").clone());
  const material = new THREE.MeshStandardMaterial({ name: "gteki_vertical_safety_yellow", color: 0xe86f00, roughness: 0.48, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "VIS_nosings";
  root.add(mesh);
  return { scene, scenes: [scene] } as unknown as GLTF;
}

describe("loadNosingKit (batch C)", () => {
  const env = new THREE.Texture();
  const nosingUris = NOSING_IDS.map((id) => catalogUri(id, false));
  const nosingAtlas = nosingAtlasUri(false);
  const nosingHost = (files: string[] = [...nosingUris, nosingAtlas], make: (uri: string) => Promise<GLTF> = async () => fakeNosing(), texture = new THREE.Texture()) => ({
    assetUrl: vi.fn((uri: string) => (files.includes(uri) ? `/blob/${uri}` : null)),
    loadGlb: vi.fn(make),
    loadTexture: vi.fn(async () => texture),
    texture,
  });
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("loads each of the 61 GLBs once and merges the tier's 69 strips into a few cluster meshes", async () => {
    const h = nosingHost();
    const loaded = await loadNosingKit(THREE, h, placements, false);
    expect(h.loadGlb.mock.calls.map((c) => c[0])).toEqual(nosingUris);
    expect(loaded.placements.length).toBe(69);
    expect(new Set(loaded.placements.map((w) => w.id)).size).toBe(61);
    expect(loaded.skippedIds).toEqual([]);
    const { group, stats } = loaded.build(THREE, env, toRenderer);
    expect(stats).toMatchObject({ parts: 69, uniqueGlbs: 61, clusters: group.children.length, drawCalls: group.children.length, triangles: 69 * 12 });
    expect(group.children.length).toBeGreaterThan(0);
    expect(group.children.length).toBeLessThanOrEqual(NOSING_CLUSTERS); // 8 draws at most, against 61 instanced ones
    expect(group.userData.gteki_role).toBe("kit_catalog");
    expect(new Set(group.children.map((m) => m.material)).size).toBe(1); // one merged material per tier
    for (const m of group.children as THREE.Mesh[]) {
      expect(m.frustumCulled).toBe(true);
      expect(m.castShadow).toBe(false);
      expect(m.receiveShadow).toBe(false);
      expect(m.geometry.boundingSphere).not.toBeNull();
      expect(m.geometry.boundingBox).not.toBeNull();
    }
    // Every anchor lands in exactly one cluster.
    const anchors = group.children.flatMap((m) => m.userData.gteki_anchors as string[]);
    expect(anchors.sort()).toEqual(loaded.placements.map((w) => w.placement.anchor).sort());
    loaded.dispose();
  });

  it("samples the tier's packed AO atlas through TEXCOORD_1, on one shared material", async () => {
    const texture = new THREE.Texture();
    const h = nosingHost(undefined, async () => fakeNosing(), texture);
    const loaded = await loadNosingKit(THREE, h, placements, false);
    const { group } = loaded.build(THREE, env, toRenderer);
    expect(h.loadTexture).toHaveBeenCalledTimes(1);
    expect(h.loadTexture.mock.calls[0]).toEqual([nosingAtlas, { colorSpace: "linear", flipY: false }]);
    expect(texture.channel).toBe(1); // three's uv1, where the catalog GLBs put the atlas UVs
    expect(texture.flipY).toBe(false);
    expect(texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(texture.userData).toMatchObject({ gteki_uri: nosingAtlas, gteki_atlas_kind: "nosing", gteki_max_isolated_mip: 2 });
    for (const m of group.children as THREE.Mesh[]) {
      const mat = m.material as THREE.MeshStandardMaterial;
      expect(mat.aoMap).toBe(texture);
      expect(mat.envMap).toBe(env);
      expect(mat.name).toBe("gteki_vertical_safety_yellow"); // the look comes from the GLB material ...
      expect(mat.color.getHex()).toBe(0xe86f00);
      expect(mat.roughness).toBeCloseTo(0.48, 6);
      expect(mat.metalness).toBe(0);
    }
    loaded.dispose();
  });

  it("merges exactly the placed vertices, and every cluster's bounds contain its own pieces", async () => {
    const h = nosingHost();
    const loaded = await loadNosingKit(THREE, h, placements, false);
    const { group } = loaded.build(THREE, env, toRenderer);
    const perPiece = fakeNosing().scene.children[0]!.children[0]!.geometry.getAttribute("position").count;
    const verts = (group.children as THREE.Mesh[]).reduce((n, m) => n + m.geometry.getAttribute("position").count, 0);
    expect(verts).toBe(loaded.placements.length * perPiece);
    const piece = fakeNosing().scene.children[0]!.children[0] as THREE.Mesh;
    const vertex = new THREE.Vector3(), matrix = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (const m of group.children as THREE.Mesh[]) {
      const mine = new Set(m.userData.gteki_anchors as string[]);
      const box = m.geometry.boundingBox!.clone().expandByScalar(1e-3); // merged vertices are float32
      for (const w of loaded.placements.filter((x) => mine.has(x.placement.anchor))) {
        const pose = piecePose(THREE, w.placement, toRenderer);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.yaw);
        matrix.compose(pose.centre, q, new THREE.Vector3(w.placement.mirror ? -1 : 1, 1, 1));
        const position = piece.geometry.getAttribute("position");
        for (let i = 0; i < position.count; i++) {
          vertex.fromBufferAttribute(position, i).applyMatrix4(matrix);
          expect(box.containsPoint(vertex)).toBe(true);
        }
      }
    }
    loaded.dispose();
  });

  it("keeps a mirrored placement's faces facing outwards", async () => {
    const placement = (mirror: boolean): CatalogPlacement => ({
      anchor: "hand", kind: "stair", scope: "building", ids: { nosing: NOSING_IDS[0]! },
      origin: [0, 0, 0], dir: [0, 1], yaw_deg: 30, mirror, tiers: { nosing: ["high"] },
    });
    for (const mirror of [false, true]) {
      const loaded = await loadNosingKit(THREE, nosingHost(), [placement(mirror)], false);
      const { group } = loaded.build(THREE, env, toRenderer);
      const g = (group.children[0] as THREE.Mesh).geometry;
      const position = g.getAttribute("position"), normal = g.getAttribute("normal"), index = g.index!;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), face = new THREE.Vector3();
      for (let t = 0; t < index.count; t += 3) {
        a.fromBufferAttribute(position, index.getX(t));
        b.fromBufferAttribute(position, index.getX(t + 1));
        c.fromBufferAttribute(position, index.getX(t + 2));
        face.crossVectors(b.sub(a), c.sub(a));
        const vertexNormal = new THREE.Vector3().fromBufferAttribute(normal, index.getX(t));
        expect(face.normalize().dot(vertexNormal)).toBeGreaterThan(0.5); // winding agrees with the baked normals
      }
      loaded.dispose();
    }
  });

  it("drops only the strip that fails to load", async () => {
    const bad = nosingUris[0]!;
    const h = nosingHost(undefined, async (uri) => {
      if (uri === bad) throw new Error("404");
      return fakeNosing();
    });
    const loaded = await loadNosingKit(THREE, h, placements, false);
    const expected = placements.filter((p) => p.ids.nosing === NOSING_IDS[0] && (p.tiers.nosing ?? []).includes("high")).length;
    expect(loaded.skippedIds).toEqual([NOSING_IDS[0]]);
    expect(loaded.placements.length).toBe(69 - expected);
    expect(loaded.build(THREE, env, toRenderer).stats.parts).toBe(69 - expected);
    loaded.dispose();
  });

  it("skips the batch when the tier ships no AO atlas", async () => {
    const h = nosingHost(nosingUris); // every GLB, but no atlas: batch C is not part of this station copy
    const loaded = await loadNosingKit(THREE, h, placements, false);
    expect(h.loadGlb).not.toHaveBeenCalled();
    expect(h.loadTexture).not.toHaveBeenCalled();
    expect(loaded.placements).toEqual([]);
    expect(loaded.skippedIds).toEqual(NOSING_IDS);
    const { group, stats } = loaded.build(THREE, env, toRenderer);
    expect(group.children).toEqual([]);
    expect(stats.parts).toBe(0);
  });

  it("frees the merged geometries, the shared material and the atlas on dispose", async () => {
    const made: GLTF[] = [];
    const h = nosingHost(undefined, async () => {
      const g = fakeNosing();
      made.push(g);
      return g;
    });
    const loaded = await loadNosingKit(THREE, h, placements, false);
    const { group } = loaded.build(THREE, env, toRenderer);
    const texture = h.texture;
    const spies = [
      ...(group.children as THREE.Mesh[]).map((m) => vi.spyOn(m.geometry, "dispose")),
      vi.spyOn((group.children[0] as THREE.Mesh).material as THREE.Material, "dispose"),
      vi.spyOn(texture, "dispose"),
      ...made.map((g) => vi.spyOn((g.scene.children[0]!.children[0] as THREE.Mesh).geometry, "dispose")),
      ...made.map((g) => vi.spyOn((g.scene.children[0]!.children[0] as THREE.Mesh).material as THREE.Material, "dispose")),
    ];
    loaded.dispose();
    expect(spies.every((s) => s.mock.calls.length === 1)).toBe(true);
  });

  it("keeps the userData the host already set on the atlas texture", async () => {
    const texture = new THREE.Texture();
    texture.userData.foo = "kept";
    const h = nosingHost(undefined, async () => fakeNosing(), texture);
    const loaded = await loadNosingKit(THREE, h, placements, false);
    expect(texture.userData).toMatchObject({ foo: "kept", gteki_uri: nosingAtlas, gteki_atlas_kind: "nosing" });
    expect(texture.userData.gteki_max_isolated_mip).toBe(2); // the Lane E manifest's desktop limit
    expect(texture.channel).toBe(1);
    loaded.dispose();
  });

  it("stops before the next GLB once disposed and frees what it had loaded", async () => {
    const h = nosingHost();
    let release!: (gltf: GLTF) => void;
    h.loadGlb.mockImplementationOnce(() => new Promise<GLTF>((resolve) => (release = resolve)));
    let disposed = false;
    const pending = loadNosingKit(THREE, h, placements, false, () => disposed);
    await vi.waitFor(() => expect(h.loadGlb).toHaveBeenCalledTimes(1));
    const gltf = fakeNosing();
    const mesh = gltf.scene.children[0]!.children[0] as THREE.Mesh;
    const geometry = vi.spyOn(mesh.geometry, "dispose");
    const material = vi.spyOn(mesh.material as THREE.Material, "dispose");
    const texture = vi.spyOn(h.texture, "dispose");
    disposed = true;
    release(gltf);
    const loaded = await pending;
    expect(h.loadGlb).toHaveBeenCalledTimes(1); // no fetch started after dispose
    expect(loaded.placements).toEqual([]);
    expect(loaded.build(THREE, env, toRenderer).stats.parts).toBe(0);
    expect([geometry, material, texture].every((s) => s.mock.calls.length === 1)).toBe(true);
    loaded.dispose(); // idempotent: the caller may dispose the abandoned kit again
  });

  it("drops a part without uv1, keeps a part without uv, and merges the cluster without uv", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const yellow = new THREE.MeshStandardMaterial({ name: "gteki_vertical_safety_yellow", color: 0xe86f00 });
    const part = (opts: { uv?: boolean; uv1?: boolean }) => {
      const g = new THREE.BoxGeometry(1, 0.05, 2);
      if (opts.uv1 !== false) g.setAttribute("uv1", g.getAttribute("uv").clone());
      if (opts.uv === false) g.deleteAttribute("uv");
      return new THREE.Mesh(g, yellow);
    };
    const scene = new THREE.Group();
    for (const opts of [{}, { uv1: false }, { uv: false }]) scene.add(part(opts));
    const placement: CatalogPlacement = {
      anchor: "hand", kind: "stair", scope: "building", ids: { nosing: NOSING_IDS[0]! },
      origin: [0, 0, 0], dir: [0, 1], yaw_deg: 0, mirror: false, tiers: { nosing: ["high"] },
    };
    const h = nosingHost(undefined, async () => ({ scene, scenes: [scene] } as unknown as GLTF));
    const loaded = await loadNosingKit(THREE, h, [placement], false);
    const { group } = loaded.build(THREE, env, toRenderer);
    expect(group.children).toHaveLength(1);
    const g = (group.children[0] as THREE.Mesh).geometry;
    expect(g.getAttribute("position").count).toBe(48); // two boxes; the one without uv1 is dropped
    expect(g.getAttribute("uv1")).toBeDefined();
    expect(g.getAttribute("uv")).toBeUndefined(); // one part lacks uv, so the whole cluster does
    expect((group.children[0] as THREE.Mesh).material).toMatchObject({ aoMap: h.texture });
    expect(h.texture.channel).toBe(1);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("lacks uv1"))).toBe(true);
    loaded.dispose();
    warn.mockRestore();
  });

  it("merges indexed and non-indexed parts of a mirrored placement into one cluster", async () => {
    const yellow = new THREE.MeshStandardMaterial({ name: "gteki_vertical_safety_yellow", color: 0xe86f00 });
    const box = (indexed: boolean) => {
      const g = new THREE.BoxGeometry(1, 0.05, 2);
      g.setAttribute("uv1", g.getAttribute("uv").clone());
      return new THREE.Mesh(indexed ? g : g.toNonIndexed(), yellow);
    };
    const scene = new THREE.Group();
    scene.add(box(true), box(false));
    const placement: CatalogPlacement = {
      anchor: "hand", kind: "stair", scope: "building", ids: { nosing: NOSING_IDS[0]! },
      origin: [0, 0, 0], dir: [0, 1], yaw_deg: 30, mirror: true, tiers: { nosing: ["high"] },
    };
    const h = nosingHost(undefined, async () => ({ scene, scenes: [scene] } as unknown as GLTF));
    const loaded = await loadNosingKit(THREE, h, [placement], false);
    const { group, stats } = loaded.build(THREE, env, toRenderer);
    expect(group.children).toHaveLength(1);
    expect(stats.triangles).toBe(24); // two 12-triangle boxes
    const g = (group.children[0] as THREE.Mesh).geometry;
    expect(g.index).not.toBeNull();
    const position = g.getAttribute("position"), normal = g.getAttribute("normal"), index = g.index!;
    expect(index.count).toBe(72);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), face = new THREE.Vector3();
    for (let t = 0; t < index.count; t += 3) {
      a.fromBufferAttribute(position, index.getX(t));
      b.fromBufferAttribute(position, index.getX(t + 1));
      c.fromBufferAttribute(position, index.getX(t + 2));
      face.crossVectors(b.sub(a), c.sub(a)).normalize();
      expect(face.dot(new THREE.Vector3().fromBufferAttribute(normal, index.getX(t)))).toBeGreaterThan(0.5);
    }
    loaded.dispose();
  });

  it("excludes a part whose material differs visibly instead of merging it under the first", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const yellow = new THREE.MeshStandardMaterial({ name: "gteki_vertical_safety_yellow", color: 0xe86f00, roughness: 0.48 });
    const other = new THREE.MeshStandardMaterial({ name: "gteki_vertical_safety_yellow", color: 0xe86f00, roughness: 0.2 });
    const box = (material: THREE.MeshStandardMaterial) => {
      const g = new THREE.BoxGeometry(1, 0.05, 2);
      g.setAttribute("uv1", g.getAttribute("uv").clone());
      return new THREE.Mesh(g, material);
    };
    const scene = new THREE.Group();
    scene.add(box(yellow), box(other));
    const placement: CatalogPlacement = {
      anchor: "hand", kind: "stair", scope: "building", ids: { nosing: NOSING_IDS[0]! },
      origin: [0, 0, 0], dir: [0, 1], yaw_deg: 0, mirror: false, tiers: { nosing: ["high"] },
    };
    const h = nosingHost(undefined, async () => ({ scene, scenes: [scene] } as unknown as GLTF));
    const loaded = await loadNosingKit(THREE, h, [placement], false);
    const { group } = loaded.build(THREE, env, toRenderer);
    expect((group.children[0] as THREE.Mesh).geometry.getAttribute("position").count).toBe(24);
    expect((group.children[0] as THREE.Mesh).material).toMatchObject({ roughness: 0.48 });
    expect(warn.mock.calls.some((c) => String(c[0]).includes("differs from"))).toBe(true);
    loaded.dispose();
    warn.mockRestore();
  });

  it("settled() waits for the merged nosings, not only for the instanced batches", async () => {
    vi.useFakeTimers();
    const h = nosingHost([...nosingUris, nosingAtlas]);
    const root = new THREE.Group();
    const lazy = lazyKitCatalog(THREE, h, placements, false, root, env, toRenderer);
    try {
      let resolved = false;
      const settled = lazy.settled().then(() => { resolved = true; });
      await vi.runOnlyPendingTimersAsync();
      await settled;
      expect(resolved).toBe(true);
      expect(h.loadGlb).toHaveBeenCalledTimes(61); // every nosing GLB is in before settled() resolves
      expect(root.children.map((g) => g.name)).toEqual(["ikebukuro_kit_catalog_nosing"]);
    } finally {
      lazy.dispose();
      vi.useRealTimers();
    }
  });

  it("attaches the merged nosing group after the instanced batches in the lazy path", async () => {
    vi.useFakeTimers();
    const root = new THREE.Group();
    const h = nosingHost([...nosingUris, nosingAtlas, catalogUri(ESCALATOR_IDS[0]!, false)]);
    const lazy = lazyKitCatalog(THREE, h, placements, false, root, env, toRenderer);
    try {
      lazy.start();
      await vi.runOnlyPendingTimersAsync();
      await vi.runOnlyPendingTimersAsync();
      expect(root.children.map((g) => g.name)).toEqual(["ikebukuro_kit_catalog", "ikebukuro_kit_catalog_nosing"]);
      const nosing = root.children[1]!;
      expect(nosing.children.length).toBeLessThanOrEqual(NOSING_CLUSTERS);
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(10_000, 10_000, 10_000);
      lazy.update(camera);
      expect(nosing.children.every((m) => !m.visible)).toBe(true);
      lazy.dispose();
      expect(root.children).toHaveLength(0);
    } finally {
      lazy.dispose();
      vi.useRealTimers();
    }
  });
});
