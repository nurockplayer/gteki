// Street-level context layer (#39): the shipped GLBs are buildings only and visual only, the explorer's
// collision world never sees them, and the visibility gate hides them underground and in overview.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { glbPrimitivePlugin, roleOf, sceneFromGlbRoles } from "@gteki/scene-api";
import { enuToRenderer } from "../../../packages/geo/src/index.ts";
import { explorerTargets } from "../../../apps/web/src/explorer/raycast.ts";
import { buildFenceCollider } from "./fences.ts";
import accessFences from "./access_fences.json";
import { CONTEXT_GATE, CONTEXT_GLB, contextVisibleAt, createContextMaterial, dressContext, streetRenderY, trackCamera } from "./context.ts";
import { assembleCollision } from "./scene.ts";

const GTEKI = new URL("../gteki/", import.meta.url).pathname;
const ATTRIBUTION = "出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成";

interface GlbJson {
  nodes: { name?: string; mesh?: number; extras?: Record<string, unknown> }[];
  meshes: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[];
  accessors: { count: number }[];
  materials?: { name?: string }[];
  images?: unknown[];
}

function readGlb(uri: string): { bytes: Buffer; json: GlbJson } {
  const bytes = fs.readFileSync(GTEKI + uri);
  expect(bytes.toString("latin1", 0, 4)).toBe("glTF");
  const length = bytes.readUInt32LE(12);
  return { bytes, json: JSON.parse(bytes.toString("utf8", 20, 20 + length)) as GlbJson };
}

function triangles(j: GlbJson): number {
  let tris = 0;
  for (const m of j.meshes) for (const p of m.primitives) tris += j.accessors[p.indices ?? p.attributes.POSITION!]!.count / 3;
  return tris;
}

const BUDGET = {
  low: { tris: 12_000, meshes: 1 },
  high: { tris: 125_000, meshes: 4 },
} as const;

describe("ikebukuro context GLBs (buildings only, role context)", () => {
  for (const quality of ["low", "high"] as const) {
    describe(quality, () => {
      const { json } = readGlb(CONTEXT_GLB[quality]);
      const meshNodes = json.nodes.filter((n) => n.mesh !== undefined);

      it("exists and every node is gteki_role=context, named ctx_bldg_*, NOT_FOR_ROUTING and visual_only", () => {
        expect(meshNodes.length).toBeGreaterThan(0);
        for (const n of json.nodes) {
          expect(n.extras?.gteki_role, n.name).toBe("context");
          expect(n.extras?.navigation_use, n.name).toBe("NOT_FOR_ROUTING");
          expect(n.extras?.visual_only, n.name).toBe(true);
        }
        for (const n of meshNodes) expect(n.name, "node name").toMatch(/^ctx_bldg_/);
        for (const m of json.meshes) expect(m.name ?? "").toMatch(/^ctx_bldg_/);
      });

      it("carries no road geometry, road nodes or tran data (roads are on HOLD)", () => {
        const names = [...json.nodes.map((n) => n.name ?? ""), ...json.meshes.map((m) => m.name ?? "")];
        expect(names.filter((n) => /road|tran/i.test(n))).toEqual([]);
        // The primitives use the building material only (the file lists an unused road_surface material entry).
        const used = new Set(json.meshes.flatMap((m) => m.primitives.map((p) => json.materials?.[p.material ?? -1]?.name)));
        expect([...used]).toEqual(["building"]);
        for (const n of meshNodes) {
          expect(n.extras?.kinds, n.name).toEqual(["bldg"]);
          expect(n.extras?.kind, n.name).toBe("building");
        }
        // Attributes: geometry and normals only, no textures.
        for (const m of json.meshes) for (const p of m.primitives) expect(Object.keys(p.attributes).sort()).toEqual(["NORMAL", "POSITION"]);
        expect(json.images ?? []).toEqual([]);
      });

      it(`is within budget: at most ${BUDGET[quality].meshes} mesh(es) and ${BUDGET[quality].tris} triangles`, () => {
        expect(json.meshes.length).toBeLessThanOrEqual(BUDGET[quality].meshes);
        const tris = triangles(json);
        expect(tris).toBeGreaterThan(1000);
        expect(tris).toBeLessThanOrEqual(BUDGET[quality].tris);
      });
    });
  }

  it("low is a single ctx_bldg_all mesh", () => {
    const { json } = readGlb(CONTEXT_GLB.low);
    expect(json.meshes.length).toBe(1);
    expect(json.nodes.map((n) => n.name)).toEqual(["ctx_bldg_all"]);
  });
});

