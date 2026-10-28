// Shopfront kit, batch 4 (#209): pins the placement maths (bays, scale, yaw, the 1.8 m skip), the committed data
// (every opening exists, real shops carry their POI and sources, placeholders carry none) and that the shopfronts are
// visual only (placed rows stand off the walk graph, and the built group adds nothing to walkable or colliders).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import kitJson from "./kit/kit.json";
import openingsJson from "./shop_openings.json";
import placementsJson from "./shop_placements.json";
import { type KitManifest, pieceUri } from "./kit.ts";
import {
  type Opening, type Shop, SHOP_USE, SIGN_HEIGHT_M, SIGN_MAX_WIDTH_M, SIGN_OFFSET_M, loadShopKit, relativeLuminance, shopPieces,
  shopPlacements, shopSigns, shopBladeSigns, shopABoards, signTextColour,
} from "./kit_shops.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATION = path.resolve(HERE, "..");
const GTEKI = path.join(STATION, "gteki");
const kit = kitJson as KitManifest;
const shops = (placementsJson as unknown as { shops: Shop[] }).shops;
const openings = (openingsJson as unknown as { openings: Opening[] }).openings;
const pieces = shopPieces(kit);
const toRenderer = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y); // the shared ENU -> renderer frame

/** Canvas 2D stub: same flat CJK/Latin estimate as kit_signs.test.ts, enough for measure/fit. */
function stubDocument() {
  return {
    createElement: () => {
      const state: Record<string, unknown> = { font: "16px sans" };
      const context = new Proxy(state, {
        get(t, k: string) {
          if (k === "createLinearGradient") return () => ({ addColorStop: () => undefined });
          if (k === "measureText")
            return (text: string) => ({
              width: [...text].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e7f ? 1 : /\d/.test(ch) ? 0.6 : 0.56), 0)
                * Number(/(\d+(?:\.\d+)?)px/.exec(String(t.font))?.[1] ?? 16),
            });
          return k in t ? t[k] : () => undefined;
        },
        set(t, k: string, v) {
          t[k] = v;
          return true;
        },
      });
      return { width: 0, height: 0, getContext: () => context };
    },
  };
}
beforeEach(() => vi.stubGlobal("document", stubDocument()));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("placement maths", () => {
  const door: Opening = {
    type: "Door", opening_id: "r-door", polygon_ids: ["p-door"], base_z: 10, height: 2.2, width: 3,
    centre: [100, 50, 10], normal_deg: 90, nearest_edge: "e", edge_distance_m: 3,
  };
  const windowRow: Opening = {
    type: "Window", opening_id: "r-win", polygon_ids: ["p-win"], base_z: 12, height: 3, width: 4,
    centre: [-20, 30, 12], normal_deg: 0, nearest_edge: "e", edge_distance_m: 2,
  };
  const lowRow: Opening = { ...windowRow, opening_id: "r-low", polygon_ids: ["p-low"], height: 1.5, width: 5 };
  const shop: Shop = {
    id: "s", kind: "placeholder", openings: ["p-door", "p-win", "p-low"], front: "door_glazing",
    sign: { ja: "店", en: "Shop" }, accent: "#8a5a3c", display: "cafe",
  };
  const placed = shopPlacements([shop], [door, windowRow, lowRow], pieces);

  it("splits each row into round(width / bay_m) bays of the front's piece, door on Door rows and glazing on Window rows", () => {
    expect(placed.map((p) => [p.row, p.piece])).toEqual([
      ["r-door", "gteki_shopfront_door_w2000"], ["r-door", "gteki_shopfront_door_w2000"],
      ["r-win", "gteki_shopfront_glazing_w2400"], ["r-win", "gteki_shopfront_glazing_w2400"],
    ]);
    expect(SHOP_USE.door).toBe("shopfront_door");
  });

  it("spaces the bays side by side on the row centre, sx = width / (n * bay_m), and skips a row under 1.8 m", () => {
    const d = placed.filter((p) => p.row === "r-door");
    expect(d.map((p) => p.sx)).toEqual([0.75, 0.75]); // 3 m / (2 x 2 m)
    expect(d.map((p) => p.x)).toEqual([100.75, 99.25]); // +X runs along the wall (normal 90 deg -> yaw 180)
    // The back plane stands 0.01 m in front of the opening plane (normal 90 deg -> +Y).
    for (const p of d) expect([p.y, p.z, p.sy]).toEqual([expect.closeTo(50.01, 12), 10, 1]);
    const w = placed.filter((p) => p.row === "r-win");
    expect(w.map((p) => p.sx)).toEqual([4 / 4.8, 4 / 4.8]);
    expect(w.map((p) => p.y)).toEqual([29, 31]); // wall normal 0 deg -> yaw 90: bays run north
    for (const p of w) expect([p.x, p.sy]).toEqual([expect.closeTo(-19.99, 12), 1.15]); // 3.0 / 2.2 clamped to 1.15
    expect(placed.some((p) => p.row === "r-low")).toBe(false);
  });

  it("turns the piece so +X follows the wall and +Z the wall normal", () => {
    expect(placed.find((p) => p.row === "r-door")!.yawDeg).toBe(180);
    expect(placed.find((p) => p.row === "r-win")!.yawDeg).toBe(90);
  });

  it("puts one sign per shop on its widest placed row's fascia, 0.148 m in front, fitting the fascia", () => {
    const [sign, ...rest] = shopSigns([shop], [door, windowRow, lowRow], pieces);
    expect(rest).toEqual([]);
    expect(sign).toMatchObject({ shop: "s", ja: "店", en: "Shop", width: 3.9, height: SIGN_HEIGHT_M * 1.15, yawDeg: 90 });
    expect(sign!.x).toBeCloseTo(-20 + SIGN_OFFSET_M, 12);
    expect(sign!.y).toBe(30);
    expect(sign!.z).toBeCloseTo(12 + (2.2 + 0.3) * 1.15, 12);
    const wide = { ...windowRow, opening_id: "r-wide", polygon_ids: ["p-wide"], width: 6 };
    expect(shopSigns([{ ...shop, openings: ["p-wide"] }], [wide], pieces)[0]!.width).toBe(SIGN_MAX_WIDTH_M - 0.1);
    // Only pieces that loaded anchor a sign: without the glazing piece it moves to the door row.
    const noGlazing = Object.fromEntries(Object.entries(pieces).filter(([id]) => !id.includes("glazing")));
    expect(shopSigns([shop], [door, windowRow, lowRow], noGlazing)[0]!.width).toBeCloseTo(3 - 0.1, 12);
    // A shop with no placed row (all under 1.8 m) gets no sign.
    expect(shopSigns([{ ...shop, openings: ["p-low"] }], [lowRow], pieces)).toEqual([]);
  });

  it("places eligible blade signs and boards", () => {
    expect(shopBladeSigns([shop], [{ ...door, height: 1.9 }], pieces)).toEqual([]);
    expect(shopBladeSigns([shop], [door], pieces)).toHaveLength(1);
    for (const display of ["cafe", "bakery", "deli", "sweets", "books"]) {
      const candidate = { ...shop, openings: ["p-door"], display };
      expect(shopABoards([candidate], [door], pieces)).toHaveLength(display === "books" ? 0 : 1);
      expect(shopABoards([candidate], [{ ...door, edge_distance_m: 1.99 }], pieces)).toHaveLength(0);
    }
  });

  it("uses accents darkened to legible luminance", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#f4f2ee")).toBeGreaterThan(0.6);
    expect(signTextColour("#8a5a3c")).toBe("#8a5a3c");
    expect(relativeLuminance(signTextColour("#f4f2ee"))).toBeLessThanOrEqual(0.25);
  });
});

