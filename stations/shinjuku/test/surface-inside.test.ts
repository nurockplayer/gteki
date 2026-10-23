import { describe, expect, it } from "vitest";
import { pointInRings } from "../scene/layout.ts";
import { inside } from "../scene/surface-street.ts";
import surfaceJson from "../data/surface.json";
import type { SurfaceData } from "../scene/surface.ts";

// surface-street's numeric containment must agree exactly with layout's pointInRings (outer ring minus holes).
describe("surface containment", () => {
  it("matches pointInRings on every PLATEAU building at seeded points", () => {
    const polys = (surfaceJson as unknown as SurfaceData).buildings.map((b) => b.rings);
    const asXY = polys.map((poly) => poly.map((r) => r.map(([x, y]) => ({ x: x!, y: y! }))));
    let seed = 27, hits = 0;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 4000; i++) {
      const p = { x: -300 + rand() * 600, y: -200 + rand() * 600 };
      const got = inside(p, polys);
      expect(got).toBe(asXY.some((poly) => pointInRings(p, poly)));
      if (got) hits++;
    }
    expect(hits).toBeGreaterThan(200);
  });
});