describe("the context is not part of the collision world", () => {
  const load = async (uri: string): Promise<GLTF> => {
    const buf = fs.readFileSync(GTEKI + uri);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const gltf = await new Promise<GLTF>((res, rej) => new GLTFLoader().register(glbPrimitivePlugin).parse(ab, "", res, rej));
    gltf.scene.updateMatrixWorld(true);
    return gltf;
  };

  for (const quality of ["low", "high"] as const) {
    it(`${quality}: the explorer classifies no mesh as walkable, collider or camera blocker, and assembleCollision sees none`, async () => {
      const { scene } = await load(CONTEXT_GLB[quality]);
      let meshes = 0;
      scene.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh) return;
        meshes++;
        expect(roleOf(o)).toBe("context");
      });
      expect(meshes).toBeGreaterThan(0);
      // The explorer's own classifier (manifest scenes) and the target builder.
      const roles = sceneFromGlbRoles(scene);
      expect(roles).toEqual({ walkable: [], colliders: [], cameraBlockers: [] });
      const t = explorerTargets(roles.walkable, roles.colliders, roles.cameraBlockers);
      expect([t.ground, t.collider, t.sky, t.camera].map((a) => a.length)).toEqual([0, 0, 0, 0]);
      // This scene's collision assembly (scene.ts): even if handed the context, nothing becomes walkable or solid.
      const toRenderer = (x: number, y: number, z: number) => new THREE.Vector3(...enuToRenderer({ x, y, z }));
      const fenceCollider = buildFenceCollider(THREE, (accessFences as { fences: never }).fences, toRenderer);
      const parts = assembleCollision(THREE, scene, { materialFor: () => undefined, toRenderer, enuToRenderer, fenceCollider });
      expect(parts.walkable.filter((o) => o !== parts.bridges)).toEqual([]);
      expect(parts.colliders).toEqual([fenceCollider]);
      expect([...parts.meshesByRole.keys()]).toEqual(["context"]);
    });
  }

  it("scene.ts returns no cameraBlockers and builds walkable and colliders from assembleCollision alone", () => {
    const src = fs.readFileSync(new URL("./scene.ts", import.meta.url), "utf8").replace(/\/\/[^\n]*/g, "");
    expect(src).not.toContain("cameraBlockers");
    expect(src).toMatch(/tileCollision\(THREE, \{ walkable, colliders \}\)/);
    expect(src).toMatch(/root\.add\(context\)/);
  });
});

