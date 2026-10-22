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
    expect(gap?.fieldWorkNeeded).toMatch(/SYMBOLIC.*never measured/);
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
});
