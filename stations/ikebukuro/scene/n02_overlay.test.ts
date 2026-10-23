import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { glbPrimitivePlugin, sceneFromGlbRoles } from "@gteki/scene-api";
import { enuToRenderer } from "../../../packages/geo/src/index.ts";
import { contextVisibleAt, dressContext, streetRenderY } from "./context.ts";
import { assembleCollision } from "./scene.ts";
import { loadN02Overlay, N02_COLORS, N02_GLB, N02_OFFSET_M, N02_RENDER_ORDER } from "./n02_overlay.ts";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const station = read("../gteki/station.json");
const source = station.sources.find((s: { id: string }) => s.id === "ksj-n02-2025");
const ATTRIBUTION = "出典：国土交通省国土数値情報ダウンロードサイト（https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html）を加工して作成";
const RUN = "overlay-ikebukuro-r700-ikebukuro-station-enu-v0-station-railway-70f286365793c8e9acf3";
const receipt = read(`../../../docs/gis/context/${RUN}.json`);
const acquisition = read("../../../docs/gis/acquisitions/ksj-n02-2025.json");
const bytes = readFileSync(new URL(`../gteki/${N02_GLB}`, import.meta.url));
const glb = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
const load = async (): Promise<GLTF> => new Promise((resolve, reject) => {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  new GLTFLoader().register(glbPrimitivePlugin).parse(ab, "", resolve, reject);
});
const meshes = (scene: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
  return out;
};
const host = (loadGlb = vi.fn(load)) => ({ assetUrl: vi.fn(() => "overlay-url"), loadGlb });

describe("KSJ N02 source and shipped geometry", () => {
  it("carries the same source and visual asset declarations in both manifests", () => {
    const src = read("../data/graph.src.json");
    expect(station.sources).toEqual(src.sources);
    expect(station.assets).toEqual(src.assets);
    const asset = station.assets.find((a: { uri: string }) => a.uri === N02_GLB);
    expect(asset).toMatchObject({ role: "visual", floorIds: ["street"], sourceIds: [source.id] });
    const derivation = `tools/gis context-overlay run ${RUN} (receipt docs/gis/context/${RUN}.json): station and railway geometry, coarse kind and feature hash only, clipped to a 700 m origin disc; no name, code or attribute; rendered 0.02 m above its z basis as a scene-side render offset, not data z`;
    expect(source.derivation).toBe(derivation);
    expect(asset.derivation).toBe(derivation);
  });

  it("records the verbatim credit, reusable CC BY licence and honest context flags", () => {
    expect(source).toMatchObject({
      id: "ksj-n02-2025", title: "KSJ N02-2025 railway data (stations and railway sections)",
      license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
      rights: "REUSABLE_WITH_CONDITIONS", attribution: ATTRIBUTION, modified: true,
      gteki_role: "context", navigation_use: "NOT_FOR_ROUTING", visual_only: true, verification: "UNVERIFIED",
    });
    expect(source.attribution).toBe(receipt.credit);
    expect(source.usage ?? "data").toBe("data");
    expect(source.sha256["N02-25_GML.zip"]).toBe(acquisition.sha256);
    expect(acquisition.bytes).toBe(14_903_774);
    expect(source.sha256[N02_GLB]).toBe("28ae48bc9ea9798587d57a9a6649b3ea0a23119ae1705db7530cd4c0b1bf94ec");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(source.sha256[N02_GLB]);
    expect(source.sha256[N02_GLB]).toBe(receipt.outputs.glb.sha256);
    expect(bytes.length).toBe(16_728);
    expect(receipt.z_basis).toMatchObject({ z_m: streetRenderY(station.floors), baked_offset_m: 0 });
  });

  it("keeps only geometry and provenance, with identity node transforms and no names/codes/attributes", () => {
    expect(glb.nodes.map((n: { name: string }) => n.name).sort()).toEqual(["ctx_rail_all", "ctx_station_all"]);
    for (const node of glb.nodes) {
      expect(node.extras).toMatchObject({ source_id: source.id, gteki_role: "context", navigation_use: "NOT_FOR_ROUTING", visual_only: true, verification: "UNVERIFIED", z_m: 32.5 });
      expect(node.translation).toBeUndefined();
      expect(node.rotation).toBeUndefined();
      expect(node.scale).toBeUndefined();
      expect(node.matrix).toBeUndefined();
    }
    const keys = (v: unknown): string[] => v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : [];
    expect(keys(glb).filter((k) => /^(N02_|name_ja|name_en|code$|properties$)/i.test(k))).toEqual([]);
    for (const path of ["../gteki/graph.json", "../gteki/pois.json"]) expect(JSON.stringify(read(path))).not.toContain(source.id);
    const src = read("../data/graph.src.json");
    for (const [key, value] of Object.entries(src)) if (!["sources", "assets"].includes(key)) expect(JSON.stringify(value)).not.toContain(source.id);
  });

  it("never advances route evidence timestamps when the context source is added or refreshed", () => {
    // Execute only the real build_instant function, without loading geometry or writing generated files.
    const script = `import ast, datetime, json, os, sys
tree = ast.parse(open(sys.argv[1]).read())
fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'build_instant')
scope = {'datetime': datetime, 'os': os, 'STATION_TZ': datetime.timezone(datetime.timedelta(hours=9))}
os.environ.pop('SOURCE_DATE_EPOCH', None)
exec(compile(ast.Module(body=[fn], type_ignores=[]), sys.argv[1], 'exec'), scope)
src = json.load(open(sys.argv[2]))
baseline = json.loads(json.dumps(src))
baseline['sources'] = [s for s in baseline['sources'] if s['id'] != 'ksj-n02-2025']
expected = scope['build_instant'](baseline)
assert scope['build_instant'](src) == expected
next(s for s in src['sources'] if s['id'] == 'ksj-n02-2025')['retrievedAt'] = '2099-01-01T00:00:00Z'
assert scope['build_instant'](src) == expected
print('unchanged')`;
    expect(execFileSync("python3", ["-I", "-c", script, new URL("../pipeline/build_station.py", import.meta.url).pathname, new URL("../data/graph.src.json", import.meta.url).pathname], { encoding: "utf8" }).trim()).toBe("unchanged");
  });
});

