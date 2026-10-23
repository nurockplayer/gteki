import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { protectFareAndAccess } from "../scene/fare-fence.ts";
import { buildLayout, type Plan } from "../scene/layout.ts";
import { runAnchors } from "../scene/kit/anchors.ts";
import {
  buildStationCatalog, CATALOG_FIT_LIMITS, CATALOG_ID_PATTERN, ESCALATOR_AO_RES, escalatorProblem, STAIR_AO_RES, validateStationCatalog, type CatalogEntry, type StationCatalog,
} from "../scene/kit/catalog.ts";
import { escalatorPlacement, stairPlacement } from "../scene/kit/place.ts";
import { parseKitManifest } from "../scene/kit/manifest.ts";
import { renderCatalog } from "../tools/kit-catalog.ts";
import { catalogStubAssets, stubManifestJson } from "./helpers/kit-stub.ts";

const committed = JSON.parse(readFileSync(new URL("../kit/catalog.json", import.meta.url), "utf8")) as StationCatalog;
const { bundle } = loadShinjukuBundle();
const plan = planJson as unknown as Plan;
const layout = buildLayout(bundle, plan);
const protection = protectFareAndAccess(layout, plan, bundle);
const fresh = buildStationCatalog(layout, protection);
const runs = runAnchors(layout);