describe("context visibility gate", () => {
  const station = JSON.parse(fs.readFileSync(GTEKI + "station.json", "utf8")) as {
    floors: { id: string; ordinal: number; intermediate: boolean; renderElevationM: number }[];
  };
  const graph = JSON.parse(fs.readFileSync(GTEKI + "graph.json", "utf8")) as { nodes: { id: string; floorId: string; kind: string; position: { z: number } }[] };
  const streetY = streetRenderY(station.floors)!;
  const HEAD = 1.62; // WALKER_BODY.eyeM

  it("takes the street floor's render elevation as the explorer does", () => {
    expect(streetY).toBe(32.5);
    expect(streetRenderY([])).toBeNull();
    expect(streetRenderY([{ ordinal: -1, intermediate: false, renderElevationM: 27.9 }])).toBeNull();
  });

  it("is hidden at every B1 camera height: the head of the highest B1 walking height, and the highest the follow camera can reach under a ceiling (31.42 m)", () => {
    const b1 = graph.nodes.filter((n) => n.floorId === "b1").map((n) => n.position.z);
    const top = Math.max(...b1);
    expect(top).toBeLessThan(29.2);
    for (const y of [Math.min(...b1), 27.9, top, top + HEAD, top + HEAD + 0.5, 31.42]) expect(contextVisibleAt(y, streetY), `y=${y}`).toBe(false);
    expect(CONTEXT_GATE.below).toBeLessThanOrEqual(1.1);
  });

  it("is hidden in overview: the camera Explorer.frameAll computes for this station, and any low overview orbit (no fog)", async () => {
    const buf = fs.readFileSync(GTEKI + "assets/ikebukuro_b1_lit.glb");
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const gltf = await new Promise<GLTF>((res, rej) => new GLTFLoader().register(glbPrimitivePlugin).parse(ab, "", res, rej));
    // The same arithmetic as Explorer.frameAll on the station root (context not attached while hidden).
    const b = new THREE.Box3().setFromObject(gltf.scene);
    const center = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    const radius = Math.max(20, Math.hypot(size.x, size.z) * 0.62);
    const overviewY = center.y + radius * 0.85;
    console.info(`overview camera y ${overviewY.toFixed(1)} m (center y ${center.y.toFixed(1)}, radius ${radius.toFixed(1)})`);
    expect(overviewY).toBeGreaterThan(200);
    expect(contextVisibleAt(overviewY, streetY)).toBe(false);
    expect(overviewY).toBeGreaterThan(streetY + CONTEXT_GATE.above);
    // Zoomed down the orbit can pass through the street band; the explorer drops the fog in overview.
    expect(contextVisibleAt(streetY + 10, streetY, false)).toBe(false);
  });

  it("is visible at street-level walking heights: the lowest exit top and the street floor, from first-person eye height to the follow camera's highest boom", () => {
    const exits = graph.nodes.filter((n) => n.floorId === "street" && n.kind === "exit").map((n) => n.position.z);
    const lowestExit = Math.min(...exits);
    expect(lowestExit).toBeGreaterThan(31);
    // Default follow pose (pitch -0.12, 3.4 m): about a metre over the head. Max zoom looking down: ~9 m over it.
    for (const y of [lowestExit + HEAD, streetY + HEAD, streetY + HEAD + 1, streetY + HEAD + 9.9, streetY + 20]) expect(contextVisibleAt(y, streetY), `y=${y}`).toBe(true);
    expect(contextVisibleAt(streetY + CONTEXT_GATE.above + 0.01, streetY)).toBe(false);
  });

  it("is hidden without a street floor, without a camera reading, and for NaN", () => {
    expect(contextVisibleAt(33, null)).toBe(false);
    expect(contextVisibleAt(Number.NaN, streetY)).toBe(false);
  });

  it("trackCamera reads the camera height and fog from a draw the scene makes anyway, and restores the hook", () => {
    const mesh = new THREE.Mesh();
    let own = 0;
    mesh.onBeforeRender = () => { own++; };
    const original = mesh.onBeforeRender;
    const track = trackCamera(mesh);
    expect(track.read()).toBeNull();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(1, 34, 2);
    camera.updateMatrixWorld(true);
    const scene = new THREE.Scene();
    const call = () => (mesh.onBeforeRender as (...a: unknown[]) => void)(null, scene, camera, null, null, null);
    call();
    expect(track.read()).toEqual({ y: 34, fogged: false });
    scene.fog = new THREE.Fog(0xffffff, 1, 100);
    camera.position.y = 301;
    camera.updateMatrixWorld(true);
    call();
    expect(track.read()).toEqual({ y: 301, fogged: true });
    expect(own).toBe(2);
    track.dispose();
    expect(mesh.onBeforeRender).toBe(original);
  });
});

