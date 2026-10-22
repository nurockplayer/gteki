/**
 * PLATEAU street context (#39): wiring of the two tools/gis GLBs into the Shinjuku scene.
 * The pinned BASELINE values are the scene of fe8d3b6 (before the context), measured with the same helpers.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { sceneFromGlbRoles, type StationScene } from "@gteki/scene-api";
import { validateBundle, type StationBundle } from "@gteki/schema";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json";
import surfaceJson from "../data/surface.json";
import { buildLayout, type Plan } from "../scene/layout.ts";
import type { SurfaceData } from "../scene/surface-data.ts";
import { CONTEXT_ASSET_ID, CONTEXT_ATTRIBUTION, CONTEXT_GLB, CONTEXT_OMIT, contextGlbFor, contextMeshes, prepareContext } from "../scene/context.ts";
import { buildScene } from "../gteki/scene.ts";
import { explorerTargets } from "../../../apps/web/src/explorer/raycast.ts";
import { sourceCredit } from "../../../apps/web/src/credits.ts";
import { discoverStations, publishableAssets } from "../../../apps/web/stations-plugin.ts";
import { contextIntrusions, walkableZones } from "./context-clearance.ts";
import { GTEKI_DIR, SOURCES_DIR, featureRows, nodeLoadGlb, parseGlb, readGlbBytes } from "./context-glb.ts";
import { physicalDigest } from "./context-digest.ts";
import { measure } from "./scene-budget.ts";

const { bundle } = loadShinjukuBundle();
const layout = buildLayout(bundle, planJson as Plan);

/** fe8d3b6: colliders, walls, walkable, camera blockers and spawn points (context-digest.ts), identical at low and high. */
const BASELINE_DIGEST = { all: "6b61a84cf89d8029f460028830543b8b4534d59d41d023f7d0de15526e7fb206", walls: "a714c93a0a556bf7eee01bef060c9de986e65f219a4130791c2533cd307a5dd1", walkable: 433, colliders: 2, cameraBlockers: 3 };
/** fe8d3b6: the whole scene graph (scene-budget.ts), identical at low and high. */
const BASELINE_BUDGET = { draws: 285, triangles: 224991, geometryBytes: 13288866, meshes: 136 };
/** fe8d3b6: the LOD1 building extrusions the context replaces (surface-facade-0..4 and surface-roof). */
const LOD1_BUILDINGS = { draws: 6, triangles: 25308, geometryBytes: 2_052_424 };

const manifest = JSON.parse(readFileSync(join(SOURCES_DIR, "context-manifest.json"), "utf8")) as {
  attribution: string;
  assets: Record<"low" | "high", { uri: string; outputSha256: string; outputBytes: number; triangles: number; drawCalls: number; features: number }>;
};
const VARIANT = { low: { uri: CONTEXT_GLB.low, draws: 1, triangles: 14_260, drawnTriangles: 14_220, geometryBytes: 672_408, meshNames: ["ctx_bldg_all"] }, high: { uri: CONTEXT_GLB.high, draws: 6, triangles: 83_705, drawnTriangles: 83_543, geometryBytes: 5_088_132, meshNames: ["ctx_bldg_t00_00", "ctx_bldg_t00_01", "ctx_bldg_t00_02", "ctx_bldg_t01_00", "ctx_bldg_t01_01", "ctx_bldg_t01_02"] } } as const;

const withContext = (quality: "low" | "high", over: Record<string, unknown> = {}) => ({
  THREE, bundle, quality, assetUrl: (uri: string) => `/@fs/${uri}`, loadGlb: nodeLoadGlb(), ...over,
}) as never;
const surfaceOf = (scene: StationScene) => scene.root.getObjectByName("surface-render-only") as THREE.Group;
const lod1Names = (scene: StationScene) => surfaceOf(scene).children.map((c) => c.name).filter((n) => /^surface-(facade-\d|roof)$/.test(n));