describe("committed shop data", () => {
  const byPolygon = new Map(openings.map((o) => [o.polygon_ids[0], o]));
  const pois = new Set((JSON.parse(fs.readFileSync(path.join(GTEKI, "pois.json"), "utf8")) as { pois: { id: string }[] }).pois.map((p) => p.id));

  it("lists 10 shops whose every opening id is a surveyed opening row", () => {
    expect(shops).toHaveLength(10);
    for (const shop of shops)
      for (const polygon of shop.openings) expect(byPolygon.get(polygon), `${shop.id} ${polygon}`).toBeTruthy();
  });

  it("gives every real shop a POI in the bundle plus its position basis, sources and field check", () => {
    const real = shops.filter((s) => s.kind === "real");
    expect(real.length).toBeGreaterThan(0);
    for (const shop of real) {
      expect(shop.poiId, shop.id).toBeTruthy();
      expect(pois.has(shop.poiId!), `${shop.id} ${shop.poiId}`).toBe(true);
      expect(shop.position_basis, shop.id).toBeTruthy();
      expect(shop.sourceIds?.length, shop.id).toBeGreaterThan(0);
      expect(shop.field_check, shop.id).toBeTruthy();
    }
  });

  it("gives every placeholder shop no POI (示意店面, never a search result or route node)", () => {
    const placeholders = shops.filter((s) => s.kind === "placeholder");
    expect(placeholders.length).toBeGreaterThan(0);
    for (const shop of placeholders) {
      expect(shop.poiId, shop.id).toBeUndefined();
      expect(shop.sourceIds, shop.id).toBeUndefined();
    }
  });
});

