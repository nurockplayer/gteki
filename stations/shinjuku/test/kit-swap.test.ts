import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { StationScene } from "@gteki/scene-api";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { assembleScene } from "../gteki/scene.ts";
import { OEDO_MAGENTA } from "../scene/build.ts";
import { KIT_BUDGET, kitSwapRequested, kitTierFor, ROLE_SELECTORS } from "../scene/kit/config.ts";
import { collectKitAnchors } from "../scene/kit/anchors.ts";
import { batchKitPlacements } from "../scene/kit/batch.ts";
import { PlaceholderLedger, compact } from "../scene/kit/ledger.ts";
import { bundleProvider } from "../scene/kit/load.ts";
import { KitManifestError, parseKitManifest, selectAssets } from "../scene/kit/manifest.ts";
import { buildStationCatalog } from "../scene/kit/catalog.ts";
import { combRunM, planKitPlacements, totalsFor } from "../scene/kit/place.ts";
import { protectFareAndAccess } from "../scene/fare-fence.ts";
import { buildLayout, type Plan } from "../scene/layout.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { createKitSwap } from "../scene/kit/swap.ts";
import { tintSlots } from "../scene/kit/config.ts";
import type { KitAnchors, KitApplyContext, KitSwap, KitSwapReport } from "../scene/kit/types.ts";
import { digestStation } from "./helpers/station-digest.ts";
import { shinjukuStubManifestJson, STUB_TRIANGLES, stubAsset, stubManifestJson, stubProvider } from "./helpers/kit-stub.ts";

const { bundle } = loadShinjukuBundle();
const catalogJson = JSON.parse(readFileSync(new URL("../kit/catalog.json", import.meta.url), "utf8")) as Parameters<typeof shinjukuStubManifestJson>[0];
const library = (file: string) => JSON.parse(readFileSync(new URL(`../../../assets/library/${file}`, import.meta.url), "utf8"));

/** Digest of the flag-off station at fe8d3b6 (computed from that tree, and equal to geometry-lifetime.test.ts). */
const FE8D3B6 = {
  geometryDigest: "2b3a94baf32629b9d6371d6f365c808fd67efcb924a7ae00dc27daebdecb48b4",
  appearanceDigest: "3b66b3e19fd747dc9308d1f7ddc2adc8c60b13a53d925dca92514143dd07cfaf",
  meshes: 136,
  bytes: 13_288_866,
};

const sha = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const geometryHash = (g: THREE.BufferGeometry) => {
  const h = createHash("sha256");
  for (const [name, a] of [["index", g.index], ...Object.entries(g.attributes)] as const) {
    if (!a) continue;
    h.update(name);
    h.update(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength));
  }
  return h.digest("hex");
};
const isStationProxy = (o: THREE.Object3D) => o.name === "walk proxies (invisible)" || o.name === "viewer probe (draws nothing)";
const triangles = (root: THREE.Object3D, skip: (o: THREE.Object3D) => boolean = () => false) => {
  let n = 0;
  const visit = (o: THREE.Object3D) => {
    if (skip(o)) return;
    const m = o as THREE.Mesh;
    if (m.isMesh) n += ((m.geometry.index?.count ?? m.geometry.attributes.position!.count) / 3) * (m instanceof THREE.InstancedMesh ? m.count : 1);
    o.children.forEach(visit);
  };
  visit(root);
  return n;
};

