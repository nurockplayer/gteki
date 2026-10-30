import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createRouter } from "@gteki/navigation";
import type { StationBundle } from "@gteki/schema";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { floorLabel, narrate } from "../app/src/narrate.ts";

// The clearance-solved floor stack (B1 −7.80 … B6 −42.87) is display geometry: it may live in renderZ,
// renderElevationM and plan.heightModel, never in sourced fields, narration or unlabelled UI text.
const here = dirname(fileURLToPath(import.meta.url));
const { bundle } = loadShinjukuBundle();

describe("symbolic heights stay display-only", () => {
  it("leaves every sourced height null and records the gap as symbolic", () => {
    for (const f of bundle.floors) {
      expect(f.elevationM).toBeNull();
      expect(typeof f.renderElevationM).toBe("number");
    }
    for (const n of bundle.nodes) expect(n.position.z).toBeNull();
    expect(bundle.station.origin.hM).toBeNull();
    const gap = bundle.coverage.gaps.find((g) => g.id === "gap:heights");
    const heightsField = gap && typeof gap.fieldWorkNeeded !== "string" ? gap.fieldWorkNeeded.find((t) => t.lang === "en")?.text : gap?.fieldWorkNeeded;
    expect(heightsField).toMatch(/SYMBOLIC.*never measured/);
  });

  it("keeps the height model in the render plan, out of the contract files", () => {
    const plan = JSON.parse(readFileSync(join(here, "../data/plan.json"), "utf8"));
    expect(plan.heightModel.overheadClearanceM).toBe(2.3);
    for (const f of ["station.json", "graph.json"]) {
      const raw = readFileSync(join(here, "../gteki", f), "utf8");
      expect(raw).not.toMatch(/heightModel|overheadClearance/);
    }
  });

  it("narrates identically whatever the display heights are (no metres of depth in any instruction)", () => {
    // Order-preserving rescale of every display height: up/down wording may depend on order, nothing else may.
    const warped: StationBundle = {
      ...bundle,
      floors: bundle.floors.map((f) => ({ ...f, renderElevationM: f.renderElevationM * 3 - 5 })),
      nodes: bundle.nodes.map((n) => ({ ...n, renderZ: (n.renderZ ?? 0) * 3 - 5 })),
    };
    const router = createRouter(bundle);
    let routes = 0;
    for (const a of bundle.pois)
      for (const b of bundle.pois) {
        if (a === b) continue;
        const r = router.route(a.connectorNodeIds, b.connectorNodeIds, { fare: "ticketed", stepFree: false, today: "2026-10-21" });
        if (!r.ok) continue;
        routes++;
        const strip = (ms: ReturnType<typeof narrate>) => ms.map((m) => [m.ja, m.en]);
        expect(strip(narrate(warped, r))).toEqual(strip(narrate(bundle, r)));
      }
    expect(routes).toBeGreaterThan(100);
    for (const f of bundle.floors) expect(Object.values(floorLabel(f)).join(" ")).not.toMatch(/\d\s*m\b/);
  });

  it("labels every display height in the lane HUD as estimated", () => {
    const main = readFileSync(join(here, "../app/src/main.ts"), "utf8");
    const shown = main.split("\n").filter((l) => /textContent/.test(l) && /renderElevationM|renderZ|player\.z/.test(l));
    expect(shown.length).toBeGreaterThan(0);
    for (const l of shown) expect(l).toMatch(/推定.*est\./);
    expect(main).toContain("高さは推定 Heights estimated");
  });

  it("marks stairs and escalators whose anchored display rise is impossible (gteki #644)", () => {
    const nodeById = new Map(bundle.nodes.map((n) => [n.id, n]));
    const floorById = new Map(bundle.floors.map((f) => [f.id, f]));
    const displayZ = (id: string) => {
      const n = nodeById.get(id)!;
      return n.position.z ?? n.renderZ ?? floorById.get(n.floorId)!.renderElevationM;
    };
    // Shrink-only (gteki #644): remove an id when field work fixes its floor id; never add one without a ruling.
    const APPROX_ALLOWED = new Set([
      "e:c690df6cad7b48bba7b3b30fee65eda2",
      "e:c3fe6342f158400ab602dd610f636329",
      "e:dcbc1a258ceb41b09ab50e417aabc8b4",
      "e:bdcdf9229c9f49dc9bc02bec79c4a8fe",
      "e:c7fa5f74d72f43498ef2cb3b1dbea7e4",
      "e:c2c4ebb36e374e1da3dde94d3a5257d6",
      "e:45ebdab487134925b3b47cd29bffb99c",
      "e:4038cecf024c417a87310ab9859a7404",
    ]);
    for (const e of bundle.edges) {
      if (e.mode === "stairs" || e.mode === "escalator") {
        const a = nodeById.get(e.from)!;
        const b = nodeById.get(e.to)!;
        const plan = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
        const rise = Math.abs(displayZ(e.from) - displayZ(e.to));
        if ((plan > 0 && rise / plan > 1.0) || rise < 0.05) expect(e.attributes?.displayHeightApprox, e.id).toBe(true);
      }
      if (e.attributes?.displayHeightApprox) expect(APPROX_ALLOWED.has(e.id), e.id).toBe(true);
      if (e.mode === "elevator") expect(e.attributes?.displayHeightApprox).toBeUndefined();
    }
  });
});