describe("N02 loader", () => {
  it("retains renderer geometry, styles by kind, shares the street gate and never enters collision paths", async () => {
    const gltf = await load();
    const parts = meshes(gltf.scene);
    const originals = parts.map((m) => Array.from(m.geometry.getAttribute("position").array));
    const originalMaterials = parts.flatMap((m) => Array.isArray(m.material) ? m.material : [m.material]);
    const freed = originalMaterials.map((m) => vi.spyOn(m, "dispose"));
    const root = new THREE.Group();
    const h = host(vi.fn(async () => gltf));
    const overlay = loadN02Overlay(THREE, h, root);
    await overlay.ready;
    expect(h.loadGlb).toHaveBeenCalledWith(N02_GLB);
    expect(root.children).toEqual([]);
    expect(gltf.scene.position.toArray()).toEqual([0, N02_OFFSET_M, 0]);
    expect(gltf.scene.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(gltf.scene.scale.toArray()).toEqual([1, 1, 1]);
    const road = new THREE.Mesh(new THREE.BufferGeometry());
    dressContext(road, new THREE.MeshBasicMaterial());
    parts.forEach((mesh, i) => {
      expect(Array.from(mesh.geometry.getAttribute("position").array)).toEqual(originals[i]);
      const m = mesh.material as THREE.MeshBasicMaterial;
      expect(m.isMeshBasicMaterial).toBe(true);
      expect(m.color.getHex()).toBe(N02_COLORS[mesh.userData.kind as keyof typeof N02_COLORS]);
      expect(m.depthWrite).toBe(false);
      expect([m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits]).toEqual([true, -1, -1]);
      expect(mesh.renderOrder).toBe(N02_RENDER_ORDER);
      expect(mesh.renderOrder).toBeGreaterThan(road.renderOrder);
      expect(mesh.userData.verification).toBe("UNVERIFIED");
    });
    for (const spy of freed) expect(spy).toHaveBeenCalledOnce();
    for (const [y, fogged, expected] of [[34, true, true], [31.4, true, false], [300, false, false], [34, false, false]] as const) {
      overlay.setVisible(contextVisibleAt(y, streetRenderY(station.floors), fogged));
      expect(gltf.scene.visible).toBe(expected);
      expect(root.children.includes(gltf.scene)).toBe(expected);
    }
    expect(sceneFromGlbRoles(gltf.scene)).toEqual({ walkable: [], colliders: [], cameraBlockers: [] });
    const fenceCollider = new THREE.Group();
    const collision = assembleCollision(THREE, gltf.scene, { materialFor: () => undefined, enuToRenderer, toRenderer: (x, y, z) => new THREE.Vector3(...enuToRenderer({ x, y, z })), fenceCollider });
    expect(collision.walkable.filter((o) => o !== collision.bridges)).toEqual([]);
    expect(collision.colliders).toEqual([fenceCollider]);
    expect([...collision.meshesByRole.keys()]).toEqual(["context"]);
    const sceneCode = readFileSync(new URL("./scene.ts", import.meta.url), "utf8");
    expect(sceneCode).toContain("n02Overlay.setVisible(show && context !== null)");
    expect(sceneCode).toContain("setContext(seen !== null && contextVisibleAt(seen.y, streetY, seen.fogged))");
    expect(sceneCode).toContain("n02Overlay.dispose()");
    const geometrySpies = parts.map((m) => vi.spyOn(m.geometry, "dispose"));
    const materialSpies = [...new Set(parts.map((m) => m.material as THREE.Material))].map((m) => vi.spyOn(m, "dispose"));
    overlay.setVisible(true);
    overlay.dispose();
    overlay.dispose();
    overlay.setVisible(true);
    expect(root.children).toEqual([]);
    expect(gltf.scene.visible).toBe(false);
    for (const spy of [...geometrySpies, ...materialSpies]) expect(spy).toHaveBeenCalledOnce();
    collision.bridges?.geometry.dispose();
    collision.bridges?.material.dispose();
    road.geometry.dispose();
    (road.material as THREE.Material).dispose();
  });

  it("warns and leaves the scene unchanged after a load failure or missing asset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const missing of [false, true]) {
        const root = new THREE.Group(), existing = new THREE.Group();
        root.add(existing);
        const h = { assetUrl: () => missing ? null : "url", loadGlb: vi.fn(async (): Promise<GLTF> => { throw new Error("unavailable"); }) };
        const overlay = loadN02Overlay(THREE, h, root);
        overlay.setVisible(true);
        await overlay.ready;
        expect(root.children).toEqual([existing]);
        expect(h.loadGlb).toHaveBeenCalledTimes(missing ? 0 : 1);
        overlay.dispose();
      }
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[0]![0]).toContain("skipping overlay");
    } finally { warn.mockRestore(); }
  });

  it("frees a load that finishes after teardown, without adding it to the scene", async () => {
    const gltf = await load();
    let resolve!: (gltf: GLTF) => void;
    const pending = new Promise<GLTF>((res) => { resolve = res; });
    const root = new THREE.Group();
    const spies = meshes(gltf.scene).flatMap((m) => [vi.spyOn(m.geometry, "dispose"), vi.spyOn(m.material as THREE.Material, "dispose")]);
    const overlay = loadN02Overlay(THREE, host(vi.fn(() => pending)), root);
    overlay.setVisible(true);
    overlay.dispose();
    resolve(gltf);
    await overlay.ready;
    expect(root.children).toEqual([]);
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
  });

  it("uses the current visibility decision when a background load finishes", async () => {
    const gltf = await load();
    let resolve!: (gltf: GLTF) => void;
    const pending = new Promise<GLTF>((res) => { resolve = res; });
    const root = new THREE.Group();
    const overlay = loadN02Overlay(THREE, host(vi.fn(() => pending)), root);
    overlay.setVisible(true);
    expect(root.children).toEqual([]);
    resolve(gltf);
    await overlay.ready;
    expect(root.children).toEqual([gltf.scene]);
    overlay.setVisible(false);
    expect(root.children).toEqual([]);
    overlay.dispose();
  });
});