describe("kit swap: Issue #94, Shinjuku half", () => {
  describe("flag and tier", () => {
    it("is off by default and only an explicit opt-in turns it on", () => {
      expect(kitSwapRequested(undefined).enabled).toBe(false);
      expect(kitSwapRequested("").enabled).toBe(false);
      expect(kitSwapRequested("?q=high").enabled).toBe(false);
      expect(kitSwapRequested("?kit=maybe").enabled).toBe(false);
      expect(kitSwapRequested("?kit=0").enabled).toBe(false);
      expect(kitSwapRequested("?kit=1")).toEqual({ enabled: true });
      expect(kitSwapRequested("?kit=full")).toEqual({ enabled: true, tier: "full" });
    });
    it("uses the mobile tier on both qualities until the loader decodes KTX2", () => {
      expect(kitTierFor("low", { ktx2: false })).toBe("mobile");
      expect(kitTierFor("high", { ktx2: false })).toBe("mobile");
      expect(kitTierFor("high", { ktx2: true })).toBe("full");
      expect(kitTierFor("high", { ktx2: true }, "mobile")).toBe("mobile");
    });
  });

  describe("manifest adapter", () => {
    it("parses both real manifests and refuses a tier mix-up", () => {
      const full = parseKitManifest(library("manifest.json"), "full");
      const mobile = parseKitManifest(library("mobile/manifest.json"), "mobile");
      expect(full.assets.length).toBe(48);
      expect(mobile.assets.length).toBe(48);
      expect(() => parseKitManifest(library("mobile/manifest.json"), "full")).toThrow(KitManifestError);
      expect(() => parseKitManifest(library("manifest.json"), "mobile")).toThrow(KitManifestError);
    });
    it("rejects malformed manifests with every problem listed", () => {
      expect(() => parseKitManifest({ contract: "gteki-asset/9", assets: [{ id: "../x" }] }, "full")).toThrow(/unsupported contract/);
      expect(() => parseKitManifest({ contract: "gteki-asset/0.1", assets: [{ id: "a" }, { id: "a" }] }, "full")).toThrow(KitManifestError);
    });
    it("carries the manifest licence string through verbatim and claims none of its own", () => {
      expect(parseKitManifest(stubManifestJson(), "mobile").license).toBe("STUB LICENCE STRING");
      expect(parseKitManifest(library("manifest.json"), "full").license).toBe(library("manifest.json").license);
    });
  });

  describe("tier parity on the real manifests", () => {
    const full = parseKitManifest(library("manifest.json"), "full");
    const mobile = parseKitManifest(library("mobile/manifest.json"), "mobile");

    it("the mobile tier has the same ids, sockets and params as the full tier", () => {
      expect(mobile.assets.map((a) => a.id)).toEqual(full.assets.map((a) => a.id));
      for (const f of full.assets) {
        const m = mobile.byId.get(f.id)!;
        expect(m.family).toBe(f.family);
        expect(m.placement).toBe(f.placement);
        expect(m.params).toEqual(f.params);
        expect(m.sockets.map((s) => [s.name, s.position, s.yawDeg])).toEqual(f.sockets.map((s) => [s.name, s.position, s.yawDeg]));
      }
    });
    it("every Shinjuku role selects the same ids in both tiers", () => {
      for (const [role, selector] of Object.entries(ROLE_SELECTORS)) {
        expect([role, selectAssets(mobile, selector).map((a) => a.id)]).toEqual([role, selectAssets(full, selector).map((a) => a.id)]);
      }
    });
    it("kit 0.1.0 has a lift portal and none of the other Shinjuku pieces: those wait for Lane E PR #143 and later", () => {
      expect(selectAssets(mobile, ROLE_SELECTORS.lift).map((a) => a.id)).toEqual(["gteki_lift_portal_w1000"]);
      for (const role of ["gate", "toilet", "exit", "stairs", "escalator"] as const) {
        expect([role, selectAssets(mobile, ROLE_SELECTORS[role]).length]).toEqual([role, 0]);
        expect([role, selectAssets(full, ROLE_SELECTORS[role]).length]).toEqual([role, 0]);
      }
    });
    it("the real lift portal fits the budget on the mobile tier, but not on the full tier even with KTX2", () => {
      const lift = (m: typeof mobile) => {
        const anchors = Array.from({ length: 15 }, (_, i) => ({ role: "lift" as const, key: String(i), nodeIds: [], wallPoint: { x: i * 10, y: 0 }, z: -7.8, u: { x: 1, y: 0 }, normal: { x: 0, y: 1 }, floorId: "f" }));
        const empty: KitAnchors = { gates: [], lifts: anchors, runs: [], toilets: [], exits: [] };
        return planKitPlacements({ anchors: empty, manifest: m, budget: KIT_BUDGET, caps: { ktx2: false } });
      };
      const onMobile = lift(mobile);
      expect(onMobile.placed.length).toBe(15);
      expect(onMobile.dropped).toEqual([]);
      expect(onMobile.totals.triangles).toBeLessThan(KIT_BUDGET.maxTriangles);
      expect(onMobile.totals.gpuTextureBytes).toBeLessThan(KIT_BUDGET.maxGpuTextureBytes);
      const onFull = lift(full);
      expect(onFull.placed.length).toBeLessThan(15);
      expect(onFull.dropped.some((d) => /GPU textures/.test(d.reason))).toBe(true);
    });
  });

  describe("placement and budget (pure)", () => {
    const manifest = parseKitManifest(stubManifestJson(), "mobile");
    const anchors = (gates: number, lifts: number, toilets = 0): KitAnchors => ({
      gates: Array.from({ length: gates }, (_, i) => ({ role: "gate" as const, key: `g${i}`, center: { x: i * 20, y: 0, z: -7.8 }, dir: { x: 1, y: 0 }, width: 1.8, floorId: "B1" })),
      lifts: Array.from({ length: lifts }, (_, i) => ({ role: "lift" as const, key: `l${i}`, nodeIds: [], wallPoint: { x: i * 10, y: 5 }, z: -7.8, u: { x: 1, y: 0 }, normal: { x: 0, y: -1 }, floorId: "B1" })),
      runs: [],
      toilets: Array.from({ length: toilets }, (_, i) => ({ role: "toilet" as const, key: `t${i}`, code: "F001", point: { x: 0, y: 0, z: -23.7 }, wall: { point: { x: 0, y: 0 }, u: { x: 1, y: 0 }, normal: { x: 0, y: 1 }, length: 6, s: 3 }, floorId: "B3" })),
      exits: [],
    });

    it("never offers a multi-aisle gate for a one-aisle row, and puts the cabinets on the verified row", () => {
      const r = planKitPlacements({ anchors: anchors(2, 0), manifest, budget: KIT_BUDGET, caps: { ktx2: false } });
      expect(r.placed.map((p) => p.assetId)).toEqual(["stub_gate_1aisle", "stub_gate_1aisle"]);
      // Flow is +x, so local -Z is +x and the cabinet span (z -0.3..-1.6, middle -0.95) is centred on the row.
      const p = r.placed[0]!;
      expect(p.yaw).toBeCloseTo(Math.atan2(-1, -0), 5); // local +Z against the flow
      const ahead = new THREE.Vector3(0, 0, -0.95).applyEuler(new THREE.Euler(0, p.yaw, 0)).add(new THREE.Vector3(...p.position));
      expect(ahead.x).toBeCloseTo(0, 5);
      expect(ahead.z).toBeCloseTo(-0, 5);
    });
    it("without a single-aisle gate in the manifest the rows keep their placeholders and the gap is reported", () => {
      const only4 = parseKitManifest(stubManifestJson({ remove: ["stub_gate_1aisle"] }), "mobile");
      const r = planKitPlacements({ anchors: anchors(3, 0), manifest: only4, budget: KIT_BUDGET, caps: { ktx2: false } });
      expect(r.placed).toEqual([]);
      expect(r.gaps.map((g) => g.role)).toEqual(["gate"]);
    });
    it("puts a lift's door plane on the existing wall plane, facing into the room", () => {
      const r = planKitPlacements({ anchors: anchors(0, 1), manifest, budget: KIT_BUDGET, caps: { ktx2: false } });
      const p = r.placed[0]!;
      // Wall at y = 5 (renderer z = -5); the room is at lower y (renderer +z), so local +Z must point to renderer +z.
      expect(p.yaw).toBeCloseTo(0, 5);
      const door = new THREE.Vector3(0, 0, -0.26).applyEuler(new THREE.Euler(0, p.yaw, 0)).add(new THREE.Vector3(...p.position));
      expect(door.z).toBeCloseTo(-5 + 0.004, 5);
      expect(p.position[1]).toBeGreaterThan(-7.8);
      expect(p.position[1]).toBeLessThan(-7.8 + 0.01);
    });
    it("only adds toilets at toilet facility anchors, on a wall long enough for the piece", () => {
      const r = planKitPlacements({ anchors: anchors(0, 0, 3), manifest, budget: KIT_BUDGET, caps: { ktx2: false } });
      expect(r.placed.map((p) => [p.role, p.assetId])).toEqual([["toilet", "stub_toilet_entrance"], ["toilet", "stub_toilet_entrance"], ["toilet", "stub_toilet_entrance"]]);
      const short = anchors(0, 0, 1);
      short.toilets[0]!.wall!.length = 0.8;
      expect(planKitPlacements({ anchors: short, manifest, budget: KIT_BUDGET, caps: { ktx2: false } }).placed).toEqual([]);
      const noWall = anchors(0, 0, 1);
      noWall.toilets[0]!.wall = null;
      expect(planKitPlacements({ anchors: noWall, manifest, budget: KIT_BUDGET, caps: { ktx2: false } }).placed).toEqual([]);
    });
    it("places no shop, kiosk, bench or vending piece, however many the manifest offers and whatever the anchors", () => {
      const onlyProps = parseKitManifest(stubManifestJson({ remove: ["stub_gate_1aisle", "stub_gate_4aisle", "stub_lift_portal", "stub_toilet_entrance"] }), "mobile");
      const r = planKitPlacements({ anchors: anchors(4, 15, 3), manifest: onlyProps, budget: KIT_BUDGET, caps: { ktx2: false } });
      expect(r.placed).toEqual([]);
      const real = parseKitManifest(library("mobile/manifest.json"), "mobile");
      const all = planKitPlacements({ anchors: anchors(4, 15, 3), manifest: real, budget: KIT_BUDGET, caps: { ktx2: false } });
      expect(all.placed.every((p) => p.role === "lift")).toBe(true);
      expect(all.placed.map((p) => p.assetId).join()).not.toMatch(/bench|vending|kiosk|shop|bin_|poster|column/);
    });
    it("refuses roles whose placeholder the build does not record (exits), so geometry is never doubled", () => {
      const withExit = anchors(0, 0);
      withExit.exits = [{ role: "exit", key: "x1", top: { x: 0, y: 0 }, center: { x: 0, y: 0 }, u: { x: 1, y: 0 }, halfWidth: 2, halfLength: 3, z: 0, floorId: "G" }];
      const m = parseKitManifest(stubManifestJson({ extra: [stubAsset("stub_canopy", "canopy", "free")] }), "mobile");
      const refused = planKitPlacements({ anchors: withExit, manifest: m, budget: KIT_BUDGET, caps: { ktx2: false } });
      expect(refused.placed).toEqual([]);
      expect(refused.gaps[0]?.reason).toMatch(/does not record/);
      const widened = planKitPlacements({ anchors: withExit, manifest: m, budget: KIT_BUDGET, caps: { ktx2: false }, placeable: new Set(["exit"]) });
      expect(widened.placed.map((p) => p.assetId)).toEqual(["stub_canopy"]);
    });
    describe("stair and escalator dressing (Lane E PR #143)", () => {
      const run = (role: "stairs" | "escalator", width: number, rise = 3.2, length = 4.8) => ({
        role, key: "r1", lo: { x: 0, y: 0, z: -7.8 }, hi: { x: length, y: 0, z: -7.8 + rise }, width, dir: { x: 1, y: 0 }, floorId: "B1",
      });
      const stair = (extra: Record<string, unknown> = {}) => stubAsset("stub_stair_nosing", "dressing", "linear", { tags: ["dressing", "stair"], materials: ["stub_yellow"], textures: {}, params: { step_count: 16, riser_mm: 200, tread_mm: 300, width_mm: 2400, parts: ["nosing"], ...extra } });
      const esc = (extra: Record<string, unknown> = {}) => stubAsset("stub_esc_comb_newel", "dressing", "linear", { tags: ["dressing", "escalator"], materials: ["stub_steel"], textures: {}, params: { rise_mm: 3200, width_mm: 1150, run_mm: 6000, parts: ["comb", "newel"], ...extra } });
      const plan = (assets: unknown[], runs: ReturnType<typeof run>[]) => {
        const a = anchors(0, 0);
        a.runs = runs;
        return planKitPlacements({ anchors: a, manifest: parseKitManifest(stubManifestJson({ extra: assets }), "mobile"), budget: KIT_BUDGET, caps: { ktx2: false } });
      };
      it("puts the nosing origin under the first nosing, climbing along the run", () => {
        const r = plan([stair()], [run("stairs", 2.4)]);
        expect(r.placed.map((p) => [p.role, p.assetId, p.replaces])).toEqual([["stairs", "stub_stair_nosing", "stair-nosing"]]);
        const p = r.placed[0]!;
        expect(p.position[0]).toBeCloseTo(0, 6);
        expect(p.position[2]).toBeCloseTo(0, 6);
        expect(p.position[1]).toBeCloseTo(-7.8 + 0.003, 6);
        // Local -Z (the climb) must point along +x (the run direction).
        const climb = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, p.yaw, 0));
        expect(climb.x).toBeCloseTo(1, 6);
        expect(climb.z).toBeCloseTo(0, 6);
      });
      it("puts the escalator comb line on the lower end node and adds (never replaces) placeholder geometry", () => {
        const r = plan([esc()], [run("escalator", 1.25, 3.2, 8.4)]);
        const p = r.placed[0]!;
        expect([p.assetId, p.replaces]).toEqual(["stub_esc_comb_newel", null]);
        expect(p.position[0]).toBeCloseTo(0, 6);
        expect(p.position[1]).toBeCloseTo(-7.797, 6);
        expect(p.position[2]).toBeCloseTo(0, 6);
      });
      it("never selects a piece that also carries parts the scene already draws, or one with no stated parts", () => {
        for (const parts of [["balustrade", "comb", "newel"], ["comb"], ["comb", "newel", "handrail"], undefined]) {
          const e = esc(parts ? { parts } : { parts: undefined });
          const r = plan([e], [run("escalator", 1.25, 3.2, 8.4)]);
          expect(r.placed).toEqual([]);
        }
        for (const parts of [["nosing", "skirt"], ["handrail"], ["nosing", "handrail", "skirt"]]) expect(plan([stair({ parts })], [run("stairs", 2.4)]).placed).toEqual([]);
        expect(plan([esc({ parts: ["newel", "comb"] })], [run("escalator", 1.25, 3.2, 8.4)]).placed.length).toBe(1);
      });
      it("fits on rise, length and width, and reports an unfit run as dropped", () => {
        expect(plan([stair()], [run("stairs", 2.4, 3.6)]).placed).toEqual([]); // rise 3.6 vs 16 x 200 mm
        expect(plan([stair()], [run("stairs", 1.8)]).placed).toEqual([]); // width 1.8 vs 2.4
        expect(plan([stair()], [run("stairs", 2.4, 3.2, 5.4)]).placed).toEqual([]); // length 5.4 vs 4.8
        const r = plan([esc()], [run("escalator", 1.25, 3.5, 8.4)]);
        expect(r.placed).toEqual([]);
        expect(r.dropped.map((d) => d.reason)).toEqual(["no piece fits this anchor"]);
        expect(plan([esc({ run_mm: 3000 })], [run("escalator", 1.25, 3.2, 8.4)]).placed).toEqual([]); // comb run 5.4 vs 8.4
      });
      it("derives the comb-to-comb run from the manifest, or from run_mm / angle_deg with the kit's flat steps", () => {
        expect(combRunM({ comb_run_m: 7.5, rise_mm: 1 })).toBe(7.5);
        expect(combRunM({ rise_mm: 4000, run_mm: 5000 })).toBeCloseTo(7.4, 9);
        expect(combRunM({ rise_mm: 4000, run_mm: 5000, flat_steps: 3 })).toBeCloseTo(5 + 2 * 3 * 0.4 + 0.8, 9);
        expect(combRunM({ rise_mm: 4000, angle_deg: 30 })).toBeCloseTo(4 / Math.tan(Math.PI / 6) + 2.4, 9);
        expect(combRunM({ rise_mm: 4000 })).toBeNull();
      });
    });
    it("enforces the budget at build time: the lowest-ranked placements are dropped first, and logged", () => {
      const heavy = parseKitManifest(stubManifestJson({ remove: ["stub_lift_portal"], extra: [{ id: "stub_lift_heavy", family: "vertical", file: "glb/h.glb", bytes: 1, triangles: 20_000, materials: ["stub_palette"], textures: { stub_palette: { res: 64, maps: ["albedo"] } }, bounds_m: { min: [-1, 0, -0.3], max: [1, 2.7, 0.9] }, placement: "wall", params: {}, sockets: [] }] }), "mobile");
      const logs: string[] = [];
      const r = planKitPlacements({ anchors: anchors(2, 5, 1), manifest: heavy, budget: KIT_BUDGET, caps: { ktx2: false }, log: (m) => logs.push(m) });
      // Gates (rank 3) come before lifts (5) and the toilet (6) and are cheap; a 20k-triangle lift is 20k of the 60k triangle cap, so two fit with the gates; the rest and the toilet go.
      expect(r.placed.filter((p) => p.role === "gate").length).toBe(2);
      expect(r.placed.filter((p) => p.role === "lift").length).toBe(2);
      expect(r.totals.triangles).toBeLessThanOrEqual(KIT_BUDGET.maxTriangles);
      expect(r.dropped.map((d) => d.role).sort()).toEqual(["lift", "lift", "lift", "toilet"]);
      expect(r.dropped.find((d) => d.role === "lift")!.reason).toMatch(/over budget \(triangles 60200 > 60000/);
      // With a roomier triangle cap the 3 MB geometry cap binds instead.
      const roomy = planKitPlacements({ anchors: anchors(0, 5), manifest: heavy, budget: { ...KIT_BUDGET, maxTriangles: 99e6 }, caps: { ktx2: false } });
      expect(roomy.placed.length).toBe(2);
      expect(roomy.dropped[0]!.reason).toMatch(/over budget \(geometry/);
      expect(r.dropped.find((d) => d.role === "toilet")!.reason).toMatch(/ranked below/);
      expect(logs.length).toBe(4);
      expect(logs.every((l) => /^kit swap: dropped /.test(l))).toBe(true);
      // Every cap holds for what was kept.
      const t = totalsFor(r.placed, heavy, { ktx2: false });
      expect(t.draws).toBeLessThanOrEqual(KIT_BUDGET.maxDraws);
      expect(t.geometryBytes).toBeLessThanOrEqual(KIT_BUDGET.maxGeometryBytes);
      expect(t.gpuTextureBytes).toBeLessThanOrEqual(KIT_BUDGET.maxGpuTextureBytes);
    });
    it("counts draws as level x material batches and caps them", () => {
      const r = planKitPlacements({ anchors: anchors(0, 4), manifest, budget: { ...KIT_BUDGET, maxDraws: 2 }, caps: { ktx2: false } });
      // One level, two materials per stub lift: two draws fit, so all four lifts fit.
      expect(r.placed.length).toBe(4);
      expect(r.totals.draws).toBe(2);
      const tight = planKitPlacements({ anchors: anchors(0, 4), manifest, budget: { ...KIT_BUDGET, maxDraws: 1 }, caps: { ktx2: false } });
      expect(tight.placed).toEqual([]);
    });
  });

  describe("placeholder ledger", () => {
    it("hides only the triangles of the named anchors and drops unreferenced vertices", () => {
      const tracked: unknown[] = [];
      const ledger = new PlaceholderLedger((x) => (tracked.push(x), x));
      const a = ledger.tag("lift-portals", "0", new THREE.BoxGeometry());
      const b = ledger.tag("lift-portals", "1", new THREE.BoxGeometry().translate(5, 0, 0));
      const other = new THREE.BoxGeometry().translate(9, 0, 0); // untagged: a different placeholder in the same mesh
      const geos = [a, b, other];
      const merged = mergeGeometries(geos, false)!;
      const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial());
      new THREE.Group().add(mesh);
      ledger.bind("lift-portals", mesh, geos);
      expect(ledger.keys("lift-portals").sort()).toEqual(["0", "1"]);
      const before = mesh.geometry.index!.count / 3;
      expect(ledger.hide("lift-portals", new Set(["1"]))).toBe(12);
      expect(mesh.geometry.index!.count / 3).toBe(before - 12);
      // The surviving geometry is exactly boxes 0 and the untagged one.
      mesh.geometry.computeBoundingBox();
      expect(mesh.geometry.boundingBox!.min.x).toBeCloseTo(-0.5);
      expect(mesh.geometry.boundingBox!.max.x).toBeCloseTo(9.5);
      expect(mesh.geometry.attributes.position!.count).toBe(48);
      expect(ledger.hide("lift-portals", new Set(["1"]))).toBe(0);
      expect(ledger.hide("lift-portals", new Set(["0"]))).toBe(12);
      expect(mesh.geometry.index!.count / 3).toBe(12);
    });
    it("removes a mesh that loses every triangle, and never touches another group", () => {
      const ledger = new PlaceholderLedger((x) => x);
      const g = ledger.tag("gate-machines", "e1", new THREE.BoxGeometry());
      const merged = mergeGeometries([g], false)!;
      const parent = new THREE.Group();
      const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial());
      parent.add(mesh);
      ledger.bind("gate-machines", mesh, [g]);
      expect(ledger.hide("lift-portals", new Set(["e1"]))).toBe(0);
      expect(mesh.parent).toBe(parent);
      expect(ledger.hide("gate-machines", new Set(["e1"]))).toBe(12);
      expect(mesh.parent).toBeNull();
    });
    it("compact() keeps attributes aligned", () => {
      const g = new THREE.BoxGeometry();
      const out = compact(g, [0, 1, 2, 20, 21, 22]);
      expect(out.attributes.position!.count).toBe(6);
      expect(out.attributes.uv!.count).toBe(6);
      expect(out.attributes.normal!.getX(3)).toBe(g.attributes.normal!.getX(20));
    });
  });

  describe("batching and tint", () => {
    it("draws only visual nodes, batches by contract material name, tints line_accent and leaves the source material alone", () => {
      const manifest = parseKitManifest(stubManifestJson(), "mobile");
      const provider = stubProvider();
      const placed = planKitPlacements({ anchors: { gates: [], lifts: [1, 2, 3].map((i) => ({ role: "lift" as const, key: String(i), nodeIds: [], wallPoint: { x: i * 3, y: 0 }, z: 0, u: { x: 1, y: 0 }, normal: { x: 0, y: 1 }, floorId: "L" })), runs: [], toilets: [], exits: [] }, manifest, budget: KIT_BUDGET, caps: { ktx2: false } }).placed;
      {
        const out = batchKitPlacements({ placed, manifest, provider, tint: tintSlots(OEDO_MAGENTA), track: (x) => x });
        expect(out.meshes.map((m) => m.name)).toEqual(["kit:L:gteki_line_accent", "kit:L:stub_palette"]);
        // 3 lifts x (1 body + 1 stripe) boxes of 12 triangles; the collision box (and socket, hint) never reach the scene.
        expect(out.triangles).toBe(3 * 12 + 3 * 12);
        const accent = out.meshes[0]!.material as THREE.MeshStandardMaterial;
        expect(`#${accent.color.getHexString()}`).toBe(`#${new THREE.Color(OEDO_MAGENTA).getHexString()}`);
        expect(accent).not.toBe(provider.materials.get("gteki_line_accent"));
        expect(provider.materials.get("gteki_line_accent")!.color.getHexString()).toBe("ffffff");
        expect(out.tinted).toEqual(["gteki_line_accent"]);
        expect(out.group.children.every((c) => (c as THREE.Mesh).isMesh)).toBe(true);
      }
    });
    it("reads gteki_name for AO-baked clones and drops the per-asset AO map from the shared material", () => {
      const manifest = parseKitManifest(stubManifestJson(), "mobile");
      const provider = stubProvider();
      const aoTexture = new THREE.Texture();
      const clone = (asset: string) => {
        const m = provider.materials.get("stub_palette")!.clone();
        m.name = `stub_palette~${asset}`;
        m.userData.gteki_name = "stub_palette";
        m.aoMap = aoTexture;
        return m;
      };
      const base = provider.instantiate.bind(provider);
      provider.instantiate = (a) => {
        const o = base(a)!;
        o.traverse((c) => { const mesh = c as THREE.Mesh; if (mesh.isMesh && mesh.material === provider.materials.get("stub_palette")) mesh.material = clone(a.id); });
        return o;
      };
      const placed = planKitPlacements({ anchors: { gates: [], lifts: [1, 2].map((i) => ({ role: "lift" as const, key: String(i), nodeIds: [], wallPoint: { x: i * 3, y: 0 }, z: 0, u: { x: 1, y: 0 }, normal: { x: 0, y: 1 }, floorId: "L" })), runs: [], toilets: [], exits: [] }, manifest, budget: KIT_BUDGET, caps: { ktx2: false } }).placed;
      {
        const out = batchKitPlacements({ placed, manifest, provider, tint: [], track: (x) => x });
        const names = out.meshes.map((m) => m.name);
        expect(names).toContain("kit:L:stub_palette");
        expect(names.filter((n) => n.includes("~"))).toEqual([]);
        expect((out.meshes.find((m) => m.name === "kit:L:stub_palette")!.material as THREE.MeshStandardMaterial).aoMap).toBeNull();
      }
    });
    it("reads asset roots from a kit bundle, using gteki_name for renamed nodes", () => {
      const holder = new THREE.Group();
      holder.userData.gteki_bundle = { contract: "gteki-kit-bundle/0.1" };
      const a = new THREE.Group();
      a.name = "stub_lift_portal_1";
      a.userData.gteki_name = "stub_lift_portal";
      holder.add(a);
      const scene = new THREE.Group();
      scene.add(holder);
      const manifest = parseKitManifest(stubManifestJson(), "mobile");
      const provider = bundleProvider(scene);
      const inst = provider.instantiate(manifest.byId.get("stub_lift_portal")!)!;
      expect(inst).not.toBe(a);
      expect(inst.parent).toBeNull();
      expect(provider.instantiate(manifest.byId.get("stub_gate_1aisle")!)).toBeNull();
    });
  });

  describe("in the real scene", () => {
    let off: StationScene;
    let on: StationScene;
    let report: KitSwapReport;
    let captured: KitApplyContext;
    let catalogResult: ReturnType<typeof buildStationCatalog>;
    const logs: string[] = [];
    const ctx = { THREE, bundle, quality: "low" as const } as never;

    beforeAll(() => {
      const context = new Proxy({}, { get: (_t, key) => (key === "createLinearGradient" || key === "createRadialGradient") ? () => ({ addColorStop() {} }) : () => undefined });
      vi.stubGlobal("document", { createElement: () => ({ width: 1, height: 1, getContext: () => context }) });
      off = assembleScene(ctx);
      const inner = createKitSwap({
        manifest: parseKitManifest(shinjukuStubManifestJson(catalogJson), "mobile"),
        provider: stubProvider(),
        caps: { ktx2: false },
        tint: tintSlots(OEDO_MAGENTA),
        log: (m) => logs.push(m),
      });
      const spy: KitSwap = { apply: (c) => { captured = c; report = inner.apply(c); return report; } };
      on = assembleScene(ctx, spy);
      const layout = buildLayout(bundle, planJson as unknown as Plan);
      catalogResult = buildStationCatalog(layout, protectFareAndAccess(layout, planJson as unknown as Plan, bundle));
    }, 120_000);
    afterAll(() => {
      off?.dispose();
      on?.dispose();
      vi.unstubAllGlobals();
    });

    it("flag off: the scene is byte-identical to fe8d3b6", () => {
      expect(off.root.userData.kitSwap).toBeUndefined();
      const digest = digestStation(off.root, isStationProxy);
      expect(digest).toEqual(FE8D3B6);
    });

    it("flag on: every placement lands on a real anchor, in the right role", () => {
      expect(report.placed.length).toBeGreaterThan(0);
      const gateEdges = new Set(bundle.edges.filter((e) => e.mode === "gate").map((e) => e.id));
      const anchors = collectKitAnchors({ layout: captured.layout, protection: captured.protection, plan: captured.plan, bundle, lifts: captured.liftAnchors });
      const facility = new Set(captured.plan.levels.flatMap((l) => l.facilities.filter((f) => ["F001", "F002", "F003"].includes(f.category)).map((f) => f.id)));
      for (const p of report.placed) {
        if (p.role === "gate") {
          expect(gateEdges.has(p.anchorKey)).toBe(true);
          const a = anchors.gates.find((g) => g.key === p.anchorKey)!;
          const ahead = new THREE.Vector3(0, 0, -0.95).applyEuler(new THREE.Euler(0, p.yaw, 0)).add(new THREE.Vector3(...p.position));
          expect(Math.hypot(ahead.x - a.center.x, ahead.z + a.center.y)).toBeLessThan(0.01);
        } else if (p.role === "lift") {
          const a = anchors.lifts.find((l) => l.key === p.anchorKey)!;
          expect(a).toBeDefined();
          // On an existing full-height wall of its level, 0.26 m + clearance in front of it.
          const wall = captured.layout.levels.flatMap((lv) => lv.walls).find((w) => {
            const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, l2 = dx * dx + dy * dy, t = ((a.wallPoint.x - w.a.x) * dx + (a.wallPoint.y - w.a.y) * dy) / l2;
            return t >= -1e-6 && t <= 1 + 1e-6 && Math.hypot(a.wallPoint.x - w.a.x - dx * t, a.wallPoint.y - w.a.y - dy * t) < 1e-6 && w.zMin <= a.z + 0.02 && w.zMax >= a.z + 2.5;
          });
          expect(wall).toBeDefined();
          expect(Math.hypot(p.position[0] - a.wallPoint.x, -p.position[2] - a.wallPoint.y)).toBeCloseTo(0.264, 3);
        } else if (p.role === "toilet") {
          expect(facility.has(p.anchorKey)).toBe(true);
        } else if (p.role === "stairs" || p.role === "escalator") {
          const a = anchors.runs.find((r) => r.key === p.anchorKey && r.role === p.role)!;
          expect(a).toBeDefined();
          // Origin on the lower end node, and the catalog says which piece fits this run.
          expect(p.position[0]).toBeCloseTo(a.lo.x, 6);
          expect(-p.position[2]).toBeCloseTo(a.lo.y, 6);
          expect(p.assetId).toBe(catalogResult.byAnchor.get(p.anchorKey));
        } else {
          throw new Error(`unexpected role ${p.role}`);
        }
      }
      // Every mounted portal is either placed once or dropped for budget (see the budget test): none is skipped or doubled.
      const lifts = report.placed.filter((p) => p.role === "lift").map((p) => p.anchorKey);
      expect(new Set(lifts).size).toBe(lifts.length);
      expect(lifts.length + report.dropped.filter((d) => d.role === "lift").length).toBe(captured.liftAnchors.length);
      expect(captured.liftAnchors.length).toBeGreaterThan(5);
      // Gate rows are the verified ones only: 4 rows from 5 gate edges.
      expect(report.placed.filter((p) => p.role === "gate").length).toBe(anchors.gates.length);
    });

    it("flag on, stub library at the estimated triangle counts: the budget keeps the highest-ranked placements", () => {
      // Stub counts (STUB_TRIANGLES): escalator 1352 (19 fitted runs), stairs 180 (24), gate 1800 (4 rows), lift 1090 (9 portals), toilet 100 (3).
      // Geometry is 70 B per merged triangle, so the 3 MB cap allows 42,857 triangles:
      //   19*1352 + 24*180 + 4*1800 = 37,208; five lifts add 5,450 = 42,658; a sixth (43,748) would breach, so the other 4 of the 9 portals and the 3 toilets go.
      const count = (role: string) => report.placed.filter((p) => p.role === role).length;
      expect([count("escalator"), count("stairs"), count("gate"), count("lift"), count("toilet")]).toEqual([19, 24, 4, 5, 0]);
      expect(report.dropped.filter((d) => d.role === "lift").length).toBe(4);
      expect(report.dropped.filter((d) => d.role === "toilet").length).toBe(3);
      expect(report.dropped.filter((d) => d.role === "escalator").map((d) => d.anchorKey).sort()).toEqual(catalogResult.unfitted.map((u) => u.edgeId).sort());
      expect(report.dropped.find((d) => d.role === "lift")!.reason).toMatch(/over budget \(geometry/);
      expect(report.totals.triangles).toBe(19 * STUB_TRIANGLES.escalator + 24 * STUB_TRIANGLES.stairs + 4 * STUB_TRIANGLES.gate + 5 * STUB_TRIANGLES.lift);
      expect(report.totals.triangles).toBeLessThanOrEqual(KIT_BUDGET.maxTriangles);
      expect(report.totals.geometryBytes).toBeLessThanOrEqual(KIT_BUDGET.maxGeometryBytes);
      expect(report.totals.draws).toBeLessThanOrEqual(KIT_BUDGET.maxDraws);
      // Lifts are dropped from the tail of the anchor order, never an escalator or stair for a lift.
      expect(report.placed.filter((p) => p.role === "lift").map((p) => p.anchorKey)).toEqual(["0", "1", "2", "3", "4"]);
    });

    it("the real kit 0.1.0 has no dressing piece, so with the real manifest stairs and escalators stay placeholders", () => {
      const mobile = parseKitManifest(library("mobile/manifest.json"), "mobile");
      const anchors = collectKitAnchors({ layout: captured.layout, protection: captured.protection, plan: captured.plan, bundle, lifts: captured.liftAnchors });
      expect(anchors.runs.filter((r) => r.role === "stairs").length).toBe(24);
      expect(anchors.runs.filter((r) => r.role === "escalator").length).toBe(21);
      const r = planKitPlacements({ anchors, manifest: mobile, budget: KIT_BUDGET, caps: { ktx2: false } });
      expect(r.placed.every((p) => p.role === "lift")).toBe(true);
      expect(r.gaps.filter((g) => /no (stairs|escalator|gate) piece/.test(g.reason)).map((g) => g.role).sort()).toEqual(["escalator", "gate", "stairs"]);
      // Exit tops: anchors exist for each street exit, the build records no placeholder for them, and no canopy exists.
      expect(anchors.exits.length).toBe(4);
      expect(r.gaps.find((g) => g.role === "exit")?.reason).toMatch(/does not record/);
      const exits = planKitPlacements({ anchors, manifest: mobile, budget: KIT_BUDGET, caps: { ktx2: false }, placeable: new Set(["exit"]) });
      expect(exits.gaps.find((g) => g.role === "exit")?.reason).toMatch(/no exit piece/);
    });

    it("flag on: no shop, kiosk, bench or vending piece is instantiated or drawn", () => {
      const ids = new Set(report.placed.map((p) => p.assetId));
      for (const id of ids) expect(id).not.toMatch(/bench|vending|kiosk|shop/);
      const names: string[] = [];
      on.root.traverse((o) => names.push(o.name));
      expect(names.join("|")).not.toMatch(/bench|vending|kiosk|shop/);
    });

    it("flag on: colliders, walls, walkable proxies, camera blockers and fences are unchanged", () => {
      expect(sha([on.walls])).toBe(sha([off.walls]));
      const hashes = (s: StationScene) => ({
        colliders: (s.colliders ?? []).map((m) => geometryHash((m as THREE.Mesh).geometry)),
        blockers: (s.cameraBlockers ?? []).map((m) => [m.name, geometryHash((m as THREE.Mesh).geometry)]),
        walkable: s.walkable.map((m) => geometryHash((m as THREE.Mesh).geometry)),
        spawn: s.spawnPoints,
      });
      expect(hashes(on)).toEqual(hashes(off));
      // The collision walls the kit sits on, and the gate-machine and fence collision props, come from `walls`.
      const killed = [...on.root.children].filter((c) => c.name === "kit-swap");
      expect(killed.length).toBe(1);
    });

    it("flag on: apart from the kit, only the triangles of replaced placeholders are gone", () => {
      const skip = (o: THREE.Object3D) => isStationProxy(o);
      const offTri = triangles(off.root, skip);
      const onTri = triangles(on.root, (o) => skip(o) || o.name === "kit-swap");
      const hidden = Object.values(report.hidden).reduce((s, n) => s + (n ?? 0), 0);
      expect(hidden).toBeGreaterThan(0);
      expect(offTri - onTri).toBe(hidden);
      // Gate placeholders really were replaced: their machines are among the hidden triangles.
      expect(report.hidden["gate-machines"]).toBeGreaterThan(0);
      expect(report.hidden["lift-portals"]).toBeGreaterThan(0);
      // Stair nosing: exactly one 12-triangle strip per step of every placed stair run is hidden, and no escalator geometry.
      const steps = report.placed.filter((p) => p.role === "stairs").reduce((n, p) => n + (catalogJson.assets.find((e) => e.id === p.assetId)!.params.step_count as number), 0);
      expect(report.hidden["stair-nosing"]).toBe(12 * steps);
    });

    it("flag on: the budget holds on what was actually built, and the report states it", () => {
      expect(report.measured.draws).toBeLessThanOrEqual(KIT_BUDGET.maxDraws);
      expect(report.measured.triangles).toBeLessThanOrEqual(KIT_BUDGET.maxTriangles);
      expect(report.measured.geometryBytes).toBeLessThanOrEqual(KIT_BUDGET.maxGeometryBytes);
      expect(report.totals.triangles).toBeGreaterThanOrEqual(report.measured.triangles);
      expect(report.license).toBe("STUB LICENCE STRING");
      expect(on.root.userData.kitSwap).toBe(report);
      expect(logs.some((l) => /^kit swap \(mobile\)/.test(l))).toBe(true);
    });

    it("flag on: line_accent is tinted to the Oedo magenta in the drawn kit", () => {
      expect(report.tinted).toEqual(["gteki_line_accent"]);
      const accents: THREE.Mesh[] = [];
      on.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.name.endsWith(":gteki_line_accent")) accents.push(m); });
      expect(accents.length).toBeGreaterThan(0);
      for (const m of accents) expect((m.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(new THREE.Color(OEDO_MAGENTA).getHexString());
    });

    it("flag on: the drawn kit meshes are plain merged meshes without collision, sockets or hints", () => {
      const kit = on.root.children.find((c) => c.name === "kit-swap")!;
      kit.traverse((o) => { expect(o.name).not.toMatch(/^(COL_|SOCKET_|LIGHTHINT_)|-colonly$/); });
      for (const c of kit.children) {
        expect((c as THREE.Mesh).isMesh).toBe(true);
        expect(on.walkable).not.toContain(c);
        expect(on.colliders).not.toContain(c);
        expect(on.cameraBlockers).not.toContain(c);
      }
    });
  });
});