describe("context material", () => {
  it("is a double-sided, fogged, unlit-by-the-rig material and dressContext changes nothing but the material", () => {
    const mat = createContextMaterial(THREE);
    expect(mat).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(mat.side).toBe(THREE.DoubleSide);
    expect(mat.fog).toBe(true);
    const g = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    a.name = "ctx_bldg_all";
    a.userData.gteki_role = "context";
    g.add(a);
    const meshes = dressContext(g, mat);
    expect(meshes).toEqual([a]);
    expect(a.material).toBe(mat);
    expect(a.name).toBe("ctx_bldg_all");
    expect(a.userData.gteki_role).toBe("context");
  });

  it("patches three's basic shader at the chunks it anchors on, and leaves the shader alone if they are missing", () => {
    const mat = createContextMaterial(THREE);
    const shader = { vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
    mat.onBeforeCompile(shader, null as never);
    expect(shader.vertexShader).toContain("varying vec3 vCtxN;");
    expect(shader.vertexShader).toContain("vCtxN = normalize( mat3( modelMatrix ) * normal );");
    expect(shader.fragmentShader).toContain("varying vec3 vCtxN;");
    expect(shader.fragmentShader).toMatch(/outgoingLight \*= [^;]+;\n#include <opaque_fragment>/);
    const bare = { vertexShader: "void main(){}", fragmentShader: "void main(){}" } as THREE.WebGLProgramParametersWithUniforms;
    mat.onBeforeCompile(bare, null as never);
    expect(bare).toEqual({ vertexShader: "void main(){}", fragmentShader: "void main(){}" });
  });
});

describe("station.json: street-context asset, sources and attribution", () => {
  const station = JSON.parse(fs.readFileSync(GTEKI + "station.json", "utf8")) as {
    station: { datasetVersion: string };
    sources: { id: string; attribution: string; modified: boolean; rights: string; license: { name: string } | null; sha256?: Record<string, string>; notes?: string }[];
    assets: { id: string; uri: string; role: string; floorIds: string[]; sourceIds: string[]; files?: string[]; derivation?: string }[];
  };
  const SOURCE_IDS = ["plateau-13116-bldg-53394576", "plateau-13116-bldg-53394577"];

  it("lists the two bldg sources with the exact PLATEAU attribution, modified: true, and no tran source", () => {
    expect(station.station.datasetVersion).toBe("ikebukuro-b1-slice5.5");
    const bldg = station.sources.filter((s) => SOURCE_IDS.includes(s.id));
    expect(bldg.map((s) => s.id).sort()).toEqual(SOURCE_IDS);
    for (const s of bldg) {
      expect(s.attribution).toBe(ATTRIBUTION);
      expect(s.modified).toBe(true);
      expect(s.license?.name).toBe("CC BY 4.0");
      expect(s.rights).toBe("REUSABLE_WITH_CONDITIONS");
      expect(s.notes).toContain("CONDITIONAL");
      expect(Object.keys(s.sha256 ?? {})).toHaveLength(1);
    }
    expect(station.sources.filter((s) => /tran|road/i.test(s.id))).toEqual([]);
  });

  it("has one visual street asset on the street floor, low as uri and high in files, pointing at existing files", () => {
    const a = station.assets.find((x) => x.id === "street-context")!;
    expect(a).toBeDefined();
    expect(a.role).toBe("visual");
    expect(a.floorIds).toEqual(["street"]);
    expect(a.sourceIds).toEqual(SOURCE_IDS);
    expect(a.uri).toBe(CONTEXT_GLB.low);
    expect(a.files).toEqual([CONTEXT_GLB.high]);
    for (const f of [a.uri, ...(a.files ?? [])]) expect(fs.existsSync(GTEKI + f), f).toBe(true);
    expect(a.derivation).toContain("--kinds bldg");
    for (const quality of ["low", "high"] as const) expect(a.derivation).toContain(`ikebukuro_context_${quality}.glb`);
  });

  it("records the sha256 of both committed GLBs in the derivation, and they match the bytes", async () => {
    const { createHash } = await import("node:crypto");
    const a = station.assets.find((x) => x.id === "street-context")!;
    for (const quality of ["low", "high"] as const) {
      const sha = createHash("sha256").update(fs.readFileSync(GTEKI + CONTEXT_GLB[quality])).digest("hex");
      expect(a.derivation, quality).toContain(sha);
    }
  });
});