describe("street context: station record and rights gate", () => {
  it("declares one visual asset: low file as uri, high file in files, floor toei-nwd-0, both PLATEAU bldg sources", () => {
    const assets = bundle.assets ?? [];
    expect(assets.map((a) => a.id)).toEqual([CONTEXT_ASSET_ID]);
    const a = assets[0]!;
    expect(a).toMatchObject({ uri: CONTEXT_GLB.low, files: [CONTEXT_GLB.high], format: "glb", role: "visual", floorIds: ["toei-nwd-0"] });
    expect(a.sourceIds).toEqual(["plateau-13104-bldg-53394525", "plateau-13104-bldg-53394526"]);
    expect(a.derivation).toMatch(/shinjuku-station-enu-v0/);
    expect(a.derivation).toMatch(/flattened to street z = 0/);
  });

  it("carries the Owner's credit verbatim (Q10 Option A) and CC BY 4.0 with its URL on every source the asset cites", () => {
    expect(CONTEXT_ATTRIBUTION).toBe("出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成（建物の基部を地表面の高さにそろえて表示）");
    expect(manifest.attribution).toBe(CONTEXT_ATTRIBUTION);
    for (const id of bundle.assets![0]!.sourceIds) {
      const source = bundle.sources.find((s) => s.id === id)!;
      expect(source.rights).toBe("REUSABLE_WITH_CONDITIONS");
      expect(source.usage).toBe("data");
      expect(source.modified).toBe(true);
      // What apps/web's Coverage dialog renders for this source.
      expect(sourceCredit(source)).toMatchObject({ attribution: CONTEXT_ATTRIBUTION, license: { name: "CC BY 4.0", href: "https://creativecommons.org/licenses/by/4.0/" }, modified: true });
    }
  });

  it("the committed GLB bytes are exactly the files the manifest and receipts name", () => {
    for (const v of ["low", "high"] as const) {
      const bytes = readGlbBytes(VARIANT[v].uri);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.assets[v].outputSha256);
      expect(bytes.length).toBe(manifest.assets[v].outputBytes);
      expect(manifest.assets[v].uri).toBe(VARIANT[v].uri);
    }
  });

  it("has no validation error, and passes apps/web's publishableAssets gate (declared, rights-checked, nothing undeclared)", () => {
    expect(validateBundle(bundle).filter((i) => i.level === "error")).toEqual([]);
    const root = mkdtempSync(join(tmpdir(), "gteki-shinjuku-"));
    try {
      symlinkSync(join(GTEKI_DIR, ".."), join(root, "shinjuku"), "dir");
      const allowed = publishableAssets(discoverStations([root])).get("shinjuku")!;
      expect([...allowed].sort()).toEqual([CONTEXT_GLB.high, CONTEXT_GLB.low]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("negative control: dropping a source's credit or licence from the station record fails that gate", () => {
    const broken = (patch: (s: StationBundle["sources"][number]) => void) => {
      const b = structuredClone(bundle) as StationBundle;
      patch(b.sources.find((s) => s.id === "plateau-13104-bldg-53394525")!);
      return validateBundle({ ...b, station: { ...b.station, synthetic: false } }).filter((i) => i.level === "error").map((i) => i.code);
    };
    expect(broken((s) => { s.attribution = ""; })).toContain("source.attribution");
    expect(broken((s) => { s.license = { name: "", url: "" }; })).toContain("source.license");
    expect(broken((s) => { s.rights = "HOLD" as never; })).toContain("asset.rights");
  });
});

describe("street context: the GLBs", () => {
  for (const v of ["low", "high"] as const) {
    it(`${v}: tools/gis structure, tags, credit and per-building table`, () => {
      const glb = parseGlb(readGlbBytes(VARIANT[v].uri));
      expect(glb.meshes.map((m) => m.name)).toEqual(VARIANT[v].meshNames);
      expect(glb.meshes.length).toBe(VARIANT[v].draws);
      expect(glb.meshes.reduce((n, m) => n + m.indices.length / 3, 0)).toBe(VARIANT[v].triangles);
      expect(glb.json.asset.copyright).toBe(CONTEXT_ATTRIBUTION);
      for (const m of glb.meshes) {
        expect(m.extras).toMatchObject({ gteki_role: "context", navigation_use: "NOT_FOR_ROUTING", visual_only: true, frame_id: "shinjuku-station-enu-v0", vertical_mode: "per_feature_ground" });
        expect(m.extras.modifications).toEqual(["building bases flattened to street level"]);
      }
      const rows = featureRows(v);
      expect(rows.length).toBe(520);
      expect(new Set(rows.map((r) => r.gmlId)).size).toBe(520);
      expect(rows.reduce((n, r) => n + r.triCount, 0)).toBe(VARIANT[v].triangles);
    });
  }

  it("uses the scene's own frame: x east, y up from street z = 0, z = -north; the LOD1 import agrees building by building", () => {
    // Street z = 0 and axes: this scene draws street paving at y = 0 (z up), and ENU y is -z in three.js.
    const street = bundle.floors.find((f) => f.id === "toei-nwd-0")!;
    expect([street.ordinal, street.renderElevationM]).toEqual([0, 0]);
    expect(layout.streetPads.length).toBeGreaterThan(0);
    for (const p of layout.streetPads) expect(p.z).toBe(0);
    const lod1 = new Map((surfaceJson as unknown as SurfaceData).buildings.map((b) => [b.id.replace(/:\d+$/, ""), b]));
    for (const v of ["low", "high"] as const) {
      const glb = parseGlb(readGlbBytes(VARIANT[v].uri));
      const byName = new Map(glb.meshes.map((m) => [m.name, m]));
      let compared = 0, minY = Infinity;
      const offsets: number[] = [];
      for (const row of featureRows(v)) {
        const mesh = byName.get(row.mesh)!;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let t = row.triStart; t < row.triStart + row.triCount; t++) for (let k = 0; k < 3; k++) {
          const i = mesh.indices[t * 3 + k]!;
          const x = mesh.positions[i * 3]!, y = -mesh.positions[i * 3 + 2]!;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          minY = Math.min(minY, mesh.positions[i * 3 + 1]!);
        }
        const ref = lod1.get(row.gmlId);
        if (!ref) continue;
        const xs = ref.rings[0]!.map((p) => p[0]), ys = ref.rings[0]!.map((p) => p[1]);
        for (const [a, b] of [[x0, Math.min(...xs)], [x1, Math.max(...xs)], [y0, Math.min(...ys)], [y1, Math.max(...ys)]] as const) offsets.push(Math.abs(a - b));
        compared++;
      }
      expect(compared, v).toBeGreaterThan(350);
      // Same frame: the LOD1 import (decimetre-quantised, simplified) and the GLB agree on every footprint edge to the
      // centimetres (low: LOD1 against LOD1); the high file's LOD2 eaves, roof overhangs and wings the LOD1 import simplified away differ more (one LOD2 footprint edge is 23 m off its LOD1 import).
      offsets.sort((a, b) => a - b);
      expect(offsets[Math.floor(offsets.length / 2)]!, `${v} median`).toBeLessThan(0.15);
      if (v === "low") expect(offsets.at(-1)!, "low max").toBeLessThan(0.3);
      else expect(offsets[Math.floor(offsets.length * 0.95)]!, "high p95").toBeLessThan(2);
      // Each building's own ground is street z = 0 (LOD2 roofs/eaves can sit a few decimetres under it).
      expect(minY, v).toBeGreaterThan(-0.3);
    }
  });
});

describe("street context: scene wiring", () => {
  const built: Partial<Record<"off" | "noAssets" | "lowOn" | "highOn" | "rejected", StationScene>> = {};
  beforeAll(async () => {
    const canvasContext = new Proxy({}, { get: (_t, key) => (key === "createLinearGradient" || key === "createRadialGradient") ? () => ({ addColorStop() {} }) : () => undefined });
    vi.stubGlobal("document", { createElement: () => ({ width: 1, height: 1, getContext: () => canvasContext }) });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The explorer hands a scene no asset URL in these tests: the real station record, no context.
    built.off = await buildScene({ THREE, bundle, quality: "low" } as never);
    built.noAssets = await buildScene(withContext("low", { bundle: { ...bundle, assets: undefined } }));
    built.rejected = await buildScene(withContext("low", { loadGlb: () => Promise.reject(new Error("offline")) }));
    built.lowOn = await buildScene(withContext("low"));
    built.highOn = await buildScene(withContext("high"));
  }, 240_000);
  afterAll(() => {
    for (const s of Object.values(built)) s?.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("context off (no asset record, no bundled file, load failure, or a wrong credit)", () => {
    it("is the scene of fe8d3b6: same graph, LOD1 buildings drawn, nothing named street-context", () => {
      for (const key of ["off", "noAssets", "rejected"] as const) {
        const scene = built[key]!;
        expect(measure(scene.root), key).toEqual(BASELINE_BUDGET);
        expect(lod1Names(scene).length, key).toBe(6);
        expect(scene.root.getObjectByName("street-context"), key).toBeUndefined();
        expect(surfaceOf(scene).userData.buildingParts, key).toBeGreaterThan(100);
      }
    });
    it("has identical colliders, walls, walkable, blockers and spawn points", () => {
      for (const key of ["off", "noAssets", "rejected"] as const) {
        const d = physicalDigest(built[key]!);
        expect({ all: d.all, walls: d.walls, walkable: d.walkable.length, colliders: d.colliders.length, cameraBlockers: d.cameraBlockers.length }, key).toEqual(BASELINE_DIGEST);
      }
    });
    it("negative control: the digest does change when a wall, a collider or a spawn point does", () => {
      const scene = built.off!;
      const base = physicalDigest(scene).all;
      const moved = { ...scene, walls: scene.walls!.map((w, i) => (i === 0 ? { ...w, zMax: w.zMax + 0.01 } : w)) } as StationScene;
      expect(physicalDigest(moved).all).not.toBe(base);
      const spawn = { ...scene, spawnPoints: [...scene.spawnPoints!, { x: 0, y: 0, z: 0, headingDeg: 0 }] } as StationScene;
      expect(physicalDigest(spawn).all).not.toBe(base);
      const extra = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      const withBox = { ...scene, colliders: [...scene.colliders!, extra] } as StationScene;
      expect(physicalDigest(withBox).all).not.toBe(base);
    });
    it("contextGlbFor refuses each way the record can be incomplete", () => {
      const host = (over: Record<string, unknown>) => ({ bundle, quality: "low" as const, assetUrl: (u: string) => u, loadGlb: () => undefined, ...over });
      expect(contextGlbFor(host({}))).toBe(CONTEXT_GLB.low);
      expect(contextGlbFor(host({ quality: "high" }))).toBe(CONTEXT_GLB.high);
      expect(contextGlbFor(host({ bundle: { ...bundle, assets: [] } }))).toBeNull();
      expect(contextGlbFor(host({ assetUrl: undefined }))).toBeNull();
      expect(contextGlbFor(host({ assetUrl: () => null }))).toBeNull();
      expect(contextGlbFor(host({ loadGlb: undefined }))).toBeNull();
      const wrongCredit = { ...bundle, sources: bundle.sources.map((s) => (s.id === "plateau-13104-bldg-53394526" ? { ...s, attribution: "出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成" } : s)) };
      expect(contextGlbFor(host({ bundle: wrongCredit }))).toBeNull();
      const lowOnly = { ...bundle, assets: bundle.assets!.map((a) => ({ ...a, files: [] })) };
      expect(contextGlbFor(host({ bundle: lowOnly, quality: "high" }))).toBeNull();
    });
    it("refuses a GLB that is not the visual-only ctx_bldg_* file tools/gis writes", () => {
      const mesh = (name: string, role?: string) => { const m = new THREE.Mesh(new THREE.BufferGeometry()); m.name = name; if (role) m.userData.gteki_role = role; return m; };
      const group = (...children: THREE.Object3D[]) => { const g = new THREE.Group(); g.add(...children); return g; };
      expect(contextMeshes(group(mesh("ctx_bldg_all", "context")))).toHaveLength(1);
      expect(contextMeshes(group(mesh("floor", "context")))).toBeNull();
      expect(contextMeshes(group(mesh("ctx_bldg_all", "walkable")))).toBeNull();
      expect(contextMeshes(group(mesh("ctx_bldg_all")))).toBeNull();
      expect(contextMeshes(group(mesh("ctx_bldg_a", "context"), mesh("wall_1")))).toBeNull();
      expect(contextMeshes(new THREE.Group())).toBeNull();
    });
  });

  for (const [key, quality] of [["lowOn", "low"], ["highOn", "high"]] as const) {
    describe(`context on, quality ${quality}`, () => {
      it("removes the LOD1 extrusions and adds the right variant, under the street layer's own visibility rule", () => {
        const scene = built[key]!;
        expect(lod1Names(scene)).toEqual([]);
        expect(surfaceOf(scene).userData.buildingParts).toBe(0);
        const ctx = surfaceOf(scene).getObjectByName("street-context")!;
        expect(ctx).toBeDefined();
        expect(ctx.parent).toBe(surfaceOf(scene));
        const meshes: THREE.Mesh[] = [];
        ctx.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
        expect(meshes.map((m) => m.name)).toEqual([...VARIANT[quality].meshNames]);
        expect(measure(ctx)).toMatchObject({ draws: VARIANT[quality].draws, triangles: VARIANT[quality].drawnTriangles });
        // The other quality's file is not in the scene.
        const other = quality === "low" ? VARIANT.high : VARIANT.low;
        expect(meshes.some((m) => other.meshNames.includes(m.name as never))).toBe(false);
        // The street layer stays what decides when buildings are drawn.
        expect(surfaceOf(scene).visible).toBe(false);
      });
      it("changes the scene graph by exactly: LOD1 extrusions out, this variant in", () => {
        const scene = built[key]!;
        const now = measure(scene.root), v = VARIANT[quality];
        expect(now.draws).toBe(BASELINE_BUDGET.draws - LOD1_BUILDINGS.draws + v.draws);
        expect(now.triangles).toBe(BASELINE_BUDGET.triangles - LOD1_BUILDINGS.triangles + v.drawnTriangles);
        expect(now.geometryBytes).toBe(BASELINE_BUDGET.geometryBytes - LOD1_BUILDINGS.geometryBytes + v.geometryBytes);
      });
      it("leaves colliders, walls, walkable surfaces, camera blockers and spawn points byte-identical to fe8d3b6", () => {
        const d = physicalDigest(built[key]!);
        expect({ all: d.all, walls: d.walls, walkable: d.walkable.length, colliders: d.colliders.length, cameraBlockers: d.cameraBlockers.length }).toEqual(BASELINE_DIGEST);
      });
      it("is never walkable, a collider, a camera blocker or a sky target, by any list or by the explorer's role rules", () => {
        const scene = built[key]!;
        const ctx = surfaceOf(scene).getObjectByName("street-context")!;
        const inside = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === ctx) return true; return false; };
        const targets = explorerTargets(scene.walkable, scene.colliders ?? [], scene.cameraBlockers ?? []);
        for (const list of [scene.walkable, scene.colliders ?? [], scene.cameraBlockers ?? [], targets.ground, targets.collider, targets.sky, targets.camera, [...targets.blockers]]) {
          expect(list.filter(inside)).toEqual([]);
        }
        // Classifying the GLB by gteki_role (the manifest path of the explorer) finds nothing physical in it.
        const roles = sceneFromGlbRoles(ctx, { assetRole: "visual" });
        expect([roles.walkable.length, roles.colliders.length, roles.cameraBlockers.length]).toEqual([0, 0, 0]);
        ctx.traverse((o) => { if ((o as THREE.Mesh).isMesh) expect(o.userData.gteki_role).toBe("context"); });
      });
      it("carries the credit on the group and in the station record", () => {
        const ctx = surfaceOf(built[key]!).getObjectByName("street-context")!;
        expect(ctx.userData.attribution).toBe(CONTEXT_ATTRIBUTION);
        expect(bundle.sources.filter((s) => bundle.assets![0]!.sourceIds.includes(s.id)).every((s) => s.attribution === CONTEXT_ATTRIBUTION)).toBe(true);
      });
    });
  }
});

describe("street context: clearance from our walkable street", () => {
  /**
   * A building whose footprint (roofs included) covers more than TOLERANCE of a walkable or opened street zone
   * intrudes. Nothing is moved or edited in the GLB: the buildings found are listed, by gml_id, in
   * sources/context-omit.json and left out of the drawing by triangle range (a visual omission, not a claim that
   * the building is absent). The omit list must equal exactly the intruders found without it, so it cannot grow
   * silently, and with it applied there are none.
   */
  const TOLERANCE_M2 = 0.05;
  const zones = walkableZones(layout, bundle);
  const omitted = new Set(CONTEXT_OMIT.omit.map((o) => o.gmlId));

  it("the zones are the real street: pads, exit tops, openings, the four canopies, roofed runs and street-height corridors", () => {
    expect(zones.street.length).toBeGreaterThan(0);
    expect(zones.opening.length).toBeGreaterThan(0);
    expect(zones.canopy.length).toBe(4);
    expect(zones.route.length).toBeGreaterThan(0);
  });

  for (const v of ["low", "high"] as const) {
    it(`${v}: the intruders without the omit list are exactly the omit list, and none remain with it applied`, () => {
      const meshes = parseGlb(readGlbBytes(VARIANT[v].uri)).meshes;
      const rows = featureRows(v);
      const found = contextIntrusions(meshes, rows, zones, TOLERANCE_M2);
      expect([...new Set(found.map((r) => r.gmlId))].sort()).toEqual([...omitted].sort());
      // Reported overlaps in the list are the measured ones.
      for (const o of CONTEXT_OMIT.omit) for (const r of found.filter((f) => f.gmlId === o.gmlId)) expect(r.areaM2, `${o.gmlId} ${r.zone}`).toBeCloseTo(o.overlapM2[r.zone]!, 2);
      expect(contextIntrusions(meshes, rows.filter((r) => !omitted.has(r.gmlId)), zones, TOLERANCE_M2)).toEqual([]);
    });
  }

  it("every omitted id and triangle range is in the features table of both files, and the list is for these GLBs", () => {
    const man = JSON.parse(readFileSync(join(SOURCES_DIR, "context-omit.json"), "utf8")) as { glbSha256: Record<"low" | "high", string>; reason: string };
    expect(man.reason).toBe("E27 exit opening lies inside this building's footprint; the context is a solid visual mass with no modelled opening, so drawing it would put the exit inside a wall. Omitted visually; not a claim that the building is absent.");
    for (const v of ["low", "high"] as const) {
      expect(man.glbSha256[v]).toBe(manifest.assets[v].outputSha256);
      expect(CONTEXT_OMIT.glbTriangles[v]).toBe(VARIANT[v].triangles);
      const rows = featureRows(v);
      for (const o of CONTEXT_OMIT.omit) {
        const row = rows.find((r) => r.gmlId === o.gmlId);
        expect(row, `${v} ${o.gmlId}`).toBeDefined();
        expect({ mesh: row!.mesh, triStart: row!.triStart, triCount: row!.triCount }, `${v} ${o.gmlId}`).toEqual(o.ranges[v]);
      }
    }
  });

  for (const v of ["low", "high"] as const) {
    it(`${v}: prepareContext removes exactly the omitted triangles and leaves the rest in order; a file it was not written for is refused`, async () => {
      const load = nodeLoadGlb();
      const original = parseGlb(readGlbBytes(VARIANT[v].uri)).meshes;
      const gltf = await load(VARIANT[v].uri);
      expect(prepareContext(gltf.scene, v)).toBe(true);
      const meshes = contextMeshes(gltf.scene)!;
      let removed = 0;
      for (const mesh of meshes) {
        const before = original.find((m) => m.name === mesh.name)!.indices;
        const ranges = CONTEXT_OMIT.omit.map((o) => o.ranges[v]).filter((r) => r.mesh === mesh.name).sort((a, b) => a.triStart - b.triStart);
        const expected: number[] = [];
        for (let t = 0; t < before.length / 3; t++) if (!ranges.some((r) => t >= r.triStart && t < r.triStart + r.triCount)) expected.push(before[t * 3]!, before[t * 3 + 1]!, before[t * 3 + 2]!);
        expect(Array.from(mesh.geometry.index!.array), mesh.name).toEqual(expected);
        removed += (before.length - expected.length) / 3;
        // Uint16 index exactly when the mesh has fewer than 65,536 vertices.
        expect(mesh.geometry.index!.array instanceof Uint16Array, mesh.name).toBe(mesh.geometry.attributes.position!.count < 65_536);
      }
      expect(removed).toBe(CONTEXT_OMIT.omit.reduce((n, o) => n + o.ranges[v].triCount, 0));
      // The other variant's file does not fit this list.
      const other = await load(VARIANT[v === "low" ? "high" : "low"].uri);
      expect(prepareContext(other.scene, v)).toBe(false);
      // A range that no longer fits (a replaced GLB with fewer triangles) is refused, not applied.
      const stale = await load(VARIANT[v].uri);
      const first = contextMeshes(stale.scene)![0]!;
      first.geometry.setIndex(Array.from(first.geometry.index!.array).slice(0, 30));
      expect(prepareContext(stale.scene, v)).toBe(false);
    });
  }

  it("the deliberately kept 31.46 m tower (bldg_425e09d4-026e-4cf0-a7cf-20ad8f22b5d3, beside exits 3/4) is in both files and clear of our street", () => {
    const id = "bldg_425e09d4-026e-4cf0-a7cf-20ad8f22b5d3";
    for (const v of ["low", "high"] as const) {
      const row = featureRows(v).find((r) => r.gmlId === id)!;
      expect(row, v).toBeDefined();
      expect(row.groundOffsetM, v).toBeGreaterThan(31.4);
      expect(row.groundOffsetM, v).toBeLessThan(31.6);
      expect(contextIntrusions(parseGlb(readGlbBytes(VARIANT[v].uri)).meshes, [row], zones, TOLERANCE_M2), v).toEqual([]);
    }
  });

  it("negative control: a building dropped onto exit 1's top is reported", () => {
    const top = { x: -59.9, y: 211.96 };
    const s = 4;
    // One building, plan square around the exit top, two triangles, glTF z = -north.
    const positions = new Float32Array([top.x - s, 0, -(top.y - s), top.x + s, 0, -(top.y - s), top.x + s, 0, -(top.y + s), top.x - s, 0, -(top.y + s)]);
    const mesh = { name: "m", positions, indices: new Uint32Array([0, 1, 2, 0, 2, 3]), extras: {} };
    const rows = contextIntrusions([mesh], [{ gmlId: "test", mesh: "m", triStart: 0, triCount: 2, groundOffsetM: 0, lod: "LOD1" }], zones, TOLERANCE_M2);
    expect(rows.find((r) => r.zone === "street")?.areaM2).toBeGreaterThan(1);
  });
});
