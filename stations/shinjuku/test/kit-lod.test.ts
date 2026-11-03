import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { KIT_BUDGET } from "../scene/kit/config.ts";
import { PlaceholderLedger } from "../scene/kit/ledger.ts";
import { batchDistanceKit } from "../scene/kit/lod.ts";
import { parseKitManifest } from "../scene/kit/manifest.ts";
import { planKitPlacements } from "../scene/kit/place.ts";
import type { KitAnchors, KitPlacement } from "../scene/kit/types.ts";
import { stubAsset, stubManifestJson, stubProvider } from "./helpers/kit-stub.ts";

describe("kit distance LOD", () => {
  it("admits a twentieth fitted run beyond 60k resident triangles while retaining the 3 MB guard", () => {
    const manifest = parseKitManifest(stubManifestJson({ extra: [stubAsset("test_dressing", "dressing", "linear", {
      triangles: 3050, tags: ["dressing", "escalator"], materials: ["stub_steel"], textures: {},
      params: { rise_mm: 3200, width_mm: 1150, run_mm: 6800, parts: ["balustrade", "handrail", "newel", "comb"] },
    })] }), "mobile");
    const anchors: KitAnchors = { gates: [], lifts: [], toilets: [], exits: [], runs: Array.from({ length: 22 }, (_, i) => ({
      role: "escalator", key: String(i), floorId: "B1", lo: { x: i * 100, y: 0, z: 0 }, hi: { x: i * 100 + 8.4, y: 0, z: 3.2 }, width: 1.25, dir: { x: 1, y: 0 },
    })) };
    const plan = planKitPlacements({ anchors, manifest, budget: KIT_BUDGET, caps: { ktx2: false } });
    expect(plan.placed).toHaveLength(21);
    expect(plan.totals.triangles).toBe(64050);
    expect(plan.totals.geometryBytes).toBeLessThanOrEqual(3_000_000);
    expect(plan.dropped[0]!.reason).toMatch(/geometry/);
  });
  const setup = (budget = KIT_BUDGET) => {
    const owned: { dispose(): void }[] = [];
    const track = <T extends { dispose(): void }>(v: T): T => { owned.push(v); return v; };
    const manifest = parseKitManifest(stubManifestJson(), "mobile");
    const ledger = new PlaceholderLedger(track);
    const anchors: KitAnchors = { runs: [], gates: [], lifts: [], toilets: [], exits: [] };
    // Two nearby runs share a cluster across floor labels, while a third is 100 m away.
    const placed: KitPlacement[] = [0, 4, 100].map((x, i) => {
      const floorId = i === 1 ? "B2" : "B1";
      anchors.runs.push({ role: "escalator", key: String(i), floorId, lo: { x, y: 0, z: 0 }, hi: { x, y: 10, z: 5 }, width: 1, dir: { x: 0, y: 1 } });
      return { role: "escalator", anchorKey: String(i), floorId, position: [x, 0, 0], yaw: 0, assetId: "stub_lift_portal", rank: 1, replaces: "escalator-balustrade" };
    });
    const geos = placed.map((p) => track(ledger.tag("escalator-balustrade", p.anchorKey, new THREE.BoxGeometry().translate(...p.position))));
    const original = new THREE.Mesh(track(mergeGeometries(geos, false)!), track(new THREE.MeshBasicMaterial()));
    new THREE.Group().add(original);
    ledger.bind("escalator-balustrade", original, geos);
    const result = batchDistanceKit({ placed, manifest, provider: stubProvider(), tint: [], track }, anchors, ledger, budget, { ktx2: false });
    const near = result.group.children.filter((g) => g.name.startsWith("kit-near:"));
    const far = result.group.children.filter((g) => g.name === "kit-fallback");
    const checkPair = () => near.forEach((g, i) => expect(Number(g.visible) + Number(far[i]!.visible)).toBe(1));
    const dispose = () => owned.forEach((v) => v.dispose());
    return { ...result, near, far, checkPair, original, ledger, dispose };
  };

  it("keeps the exact procedural triangles and switches whole merged clusters with hysteresis", () => {
    const s = setup();
    try {
      expect(s.near).toHaveLength(2);
      expect(s.near[0]!.children).toHaveLength(4); // original floor/material batches, one visibility cluster
      expect(s.far[0]!.children[0]!.children).toHaveLength(1);
      const fallback = s.far[0]!.children[0]!.children[0] as THREE.Mesh;
      expect(fallback.geometry.index!.count).toBe(72);
      expect(s.original.geometry.index!.count).toBe(108); // copy did not mutate the source
      s.ledger.hide("escalator-balustrade", new Set(["0", "1", "2"]));
      expect(s.original.parent).toBeNull();
      for (const [x, expected] of [[-25, false], [-24, true], [-28, true], [-33, false], [-28, false], [0, true]] as const) {
        s.lod.update({ x, y: 0, z: 0 });
        expect(s.near[0]!.visible).toBe(expected);
        expect(s.lod.active.has("0")).toBe(expected);
        s.checkPair();
      }
      s.lod.update({ x: 100, y: 0, z: 0 });
      expect([...s.lod.active]).toEqual(["2"]);
      s.checkPair();
      s.lod.update({ x: 100, y: 0, z: 100 }); // distance includes height
      expect(s.lod.active.size).toBe(0);
      s.checkPair();
    } finally { s.dispose(); }
  });

  it("leaves the procedural cluster visible when the active triangle or draw cap cannot admit it", () => {
    for (const budget of [{ ...KIT_BUDGET, maxTriangles: 1 }, { ...KIT_BUDGET, maxDraws: 1 }]) {
      const s = setup(budget);
      try {
        s.lod.update({ x: 0, y: 0, z: 0 });
        expect(s.lod.active.size).toBe(0);
        s.checkPair();
      } finally { s.dispose(); }
    }
  });
});