describe("Shinjuku station catalog for the Lane E kit (Issue #94)", () => {
  it("is valid: kit catalog shape, id pattern, params inside the generator ranges", () => {
    expect(validateStationCatalog(committed)).toEqual([]);
    for (const e of committed.assets) expect(e.id).toMatch(CATALOG_ID_PATTERN);
    expect(new Set(committed.assets.map((e) => e.id)).size).toBe(committed.assets.length);
    // Same entry shape as tools/blender/catalog/kit_v0_1.json (id, generator, params, tags) plus build.py's dimension_basis and notes.
    const kit = JSON.parse(readFileSync(new URL("../../../tools/blender/catalog/kit_v0_1.json", import.meta.url), "utf8"));
    expect(Object.keys(kit)).toEqual(expect.arrayContaining(["catalog", "version", "notes", "assets"]));
    for (const k of ["catalog", "version", "notes", "assets"]) expect(committed).toHaveProperty(k);
    // anchor, ao_res and gteki_role are optional keys: dressings carry all three, the gate carries collision false only.
    for (const e of committed.assets) expect(Object.keys(e).filter((k) => !["anchor", "ao_res", "gteki_role", "collision"].includes(k)).sort()).toEqual(["dimension_basis", "generator", "id", "notes", "params", "tags"]);
  });

  it("dressings carry category AO and linear_run anchor at entry level; the gate array carries neither", () => {
    const dressings = committed.assets.filter((e) => e.generator !== "gate_array");
    expect(dressings.map((e) => e.generator).filter((g) => g === "escalator_dressing").length).toBe(10);
    expect(dressings.map((e) => e.generator).filter((g) => g === "stair_dressing").length).toBe(22);
    for (const e of dressings) {
      expect(e.ao_res).toBe(e.generator === "stair_dressing" ? STAIR_AO_RES : ESCALATOR_AO_RES);
      expect(e.anchor).toBe("linear_run");
      expect(e.params).not.toHaveProperty("ao_res");
      // Visual-only: an explicit null role, so Lane E's builder does not tag them stairs_ramps or transport.
      expect(e).toHaveProperty("gteki_role", null);
      expect(e).not.toHaveProperty("collision");
    }
    for (const e of committed.assets.filter((x) => x.generator === "gate_array")) {
      expect(e).not.toHaveProperty("ao_res");
      expect(e).not.toHaveProperty("anchor");
      expect(e).not.toHaveProperty("gteki_role");
      // Lane E strips the gate's COL_* nodes, so Godot builds no StaticBody for it.
      expect(e).toHaveProperty("collision", false);
    }
  });

  it("is exactly what the generator derives from the current data (regenerate with pnpm kit:catalog)", () => {
    expect(renderCatalog().text).toBe(`${JSON.stringify(committed, null, 2)}\n`);
    expect(fresh.catalog).toEqual(committed);
  });

  it("covers every verified gate row and every stair and escalator run the kit can fit, grouped by identical params", () => {
    const stairs = runs.filter((r) => r.role === "stairs"), escalators = runs.filter((r) => r.role === "escalator");
    expect([stairs.length, escalators.length, protection.gates.length]).toEqual([24, 21, 4]);
    const covered = (g: string) => committed.assets.filter((e) => e.generator === g);
    expect(fresh.unfitted.map((u) => [u.role, u.edgeId.slice(2, 8)])).toEqual([["escalator", "4bee1c"], ["escalator", "27d3ed"]]);
    expect(stairs.every((r) => fresh.byAnchor.has(r.key))).toBe(true);
    expect(escalators.filter((r) => fresh.byAnchor.has(r.key)).length).toBe(19);
    expect(protection.gates.every((g) => fresh.byAnchor.has(g.edgeId))).toBe(true);
    // Identical params share one id (the scene has more runs than the catalog has entries).
    expect(covered("escalator_dressing").length).toBeLessThan(19);
    expect(covered("stair_dressing").length).toBeLessThanOrEqual(24);
    expect(covered("gate_array").length).toBe(1);
    const paramKeys = committed.assets.map((e) => `${e.generator}:${JSON.stringify(e.params)}`);
    expect(new Set(paramKeys).size).toBe(paramKeys.length);
  });

  it("records every run's edge id and states that the heights are symbolic and the sizes drawn, not surveyed", () => {
    for (const e of committed.assets) {
      const edges = [...fresh.byAnchor].filter(([, id]) => id === e.id).map(([edge]) => edge);
      expect(edges.length).toBeGreaterThan(0);
      for (const edge of edges) expect(e.notes).toContain(edge);
      expect(e.dimension_basis).toBe("synthetic");
      if (e.generator !== "gate_array") expect(e.notes).toMatch(/symbolic \(station\.json hM is null\)[\s\S]*not a survey/);
    }
    expect(committed.notes).toMatch(/symbolic, not surveyed/);
  });

  it("does not state a gate clear width as a fact: the kit default 1.02 m is noted as a visual default", () => {
    const gate = committed.assets.find((e) => e.generator === "gate_array")!;
    expect(gate.params).toEqual({ aisles: 1, wide_aisles: [0], wide_w: 1.02 });
    expect(gate.notes).toMatch(/kit default clear width and a visual default/);
    expect(gate.notes).toMatch(/no source in this dataset states a gate clear width/);
    expect(gate.notes).not.toMatch(/verified (clear )?width/i);
  });

  it("derives each stair and escalator param from the drawn run (quantisation inside the fit tolerance)", () => {
    for (const r of runs) {
      const id = fresh.byAnchor.get(r.key);
      if (!id) continue;
      const e = committed.assets.find((x) => x.id === id)!;
      const rise = r.hi.z - r.lo.z, length = Math.hypot(r.hi.x - r.lo.x, r.hi.y - r.lo.y);
      const p = e.params as Record<string, number>;
      if (e.generator === "stair_dressing") {
        expect(Math.abs((p.step_count! * p.riser_mm!) / 1000 - rise)).toBeLessThan(CATALOG_FIT_LIMITS.riseM / 2);
        expect(Math.abs((p.step_count! * p.tread_mm!) / 1000 - length)).toBeLessThan(CATALOG_FIT_LIMITS.lengthM / 2);
        expect(p.width_mm).toBe(Math.round(r.width * 1000));
        expect(p.step_count).toBe(Math.max(2, Math.round(rise / 0.165)));
      } else {
        expect(Math.abs(p.rise_mm! / 1000 - rise)).toBeLessThan(CATALOG_FIT_LIMITS.riseM / 2);
        expect(Math.abs(p.run_mm! / 1000 + 2.4 - length)).toBeLessThan(CATALOG_FIT_LIMITS.lengthM / 2);
        expect(p.width_mm).toBe(Math.round((r.width - 0.1) * 1000));
        expect(escalatorProblem(e.params)).toBeNull();
      }
    }
  });

  it("every run fits its own catalog piece under the placement fit check, and no other width class", () => {
    const manifest = parseKitManifest(stubManifestJson({ extra: catalogStubAssets(committed) }), "mobile");
    for (const r of runs) {
      const id = fresh.byAnchor.get(r.key);
      if (!id) continue;
      const asset = manifest.byId.get(id)!;
      const fit = r.role === "stairs" ? stairPlacement(r, asset) : escalatorPlacement(r, asset);
      expect([r.key, fit !== null]).toEqual([r.key, true]);
    }
  });

  it("validation rejects what the generators would reject", () => {
    const base = committed.assets.find((e) => e.generator === "escalator_dressing")!;
    const stair = committed.assets.find((e) => e.generator === "stair_dressing")!;
    const gate = committed.assets.find((e) => e.generator === "gate_array")!;
    const mutate = (e: CatalogEntry, patch: Partial<CatalogEntry>) => ({ ...committed, assets: [{ ...e, ...patch }] });
    expect(validateStationCatalog(mutate(base, { id: "Gteki-Bad" })).join()).toMatch(/id must match/);
    expect(validateStationCatalog(mutate(base, { params: { ...base.params, rise_mm: 20000, run_mm: 2000 } })).join()).toMatch(/incline/);
    expect(validateStationCatalog(mutate(base, { params: { ...base.params, flat_steps: 4 } })).join()).toMatch(/flat_steps/);
    expect(validateStationCatalog(mutate(base, { params: { ...base.params, parts: ["balustrade", "comb", "newel"] } })).join()).toMatch(/parts/);
    expect(validateStationCatalog(mutate(stair, { params: { ...stair.params, step_count: 90 } })).join()).toMatch(/step_count/);
    expect(validateStationCatalog(mutate(gate, { params: { ...gate.params, wide_w: 1.2 } })).join()).toMatch(/wide_w/);
    expect(validateStationCatalog(mutate(gate, { dimension_basis: "station-verified" as never })).join()).toMatch(/station-verified/);
    expect(validateStationCatalog(mutate(base, { gteki_role: "transport" as never })).join()).toMatch(/gteki_role must be null/);
    expect(validateStationCatalog(mutate(stair, { gteki_role: "stairs_ramps" as never })).join()).toMatch(/gteki_role must be null/);
    expect(validateStationCatalog(mutate(base, { gteki_role: undefined })).join()).toMatch(/gteki_role must be null/);
    expect(validateStationCatalog(mutate(gate, { gteki_role: null })).join()).toMatch(/gteki_role is set on stair and escalator/);
    expect(validateStationCatalog(mutate(gate, { collision: true as never })).join()).toMatch(/collision must be false/);
    expect(validateStationCatalog(mutate(gate, { collision: undefined })).join()).toMatch(/collision must be false/);
    expect(validateStationCatalog(mutate(base, { collision: false as never })).join()).toMatch(/collision is set on the gate array only/);
    expect(validateStationCatalog(mutate(base, { ao_res: 64 as never })).join()).toMatch(/ao_res must be one of/);
    expect(validateStationCatalog(mutate(base, { ao_res: 128 })).join()).toMatch(/ao_res must be 256/);
    expect(validateStationCatalog(mutate(stair, { ao_res: 256 })).join()).toMatch(/ao_res must be 128/);
    expect(validateStationCatalog(mutate(stair, { ao_res: undefined })).join()).toMatch(/ao_res must be 128/);
    expect(validateStationCatalog(mutate(base, { anchor: undefined })).join()).toMatch(/anchor must be linear_run/);
    expect(validateStationCatalog(mutate(gate, { anchor: "linear_run" })).join()).toMatch(/anchor is set on stair and escalator/);
    expect(validateStationCatalog(mutate(gate, { ao_res: 128 })).join()).toMatch(/stair and escalator dressings only/);
    expect(validateStationCatalog({ ...committed, assets: [base, base] }).join()).toMatch(/duplicate id/);
    expect(validateStationCatalog({})).not.toEqual([]);
  });
});