describe("visual only", () => {
  it("stands every placed row at least 1.0 m off the nearest walk-graph edge", () => {
    const byId = new Map(openings.map((o) => [o.opening_id, o]));
    const placed = shopPlacements(shops, openings, pieces);
    expect(placed.length).toBeGreaterThan(0);
    for (const p of placed) expect(byId.get(p.row)!.edge_distance_m, p.row).toBeGreaterThanOrEqual(1.0);
  });

  it("scene.ts hands the shopfronts to `root` only, never to walkable, colliders or the collision assembly", () => {
    const src = fs.readFileSync(path.join(HERE, "scene.ts"), "utf8");
    expect(src).toMatch(/root\.add\(shopKit\.build\(THREE, env, toRenderer\)\.group\)/);
    const lines = src.split("\n").filter((l) => /\bshopKit\b|\bshopPlacements\b|\bshopOpenings\b/.test(l));
    expect(lines.filter((l) => /walkable|colliders|assembleCollision|tileCollision/.test(l))).toEqual([]);
    const ownSrc = fs.readFileSync(path.join(HERE, "kit_shops.ts"), "utf8");
    expect(ownSrc).not.toMatch(/graph\.json|assembleCollision|tileCollision|gteki_role = "(floor|wall|barriers|stairs_ramps|transport)"/);
  });

  /** A stand-in for what GLTFLoader returns: root node, VIS_ meshes, COL_ node. */
  function fakeShop(id: string, parts = 2) {
    const scene = new THREE.Group();
    const root = new THREE.Group();
    root.name = id;
    scene.add(root);
    const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
    for (let i = 0; i < parts; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.8, 0.14), mat);
      m.name = `VIS_part${i}`;
      m.position.set(0, 1.4, 0.07);
      root.add(m);
    }
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.8, 0.6), new THREE.MeshBasicMaterial());
    col.name = "COL_shop-colonly";
    root.add(col);
    return { scene, scenes: [scene] } as unknown as GLTF;
  }
  const host = (files: string[], gltf: (uri: string) => Promise<GLTF> = async (uri) => fakeShop(uri)) => ({
    assetUrl: vi.fn((uri: string) => (files.includes(uri) ? `/blob/${uri}` : null)),
    loadGlb: vi.fn(gltf),
  });
  const all = (tier: string) => ["gteki_shopfront_glazing_w2400", "gteki_shopfront_door_w2000", "gteki_shopfront_shutter_w2400_half"]
    .map((id) => pieceUri(kit, id, tier === "low"));
  const env = new THREE.Texture();
  function realShop(uri: string): GLTF {
    const bytes = fs.readFileSync(path.join(GTEKI, uri));
    const jsonBytes = bytes.readUInt32LE(12);
    const d = JSON.parse(bytes.subarray(20, 20 + jsonBytes).toString("utf8"));
    const bin = bytes.subarray(28 + jsonBytes);
    const accessor = (id: number, components: number) => {
      const a = d.accessors[id], view = d.bufferViews[a.bufferView];
      const size = a.componentType === 5123 ? 2 : 4;
      const get = a.componentType === 5126 ? (o: number) => bin.readFloatLE(o) : a.componentType === 5123 ? (o: number) => bin.readUInt16LE(o) : (o: number) => bin.readUInt32LE(o);
      return Array.from({ length: a.count * components }, (_, i) => get((view.byteOffset ?? 0) + (a.byteOffset ?? 0) + Math.floor(i / components) * (view.byteStride ?? components * size) + i % components * size));
    };
    const nodes = d.nodes.map((n: { name: string; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[] }) => {
      const group = new THREE.Group(); group.name = n.name;
      if (n.translation) group.position.fromArray(n.translation);
      if (n.rotation) group.quaternion.fromArray(n.rotation);
      if (n.scale) group.scale.fromArray(n.scale);
      if (n.mesh !== undefined) for (const p of d.meshes[n.mesh].primitives) {
        const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(accessor(p.attributes.POSITION, 3), 3)); geo.setIndex(accessor(p.indices, 1));
        group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: d.materials[p.material].name })));
      }
      return group;
    });
    d.nodes.forEach((n: { children?: number[] }, i: number) => n.children?.forEach((c) => nodes[i].add(nodes[c])));
    const scene = new THREE.Group(); for (const i of d.scenes[d.scene ?? 0].nodes) scene.add(nodes[i]);
    return { scene, scenes: [scene] } as unknown as GLTF;
  }
  it("reports committed placements for each real tier", async () => {
    for (const low of [false, true]) {
      const loaded = await loadShopKit(THREE, host(all(low ? "low" : "high"), async (uri) => realShop(uri)), kit, shops, openings, low);
      const { stats } = loaded.build(THREE, env, toRenderer);
      console.log(`[shop stats] ${low ? "low" : "desktop"}: ${JSON.stringify(stats)}`);
      expect(stats).toMatchObject({ shops: 10, modules: 22, tiles: low ? 5 : 8,
        drawCallsAllTiles: low ? 29 : 77, trianglesAllTiles: low ? 3336 : 7379,
        trianglesWorstTile: low ? 1294 : 1548, signs: 9, signDrawCalls: 1, signTriangles: 34,
        interiorDrawCalls: 1, interiorTriangles: 60, spillDrawCalls: 1, bladeSigns: 8, aBoards: 4 });
      loaded.dispose();
    }
  });


  it("builds instances and one merged sign mesh, all under the kit_shop role, and nothing else", async () => {
    const loaded = await loadShopKit(THREE, host(all("high")), kit, shops, openings, false);
    expect(loaded.placements.length).toBe(shopPlacements(shops, openings, pieces).length);
    expect(loaded.signs.length).toBe(shops.filter((s) => s.sign.ja).length);
    const { group, stats } = loaded.build(THREE, env, toRenderer);
    expect(group.userData.gteki_role).toBe("kit_shop");
    const roles = new Set<string>();
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) roles.add(String((o.userData as { gteki_role?: string }).gteki_role));
    });
    expect([...roles].sort()).toEqual(["kit_shop", "kit_shop_sign"]);
    expect(stats.modules).toBe(loaded.placements.length);
    expect(stats.signs).toBe(loaded.signs.length);
    expect(stats.signDrawCalls).toBe(1);
    expect(stats.signTriangles).toBe(2 * (loaded.signs.length + stats.bladeSigns));
    expect(stats.trianglesAllTiles).toBe(loaded.placements.length * 2 * 12); // 2 fake parts, 12 triangles each
    expect(stats.drawCallsAllTiles).toBe(group.children.filter((o) => (o as THREE.InstancedMesh).isInstancedMesh).length);
    loaded.dispose();
  });

  it("merges reveals into an atlas and adds one spill mesh", async () => {
    const row: Opening = { ...openings[0]!, opening_id: "test-row", polygon_ids: ["test-polygon"], width: 4.8, height: 2.2, type: "Window" };
    const shop: Shop = { ...shops[0]!, id: "test-shop", openings: ["test-polygon"], front: "glazing", display: "books" };
    const loaded = await loadShopKit(THREE, host(all("high"), async (uri) => {
      const gltf = fakeShop(uri, 1);
      const reveal = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshStandardMaterial({ name: "gteki_reveal_dark" }));
      reveal.name = "VIS_reveal";
      gltf.scene.children[0]!.add(reveal);
      return gltf;
    }), kit, [shop], [row], false);
    const { group } = loaded.build(THREE, env, toRenderer);
    const instances = group.children.filter((o) => (o as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh[];
    expect(instances.every((o) => (o.material as THREE.Material).name !== "gteki_reveal_dark")).toBe(true);
    const interior = group.getObjectByName("kit_shop_interiors") as THREE.Mesh;
    expect(interior).toBeTruthy();
    expect(group.children.filter((o) => o.name === "kit_shop_interiors")).toHaveLength(1);
    expect(group.children.filter((o) => o.name === "kit_shop_spill")).toHaveLength(1);
    const uv = interior.geometry.getAttribute("uv");
    expect([uv.getX(0), uv.getY(0)]).not.toEqual([uv.getX(4), uv.getY(4)]);
    loaded.dispose();
  });

  it("builds low-tier cards for glazing and door bays without reveal parts", async () => {
    const rows: Opening[] = [
      { ...openings[0]!, opening_id: "window", polygon_ids: ["window"], width: 4.8, height: 2.2, type: "Window" },
      { ...openings[0]!, opening_id: "door", polygon_ids: ["door"], width: 4, height: 2.2, type: "Door" },
    ];
    const shop: Shop = { ...shops[0]!, openings: ["window", "door"], front: "door_glazing", display: "books" };
    const loaded = await loadShopKit(THREE, host(all("low")), kit, [shop], rows, true);
    const { group, stats } = loaded.build(THREE, env, toRenderer);
    expect(loaded.placements).toHaveLength(4);
    expect(stats.interiorTriangles).toBe(8);
    expect((group.getObjectByName("kit_shop_interiors") as THREE.Mesh).geometry.getAttribute("position").count).toBe(16);
    loaded.dispose();
  });

  it("keeps spill quads for distinct rows sharing an opening id", async () => {
    const row: Opening = { ...openings[0]!, opening_id: "shared", polygon_ids: ["one"], centre: [10, 20, 0], width: 3, height: 2.2, type: "Window" };
    const other: Opening = { ...row, polygon_ids: ["two"], centre: [30, 20, 0] };
    const shop: Shop = { ...shops[0]!, openings: ["one", "two"], front: "glazing" };
    const loaded = await loadShopKit(THREE, host(all("high")), kit, [shop], [row, other], false);
    const mesh = loaded.build(THREE, env, toRenderer).group.getObjectByName("kit_shop_spill") as THREE.Mesh;
    const pos = mesh.geometry.getAttribute("position");
    expect(pos.count).toBe(8);
    expect(Math.abs(pos.getX(0) - pos.getX(4))).toBeCloseTo(20);
    loaded.dispose();
  });

  it("drops only the rows of a piece that cannot be loaded, and frees its instances", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onlyGlazing = await loadShopKit(THREE, host([all("high")[0]!]), kit, shops, openings, false);
    expect(onlyGlazing.placements.length).toBeGreaterThan(0);
    expect(onlyGlazing.placements.every((p) => p.piece === "gteki_shopfront_glazing_w2400")).toBe(true);
    expect(onlyGlazing.signs.length).toBeLessThan(shops.filter((s) => s.sign.ja).length);
    const none = await loadShopKit(THREE, host([]), kit, shops, openings, false);
    expect(none.placements).toEqual([]);
    expect(none.signs).toEqual([]);
    expect(none.build(THREE, env, toRenderer).group.children).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();

    const loaded = await loadShopKit(THREE, host(all("high")), kit, shops, openings, false);
    const { group } = loaded.build(THREE, env, toRenderer);
    const instanced: THREE.InstancedMesh[] = [];
    group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) instanced.push(o as THREE.InstancedMesh); });
    const spies = instanced.map((im) => vi.spyOn(im, "dispose"));
    loaded.dispose();
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
  });
});
